import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlockchainService } from '../blockchain/blockchain.service';
import { HistoricalSale } from './entities/historical-sale.entity';
import { ethers, Contract, Log, EventLog } from 'ethers';
import { ListingDto } from './dto/listing.dto';

@Injectable()
export class MarketplaceService implements OnModuleInit {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    @InjectRepository(HistoricalSale)
    private historicalSaleRepository: Repository<HistoricalSale>,
    private blockchainService: BlockchainService,
  ) {}

  onModuleInit() {
    this.listenToListingPurchased();
  }

  private formatListingData(listingData: any): ListingDto {
    return {
      listingId: Number(listingData.listingId),
      seller: listingData.seller,
      nftAddress: listingData.nftAddress,
      tokenId: listingData.tokenId.toString(),
      tokenAddress: listingData.tokenAddress,
      pricePerToken: listingData.pricePerToken.toString(),
      amount: listingData.amount.toString(),
      active: listingData.active,
    };
  }

  async findAllListings(): Promise<ListingDto[]> {
    this.logger.log('Fetching all active listings...');
    const propertyMarketplace = this.blockchainService.getContract('propertyMarketplace');

    if (!propertyMarketplace) {
        this.logger.error('PropertyMarketplace contract not available from BlockchainService');
        return [];
    }
    try {
        const rawListings = await (propertyMarketplace as any).getActiveListings();
        return rawListings.map((listing: any) => this.formatListingData(listing));
    } catch (error) {
        this.logger.error(`Error fetching listings: ${error.message}`);
        return [];
    }
  }

  async getListingDetails(listingId: number): Promise<ListingDto | null> {
     this.logger.log(`Fetching details for listing ${listingId}...`);
     const propertyMarketplace = this.blockchainService.getContract('propertyMarketplace');

      if (!propertyMarketplace) {
          this.logger.error('PropertyMarketplace contract not available from BlockchainService');
          return null;
      }
    try {
         const rawListing = await (propertyMarketplace as any).getListing(listingId);
         if (!rawListing || rawListing.seller === ethers.ZeroAddress) {
             this.logger.warn(`Listing ${listingId} not found.`);
             return null;
         }
         return this.formatListingData(rawListing);
     } catch (error) {
         this.logger.error(`Error fetching listing details for ${listingId}: ${error.message}`);
         return null;
     }
  }

  async getPriceHistory(propertyNftId: string): Promise<HistoricalSale[]> {
    this.logger.log(`Fetching price history for property NFT ${propertyNftId}...`);
    try {
        return this.historicalSaleRepository.find({
          where: { propertyNftId },
          order: { timestamp: 'ASC' },
        });
    } catch (error) {
        this.logger.error(`Error fetching price history from database: ${error.message}`);
        return [];
    }
  }

  private listenToListingPurchased() {
    const propertyMarketplace = this.blockchainService.getContract('propertyMarketplace');
    if (!propertyMarketplace) {
      this.logger.error('Cannot listen for ListingPurchased: PropertyMarketplace contract not available');
      return;
    }

    this.logger.log('Setting up listener for ListingPurchased events...');

    propertyMarketplace.on('ListingPurchased', async (listingId, buyer, seller, amount, totalPrice, event: EventLog) => {
        this.logger.log(`ListingPurchased event received: listingId=${listingId}, buyer=${buyer}, amount=${amount}`);
        try {
            const listingDetails = await this.getListingDetails(Number(listingId));
            if (!listingDetails) {
                 this.logger.warn(`Could not get details for purchased listing ${listingId} to record sale.`);
                 return;
            }

            const block = await event.getBlock();

            const sale = this.historicalSaleRepository.create({
                propertyNftId: listingDetails.tokenId,
                buyerAddress: buyer,
                sellerAddress: seller,
                price: parseFloat(ethers.formatUnits(totalPrice, 18)),
                currency: 'ETH/USDC',
                transactionHash: event.transactionHash,
                timestamp: new Date(block.timestamp * 1000),
            });
            await this.historicalSaleRepository.save(sale);
            this.logger.log(`Saved historical sale for listing ${listingId}, tx: ${event.transactionHash}`);
        } catch (error) {
            this.logger.error(`Error processing ListingPurchased event: ${error.message}`);
        }
    });
  }
} 