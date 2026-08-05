import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class UpdateMembershipRoleDto {
  @ApiProperty({ description: "One of this company's Role ids (see GET /roles)." })
  @IsUUID()
  roleId!: string;
}
