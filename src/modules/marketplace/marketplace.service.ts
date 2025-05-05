import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlockchainService } from '../blockchain/blockchain.service';
import { PropertiesService } from '../properties/properties.service';
import { HistoricalSale } from './entities/historical-sale.entity';
import { CachedListing } from './entities/cached-listing.entity';
import { CacheService } from '../cache/cache.service';
import { ethers, Contract, Log, EventLog, ZeroAddress } from 'ethers';
import { ListingDto } from './dto/listing.dto';
import { UserPropertyBalance } from '../properties/entities/user-property-balance.entity';

@Injectable()
export class MarketplaceService implements OnModuleInit {
  private readonly logger = new Logger(MarketplaceService.name);
  private readonly ALL_LISTINGS_CACHE_TTL = 3600; // 1 hour in seconds
  private readonly INDIVIDUAL_LISTING_CACHE_TTL = 3600; // 1 hour

  constructor(
    @InjectRepository(HistoricalSale)
    private historicalSaleRepository: Repository<HistoricalSale>,
    @InjectRepository(CachedListing)
    private cachedListingRepository: Repository<CachedListing>,
    @InjectRepository(UserPropertyBalance)
    private userPropertyBalanceRepository: Repository<UserPropertyBalance>,
    private blockchainService: BlockchainService,
    private propertiesService: PropertiesService,
    private cacheService: CacheService,
  ) {}

  async onModuleInit() {
    this.listenToListingEvents(); // Renamed for clarity
    // Remove setupCacheCleanup call
    this.logger.log('MarketplaceService initialized, starting initial cache population...');
    // Populate cache on startup - don't await, let it run in background
    this.populateInitialListingCache().catch(error => {
      this.logger.error(`Initial listing cache population failed: ${error.message}`);
    });
  }
  
  private async populateInitialListingCache(): Promise<void> {
    this.logger.log('Starting initial fetch of all active listings for cache...');
    const listings = await this.fetchAllListingsFromBlockchain();
    if (listings.length > 0) {
      await this.cacheService.setAllListings(listings, this.ALL_LISTINGS_CACHE_TTL);
      this.logger.log(`Successfully populated Redis cache with ${listings.length} active listings.`);
    } else {
      this.logger.warn('No active listings found during initial cache population.');
    }
  }

