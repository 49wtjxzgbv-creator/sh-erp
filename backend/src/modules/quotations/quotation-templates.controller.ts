import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CreateQuotationTemplateDto, UpdateQuotationTemplateDto } from './dto/quotation-template.dto';
import { QuotationTemplatesService } from './quotation-templates.service';

@ApiTags('quotation-templates')
@Controller({ path: 'quotation-templates', version: '1' })
export class QuotationTemplatesController {
  constructor(private readonly templatesService: QuotationTemplatesService) {}

  @Post()
  @RequirePermissions('quotations:manage')
  @ApiOperation({ summary: 'Create a quotation PDF template (design settings only — never live prices).' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateQuotationTemplateDto) {
    return this.templatesService.create(user, dto);
  }

  @Get()
  @RequirePermissions('quotations:read')
  @ApiOperation({ summary: 'List quotation templates.' })
  async query(@CurrentUser() user: RequestUser) {
    return this.templatesService.query(user);
  }

  @Get(':id')
  @RequirePermissions('quotations:read')
  @ApiOperation({ summary: 'Get one quotation template.' })
  async findOne(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.templatesService.findOne(user, id);
  }

  @Patch(':id')
  @RequirePermissions('quotations:manage')
  @ApiOperation({ summary: 'Update a quotation template.' })
  async update(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: UpdateQuotationTemplateDto) {
    return this.templatesService.update(user, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('quotations:manage')
  @ApiOperation({ summary: 'Soft-delete a quotation template.' })
  async remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.templatesService.remove(user, id);
  }
}
