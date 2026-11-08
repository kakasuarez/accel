import Link from 'next/link';
import { AppHeader } from './AppHeader';
import { SignOutButton } from './SignOutButton';

/** Header for signed-in pages: logo (to the dashboard), the account's email and sign-out. Admins also get a link to /admin. */
export function AccountHeader({ email, isAdmin = false }: { email: string; isAdmin?: boolean }) {
  return (
    <AppHeader href="/dashboard">
      <span className="app-email" title={email}>
        <span className="sr-only">Signed in as </span>
        {email}
      </span>
      {isAdmin && (
        <Link href="/admin" className="btn btn-outline-dark btn-sm">
          Admin
        </Link>
      )}
      <SignOutButton />
    </AppHeader>
  );
}
