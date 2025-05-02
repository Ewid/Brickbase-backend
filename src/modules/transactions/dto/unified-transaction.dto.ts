import { IsString, IsNotEmpty, IsNumber, IsDate, IsEnum } from 'class-validator';

export enum TransactionType {
  PURCHASE = 'Purchase',
  SALE = 'Sale',
  RENT_CLAIM = 'Rent Claim',
}

export class UnifiedTransactionDto {
  @IsString()
  @IsNotEmpty()
  id: string; // Unique ID (e.g., tx hash or db id)

  @IsEnum(TransactionType)
  type: TransactionType;

  @IsString()
  @IsNotEmpty()
  propertyNftId: string; // Associated Property NFT Address

  @IsString()
  propertyName?: string; // Optional: Added for context

  @IsString()
  propertyTokenAddress?: string; // Optional, useful for rent claims & context

  @IsNumber()
  amount: number; // Value of the transaction (e.g., sale price or rent amount)

  @IsString()
  @IsNotEmpty()
  currency: string; // e.g., 'USDC'

  @IsDate()
  timestamp: Date;

  @IsString()
  transactionHash: string;

  // Optional fields depending on type
  @IsString()
  buyerAddress?: string;

  @IsString()
  sellerAddress?: string;

  @IsString()
  tokenHolderAddress?: string; // For rent claims
} 