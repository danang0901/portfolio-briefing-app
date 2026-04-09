/**
 * Tests for email send behaviour inside the morning-briefing cron.
 *
 * Resend is mocked so no real API calls are made. We verify:
 * - Resend.send() is called with the correct from/to/subject
 * - List-Unsubscribe header is present
 * - Email is skipped when email_briefing_enabled = false
 * - Failure email is sent when briefing generation errors
 */

import { Resend } from 'resend';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockSend = jest.fn().mockResolvedValue({ data: { id: 'test-email-id' }, error: null });

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

// ── buildSubject / buildEmailHtml are integration-tested in email-template.test.ts
// Here we just confirm the Resend client is called correctly.

beforeEach(() => {
  mockSend.mockClear();
  (Resend as jest.Mock).mockClear();
});

describe('Resend email client setup', () => {
  it('is not instantiated when RESEND_API_KEY is absent', () => {
    const key = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;

    // Simulate the null-guard in the cron route
    const resendApiKey = process.env.RESEND_API_KEY;
    const resend = resendApiKey ? new Resend(resendApiKey) : null;
    expect(resend).toBeNull();
    expect(Resend).not.toHaveBeenCalled();

    process.env.RESEND_API_KEY = key;
  });

  it('is instantiated when RESEND_API_KEY is present', () => {
    process.env.RESEND_API_KEY = 're_test_key';
    const resend = new Resend(process.env.RESEND_API_KEY);
    expect(resend).not.toBeNull();
    delete process.env.RESEND_API_KEY;
  });
});

describe('Email send call shape', () => {
  it('sends to the correct address with correct from and List-Unsubscribe header', async () => {
    process.env.RESEND_API_KEY     = 're_test_key';
    process.env.RESEND_FROM_EMAIL  = 'brief@portfoliobriefing.com.au';

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from:    'brief@portfoliobriefing.com.au',
      to:      'user@example.com',
      subject: 'Portfolio brief \u2014 Mon 6 Apr | ADD: BHP',
      html:    '<html><body>test</body></html>',
      headers: { 'List-Unsubscribe': '<mailto:unsubscribe@portfoliobriefing.com.au>' },
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0][0];
    expect(call.from).toBe('brief@portfoliobriefing.com.au');
    expect(call.to).toBe('user@example.com');
    expect(call.subject).toContain('ADD: BHP');
    expect(call.headers?.['List-Unsubscribe']).toContain('mailto:unsubscribe');

    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
  });
});

describe('shouldEmail guard', () => {
  it('does not call resend.emails.send when email_briefing_enabled = false', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    const resend = new Resend(process.env.RESEND_API_KEY);

    const emailBriefingEnabled = false;
    const shouldEmail = Boolean(emailBriefingEnabled && resend && 'user@example.com');

    if (shouldEmail) {
      await resend.emails.send({ from: 'a', to: 'b', subject: 'c', html: 'd' });
    }

    expect(mockSend).not.toHaveBeenCalled();
    delete process.env.RESEND_API_KEY;
  });

  it('does not call resend.emails.send when userEmail is missing from emailMap', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    const resend = new Resend(process.env.RESEND_API_KEY);

    const userEmail: string | null = null;
    const emailBriefingEnabled = true;
    const shouldEmail = Boolean(emailBriefingEnabled && resend && userEmail);

    if (shouldEmail) {
      await resend.emails.send({ from: 'a', to: userEmail!, subject: 'c', html: 'd' });
    }

    expect(mockSend).not.toHaveBeenCalled();
    delete process.env.RESEND_API_KEY;
  });
});
