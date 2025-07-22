# Berez Chatbot v2

A fast, hybrid search real estate chatbot built with Hono, Redis Cloud, and OpenAI.

## 🚀 Features

- **Hybrid Search**: Combines exact filters with semantic understanding
- **Fast Performance**: <700ms response times with Redis Cloud
- **Real Data**: Uses actual property listings from real estate APIs
- **Session Management**: Maintains conversation context
- **Edge Optimized**: Deployed on Vercel Edge (pdx1 region)

## 🏗️ Architecture

- **Framework**: Hono (fast edge functions)
- **Database**: Redis Cloud (us-west-2) with RediSearch + RedisJSON
- **AI**: OpenAI GPT-4o-mini + text-embedding-3-small
- **Deployment**: Vercel Edge + Regional Optimization (pdx1)
- **Data**: Real property listings from Lincoln Court and Rock 459 APIs

## 🛠️ Development Principles

### **Data Management**
- **NEVER use fake sample data** - it creates maintenance headaches
- Always use real data from APIs or clearly marked test fixtures
- Fake data requires cleanup endpoints and manual deletion
- Real data provides better testing and user experience

### **Performance**
- Target <700ms response times
- Use Redis Cloud for fast hybrid search
- Optimize for Portland region (pdx1)

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

### 3. Start Development Server
```bash
npm run dev
```

### 4. Load Real Estate Data
```bash
curl -X POST http://localhost:3000/load-data
```

## 📁 Project Structure

```
src/
├── index.ts              # Main server entry point
├── config.ts             # Environment configuration
├── types.ts              # TypeScript interfaces
├── services/
│   ├── redis.ts         # Redis Cloud service
│   ├── openai.ts        # OpenAI API service
│   └── chatbot.ts       # Main chatbot logic
└── utils/
    └── data-loader.ts   # Real estate data loader
```

## 🔌 API Endpoints

- `GET /` - Health check
- `GET /test-redis` - Test Redis connection
- `POST /load-data` - Load real estate data
- `POST /cleanup-data` - Remove sample data
- `POST /cleanup-null` - Remove null entries
- `POST /chat` - Chat with the bot
- `POST /properties` - Add property
- `GET /properties?q=query` - Search properties

## 🎯 Example Usage

```bash
# Test the chatbot
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Show me 2 bedroom apartments under $2000"}'

# Search properties
curl "http://localhost:3000/properties?q=pet%20friendly%20portland"
```

## 📊 Performance

- **Response Time**: <700ms target
- **Region**: Portland (pdx1) for low latency
- **Database**: Redis Cloud us-west-2
- **Search**: Hybrid (exact + semantic)

## 🚀 Deployment

Ready for Vercel Edge deployment with regional optimization targeting Portland (pdx1) region.
