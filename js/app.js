import * as store from './storage.js';
import { TRANSLATIONS, isValidTranslation, translationName, getBooks, getChapter } from './bible.js';
import { czName, testament } from './books-cs.js';
import { listModels, pickDefaultModel, generate, isValidModel, DEFAULT_MODEL } from './ai.js';
import { LENGTHS, buildSystemPrompt, buildUserPrompt } from './prompt.js';
import { renderMarkdown } from './markdown.js';

// ---------- pomocné funkce ----------
const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

const normalize = (s) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

/** [1,2,3,5,7,8] → "1–3, 5, 7–8" */
function formatRanges(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(i === j ? `${s[i]}` : `${s[i]}–${s[j]}`);
    i = j;
  }
  return out.join(', ');
}

// ---------- stav ----------
const LANGS = ['cs', 'en'];
const state = {
  translation: isValidTranslation(store.load('translation', 'BSB')) ? store.load('translation', 'BSB') : 'BSB',
  testament: 'NT',
  books: [],
  book: null,
  chapters: new Set(),
  verses: new Set(),
  chapterData: null,
  chapMode: 'single',
  verseMode: 'single',
  chapAnchor: null,
  verseAnchor: null,
  lang: LANGS.includes(store.load('lang', 'cs')) ? store.load('lang', 'cs') : 'cs',
  length: LENGTHS[store.load('length', 'short')] ? store.load('length', 'short') : 'short',
  split: store.load('split', true) !== false,
  abort: null,
  versesToken: 0,
};

const getKey = () => {
  const k = store.load('apiKey', '');
  return typeof k === 'string' ? k : '';
};
const getModel = () => {
  const m = store.load('model', DEFAULT_MODEL);
  return isValidModel(m) ? m : DEFAULT_MODEL;
};

// ---------- segmentové přepínače ----------
function setupSeg(container, value, onChange) {
  const buttons = [...container.querySelectorAll('button[data-value]')];
  const set = (v) => buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === v)));
  set(value);
  buttons.forEach((b) =>
    b.addEventListener('click', () => {
      set(b.dataset.value);
      onChange(b.dataset.value);
    })
  );
  return set;
}

/** Společná logika výběru (jednotlivě / od–do, Shift+klik na PC). */
function applySelection(set, n, mode, anchorKey, shiftKey) {
  const anchor = state[anchorKey];
  if ((mode === 'range' && anchor != null) || (shiftKey && anchor != null)) {
    const [a, b] = anchor < n ? [anchor, n] : [n, anchor];
    for (let i = a; i <= b; i++) set.add(i);
    state[anchorKey] = mode === 'range' ? null : n;
  } else if (mode === 'range') {
    set.add(n);
    state[anchorKey] = n;
  } else {
    if (set.has(n)) set.delete(n);
    else set.add(n);
    state[anchorKey] = n;
  }
}

// ---------- knihy ----------
function renderTranslations() {
  const sel = $('#translation');
  sel.replaceChildren(...TRANSLATIONS.map((t) => el('option', { value: t.id, text: t.label })));
  sel.value = state.translation;
  $('#translation-credit').textContent = `Překlad: ${translationName(state.translation)}`;
}

async function loadBooks() {
  const grid = $('#book-grid');
  grid.replaceChildren(el('p', { class: 'muted', text: 'Načítám knihy…' }));
  try {
    state.books = await getBooks(state.translation);
    $('.tabs [data-testament="OTHER"]').hidden = !state.books.some((b) => testament(b.id) === 'OTHER');
    if (state.book) {
      const same = state.books.find((b) => b.id === state.book.id);
      if (same) state.book = same;
      else resetBook();
    }
    renderBooks();
  } catch (e) {
    grid.replaceChildren(
      el('p', { class: 'error', text: e.message }),
      el('button', { class: 'btn small', type: 'button', text: 'Zkusit znovu', onclick: loadBooks })
    );
  }
}

