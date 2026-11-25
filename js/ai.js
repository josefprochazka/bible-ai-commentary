// Volání Google Gemini API přímo z prohlížeče. Klíč jde jen do hlavičky na googleapis.com.
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Alias Googlu, který vždy ukazuje na aktuální model „flash“.
export const DEFAULT_MODEL = 'gemini-flash-latest';
const MODEL_RE = /^[a-z0-9][a-z0-9.\-]{1,80}$/;

export class AiError extends Error {
  constructor(message, { status = 0, retryAfterSec = null } = {}) {
    super(message);
    this.status = status;
    this.retryAfterSec = retryAfterSec;
  }
}

export function isValidModel(id) {
  return typeof id === 'string' && MODEL_RE.test(id);
}

async function call(path, key, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { 'x-goog-api-key': key, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new AiError('Nepodařilo se spojit se službou Google AI. Jsi online?');
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* prázdná odpověď */
  }
  if (!res.ok) throw toError(res.status, data);
  return data;
}

function toError(status, data) {
  const msg = String(data?.error?.message || '');
  let retry = null;
  const info = (data?.error?.details || []).find((d) => String(d?.['@type'] || '').includes('RetryInfo'));
  if (info?.retryDelay) {
    const s = parseFloat(info.retryDelay);
    if (Number.isFinite(s)) retry = Math.ceil(s);
  }
  let text;
  if (status === 400 && /api key/i.test(msg)) text = 'API klíč není platný. Zkontroluj ho v Nastavení.';
  else if (status === 400) text = 'Google AI požadavek odmítlo.';
  else if (status === 401 || status === 403) text = 'Klíč nemá oprávnění. Zkontroluj klíč a jeho omezení v Google Cloud.';
  else if (status === 404) text = 'Model AI není dostupný.';
  else if (status === 429) text = 'Překročen bezplatný limit Google AI. Zkus to za chvíli (nebo zítra).';
  else if (status >= 500) text = 'Služba Google AI je teď přetížená. Zkus to za pár minut znovu.';
  else text = 'Neočekávaná chyba Google AI.';
  // Přesný kód a zpráva od Googlu, ať je vidět, co se děje (vykresluje se jako text, ne HTML).
  const detail = msg.replace(/\s+/g, ' ').trim().slice(0, 300);
  text += ` [chyba ${status}${detail ? `: ${detail}` : ''}]`;
  return new AiError(text, { status, retryAfterSec: retry });
}

export async function listModels(key) {
  const data = await call('/models?pageSize=1000', key);
  return (data?.models || [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /^models\/gemini/.test(m.name))
    .map((m) => {
      const id = String(m.name).replace(/^models\//, '');
      return { id, label: m.displayName ? `${m.displayName} (${id})` : id };
    })
    .filter((m) => isValidModel(m.id));
}

/** Seřadí modely od nejvhodnějšího: alias „flash-latest“, pak nejnovější „flash“ (rychlé a zdarma). */
export function rankModels(models) {
  const version = (id) => parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0');
  const score = (id) =>
    (id === 'gemini-flash-latest' ? 1000 : 0) +
    (/flash/.test(id) ? 100 : 0) -
    (/lite/.test(id) ? 30 : 0) -
    (/(preview|exp)/.test(id) ? 20 : 0) +
    version(id);
  return models
    .map((m) => m.id)
    .filter((id) => !/(image|tts|audio|live|embed|vision|learnlm|gemma|robotics|computer|thinking)/.test(id))
    .sort((a, b) => score(b) - score(a));
}

/**
 * Napíše odpověď a model si najde sám: zkusí uložený / výchozí model,
 * a když neexistuje, vezme seznam modelů dostupných pro klíč a zkusí nejlepší.
 */
export async function generateAuto({ key, preferred, system, prompt, signal, onModel }) {
  const first = isValidModel(preferred) ? preferred : DEFAULT_MODEL;
  let overloaded = null; // poslední chyba 5xx (model přetížený) – zkusíme jiný model, ale neukládáme ho
  try {
    return await generate({ key, model: first, system, prompt, signal });
  } catch (e) {
    if (e.status >= 500) overloaded = e;
    else if (e.status !== 404) throw e;
  }
  const candidates = rankModels(await listModels(key)).filter((id) => id !== first).slice(0, 5);
  for (const id of candidates) {
    try {
      const res = await generate({ key, model: id, system, prompt, signal });
      // Model ukládáme jen místo neexistujícího; při přetížení zůstane původní.
      if (!overloaded) onModel?.(id);
      return res;
    } catch (e) {
      if (e.status === 404 || e.status === 400) continue;
      if (e.status >= 500) {
        overloaded ??= e;
        continue;
      }
      throw e;
    }
  }
  if (overloaded) throw overloaded;
  throw new AiError('Pro tento klíč jsem nenašel žádný dostupný model Gemini.');
}

export async function generate({ key, model, system, prompt, signal }) {
  if (!isValidModel(model)) throw new AiError('Neplatný název modelu.');
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7 },
  };
  const data = await call(`/models/${encodeURIComponent(model)}:generateContent`, key, { method: 'POST', body, signal });
  if (data?.promptFeedback?.blockReason) {
    throw new AiError('AI odmítla odpovědět (bezpečnostní filtr Googlu).');
  }
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts || [])
    .filter((p) => !p.thought && typeof p.text === 'string')
    .map((p) => p.text)
    .join('')
    .trim();
  if (!text) {
    if (cand?.finishReason === 'SAFETY') throw new AiError('AI odmítla odpovědět (bezpečnostní filtr Googlu).');
    throw new AiError(`AI nevrátila žádný text (${cand?.finishReason || 'neznámý důvod'}).`);
  }
  return { text, truncated: cand?.finishReason === 'MAX_TOKENS' };
}
