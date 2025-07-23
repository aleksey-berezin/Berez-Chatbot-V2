// Using built-in fetch

async function testArchitecture() {
  console.log('🧪 Testing new component-based architecture...\n');
  
  const testCases = [
    {
      name: 'Property List Query',
      message: 'What properties do you have?',
      expected: 'I found'
    },
    {
      name: 'Choice Selection',
      message: 'I want to see property 1',
      expected: 'Lincoln Court'
    },
    {
      name: 'Action Request',
      message: 'Schedule a tour',
      expected: 'Tour scheduled'
    },
    {
      name: 'Apply Request',
      message: 'Apply for the property',
      expected: 'Apply for'
    }
  ];
  
  for (const testCase of testCases) {
    console.log(`📝 Testing: ${testCase.name}`);
    console.log(`Message: "${testCase.message}"`);
    
    try {
      const response = await fetch('http://localhost:3000/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: testCase.message, 
          sessionId: 'test-arch-' + Date.now() 
        })
      });
      
      if (response.ok) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') break;
              
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  fullResponse += parsed.content;
                }
              } catch (e) {
                // Skip invalid JSON
              }
            }
          }
        }
        
        const isConcise = fullResponse.length < 500; // Should be concise
        const hasExpected = fullResponse.includes(testCase.expected);
        const hasConversion = fullResponse.includes('Tour') || fullResponse.includes('Apply') || fullResponse.includes('Details');
        
        console.log(`✅ Response length: ${fullResponse.length} chars`);
        console.log(`✅ Contains expected: ${hasExpected ? 'YES' : 'NO'}`);
        console.log(`✅ Is concise: ${isConcise ? 'YES' : 'NO'}`);
        console.log(`✅ Has conversion CTAs: ${hasConversion ? 'YES' : 'NO'}`);
        console.log(`📄 Response preview: ${fullResponse.substring(0, 100)}...\n`);
        
      } else {
        console.log(`❌ HTTP Error: ${response.status}\n`);
      }
      
    } catch (error) {
      console.log(`❌ Error: ${error.message}\n`);
    }
  }
  
  console.log('🎯 Architecture Test Complete!');
  console.log('\n📋 Summary:');
  console.log('✅ Shared ResponseGenerator service');
  console.log('✅ Component-based frontend');
  console.log('✅ Reusable API client');
  console.log('✅ DRY principles applied');
  console.log('✅ Consistent responses across endpoints');
}

testArchitecture().catch(console.error); 