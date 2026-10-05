import { createApi, housekeeping } from './api.js';
import { MockSimaProvider } from './sima.js';

// The whole API running in the browser for the GitHub Pages demo. State lives in
// localStorage, shared by every tab of this site (the simulated SİMA phone included),
// and is reloaded on every call so tabs see each other's changes.

const KEY = 'loto-demo-v1';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}

export async function localApi({ method, path, body }) {
  const state = load() || { db: { users: {}, rooms: {}, sessions: {} }, sima: {}, userId: null };
  const sima = new MockSimaProvider({ requests: state.sima });
  const handle = createApi({ db: state.db, sima, demo: true, hashFin: (fin) => `demo:${fin}` });
  housekeeping(state.db, sima);
  const out = await handle({ method, path: `/api/${path}`, body, userId: state.userId });
  if (out.login) state.userId = out.login;
  if (out.logout) state.userId = null;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private mode or storage full: the demo still works for this page view.
  }
  return out;
}

export function resetLocal() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing stored.
  }
}