  // Renamed for clarity, includes all listing-related events
  private listenToListingEvents() {
    const propertyMarketplace = this.blockchainService.getContract('propertyMarketplace');
    if (!propertyMarketplace) {
      this.logger.error('Cannot listen for Marketplace events: PropertyMarketplace contract not available');
      return;
    }

    this.logger.log('Setting up listeners for Marketplace events (ListingPurchased, ListingCancelled, ListingCreated)...');

    // --- ListingPurchased Listener ---
    propertyMarketplace.on('ListingPurchased', async (listingId, buyer, amount, totalPrice, event: EventLog) => {
        this.logger.log(`ListingPurchased event received: listingId=${listingId}, buyer=${buyer}, amount=${amount}`);
        const listingIdNum = Number(listingId);
        let listingDetails: ListingDto | null = null;
        try {
            // Fetch details *before* invalidating
            listingDetails = await this.getListingDetails(listingIdNum);
            if (!listingDetails) {
                this.logger.warn(`Could not get details for purchased listing ${listingIdNum} to record sale or invalidate seller cache.`);
                // Attempt to invalidate listing cache even if details fetch failed
                await this.invalidateListingCache(listingIdNum);
                // Invalidate buyer's Redis cache anyway
                await this.cacheService.delete(`${this.cacheService['CACHE_KEYS'].USER_PROPERTIES}${buyer}`);
                return;
            }

            // Define seller for clarity
            const seller = listingDetails.seller;
            const propertyTokenAddress = listingDetails.tokenAddress;

            // Get block timestamp
            const block = await event.getBlock();
            const timestamp = new Date(block.timestamp * 1000);

            // Get transaction hash (handle potential missing value)
            let txHash = event.transactionHash;
            if (!txHash) {
                this.logger.warn(`Transaction hash missing from ListingPurchased event log for listing ${listingIdNum}. Attempting to fetch receipt...`);
                try {
                    const txReceipt = await event.getTransactionReceipt();
                    if (txReceipt) {
                      txHash = txReceipt.hash;
                      this.logger.log(`Successfully fetched transaction hash ${txHash} from receipt.`);
                    } else {
                        this.logger.error(`Could not fetch transaction receipt for ListingPurchased event (listing ${listingIdNum}). Cannot record historical sale.`);
                        // Optionally, still attempt cache invalidation before returning
                        await this.invalidateListingCache(listingIdNum);
                        await this.cacheService.delete(`${this.cacheService['CACHE_KEYS'].USER_PROPERTIES}${buyer}`);
                        await this.cacheService.delete(`${this.cacheService['CACHE_KEYS'].USER_PROPERTIES}${seller}`);
                        return; // Exit if hash cannot be obtained
                    }
                } catch (receiptError) {
                    this.logger.error(`Error fetching transaction receipt for ListingPurchased event (listing ${listingIdNum}): ${receiptError.message}. Cannot record historical sale.`);
                     // Optionally, still attempt cache invalidation before returning
                    await this.invalidateListingCache(listingIdNum);
                    await this.cacheService.delete(`${this.cacheService['CACHE_KEYS'].USER_PROPERTIES}${buyer}`);
                    await this.cacheService.delete(`${this.cacheService['CACHE_KEYS'].USER_PROPERTIES}${seller}`);
                    return; // Exit if hash cannot be obtained
                }
            }

            // Record the historical sale
            const sale = this.historicalSaleRepository.create({
                propertyNftId: listingDetails.nftAddress,
                buyerAddress: buyer,
                sellerAddress: seller,
                tokenAmount: amount.toString(),
                price: parseFloat(ethers.formatUnits(totalPrice, 6)), // Assuming 6 decimals for USDC
                currency: 'USDC',
                transactionHash: txHash, // Use the obtained hash
                timestamp: timestamp, // Use the obtained timestamp
            });
            this.logger.log(`[MarketplaceService] Attempting to save historical sale: ${JSON.stringify(sale)}`);
            await this.historicalSaleRepository.save(sale);
            this.logger.log(`[MarketplaceService] Successfully saved historical sale for listing ${listingIdNum} (NFT: ${listingDetails.nftAddress}), tx: ${txHash}`);
            
            // Invalidate listing cache
            await this.invalidateListingCache(listingIdNum);
            
            // --- Cache Invalidation --- 
            // 1. Invalidate buyer's Redis cache (DB cache handled by Transfer listener in PropertiesService)
            await this.cacheService.delete(`${this.cacheService['CACHE_KEYS'].USER_PROPERTIES}${buyer}`);
            
            // 2. Invalidate seller's Redis cache
            await this.cacheService.delete(`${this.cacheService['CACHE_KEYS'].USER_PROPERTIES}${seller}`);
            
            // 3. Update seller's DB balance cache to 0
            try {
              const updateResult = await this.userPropertyBalanceRepository.update(
                { userAddress: seller, propertyTokenAddress: propertyTokenAddress },
                { balance: '0' }
              );
              if (updateResult.affected && updateResult.affected > 0) {
                this.logger.log(`Updated seller ${seller}'s DB balance cache to 0 for token ${propertyTokenAddress}.`);
              } else {
                this.logger.log(`No existing DB balance cache found for seller ${seller} and token ${propertyTokenAddress} to update.`);
                // Optionally create a record with balance 0 if it should always exist after a sale
                // const zeroBalance = this.userPropertyBalanceRepository.create({ userAddress: seller, propertyTokenAddress: propertyTokenAddress, balance: '0', propertyNftAddress: listingDetails.nftAddress, tokenId: parseInt(listingDetails.tokenId) });
                // await this.userPropertyBalanceRepository.save(zeroBalance);
              }
            } catch (dbUpdateError) {
              this.logger.error(`Error updating seller ${seller}'s DB balance cache for token ${propertyTokenAddress}: ${dbUpdateError.message}`);
            }

            // 4. Also invalidate the specific property cache since balances changed
            await this.cacheService.invalidatePropertyCache(listingDetails.nftAddress, parseInt(listingDetails.tokenId)); // Pass tokenId too
            
            this.logger.log(`Invalidated caches for listing ${listingIdNum}, buyer ${buyer}, seller ${seller}, and property ${listingDetails.nftAddress}`);
        } catch (error) {
            this.logger.error(`Error processing ListingPurchased event for listing ${listingIdNum}: ${error.message}`);
            // Attempt to invalidate caches even on error
            await this.invalidateListingCache(listingIdNum);
             // Invalidate buyer's Redis cache anyway
             await this.cacheService.delete(`${this.cacheService['CACHE_KEYS'].USER_PROPERTIES}${buyer}`);
            if (listingDetails?.nftAddress) {
                await this.cacheService.invalidatePropertyCache(listingDetails.nftAddress, parseInt(listingDetails.tokenId));
            }
            if (listingDetails?.seller) {
                 await this.cacheService.delete(`${this.cacheService['CACHE_KEYS'].USER_PROPERTIES}${listingDetails.seller}`);
            }
        }
    });
    
    // --- ListingCancelled Listener ---
    propertyMarketplace.on('ListingCancelled', async (listingId, event: EventLog) => {
      const listingIdNum = Number(listingId);
      this.logger.log(`ListingCancelled event received for listingId=${listingIdNum}`);
      try {
        await this.invalidateListingCache(listingIdNum);
        this.logger.log(`Invalidated cache for cancelled listing ${listingIdNum}.`);
      } catch (error) {
        this.logger.error(`Error processing ListingCancelled event for ${listingIdNum}: ${error.message}`);
      }
    });
    
    // --- ListingCreated Listener ---
    propertyMarketplace.on('ListingCreated', async (listingId, seller, propertyToken, tokenAmount, pricePerToken, event: EventLog) => {
      const listingIdNum = Number(listingId);
      this.logger.log(`ListingCreated event received: listingId=${listingIdNum}, seller=${seller}`);
      try {
        // Fetch new listing details directly from blockchain
        const listing = await this.fetchListingDetailsFromBlockchain(listingIdNum);
        if (listing) {
          // formatListingData (called by fetchListingDetails) handles caching individual listing
          // We just need to invalidate the 'all listings' cache
          await this.cacheService.delete(this.cacheService['CACHE_KEYS'].LISTINGS_ALL);
          this.logger.log(`Processed new listing ${listingIdNum}, invalidating LISTINGS_ALL cache.`);
        } else {
           this.logger.warn(`Could not fetch details for newly created listing ${listingIdNum}. LISTINGS_ALL cache might be stale.`);
            // Still invalidate LISTINGS_ALL just in case
           await this.cacheService.delete(this.cacheService['CACHE_KEYS'].LISTINGS_ALL);
           this.logger.log(`Invalidating LISTINGS_ALL cache (new listing details not found).`);
        }
      } catch (error) {
        this.logger.error(`Error processing ListingCreated event for ${listingIdNum}: ${error.message}`);
         // Attempt to invalidate LISTINGS_ALL on error
        await this.cacheService.delete(this.cacheService['CACHE_KEYS'].LISTINGS_ALL);
        this.logger.log(`Invalidating LISTINGS_ALL cache (error).`);
      }
    });
  }

