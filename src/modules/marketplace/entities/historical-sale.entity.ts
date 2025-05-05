import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('historical_sales')
export class HistoricalSale {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  propertyNftId: string; // Or reference a Property entity if you create one

  @Column()
  buyerAddress: string;

  @Column()
  sellerAddress: string;

  @Column({ type: 'varchar' }) // Store token amount as string (from BigInt)
  tokenAmount: string;

  @Column('decimal', { precision: 18, scale: 6 }) // Adjust precision/scale as needed
  price: number; // This is the total price in USDC

  @Column()
  currency: string; // e.g., 'ETH' or token address

  @Column()
  transactionHash: string;

  @CreateDateColumn()
  timestamp: Date;
} 