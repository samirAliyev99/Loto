import { fillWithBots, botsAct } from './demo.js';
import {
  GameError, TIERS, RATING, LIMITS, newUser, randomId, createRoom, joinRoom, leaveRoom, findRoomByCode,
  markSent, confirmPayment, tick, roomDetail, listOpenRooms, userDashboard,
} from './game.js';

// The JSON API, independent of transport. server.js serves it over HTTP with cookie
// sessions; local-api.js runs it in the browser on top of localStorage (GitHub Pages).
//
// handle({ method, path, body, userId }) -> { status, body, login?: userId, logout?: true }

export function createApi({ db, sima, demo, hashFin, now = Date.now }) {
  const requireUser = (userId) => {
    const user = userId && db.users[userId];
    if (!user) throw new GameError('Daxil olun.', 401);
    return user;
  };

  const requireRoom = (id) => {
    const room = Object.hasOwn(db.rooms, id) ? db.rooms[id] : null;
    if (!room) throw new GameError('Otaq tapılmadı.', 404);
    return room;
  };

  const requireMember = (user, room) => {
    if (!room.members.includes(user.id)) throw new GameError('Siz bu otaqda deyilsiniz.', 403);
  };

  async function findOrCreateUser(identity) {
    const finHash = await hashFin(identity.fin);
    let user = Object.values(db.users).find((u) => u.finHash === finHash);
    if (!user) {
      user = newUser({
        id: randomId(),
        finHash,
        finMasked: `${identity.fin.slice(0, 2)}***${identity.fin.slice(-2)}`,
        fullName: identity.fullName,
      }, now());
      db.users[user.id] = user;
    }
    return user;
  }

  // [method, pattern, handler({ userId, body, params }) -> { status?, body, login?, logout? }]
  const routes = [
    ['GET', /^\/api\/config$/, () => ({ body: { demo, tiers: TIERS, rating: RATING, limits: LIMITS } })],

    ['POST', /^\/api\/auth\/sima\/start$/, () => ({ body: sima.createRequest('Lotereya: hesaba giriş / qeydiyyat') })],
    ['POST', /^\/api\/auth\/sima\/status\/([\w-]+)$/, async ({ params: [id] }) => {
      const result = sima.getResult(id);
      if (result.status !== 'signed') return { body: { status: result.status } };
      const user = await findOrCreateUser(result.identity);
      return { body: { status: 'signed', userId: user.id }, login: user.id };
    }],
    ['POST', /^\/api\/auth\/logout$/, () => ({ body: { ok: true }, logout: true })],

    ['GET', /^\/api\/me$/, ({ userId }) => ({ body: userDashboard(db, requireUser(userId)) })],
    ['GET', /^\/api\/rooms$/, ({ userId }) => ({ body: listOpenRooms(db, requireUser(userId)) })],
    ['POST', /^\/api\/rooms$/, ({ userId, body }) => {
      const user = requireUser(userId);
      const room = createRoom(db, user, body, now());
      return { status: 201, body: roomDetail(db, room, user) };
    }],
    ['POST', /^\/api\/rooms\/join$/, ({ userId, body }) => {
      const user = requireUser(userId);
      const room = findRoomByCode(db, body.code);
      if (!room) throw new GameError('Bu kodla otaq tapılmadı.', 404);
      joinRoom(db, user, room, now());
      return { body: roomDetail(db, room, user) };
    }],
    ['GET', /^\/api\/rooms\/([\w-]+)$/, ({ userId, params: [id] }) => {
      const user = requireUser(userId);
      const room = requireRoom(id);
      if (room.isPrivate && !room.members.includes(user.id)) throw new GameError('Otaq tapılmadı.', 404);
      return { body: roomDetail(db, room, user) };
    }],
    ['POST', /^\/api\/rooms\/([\w-]+)\/join$/, ({ userId, params: [id] }) => {
      const user = requireUser(userId);
      const room = requireRoom(id);
      if (room.isPrivate) throw new GameError('Gizli otağa yalnız kodla qoşulmaq olar.', 403);
      joinRoom(db, user, room, now());
      return { body: roomDetail(db, room, user) };
    }],
    ['POST', /^\/api\/rooms\/([\w-]+)\/leave$/, ({ userId, params: [id] }) => {
      leaveRoom(db, requireUser(userId), requireRoom(id));
      return { body: { ok: true } };
    }],
    ['POST', /^\/api\/rooms\/([\w-]+)\/payments\/([\w-]+)\/sent$/, ({ userId, body, params: [id, pid] }) => {
      const user = requireUser(userId);
      const room = requireRoom(id);
      markSent(db, user, room, pid, body.reference, now());
      return { body: roomDetail(db, room, user) };
    }],
    ['POST', /^\/api\/rooms\/([\w-]+)\/payments\/([\w-]+)\/confirm$/, ({ userId, params: [id, pid] }) => {
      const user = requireUser(userId);
      const room = requireRoom(id);
      confirmPayment(db, user, room, pid, now());
      return { body: roomDetail(db, room, user) };
    }],
  ];

  if (demo) {
    routes.push(
      ['GET', /^\/api\/sima\/mock\/([\w-]+)$/, ({ params: [id] }) => {
        const info = sima.describe(id);
        if (!info) throw new GameError('Sorğu tapılmadı.', 404);
        return { body: info };
      }],
      ['POST', /^\/api\/sima\/mock\/([\w-]+)\/sign$/, ({ body, params: [id] }) => {
        try {
          sima.sign(id, body);
        } catch (err) {
          throw new GameError(err.message);
        }
        return { body: { ok: true } };
      }],
      ['POST', /^\/api\/demo\/rooms\/([\w-]+)\/fill$/, ({ userId, params: [id] }) => {
        const user = requireUser(userId);
        const room = requireRoom(id);
        requireMember(user, room);
        fillWithBots(db, room, now());
        return { body: roomDetail(db, room, user) };
      }],
      ['POST', /^\/api\/demo\/rooms\/([\w-]+)\/bots$/, ({ userId, params: [id] }) => {
        const user = requireUser(userId);
        const room = requireRoom(id);
        requireMember(user, room);
        botsAct(db, room, now());
        return { body: roomDetail(db, room, user) };
      }],
    );
  }

  return async function handle({ method, path, body = {}, userId = null }) {
    try {
      for (const [m, pattern, handler] of routes) {
        const match = path.match(pattern);
        if (!match || method !== m) continue;
        const out = await handler({ userId, body, params: match.slice(1) });
        return { status: 200, ...out };
      }
      return { status: 404, body: { error: 'Not found' } };
    } catch (err) {
      if (err instanceof GameError) return { status: err.status, body: { error: err.message } };
      throw err;
    }
  };
}

// Periodic upkeep: overdue penalties and stale SİMA requests. Returns true if db changed.
export function housekeeping(db, sima, now = Date.now()) {
  sima.prune();
  return tick(db, now);
}
