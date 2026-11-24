import { feedback, request } from './api.js';

const form = document.querySelector('#login');
const submit = form.querySelector('button');
const result = document.querySelector('#result');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submit.disabled = true;
  feedback(result, '正在登入…');
  const data = await request('/api/login', Object.fromEntries(new FormData(form)));
  if (data.ok) {
    location.replace('/staff');
    return;
  }
  feedback(result, data.error, 'error');
  submit.disabled = false;
});
