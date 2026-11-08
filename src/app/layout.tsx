import { Inter, Noto_Sans_Devanagari, Noto_Sans_Tamil } from 'next/font/google';
import './globals.css';

// Inter is the open-source substitute DESIGN.md recommends for the heavy display sans.
const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '600', '700', '800'],
  variable: '--font-inter',
  display: 'swap',
});

// Accel Bot's Hindi and Tamil. They sit after Inter in the stack, so Latin stays in Inter and only Indic glyphs
// fall through to Noto; unicode-range keeps the files from loading on English pages. Indic text is set at 400
// and up (bot.css), so 300 and 800 aren't loaded. The metric-matched fallback is Arial, which has no Indic
// glyphs, so it is turned off.
const notoDevanagari = Noto_Sans_Devanagari({
  subsets: ['devanagari'],
  weight: ['400', '600', '700'],
  variable: '--font-noto-devanagari',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});
const notoTamil = Noto_Sans_Tamil({
  subsets: ['tamil'],
  weight: ['400', '600', '700'],
  variable: '--font-noto-tamil',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

export const metadata = {
  title: 'Accel Business — Connectivity for India’s MSMEs',
  description:
    'Business broadband, postpaid, Wi-Fi and digital tools for kirana stores, clinics, coaching centres, small manufacturers, CA firms and restaurants.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${notoDevanagari.variable} ${notoTamil.variable}`}>
      <body>{children}</body>
    </html>
  );
}
