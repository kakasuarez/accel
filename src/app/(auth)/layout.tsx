import type { Viewport } from 'next';
import { AppHeader } from '@/components/AppHeader';
import '../app.css';

export const viewport: Viewport = { themeColor: '#ffffff' };

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app">
      <AppHeader href="/" />
      <main className="auth-main">{children}</main>
    </div>
  );
}
