import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum ExpenseStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PAID = 'paid',
}

@Entity('expense_records')
export class ExpenseRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column() // Link to the DAO proposal ID
  daoProposalId: string;

  @Column() // Optional: Link to a Property entity
  propertyNftId: string;

  @Column()
  description: string;

  @Column('decimal', { precision: 18, scale: 6 })
  amount: number;

  @Column()
  currency: string;

  @Column({ type: 'enum', enum: ExpenseStatus, default: ExpenseStatus.PENDING })
  status: ExpenseStatus;

  @Column({ nullable: true })
  paymentTransactionHash?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
} 