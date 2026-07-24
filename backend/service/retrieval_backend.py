import os
import re
import json
import logging
import asyncio
import uuid
import time
from typing import List, Dict, Any, Optional
import google.generativeai as genai
from backend.telemetry.otel_config import tracer
from backend.event.event_broker import event_broker
from backend.config import has_configured_gemini_api_key

logger = logging.getLogger("blackbox.retrieval")

# --- Embedding Service Abstraction ---

class BaseEmbeddingService:
    async def get_embedding(self, text: str) -> List[float]:
        raise NotImplementedError()

    def get_model_name(self) -> str:
        raise NotImplementedError()

class GeminiEmbeddingService(BaseEmbeddingService):
    def __init__(self, model_name: str = "models/text-embedding-004"):
        self.model_name = model_name
        self.api_key_configured = has_configured_gemini_api_key()

    def get_model_name(self) -> str:
        return self.model_name

    async def get_embedding(self, text: str) -> List[float]:
        if not self.api_key_configured:
            # Return a deterministic mock vector if API key is not configured
            # 768 dimensions for models/text-embedding-004
            return [0.01 * (i % 10) for i in range(768)]
        try:
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None,
                lambda: genai.embed_content(
                    model=self.model_name,
                    content=text
                )
            )
            return response["embedding"]
        except Exception as e:
            logger.error(f"Error calling Gemini Embedding API: {e}. Falling back to default vector.")
            return [0.01 * (i % 10) for i in range(768)]

# --- Retriever Abstraction ---

class BaseRetriever:
    async def retrieve(self, trace_id: str, query: str, limit: int = 3) -> List[Dict[str, Any]]:
        raise NotImplementedError()

