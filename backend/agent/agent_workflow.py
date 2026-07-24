import asyncio
import random
import logging
import os
import re
import json
import urllib.request
import urllib.parse
from typing import TypedDict, List, Dict, Any, Literal, Optional
from opentelemetry import trace
from langgraph.graph import StateGraph, END
import google.generativeai as genai
from pydantic import BaseModel, Field
from backend.event.event_broker import event_broker
from backend.telemetry.otel_config import tracer
from backend.service.scenario_engine import get_scenario
from backend.config import has_configured_gemini_api_key

logger = logging.getLogger("blackbox.agent")

# Configure Google Gemini client
gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
gemini_model = None
if has_configured_gemini_api_key():
    try:
        genai.configure(api_key=gemini_key)
        gemini_model = genai.GenerativeModel(GEMINI_MODEL)
        logger.info(f"Google Gemini SDK client configured successfully with model {GEMINI_MODEL}.")
    except Exception as e:
        logger.error(f"Error configuring Gemini SDK client: {e}")

# --- Pydantic Output Validation Schema ---

class WeatherDetail(BaseModel):
    city: str = Field(description="The name of the city.")
    temperature: float = Field(description="The temperature value in Celsius.")
    forecast: str = Field(description="Weather condition forecast (e.g. Rain, Clear, Sunny, Cloudy).")
    wind_speed_kmh: Optional[float] = Field(None, description="Wind speed in km/h if available.")

class AgentResponse(BaseModel):
    response_text: str = Field(description="Conversational answer responding to the user's prompt query.")
    is_weather_report: bool = Field(description="True if the response contains a weather forecast, False otherwise.")
    weather_details: Optional[WeatherDetail] = Field(None, description="Detailed weather metrics structure if is_weather_report is True.")

# --- LangGraph Agent State Definition ---

class AgentState(TypedDict):
    trace_id: str
    prompt: str
    scenario_id: str
    response: str
    nodes_executed: List[str]
    retries: int
    errors: int
    cost: float
    tokens: int
    weather_info: str
    has_failed: bool
    validation_error: Optional[str]
    retrieved_docs: Optional[List[Dict[str, Any]]]

# Helper to trace nodes and stream event broker messages
async def run_node_with_telemetry(state: AgentState, node_name: str, logic_fn) -> Dict[str, Any]:
    trace_id = state["trace_id"]
    
    # 1. Publish NODE_STARTED event
    await event_broker.publish(trace_id, "NODE_STARTED", {
        "node_name": node_name,
        "input": {
            "prompt": state["prompt"],
            "retries": state["retries"]
        }
    })
    
    # 2. Execute within OpenTelemetry Span
    with tracer.start_as_current_span(node_name) as span:
        span.set_attribute("agent.trace_id", trace_id)
        span.set_attribute("agent.node_name", node_name)
        span.set_attribute("agent.scenario_id", state["scenario_id"])
        
        try:
            # Run the node's specific logic
            output, cost_delta, token_delta = await logic_fn(state)
            
            span.set_attribute("agent.node_status", "success")
            span.set_attribute("gen_ai.usage.total_tokens", token_delta)
            span.set_attribute("gen_ai.usage.cost", cost_delta)
            
            # 3. Publish NODE_COMPLETED event
            await event_broker.publish(trace_id, "NODE_COMPLETED", {
                "node_name": node_name,
                "output": output,
                "metrics": {
                    "cost_delta": cost_delta,
                    "token_delta": token_delta
                }
            })
            
            return {
                "output": output,
                "cost_delta": cost_delta,
                "token_delta": token_delta,
                "error": None
            }
            
        except Exception as e:
            span.set_attribute("agent.node_status", "failed")
            span.record_exception(e)
            
            # Publish ERROR event
            await event_broker.publish(trace_id, "ERROR", {
                "node_name": node_name,
                "error_message": str(e)
            })
            
            return {
                "output": None,
                "cost_delta": 0,
                "token_delta": 0,
                "error": e
            }

# --- Nodes implementation ---

