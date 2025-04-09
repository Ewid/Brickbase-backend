import { Controller, Get, Param, Logger, ParseUUIDPipe } from '@nestjs/common';
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

  @Get(':id')
  // Assuming property ID (NFT ID) is not necessarily a UUID, keep as string for now.
  // If it *is* a UUID, use `@Param('id', ParseUUIDPipe) id: string`
  async findOne(@Param('id') id: string): Promise<PropertyDto | null> {
    this.logger.log(`GET /properties/${id} called`);
     // Note: The service method needs to be updated to return matching DTO
    return this.propertiesService.getPropertyDetails(id);
  }
}
