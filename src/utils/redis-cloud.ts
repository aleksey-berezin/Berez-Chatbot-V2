import { createClient } from 'redis';
import { config } from '../config';

export class RedisCloudConnection {
  private client;

  constructor() {
    this.client = createClient({
      url: config.redis.url
    });
  }

  async connect() {
    try {
      await this.client.connect();
      console.log('✅ Connected to Redis Cloud successfully!');
      
      // Test basic operations
      await this.testConnection();
      
      return true;
    } catch (error) {
      console.error('❌ Failed to connect to Redis Cloud:', error);
      return false;
    }
  }

  async disconnect() {
    try {
      await this.client.disconnect();
      console.log('✅ Disconnected from Redis Cloud');
    } catch (error) {
      console.error('❌ Error disconnecting:', error);
    }
  }

  private async testConnection() {
    try {
      // Test basic operations
      await this.client.set('test:connection', 'success');
      const result = await this.client.get('test:connection');
      
      if (result === 'success') {
        console.log('✅ Redis Cloud operations working correctly');
        await this.client.del('test:connection');
      } else {
        throw new Error('Test operation failed');
      }
    } catch (error) {
      console.error('❌ Redis Cloud test failed:', error);
      throw error;
    }
  }

  // Test JSON operations
  async testJsonOperations() {
    try {
      const testData = {
        id: 'test-1',
        name: 'Test Property',
        address: '123 Test St',
        beds: 2,
        baths: 1,
        rent: 1500,
        available: true
      };

      await this.client.json.set('test:property', '$', testData as any);
      const retrieved = await this.client.json.get('test:property');
      
      if (retrieved) {
        console.log('✅ Redis JSON operations working');
        await this.client.del('test:property');
        return true;
      }
    } catch (error) {
      console.error('❌ Redis JSON test failed:', error);
      return false;
    }
  }

  // Get connection info
  async getConnectionInfo() {
    try {
      const info = await this.client.info();
      console.log('📊 Redis Cloud Info:', info.substring(0, 200) + '...');
      return info;
    } catch (error) {
      console.error('❌ Failed to get Redis info:', error);
      return null;
    }
  }
} 