import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Portfolio Briefing',
  description: 'Stop spending 20 minutes on Reddit every morning. AI-powered fund manager briefings — ADD/HOLD/TRIM/EXIT signals with technical analysis and live news for your ASX and US portfolio.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
