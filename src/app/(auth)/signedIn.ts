import 'server-only';
import { currentUser } from '@/lib/auth/session';

/** The signed-in user, or null, including when auth isn't configured (the form then shows the API's error). */
export async function signedInUser() {
  try {
    return await currentUser();
  } catch {
    return null;
  }
}
