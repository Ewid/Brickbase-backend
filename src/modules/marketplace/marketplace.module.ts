import { Module } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceController } from './marketplace.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HistoricalSale } from './entities/historical-sale.entity';
import { PropertiesModule } from '../properties/properties.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([HistoricalSale]),
    PropertiesModule
  ],
  controllers: [MarketplaceController],
  providers: [MarketplaceService],
})
export class MarketplaceModule {} 