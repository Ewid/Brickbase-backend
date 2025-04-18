import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ethers, Contract, ZeroAddress, EventLog } from 'ethers';
import { PropertyDto } from './dto/property.dto';
import { CachedProperty } from './entities/cached-property.entity';
import { UserPropertyBalance } from './entities/user-property-balance.entity';
import { CacheService } from '../cache/cache.service';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { ListingDto } from '../marketplace/dto/listing.dto';
// Define an interface matching the RegisteredProperty struct
interface RegisteredProperty {
  propertyNFT: string;
  propertyToken: string;
  isActive: boolean;
  registrationDate: bigint; // Use bigint for uint256
}

// Interface for PropertyNFT.properties mapping return value
interface PropertyDetailsFromContract {
    propertyAddress: string;
    squareFootage: bigint;
    purchasePrice: bigint;
    constructionYear: bigint;
    propertyType: string;
    propertyToken: string; // Associated ERC20 token address
}

@Injectable()
export class PropertiesService implements OnModuleInit {
  private readonly logger = new Logger(PropertiesService.name);
  private ipfsGatewayUrl: string;
  private readonly tokenAddresses: string[] = [];
  private readonly ALL_PROPERTIES_CACHE_TTL = 86400; // 24 hours in seconds
  private readonly INDIVIDUAL_PROPERTY_CACHE_TTL = 86400; // 24 hours
  private readonly USER_BALANCE_CACHE_TTL = 900; // 15 minutes

  constructor(
    private blockchainService: BlockchainService,
    private configService: ConfigService,
    private cacheService: CacheService,
    @InjectRepository(CachedProperty)
    private cachedPropertyRepository: Repository<CachedProperty>,
    @InjectRepository(UserPropertyBalance)
    private userPropertyBalanceRepository: Repository<UserPropertyBalance>,
  ) {
    this.ipfsGatewayUrl = this.configService.get<string>('IPFS_GATEWAY_URL', 'https://ipfs.io/ipfs/');
    if (!this.ipfsGatewayUrl.endsWith('/')) {
        this.ipfsGatewayUrl += '/';
    }
    
    // Collect token addresses from environment config
    this.tokenAddresses = [
      this.configService.get<string>('MBV_TOKEN_ADDRESS', ''),
      this.configService.get<string>('MLC_TOKEN_ADDRESS', ''),
      this.configService.get<string>('SFMT_TOKEN_ADDRESS', ''),
      this.configService.get<string>('CDP_TOKEN_ADDRESS', ''),
    ].filter(address => address && address !== '');
  }
  
  async onModuleInit() {
    this.listenToPropertyEvents();
    this.logger.log('PropertiesService initialized, starting initial cache population...');
    this.populateInitialPropertyCache().catch(error => {
      this.logger.error(`Initial property cache population failed: ${error.message}`);
    });
  }

  private async populateInitialPropertyCache(): Promise<void> {
    this.logger.log('Starting initial fetch of all properties for cache...');
    const properties = await this.fetchAllPropertiesFromBlockchain();
    if (properties.length > 0) {
      await this.cacheService.setAllProperties(properties, this.ALL_PROPERTIES_CACHE_TTL);
      this.logger.log(`Successfully populated Redis cache with ${properties.length} properties.`);
    } else {
      this.logger.warn('No properties found during initial cache population.');
    }
  }
  
  // Setup listeners for blockchain events to invalidate caches
  private listenToPropertyEvents() {
    this.logger.log('Setting up property event listeners...');
    
    // Listen for registry events
    this.setupRegistryListeners();
    
    // Listen for NFT events
    this.setupNftListeners();
    
    // Listen for token transfer events
    this.setupTokenTransferListeners();
  }
  
