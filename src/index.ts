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
import { pool, q, q1 } from './db.js';
import { MONTH_CODES, MONTH_YI, daysUntil, gem, hebrewForYmd, nextYahrzeit, todayYmd } from './hebrew.js';
import { startJobs } from './jobs.js';
import { MASECHTOS } from './masechtos.js';

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

interface User { id: number; name: string; phone: string; email: string | null; sides: string[]; status: string; is_admin: boolean }
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
  const u = await q1<User>(`SELECT u.id,u.name,u.phone,u.email,u.sides,u.status,u.is_admin FROM sessions s JOIN users u ON u.id=s.user_id
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
const publicUser = (u: any) => ({ id: u.id, name: u.name, phone: u.phone, email: u.email, sides: u.sides, status: u.status, is_admin: u.is_admin });

// ---------------- settings ----------------
const getSettings = () => q1('SELECT family_yi,family_en,side_a_yi,side_a_en,side_a_family_yi,side_a_family_en,side_b_yi,side_b_en,side_b_family_yi,side_b_family_en FROM settings WHERE id=1');
app.get('/api/settings', async () => ({ settings: await getSettings() }));
const BOOTED = new Date().toISOString();
app.get('/api/health', async () => { await q('SELECT 1'); return { ok: true, booted: BOOTED, build: process.env.BUILD_ID || null }; });

// ---------------- auth ----------------
const authLimit = { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } };
app.post('/api/auth/signup', authLimit, async (req, reply) => {
  const b: any = req.body || {};
  const name = str(b.name, 80), phone = normPhone(b.phone), email = str(b.email, 120) || null;
  const sides = Array.isArray(b.sides) ? [...new Set(b.sides.filter((s: any) => s === 'a' || s === 'b'))] as string[] : [];
  if (!name) throw bad('שרייב דיין נאמען');
  if (!phone) throw bad('שרייב א ריכטיגן טעלעפאן נומער');
  if (!sides.length) throw bad('קלייב אויס פון וועלכע סייד דו ביסט');
  const p = pwProblem(b.password); if (p) throw bad(p);
  if (await q1('SELECT 1 FROM users WHERE phone=$1', [phone])) throw new HttpError(409, 'דער טעלעפאן נומער איז שוין רעדזשיסטרירט. לאג אין.');
  const isQa = !!config.qaPhonePrefix && phone.startsWith(config.qaPhonePrefix);
  const u = await q1(`INSERT INTO users(name,phone,email,password_hash,sides,is_qa,note) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [name, phone, email, await hashPw(b.password), sides, isQa, str(b.note, 300)]);
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
  return { user: u ? publicUser(u) : null, settings: await getSettings() };
});
app.get('/api/auth/token/:t', authLimit, async (req) => {
  const r = await q1(`SELECT u.name FROM password_tokens p JOIN users u ON u.id=p.user_id WHERE p.token_hash=$1 AND p.used_at IS NULL AND p.expires_at>now()`, [sha((req.params as any).t)]);
  if (!r) throw new HttpError(404, 'דער לינק איז שוין נישט גוט (אדער שוין גענוצט). בעט דעם אדמין פאר א נייעם.');
  return { name: r.name };
});
app.post('/api/auth/set-password', authLimit, async (req, reply) => {
  const b: any = req.body || {};
  const p = pwProblem(b.password); if (p) throw bad(p);
  const r = await q1(`UPDATE password_tokens SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() RETURNING user_id`, [sha(String(b.token || ''))]);
  if (!r) throw new HttpError(404, 'דער לינק איז שוין נישט גוט (אדער שוין גענוצט). בעט דעם אדמין פאר א נייעם.');
  await q('UPDATE users SET password_hash=$1 WHERE id=$2', [await hashPw(b.password), r.user_id]);
  await q('DELETE FROM sessions WHERE user_id=$1', [r.user_id]);
  await newSession(reply, r.user_id);
  const u = await q1('SELECT * FROM users WHERE id=$1', [r.user_id]);
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
  const u = await q1('UPDATE users SET name=$1,email=$2 WHERE id=$3 RETURNING *', [name, str(b.email, 120) || null, u0.id]);
  return { user: publicUser(u) };
});

