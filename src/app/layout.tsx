import { Inter } from 'next/font/google';
import './globals.css';

// Inter is the open-source substitute DESIGN.md recommends for the heavy display sans.
const inter = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '600', '700', '800'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata = {
  title: 'Accel Business — Connectivity for India’s MSMEs',
  description:
    'Business broadband, postpaid, Wi-Fi and digital tools for kirana stores, clinics, coaching centres, small manufacturers, CA firms and restaurants.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