  private setupRegistryListeners() {
    const propertyRegistry = this.blockchainService.getContract('propertyRegistry');
    
    if (!propertyRegistry) {
      this.logger.error('Cannot listen for registry events: PropertyRegistry contract not available');
      return;
    }
    
    // Listen for property registrations
    propertyRegistry.on('PropertyRegistered', async (propertyNftAddress, propertyTokenAddress, event: EventLog) => {
      this.logger.log(`PropertyRegistered event: NFT=${propertyNftAddress}, Token=${propertyTokenAddress}`);
      
      // Invalidate the all properties cache - let the next request repopulate
      await this.cacheService.delete(this.cacheService['CACHE_KEYS'].PROPERTIES_ALL);
      // Optionally fetch and add the new property immediately
      // await this.getPropertyDetails(propertyNftAddress); // This would fetch and cache it
      this.logger.log('Invalidated properties list cache due to new property registration.');
    });
    
    // Listen for property status changes (active/inactive)
    propertyRegistry.on('PropertyStatusChanged', async (propertyNftAddress, isActive, event: EventLog) => {
      this.logger.log(`PropertyStatusChanged event: NFT=${propertyNftAddress}, isActive=${isActive}`);
      
      try {
        // Find the property details needed for invalidation
        const cachedProperty = await this.cachedPropertyRepository.findOne({
          where: { id: propertyNftAddress },
          select: ['tokenAddress', 'tokenId'] // Select only needed fields
        });
        
        if (cachedProperty) {
          await this.invalidatePropertyCaches(
            propertyNftAddress, 
            cachedProperty.tokenAddress, 
            cachedProperty.tokenId
          );
        } else {
           // If not in DB cache, still invalidate Redis 'all' cache
           await this.cacheService.delete(this.cacheService['CACHE_KEYS'].PROPERTIES_ALL);
           this.logger.warn(`PropertyStatusChanged for ${propertyNftAddress}, but property not found in DB cache. Invalidating ALL_PROPERTIES only.`);
        }
      } catch (error) {
        this.logger.error(`Error handling PropertyStatusChanged event: ${error.message}`);
      }
    });
  }
  
  private setupNftListeners() {
    const propertyNFT = this.blockchainService.getContract('propertyNFT');
    
    if (!propertyNFT) {
      this.logger.error('Cannot listen for NFT events: PropertyNFT contract not available');
      return;
    }
    
    // Listen for metadata updates
    propertyNFT.on('MetadataUpdate', async (tokenId, event: EventLog) => {
      this.logger.log(`MetadataUpdate event for tokenId=${tokenId}`);
      
      try {
        // Convert tokenId to number
        const tokenIdNum = Number(tokenId);
        
        // Find the property details needed for invalidation
        const cachedProperty = await this.cachedPropertyRepository.findOne({
          where: { tokenId: tokenIdNum },
          select: ['id', 'tokenAddress'] // Select only needed fields
        });
        
        if (cachedProperty) {
          await this.invalidatePropertyCaches(
            cachedProperty.id, 
            cachedProperty.tokenAddress, 
            tokenIdNum
          );
           this.logger.log(`Invalidated caches for property with tokenId ${tokenIdNum} due to metadata update`);
        } else {
            // If not in DB cache, still invalidate Redis 'all' cache
           await this.cacheService.delete(this.cacheService['CACHE_KEYS'].PROPERTIES_ALL);
           this.logger.warn(`MetadataUpdate for tokenId ${tokenIdNum}, but property not found in DB cache for full invalidation. Invalidating ALL_PROPERTIES only.`);
        }
      } catch (error) {
        this.logger.error(`Error handling MetadataUpdate event: ${error.message}`);
      }
    });
    
    // Listen for NFT transfers (although these should be rare in this system)
    propertyNFT.on('Transfer', async (from, to, tokenId, event: EventLog) => {
      this.logger.log(`NFT Transfer event: tokenId=${tokenId}, from=${from}, to=${to}`);
      
      try {
        const tokenIdNum = Number(tokenId);
        // Find the property details needed for invalidation
        const cachedProperty = await this.cachedPropertyRepository.findOne({
           where: { tokenId: tokenIdNum },
           select: ['id', 'tokenAddress'] // Select only needed fields
        });
        
        if (cachedProperty) {
          await this.invalidatePropertyCaches(
            cachedProperty.id, 
            cachedProperty.tokenAddress, 
            tokenIdNum
          );
          this.logger.log(`Invalidated caches for property with tokenId ${tokenIdNum} due to NFT transfer`);
        } else {
            // If not in DB cache, still invalidate Redis 'all' cache
           await this.cacheService.delete(this.cacheService['CACHE_KEYS'].PROPERTIES_ALL);
           this.logger.warn(`NFT Transfer for tokenId ${tokenIdNum}, but property not found in DB cache for full invalidation. Invalidating ALL_PROPERTIES only.`);
        }
      } catch (error) {
        this.logger.error(`Error handling NFT Transfer event: ${error.message}`);
      }
    });
  }
  
