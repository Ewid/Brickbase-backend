import { IsString, IsObject, IsNotEmpty } from 'class-validator';

export class PropertyDto {
  @IsString()
  @IsNotEmpty()
  id: string; // The NFT ID

  @IsObject()
  metadata: any; // Define more strictly based on actual metadata structure

  @IsString() // Assuming total supply is returned as a string (BigNumber)
  @IsNotEmpty()
  totalSupply: string;
} 