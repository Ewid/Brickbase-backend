import { Controller, Get, Param, Logger, ParseUUIDPipe, Query } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { PropertyDto } from './dto/property.dto'; // Import from DTO file
import { CacheService } from '../cache/cache.service';

@Controller('properties')
export class PropertiesController {
  private readonly logger = new Logger(PropertiesController.name);

  constructor(
    private readonly propertiesService: PropertiesService,
    private readonly cacheService: CacheService,
  ) {}

  @Get()
  async findAll(): Promise<PropertyDto[]> {
    this.logger.log('GET /properties called');
    return this.propertiesService.findAllProperties();
  }

  @Get('token/:address')
  async findByTokenAddress(@Param('address') address: string): Promise<PropertyDto | null> {
    this.logger.log(`GET /properties/token/${address} called`);
    return this.propertiesService.getPropertyDetailsByTokenAddress(address);
  }

  @Get('owned/:address')
  async getPropertiesOwnedByUser(@Param('address') address: string): Promise<any[]> {
    this.logger.log(`GET /properties/owned/${address} called`);
    return this.propertiesService.findPropertiesOwnedByUser(address);
  }

  @Get(':id')
  // Assuming property ID (NFT ID) is not necessarily a UUID, keep as string for now.
  // If it *is* a UUID, use `@Param('id', ParseUUIDPipe) id: string`
  async findOne(
    @Param('id') id: string,
    @Query('tokenId') tokenId?: string
  ): Promise<PropertyDto | null> {
    this.logger.log(`GET /properties/${id} called${tokenId ? ` with tokenId=${tokenId}` : ''}`);
    // Pass the tokenId as a number if provided, otherwise undefined
    return this.propertiesService.getPropertyDetails(id, tokenId ? parseInt(tokenId) : undefined);
  }

  @Get('admin/rebuild-cache')
  async rebuildCache(): Promise<{ success: boolean; message: string }> {
    this.logger.log('Admin cache rebuild requested');
    try {
      await this.propertiesService.resetAndRebuildCache();
      return { success: true, message: 'Property cache rebuilt successfully' };
    } catch (error) {
      return { success: false, message: `Error rebuilding cache: ${error.message}` };
    }
  }
}