  private setupTokenTransferListeners() {
    // Listen for ERC20 token transfers (affects user balances)
    for (const tokenAddress of this.tokenAddresses) {
      const tokenContract = this.blockchainService.getPropertyTokenByAddress(tokenAddress);
      
      if (!tokenContract) {
        this.logger.warn(`Cannot listen for token transfers: Token contract not available for ${tokenAddress}`);
        continue;
      }
      
      this.logger.log(`Setting up transfer event listener for token ${tokenAddress}`);
      
      tokenContract.on('Transfer', async (from, to, amount, event: EventLog) => {
        this.logger.log(`Token Transfer event on ${tokenAddress}: from=${from}, to=${to}, amount=${amount}`);
        
        try {
          // Keep the 'to' address handling block (for the buyer/recipient)
          if (to !== ZeroAddress) {
            await this.cacheService.delete(`${this.cacheService['CACHE_KEYS'].USER_PROPERTIES}${to}`);
            // For the buyer, fetch the new balance and update the cache
            const newBalance = await tokenContract.balanceOf(to);
            const propertyDetails = await this.findNftDetailsByTokenAddressFromBlockchain(tokenAddress);
            
            if (propertyDetails) {
              const userBalance = new UserPropertyBalance();
              userBalance.userAddress = to;
              userBalance.propertyTokenAddress = tokenAddress;
              userBalance.propertyNftAddress = propertyDetails.nftAddress;
              userBalance.tokenId = propertyDetails.tokenId;
              userBalance.balance = newBalance.toString();
              
              await this.userPropertyBalanceRepository.upsert(userBalance, ['userAddress', 'propertyTokenAddress']);
              this.logger.log(`Updated property balance cache for buyer ${to} and token ${tokenAddress} to ${newBalance.toString()}`);
            }
          }
        } catch (error) {
          this.logger.error(`Error handling token transfer event for ${tokenAddress}: ${error.message}`); // Updated error log message
        }
      });
    }
  }