function renderBooks() {
  $('#book-current').textContent = state.book ? `– ${czName(state.book.id, state.book.name)}` : '';
  const q = normalize($('#book-filter').value.trim());
  document.querySelectorAll('.tabs [data-testament]').forEach((b) =>
    b.setAttribute('aria-selected', String(!q && b.dataset.testament === state.testament))
  );
  const list = state.books.filter((b) =>
    q ? normalize(czName(b.id, b.name)).includes(q) || normalize(b.name).includes(q) : testament(b.id) === state.testament
  );
  const grid = $('#book-grid');
  if (!list.length) {
    grid.replaceChildren(el('p', { class: 'muted', text: 'Nic nenalezeno.' }));
    return;
  }
  grid.replaceChildren(
    ...list.map((b) => {
      const cz = czName(b.id, b.name);
      return el(
        'button',
        {
          type: 'button',
          class: 'book' + (state.book?.id === b.id ? ' selected' : ''),
          'aria-pressed': String(state.book?.id === b.id),
          onclick: () => selectBook(b),
        },
        el('span', { class: 'book-name', text: cz }),
        el('span', { class: 'book-meta', text: `${cz !== b.name ? b.name + ' · ' : ''}${b.chapters} kap.` })
      );
    })
  );
}

function resetBook() {
  state.book = null;
  state.chapters.clear();
  state.verses.clear();
  state.chapterData = null;
  state.chapAnchor = state.verseAnchor = null;
}

