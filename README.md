# AI Selfbot

Discord selfbot that uses AI to respond to pings and DMs. Learns your communication style from chat history to maintain consistent personality per relationship.

> **Warning**: Discord selfbots violate Discord's Terms of Service. Use at your own risk. This project is for educational purposes only.

## Features

- **AI-powered responses** via OpenRouter or local Ollama
- **Per-user profiles** - learns how you talk to each person from DM history
- **Memory system** - remembers facts about people and topics discussed
- **Server awareness** - tracks users and context in servers
- **Dead chat revival** - optionally starts conversations in quiet channels
- **GIF responses** - can respond with configured GIFs when appropriate
- **Configurable delays** - humanizes response timing
- **Blacklists** - ignore specific users or servers

## Setup

1. Clone and install dependencies:
```bash
git clone itzdaimy/AI-Selfbot
cd ai-selfbot
npm install
```

2. Copy `.env.example` to `.env` and fill in:
```
discord_token=discord account token here
openrouter_key=openrouter api key here
```

3. Edit `config.json` to your liking

4. Run:
```bash
npm run start
```

## Configuration

### config.json

| Field | Description |
|-------|-------------|
| `provider` | `"openrouter"` or `"ollama"` |
| `model` | Model ID for OpenRouter |
| `ollama.baseUrl` | Ollama API URL (default: `http://localhost:11434`) |
| `ollama.model` | Model name for Ollama |
| `contextMessages` | How many recent messages to include as context |
| `profileHistoryLimit` | Messages to analyze when learning a new profile |
| `learningInterval` | Interactions before updating a profile |
| `memoryExtraction` | Enable/disable memory extraction from conversations |
| `defaultPrompt` | System prompt for AI responses |
| `serverPrompts` | Per-server system prompts (key = server ID) |
| `blacklist.users` | Array of user IDs to ignore |
| `blacklist.servers` | Array of server IDs to ignore |
| `delay.min` / `delay.max` | Response delay range in ms |

### Server Chat Settings

```json
"serverChat": {
  "readingPeriod": {
    "min": 3000,
    "max": 15000,
    "extendOnActivity": true,
    "maxExtensions": 3
  },
  "engagement": {
    "idleTimeout": 60000,
    "maxReplies": 10
  },
  "deadChat": {
    "enabled": true,
    "minBotMessages": 15,
    "idleMinutes": 30,
    "checkInterval": 300000,
    "chance": 0.3
  }
}
```

### GIF Responses

Create `gifs.json` in the root directory:

```json
{
  "enabled": true,
  "chance": 0.3,
  "gifs": [
    {
      "url": "https://tenor.com/...",
      "context": "when someone says something funny",
      "triggers": ["lmao", "lol", "haha"]
    }
  ]
}
```

## How It Works

1. **DMs**: When someone DMs you, the bot checks if it has a profile for them. If not, it analyzes your chat history to learn your communication style with that person. Then it responds using AI with that context.

2. **Server pings**: When mentioned in a server, the bot enters a "reading period" to collect context from the conversation before responding. It can continue engaging naturally for multiple replies.

3. **Profiles**: Stored in `data/profiles/`. Each profile contains relationship summary, communication style, example exchanges, and common phrases.

4. **Memory**: Stored in `data/memory/`. Extracts and remembers facts about users and topics for future context.

## File Structure

```
src/
├── index.js        # entry point
├── client.js       # discord connection and event routing
├── handler.js      # builds prompts and sends responses
├── profiles.js     # per-user profile learning and storage
├── memory.js       # fact and topic memory system
├── context.js      # time and conversation context
├── conversations.js # server conversation state management
├── servers.js      # server and user tracking
├── gifs.js         # gif response handling
└── ai.js           # openrouter/ollama api calls

data/
├── profiles/       # per-user profile JSON files
├── memory/         # memory storage
│   ├── users/      # per-user memories
│   └── self.json   # facts about yourself
└── servers/        # server tracking data
```

## License

Check LISCENSE file