// ---------------- admin ----------------
app.get('/api/admin/users', async (req) => {
  await admin(req);
  return { owner_phone: normPhone(config.admin.phone), users: await q(`SELECT id,name,phone,email,sides,status,is_admin,note,created_at,last_seen_at,(password_hash IS NOT NULL) has_password FROM users
    ORDER BY (status='pending') DESC, status, name`) };
});
app.patch('/api/admin/users/:id', async (req) => {
  const me = await admin(req);
  const id = Number((req.params as any).id), b: any = req.body || {};
  const u = await q1('SELECT * FROM users WHERE id=$1', [id]); if (!u) throw new HttpError(404, 'נישט געטראפן');
  const owner = !!config.admin.phone && u.phone === normPhone(config.admin.phone);
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
  if (u && config.admin.phone && u.phone === normPhone(config.admin.phone)) throw new HttpError(403, 'מען קען נישט אויסמעקן דעם הויפט אדמין');
  await q('DELETE FROM users WHERE id=$1', [id]);
  return { ok: true };
});
app.post('/api/admin/users/:id/reset-link', async (req) => {
  await admin(req);
  const id = Number((req.params as any).id);
  if (!(await q1('SELECT 1 FROM users WHERE id=$1', [id]))) throw new HttpError(404, 'נישט געטראפן');
  const t = tok(24);
  await q(`UPDATE password_tokens SET expires_at=now() WHERE user_id=$1 AND used_at IS NULL`, [id]);
  await q(`INSERT INTO password_tokens(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')`, [sha(t), id]);
  return { link: `${config.publicUrl}/#setpw=${t}`, days: 7 };
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
  const rows = await q(`SELECT y.*, (r.user_id IS NOT NULL) remind, cu.name created_by_name FROM yahrzeits y
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
  const old = await q1('SELECT side FROM yahrzeits WHERE id=$1', [id]);
  if (!old || !canSee(u, old.side)) throw new HttpError(404, 'נישט געטראפן');
  const r = await q1(`UPDATE yahrzeits SET name=$1,father_name=$2,relation=$3,side=$4,hday=$5,hmonth=$6,death_year=$7,kever=$8,note=$9 WHERE id=$10 RETURNING *`, [...yzBody(u, req.body), id]);
  return { yahrzeit: yzOut(r) };
});
app.delete('/api/yahrzeits/:id', async (req) => {
  const u = await member(req); const id = Number((req.params as any).id);
  const r = await q1('SELECT created_by FROM yahrzeits WHERE id=$1', [id]);
  if (!r) throw new HttpError(404, 'נישט געטראפן');
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

// ---------------- family tree ----------------
app.get('/api/people', async (req) => {
  const u = await member(req);
  return { people: await q(`SELECT id,side,name,spouse,parent_id,niftar,note,created_by FROM people WHERE side = ANY($1::text[]) ORDER BY id`, [mySides(u)]) };
});
async function personBody(u: User, b: any, selfId?: number) {
  const name = str(b.name, 120); if (!name) throw bad('שרייב א נאמען');
  let side = okSide(u, b.side, ['a', 'b']);
  let parent: number | null = b.parent_id ? Number(b.parent_id) : null;
  if (parent) {
    const p = await q1('SELECT side FROM people WHERE id=$1', [parent]);
    if (!p || !canSee(u, p.side)) throw bad('דער טאטע/מאמע איז נישט געטראפן');
    side = p.side;
    // no cycles
    if (selfId) {
      let cur: number | null = parent;
      for (let i = 0; cur && i < 200; i++) { if (cur === selfId) throw bad('א מענטש קען נישט זיין זיין אייגענער אייניקל'); cur = (await q1('SELECT parent_id FROM people WHERE id=$1', [cur]))?.parent_id ?? null; }
    }
  }
  return [side, name, str(b.spouse, 120), parent, !!b.niftar, str(b.note, 300)];
}
app.post('/api/people', async (req) => {
  const u = await member(req);
  return { person: await q1(`INSERT INTO people(side,name,spouse,parent_id,niftar,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [...(await personBody(u, req.body)), u.id]) };
});
app.put('/api/people/:id', async (req) => {
  const u = await member(req); const id = Number((req.params as any).id);
  const old = await q1('SELECT side FROM people WHERE id=$1', [id]);
  if (!old || !canSee(u, old.side)) throw new HttpError(404, 'נישט געטראפן');
  return { person: await q1(`UPDATE people SET side=$1,name=$2,spouse=$3,parent_id=$4,niftar=$5,note=$6 WHERE id=$7 RETURNING *`, [...(await personBody(u, req.body, id)), id]) };
});
app.delete('/api/people/:id', async (req) => {
  const u = await member(req); const id = Number((req.params as any).id);
  const r = await q1('SELECT created_by,side FROM people WHERE id=$1', [id]);
  if (!r || !canSee(u, r.side)) throw new HttpError(404, 'נישט געטראפן');
  if (await q1('SELECT 1 FROM people WHERE parent_id=$1', [id])) throw bad('מעק קודם אויס די קינדער');
  if (!u.is_admin && r.created_by !== u.id) throw new HttpError(403, 'נאר דער וואס האט עס צוגעלייגט אדער דער אדמין');
  await q('DELETE FROM people WHERE id=$1', [id]);
  return { ok: true };
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
  // Store invitation bytes in PostgreSQL across deployment restarts.
  const filename = (part.filename || 'invitation').replace(/[\\/\r\n"]/g, '_').slice(0, 120);
  await q('INSERT INTO files(id,filename,mime,size,uploaded_by,content) VALUES($1,$2,$3,$4,$5,$6)', [id, filename, mime, buf.length, u.id, buf]);
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
  const p = path.join(UPLOADS, f.id); if (!f.content && !existsSync(p)) throw new HttpError(404, 'נישט געטראפן');
  const dl = (req.query as any).dl === '1';
  reply.header('Content-Type', f.mime).header('Content-Length', f.content ? f.content.length : statSync(p).size)
    .header('Content-Disposition', `${dl ? 'attachment' : 'inline'}; filename="invitation${extOf(f.mime)}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`)
    .header('Cache-Control', 'private, max-age=3600').header('X-Content-Type-Options', 'nosniff');
  // images get a locked-down CSP; PDFs get none so the browser's own PDF viewer can open them (a sandbox CSP blocks it)
  if (f.mime !== 'application/pdf') reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  else reply.removeHeader('Content-Security-Policy');
  return reply.send(f.content ? Buffer.from(f.content) : createReadStream(p));
});
const extOf = (m: string) => ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'application/pdf': '.pdf', 'image/heic': '.heic' } as any)[m] || '';

