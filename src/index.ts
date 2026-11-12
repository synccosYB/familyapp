import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, verify } from '@node-rs/argon2';
import { config } from './config.js';
import { pool, q, q1, tx } from './db.js';
import { MONTH_CODES, MONTH_YI, daysUntil, gem, hebrewForYmd, nextYahrzeit, todayYmd } from './hebrew.js';
import { startJobs } from './jobs.js';
import { MASECHTOS } from './masechtos.js';
import { emailReady, normalizeEmail, sendAccountEmail } from './email.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(__dirname, '../web');
const UPLOADS = path.resolve(config.dataDir, 'uploads');
mkdirSync(UPLOADS, { recursive: true });

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const tok = (n = 32) => randomBytes(n).toString('base64url');
const hashPw = (pw: string) => hash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
const COOKIE = 'fam_s';

class HttpError extends Error { constructor(public status: number, public yi: string) { super(yi); } }
const bad = (yi: string) => new HttpError(400, yi);

export function normPhone(raw: unknown): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 10) return '1' + d;
  if (d.length >= 11 && d.length <= 15) return d;
  return '';
}
const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const pwProblem = (pw: unknown) => (typeof pw !== 'string' || pw.length < 6 ? 'דאס פאסווארט דארף האבן כאטש 6 אותיות' : pw.length > 200 ? 'צו לאנג' : null);
const SIDE3 = ['a', 'b', 'both'];

interface User { id: number; name: string; phone: string; email: string | null; email_verified_at: string | null; sides: string[]; status: string; is_admin: boolean }
declare module 'fastify' { interface FastifyRequest { user?: User } }

const app = Fastify({ logger: { level: config.logLevel }, trustProxy: config.trustProxy, bodyLimit: 200_000 });
await app.register(cookie);
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'], frameSrc: ["'self'"], objectSrc: ["'self'"], connectSrc: ["'self'"],
      frameAncestors: ["'self'"], formAction: ["'self'"], upgradeInsecureRequests: null,
    },
  },
  crossOriginEmbedderPolicy: false,
});
await app.register(rateLimit, { global: false });
await app.register(multipart, { limits: { fileSize: config.uploadMaxMb * 1024 * 1024, files: 1, fields: 5 } });
await app.register(fstatic, { root: WEB, prefix: '/', index: ['index.html'], maxAge: 0, cacheControl: true,
  setHeaders: (res, p) => { if (/\.(js|css|svg|png|woff2)$/.test(p)) res.setHeader('Cache-Control', 'no-cache'); } });

app.setErrorHandler((err: any, req, reply) => {
  if (err instanceof HttpError) return reply.code(err.status).send({ error: err.yi });
  if (err.statusCode === 429) return reply.code(429).send({ error: 'צו פיל פרואוון, ווארט א מינוט' });
  if (err.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: `די פייל איז צו גרויס (מאקסימום ${config.uploadMaxMb} MB)` });
  if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'פעלער: ' + err.message });
  req.log.error(err);
  return reply.code(500).send({ error: 'עפעס איז נישט געגאנגען, פרובירט נאכאמאל' });
});

// CSRF: state-changing API calls must carry our header (a cross-site form cannot set it); cookie is SameSite=Lax too.
app.addHook('onRequest', async (req) => {
  if (req.url.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-familye'] !== '1')
    throw new HttpError(403, 'פארבאטן');
});

async function loadUser(req: FastifyRequest): Promise<User | null> {
  const t = req.cookies[COOKIE];
  if (!t) return null;
  const u = await q1<User>(`SELECT u.id,u.name,u.phone,u.email,u.email_verified_at,u.sides,u.status,u.is_admin FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at>now()`, [sha(t)]);
  return u || null;
}
async function member(req: FastifyRequest): Promise<User> {
  const u = await loadUser(req);
  if (!u) throw new HttpError(401, 'לאג אין');
  if (u.status !== 'active') throw new HttpError(403, 'דיין אקאונט ווארט נאך אויף אפרוביישן');
  req.user = u;
  q('UPDATE users SET last_seen_at=now() WHERE id=$1 AND (last_seen_at IS NULL OR last_seen_at<now()-interval \'5 min\')', [u.id]).catch(() => {});
  return u;
}
async function admin(req: FastifyRequest) { const u = await member(req); if (!u.is_admin) throw new HttpError(403, 'נאר פאר אדמין'); return u; }
const seesAll = (u: User) => u.is_admin || (u.sides.includes('a') && u.sides.includes('b'));
const mySides = (u: User) => (u.is_admin ? ['a', 'b'] : u.sides);
const canSee = (u: User, side: string) => side === 'both' || side === 'all' || mySides(u).includes(side);
// SQL fragment: rows whose side is visible to u (param index n holds mySides)
const sideSql = (col: string, n: number) => `(${col} IN ('both','all') OR ${col} = ANY($${n}::text[]))`;
function okSide(u: User, side: unknown, allowed = SIDE3): string {
  const s = String(side || '');
  if (!allowed.includes(s)) throw bad('קלייב אויס א סייד');
  if (s === 'all') return s;
  if (s === 'both') return seesAll(u) ? s : u.sides[0];
  if (!mySides(u).includes(s)) throw new HttpError(403, 'דו ביסט נישט אויף יענע סייד');
  return s;
}

async function newSession(reply: FastifyReply, userId: number) {
  const t = tok();
  await q(`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+($3||' days')::interval)`, [sha(t), userId, String(config.sessionDays)]);
  reply.setCookie(COOKIE, t, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: config.sessionDays * 86400 });
}
const publicUser = (u: any) => ({ id: u.id, name: u.name, phone: u.phone, email: u.email, email_verified: !!u.email_verified_at, sides: u.sides, status: u.status, is_admin: u.is_admin });

// ---------------- settings ----------------
const getSettings = () => q1('SELECT family_yi,family_en,side_a_yi,side_a_en,side_a_family_yi,side_a_family_en,side_b_yi,side_b_en,side_b_family_yi,side_b_family_en FROM settings WHERE id=1');
app.get('/api/settings', async () => ({ settings: await getSettings() }));
const BOOTED = new Date().toISOString();
app.get('/api/health', async () => { await q('SELECT 1'); return { ok: true, booted: BOOTED, build: process.env.BUILD_ID || null }; });

