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

  // Updated helper to accept tokenId
  private async formatProperty(propertyData: RegisteredProperty, tokenId: number): Promise<PropertyDto | null> {
    const propertyNFTContract = this.blockchainService.getContract('propertyNFT');
    const propertyTokenBase = this.blockchainService.getContract('propertyToken');

    if (!propertyNFTContract || !propertyTokenBase) {
      this.logger.error('NFT or Token contract instance not available for formatting');
      return null;
    }

    const tokenAddress = propertyData.propertyToken;
    if (!tokenAddress || tokenAddress === ZeroAddress) {
        this.logger.warn(`No associated token found for NFT ${propertyData.propertyNFT} in registry data.`);
        return null;
    }

    try {
      const tokenURI = await (propertyNFTContract as any).tokenURI(tokenId);
      const metadata = await this.fetchMetadata(tokenURI);
      const propertyTokenContract = propertyTokenBase.attach(tokenAddress);
      const totalSupply = await (propertyTokenContract as any).totalSupply();

      return {
        id: propertyData.propertyNFT, // NFT contract address
        tokenId: tokenId,
        metadata: metadata,
        totalSupply: totalSupply.toString(),
      };
    } catch (error) {
      this.logger.error(`Error formatting property details for NFT ${propertyData.propertyNFT} (Token ID ${tokenId}): ${error.message}`);
      return null;
    }
  }

  async findAllProperties(): Promise<PropertyDto[]> {
    this.logger.log('Fetching all registered properties...');
    const propertyRegistry = this.blockchainService.getContract('propertyRegistry');
    const propertyNFTBase = this.blockchainService.getContract('propertyNFT'); // Get the base ABI instance

    if (!propertyRegistry || !propertyNFTBase) {
      this.logger.error('PropertyRegistry or base PropertyNFT contract not available');
      return [];
    }

    try {
      const allRegisteredProps: RegisteredProperty[] = await (propertyRegistry as any).getAllProperties();
      this.logger.log(`Found ${allRegisteredProps.length} registered PropertyNFT contract(s) in registry.`);

      const allProperties: PropertyDto[] = [];

      // Iterate through each registered NFT contract address
      for (const propStruct of allRegisteredProps) {
        if (!propStruct.isActive) {
            this.logger.log(`Skipping inactive property registration: ${propStruct.propertyNFT}`);
            continue;
        }

        this.logger.log(`Processing registered NFT contract: ${propStruct.propertyNFT}`);
        const specificNftContract = propertyNFTBase.attach(propStruct.propertyNFT);
        let currentTokenId = 0;
        let owner;

        // Iterate through token IDs for this specific NFT contract
        while (true) {
          try {
            // Check if token exists by calling ownerOf
            owner = await (specificNftContract as any).ownerOf(currentTokenId);
            this.logger.debug(`Token ID ${currentTokenId} exists for NFT ${propStruct.propertyNFT}, owned by ${owner}. Formatting...`);

            // If ownerOf succeeds, format the property details for this tokenId
            const formattedProperty = await this.formatProperty(propStruct, currentTokenId);
            if (formattedProperty) {
              allProperties.push(formattedProperty);
            }
            currentTokenId++;
          } catch (error) {
            // Assuming error means tokenId does not exist (standard ERC721 behavior)
            if (error.code === 'CALL_EXCEPTION') { // Ethers v6 specific error code for reverted call
                this.logger.debug(`Token ID ${currentTokenId} does not exist for NFT ${propStruct.propertyNFT}. Stopping iteration for this contract.`);
                break; // Exit the while loop for this contract
            } else {
                 this.logger.error(`Unexpected error checking ownerOf(${currentTokenId}) for NFT ${propStruct.propertyNFT}: ${error.message}`);
                 break; // Exit loop on unexpected errors too
            }
          }
        }
      }

      this.logger.log(`Formatted ${allProperties.length} total active property tokens.`);
      return allProperties;
    } catch (error) {
        this.logger.error(`Error in findAllProperties: ${error.message}`);
        return [];
    }
  }

  async getPropertyDetails(nftAddress: string): Promise<PropertyDto | null> {
    this.logger.log(`Fetching details for specific property NFT address ${nftAddress}...`);
    const propertyRegistry = this.blockchainService.getContract('propertyRegistry');

    if (!propertyRegistry) {
        this.logger.error('PropertyRegistry contract not available from BlockchainService');
        return null;
    }

    try {
        const indexBigInt: bigint = await (propertyRegistry as any).propertyIndex(nftAddress);
        const registryIndex = Number(indexBigInt);

        if (registryIndex === 0) {
            this.logger.warn(`Property NFT address ${nftAddress} not found in registry index.`);
            return null;
        }

        const likelyTokenId = registryIndex - 1;
        const propertyData: RegisteredProperty = await (propertyRegistry as any).registeredProperties(likelyTokenId);

        if (!propertyData || propertyData.propertyNFT.toLowerCase() !== nftAddress.toLowerCase() || !propertyData.isActive) {
             this.logger.warn(`Property data mismatch or inactive for NFT address ${nftAddress} at index ${likelyTokenId}.`);
             return null;
        }

        return this.formatProperty(propertyData, likelyTokenId);

    } catch (error) {
        this.logger.error(`Error fetching details for NFT ${nftAddress}: ${error.message}`);
        return null;
    }
  }

  // New method to find NFT details by PropertyToken address
  async findNftDetailsByTokenAddress(tokenAddress: string): Promise<{ nftAddress: string; tokenId: number } | null> {
    this.logger.log(`Searching for NFT details associated with Token: ${tokenAddress}`);
    const propertyRegistry = this.blockchainService.getContract('propertyRegistry');
    const propertyNFTBase = this.blockchainService.getContract('propertyNFT'); // Base ABI

    if (!propertyRegistry || !propertyNFTBase) {
      this.logger.error('PropertyRegistry or base PropertyNFT contract not available for NFT detail lookup.');
      return null;
    }

    try {
      // 1. Find the RegisteredProperty struct that contains this tokenAddress
      // Note: This requires iterating through all registered properties in the registry
      // This could be inefficient if the registry grows very large.
      // Consider adding a mapping (tokenAddress => nftAddress) in the registry contract if performance becomes an issue.
      const allRegisteredProps: RegisteredProperty[] = await (propertyRegistry as any).getAllProperties();
      let foundNftAddress: string | null = null;

      for (const propStruct of allRegisteredProps) {
        if (propStruct.isActive && propStruct.propertyToken.toLowerCase() === tokenAddress.toLowerCase()) {
          foundNftAddress = propStruct.propertyNFT;
          this.logger.debug(`Found matching active NFT contract in registry: ${foundNftAddress}`);
          break;
        }
      }

      if (!foundNftAddress) {
        this.logger.warn(`No active NFT contract found in registry associated with Token: ${tokenAddress}`);
        return null;
      }

      // 2. Query the specific PropertyNFT contract to find the tokenId
      const specificNftContract = propertyNFTBase.attach(foundNftAddress);
      let currentTokenId = 0;
      while (true) {
        try {
          // Call the public 'properties' mapping getter
          const details: PropertyDetailsFromContract = await (specificNftContract as any).properties(currentTokenId);

          // Check if the propertyToken in the details matches our target tokenAddress
          if (details.propertyToken.toLowerCase() === tokenAddress.toLowerCase()) {
            this.logger.log(`Found matching Token ID ${currentTokenId} on NFT contract ${foundNftAddress} for Token ${tokenAddress}`);
            // Verify token existence by checking owner (optional but good practice)
            try {
                await (specificNftContract as any).ownerOf(currentTokenId);
                return { nftAddress: foundNftAddress, tokenId: currentTokenId };
            } catch (ownerError) {
                 this.logger.warn(`Token ID ${currentTokenId} found in properties mapping but ownerOf failed. Skipping. Error: ${ownerError.message}`);
                 // Continue searching other token IDs if owner check fails
            }
          }
          currentTokenId++;
        } catch (error) {
          // Error likely means tokenId does not exist in the 'properties' mapping or contract call failed
          if (error.code === 'CALL_EXCEPTION' || error.message?.includes('invalid token ID')) { // Adjust error checking as needed for your specific provider/contract version
             this.logger.debug(`Stopped searching token IDs for NFT ${foundNftAddress} at index ${currentTokenId}. Reason: ${error.message}`);
             break; // Stop searching this NFT contract
          } else {
            this.logger.error(`Unexpected error querying properties(${currentTokenId}) on NFT ${foundNftAddress}: ${error.message}`);
            break; // Stop on unexpected errors
          }
        }
      }

      this.logger.warn(`Could not find a specific Token ID on NFT ${foundNftAddress} matching Token ${tokenAddress}`);
      return null; // Token ID not found for this token address on the associated NFT contract

    } catch (error) {
      this.logger.error(`Error in findNftDetailsByTokenAddress for ${tokenAddress}: ${error.message}`);
      return null;
    }
  }
}
