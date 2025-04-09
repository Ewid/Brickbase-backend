import { Controller, Get, Post, Body, Param, Logger, NotFoundException, ParseUUIDPipe } from '@nestjs/common';
import { InstallmentsService } from './installments.service';
import { CreateInstallmentPlanDto } from './dto/create-installment-plan.dto';
import { InstallmentPlanDto } from './dto/installment-plan.dto';

@Controller('installments')
export class InstallmentsController {
  private readonly logger = new Logger(InstallmentsController.name);

  constructor(private readonly installmentsService: InstallmentsService) {}

  // Example: Endpoint to initiate an installment plan (logic might be more complex)
  @Post()
  async create(@Body() createDto: CreateInstallmentPlanDto): Promise<InstallmentPlanDto> {
    this.logger.log('POST /installments called', createDto);

    // Basic calculations can be done here or moved entirely to the service
    const installmentAmount = createDto.totalAmount / createDto.numberOfInstallments;
    const nextDueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Example: 30 days later

    const planData = {
        ...createDto,
        amountPaid: 0,
        installmentAmount: installmentAmount,
        nextDueDate: nextDueDate,
    };

    // Let the service handle the creation logic
    return this.installmentsService.createInstallmentPlan(planData);
  }

  @Get('user/:userId')
  // Add validation for userId if needed (e.g., IsEthereumAddress)
  async findUserInstallments(@Param('userId') userId: string): Promise<InstallmentPlanDto[]> {
    this.logger.log(`GET /installments/user/${userId} called`);
    return this.installmentsService.getUserInstallments(userId);
  }

  @Get(':planId')
  // Use ParseUUIDPipe since the entity uses UUID for primary key
  async findOne(@Param('planId', ParseUUIDPipe) planId: string): Promise<InstallmentPlanDto> {
    this.logger.log(`GET /installments/${planId} called`);
    const plan = await this.installmentsService.getInstallmentPlanById(planId);
    if (!plan) {
      throw new NotFoundException(`Installment plan with ID ${planId} not found`);
    }
    return plan;
  }

  // Add endpoints for payment records, status updates etc. as needed
} 