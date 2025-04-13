import { Controller, Get, Post, Query, Logger, Param } from '@nestjs/common';
import { RentService } from './rent.service';
import { ClaimableRentDto } from './dto/claimable-rent.dto';
import { RentClaimDto } from './dto/rent-claim.dto';

// Define validation rules for addresses if needed (e.g., using a custom decorator or regex)

@Controller('rent')
export class RentController {
   private readonly logger = new Logger(RentController.name);

  constructor(private readonly rentService: RentService) {}

  @Get('claimable/:userAddress/:tokenAddress')
  async getClaimableRent(
    @Param('userAddress') userAddress: string,
    @Param('tokenAddress') tokenAddress: string,
  ): Promise<ClaimableRentDto> {
    this.logger.log(`GET /rent/claimable/${userAddress}/${tokenAddress} called`);
    const rentData = await this.rentService.getClaimableRent(userAddress, tokenAddress);
    return { 
      amount: rentData.amount,
      currency: rentData.currency 
    };
  }

  @Post('claim/:userAddress/:tokenAddress')
  async prepareRentClaim(
    @Param('userAddress') userAddress: string,
    @Param('tokenAddress') tokenAddress: string,
  ): Promise<RentClaimDto> {
    this.logger.log(`POST /rent/claim/${userAddress}/${tokenAddress} called`);
    return this.rentService.claimRent(userAddress, tokenAddress);
  }

  // POST endpoint for depositing rent might go here (admin only)
} 