import { Injectable, Logger } from '@nestjs/common';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ethers, Contract } from 'ethers';
import { PropertyDto } from './dto/property.dto'; // Import DTO
import axios from 'axios'; // For fetching metadata

@Injectable()
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);

  constructor(private blockchainService: BlockchainService) {
    // REMOVE constructor initialization of contracts
    // this.propertyRegistry = this.blockchainService.getContract('propertyRegistry');
    // this.propertyNFT = this.blockchainService.getContract('propertyNFT');
    // this.propertyToken = this.blockchainService.getContract('propertyToken');
  }

  // Helper to fetch metadata (simple implementation)
  private async fetchMetadata(uri: string): Promise<any> {
    if (!uri) return {};
    // Basic handling for IPFS URIs (replace with your IPFS gateway)
    const gatewayUri = uri.replace('ipfs://', 'https://ipfs.io/ipfs/');
    try {
      const response = await axios.get(gatewayUri);
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to fetch metadata from ${gatewayUri}: ${error.message}`);
      return {};
    }
  }

  // Helper to format raw contract property data into DTO
  private async formatProperty(nftId: string, propertyNFT: Contract, propertyRegistry: Contract, propertyTokenBase: Contract): Promise<PropertyDto | null> {
    try {
      const tokenURI = await propertyNFT.tokenURI(nftId);
      const metadata = await this.fetchMetadata(tokenURI);
      const tokenAddress = await propertyRegistry.getTokenForNFT(nftId); // Assumes this function exists
      if (!tokenAddress || tokenAddress === ethers.ZeroAddress) {
        this.logger.warn(`No associated token found for NFT ${nftId}`);
        return null; // Or return partial data
      }
      const propertyTokenContract = propertyTokenBase.attach(tokenAddress);
      // Use type assertion to bypass TypeScript check for dynamically added methods
      const totalSupply = await (propertyTokenContract as any).totalSupply();

      return {
        id: nftId,
        metadata: metadata,
        totalSupply: totalSupply.toString(),
      };
    } catch (error) {
      this.logger.error(`Error formatting property details for ${nftId}: ${error.message}`);
      return null;
    }
  }

  async findAllProperties(): Promise<PropertyDto[]> {
    this.logger.log('Fetching all properties...');
    const propertyRegistry = this.blockchainService.getContract('propertyRegistry');
    const propertyNFT = this.blockchainService.getContract('propertyNFT');
    const propertyTokenBase = this.blockchainService.getContract('propertyToken');

    if (!propertyRegistry || !propertyNFT || !propertyTokenBase) {
      this.logger.error('Required contracts not available from BlockchainService for findAllProperties');
      return [];
    }
    try {
      // **ASSUMPTION**: PropertyRegistry has a function `getAllRegisteredNFTs()` that returns an array of NFT IDs (strings)
      const propertyIds: string[] = await propertyRegistry.getAllRegisteredNFTs();
      this.logger.log(`Found ${propertyIds.length} registered properties.`);

      const propertiesPromises = propertyIds.map(id => this.formatProperty(id, propertyNFT, propertyRegistry, propertyTokenBase));
      const properties = (await Promise.all(propertiesPromises)).filter(p => p !== null) as PropertyDto[];

      return properties;
    } catch (error) {
        this.logger.error(`Error fetching properties from contract: ${error.message}`);
        return [];
    }
  }

  async getPropertyDetails(propertyId: string): Promise<PropertyDto | null> {
    this.logger.log(`Fetching details for property ${propertyId}...`);
    const propertyNFT = this.blockchainService.getContract('propertyNFT');
    const propertyTokenBase = this.blockchainService.getContract('propertyToken');
    const propertyRegistry = this.blockchainService.getContract('propertyRegistry');

    if (!propertyNFT || !propertyTokenBase || !propertyRegistry) {
        this.logger.error('Required contracts not available from BlockchainService for getPropertyDetails');
        return null;
    }

    return this.formatProperty(propertyId, propertyNFT, propertyRegistry, propertyTokenBase);
  }
}
