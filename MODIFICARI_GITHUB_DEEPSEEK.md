# Integrarea DeepSeek automată — pași exacți

## 1. Modifică repository-ul GitHub

În repository-ul care funcționează deja, înlocuiește aceste fișiere cu versiunile din arhivă:

```text
js/app.js
js/db.js
styles.css
README.md
SECURITY.md
```

Adaugă aceste fișiere noi, păstrând exact directoarele:

```text
js/deepseek-session.js
supabase/config.toml
supabase/functions/deepseek-proxy/index.ts
```

Nu modifica:

```text
render.yaml
build.sh
supabase/schema.sql
```

`build.sh` copiază automat toate fișierele din `js/`, deci noul `deepseek-session.js` va intra în build.

După upload, fă un commit pe branch-ul conectat la Render. Render va redeploya automat interfața.

## 2. Deployează Edge Function în Supabase

Doar urcarea codului în GitHub nu publică automat funcția Supabase. Trebuie deployată o singură dată.

### Varianta recomandată: Supabase CLI

În terminal, din folderul repository-ului:

```bash
npx supabase@latest login
npx supabase@latest link --project-ref PROJECT_REF
npx supabase@latest functions deploy deepseek-proxy --no-verify-jwt
```

`PROJECT_REF` este partea din URL înainte de `.supabase.co`:

```text
https://PROJECT_REF.supabase.co
```

Exemplu:

```bash
npx supabase@latest link --project-ref abcdefghijklmnop
npx supabase@latest functions deploy deepseek-proxy --no-verify-jwt
```

Nu adăuga cheia DeepSeek în Supabase Secrets. Utilizatorul o introduce în aplicație la login.

### Varianta Dashboard

În Supabase:

1. intră la **Edge Functions**;
2. alege **Deploy a new function**;
3. numește funcția exact `deepseek-proxy`;
4. copiază conținutul din `supabase/functions/deepseek-proxy/index.ts`;
5. dezactivează verificarea JWT legacy / selectează opțiunea echivalentă cu `--no-verify-jwt`;
6. deployează.

Funcția validează manual utilizatorul autentificat, chiar dacă verificarea legacy este dezactivată.

## 3. Login

Pagina de login va cere:

1. Supabase Project URL;
2. Supabase Publishable Key;
3. DeepSeek API Key;
4. modelul DeepSeek;
5. emailul și parola Supabase.

Cheia DeepSeek este salvată în `sessionStorage`. Este ștearsă la logout și când fila este închisă. Nu este trimisă către baza de date.

## 4. Traducerea automată

La crearea proiectului este bifată implicit opțiunea:

```text
Începe automat traducerea tuturor segmentelor
```

După extragerea și salvarea segmentelor:

- segmentele sunt trimise unul câte unul;
- fiecare rezultat este salvat imediat;
- erorile 429, 500, 502, 503 și 504 sunt reîncercate automat;
- procesul poate fi oprit după segmentul curent;
- segmentele deja traduse nu sunt retrimise când apeși „Traduce automat toate netraduse”.

În editor există și:

```text
Traduce segmentul
Traduce automat toate netraduse
```

## 5. Verificarea rapidă

Creează un proiect cu un PDF de 1–2 pagini și lasă opțiunea de traducere automată bifată.

Rezultatul corect:

1. apare fereastra de progres;
2. numărul segmentului avansează;
3. traducerea este salvată în editor;
4. după refresh, traducerea rămâne;
5. după închiderea filei, aplicația cere din nou cheia DeepSeek.

## 6. Erori uzuale

### Function not found / 404

Funcția `deepseek-proxy` nu a fost deployată sau are alt nume.

### 401 de la DeepSeek

Cheia DeepSeek este greșită, incompletă sau revocată.

### 401 sesiune Supabase

Ieși din cont și autentifică-te din nou.

### 402 Insufficient Balance

Contul DeepSeek nu mai are credit.

### 429 / 503

Aplicația reîncearcă automat. Dacă persistă, oprește și reia mai târziu.

### CORS

Verifică dacă ai deployat exact codul funcției incluse și dacă numele este `deepseek-proxy`.

## 7. Recomandări de siguranță

- folosește o cheie DeepSeek dedicată acestei aplicații;
- alimentează contul cu o sumă mică;
- rotește cheia dacă suspectezi că a fost expusă;
- nu folosi aplicația pe calculatoare publice;
- nu pune cheia DeepSeek în GitHub, Render Environment Variables sau Supabase Database.
