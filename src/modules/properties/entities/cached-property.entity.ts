import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, Index, Unique } from 'typeorm';

@Entity('cached_properties')
@Unique(['id', 'tokenId'])
export class CachedProperty {
  @PrimaryColumn()
  id: string; // NFT address

  @PrimaryColumn()
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
} 