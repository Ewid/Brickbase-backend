import { IsString, IsObject, IsNotEmpty, IsNumber } from 'class-validator';

export class PropertyDto {
  @IsString()
  @IsNotEmpty()
  id: string; // The NFT Contract Address

  @IsNumber()
  tokenId: number;

  @IsString()
  @IsNotEmpty()
  tokenAddress: string; // Property's specific ERC20 token address

  @IsObject()
  metadata: any; // Define more strictly based on actual metadata structure

  @IsString() // Assuming total supply is returned as a string (BigNumber)
  @IsNotEmpty()
  totalSupply: string;
} 