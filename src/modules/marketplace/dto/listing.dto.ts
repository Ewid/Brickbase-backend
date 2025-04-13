// src/modules/marketplace/dto/listing.dto.ts
import { IsNumber, IsString, IsBoolean, IsNotEmpty } from 'class-validator';

export class ListingDto {
  // Example fields based on typical marketplace contract listing structure
  // Adjust based on your actual PropertyMarketplace contract
  @IsNumber()
  listingId: number;

  @IsString()
  @IsNotEmpty()
  seller: string; // Address

  @IsString()
  @IsNotEmpty()
  nftAddress: string;

  @IsString()
  @IsNotEmpty()
  tokenId: string; // NFT ID

  @IsString()
  @IsNotEmpty()
  tokenAddress: string; // ERC20 Token Address

  @IsString() // Price as BigNumber string
  @IsNotEmpty()
  pricePerToken: string;

  @IsString() // Amount as BigNumber string
  @IsNotEmpty()
  amount: string; // Amount of tokens listed

  @IsBoolean()
  active: boolean;
  
  @IsString()
  @IsNotEmpty()
  currency: string; // 'USDC' instead of 'ETH'
} 