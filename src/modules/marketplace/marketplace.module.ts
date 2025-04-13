import { Module } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceController } from './marketplace.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HistoricalSale } from './entities/historical-sale.entity';
import { CachedListing } from './entities/cached-listing.entity';
import { PropertiesModule } from '../properties/properties.module';
import { CacheModule } from '../cache/cache.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([HistoricalSale, CachedListing]),
    PropertiesModule,
    CacheModule,
  ],
  controllers: [MarketplaceController],
  providers: [MarketplaceService],
  exports: [MarketplaceService]
})
export class MarketplaceModule {} 