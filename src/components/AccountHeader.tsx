import { AppHeader } from './AppHeader';
import { SignOutButton } from './SignOutButton';

/** Header for signed-in pages: logo (to the dashboard), the account's email and sign-out. */
export function AccountHeader({ email }: { email: string }) {
  return (
    <AppHeader href="/dashboard">
      <span className="app-email" title={email}>
        <span className="sr-only">Signed in as </span>
        {email}
      </span>
      <SignOutButton />
    </AppHeader>
  );
}
