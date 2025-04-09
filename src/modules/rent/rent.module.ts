import { Module } from '@nestjs/common';
import { RentService } from './rent.service';
import { RentController } from './rent.controller';

@Module({
  controllers: [RentController],
  providers: [RentService],
})
export class RentModule {} 