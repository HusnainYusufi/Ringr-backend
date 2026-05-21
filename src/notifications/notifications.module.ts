import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { NotificationsService } from './notifications.service';
import { NotificationProcessor } from './processors/notification.processor';
import { ReminderProcessor, SlotManagementProcessor } from './processors/reminder.processor';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'notifications' },
      { name: 'reminders' },
      { name: 'slot-management' },
    ),
  ],
  providers: [
    NotificationsService,
    NotificationProcessor,
    ReminderProcessor,
    SlotManagementProcessor,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
