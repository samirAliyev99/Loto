// SİMA sign-in. Every provider has the same shape:
//   createRequest(purpose)  -> { requestId, deeplink, demoUrl?, expiresAt }
//   getResult(requestId)    -> { status: 'pending' | 'signed' | 'rejected' | 'expired', identity? }
// identity is { fin, fullName } taken from the signer's certificate. A signed result
// is returned only once, so one signature can't open two sessions.

const FIN_RE = /^[0-9A-Z]{7}$/;

export function normalizeFin(fin) {
  const f = String(fin ?? '').trim().toUpperCase();
  return FIN_RE.test(f) ? f : null;
}

// Simulates the SİMA phone app so the whole flow can be tried without a contract.
// The "phone" is public/sima-demo.html; it calls sign() through /api/sima/mock/*.
// Requests live in a plain object so the browser-only build can keep them in localStorage.
export class MockSimaProvider {
  constructor({ requests = {}, ttlMs = 5 * 60_000, now = Date.now } = {}) {
    this.requests = requests;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  createRequest(purpose) {
    const id = globalThis.crypto.randomUUID();
    const expiresAt = this.now() + this.ttlMs;
    const challenge = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    this.requests[id] = { id, purpose, challenge, status: 'pending', expiresAt };
    return { requestId: id, deeplink: `sima://sign?request=${id}`, demoUrl: `sima-demo.html?req=${id}`, expiresAt };
  }

  #get(id) {
    const req = Object.hasOwn(this.requests, id) ? this.requests[id] : null;
    if (req && req.status === 'pending' && this.now() > req.expiresAt) req.status = 'expired';
    return req;
  }

  describe(id) {
    const req = this.#get(id);
    if (!req) return null;
    return { purpose: req.purpose, challenge: req.challenge, status: req.status, expiresAt: req.expiresAt };
  }

  sign(id, { fin, fullName, approve = true }) {
    const req = this.#get(id);
    if (!req) throw new Error('Sorğu tapılmadı.');
    if (req.status !== 'pending') throw new Error('Sorğu artıq aktiv deyil.');
    if (!approve) {
      req.status = 'rejected';
      return;
    }
    const identity = { fin: normalizeFin(fin), fullName: String(fullName ?? '').trim().slice(0, 80) };
    if (!identity.fin) throw new Error('FİN 7 simvol olmalıdır (rəqəm və latın hərfi).');
    if (identity.fullName.length < 3) throw new Error('Ad və soyad daxil edin.');
    req.identity = identity;
    req.status = 'signed';
  }

  getResult(id) {
    const req = this.#get(id);
    if (!req) return { status: 'expired' };
    if (req.status !== 'signed') return { status: req.status };
    // A real provider verifies the signature and certificate chain here.
    delete this.requests[id];
    return { status: 'signed', identity: req.identity };
  }

  // Drops finished requests so the store doesn't grow forever.
  prune() {
    for (const [id, req] of Object.entries(this.requests)) {
      if (this.now() > req.expiresAt + this.ttlMs) delete this.requests[id];
    }
  }
}

// Production SİMA. The integration API, endpoints and credentials come with the
// service agreement for SİMA İmza, so they are configuration, not code.
// Fill in the two methods according to that documentation.
export class SimaProvider {
  constructor({ apiUrl, clientId, clientSecret }) {
    if (!apiUrl || !clientId || !clientSecret) {
      throw new Error('SIMA_API_URL, SIMA_CLIENT_ID and SIMA_CLIENT_SECRET must be set (or run with DEMO=1).');
    }
    Object.assign(this, { apiUrl, clientId, clientSecret });
  }

  createRequest(purpose) {
    // 1. Create a signing request with a random challenge for `purpose`.
    // 2. Return the deeplink/QR payload the SİMA app opens.
    throw new Error('SİMA integration is not configured yet.');
  }

  getResult(requestId) {
    // 1. Ask SİMA for the request status.
    // 2. When signed: verify the signature against the challenge and the certificate
    //    chain, then read the FIN and full name from the certificate.
    throw new Error('SİMA integration is not configured yet.');
  }

  prune() {}
}

export function createSimaProvider(env) {
  if (env.DEMO === '1') return new MockSimaProvider();
  return new SimaProvider({ apiUrl: env.SIMA_API_URL, clientId: env.SIMA_CLIENT_ID, clientSecret: env.SIMA_CLIENT_SECRET });
}
