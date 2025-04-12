import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlockchainService } from '../blockchain/blockchain.service';
import { PropertiesService } from '../properties/properties.service';
import { HistoricalSale } from './entities/historical-sale.entity';
import { ethers, Contract, Log, EventLog, ZeroAddress } from 'ethers';
import { ListingDto } from './dto/listing.dto';

@Injectable()
export class MarketplaceService implements OnModuleInit {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    @InjectRepository(HistoricalSale)
    private historicalSaleRepository: Repository<HistoricalSale>,
    private blockchainService: BlockchainService,
    private propertiesService: PropertiesService,
  ) {}

  onModuleInit() {
    this.listenToListingPurchased();
  }

  private async formatListingData(listingData: any, listingId: number): Promise<ListingDto> {
    // Indices based on PropertyMarketplace.listings return:
    // 0: seller (address)
    // 1: propertyToken (address) - This is the ERC20 token for the property shares
    // 2: tokenAmount (uint256)
    // 3: pricePerToken (uint256)
    // 4: isActive (bool)
    const tokenAddress = listingData[1]; // PropertyToken address

    let nftAddress = '';
    let tokenId = '';

    // Fetch NFT details using the PropertiesService
    const nftDetails = await this.propertiesService.findNftDetailsByTokenAddress(tokenAddress);
    if (nftDetails) {
      nftAddress = nftDetails.nftAddress;
      tokenId = nftDetails.tokenId.toString();
    }

    return {
      listingId: listingId, // Pass the index as the ID
      seller: listingData[0],
      nftAddress: nftAddress, // Populate with found address
      tokenId: tokenId,    // Populate with found ID
      tokenAddress: tokenAddress,
      pricePerToken: listingData[3].toString(),
      amount: listingData[2].toString(),
      active: listingData[4],
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
        const activeListingIndices: bigint[] = await (propertyMarketplace as any).getActiveListings();
        this.logger.debug(`Found ${activeListingIndices.length} active listing indices: ${activeListingIndices.join(', ')}`);

        // Create promises for fetching and formatting each listing
        const listingPromises = activeListingIndices.map(async (indexBigInt) => {
            const index = Number(indexBigInt);
            try {
                const rawListing = await (propertyMarketplace as any).listings(index);
                // Await the async formatting
                return await this.formatListingData(rawListing, index);
            } catch (error) {
                this.logger.error(`Error fetching or formatting listing index ${index}: ${error.message}`);
                return null; // Return null for failed listings
            }
        });

        // Resolve all promises and filter out nulls (failed fetches/formats)
        const resolvedListings = await Promise.all(listingPromises);
        const activeListings = resolvedListings.filter(listing => listing !== null) as ListingDto[];

        this.logger.log(`Successfully formatted ${activeListings.length} active listings.`);
        return activeListings;

    } catch (error) {
        this.logger.error(`Error fetching active listing indices: ${error.message}`);
        return [];
    }
  }

  async getListingDetails(listingId: number): Promise<ListingDto | null> {
     this.logger.log(`Fetching details for listing index ${listingId}...`);
     const propertyMarketplace = this.blockchainService.getContract('propertyMarketplace');

      if (!propertyMarketplace) {
          this.logger.error('PropertyMarketplace contract not available from BlockchainService');
          return null;
      }
    try {
         const rawListing = await (propertyMarketplace as any).listings(listingId);

         if (!rawListing || rawListing[0] === ZeroAddress) { // Check seller (index 0) 
             this.logger.warn(`Listing at index ${listingId} not found (or seller is zero address).`);
             return null;
         }
         // Await the async formatting
         return await this.formatListingData(rawListing, listingId);
     } catch (error) {
         this.logger.error(`Error fetching listing details for index ${listingId}: ${error.message}`);
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
            // Fetch details using the listingId from the event
            const listingDetails = await this.getListingDetails(Number(listingId)); 
            if (!listingDetails) {
                 this.logger.warn(`Could not get details for purchased listing ${listingId} to record sale.`);
                 return;
            }

            const block = await event.getBlock();

            const sale = this.historicalSaleRepository.create({
                // Use nftAddress from the fetched listing details
                propertyNftId: listingDetails.nftAddress, 
                buyerAddress: buyer,
                // The seller argument from the event might be more reliable than listingDetails.seller
                // if the listing was somehow transferred, although unlikely with current contract.
                // Using event seller for consistency:
                sellerAddress: seller, 
                price: parseFloat(ethers.formatUnits(totalPrice, 18)), // Assuming price is in ETH/native token
                // Currency might need to be determined differently if using USDC etc.
                currency: 'ETH', // Adjust if necessary 
                transactionHash: event.transactionHash,
                timestamp: new Date(block.timestamp * 1000),
            });
            await this.historicalSaleRepository.save(sale);
            this.logger.log(`Saved historical sale for listing ${listingId} (NFT: ${listingDetails.nftAddress}), tx: ${event.transactionHash}`);
        } catch (error) {
            this.logger.error(`Error processing ListingPurchased event for listing ${listingId}: ${error.message}`);
        }
    });
  }
} 