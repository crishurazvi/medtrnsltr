# MedTranslate Studio — GitHub + Render + Supabase

Aplicație web statică pentru traducerea manuală asistată a documentelor medicale PDF.

Nu există integrare cu DeepSeek, OpenAI, Claude sau alt API AI. Fluxul rămâne intenționat manual:

1. încarci PDF-ul;
2. textul este extras local în browser;
3. aplicația împarte documentul în segmente;
4. copiezi promptul și segmentul;
5. le trimiți manual în instrumentul AI ales;
6. lipești traducerea în editor;
7. progresul se salvează în proiectul tău Supabase;
8. exporți Markdown, HTML, backup JSON sau PDF prin Print.

## Ce s-a schimbat în această versiune

- proiect pregătit pentru repository GitHub;
- deploy automat pe Render ca **Static Site**;
- configurație Render inclusă în `render.yaml`;
- build explicit în `build.sh` și publicare din folderul `dist`;
- nu mai există `config.js`;
- ecranul de autentificare cere:
  - Supabase Project URL;
  - Supabase Publishable Key;
  - email;
  - parolă;
- URL-ul și cheia Publishable pot fi reținute opțional în browser;
- aplicația refuză cheile `sb_secret_...` și JWT-urile `service_role`;
- conexiunea Supabase poate fi schimbată din bara de sus.

## Fișiere importante

- `index.html` — intrarea aplicației;
- `styles.css` — interfața;
- `js/app.js` — logica aplicației;
- `js/connection.js` — validarea și memorarea conexiunii Supabase;
- `js/db.js` — accesul la Supabase;
- `js/pdf-tools.js` — extragerea și segmentarea PDF-ului;
- `js/export-tools.js` — exporturile;
- `supabase/schema.sql` — schema bazei, RLS și Storage;
- `build.sh` — copiază fișierele publicabile în `dist`;
- `render.yaml` — configurarea automată Render;
- `TUTORIAL_GITHUB_RENDER_SUPABASE.md` — ghidul complet.

## Testare locală

Nu deschide direct `index.html` prin dublu click, deoarece modulele JavaScript au nevoie de HTTP.

```bash
python -m http.server 8080
```

Apoi deschide:

```text
http://localhost:8080
```

Pentru a testa exact build-ul Render:

```bash
bash build.sh
python -m http.server 8080 --directory dist
```

## Deploy rapid pe Render

1. urcă toate fișierele în rădăcina unui repository GitHub;
2. în Render alege `New > Blueprint`;
3. conectează repository-ul;
4. Render citește `render.yaml` și publică folderul `dist`;
5. după deploy, introdu în aplicație URL-ul și cheia Publishable Supabase.

Instrucțiunile complete sunt în [TUTORIAL_GITHUB_RENDER_SUPABASE.md](./TUTORIAL_GITHUB_RENDER_SUPABASE.md).

## Securitate

Cheia Supabase **Publishable** este destinată utilizării în browser. Datele sunt protejate de autentificare și politicile Row Level Security din `supabase/schema.sql`.

Nu introduce niciodată în aplicație:

- cheia `sb_secret_...`;
- cheia legacy `service_role`;
- parola bazei de date;
- un connection string PostgreSQL;
- chei DeepSeek, OpenAI, Anthropic sau alte secrete.

## Limitări

- nu include OCR pentru PDF-uri scanate;
- nu păstrează fidel layoutul original al PDF-ului;
- imaginile și tabelele complexe nu sunt reconstruite automat;
- bibliotecile PDF.js, Supabase JS, Marked și DOMPurify sunt încărcate de pe jsDelivr;
- datele conexiunii Supabase sunt specifice browserului/dispozitivului în care au fost introduse.
