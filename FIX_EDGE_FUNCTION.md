# Reparare „Failed to send a request to the Edge Function”

## 1. Înlocuiește în GitHub

- `supabase/functions/deepseek-proxy/index.ts`
- `js/db.js`

Commit-ul va actualiza automat interfața pe Render, dar NU publică automat funcția Supabase.

## 2. Publică funcția în proiectul Supabase corect

Din rădăcina repository-ului:

```bash
npx supabase@latest login
npx supabase@latest functions deploy deepseek-proxy --project-ref PROJECT_REF --no-verify-jwt --use-api
```

Înlocuiește `PROJECT_REF` cu textul dintre `https://` și `.supabase.co` din URL-ul introdus la login.

Exemplu: pentru `https://abcxyz.supabase.co`, project ref este `abcxyz`.

## 3. Verifică simplu

Deschide în browser:

```text
https://PROJECT_REF.supabase.co/functions/v1/deepseek-proxy
```

Rezultatul corect este:

```json
{"ok":true,"function":"deepseek-proxy","version":2}
```

Dacă vezi 404 / function not found, funcția nu este deployată în acel proiect sau numele este greșit.

## 4. Reîncarcă aplicația

Închide fila, redeschide site-ul Render, autentifică-te din nou și încearcă mai întâi traducerea unui singur segment.
