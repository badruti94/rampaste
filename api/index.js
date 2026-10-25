// Entry point serverless Vercel. Semua request masuk ke sini.
import { createApp } from '../src/app.js';

const app = createApp();

export default app;
