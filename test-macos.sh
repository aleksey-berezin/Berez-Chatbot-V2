#!/bin/bash

echo "🚀 macOS-Compatible Testing"

# Test server health
echo "📋 Server Health:"
curl -s http://localhost:3000/ | head -1 | grep -o "Berez Chatbot" || echo "Server not responding"

# Test Redis
echo -e "\n🔌 Redis Status:"
curl -s http://localhost:3000/test-redis | head -1

# Test streaming with background process (macOS compatible)
echo -e "\n🔄 Streaming Test (3 seconds):"
curl -X POST http://localhost:3000/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message":"test","sessionId":"macos-test"}' 2>/dev/null &
CURL_PID=$!

# Wait 3 seconds then kill
sleep 3
kill $CURL_PID 2>/dev/null
wait $CURL_PID 2>/dev/null

echo -e "\n✅ Testing complete - no hanging!"

# Show architecture status
echo -e "\n📁 Architecture Files:"
ls -la public/js/
echo -e "\n🏗️ Modern Interface: http://localhost:3000/chat-modern.html" 