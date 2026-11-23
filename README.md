# Bible AI komentář

PWA (webová aplikace, kterou jde nainstalovat jako appku) pro PC i Android. Vybereš knihu, kapitoly nebo konkrétní verše Bible a AI (Google Gemini) k nim napíše komentář.

## Co umí
- Výběr knihy (Starý / Nový zákon, hledání i bez diakritiky), kapitol a veršů. Jednotlivě, nebo rozsahem „Od – do“ (na PC i Shift + klik).
- U jedné kapitoly vidíš celý text a můžeš klepnout na konkrétní verše.
- K AI se pošle odkaz na pasáž **i celý biblický text**, aby měla kontext.
- Jazyk odpovědi: česky / anglicky (i když je text Bible anglicky).
- Délka: 1 věta, 2–3 věty, odstavec, podrobně.
- Více kapitol: každá kapitola zvlášť (karta kapitola → komentář pod sebou), nebo vše dohromady.
- Nepovinné „na co se zaměřit“.
- Funguje offline (kromě AI). Přečtené biblické texty se ukládají do mezipaměti.

## Technologie
- Čisté HTML + CSS + JavaScript (ES moduly), **žádné knihovny ani build**. Nic se nestahuje z cizích zdrojů, takže nehrozí podvržený balíček.
- Biblický text: [Free Use Bible API](https://bible.helloao.org) (zdarma, bez klíče). Výchozí překlad je **Berean Standard Bible** (moderní angličtina). Na výběr je i World English Bible, Bible 21 a Bible kralická.
- AI: [Google Gemini API](https://ai.google.dev) (volá se přímo z prohlížeče, free tier).

## Spuštění
Appka je statická, stačí ji hostovat přes HTTPS.

**GitHub Pages (doporučeno):** Settings → Pages → Source: *Deploy from a branch* → `main` / `/ (root)` → Save. Za minutu běží na `https://josefprochazka.github.io/bible-ai-commentary/`.

**Lokálně:** v kořeni repa spusť třeba `npx serve .` nebo `python -m http.server 8000` a otevři `http://localhost:8000`.

**Instalace na Android:** otevři adresu v Chrome → menu ⋮ → *Přidat na plochu / Nainstalovat aplikaci*. Na PC v Chrome/Edge ikonka instalace v adresním řádku (nebo tlačítko „Nainstalovat“ v appce).

## API klíč
1. Klíč zdarma vytvoříš na <https://aistudio.google.com/apikey>.
2. V appce klikni na ikonu nastavení vpravo nahoře, vlož klíč a dej **Uložit**. Appka klíč ověří a sama vybere nejnovější rychlý model „flash“ (jde změnit).

Klíč **není v kódu ani v repu**. Ukládá se jen v prohlížeči daného zařízení (localStorage) a posílá se jen přímo na `generativelanguage.googleapis.com`. Na každém zařízení ho vložíš jednou.

**Doporučené omezení klíče** (Google Cloud Console → APIs & Services → Credentials → tvůj klíč):
- *API restrictions*: jen **Generative Language API**.
- Free tier nic nestojí, ale omezením zajistíš, že klíč nejde použít na nic jiného.

## Bezpečnost
- Content Security Policy (pravidla prohlížeče, odkud stránka smí cokoli načítat): skripty jen z vlastní domény, síťové dotazy jen na Bible API a Google AI. Žádné inline skripty.
- Odpověď AI se převádí z Markdownu na prvky stránky bez `innerHTML`, takže AI ani podvržený text nemůže do stránky vložit HTML nebo skript.
- Vstupy (překlad, kniha, kapitola, model) se před sestavením adresy kontrolují.
- Service worker nikdy neukládá dotazy na AI (ani klíč).
- Bez cookies a analytiky, odkazy ven s `noopener noreferrer`.

## Struktura
```
index.html            stránka
css/app.css           vzhled (světlý i tmavý režim)
js/app.js             logika výběru a zobrazení
js/bible.js           Bible API
js/ai.js              Gemini API
js/prompt.js          texty pro AI (jazyk, délka)
js/markdown.js        bezpečné vykreslení odpovědi
js/books-cs.js        české názvy knih
js/storage.js         nastavení v localStorage
sw.js                 service worker (offline)
manifest.webmanifest  údaje pro instalaci
icons/                ikony
```

Po změně souborů zvyš `VERSION` v `sw.js`, ať si nainstalované appky stáhnou novou verzi.

## Licence textů
Berean Standard Bible a World English Bible jsou volná díla. Bible, překlad 21. století: © Biblion, z. s., CC BY-NC-ND 4.0 (jen nekomerční použití). Bible kralická: volné dílo.
