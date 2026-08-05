import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CompanyService } from './company.service';
import { CreateCompanyDto } from './dto/create-company.dto';

@ApiTags('tenancy')
@Controller({ path: 'companies', version: '1' })
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Public()
  @Post('signup')
  @ApiOperation({ summary: 'Create a new company and its first (Admin) user.' })
  @ApiResponse({ status: 201, description: 'Company and owner user created.' })
  @ApiResponse({ status: 409, description: 'Slug or email already in use.' })
  async signup(@Body() dto: CreateCompanyDto) {
    const { company } = await this.companyService.createCompany(dto);
    return { id: company.id, slug: company.slug, name: company.name };
  }
}
