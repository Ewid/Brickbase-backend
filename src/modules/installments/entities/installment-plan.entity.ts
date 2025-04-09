import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne } from 'typeorm';
// Import User entity if you create one
// import { User } from '../../users/entities/user.entity';

export enum InstallmentStatus {
  ACTIVE = 'active',
  PAID = 'paid',
  DEFAULTED = 'defaulted',
  CANCELLED = 'cancelled',
}

@Entity('installment_plans')
export class InstallmentPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // @ManyToOne(() => User, user => user.installmentPlans) // Example if User entity exists
  // user: User;
  @Column() // Placeholder for user identifier (e.g., wallet address)
  userId: string;

  @Column() // Identifier for the listing or property being paid for
  listingId: string; // Or propertyNftId

  @Column('decimal', { precision: 18, scale: 6 })
  totalAmount: number;

  @Column('decimal', { precision: 18, scale: 6 })
  amountPaid: number;

  @Column()
  numberOfInstallments: number;

  @Column()
  installmentAmount: number;

  @Column()
  currency: string;

  @Column({ type: 'timestamp with time zone' }) // Store due date with timezone
  nextDueDate: Date;

  @Column({ type: 'enum', enum: InstallmentStatus, default: InstallmentStatus.ACTIVE })
  status: InstallmentStatus;

  // Add fields for payment history references if needed

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
} 