function selectBook(b) {
  resetBook();
  state.book = b;
  renderBooks();
  $('#step-book').classList.add('collapsed');
  renderChapters();
  onSelectionChanged();
  $('#step-chapters').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- kapitoly ----------
function renderChapters() {
  const sec = $('#step-chapters');
  sec.hidden = !state.book;
  if (!state.book) return;
  const b = state.book;
  $('#book-title').textContent = `– ${czName(b.id, b.name)}`;
  const chips = [];
  for (let n = b.first; n < b.first + b.chapters; n++) {
    const sel = state.chapters.has(n);
    chips.push(
      el('button', {
        type: 'button',
        class: 'chip' + (sel ? ' selected' : '') + (state.chapMode === 'range' && state.chapAnchor === n ? ' anchor' : ''),
        'aria-pressed': String(sel),
        'aria-label': `Kapitola ${n}`,
        text: n,
        onclick: (ev) => {
          applySelection(state.chapters, n, state.chapMode, 'chapAnchor', ev.shiftKey);
          renderChapters();
          onSelectionChanged();
        },
      })
    );
  }
  $('#chapter-grid').replaceChildren(...chips);
  $('#chap-hint').textContent =
    state.chapMode === 'range'
      ? state.chapAnchor != null
        ? `Začátek: kapitola ${state.chapAnchor}. Teď klepni na poslední kapitolu rozsahu.`
        : 'Klepni na první a pak na poslední kapitolu rozsahu.'
      : 'Klepnutím kapitolu vybereš nebo zrušíš. Na PC jde rozsah i přes Shift + klik.';
}

// ---------- verše ----------
async function loadVerses() {
  const sec = $('#step-verses');
  const only = state.chapters.size === 1 ? [...state.chapters][0] : null;
  if (only == null) {
    sec.hidden = true;
    state.verses.clear();
    state.chapterData = null;
    return;
  }
  if (state.chapterData?.number === only && state.chapterData.book === state.book.id) {
    sec.hidden = false;
    renderVerses();
    return;
  }
  state.verses.clear();
  state.verseAnchor = null;
  sec.hidden = false;
  const token = ++state.versesToken;
  $('#verse-list').replaceChildren(el('p', { class: 'muted', text: 'Načítám text kapitoly…' }));
  try {
    const data = await getChapter(state.translation, state.book.id, only);
    if (token !== state.versesToken) return;
    state.chapterData = { ...data, book: state.book.id };
    renderVerses();
  } catch (e) {
    if (token !== state.versesToken) return;
    $('#verse-list').replaceChildren(el('p', { class: 'error', text: e.message }));
  }
}

function renderVerses() {
  const data = state.chapterData;
  if (!data) return;
  const nodes = data.items.map((it) => {
    if (it.type === 'heading') return el('div', { class: 'v-heading', text: it.text });
    const sel = state.verses.has(it.n);
    return el(
      'button',
      {
        type: 'button',
        class: 'verse' + (sel ? ' selected' : '') + (state.verseMode === 'range' && state.verseAnchor === it.n ? ' anchor' : ''),
        'aria-pressed': String(sel),
        onclick: (ev) => {
          applySelection(state.verses, it.n, state.verseMode, 'verseAnchor', ev.shiftKey);
          renderVerses();
          onSelectionChanged();
        },
      },
      el('sup', { text: it.n }),
      ' ',
      it.text
    );
  });
  $('#verse-list').replaceChildren(...nodes);
  $('#verse-hint').textContent =
    state.verseMode === 'range' && state.verseAnchor != null
      ? `Začátek: verš ${state.verseAnchor}. Teď klepni na poslední verš rozsahu.`
      : state.verses.size
        ? `Vybráno ${state.verses.size} veršů. Pošle se jen tento výběr.`
        : 'Nic nevybráno = pošle se celá kapitola. Klepnutím na verš ho vybereš.';
}

// ---------- souhrn výběru ----------
function selectionLabel() {
  if (!state.book || !state.chapters.size) return null;
  const name = czName(state.book.id, state.book.name);
  if (state.chapters.size === 1 && state.verses.size) {
    return `${name} ${[...state.chapters][0]}:${formatRanges(state.verses)}`;
  }
  return `${name} ${formatRanges(state.chapters)}`;
}

function onSelectionChanged() {
  loadVerses().then(updateSummary);
  updateSummary();
}

function updateSummary() {
  const label = selectionLabel();
  $('#selection-summary').textContent = label || 'Nic nevybráno';
  $('#btn-run').disabled = !label || !!state.abort;
  const multi = state.chapters.size > 1;
  $('#row-split').hidden = !multi;
  $('#options-step').textContent = $('#step-verses').hidden ? (state.book ? '3' : '2') : '4';
}

// ---------- psaní komentáře ----------
function buildUnits() {
  const b = state.book;
  const name = czName(b.id, b.name);
  const chapters = [...state.chapters].sort((x, y) => x - y);
  if (chapters.length === 1 && state.verses.size) {
    const verses = new Set(state.verses);
    const r = formatRanges(verses);
    return [{ refCs: `${name} ${chapters[0]}:${r}`, refEn: `${b.name} ${chapters[0]}:${r}`, chapters, verses }];
  }
  if (chapters.length > 1 && state.split) {
    return chapters.map((c) => ({ refCs: `${name} ${c}`, refEn: `${b.name} ${c}`, chapters: [c], verses: null }));
  }
  const r = formatRanges(chapters);
  return [{ refCs: `${name} ${r}`, refEn: `${b.name} ${r}`, chapters, verses: null }];
}

async function loadUnitText(unit, translation, bookId) {
  const parts = [];
  for (const c of unit.chapters) {
    const data = await getChapter(translation, bookId, c);
    const items = unit.verses ? data.items.filter((it) => it.type === 'verse' && unit.verses.has(it.n)) : data.items;
    parts.push({ chapter: c, items });
  }
  const multi = unit.chapters.length > 1;
  const prompt = parts
    .map((p) =>
      (multi ? `# Chapter ${p.chapter}\n` : '') +
      p.items.map((it) => (it.type === 'heading' ? `## ${it.text}` : `${p.chapter}:${it.n} ${it.text}`)).join('\n')
    )
    .join('\n\n');
  return { parts, prompt };
}

function renderBibleText(container, parts, multi) {
  container.replaceChildren(
    ...parts.flatMap((p) => [
      multi ? el('div', { class: 'v-heading', text: `Kapitola ${p.chapter}` }) : null,
      el(
        'p',
        {},
        ...p.items.flatMap((it) =>
          it.type === 'heading'
            ? [el('span', { class: 'inline-heading', text: it.text }), ' ']
            : [el('sup', { text: it.n }), ` ${it.text} `]
        )
      ),
    ]).filter(Boolean)
  );
}

function createResultCard(unit) {
  const status = el('div', { class: 'status' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), el('span', { text: 'Čeká ve frontě…' }));
  const commentary = el('div', { class: 'commentary' }, status);
  const bibleBox = el('div', { class: 'bible-text' }, el('p', { class: 'muted', text: 'Načítám…' }));
  const copyBtn = el('button', { type: 'button', class: 'btn ghost small', text: 'Kopírovat', disabled: true });
  const card = el(
    'article',
    { class: 'result' },
    el('header', { class: 'result-head' }, el('h3', { text: unit.refCs }), copyBtn),
    commentary,
    el('details', { class: 'bible-details' }, el('summary', { text: 'Zobrazit biblický text' }), bibleBox)
  );
  const setStatus = (text) => {
    status.lastChild.textContent = text;
  };
  return { card, commentary, bibleBox, copyBtn, setStatus };
}

async function run() {
  const key = getKey();
  if (!key) {
    openSettings('Nejdřív vlož svůj API klíč.');
    return;
  }
  const units = buildUnits();
  if (units.length > 10 && !confirm(`Vybral jsi ${units.length} kapitol. To je ${units.length} dotazů na AI a bezplatný limit může dojít. Pokračovat?\n\n(Tip: zvol „Vše dohromady“ = 1 dotaz.)`)) {
    return;
  }

  const ctrl = new AbortController();
  state.abort = ctrl;
  $('#btn-run').disabled = true;
  $('#btn-stop').hidden = false;

  const translation = state.translation;
  const bookId = state.book.id;
  const lang = state.lang;
  const length = state.length;
  const model = getModel();
  const focus = $('#opt-focus').value.trim().slice(0, 300);
  const system = buildSystemPrompt(lang);

  const results = $('#results');
  const meta = [lang === 'cs' ? 'Česky' : 'English', LENGTHS[length].label, translationName(translation)].join(' · ');
  const cards = units.map(createResultCard);
  results.replaceChildren(
    el(
      'div',
      { class: 'results-head' },
      el('div', {}, el('h2', { text: 'Komentář' }), el('p', { class: 'muted small', text: meta })),
      el('button', { type: 'button', class: 'btn ghost small', text: 'Vymazat', onclick: () => results.replaceChildren() })
    ),
    ...cards.map((c) => c.card)
  );
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      const ui = cards[i];
      if (ctrl.signal.aborted) break;
      try {
        ui.setStatus('Načítám biblický text…');
        const text = await loadUnitText(unit, translation, bookId);
        renderBibleText(ui.bibleBox, text.parts, unit.chapters.length > 1);

        const prompt = buildUserPrompt({
          lang,
          length,
          refCs: unit.refCs,
          refEn: unit.refEn,
          translation: translationName(translation),
          focus,
          text: text.prompt,
        });

        let answer;
        for (let attempt = 0; ; attempt++) {
          try {
            ui.setStatus('AI píše komentář…');
            answer = await generate({ key, model, system, prompt, signal: ctrl.signal });
            break;
          } catch (e) {
            if (e.status === 429 && attempt < 2) {
              const wait = Math.min(Math.max(e.retryAfterSec ?? 30, 5), 90);
              for (let s = wait; s > 0; s--) {
                ui.setStatus(`Limit Google AI – čekám ${s} s a zkusím to znovu…`);
                await sleep(1000, ctrl.signal);
              }
              continue;
            }
            throw e;
          }
        }

        renderMarkdown(answer.text, ui.commentary);
        if (answer.truncated) {
          ui.commentary.append(el('p', { class: 'muted small', text: '(Odpověď byla zkrácena – je příliš dlouhá.)' }));
        }
        ui.copyBtn.disabled = false;
        ui.copyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(`${unit.refCs}\n\n${answer.text}`);
            ui.copyBtn.textContent = 'Zkopírováno ✓';
            setTimeout(() => (ui.copyBtn.textContent = 'Kopírovat'), 1500);
          } catch {
            ui.copyBtn.textContent = 'Nelze kopírovat';
          }
        });
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        ui.commentary.replaceChildren(el('p', { class: 'error', text: e.message || 'Neznámá chyba.' }));
        if (e.status === 429 || /klíč/.test(e.message || '')) {
          // Další dotazy by skončily stejně – zbytek označíme a skončíme.
          for (const rest of cards.slice(i + 1)) {
            rest.commentary.replaceChildren(el('p', { class: 'muted', text: 'Přeskočeno kvůli chybě výše.' }));
          }
          break;
        }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
    cards.forEach((c) => {
      if (c.commentary.querySelector('.status')) {
        c.commentary.replaceChildren(el('p', { class: 'muted', text: 'Zastaveno.' }));
      }
    });
  } finally {
    state.abort = null;
    $('#btn-stop').hidden = true;
    updateSummary();
  }
}

