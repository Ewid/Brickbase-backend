import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InstallmentPlan } from './entities/installment-plan.entity';

@Injectable()
export class InstallmentsService {
  private readonly logger = new Logger(InstallmentsService.name);

  constructor(
    @InjectRepository(InstallmentPlan)
    private installmentPlanRepository: Repository<InstallmentPlan>,
  ) {}

  async createInstallmentPlan(planData: Partial<InstallmentPlan>): Promise<InstallmentPlan> {
    this.logger.log(`Creating new installment plan for user ${planData.userId} and listing ${planData.listingId}`);
    const newPlan = this.installmentPlanRepository.create(planData);
    return this.installmentPlanRepository.save(newPlan);
  }

  async getUserInstallments(userId: string): Promise<InstallmentPlan[]> {
    this.logger.log(`Fetching installment plans for user ${userId}...`);
    return this.installmentPlanRepository.find({ where: { userId } });
  }

  async getInstallmentPlanById(planId: string): Promise<InstallmentPlan | null> {
     this.logger.log(`Fetching installment plan ${planId}...`);
    return this.installmentPlanRepository.findOne({ where: { id: planId } });
  }

  // TODO: Add methods for processing payments, updating status (e.g., check due dates)
  // async processPayment(planId: string, amount: number) { ... }
  // async checkDueDatesAndDefault() { ... } // Potentially run by a cron job
} 