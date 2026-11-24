export async function request(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const options = { signal: controller.signal };
    if (body !== undefined) {
      options.method = 'POST';
      options.headers = { 'Content-Type': 'application/json' };
      options.body = JSON.stringify(body);
    }
    const response = await fetch(path, options);
    return { ...await response.json(), httpStatus: response.status };
  } catch {
    return { error: '暫時無法連線，請稍後重試。' };
  } finally {
    clearTimeout(timeout);
  }
}

export function feedback(element, text, kind = '') {
  element.textContent = text;
  element.dataset.kind = kind;
}
