import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { LowStockDigestService } from './low-stock-digest.service';
import { NotificationsController } from './notifications.controller';

@Module({
  controllers: [NotificationsController],
  providers: [EmailService, LowStockDigestService],
  exports: [EmailService, LowStockDigestService],
})
export class NotificationsModule {}
