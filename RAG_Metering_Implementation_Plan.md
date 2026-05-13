# Implementation Plan: RAG-Enhanced Metering Report

## Goal
To augment the "Metering & Sustainability" AI Report in PowerDia with Retrieval-Augmented Generation (RAG). By leveraging `pgvector` as the vector backend, Ollama (`nomic-embed-text`) for embeddings, and **LlamaIndex** as the RAG framework, the LLM will synthesize facts from the `powerwd` database along with insights retrieved from approximately **3,000 pages** of smart metering research documents (Markdown format, converted from PDF via Marker).

## Architecture Overview

1. **Ingestion**: A LlamaIndex ingestion script (`llm/rag/ingest.py`) uses `SimpleDirectoryReader` + `MarkdownNodeParser` to read the `.md` research files, chunk them by heading structure, generate embeddings via Ollama (`nomic-embed-text`), and store them in the `metering_knowledge` table via `PGVectorStore`.
2. **Retrieval (Hybrid Scope)**: During report generation, each of the **5 metering sections** retrieves topic-specific chunks (e.g., "Transformer Load" retrieves transformer-related research). The **Synthesis stage** performs a broader retrieval across all topics for the executive summary.
3. **Generation**: The existing `ReportPipeline` is modified to call LlamaIndex's retriever at two injection points — `_analyze_section_with_retry` and `_synthesize_with_retry` — and inject the retrieved chunks into the LLM prompts.

## Resolved Questions

| # | Question | Answer |
|---|---|---|
| 1 | Document format | **Markdown** (`.md`), converted from PDF via Marker. ~3,000 pages total. |
| 2 | pgvector installed? | **Yes** — confirmed installed on the system. |
| 3 | Scope | **Hybrid** — all 5 sections get topic-specific chunks; synthesis gets a broad retrieval. |

## Proposed Changes

### Database Setup (Manual Execution Required)
A new table `metering_knowledge` and an `hnsw` index must be created in the `powerwd` database.

