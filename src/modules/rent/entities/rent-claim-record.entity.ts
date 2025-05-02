import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('rent_claim_records')
export class RentClaimRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  propertyTokenAddress: string;

  @Column()
  @Index()
  tokenHolderAddress: string;

  @Column()
  amount: string; // Store as string (BigNumber format)

  @Column()
  currency: string; // e.g., 'USDC'

  @Column()
  @Index()
  transactionHash: string;

  @CreateDateColumn()
  @Index()
  timestamp: Date;
} 