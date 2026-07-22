# Fix pentru „DeepSeek nu a returnat o traducere validă”

Acest patch repară două lucruri:

1. aplicația acceptă atât răspunsul normalizat `{ translation: ... }`, cât și răspunsul brut DeepSeek;
2. dacă DeepSeek chiar întoarce conținut gol, mesajul afișează `finish_reason`, structura răspunsului și trace ID-ul, fără a afișa cheia API.

## 1. GitHub

Înlocuiește:

```text
js/db.js
```

Fă Commit și așteaptă deploy-ul Render.

## 2. Supabase

Intră la:

```text
Edge Functions → deepseek-proxy → Edit
```

Înlocuiește tot codul cu:

```text
supabase/functions/deepseek-proxy/index.ts
```

Apasă **Deploy function**.

Păstrează `Verify JWT with legacy secret` pe OFF.

## 3. Verificare

Deschide:

```text
https://PROJECT_REF.supabase.co/functions/v1/deepseek-proxy
```

Trebuie să vezi `"version":4`.

Apoi fă `Ctrl + Shift + R` pe site și reîncearcă segmentele netraduse.
