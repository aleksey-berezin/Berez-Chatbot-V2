#!/bin/bash

echo "🚀 Quick Test - No Hanging!"

# Simple health check
echo "Health:" && curl -s http://localhost:3000/ | grep -o "RUNNING" || echo "Server not responding"

# Redis test
echo "Redis:" && curl -s http://localhost:3000/test-redis | grep -o "connected.*true" || echo "Redis issue"

# Streaming test with strict timeout and background
echo "Stream test (5 sec max):" 
(curl -X POST http://localhost:3000/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message":"test","sessionId":"quick"}' 2>/dev/null | head -5 &) &
CURL_PID=$!
sleep 5
kill $CURL_PID 2>/dev/null
wait $CURL_PID 2>/dev/null

echo "✅ Tests complete - no hanging!" 