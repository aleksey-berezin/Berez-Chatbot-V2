import { Property } from '../types';

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

  // Generate sample data for testing
  static generateSampleData(): Property[] {
    return [
      {
        source: 'sample',
        property_name: 'Lincoln Court Townhomes',
        address: {
          raw: '230 Lincoln St, Unit 111, Fairview, OR 97024',
          street_number: '230',
          street_name: 'Lincoln',
          street_type: 'St',
          unit: '111',
          city: 'Fairview',
          state: 'OR',
          zip_code: '97024'
        },
        listing_urls: {
          listing_id: 'sample-1',
          view_details_url: 'https://example.com/view/1',
          apply_now_url: 'https://example.com/apply/1',
          schedule_showing_url: 'https://example.com/showing/1',
          property_website_url: 'https://lincolntownhomes.com'
        },
        unit_details: {
          beds: 2,
          baths: 1.5,
          square_feet: 864,
          available: '8/11/25',
          floorplan_name: '2 x 1.5'
        },
        rental_terms: {
          rent: 1475,
          application_fee: 65,
          security_deposit: 1475,
          flex_rent_program: true
        },
        pet_policy: {
          pets_allowed: {
            allowed: true,
            allowed_types: ['cats', 'dogs'],
            weight_limit: null,
            size_restrictions: []
          },
          pet_rent: 35,
          pet_deposit: 500
        },
        appliances: ['Dishwasher', 'Microwave', 'Range', 'Refrigerator/Freezer'],
        photos: ['https://example.com/photo1.jpg'],
        special_offer: {
          flag: false,
          text: null
        },
        utilities_included: []
      },
      {
        source: 'sample',
        property_name: 'Downtown Luxury Apartments',
        address: {
          raw: '123 Main St, Unit 456, Portland, OR 97201',
          street_number: '123',
          street_name: 'Main',
          street_type: 'St',
          unit: '456',
          city: 'Portland',
          state: 'OR',
          zip_code: '97201'
        },
        listing_urls: {
          listing_id: 'sample-2',
          view_details_url: 'https://example.com/view/2',
          apply_now_url: 'https://example.com/apply/2',
          schedule_showing_url: 'https://example.com/showing/2',
          property_website_url: 'https://downtownluxury.com'
        },
        unit_details: {
          beds: 1,
          baths: 1,
          square_feet: 650,
          available: '9/1/25',
          floorplan_name: '1 x 1'
        },
        rental_terms: {
          rent: 2100,
          application_fee: 50,
          security_deposit: 2100,
          flex_rent_program: false
        },
        pet_policy: {
          pets_allowed: {
            allowed: false,
            allowed_types: [],
            weight_limit: null,
            size_restrictions: []
          },
          pet_rent: null,
          pet_deposit: null
        },
        appliances: ['Dishwasher', 'Microwave', 'Range', 'Refrigerator/Freezer', 'In-Unit Washer/Dryer'],
        photos: ['https://example.com/photo2.jpg'],
        special_offer: {
          flag: true,
          text: 'First month free!'
        },
        utilities_included: ['Water', 'Sewer', 'Garbage']
      }
    ];
  }
} 