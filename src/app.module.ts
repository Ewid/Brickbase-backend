import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './modules/auth/auth.module';
import { PropertiesModule } from './modules/properties/properties.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { RentModule } from './modules/rent/rent.module';
import { DaoModule } from './modules/dao/dao.module';
import { InstallmentsModule } from './modules/installments/installments.module';
import { BlockchainModule } from './modules/blockchain/blockchain.module';
import { DatabaseModule } from './modules/database/database.module';
import { CacheModule } from './modules/cache/cache.module';
import { TransactionsModule } from './modules/transactions/transactions.module';
import { join } from 'path';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.get<string>('DATABASE_URL'),
        entities: [join(__dirname, '**', '*.entity.js')],
        synchronize: true,
      }),
      inject: [ConfigService],
    }),
    CacheModule,
    AuthModule,
    PropertiesModule,
    MarketplaceModule,
    RentModule,
    DaoModule,
    InstallmentsModule,
    BlockchainModule,
    DatabaseModule,
    TransactionsModule,
  ],
})
export class AppModule {}