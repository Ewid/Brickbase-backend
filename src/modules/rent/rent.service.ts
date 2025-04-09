import { Injectable, Logger } from '@nestjs/common';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ethers, Contract } from 'ethers';

@Injectable()
export class RentService {
  private readonly logger = new Logger(RentService.name);

  constructor(private blockchainService: BlockchainService) {
  }

  async getClaimableRent(userAddress: string, propertyTokenAddress: string): Promise<string> {
    this.logger.log(`Fetching claimable rent for ${userAddress} on token ${propertyTokenAddress}...`);
    const rentDistribution = this.blockchainService.getContract('rentDistribution');

     if (!rentDistribution) {
        this.logger.error('RentDistribution contract not available from BlockchainService');
        return '0';
     }
    try {
        // **ASSUMPTION**: Contract has `claimableRent(address token, address user)` returning uint
        const claimable = await (rentDistribution as any).claimableRent(propertyTokenAddress, userAddress);
        return claimable.toString();
    } catch (error) {
        this.logger.error(`Error fetching claimable rent for ${userAddress} on ${propertyTokenAddress}: ${error.message}`);
        // Return '0' or throw an appropriate HTTP exception based on desired API behavior
        return '0';
    }
  }

  // TODO: Implement depositRent if needed, potentially as an admin-only feature
  // async depositRent(propertyTokenAddress: string, amount: string): Promise<void> {
  //   const rentDistribution = this.blockchainService.getContract('rentDistribution');
  //   if (!rentDistribution) throw new Error('Contract not available');
  //   const signer = ... // Need a backend wallet/signer with funds and permissions
  //   const tx = await rentDistribution.connect(signer).depositRent(propertyTokenAddress, ethers.parseUnits(amount, 18)); // Adjust units
  //   await tx.wait();
  //   this.logger.log(`Deposited ${amount} for token ${propertyTokenAddress}`);
  // }
} 