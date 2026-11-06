import { ElevenLabsError, isConfigured, synthesize } from '@/lib/bot/elevenlabs';
import { isSpeakable } from '@/lib/bot/speakable';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Only the bot's own lines (fixed lines and backend questions) can be spoken, so the key can't be used as an
// open TTS proxy.
/** POST /api/bot/tts { text } → audio/mpeg */
export async function POST(req: Request) {
  if (!isConfigured()) return Response.json({ error: 'Text-to-speech is not configured.' }, { status: 501 });

  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text : '';
  if (!isSpeakable(text)) return Response.json({ error: 'Unknown line.' }, { status: 400 });

  try {
    const audio = await synthesize(text);
    return new Response(new Uint8Array(audio), {
      headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=86400' },
    });
  } catch (err) {
    if (err instanceof ElevenLabsError) {
      console.error(err.message);
      return Response.json({ error: 'Text-to-speech failed.' }, { status: 502 });
    }
    throw err;
  }
}
