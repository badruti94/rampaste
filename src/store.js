// Penyimpanan paste di RAM. Tidak ada database, tidak ada file.
// Semua isi dihapus serentak setiap pergantian jam (00:00, 01:00, 02:00, ... waktu server).
import { randomBytes } from 'node:crypto';

export const HOUR_MS = 3_600_000;
export const MAX_PASTE_BYTES = 200 * 1024; // 1 paste maks 200 KB
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024; // total RAM yang dipakai maks 32 MB
export const MAX_ITEMS = 2000;
export const LIST_LIMIT = 50;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const pastes = new Map(); // id -> paste
const tokens = new Map(); // id -> deleteToken
let totalBytes = 0;
let hourSlot = currentSlot();
let lastWipeAt = Date.now();
let totalWiped = 0;
const startedAt = Date.now();

function currentSlot() {
  return Math.floor(Date.now() / HOUR_MS);
}

export function nextWipeAt() {
  return (currentSlot() + 1) * HOUR_MS;
}

function newId() {
  let id;
  do {
    id = randomBytes(5).toString('hex');
  } while (pastes.has(id));
  return id;
}

function drop(id) {
  const p = pastes.get(id);
  if (!p) return false;
  pastes.delete(id);
  tokens.delete(id);
  totalBytes -= p.bytes;
  return true;
}

function evictOldest() {
  let oldest = null;
  for (const p of pastes.values()) {
    if (!oldest || p.createdAt < oldest.createdAt) oldest = p;
  }
  if (oldest) drop(oldest.id);
}

// Dipanggil di setiap request (juga tiap 30 detik oleh long-running server).
// return: jumlah paste yang dibuang karena pergantian jam
export function tick() {
  let wiped = 0;
  const slot = currentSlot();
  if (slot !== hourSlot) {
    wiped = pastes.size;
    pastes.clear();
    tokens.clear();
    totalBytes = 0;
    hourSlot = slot;
    lastWipeAt = Date.now();
    totalWiped += wiped;
  }
  const now = Date.now();
  for (const [id, p] of pastes) {
    if (p.expiresAt <= now) drop(id);
  }
  return wiped;
}

const LANGS = new Set([
  'text', 'json', 'javascript', 'typescript', 'html', 'css', 'python',
  'bash', 'sql', 'markdown', 'yaml', 'php', 'ruby', 'go', 'rust', 'java', 'c', 'cpp', 'diff',
]);

function normalizeLang(lang) {
  const l = String(lang ?? '').trim().toLowerCase();
  return LANGS.has(l) ? l : 'text';
}

export function create({ content, lang, ttlSeconds, burn = false, unlisted = false } = {}) {
  if (typeof content !== 'string' || content.length === 0) {
    throw new HttpError(400, 'content wajib diisi');
  }
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_PASTE_BYTES) {
    throw new HttpError(413, `paste terlalu besar (maks ${MAX_PASTE_BYTES / 1024} KB)`);
  }
  const clean = content.replace(/\r\n/g, '\n');

  tick();
  while (pastes.size >= MAX_ITEMS) evictOldest();
  while (totalBytes + bytes > MAX_TOTAL_BYTES && pastes.size > 0) evictOldest();

  const now = Date.now();
  const wipeAt = nextWipeAt();
  const ask = Number(ttlSeconds);
  const ttl = ask > 0 ? Math.min(ask * 1000, wipeAt - now) : wipeAt - now;

  const id = newId();
  const token = randomBytes(12).toString('hex');
  const paste = {
    id,
    content: clean,
    lang: normalizeLang(lang),
    burn: !!burn,
    unlisted: !!unlisted,
    createdAt: now,
    expiresAt: now + ttl,
    views: 0,
    bytes,
  };
  pastes.set(id, paste);
  tokens.set(id, token);
  totalBytes += bytes;
  return { paste, deleteToken: token };
}

export function peek(id) {
  tick();
  return pastes.get(id) || null;
}

// Ambil isi paste; menambah views, dan langsung menghapus kalau burn-after-read.
export function take(id) {
  tick();
  const p = pastes.get(id);
  if (!p) return null;
  p.views += 1;
  if (p.burn) {
    const copy = { ...p, burned: true };
    drop(id);
    return copy;
  }
  return p;
}

export function remove(id, token) {
  tick();
  const p = pastes.get(id);
  if (!p) return false;
  if (!token || tokens.get(id) !== token) {
    throw new HttpError(403, 'deleteToken tidak cocok');
  }
  return drop(id);
}

function summary(p) {
  return {
    id: p.id,
    lang: p.lang,
    burn: p.burn,
    createdAt: p.createdAt,
    expiresAt: p.expiresAt,
    views: p.views,
    bytes: p.bytes,
    preview: p.content.replace(/\s+/g, ' ').slice(0, 120),
  };
}

export function list() {
  tick();
  return [...pastes.values()]
    .filter((p) => !p.unlisted)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, LIST_LIMIT)
    .map(summary);
}

export function stats() {
  tick();
  return {
    items: pastes.size,
    bytes: totalBytes,
    maxItems: MAX_ITEMS,
    maxBytes: MAX_TOTAL_BYTES,
    maxPasteBytes: MAX_PASTE_BYTES,
    wipeIntervalMs: HOUR_MS,
    nextWipeAt: nextWipeAt(),
    lastWipeAt,
    totalWiped,
    startedAt,
    now: Date.now(),
  };
}

// Hapus SEMUA isi RAM sekarang juga (dipakai endpoint cron).
export function wipeAll(reason = 'cron') {
  const wiped = pastes.size;
  pastes.clear();
  tokens.clear();
  totalBytes = 0;
  lastWipeAt = Date.now();
  totalWiped += wiped;
  hourSlot = currentSlot();
  return { wiped, reason, at: lastWipeAt };
}
