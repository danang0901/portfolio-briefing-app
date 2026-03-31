import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — Portfolio Briefing',
};

export default function PrivacyPage() {
  return (
    <main style={{ background: '#030712', minHeight: '100vh', color: '#f9fafb', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '640px', margin: '0 auto', padding: '48px 24px' }}>

        <Link href="/" style={{ color: '#6b7280', fontSize: '13px', textDecoration: 'none', display: 'inline-block', marginBottom: '32px' }}>
          ← Back to Portfolio Briefing
        </Link>

        <h1 style={{ fontSize: '22px', fontWeight: 600, marginBottom: '8px' }}>Privacy Policy</h1>
        <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '40px' }}>Last updated: 30 March 2026</p>

        <section style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#e5e7eb', marginBottom: '12px' }}>What we collect</h2>
          <p style={{ fontSize: '14px', lineHeight: '1.7', color: '#9ca3af' }}>
            When you sign in with Google, we store your email address and a unique user ID via Supabase. We do not store your Google password or any other Google account data.
          </p>
          <p style={{ fontSize: '14px', lineHeight: '1.7', color: '#9ca3af', marginTop: '10px' }}>
            Your portfolio holdings (tickers, units, exchange) are stored in Supabase against your user ID. If you use the app without signing in, holdings are stored only in your browser's localStorage and never sent to our servers.
          </p>
          <p style={{ fontSize: '14px', lineHeight: '1.7', color: '#9ca3af', marginTop: '10px' }}>
            Generated briefings, including AI perspective signals (Accumulate Thesis / Monitor / Review Exposure / Thesis Broken), are stored in Supabase for 30 days to power the 24-hour cache and signal accuracy tracking. After 30 days, briefings may be automatically deleted.
          </p>
          <p style={{ fontSize: '14px', lineHeight: '1.7', color: '#9ca3af', marginTop: '10px' }}>
            Signal logs (ticker, signal, price at generation time) are stored to compute historical accuracy statistics. These logs are associated with your user ID and are only visible to you.
          </p>
        </section>

        <section style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#e5e7eb', marginBottom: '12px' }}>How we use your data</h2>
          <ul style={{ fontSize: '14px', lineHeight: '1.9', color: '#9ca3af', paddingLeft: '20px' }}>
            <li>To generate personalised AI briefings for your specific holdings</li>
            <li>To cache your daily briefing so it loads instantly on repeat visits</li>
            <li>To track signal accuracy over time (visible only to you)</li>
            <li>To send you a morning briefing email, if you have opted in</li>
          </ul>
          <p style={{ fontSize: '14px', lineHeight: '1.7', color: '#9ca3af', marginTop: '12px' }}>
            We do not sell your data. We do not share your portfolio holdings with any third party. Your email address is used only for authentication and, if opted in, briefing delivery.
          </p>
        </section>

        <section style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#e5e7eb', marginBottom: '12px' }}>Email communications</h2>
          <p style={{ fontSize: '14px', lineHeight: '1.7', color: '#9ca3af' }}>
            We will only send you emails if you have explicitly opted in to morning briefing delivery. Every email includes a one-click unsubscribe link. We comply with the Australian Spam Act 2003.
          </p>
        </section>

        <section style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#e5e7eb', marginBottom: '12px' }}>Third-party services</h2>
          <ul style={{ fontSize: '14px', lineHeight: '2', color: '#9ca3af', paddingLeft: '20px' }}>
            <li><strong style={{ color: '#e5e7eb' }}>Supabase</strong> — authentication and database (supabase.com)</li>
            <li><strong style={{ color: '#e5e7eb' }}>Anthropic</strong> — AI briefing generation via Claude API. Your portfolio and news context are sent to Anthropic for synthesis. Anthropic's privacy policy applies: anthropic.com/privacy</li>
            <li><strong style={{ color: '#e5e7eb' }}>Yahoo Finance</strong> — stock news and price data (publicly available, no auth)</li>
            <li><strong style={{ color: '#e5e7eb' }}>ASX</strong> — company announcements feed (public data)</li>
            <li><strong style={{ color: '#e5e7eb' }}>Vercel</strong> — hosting and deployment</li>
            <li><strong style={{ color: '#e5e7eb' }}>TradingView</strong> — chart embeds (TradingView's privacy policy applies for chart views)</li>
          </ul>
        </section>

        <section style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#e5e7eb', marginBottom: '12px' }}>Data retention and deletion</h2>
          <p style={{ fontSize: '14px', lineHeight: '1.7', color: '#9ca3af' }}>
            Briefings and signal logs are retained for 30 days. Portfolio holdings are retained as long as your account is active. To delete your account and all associated data, contact us at the address below.
          </p>
        </section>

        <section style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#e5e7eb', marginBottom: '12px' }}>Your rights (Australian Privacy Act 1988)</h2>
          <p style={{ fontSize: '14px', lineHeight: '1.7', color: '#9ca3af' }}>
            You have the right to access, correct, or delete the personal information we hold about you. You may also opt out of email communications at any time.
          </p>
        </section>

        <section style={{ marginBottom: '40px' }}>
          <h2 style={{ fontSize: '15px', fontWeight: 600, color: '#e5e7eb', marginBottom: '12px' }}>Contact</h2>
          <p style={{ fontSize: '14px', lineHeight: '1.7', color: '#9ca3af' }}>
            For privacy enquiries or data deletion requests, open an issue at{' '}
            <a href="https://github.com/danang0901/portfolio-briefing-app/issues" style={{ color: '#3b82f6' }}>
              github.com/danang0901/portfolio-briefing-app
            </a>.
          </p>
        </section>

        <p style={{ fontSize: '12px', color: '#4b5563', borderTop: '1px solid #1f2937', paddingTop: '24px' }}>
          Portfolio Briefing is not a licensed financial adviser. Briefings are for informational purposes only and do not constitute financial advice. Always consult a qualified financial adviser before making investment decisions.
        </p>
      </div>
    </main>
  );
}
