import { Controller, Get, Inject, Logger } from '@nestjs/common';
import { Cache } from 'cache-manager'; // For Redis
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectConnection } from '@nestjs/typeorm'; // For TypeORM
import { Connection } from 'typeorm'; // For TypeORM

@Controller('api/test')
export class TestController {
  private readonly logger = new Logger(TestController.name);

  constructor(
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @InjectConnection() private dbConnection: Connection,
  ) {}

  @Get('redis')
  async testRedis() {
    this.logger.log('GET /api/test/redis called');
    try {
      await this.cacheManager.set('test-key', 'connected-to-redis', { ttl: 60 } as any); // TTL of 60 seconds, cast to any for cache-manager v5+
      const value = await this.cacheManager.get('test-key');
      return { status: 'Redis connected', value };
    } catch (error) {
      this.logger.error('Redis connection error:', error);
      // Ensure error is serializable
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { status: 'Redis connection failed', error: errorMessage };
    }
  }

  @Get('database')
  async testDatabase() {
    this.logger.log('GET /api/test/database called');
    try {
      const result = await this.dbConnection.query('SELECT NOW() as now;');
      return { status: 'Database connected', timestamp: result[0]?.now };
    } catch (error) {
      this.logger.error('Database connection error:', error);
      // Ensure error is serializable
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { status: 'Database connection failed', error: errorMessage };
    }
  }
} 