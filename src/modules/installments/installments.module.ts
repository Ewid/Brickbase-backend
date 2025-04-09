import { Module } from '@nestjs/common';
import { InstallmentsService } from './installments.service';
import { InstallmentsController } from './installments.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstallmentPlan } from './entities/installment-plan.entity';

@Module({
  imports: [TypeOrmModule.forFeature([InstallmentPlan])],
  controllers: [InstallmentsController],
  providers: [InstallmentsService],
})
export class InstallmentsModule {} 