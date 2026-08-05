import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RecordQcCheckDto } from './dto/qc-check.dto';
import { QcService } from './qc.service';

@ApiTags('quality')
@Controller({ path: 'qc-checks', version: '1' })
export class QcController {
  constructor(private readonly qcService: QcService) {}

  @Post()
  @RequirePermissions('qc:record')
  @ApiOperation({ summary: 'Record a QC check — flips the finished good\'s status between IN_STOCK (accepted) and REWORK.' })
  async recordCheck(@CurrentUser() user: RequestUser, @Body() dto: RecordQcCheckDto) {
    return this.qcService.recordCheck(user, dto);
  }

  @Get('finished-good/:finishedGoodId')
  @RequirePermissions('finished-goods:read')
  @ApiOperation({ summary: 'List QC checks recorded against a finished good.' })
  async findForFinishedGood(@CurrentUser() user: RequestUser, @Param('finishedGoodId') finishedGoodId: string) {
    return this.qcService.findForFinishedGood(user, finishedGoodId);
  }
}