async def parse_prompt_node(state: AgentState) -> Dict[str, Any]:
    sc = get_scenario(state["scenario_id"])
    async def logic(s):
        await asyncio.sleep(sc.prompt_parser_delay)
        return "Cleaned query structure", 0.0, 42
    
    res = await run_node_with_telemetry(state, "Prompt Parser", logic)
    return {
        "nodes_executed": state["nodes_executed"] + ["parse_prompt"],
        "tokens": state["tokens"] + res["token_delta"],
        "cost": state["cost"] + res["cost_delta"]
    }

async def embedding_node(state: AgentState) -> Dict[str, Any]:
    sc = get_scenario(state["scenario_id"])
    async def logic(s):
        await asyncio.sleep(sc.embedding_delay)
        return "dense_vector_128d", 0.00003, 128
        
    res = await run_node_with_telemetry(state, "Embedding (text-3-small)", logic)
    return {
        "nodes_executed": state["nodes_executed"] + ["embedding"],
        "tokens": state["tokens"] + res["token_delta"],
        "cost": state["cost"] + res["cost_delta"]
    }

async def retriever_node(state: AgentState) -> Dict[str, Any]:
    sc = get_scenario(state["scenario_id"])
    trace_id = state["trace_id"]
    
    # Ingest / Query using the modular retrieval service
    from backend.service.retrieval_backend import get_retriever
    retriever = get_retriever()
    
    # Run the retriever search
    docs = await retriever.retrieve(trace_id, state["prompt"], limit=3)
    
    # Combine content snippets as a weather context reference
    context_text = "\n\n".join([f"Document Source [{d['source_file']} - {d['section']}]: {d['text']}" for d in docs])
    
    return {
        "nodes_executed": state["nodes_executed"] + ["retriever"],
        "retrieved_docs": docs,
        "weather_info": context_text if context_text else state["weather_info"]
    }

async def llm_router_node(state: AgentState) -> Dict[str, Any]:
    trace_id = state["trace_id"]
    sc = get_scenario(state["scenario_id"])
    async def logic(s):
        await asyncio.sleep(sc.llm_router_delay)
        
        route_decision = "route_to_weather"
        cost_delta = 0.0015
        token_delta = 600
        
        if gemini_model:
            try:
                prompt_text = (
                    f"Analyze this query and decide if we need a weather tool forecast query to answer it. "
                    f"Respond with exactly 'route_to_weather' or 'direct_answer' (no extra text, no markdown). "
                    f"Query: {s['prompt']}"
                )
                
                loop = asyncio.get_event_loop()
                response = await loop.run_in_executor(
                    None, 
                    lambda: gemini_model.generate_content(prompt_text)
                )
                
                cleaned_text = response.text.strip().lower()
                
                # Stream the router analysis tokens live in the UI
                stream_tokens = ["Routing", " analysis:", f" {response.text.strip()}"]
                for token in stream_tokens:
                    await event_broker.publish(trace_id, "ROUTER_STREAM", {"token": token})
                    await asyncio.sleep(0.04)
                    
                if "direct_answer" in cleaned_text:
                    route_decision = "direct_answer"
                
                token_delta = len(prompt_text.split()) + len(response.text.split()) + 50
                cost_delta = (token_delta / 1000) * 0.00015
                
            except Exception as e:
                logger.error(f"Error invoking Gemini in llm_router_node: {e}")
                tokens = ["Weather", " query", " requires", " tool", " execution."]
                for token in tokens:
                    await event_broker.publish(trace_id, "ROUTER_STREAM", {"token": token})
                    await asyncio.sleep(0.04)
        else:
            tokens = ["Weather", " query", " requires", " tool", " execution."]
            for token in tokens:
                await event_broker.publish(trace_id, "ROUTER_STREAM", {"token": token})
                await asyncio.sleep(0.04)

        return route_decision, cost_delta * sc.llm_token_multiplier, int(token_delta * sc.llm_token_multiplier)
        
    res = await run_node_with_telemetry(state, "LLM Router", logic)
    return {
        "nodes_executed": state["nodes_executed"] + ["llm_router"],
        "tokens": state["tokens"] + res["token_delta"],
        "cost": state["cost"] + res["cost_delta"]
    }

