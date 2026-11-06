import type { Viewport } from 'next';
import '../app.css';

export const viewport: Viewport = { themeColor: '#ffffff' };

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className="app">{children}</div>;
}