// ---------------- auth ----------------
const authLimit = { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } };
async function findInvitation(token: unknown) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(token)) throw bad('דער אינוויטעישן לינק איז נישט גוט');
  const invitation = await q1(`SELECT i.sides,i.created_by FROM family_invitations i JOIN users u ON u.id=i.created_by
    WHERE i.token_hash=$1 AND i.expires_at>now() AND u.status='active'
    AND (u.is_admin OR i.sides <@ u.sides)`, [sha(token)]);
  if (!invitation) throw new HttpError(404, 'דער אינוויטעישן לינק איז אויסגעלאפן. בעט א נייעם לינק.');
  return invitation;
}
app.post('/api/family-invitations', { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async req => {
  const u = await member(req), raw = (req.body as any)?.sides;
  if (!Array.isArray(raw) || !raw.length || raw.length > 2 || raw.some(s => !['a','b'].includes(s))) throw bad('קלייב אויס איין סייד אדער ביידע סיידס');
  const sides = [...new Set(raw)] as string[];
  if (sides.some(s => !mySides(u).includes(s))) throw new HttpError(403, 'דו קענסט נאר איינלאדענען צו דיין אייגענע סייד');
  const token = tok(24);
  await q('INSERT INTO family_invitations(token_hash,sides,created_by) VALUES($1,$2,$3)', [sha(token),sides,u.id]);
  return { link: `${config.publicUrl}/#join=${token}`, sides, days: 7 };
});
app.get('/api/family-invitations/:token', authLimit, async req => {
  const invitation = await findInvitation((req.params as any).token);
  return { sides: invitation.sides };
});
app.post('/api/auth/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req) => {
  const phone = normPhone((req.body as any)?.phone);
  if (!phone) throw bad('שרייב א ריכטיגן טעלעפאן נומער');
  const request = await q1(`INSERT INTO password_reset_requests(user_id)
    SELECT id FROM users WHERE phone=$1 AND status <> 'rejected'
    ON CONFLICT (user_id) DO UPDATE SET requested_at=now(), resolved_at=NULL
    WHERE password_reset_requests.requested_at < now()-interval '15 minutes'
    RETURNING user_id`, [phone]);
  if (request && emailReady()) {
    const token = tok(24), tokenHash = sha(token);
    const recipient = await tx(async c => {
      const u = (await c.query('SELECT id,email,email_verified_at,status FROM users WHERE id=$1 FOR UPDATE', [request.user_id])).rows[0];
      if (!u?.email_verified_at || !normalizeEmail(u.email) || u.status === 'rejected') return null;
      await c.query('UPDATE password_tokens SET expires_at=now() WHERE user_id=$1 AND used_at IS NULL', [u.id]);
      await c.query("INSERT INTO password_tokens(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [tokenHash, u.id]);
      return u.email;
    });
    if (recipient) {
      try {
        await sendAccountEmail(recipient, 'reset', `${config.publicUrl}/#setpw=${token}`, tokenHash);
        await q('UPDATE password_reset_requests SET resolved_at=now() WHERE user_id=$1', [request.user_id]);
      } catch {
        await q('UPDATE password_tokens SET expires_at=now() WHERE token_hash=$1', [tokenHash]);
        req.log.error({ userId: request.user_id }, 'Recovery email failed; administrator assistance remains available');
      }
    }
  }
  return { ok: true };
});
app.post('/api/auth/signup', authLimit, async (req, reply) => {
  const b: any = req.body || {};
  const name = str(b.name, 80), phone = normPhone(b.phone), email = str(b.email, 120) || null;
  const invitation = b.invitation_token ? await findInvitation(b.invitation_token) : null;
  const sides = invitation ? invitation.sides : Array.isArray(b.sides) ? [...new Set(b.sides.filter((s: any) => s === 'a' || s === 'b'))] as string[] : [];
  if (!name) throw bad('שרייב דיין נאמען');
  if (!phone) throw bad('שרייב א ריכטיגן טעלעפאן נומער');
  if (!sides.length) throw bad('קלייב אויס פון וועלכע סייד דו ביסט');
  const p = pwProblem(b.password); if (p) throw bad(p);
  if (await q1('SELECT 1 FROM users WHERE phone=$1', [phone])) throw new HttpError(409, 'דער טעלעפאן נומער איז שוין רעדזשיסטרירט. לאג אין.');
  const isQa = !!config.qaPhonePrefix && phone.startsWith(config.qaPhonePrefix);
  const u = await q1(`INSERT INTO users(name,phone,email,password_hash,sides,is_qa,note,invited_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [name, phone, email, await hashPw(b.password), sides, isQa, str(b.note, 300), invitation?.created_by || null]);
  await newSession(reply, u.id);
  return { user: publicUser(u) };
});
app.post('/api/auth/login', authLimit, async (req, reply) => {
  const b: any = req.body || {};
  const phone = normPhone(b.phone);
  const u = phone ? await q1('SELECT * FROM users WHERE phone=$1', [phone]) : null;
  const ok = u?.password_hash ? await verify(u.password_hash, String(b.password || '')).catch(() => false) : false;
  if (!u || !ok) throw new HttpError(401, 'טעלעפאן אדער פאסווארט איז נישט ריכטיג');
  if (u.status === 'rejected') throw new HttpError(403, 'דער אקאונט איז נישט אפרובירט געווארן');
  await newSession(reply, u.id);
  return { user: publicUser(u) };
});
app.post('/api/auth/logout', async (req, reply) => {
  const t = req.cookies[COOKIE];
  if (t) await q('DELETE FROM sessions WHERE token_hash=$1', [sha(t)]);
  reply.clearCookie(COOKIE, { path: '/' });
  return { ok: true };
});
app.get('/api/me', async (req) => {
  const u = await loadUser(req);
  return { user: u ? publicUser(u) : null, settings: await getSettings(), email_enabled: emailReady() };
});
app.get('/api/auth/token/:t', authLimit, async (req) => {
  const r = await q1(`SELECT u.name FROM password_tokens p JOIN users u ON u.id=p.user_id WHERE p.token_hash=$1 AND p.used_at IS NULL AND p.expires_at>now()`, [sha((req.params as any).t)]);
  if (!r) throw new HttpError(404, 'דער לינק איז שוין נישט גוט (אדער שוין גענוצט). בעט דעם אדמין פאר א נייעם.');
  return { name: r.name };
});
app.post('/api/auth/set-password', authLimit, async (req, reply) => {
  const b: any = req.body || {};
  const p = pwProblem(b.password); if (p) throw bad(p);
  const tokenHash = sha(String(b.token || ''));
  const passwordHash = await hashPw(b.password);
  const u = await tx(async c => {
    const candidate = (await c.query('SELECT user_id FROM password_tokens WHERE token_hash=$1', [tokenHash])).rows[0];
    if (!candidate) throw new HttpError(404, 'דער לינק איז שוין נישט גוט (אדער שוין גענוצט). בעט דעם אדמין פאר א נייעם.');
    // Share the account lock with reset-link creation: only one concurrent reset can win.
    await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [candidate.user_id]);
    const r = (await c.query(`UPDATE password_tokens SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING user_id`, [tokenHash])).rows[0];
    if (!r) throw new HttpError(404, 'דער לינק איז שוין נישט גוט (אדער שוין גענוצט). בעט דעם אדמין פאר א נייעם.');
    const user = (await c.query('UPDATE users SET password_hash=$1 WHERE id=$2 RETURNING *', [passwordHash, r.user_id])).rows[0];
    await c.query('UPDATE password_tokens SET expires_at=now() WHERE user_id=$1 AND used_at IS NULL', [r.user_id]);
    await c.query('DELETE FROM sessions WHERE user_id=$1', [r.user_id]);
    await c.query('UPDATE password_reset_requests SET resolved_at=now() WHERE user_id=$1', [r.user_id]);
    return user;
  });
  await newSession(reply, u.id);
  return { user: publicUser(u) };
});
app.post('/api/me/password', authLimit, async (req) => {
  const u0 = await loadUser(req); if (!u0) throw new HttpError(401, 'לאג אין');
  const b: any = req.body || {};
  const u = await q1('SELECT password_hash FROM users WHERE id=$1', [u0.id]);
  if (!(await verify(u.password_hash, String(b.old || '')).catch(() => false))) throw bad('דאס אלטע פאסווארט איז נישט ריכטיג');
  const p = pwProblem(b.password); if (p) throw bad(p);
  await q('UPDATE users SET password_hash=$1 WHERE id=$2', [await hashPw(b.password), u0.id]);
  return { ok: true };
});
app.patch('/api/me', async (req) => {
  const u0 = await loadUser(req); if (!u0) throw new HttpError(401, 'לאג אין');
  const b: any = req.body || {};
  const name = str(b.name, 80); if (!name) throw bad('שרייב דיין נאמען');
  const email = normalizeEmail(b.email);
  if (b.email && !email) throw bad('שרייב א ריכטיגן אימעיל אדרעס');
  const u = await tx(async c => {
    const previous = (await c.query('SELECT email FROM users WHERE id=$1 FOR UPDATE', [u0.id])).rows[0];
    const changed = normalizeEmail(previous.email) !== email;
    if (changed) {
      await c.query('UPDATE password_tokens SET expires_at=now() WHERE user_id=$1 AND used_at IS NULL', [u0.id]);
      await c.query('UPDATE email_verification_tokens SET expires_at=now() WHERE user_id=$1 AND used_at IS NULL', [u0.id]);
    }
    return (await c.query(`UPDATE users SET name=$1,email=$2,
      email_verified_at=CASE WHEN $4 THEN NULL ELSE email_verified_at END
      WHERE id=$3 RETURNING *`, [name, email || null, u0.id, changed])).rows[0];
  });
  return { user: publicUser(u) };
});
app.post('/api/me/email-verification', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req) => {
  const me = await member(req);
  if (!emailReady()) throw new HttpError(503, 'אימעיל איז נאך נישט פארבונדן');
  const token = tok(24), tokenHash = sha(token);
  const email = await tx(async c => {
    const u = (await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [me.id])).rows[0];
    if (!(await verify(u.password_hash || '', String((req.body as any)?.password || '')).catch(() => false))) throw bad('דאס פאסווארט איז נישט ריכטיג');
    const recipient = normalizeEmail(u.email);
    if (!recipient) throw bad('סעיוו קודם דיין אימעיל אדרעס אויבן');
    if ((await c.query('SELECT 1 FROM users WHERE lower(email)=$1 AND email_verified_at IS NOT NULL AND id<>$2', [recipient, me.id])).rowCount) throw new HttpError(409, 'דער אימעיל איז שוין באשטעטיגט אויף אן אנדער אקאונט');
    await c.query('UPDATE email_verification_tokens SET expires_at=now() WHERE user_id=$1 AND used_at IS NULL', [me.id]);
    await c.query("INSERT INTO email_verification_tokens(token_hash,user_id,email,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')", [tokenHash, me.id, recipient]);
    return recipient;
  });
  try { await sendAccountEmail(email, 'verify', `${config.publicUrl}/#verifyemail=${token}`, tokenHash); }
  catch {
    await q('UPDATE email_verification_tokens SET expires_at=now() WHERE token_hash=$1', [tokenHash]);
    throw new HttpError(503, 'דער אימעיל איז נישט געשיקט געווארן. פרוביר שפעטער נאכאמאל.');
  }
  return { ok: true };
});
app.post('/api/auth/verify-email', authLimit, async (req) => {
  const tokenHash = sha(String((req.body as any)?.token || ''));
  try {
    await tx(async c => {
      const candidate = (await c.query('SELECT user_id FROM email_verification_tokens WHERE token_hash=$1', [tokenHash])).rows[0];
      if (!candidate) throw bad('דער לינק איז שוין נישט גוט. בעט א נייעם אין מיין אקאונט.');
      const u = (await c.query('SELECT email FROM users WHERE id=$1 FOR UPDATE', [candidate.user_id])).rows[0];
      const t = (await c.query(`UPDATE email_verification_tokens SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL
        AND expires_at>now() AND email=$2 RETURNING user_id`, [tokenHash, normalizeEmail(u?.email)])).rows[0];
      if (!t) throw bad('דער לינק איז שוין נישט גוט. בעט א נייעם אין מיין אקאונט.');
      await c.query('UPDATE users SET email_verified_at=now() WHERE id=$1', [t.user_id]);
    });
  } catch (e: any) {
    if (e.code === '23505') throw new HttpError(409, 'דער אימעיל איז שוין באשטעטיגט אויף אן אנדער אקאונט');
    throw e;
  }
  return { ok: true };
});
app.post('/api/me/phone', authLimit, async (req) => {
  const me = await member(req);
  const b: any = req.body || {}, phone = normPhone(b.phone);
  if (!phone) throw bad('שרייב א ריכטיגן טעלעפאן נומער');
  let user;
  try {
    user = await tx(async c => {
      const u = (await c.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [me.id])).rows[0];
      if (!(await verify(u.password_hash || '', String(b.password || '')).catch(() => false)))
        throw bad('דאס פאסווארט איז נישט ריכטיג');
      if (u.phone === phone) return u;
      const changed = (await c.query('UPDATE users SET phone=$1 WHERE id=$2 RETURNING *', [phone, me.id])).rows[0];
      // Retain this browser session; old recovery links and other sessions expire.
      await c.query('DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2', [me.id, sha(req.cookies[COOKIE]!)]);
      await c.query('UPDATE password_tokens SET expires_at=now() WHERE user_id=$1 AND used_at IS NULL', [me.id]);
      await c.query('UPDATE password_reset_requests SET resolved_at=now() WHERE user_id=$1', [me.id]);
      return changed;
    });
  } catch (e: any) {
    if (e.code === '23505') throw new HttpError(409, 'דער טעלעפאן נומער ווערט שוין גענוצט דורך אן אנדער אקאונט');
    throw e;
  }
  return { user: publicUser(user) };
});

async function ownerId() {
  const row = await q1(`SELECT COALESCE(s.bootstrap_admin_id,
    (SELECT id FROM users WHERE phone=$1)) AS id FROM settings s WHERE s.id=1`, [normPhone(config.admin.phone)]);
  return row?.id;
}

// ---------------- admin ----------------
app.get('/api/admin/users', async (req) => {
  await admin(req);
  const owner = await q1('SELECT phone FROM users WHERE id=$1', [await ownerId()]);
  return { owner_phone: owner?.phone || '', users: await q(`SELECT id,name,phone,email,sides,status,is_admin,note,created_at,last_seen_at,(password_hash IS NOT NULL) has_password,
    (SELECT requested_at FROM password_reset_requests r WHERE r.user_id=users.id AND r.resolved_at IS NULL) reset_requested_at FROM users
    ORDER BY (status='pending') DESC, status, name`) };
});
app.patch('/api/admin/users/:id', async (req) => {
  const me = await admin(req);
  const id = Number((req.params as any).id), b: any = req.body || {};
  const u = await q1('SELECT * FROM users WHERE id=$1', [id]); if (!u) throw new HttpError(404, 'נישט געטראפן');
  const owner = u.id === await ownerId();
  if (owner && id !== me.id && (b.status !== undefined || b.is_admin === false)) throw new HttpError(403, 'מען קען נישט טוישן דעם הויפט אדמין');
  if (b.status !== undefined) {
    if (!['active', 'rejected', 'pending'].includes(b.status)) throw bad('?');
    if (id === me.id && b.status !== 'active') throw bad('דו קענסט נישט אפזאגן דיך אליין');
    await q(`UPDATE users SET status=$1, approved_at=CASE WHEN $1='active' THEN now() ELSE approved_at END WHERE id=$2`, [b.status, id]);
    if (b.status !== 'active') await q('DELETE FROM sessions WHERE user_id=$1', [id]);
  }
  if (b.sides !== undefined) {
    const s = Array.isArray(b.sides) ? [...new Set(b.sides.filter((x: any) => x === 'a' || x === 'b'))] : [];
    if (!s.length) throw bad('כאטש איין סייד');
    await q('UPDATE users SET sides=$1 WHERE id=$2', [s, id]);
  }
  if (b.is_admin !== undefined) {
    if (id === me.id && !b.is_admin) throw bad('דו קענסט נישט אוועקנעמען דיין אייגענעם אדמין');
    await q('UPDATE users SET is_admin=$1 WHERE id=$2', [!!b.is_admin, id]);
  }
  if (b.name !== undefined) { const n = str(b.name, 80); if (n) await q('UPDATE users SET name=$1 WHERE id=$2', [n, id]); }
  return { ok: true };
});
app.delete('/api/admin/users/:id', async (req) => {
  const me = await admin(req);
  const id = Number((req.params as any).id);
  if (id === me.id) throw bad('דו קענסט נישט אויסמעקן דיך אליין');
  const u = await q1('SELECT phone FROM users WHERE id=$1', [id]);
  if (u && id === await ownerId()) throw new HttpError(403, 'מען קען נישט אויסמעקן דעם הויפט אדמין');
  await q('DELETE FROM users WHERE id=$1', [id]);
  return { ok: true };
});
app.post('/api/admin/users/:id/reset-link', async (req) => {
  await admin(req);
  const id = Number((req.params as any).id);
  const t = tok(24);
  await tx(async c => {
    if (!(await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [id])).rows.length) throw new HttpError(404, 'נישט געטראפן');
    await c.query(`UPDATE password_tokens SET expires_at=now() WHERE user_id=$1 AND used_at IS NULL`, [id]);
    await c.query(`INSERT INTO password_tokens(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')`, [sha(t), id]);
    await c.query('UPDATE password_reset_requests SET resolved_at=now() WHERE user_id=$1', [id]);
  });
  return { link: `${config.publicUrl}/#setpw=${t}`, hours: 1 };
});
app.put('/api/admin/settings', async (req) => {
  await admin(req);
  const b: any = req.body || {};
  const f = ['family_yi', 'family_en', 'side_a_yi', 'side_a_en', 'side_a_family_yi', 'side_a_family_en', 'side_b_yi', 'side_b_en', 'side_b_family_yi', 'side_b_family_en'];
  const vals = f.map((k) => str(b[k], 80));
  if (!vals[0] || !vals[2] || !vals[6]) throw bad('פעלט א נאמען');
  await q(`UPDATE settings SET ${f.map((k, i) => `${k}=$${i + 1}`).join(',')}, updated_at=now() WHERE id=1`, vals);
  return { settings: await getSettings() };
});

