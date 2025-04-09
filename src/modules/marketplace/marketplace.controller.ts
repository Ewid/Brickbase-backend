import { Controller, Get, Param, Query, Logger } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { HistoricalSale } from './entities/historical-sale.entity';

// Basic DTOs
class ListingDto {
  // Define based on contract return type
  id: number;
  // ... other listing details
}

class PriceHistoryDto extends HistoricalSale {}

@Controller('marketplace')
export class MarketplaceController {
   private readonly logger = new Logger(MarketplaceController.name);

  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get('listings')
  async findAllListings(): Promise<ListingDto[]> {
    this.logger.log('GET /marketplace/listings called');
    return this.marketplaceService.findAllListings();
  }

   @Get('listings/:id')
   async findListingById(@Param('id') id: string): Promise<ListingDto | null> {
     this.logger.log(`GET /marketplace/listings/${id} called`);
     // Assuming listing ID is a number based on service method
     return this.marketplaceService.getListingDetails(parseInt(id, 10));
   }

  @Get('price-history')
  async getPriceHistory(@Query('propertyNftId') propertyNftId: string): Promise<PriceHistoryDto[]> {
      this.logger.log(`GET /marketplace/price-history?propertyNftId=${propertyNftId} called`);
      return this.marketplaceService.getPriceHistory(propertyNftId);
  }
} 