import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body of the public pairing endpoint (`POST /legacy-import/connections/pair`),
 * called by the connector itself, not an authenticated SH ERP user.
 * `pairingCode` is the only universal field; the rest is today's
 * GOOGLE_APPS_SCRIPT provider's own pairing payload shape
 * (`ScriptApp.getService().getUrl()` + version info) — the global
 * ValidationPipe here runs with `whitelist`+`forbidNonWhitelisted`, so a
 * genuinely different future provider's pairing payload would need either
 * its own endpoint/DTO or an extension of this one; not solved generically
 * here since only one provider exists today (disclosed simplification, not
 * an oversight).
 */
export class CompletePairingDto {
  @ApiProperty()
  @IsString()
  @MaxLength(32)
  pairingCode!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  webAppUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  protocolVersion?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  connectorVersion?: string;
}
