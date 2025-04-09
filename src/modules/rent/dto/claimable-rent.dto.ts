// src/modules/rent/dto/claimable-rent.dto.ts
import { IsString, IsNotEmpty } from 'class-validator';

export class ClaimableRentDto {
  @IsString()
  @IsNotEmpty()
  amount: string; // BigNumber string
} 