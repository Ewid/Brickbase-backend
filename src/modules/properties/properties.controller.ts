import { Controller, Get, Param, Logger, ParseUUIDPipe, Query } from '@nestjs/common';
import { PropertiesService } from './properties.service';
import { PropertyDto } from './dto/property.dto'; // Import from DTO file

@Controller('properties')
export class PropertiesController {
  private readonly logger = new Logger(PropertiesController.name);

  constructor(private readonly propertiesService: PropertiesService) {}

  @Get()
  async findAll(): Promise<PropertyDto[]> {
    this.logger.log('GET /properties called');
    // Note: The service method needs to be updated to return matching DTO
    return this.propertiesService.findAllProperties();
  }

  @Get('token/:address')
  async findByTokenAddress(@Param('address') address: string): Promise<PropertyDto | null> {
    this.logger.log(`GET /properties/token/${address} called`);
    return this.propertiesService.getPropertyDetailsByTokenAddress(address);
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
}
