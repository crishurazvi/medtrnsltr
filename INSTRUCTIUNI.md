# Fix CORS DeepSeek

## GitHub
Înlocuiește fișierul:

- `js/db.js`

Fă commit și așteaptă redeploy-ul automat Render.

## Supabase Dashboard
Mergi la:

`Edge Functions → deepseek-proxy → Edit function`

Înlocuiește tot codul cu:

- `supabase/functions/deepseek-proxy/index.ts`

Apasă **Deploy function**.

În setările funcției păstrează **Verify JWT with legacy secret = OFF**.

## Test
Deschide în browser:

`https://PROJECT_REF.supabase.co/functions/v1/deepseek-proxy`

Trebuie să apară:

`{"ok":true,"function":"deepseek-proxy","version":3}`

Apoi fă `Ctrl+Shift+R` pe site și reîncearcă segmentele netraduse.
