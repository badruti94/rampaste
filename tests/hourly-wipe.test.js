// Test end-to-end lewat HTTP nyata (Express + fetch), dengan jam palsu yang bisa digeser
// beberapa jam dalam sekejap — jadi wipe per jam terbukti tanpa menunggu sejam.
//
// Cara kerja jam palsu:
//   setPhase(ms)  -> taruh jam palsu di posisi `ms` dalam jam berjalan (deterministik)
//   jumpHours(n)  -> geser jam palsu maju persis n jam (melewati batas jam n kali)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const HOUR = 3_600_000;
const realNow = Date.now;
let offset = 0;
Date.now = () => realNow() + offset;

const setPhase = (ms) => { offset = ms - (realNow() % HOUR); };
const jumpHours = (n) => { offset += n * HOUR; };
const minutes = (m) => m * 60_000;

// import setelah Date.now dipatch, supaya store menghitung slot jam dari jam palsu
const { createApp } = await import('../src/app.js');
const store = await import('../src/store.js');

const server = http.createServer(createApp());
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

async function createPaste(body) {
  const res = await fetch(`${base}/api/paste`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
const getJson = async (path) => (await fetch(base + path)).json();
const getCode = async (path) => (await fetch(base + path)).status;

test('memasuki jam berikutnya: request pertama menghapus semua isi RAM', async () => {
  setPhase(HOUR - minutes(5)); // 5 menit sebelum batas jam
  store.wipeAll('test');

  const a = await createPaste({ content: 'paste A' });
  const b = await createPaste({ content: 'paste B' });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);

  const first = await fetch(`${base}/api/paste/${a.body.id}`);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).content, 'paste A');

  const before = await getJson('/api/stats');
  assert.equal(before.items, 2, 'dua paste ada di RAM sebelum batas jam');

  jumpHours(1); // sekarang lewat batas jam
  const afterWipe = await getJson('/api/stats');

  assert.equal(afterWipe.items, 0, 'RAM harus bersih di request pertama setelah batas jam');
  assert.ok(afterWipe.lastWipeAt > before.lastWipeAt, 'lastWipeAt bergerak');
  assert.equal(await getCode(`/api/paste/${a.body.id}`), 404, 'paste A hilang');
  assert.equal(await getCode(`/api/paste/${b.body.id}`), 404, 'paste B hilang');
  assert.equal((await getJson('/api/list')).items.length, 0, 'daftar publik kosong');
});

test('lewati 5 jam sekaligus (tidak ada request sama sekali selama itu)', async () => {
  setPhase(HOUR - minutes(1));
  store.wipeAll('test');
  const { status, body } = await createPaste({ content: 'paste lama' });
  assert.equal(status, 201);

  jumpHours(5); // seolah tidak ada request selama 5 jam

  const stats = await getJson('/api/stats');
  assert.equal(stats.items, 0);
  assert.ok(stats.totalWiped >= 1);
  assert.equal(await getCode(`/api/paste/${body.id}`), 404);
});

test('paste yang dibuat tepat setelah batas jam tetap hidup sejam', async () => {
  setPhase(1_000); // 1 detik setelah batas jam
  store.wipeAll('test');
  const { status, body } = await createPaste({ content: 'lahir setelah batas jam' });
  assert.equal(status, 201);

  const stats = await getJson('/api/stats');
  assert.equal(stats.items, 1);
  assert.ok(stats.nextWipeAt - stats.now > HOUR - minutes(1), 'sisa waktu harus hampir sejam');

  setPhase(minutes(1) + 1_000); // 1 menit kemudian, masih di jam yang sama
  const res = await fetch(`${base}/api/paste/${body.id}`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).content, 'lahir setelah batas jam');
});

test('timer pembersih (jalur long-running) juga membuang semua', async () => {
  setPhase(HOUR - minutes(5));
  store.wipeAll('test'); // mulai dari RAM yang bersih
  store.create({ content: 'untuk timer' });
  assert.equal(store.stats().items, 1);

  jumpHours(1);
  const wiped = store.tick(); // ini yang dipanggil setInterval di server.js
  assert.equal(wiped, 1);
  assert.equal(store.stats().items, 0);
});

test('endpoint cron purge mengosongkan RAM sekarang juga', async () => {
  setPhase(minutes(10));
  store.wipeAll('test');
  await createPaste({ content: 'akan dipurge' });
  assert.equal(store.stats().items, 1);

  const res = await fetch(`${base}/api/cron/purge`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(body.wiped >= 1);
  assert.equal((await getJson('/api/stats')).items, 0);
});
