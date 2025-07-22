#!/usr/bin/env node

import 'dotenv/config';
import { RedisCloudConnection } from '../src/utils/redis-cloud.js';

async function testRedisConnection() {
  console.log('🔗 Testing Redis Cloud Connection...\n');
  
  const redis = new RedisCloudConnection();
  
  try {
    // Test connection
    const connected = await redis.connect();
    
    if (connected) {
      console.log('\n✅ Redis Cloud connection successful!');
      
      // Test JSON operations
      await redis.testJsonOperations();
      
      // Get connection info
      await redis.getConnectionInfo();
      
      console.log('\n🎉 All Redis Cloud tests passed!');
      console.log('📝 Your Redis Cloud setup is ready for the chatbot.');
      
    } else {
      console.log('\n❌ Redis Cloud connection failed!');
      console.log('💡 Check your REDIS_URL in .env file');
    }
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
  } finally {
    await redis.disconnect();
  }
}

testRedisConnection(); 