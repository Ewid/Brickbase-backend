import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('cached_properties')
export class CachedProperty {
  @PrimaryColumn()
  id: string; // NFT address

  @Column()
  @Index()
  tokenId: number;

  @Column()
  @Index()
  tokenAddress: string;

  @Column('jsonb')
  metadata: any;

  @Column()
  totalSupply: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', default: () => "CURRENT_TIMESTAMP + interval '1 hour'" })
  expiresAt: Date;
} 