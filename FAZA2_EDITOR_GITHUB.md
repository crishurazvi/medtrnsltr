# Faza 2 — editor individual pentru concepte

Această actualizare se aplică peste versiunea cu Faza 1 deja funcțională.
Nu modifică traducerea DeepSeek, Edge Function-ul sau configurarea Render.

## 1. Fișiere de modificat în GitHub

Înlocuiește în repository:

```text
js/app.js
js/db.js
styles.css
```

Adaugă fișierul:

```text
supabase/phase2_concept_editor.sql
```

Nu modifica:

```text
render.yaml
build.sh
index.html
supabase/functions/deepseek-proxy/index.ts
```

După commit, Render va face deploy automat.

## 2. Migrarea obligatorie în Supabase

În Supabase Dashboard:

1. Deschide **SQL Editor**.
2. Alege **New query**.
3. Copiază integral conținutul din `supabase/phase2_concept_editor.sql`.
4. Apasă **Run**.
5. Confirmă că apare mesajul de succes.

Scriptul poate fi rulat din nou. Nu șterge traducerile, capitolele sau conceptele existente.

El adaugă în `concepts`:

- `content_original` — copia nemodificabilă construită din segmentele sursă;
- `content_edited` — versiunea ta editată în format HTML;
- `editor_updated_at` — ultima salvare;
- `manual_revision` — numărul salvărilor;
- `generated_title` și `generated_summary` — valorile generate de AI, folosite pentru conservarea editărilor la regenerare.

Mai creează funcția RPC:

```text
save_concept_editor
```

Aceasta salvează atomic un concept și crește numărul reviziei.

## 3. Ordinea recomandată

1. Rulează `phase2_concept_editor.sql` în Supabase.
2. Urcă fișierele modificate în GitHub.
3. Așteaptă ca Render să termine deploy-ul.
4. Deschide aplicația și apasă `Ctrl + Shift + R`.
5. Intră într-un proiect și deschide tabul **Capitole**.

## 4. Ce vei vedea

Pentru fiecare concept apare un editor individual cu:

- undo și redo;
- text normal, titlu și subtitlu;
- bold, italic, underline și text tăiat;
- liste cu puncte și liste numerotate;
- citate;
- linkuri;
- eliminarea formatării;
- număr de cuvinte;
- autosave după aproximativ o secundă;
- salvare manuală;
- copierea textului;
- revenire la conținutul extras din PDF.

Punctul portocaliu din arbore arată că acel concept are o versiune editată.

## 5. Protecția conținutului

Textul extras rămâne în `content_original` și nu este suprascris de editor.
Versiunea personală este salvată separat în `content_edited`.

HTML-ul este filtrat înainte de salvare. Sunt permise doar elementele necesare editorului: paragrafe, titluri, bold, italic, underline, liste, citate și linkuri sigure.

## 6. Regenerarea capitolelor

Noua versiune a funcției `replace_project_knowledge` încearcă să păstreze conținutul editat atunci când găsește din nou același capitol și același titlu de concept.

Dacă DeepSeek schimbă radical titlul sau elimină conceptul, asocierea nu mai poate fi garantată. Pentru proiectele foarte importante, exportă periodic un backup al bazei Supabase.

## 7. Test rapid

1. Selectează un concept.
2. Scrie o propoziție și aplică bold.
3. Așteaptă până apare **Salvat**.
4. Selectează alt concept.
5. Revino la primul.
6. Textul și formatarea trebuie să fie păstrate.
7. Reîncarcă pagina și verifică încă o dată.

## 8. Dacă apare o eroare

### „Editorul Fazei 2 nu este instalat”

Rulează `supabase/phase2_concept_editor.sql` și reîncarcă pagina.

### „Could not find the function public.save_concept_editor”

Migrarea SQL nu a fost rulată sau schema API Supabase nu s-a actualizat încă. Rulează din nou scriptul și reîncarcă aplicația după câteva secunde.

### Editarea nu se salvează

Verifică în Supabase:

```text
Table Editor → concepts → content_edited
```

și în Developer Tools → Console pentru mesajul complet.
