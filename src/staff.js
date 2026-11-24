import { randomBytes } from 'node:crypto';
import { openDatabase } from './db.js';
import { hashPassword } from './password.js';

const [username, option] = process.argv.slice(2);
if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username ?? '') || (option && option !== '--reset')) {
  console.error('Usage: npm run staff -- <username> [--reset]');
  process.exit(1);
}

const db = openDatabase();
const existing = db.prepare('SELECT id FROM staff WHERE username = ?').get(username);
if (Boolean(existing) !== Boolean(option)) {
  console.error(existing ? 'Account already exists. Use --reset to reset it.' : 'Account does not exist. Run without --reset to create it.');
  process.exit(1);
}

const password = randomBytes(18).toString('base64url');
const hash = await hashPassword(password);
if (existing) {
  db.exec('BEGIN');
  db.prepare('UPDATE staff SET password_hash = ? WHERE id = ?').run(hash, existing.id);
  db.prepare('DELETE FROM sessions WHERE staff_id = ?').run(existing.id);
  db.exec('COMMIT');
} else {
  db.prepare('INSERT INTO staff (username, password_hash) VALUES (?, ?)').run(username, hash);
}
db.close();
console.log(`Username: ${username}\nPassword: ${password}`);