// ---------------- yahrzeits ----------------
function yzOut(r: any) {
  const n = nextYahrzeit(r.hday, r.hmonth, r.death_year);
  return { ...r, hebrew: `${gem(r.hday)} ${MONTH_YI[r.hmonth] || r.hmonth}`, next: n };
}
async function listYahrzeits(u: User) {
  const rows = await q(`SELECT y.*, coalesce((SELECT json_agg(json_build_object('id',f.id,'name',f.name) ORDER BY f.name) FROM person_families pf JOIN families f ON f.id=pf.family_id WHERE pf.person_id=y.person_id),'[]') families, (r.user_id IS NOT NULL) remind, cu.name created_by_name FROM yahrzeits y
    LEFT JOIN yahrzeit_reminders r ON r.yahrzeit_id=y.id AND r.user_id=$1 LEFT JOIN users cu ON cu.id=y.created_by
    WHERE ${sideSql('y.side', 2)}`, [u.id, mySides(u)]);
  return rows.map(yzOut).sort((a, b) => (a.next?.days ?? 9999) - (b.next?.days ?? 9999));
}
function yzBody(u: User, b: any) {
  const name = str(b.name, 120); if (!name) throw bad('שרייב א נאמען');
  const hday = Number(b.hday); if (!(hday >= 1 && hday <= 30)) throw bad('קלייב אויס דעם טאג');
  if (!(MONTH_CODES as readonly string[]).includes(b.hmonth)) throw bad('קלייב אויס דעם חודש');
  const dy = b.death_year ? Number(b.death_year) : null;
  return [name, str(b.father_name, 120), str(b.relation, 80), okSide(u, b.side), hday, b.hmonth, dy && dy > 5000 && dy < 6000 ? dy : null, str(b.kever, 200), str(b.note, 500)];
}
app.get('/api/yahrzeits', async (req) => ({ yahrzeits: await listYahrzeits(await member(req)) }));
app.post('/api/yahrzeits', async (req) => {
  const u = await member(req);
  const r = await q1(`INSERT INTO yahrzeits(name,father_name,relation,side,hday,hmonth,death_year,kever,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [...yzBody(u, req.body), u.id]);
  return { yahrzeit: yzOut(r) };
});
app.put('/api/yahrzeits/:id', async (req) => {
  const u = await member(req); const id = Number((req.params as any).id);
  const old = await q1('SELECT side,person_id FROM yahrzeits WHERE id=$1', [id]);
  if (old?.person_id) throw bad('עדיט דעם מענטש אין פעמילי טרי');
  if (!old || !canSee(u, old.side)) throw new HttpError(404, 'נישט געטראפן');
  const r = await q1(`UPDATE yahrzeits SET name=$1,father_name=$2,relation=$3,side=$4,hday=$5,hmonth=$6,death_year=$7,kever=$8,note=$9 WHERE id=$10 RETURNING *`, [...yzBody(u, req.body), id]);
  return { yahrzeit: yzOut(r) };
});
app.delete('/api/yahrzeits/:id', async (req) => {
  const u = await member(req); const id = Number((req.params as any).id);
  const r = await q1('SELECT created_by,person_id FROM yahrzeits WHERE id=$1', [id]);
  if (!r) throw new HttpError(404, 'נישט געטראפן');
  if (r.person_id) throw bad('עדיט דעם פטירה דאטום אין פעמילי טרי');
  if (!u.is_admin && r.created_by !== u.id) throw new HttpError(403, 'נאר דער וואס האט עס צוגעלייגט אדער דער אדמין');
  await q('DELETE FROM yahrzeits WHERE id=$1', [id]);
  return { ok: true };
});
app.post('/api/yahrzeits/:id/remind', async (req) => {
  const u = await member(req); const id = Number((req.params as any).id), on = !!(req.body as any)?.on;
  if (on) await q('INSERT INTO yahrzeit_reminders(user_id,yahrzeit_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [u.id, id]);
  else await q('DELETE FROM yahrzeit_reminders WHERE user_id=$1 AND yahrzeit_id=$2', [u.id, id]);
  return { remind: on };
});

// ---------------- family tree: canonical person records ----------------
const personSelect = `SELECT p.*, coalesce((SELECT json_agg(json_build_object('id',fam.id,'name',fam.name) ORDER BY fam.name) FROM person_families pf JOIN families fam ON fam.id=pf.family_id WHERE pf.person_id=p.id),'[]') families, f.name father_name, f.title father_title, m.name mother_name, m.title mother_title,
  sp.name spouse_name, sp.title spouse_title FROM people p
  LEFT JOIN people f ON f.id=p.father_id LEFT JOIN people m ON m.id=p.mother_id
  LEFT JOIN people sp ON sp.id=p.spouse_id`;
app.get('/api/people', async (req) => {
  const u = await member(req);
  return { people: await q(`${personSelect} WHERE ${sideSql('p.side',1)} ORDER BY p.id`, [mySides(u)]) };
});
const personId = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v); if (!Number.isSafeInteger(n) || n < 1) throw bad('קלייב אויס א מענטש'); return n;
};
async function savePerson(u: User, b: any, id?: number) {
  return tx(async c => {
    // Serialize graph changes so two simultaneous saves cannot introduce ancestry cycles.
    await c.query("SELECT pg_advisory_xact_lock(68427301)");
    const old = id ? (await c.query('SELECT * FROM people WHERE id=$1 FOR UPDATE',[id])).rows[0] : null;
    if (id && (!old || !canSee(u,old.side))) throw new HttpError(404,'נישט געטראפן');
    b = {...(old || {}),...b};
    const name = str(b.name,120); if (!name) throw bad('שרייב א נאמען');
    const side = okSide(u,b.side);
    const father = personId(b.father_id), mother = personId(b.mother_id), spouse = personId(b.spouse_id);
    const legacyParent = b.parent_id !== undefined ? personId(b.parent_id) : old?.parent_id || null;
    if ((father && father===mother) || (spouse && [father,mother,legacyParent].includes(spouse)) || [father,mother,spouse,legacyParent].some(v=>v && v===id)) throw bad('די משפחה לינקס זענען נישט ריכטיג');
    const status = b.life_status ?? (b.niftar ? 'deceased' : old?.life_status || 'unknown');
    if (!['unknown','living','deceased'].includes(status)) throw bad('קלייב אויס א סטאטוס');
    const day = b.death_hday === '' || b.death_hday == null ? null : Number(b.death_hday);
    const month = str(b.death_hmonth,20) || null;
    const year = b.death_year === '' || b.death_year == null ? null : Number(b.death_year);
    if ((day !== null && (!Number.isInteger(day)||day<1||day>30)) || (month && !(MONTH_CODES as readonly string[]).includes(month)) || (year!==null && (!Number.isInteger(year)||year<=5000||year>=6000))) throw bad('דער אידישער דאטום איז נישט ריכטיג');
    if (status!=='deceased' && (day||month||year)) throw bad('א פטירה דאטום איז נאר פאר א נפטר');
    const refs = [...new Set([father,mother,spouse,legacyParent].filter(Boolean))];
    for (const ref of refs) {
      const r=(await c.query('SELECT * FROM people WHERE id=$1',[ref])).rows[0];
      // A linked person must be visible to every viewer of this person, not just the editor.
      if (!r || !canSee(u,r.side) || (r.side!=='both' && r.side!==side)) throw bad('דער פארבינדונג דארף זיין אויף דער זעלבער סייד');
      if (ref===spouse && r.side!==side) throw bad('מאן און ווייב לינקס דארפן זיין אויף דער זעלבער סייד');
      if (ref===spouse && r.spouse_id && r.spouse_id!==id) throw bad('דער מענטש האט שוין א מאן/ווייב לינק');
    }
    if (id) {
      const cycle=(await c.query(`WITH RECURSIVE ancestors(id) AS (
        SELECT unnest($1::int[]) UNION
        SELECT x.parent FROM ancestors a JOIN people p ON p.id=a.id
        CROSS JOIN LATERAL unnest(ARRAY[p.father_id,p.mother_id,p.parent_id]) x(parent) WHERE x.parent IS NOT NULL
      ) SELECT 1 FROM ancestors WHERE id=$2`,[[father,mother,legacyParent].filter(Boolean),id])).rows.length;
      if (cycle) throw bad('א מענטש קען נישט זיין זיין אייגענער אייניקל');
      // Do not move a referenced person behind a narrower visibility boundary.
      const incoming=(await c.query(`SELECT side FROM people WHERE father_id=$1 OR mother_id=$1 OR spouse_id=$1 OR parent_id=$1
        UNION SELECT side FROM directory WHERE husband_person_id=$1 OR wife_person_id=$1`,[id])).rows;
      if (incoming.some(r=>side!=='both' && r.side!==side)) throw bad('די סייד דארף שטימען מיט די פארבינדונגען');
    }
    const lineage=str(b.lineage_term,4);
    if (!['','בן','בת'].includes(lineage)) throw bad('קלייב אויס בן אדער בת');
    const previousFamilies=id?(await c.query('SELECT family_id FROM person_families WHERE person_id=$1',[id])).rows.map(r=>r.family_id):[];
    const requestedFamilies=b.family_ids===undefined?previousFamilies:b.family_ids;
    if(!Array.isArray(requestedFamilies) || requestedFamilies.some((v:any)=>!Number.isSafeInteger(Number(v))||Number(v)<1)) throw bad('קלייב אויס ריכטיגע משפחות');
    const familyIds:number[]=[...new Set<number>(requestedFamilies.map(Number))];
    const newFamily=str(b.new_family,80);
    if(newFamily) {
      const family=(await c.query(`INSERT INTO families(name,created_by) VALUES($1,$2) ON CONFLICT(lower(name)) DO UPDATE SET name=families.name RETURNING id`,[newFamily,u.id])).rows[0];
      if(!familyIds.includes(family.id)) familyIds.push(family.id);
    }
    if(familyIds.length) {
      const found=(await c.query('SELECT id FROM families WHERE id=ANY($1::int[])',[familyIds])).rows;
      if(found.length!==familyIds.length) throw bad('א משפחה איז נישט געפונען');
    }
    const vals=[side,name,str(b.spouse ?? old?.spouse,120),legacyParent,status==='deceased',str(b.note,300),str(b.title,80),father,mother,spouse,status,day,month,year,lineage];
    if (old?.spouse_id && old.spouse_id!==spouse) await c.query('UPDATE people SET spouse_id=NULL WHERE id=$1 AND spouse_id=$2',[old.spouse_id,id]);
    const row=id ? (await c.query(`UPDATE people SET side=$1,name=$2,spouse=$3,parent_id=$4,niftar=$5,note=$6,title=$7,father_id=$8,mother_id=$9,spouse_id=$10,life_status=$11,death_hday=$12,death_hmonth=$13,death_year=$14,lineage_term=$15 WHERE id=$16 RETURNING *`,[...vals,id])).rows[0]
      : (await c.query(`INSERT INTO people(side,name,spouse,parent_id,niftar,note,title,father_id,mother_id,spouse_id,life_status,death_hday,death_hmonth,death_year,lineage_term,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,[...vals,u.id])).rows[0];
    if (spouse) await c.query('UPDATE people SET spouse_id=$1 WHERE id=$2',[row.id,spouse]);
    await c.query('DELETE FROM person_families WHERE person_id=$1',[row.id]);
    if(familyIds.length) await c.query('INSERT INTO person_families(person_id,family_id) SELECT $1,unnest($2::int[])',[row.id,familyIds]);
    if(father) await c.query("UPDATE people SET lineage_term='בן' WHERE id=$1 AND lineage_term=''",[father]);
    if(mother) await c.query("UPDATE people SET lineage_term='בת' WHERE id=$1 AND lineage_term=''",[mother]);
    // A complete known date makes one shared yahrzeit; unknown dates remain unknown.
    if (status==='deceased' && day && month) {
      await c.query(`INSERT INTO yahrzeits(name,side,hday,hmonth,death_year,person_id,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(person_id) DO UPDATE SET name=excluded.name,side=excluded.side,hday=excluded.hday,hmonth=excluded.hmonth,death_year=excluded.death_year`,[[row.title,row.name].filter(Boolean).join(' '),side,day,month,year,row.id,u.id]);
    } else await c.query('DELETE FROM yahrzeits WHERE person_id=$1',[row.id]);
    // Keep a linked yahrzeit name in sync when its person's father is renamed too.
    await c.query(`UPDATE yahrzeits y SET father_name=coalesce((SELECT concat_ws(' ',nullif(p.lineage_term,''),nullif(f.title,''),f.name) FROM people f WHERE f.id=p.father_id),'') FROM people p WHERE y.person_id=p.id AND (p.id=ANY($1::int[]) OR p.father_id=$2)`,[[row.id,father,mother].filter(Boolean),row.id]);
    return row;
  });
}
app.post('/api/people', async req => ({person:await savePerson(await member(req),req.body)}));
app.put('/api/people/:id', async req => ({person:await savePerson(await member(req),req.body,Number((req.params as any).id))}));
app.delete('/api/people/:id', async req => {
  const u=await member(req), id=Number((req.params as any).id);
  return tx(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(68427301)');
    const r=(await c.query('SELECT * FROM people WHERE id=$1',[id])).rows[0];
    if (!r || !canSee(u,r.side)) throw new HttpError(404,'נישט געטראפן');
    if (!u.is_admin && r.created_by!==u.id) throw new HttpError(403,'נאר דער וואס האט עס צוגעלייגט אדער דער אדמין');
    const linked=(await c.query(`SELECT 1 FROM people WHERE parent_id=$1 OR father_id=$1 OR mother_id=$1 OR spouse_id=$1
      UNION SELECT 1 FROM directory WHERE husband_person_id=$1 OR wife_person_id=$1`,[id])).rows.length;
    if (linked) throw bad('דער מענטש איז פארבונדן מיט משפחה. נעם קודם אוועק די לינקס.');
    await c.query('DELETE FROM people WHERE id=$1',[id]); return {ok:true};
  });
});

