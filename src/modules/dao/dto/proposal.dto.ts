// src/modules/dao/dto/proposal.dto.ts
import { IsNumber, IsString, IsBoolean, IsNotEmpty, IsOptional, IsEthereumAddress } from 'class-validator';

export class ProposalDto {
  // Based on PropertyDAO.Proposal struct
  @IsNumber()
  id: number;

  @IsString()
  @IsNotEmpty()
  proposer: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString() // Target contract address
  @IsNotEmpty()
  targetContract: string;

  @IsString() // Function call data (hex string)
  @IsNotEmpty()
  functionCall: string;

  @IsEthereumAddress() // Added validation
  propertyTokenAddress: string;

  @IsString() // votesFor as BigNumber string
  @IsNotEmpty()
  votesFor: string;

  @IsString() // votesAgainst as BigNumber string
  @IsNotEmpty()
  votesAgainst: string;

  @IsNumber() // startTime (Unix timestamp)
  startTime: number;

  @IsNumber() // endTime (Unix timestamp)
  endTime: number;

  @IsBoolean()
  executed: boolean;

  @IsBoolean()
  passed: boolean;

  // Add state field from getProposalState
  @IsString()
  @IsOptional() // This will be added by the service, not from the raw struct
  state?: string;
} 