import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.js';
import { HttpError } from './store.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true); // supaya req.protocol benar di belakang proxy Vercel
  app.use(express.json({ limit: '256kb' }));

  const api = express.Router();

  // Cek jam di setiap request: kalau slot jamnya berubah, semua RAM dibuang.
  api.use((req, res, next) => {
    store.tick();
    next();
  });

  api.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  const baseUrl = (req) => `${req.protocol}://${req.get('host')}`;

  api.get('/health', (req, res) => res.json({ ok: true, time: Date.now() }));

  api.get('/stats', (req, res) => res.json(store.stats()));

  api.get('/list', (req, res) => res.json({ items: store.list() }));

  // Buat paste baru.
  // body: { content, lang?, ttl? (detik), burn?, unlisted? }
  api.post('/paste', (req, res) => {
    const body = req.body || {};
    const { paste, deleteToken } = store.create({
      content: body.content,
      lang: body.lang,
      ttlSeconds: body.ttl,
      burn: body.burn,
      unlisted: body.unlisted,
    });
    res.status(201).json({
      id: paste.id,
      url: `${baseUrl(req)}/?p=${paste.id}`,
      rawUrl: `${baseUrl(req)}/api/paste/${paste.id}/raw`,
      deleteToken,
      lang: paste.lang,
      bytes: paste.bytes,
      createdAt: paste.createdAt,
      expiresAt: paste.expiresAt,
    });
  });

  api.get('/paste/:id', (req, res) => {
    const p = store.take(req.params.id);
    if (!p) throw new HttpError(404, 'paste tidak ditemukan (mungkin sudah dihapus saat pergantian jam)');
    res.json({
      id: p.id,
      content: p.content,
      lang: p.lang,
      burn: p.burn,
      burned: !!p.burned,
      createdAt: p.createdAt,
      expiresAt: p.expiresAt,
      views: p.views,
      bytes: p.bytes,
    });
  });

  api.get('/paste/:id/raw', (req, res) => {
    const p = store.take(req.params.id);
    if (!p) throw new HttpError(404, 'paste tidak ditemukan');
    res.type('text/plain; charset=utf-8').send(p.content);
  });

  api.delete('/paste/:id', (req, res) => {
    const token = (req.body && req.body.deleteToken) || req.query.token;
    store.remove(req.params.id, token);
    res.json({ ok: true, deleted: req.params.id });
  });

  // Dipanggil Vercel Cron (atau manual). Kalau CRON_SECRET di-set, wajib Bearer token.
  const purge = (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (secret) {
      const auth = req.get('authorization') || '';
      if (auth !== `Bearer ${secret}`) throw new HttpError(401, 'unauthorized');
    }
    res.json({ ok: true, ...store.wipeAll('cron') });
  };
  api.get('/cron/purge', purge);
  api.post('/cron/purge', purge);

  api.use((req, res) => res.status(404).json({ error: 'not found', path: req.originalUrl }));

  app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: 0 }));
  // Dua mount: di Vercel rewrite bisa datang sebagai /api/... maupun /... (path asli).
  app.use('/api', api);
  app.use('/', api);

  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'internal error' });
  });

  return app;
}
