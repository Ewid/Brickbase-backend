import { Injectable, Logger } from '@nestjs/common';
import { BlockchainService } from '../blockchain/blockchain.service';
import { Contract } from 'ethers';

@Injectable()
export class RentService {
  private readonly logger = new Logger(RentService.name);
  private rentDistribution: Contract;

  constructor(private blockchainService: BlockchainService) {
      this.rentDistribution = this.blockchainService.getContract('rentDistribution');
  }

  async getClaimableRent(userAddress: string, propertyTokenAddress: string): Promise<string> { // Returns BigNumber string
    this.logger.log(`Fetching claimable rent for ${userAddress} on token ${propertyTokenAddress}...`);
     if (!this.rentDistribution) {
        this.logger.error('RentDistribution contract not initialized');
        return '0';
     }
    // Example: Call contract
    // const claimable = await this.rentDistribution.claimableRent(propertyTokenAddress, userAddress);
    // return claimable.toString();
    return '0'; // Placeholder
  }

  // TODO: Consider adding an admin method for depositing rent
  // async depositRent(propertyTokenAddress: string, amount: string): Promise<void> { ... }
  // Requires careful security considerations (admin roles, etc.)
} 