// ---------------- cousins directory ----------------
const dirSelect = `SELECT d.*, ou.name owner_name FROM directory d LEFT JOIN users ou ON ou.id=d.owner_id`;
async function listDir(u: User) { return q(`${dirSelect} WHERE ${sideSql('d.side', 1)} ORDER BY coalesce(nullif(d.husband,''),d.wife)`, [mySides(u)]); }
app.get('/api/directory', async (req) => { const u = await member(req); return { families: await listDir(u) }; });
function dirBody(u: User, b: any) {
  const husband = str(b.husband, 120), wife = str(b.wife, 120);
  if (!husband && !wife) throw bad('שרייב כאטש איין נאמען');
  return [husband, wife, str(b.parents, 150), okSide(u, b.side), str(b.address, 200), str(b.phone_h, 30), str(b.phone_w, 30)];
}
const mayEditDir = (u: User, d: any) => u.is_admin || d.owner_id === u.id || d.created_by === u.id;
app.post('/api/directory', async (req) => {
  const u = await member(req); const b: any = req.body || {};
  const mine = !!b.mine && !(await q1('SELECT 1 FROM directory WHERE owner_id=$1', [u.id]));
  return { family: await q1(`INSERT INTO directory(husband,wife,parents,side,address,phone_h,phone_w,owner_id,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [...dirBody(u, b), mine ? u.id : null, u.id]) };
});
app.put('/api/directory/:id', async (req) => {
  const u = await member(req); const id = Number((req.params as any).id);
  const d = await q1('SELECT * FROM directory WHERE id=$1', [id]);
  if (!d || !canSee(u, d.side)) throw new HttpError(404, 'נישט געטראפן');
  if (!mayEditDir(u, d)) throw new HttpError(403, 'דו קענסט עדיטן נאר דיין אייגענע משפחה');
  return { family: await q1(`UPDATE directory SET husband=$1,wife=$2,parents=$3,side=$4,address=$5,phone_h=$6,phone_w=$7,updated_at=now() WHERE id=$8 RETURNING *`, [...dirBody(u, req.body), id]) };
});
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
