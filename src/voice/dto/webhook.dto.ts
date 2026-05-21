import { IsString, IsIn, IsOptional } from 'class-validator';

export class RetellWebhookDto {
  @IsIn(['call_started', 'call_ended', 'call_analyzed'])
  event: string;

  call: {
    call_id: string;
    agent_id: string;
    from_number?: string;
    transcript?: string;
    call_analysis?: {
      call_summary?: string;
    };
    duration_ms?: number;
    end_timestamp?: number;
  };
}
