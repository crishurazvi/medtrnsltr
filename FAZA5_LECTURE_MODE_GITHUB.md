# Faza 5 — Lecture Mode paginat, editabil și Dark Mode

Această etapă se instalează peste proiectul care are deja Fazele 1–4.

## Ce aduce

- un tab nou **Lecture Mode** în fiecare proiect;
- afișează **numai traducerile Markdown**, fără concepte și fără notițele conceptelor;
- separă automat documentul în secțiuni după headerele Markdown `#`–`######`;
- distribuie conținutul pe pagini verticale;
- răsfoire prin scroll orizontal, rotița mouse-ului, swipe sau tastele săgeată;
- două pagini simultan pe desktop și o pagină pe mobil/tabletă îngustă;
- mod fullscreen al browserului;
- editor rich-text separat pentru fiecare secțiune, cu autosave;
- păstrează bold, italic, underline, liste, tabele, citate, linkuri și highlights;
- temă luminoasă/întunecată pentru întregul site, memorată în browser.

## 1. Rulează migrarea Supabase

În Supabase deschide:

`SQL Editor → New query`

Copiază integral și rulează:

`supabase/phase5_lecture_mode.sql`

Scriptul creează tabela `lecture_sections`, politicile RLS și funcțiile:

- `sync_project_lecture_sections`
- `save_lecture_section`

Nu șterge traducerile, conceptele sau notițele existente.

## 2. Modifică repository-ul GitHub

### Înlocuiește

```text
js/app.js
js/db.js
styles.css
```

### Adaugă

```text
js/lecture-tools.js
supabase/phase5_lecture_mode.sql
```

### Nu modifica

```text
render.yaml
build.sh
supabase/functions/deepseek-proxy/index.ts
supabase/schema.sql
```

Fă commit. Render va reconstrui automat site-ul.

## 3. Prima utilizare

1. Așteaptă până când deploy-ul Render este `Live`.
2. Deschide site-ul și apasă `Ctrl + Shift + R`.
3. Deschide un proiect care are segmente traduse.
4. Alege tabul **Lecture Mode** sau butonul **Lecture** din Bibliotecă.
5. La prima intrare, aplicația construiește secțiunile din traducerile Markdown.

Dacă traducerile au fost modificate ulterior, în toolbar apare `traduceri modificate`. Apasă **Sincronizează**.

## Cum sunt păstrate editările

Traducerea Markdown din `chunks.translated_text` rămâne sursa și nu este suprascrisă de Lecture Mode.

Pentru fiecare secțiune sunt păstrate separat:

- `source_markdown` — traducerea actuală;
- `content_edited` — varianta ta HTML, formatată;
- `manual_revision` — numărul salvărilor;
- `source_changed` — avertisment dacă sursa Markdown s-a schimbat după editarea ta.

La sincronizare, editările personale sunt păstrate. Dacă sursa s-a schimbat, aplicația afișează un avertisment și nu suprascrie automat varianta ta.

## Editarea unei secțiuni

Apasă **Editează** în antetul paginii. Editorul permite:

- bold, italic, underline și text tăiat;
- titluri și subtitluri;
- liste numerotate și cu puncte;
- citate și linkuri;
- highlights: Important, Definiție, Exemplu, De revăzut;
- undo/redo și eliminarea formatării;
- autosave după aproximativ o secundă.

Butonul **Revino la traducerea Markdown** înlocuiește versiunea editată cu randarea sursei actuale, numai după confirmare.

## Navigare

- `←` / `→` sau `Page Up` / `Page Down` schimbă spread-ul;
- rotița verticală a mouse-ului produce scroll orizontal;
- pe telefon se folosește swipe;
- selectorul din toolbar sare direct la o secțiune;
- **Fullscreen** folosește API-ul fullscreen al browserului.

## Dark Mode

Butonul **Mod întunecat / Mod luminos** apare în topbar, autentificare, Wiki, Lecture Mode și editor. Preferința este salvată local în browser, fără modificări în Supabase.

## Dacă apare eroarea că Lecture Mode nu este disponibil

Migrarea SQL nu a fost rulată sau a fost rulată în alt proiect Supabase decât cel introdus la login. Rulează din nou `phase5_lecture_mode.sql` în proiectul corect și reîncarcă pagina.