// ---------- nastavení ----------
const dialog = $('#settings');

function setModelOptions(models, selected) {
  const sel = $('#model');
  const list = models.length ? models : [{ id: selected, label: selected }];
  if (!list.some((m) => m.id === selected)) list.unshift({ id: selected, label: selected });
  sel.replaceChildren(...list.map((m) => el('option', { value: m.id, text: m.label })));
  sel.value = selected;
}

function settingsStatus(text, kind = '') {
  const p = $('#settings-status');
  p.textContent = text;
  p.className = 'small ' + kind;
}

function openSettings(message) {
  $('#api-key').value = getKey();
  $('#api-key').type = 'password';
  $('#btn-toggle-key').textContent = 'Ukázat';
  setModelOptions([], getModel());
  settingsStatus(message || '', message ? 'error' : '');
  dialog.showModal();
}

async function loadModelsInto(key) {
  settingsStatus('Ověřuji klíč a načítám modely…');
  const models = await listModels(key);
  const current = $('#model').value;
  const keep = models.some((m) => m.id === current) ? current : pickDefaultModel(models);
  setModelOptions(models, keep);
  return models;
}

function validKeyFormat(k) {
  return /^[A-Za-z0-9_\-]{20,200}$/.test(k);
}

function updateKeyBanner() {
  $('#key-banner').hidden = !!getKey();
}

