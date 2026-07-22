# Securitate

## Cheia DeepSeek

Cheia este:

- introdusă de utilizator;
- validată în browser;
- păstrată în `sessionStorage`;
- ștearsă la logout sau la închiderea filei;
- trimisă prin HTTPS în headerul `x-deepseek-api-key` către Edge Function;
- folosită numai pentru apelul curent către DeepSeek.

Cheia nu este scrisă în:

- GitHub;
- fișierele build-ului Render;
- variabile de mediu Render;
- tabelele Supabase;
- Supabase Storage.

Aceasta nu este echivalentă cu păstrarea într-un keychain de sistem. Orice cheie folosită de o aplicație web este accesibilă temporar în browser. Nu utiliza site-ul pe calculatoare publice și evită extensiile de browser necunoscute.

## Edge Function

`deepseek-proxy` este deployată cu `verify_jwt = false` pentru a evita incompatibilitățile verificării JWT legacy cu cheile noi Supabase. Funcția nu este publică în sens practic: validează manual tokenul utilizatorului cu `supabase.auth.getUser()` înainte de orice apel DeepSeek.

Funcția:

- acceptă numai POST;
- permite numai modelele `deepseek-v4-flash` și `deepseek-v4-pro`;
- limitează dimensiunea prompturilor;
- nu loghează cheia sau corpul cererii;
- nu returnează cheia către client;
- folosește `Cache-Control: no-store`.

## Supabase

În browser sunt permise numai Publishable Key sau cheia legacy `anon`. Nu introduce:

- `sb_secret_...`;
- `service_role`;
- parola bazei de date;
- connection string PostgreSQL.

Datele din tabele rămân protejate de politicile RLS din `supabase/schema.sql`.