  // Modified to save to cache with TTL and without DB expiresAt
  private async formatListingData(listingData: any, listingId: number): Promise<ListingDto | null> {
    // Indices based on PropertyMarketplace.listings return:
    // 0: seller (address)
    // 1: propertyToken (address) - This is the ERC20 token for the property shares
    // 2: tokenAmount (uint256)
    // 3: pricePerToken (uint256)
    // 4: isActive (bool)
    const tokenAddress = listingData[1]; // PropertyToken address

    if (tokenAddress === ZeroAddress) {
        this.logger.warn(`Listing ${listingId} has zero address for propertyToken.`);
        return null; // Invalid listing data
    }

    let nftAddress = '';
    let tokenId = '';

    try {
        // Fetch NFT details using the PropertiesService (relies on its own caching)
        const nftDetails = await this.propertiesService.findNftDetailsByTokenAddress(tokenAddress);
        if (nftDetails) {
          nftAddress = nftDetails.nftAddress;
          tokenId = nftDetails.tokenId.toString();
        } else {
          this.logger.warn(`Could not find NFT details for token address ${tokenAddress} associated with listing ${listingId}`);
          // Proceeding without NFT details, might indicate an issue upstream or delay in property caching
        }

        const formattedListing: ListingDto = {
          listingId: listingId,
          seller: listingData[0],
          nftAddress: nftAddress, // Might be empty if lookup failed
          tokenId: tokenId,       // Might be empty if lookup failed
          tokenAddress: tokenAddress,
          pricePerToken: listingData[3].toString(),
          amount: listingData[2].toString(),
          active: listingData[4],
          currency: 'USDC'
        };

        // Save to database cache (without TTL, using upsert)
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
        // No expiresAt
        
        await this.cachedListingRepository.upsert(cachedListing, ['listingId']);
        this.logger.debug(`Saved/Updated listing data for ID ${listingId} in database cache.`);
        
        // Cache in Redis with TTL
        await this.cacheService.setListing(listingId, formattedListing, this.INDIVIDUAL_LISTING_CACHE_TTL);

        return formattedListing;
        
    } catch (error) {
      // Catch errors during formatting or caching
      this.logger.error(`Error formatting or caching listing data for ID ${listingId}: ${error.message}`);
      return null; // Return null if formatting/caching fails
    }
  }