async def weather_tool_node(state: AgentState) -> Dict[str, Any]:
    trace_id = state["trace_id"]
    sc = get_scenario(state["scenario_id"])
    retries = state["retries"]
    errors = state["errors"]
    
    await event_broker.publish(trace_id, "NODE_STARTED", {
        "node_name": "Weather Tool (JMA)",
        "input": {"endpoint": "api.open-meteo.com/v1/forecast"}
    })
    
    with tracer.start_as_current_span("weather_tool") as span:
        span.set_attribute("agent.trace_id", trace_id)
        span.set_attribute("agent.node_name", "Weather Tool (JMA)")
        span.set_attribute("agent.scenario_id", state["scenario_id"])
        
        await asyncio.sleep(sc.weather_tool_delay)
        
        # 1. API Failure case
        if sc.weather_tool_fail:
            if retries < sc.weather_tool_max_retries:
                await event_broker.publish(trace_id, "RETRY", {
                    "node_name": "Weather Tool (JMA)",
                    "attempt": retries + 1,
                    "error": "HTTP 500 Internal Server Error"
                })
                return {
                    "retries": retries + 1,
                    "errors": errors + 1
                }
            else:
                await event_broker.publish(trace_id, "ERROR", {
                    "node_name": "Weather Tool (JMA)",
                    "error_message": "Upstream Weather API collapsed (HTTP 500) after retries."
                })
                span.set_attribute("agent.node_status", "failed")
                return {
                    "nodes_executed": state["nodes_executed"] + ["weather_tool"],
                    "errors": errors + 1,
                    "has_failed": True
                }

        # 2. Retry Storm case
        if sc.weather_tool_max_retries > 0 and retries < sc.weather_tool_max_retries:
            await event_broker.publish(trace_id, "RETRY", {
                "node_name": "Weather Tool (JMA)",
                "attempt": retries + 1,
                "error": "HTTP 429 Too Many Requests (Rate Limited)"
            })
            return {
                "retries": retries + 1,
                "errors": errors + 1
            }

        # Success case: Fetch real-time weather dynamically based on prompt city name
        city = "Tokyo"
        prompt_clean = state["prompt"].rstrip('?').rstrip('.').strip()
        match = re.search(r'\b(?:in|for|at|of)\b\s+([a-zA-Z\s]+)', prompt_clean, re.IGNORECASE)
        if match:
            city = match.group(1).strip()
        else:
            words = [w.strip() for w in re.split(r'\s+', prompt_clean) if w.strip()]
            if words:
                city = words[-1] if words[-1][0].isupper() else words[0]

        logger.info(f"Weather tool geocoding city: {city}...")
        weather_data = f"Forecast for tomorrow in {city}: Rain (68% probability), Temperature: 22°C."
        try:
            geo_url = f"https://geocoding-api.open-meteo.com/v1/search?name={urllib.parse.quote(city)}&count=1"
            req = urllib.request.Request(geo_url, headers={'User-Agent': 'Mozilla/5.0'})
            loop = asyncio.get_event_loop()
            
            def run_geo():
                with urllib.request.urlopen(req, timeout=3.0) as r:
                    return json.loads(r.read().decode('utf-8'))
            
            geo_data = await loop.run_in_executor(None, run_geo)
            
            if geo_data.get("results"):
                result = geo_data["results"][0]
                lat = result["latitude"]
                lon = result["longitude"]
                city_name = result.get("name", city)
                country = result.get("country", "")
                
                weather_url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current_weather=true"
                req_w = urllib.request.Request(weather_url, headers={'User-Agent': 'Mozilla/5.0'})
                
                def run_weather():
                    with urllib.request.urlopen(req_w, timeout=3.0) as r:
                        return json.loads(r.read().decode('utf-8'))
                
                w_data = await loop.run_in_executor(None, run_weather)
                current = w_data.get("current_weather", {})
                temp = current.get("temperature")
                wind = current.get("windspeed")
                if temp is not None:
                    weather_data = f"Real-time weather forecast for {city_name}, {country}: Temperature: {temp}°C, Wind Speed: {wind} km/h."
                    logger.info(f"Fetched real-time weather successfully: {weather_data}")
        except Exception as e:
            logger.error(f"Error fetching real weather for {city}: {e}. Falling back to default.")

        await event_broker.publish(trace_id, "NODE_COMPLETED", {
            "node_name": "Weather Tool (JMA)",
            "output": {"weather": weather_data},
            "metrics": {"cost_delta": 0.0, "token_delta": 0}
        })
        span.set_attribute("agent.node_status", "success")
        
        return {
            "nodes_executed": state["nodes_executed"] + ["weather_tool"],
            "weather_info": weather_data
        }

