import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** Pages that need a signed-in customer. Each page also checks the session itself; this only redirects early. */
const PROTECTED = [/^\/dashboard(\/|$)/, /^\/bot(\/|$)/];
/** Pages a signed-in customer skips: the landing page and the sign-in forms go straight to the dashboard. */
const SIGNED_IN_SKIPS = new Set(['/', '/login', '/signup']);

/**
 * Refreshes the Supabase session cookies on every page request (server components can't write cookies),
 * then redirects: signed-in visitors from the landing page to /dashboard, signed-out ones to /login.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // getUser() checks the token with Supabase and refreshes it if needed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const redirect = (to: URL) => {
    const res = NextResponse.redirect(to);
    // Keep any refreshed session cookies.
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  if (user && SIGNED_IN_SKIPS.has(pathname)) {
    const next = request.nextUrl.searchParams.get('next');
    const target = pathname !== '/' && next?.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
    return redirect(new URL(target, request.url));
  }
  if (!user && PROTECTED.some((p) => p.test(pathname))) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', pathname + search);
    return redirect(login);
  }
  return response;
}

export const config = {
  // Pages only: not API routes (they check the session themselves), Next assets, or static files.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|bot-voice|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|mp3|json|txt)$).*)'],
};
