# MedTranslate Studio

Aplicație web statică pentru traducerea PDF-urilor medicale, organizarea lor într-un wiki personal și lectura în format de curs paginat.

## Funcții principale

- PDF → extragere locală și segmentare;
- traducere manuală copy/paste sau automată prin DeepSeek;
- salvare în Supabase cu RLS;
- capitole și concepte generate din traduceri;
- editor rich-text pentru concepte;
- notițe personale și highlights semantice;
- Bibliotecă Wiki globală;
- **Lecture Mode full-screen** numai din traduceri, cu pagini orizontale;
- două pagini pe desktop, una pe mobil;
- editarea și autosalvarea secțiunilor Lecture;
- temă dark globală;
- export Markdown, HTML, JSON și print/PDF.

## Deploy

- frontend static: GitHub → Render;
- date și autentificare: Supabase;
- proxy DeepSeek: Supabase Edge Function.

Pentru upgrade-ul curent vezi `FAZA5_LECTURE_MODE_GITHUB.md` și rulează `supabase/phase5_lecture_mode.sql`.
