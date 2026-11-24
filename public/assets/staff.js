import { feedback, request } from './api.js';

const get = (selector) => document.querySelector(selector);
const issue = get('#issue');
const redeem = get('#redeem');
const issuedUrl = get('#issued-url');
const redeemResult = get('#redeem-result');
const video = get('#camera');
const start = get('#camera-start');
const stop = get('#camera-stop');
const next = get('#camera-next');
const dateFormat = new Intl.DateTimeFormat('zh-Hant', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Macau' });
let camera;
let cameraGeneration = 0;
let scanReady = false;
let redeeming = false;
let listGeneration = 0;
let pendingIssue;

async function staffRequest(path, body) {
  const data = await request(path, body);
  if (data.httpStatus === 401) {
    stopCamera();
    location.replace('/login');
  }
  return data;
}

function formatCode(code) {
  return code.match(/.{4}/g).join('-');
}

function makeTicketRow(ticket) {
  const row = document.createElement('tr');
  const status = ticket.redeemed_at ? `已核銷 · ${dateFormat.format(new Date(ticket.redeemed_at))} · ${ticket.redeemed_by}` : '未核銷';
  for (const value of [ticket.guest, ticket.note || '—', formatCode(ticket.code), status]) {
    row.insertCell().textContent = value;
  }
  const cell = row.insertCell();
  const link = document.createElement('a');
  link.href = ticket.link;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = '開啟邀請票';
  cell.append(link);
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = '複製';
  copy.style.marginInlineStart = '8px';
  copy.addEventListener('click', () => copyLink(link.href, get('#list-status')));
  cell.append(copy);
  return row;
}

async function copyLink(url, result, input) {
  try {
    await navigator.clipboard.writeText(url);
    feedback(result, '已複製邀請連結。', 'success');
  } catch {
    if (input) {
      input.focus();
      input.select();
    } else {
      get('#new-link').hidden = false;
      issuedUrl.value = url;
      issuedUrl.focus();
      issuedUrl.select();
    }
    feedback(result, '請手動複製已選取的連結。');
  }
}

async function refreshTickets() {
  const generation = ++listGeneration;
  const data = await staffRequest('/api/staff/tickets');
  if (generation !== listGeneration) return;
  if (data.error) return feedback(get('#list-status'), data.error, 'error');
  get('#account').textContent = data.staff;
  feedback(get('#list-status'), `共 ${data.tickets.length} 張票`);
  get('#tickets').replaceChildren(...data.tickets.map(makeTicketRow));
}

issue.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = issue.querySelector('button');
  const result = get('#issue-result');
  const fields = Object.fromEntries(new FormData(issue));
  if (!pendingIssue || fields.guest !== pendingIssue.guest || fields.note !== pendingIssue.note) {
    pendingIssue = { ...fields, issueKey: crypto.randomUUID() };
  }
  button.disabled = true;
  feedback(result, '正在生成邀請票…');
  const data = await staffRequest('/api/staff/tickets', pendingIssue);
  button.disabled = false;
  if (data.error) return feedback(result, data.error, 'error');
  pendingIssue = undefined;
  issue.reset();
  issuedUrl.value = new URL(data.ticket.link, location.origin).href;
  get('#new-link').hidden = false;
  feedback(result, `已為 ${data.ticket.guest} 生成邀請票。`, 'success');
  void refreshTickets();
});

async function submitCode(code) {
  if (redeeming) return;
  redeeming = true;
  const button = redeem.querySelector('button');
  button.disabled = true;
  feedback(redeemResult, '正在驗票…');
  const data = await staffRequest('/api/staff/redeem', { code });
  button.disabled = false;
  redeeming = false;
  if (data.status === 'redeemed') {
    feedback(redeemResult, `核銷成功 · ${data.guest}`, 'success');
    redeem.reset();
    void refreshTickets();
  } else if (data.status === 'already_redeemed') {
    feedback(redeemResult, `已核銷 · ${data.guest} · ${dateFormat.format(new Date(data.redeemed_at))}`, 'warning');
    void refreshTickets();
  } else {
    feedback(redeemResult, data.error, 'error');
  }
}

redeem.addEventListener('submit', (event) => {
  event.preventDefault();
  void submitCode(new FormData(redeem).get('code'));
});

function stopCamera() {
  cameraGeneration++;
  scanReady = false;
  camera?.stop();
  camera = undefined;
  video.hidden = stop.hidden = next.hidden = true;
  start.hidden = false;
  start.disabled = false;
}

start.addEventListener('click', async () => {
  if (!navigator.mediaDevices?.getUserMedia || !window.ZXingBrowser) {
    return feedback(redeemResult, '無法開啟相機。請在 HTTPS 網站使用相機，或手輸票號。', 'error');
  }
  const generation = ++cameraGeneration;
  start.disabled = true;
  stop.hidden = false;
  video.hidden = false;
  feedback(redeemResult, '正在開啟相機…');
  try {
    const scanner = new window.ZXingBrowser.BrowserQRCodeReader();
    const controls = await scanner.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' } }, audio: false }, video, async (result) => {
      if (generation !== cameraGeneration || !result || !scanReady || redeeming) return;
      const code = result.getText();
      if (!/^DD:[A-F0-9]{12}$/i.test(code)) return;
      scanReady = false;
      await submitCode(code);
      if (generation === cameraGeneration) next.hidden = false;
    });
    if (generation !== cameraGeneration) return controls.stop();
    camera = controls;
    start.hidden = true;
    scanReady = true;
    feedback(redeemResult, '請將相機對準驗票碼。');
  } catch {
    if (generation !== cameraGeneration) return;
    stopCamera();
    feedback(redeemResult, '無法開啟相機，請確認相機權限或手輸票號。', 'error');
  }
});

stop.addEventListener('click', () => {
  stopCamera();
  if (!redeeming) feedback(redeemResult, '相機已關閉。');
});
next.addEventListener('click', () => {
  next.hidden = true;
  scanReady = true;
  feedback(redeemResult, '請將相機對準下一張驗票碼。');
});
window.addEventListener('pagehide', stopCamera);
get('#copy-new').addEventListener('click', () => copyLink(issuedUrl.value, get('#issue-result'), issuedUrl));
get('#refresh').addEventListener('click', refreshTickets);
get('#logout').addEventListener('click', async () => {
  stopCamera();
  const data = await staffRequest('/api/logout', {});
  if (data.ok) location.replace('/login');
  else feedback(get('#page-feedback'), data.error, 'error');
});
void refreshTickets();
