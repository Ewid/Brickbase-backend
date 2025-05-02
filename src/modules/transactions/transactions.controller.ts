import { Controller, Get, Param, Logger } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { UnifiedTransactionDto } from './dto/unified-transaction.dto';

@Controller('transactions')
export class TransactionsController {
  private readonly logger = new Logger(TransactionsController.name);

  constructor(private readonly transactionsService: TransactionsService) {}

  @Get('history/:userAddress')
  async getUnifiedTransactionHistory(
    @Param('userAddress') userAddress: string
  ): Promise<UnifiedTransactionDto[]> {
    this.logger.log(`GET /transactions/history/${userAddress} called`);
    return this.transactionsService.getUnifiedHistory(userAddress);
  }
}
