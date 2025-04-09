import { Controller, Get, Param, Query, Logger, ParseIntPipe } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { ListingDto } from './dto/listing.dto';
import { PriceHistoryDto } from './dto/price-history.dto';

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
   async findListingById(@Param('id', ParseIntPipe) id: number): Promise<ListingDto | null> {
     this.logger.log(`GET /marketplace/listings/${id} called`);
     return this.marketplaceService.getListingDetails(id);
   }

  @Get('price-history')
  async getPriceHistory(@Query('propertyNftId') propertyNftId: string): Promise<PriceHistoryDto[]> {
      this.logger.log(`GET /marketplace/price-history?propertyNftId=${propertyNftId} called`);
      return this.marketplaceService.getPriceHistory(propertyNftId);
  }
} 