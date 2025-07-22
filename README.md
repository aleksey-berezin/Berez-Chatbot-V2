# Berez Chatbot v2

Fast hybrid search chatbot with Redis and OpenAI, optimized for Portland region.

## 🚀 Features

- **Hybrid Search**: JSON queries + Vector search
- **Redis Cloud Pro**: Fast 5-10ms latency
- **OpenAI Integration**: Direct API for speed
- **Portland Region**: pdx1 edge + us-west-2 Redis
- **Session Management**: Persistent conversations

## 🏗️ Architecture

### Core Stack
- **Hono**: Fast edge functions
- **Redis**: JSON + Vector storage
- **OpenAI**: GPT-4o-mini + embeddings
- **TypeScript**: Type safety

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
```bash
cp env.example .env
# Edit .env with your Redis and OpenAI keys
```

### 3. Start Development
```bash
npm run dev
```

### 4. Seed Sample Data
```bash
curl -X POST http://localhost:3000/seed
```

### 5. Test Chat
```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Show me 2 bedroom apartments under $2000"}'
```

## 📊 Performance Targets

- **Response Time**: < 700ms
- **Redis Latency**: < 10ms
- **Cache Hit Rate**: > 60%

## 🔧 API Endpoints

- `GET /` - Health check
- `POST /chat` - Chat with bot
- `POST /seed` - Seed sample data

## 🎯 Next Steps

1. **Redis Cloud Pro** setup
2. **Vector embeddings** implementation
3. **LangCache** integration
4. **Vercel deployment**

## 📝 License

[Add your license information here]
