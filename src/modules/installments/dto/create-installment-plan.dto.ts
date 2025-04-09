// src/modules/installments/dto/create-installment-plan.dto.ts
import { IsString, IsNotEmpty, IsNumber, Min, IsPositive } from 'class-validator';

export class CreateInstallmentPlanDto {
  @IsString()
  @IsNotEmpty()
  userId: string; // Wallet address or internal user ID

  @IsString()
  @IsNotEmpty()
  listingId: string; // Refers to the marketplace listing ID or property NFT ID

  @IsNumber()
  @IsPositive()
  totalAmount: number; // Ensure totalAmount is a positive number

  @IsNumber()
  @Min(1) // Must have at least one installment
  numberOfInstallments: number;

  @IsString()
  @IsNotEmpty()
  currency: string; // e.g., 'USDC', 'ETH'
} 