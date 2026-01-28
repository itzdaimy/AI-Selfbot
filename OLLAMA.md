# Ollama Setup Guide

Run AI models locally using Ollama instead of OpenRouter.

## Install Ollama

### Windows
Download from [ollama.com/download](https://ollama.com/download/windows)

### macOS
```bash
brew install ollama
```

### Linux
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

## Start Ollama

Ollama runs as a background service. On Windows it starts automatically after install. On Linux/macOS:

```bash
ollama serve
```

## Pull a Model

Download a model before using it:

```bash
# Recommended for most uses (4.7GB)
ollama pull llama3.2

# Smaller/faster option (2GB)
ollama pull llama3.2:1b

# Larger/smarter option (26GB)
ollama pull llama3.1:70b
```

See all models at [ollama.com/library](https://ollama.com/library)

## Configure the Bot

Edit `config.json`:

```json
{
  "provider": "ollama",
  "ollama": {
    "baseUrl": "http://localhost:11434",
    "model": "llama3.2"
  }
}
```

### Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `provider` | Set to `"ollama"` to use Ollama | `"openrouter"` |
| `ollama.baseUrl` | Ollama API URL | `"http://localhost:11434"` |
| `ollama.model` | Model name | `"llama3.2"` |

## Verify It Works

Test Ollama is running:

```bash
curl http://localhost:11434/api/tags
```

Test a chat:

```bash
curl http://localhost:11434/api/chat -d '{
  "model": "llama3.2",
  "messages": [{"role": "user", "content": "Hi"}],
  "stream": false
}'
```

## Recommended Models

| Model | Size | Good For |
|-------|------|----------|
| `llama3.2:1b` | 2GB | Fast responses, lower quality |
| `llama3.2` | 4.7GB | Balanced speed/quality |
| `llama3.1:8b` | 4.7GB | Same as above |
| `mistral` | 4.1GB | Good alternative |
| `llama3.1:70b` | 26GB | Best quality, needs good GPU |

## Troubleshooting

### "Connection refused"
Ollama isn't running. Start it with `ollama serve`

### Slow responses
- Use a smaller model (`llama3.2:1b`)
- Close other GPU-heavy apps
- Check if model fits in VRAM (falls back to CPU if not)

### Out of memory
Use a smaller model or add `"num_ctx": 2048` to reduce context size:

```json
"ollama": {
  "baseUrl": "http://localhost:11434",
  "model": "llama3.2:1b"
}
```

## Remote Ollama

To use Ollama on another machine:

1. On the Ollama server, set `OLLAMA_HOST=0.0.0.0` before starting
2. Update `baseUrl` in config:

```json
"ollama": {
  "baseUrl": "http://192.168.1.100:11434",
  "model": "llama3.2"
}
```
