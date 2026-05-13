##########################################################################
#
# pgAdmin 4 - PostgreSQL Tools
#
# Copyright (C) 2013 - 2026, The pgAdmin Development Team
# This software is released under the PostgreSQL Licence
#
##########################################################################

"""Ingest Markdown research documents into pgvector via LlamaIndex.

Usage:
    python3 /path/to/ingest.py /path/to/markdown/docs
"""
import sys
import os
import time
from urllib.parse import quote_plus
from llama_index.core import SimpleDirectoryReader
from llama_index.core.node_parser import SentenceSplitter
from llama_index.vector_stores.postgres import PGVectorStore
from llama_index.embeddings.ollama import OllamaEmbedding
from llama_index.core.schema import TextNode


def ingest(docs_dir: str):
    """Ingest all .md files from docs_dir into the metering_knowledge table.

    Embeds each chunk individually to avoid context-length errors with
    nomic-embed-text. Skips any chunk that still exceeds the limit.

    Args:
        docs_dir: Path to directory containing Markdown research files.
    """
    embed_model = OllamaEmbedding(
        model_name="nomic-embed-text",
        embed_batch_size=1,
    )

    db_password = quote_plus(os.environ.get("PGPASSWORD", ""))

    vector_store = PGVectorStore.from_params(
        database="powerwd",
        host="localhost",
        port="5432",
        user="grid_master",
        password=db_password,
        table_name="metering_knowledge",
        embed_dim=768,
    )

    # Load documents
    print(f"Loading .md files from {docs_dir} ...")
    docs = SimpleDirectoryReader(
        docs_dir, required_exts=[".md"], recursive=True
    ).load_data()
    print(f"Loaded {len(docs)} documents.")

    # Chunk with a conservative size (256 tokens) to stay well within
    # nomic-embed-text's 8192 context window regardless of tokenizer
    # differences between LlamaIndex and Ollama.
    parser = SentenceSplitter(chunk_size=256, chunk_overlap=50)
    nodes = parser.get_nodes_from_documents(docs)
    print(f"Split into {len(nodes)} chunks. Starting embedding...")

    # Embed and insert one chunk at a time with error handling
    success = 0
    skipped = 0
    for i, node in enumerate(nodes):
        try:
            # Generate embedding for this single chunk
            embedding = embed_model.get_text_embedding(node.text)
            node.embedding = embedding

            # Store in pgvector
            vector_store.add([node])
            success += 1

            if (i + 1) % 50 == 0:
                print(f"  Progress: {i + 1}/{len(nodes)} chunks "
                      f"({success} OK, {skipped} skipped)")

        except Exception as e:
            skipped += 1
            print(f"  Skipped chunk {i + 1} ({len(node.text)} chars): {e}")
            continue

    print(f"\nDone! Ingested {success} chunks, skipped {skipped}, "
          f"from {len(docs)} documents.")


if __name__ == "__main__":
    ingest(sys.argv[1] if len(sys.argv) > 1 else "/home/powerdia/outpot")
