# MedTranslate Studio — Faza 4 Personal Wiki

Aplicație web statică pentru traducerea documentelor medicale, organizarea lor pe capitole și concepte și construirea unei biblioteci Wiki personale.

## Fluxul complet

```text
PDF
→ extragere și segmentare locală
→ traducere DeepSeek
→ Markdown salvat în Supabase
→ capitole și concepte
→ editor individual, notițe și highlights
→ Bibliotecă și Viewing Mode Wiki
```

## Faza 4

- bibliotecă globală cu toate proiectele;
- căutare în cursuri, concepte, note și traduceri;
- pagină Wiki pentru fiecare proiect;
- capitole și subcapitole colapsabile;
- afișarea traducerii Markdown fără duplicarea segmentelor;
- păstrarea paginilor de concept editate în HTML;
- păstrarea underline-ului, highlights-urilor și notițelor;
- acces direct din Wiki în editorul conceptului;
- navigare prin URL către proiect și concept.

## Hosting

Proiectul rămâne un site static Render:

```text
Build Command: bash build.sh
Publish Directory: ./dist
```

Nu sunt necesare variabile de mediu Render.

## Baza de date

Faza 4 nu adaugă tabele. Folosește schema Fazelor 1–3 și politicile RLS existente.

Vezi `FAZA4_WIKI_LIBRARY_GITHUB.md` pentru instalare.
