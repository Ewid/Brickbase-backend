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
        entities: [__dirname + '/../**/*.entity.{js,ts}'],
        synchronize: true,
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    PropertiesModule,
    MarketplaceModule,
    RentModule,
    DaoModule,
    InstallmentsModule,
    BlockchainModule,
    DatabaseModule,
  ],
})
export class AppModule {}