// ---------------- mishnayos & tehillim ----------------
app.get('/api/lists', async (req) => {
  const u = await member(req);
  const rows = await q(`SELECT l.*, cu.name created_by_name, count(i.idx)::int total, count(i.taken_by)::int taken, count(*) FILTER (WHERE i.done)::int done,
      count(*) FILTER (WHERE i.taken_by=$2)::int mine
    FROM learn_lists l LEFT JOIN learn_items i ON i.list_id=l.id LEFT JOIN users cu ON cu.id=l.created_by
    WHERE ${sideSql('l.side', 1)} GROUP BY l.id, cu.name ORDER BY (l.target_date IS NULL OR l.target_date < CURRENT_DATE), l.target_date, l.id DESC`, [mySides(u), u.id]);
  return { lists: rows.map((r) => ({ ...r, days: r.target_date ? daysUntil(r.target_date) : null })), masechtos: MASECHTOS };
});
async function visibleList(u: User, id: number) {
  const l = await q1('SELECT * FROM learn_lists WHERE id=$1', [id]);
  if (!l || !canSee(u, l.side)) throw new HttpError(404, 'נישט געטראפן');
  return l;
}
app.get('/api/lists/:id', async (req) => {
  const u = await member(req); const l = await visibleList(u, Number((req.params as any).id));
  const items = await q(`SELECT i.idx,i.taken_by,i.done,tu.name taken_name FROM learn_items i LEFT JOIN users tu ON tu.id=i.taken_by WHERE list_id=$1 ORDER BY idx`, [l.id]);
  return { list: { ...l, days: l.target_date ? daysUntil(l.target_date) : null }, items, masechtos: MASECHTOS };
});
app.post('/api/lists', async (req) => {
  const u = await member(req); const b: any = req.body || {};
  const kind = b.kind === 'mishnayos' ? 'mishnayos' : b.kind === 'tehillim' ? 'tehillim' : '';
  if (!kind) throw bad('קלייב אויס תהילים אדער משניות');
  let niftar = str(b.niftar, 150), side = b.side, yid: number | null = b.yahrzeit_id ? Number(b.yahrzeit_id) : null, target = str(b.target_date, 10) || null;
  if (yid) {
    const y = await q1('SELECT * FROM yahrzeits WHERE id=$1', [yid]);
    if (!y || !canSee(u, y.side)) throw bad('יארצייט נישט געטראפן');
    niftar = niftar || [y.name, y.father_name].filter(Boolean).join(' ');
    side = side || y.side;
    if (!target) target = nextYahrzeit(y.hday, y.hmonth, y.death_year)?.ymd || null;
  }
  if (!niftar) throw bad('לעילוי נשמת וועמען?');
  if (target && !/^\d{4}-\d{2}-\d{2}$/.test(target)) throw bad('דאטום איז נישט ריכטיג');
  side = okSide(u, side || 'both');
  const l = await q1(`INSERT INTO learn_lists(kind,niftar,side,yahrzeit_id,target_date,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [kind, niftar, side, yid, target, str(b.note, 300), u.id]);
  const n = kind === 'tehillim' ? 150 : MASECHTOS.length, start = kind === 'tehillim' ? 1 : 0;
  await q(`INSERT INTO learn_items(list_id,idx) SELECT $1, g FROM generate_series($2::int,$3::int) g`, [l.id, start, start + n - 1]);
  return { list: l };
});
app.delete('/api/lists/:id', async (req) => {
  const u = await member(req); const l = await visibleList(u, Number((req.params as any).id));
  if (!u.is_admin && l.created_by !== u.id) throw new HttpError(403, 'נאר דער וואס האט עס געמאכט אדער דער אדמין');
  await q('DELETE FROM learn_lists WHERE id=$1', [l.id]);
  return { ok: true };
});
app.post('/api/lists/:id/items/:idx', async (req) => {
  const u = await member(req); const l = await visibleList(u, Number((req.params as any).id));
  const idx = Number((req.params as any).idx), act = (req.body as any)?.action;
  const cur = await q1('SELECT i.*, tu.name taken_name FROM learn_items i LEFT JOIN users tu ON tu.id=i.taken_by WHERE list_id=$1 AND idx=$2', [l.id, idx]);
  if (!cur) throw new HttpError(404, 'נישט געטראפן');
  if (act === 'take') {
    const r = await q1('UPDATE learn_items SET taken_by=$1,taken_at=now(),done=false WHERE list_id=$2 AND idx=$3 AND taken_by IS NULL RETURNING idx', [u.id, l.id, idx]);
    if (!r) { if (cur.taken_by === u.id) return { ok: true }; throw new HttpError(409, `דאס האט שוין ${cur.taken_name || 'איינער'} גענומען`); }
  } else if (act === 'give') {
    if (cur.taken_by !== u.id && !u.is_admin) throw new HttpError(403, 'דאס איז נישט דיינס');
    await q('UPDATE learn_items SET taken_by=NULL,taken_at=NULL,done=false WHERE list_id=$1 AND idx=$2', [l.id, idx]);
  } else if (act === 'done' || act === 'undone') {
    if (cur.taken_by !== u.id) throw new HttpError(403, 'דאס איז נישט דיינס');
    await q('UPDATE learn_items SET done=$1 WHERE list_id=$2 AND idx=$3', [act === 'done', l.id, idx]);
  } else throw bad('?');
  return { ok: true };
});

// ---------------- simchas + invitations ----------------
async function simchaFor(u: User, id: number) {
  const s = await q1('SELECT * FROM simchas WHERE id=$1', [id]);
  if (!s || !canSee(u, s.audience)) throw new HttpError(404, 'נישט געטראפן');
  return s;
}
app.get('/api/simchas', async (req) => {
  const u = await member(req);
  const past = (req.query as any).past === '1';
  const rows = await q(`SELECT s.*, f.filename file_name, f.mime file_mime, cu.name created_by_name,
      coalesce(sum(r.people) FILTER (WHERE r.answer='yes'),0)::int yes_people, count(*) FILTER (WHERE r.answer='yes')::int yes_count,
      count(*) FILTER (WHERE r.answer='no')::int no_count,
      max(r.answer) FILTER (WHERE r.user_id=$2) my_answer, max(r.people) FILTER (WHERE r.user_id=$2) my_people,
      coalesce(json_agg(json_build_object('name',ru.name,'answer',r.answer,'people',r.people) ORDER BY ru.name) FILTER (WHERE r.user_id IS NOT NULL),'[]') rsvps
    FROM simchas s LEFT JOIN files f ON f.id=s.file_id LEFT JOIN users cu ON cu.id=s.created_by
    LEFT JOIN rsvps r ON r.simcha_id=s.id LEFT JOIN users ru ON ru.id=r.user_id
    WHERE ${sideSql('s.audience', 1)} AND ${past ? 's.gdate < $3' : 's.gdate >= $3'}
    GROUP BY s.id, f.filename, f.mime, cu.name ORDER BY s.gdate ${past ? 'DESC' : 'ASC'}, s.id LIMIT 200`, [mySides(u), u.id, todayYmd()]);
  return { simchas: rows.map((s) => ({ ...s, hebrew: s.hdate_text || hebrewForYmd(s.gdate), days: daysUntil(s.gdate) })) };
});
function simBody(u: User, b: any) {
  const kind = str(b.kind, 60), whose = str(b.whose, 120), gdate = str(b.gdate, 10);
  if (!kind) throw bad('וואס פאר א שמחה?'); if (!whose) throw bad('פון וועמען?');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gdate)) throw bad('קלייב אויס א דאטום');
  return [kind, whose, gdate, str(b.time_text, 60), str(b.hdate_text, 60), str(b.hall, 120), str(b.address, 200), okSide(u, b.audience, ['a', 'b', 'all']), str(b.note, 500)];
}
app.post('/api/simchas', async (req) => {
  const u = await member(req);
  return { simcha: await q1(`INSERT INTO simchas(kind,whose,gdate,time_text,hdate_text,hall,address,audience,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [...simBody(u, req.body), u.id]) };
});
const mayEditSim = (u: User, s: any) => u.is_admin || s.created_by === u.id;
app.put('/api/simchas/:id', async (req) => {
  const u = await member(req); const s = await simchaFor(u, Number((req.params as any).id));
  if (!mayEditSim(u, s)) throw new HttpError(403, 'נאר דער וואס האט עס צוגעלייגט אדער דער אדמין');
  return { simcha: await q1(`UPDATE simchas SET kind=$1,whose=$2,gdate=$3,time_text=$4,hdate_text=$5,hall=$6,address=$7,audience=$8,note=$9 WHERE id=$10 RETURNING *`, [...simBody(u, req.body), s.id]) };
});
app.delete('/api/simchas/:id', async (req) => {
  const u = await member(req); const s = await simchaFor(u, Number((req.params as any).id));
  if (!mayEditSim(u, s)) throw new HttpError(403, 'נאר דער וואס האט עס צוגעלייגט אדער דער אדמין');
  await q('DELETE FROM simchas WHERE id=$1', [s.id]);
  if (s.file_id) await removeFile(s.file_id);
  return { ok: true };
});
app.post('/api/simchas/:id/rsvp', async (req) => {
  const u = await member(req); const s = await simchaFor(u, Number((req.params as any).id));
  const b: any = req.body || {};
  if (b.answer === null || b.answer === '') { await q('DELETE FROM rsvps WHERE simcha_id=$1 AND user_id=$2', [s.id, u.id]); return { ok: true }; }
  if (!['yes', 'no'].includes(b.answer)) throw bad('?');
  const people = b.answer === 'yes' ? Math.max(1, Math.min(50, Number(b.people) || 1)) : 0;
  await q(`INSERT INTO rsvps(simcha_id,user_id,answer,people) VALUES($1,$2,$3,$4) ON CONFLICT (simcha_id,user_id) DO UPDATE SET answer=$3,people=$4,updated_at=now()`, [s.id, u.id, b.answer, people]);
  return { ok: true };
});
app.post('/api/simchas/:id/mazeltov', async (req) => {
  const u = await member(req); const s = await simchaFor(u, Number((req.params as any).id));
  const room = s.audience === 'all' ? 'all' : s.audience;
  await q('INSERT INTO messages(room,user_id,body) VALUES($1,$2,$3)', [room, u.id, `🎉 מזל טוב צו ${s.whose} צום ${s.kind}!`]);
  return { ok: true, room };
});

