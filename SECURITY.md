# Securitate

## Ce date sunt introduse în browser

La autentificare, utilizatorul introduce:

- Supabase Project URL;
- Supabase Publishable Key;
- email;
- parolă.

URL-ul și cheia Publishable pot fi memorate opțional local în browser. Parola nu este salvată de aplicație; este trimisă direct către Supabase Auth prin clientul oficial Supabase JS.

## Chei permise

- `sb_publishable_...`;
- cheia legacy `anon` pentru proiecte vechi.

## Chei interzise

- `sb_secret_...`;
- `service_role`;
- parola bazei de date;
- connection string PostgreSQL;
- chei AI.

Aplicația verifică și refuză cele mai comune formate de chei privilegiate, dar utilizatorul rămâne responsabil să copieze cheia corectă.

## Row Level Security

Schema `supabase/schema.sql` activează RLS și limitează accesul fiecărui utilizator la propriile proiecte, segmente, intrări de glosar și PDF-uri.

O cheie Publishable este destinată utilizării în aplicații publice, dar nu înlocuiește RLS. Nu dezactiva politicile incluse fără să înțelegi consecințele.

## Hosting

Render găzduiește doar fișiere statice. Nu există un backend Render, funcții serverless sau variabile de mediu care să conțină chei Supabase ori AI.
