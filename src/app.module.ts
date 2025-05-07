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
import { TestModule } from './modules/test/test.module';
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
        // Modifications for Vercel deployment:
        synchronize: configService.get('NODE_ENV') !== 'production', // Only synchronize in non-production
        ssl: configService.get('NODE_ENV') === 'production' 
          ? { rejectUnauthorized: false } 
          : false,
        keepConnectionAlive: false, // Important for serverless
        extra: {
          poolSize: 1, // Minimize connections for serverless
          max: 20, // Maximum connections in the pool
          connectionTimeoutMillis: 5000 // Connection timeout
        },
        autoLoadEntities: true, // Auto-load entities
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
    TestModule,
  ],
})
export class AppModule {}