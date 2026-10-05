// Calls the JSON API. With a server it uses fetch; in the GitHub Pages build there is no
// server (the build adds <meta name="loto-static">), so the same API runs in the browser.

export const isStatic = document.querySelector('meta[name="loto-static"]') !== null;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  let status;
  let data;
  if (isStatic) {
    const { localApi } = await import('./src/local-api.js');
    ({ status, body: data } = await localApi({ method, path, body: body ?? {} }));
  } else {
    const res = await fetch(`api/${path}`, {
      method,
      headers: method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
      body: method !== 'GET' ? JSON.stringify(body ?? {}) : undefined,
    });
    status = res.status;
    data = await res.json().catch(() => ({}));
  }
  if (status >= 400) throw new ApiError(data.error || `Xəta ${status}`, status);
  return data;
}

export async function resetLocalData() {
  const { resetLocal } = await import('./src/local-api.js');
  resetLocal();
}
