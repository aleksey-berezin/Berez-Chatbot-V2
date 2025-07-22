const fetch = require('node-fetch');

async function testPerformance() {
  const baseUrl = 'http://localhost:3000';
  
  console.log('🚀 Testing chatbot performance optimizations...\n');
  
  // Test 1: Simple query
  console.log('📝 Test 1: Simple property query');
  const start1 = Date.now();
  try {
    const response = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message: 'What properties do you have available?',
        sessionId: 'test-session-1'
      })
    });
    const result1 = await response.json();
    const time1 = Date.now() - start1;
    console.log(`✅ Response time: ${time1}ms`);
    console.log(`📊 Response length: ${result1.response?.length || 0} characters\n`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }
  
  // Test 2: Specific query
  console.log('📝 Test 2: Specific property query');
  const start2 = Date.now();
  try {
    const response = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        message: 'Show me 2 bedroom apartments under $2000',
        sessionId: 'test-session-2'
      })
    });
    const result2 = await response.json();
    const time2 = Date.now() - start2;
    console.log(`✅ Response time: ${time2}ms`);
    console.log(`📊 Response length: ${result2.response?.length || 0} characters\n`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}\n`);
  }
  
  // Test 3: Performance stats
  console.log('📝 Test 3: Performance statistics');
  try {
    const response = await fetch(`${baseUrl}/performance`);
    const stats = await response.json();
    console.log('📊 Performance Stats:');
    console.log(`   - Total Requests: ${stats.totalRequests || 0}`);
    console.log(`   - Avg Total Latency: ${stats.avgTotalLatency || 0}ms`);
    console.log(`   - Avg Redis Latency: ${stats.avgRedisLatency || 0}ms`);
    console.log(`   - Avg OpenAI Latency: ${stats.avgOpenAILatency || 0}ms`);
    console.log(`   - Cache Hit Rate: ${stats.cacheHitRate || 0}%`);
    console.log(`   - Cache Size: ${stats.cacheSize || 0}/${stats.cacheMax || 0}\n`);
  } catch (error) {
    console.log(`❌ Error getting stats: ${error.message}\n`);
  }
  
  console.log('🎯 Performance test completed!');
  console.log('💡 Expected improvements:');
  console.log('   - Redis latency: <500ms (was likely >2000ms)');
  console.log('   - OpenAI latency: <4000ms (was likely >8000ms)');
  console.log('   - Total latency: <5000ms (was likely >10000ms)');
}

// Run the test
testPerformance().catch(console.error); 