async def validator_node(state: AgentState) -> Dict[str, Any]:
    # Bypass validation if aborted/failed in tool
    if state.get("has_failed", False):
        return {
            "nodes_executed": state["nodes_executed"] + ["validator"]
        }
        
    trace_id = state["trace_id"]
    response_content = state.get("response", "")
    retries = state["retries"]
    errors = state["errors"]
    sc = get_scenario(state["scenario_id"])

    await event_broker.publish(trace_id, "NODE_STARTED", {
        "node_name": "Validator (Pydantic)",
        "input": {"response": response_content}
    })

    with tracer.start_as_current_span("Validator (Pydantic)") as span:
        span.set_attribute("agent.trace_id", trace_id)
        span.set_attribute("agent.node_name", "Validator (Pydantic)")

        try:
            # 1. Mock failure scenarios
            if sc.validator_fail:
                raise ValueError("Validation override failure: Output violates format specifications.")

            # 2. Extract JSON string from markdown
            json_str = response_content.strip()
            if json_str.startswith("```"):
                lines = json_str.splitlines()
                if lines[0].startswith("```json") or lines[0].startswith("```"):
                    json_str = "\n".join(lines[1:-1])

            # 3. Parse JSON against Pydantic schema
            parsed = AgentResponse.model_validate_json(json_str.strip())
            
            # Validation succeeded!
            await event_broker.publish(trace_id, "NODE_COMPLETED", {
                "node_name": "Validator (Pydantic)",
                "output": {"parsed_schema": parsed.model_dump()},
                "metrics": {"cost_delta": 0.0, "token_delta": 0}
            })
            span.set_attribute("agent.node_status", "success")
            
            return {
                "nodes_executed": state["nodes_executed"] + ["validator"],
                "validation_error": None
            }

        except Exception as e:
            error_msg = str(e)
            logger.warning(f"Pydantic Validation failed on trace {trace_id}: {error_msg}")
            span.record_exception(e)
            span.set_attribute("agent.node_status", "failed")

            # Publish Failure & Retry events
            await event_broker.publish(trace_id, "VALIDATION_FAILURE", {
                "node_name": "Validator (Pydantic)",
                "error_message": error_msg,
                "invalid_response": response_content
            })

            # Mark hard failure if out of retries
            has_failed = False
            if retries >= 2: # 3 attempts total (0, 1, 2)
                has_failed = True
            else:
                await event_broker.publish(trace_id, "VALIDATION_RETRY", {
                    "node_name": "Validator (Pydantic)",
                    "attempt": retries + 1,
                    "error_message": error_msg
                })

            return {
                "nodes_executed": state["nodes_executed"] + ["validator"],
                "validation_error": error_msg,
                "retries": retries + 1,
                "errors": errors + 1,
                "has_failed": has_failed
            }