function sniff(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|mif1|msf1|hevc)/.test(buf.subarray(8, 12).toString('latin1'))) return 'image/heic';
  return null;
}
async function removeFile(id: string) {
  await q('DELETE FROM files WHERE id=$1', [id]).catch(() => {});
  const p = path.join(UPLOADS, id); if (existsSync(p)) try { unlinkSync(p); } catch { /* ignore */ }
}
app.post('/api/simchas/:id/invite', async (req) => {
  const u = await member(req); const s = await simchaFor(u, Number((req.params as any).id));
  if (!mayEditSim(u, s)) throw new HttpError(403, 'נאר דער וואס האט עס צוגעלייגט אדער דער אדמין');
  const part = await req.file();
  if (!part) throw bad('קיין פייל');
  const buf = await part.toBuffer();
  const mime = sniff(buf);
  if (!mime) throw bad('נאר א בילד (JPG/PNG) אדער PDF');
  const id = tok(18);
  writeFileSync(path.join(UPLOADS, id), buf, { mode: 0o600 });
  const filename = (part.filename || 'invitation').replace(/[\\/\r\n"]/g, '_').slice(0, 120);
  await q('INSERT INTO files(id,filename,mime,size,uploaded_by) VALUES($1,$2,$3,$4,$5)', [id, filename, mime, buf.length, u.id]);
  await q('UPDATE simchas SET file_id=$1 WHERE id=$2', [id, s.id]);
  if (s.file_id) await removeFile(s.file_id);
  return { file: { id, filename, mime, size: buf.length } };
});
app.delete('/api/simchas/:id/invite', async (req) => {
  const u = await member(req); const s = await simchaFor(u, Number((req.params as any).id));
  if (!mayEditSim(u, s)) throw new HttpError(403, 'נאר דער וואס האט עס צוגעלייגט אדער דער אדמין');
  if (s.file_id) { await q('UPDATE simchas SET file_id=NULL WHERE id=$1', [s.id]); await removeFile(s.file_id); }
  return { ok: true };
});
app.get('/api/files/:id', async (req, reply) => {
  const u = await member(req); const id = String((req.params as any).id);
  const f = await q1(`SELECT f.*, s.audience FROM files f JOIN simchas s ON s.file_id=f.id WHERE f.id=$1`, [id]);
  if (!f || !canSee(u, f.audience)) throw new HttpError(404, 'נישט געטראפן');
  const p = path.join(UPLOADS, f.id); if (!existsSync(p)) throw new HttpError(404, 'נישט געטראפן');
  const dl = (req.query as any).dl === '1';
  reply.header('Content-Type', f.mime).header('Content-Length', statSync(p).size)
    .header('Content-Disposition', `${dl ? 'attachment' : 'inline'}; filename="invitation${extOf(f.mime)}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`)
    .header('Cache-Control', 'private, max-age=3600').header('X-Content-Type-Options', 'nosniff');
  // images get a locked-down CSP; PDFs get none so the browser's own PDF viewer can open them (a sandbox CSP blocks it)
  if (f.mime !== 'application/pdf') reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  else reply.removeHeader('Content-Security-Policy');
  return reply.send(createReadStream(p));
});
const extOf = (m: string) => ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'application/pdf': '.pdf', 'image/heic': '.heic' } as any)[m] || '';