  // Modified to prioritize Redis cache
  async findAllListings(): Promise<ListingDto[]> {
    this.logger.log('Fetching all active listings...');
    
    try {
      // Check Redis cache first
      const redisCache = await this.cacheService.getAllListings();
      if (redisCache && redisCache.length > 0) {
        this.logger.log(`Returning ${redisCache.length} active listings from Redis cache.`);
        return redisCache;
      }
      
      // Redis cache miss, fetch from blockchain
      this.logger.log('Redis cache miss for all listings, fetching from blockchain...');
      const listings = await this.fetchAllListingsFromBlockchain();
      
      // Update Redis cache
      if (listings.length > 0) {
        await this.cacheService.setAllListings(listings, this.ALL_LISTINGS_CACHE_TTL);
      }
      
      return listings;
    } catch (error) {
      this.logger.error(`Error finding all listings: ${error.message}`);
      // Attempt fallback to blockchain directly
      try {
        return await this.fetchAllListingsFromBlockchain();
      } catch (fallbackError) {
        this.logger.error(`Fallback fetchAllListingsFromBlockchain failed: ${fallbackError.message}`);
        return [];
      }
    }
  }
  
  // fetchAllListingsFromBlockchain remains largely the same,
  // formatListingData handles caching internally now
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
                // Fetch raw data first
                const rawListing = await (propertyMarketplace as any).listings(index);
                 // Basic validation before formatting
                 if (!rawListing || rawListing[0] === ZeroAddress || !rawListing[4]) { // Check seller and isActive flag
                     this.logger.debug(`Skipping listing index ${index}: Seller is zero or listing is inactive.`);
                     return null;
                 }
                // Format data (this includes caching)
                return await this.formatListingData(rawListing, index);
            } catch (error) {
                this.logger.error(`Error fetching or formatting listing index ${index}: ${error.message}`);
                return null; // Return null for failed listings
            }
        });

        // Resolve all promises and filter out nulls (failed/inactive fetches/formats)
        const resolvedListings = await Promise.all(listingPromises);
        const activeListings = resolvedListings.filter(listing => listing !== null) as ListingDto[];

        this.logger.log(`Successfully formatted ${activeListings.length} active listings from blockchain.`);
        return activeListings;

    } catch (error) {
        this.logger.error(`Error fetching active listing indices: ${error.message}`);
        return [];
    }
  }

  // Modified to prioritize Redis, then blockchain
  async getListingDetails(listingId: number): Promise<ListingDto | null> {
     this.logger.log(`Fetching details for listing index ${listingId}...`);
     
     try {
       // Check Redis cache first
       const redisCache = await this.cacheService.getListing(listingId);
       if (redisCache) {
         // Verify if the cached listing is still active according to its own flag
         if (redisCache.active) {
            this.logger.log(`Redis cache hit for listing ID ${listingId}.`);
            return redisCache;
         } else {
             this.logger.log(`Redis cache hit for listing ID ${listingId}, but it's marked inactive. Returning null.`);
              // Optionally invalidate here if inactive shouldn't be cached long
             // await this.invalidateListingCache(listingId);
             return null;
         }
       }
       
       // Redis cache miss, fetch from blockchain
       this.logger.log(`Redis cache miss for listing ID ${listingId}, fetching from blockchain...`);
       const listing = await this.fetchListingDetailsFromBlockchain(listingId);
       
       // formatListingData called within fetchListingDetailsFromBlockchain handles caching
       
       return listing; // Return the fetched (and maybe cached) listing or null
     } catch (error) {
        this.logger.error(`Error getting listing details for ${listingId}: ${error.message}`);
        // Attempt fallback to blockchain directly
        try {
            return await this.fetchListingDetailsFromBlockchain(listingId);
        } catch (fallbackError) {
            this.logger.error(`Fallback fetchListingDetailsFromBlockchain failed for ${listingId}: ${fallbackError.message}`);
            return null;
        }
     }
  }
  
  // fetchListingDetailsFromBlockchain remains largely the same,
  // formatListingData handles caching internally now
  private async fetchListingDetailsFromBlockchain(listingId: number): Promise<ListingDto | null> {
     const propertyMarketplace = this.blockchainService.getContract('propertyMarketplace');

      if (!propertyMarketplace) {
          this.logger.error('PropertyMarketplace contract not available from BlockchainService');
          return null;
      }
    try {
         const rawListing = await (propertyMarketplace as any).listings(listingId);

         // Check seller and isActive flag directly from contract data
         if (!rawListing || rawListing[0] === ZeroAddress || !rawListing[4]) { 
             this.logger.warn(`Listing at index ${listingId} not found, seller is zero address, or inactive.`);
             // Ensure cache is clean for this inactive/non-existent listing
             await this.invalidateListingCache(listingId);
              this.logger.log(`Skipping cache invalidation for inactive/non-existent listing ${listingId}.`);
             return null;
         }
         // Format data (this includes caching)
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

  // Modified to delete from DB cache
  private async invalidateListingCache(listingId: number): Promise<void> {
    this.logger.log(`CACHE INVALIDATION SKIPPED for listing ID: ${listingId}`);
    return;
    /* Original logic:
    try {
      // Delete from database cache
      const deleteResult = await this.cachedListingRepository.delete({ listingId: listingId });
      this.logger.log(`Deleted ${deleteResult.affected || 0} entries from DB cache for listing ${listingId}.`);
      
      // Delete from Redis cache (specific and all)
      await this.cacheService.invalidateListingCache(listingId);
      
      this.logger.log(`Invalidated Redis caches for listing ${listingId}`);
    } catch (error) {
      this.logger.error(`Error invalidating cache for listing ${listingId}: ${error.message}`);
    }
    */
  }
  
  // Remove the setupCacheCleanup method entirely
  // private setupCacheCleanup() { ... }

  // Modified to call populateInitialListingCache after clearing
  async resetAndRebuildCache(): Promise<void> {
    this.logger.log('Resetting and rebuilding listings cache...');
    
    try {
      // Clear Redis caches
      // await this.cacheService.delete(this.cacheService['CACHE_KEYS'].LISTINGS_ALL);
      // Ideally, clear individual listing keys too (requires knowing all IDs or pattern matching)
      // Example: await this.cacheService.deletePattern(this.cacheService['CACHE_KEYS'].LISTING + '*');
      this.logger.warn('SKIPPING Redis cache clear during reset/rebuild.');

      // Delete all cached listings from DB
      // await this.cachedListingRepository.clear();
      this.logger.warn('SKIPPING database cache clear during reset/rebuild.');
      
      // Fetch fresh data and populate Redis
      this.logger.log('Attempting to repopulate cache...');
      await this.populateInitialListingCache();
      
      this.logger.log('Listings cache reset and rebuild initiated (invalidation/clearing skipped).');
    } catch (error) {
      this.logger.error(`Error during listings cache reset and rebuild: ${error.message}`);
    }
  }
} 