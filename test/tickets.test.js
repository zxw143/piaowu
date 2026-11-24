import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { hashPassword } from '../src/password.js';

test('staff can issue and redeem a ticket exactly once, and the guest view follows its status', async (t) => {
  const db = openDatabase(':memory:');
  const credentials = { username: 'staff-test', password: randomUUID() };
  db.prepare('INSERT INTO staff (username, password_hash) VALUES (?, ?)').run(credentials.username, await hashPassword(credentials.password));
  const server = createApp(db).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const get = (path, headers) => fetch(origin + path, { redirect: 'manual', headers });
  const post = (path, payload, headers) => fetch(origin + path, {
    method: 'POST', headers: { origin, 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload),
  });

  assert.equal((await get('/staff')).headers.get('location'), '/login');
  assert.equal((await get('/api/staff/tickets')).status, 401);
  assert.equal((await post('/api/staff/tickets', { guest: '訪客' })).status, 401);
  assert.equal((await post('/api/login', { ...credentials, password: 'incorrect' })).status, 401);
  const loggedIn = await post('/api/login', credentials);
  assert.equal(loggedIn.status, 200);
  assert.match(loggedIn.headers.get('set-cookie'), /HttpOnly.*SameSite=Strict/i);
  const auth = { cookie: loggedIn.headers.get('set-cookie').split(';')[0] };

  const details = { guest: '張嘉賓', note: '測試', issueKey: randomUUID() };
  const issued = await post('/api/staff/tickets', details, auth);
  assert.equal(issued.status, 201);
  const { ticket } = await issued.json();
  const retried = await post('/api/staff/tickets', details, auth);
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).ticket.link, ticket.link);
  assert.equal((await get('/t/this-does-not-exist')).status, 404);
  assert.equal((await get(`${ticket.link}/welcome`)).headers.get('location'), ticket.link);
  assert.match(await (await get(ticket.link)).text(), /id="small-qr"/);
  const qr = await get(`${ticket.link}/qr.png`);
  assert.match(qr.headers.get('content-type'), /^image\/png/);
  assert.deepEqual(await (await get(`${ticket.link}/status`)).json(), { redeemed: false, code: ticket.code });

  const scan = { code: `DD:${ticket.code}` };
  assert.equal((await post('/api/staff/redeem', scan)).status, 401);
  assert.equal((await post('/api/staff/redeem', scan, { ...auth, origin: 'https://other.example' })).status, 403);
  const redemptions = await Promise.all([post('/api/staff/redeem', scan, auth), post('/api/staff/redeem', scan, auth)]);
  assert.deepEqual(redemptions.map((result) => result.status).sort(), [200, 409]);
  const [first, second] = await Promise.all(redemptions.map((result) => result.json()));
  assert.equal(first.redeemed_at, second.redeemed_at);
  assert.equal(first.redeemed_by, credentials.username);
  assert.deepEqual(await (await get(`${ticket.link}/status`)).json(), { redeemed: true });
  assert.equal((await get(`${ticket.link}/qr.png`)).status, 410);
  assert.equal((await get(ticket.link)).headers.get('location'), `${ticket.link}/welcome`);
  assert.match(await (await get(`${ticket.link}/welcome`)).text(), /驗票成功，歡迎入場/);
  assert.equal((await post('/api/logout', {}, auth)).status, 200);
  assert.equal((await get('/api/staff/tickets', auth)).status, 401);
});
