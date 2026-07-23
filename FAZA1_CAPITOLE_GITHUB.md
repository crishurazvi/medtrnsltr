# Implementare Faza 1 — Capitole și concepte

Această versiune păstrează integral traducerea existentă și adaugă un view separat de tip wiki.

## Ce se schimbă în GitHub

Înlocuiește aceste fișiere:

```text
js/app.js
js/db.js
styles.css
```

Adaugă:

```text
supabase/phase1_chapters.sql
```

Poți înlocui și `supabase/schema.sql` cu versiunea inclusă, dar pentru un proiect Supabase deja creat este suficient să rulezi fișierul incremental `phase1_chapters.sql`.

Nu modifica:

```text
render.yaml
build.sh
supabase/functions/deepseek-proxy/index.ts
```

Funcția DeepSeek care traduce deja segmentele este reutilizată și pentru analiza structurii. Nu este necesar un nou Edge Function și nu trebuie publicată din nou funcția existentă.

## Pas obligatoriu în Supabase

1. Deschide Supabase Dashboard.
2. Intră în proiectul folosit de aplicație.
3. Deschide **SQL Editor**.
4. Creează o interogare nouă.
5. Copiază integral conținutul fișierului:

```text
supabase/phase1_chapters.sql
```

6. Apasă **Run**.

Scriptul creează:

- `chapters`;
- `concepts`;
- politicile RLS;
- indexurile;
- funcția tranzacțională `replace_project_knowledge`.

Scriptul este idempotent și poate fi rulat din nou fără să dubleze tabelele sau politicile.

## Deploy

După commit, Render va reconstrui automat site-ul cu comanda existentă:

```text
bash build.sh
```

După terminarea deploy-ului, deschide aplicația și folosește `Ctrl + Shift + R`.

## Utilizare

1. Deschide un proiect existent.
2. În partea de sus apar două taburi:
   - **Traducere**;
   - **Capitole**.
3. Deschide **Capitole**.
4. Apasă **Generează structura**.
5. DeepSeek analizează fiecare segment pe rând.
6. Structura este salvată numai după terminarea analizei, printr-o funcție SQL tranzacțională.

Dacă unele segmente nu sunt traduse, aplicația folosește textul original pentru ele. Titlurile, rezumatele și tag-urile sunt cerute în limba română.

## Ce include Faza 1

- structură `capitole → concepte`;
- detectare automată cu DeepSeek;
- căutare în titluri, rezumate și tag-uri;
- navigare într-un arbore lateral;
- legătură între concept și segmentele/paginile sursă;
- vizualizarea traducerii și a originalului asociat;
- regenerarea completă a structurii;
- protecție RLS pentru fiecare utilizator.

## Ce NU include încă

- editarea rich-text a conceptelor;
- notițe personale;
- highlight-uri;
- resurse suplimentare;
- flashcard-uri și mod examen.

Acestea rămân pentru fazele următoare.

## Siguranța informației

DeepSeek primește fiecare segment separat. Promptul îi cere explicit să folosească numai informația din segment și să nu completeze cu informații externe. Conceptele păstrează referințe către fragmentele sursă, pentru verificare umană.
