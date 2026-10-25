import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../src/store.js';

const HOUR = 3_600_000;

function freezeTime(start) {
  const real = Date.now;
  let t = start;
  Date.now = () => t;
  return {
    advance: (ms) => { t += ms; },
    restore: () => { Date.now = real; },
  };
}

test('create + take: isi tersimpan, views nambah', () => {
  store.wipeAll('test');
  const { paste, deleteToken } = store.create({ content: 'halo dunia', lang: 'text' });
  assert.equal(paste.id.length, 10);
  assert.equal(deleteToken.length, 24);

  const a = store.take(paste.id);
  assert.equal(a.content, 'halo dunia');
  assert.equal(a.views, 1);
  const b = store.take(paste.id);
  assert.equal(b.views, 2);
});

test('ttl: paste hilang setelah waktunya habis (tanpa ganti jam)', () => {
  store.wipeAll('test');
  const clock = freezeTime(Date.now()); // beku di waktu sebenarnya
  try {
    const { paste } = store.create({ content: 'sebentar saja', ttlSeconds: 60 });
    clock.advance(30_000);
    assert.ok(store.peek(paste.id), 'harusnya masih ada di detik 30');
    clock.advance(31_000);
    assert.equal(store.peek(paste.id), null, 'harusnya sudah kedaluwarsa');
    assert.equal(store.stats().items, 0);
  } finally {
    clock.restore();
  }
});

test('wipe per jam: semua isi RAM dibuang saat jam berganti', () => {
  store.wipeAll('test');
  const clock = freezeTime(Date.now());
  try {
    store.create({ content: 'satu' });
    store.create({ content: 'dua' });
    assert.equal(store.stats().items, 2);

    clock.advance(HOUR + 5_000); // lewati batas jam
    const wiped = store.tick();
    assert.equal(wiped, 2, 'tick() harus melaporkan 2 paste dibuang');
    assert.equal(store.stats().items, 0);
    assert.ok(store.stats().lastWipeAt <= Date.now());
  } finally {
    clock.restore();
  }
});

test('burn after read: sekali baca langsung hilang', () => {
  store.wipeAll('test');
  const { paste } = store.create({ content: 'rahasia', burn: true });
  const first = store.take(paste.id);
  assert.equal(first.content, 'rahasia');
  assert.equal(first.burned, true);
  assert.equal(store.take(paste.id), null);
});

test('batas ukuran: paste kebesaran ditolak 413', () => {
  store.wipeAll('test');
  const big = 'x'.repeat(store.MAX_PASTE_BYTES + 1);
  assert.throws(() => store.create({ content: big }), (e) => e.status === 413);
});

test('content kosong ditolak 400', () => {
  store.wipeAll('test');
  assert.throws(() => store.create({ content: '' }), (e) => e.status === 400);
  assert.throws(() => store.create({}), (e) => e.status === 400);
});

test('hapus: token salah ditolak 403, token benar menghapus', () => {
  store.wipeAll('test');
  const { paste, deleteToken } = store.create({ content: 'hapus aku' });
  assert.throws(() => store.remove(paste.id, 'token-palsu'), (e) => e.status === 403);
  assert.equal(store.remove(paste.id, deleteToken), true);
  assert.equal(store.peek(paste.id), null);
});

test('list: unlisted tidak muncul di daftar publik', () => {
  store.wipeAll('test');
  const pub = store.create({ content: 'publik' }).paste;
  const priv = store.create({ content: 'sembunyi', unlisted: true }).paste;
  const ids = store.list().map((p) => p.id);
  assert.ok(ids.includes(pub.id));
  assert.ok(!ids.includes(priv.id));
});

test('lang tidak dikenal di-fallback ke text', () => {
  store.wipeAll('test');
  const { paste } = store.create({ content: 'x', lang: 'klingon' });
  assert.equal(paste.lang, 'text');
});