// ---------------- cousins directory ----------------
const dirSelect = `SELECT d.*, ou.name owner_name FROM directory d LEFT JOIN users ou ON ou.id=d.owner_id`;
async function listDir(u: User) {
  const rows=await q(`${dirSelect} WHERE ${sideSql('d.side',1)} ORDER BY d.id`,[mySides(u)]);
  const people=await q(`${personSelect} WHERE ${sideSql('p.side',1)}`,[mySides(u)]);
  const byId=new Map(people.map(p=>[p.id,p]));
  const full=(p:any)=>p ? [p.title,p.name].filter(Boolean).join(' ') : '';
  return rows.map(d=>{
    const h=byId.get(d.husband_person_id), w=byId.get(d.wife_person_id);
    const parentName=(id:number)=>{const p=byId.get(id);return p?[full(p),p.niftar?'ז״ל':''].filter(Boolean).join(' '):'';};
    const parents=(p:any)=>p ? [p.father_id?`טאטע: ${parentName(p.father_id)}`:'',p.mother_id?`מאמע: ${parentName(p.mother_id)}`:''].filter(Boolean).join(' · ') : '';
    return {...d,husband:h?full(h):d.husband,wife:w?full(w):d.wife,
      parents:[h&&parents(h)?`${h.name}: ${parents(h)}`:'',w&&parents(w)?`${w.name}: ${parents(w)}`:''].filter(Boolean).join(' · ') || d.parents};
  });
}
app.get('/api/directory', async (req) => { const u = await member(req); return { families: await listDir(u) }; });
const mayEditDir = (u: User, d: any) => u.is_admin || d.owner_id === u.id || d.created_by === u.id;
async function saveDirectory(u:User,b:any,id?:number) {
  return tx(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(68427301)');
    const old=id?(await c.query('SELECT * FROM directory WHERE id=$1 FOR UPDATE',[id])).rows[0]:null;
    if (id && (!old || !canSee(u,old.side))) throw new HttpError(404,'נישט געטראפן');
    if (old && !mayEditDir(u,old)) throw new HttpError(403,'דו קענסט עדיטן נאר דיין אייגענע משפחה');
    const addressKeys=['address_line1','address_line2','city','state','postal_code','country'];
    const structuredAddress=addressKeys.some(key=>b[key]!==undefined);
    const legacyAddress=b.address!==undefined && !structuredAddress;
    b={...(old||{}),...b};
    const hp=personId(b.husband_person_id),wp=personId(b.wife_person_id),side=okSide(u,b.side);
    if(hp && hp===wp) throw bad('קלייב אויס צוויי באזונדערע מענטשן');
    const linked=new Map<number,any>();
    for(const person of [hp,wp].filter(Boolean)) {
      const p=(await c.query('SELECT * FROM people WHERE id=$1',[person])).rows[0];
      if(!p || !canSee(u,p.side) || (p.side!=='both' && p.side!==side)) throw bad('דער מענטש דארף זיין אויף דער זעלבער סייד');
      linked.set(p.id,p);
    }
    const husband=hp?linked.get(hp).name:str(b.husband,120),wife=wp?linked.get(wp).name:str(b.wife,120);
    if(!husband && !wife) throw bad('שרייב כאטש איין נאמען');
    const parts=addressKeys.map(key=>legacyAddress?null:(structuredAddress?str(b[key],160):(old?.[key]??null)));
    const address=structuredAddress
      ? [parts[0],parts[1],[parts[2],parts[3],parts[4]].filter(Boolean).join(' '),parts[5]].filter(Boolean).join(', ')
      : str(b.address,1000);
    const values=[husband,wife,str(b.parents,1000),side,address,str(b.phone_h,30),str(b.phone_w,30),hp,wp,...parts];
    if(id) return (await c.query(`UPDATE directory SET husband=$1,wife=$2,parents=$3,side=$4,address=$5,phone_h=$6,phone_w=$7,husband_person_id=$8,wife_person_id=$9,address_line1=$10,address_line2=$11,city=$12,state=$13,postal_code=$14,country=$15,updated_at=now() WHERE id=$16 RETURNING *`,[...values,id])).rows[0];
    const mine=!!b.mine && !(await c.query('SELECT 1 FROM directory WHERE owner_id=$1',[u.id])).rows.length;
    return (await c.query(`INSERT INTO directory(husband,wife,parents,side,address,phone_h,phone_w,husband_person_id,wife_person_id,address_line1,address_line2,city,state,postal_code,country,owner_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,[...values,mine?u.id:null,u.id])).rows[0];
  });
}
app.post('/api/directory',async req=>({family:await saveDirectory(await member(req),req.body)}));
app.put('/api/directory/:id',async req=>({family:await saveDirectory(await member(req),req.body,Number((req.params as any).id))}));
app.delete('/api/directory/:id', async (req) => {
  const u = await member(req); const id = Number((req.params as any).id);
  const d = await q1('SELECT * FROM directory WHERE id=$1', [id]);
  if (!d || !canSee(u, d.side)) throw new HttpError(404, 'נישט געטראפן');
  if (!mayEditDir(u, d)) throw new HttpError(403, 'דו קענסט אויסמעקן נאר דיין אייגענע משפחה');
  await q('DELETE FROM directory WHERE id=$1', [id]);
  return { ok: true };
});
app.get('/api/directory.csv', async (req, reply) => {
  const u = await member(req); const s: any = await getSettings();
  const sideName = (x: string) => (x === 'a' ? s.side_a_yi : x === 'b' ? s.side_b_yi : 'ביידע');
  const rows = [['מאן', 'ווייב', 'וועמענס קינד', 'סייד', 'אדרעס', 'טעל מאן', 'טעל ווייב'],
    ...(await listDir(u)).map((d: any) => [d.husband, d.wife, d.parents, sideName(d.side), d.address, d.phone_h, d.phone_w])];
  const cell = (x: string) => { let v = String(x ?? ''); if (/^[=+\-@]/.test(v)) v = "'" + v; return '"' + v.replace(/"/g, '""') + '"'; };
  const csv = '\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="cousins.csv"; filename*=UTF-8''${encodeURIComponent('קאזינס.csv')}`).header('Cache-Control', 'no-store');
  return csv;
});

// ---------------- chat ----------------
const roomsFor = (u: User) => ['all', ...mySides(u)];
app.get('/api/chat/:room', async (req) => {
  const u = await member(req); const room = String((req.params as any).room);
  if (!roomsFor(u).includes(room)) throw new HttpError(403, 'נישט דיין גרופע');
  const after = Number((req.query as any).after) || 0;
  const rows = after
    ? await q(`SELECT m.id,m.body,m.created_at,m.user_id,u.name FROM messages m JOIN users u ON u.id=m.user_id WHERE room=$1 AND m.id>$2 ORDER BY m.id LIMIT 200`, [room, after])
    : (await q(`SELECT m.id,m.body,m.created_at,m.user_id,u.name FROM messages m JOIN users u ON u.id=m.user_id WHERE room=$1 ORDER BY m.id DESC LIMIT 100`, [room])).reverse();
  return { messages: rows };
});
app.post('/api/chat/:room', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
  const u = await member(req); const room = String((req.params as any).room);
  if (!roomsFor(u).includes(room)) throw new HttpError(403, 'נישט דיין גרופע');
  const body = str((req.body as any)?.body, 2000); if (!body) throw bad('שרייב א מעסעדזש');
  return { message: await q1(`INSERT INTO messages(room,user_id,body) VALUES($1,$2,$3) RETURNING id,body,created_at,user_id`, [room, u.id, body]) };
});
app.delete('/api/chat/message/:id', async (req) => {
  const u = await member(req); const id = Number((req.params as any).id);
  const m = await q1('SELECT user_id FROM messages WHERE id=$1', [id]);
  if (!m) throw new HttpError(404, 'נישט געטראפן');
  if (m.user_id !== u.id && !u.is_admin) throw new HttpError(403, 'נאר דיינע');
  await q('DELETE FROM messages WHERE id=$1', [id]);
  return { ok: true };
});
app.get('/api/chat-summary', async (req) => {
  const u = await member(req);
  return { rooms: await q(`SELECT r room, (SELECT max(id) FROM messages WHERE room=r) last_id FROM unnest($1::text[]) r`, [roomsFor(u)]) };
});

