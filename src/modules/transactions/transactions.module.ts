import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { HistoricalSale } from '../marketplace/entities/historical-sale.entity';
import { RentClaimRecord } from '../rent/entities/rent-claim-record.entity';
import { PropertiesModule } from '../properties/properties.module'; // Might need this for context
import { CacheModule } from '../cache/cache.module'; // Might need this for caching

@Module({
  imports: [
    TypeOrmModule.forFeature([HistoricalSale, RentClaimRecord]), // Import required entities
    PropertiesModule, // If needed for property context
    CacheModule,      // If needed for caching results
  ],
  controllers: [TransactionsController],
  providers: [TransactionsService],
})
export class TransactionsModule {}
