import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cache } from 'cache-manager';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly DEFAULT_TTL = 3600; // 1 hour in seconds
  
  // Cache key prefixes for different types of data
  private readonly CACHE_KEYS = {
    PROPERTY: 'property:',
    PROPERTIES_ALL: 'properties:all',
    PROPERTY_BY_TOKEN: 'property:byToken:',
    USER_PROPERTIES: 'user:properties:',
    LISTING: 'listing:',
    LISTINGS_ALL: 'listings:all',
  };

  constructor(@Inject(CACHE_MANAGER) private cacheManager: Cache) {}

  async get<T>(key: string): Promise<T | null> {
    try {
      return await this.cacheManager.get<T>(key);
    } catch (error) {
      this.logger.error(`Error getting cache for key ${key}: ${error.message}`);
      return null;
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    try {
      await this.cacheManager.set(key, value, ttl || this.DEFAULT_TTL);
      this.logger.debug(`Cache set for key ${key} with TTL ${ttl || this.DEFAULT_TTL}s`);
    } catch (error) {
      this.logger.error(`Error setting cache for key ${key}: ${error.message}`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.cacheManager.del(key);
      this.logger.debug(`Cache deleted for key ${key}`);
    } catch (error) {
      this.logger.error(`Error deleting cache for key ${key}: ${error.message}`);
    }
  }
  
  async reset(): Promise<void> {
    try {
      // Redis doesn't have a direct 'reset' method, so we'll clear by pattern
      this.logger.log('Clearing all cache keys...');
      
      // Delete all property keys
      await this.delete(this.CACHE_KEYS.PROPERTIES_ALL);
      
      // Delete all listing keys
      await this.delete(this.CACHE_KEYS.LISTINGS_ALL);
      
      this.logger.log('Cache reset completed');
    } catch (error) {
      this.logger.error(`Error resetting cache: ${error.message}`);
    }
  }
  
  // Property cache methods
  async getProperty(nftAddress: string, tokenId?: number): Promise<any> {
    const key = this.getPropertyKey(nftAddress, tokenId);
    return this.get(key);
  }
  
  async setProperty(nftAddress: string, property: any, tokenId?: number, ttl: number = 3600): Promise<void> {
    const key = this.getPropertyKey(nftAddress, tokenId);
    await this.set(key, property, ttl);
  }
  
  async getAllProperties(): Promise<any[]> {
    const result = await this.get<any[]>(this.CACHE_KEYS.PROPERTIES_ALL) || [];
    this.logger.log(`Retrieved properties from cache: found ${result.length} properties`);
    return result;
  }
  
  async setAllProperties(properties: any[], ttl: number = 3600): Promise<void> {
    this.logger.log(`Setting all properties in cache: ${properties.length} properties with TTL ${ttl}s`);
    await this.set(this.CACHE_KEYS.PROPERTIES_ALL, properties, ttl);
  }
  
  async getPropertyByToken(tokenAddress: string): Promise<any> {
    const key = `${this.CACHE_KEYS.PROPERTY_BY_TOKEN}${tokenAddress}`;
    return this.get(key);
  }
  
  async setPropertyByToken(tokenAddress: string, property: any, ttl: number = 3600): Promise<void> {
    const key = `${this.CACHE_KEYS.PROPERTY_BY_TOKEN}${tokenAddress}`;
    await this.set(key, property, ttl);
  }
  
  async getUserProperties(userAddress: string): Promise<any[]> {
    const key = `${this.CACHE_KEYS.USER_PROPERTIES}${userAddress}`;
    return this.get<any[]>(key) || [];
  }
  
  async setUserProperties(userAddress: string, properties: any[], ttl: number = 900): Promise<void> {
    const key = `${this.CACHE_KEYS.USER_PROPERTIES}${userAddress}`;
    await this.set(key, properties, ttl);
  }
  
  // Listing cache methods
  async getListing(listingId: number): Promise<any> {
    const key = `${this.CACHE_KEYS.LISTING}${listingId}`;
    return this.get(key);
  }
  
  async setListing(listingId: number, listing: any, ttl: number = 300): Promise<void> {
    const key = `${this.CACHE_KEYS.LISTING}${listingId}`;
    await this.set(key, listing, ttl);
  }
  
  async getAllListings(): Promise<any[]> {
    return this.get<any[]>(this.CACHE_KEYS.LISTINGS_ALL) || [];
  }
  
  async setAllListings(listings: any[], ttl: number = 300): Promise<void> {
    await this.set(this.CACHE_KEYS.LISTINGS_ALL, listings, ttl);
  }
  
  async invalidatePropertyCache(nftAddress: string, tokenId?: number): Promise<void> {
    const key = this.getPropertyKey(nftAddress, tokenId);
    await this.delete(key);
    await this.delete(this.CACHE_KEYS.PROPERTIES_ALL);
  }
  
  async invalidateListingCache(listingId: number): Promise<void> {
    const key = `${this.CACHE_KEYS.LISTING}${listingId}`;
    await this.delete(key);
    await this.delete(this.CACHE_KEYS.LISTINGS_ALL);
  }
  
  private getPropertyKey(nftAddress: string, tokenId?: number): string {
    return tokenId !== undefined 
      ? `${this.CACHE_KEYS.PROPERTY}${nftAddress}:${tokenId}`
      : `${this.CACHE_KEYS.PROPERTY}${nftAddress}`;
  }
} 