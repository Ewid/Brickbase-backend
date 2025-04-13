import { Controller, Get, Param, Query, Logger, ParseIntPipe } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { ListingDto } from './dto/listing.dto';
import { HistoricalSale } from './entities/historical-sale.entity';
import { CacheService } from '../cache/cache.service';

@Controller('marketplace')
export class MarketplaceController {
  private readonly logger = new Logger(MarketplaceController.name);

  constructor(
    private readonly marketplaceService: MarketplaceService,
    private readonly cacheService: CacheService,
  ) {}

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
  async getPriceHistory(@Query('propertyNftId') propertyNftId: string): Promise<HistoricalSale[]> {
    this.logger.log(`GET /marketplace/price-history?propertyNftId=${propertyNftId} called`);
    return this.marketplaceService.getPriceHistory(propertyNftId);
  }
  
  @Get('admin/rebuild-cache')
  async rebuildCache(): Promise<{ success: boolean; message: string }> {
    this.logger.log('Admin cache rebuild requested for marketplace');
    try {
      await this.marketplaceService.resetAndRebuildCache();
      return { success: true, message: 'Marketplace cache rebuilt successfully' };
    } catch (error) {
      return { success: false, message: `Error rebuilding marketplace cache: ${error.message}` };
    }
  }
} 