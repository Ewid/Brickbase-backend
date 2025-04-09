import { Controller, Get, Post, Body, Param, Logger, NotFoundException } from '@nestjs/common';
import { InstallmentsService } from './installments.service';
import { InstallmentPlan } from './entities/installment-plan.entity';

// Basic DTOs (Consider using class-validator for real applications)
class CreateInstallmentPlanDto {
  userId: string;
  listingId: string;
  totalAmount: number;
  numberOfInstallments: number;
  // currency, installmentAmount, nextDueDate might be calculated/set in service
}

class InstallmentPlanDto extends InstallmentPlan {}

@Controller('installments')
export class InstallmentsController {
  private readonly logger = new Logger(InstallmentsController.name);

  constructor(private readonly installmentsService: InstallmentsService) {}

  // Example: Endpoint to initiate an installment plan (logic might be more complex)
  @Post()
  async create(@Body() createDto: CreateInstallmentPlanDto): Promise<InstallmentPlanDto> {
    this.logger.log('POST /installments called', createDto);
    // Add validation and calculation logic here or in the service
    const planData = {
        ...createDto,
        amountPaid: 0, // Initial amount paid
        installmentAmount: createDto.totalAmount / createDto.numberOfInstallments, // Basic calculation
        // Set initial nextDueDate based on creation date + interval
        nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Example: 30 days later
        currency: 'USD', // Example currency
    }
    return this.installmentsService.createInstallmentPlan(planData);
  }

  @Get('user/:userId')
  async findUserInstallments(@Param('userId') userId: string): Promise<InstallmentPlanDto[]> {
    this.logger.log(`GET /installments/user/${userId} called`);
    return this.installmentsService.getUserInstallments(userId);
  }

  @Get(':planId')
  async findOne(@Param('planId') planId: string): Promise<InstallmentPlanDto> {
    this.logger.log(`GET /installments/${planId} called`);
    const plan = await this.installmentsService.getInstallmentPlanById(planId);
    if (!plan) {
      throw new NotFoundException(`Installment plan with ID ${planId} not found`);
    }
    return plan;
  }

  // Add endpoints for payment records, status updates etc. as needed
} 