async def responder_node(state: AgentState) -> Dict[str, Any]:
    trace_id = state["trace_id"]
    sc = get_scenario(state["scenario_id"])
    
    if state.get("has_failed", False):
        async def logic_err(s):
            err_msg = "Error execution aborted. Fallback path activated: weather information is currently unavailable."
            return err_msg, 0.0, 100
            
        res_err = await run_node_with_telemetry(state, "Responder (Stream)", logic_err)
        return {
            "nodes_executed": state["nodes_executed"] + ["responder"],
            "response": res_err["output"],
            "tokens": state["tokens"] + res_err["token_delta"],
            "cost": state["cost"] + res_err["cost_delta"]
        }
        
    async def logic(s):
        await asyncio.sleep(sc.responder_delay)
        
        # Dynamic fallback response text structure if gemini is offline or out of quota
        prompt_lower = s["prompt"].lower()
        is_weather = any(w in prompt_lower for w in ["weather", "rain", "temp", "forecast", "climate", "degree"])
        
        if is_weather:
            city = "Tokyo"
            match = re.search(r'\b(?:in|for|at|of)\b\s+([a-zA-Z\s]+)', s["prompt"], re.IGNORECASE)
            if match:
                city = match.group(1).strip()
            
            default_json = {
                "response_text": f"The weather in {city} is currently 22°C and clear.",
                "is_weather_report": True,
                "weather_details": {
                    "city": city,
                    "temperature": 22.0,
                    "forecast": "Clear",
                    "wind_speed_kmh": 10.0
                }
            }
        else:
            default_json = {
                "response_text": f"I am currently operating in offline mode and cannot retrieve real-time updates for: '{s['prompt']}'.",
                "is_weather_report": False,
                "weather_details": None
            }
            
        response_text = json.dumps(default_json)
        cost_delta = 0.002
        token_delta = 850

        if gemini_model:
            try:
                # 1. Base prompt asking for json schema matching AgentResponse
                prompt_text = (
                    f"You are a helpful AI assistant. Answer the user query.\n"
                    f"If the query is related to weather, you may use the following context data if present: {s['weather_info']}.\n"
                    f"User Query: {s['prompt']}\n\n"
                    f"You MUST return a JSON object conforming exactly to this schema:\n"
                    f"{{\n"
                    f"  \"response_text\": \"Conversational answer text responding to query\",\n"
                    f"  \"is_weather_report\": true/false,\n"
                    f"  \"weather_details\": {{\n"
                    f"    \"city\": \"City Name\",\n"
                    f"    \"temperature\": 22.5,\n"
                    f"    \"forecast\": \"Rain/Clear/Cloudy\",\n"
                    f"    \"wind_speed_kmh\": 15.0\n"
                    f"  }}\n"
                    f"}}\n"
                    f"Ensure weather_details is null if is_weather_report is false.\n"
                )

                # 2. Enhanced repair validation prompt if recovering from a validation error
                if s.get("validation_error"):
                    prompt_text += (
                        f"\n[ATTENTION: PREVIOUS ATTEMPT FAILED SCHEMA VALIDATION]\n"
                        f"Your previous attempt was:\n{s['response']}\n\n"
                        f"Validation errors reported:\n{s['validation_error']}\n\n"
                        f"Please MINIMALLY REPAIR the JSON format to fix the validation issues and return only the valid corrected JSON object."
                    )
                
                loop = asyncio.get_event_loop()
                response = await loop.run_in_executor(
                    None,
                    lambda: gemini_model.generate_content(prompt_text)
                )
                
                response_text = response.text
                
                # Stream only the conversational response_text to the UI
                try:
                    clean_res = response_text.strip()
                    if clean_res.startswith("```"):
                        lines = clean_res.splitlines()
                        if lines[0].startswith("```json") or lines[0].startswith("```"):
                            clean_res = "\n".join(lines[1:-1])
                    parsed_res = json.loads(clean_res.strip())
                    stream_text = parsed_res.get("response_text", response_text)
                except Exception:
                    stream_text = response_text

                words = stream_text.split(" ")
                for word in words:
                    await event_broker.publish(trace_id, "TOKEN_STREAM", {"token": word + " "})
                    await asyncio.sleep(0.04)
                
                token_delta = len(prompt_text.split()) + len(response_text.split()) + 50
                cost_delta = (token_delta / 1000) * 0.00015
                
            except Exception as e:
                logger.error(f"Error invoking Gemini in responder_node: {e}")
                stream_text = default_json["response_text"]
                for word in stream_text.split(" "):
                    await event_broker.publish(trace_id, "TOKEN_STREAM", {"token": word + " "})
                    await asyncio.sleep(0.04)
        else:
            stream_text = default_json["response_text"]
            for word in stream_text.split(" "):
                await event_broker.publish(trace_id, "TOKEN_STREAM", {"token": word + " "})
                await asyncio.sleep(0.04)

        return response_text, cost_delta * sc.llm_token_multiplier, int(token_delta * sc.llm_token_multiplier)
        
    res = await run_node_with_telemetry(state, "Responder (Stream)", logic)
    return {
        "nodes_executed": state["nodes_executed"] + ["responder"],
        "response": res["output"],
        "tokens": state["tokens"] + res["token_delta"],
        "cost": state["cost"] + res["cost_delta"]
    }