> [!IMPORTANT]
> We use **HNSW** instead of IVFFlat because at ~3,000 pages (~10,000–15,000 chunks), HNSW provides better recall and does not require a separate training step.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS metering_knowledge (
    id           SERIAL PRIMARY KEY,
    source       TEXT NOT NULL,
    chunk_index  INTEGER NOT NULL,
    content      TEXT NOT NULL,
    embedding    vector(768),
    topic_tags   TEXT[],
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON metering_knowledge USING hnsw (embedding vector_cosine_ops);
```

---

### Dependencies (One-time Install)
```bash
pip install llama-index \
            llama-index-vector-stores-postgres \
            llama-index-embeddings-ollama
```

---

### New File

#### [NEW] `web/pgadmin/llm/rag/ingest.py`
A standalone CLI script to ingest the ~3,000 pages of Markdown research. Uses LlamaIndex to handle all chunking, embedding, and storage — replacing the need for a custom `retriever.py` and `__init__.py`.

It will:
- Use `SimpleDirectoryReader` to load all `.md` files from the Marker output directory.
- Use `MarkdownNodeParser` to chunk by heading structure (`#`, `##`, `###`) rather than arbitrary word counts — preserving document structure.
- Use `OllamaEmbedding(model_name="nomic-embed-text")` for local embeddings.
- Use `PGVectorStore` to write directly into the `metering_knowledge` table in `powerwd`.

```python
"""Ingest Markdown research documents into pgvector via LlamaIndex.

Usage:
    python -m pgadmin.llm.rag.ingest /path/to/markdown/docs
"""
import sys
from llama_index.core import SimpleDirectoryReader, VectorStoreIndex, StorageContext
from llama_index.core.node_parser import MarkdownNodeParser
from llama_index.vector_stores.postgres import PGVectorStore
from llama_index.embeddings.ollama import OllamaEmbedding

def ingest(docs_dir: str):
    embed_model = OllamaEmbedding(model_name="nomic-embed-text")

    vector_store = PGVectorStore.from_params(
        database="powerwd",
        host="localhost",
        port="5432",
        user="powerdia",
        password="",          # adjust as needed
        table_name="metering_knowledge",
        embed_dim=768,
    )

    docs = SimpleDirectoryReader(
        docs_dir, required_exts=[".md"]
    ).load_data()

    parser = MarkdownNodeParser()
    nodes = parser.get_nodes_from_documents(docs)

    storage_context = StorageContext.from_defaults(vector_store=vector_store)
    index = VectorStoreIndex(
        nodes, storage_context=storage_context, embed_model=embed_model
    )
    print(f"Ingested {len(nodes)} chunks from {len(docs)} documents.")

if __name__ == "__main__":
    ingest(sys.argv[1] if len(sys.argv) > 1 else "/home/powerdia/outpot")
```

---

### Modified Files

#### [MODIFY] `web/pgadmin/llm/reports/pipeline.py`
- Add a `rag_retriever` optional parameter to `ReportPipeline.__init__()`.
- In `_analyze_section_with_retry` (line ~285): Before building the prompt, call `rag_retriever.retrieve(section.name + " " + section.description)` to get the top 5 relevant chunks. Pass them to `get_section_analysis_prompt()`.
- In `_synthesize_with_retry` (line ~366): Call `rag_retriever.retrieve("grid metering sustainability analysis overview")` for broad context. Pass the chunks to `get_synthesis_prompt()`.

```python
# In __init__, add:
def __init__(self, ..., rag_retriever=None):
    ...
    self.rag_retriever = rag_retriever

# In _analyze_section_with_retry, before building prompt:
rag_chunks = []
if self.rag_retriever:
    query = f"{section.name} {section.description}"
    rag_chunks = [n.text for n in self.rag_retriever.retrieve(query)]

user_prompt = get_section_analysis_prompt(
    section.name, section.description, data, context,
    rag_chunks=rag_chunks  # NEW parameter
)

# In _synthesize_with_retry, before building prompt:
rag_chunks = []
if self.rag_retriever:
    rag_chunks = [n.text for n in self.rag_retriever.retrieve(
        "grid metering sustainability analysis overview"
    )]

user_prompt = get_synthesis_prompt(
    self.report_type, successful_results, context,
    rag_chunks=rag_chunks  # NEW parameter
)
```

#### [MODIFY] `web/pgadmin/llm/reports/prompts.py`
- Update `get_section_analysis_prompt()` to accept a new `rag_chunks: list[str] = None` parameter. If provided, append a "Relevant Research Context" block to the prompt string.
- Update `get_synthesis_prompt()` similarly.

```python
def get_section_analysis_prompt(
    section_name, section_description, data, context,
    rag_chunks=None  # NEW
):
    ...
    prompt = f"""Analyze the following {section_name} data ..."""

    if rag_chunks:
        context_block = "\n\n".join(rag_chunks[:5])
        prompt += f"""

Relevant Research Context (use these facts to enrich your analysis):
---
{context_block}
---"""

    return prompt
```

#### [MODIFY] `web/pgadmin/llm/reports/generator.py`
- In `generate_report_streaming` and `generate_report_sync`, create a LlamaIndex retriever from the existing `PGVectorStore` and pass it into the `ReportPipeline` constructor as `rag_retriever`.

```python
# At the top of generator.py:
from llama_index.vector_stores.postgres import PGVectorStore
from llama_index.embeddings.ollama import OllamaEmbedding
from llama_index.core import VectorStoreIndex

# In generate_report_streaming / generate_report_sync,
# after creating query_executor:
rag_retriever = None
if report_type == 'metering':
    vector_store = PGVectorStore.from_params(
        database="powerwd", host="localhost",
        table_name="metering_knowledge", embed_dim=768
    )
    embed_model = OllamaEmbedding(model_name="nomic-embed-text")
    index = VectorStoreIndex.from_vector_store(
        vector_store, embed_model=embed_model
    )
    rag_retriever = index.as_retriever(similarity_top_k=5)

pipeline = ReportPipeline(
    report_type=report_type,
    sections=sections,
    client=client,
    query_executor=query_executor,
    rag_retriever=rag_retriever  # NEW
)
```

## Hybrid Scope — How Each Section Retrieves Context

| Section ID | Section Name | RAG Query Used for Retrieval |
|---|---|---|
| `grid_topology` | Grid Topology Overview | `"Grid Topology Overview substations feeders transformers"` |
| `transformer_load` | Transformer Load Analysis | `"Transformer Load Analysis capacity overload users_per_kva"` |
| `consumption_patterns` | Consumption Patterns | `"Consumption Patterns kwh energy usage statistics"` |
| `grid_losses` | Grid Loss Estimation | `"Grid Loss Estimation feeder load imbalance distribution"` |
| `spatial_density` | Spatial Density (PostGIS) | `"Spatial Density geographic clustering substation PostGIS"` |
| *(synthesis)* | Final Report | `"grid metering sustainability analysis overview"` |

Each query is automatically constructed from `section.name + section.description` (already defined in `sections.py`), so no hardcoding is needed.

## Verification Plan

### Automated Tests
1. Run the SQL setup in `powerwd` and confirm the extension, table, and HNSW index exist:
   ```bash
   sudo -u postgres psql -d powerwd -c "\dx vector" -c "\dt metering_knowledge" -c "\di"
   ```
2. Run `ingest.py` against a small test directory with 2–3 Markdown files and verify row count:
   ```bash
   python -m pgadmin.llm.rag.ingest /home/powerdia/outpot
   sudo -u postgres psql -d powerwd -c "SELECT count(*) FROM metering_knowledge;"
   ```
3. Generate a metering report and verify the output contains research-grounded insights (not just database facts).

### Manual Verification
- Compare a metering report generated **without** RAG (current behavior) vs **with** RAG to confirm the research context enriches the analysis.
- Spot-check that retrieved chunks are relevant to their respective sections.
