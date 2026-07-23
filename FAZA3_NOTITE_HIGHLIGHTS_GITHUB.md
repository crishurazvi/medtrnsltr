# Faza 3 — Notițe personale și highlight-uri

Această actualizare se aplică peste proiectul care are deja Fazele 1 și 2 instalate.
Nu modifică funcția `deepseek-proxy`, configurarea Render sau fluxul de traducere.

## 1. Rulează migrarea în Supabase

În Supabase Dashboard:

1. Deschide **SQL Editor**.
2. Alege **New query**.
3. Copiază integral fișierul:

```text
supabase/phase3_notes_highlights.sql
```

4. Apasă **Run**.

Migrarea adaugă în tabela `concepts`:

- `personal_notes`
- `notes_format`
- `notes_updated_at`
- `notes_revision`

Mai creează funcția RPC `save_concept_notes` și actualizează
`replace_project_knowledge`, astfel încât notițele și highlight-urile să fie
păstrate la regenerarea structurii cu DeepSeek.

## 2. Modifică repository-ul GitHub

Înlocuiește:

```text
js/app.js
js/db.js
styles.css
```

Adaugă:

```text
supabase/phase3_notes_highlights.sql
```

Nu modifica:

```text
render.yaml
build.sh
index.html
supabase/functions/deepseek-proxy/index.ts
```

Fă commit. Render va porni automat un deploy nou.

## 3. Reîncarcă aplicația

După ce deploy-ul Render este `Live`:

1. Deschide site-ul.
2. Apasă `Ctrl + Shift + R`.
3. Autentifică-te.
4. Deschide un proiect și tabul **Capitole**.

## Ce aduce Faza 3

### Highlight-uri semantice

Selectează text din editor și alege una dintre categorii:

- **Important** — galben
- **Definiție** — verde-turcoaz
- **Exemplu** — albastru
- **De revăzut** — roșu deschis

Butonul **Fără highlight** elimină evidențierea selectată. Pentru rezultate
predictibile, selectează text dintr-un singur paragraf sau element de listă.

Highlight-urile sunt salvate în `content_edited` folosind markup-ul:

```html
<mark data-highlight="definition">...</mark>
```

Aplicația acceptă numai cele patru categorii și elimină atributele HTML
nepermise înainte de salvare.

### Notițe personale

Fiecare concept primește un editor separat **Notițele mele**, cu:

- bold, italic și underline;
- liste;
- linkuri;
- autosave separat;
- revizie și data ultimei salvări;
- golirea explicită a notițelor.

Notițele nu modifică textul extras și nu sunt trimise către DeepSeek.

## Protecția datelor

- RLS-ul existent al tabelei `concepts` continuă să se aplice.
- `save_concept_notes` verifică `auth.uid()`.
- HTML-ul este filtrat în browser înainte de salvare.
- Notițele și highlight-urile sunt conservate când regenerezi structura, dacă
  DeepSeek păstrează același titlu pentru capitol și concept.

## Test rapid

1. Selectează o propoziție și apasă **Definiție**.
2. Așteaptă să apară `Salvat`.
3. Scrie o notiță și așteaptă din nou `Salvat`.
4. Deschide alt concept și revino.
5. Reîncarcă pagina.

Atât highlight-ul, cât și notița trebuie să fie prezente.