function setupSettings() {
  $('#btn-settings').addEventListener('click', () => openSettings());
  $('#btn-banner-settings').addEventListener('click', () => openSettings());
  $('#btn-close-settings').addEventListener('click', () => dialog.close());
  $('#btn-toggle-key').addEventListener('click', () => {
    const i = $('#api-key');
    i.type = i.type === 'password' ? 'text' : 'password';
    $('#btn-toggle-key').textContent = i.type === 'password' ? 'Ukázat' : 'Skrýt';
  });
  $('#btn-load-models').addEventListener('click', async () => {
    const key = $('#api-key').value.trim();
    if (!validKeyFormat(key)) return settingsStatus('Nejdřív vlož platný klíč.', 'error');
    try {
      const models = await loadModelsInto(key);
      settingsStatus(`Klíč funguje ✓ Nalezeno ${models.length} modelů.`, 'ok');
    } catch (e) {
      settingsStatus(e.message, 'error');
    }
  });
  $('#btn-save-settings').addEventListener('click', async () => {
    const key = $('#api-key').value.trim();
    if (key && !validKeyFormat(key)) return settingsStatus('Klíč má neplatný formát (bez mezer, 20+ znaků).', 'error');
    const model = $('#model').value;
    if (!isValidModel(model)) return settingsStatus('Neplatný model.', 'error');
    if (!key) {
      store.remove('apiKey');
      store.save('model', model);
      updateKeyBanner();
      dialog.close();
      return;
    }
    const firstTime = key !== getKey();
    store.save('apiKey', key);
    store.save('model', model);
    updateKeyBanner();
    if (firstTime) {
      try {
        await loadModelsInto(key);
        store.save('model', $('#model').value);
        settingsStatus(`Uloženo. Klíč funguje ✓ Model: ${$('#model').value}`, 'ok');
      } catch (e) {
        settingsStatus(`Uloženo, ale: ${e.message}`, 'error');
      }
    } else {
      dialog.close();
    }
  });
  $('#btn-delete-key').addEventListener('click', () => {
    store.remove('apiKey');
    $('#api-key').value = '';
    updateKeyBanner();
    settingsStatus('Klíč smazán z tohoto prohlížeče.', 'ok');
  });
}

