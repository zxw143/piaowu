import { createApp } from './app.js';
import { openDatabase } from './db.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const db = openDatabase();
const app = createApp(db, process.env.APP_ORIGIN);
app.listen(port, host, () => console.log(`Ticket server listening on ${host}:${port}`));
