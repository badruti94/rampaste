// Jalankan server dengan jam yang digeser — untuk menguji wipe per jam tanpa menunggu sejam.
//   node scripts/server-offset.js --boundary-in=15   # batas jam berikutnya terjadi 15 detik lagi
//   node scripts/server-offset.js +3600000           # geser jam +1 jam
// Port default 3100 supaya bisa jalan bareng server normal (3000).
const arg = process.argv[2] ?? '0';
const port = Number(process.argv[3] || 3100);
const realNow = Date.now;

let offset;
if (arg.startsWith('--boundary-in=')) {
  // Jam palsu tetap berjalan 1 detik / 1 detik nyata, kita hanya menggeser fasenya
  // supaya batas jam jatuh N detik dari sekarang.
  const seconds = Number(arg.slice('--boundary-in='.length));
  offset = 3_600_000 - seconds * 1000 - (realNow() % 3_600_000);
} else {
  offset = Number(arg);
}

Date.now = () => realNow() + offset;
process.env.PORT = String(port);
console.log(`jam digeser ${offset} ms; batas jam dalam ${((3_600_000 - (Date.now() % 3_600_000)) / 1000).toFixed(1)} detik`);

await import('../server.js');
