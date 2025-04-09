import { Controller, Get, Param, Logger } from '@nestjs/common';
import { PropertiesService } from './properties.service';

// Basic DTOs (can be moved to separate files later)
class PropertyDto {
  // Define properties based on what getPropertyDetails returns
  id: string;
  // metadata: any;
  // totalSupply: string;
}

@Controller('properties')
export class PropertiesController {
  private readonly logger = new Logger(PropertiesController.name);

  constructor(private readonly propertiesService: PropertiesService) {}

  @Get()
  async findAll(): Promise<PropertyDto[]> {
    this.logger.log('GET /properties called');
    return this.propertiesService.findAllProperties();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<PropertyDto | null> {
    this.logger.log(`GET /properties/${id} called`);
    return this.propertiesService.getPropertyDetails(id);
  }
}
