// Comprehensive test script with 25 diverse questions
const questions = [
  // SIMPLE QUESTIONS (Basic Information)
  "What properties do you have available?",
  "How much is the rent for 2 bedroom apartments?",
  "Do you allow pets?",
  "What's the address of your properties?",
  "When are the units available?",
  
  // MEDIUM COMPLEXITY (Specific Details)
  "What appliances are included in the units?",
  "What's the security deposit for a 2 bedroom unit?",
  "Are there any application fees?",
  "What's the square footage of your apartments?",
  "Do you have any special offers?",
  
  // COMPLEX QUESTIONS (Multi-criteria)
  "I need a 2 bedroom apartment under $2000 with pets allowed. What do you have?",
  "What's the difference between Lincoln Court and 459 Rock apartments?",
  "Which property has better pet policies?",
  "Show me apartments with dishwashers and microwaves",
  "What utilities are included in the rent?",
  
  // ADVANCED QUERIES (Detailed Analysis)
  "Compare the rental terms between your properties",
  "Which apartment has the best value for money?",
  "What are the pet restrictions and fees?",
  "Show me all the floorplan options available",
  "What's the total cost including deposits and fees?",
  
  // EDGE CASES (Specific Scenarios)
  "I have a large dog, which properties accept them?",
  "What's the application process and timeline?",
  "Are there any furnished options?",
  "What's the parking situation?",
  "Do you offer month-to-month leases?"
];

async function testComprehensive() {
  const baseUrl = 'http://localhost:3000';
  const results = [];
  
  console.log('🧪 Comprehensive Test: 25 Questions\n');
  console.log('Testing both performance and answer quality...\n');
  
  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    const startTime = Date.now();
    
    try {
      const response = await fetch(`${baseUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: question,
          sessionId: `test-comprehensive-${i}`
        })
      });
      
      const result = await response.json();
      const time = Date.now() - startTime;
      
      results.push({
        question: question,
        response: result.response,
        time: time,
        length: result.response?.length || 0
      });
      
      console.log(`✅ Q${i + 1}: ${time}ms - "${question.substring(0, 50)}..."`);
      
    } catch (error) {
      console.log(`❌ Q${i + 1}: Error - ${error.message}`);
      results.push({
        question: question,
        response: 'ERROR',
        time: 0,
        length: 0
      });
    }
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Performance Analysis
  const avgTime = results.reduce((sum, r) => sum + r.time, 0) / results.length;
  const maxTime = Math.max(...results.map(r => r.time));
  const minTime = Math.min(...results.map(r => r.time));
  const avgLength = results.reduce((sum, r) => sum + r.length, 0) / results.length;
  
  console.log('\n📊 PERFORMANCE ANALYSIS');
  console.log('=======================');
  console.log(`Average Response Time: ${avgTime.toFixed(0)}ms`);
  console.log(`Fastest Response: ${minTime}ms`);
  console.log(`Slowest Response: ${maxTime}ms`);
  console.log(`Average Response Length: ${avgLength.toFixed(0)} characters`);
  
  // Quality Analysis
  console.log('\n📝 QUALITY ANALYSIS');
  console.log('==================');
  
  const qualityScores = results.map((result, index) => {
    const response = result.response.toLowerCase();
    const question = result.question.toLowerCase();
    
    let score = 0;
    let notes = [];
    
    // Check for relevant information
    if (response.includes('lincoln court') || response.includes('459 rock')) score += 2;
    if (response.includes('rent') || response.includes('$')) score += 2;
    if (response.includes('bedroom') || response.includes('bath')) score += 2;
    if (response.includes('pet')) score += 1;
    if (response.includes('available')) score += 1;
    if (response.includes('deposit') || response.includes('fee')) score += 1;
    if (response.includes('appliance')) score += 1;
    if (response.includes('utility')) score += 1;
    
    // Check for URLs/links
    if (response.includes('http') || response.includes('url')) score += 1;
    
    // Check for specific details
    if (response.includes('fairview') || response.includes('portland')) score += 1;
    if (response.includes('square') || response.includes('sq ft')) score += 1;
    
    // Penalize generic responses
    if (response.includes('don\'t have') || response.includes('not available')) score -= 2;
    if (response.length < 50) score -= 1;
    
    // Categorize by question type
    const questionType = index < 5 ? 'SIMPLE' : index < 10 ? 'MEDIUM' : index < 15 ? 'COMPLEX' : index < 20 ? 'ADVANCED' : 'EDGE';
    
    return { index, score, questionType, notes };
  });
  
  const simpleAvg = qualityScores.filter(s => s.questionType === 'SIMPLE').reduce((sum, s) => sum + s.score, 0) / 5;
  const mediumAvg = qualityScores.filter(s => s.questionType === 'MEDIUM').reduce((sum, s) => sum + s.score, 0) / 5;
  const complexAvg = qualityScores.filter(s => s.questionType === 'COMPLEX').reduce((sum, s) => sum + s.score, 0) / 5;
  const advancedAvg = qualityScores.filter(s => s.questionType === 'ADVANCED').reduce((sum, s) => sum + s.score, 0) / 5;
  const edgeAvg = qualityScores.filter(s => s.questionType === 'EDGE').reduce((sum, s) => sum + s.score, 0) / 5;
  
  console.log(`Simple Questions (1-5): ${simpleAvg.toFixed(1)}/10 average`);
  console.log(`Medium Questions (6-10): ${mediumAvg.toFixed(1)}/10 average`);
  console.log(`Complex Questions (11-15): ${complexAvg.toFixed(1)}/10 average`);
  console.log(`Advanced Questions (16-20): ${advancedAvg.toFixed(1)}/10 average`);
  console.log(`Edge Cases (21-25): ${edgeAvg.toFixed(1)}/10 average`);
  
  const overallQuality = (simpleAvg + mediumAvg + complexAvg + advancedAvg + edgeAvg) / 5;
  console.log(`\n🎯 OVERALL QUALITY SCORE: ${overallQuality.toFixed(1)}/10`);
  
  // Performance Grade
  let performanceGrade = 'A';
  if (avgTime > 5000) performanceGrade = 'F';
  else if (avgTime > 3000) performanceGrade = 'C';
  else if (avgTime > 2000) performanceGrade = 'B';
  
  console.log(`🏃 PERFORMANCE GRADE: ${performanceGrade} (${avgTime.toFixed(0)}ms average)`);
  
  // Overall Grade
  const overallScore = (overallQuality * 0.7) + (performanceGrade === 'A' ? 10 : performanceGrade === 'B' ? 8 : performanceGrade === 'C' ? 6 : 4) * 0.3;
  console.log(`⭐ OVERALL GRADE: ${overallScore.toFixed(1)}/10`);
  
  // Detailed Results
  console.log('\n📋 DETAILED RESULTS');
  console.log('==================');
  results.forEach((result, index) => {
    const score = qualityScores[index];
    console.log(`Q${index + 1} (${score.questionType}): ${score.score}/10 - ${result.time}ms`);
    console.log(`   Q: ${result.question}`);
    console.log(`   A: ${result.response.substring(0, 100)}...`);
    console.log('');
  });
}

// Run the comprehensive test
testComprehensive().catch(console.error); 