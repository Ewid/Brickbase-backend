import { IsString, IsNotEmpty } from 'class-validator';

export class RentClaimDto {
  @IsString()
  @IsNotEmpty()
  amount: string; // Claimable rent amount

  @IsString()
  @IsNotEmpty()
  currency: string; // Currency (USDC)

  @IsString()
  @IsNotEmpty()
  userAddress: string; // User claiming the rent

  @IsString()
  @IsNotEmpty()
  propertyTokenAddress: string; // Property token address
} 