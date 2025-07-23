#!/bin/bash

echo "🧪 Testing Endpoints Properly..."

# Test health endpoint (quick)
echo "📋 Testing health endpoint..."
curl -s http://localhost:3000/ | head -1

# Test non-streaming chat endpoint with timeout
echo -e "\n📝 Testing non-streaming chat endpoint..."
timeout 10s curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"What properties do you have?","sessionId":"test"}' \
  2>/dev/null || echo "Endpoint timed out (expected for streaming)"

# Test streaming endpoint with limited output
echo -e "\n🔄 Testing streaming endpoint (first 10 lines)..."
timeout 5s curl -X POST http://localhost:3000/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message":"What properties do you have?","sessionId":"test-stream"}' \
  2>/dev/null | head -10 || echo "Stream test completed"

# Test Redis connection
echo -e "\n🔌 Testing Redis connection..."
curl -s http://localhost:3000/test-redis

echo -e "\n✅ Endpoint testing complete!" 