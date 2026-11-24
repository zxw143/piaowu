const ticketPath = location.pathname.replace(/\/$/, '');
const qrButton = document.querySelector('#ticket-qr');
const smallQr = document.querySelector('#small-qr');
const largeQr = document.querySelector('#large-qr');
const dialog = document.querySelector('#qr-dialog');
const message = document.querySelector('#ticket-status');
const openQr = document.createElement('button');
openQr.id = 'open-qr';
openQr.type = 'button';
openQr.textContent = '放大驗票碼';
openQr.hidden = true;
message.before(openQr);
qrButton.disabled = true;

let timer;
let checking = false;
let done = false;
let loadingQr = false;

function showQr() {
  if (!dialog.open) dialog.showModal();
}

qrButton.addEventListener('click', showQr);
openQr.addEventListener('click', showQr);
document.querySelector('#close-qr').addEventListener('click', () => dialog.close());

async function renderQr(code) {
  document.querySelector('#manual-code').textContent = code.match(/.{4}/g).join('-');
  openQr.hidden = false;
  if (loadingQr || smallQr.hasAttribute('src')) return;
  loadingQr = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${ticketPath}/qr.png`, { signal: controller.signal });
    if (!response.ok) return;
    const image = URL.createObjectURL(await response.blob());
    smallQr.src = image;
    largeQr.src = image;
  } catch {
    // Keep the manual code available and try the image again on the next status check.
  } finally {
    clearTimeout(timeout);
    loadingQr = false;
  }
}

smallQr.addEventListener('load', () => {
  qrButton.disabled = false;
});
smallQr.addEventListener('error', () => {
  URL.revokeObjectURL(smallQr.src);
  smallQr.removeAttribute('src');
  largeQr.removeAttribute('src');
  qrButton.disabled = true;
});

async function checkStatus() {
  clearTimeout(timer);
  if (checking || done || document.hidden) return;
  checking = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${ticketPath}/status`, { signal: controller.signal });
    if (!response.ok) throw new Error();
    const status = await response.json();
    if (status.redeemed) {
      done = true;
      location.replace(`${ticketPath}/welcome`);
      return;
    }
    void renderQr(status.code);
    message.textContent = '請向工作人員出示驗票碼。';
  } catch {
    message.textContent = '暫時無法更新驗票狀態，網絡恢復後會自動重試。';
  } finally {
    clearTimeout(timeout);
    checking = false;
    if (!done && !document.hidden) timer = setTimeout(checkStatus, 1800);
  }
}

document.addEventListener('visibilitychange', checkStatus);
window.addEventListener('online', checkStatus);
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    done = false;
    checkStatus();
  }
});
checkStatus();
