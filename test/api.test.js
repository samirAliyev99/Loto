import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.js';
import { MockSimaProvider } from '../src/sima.js';

function setup() {
  const db = { users: {}, rooms: {}, sessions: {} };
  const sima = new MockSimaProvider();
  const handle = createApi({ db, sima, demo: true, hashFin: (fin) => `h:${fin}` });
  return { db, sima, handle };
}

async function login(handle, fin = '5ABC12D') {
  const start = await handle({ method: 'POST', path: '/api/auth/sima/start' });
  const id = start.body.requestId;
  assert.equal((await handle({ method: 'POST', path: `/api/auth/sima/status/${id}` })).body.status, 'pending');
  await handle({ method: 'POST', path: `/api/sima/mock/${id}/sign`, body: { fin, fullName: 'Test User' } });
  const done = await handle({ method: 'POST', path: `/api/auth/sima/status/${id}` });
  assert.equal(done.body.status, 'signed');
  return done.login;
}

test('SİMA login creates one account per FIN', async () => {
  const { db, handle } = setup();
  const a = await login(handle);
  const b = await login(handle, '5abc12d');
  assert.equal(a, b);
  assert.equal(Object.keys(db.users).length, 1);
  assert.equal(db.users[a].finHash, 'h:5ABC12D');
  assert.equal(db.users[a].finMasked, '5A***2D');
});

test('routes need a session and report game errors as JSON', async () => {
  const { handle } = setup();
  assert.equal((await handle({ method: 'GET', path: '/api/me' })).status, 401);
  assert.equal((await handle({ method: 'GET', path: '/api/nope' })).status, 404);
  const userId = await login(handle);
  const bad = await handle({ method: 'POST', path: '/api/rooms', body: { name: '', memberCount: 5, amount: 100 }, userId });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /adı/);
});

test('create, fill with bots and play a room through the API', async () => {
  const { handle } = setup();
  const userId = await login(handle);
  const created = await handle({ method: 'POST', path: '/api/rooms', body: { name: 'Ailə', memberCount: 3, amount: 50, periodDays: 30 }, userId });
  assert.equal(created.status, 201);
  const id = created.body.id;
  let room = (await handle({ method: 'POST', path: `/api/demo/rooms/${id}/fill`, userId })).body;
  assert.equal(room.status, 'active');
  for (let i = 0; i < 3; i++) {
    const round = room.rounds.at(-1);
    const mine = round.payments.find((p) => p.from === userId);
    if (mine) await handle({ method: 'POST', path: `/api/rooms/${id}/payments/${mine.id}/sent`, body: {}, userId });
    room = (await handle({ method: 'POST', path: `/api/demo/rooms/${id}/bots`, userId })).body;
    for (const p of room.rounds.at(-1).payments.filter((x) => x.to === userId && x.status !== 'confirmed')) {
      room = (await handle({ method: 'POST', path: `/api/rooms/${id}/payments/${p.id}/confirm`, userId })).body;
    }
  }
  assert.equal(room.status, 'completed');
  const me = (await handle({ method: 'GET', path: '/api/me', userId })).body;
  assert.equal(me.user.rating, 2 * 5 + 20);
});

test('private rooms are hidden from non-members', async () => {
  const { handle } = setup();
  const owner = await login(handle, '1111111');
  const other = await login(handle, '2222222');
  const room = (await handle({ method: 'POST', path: '/api/rooms', body: { name: 'Gizli', memberCount: 3, amount: 50, isPrivate: true }, userId: owner })).body;
  assert.equal((await handle({ method: 'GET', path: `/api/rooms/${room.id}`, userId: other })).status, 404);
  assert.equal((await handle({ method: 'POST', path: `/api/rooms/${room.id}/join`, userId: other })).status, 403);
  assert.equal((await handle({ method: 'POST', path: '/api/rooms/join', body: { code: room.code }, userId: other })).status, 200);
});
