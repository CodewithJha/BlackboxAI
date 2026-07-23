import os
import logging
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger("blackbox.telemetry")

def setup_telemetry(service_name: str = "blackbox-ai"):
    """
    Sets up the OpenTelemetry TracerProvider and exporters.
    """
    try:
        resource = Resource.create(attributes={
            "service.name": service_name,
            "environment": os.getenv("ENVIRONMENT", "development")
        })

        provider = TracerProvider(resource=resource)
        trace.set_tracer_provider(provider)

        # OTLP Exporter setup (pointing to SigNoz or standard Collector)
        otlp_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4317")
        
        try:
            logger.info(f"Configuring OTLP span exporter to {otlp_endpoint}...")
            # Use gRPC or HTTP OTLP Exporter depending on the endpoint configuration
            otlp_exporter = OTLPSpanExporter(endpoint=otlp_endpoint, insecure=True)
            provider.add_span_processor(BatchSpanProcessor(otlp_exporter))
            logger.info("OTLP BatchSpanProcessor added successfully.")
        except Exception as e:
            logger.warning(f"Failed to initialize OTLP Span Exporter: {e}. Telemetry will fallback to Console export.")
            # Fallback to console trace logging in development
            provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))

        # Keep a global trace handle
        tracer = trace.get_tracer("blackbox.agent")
        return tracer

    except Exception as e:
        logger.error(f"Critical error setting up OpenTelemetry: {e}")
        # Return a mock or default tracer to prevent app failures
        return trace.get_tracer("blackbox.fallback")

# Initialize default global tracer instance
tracer = setup_telemetry()
