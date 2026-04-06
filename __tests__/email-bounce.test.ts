/**
 * Tests for the Resend webhook bounce handler.
 *
 * Supabase admin client is mocked so no real DB calls are made. We verify:
 * - email.bounced → sets email_briefing_enabled = false for the affected user
 * - email.complained → same behaviour
 * - Unknown event type → 200 no-op
 * - Missing secret → 401
 * - User not found in auth → 200 with action: user_not_found
 */

import { NextResponse } from 'next/server';

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockUpdate  = jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
const mockFrom    = jest.fn().mockReturnValue({ update: mockUpdate });
const mockGetUser = jest.fn();

const mockAdmin = {
  from: mockFrom,
  auth: {
    admin: {
      listUsers: jest.fn().mockResolvedValue({
        data: {
          users: [{ id: 'user-uuid-123', email: 'user@example.com' }],
        },
        error: null,
      }),
    },
  },
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockAdmin),
}));

// ── Helper: build a fake Request ──────────────────────────────────────────────

function makeRequest(
  body: object,
  secret?: string,
): Request {
  const url = `http://localhost/api/webhooks/resend${secret ? `?secret=${secret}` : ''}`;
  return new Request(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockFrom.mockReturnValue({
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockResolvedValue({ error: null }),
    }),
  });
  mockAdmin.auth.admin.listUsers.mockResolvedValue({
    data: { users: [{ id: 'user-uuid-123', email: 'user@example.com' }] },
    error: null,
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL   = 'https://fake.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY  = 'fake-service-key';
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.RESEND_WEBHOOK_SECRET;
});

// Import after mocks are set up
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { POST } = require('../app/api/webhooks/resend/route');

describe('POST /api/webhooks/resend', () => {
  describe('auth', () => {
    it('returns 401 when secret is set and request has wrong secret', async () => {
      process.env.RESEND_WEBHOOK_SECRET = 'correct-secret';
      const req = makeRequest({ type: 'email.bounced', data: { to: ['user@example.com'] } }, 'wrong-secret');
      const res: NextResponse = await POST(req);
      expect(res.status).toBe(401);
    });

    it('allows request when secret matches', async () => {
      process.env.RESEND_WEBHOOK_SECRET = 'correct-secret';
      const req = makeRequest({ type: 'email.bounced', data: { to: ['user@example.com'] } }, 'correct-secret');
      const res: NextResponse = await POST(req);
      expect(res.status).toBe(200);
    });

    it('allows request when RESEND_WEBHOOK_SECRET is not set', async () => {
      const req = makeRequest({ type: 'email.bounced', data: { to: ['user@example.com'] } });
      const res: NextResponse = await POST(req);
      expect(res.status).toBe(200);
    });
  });

  describe('email.bounced', () => {
    it('disables email for the bounced user', async () => {
      const req = makeRequest({ type: 'email.bounced', data: { to: ['user@example.com'] } });
      const res: NextResponse = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.action).toBe('disabled');
      expect(mockFrom).toHaveBeenCalledWith('portfolios');
    });
  });

  describe('email.complained', () => {
    it('also disables email (spam complaint treated same as bounce)', async () => {
      const req = makeRequest({ type: 'email.complained', data: { to: ['user@example.com'] } });
      const res: NextResponse = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.action).toBe('disabled');
    });
  });

  describe('unknown event type', () => {
    it('returns 200 with action: ignored (no DB write)', async () => {
      const req = makeRequest({ type: 'email.opened', data: { to: ['user@example.com'] } });
      const res: NextResponse = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.action).toBe('ignored');
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  describe('user not found in auth', () => {
    it('returns 200 with action: user_not_found', async () => {
      mockAdmin.auth.admin.listUsers.mockResolvedValueOnce({
        data: { users: [] },
        error: null,
      });
      const req = makeRequest({ type: 'email.bounced', data: { to: ['unknown@example.com'] } });
      const res: NextResponse = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.action).toBe('user_not_found');
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  describe('invalid JSON body', () => {
    it('returns 400', async () => {
      const url = 'http://localhost/api/webhooks/resend';
      const req = new Request(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    'not-json',
      });
      const res: NextResponse = await POST(req);
      expect(res.status).toBe(400);
    });
  });
});
