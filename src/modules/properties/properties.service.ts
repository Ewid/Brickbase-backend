import { Injectable, Logger } from '@nestjs/common';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ethers, Contract, ZeroAddress } from 'ethers';
import { PropertyDto } from './dto/property.dto';
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
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);
  private ipfsGatewayUrl: string;

  constructor(
    private blockchainService: BlockchainService,
    private configService: ConfigService,
  ) {
    this.ipfsGatewayUrl = this.configService.get<string>('IPFS_GATEWAY_URL', 'https://ipfs.io/ipfs/');
    if (!this.ipfsGatewayUrl.endsWith('/')) {
        this.ipfsGatewayUrl += '/';
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

  // Updated formatProperty method to include tokenAddress from the registry
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

      return {
        id: propertyData.propertyNFT, // NFT contract address
        tokenId: tokenId,
        tokenAddress: tokenAddress, // Include the specific token address
        metadata: metadata,
        totalSupply: totalSupply.toString(),
      };
    } catch (error) {
      this.logger.error(`Error formatting property details for NFT ${propertyData.propertyNFT} (Token ID ${tokenId}): ${error.message}`);
      return null;
    }
  }

  // Modified to check for property tokens in registry directly
  async findAllProperties(): Promise<PropertyDto[]> {
    this.logger.log('Fetching all registered properties...');
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
          }
        } catch (error) {
          this.logger.error(`Error processing property at index ${i}: ${error.message}`);
        }
      }

      this.logger.log(`Successfully formatted ${allProperties.length} active properties.`);
      return allProperties;
    } catch (error) {
      this.logger.error(`Error in findAllProperties: ${error.message}`);
      return [];
    }
  }

  // Updated to accept tokenId as parameter
  async getPropertyDetails(nftAddress: string, tokenId?: number): Promise<PropertyDto | null> {
    this.logger.log(`Fetching details for property NFT address ${nftAddress}${tokenId !== undefined ? `, tokenId: ${tokenId}` : ''}`);
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

  // Updated NFT details lookup that uses the registry more directly
  async findNftDetailsByTokenAddress(tokenAddress: string): Promise<{ nftAddress: string; tokenId: number } | null> {
    this.logger.log(`Searching for NFT details associated with Token: ${tokenAddress}`);
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
      this.logger.error(`Error in findNftDetailsByTokenAddress for ${tokenAddress}: ${error.message}`);
      return null;
    }
  }

  // Get property by token address directly
  async getPropertyDetailsByTokenAddress(tokenAddress: string): Promise<PropertyDto | null> {
    this.logger.log(`Fetching property details by token address ${tokenAddress}`);
    
    // Find the NFT details for this token
    const nftDetails = await this.findNftDetailsByTokenAddress(tokenAddress);
    
    if (!nftDetails) {
      this.logger.warn(`No NFT details found for token address ${tokenAddress}`);
      return null;
    }
    
    // Get the property details using the NFT address and token ID
    return this.getPropertyDetails(nftDetails.nftAddress, nftDetails.tokenId);
  }

  async findPropertiesOwnedByUser(address: string): Promise<any[]> {
    this.logger.log(`Finding properties owned by ${address}`);
    const allProperties = await this.findAllProperties();
    const ownedProperties = [];
    
    for (const property of allProperties) {
      try {
        const tokenContract = this.blockchainService.getPropertyTokenByAddress(property.tokenAddress);
        if (tokenContract) {
          const balance = await tokenContract.balanceOf(address);
          if (balance > BigInt(0)) {
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
}

