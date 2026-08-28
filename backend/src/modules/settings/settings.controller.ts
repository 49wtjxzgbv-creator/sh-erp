import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { UpdateCompanyBrandingDto } from './dto/update-branding.dto';
import { UpdateCompanyRequisitesDto } from './dto/update-requisites.dto';
import { UpdateCompanySettingsDto } from './dto/update-settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller({ path: 'company-settings', version: '1' })
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: "Get the company's settings (VAT rate, dashboard widgets, daily digest)." })
  async get(@CurrentUser() user: RequestUser) {
    return this.settingsService.getSettings(user);
  }

  @Patch()
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Update company settings.' })
  async update(@CurrentUser() user: RequestUser, @Body() dto: UpdateCompanySettingsDto) {
    return this.settingsService.updateSettings(user, dto);
  }

  @Get('branding')
  @ApiOperation({ summary: "Get the company's branding (logo/favicon file references)." })
  async getBranding(@CurrentUser() user: RequestUser) {
    return this.settingsService.getBranding(user);
  }

  @Patch('branding')
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Update company branding.' })
  async updateBranding(@CurrentUser() user: RequestUser, @Body() dto: UpdateCompanyBrandingDto) {
    return this.settingsService.updateBranding(user, dto);
  }

  @Get('requisites')
  @ApiOperation({ summary: "Get the company's legal/contact requisites (name, tax id, address, bank details)." })
  async getRequisites(@CurrentUser() user: RequestUser) {
    return this.settingsService.getRequisites(user);
  }

  @Patch('requisites')
  @RequirePermissions('settings:manage')
  @ApiOperation({ summary: 'Update company requisites.' })
  async updateRequisites(@CurrentUser() user: RequestUser, @Body() dto: UpdateCompanyRequisitesDto) {
    return this.settingsService.updateRequisites(user, dto);
  }
}
