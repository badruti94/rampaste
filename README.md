# rampaste

## Struktur

```
rampaste/
├── api/index.js        # entry point serverless Vercel (export app Express)
├── src/store.js        # penyimpanan RAM + logika wipe per jam
├── src/app.js          # route & middleware Express
├── public/index.html   # UI (satu file, tanpa build step)
├── server.js           # entry point lokal / VPS
├── tests/store.test.js # test node:test
└── vercel.json         # rewrites + cron
```

## Jalan lokal

```bash
npm install
npm start
npm test
```
