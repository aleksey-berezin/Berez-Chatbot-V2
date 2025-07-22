# Berez Chatbot v2

Fast hybrid search chatbot with Redis and OpenAI, optimized for Portland region.

## 🚀 Features

- **Hybrid Search**: JSON queries + Vector search
- **Redis Cloud Pro**: Fast 5-10ms latency
- **OpenAI Integration**: Direct API for speed
- **Portland Region**: pdx1 edge + us-west-2 Redis
- **Session Management**: Persistent conversations
- **Environment Management**: dotenv for configuration

## 🏗️ Architecture

### Core Stack
- **Hono**: Fast edge functions
- **Redis**: JSON + Vector storage
- **OpenAI**: GPT-4o-mini + embeddings
- **TypeScript**: Type safety
- **dotenv**: Environment variable management

### Data Flow
1. User query → Query analysis
2. Hybrid search (JSON + Vector)
3. Property matching
4. AI response generation
5. Session update

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Setup
Create a `.env` file in the root directory:
```bash
# Redis Configuration
REDIS_URL=redis://localhost:6379

# OpenAI Configuration
OPENAI_API_KEY=your_openai_api_key_here

# Server Configuration
PORT=3000
```

### 3. Development
```bash
# Start development server
npm run dev

# Type check
npm run type-check
```

### 4. Production
```bash
# Build the project
npm run build

# Start production server
npm start
```

## 🔧 Configuration

The project uses [dotenv](https://github.com/motdotla/dotenv) to load environment variables from `.env` file:

- **REDIS_URL**: Redis connection string
- **OPENAI_API_KEY**: Your OpenAI API key
- **PORT**: Server port (default: 3000)

## 📁 Project Structure

```
src/
├── types.ts          # TypeScript type definitions
├── config.ts         # Environment configuration
├── index.ts          # Main server entry point
└── services/
    ├── redis.ts      # Redis hybrid search service
    ├── openai.ts     # OpenAI API integration
    └── chatbot.ts    # Main chatbot logic
```

## 🚀 API Endpoints

- `GET /` - Health check
- `POST /chat` - Chat with the bot
- `POST /properties` - Add property data
- `GET /properties` - Search properties

## 📝 License

[Add your license information here]
