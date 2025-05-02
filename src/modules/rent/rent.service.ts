import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlockchainService } from '../blockchain/blockchain.service';
import { ethers, EventLog } from 'ethers';
import { RentClaimDto } from './dto/rent-claim.dto';
import { RentClaimRecord } from './entities/rent-claim-record.entity';

@Injectable()
export class RentService implements OnModuleInit {
  private readonly logger = new Logger(RentService.name);

  constructor(
    private blockchainService: BlockchainService,
    @InjectRepository(RentClaimRecord)
    private rentClaimRecordRepository: Repository<RentClaimRecord>,
  ) {}

  onModuleInit() {
    this.listenForRentClaims();
  }

  async getClaimableRent(userAddress: string, propertyTokenAddress: string): Promise<{ amount: string, currency: string }> {
    this.logger.log(`Fetching claimable rent for ${userAddress} on token ${propertyTokenAddress}...`);
    const rentDistribution = this.blockchainService.getContract('rentDistribution');

    if (!rentDistribution) {
      this.logger.error('RentDistribution contract not available from BlockchainService');
      throw new Error('RentDistribution contract service is unavailable.');
    }
    
    const claimable = await (rentDistribution as any).getUnclaimedRent(propertyTokenAddress, userAddress);
    
    const formattedAmount = ethers.formatUnits(claimable, 6);
    this.logger.debug(`Claimable rent amount retrieved from contract: ${formattedAmount} USDC (Raw: ${claimable.toString()})`);
    
    return { 
      amount: claimable.toString(),
      currency: 'USDC'
    };
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

  private listenForRentClaims() {
    const rentDistribution = this.blockchainService.getContract('rentDistribution');
    if (!rentDistribution) {
      this.logger.error('Cannot listen for Rent Claims: RentDistribution contract not available');
      return;
    }

    this.logger.log('Setting up listener for RentClaimed events...');

    rentDistribution.on('RentClaimed', async (propertyToken, tokenHolder, amount, event: EventLog) => {
      // Log basic event info, avoiding stringifying the entire event object due to BigInt issues
      this.logger.log(`[RentService] Received RentClaimed event: Token=${propertyToken}, Holder=${tokenHolder}, Amount=${amount.toString()}`);
      
      // --- Add explicit transaction hash check --- 
      let txHash = event.transactionHash;
      if (!txHash) {
        this.logger.warn(`[RentService] Transaction hash missing from RentClaimed event log. Attempting to fetch receipt... Event TX Hash: ${event.transactionHash}`);
        try {
            const txReceipt = await event.getTransactionReceipt();
            if (txReceipt) {
              txHash = txReceipt.hash;
              this.logger.log(`[RentService] Successfully fetched transaction hash ${txHash} from receipt.`);
            } else {
                this.logger.error(`[RentService] Could not fetch transaction receipt for RentClaimed event. Cannot save record.`);
                return; // Exit if hash cannot be obtained
            }
        } catch (receiptError) {
            this.logger.error(`[RentService] Error fetching transaction receipt for RentClaimed event: ${receiptError.message}. Cannot save record.`);
            return; // Exit if hash cannot be obtained
        }
      }
      // --- End explicit transaction hash check --- 
      
      try {
        this.logger.log(`[RentService] Checking for existing record with txHash: ${txHash}`);
        const existingRecord = await this.rentClaimRecordRepository.findOne({
          where: { transactionHash: txHash }, // Use the potentially fetched txHash
        });

        if (existingRecord) {
          this.logger.log(`[RentService] Rent claim record for tx ${txHash} already exists.`);
          return;
        }
        
        this.logger.log(`[RentService] Fetching block details for tx ${txHash}...`);
        const block = await event.getBlock();
        if (!block) {
            this.logger.error(`[RentService] Failed to get block details for tx ${txHash}. Cannot save record.`);
            return;
        }
        const timestamp = new Date(block.timestamp * 1000);
        this.logger.log(`[RentService] Block timestamp: ${timestamp.toISOString()}`);

        const claimRecordData = {
          propertyTokenAddress: propertyToken,
          tokenHolderAddress: tokenHolder,
          amount: amount.toString(),
          currency: 'USDC', // Assuming USDC
          transactionHash: txHash,
          timestamp: timestamp,
        };
        
        this.logger.log(`[RentService] Attempting to create rent claim record: ${JSON.stringify(claimRecordData)}`);
        const claimRecord = this.rentClaimRecordRepository.create(claimRecordData);
        
        this.logger.log(`[RentService] Attempting to save rent claim record for tx ${txHash}...`);
        await this.rentClaimRecordRepository.save(claimRecord);
        this.logger.log(`[RentService] Successfully saved new rent claim record for ${tokenHolder} (Tx: ${txHash})`);
        
        // --- Add post-save read check --- 
        try {
            this.logger.log(`[RentService] Attempting post-save read for txHash: ${txHash}`);
            const savedRecord = await this.rentClaimRecordRepository.findOne({ where: { transactionHash: txHash } });
            if (savedRecord) {
                this.logger.log(`[RentService] Post-save read successful! Found record: ${JSON.stringify(savedRecord)}`);
            } else {
                this.logger.error(`[RentService] Post-save read FAILED! Record not found for txHash: ${txHash}`);
            }
        } catch (readError) {
            this.logger.error(`[RentService] Error during post-save read for txHash ${txHash}: ${readError.message}`);
        }
        // --- End post-save read check --- 

      } catch (error) {
        this.logger.error(`[RentService] Error processing RentClaimed event for tx ${txHash}: ${error.message}`, error.stack);
      }
    });
  }
} 