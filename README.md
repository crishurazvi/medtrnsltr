# MedTranslate Studio — DeepSeek Auto

Aplicație web pentru traducerea automată a documentelor medicale PDF, găzduită ca site static pe Render, cu datele salvate în Supabase.

## Flux

1. utilizatorul introduce Supabase URL, Publishable Key, contul și cheia DeepSeek;
2. cheia DeepSeek este păstrată numai în `sessionStorage`, până la închiderea filei;
3. PDF-ul este extras și împărțit local în browser;
4. aplicația trimite secvențial fiecare segment către funcția `deepseek-proxy` din Supabase;
5. funcția validează sesiunea utilizatorului și redirecționează cererea către DeepSeek;
6. fiecare traducere este salvată imediat în tabelul `chunks`;
7. traducerea poate fi oprită și reluată fără pierderea progresului.

Copy–paste-ul manual a fost păstrat ca rezervă.

## Fișiere importante

- `js/app.js` — autentificare, interfață și coada de traducere;
- `js/deepseek-session.js` — validarea și stocarea temporară a cheii;
- `js/db.js` — apelul funcției Supabase și operațiile bazei de date;
- `supabase/functions/deepseek-proxy/index.ts` — proxy-ul autentificat către DeepSeek;
- `supabase/config.toml` — dezactivează verificarea JWT legacy; funcția validează manual utilizatorul;
- `MODIFICARI_GITHUB_DEEPSEEK.md` — instalarea exactă.

## Modele

- `deepseek-v4-flash` — implicit și recomandat pentru traducere;
- `deepseek-v4-pro` — opțional.

Apelul folosește modul non-thinking pentru a evita cost și latență inutile la traducere.

## Build Render

Configurarea Render nu se schimbă:

```text
Build Command: bash build.sh
Publish Directory: ./dist
```

## Limitări de securitate

Cheia DeepSeek nu este salvată în GitHub, Render, Supabase Database sau Storage. Totuși, cât timp fila este deschisă, cheia există în browser și poate fi văzută de codul care rulează pe acel origin, de extensii malițioase sau în Network DevTools. Folosește aplicația numai pe dispozitive de încredere și setează limite de credit în contul DeepSeek.
