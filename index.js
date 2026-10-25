// Untuk jalan lokal / VPS (bukan serverless).
import { createApp } from './src/app.js';
import * as store from './src/store.js';

const app = createApp();
const port = Number(process.env.PORT) || 3000;

// Pembersih jam: pengecekan lazy di setiap request sudah ada,
// timer ini yang bikin paste ikut hilang walau tidak ada request.
const timer = setInterval(() => {
  const wiped = store.tick();
  if (wiped > 0) console.log(`[wipe] ${wiped} paste dihapus (pergantian jam)`);
}, 30_000);
timer.unref();

app.listen(port, () => {
  console.log(`rampaste jalan di http://localhost:${port}`);
  console.log(`wipe berikutnya: ${new Date(store.nextWipeAt()).toLocaleString('id-ID')}`);
});
