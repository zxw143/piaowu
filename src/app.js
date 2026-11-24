import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import QRCode from 'qrcode';
import { verifyPassword } from './password.js';

const fromRoot = (path) => fileURLToPath(new URL(`../${path}`, import.meta.url));
const sessionAge = 12 * 60 * 60 * 1000;
const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const ticketFields = `tickets.id, guest, note, link_token, code, issued_at, redeemed_at,
  staff.username AS redeemed_by`;

export function createApp(db, publicUrl) {
  const app = express();
  const publicOrigin = publicUrl && new URL(publicUrl).origin;
  const secure = publicOrigin?.startsWith('https://') ?? false;
  const cookieName = secure ? '__Host-ticket_session' : 'ticket_session';
  const cookieOptions = { httpOnly: true, sameSite: 'strict', secure, path: '/' };
  let loginAttempts = new Map();
  let loginWindowEndsAt = 0;

  const findStaff = db.prepare('SELECT id, username, password_hash FROM staff WHERE username = ?');
  const findSession = db.prepare(`SELECT staff.id, staff.username FROM sessions JOIN staff
    ON staff.id = sessions.staff_id WHERE token_hash = ? AND expires_at > ?`);
  const deleteSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const deleteExpiredSessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
  const insertSession = db.prepare('INSERT INTO sessions VALUES (?, ?, ?)');
  const listTickets = db.prepare(`SELECT ${ticketFields} FROM tickets LEFT JOIN staff
    ON staff.id = tickets.redeemed_by ORDER BY tickets.id DESC`);
  const findCode = db.prepare(`SELECT ${ticketFields} FROM tickets LEFT JOIN staff
    ON staff.id = tickets.redeemed_by WHERE code = ?`);
  const findIssued = db.prepare(`SELECT ${ticketFields} FROM tickets LEFT JOIN staff
    ON staff.id = tickets.redeemed_by WHERE issue_key = ?`);
  const findLink = db.prepare('SELECT code, redeemed_at FROM tickets WHERE link_token = ?');
  const insertTicket = db.prepare(`INSERT INTO tickets (guest, note, issue_key, link_token, code, issued_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(issue_key) DO NOTHING RETURNING id`);
  const redeem = db.prepare('UPDATE tickets SET redeemed_at = ?, redeemed_by = ? WHERE code = ? AND redeemed_at IS NULL RETURNING id');

  function sessionToken(req) {
    const cookie = req.headers.cookie?.split(';').map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`));
    const token = cookie?.slice(cookieName.length + 1);
    return /^[A-Za-z0-9_-]{43}$/.test(token ?? '') ? token : null;
  }

  function getStaff(req) {
    const token = sessionToken(req);
    return token && findSession.get(hashToken(token), Date.now());
  }

  function requireStaff(req, res, next) {
    req.staff = getStaff(req);
    if (!req.staff) return res.status(401).json({ error: '請先登入工作人員帳號。' });
    next();
  }

  function ticketJson({ link_token, ...ticket }) {
    return { ...ticket, link: `/t/${link_token}` };
  }

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
    if (req.method === 'POST') {
      const expectedOrigin = publicOrigin || `http://${req.get('host')}`;
      if (req.get('origin') !== expectedOrigin || !req.is('application/json')) {
        return res.status(403).json({ error: '此請求必須從票務網站發出。' });
      }
    }
    next();
  });
  app.use(express.json({ limit: '8kb' }));
  app.use('/assets', express.static(fromRoot('public/assets'), { index: false }));

  app.get('/', (_req, res) => res.redirect('/staff'));
  app.get('/login', (req, res) => getStaff(req) ? res.redirect('/staff') : res.sendFile(fromRoot('public/login.html')));
  app.get('/staff', (req, res) => getStaff(req) ? res.sendFile(fromRoot('public/staff.html')) : res.redirect('/login'));
  app.get('/staff/decoder.js', requireStaff, (_req, res) => {
    res.sendFile(fromRoot('node_modules/@zxing/browser/umd/zxing-browser.min.js'));
  });

  app.post('/api/login', async (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || username.length > 32 || typeof password !== 'string' || password.length > 128) {
      return res.status(400).json({ error: '請輸入帳號與密碼。' });
    }
    const now = Date.now();
    if (now >= loginWindowEndsAt) {
      loginAttempts = new Map();
      loginWindowEndsAt = now + 5 * 60 * 1000;
    }
    const name = username.trim().toLowerCase();
    const ip = req.ip;
    const account = `${ip}/${name}`;
    const ipCount = loginAttempts.get(ip) ?? 0;
    const accountCount = loginAttempts.get(account) ?? 0;
    if (ipCount >= 120 || accountCount >= 12) return res.status(429).json({ error: '登入嘗試過多，請稍後再試。' });
    loginAttempts.set(ip, ipCount + 1);
    loginAttempts.set(account, accountCount + 1);
    const staff = findStaff.get(name);
    if (!await verifyPassword(password, staff?.password_hash)) {
      return res.status(401).json({ error: '帳號或密碼錯誤。' });
    }
    loginAttempts.delete(account);
    const previous = sessionToken(req);
    if (previous) deleteSession.run(hashToken(previous));
    deleteExpiredSessions.run(now);
    const token = randomBytes(32).toString('base64url');
    insertSession.run(hashToken(token), staff.id, now + sessionAge);
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: sessionAge }).json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    const token = sessionToken(req);
    if (token) deleteSession.run(hashToken(token));
    res.clearCookie(cookieName, cookieOptions).json({ ok: true });
  });

  app.get('/api/staff/tickets', requireStaff, (req, res) => {
    res.json({ staff: req.staff.username, tickets: listTickets.all().map(ticketJson) });
  });

  app.post('/api/staff/tickets', requireStaff, (req, res) => {
    const { guest, note = '', issueKey } = req.body ?? {};
    if (typeof guest !== 'string' || !guest.trim() || guest.trim().length > 80 || typeof note !== 'string' || note.trim().length > 300) {
      return res.status(400).json({ error: '請填寫嘉賓姓名（最多 80 字），備註最多 300 字。' });
    }
    if (typeof issueKey !== 'string' || !/^[a-f0-9-]{36}$/.test(issueKey)) {
      return res.status(400).json({ error: '缺少出票識別碼，請重新整理後再試。' });
    }
    const linkToken = randomBytes(24).toString('base64url');
    const code = randomBytes(6).toString('hex').toUpperCase();
    const issued = insertTicket.get(guest.trim(), note.trim(), issueKey, linkToken, code, new Date().toISOString());
    res.status(issued ? 201 : 200).json({ ticket: ticketJson(findIssued.get(issueKey)) });
  });

  app.post('/api/staff/redeem', requireStaff, (req, res) => {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().replace(/^DD:/i, '').replace(/[\s-]/g, '').toUpperCase() : '';
    if (!/^[A-F0-9]{12}$/.test(code)) return res.status(400).json({ error: '票碼格式無效。' });
    const changed = redeem.get(new Date().toISOString(), req.staff.id, code);
    const ticket = findCode.get(code);
    if (!ticket) return res.status(404).json({ error: '找不到這張票。' });
    const { guest, redeemed_at, redeemed_by } = ticket;
    res.status(changed ? 200 : 409).json({ guest, redeemed_at, redeemed_by, status: changed ? 'redeemed' : 'already_redeemed' });
  });

  function guestTicket(req, res, next) {
    const { token } = req.params;
    req.ticket = /^[A-Za-z0-9_-]{32}$/.test(token) && findLink.get(token);
    if (!req.ticket) return res.status(404).sendFile(fromRoot('public/missing.html'));
    next();
  }

  app.get('/t/:token', guestTicket, (req, res) => {
    if (req.ticket.redeemed_at) return res.redirect(`/t/${req.params.token}/welcome`);
    res.sendFile(fromRoot('public/ticket.html'));
  });
  app.get('/t/:token/welcome', guestTicket, (req, res) => {
    if (!req.ticket.redeemed_at) return res.redirect(`/t/${req.params.token}`);
    res.sendFile(fromRoot('public/welcome.html'));
  });
  app.get('/t/:token/status', guestTicket, (req, res) => {
    res.json(req.ticket.redeemed_at ? { redeemed: true } : { redeemed: false, code: req.ticket.code });
  });
  app.get('/t/:token/qr.png', guestTicket, async (req, res) => {
    if (req.ticket.redeemed_at) return res.sendStatus(410);
    const png = await QRCode.toBuffer(`DD:${req.ticket.code}`, { width: 360, margin: 4 });
    res.type('png').send(png);
  });

  app.use((err, _req, res, _next) => {
    if (err.status === 400 || err.status === 413) {
      return res.status(err.status).json({ error: '請求內容無效或過長。' });
    }
    console.error(err);
    res.status(500).json({ error: '服務暫時無法處理，請稍後再試。' });
  });
  return app;
}
