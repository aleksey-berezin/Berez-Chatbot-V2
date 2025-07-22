import { Property } from '../types';

/**
 * IMPORTANT: NEVER USE FAKE SAMPLE DATA
 * 
 * Fake sample data creates maintenance headaches:
 * - Hard to track what's real vs fake
 * - Requires cleanup endpoints and manual deletion
 * - Confuses users and developers
 * - Adds complexity without value
 * 
 * Always use real data from APIs or create realistic test fixtures
 * that are clearly marked and easily removable.
 */
export class DataLoader {
  private static readonly LINCOLN_COURT_URL = 'https://plucky-outlet.cloudvent.net/api/lincoln-court-listings.json';
  private static readonly ROCK459_URL = 'https://plucky-outlet.cloudvent.net/api/rock459-listings.json';

  static async loadLincolnCourtData(): Promise<Property[]> {
    try {
      const response = await fetch(this.LINCOLN_COURT_URL);
      const data = await response.json();
      return data.listings.listings || [];
    } catch (error) {
      console.error('Failed to load Lincoln Court data:', error);
      return [];
    }
  }

  static async loadRock459Data(): Promise<Property[]> {
    try {
      const response = await fetch(this.ROCK459_URL);
      const data = await response.json();
      return data.listings.listings || [];
    } catch (error) {
      console.error('Failed to load Rock 459 data:', error);
      return [];
    }
  }

  static async loadAllData(): Promise<Property[]> {
    try {
      const [lincolnCourtData, rock459Data] = await Promise.all([
        this.loadLincolnCourtData(),
        this.loadRock459Data()
      ]);

      const allProperties = [...lincolnCourtData, ...rock459Data];
      console.log(`Loaded ${allProperties.length} properties total`);
      
      return allProperties;
    } catch (error) {
      console.error('Failed to load all data:', error);
      return [];
    }
  }
} 