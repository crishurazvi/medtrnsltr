# Tutorial complet: GitHub → Render → Supabase

Acest ghid publică MedTranslate Studio ca site static pe Render, pornind dintr-un repository GitHub.

În această versiune **nu pui URL-ul sau cheia Supabase în GitHub și nici în Render Environment Variables**. Aplicația le cere în ecranul de login.

## Cum funcționează arhitectura

```text
GitHub repository
       ↓ deploy automat
Render Static Site
       ↓ utilizatorul introduce la login
Supabase URL + Publishable Key
       ↓
Supabase Auth + Postgres + Storage
```

Render găzduiește doar fișierele HTML/CSS/JavaScript. Nu există server propriu și nu există nicio cheie AI.

---

# Partea I — Configurează Supabase

## 1. Creează proiectul

1. Intră în Supabase Dashboard.
2. Creează un proiect nou.
3. Așteaptă finalizarea inițializării bazei de date.
4. Nu ai nevoie de parola bazei de date în aplicație.

## 2. Creează tabelele și politicile RLS

1. În proiectul Supabase deschide **SQL Editor**.
2. Alege **New query**.
3. Deschide local fișierul:

```text
supabase/schema.sql
```

4. Copiază întregul conținut.
5. Lipește-l în SQL Editor.
6. Apasă **Run**.

Scriptul creează:

- `projects`;
- `chunks`;
- `glossary`;
- trigger-ele pentru `updated_at`;
- politicile Row Level Security;
- bucket-ul privat opțional `source-pdfs`;
- politicile Storage.

Rulează scriptul integral, nu doar primele tabele.

## 3. Creează utilizatorul

Pentru uz personal este mai sigur să creezi contul manual:

1. deschide **Authentication**;
2. intră la **Users**;
3. alege **Add user / Create new user**;
4. introdu emailul și parola;
5. marchează emailul ca verificat, dacă interfața îți oferă opțiunea.

Poți dezactiva înscrierile publice din setările Authentication. Butonul „Creează cont” din aplicație va returna atunci mesajul Supabase corespunzător, iar autentificarea contului creat manual va continua să funcționeze.

## 4. Găsește URL-ul și cheia corectă

În Supabase deschide dialogul **Connect** sau:

```text
Settings → API Keys
```

Ai nevoie de:

### Supabase Project URL

Exemplu:

```text
https://abcdefghijk.supabase.co
```

### Publishable Key

Exemplu:

```text
sb_publishable_...
```

Pentru un proiect mai vechi poți folosi și cheia legacy `anon`, care arată ca un JWT lung începând de obicei cu `eyJ...`.

Nu folosi:

```text
sb_secret_...
```

și nu folosi cheia:

```text
service_role
```

Aplicația încearcă să blocheze aceste chei, deoarece ele nu trebuie să ajungă niciodată în browser.

---

# Partea II — Urcă proiectul pe GitHub

## Varianta simplă, direct din browser

### 1. Dezarhivează proiectul

Dezarhivează ZIP-ul. În folder trebuie să vezi direct:

```text
index.html
styles.css
render.yaml
build.sh
README.md
js/
supabase/
```

Important: aceste fișiere trebuie să fie în rădăcina repository-ului, nu într-un subfolder suplimentar de tip:

```text
medtranslate-render/medtranslate-render/index.html
```

### 2. Creează repository-ul

1. În GitHub alege **New repository**.
2. Nume recomandat:

```text
medtranslate-studio
```

3. Poate fi public sau privat.
4. Nu bifa generarea unui README nou dacă vrei să eviți conflictele.
5. Creează repository-ul.

### 3. Încarcă fișierele

1. În repository alege **Add file → Upload files**.
2. Selectează toate fișierele și folderele din proiect.
3. Verifică să apară `index.html` și `render.yaml` direct în rădăcină.
4. Alege **Commit changes**.

## Varianta Git din terminal

Din folderul proiectului:

```bash
git init
git add .
git commit -m "Initial MedTranslate Studio Render version"
git branch -M main
git remote add origin https://github.com/UTILIZATORUL-TAU/medtranslate-studio.git
git push -u origin main
```

Înlocuiește URL-ul repository-ului cu al tău.

---

# Partea III — Publică pe Render

Ai două metode. Prima este cea mai simplă pentru proiectul inclus.

## Metoda A — Render Blueprint

1. Creează un cont Render sau autentifică-te.
2. În Dashboard alege:

```text
New → Blueprint
```

3. Conectează contul GitHub.
4. Acordă Render acces la repository-ul `medtranslate-studio`.
5. Selectează repository-ul.
6. Render detectează automat fișierul `render.yaml`.
7. Confirmă crearea Blueprint-ului.
8. Așteaptă deploy-ul.

Fișierul `render.yaml` spune Render să folosească:

```text
Runtime: Static
Build command: bash build.sh
Publish directory: dist
```

După deploy vei primi un URL asemănător:

```text
https://medtranslate-studio.onrender.com
```

## Metoda B — Static Site configurat manual

Dacă nu vrei Blueprint:

1. în Render alege **New → Static Site**;
2. conectează repository-ul GitHub;
3. alege branch-ul `main`;
4. completează:

