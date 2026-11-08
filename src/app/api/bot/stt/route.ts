import { ElevenLabsError, isConfigured, transcribe } from '@/lib/bot/elevenlabs';
import { isLang, languageInfo } from '@/lib/i18n/languages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A spoken answer is a few seconds long; this is generous. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * POST /api/bot/stt (multipart/form-data, part "audio", optional part "lang", e.g. "hi") → { text }
 * Audio is forwarded to the provider and never stored.
 */
export async function POST(req: Request) {
  if (!isConfigured()) return Response.json({ error: 'Speech-to-text is not configured.' }, { status: 501 });

  const form = await req.formData().catch(() => null);
  const audio = form?.get('audio');
  if (!(audio instanceof Blob) || audio.size === 0) return Response.json({ error: 'Expected an "audio" file.' }, { status: 400 });
  if (audio.size > MAX_BYTES) return Response.json({ error: 'Recording is too long.' }, { status: 413 });

  try {
    const lang = form?.get('lang');
    return Response.json({ text: await transcribe(audio, isLang(lang) ? languageInfo(lang).sttCode : undefined) });
  } catch (err) {
    if (err instanceof ElevenLabsError) {
      console.error(err.message);
      return Response.json({ error: 'Speech-to-text failed.' }, { status: 502 });
    }
    throw err;
  }
}
