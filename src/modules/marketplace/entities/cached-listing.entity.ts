import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('cached_listings')
export class CachedListing {
  @PrimaryColumn()
  listingId: number;

  @Column()
  seller: string;

  @Column()
  @Index()
  nftAddress: string;

  @Column()
  tokenId: string;

  @Column()
  @Index()
  tokenAddress: string;

  @Column()
  pricePerToken: string;

  @Column()
  amount: string;

  @Column()
  active: boolean;

  @Column()
  currency: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', default: () => "CURRENT_TIMESTAMP + interval '5 minutes'" })
  expiresAt: Date;
} 