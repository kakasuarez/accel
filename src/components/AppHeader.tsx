import Link from 'next/link';
import { AccelMark } from './AccelMark';

/** The signed-in app's top bar: the Accel mark on the left, account controls on the right. */
export function AppHeader({ href = '/', children }: { href?: string; children?: React.ReactNode }) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Link href={href} className="brand app-brand" aria-label="Accel Business home">
          <AccelMark />
          <span className="brand-name">
            Accel
            <small>Business</small>
          </span>
        </Link>
        {children && <div className="app-header-actions">{children}</div>}
      </div>
    </header>
  );
}