# --- Router functions ---

def route_after_tool(state: AgentState) -> Literal["responder", "weather_tool"]:
    if "weather_tool" not in state["nodes_executed"]:
        return "weather_tool"
    return "responder"

def route_after_validator(state: AgentState) -> Literal["responder", "__end__"]:
    # Loop back to responder if validation failed and we have retries remaining
    if state.get("validation_error") and state["retries"] < 3:
        if state.get("has_failed", False):
            return "__end__"
        return "responder"
    return "__end__"

# --- Build the State Graph ---

workflow = StateGraph(AgentState)

# Add Nodes
workflow.add_node("parse_prompt", parse_prompt_node)
workflow.add_node("retriever", retriever_node)
workflow.add_node("embedding", embedding_node)
workflow.add_node("llm_router", llm_router_node)
workflow.add_node("weather_tool", weather_tool_node)
workflow.add_node("validator", validator_node)
workflow.add_node("responder", responder_node)

# Set Entry
workflow.set_entry_point("parse_prompt")

# Add edges
workflow.add_edge("parse_prompt", "retriever")
workflow.add_edge("retriever", "embedding")
workflow.add_edge("embedding", "llm_router")
workflow.add_edge("llm_router", "weather_tool")

workflow.add_conditional_edges(
    "weather_tool",
    route_after_tool,
    {
        "weather_tool": "weather_tool",
        "responder": "responder"
    }
)

workflow.add_edge("responder", "validator")

workflow.add_conditional_edges(
    "validator",
    route_after_validator,
    {
        "responder": "responder",
        "__end__": END
    }
)

# Compile Agent Graph
agent_app = workflow.compile()

async def run_agent_workflow(trace_id: str, prompt: str, scenario_id: str) -> Dict[str, Any]:
    """
    Core executor that calls LangGraph and structures the output results.
    """
    initial_state: AgentState = {
        "trace_id": trace_id,
        "prompt": prompt,
        "scenario_id": scenario_id,
        "response": "",
        "nodes_executed": [],
        "retries": 0,
        "errors": 0,
        "cost": 0.0,
        "tokens": 0,
        "weather_info": "",
        "has_failed": False,
        "validation_error": None,
        "retrieved_docs": None
    }
    
    start_time = asyncio.get_event_loop().time()
    
    # 1. Publish pipeline start event
    await event_broker.publish(trace_id, "NODE_STARTED", {
        "node_name": "Pipeline",
        "input": {"prompt": prompt, "scenario_id": scenario_id}
    })
    
    try:
        # Execute workflow
        final_state = await agent_app.ainvoke(initial_state)
        
        end_time = asyncio.get_event_loop().time()
        duration_ms = int((end_time - start_time) * 1000)
        
        status = "completed"
        if final_state.get("has_failed", False):
            status = "failed"
        elif final_state["retries"] > 0 or final_state["errors"] > 0:
            status = "degraded"
            
        # 2. Publish Finished event
        await event_broker.publish(trace_id, "FINISHED", {
            "status": status,
            "duration_ms": duration_ms,
            "cost": final_state["cost"],
            "tokens": final_state["tokens"],
            "retries": final_state["retries"],
            "errors": final_state["errors"],
            "response": final_state["response"]
        })
        
        return {
            "status": status,
            "duration_ms": duration_ms,
            "final_state": final_state
        }
    except Exception as e:
        end_time = asyncio.get_event_loop().time()
        duration_ms = int((end_time - start_time) * 1000)
        
        await event_broker.publish(trace_id, "FINISHED", {
            "status": "failed",
            "duration_ms": duration_ms,
            "error": str(e)
        })
        raise e
