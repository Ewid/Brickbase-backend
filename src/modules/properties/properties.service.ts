import { Injectable, Logger } from '@nestjs/common';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ethers, Contract, ZeroAddress } from 'ethers';
import { PropertyDto } from './dto/property.dto';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';

// Define an interface matching the RegisteredProperty struct
interface RegisteredProperty {
  propertyNFT: string;
  propertyToken: string;
  isActive: boolean;
  registrationDate: bigint; // Use bigint for uint256
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

    if (!propertyRegistry) {
      this.logger.error('PropertyRegistry contract not available from BlockchainService');
      return [];
    }

    try {
      const allRegisteredProps: RegisteredProperty[] = await (propertyRegistry as any).getAllProperties();
      this.logger.log(`Found ${allRegisteredProps.length} total registered properties in registry.`);

      const propertiesPromises = allRegisteredProps.map((propStruct, index) => {
          if (propStruct.isActive) {
              return this.formatProperty(propStruct, index);
          } else {
              return Promise.resolve(null);
          }
      });

      const properties = (await Promise.all(propertiesPromises)).filter(p => p !== null) as PropertyDto[];
      this.logger.log(`Formatted ${properties.length} active properties.`);
      return properties;
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
}
