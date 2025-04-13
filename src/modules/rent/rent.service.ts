import { Injectable, Logger } from '@nestjs/common';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ethers } from 'ethers';
import { RentClaimDto } from './dto/rent-claim.dto';

@Injectable()
export class RentService {
  private readonly logger = new Logger(RentService.name);

  constructor(private blockchainService: BlockchainService) {
  }

  async getClaimableRent(userAddress: string, propertyTokenAddress: string): Promise<{ amount: string, currency: string }> {
    this.logger.log(`Fetching claimable rent for ${userAddress} on token ${propertyTokenAddress}...`);
    const rentDistribution = this.blockchainService.getContract('rentDistribution');

    if (!rentDistribution) {
      this.logger.error('RentDistribution contract not available from BlockchainService');
      return { amount: '0', currency: 'USDC' };
    }
    
    try {
      // The contract method is now called getUnclaimedRent based on the smart contract
      const claimable = await (rentDistribution as any).getUnclaimedRent(propertyTokenAddress, userAddress);
      
      // Format with 6 decimals for USDC
      const formattedAmount = ethers.formatUnits(claimable, 6);
      this.logger.debug(`Claimable rent amount: ${formattedAmount} USDC`);
      
      return { 
        amount: claimable.toString(),
        currency: 'USDC'
      };
    } catch (error) {
      this.logger.error(`Error fetching claimable rent for ${userAddress} on ${propertyTokenAddress}: ${error.message}`);
      return { amount: '0', currency: 'USDC' };
    }
  }
  
  // Implement claimRent function for frontend integration
  async claimRent(userAddress: string, propertyTokenAddress: string): Promise<RentClaimDto> {
    this.logger.log(`Preparing to claim rent for ${userAddress} on token ${propertyTokenAddress}...`);
    
    // This method only provides information for frontend integration
    // Actual claiming will happen directly from frontend to smart contract
    
    const rentDistribution = this.blockchainService.getContract('rentDistribution');
    const usdcToken = this.blockchainService.getContract('usdcToken');
    
    if (!rentDistribution || !usdcToken) {
      this.logger.error('Required contracts not available');
      throw new Error('Required contracts not available');
    }
    
    try {
      // Get the unclaimed rent amount
      const unclaimedAmount = await (rentDistribution as any).getUnclaimedRent(propertyTokenAddress, userAddress);
      
      return {
        amount: unclaimedAmount.toString(),
        currency: 'USDC',
        userAddress,
        propertyTokenAddress
      };
    } catch (error) {
      this.logger.error(`Error preparing rent claim: ${error.message}`);
      throw error;
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