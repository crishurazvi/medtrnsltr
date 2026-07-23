# Faza 4 — Bibliotecă și Viewing Mode Wiki

Această fază se aplică peste proiectul care are deja Fazele 1–3.

## Nu este necesară o migrare SQL nouă

Faza 4 folosește tabelele deja existente:

- `projects`
- `chunks`
- `chapters`
- `concepts`

Trebuie doar ca scripturile SQL ale Fazelor 1–3 să fi fost rulate anterior.

## Fișiere de înlocuit în GitHub

Înlocuiește exact:

```text
js/app.js
js/db.js
styles.css
```

Nu modifica:

```text
render.yaml
build.sh
supabase/functions/deepseek-proxy/index.ts
supabase/schema.sql
```

După commit, Render va reconstrui automat site-ul.

## Ce apare nou

### 1. Bibliotecă Wiki globală

După autentificare, aplicația se deschide în `Bibliotecă Wiki`.

Biblioteca permite:

- afișarea tuturor proiectelor și cursurilor;
- căutare transversală în titluri, capitole, concepte, tag-uri, notițe și traduceri;
- deschiderea directă a unui proiect în Wiki;
- deschiderea directă a unui concept găsit prin căutare;
- trecerea în modul `Proiecte` pentru import și administrare.

### 2. Tab nou în fiecare proiect: Wiki

Fiecare proiect are trei moduri:

```text
Wiki
Traducere
Concepte & editare
```

### 3. Pagină Wiki pe capitole

Fiecare capitol este colapsabil și conține:

1. textul tradus complet al capitolului, randat din Markdown;
2. conceptele/subcapitolele identificate;
3. paginile proprii ale conceptelor editate manual;
4. notițele personale, care pot fi afișate sau ascunse.

### 4. Formatarea este păstrată

În textul tradus sunt randate:

- titluri Markdown;
- bold și italic;
- liste;
- citate;
- linkuri;
- tabele;
- cod inline și blocuri de cod;
- linii de separare.

În paginile de concept sunt păstrate și:

- underline;
- text tăiat;
- highlights `Important`, `Definiție`, `Exemplu`, `De revăzut`;
- notițele personale;
- linkurile și listele introduse în editor.

### 5. Editare din Viewing Mode

În dreptul fiecărui concept există:

```text
Editează și formatează
```

Butonul deschide conceptul în editorul din Faza 2/3. După autosave, revenirea în tabul `Wiki` afișează versiunea salvată.

## Instalare

1. Înlocuiește cele trei fișiere în repository.
2. Fă commit pe branch-ul conectat la Render.
3. Așteaptă ca deploy-ul să devină `Live`.
4. Deschide site-ul și apasă `Ctrl + Shift + R`.
5. Intră în `Bibliotecă Wiki`.
6. Deschide un proiect cu butonul `Citește în Wiki`.

## Verificare recomandată

1. Deschide un proiect tradus.
2. Confirmă că tabul `Wiki` afișează capitolele.
3. Confirmă că un tabel Markdown este randat ca tabel.
4. Intră în `Concepte & editare` și adaugă underline și un highlight.
5. Salvează și revino în `Wiki`.
6. Confirmă că formatarea apare în pagina conceptului.
7. Testează `Restrânge tot`, `Extinde tot` și căutarea globală.
