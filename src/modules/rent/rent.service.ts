import { Injectable, Logger } from '@nestjs/common';
import { BlockchainService } from '../blockchain/blockchain.service';
import { Contract } from 'ethers';

@Injectable()
export class RentService {
  private readonly logger = new Logger(RentService.name);

  constructor(private blockchainService: BlockchainService) {
  }

  async getClaimableRent(userAddress: string, propertyTokenAddress: string): Promise<string> { // Returns BigNumber string
    this.logger.log(`Fetching claimable rent for ${userAddress} on token ${propertyTokenAddress}...`);
    const rentDistribution = this.blockchainService.getContract('rentDistribution');

     if (!rentDistribution) {
        this.logger.error('RentDistribution contract not available from BlockchainService');
        return '0';
     }
    try {
        // Example: Call contract
        // const claimable = await rentDistribution.claimableRent(propertyTokenAddress, userAddress);
        // return claimable.toString();
        return '0'; // Placeholder
    } catch (error) {
        this.logger.error(`Error fetching claimable rent: ${error.message}`);
        return '0';
    }
  }

  // TODO: Consider adding an admin method for depositing rent
  // async depositRent(propertyTokenAddress: string, amount: string): Promise<void> { ... }
  // Requires careful security considerations (admin roles, etc.)
} 