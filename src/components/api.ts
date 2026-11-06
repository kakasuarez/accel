// Browser-side helpers for the app's JSON API. Errors always arrive as { error: { code, message } }.

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const NETWORK_MESSAGE = 'We couldn’t reach Accel. Check your connection and try again.';

/** Calls an API route and returns its JSON body, or throws an ApiFailure carrying the server's message. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers: json === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: json === undefined ? rest.body : JSON.stringify(json),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiFailure(0, 'network', NETWORK_MESSAGE);
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    throw new ApiFailure(res.status, body?.error?.code ?? 'error', body?.error?.message ?? 'Something went wrong. Please try again.');
  }
  return body as T;
}

/** Only same-site paths: "/x" but never "//host" (open redirect). */
export function safeNext(next: string | null | undefined): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : null;
}
