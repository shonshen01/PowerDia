# Plan: Adopt DeepSeek-R1 in PowerDia on Rocky Linux

## Phase 1 — Install Ollama (The Runner)
```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama --version
```

## Phase 2 — Start Ollama as a Background Service
```bash
sudo systemctl enable ollama
sudo systemctl start ollama
sudo systemctl status ollama
```

## Phase 3 — Pull the DeepSeek-R1 Model (~4.9GB download)
```bash
ollama pull deepseek-r1:8b
ollama list
```

## Phase 4 — Test Before Connecting to PowerDia
```bash
ollama run deepseek-r1:8b "Explain a PostgreSQL index in one sentence."
# Press Ctrl+D to exit
```

## Phase 5 — Configure PowerDia's config_local.py
Add these lines to the bottom of your config_local.py:
```python
# ── DeepSeek-R1 via Ollama ────────────────────────────────────
LLM_ENABLED = True
DEFAULT_LLM_PROVIDER = 'ollama'
OLLAMA_API_URL = 'http://localhost:11434'
OLLAMA_API_MODEL = 'deepseek-r1:8b'
```

## Phase 6 — Restart PowerDia
```bash
sudo systemctl restart powerdia
# Or if running manually:
# kill the existing process and re-run:
# python3 /home/powerdia/PowerDia-master/web/pgAdmin4.py
```

## Phase 7 — Verify in the Browser UI
1. Open PowerDia in your browser (http://127.0.0.1:5051)
2. Go to File -> Preferences -> AI
3. You should see "ollama" selected as the provider
4. Right-click any database -> AI Analysis -> Security Report
5. The report should generate using DeepSeek-R1 locally!

## GPU Acceleration (Optional but Recommended)
If your NVIDIA GTX 1080 drivers are correctly installed, Ollama
automatically detects and uses the GPU. Verify with:
```bash
ollama run deepseek-r1:8b ""
# While running, in another terminal:
nvidia-smi
# You should see ollama consuming VRAM
```

## Status Summary
| Component          | Status      |
|--------------------|-------------|
| config.py LLM vars | Already present (9.14 applied) |
| Ollama runner      | To install  |
| DeepSeek-R1 model  | To download |
| config_local.py    | To update   |
| PowerDia restart   | After config |
