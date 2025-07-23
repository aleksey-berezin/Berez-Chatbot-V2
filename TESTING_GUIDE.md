# 🧪 Testing Guide - No More Hanging Commands!

## The Problem
Streaming endpoints like `/chat/stream` will keep the connection open indefinitely, causing curl commands to hang and block the terminal.

## ✅ Proper Testing Methods

### 1. **Health Checks (Quick)**
```bash
# Test if server is running
curl -s http://localhost:3000/ | head -1

# Test Redis connection
curl -s http://localhost:3000/test-redis
```

### 2. **Non-Streaming Endpoints**
```bash
# Regular chat endpoint (if it returns JSON)
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"test","sessionId":"test"}'
```

### 3. **Streaming Endpoints (With Timeout)**
```bash
# Method 1: Use timeout command
timeout 5s curl -X POST http://localhost:3000/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message":"test","sessionId":"test"}' | head -10

# Method 2: Background with kill
curl -X POST http://localhost:3000/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message":"test","sessionId":"test"}' &
CURL_PID=$!
sleep 5
kill $CURL_PID
```

### 4. **Test Scripts (Recommended)**
```bash
# Use our test scripts
./test-quick.sh      # Fast tests, no hanging
./test-endpoints.sh  # Comprehensive tests
```

## 🚀 Server Management

### Start Server (Background)
```bash
# Kill any existing server
pkill -f "tsx watch"

# Start in background with logging
nohup npm run dev > server.log 2>&1 &

# Check if running
ps aux | grep tsx
```

### Monitor Server
```bash
# View logs
tail -f server.log

# Check specific errors
grep -i error server.log
```

### Stop Server
```bash
pkill -f "tsx watch"
```

## 🎯 Best Practices

### ✅ DO:
- Use `timeout` command for streaming endpoints
- Run server in background with `nohup` and `&`
- Test with scripts that handle timeouts
- Use `head -n` to limit streaming output
- Background curl commands for streaming with `&`

### ❌ DON'T:
- Run streaming curl commands directly in terminal
- Leave server running in chat interface
- Use blocking commands without timeouts
- Test streaming endpoints without limits

## 📋 Quick Test Commands

```bash
# Server status
curl -s http://localhost:3000/ | grep -o "RUNNING"

# Redis status  
curl -s http://localhost:3000/test-redis | grep -o "connected.*true"

# Quick stream test (5 seconds max)
timeout 5s curl -X POST http://localhost:3000/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message":"test","sessionId":"test"}' | head -5
```

## 🔧 Architecture Testing

### Component-Based Frontend
```bash
# Test modern interface
open http://localhost:3000/chat-modern.html

# Test legacy interface
open http://localhost:3000/chat.html
```

### API Testing
```bash
# Test shared ResponseGenerator
node test-architecture.js &

# Test specific endpoints
./test-endpoints.sh
```

Remember: **Always use timeouts or background processes for streaming endpoints!** 