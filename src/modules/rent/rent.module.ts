import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RentService } from './rent.service';
import { RentController } from './rent.controller';
import { RentClaimRecord } from './entities/rent-claim-record.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RentClaimRecord])],
  controllers: [RentController],
  providers: [RentService],
})
export class RentModule {} 