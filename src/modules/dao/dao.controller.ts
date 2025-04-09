import { Controller, Get, Param, Query, Logger, ParseIntPipe } from '@nestjs/common';
import { DaoService } from './dao.service';
import { ProposalDto } from './dto/proposal.dto';
import { ExpenseRecordDto } from './dto/expense-record.dto';

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
  async findProposalById(@Param('id', ParseIntPipe) id: number): Promise<ProposalDto | null> {
    this.logger.log(`GET /dao/proposals/${id} called`);
    return this.daoService.getProposalDetails(id);
  }

  @Get('expenses')
  async findExpenseRecords(
    @Query('propertyNftId') propertyNftId?: string
  ): Promise<ExpenseRecordDto[]> {
      this.logger.log(`GET /dao/expenses${propertyNftId ? '?propertyNftId=' + propertyNftId : ''} called`);
      return this.daoService.getExpenseProposals(propertyNftId);
  }
} 