// ---------------- home ----------------
app.get('/api/home', async (req) => {
  const u = await member(req);
  const yz = (await listYahrzeits(u)).filter((y) => y.next).slice(0, 3);
  const sims = (await q(`SELECT s.id,s.kind,s.whose,s.gdate,s.time_text,s.hdate_text,s.hall,s.address,s.audience FROM simchas s WHERE ${sideSql('s.audience', 1)} AND s.gdate >= $2 ORDER BY s.gdate LIMIT 4`, [mySides(u), todayYmd()]))
    .map((s) => ({ ...s, hebrew: s.hdate_text || hebrewForYmd(s.gdate), days: daysUntil(s.gdate) }));
  const msgs = await q(`SELECT m.id,m.room,m.body,m.created_at,u.name FROM messages m JOIN users u ON u.id=m.user_id WHERE m.room = ANY($1::text[]) ORDER BY m.id DESC LIMIT 5`, [roomsFor(u)]);
  const lists = await q(`SELECT l.id,l.kind,l.niftar,l.target_date,count(i.taken_by)::int taken,count(i.idx)::int total FROM learn_lists l JOIN learn_items i ON i.list_id=l.id
    WHERE ${sideSql('l.side', 1)} AND (l.target_date IS NULL OR l.target_date >= $2) GROUP BY l.id ORDER BY l.target_date NULLS LAST LIMIT 4`, [mySides(u), todayYmd()]);
  const counts = await q1(`SELECT (SELECT count(*) FROM users WHERE status='active')::int members, (SELECT count(*) FROM users WHERE status='pending')::int pending`);
  return { yahrzeits: yz, simchas: sims, messages: msgs, lists, members: counts.members, pending: u.is_admin ? counts.pending : 0, today: hebrewForYmd(todayYmd()) };
});

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'נישט געטראפן' });
  return reply.sendFile('index.html');
});

startJobs(app.log);
await app.listen({ port: config.port, host: config.host });

