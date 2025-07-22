import { createClient } from 'redis';
import 'dotenv/config';

async function testData() {
  const client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
  });

  try {
    await client.connect();
    console.log('✅ Connected to Redis');

    // Check for property keys
    const propertyKeys = await client.keys('property:*');
    console.log('📋 Property keys found:', propertyKeys.length);
    console.log('Keys:', propertyKeys);

    // Check for embedding keys
    const embeddingKeys = await client.keys('embedding:*');
    console.log('📋 Embedding keys found:', embeddingKeys.length);
    console.log('Keys:', embeddingKeys);

    // Get a sample property
    if (propertyKeys.length > 0) {
      const sampleProperty = await client.json.get(propertyKeys[0]);
      console.log('📋 Sample property:', JSON.stringify(sampleProperty, null, 2));
    }

    await client.disconnect();
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testData(); 