import { Controller, Get, Param, Query, Logger } from '@nestjs/common';
import { DaoService } from './dao.service';
import { ExpenseRecord } from './entities/expense-record.entity';

// Basic DTOs
class ProposalDto {
  // Define based on contract return type
  id: number;
  // ... other proposal details
}

class ExpenseRecordDto extends ExpenseRecord {}

@Controller('dao')
export class DaoController {
  private readonly logger = new Logger(DaoController.name);

  constructor(private readonly daoService: DaoService) {}

  @Get('proposals')
  async findAllProposals(): Promise<ProposalDto[]> {
    this.logger.log('GET /dao/proposals called');
    return this.daoService.getDaoProposals();
  }

  @Get('proposals/:id')
  async findProposalById(@Param('id') id: string): Promise<ProposalDto | null> {
    this.logger.log(`GET /dao/proposals/${id} called`);
     // Assuming proposal ID is a number based on service method
    return this.daoService.getProposalDetails(parseInt(id, 10));
  }

  @Get('expenses')
  async findExpenseRecords(@Query('propertyNftId') propertyNftId?: string): Promise<ExpenseRecordDto[]> {
      this.logger.log(`GET /dao/expenses${propertyNftId ? '?propertyNftId=' + propertyNftId : ''} called`);
      return this.daoService.getExpenseProposals(propertyNftId);
  }
} 