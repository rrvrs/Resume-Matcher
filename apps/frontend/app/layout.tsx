import type { Metadata } from 'next';
import { Geist, Noto_Sans_SC, Space_Grotesk } from 'next/font/google';
import './(default)/css/globals.css';

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  display: 'swap',
});

const geist = Geist({
  variable: '--font-geist',
  subsets: ['latin'],
  display: 'swap',
});

// CJK fallback for Chinese/Japanese/Korean resume content. Explicit
// `preload: false` because the CJK unicode-ranges are not preloadable anyway
// (Google exposes no `chinese-simplified` subset to next/font) and we don't
// want to ship a large font to users who never render CJK. Turbopack already
// skips preloading it, but the legacy webpack font path errors on a preloaded
// font declared without `subsets`, so this keeps both pipelines building.
const notoSansSC = Noto_Sans_SC({
  variable: '--font-noto-sans-sc',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  preload: false,
});

export const metadata: Metadata = {
  title: 'Resume Matcher',
  description: 'Build your resume with Resume Matcher',
  applicationName: 'Resume Matcher',
  keywords: ['resume', 'matcher', 'job', 'application'],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-US" className="h-full" suppressHydrationWarning>
      <body
        className={`${geist.variable} ${spaceGrotesk.variable} ${notoSansSC.variable} antialiased bg-background text-ink-soft min-h-full`}
      >
        {children}
      </body>
    </html>
  );
}
