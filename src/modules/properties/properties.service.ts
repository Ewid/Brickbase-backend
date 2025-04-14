import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, MoreThan } from 'typeorm';
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
  
  onModuleInit() {
    this.listenToPropertyEvents();
    this.setupCacheCleanup();
    
    this.logger.log('PropertiesService initialized with blockchain event listeners');
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
      
      // Invalidate the all properties cache
      await this.cacheService.delete(this.cacheService['CACHE_KEYS'].PROPERTIES_ALL);
      this.logger.log('Invalidated properties list cache due to new property registration');
    });
    
    // Listen for property status changes (active/inactive)
    propertyRegistry.on('PropertyStatusChanged', async (propertyNftAddress, isActive, event: EventLog) => {
      this.logger.log(`PropertyStatusChanged event: NFT=${propertyNftAddress}, isActive=${isActive}`);
      
      try {
        // Find the property in cache
        const cachedProperty = await this.cachedPropertyRepository.findOne({
          where: { id: propertyNftAddress },
        });
        
        if (cachedProperty) {
          await this.invalidatePropertyCaches(
            propertyNftAddress, 
            cachedProperty.tokenAddress, 
            cachedProperty.tokenId
          );
        }
        
        // Always invalidate the all properties cache
        await this.cacheService.delete(this.cacheService['CACHE_KEYS'].PROPERTIES_ALL);
        
        this.logger.log(`Invalidated caches for property ${propertyNftAddress} due to status change`);
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
        
        // Find the property in cache by tokenId
        const cachedProperty = await this.cachedPropertyRepository.findOne({
          where: { tokenId: tokenIdNum },
        });
        
        if (cachedProperty) {
          await this.invalidatePropertyCaches(
            cachedProperty.id, 
            cachedProperty.tokenAddress, 
            tokenIdNum
          );
          
          this.logger.log(`Invalidated caches for property with tokenId ${tokenId} due to metadata update`);
        }
      } catch (error) {
        this.logger.error(`Error handling MetadataUpdate event: ${error.message}`);
      }
    });
    
    // Listen for NFT transfers (although these should be rare in this system)
    propertyNFT.on('Transfer', async (from, to, tokenId, event: EventLog) => {
      this.logger.log(`NFT Transfer event: tokenId=${tokenId}, from=${from}, to=${to}`);
      
      try {
        // Find the property in cache by tokenId
        const cachedProperty = await this.cachedPropertyRepository.findOne({
          where: { tokenId: Number(tokenId) },
        });
        
        if (cachedProperty) {
          await this.invalidatePropertyCaches(
            cachedProperty.id, 
            cachedProperty.tokenAddress, 
            Number(tokenId)
          );
          
          this.logger.log(`Invalidated caches for property with tokenId ${tokenId} due to NFT transfer`);
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
          // Get property details for this token
          const property = await this.cachedPropertyRepository.findOne({
            where: { tokenAddress },
          });
          
          // For non-zero addresses, invalidate the user's property cache
          if (from !== ZeroAddress) {
            await this.cacheService.delete(`${this.cacheService['CACHE_KEYS'].USER_PROPERTIES}${from}`);
            
            // Clear database cache
            await this.userPropertyBalanceRepository.delete({
              userAddress: from,
              propertyTokenAddress: tokenAddress,
            });
            
            this.logger.log(`Invalidated property balance cache for user ${from}`);
          }
          
          if (to !== ZeroAddress) {
            await this.cacheService.delete(`${this.cacheService['CACHE_KEYS'].USER_PROPERTIES}${to}`);
            
            // Clear database cache
            await this.userPropertyBalanceRepository.delete({
              userAddress: to,
              propertyTokenAddress: tokenAddress,
            });
            
            this.logger.log(`Invalidated property balance cache for user ${to}`);
          }
          
          // Update property total supply in cache if it changes significantly
          if (property && (from === ZeroAddress || to === ZeroAddress)) {
            // If tokens were minted or burned, total supply changed
            await this.invalidatePropertyCaches(
              property.id,
              property.tokenAddress,
              property.tokenId
            );
            
            this.logger.log(`Invalidated property cache for ${property.id} due to supply change`);
          }
        } catch (error) {
          this.logger.error(`Error handling token transfer event: ${error.message}`);
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

  // Modified formatProperty to save to cache
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

      // Save to database cache
      await this.saveToCachedProperties(propertyDto);
      
      // Save to Redis cache
      await this.cacheService.setProperty(propertyDto.id, propertyDto, propertyDto.tokenId);
      await this.cacheService.setPropertyByToken(propertyDto.tokenAddress, propertyDto);
      
      return propertyDto;
    } catch (error) {
      this.logger.error(`Error formatting property details for NFT ${propertyData.propertyNFT} (Token ID ${tokenId}): ${error.message}`);
      return null;
    }
  }

  // New method to save data to cache
  private async saveToCachedProperties(propertyDto: PropertyDto): Promise<void> {
    try {
      const cachedProperty = new CachedProperty();
      cachedProperty.id = propertyDto.id;
      cachedProperty.tokenId = propertyDto.tokenId;
      cachedProperty.tokenAddress = propertyDto.tokenAddress;
      cachedProperty.metadata = propertyDto.metadata;
      cachedProperty.totalSupply = propertyDto.totalSupply;
      cachedProperty.isActive = true; // Explicitly set isActive to true
      cachedProperty.expiresAt = new Date(Date.now() + 3600000); // 1 hour TTL
      
      await this.cachedPropertyRepository.save(cachedProperty);
      this.logger.log(`Cached property data for NFT ${propertyDto.id}, Token ID ${propertyDto.tokenId}, isActive: true`);
    } catch (error) {
      this.logger.error(`Error caching property data: ${error.message}`);
    }
  }

  // Modified to check Redis cache first
  async findAllProperties(): Promise<PropertyDto[]> {
    this.logger.log('Fetching all properties...');
    
    try {
      // Check Redis cache first
      const redisCache = await this.cacheService.getAllProperties();
      this.logger.log(`Cache read attempt: found ${redisCache?.length || 0} properties`);
      if (redisCache && redisCache.length > 1) {
        this.logger.log(`Returning ${redisCache.length} properties from Redis cache.`);
        return redisCache;
      }
      
      // Check database cache
      const cachedProperties = await this.cachedPropertyRepository.find({
        where: {
          isActive: true,
          expiresAt: MoreThan(new Date()),
        },
      });
      
      if (cachedProperties.length > 0) {
        this.logger.log(`Returning ${cachedProperties.length} properties from database cache.`);
        const properties = cachedProperties.map(cp => ({
          id: cp.id,
          tokenId: cp.tokenId,
          tokenAddress: cp.tokenAddress,
          metadata: cp.metadata,
          totalSupply: cp.totalSupply,
        }));
        
        // Update Redis cache
        await this.cacheService.setAllProperties(properties);
        
        return properties;
      }
      
      // Cache miss or not enough properties, fetch from blockchain
      this.logger.log('Not enough properties in cache, fetching from blockchain...');
      const properties = await this.fetchAllPropertiesFromBlockchain();
      
      // Update Redis cache
      if (properties.length > 0) {
        await this.cacheService.setAllProperties(properties);
      }
      
      return properties;
    } catch (error) {
      this.logger.error(`Error in findAllProperties: ${error.message}`);
      return this.fetchAllPropertiesFromBlockchain(); // Fallback to blockchain
    }
  }
  
  // New method to fetch all properties from blockchain
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

      const allProperties: PropertyDto[] = [];

      // For each property in the registry, get its details
      for (let i = 0; i < allRegisteredProps.length; i++) {
        const propStruct = allRegisteredProps[i];
        
        this.logger.log(`Property at index ${i}: NFT=${propStruct.propertyNFT}, Token=${propStruct.propertyToken}, isActive=${propStruct.isActive}`);
        
        if (!propStruct.isActive) {
          this.logger.log(`Skipping inactive property registration at index ${i}`);
          continue;
        }

        this.logger.log(`Processing property at index ${i}: NFT ${propStruct.propertyNFT}, Token ${propStruct.propertyToken}`);
        
        try {
          // The tokenId is the index in the registry
          const formattedProperty = await this.formatProperty(propStruct, i);
          if (formattedProperty) {
            allProperties.push(formattedProperty);
            this.logger.log(`Added property to results: NFT=${formattedProperty.id}, tokenId=${formattedProperty.tokenId}`);
          } else {
            this.logger.warn(`Property at index ${i} could not be formatted, skipping`);
          }
        } catch (error) {
          this.logger.error(`Error processing property at index ${i}: ${error.message}`);
        }
      }

      this.logger.log(`Successfully formatted ${allProperties.length} active properties.`);
      return allProperties;
    } catch (error) {
      this.logger.error(`Error in fetchAllPropertiesFromBlockchain: ${error.message}`);
      return [];
    }
  }

  // Modified to check Redis cache first
  async getPropertyDetails(nftAddress: string, tokenId?: number): Promise<PropertyDto | null> {
    this.logger.log(`Fetching details for property NFT address ${nftAddress}${tokenId !== undefined ? `, tokenId: ${tokenId}` : ''}`);
    
    try {
      // Try to get from Redis cache first
      const redisCache = await this.cacheService.getProperty(nftAddress, tokenId);
      if (redisCache) {
        this.logger.log(`Redis cache hit for property NFT ${nftAddress}`);
        return redisCache;
      }
      
      // Try to get from database cache
      const cacheQuery: any = { 
        id: nftAddress, 
        isActive: true,
        expiresAt: MoreThan(new Date())
      };
      if (tokenId !== undefined) {
        cacheQuery.tokenId = tokenId;
      }
      
      const cachedProperty = await this.cachedPropertyRepository.findOne({
        where: cacheQuery,
      });
      
      if (cachedProperty) {
        this.logger.log(`Database cache hit for property NFT ${nftAddress}`);
        const property = {
          id: cachedProperty.id,
          tokenId: cachedProperty.tokenId,
          tokenAddress: cachedProperty.tokenAddress,
          metadata: cachedProperty.metadata,
          totalSupply: cachedProperty.totalSupply,
        };
        
        // Update Redis cache
        await this.cacheService.setProperty(nftAddress, property, tokenId);
        
        return property;
      }
      
      // Cache miss or expired, fetch from blockchain
      this.logger.log(`Cache miss for property NFT ${nftAddress}, fetching from blockchain...`);
      const property = await this.fetchPropertyDetailsFromBlockchain(nftAddress, tokenId);
      
      // Update Redis cache if property was found
      if (property) {
        await this.cacheService.setProperty(nftAddress, property, tokenId);
      }
      
      return property;
    } catch (error) {
      this.logger.error(`Error checking cache for NFT ${nftAddress}: ${error.message}`);
      return this.fetchPropertyDetailsFromBlockchain(nftAddress, tokenId);
    }
  }
  
  // New method to fetch property details from blockchain
  private async fetchPropertyDetailsFromBlockchain(nftAddress: string, tokenId?: number): Promise<PropertyDto | null> {
    const propertyRegistry = this.blockchainService.getContract('propertyRegistry');

    if (!propertyRegistry) {
      this.logger.error('PropertyRegistry contract not available');
      return null;
    }

    try {
      // If tokenId is not provided, try to find it from the registry
      if (tokenId === undefined) {
        const indexBigInt: bigint = await (propertyRegistry as any).propertyIndex(nftAddress);
        tokenId = Number(indexBigInt) - 1;
        
        if (tokenId < 0) {
          this.logger.warn(`Property NFT address ${nftAddress} not found in registry index.`);
          return null;
        }
      }

      // Get the property data from the registry
      const propertyData: RegisteredProperty = await (propertyRegistry as any).registeredProperties(tokenId);

      if (!propertyData || propertyData.propertyNFT.toLowerCase() !== nftAddress.toLowerCase() || !propertyData.isActive) {
        this.logger.warn(`Property data mismatch or inactive for NFT address ${nftAddress} at index ${tokenId}.`);
        return null;
      }

      return this.formatProperty(propertyData, tokenId);
    } catch (error) {
      this.logger.error(`Error fetching details for NFT ${nftAddress}: ${error.message}`);
      return null;
    }
  }

  // Modified to use Redis cache for NFT lookups
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
      
      // Check database cache
      const cachedProperty = await this.cachedPropertyRepository.findOne({
        where: { tokenAddress, isActive: true, expiresAt: MoreThan(new Date()) },
      });
      
      if (cachedProperty) {
        this.logger.log(`Database cache hit for token ${tokenAddress}`);
        
        // Update Redis cache
        await this.cacheService.setPropertyByToken(tokenAddress, {
          id: cachedProperty.id,
          tokenId: cachedProperty.tokenId,
          tokenAddress: cachedProperty.tokenAddress,
          metadata: cachedProperty.metadata,
          totalSupply: cachedProperty.totalSupply,
        });
        
        return {
          nftAddress: cachedProperty.id,
          tokenId: cachedProperty.tokenId,
        };
      }
      
      // Cache miss, fetch from blockchain
      this.logger.log(`Cache miss for token ${tokenAddress}, fetching from blockchain...`);
      const nftDetails = await this.findNftDetailsByTokenAddressFromBlockchain(tokenAddress);
      
      // If found, we'll update the Redis cache when we fetch the full property details
      
      return nftDetails;
    } catch (error) {
      this.logger.error(`Error checking cache for token ${tokenAddress}: ${error.message}`);
      return this.findNftDetailsByTokenAddressFromBlockchain(tokenAddress);
    }
  }
  
  // New method to find NFT details by token address from blockchain
  private async findNftDetailsByTokenAddressFromBlockchain(tokenAddress: string): Promise<{ nftAddress: string; tokenId: number } | null> {
    const propertyRegistry = this.blockchainService.getContract('propertyRegistry');

    if (!propertyRegistry) {
      this.logger.error('PropertyRegistry contract not available for NFT detail lookup.');
      return null;
    }

    try {
      // Get mapping from token to property directly from the registry if available
      try {
        // This would be ideal if your registry has this function
        const propertyInfo = await (propertyRegistry as any).getPropertyByToken(tokenAddress);
        if (propertyInfo && propertyInfo.propertyNFT && propertyInfo.propertyNFT !== ZeroAddress) {
          this.logger.log(`Found property directly for token ${tokenAddress}: NFT ${propertyInfo.propertyNFT}, tokenId ${propertyInfo.tokenId}`);
          return { 
            nftAddress: propertyInfo.propertyNFT, 
            tokenId: Number(propertyInfo.tokenId) 
          };
        }
      } catch (directLookupError) {
        // If direct lookup isn't available, fall back to iteration
        this.logger.debug(`Direct property lookup not available, falling back to iteration: ${directLookupError.message}`);
      }

      // Fallback: Iterate through all registered properties
      const allRegisteredProps: RegisteredProperty[] = await (propertyRegistry as any).getAllProperties();
      
      for (let i = 0; i < allRegisteredProps.length; i++) {
        const propStruct = allRegisteredProps[i];
        
        if (propStruct.isActive && propStruct.propertyToken.toLowerCase() === tokenAddress.toLowerCase()) {
          this.logger.debug(`Found matching NFT address ${propStruct.propertyNFT} at index ${i} for token ${tokenAddress}`);
          return { nftAddress: propStruct.propertyNFT, tokenId: i };
        }
      }

      this.logger.warn(`No matching property found for token address ${tokenAddress}`);
      return null;
    } catch (error) {
      this.logger.error(`Error in findNftDetailsByTokenAddressFromBlockchain for ${tokenAddress}: ${error.message}`);
      return null;
    }
  }

  // Modified to use Redis cache for token address lookups
  async getPropertyDetailsByTokenAddress(tokenAddress: string): Promise<PropertyDto | null> {
    this.logger.log(`Fetching property details by token address ${tokenAddress}`);
    
    try {
      // Check Redis cache first
      const redisCache = await this.cacheService.getPropertyByToken(tokenAddress);
      if (redisCache) {
        this.logger.log(`Redis cache hit for token address ${tokenAddress}`);
        return redisCache;
      }
      
      // Check database cache
      const cachedProperty = await this.cachedPropertyRepository.findOne({
        where: { tokenAddress, isActive: true, expiresAt: MoreThan(new Date()) },
      });
      
      if (cachedProperty) {
        this.logger.log(`Database cache hit for token address ${tokenAddress}`);
        const property = {
          id: cachedProperty.id,
          tokenId: cachedProperty.tokenId,
          tokenAddress: cachedProperty.tokenAddress,
          metadata: cachedProperty.metadata,
          totalSupply: cachedProperty.totalSupply,
        };
        
        // Update Redis cache
        await this.cacheService.setPropertyByToken(tokenAddress, property);
        
        return property;
      }
      
      // Cache miss, fetch from blockchain
      this.logger.log(`Cache miss for token address ${tokenAddress}, fetching from blockchain...`);
      
      // Find the NFT details for this token
      const nftDetails = await this.findNftDetailsByTokenAddressFromBlockchain(tokenAddress);
      
      if (!nftDetails) {
        this.logger.warn(`No NFT details found for token address ${tokenAddress}`);
        return null;
      }
      
      // Get the property details using the NFT address and token ID
      const property = await this.fetchPropertyDetailsFromBlockchain(nftDetails.nftAddress, nftDetails.tokenId);
      
      // Update Redis cache if property was found
      if (property) {
        await this.cacheService.setPropertyByToken(tokenAddress, property);
      }
      
      return property;
    } catch (error) {
      this.logger.error(`Error in getPropertyDetailsByTokenAddress for ${tokenAddress}: ${error.message}`);
      return null;
    }
  }

  // Modified to use Redis cache for user property balances
  async findPropertiesOwnedByUser(address: string): Promise<any[]> {
    this.logger.log(`Finding properties owned by ${address}`);
    
    try {
      // Check Redis cache first
      const redisCache = await this.cacheService.getUserProperties(address);
      if (redisCache && redisCache.length > 0) {
        this.logger.log(`Redis cache hit for user ${address} properties`);
        return redisCache;
      }
      
      // Check database cache - fix the relation issue
      const cachedBalances = await this.userPropertyBalanceRepository.find({
        where: { 
          userAddress: address,
          expiresAt: MoreThan(new Date()),
        },
        relations: { cachedProperty: true },
      });
      
      if (cachedBalances.length > 0) {
        this.logger.log(`Found ${cachedBalances.length} cached balances for user ${address}`);
        
        // Map balances to properties using the relation
        const userProperties = cachedBalances
          .filter(balance => balance.cachedProperty) // Ensure property exists
          .map(balance => ({
            id: balance.propertyNftAddress,
            tokenId: balance.tokenId,
            tokenAddress: balance.propertyTokenAddress,
            metadata: balance.cachedProperty.metadata,
            totalSupply: balance.cachedProperty.totalSupply,
            balance: balance.balance,
          }));
        
        if (userProperties.length > 0) {
          // Update Redis cache
          await this.cacheService.setUserProperties(address, userProperties);
          return userProperties;
        }
      }
      
      // Cache miss, fetch from blockchain
      this.logger.log(`Cache miss for user ${address} balances, fetching from blockchain...`);
      const userProperties = await this.fetchPropertiesOwnedByUserFromBlockchain(address);
      
      // Update Redis cache
      if (userProperties.length > 0) {
        await this.cacheService.setUserProperties(address, userProperties);
      }
      
      return userProperties;
    } catch (error) {
      this.logger.error(`Error checking cache for user ${address} balances: ${error.message}`);
      return this.fetchPropertiesOwnedByUserFromBlockchain(address);
    }
  }
  
  // New method to fetch user-owned properties from blockchain
  private async fetchPropertiesOwnedByUserFromBlockchain(address: string): Promise<any[]> {
    const allProperties = await this.findAllProperties();
    const ownedProperties = [];
    
    for (const property of allProperties) {
      try {
        const tokenContract = this.blockchainService.getPropertyTokenByAddress(property.tokenAddress);
        if (tokenContract) {
          const balance = await tokenContract.balanceOf(address);
          if (balance > BigInt(0)) {
            // Save to cache
            const userBalance = new UserPropertyBalance();
            userBalance.userAddress = address;
            userBalance.propertyTokenAddress = property.tokenAddress;
            userBalance.propertyNftAddress = property.id;
            userBalance.tokenId = property.tokenId;
            userBalance.balance = balance.toString();
            userBalance.expiresAt = new Date(Date.now() + 900000); // 15 minutes TTL
            
            await this.userPropertyBalanceRepository.save(userBalance);
            
            ownedProperties.push({
              ...property,
              balance: balance.toString()
            });
          }
        }
      } catch (error) {
        this.logger.error(`Error checking balance for property ${property.id}: ${error.message}`);
      }
    }
    
    return ownedProperties;
  }
  
  // Cache cleanup method
  private setupCacheCleanup() {
    const cleanupInterval = 3600000; // 1 hour
    
    setInterval(async () => {
      this.logger.log('Running cache cleanup...');
      
      try {
        // Delete expired property cache entries
        const expiredPropertiesResult = await this.cachedPropertyRepository.delete({
          expiresAt: LessThan(new Date()), // Keep LessThan for cleanup
        });
        
        // Delete expired user balance cache entries
        const expiredBalancesResult = await this.userPropertyBalanceRepository.delete({
          expiresAt: LessThan(new Date()), // Keep LessThan for cleanup
        });
        
        this.logger.log(`Cleaned up ${expiredPropertiesResult.affected || 0} expired property entries and ${expiredBalancesResult.affected || 0} expired balance entries.`);
      } catch (error) {
        this.logger.error(`Error during cache cleanup: ${error.message}`);
      }
    }, cleanupInterval);
  }

  // When a property is updated, invalidate caches
  async invalidatePropertyCaches(nftAddress: string, tokenAddress: string, tokenId?: number): Promise<void> {
    try {
      // Invalidate database cache
      await this.cachedPropertyRepository.update(
        { id: nftAddress },
        { expiresAt: new Date(Date.now() - 1000) } // Expired 1 second ago
      );
      
      // Invalidate Redis cache
      await this.cacheService.invalidatePropertyCache(nftAddress, tokenId);
      await this.cacheService.delete(`${this.cacheService['CACHE_KEYS'].PROPERTY_BY_TOKEN}${tokenAddress}`);
      await this.cacheService.delete(this.cacheService['CACHE_KEYS'].PROPERTIES_ALL);
      
      this.logger.log(`Invalidated caches for property ${nftAddress} with token ${tokenAddress}`);
    } catch (error) {
      this.logger.error(`Error invalidating property caches: ${error.message}`);
    }
  }

  async resetAndRebuildCache(): Promise<void> {
    this.logger.log('Resetting and rebuilding property cache...');
    
    try {
      // Clear Redis caches
      await this.cacheService.delete(this.cacheService['CACHE_KEYS'].PROPERTIES_ALL);
      
      // First delete records from the dependent table (UserPropertyBalance)
      await this.userPropertyBalanceRepository.delete({});
      
      // Then delete records from the main table (CachedProperty)
      await this.cachedPropertyRepository.delete({});
      
      // Fetch fresh data from blockchain
      const properties = await this.fetchAllPropertiesFromBlockchain();
      
      this.logger.log(`Fetched ${properties.length} properties from blockchain for cache rebuild`);
      
      // Update Redis cache
      await this.cacheService.setAllProperties(properties);
      
      this.logger.log('Cache rebuild completed successfully');
    } catch (error) {
      this.logger.error(`Error during cache rebuild: ${error.message}`);
    }
  }
}

