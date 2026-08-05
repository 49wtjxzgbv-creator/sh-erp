import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ConfirmAiActionDto {
  @ApiProperty({ description: 'The PendingAiAction id returned in a previous askFullAssistant response\'s pendingConfirmation.' })
  @IsUUID()
  pendingActionId!: string;
}

export class CancelAiActionDto {
  @ApiProperty()
  @IsUUID()
  pendingActionId!: string;
}
