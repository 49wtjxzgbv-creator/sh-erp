import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class ImpersonateDto {
  @ApiPropertyOptional({
    description:
      'Specific user to impersonate as, must belong to the target company. If omitted, defaults to that ' +
      "company's original signup owner (its earliest Admin-role membership).",
  })
  @IsOptional()
  @IsUUID()
  userId?: string;
}