```text
Build Command: bash build.sh
Publish Directory: dist
```

5. nu adăuga Environment Variables;
6. apasă **Create Static Site**.

## Deploy-urile viitoare

După ce Render este legat la branch-ul `main`, fiecare commit nou în GitHub declanșează în mod normal un deploy automat.

---

# Partea IV — Configurează redirecturile Supabase

Acest pas este important pentru:

- confirmarea contului prin email;
- resetarea parolei;
- eventuale redirecturi Auth.

1. Copiază URL-ul final Render.
2. În Supabase deschide:

```text
Authentication → URL Configuration
```

3. La **Site URL** introdu URL-ul Render exact, de exemplu:

```text
https://medtranslate-studio.onrender.com
```

4. La **Redirect URLs** adaugă:

```text
https://medtranslate-studio.onrender.com/**
```

Pentru testare locală poți adăuga și:

```text
http://localhost:8080/**
```

În producție este preferabil să păstrezi URL-ul exact al site-ului tău.

---

# Partea V — Prima autentificare

Deschide URL-ul Render.

Ecranul cere patru câmpuri:

1. **Supabase Project URL**;
2. **Supabase Publishable Key**;
3. **Email**;
4. **Parolă**.

Completează datele proiectului Supabase și contul creat în Authentication.

## Opțiunea „Ține minte”

Dacă este bifată, URL-ul și cheia Publishable sunt salvate în `localStorage` în browserul curent.

Dacă nu este bifată, ele sunt păstrate numai pentru sesiunea filei/browserului prin `sessionStorage`.

Cheia Publishable nu este un secret administrativ, dar trebuie să ai RLS activ. Cheile Secret și `service_role` sunt interzise.

## Schimbarea proiectului Supabase

După autentificare, în bara de sus apare hostname-ul proiectului Supabase. Apasă pe el pentru a te deconecta și a reveni la ecranul unde poți introduce alt URL și altă cheie.

Poți folosi și butonul:

```text
Șterge datele Supabase salvate
```

pentru a șterge conexiunea din browser.

---

# Partea VI — Test complet

După login:

1. creează un proiect nou;
2. încarcă un PDF care conține text selectabil;
3. lasă dimensiunea segmentului la 2.500;
4. creează proiectul;
5. apasă „Copiază prompt + segment”;
6. lipește textul într-un AI ales manual;
7. copiază traducerea;
8. lipește-o în panoul din dreapta;
9. verifică mesajul de autosalvare;
10. reîncarcă pagina;
11. autentifică-te din nou și confirmă că proiectul există.

---

# Depanare

## Render spune că build-ul a eșuat

Verifică să existe în rădăcina repository-ului:

```text
build.sh
render.yaml
index.html
```

În setările Render, valorile trebuie să fie:

```text
Build Command: bash build.sh
Publish Directory: dist
```

Folosește `bash build.sh`, nu doar `./build.sh`, pentru a evita problemele cu permisiunea executabilă după uploadul prin browser.

## Site-ul arată 404

Verifică `Publish Directory`. Trebuie să fie exact:

```text
dist
```

Nu `./medtranslate-render`, nu `public` și nu rădăcina repository-ului.

## Aplicația spune „Invalid API key”

Ai introdus probabil:

- o cheie din alt proiect;
- cheia Secret;
- cheia trunchiată;
- URL-ul unui proiect diferit.

Copiază URL-ul și Publishable Key din același proiect Supabase.

## Loginul funcționează, dar apar erori despre tabele

Cel mai probabil `supabase/schema.sql` nu a fost rulat integral sau a fost rulat în alt proiect decât cel ale cărui date le introduci la login.

## „Invalid login credentials”

Verifică:

- emailul;
- parola;
- că utilizatorul există în proiectul Supabase selectat;
- că emailul este confirmat, dacă proiectul cere confirmare.

## Resetarea parolei trimite la adresa greșită

Verifică în Supabase:

```text
Authentication → URL Configuration
```

Site URL trebuie să fie domeniul Render, iar domeniul trebuie să existe și în Redirect URLs.

## PDF-ul nu extrage text

PDF-ul poate fi scanat ca imagine. Această versiune nu include OCR. Încearcă un PDF cu text selectabil sau trece documentul prin OCR înainte de upload.

## Clipboard-ul nu funcționează

Render oferă HTTPS, dar browserul poate cere permisiune. Poți selecta textul manual sau poți folosi `Ctrl+C` și `Ctrl+V`.

---

# Checklist final

- [ ] `supabase/schema.sql` a fost rulat integral.
- [ ] există un utilizator în Supabase Authentication.
- [ ] repository-ul GitHub are `index.html` în rădăcină.
- [ ] repository-ul GitHub are `render.yaml` în rădăcină.
- [ ] Render folosește `bash build.sh`.
- [ ] Render publică folderul `dist`.
- [ ] URL-ul Render este setat în Supabase Auth URL Configuration.
- [ ] la login folosești Project URL și Publishable Key din același proiect.
- [ ] nu ai introdus Secret Key sau service_role.
- [ ] autentificarea și autosalvarea au fost testate.
