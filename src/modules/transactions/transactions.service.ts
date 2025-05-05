import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HistoricalSale } from '../marketplace/entities/historical-sale.entity';
import { RentClaimRecord } from '../rent/entities/rent-claim-record.entity';
import { PropertiesService } from '../properties/properties.service';
import { UnifiedTransactionDto, TransactionType } from './dto/unified-transaction.dto';
import { CacheService } from '../cache/cache.service';
import { ethers } from 'ethers';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);
  private readonly HISTORY_CACHE_TTL = 600; // 10 minutes

  constructor(
    @InjectRepository(HistoricalSale)
    private historicalSaleRepository: Repository<HistoricalSale>,
    @InjectRepository(RentClaimRecord)
    private rentClaimRecordRepository: Repository<RentClaimRecord>,
    private propertiesService: PropertiesService, // To resolve NFT address if needed
    private cacheService: CacheService,
  ) {}

  async getUnifiedHistory(userAddress: string): Promise<UnifiedTransactionDto[]> {
    const cacheKey = `transactions:history:${userAddress}`;
    this.logger.log(`Fetching unified transaction history for ${userAddress}`);

    // Check cache first
    const cachedHistory = await this.cacheService.get<UnifiedTransactionDto[]>(cacheKey);
    if (cachedHistory) {
      this.logger.log(`Returning cached transaction history for ${userAddress}`);
      return cachedHistory;
    }

    this.logger.log(`Cache miss for ${userAddress}, fetching from database...`);

    const userAddressLower = userAddress.toLowerCase();

    // --- Use QueryBuilder for robust case-insensitive OR query --- 
    this.logger.log(`[TransactionsService] Querying HistoricalSale with QueryBuilder for address: ${userAddress}`);
    const sales = await this.historicalSaleRepository.createQueryBuilder("sale")
      .where("LOWER(sale.buyerAddress) = LOWER(:userAddress)", { userAddress })
      .orWhere("LOWER(sale.sellerAddress) = LOWER(:userAddress)", { userAddress })
      .orderBy("sale.timestamp", "DESC")
      .getMany();

    // --- Use QueryBuilder for rent claims query --- 
    this.logger.log(`[TransactionsService] Querying RentClaimRecord with QueryBuilder for address: ${userAddress}`);
    const rentClaims = await this.rentClaimRecordRepository.createQueryBuilder("claim")
      .where("LOWER(claim.tokenHolderAddress) = LOWER(:userAddress)", { userAddress })
      .orderBy("claim.timestamp", "DESC")
      .getMany();

    this.logger.log(`Found ${sales.length} sales and ${rentClaims.length} rent claims for ${userAddress}`);

    // Map sales to unified DTO, enriching with property details
    const saleTransactionsPromises = sales.map(async (sale): Promise<UnifiedTransactionDto | null> => {
      let propertyName = 'Property N/A';
      let propertyTokenAddress = '0xUnknown';
      try {
        // Fetch property details using the NFT ID from the sale record
        const propertyDetails = await this.propertiesService.getPropertyDetails(sale.propertyNftId);
        if (propertyDetails) {
          propertyName = propertyDetails.metadata?.name || propertyName;
          propertyTokenAddress = propertyDetails.tokenAddress || propertyTokenAddress;
        }
      } catch (propError) {
        this.logger.warn(`Could not fetch property details for NFT ${sale.propertyNftId} during history mapping: ${propError.message}`);
      }

      return {
        id: sale.transactionHash, // Use tx hash as unique ID for sales
        type: sale.buyerAddress.toLowerCase() === userAddressLower ? TransactionType.PURCHASE : TransactionType.SALE,
        propertyNftId: sale.propertyNftId,
        propertyName: propertyName, // Add fetched name
        propertyTokenAddress: propertyTokenAddress, // Add fetched token address
        amount: sale.price, // Use the number directly
        tokenAmount: sale.tokenAmount, // <-- Add the token amount
        currency: sale.currency,
        timestamp: sale.timestamp,
        transactionHash: sale.transactionHash,
        buyerAddress: sale.buyerAddress,
        sellerAddress: sale.sellerAddress,
      };
    });
    const resolvedSaleTransactions = await Promise.all(saleTransactionsPromises);
    const saleTransactions = resolvedSaleTransactions.filter(tx => tx !== null) as UnifiedTransactionDto[];

    // Map rent claims to unified DTO
    // Need to resolve propertyNftId for rent claims
    const rentClaimTransactionsPromises: Promise<UnifiedTransactionDto | null>[] = rentClaims.map(async (claim) => {
       try {
         // Find the NFT associated with the property token
         const nftDetails = await this.propertiesService.findNftDetailsByTokenAddress(claim.propertyTokenAddress);
         if (!nftDetails) {
           this.logger.warn(`Could not find NFT details for rent claim token ${claim.propertyTokenAddress} (Tx: ${claim.transactionHash})`);
           return null; // Skip if NFT details cannot be found
         }
         
         // --- Fetch full property details to get name --- 
         let propertyName = 'Property N/A';
         try {
            const propertyDetails = await this.propertiesService.getPropertyDetails(nftDetails.nftAddress, nftDetails.tokenId);
            if (propertyDetails) {
                propertyName = propertyDetails.metadata?.name || propertyName;
            }
         } catch (propError) {
            this.logger.warn(`Could not fetch property details for NFT ${nftDetails.nftAddress} (Token ID: ${nftDetails.tokenId}) during rent claim history mapping: ${propError.message}`);
         }
         // --- End fetching name --- 
         
         return {
           id: claim.id, // Use DB id as unique ID for rent claims
           type: TransactionType.RENT_CLAIM,
           propertyNftId: nftDetails.nftAddress, // Use resolved NFT address
           propertyName: propertyName, // Add fetched name
           propertyTokenAddress: claim.propertyTokenAddress,
           amount: parseFloat(ethers.formatUnits(claim.amount, 6)), // Format USDC amount
           currency: claim.currency,
           timestamp: claim.timestamp,
           transactionHash: claim.transactionHash,
           tokenHolderAddress: claim.tokenHolderAddress,
         };
       } catch (error) {
            this.logger.error(`Error processing rent claim ${claim.id} for unified history: ${error.message}`);
            return null; // Skip on error
       }
    });

    const resolvedRentClaimTransactions = await Promise.all(rentClaimTransactionsPromises);
    const rentClaimTransactions = resolvedRentClaimTransactions.filter(tx => tx !== null) as UnifiedTransactionDto[];

    // Combine and sort
    const combinedHistory = [...saleTransactions, ...rentClaimTransactions];
    combinedHistory.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    this.logger.log(`Returning combined history of ${combinedHistory.length} items for ${userAddress}`);

    // Save to cache
    await this.cacheService.set(cacheKey, combinedHistory, this.HISTORY_CACHE_TTL);

    return combinedHistory;
  }
}
