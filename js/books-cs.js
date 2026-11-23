// České názvy biblických knih podle ID z Bible API (formát USFM).
export const BOOKS_CS = {
  GEN: 'Genesis', EXO: 'Exodus', LEV: 'Leviticus', NUM: 'Numeri', DEU: 'Deuteronomium',
  JOS: 'Jozue', JDG: 'Soudců', RUT: 'Rút', '1SA': '1. Samuelova', '2SA': '2. Samuelova',
  '1KI': '1. Královská', '2KI': '2. Královská', '1CH': '1. Paralipomenon', '2CH': '2. Paralipomenon',
  EZR: 'Ezdráš', NEH: 'Nehemjáš', EST: 'Ester', JOB: 'Job', PSA: 'Žalmy', PRO: 'Přísloví',
  ECC: 'Kazatel', SNG: 'Píseň písní', ISA: 'Izajáš', JER: 'Jeremjáš', LAM: 'Pláč',
  EZK: 'Ezechiel', DAN: 'Daniel', HOS: 'Ozeáš', JOL: 'Jóel', AMO: 'Ámos', OBA: 'Abdijáš',
  JON: 'Jonáš', MIC: 'Micheáš', NAM: 'Nahum', HAB: 'Abakuk', ZEP: 'Sofonjáš', HAG: 'Ageus',
  ZEC: 'Zacharjáš', MAL: 'Malachiáš',
  MAT: 'Matouš', MRK: 'Marek', LUK: 'Lukáš', JHN: 'Jan', ACT: 'Skutky apoštolů', ROM: 'Římanům',
  '1CO': '1. Korintským', '2CO': '2. Korintským', GAL: 'Galatským', EPH: 'Efezským',
  PHP: 'Filipským', COL: 'Koloským', '1TH': '1. Tesalonickým', '2TH': '2. Tesalonickým',
  '1TI': '1. Timoteovi', '2TI': '2. Timoteovi', TIT: 'Titovi', PHM: 'Filemonovi', HEB: 'Židům',
  JAS: 'Jakubův', '1PE': '1. Petrův', '2PE': '2. Petrův', '1JN': '1. Janův', '2JN': '2. Janův',
  '3JN': '3. Janův', JUD: 'Judův', REV: 'Zjevení',
};

const NT = new Set(['MAT', 'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP',
  'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE', '2PE', '1JN', '2JN',
  '3JN', 'JUD', 'REV']);

export function czName(id, fallback) {
  return BOOKS_CS[id] || fallback || id;
}

/** 'OT' | 'NT' | 'OTHER' (deuterokanonické knihy apod.) */
export function testament(id) {
  if (NT.has(id)) return 'NT';
  if (BOOKS_CS[id]) return 'OT';
  return 'OTHER';
}
