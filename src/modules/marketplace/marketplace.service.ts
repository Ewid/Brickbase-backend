import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan } from 'typeorm';
import { BlockchainService } from '../blockchain/blockchain.service';
import { PropertiesService } from '../properties/properties.service';
import { HistoricalSale } from './entities/historical-sale.entity';
import { CachedListing } from './entities/cached-listing.entity';
import { CacheService } from '../cache/cache.service';
import { ethers, Contract, Log, EventLog, ZeroAddress } from 'ethers';
import { ListingDto } from './dto/listing.dto';

@Injectable()
export class MarketplaceService implements OnModuleInit {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    @InjectRepository(HistoricalSale)
    private historicalSaleRepository: Repository<HistoricalSale>,
    @InjectRepository(CachedListing)
    private cachedListingRepository: Repository<CachedListing>,
    private blockchainService: BlockchainService,
    private propertiesService: PropertiesService,
    private cacheService: CacheService,
  ) {}

  onModuleInit() {
    this.listenToListingPurchased();
    this.setupCacheCleanup();
    
    // Reset and rebuild cache on startup
    setTimeout(() => {
      this.resetAndRebuildCache();
    }, 8000); // Delay 8 seconds to ensure contracts are loaded and after properties
  }

  private async formatListingData(listingData: any, listingId: number): Promise<ListingDto> {
    // Indices based on PropertyMarketplace.listings return:
    // 0: seller (address)
    // 1: propertyToken (address) - This is the ERC20 token for the property shares
    // 2: tokenAmount (uint256)
    // 3: pricePerToken (uint256)
    // 4: isActive (bool)
    const tokenAddress = listingData[1]; // PropertyToken address

    let nftAddress = '';
    let tokenId = '';

    // Fetch NFT details using the PropertiesService
    const nftDetails = await this.propertiesService.findNftDetailsByTokenAddress(tokenAddress);
    if (nftDetails) {
      nftAddress = nftDetails.nftAddress;
      tokenId = nftDetails.tokenId.toString();
    }

    const formattedListing = {
      listingId: listingId, // Pass the index as the ID
      seller: listingData[0],
      nftAddress: nftAddress, // Populate with found address
      tokenId: tokenId,    // Populate with found ID
      tokenAddress: tokenAddress,
      pricePerToken: listingData[3].toString(), // Price in USDC with 6 decimal places
      amount: listingData[2].toString(),
      active: listingData[4],
      currency: 'USDC' // New property indicating USDC currency
    };

    // Cache the listing in database
    try {
      const cachedListing = new CachedListing();
      cachedListing.listingId = formattedListing.listingId;
      cachedListing.seller = formattedListing.seller;
      cachedListing.nftAddress = formattedListing.nftAddress;
      cachedListing.tokenId = formattedListing.tokenId;
      cachedListing.tokenAddress = formattedListing.tokenAddress;
      cachedListing.pricePerToken = formattedListing.pricePerToken;
      cachedListing.amount = formattedListing.amount;
      cachedListing.active = formattedListing.active;
      cachedListing.currency = formattedListing.currency;
      cachedListing.expiresAt = new Date(Date.now() + 300000); // 5 minutes TTL
      
      await this.cachedListingRepository.save(cachedListing);
      this.logger.debug(`Cached listing data for ID ${listingId} in database`);
      
      // Cache in Redis
      await this.cacheService.setListing(listingId, formattedListing);
    } catch (error) {
      this.logger.error(`Error caching listing data: ${error.message}`);
    }

    return formattedListing;
  }

  async findAllListings(): Promise<ListingDto[]> {
    this.logger.log('Fetching all active listings...');
    
    try {
      // Check Redis cache first
      const redisCache = await this.cacheService.getAllListings();
      if (redisCache && redisCache.length > 0) {
        this.logger.log(`Returning ${redisCache.length} active listings from Redis cache.`);
        return redisCache;
      }
      
      // Check database cache
      const cachedListings = await this.cachedListingRepository.find({
        where: {
          active: true,
          expiresAt: MoreThan(new Date()),
        },
      });
      
      if (cachedListings.length > 0) {
        this.logger.log(`Returning ${cachedListings.length} active listings from database cache.`);
        const listings = cachedListings.map(cl => ({
          listingId: cl.listingId,
          seller: cl.seller,
          nftAddress: cl.nftAddress,
          tokenId: cl.tokenId,
          tokenAddress: cl.tokenAddress,
          pricePerToken: cl.pricePerToken,
          amount: cl.amount,
          active: cl.active,
          currency: cl.currency,
        }));
        
        // Update Redis cache
        await this.cacheService.setAllListings(listings);
        
        return listings;
      }
      
      // Cache miss, fetch from blockchain
      this.logger.log('Cache miss for active listings, fetching from blockchain...');
      const listings = await this.fetchAllListingsFromBlockchain();
      
      // Update Redis cache
      if (listings.length > 0) {
        await this.cacheService.setAllListings(listings);
      }
      
      return listings;
    } catch (error) {
      this.logger.error(`Error checking cache for listings: ${error.message}`);
      return this.fetchAllListingsFromBlockchain();
    }
  }
  
  private async fetchAllListingsFromBlockchain(): Promise<ListingDto[]> {
    const propertyMarketplace = this.blockchainService.getContract('propertyMarketplace');

    if (!propertyMarketplace) {
        this.logger.error('PropertyMarketplace contract not available from BlockchainService');
        return [];
    }

    try {
        const activeListingIndices: bigint[] = await (propertyMarketplace as any).getActiveListings();
        this.logger.debug(`Found ${activeListingIndices.length} active listing indices: ${activeListingIndices.join(', ')}`);

        // Create promises for fetching and formatting each listing
        const listingPromises = activeListingIndices.map(async (indexBigInt) => {
            const index = Number(indexBigInt);
            try {
                const rawListing = await (propertyMarketplace as any).listings(index);
                // Await the async formatting
                return await this.formatListingData(rawListing, index);
            } catch (error) {
                this.logger.error(`Error fetching or formatting listing index ${index}: ${error.message}`);
                return null; // Return null for failed listings
            }
        });

        // Resolve all promises and filter out nulls (failed fetches/formats)
        const resolvedListings = await Promise.all(listingPromises);
        const activeListings = resolvedListings.filter(listing => listing !== null) as ListingDto[];

        this.logger.log(`Successfully formatted ${activeListings.length} active listings.`);
        return activeListings;

    } catch (error) {
        this.logger.error(`Error fetching active listing indices: ${error.message}`);
        return [];
    }
  }

  async getListingDetails(listingId: number): Promise<ListingDto | null> {
     this.logger.log(`Fetching details for listing index ${listingId}...`);
     
     try {
       // Check Redis cache first
       const redisCache = await this.cacheService.getListing(listingId);
       if (redisCache) {
         this.logger.log(`Redis cache hit for listing ID ${listingId}`);
         return redisCache;
       }
       
       // Check database cache
       const cachedListing = await this.cachedListingRepository.findOne({
         where: { listingId, active: true, expiresAt: MoreThan(new Date()) },
       });
       
       if (cachedListing) {
         this.logger.log(`Database cache hit for listing ID ${listingId}`);
         const listing = {
           listingId: cachedListing.listingId,
           seller: cachedListing.seller,
           nftAddress: cachedListing.nftAddress,
           tokenId: cachedListing.tokenId,
           tokenAddress: cachedListing.tokenAddress,
           pricePerToken: cachedListing.pricePerToken,
           amount: cachedListing.amount,
           active: cachedListing.active,
           currency: cachedListing.currency,
         };
         
         // Update Redis cache
         await this.cacheService.setListing(listingId, listing);
         
         return listing;
       }
       
       // Cache miss, fetch from blockchain
       this.logger.log(`Cache miss for listing ID ${listingId}, fetching from blockchain...`);
       const listing = await this.fetchListingDetailsFromBlockchain(listingId);
       
       // Update Redis cache if listing was found
       if (listing) {
         await this.cacheService.setListing(listingId, listing);
       }
       
       return listing;
     } catch (error) {
        this.logger.error(`Error checking cache for listing ${listingId}: ${error.message}`);
        return this.fetchListingDetailsFromBlockchain(listingId);
     }
  }
  
  private async fetchListingDetailsFromBlockchain(listingId: number): Promise<ListingDto | null> {
     const propertyMarketplace = this.blockchainService.getContract('propertyMarketplace');

      if (!propertyMarketplace) {
          this.logger.error('PropertyMarketplace contract not available from BlockchainService');
          return null;
      }
    try {
         const rawListing = await (propertyMarketplace as any).listings(listingId);

         if (!rawListing || rawListing[0] === ZeroAddress) { // Check seller (index 0) 
             this.logger.warn(`Listing at index ${listingId} not found (or seller is zero address).`);
             return null;
         }
         // Await the async formatting
         return await this.formatListingData(rawListing, listingId);
     } catch (error) {
         this.logger.error(`Error fetching listing details for index ${listingId}: ${error.message}`);
         return null;
     }
  }

  async getPriceHistory(propertyNftId: string): Promise<HistoricalSale[]> {
    this.logger.log(`Fetching price history for property NFT ${propertyNftId}...`);
    try {
        return this.historicalSaleRepository.find({
          where: { propertyNftId },
          order: { timestamp: 'ASC' },
        });
    } catch (error) {
        this.logger.error(`Error fetching price history from database: ${error.message}`);
        return [];
    }
  }

  private listenToListingPurchased() {
    const propertyMarketplace = this.blockchainService.getContract('propertyMarketplace');
    if (!propertyMarketplace) {
      this.logger.error('Cannot listen for ListingPurchased: PropertyMarketplace contract not available');
      return;
    }

    this.logger.log('Setting up listener for ListingPurchased events...');

    propertyMarketplace.on('ListingPurchased', async (listingId, buyer, seller, amount, totalPrice, event: EventLog) => {
        this.logger.log(`ListingPurchased event received: listingId=${listingId}, buyer=${buyer}, amount=${amount}`);
        try {
            // Fetch details using the listingId from the event
            const listingDetails = await this.getListingDetails(Number(listingId)); 
            if (!listingDetails) {
                 this.logger.warn(`Could not get details for purchased listing ${listingId} to record sale.`);
                 return;
            }

            const block = await event.getBlock();

            const sale = this.historicalSaleRepository.create({
                // Use nftAddress from the fetched listing details
                propertyNftId: listingDetails.nftAddress, 
                buyerAddress: buyer,
                // The seller argument from the event might be more reliable than listingDetails.seller
                // if the listing was somehow transferred, although unlikely with current contract.
                // Using event seller for consistency:
                sellerAddress: seller, 
                // Format with 6 decimals for USDC instead of 18 for ETH
                price: parseFloat(ethers.formatUnits(totalPrice, 6)),
                // Update currency to USDC
                currency: 'USDC',
                transactionHash: event.transactionHash,
                timestamp: new Date(block.timestamp * 1000),
            });
            await this.historicalSaleRepository.save(sale);
            this.logger.log(`Saved historical sale for listing ${listingId} (NFT: ${listingDetails.nftAddress}), tx: ${event.transactionHash}`);
            
            // Update or invalidate caches
            await this.invalidateListingCache(Number(listingId));
        } catch (error) {
            this.logger.error(`Error processing ListingPurchased event for listing ${listingId}: ${error.message}`);
        }
    });
    
    // Listen for ListingCancelled events to update cache
    propertyMarketplace.on('ListingCancelled', async (listingId, event: EventLog) => {
      this.logger.log(`ListingCancelled event received for listingId=${listingId}`);
      try {
        await this.invalidateListingCache(Number(listingId));
        this.logger.log(`Invalidated cache for cancelled listing ${listingId}`);
      } catch (error) {
        this.logger.error(`Error processing ListingCancelled event: ${error.message}`);
      }
    });
    
    // Listen for ListingCreated events to update cache
    propertyMarketplace.on('ListingCreated', async (listingId, seller, propertyToken, tokenAmount, pricePerToken, event: EventLog) => {
      this.logger.log(`ListingCreated event received: listingId=${listingId}, seller=${seller}`);
      try {
        // Fetch and cache new listing details
        const listing = await this.fetchListingDetailsFromBlockchain(Number(listingId));
        if (listing) {
          await this.cacheService.setListing(Number(listingId), listing);
          
          // Invalidate all listings cache to include this new listing
          await this.cacheService.delete(this.cacheService['CACHE_KEYS'].LISTINGS_ALL);
        }
        this.logger.log(`Processed new listing ${listingId}`);
      } catch (error) {
        this.logger.error(`Error processing ListingCreated event: ${error.message}`);
      }
    });
  }
  
  // Invalidate both database and Redis cache for a listing
  private async invalidateListingCache(listingId: number): Promise<void> {
    try {
      // Delete from database cache
      await this.cachedListingRepository.delete({ listingId: listingId });
      
      // Delete from Redis cache
      await this.cacheService.invalidateListingCache(listingId);
      
      this.logger.log(`Invalidated cache for listing ${listingId}`);
    } catch (error) {
      this.logger.error(`Error invalidating cache for listing ${listingId}: ${error.message}`);
    }
  }
  
  // Setup periodic cache cleanup
  private setupCacheCleanup() {
    const cleanupInterval = 1800000; // 30 minutes
    
    setInterval(async () => {
      this.logger.log('Running listings cache cleanup...');
      
      try {
        // Delete expired listing cache entries
        const expiredListingsResult = await this.cachedListingRepository.delete({
          expiresAt: LessThan(new Date()),
        });
        
        this.logger.log(`Cleaned up ${expiredListingsResult.affected || 0} expired listing entries.`);
      } catch (error) {
        this.logger.error(`Error during listings cache cleanup: ${error.message}`);
      }
    }, cleanupInterval);
  }

  async resetAndRebuildCache(): Promise<void> {
    this.logger.log('Resetting and rebuilding listings cache...');
    
    try {
      // Clear Redis caches
      await this.cacheService.delete(this.cacheService['CACHE_KEYS'].LISTINGS_ALL);
      
      // Delete all cached listings
      await this.cachedListingRepository.clear();
      
      // Fetch fresh data from blockchain
      const listings = await this.fetchAllListingsFromBlockchain();
      
      this.logger.log(`Fetched ${listings.length} listings from blockchain for cache rebuild`);
      
      // Update Redis cache
      await this.cacheService.setAllListings(listings);
      
      this.logger.log('Listings cache rebuild completed successfully');
    } catch (error) {
      this.logger.error(`Error during listings cache rebuild: ${error.message}`);
    }
  }
} 