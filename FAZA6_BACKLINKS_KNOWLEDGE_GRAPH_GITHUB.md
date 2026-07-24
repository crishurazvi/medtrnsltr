# Faza 6 — Backlinking bidirecțional și Knowledge Graph

Această migrare se aplică peste proiectul complet din Faza 5.

## Ce aduce

- sintaxa internă `[[Concept]]` în:
  - editorul conceptului;
  - notițele personale;
  - editorul Lecture Mode;
- variante opționale:
  - `[[Concept|text afișat]]`;
  - `[[Titlul proiectului::Concept]]` când există titluri duplicate;
  - `[[Titlul proiectului::Concept|alias]]`;
- linkuri clickabile în Wiki și Lecture Mode;
- navigare către concepte din alte proiecte;
- backlinks sub fiecare concept în Wiki;
- Knowledge Graph global cu Vis Network;
- noduri pentru capitole, concepte și secțiuni Lecture care conțin linkuri;
- noduri roșii pentru legături nerezolvate;
- reindexarea conținutului existent;
- adaptare automată la Dark Mode.

## 1. Rulează migrarea SQL

În Supabase:

1. `SQL Editor`;
2. `New query`;
3. copiază integral `supabase/phase6_knowledge_graph.sql`;
4. apasă `Run`.

Scriptul creează:

- `concept_links`;
- `normalize_wiki_title()`;
- `sync_content_links()`;
- `resolve_concept_reference()`;
- `get_project_backlinks()`;
- `get_knowledge_graph()`;
- politici RLS pentru utilizatorul autentificat.

Nu șterge proiecte, traduceri, concepte, notițe sau secțiuni Lecture.

## 2. Modifică repository-ul GitHub

### Înlocuiește

```text
js/app.js
js/db.js
styles.css
```

### Adaugă

```text
js/wiki-links.js
js/knowledge-graph.js
supabase/phase6_knowledge_graph.sql
FAZA6_BACKLINKS_KNOWLEDGE_GRAPH_GITHUB.md
```

### Nu modifica

```text
render.yaml
build.sh
index.html
supabase/functions/deepseek-proxy/index.ts
supabase/schema.sql
```

`build.sh` copiază automat toate fișierele din `js/`, deci noile module vor intra în folderul `dist` la deploy.

## 3. Commit și deploy

Fă un commit în GitHub. Render va reconstrui automat site-ul.

După ce deploy-ul este `Live`:

1. deschide aplicația;
2. apasă `Ctrl + Shift + R`;
3. autentifică-te din nou dacă este necesar.

## 4. Reindexează textele existente

Linkurile se indexează automat la fiecare autosave nou. Pentru textele scrise înainte de instalarea Fazei 6:

1. intră în tabul global `Knowledge Graph`;
2. apasă `Reindexează [[linkurile]]`;
3. așteaptă finalizarea.

Aplicația parcurge:

- `concepts.content_edited`;
- `concepts.personal_notes`;
- `lecture_sections.content_edited`;
- traducerea Markdown a secțiunii Lecture dacă nu există încă o versiune editată.

## 5. Utilizare

În orice editor scrie:

```text
Tratamentul depinde de [[Severitatea stenozei aortice]].
```

Dacă titlul apare în mai multe proiecte:

```text
Vezi [[TAVI – Anatomie::Annulus]].
```

Pentru un alias mai scurt:

```text
Vezi [[Stenoza aortică severă|SA severă]].
```

În editor există și butonul `[[ ]]` / `[[Concept]]`, care introduce sintaxa fără să fie nevoie să scrii manual parantezele.

## 6. Autosave și protecția datelor

Ordinea este intenționat:

1. se salvează conținutul conceptului, notiței sau secțiunii Lecture;
2. apoi se sincronizează indexul de linkuri.

Dacă indexarea linkurilor eșuează, conținutul rămâne salvat. UI-ul afișează un avertisment separat, fără să marcheze fals textul drept pierdut.

La ștergerea sintaxei `[[...]]` și următorul autosave, relația veche este eliminată din `concept_links`.

## 7. Backlinks

În Viewing Mode Wiki, sub notițele fiecărui concept apare:

```text
Concepte care menționează această pagină
```

Un backlink poate proveni din:

- conținutul editat al altui concept;
- notițele personale ale altui concept;
- o secțiune Lecture Mode.

Click pe backlink deschide sursa în Wiki sau Lecture Mode.

## 8. Knowledge Graph

Tabul global `Knowledge Graph` conține:

- capitole — noduri dreptunghiulare;
- concepte — noduri circulare;
- secțiuni Lecture — noduri ovale;
- legături `[[...]]` — săgeți direcționale;
- apartenență capitol → concept — muchii punctate;
- referințe fără destinație — noduri roșii.

Interacțiuni:

- drag pentru repoziționare;
- scroll/pinch pentru zoom;
- click pentru panelul de detalii;
- dublu click pe concept pentru deschidere directă în Wiki;
- `Încadrează` pentru a readuce toate nodurile în ecran;
- filtre pentru capitole și Lecture Mode;
- căutare după titlu, rezumat, proiect sau tag.

## 9. Verificare recomandată

1. Deschide conceptul A.
2. Scrie în editor: `Vezi [[Conceptul B]].`
3. Așteaptă `Salvat`.
4. Mergi în Wiki la conceptul A: textul trebuie să fie clickabil.
5. Click pe link: trebuie să se deschidă conceptul B.
6. Sub conceptul B trebuie să apară A în Backlinks.
7. În `Knowledge Graph`, trebuie să existe săgeata A → B.
8. Șterge linkul din A și salvează: backlink-ul și săgeata trebuie să dispară.

## Observație despre titluri duplicate

Pentru `[[Concept]]`, aplicația prioritizează un concept cu același titlu din proiectul curent. Dacă sunt mai multe potriviri în bibliotecă, folosește forma explicită:

```text
[[Titlul proiectului::Numele conceptului]]
```