class ChromaRetriever(BaseRetriever):
    def __init__(self, embedding_service: BaseEmbeddingService, chroma_path: str = "backend/data/chroma"):
        import chromadb
        self.embedding_service = embedding_service
        self.client = chromadb.PersistentClient(path=chroma_path)
        
        # Initialize or fetch the Chroma Collection
        self.collection = self.client.get_or_create_collection(
            name="blackbox_agent_docs",
            metadata={"hnsw:space": "cosine"}
        )
        
        # Load and index markdown documents from data/documents on initialize
        self.documents_dir = "backend/data/documents"
        os.makedirs(self.documents_dir, exist_ok=True)
        self.index_documents_on_startup()

    def index_documents_on_startup(self):
        """
        Scans backend/data/documents for Markdown files, splits them into chunk blocks,
        generates embeddings, and indexes them in ChromaDB.
        """
        try:
            logger.info(f"Scanning '{self.documents_dir}' for Markdown documents to index...")
            files = [f for f in os.listdir(self.documents_dir) if f.endswith(".md")]
            if not files:
                logger.info("No Markdown documents found in the documents directory to index.")
                # Create a sample document so it's not empty
                sample_file = os.path.join(self.documents_dir, "welcome.md")
                with open(sample_file, "w") as f:
                    f.write("# Welcome to BlackBox AI\n\nThis is a local documentation manual for the BlackBox AI Agent pipeline. Our JMA weather tool endpoint fetches coordinates from Open-Meteo geocoding and coordinates APIs, returning current temperatures.")
                files = ["welcome.md"]

            total_chunks_ingested = 0
            for file_name in files:
                file_path = os.path.join(self.documents_dir, file_name)
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()

                # Split into chunks by headers or double newlines
                sections = re.split(r'\n(?=#+ )', content)
                for sec_idx, section in enumerate(sections):
                    if not section.strip():
                        continue
                    
                    # Extract header section name
                    header_match = re.match(r'^#+\s+(.+)$', section.splitlines()[0])
                    section_title = header_match.group(1).strip() if header_match else "Overview"
                    
                    # Chunk paragraphs
                    paragraphs = [p.strip() for p in section.split("\n\n") if p.strip()]
                    for p_idx, paragraph in enumerate(paragraphs):
                        # Unique chunk ID
                        chunk_id = f"chk_{file_name[:-3]}_s{sec_idx}_p{p_idx}"
                        
                        # Generate embedding synchronously since startup is blocking
                        # (Run inside event loop executor or simply run blocking helper during initialize)
                        try:
                            # Run embedding query blocking during startup
                            response = genai.embed_content(
                                model=self.embedding_service.get_model_name(),
                                content=paragraph
                            )
                            vector = response["embedding"]
                        except Exception:
                            # Mock vector fallback if offline/failed
                            vector = [0.01 * (i % 10) for i in range(768)]

                        self.collection.upsert(
                            ids=[chunk_id],
                            embeddings=[vector],
                            documents=[paragraph],
                            metadatas=[{
                                "source_file": file_name,
                                "section": section_title,
                                "chunk_id": chunk_id
                            }]
                        )
                        total_chunks_ingested += 1
            
            logger.info(f"Dynamic Markdown Document Indexing Complete! Ingested {total_chunks_ingested} chunks into ChromaDB.")
        except Exception as e:
            logger.error(f"Error during ChromaDB document indexing: {e}")

    async def retrieve(self, trace_id: str, query: str, limit: int = 3) -> List[Dict[str, Any]]:
        """
        Retrieves matching chunks from ChromaDB, emitting OTel and event broker telemetry.
        """
        start_time = time.time()
        
        # 1. Publish RETRIEVAL_STARTED
        await event_broker.publish(trace_id, "RETRIEVAL_STARTED", {
            "node_name": "Retriever (ChromaDB)",
            "query": query
        })

        retrieved_items = []
        
        with tracer.start_as_current_span("ChromaDB Retrieval") as span:
            span.set_attribute("agent.trace_id", trace_id)
            span.set_attribute("retrieval.query", query)
            span.set_attribute("retrieval.embedding_model", self.embedding_service.get_model_name())

            try:
                # Query embedding
                query_vector = await self.embedding_service.get_embedding(query)
                
                # Fetch records from ChromaDB
                loop = asyncio.get_event_loop()
                results = await loop.run_in_executor(
                    None,
                    lambda: self.collection.query(
                        query_embeddings=[query_vector],
                        n_results=limit
                    )
                )

                # Process results
                if results and "documents" in results and len(results["documents"]) > 0:
                    documents = results["documents"][0]
                    metadatas = results["metadatas"][0] if "metadatas" in results else []
                    distances = results["distances"][0] if "distances" in results else []

                    for idx, doc in enumerate(documents):
                        distance = distances[idx] if idx < len(distances) else 0.5
                        # Normalize distance into a similarity score (0.0 to 1.0)
                        score = max(0.0, min(1.0, 1.0 - distance))
                        metadata = metadatas[idx] if idx < len(metadatas) else {}

                        retrieved_items.append({
                            "text": doc,
                            "score": round(score, 3),
                            "source_file": metadata.get("source_file", "unknown"),
                            "section": metadata.get("section", "unknown"),
                            "chunk_id": metadata.get("chunk_id", "unknown")
                        })

                latency_ms = int((time.time() - start_time) * 1000)
                span.set_attribute("retrieval.latency_ms", latency_ms)
                span.set_attribute("retrieval.document_count", len(retrieved_items))

                # 2. Publish RETRIEVAL_COMPLETED
                await event_broker.publish(trace_id, "RETRIEVAL_COMPLETED", {
                    "node_name": "Retriever (ChromaDB)",
                    "latency_ms": latency_ms,
                    "model": self.embedding_service.get_model_name(),
                    "document_count": len(retrieved_items),
                    "documents": retrieved_items
                })

            except Exception as e:
                logger.error(f"Error querying ChromaDB retriever backend: {e}")
                span.record_exception(e)
                # Fallback empty completed
                latency_ms = int((time.time() - start_time) * 1000)
                await event_broker.publish(trace_id, "RETRIEVAL_COMPLETED", {
                    "node_name": "Retriever (ChromaDB)",
                    "latency_ms": latency_ms,
                    "model": self.embedding_service.get_model_name(),
                    "document_count": 0,
                    "documents": []
                })

        return retrieved_items

# --- Getter Factory to keep retriever modules decoupled ---
_retriever_instance: Optional[BaseRetriever] = None

def get_retriever() -> BaseRetriever:
    global _retriever_instance
    if _retriever_instance is None:
        try:
            logger.info("Initializing ChromaDB retriever backend instance...")
            embedding_service = GeminiEmbeddingService()
            _retriever_instance = ChromaRetriever(embedding_service=embedding_service)
        except Exception as e:
            logger.error(f"Failed to initialize ChromaRetriever: {e}. Falling back to default mock retriever.")
            # Mock fallback retriever to prevent crash
            class MockRetriever(BaseRetriever):
                async def retrieve(self, trace_id: str, query: str, limit: int = 3) -> List[Dict[str, Any]]:
                    return []
            _retriever_instance = MockRetriever()
    return _retriever_instance