// ---------- instalace (PWA) ----------
function setupInstall() {
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    $('#btn-install').hidden = false;
  });
  $('#btn-install').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice.catch(() => null);
    deferred = null;
    $('#btn-install').hidden = true;
  });
  window.addEventListener('appinstalled', () => ($('#btn-install').hidden = true));
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// ---------- start ----------
function init() {
  renderTranslations();
  $('#translation').addEventListener('change', (e) => {
    if (!isValidTranslation(e.target.value)) return;
    state.translation = e.target.value;
    store.save('translation', state.translation);
    $('#translation-credit').textContent = `Překlad: ${translationName(state.translation)}`;
    state.chapterData = null;
    state.verses.clear();
    loadBooks().then(() => {
      renderChapters();
      onSelectionChanged();
    });
  });

  document.querySelectorAll('.tabs [data-testament]').forEach((b) =>
    b.addEventListener('click', () => {
      state.testament = b.dataset.testament;
      $('#book-filter').value = '';
      renderBooks();
    })
  );
  $('#book-filter').addEventListener('input', renderBooks);
  $('#btn-change-book').addEventListener('click', () => {
    $('#step-book').classList.remove('collapsed');
    $('#step-book').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('#book-head').addEventListener('click', () => $('#step-book').classList.remove('collapsed'));

  setupSeg($('#chap-mode'), state.chapMode, (v) => {
    state.chapMode = v;
    state.chapAnchor = null;
    renderChapters();
  });
  setupSeg($('#verse-mode'), state.verseMode, (v) => {
    state.verseMode = v;
    state.verseAnchor = null;
    renderVerses();
  });
  $('#chap-all').addEventListener('click', () => {
    if (!state.book) return;
    for (let n = state.book.first; n < state.book.first + state.book.chapters; n++) state.chapters.add(n);
    state.chapAnchor = null;
    renderChapters();
    onSelectionChanged();
  });
  $('#chap-clear').addEventListener('click', () => {
    state.chapters.clear();
    state.chapAnchor = null;
    renderChapters();
    onSelectionChanged();
  });
  $('#verse-clear').addEventListener('click', () => {
    state.verses.clear();
    state.verseAnchor = null;
    renderVerses();
    updateSummary();
  });

  setupSeg($('#opt-lang'), state.lang, (v) => {
    state.lang = v;
    store.save('lang', v);
  });
  setupSeg($('#opt-length'), state.length, (v) => {
    state.length = v;
    store.save('length', v);
  });
  setupSeg($('#opt-split'), state.split ? 'split' : 'joined', (v) => {
    state.split = v === 'split';
    store.save('split', state.split);
  });

  $('#btn-run').addEventListener('click', () => run().catch((e) => alert(e.message)));
  $('#btn-stop').addEventListener('click', () => state.abort?.abort());

  setupSettings();
  setupInstall();
  updateKeyBanner();
  updateSummary();
  loadBooks();
}

init();
