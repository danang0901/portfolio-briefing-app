import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Alex Rivera — Full-Stack Engineer",
  description:
    "Portfolio briefing for Alex Rivera, a full-stack software engineer specializing in building exceptional digital products.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="bg-slate-950 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
