import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { CachedProperty } from './cached-property.entity';

@Entity('user_property_balances')
export class UserPropertyBalance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  userAddress: string;

  @Column()
  @Index()
  propertyTokenAddress: string;

  @Column()
  propertyNftAddress: string;

  @Column()
  tokenId: number;

  @Column()
  balance: string;

  @ManyToOne(() => CachedProperty)
  @JoinColumn({ name: 'propertyNftAddress', referencedColumnName: 'id' })
  cachedProperty: CachedProperty;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', default: () => "CURRENT_TIMESTAMP + interval '15 minutes'" })
  expiresAt: Date;
} 