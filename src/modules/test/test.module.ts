import { Module } from '@nestjs/common';
import { TestController } from './test.controller';
import { CacheModule as AppCacheModule } from '../cache/cache.module'; // Renamed to avoid conflict with @nestjs/cache-manager 
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    AppCacheModule, // Use the aliased import
    TypeOrmModule.forFeature([]), 
  ],
  controllers: [TestController],
})
export class TestModule {} 