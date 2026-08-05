import { EmailService } from './email.service';

describe('EmailService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('logs instead of sending (fails open) when SMTP_HOST is not configured', async () => {
    delete process.env.SMTP_HOST;
    const service = new EmailService();
    const result = await service.send('owner@acme.test', 'Subject', 'Body text');
    expect(result).toEqual({ sent: false });
  });
});
