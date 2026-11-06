import { isConfigured } from '@/lib/bot/elevenlabs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/bot/config: which server speech features are available. */
export function GET() {
  const on = isConfigured();
  return Response.json({ tts: on, stt: on });
}
