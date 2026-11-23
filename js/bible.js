// Přístup k Free Use Bible API (https://bible.helloao.org) – zdarma, bez klíče.
const BASE = 'https://bible.helloao.org/api';

export const TRANSLATIONS = [
  { id: 'BSB', label: 'Berean Standard Bible – angličtina, moderní', name: 'Berean Standard Bible (BSB)' },
  { id: 'ENGWEBP', label: 'World English Bible – angličtina, moderní', name: 'World English Bible (WEB)' },
  { id: 'ces_bible', label: 'Bible, překlad 21. století – čeština', name: 'Bible, překlad 21. století (B21)' },
  { id: 'ces_bkr', label: 'Bible kralická 1613 – čeština', name: 'Bible kralická (1613)' },
];

const ID_RE = /^[A-Za-z0-9_]{1,24}$/;
const cache = new Map();

export function isValidTranslation(id) {
  return TRANSLATIONS.some((t) => t.id === id);
}

export function translationName(id) {
  return TRANSLATIONS.find((t) => t.id === id)?.name || id;
}

async function getJson(path) {
  if (cache.has(path)) return cache.get(path);
  const promise = (async () => {
    let res;
    try {
      res = await fetch(BASE + path, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    } catch {
      throw new Error('Nepodařilo se načíst biblický text. Jsi online?');
    }
    if (!res.ok) throw new Error(`Bible API vrátilo chybu ${res.status}.`);
    return res.json();
  })();
  cache.set(path, promise);
  promise.catch(() => cache.delete(path));
  return promise;
}

export async function getBooks(translation) {
  if (!isValidTranslation(translation)) throw new Error('Neznámý překlad.');
  const data = await getJson(`/${translation}/books.json`);
  return (data.books || [])
    .filter((b) => ID_RE.test(b.id) && Number.isInteger(b.numberOfChapters) && b.numberOfChapters > 0)
    .map((b) => ({
      id: b.id,
      name: String(b.commonName || b.name || b.id),
      chapters: b.numberOfChapters,
      first: Number.isInteger(b.firstChapterNumber) ? b.firstChapterNumber : 1,
      order: b.order,
    }));
}

/** Vrátí kapitolu jako { number, items: [{type:'heading', text} | {type:'verse', n, text}] } */
export async function getChapter(translation, bookId, chapter) {
  if (!isValidTranslation(translation) || !ID_RE.test(bookId) || !Number.isInteger(chapter) || chapter < 0) {
    throw new Error('Neplatný odkaz na kapitolu.');
  }
  const data = await getJson(`/${translation}/${encodeURIComponent(bookId)}/${chapter}.json`);
  const items = [];
  for (const c of data.chapter?.content || []) {
    if (c.type === 'verse' && Number.isInteger(c.number)) {
      const text = joinContent(c.content);
      if (text) items.push({ type: 'verse', n: c.number, text });
    } else if (c.type === 'heading' || c.type === 'hebrew_subtitle') {
      const text = joinContent(c.content);
      if (text) items.push({ type: 'heading', text });
    }
  }
  return { number: chapter, items };
}

// Složí obsah verše (řetězce a objekty {text}) do jednoho textu s rozumnými mezerami.
function joinContent(parts) {
  if (!Array.isArray(parts)) return '';
  let out = '';
  for (const p of parts) {
    const t = typeof p === 'string' ? p : p && typeof p.text === 'string' ? p.text : '';
    if (!t) continue;
    if (!out || /^[”’.,;:!?)\]]/.test(t) || /[“‘(\[]$/.test(out)) out += t;
    else out += ' ' + t;
  }
  return out.replace(/\s+/g, ' ').trim();
}
