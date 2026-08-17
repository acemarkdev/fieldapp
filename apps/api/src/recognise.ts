// Phase A vision service: send a survey photo to a vision-language model and get back the
// frozen RecognitionResult (window layout + style). Uses the OpenAI-compatible /chat/completions
// shape, so the same code works against OpenAI, a self-hosted Qwen-VL via vLLM, OpenRouter, etc.
// Configure with VISION_API_URL, VISION_MODEL, and (if the endpoint needs it) VISION_API_KEY.
import { RECOGNITION_PROMPT, parseRecognition, type RecognitionResult } from '@ace/shared';
import { listItemPhotos, downloadPhoto } from './store';

function visionConfig() {
  const url = process.env.VISION_API_URL;
  const model = process.env.VISION_MODEL;
  if (!url || !model) {
    throw new Error('Vision assist is off — set VISION_API_URL and VISION_MODEL (+ VISION_API_KEY if required) in .env.');
  }
  return { url: url.replace(/\/+$/, ''), key: process.env.VISION_API_KEY ?? '', model };
}

export async function recogniseImage(bytes: Uint8Array, mime = 'image/jpeg'): Promise<RecognitionResult> {
  const { url, key, model } = visionConfig();
  const dataUri = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
  const res = await fetch(`${url}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: RECOGNITION_PROMPT },
          { type: 'image_url', image_url: { url: dataUri } },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Vision API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json: any = await res.json();
  const content = json?.choices?.[0]?.message?.content ?? '';
  return parseRecognition(typeof content === 'string' ? content : JSON.stringify(content));
}

// Analyse an item's most recent photo (downloaded server-side with the service-role key).
export async function recogniseItemPhoto(itemId: string): Promise<RecognitionResult> {
  const photos = await listItemPhotos(itemId);
  if (photos.length === 0) throw new Error('This item has no photo to analyse yet.');
  const latest = photos[photos.length - 1];
  const bytes = await downloadPhoto(latest.storage_path);
  return recogniseImage(bytes);
}