  private async fetchMetadata(uri: string): Promise<any> {
    if (!uri || !uri.startsWith('ipfs://')) {
        this.logger.warn(`Invalid or non-IPFS URI received: ${uri}`);
        return {};
    }
    const gatewayUri = uri.replace('ipfs://', this.ipfsGatewayUrl);
    this.logger.debug(`Fetching metadata from: ${gatewayUri}`);
    try {
      const response = await axios.get(gatewayUri);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch metadata from ${gatewayUri}: ${error.message}`);
      return {};
    }
  }

  // Modified formatProperty to save to caches with longer TTL
  private async formatProperty(propertyData: RegisteredProperty, tokenId: number): Promise<PropertyDto | null> {
    const propertyNFTContract = this.blockchainService.getContract('propertyNFT');

    if (!propertyNFTContract) {
      this.logger.error('NFT contract instance not available for formatting');
      return null;
    }

    const tokenAddress = propertyData.propertyToken;
    if (!tokenAddress || tokenAddress === ZeroAddress) {
        this.logger.warn(`No associated token found for NFT ${propertyData.propertyNFT} in registry data.`);
        return null;
    }

    try {
      // Get the specific token contract for this property
      const propertyTokenContract = this.blockchainService.getPropertyTokenByAddress(tokenAddress);

      if (!propertyTokenContract) {
        this.logger.error(`Token contract not available for ${tokenAddress}`);
        return null;
      }

      // Fetch the token URI and metadata
      const tokenURI = await (propertyNFTContract as any).tokenURI(tokenId);
      this.logger.debug(`Token URI for NFT ${propertyData.propertyNFT}, ID ${tokenId}: ${tokenURI}`);
      
      const metadata = await this.fetchMetadata(tokenURI);
      const totalSupply = await propertyTokenContract.totalSupply();

      const propertyDto = {
        id: propertyData.propertyNFT, // NFT contract address
        tokenId: tokenId,
        tokenAddress: tokenAddress, // Include the specific token address
        metadata: metadata,
        totalSupply: totalSupply.toString(),
      };

      // Save to database cache (without TTL)
      await this.saveToCachedProperties(propertyDto);
      
      // Save to Redis cache with long TTL
      await this.cacheService.setProperty(propertyDto.id, propertyDto, propertyDto.tokenId, this.INDIVIDUAL_PROPERTY_CACHE_TTL);
      await this.cacheService.setPropertyByToken(propertyDto.tokenAddress, propertyDto, this.INDIVIDUAL_PROPERTY_CACHE_TTL);
      
      return propertyDto;
    } catch (error) {
      this.logger.error(`Error formatting property details for NFT ${propertyData.propertyNFT} (Token ID ${tokenId}): ${error.message}`);
      return null;
    }
  }

  // Modified method to save data to DB cache without TTL
  private async saveToCachedProperties(propertyDto: PropertyDto): Promise<void> {
    try {
      const cachedProperty = new CachedProperty();
      cachedProperty.id = propertyDto.id;
      cachedProperty.tokenId = propertyDto.tokenId;
      cachedProperty.tokenAddress = propertyDto.tokenAddress;
      cachedProperty.metadata = propertyDto.metadata;
      cachedProperty.totalSupply = propertyDto.totalSupply;
      cachedProperty.isActive = true; // Explicitly set isActive to true
      // No expiresAt needed here
      
      // Use upsert to avoid race conditions if called multiple times quickly
      // Specify the composite key for conflict resolution
      await this.cachedPropertyRepository.upsert(cachedProperty, ['id', 'tokenId']);
      this.logger.log(`Saved/Updated property data in DB cache for NFT ${propertyDto.id}, Token ID ${propertyDto.tokenId}`);
    } catch (error) {
      this.logger.error(`Error saving property data to DB cache: ${error.message}`);
    }
  }

  // Modified to prioritize Redis cache
  async findAllProperties(): Promise<PropertyDto[]> {
    this.logger.log('Fetching all properties...');
    
    try {
      // Check Redis cache first
      const redisCache = await this.cacheService.getAllProperties();
      if (redisCache && redisCache.length > 0) {
        this.logger.log(`Returning ${redisCache.length} properties from Redis cache.`);
        return redisCache;
      }
      
      // Redis cache miss - fetch from blockchain
      this.logger.log('Redis cache miss for all properties, fetching from blockchain...');
      const properties = await this.fetchAllPropertiesFromBlockchain();
      
      // Update Redis cache
      if (properties.length > 0) {
        await this.cacheService.setAllProperties(properties, this.ALL_PROPERTIES_CACHE_TTL);
      }
      
      return properties;
    } catch (error) {
      this.logger.error(`Error in findAllProperties: ${error.message}`);
      // Attempt fallback to blockchain fetch directly in case of error during cache checks
      try {
          return await this.fetchAllPropertiesFromBlockchain();
      } catch (fallbackError) {
           this.logger.error(`Fallback fetchAllPropertiesFromBlockchain failed: ${fallbackError.message}`);
           return []; // Return empty if fallback also fails
      }
    }
  }
  
  // formatProperty handles caching internally now
  private async fetchAllPropertiesFromBlockchain(): Promise<PropertyDto[]> {
    const propertyRegistry = this.blockchainService.getContract('propertyRegistry');
    const propertyNFT = this.blockchainService.getContract('propertyNFT');

    if (!propertyRegistry || !propertyNFT) {
      this.logger.error('PropertyRegistry or PropertyNFT contract not available');
      return [];
    }

    try {
      // Get all properties from the registry
      const allRegisteredProps: RegisteredProperty[] = await (propertyRegistry as any).getAllProperties();
      this.logger.log(`Found ${allRegisteredProps.length} registered properties in registry.`);

      const propertyPromises: Promise<PropertyDto | null>[] = [];

      // For each property in the registry, use its index as the tokenId (matching registration logic)
      for (let i = 0; i < allRegisteredProps.length; i++) {
        const propStruct = allRegisteredProps[i];
        
        if (!propStruct.isActive) {
          this.logger.log(`Skipping inactive property registration at index ${i}: NFT ${propStruct.propertyNFT}`);
          continue;
        }
        
        // Reverted: Use index 'i' as the assumed tokenId based on registration script
        const resolvedTokenId = i; 

        this.logger.log(`Queueing format for property at index ${i}: NFT ${propStruct.propertyNFT}, TokenId ${resolvedTokenId}`);
        propertyPromises.push(this.formatProperty(propStruct, resolvedTokenId));
      }
      
      // Await all formatting promises
      const resolvedProperties = await Promise.all(propertyPromises);
      
      // Filter out nulls (errors during formatting/fetching)
      const allProperties = resolvedProperties.filter(p => p !== null) as PropertyDto[];

      this.logger.log(`Successfully formatted ${allProperties.length} active properties from blockchain.`);
      return allProperties;
    } catch (error) {
      this.logger.error(`Error in fetchAllPropertiesFromBlockchain: ${error.message}`);
      return [];
    }
  }

  // Modified to check Redis cache first, then blockchain
  async getPropertyDetails(nftAddress: string, tokenId?: number): Promise<PropertyDto | null> {
    this.logger.log(`Fetching details for property NFT address ${nftAddress}${tokenId !== undefined ? `, tokenId: ${tokenId}` : ''}`);
    
    try {
      // Try to get from Redis cache first
      const redisCache = await this.cacheService.getProperty(nftAddress, tokenId);
      if (redisCache) {
        this.logger.log(`Redis cache hit for property NFT ${nftAddress}`);
        return redisCache;
      }
      
      // Cache miss, fetch from blockchain
      this.logger.log(`Redis cache miss for property NFT ${nftAddress}, fetching from blockchain...`);
      const property = await this.fetchPropertyDetailsFromBlockchain(nftAddress, tokenId);
      
      // formatProperty called within fetchPropertyDetailsFromBlockchain now handles caching
      
      return property;
    } catch (error) {
      this.logger.error(`Error checking cache for NFT ${nftAddress}: ${error.message}`);
      // Attempt fallback to blockchain directly
      try {
        return await this.fetchPropertyDetailsFromBlockchain(nftAddress, tokenId);
      } catch (fallbackError) {
        this.logger.error(`Fallback fetchPropertyDetailsFromBlockchain failed for ${nftAddress}: ${fallbackError.message}`);
        return null;
      }
    }
  }
  
  // fetchPropertyDetailsFromBlockchain remains largely the same,
  // formatProperty handles caching internally now
  private async fetchPropertyDetailsFromBlockchain(nftAddress: string, tokenId?: number): Promise<PropertyDto | null> {
    const propertyRegistry = this.blockchainService.getContract('propertyRegistry');

    if (!propertyRegistry) {
      this.logger.error('PropertyRegistry contract not available');
      return null;
    }

    try {
      let resolvedTokenId = tokenId;
      // If tokenId is not provided, try to find it from the registry
      if (resolvedTokenId === undefined) {
        try {
            const indexBigInt: bigint = await (propertyRegistry as any).propertyIndex(nftAddress);
            resolvedTokenId = Number(indexBigInt) - 1; // Assuming index is 1-based in contract
             if (resolvedTokenId < 0) {
               this.logger.warn(`Property NFT address ${nftAddress} not found in registry index mapping.`);
               return null;
            }
            this.logger.debug(`Resolved tokenId ${resolvedTokenId} for NFT ${nftAddress} via propertyIndex.`);
        } catch (indexError) {
             this.logger.warn(`Could not resolve tokenId for NFT ${nftAddress} via propertyIndex: ${indexError.message}. Iteration might be needed if this registry structure is used.`);
             // Depending on contract, might need to iterate here if index isn't reliable/present
             return null; // Or implement iteration fallback if necessary
        }
      }

      // Get the property data from the registry using the resolved tokenId
      const propertyData: RegisteredProperty = await (propertyRegistry as any).registeredProperties(resolvedTokenId);

      if (!propertyData || propertyData.propertyNFT.toLowerCase() !== nftAddress.toLowerCase()) {
         this.logger.warn(`Property data mismatch for NFT address ${nftAddress} at index ${resolvedTokenId}. Expected ${nftAddress}, got ${propertyData?.propertyNFT}`);
         return null;
      }
      
      if (!propertyData.isActive) {
        this.logger.warn(`Property NFT ${nftAddress} at index ${resolvedTokenId} is registered but inactive.`);
        // Invalidate any potential stale cache entry
        await this.invalidatePropertyCaches(nftAddress, propertyData.propertyToken, resolvedTokenId);
        this.logger.log(`Skipping cache invalidation for inactive property NFT ${nftAddress}.`);
        return null; // Return null for inactive properties
      }

      return this.formatProperty(propertyData, resolvedTokenId);
    } catch (error) {
      this.logger.error(`Error fetching details for NFT ${nftAddress}: ${error.message}`);
      return null;
    }
  }

  // Modified to check Redis cache first, then blockchain
  async findNftDetailsByTokenAddress(tokenAddress: string): Promise<{ nftAddress: string; tokenId: number } | null> {
    this.logger.log(`Searching for NFT details associated with Token: ${tokenAddress}`);
    
    try {
      // Check Redis cache first
      const redisCache = await this.cacheService.getPropertyByToken(tokenAddress);
      if (redisCache) {
        this.logger.log(`Redis cache hit for token ${tokenAddress}`);
        return {
          nftAddress: redisCache.id,
          tokenId: redisCache.tokenId,
        };
      }
      
      // Redis cache miss, fetch details from blockchain
      this.logger.log(`Redis cache miss for token ${tokenAddress}, fetching NFT details from blockchain...`);
      const nftDetails = await this.findNftDetailsByTokenAddressFromBlockchain(tokenAddress);
      
      // If found, fetch the full property details which will populate the cache
      if (nftDetails) {
         this.logger.log(`Found NFT details for token ${tokenAddress}, fetching full property data to populate cache...`);
         // Don't await this, let it happen in background if needed immediately
         this.getPropertyDetails(nftDetails.nftAddress, nftDetails.tokenId).catch(err => {
             this.logger.error(`Error populating cache after finding NFT details for ${tokenAddress}: ${err.message}`);
         });
      }
      
      return nftDetails;
    } catch (error) {
      this.logger.error(`Error checking cache for token ${tokenAddress}: ${error.message}`);
      // Attempt fallback to blockchain directly
      try {
         return await this.findNftDetailsByTokenAddressFromBlockchain(tokenAddress);
      } catch (fallbackError) {
          this.logger.error(`Fallback findNftDetailsByTokenAddressFromBlockchain failed for ${tokenAddress}: ${fallbackError.message}`);
          return null;
      }
    }
  }
  
  // findNftDetailsByTokenAddressFromBlockchain remains the same logic
  private async findNftDetailsByTokenAddressFromBlockchain(tokenAddress: string): Promise<{ nftAddress: string; tokenId: number } | null> {
    const propertyRegistry = this.blockchainService.getContract('propertyRegistry');

    if (!propertyRegistry) {
      this.logger.error('PropertyRegistry contract not available for NFT detail lookup.');
      return null;
    }

    try {
      // Attempt direct lookup if available (ideal scenario)
      try {
        const propertyInfo = await (propertyRegistry as any).getPropertyByToken(tokenAddress);
        if (propertyInfo && propertyInfo.propertyNFT && propertyInfo.propertyNFT !== ZeroAddress) {
          const tokenId = Number(propertyInfo.tokenId); // Ensure conversion
          this.logger.log(`Found property directly via getPropertyByToken for token ${tokenAddress}: NFT ${propertyInfo.propertyNFT}, tokenId ${tokenId}`);
          // Verify it's active before returning
           const propData: RegisteredProperty = await (propertyRegistry as any).registeredProperties(tokenId);
           if (propData.isActive) {
                return { nftAddress: propertyInfo.propertyNFT, tokenId: tokenId };
           } else {
                this.logger.warn(`Direct lookup found inactive property for token ${tokenAddress}.`);
                return null;
           }
        }
      } catch (directLookupError) {
        this.logger.debug(`Direct property lookup via getPropertyByToken failed or not available, falling back to iteration: ${directLookupError.message}`);
      }

      // Fallback: Iterate through all registered properties
      this.logger.debug(`Iterating through registered properties to find token ${tokenAddress}...`);
      const allRegisteredProps: RegisteredProperty[] = await (propertyRegistry as any).getAllProperties();
      
      for (let i = 0; i < allRegisteredProps.length; i++) {
        const propStruct = allRegisteredProps[i];
        
        if (propStruct.isActive && propStruct.propertyToken.toLowerCase() === tokenAddress.toLowerCase()) {
          this.logger.debug(`Found matching NFT address ${propStruct.propertyNFT} at index ${i} for token ${tokenAddress} via iteration`);
          return { nftAddress: propStruct.propertyNFT, tokenId: i };
        }
      }

      this.logger.warn(`No *active* matching property found for token address ${tokenAddress} after checking registry`);
      return null;
    } catch (error) {
      this.logger.error(`Error in findNftDetailsByTokenAddressFromBlockchain for ${tokenAddress}: ${error.message}`);
      return null;
    }
  }

  // Modified to use Redis cache first, then blockchain
  async getPropertyDetailsByTokenAddress(tokenAddress: string): Promise<PropertyDto | null> {
    this.logger.log(`Fetching property details by token address ${tokenAddress}`);
    
    try {
      // Check Redis cache first
      const redisCache = await this.cacheService.getPropertyByToken(tokenAddress);
      if (redisCache) {
        this.logger.log(`Redis cache hit for token address ${tokenAddress}`);
        return redisCache;
      }
      
      // Redis cache miss, need to find NFT details first
      this.logger.log(`Redis cache miss for token address ${tokenAddress}, finding NFT details...`);
      const nftDetails = await this.findNftDetailsByTokenAddressFromBlockchain(tokenAddress); // Use the blockchain fetcher directly
      
      if (!nftDetails) {
        this.logger.warn(`No NFT details found for token address ${tokenAddress}`);
        return null;
      }
      
      // Found NFT details, now get the full property details (which will cache)
      this.logger.log(`Found NFT details for token ${tokenAddress} (NFT: ${nftDetails.nftAddress}, ID: ${nftDetails.tokenId}), fetching details...`);
      // This call will fetch from blockchain and populate Redis via formatProperty
      const property = await this.getPropertyDetails(nftDetails.nftAddress, nftDetails.tokenId); 
      
      return property; // Return the fetched (and now cached) property
    } catch (error) {
      this.logger.error(`Error in getPropertyDetailsByTokenAddress for ${tokenAddress}: ${error.message}`);
       return null; // Return null on error
    }
  }

  // Modified to use Redis cache first, then blockchain, remove expiresAt from DB logic
  async findPropertiesOwnedByUser(address: string): Promise<any[]> {
    this.logger.log(`Finding properties owned by ${address}`);
    
    try {
      // Check Redis cache first
      const redisCache = await this.cacheService.getUserProperties(address);
      if (redisCache && redisCache.length > 0) { // Check if array is not empty
        this.logger.log(`Redis cache hit for user ${address} properties`);
        return redisCache;
      }
      
      // Check database cache (no expiresAt check)
      const cachedBalances = await this.userPropertyBalanceRepository.find({
        where: { userAddress: address },
        // Remove automatic relation loading, we'll fetch manually
        // relations: { cachedProperty: true }, 
      });
      
      if (cachedBalances.length > 0) {
        this.logger.log(`Found ${cachedBalances.length} balances in DB cache for user ${address}`);
        
        // Manually fetch corresponding cached property for each balance
        const userPropertiesPromises = cachedBalances.map(async (balance) => {
          const cachedProperty = await this.cachedPropertyRepository.findOne({
            where: { id: balance.propertyNftAddress, tokenId: balance.tokenId },
          });
          
          if (cachedProperty && cachedProperty.isActive) {
            return {
              id: cachedProperty.id,
              tokenId: cachedProperty.tokenId,
              tokenAddress: cachedProperty.tokenAddress,
              metadata: cachedProperty.metadata,
              totalSupply: cachedProperty.totalSupply,
              balance: balance.balance,
            };
          } else {
             this.logger.warn(`Cached property not found or inactive for NFT ${balance.propertyNftAddress}, TokenID ${balance.tokenId} during DB cache retrieval for user ${address}`);
            return null; // Exclude if property not found or inactive
          }
        });

        const resolvedUserProperties = await Promise.all(userPropertiesPromises);
        const userProperties = resolvedUserProperties.filter(p => p !== null) as any[];
        
        if (userProperties.length > 0) {
          this.logger.log(`Returning ${userProperties.length} properties from DB cache for user ${address}. Updating Redis.`);
          // Update Redis cache with DB data
          await this.cacheService.setUserProperties(address, userProperties, this.USER_BALANCE_CACHE_TTL);
          return userProperties;
        }
      }
      
      // Cache miss (Redis and DB), fetch from blockchain
      this.logger.log(`Cache miss for user ${address} balances, fetching from blockchain...`);
      const userProperties = await this.fetchPropertiesOwnedByUserFromBlockchain(address);
      
      // Update Redis cache
      if (userProperties.length > 0) {
        await this.cacheService.setUserProperties(address, userProperties, this.USER_BALANCE_CACHE_TTL);
      }
      
      return userProperties;
    } catch (error) {
      this.logger.error(`Error finding properties for user ${address}: ${error.message}`);
       // Attempt fallback to blockchain directly
       try {
         return await this.fetchPropertiesOwnedByUserFromBlockchain(address);
       } catch (fallbackError) {
          this.logger.error(`Fallback fetchPropertiesOwnedByUserFromBlockchain failed for ${address}: ${fallbackError.message}`);
          return [];
       }
    }
  }
  
  // Modified to save to DB cache without TTL
  private async fetchPropertiesOwnedByUserFromBlockchain(address: string): Promise<any[]> {
    // Ensure we have the latest list of properties, potentially from cache
    const allProperties = await this.findAllProperties(); 
    // Log the properties being checked
    this.logger.debug(`[fetchOwned] Properties list from findAllProperties: ${JSON.stringify(allProperties.map(p => ({ id: p.id, tokenAddress: p.tokenAddress, tokenId: p.tokenId })), null, 2)}`);
    const ownedPropertiesPromises: Promise<any | null>[] = [];
    
    this.logger.log(`Checking balances for ${allProperties.length} properties for user ${address}...`);

    for (const property of allProperties) {
      ownedPropertiesPromises.push(
         (async () => {
            try {
              const tokenContract = this.blockchainService.getPropertyTokenByAddress(property.tokenAddress);
              if (tokenContract) {
                const balance = await tokenContract.balanceOf(address);
                // Log the balance check result
                this.logger.debug(`[fetchOwned] Balance check for ${property.tokenAddress} (User: ${address}): ${balance.toString()}`);
                if (balance > BigInt(0)) {
                  // --- Ensure CachedProperty exists before upserting UserPropertyBalance ---
                  const ensuredProperty = await this.getPropertyDetails(property.id, property.tokenId);
                  if (!ensuredProperty) {
                    this.logger.error(`[fetchOwned] Failed to ensure CachedProperty exists for NFT ${property.id}, TokenID ${property.tokenId} before balance upsert. Skipping.`);
                    return null; // Skip if we can't ensure the parent record exists
                  }
                  // --- End Ensure --- 
                  
                  // Save to DB cache (without TTL) using upsert
                  const userBalance = new UserPropertyBalance();
                  userBalance.userAddress = address;
                  userBalance.propertyTokenAddress = property.tokenAddress;
                  userBalance.propertyNftAddress = ensuredProperty.id; // Use ID from the ensured property
                  userBalance.tokenId = ensuredProperty.tokenId; // Use tokenId from the ensured property
                  userBalance.balance = balance.toString();
                  // No expiresAt
                  
                  // Upsert the balance record, now that we know the CachedProperty exists
                  await this.userPropertyBalanceRepository.upsert(userBalance, ['userAddress', 'propertyTokenAddress']);
                  this.logger.debug(`[fetchOwned] Upserted balance for user ${address}, token ${property.tokenAddress}`);

                  // Return the DTO using ensuredProperty for consistency
                  return { 
                      id: ensuredProperty.id,
                      tokenId: ensuredProperty.tokenId,
                      tokenAddress: ensuredProperty.tokenAddress,
                      metadata: ensuredProperty.metadata,
                      totalSupply: ensuredProperty.totalSupply,
                      balance: balance.toString() 
                  };
                }
              }
              return null; // Return null if no balance or contract error
            } catch (error) {
              // Log the specific error, including which property failed
              this.logger.error(`[fetchOwned] Error checking balance or upserting for property ${property.id} / token ${property.tokenAddress} for user ${address}: ${error.message}`);
              return null; // Return null on error for this specific property
            }
         })()
      );
    }
    
    const resolvedOwnedProperties = await Promise.all(ownedPropertiesPromises);
    const ownedProperties = resolvedOwnedProperties.filter(p => p !== null);
    
    this.logger.log(`Found ${ownedProperties.length} properties owned by ${address} from blockchain.`);
    return ownedProperties;
  }
  
  // Modified to delete from DB cache instead of updating expiry
  async invalidatePropertyCaches(nftAddress: string, tokenAddress: string, tokenId?: number): Promise<void> {
    // Removed skip log
    // return;
    /* Original logic: */ // Keep comment for context if needed
    try {
      // Delete from database cache
      const deleteResult = await this.cachedPropertyRepository.delete({ id: nftAddress });
      this.logger.log(`Deleted ${deleteResult.affected || 0} property entries from DB cache for NFT ${nftAddress}.`);
      
      // Invalidate Redis caches
      await this.cacheService.invalidatePropertyCache(nftAddress, tokenId); // Deletes specific property cache
      await this.cacheService.delete(`${this.cacheService['CACHE_KEYS'].PROPERTY_BY_TOKEN}${tokenAddress}`);
      await this.cacheService.delete(this.cacheService['CACHE_KEYS'].PROPERTIES_ALL); // Invalidate the 'all' list
      
      // Also delete related user balances from DB cache as the property is invalid/changed
      const balanceDeleteResult = await this.userPropertyBalanceRepository.delete({ propertyNftAddress: nftAddress });
       this.logger.log(`Deleted ${balanceDeleteResult.affected || 0} user balance entries from DB cache related to NFT ${nftAddress}.`);
       // Note: Redis user balances are invalidated by token transfer events or expire naturally.
       
      this.logger.log(`Invalidated all caches for property ${nftAddress} (Token: ${tokenAddress}, ID: ${tokenId})`);
    } catch (error) {
      this.logger.error(`Error invalidating property caches for ${nftAddress}: ${error.message}`);
    }
    // */ // Keep comment end for context if needed
  }

  // Modified to call populateInitialPropertyCache after clearing
  async resetAndRebuildCache(): Promise<void> {
    this.logger.log('Resetting and rebuilding property cache...');
    
    try {
      // Clear all related Redis caches
      await this.cacheService.reset(); // Use the CacheService reset method
      this.logger.log('Cleared all known Redis cache keys.');
      /* 
      await this.cacheService.delete(this.cacheService['CACHE_KEYS'].PROPERTIES_ALL);
      // Ideally, clear individual property keys too (requires knowing all IDs or using pattern matching in Redis)
      // Example (if Redis supports KEYS or SCAN): await this.cacheService.deletePattern(this.cacheService['CACHE_KEYS'].PROPERTY + '*');
      // Example: await this.cacheService.deletePattern(this.cacheService['CACHE_KEYS'].PROPERTY_BY_TOKEN + '*');
      // Example: await this.cacheService.deletePattern(this.cacheService['CACHE_KEYS'].USER_PROPERTIES + '*');
      // For simplicity without pattern matching: Resetting 'all' forces reload on next individual request.
      this.logger.warn('SKIPPING Redis cache clear during reset/rebuild.');
      */

      // Clear database tables
      await this.userPropertyBalanceRepository.clear(); // Clear dependent table first
      await this.cachedPropertyRepository.clear();    // Clear main table
      this.logger.log('Cleared user_property_balances and cached_properties DB tables.');
      // this.logger.warn('SKIPPING database cache clear during reset/rebuild.');
      
      // Fetch fresh data and populate Redis cache
      this.logger.log('Attempting to repopulate cache...');
      await this.populateInitialPropertyCache();
      
      this.logger.log('Property cache reset and rebuild completed.');
    } catch (error) {
      this.logger.error(`Error during property cache reset and rebuild: ${error.message}`);
      throw error; // Re-throw error so the controller can report failure
    }
  }
}

