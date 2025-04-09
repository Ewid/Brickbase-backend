import { Controller, Get, Query, Logger } from '@nestjs/common';
import { RentService } from './rent.service';

// Basic DTO
class ClaimableRentDto {
  amount: string; // BigNumber string
}

@Controller('rent')
export class RentController {
   private readonly logger = new Logger(RentController.name);

  constructor(private readonly rentService: RentService) {}

  @Get('claimable')
  async getClaimableRent(
    @Query('userAddress') userAddress: string,
    @Query('tokenAddress') tokenAddress: string,
  ): Promise<ClaimableRentDto> {
    this.logger.log(`GET /rent/claimable?userAddress=${userAddress}&tokenAddress=${tokenAddress} called`);
    const amount = await this.rentService.getClaimableRent(userAddress, tokenAddress);
    return { amount };
  }

  // POST endpoint for depositing rent might go here (admin only)
} 