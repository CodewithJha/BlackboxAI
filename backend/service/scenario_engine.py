from typing import Dict, Any, NamedTuple

class ScenarioConfig(NamedTuple):
    id: str
    name: str
    description: str
    prompt_parser_delay: float
    embedding_delay: float
    retriever_delay: float
    retriever_cache_hit: bool
    llm_router_delay: float
    llm_token_multiplier: float
    weather_tool_delay: float
    weather_tool_max_retries: int
    weather_tool_fail: bool
    validator_fail: bool
    responder_delay: float

SCENARIOS: Dict[str, ScenarioConfig] = {
    "healthy": ScenarioConfig(
        id="healthy",
        name="Healthy Route",
        description="Fast, optimized execution. Cache hit on vector DB, first-attempt tool call success, and valid schema output.",
        prompt_parser_delay=0.08,
        embedding_delay=0.1,
        retriever_delay=0.05,
        retriever_cache_hit=True,
        llm_router_delay=0.25,
        llm_token_multiplier=1.0,
        weather_tool_delay=0.2,
        weather_tool_max_retries=0,
        weather_tool_fail=False,
        validator_fail=False,
        responder_delay=0.3
    ),
    "high_latency": ScenarioConfig(
        id="high_latency",
        name="High Latency Route",
        description="Amplified network/disk latency across all nodes, demonstrating a bottleneck trace.",
        prompt_parser_delay=0.45,
        embedding_delay=0.8,
        retriever_delay=1.5,
        retriever_cache_hit=False,
        llm_router_delay=1.2,
        llm_token_multiplier=1.0,
        weather_tool_delay=2.5,
        weather_tool_max_retries=0,
        weather_tool_fail=False,
        validator_fail=False,
        responder_delay=1.8
    ),
    "retry_storm": ScenarioConfig(
        id="retry_storm",
        name="Retry Storm",
        description="Weather tool hits upstream HTTP 429 Rate Limits repeatedly, triggering backoffs and retries.",
        prompt_parser_delay=0.08,
        embedding_delay=0.1,
        retriever_delay=0.05,
        retriever_cache_hit=True,
        llm_router_delay=0.25,
        llm_token_multiplier=1.0,
        weather_tool_delay=0.4,
        weather_tool_max_retries=3, # Will retry 3 times and succeed on the 4th
        weather_tool_fail=False,
        validator_fail=False,
        responder_delay=0.3
    ),
    "api_failure": ScenarioConfig(
        id="api_failure",
        name="API Failure",
        description="Upstream Weather Tool fails with HTTP 500. Exhausts fallback logic and results in execution abort.",
        prompt_parser_delay=0.08,
        embedding_delay=0.1,
        retriever_delay=0.05,
        retriever_cache_hit=True,
        llm_router_delay=0.25,
        llm_token_multiplier=1.0,
        weather_tool_delay=0.4,
        weather_tool_max_retries=2, # Retries twice but continues to fail
        weather_tool_fail=True,
        validator_fail=False,
        responder_delay=0.2
    ),
    "cache_miss": ScenarioConfig(
        id="cache_miss",
        name="Cache Miss",
        description="Vector DB semantic index cache miss, forcing pgvector cold read (+1.0s overhead).",
        prompt_parser_delay=0.08,
        embedding_delay=0.1,
        retriever_delay=1.05,
        retriever_cache_hit=False,
        llm_router_delay=0.25,
        llm_token_multiplier=1.0,
        weather_tool_delay=0.2,
        weather_tool_max_retries=0,
        weather_tool_fail=False,
        validator_fail=False,
        responder_delay=0.3
    ),
    "expensive_prompt": ScenarioConfig(
        id="expensive_prompt",
        name="Expensive Prompt",
        description="Context-inflated prompt causing 5x LLM input token count and cost spike.",
        prompt_parser_delay=0.08,
        embedding_delay=0.1,
        retriever_delay=0.05,
        retriever_cache_hit=True,
        llm_router_delay=0.3,
        llm_token_multiplier=5.0, # 5x token sizes
        weather_tool_delay=0.2,
        weather_tool_max_retries=0,
        weather_tool_fail=False,
        validator_fail=False,
        responder_delay=0.3
    ),
    "validation_failure": ScenarioConfig(
        id="validation_failure",
        name="Validation Failure",
        description="Output schema fails Zod/Pydantic validation, aborting output mapping.",
        prompt_parser_delay=0.08,
        embedding_delay=0.1,
        retriever_delay=0.05,
        retriever_cache_hit=True,
        llm_router_delay=0.25,
        llm_token_multiplier=1.0,
        weather_tool_delay=0.2,
        weather_tool_max_retries=0,
        weather_tool_fail=False,
        validator_fail=True,
        responder_delay=0.1
    )
}

def get_scenario(scenario_id: str) -> ScenarioConfig:
    """
    Returns the scenario config by ID, falling back to 'healthy' if not found.
    """
    return SCENARIOS.get(scenario_id, SCENARIOS["healthy"])
