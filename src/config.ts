import 'dotenv/config';

// Environment configuration
export const config = {
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    region: 'us-west-2' // Portland region
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: 'gpt-4o-mini',
    embeddingModel: 'text-embedding-3-small'
  },
  server: {
    port: parseInt(process.env.PORT || '3000'),
    region: 'pdx1' // Portland edge
  }
}; 