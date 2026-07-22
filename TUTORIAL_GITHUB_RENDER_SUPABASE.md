# Tutorial GitHub + Render + Supabase + DeepSeek

Aplicația continuă să fie publicată pe Render ca Static Site. Pentru traducerea automată, se adaugă o singură Supabase Edge Function.

Urmează integral instrucțiunile din:

```text
MODIFICARI_GITHUB_DEEPSEEK.md
```

Ordinea este:

1. înlocuiești și adaugi fișierele în GitHub;
2. Render redeployează automat site-ul;
3. deployezi funcția `deepseek-proxy` în Supabase;
4. introduci cheia DeepSeek la autentificare;
5. creezi PDF-ul cu traducere automată bifată.

Configurarea Render rămâne:

```text
Build Command: bash build.sh
Publish Directory: ./dist
```
