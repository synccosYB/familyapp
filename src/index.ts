import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, verify } from '@node-rs/argon2';
import { config } from './config.js';
import { nameKey, sameParent } from './person-matches.js';
import { familyContext, familySql, personSql, personGroupsSql } from './family-scope.js';
import { pool, q, q1, tx } from './db.js';
import { MONTH_CODES, MONTH_YI, daysUntil, gem, hebrewForYmd, nextYahrzeit, todayYmd } from './hebrew.js';
import { dailyLearning, reminderClock, remainingLearning } from './learning-reminders.js';
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

class HttpError extends Error { constructor(public status: number, public yi: string, public details?: unknown) { super(yi); } }
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

interface User { id: number; name: string; phone: string; email: string | null; email_verified_at: string | null; learning_email_reminders: boolean; sides: string[]; family_group_id: number | null; family_group_ids: number[]; primary_family_group_id?: number | null; status: string; is_admin: boolean; is_family_admin: boolean }
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
  if (err instanceof HttpError) return reply.code(err.status).send({ error: err.yi, details:err.details });
  if (err.statusCode === 429) return reply.code(429).send({ error: 'צו פיל פרואוון, ווארט א מינוט' });
  if (err.code === '23503') return reply.code(400).send({error:'פארבונדענע רעקארדס מוזן זיין אין דער זעלבער משפחה. קלייב זיי אויס אינאיינעם.'});
  if (err.code === '23514') return reply.code(400).send({error:'די אויסגעקליבענע פרטים זענען נישט ריכטיג'});
  if (err.code === '23505') return reply.code(409).send({error:'דער רעקארד עקזיסטירט שוין'});
  if (err.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: `די פייל איז צו גרויס (מאקסימום ${config.uploadMaxMb} MB)` });
  if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'פעלער: ' + err.message });
  req.log.error(err);
  return reply.code(500).send({ error: 'עפעס איז נישט געגאנגען, פרובירט נאכאמאל' });
});

// CSRF: state-changing API calls must carry our header (a cross-site form cannot set it); cookie is SameSite=Lax too.
app.addHook('onRequest', (_req, _reply, done) => familyContext.run({}, done));
app.addHook('onRequest', async (req,reply) => {
  if(req.url.startsWith('/api/'))reply.header('Cache-Control','private, no-store');
  if (req.url.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-familye'] !== '1')
    throw new HttpError(403, 'פארבאטן');
});

async function loadUser(req: FastifyRequest): Promise<User | null> {
  const t = req.cookies[COOKIE];
  if (!t) return null;
  const u = await q1<User>(`SELECT u.id,u.name,u.phone,u.email,u.email_verified_at,u.learning_email_reminders,u.family_group_id,u.family_group_ids,u.sides,u.status,u.is_admin,u.is_family_admin FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at>now()`, [sha(t)]);
  if(!u)return null;
  u.primary_family_group_id=u.family_group_id;
  const requested=req.headers['x-family-group'] || req.cookies.fam_group;
  if(requested) {
    const selected=Number(requested);
    if(!Number.isSafeInteger(selected)||selected<1 || (!u.is_admin&&!u.family_group_ids.includes(selected))) {
      // Stale cookies are harmless; an explicit unauthorized API header is rejected.
      if(req.headers['x-family-group'])throw new HttpError(403,'די משפחה איז נישט צוגעטיילט צו דיר');
    } else u.family_group_id=selected;
  }
  u.is_family_admin=u.is_family_admin && u.family_group_id===u.primary_family_group_id;
  return u;
}
async function member(req: FastifyRequest): Promise<User> {
  const u = await loadUser(req);
  if (!u) throw new HttpError(401, 'לאג אין');
  if (u.status !== 'active') throw new HttpError(403, 'דיין אקאונט ווארט נאך אויף אפרוביישן');
  req.user = u;
  q('UPDATE users SET last_seen_at=now() WHERE id=$1 AND (last_seen_at IS NULL OR last_seen_at<now()-interval \'5 min\')', [u.id]).catch(() => {});
  return u;
}
async function admin(req: FastifyRequest) { const u = await member(req); if (!managesFamily(u)) throw new HttpError(403, 'נאר פאר אדמין'); return u; }
const managesFamily = (u: User) => u.is_admin || u.is_family_admin;
const seesAll = (u: User) => managesFamily(u) || (u.sides.includes('a') && u.sides.includes('b'));
const mySides = (u: User) => (managesFamily(u) ? ['a', 'b'] : u.sides);
const canSee = (u: User, side: string) => side === 'both' || side === 'all' || mySides(u).includes(side);
// SQL fragment: rows whose side is visible to u (param index n holds mySides)
const sideSql = (col: string, n: number) => `(${familySql(col.includes('.') ? col.split('.')[0] : '')} AND (${col} IN ('both','all') OR ${col} = ANY($${n}::text[])))`;
const yahrzeitSql=(alias='yahrzeits')=>`(${familySql(alias)} OR EXISTS(SELECT 1 FROM people yp WHERE yp.id=${alias}.person_id AND ${personSql('yp')}))`;
const personSideSql=(alias:string,n:number)=>`(${personSql(alias)} AND (${alias}.side IN ('both','all') OR ${alias}.side=ANY($${n}::text[])))`;
function okSide(u: User, side: unknown, allowed = SIDE3): string {
  const s = String(side || '');
  if (!allowed.includes(s)) throw bad('קלייב אויס א סייד');
  if (s === 'all') return s;
  if (s === 'both') return seesAll(u) ? s : u.sides[0];
  if (!mySides(u).includes(s)) throw new HttpError(403, 'דו ביסט נישט אויף יענע סייד');
  return s;
}

// Account/auth and global administration remain available to unassigned members/admins.
// Everything else under /api is family content, including future routes by default.
app.addHook('preHandler', async req => {
  const route = req.routeOptions.url || '';
  if (route.startsWith('/api/admin/')) {
    const manager=await admin(req);
    if(!manager.is_admin) {
      if(!await q1('SELECT 1 FROM family_groups WHERE id=$1 AND NOT is_quarantine AND archived_at IS NULL',[manager.family_group_id])) throw new HttpError(403,'משפחה נישט צוגעטיילט');
      const groupEdit=req.method==='PATCH'&&route==='/api/admin/family-groups/:id';
      if(groupEdit&&Number((req.params as any).id)!==manager.family_group_id)throw new HttpError(404,'נישט געטראפן');
      const permitted=groupEdit||(req.method==='GET' && ['/api/admin/users','/api/admin/family-groups'].includes(route)) ||
        (req.method==='PATCH' && route==='/api/admin/users/:id') ||
        (req.method==='POST' && route==='/api/admin/users/:id/reset-link');
      if(!permitted) throw new HttpError(403,'נאר פאר דעם הויפט אדמין');
      const target=(req.params as any)?.id;
      if(target && !groupEdit && !await q1('SELECT 1 FROM users WHERE id=$1 AND family_group_id=$2 AND NOT is_admin',[target,manager.family_group_id])) throw new HttpError(404,'נישט געטראפן');
    }
    return;
  }
  if (!route.startsWith('/api/') || /^\/api\/(auth(?:\/|$)|admin(?:\/|$)|me(?:\/|$)|settings$|health$)/.test(route)
      || (req.method==='GET' && route==='/api/family-invitations/:token')) return;
  const u = await member(req);
  const group = u.family_group_id;
  if (!group || !Number.isSafeInteger(group) || (!u.is_admin && !u.family_group_ids.includes(group)))
    throw new HttpError(403,'מען דארף דיר צוטיילן צו א משפחה. רעד מיט דעם אדמין.');
  const treeScope=(req.method==='GET'||u.is_admin)&&(route.startsWith('/api/people')||route.startsWith('/api/person-reviews'));
  const scopedGroups=treeScope?[...u.family_group_ids,group]:[group];
  const activeGroups=(await q<{id:number}>('SELECT id FROM family_groups WHERE id=ANY($1::int[]) AND NOT is_quarantine AND archived_at IS NULL',[scopedGroups])).map(g=>g.id);
  if(!activeGroups.includes(group))throw new HttpError(403,'משפחה נישט געטראפן');
  const context=familyContext.getStore()!;
  context.id=group;
  if(treeScope)context.peopleGroups=activeGroups;
  const check = async (table: string, id: unknown) => {
    if (id===null || id===undefined || id==='') return;
    const row=await q1(`SELECT 1 FROM ${table} WHERE id::text=$1 AND ${table==='people'?personSql():table==='yahrzeits'?yahrzeitSql():table==='families'&&route.startsWith('/api/people')?`family_group_id=ANY(${personGroupsSql()})`:familySql()}`,[String(id)]);
    if (!row) throw new HttpError(404,'נישט געטראפן');
  };
  const params=req.params as any;
  const table=route.startsWith('/api/chat/message/')?'messages':({people:'people',yahrzeits:'yahrzeits',lists:'learn_lists',simchas:'simchas',directory:'directory',files:'files','person-reviews':'person_reviews'} as Record<string,string>)[route.split('/')[2]];
  if(table && params?.id) await check(table,params.id);
  const b:any=req.body || {};
  for(const key of ['father_id','mother_id','spouse_id','second_spouse_id','parent_id','person_id','husband_person_id','wife_person_id','existing_person_id']) await check('people',b[key]);
  for(const key of ['yahrzeit_id','legacy_yahrzeit_id']) await check('yahrzeits',b[key]);
  await check('files',b.file_id); await check('messages',b.reply_to);
  if(Array.isArray(b.family_ids)) for(const id of b.family_ids) await check('families',id);
});

async function newSession(reply: FastifyReply, userId: number) {
  const t = tok();
  await q(`INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+($3||' days')::interval)`, [sha(t), userId, String(config.sessionDays)]);
  reply.setCookie(COOKIE, t, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: config.sessionDays * 86400 });
}
const publicUser = (u: any) => ({ id: u.id, name: u.name, phone: u.phone, email: u.email, email_verified: !!u.email_verified_at, learning_email_reminders: !!u.learning_email_reminders, sides: u.sides, family_group_id: u.family_group_id, family_group_ids:u.family_group_ids, primary_family_group_id:u.primary_family_group_id??u.family_group_id, status: u.status, is_admin: u.is_admin, is_family_admin: u.is_family_admin });

// ---------------- settings ----------------
const getSettings = () => q1('SELECT family_yi,family_en,side_a_yi,side_a_en,side_a_family_yi,side_a_family_en,side_b_yi,side_b_en,side_b_family_yi,side_b_family_en FROM settings WHERE id=1');
app.get('/api/settings', async () => ({ settings: await getSettings() }));
const BOOTED = new Date().toISOString();
app.get('/api/health', async () => { await q('SELECT 1'); return { ok: true, booted: BOOTED, build: process.env.BUILD_ID || null }; });

// ---------------- auth ----------------
const authLimit = { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } };
async function findInvitation(token: unknown) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(token)) throw bad('דער אינוויטעישן לינק איז נישט גוט');
  const invitation = await q1(`SELECT i.sides,i.created_by,i.family_group_id FROM family_invitations i JOIN users u ON u.id=i.created_by
    WHERE i.token_hash=$1 AND i.expires_at>now() AND u.status='active'
    AND EXISTS(SELECT 1 FROM family_groups g WHERE g.id=i.family_group_id AND NOT g.is_quarantine AND g.archived_at IS NULL) AND (u.is_admin OR (i.family_group_id=ANY(u.family_group_ids) AND ((u.is_family_admin AND i.family_group_id=u.family_group_id) OR i.sides <@ u.sides)))`, [sha(token)]);
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
  return { sides: invitation.sides, family_name:(await q1('SELECT name FROM family_groups WHERE id=$1',[invitation.family_group_id]))?.name };
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
  const b:any=req.body||{}, name=str(b.name,80),phone=normPhone(b.phone),email=str(b.email,120)||null;
  if(!name)throw bad('שרייב דיין נאמען'); if(!phone)throw bad('שרייב א ריכטיגן טעלעפאן נומער');
  const problem=pwProblem(b.password);if(problem)throw bad(problem);
  const invitation=b.invitation_token?await findInvitation(b.invitation_token):null;
  const newFamily=invitation?'':str(b.create_family,120);
  if(!invitation&&!newFamily)throw new HttpError(403,'נוץ א משפחה אינוויטעישן אדער מאך דיין אייגענע משפחה');
  const password=await hashPw(b.password);
  const u=await tx(async c=>{
    // Revalidate an invite inside the account creation transaction and lock its inviter.
    let group=invitation?.family_group_id, sides=invitation?.sides;
    if(invitation) {
      const creator=(await c.query('SELECT * FROM users WHERE id=$1 FOR SHARE',[invitation.created_by])).rows[0];
      const valid=(await c.query('SELECT 1 FROM family_invitations WHERE token_hash=$1 AND expires_at>now()',[sha(b.invitation_token)])).rows.length;
      if(!valid||creator?.status!=='active'||(!creator.is_admin&&(!creator.family_group_ids.includes(group)||sides.some((side:string)=>!creator.sides.includes(side)&&!(creator.is_family_admin&&creator.family_group_id===group)))))throw new HttpError(403,'דער אינוויטעישן איז שוין נישט גוט');
    } else {
      group=(await c.query('INSERT INTO family_groups(name) VALUES($1) RETURNING id',[newFamily])).rows[0].id;
      sides=['a','b'];
    }
    return (await c.query(`INSERT INTO users(name,phone,email,password_hash,sides,is_qa,note,invited_by,status,approved_at,family_group_id,is_family_admin)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active',now(),$9,$10) RETURNING *`,
      [name,phone,email,password,sides,!!config.qaPhonePrefix&&phone.startsWith(config.qaPhonePrefix),str(b.note,300),invitation?.created_by||null,group,!invitation])).rows[0];
  });
  await newSession(reply,u.id);return {user:publicUser(u)};
});
app.post('/api/auth/login', authLimit, async (req, reply) => {
  const b: any = req.body || {};
  const phone = normPhone(b.phone);
  const u = phone ? await q1('SELECT * FROM users WHERE phone=$1', [phone]) : null;
  const ok = u?.password_hash ? await verify(u.password_hash, String(b.password || '')).catch(() => false) : false;
  if (!u || !ok) throw new HttpError(401, 'טעלעפאן אדער פאסווארט איז נישט ריכטיג');
  if (!u.is_admin && !(await q1('SELECT 1 FROM family_groups WHERE id=$1 AND NOT is_quarantine AND archived_at IS NULL',[u.family_group_id]))) throw new HttpError(403,'דיין אקאונט דארף א משפחה צוטיילונג פונעם אדמין');
  if (u.status === 'rejected') throw new HttpError(403, 'דער אקאונט איז נישט אפרובירט געווארן');
  await newSession(reply, u.id);
  return { user: publicUser(u) };
});
app.post('/api/auth/logout', async (req, reply) => {
  const t = req.cookies[COOKIE];
  if (t) await q('DELETE FROM sessions WHERE token_hash=$1', [sha(t)]);
  reply.clearCookie(COOKIE, { path: '/' }); reply.clearCookie('fam_group',{path:'/'});
  return { ok: true };
});
app.get('/api/me', async (req) => {
  const u = await loadUser(req);
  const groupId=u?.family_group_id;
  const groups=u?await q('SELECT id,name FROM family_groups WHERE NOT is_quarantine AND archived_at IS NULL AND ($1::boolean OR id=ANY($2::int[])) ORDER BY name',[u.is_admin,u.family_group_ids]):[];
  const group=groups.find(g=>g.id===groupId);
  return { user: u ? {...publicUser(u),family_groups:groups,family_name:group?.name || null,selected_family_group_id:group?.id || null} : null, settings: {...await getSettings(),...(group?{family_yi:group.name,side_a_family_yi:'',side_b_family_yi:''}:{})}, email_enabled: emailReady() };
});
app.post('/api/me/family-group',async(req,reply)=>{
  const u=await member(req),group=Number((req.body as any)?.family_group_id);
  if(!Number.isSafeInteger(group)||(!u.is_admin&&!u.family_group_ids.includes(group)))throw new HttpError(403,'די משפחה איז נישט צוגעטיילט צו דיר');
  if(!await q1('SELECT 1 FROM family_groups WHERE id=$1 AND NOT is_quarantine AND archived_at IS NULL',[group]))throw bad('קלייב אויס א משפחה');
  reply.setCookie('fam_group',String(group),{path:'/',httpOnly:true,sameSite:'lax',secure:config.cookieSecure});
  await q('DELETE FROM chat_presence WHERE user_id=$1',[u.id]);
  return {ok:true};
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
app.post('/api/me/learning-reminders', async req => {
  const u = await member(req), on = (req.body as any)?.on;
  if (typeof on !== 'boolean') throw bad('קלייב אויס יא אדער ניין');
  if (on && (!emailReady() || !u.email_verified_at || !normalizeEmail(u.email))) throw bad('באשטעטיג קודם דיין אימעיל אדרעס');
  const updated = await q1('UPDATE users SET learning_email_reminders=$1 WHERE id=$2 RETURNING *',[on,u.id]);
  return {user:publicUser(updated)};
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
  const manager=await admin(req);
  const owner = await q1('SELECT phone FROM users WHERE id=$1', [await ownerId()]);
  return { owner_phone: manager.is_admin ? owner?.phone || '' : '', users: await q(`SELECT id,name,phone,email,sides,family_group_id,family_group_ids,status,is_admin,is_family_admin,note,created_at,last_seen_at,(password_hash IS NOT NULL) has_password,
    (SELECT requested_at FROM password_reset_requests r WHERE r.user_id=users.id AND r.resolved_at IS NULL) reset_requested_at FROM users WHERE ($1::boolean OR (family_group_id=$2 AND NOT is_admin))
    ORDER BY (status='pending') DESC, status, name`,[manager.is_admin,manager.family_group_id]) };
});
app.patch('/api/admin/users/:id', async (req) => {
  const me = await admin(req);
  return tx(async c=>{
  const q=async(sql:string,params:unknown[]=[]) => (await c.query(sql,params)).rows;
  const q1=async(sql:string,params:unknown[]=[]) => (await q(sql,params))[0];
  const id = Number((req.params as any).id), b: any = req.body || {};
  if(b.is_admin!==undefined&&!me.is_admin)throw new HttpError(403,'נאר פאר דעם הויפט אדמין');
  const u = await q1('SELECT * FROM users WHERE id=$1 AND ($2::boolean OR (family_group_id=$3 AND NOT is_admin)) FOR UPDATE', [id,me.is_admin,me.family_group_id]); if (!u) throw new HttpError(404, 'נישט געטראפן');
  if(!me.is_admin && u.family_group_ids.length>1)throw new HttpError(403,'א מעמבער פון מערערע משפחות דארף דער הויפט אדמין באהאנדלען');
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
    if(!me.is_admin)throw new HttpError(403,'נאר פאר דעם הויפט אדמין');
    if (id === me.id && !b.is_admin) throw bad('דו קענסט נישט אוועקנעמען דיין אייגענעם אדמין');
    await q('UPDATE users SET is_admin=$1 WHERE id=$2', [!!b.is_admin, id]);
  }
  if(b.is_family_admin!==undefined) {
    if(id===me.id&&!b.is_family_admin&&!me.is_admin)throw bad('מען קען נישט אוועקנעמען דיין אייגענעם אדמין');
    await q('UPDATE users SET is_family_admin=$1 WHERE id=$2',[!!b.is_family_admin,id]);
  }
  if (b.name !== undefined) { const n = str(b.name, 80); if (n) await q('UPDATE users SET name=$1 WHERE id=$2', [n, id]); }
  return { ok: true };
  });
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
  const me=await admin(req);
  const id = Number((req.params as any).id);
  const t = tok(24);
  await tx(async c => {
    if (!(await c.query('SELECT id FROM users WHERE id=$1 AND ($2::boolean OR (family_group_id=$3 AND NOT is_admin)) FOR UPDATE', [id,me.is_admin,me.family_group_id])).rows.length) throw new HttpError(404, 'נישט געטראפן');
    if(!me.is_admin && (await c.query('SELECT cardinality(family_group_ids) n FROM users WHERE id=$1',[id])).rows[0].n>1)throw new HttpError(403,'פאר דעם מעמבער דארף דער הויפט אדמין מאכן א לינק');
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

// Explicit administrator assignment. Genealogical names never grant access.
const assignmentTables = ['people','yahrzeits','learn_lists','directory','simchas','files','messages','families'] as const;
app.get('/api/admin/family-groups', async req => {
  const manager=await admin(req);
  return {groups:await q('SELECT id,name FROM family_groups WHERE NOT is_quarantine AND archived_at IS NULL AND ($1::boolean OR id=$2) ORDER BY name',[manager.is_admin,manager.family_group_id])};
});
app.patch('/api/admin/family-groups/:id', async req => {
  const manager=await admin(req),id=Number((req.params as any).id),name=str((req.body as any)?.name,120);
  if(!name)throw bad('שרייב א משפחה נאמען');
  const group=await q1('UPDATE family_groups SET name=$1 WHERE id=$2 AND NOT is_quarantine AND archived_at IS NULL AND ($3::boolean OR id=$4) RETURNING id,name',[name,id,manager.is_admin,manager.family_group_id]);
  if(!group)throw new HttpError(404,'נישט געטראפן'); return {group};
});
app.post('/api/admin/select-family-group', async (req,reply) => {
  await admin(req);const group=Number((req.body as any)?.family_group_id);
  if(!Number.isSafeInteger(group)||!await q1('SELECT 1 FROM family_groups WHERE id=$1 AND NOT is_quarantine AND archived_at IS NULL',[group]))throw bad('קלייב אויס א משפחה');
  reply.setCookie('fam_group',String(group),{path:'/',httpOnly:true,sameSite:'lax',secure:config.cookieSecure});
  return {ok:true};
});
app.post('/api/admin/family-groups', async req => {
  await admin(req); const name=str((req.body as any)?.name,120);
  if(!name) throw bad('שרייב א משפחה נאמען');
  return {group:await q1('INSERT INTO family_groups(name) VALUES($1) RETURNING id,name',[name])};
});
app.put('/api/admin/users/:id/family-group', async req => {
  const a=await admin(req),id=Number((req.params as any).id),body:any=req.body||{};
  const raw=body.family_group_ids===undefined?[body.family_group_id]:body.family_group_ids;
  if(!Array.isArray(raw)||raw.length<1||raw.length>4||raw.some((g:any)=>!Number.isSafeInteger(Number(g))||Number(g)<1))throw bad('קלייב אויס איינס ביז פיר משפחות');
  const groups:number[]=raw.map(Number);
  if(new Set(groups).size!==groups.length)throw bad('קלייב יעדע משפחה נאר איינמאל');
  await tx(async c=>{
    const old=(await c.query('SELECT family_group_id,family_group_ids FROM users WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!old)throw new HttpError(404,'נישט געטראפן');
    const valid=(await c.query('SELECT id FROM family_groups WHERE id=ANY($1::int[]) AND NOT is_quarantine AND archived_at IS NULL FOR KEY SHARE',[groups])).rows;
    if(valid.length!==groups.length)throw bad('קלייב אויס עקזיסטירנדיקע משפחות');
    const primary=groups.includes(old.family_group_id)?old.family_group_id:groups[0];
    await c.query('UPDATE users SET family_group_id=$1,family_group_ids=$2,is_family_admin=CASE WHEN family_group_id=$1 THEN is_family_admin ELSE false END WHERE id=$3',[primary,groups,id]);
    if(JSON.stringify([...old.family_group_ids].sort())!==JSON.stringify([...groups].sort())) {
      await c.query('UPDATE password_tokens SET expires_at=now() WHERE user_id=$1 AND used_at IS NULL',[id]);
      await c.query('DELETE FROM sessions WHERE user_id=$1',[id]);
      await c.query('DELETE FROM chat_presence WHERE user_id=$1',[id]);
    }
    await c.query('INSERT INTO family_assignment_audit(admin_id,family_group_id,assignments) VALUES($1,$2,$3)',[a.id,primary,JSON.stringify({user_id:id,previous_groups:old.family_group_ids,groups})]);
  });
  return {ok:true};
});
// Legacy content remains hidden until an administrator reviews its explicit assignment.
app.get('/api/admin/unassigned-records', async req => {
  await admin(req); const records: Record<string,unknown[]>={};
  for(const table of assignmentTables) {
    const label=({people:'name',yahrzeits:'name',learn_lists:'niftar',directory:"concat_ws(' ',husband,wife)",simchas:'whose',files:'filename',messages:'left(body,100)',families:'name'} as const)[table];
    records[table]=await q(`SELECT id,${label} label FROM ${table} WHERE family_group_id IS NULL ORDER BY id LIMIT 500`);
  }
  // Recovery needs the original graph, not a list of ambiguous names. This route
  // is global-admin-only in preHandler; never expose unassigned data to members.
  const people=await q(`SELECT p.id,p.father_id,p.mother_id,p.parent_id,p.spouse_id,p.second_spouse_id,
    fa.name father_name,mo.name mother_name,pa.name parent_name,sp.name spouse_name,ss.name second_spouse_name,
    coalesce((SELECT json_agg(json_build_object('id',f.id,'name',f.name)) FROM person_families pf JOIN families f ON f.id=pf.family_id WHERE pf.person_id=p.id),'[]') families
    FROM people p LEFT JOIN people fa ON fa.id=p.father_id LEFT JOIN people mo ON mo.id=p.mother_id
    LEFT JOIN people pa ON pa.id=p.parent_id LEFT JOIN people sp ON sp.id=p.spouse_id LEFT JOIN people ss ON ss.id=p.second_spouse_id
    WHERE p.family_group_id IS NULL ORDER BY p.id LIMIT 500`);
  const details=new Map(people.map(p=>[p.id,p]));
  records.people=records.people.map((r:any)=>({...r,...details.get(r.id)}));
  return {records};
});
app.post('/api/admin/assign-records', async req => {
  const a=await admin(req),b:any=req.body||{},group=Number(b.family_group_id);
  if(!Number.isSafeInteger(group)||!await q1('SELECT 1 FROM family_groups WHERE id=$1 AND NOT is_quarantine AND archived_at IS NULL',[group]))throw bad('קלייב אויס א משפחה');
  if(!b.records || typeof b.records!=='object' || Object.keys(b.records).some(t=>!assignmentTables.includes(t as any)))throw bad('קלייב אויס רעקארדס');
  await tx(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(68427301)');
    for(const table of assignmentTables) {
      const ids=b.records[table]||[];
      if(!Array.isArray(ids)||ids.length>500||ids.some((id:any)=>!['string','number'].includes(typeof id)))throw bad('קלייב אויס רעקארדס');
      const unique=[...new Set(ids.map(String))];
      const result=await c.query(`UPDATE ${table} SET family_group_id=$1 WHERE id::text=ANY($2::text[]) AND family_group_id IS NULL RETURNING id`,[group,unique]);
      if(result.rows.length!==unique.length)throw new HttpError(409,'א רעקארד איז שוין צוגעטיילט. ריפרעש און פרוביר נאכאמאל.');
    }
    // Check labels affected by this assignment, including labels attached to other people.
    if((await c.query(`SELECT 1 FROM person_families pf JOIN people p ON p.id=pf.person_id JOIN families f ON f.id=pf.family_id
      WHERE (p.id::text=ANY($1::text[]) OR f.id::text=ANY($2::text[])) AND p.family_group_id IS NOT NULL
        AND (f.family_group_id IS NULL OR (p.family_group_id IS DISTINCT FROM f.family_group_id AND NOT EXISTS(SELECT 1 FROM person_family_access a WHERE a.person_id=p.id AND a.family_group_id=f.family_group_id))) LIMIT 1`,[b.records.people||[],b.records.families||[]])).rows.length)
      throw bad('קלייב אויך אויס די פארבונדענע משפחה נעמען פאר דער זעלבער משפחה');
    await c.query('INSERT INTO family_assignment_audit(admin_id,family_group_id,assignments) VALUES($1,$2,$3)',[a.id,group,JSON.stringify(b.records)]);
  });
  return {ok:true};
});

// Preview and commit the same explicit mapping; never infer access from a surname.
async function recoveryPlan(c:any, mapping:any) {
  const labels=(await c.query('SELECT id,name,family_group_id FROM families WHERE family_group_id IS NULL ORDER BY id')).rows;
  const people=(await c.query(`SELECT p.id,p.name,p.father_id,p.mother_id,p.parent_id,p.spouse_id,p.second_spouse_id,
    coalesce((SELECT array_agg(family_id) FROM person_families WHERE person_id=p.id),'{}') label_ids FROM people p WHERE family_group_id IS NULL ORDER BY id`)).rows;
  if(!people.length)throw bad('נישטא קיין אלטע מענטשן צוריקצושטעלן');
  if(!mapping || typeof mapping!=='object' || Array.isArray(mapping) || Object.keys(mapping).length!==labels.length)throw bad('טייל צו יעדן אלטן משפחה נאמען');
  const groups=(await c.query('SELECT id,name FROM family_groups WHERE NOT is_quarantine AND archived_at IS NULL')).rows;
  for(const label of labels)if(!groups.some((g:any)=>g.id===Number(mapping[label.id])))throw bad('קלייב אויס א משפחה פאר יעדן נאמען');
  const assignments=new Map<number,number[]>();
  for(const p of people)assignments.set(p.id,[...new Set<number>(p.label_ids.map((id:number)=>Number(mapping[id])))].filter(Boolean).sort((a,b)=>a-b));
  // Only unlabelled children inherit the common access of known parents.
  let changed=true;
  while(changed) {
    changed=false;
    for(const p of people)if(!assignments.get(p.id)!.length) {
      const parents=[p.father_id,p.mother_id,p.parent_id].filter(Boolean);
      if(!parents.length || parents.some(id=>!assignments.get(id)?.length))continue;
      const common=assignments.get(parents[0])!.filter(g=>parents.every(id=>assignments.get(id)!.includes(g)));
      if(common.length){assignments.set(p.id,common);changed=true;}
    }
  }
  const rows=people.map((p:any)=>({...p,group_ids:assignments.get(p.id),inherited:!p.label_ids.length}));
  const unknown=rows.filter((p:any)=>!p.group_ids.length);
  for(const p of rows)for(const id of [p.father_id,p.mother_id,p.parent_id,p.spouse_id,p.second_spouse_id].filter(Boolean)) {
    const other=assignments.get(id);
    if(other?.length && p.group_ids.length && !p.group_ids.some((g:number)=>other.includes(g)))throw bad('פארבונדענע מענטשן דארפן האבן כאטש איין געמיינזאמע משפחה; דער הויפט אדמין דארף איבערקוקן די צוטיילונג');
  }
  return {people:rows,groups,labels,unknown,token:sha(JSON.stringify({rows,mapping,labels}))};
}
app.post('/api/admin/recover-tree/preview',async req=>{await admin(req);return tx(c=>recoveryPlan(c,(req.body as any)?.label_groups));});
app.post('/api/admin/recover-tree',async req=>{
  const a=await admin(req),b:any=req.body||{};
  return tx(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(68427301)');
    const plan=await recoveryPlan(c,b.label_groups);
    if(plan.token!==b.token)throw new HttpError(409,'די רעקארדס האבן זיך געטוישט. קוק איבער נאכאמאל.');
    if(plan.unknown.length)throw bad('עטליכע מענטשן האבן נאך נישט קיין זיכערע משפחה צוטיילונג');
    for(const p of plan.people) {
      for(const g of p.group_ids)await c.query('INSERT INTO person_family_access(person_id,family_group_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[p.id,g]);
      await c.query('UPDATE people SET family_group_id=$1 WHERE id=$2 AND family_group_id IS NULL',[p.group_ids[0],p.id]);
    }
    for(const f of plan.labels)await c.query('UPDATE families SET family_group_id=$1 WHERE id=$2 AND family_group_id IS NULL',[Number(b.label_groups[f.id]),f.id]);
    const yz=await c.query(`UPDATE yahrzeits y SET family_group_id=p.family_group_id FROM people p WHERE y.person_id=p.id AND y.family_group_id IS NULL AND p.id=ANY($1::int[]) RETURNING y.id`,[plan.people.map((p:any)=>p.id)]);
    await c.query(`UPDATE yahrzeits y SET family_group_id=c.family_group_id FROM yahrzeits c WHERE y.canonical_id=c.id AND y.family_group_id IS NULL AND c.id=ANY($1::int[])`,[yz.rows.map(r=>r.id)]);
    await c.query(`UPDATE learn_lists l SET family_group_id=y.family_group_id FROM yahrzeits y WHERE l.yahrzeit_id=y.id AND l.family_group_id IS NULL AND y.id=ANY($1::int[])`,[yz.rows.map(r=>r.id)]);
    await c.query('INSERT INTO family_assignment_audit(admin_id,family_group_id,assignments) VALUES($1,$2,$3)',[a.id,plan.people[0].group_ids[0],JSON.stringify({kind:'canonical_tree_recovery',people:plan.people,label_groups:b.label_groups})]);
    return {ok:true,people:plan.people.length,yahrzeits:yz.rows.length};
  });
});

// ---------------- yahrzeits ----------------
const personFamilyLabelsSql = (personId: string, groups: string) => `coalesce((
  SELECT json_agg(json_build_object('id',f.id,'name',f.name) ORDER BY f.name)
  FROM person_families pf JOIN families f ON f.id=pf.family_id
  JOIN family_groups g ON g.id=f.family_group_id AND NOT g.is_quarantine AND g.archived_at IS NULL
  WHERE pf.person_id=${personId} AND f.family_group_id=ANY(${groups})
),'[]')`;
function yzOut(r: any) {
  const n = nextYahrzeit(r.hday, r.hmonth, r.death_year);
  return { ...r, hebrew: `${gem(r.hday)} ${MONTH_YI[r.hmonth] || r.hmonth}`, next: n };
}
async function listYahrzeits(u: User) {
  const labelGroups=[...u.family_group_ids,u.family_group_id];
  const rows = await q(`SELECT y.*,CASE WHEN p.id IS NULL THEN y.father_name ELSE coalesce((SELECT concat_ws(' ',nullif(p.lineage_term,''),nullif(fp.title,''),fp.name) FROM people fp WHERE fp.id=p.father_id AND ${personSql('fp')}),'') END father_name,coalesce(p.side,y.side) side,CASE WHEN p.id IS NULL THEN y.name ELSE concat_ws(' ',nullif(p.title,''),p.name) END name,coalesce(p.kever,y.kever) kever,p.kever_address,coalesce(p.death_hday,y.hday) hday,coalesce(p.death_hmonth,y.hmonth) hmonth,coalesce(p.death_year,y.death_year) death_year,
    ${personFamilyLabelsSql('y.person_id','$3::int[]')} families, (r.user_id IS NOT NULL) remind, cu.name created_by_name FROM yahrzeits y LEFT JOIN people p ON p.id=y.person_id
    LEFT JOIN yahrzeit_reminders r ON r.yahrzeit_id=y.id AND r.user_id=$1 LEFT JOIN users cu ON nullif(current_setting('familye.family_group_id',true),'')::int=ANY(cu.family_group_ids) AND cu.id=y.created_by
    WHERE y.archived_at IS NULL AND ${yahrzeitSql('y')} AND (y.side IN ('both','all') OR y.side=ANY($2::text[]))`, [u.id, mySides(u), labelGroups]);
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
app.post('/api/yahrzeits',async req=>{
  const u=await member(req),b:any=req.body||{};
  yzBody(u,b);
  const person=await savePerson(u,{name:b.name,side:b.side,life_status:'deceased',death_hday:b.hday,death_hmonth:b.hmonth,death_year:b.death_year,kever:b.kever,kever_address:b.kever_address,note:b.note,family_ids:b.family_ids||[]},b.person_id?Number(b.person_id):undefined);
  if(person.pending_review)return {pending_review:person.pending_review};
  const y=await q1('SELECT * FROM yahrzeits WHERE person_id=$1',[person.id]);
  if(!y) throw bad('לייג צו א טאג און חודש אין דעם מענטשס פראפיל');
  return {yahrzeit:yzOut(y)};
});
app.put('/api/yahrzeits/:id',async()=>{throw bad('עדיט דעם זעלבן מענטשס פראפיל; פארבינד קודם אן אלטן יארצייט צום מענטש');});
app.delete('/api/yahrzeits/:id', async (req) => {
  const u = await member(req); const id = Number((req.params as any).id);
  const r = await q1('SELECT created_by,person_id FROM yahrzeits WHERE id=$1', [id]);
  if (!r) throw new HttpError(404, 'נישט געטראפן');
  if (r.person_id) throw bad('עדיט דעם פטירה דאטום אין פעמילי טרי');
  if (!managesFamily(u) && r.created_by !== u.id) throw new HttpError(403, 'נאר דער וואס האט עס צוגעלייגט אדער דער אדמין');
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
const personSelect = () => `SELECT p.*,
  f.id father_id,m.id mother_id,sp.id spouse_id,sp2.id second_spouse_id,pa.id parent_id,
  CASE WHEN p.spouse_id IS NOT NULL AND sp.id IS NULL THEN '' ELSE p.spouse END spouse,
  ${personFamilyLabelsSql('p.id',personGroupsSql())} families,
  f.name father_name,f.title father_title,m.name mother_name,m.title mother_title,
  sp.name spouse_name,sp.title spouse_title,sp2.name second_spouse_name,sp2.title second_spouse_title
  FROM people p LEFT JOIN people f ON f.id=p.father_id AND ${personSql('f')}
  LEFT JOIN people m ON m.id=p.mother_id AND ${personSql('m')}
  LEFT JOIN people sp ON sp.id=p.spouse_id AND ${personSql('sp')}
  LEFT JOIN people sp2 ON sp2.id=p.second_spouse_id AND ${personSql('sp2')}
  LEFT JOIN people pa ON pa.id=p.parent_id AND ${personSql('pa')}`;
app.get('/api/people', async (req) => {
  const u = await member(req);
  return { people: await q(`${personSelect()} WHERE ${personSideSql('p',1)} ORDER BY p.id`, [mySides(u)]) };
});
const personId = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v); if (!Number.isSafeInteger(n) || n < 1) throw bad('קלייב אויס א מענטש'); return n;
};
async function savePerson(u: User, b: any, id?: number, reviewId?: number) {
  return tx(async c => {
    // Serialize graph changes so two simultaneous saves cannot introduce ancestry cycles.
    await c.query("SELECT pg_advisory_xact_lock(68427301)");
    let review:any;
    if(reviewId) {
      if(!managesFamily(u))throw new HttpError(403,'נאר פאר אדמין');
      review=(await c.query(`SELECT * FROM person_reviews WHERE id=$1 AND ${familySql()} FOR UPDATE`,[reviewId])).rows[0];
      if(!review || review.status!=='pending')throw new HttpError(409,'די בקשה איז שוין באהאנדלט');
      b=review.payload;id=review.person_id||undefined;
    }
    const original=structuredClone(b), key=reviewId?'':str(b.request_key,80);
    if(key&&!/^[a-zA-Z0-9_-]{16,80}$/.test(key))throw bad('דער סעיוו קוד איז נישט ריכטיג');
    const fingerprint=sha(JSON.stringify({id:id||null,body:b}));
    if(key){const saved=(await c.query(`SELECT * FROM person_save_requests WHERE user_id=$1 AND request_key=$2 AND ${familySql()}`,[u.id,key])).rows[0];
      if(saved){
        if(saved.fingerprint!==fingerprint)throw new HttpError(409,'די פרטים האבן זיך געטוישט. פרוביר נאכאמאל.');
        if(!saved.response?.id)return saved.response;
        const person=(await c.query(`${personSelect()} WHERE p.id=$1 AND ${personSideSql('p',2)}`,[saved.response.id,mySides(u)])).rows[0];
        if(!person)throw new HttpError(404,'נישט געטראפן');
        return person;
      }}
    const finish=async(response:any)=>{
      if(key)await c.query('INSERT INTO person_save_requests(user_id,request_key,fingerprint,response) VALUES($1,$2,$3,$4)',[u.id,key,fingerprint,JSON.stringify(response)]);
      return response;
    };
    const old = id ? (await c.query('SELECT * FROM people WHERE id=$1 FOR UPDATE',[id])).rows[0] : null;
    if(review?.person_id && sha(JSON.stringify(old))!==review.previous_hash)throw new HttpError(409,'דער מענטש איז געענדערט זינט דער בקשה. עדיט דעם יעצטיגן רעקארד.');
    if (id && (!old || !canSee(u,old.side) || !(await c.query(`SELECT 1 FROM people WHERE id=$1 AND ${personSql()}`,[id])).rows.length)) throw new HttpError(404,'נישט געטראפן');
    if(old && !u.is_admin && (await c.query('SELECT 1 FROM person_family_access WHERE person_id=$1 AND family_group_id<>$2',[id,old.family_group_id])).rows.length)throw new HttpError(403,'א געמיינזאמער מענטש דארף ווערן געענדערט דורך דעם הויפט אדמין');
    const legacy=b.legacy_yahrzeit_id ? (await c.query('SELECT * FROM yahrzeits WHERE id=$1 FOR UPDATE',[Number(b.legacy_yahrzeit_id)])).rows[0] : null;
    if(b.legacy_yahrzeit_id && (!legacy || legacy.archived_at || (legacy.person_id && legacy.person_id!==id) || !canSee(u,legacy.side) || legacy.family_group_id!==familyContext.getStore()?.id)) throw bad('דער אלטער יארצייט איז נישט פאר דעם מענטש');
    if(legacy&&!managesFamily(u)&&legacy.created_by!==u.id)throw new HttpError(403,'נאר דער באשעפער אדער אדמין קען פארבינדן דעם אלטן רעקארד');
    if(old)for(const key of ['father_id','mother_id','parent_id','spouse_id','second_spouse_id']) {
      if(old[key] && !(await c.query(`SELECT 1 FROM people WHERE id=$1 AND ${personSql()}`,[old[key]])).rows.length && b[key]!==undefined && String(b[key]||'')!==String(old[key]))throw new HttpError(403,'די פארבינדונג דארף ווערן געענדערט דורך דעם הויפט אדמין');
    }
    b = {...(old || {}),...b};
    const name = str(b.name,120); if (!name) throw bad('שרייב א נאמען');
    const side = okSide(u,b.side);
    const context=familyContext.getStore()!;
    const viewedGroup=context.id!;
    const previousFamilies=id?(await c.query(`SELECT pf.family_id FROM person_families pf JOIN families f ON f.id=pf.family_id WHERE pf.person_id=$1 AND f.family_group_id=ANY(${personGroupsSql()})`,[id])).rows.map(r=>r.family_id):[];
    const requestedFamilies=b.family_ids===undefined?previousFamilies:b.family_ids;
    if(!Array.isArray(requestedFamilies) || requestedFamilies.some((v:any)=>!Number.isSafeInteger(Number(v))||Number(v)<1)) throw bad('קלייב אויס ריכטיגע משפחות');
    const familyIds=[...new Set<number>(requestedFamilies.map(Number))];
    const checkedFamilies=familyIds.length?(await c.query(`SELECT f.family_group_id FROM families f JOIN family_groups g ON g.id=f.family_group_id AND NOT g.is_quarantine AND g.archived_at IS NULL
      WHERE f.id=ANY($1::int[]) AND f.family_group_id=ANY(${personGroupsSql()})`,[familyIds])).rows:[];
    if(checkedFamilies.length!==familyIds.length)throw bad('א משפחה איז נישט געפונען');

    const checkedGroups=[...new Set<number>(checkedFamilies.map(f=>f.family_group_id))];
    const assignAccess=u.is_admin && original.family_ids!==undefined && checkedGroups.length>0;
    let owner:number=old?.family_group_id ?? viewedGroup;
    if(assignAccess && !checkedGroups.includes(owner) && (!old || (context.peopleGroups || [viewedGroup]).includes(owner))) {
      owner=checkedGroups.includes(viewedGroup)?viewedGroup:Math.min(...checkedGroups);
    }
    const accessGroups=new Set([owner]);
    if(assignAccess)for(const group of checkedGroups)accessGroups.add(group);
    if(old) {
      // Retain access assigned independently of the editable labels, including inherited legacy access.
      const retained=(await c.query(`SELECT a.family_group_id FROM person_family_access a WHERE a.person_id=$1 AND (
          NOT $2::boolean OR
          a.family_group_id<>ALL(${personGroupsSql()}) OR NOT EXISTS (
            SELECT 1 FROM person_families pf JOIN families f ON f.id=pf.family_id
            WHERE pf.person_id=a.person_id AND f.family_group_id=a.family_group_id))`,[id,assignAccess])).rows;
      for(const grant of retained)accessGroups.add(grant.family_group_id);
    }
    const visible=(await c.query(`${personSelect()} WHERE ${personSideSql('p',1)}`,[mySides(u)])).rows;
    const matches=(value:string,exclude?:number)=>visible.filter(p=>p.id!==exclude&&nameKey(p.name)===nameKey(value));
    const identityChanged=!old || ['name','father_id','mother_id','parent_id'].some(k=>String(b[k]||'')!==String(old[k]||''));
    const proposal={...original,name,father_id:b.father_id,mother_id:b.mother_id,parent_id:b.parent_id,spouse_id:b.spouse_id};
    const candidates=identityChanged?matches(name,id):[];
    let confirmationId:number|undefined;
    if(candidates.length&&!reviewId) {
      const reason=str(b.distinct_reason,500);
      if(b.confirm_distinct!==true || reason.length<5)throw new HttpError(409,'דער נאמען עקזיסטירט שוין. קלייב דעם מענטש, אדער באשטעטיג אז דאס איז א צווייטער מענטש און ערקלער פארוואס.',{code:'person_matches',field:'person',matches:candidates.map(p=>({id:p.id,name:p.name,father_name:p.father_name,mother_name:p.mother_name,spouse_name:p.spouse_name}))});
      if(!key)throw bad('די באשטעטיגונג דארף א סעיוו קוד');
      if(candidates.some(p=>sameParent(p,b))) {
        const pending=(await c.query(`INSERT INTO person_reviews(created_by,person_id,payload,previous_hash,reason,family_group_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[u.id,id||null,JSON.stringify(proposal),old?sha(JSON.stringify(old)):null,reason,owner])).rows[0];
        return finish({pending_review:pending.id,...(owner!==viewedGroup?{review_family_group_id:owner}:{})});
      }
      // Keep the explicit same-name exception for later audit; no automatic merge.
      confirmationId=(await c.query(`INSERT INTO person_reviews(created_by,person_id,payload,previous_hash,reason,status,reviewed_by,reviewed_at,family_group_id) VALUES($1,$2,$3,$4,$5,'confirmed',$1,now(),$6) RETURNING id`,[u.id,id||null,JSON.stringify(proposal),old?sha(JSON.stringify(old)):null,reason,owner])).rows[0].id;
    }
    const relativeGroup=accessGroups.has(viewedGroup)?viewedGroup:owner;
    // Inline relatives and their links commit together, so a failed form leaves no orphan people.
    for (const key of ['father_id','mother_id','spouse_id','second_spouse_id']) {
      const draft = b.new_relatives?.[key];
      if (!draft) continue;
      if (b[key]) throw bad('קלייב אן עקזיסטירנדיקן מענטש אדער לייג צו א נייעם');
      const relativeName = str(draft.name,120);
      if (!relativeName) throw bad('שרייב דעם נאמען פונעם נייעם מענטש');
      const existing=matches(relativeName);
      if(existing.length)throw new HttpError(409,'דער קרוב עקזיסטירט אפשר שוין. קלייב אים פון דער ליסטע. אויב דאס איז א צווייטער מענטש, לייג אים צו באזונדער מיט אן ערקלערונג.',{code:'person_matches',field:key,matches:existing.map(p=>({id:p.id,name:p.name,father_name:p.father_name,mother_name:p.mother_name,spouse_name:p.spouse_name}))});
      const relative = (await c.query(`INSERT INTO people(name,title,side,life_status,lineage_term,created_by,family_group_id)
        VALUES($1,$2,$3,'unknown',$4,$5,$6) RETURNING *`, [relativeName,str(draft.title,80),side,key==='father_id'?'בן':key==='mother_id'?'בת':'',u.id,relativeGroup])).rows[0];
      visible.push(relative);b[key] = relative.id;
    }
    const father = personId(b.father_id), mother = personId(b.mother_id), spouse = personId(b.spouse_id), secondSpouse = personId(b.second_spouse_id);
    const partners=[spouse,secondSpouse].filter((v):v is number=>v!==null);
    if(new Set(partners).size!==partners.length || partners.some(v=>v===id || [father,mother,personId(b.parent_id)].includes(v)))throw bad('די זיווג לינקס זענען נישט ריכטיג');
    const legacyParent = b.parent_id !== undefined ? personId(b.parent_id) : old?.parent_id || null;
    if ((father && father===mother) || (spouse && [father,mother,legacyParent].includes(spouse)) || [father,mother,spouse,legacyParent].some(v=>v && v===id)) throw bad('די משפחה לינקס זענען נישט ריכטיג');
    const status = b.life_status ?? (b.niftar ? 'deceased' : old?.life_status || 'unknown');
    if (!['unknown','living','deceased'].includes(status)) throw bad('קלייב אויס א סטאטוס');
    const day = b.death_hday === '' || b.death_hday == null ? null : Number(b.death_hday);
    const month = str(b.death_hmonth,20) || null;
    if(legacy && (status!=='deceased'||!day||!month))throw bad('צו פארבינדן דעם יארצייט דארף דער מענטש האבן א פטירה טאג און חודש');
    const year = b.death_year === '' || b.death_year == null ? null : Number(b.death_year);
    if ((day !== null && (!Number.isInteger(day)||day<1||day>30)) || (month && !(MONTH_CODES as readonly string[]).includes(month)) || (year!==null && (!Number.isInteger(year)||year<=5000||year>=6000))) throw bad('דער אידישער דאטום איז נישט ריכטיג');
    if (status!=='deceased' && (day||month||year)) throw bad('א פטירה דאטום איז נאר פאר א נפטר');
    const refs = [...new Set([father,mother,...partners,legacyParent].filter(Boolean))];
    for (const ref of refs) {
      const r=(await c.query('SELECT * FROM people WHERE id=$1',[ref])).rows[0];
      // A linked person must be visible to every viewer of this person, not just the editor.
      if (!r || !canSee(u,r.side) || !(await c.query(`SELECT 1 FROM people WHERE id=$1 AND ${personSql()}`,[ref])).rows.length || (r.side!=='both' && r.side!==side)) throw bad('דער פארבינדונג דארף זיין אויף דער זעלבער סייד');
      if (partners.includes(Number(ref)) && r.side!==side) throw bad('מאן און ווייב לינקס דארפן זיין אויף דער זעלבער סייד');
      if (partners.includes(Number(ref)) && ![r.spouse_id,r.second_spouse_id].includes(id) && r.spouse_id && r.second_spouse_id) throw bad('ביי דעם מענטש זענען שוין ביידע זיווגים אויסגעפילט');
    }
    if (id) {
      const cycle=(await c.query(`WITH RECURSIVE ancestors(id) AS (
        SELECT unnest($1::int[]) UNION
        SELECT x.parent FROM ancestors a JOIN people p ON p.id=a.id
        CROSS JOIN LATERAL unnest(ARRAY[p.father_id,p.mother_id,p.parent_id]) x(parent) WHERE x.parent IS NOT NULL
      ) SELECT 1 FROM ancestors WHERE id=$2`,[[father,mother,legacyParent].filter(Boolean),id])).rows.length;
      if (cycle) throw bad('א מענטש קען נישט זיין זיין אייגענער אייניקל');
      // Do not move a referenced person behind a narrower visibility boundary.
      const incoming=(await c.query(`SELECT side FROM people WHERE father_id=$1 OR mother_id=$1 OR spouse_id=$1 OR second_spouse_id=$1 OR parent_id=$1
        UNION SELECT side FROM directory WHERE husband_person_id=$1 OR wife_person_id=$1`,[id])).rows;
      if (incoming.some(r=>side!=='both' && r.side!==side)) throw bad('די סייד דארף שטימען מיט די פארבינדונגען');
    }
    const lineage=str(b.lineage_term,4);
    if (!['','בן','בת'].includes(lineage)) throw bad('קלייב אויס בן אדער בת');
    const newFamily=str(b.new_family,80);
    if(newFamily) {
      const family=(await c.query(`INSERT INTO families(name,created_by,family_group_id) VALUES($1,$2,$3) ON CONFLICT(family_group_id,lower(name)) DO UPDATE SET name=families.name RETURNING id`,[newFamily,u.id,relativeGroup])).rows[0];
      if(!familyIds.includes(family.id)) familyIds.push(family.id);
    }
    const vals=[side,name,str(b.spouse ?? old?.spouse,120),legacyParent,status==='deceased',str(b.note,300),str(b.title,80),father,mother,spouse,status,day,month,year,lineage];
    for(const previous of [old?.spouse_id,old?.second_spouse_id].filter(Boolean)) if(!partners.includes(previous)) {
      await c.query('UPDATE people SET spouse_id=CASE WHEN spouse_id=$1 THEN NULL ELSE spouse_id END, second_spouse_id=CASE WHEN second_spouse_id=$1 THEN NULL ELSE second_spouse_id END WHERE id=$2',[id,previous]);
    }
    const row=id ? (await c.query(`UPDATE people SET side=$1,name=$2,spouse=$3,parent_id=$4,niftar=$5,note=$6,title=$7,father_id=$8,mother_id=$9,spouse_id=$10,life_status=$11,death_hday=$12,death_hmonth=$13,death_year=$14,lineage_term=$15,second_spouse_id=$17,family_group_id=$18 WHERE id=$16 RETURNING *`,[...vals,id,secondSpouse,owner])).rows[0]
      : (await c.query(`INSERT INTO people(side,name,spouse,parent_id,niftar,note,title,father_id,mother_id,spouse_id,life_status,death_hday,death_hmonth,death_year,lineage_term,created_by,family_group_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,[...vals,u.id,owner])).rows[0];
    if(assignAccess) {
      const groups=[...accessGroups];
      if(old) {
        await c.query('DELETE FROM person_family_access WHERE person_id=$1 AND family_group_id<>ALL($2::int[])',[row.id,groups]);
        // Move the person's memorial only when its current family loses access to the person.
        await c.query(`WITH moved AS (SELECT id,family_group_id FROM yahrzeits WHERE person_id=$1 AND family_group_id<>ALL($2::int[]))
          UPDATE yahrzeits y SET family_group_id=$3 FROM moved m
          WHERE y.id=m.id OR (y.canonical_id=m.id AND y.family_group_id=m.family_group_id)`,[row.id,groups,owner]);
      }
      await c.query(`INSERT INTO person_family_access(person_id,family_group_id)
        SELECT $1,g FROM unnest($2::int[]) g WHERE g<>$3 ON CONFLICT DO NOTHING`,[row.id,groups,owner]);
    }
    row.kever=str(b.kever ?? old?.kever,200);
    row.kever_address=str(b.kever_address ?? old?.kever_address,500);
    await c.query('UPDATE people SET kever=$1,kever_address=$3 WHERE id=$2',[row.kever,row.id,row.kever_address]);
    await c.query('UPDATE people SET second_spouse_id=$1 WHERE id=$2',[secondSpouse,row.id]);row.second_spouse_id=secondSpouse;
    for(const partner of partners) {
      const other=(await c.query('SELECT spouse_id,second_spouse_id FROM people WHERE id=$1',[partner])).rows[0];
      if(![other.spouse_id,other.second_spouse_id].includes(row.id)) {
        const slot=other.spouse_id?'second_spouse_id':'spouse_id';
        await c.query(`UPDATE people SET ${slot}=$1 WHERE id=$2`,[row.id,partner]);
      }
    }
    await c.query(`DELETE FROM person_families pf USING families f WHERE pf.family_id=f.id AND pf.person_id=$1 AND f.family_group_id=ANY(${personGroupsSql()})`,[row.id]);
    if(familyIds.length) await c.query('INSERT INTO person_families(person_id,family_id) SELECT $1,unnest($2::int[])',[row.id,familyIds]);
    if(father) await c.query("UPDATE people SET lineage_term='בן' WHERE id=$1 AND lineage_term=''",[father]);
    if(mother) await c.query("UPDATE people SET lineage_term='בת' WHERE id=$1 AND lineage_term=''",[mother]);
    // A complete known date makes one shared yahrzeit; unknown dates remain unknown.
    // Inherit the canonical person's owner, not the editor's currently selected family.
    if (status==='deceased' && day && month) {
      await c.query(`INSERT INTO yahrzeits(name,side,hday,hmonth,death_year,person_id,created_by,kever,family_group_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(person_id) DO UPDATE SET name=excluded.name,side=excluded.side,hday=excluded.hday,hmonth=excluded.hmonth,death_year=excluded.death_year,kever=excluded.kever`,[[row.title,row.name].filter(Boolean).join(' '),side,day,month,year,row.id,u.id,row.kever,row.family_group_id]);
    } else await c.query('DELETE FROM yahrzeits WHERE person_id=$1',[row.id]);
    if(legacy) {
      const canonical=(await c.query('SELECT id FROM yahrzeits WHERE person_id=$1',[row.id])).rows[0];
      if(canonical && canonical.id!==legacy.id) {
        await c.query('UPDATE learn_lists SET yahrzeit_id=$1 WHERE yahrzeit_id=$2',[canonical.id,legacy.id]);
        await c.query('INSERT INTO yahrzeit_reminders(user_id,yahrzeit_id) SELECT user_id,$1 FROM yahrzeit_reminders WHERE yahrzeit_id=$2 ON CONFLICT DO NOTHING',[canonical.id,legacy.id]);
        await c.query("UPDATE yahrzeits SET relation=CASE WHEN relation='' THEN $1 ELSE relation END,note=CASE WHEN note='' THEN $2 ELSE note END WHERE id=$3",[legacy.relation,legacy.note,canonical.id]);
        await c.query('UPDATE yahrzeits SET canonical_id=$1,archived_at=now() WHERE id=$2',[canonical.id,legacy.id]);
      }
    }
    // Keep a linked yahrzeit name in sync when its person's father is renamed too.
    await c.query(`UPDATE yahrzeits y SET father_name=coalesce((SELECT concat_ws(' ',nullif(p.lineage_term,''),nullif(f.title,''),f.name) FROM people f WHERE f.id=p.father_id),'') FROM people p WHERE y.person_id=p.id AND (p.id=ANY($1::int[]) OR p.father_id=$2)`,[[row.id,father,mother].filter(Boolean),row.id]);
    if(confirmationId)await c.query('UPDATE person_reviews SET result_id=$1 WHERE id=$2',[row.id,confirmationId]);
    if(reviewId) {
      await c.query("UPDATE person_reviews SET status='approved',result_id=$1,reviewed_by=$2,reviewed_at=now() WHERE id=$3",[row.id,u.id,reviewId]);
      await c.query(`UPDATE person_save_requests SET response=$1 WHERE user_id=$2 AND response->>'pending_review'=$3`,[JSON.stringify(row),review.created_by,String(reviewId)]);
    }
    return finish((await c.query(`${personSelect()} WHERE p.id=$1`,[row.id])).rows[0]);
  });
}
const personResponse=(person:any)=>person.pending_review?person:{person};
app.post('/api/people', async req => personResponse(await savePerson(await member(req),req.body)));
app.put('/api/people/:id', async req => personResponse(await savePerson(await member(req),req.body,Number((req.params as any).id))));
app.delete('/api/people/:id', async req => {
  const u=await member(req), id=Number((req.params as any).id);
  return tx(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(68427301)');
    const r=(await c.query('SELECT * FROM people WHERE id=$1',[id])).rows[0];
    if (!r || !canSee(u,r.side) || r.family_group_id!==familyContext.getStore()?.id) throw new HttpError(404,'נישט געטראפן');
    if (!managesFamily(u) && r.created_by!==u.id) throw new HttpError(403,'נאר דער וואס האט עס צוגעלייגט אדער דער אדמין');
    const linked=(await c.query(`SELECT 1 FROM people WHERE parent_id=$1 OR father_id=$1 OR mother_id=$1 OR spouse_id=$1 OR second_spouse_id=$1
      UNION SELECT 1 FROM directory WHERE husband_person_id=$1 OR wife_person_id=$1`,[id])).rows.length;
    if (linked) throw bad('דער מענטש איז פארבונדן מיט משפחה. נעם קודם אוועק די לינקס.');
    await c.query('DELETE FROM people WHERE id=$1',[id]); return {ok:true};
  });
});

app.get('/api/person-reviews',async req=>{
  const u=await member(req);
  const reviews=await q(`SELECT id,person_id,payload,reason,status,result_id,created_at FROM person_reviews WHERE ${familySql()} AND ($1::boolean OR created_by=$2) ORDER BY (status='pending') DESC,id DESC LIMIT 200`,[managesFamily(u),u.id]);
  const people=await q(`${personSelect()} WHERE ${personSideSql('p',1)}`,[mySides(u)]);
  return {reviews:reviews.map(r=>({...r,proposal:{father:people.find(p=>p.id===Number(r.payload.father_id))?.name||r.payload.new_relatives?.father_id?.name||'',mother:people.find(p=>p.id===Number(r.payload.mother_id))?.name||r.payload.new_relatives?.mother_id?.name||'',spouse:people.find(p=>p.id===Number(r.payload.spouse_id))?.name||r.payload.new_relatives?.spouse_id?.name||''},matches:people.filter(p=>p.id!==r.person_id&&nameKey(p.name)===nameKey(r.payload.name)).map(p=>({id:p.id,name:p.name,father_name:p.father_name,mother_name:p.mother_name,spouse_name:p.spouse_name}))}))};
});
app.post('/api/person-reviews/:id/resolve',async req=>{
  const u=await member(req),id=Number((req.params as any).id),b:any=req.body||{};
  if(!managesFamily(u))throw new HttpError(403,'נאר פאר אדמין');
  if(b.action==='approve')return personResponse(await savePerson(u,{},undefined,id));
  if(!['existing','reject'].includes(b.action))throw bad('קלייב אויס אן אקציע');
  return tx(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(68427301)');
    const review=(await c.query(`SELECT * FROM person_reviews WHERE id=$1 AND ${familySql()} FOR UPDATE`,[id])).rows[0];
    if(!review||review.status!=='pending')throw new HttpError(409,'די בקשה איז שוין באהאנדלט');
    let person:any=null;
    if(b.action==='existing') {
      person=(await c.query(`${personSelect()} WHERE p.id=$1 AND ${personSql('p')}`,[personId(b.existing_person_id)])).rows[0];
      if(!person)throw new HttpError(404,'נישט געטראפן');
    }
    await c.query('UPDATE person_reviews SET status=$1,result_id=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$4',[b.action==='existing'?'existing':'rejected',person?.id||null,u.id,id]);
    return {ok:true,person};
  });
});

// ---------------- mishnayos & tehillim ----------------
// Linked list titles are projections of the canonical person, not independently edited copies.
const learningTitleSql = (param: number) => `coalesce(
  (SELECT concat_ws(' ',nullif(p.title,''),p.name,CASE WHEN f.id IS NOT NULL THEN concat_ws(' ',nullif(p.lineage_term,''),nullif(f.title,''),f.name) END)
    FROM yahrzeits y JOIN people p ON p.id=y.person_id LEFT JOIN people f ON f.id=p.father_id AND ${personSideSql('f',param)}
    WHERE y.id=l.yahrzeit_id AND ${personSideSql('p',param)}),
  (SELECT concat_ws(' ',y.name,nullif(y.father_name,'')) FROM yahrzeits y WHERE y.id=l.yahrzeit_id AND y.person_id IS NULL AND ${sideSql('y.side',param)}),l.niftar)`;
app.get('/api/lists', async (req) => {
  const u = await member(req);
  const rows = await q(`SELECT l.*, ${learningTitleSql(1)} niftar, (SELECT coalesce(json_agg(json_build_object('id',fam.id,'name',fam.name)),'[]') FROM families fam JOIN person_families pf ON pf.family_id=fam.id JOIN yahrzeits y ON y.person_id=pf.person_id WHERE y.id=l.yahrzeit_id AND fam.family_group_id=l.family_group_id) families, cu.name created_by_name, count(i.idx)::int total, count(*) FILTER (WHERE i.taken_by IS NOT NULL OR (EXISTS(SELECT 1 FROM learn_portions p WHERE p.list_id=l.id AND p.idx=i.idx) AND NOT EXISTS(SELECT 1 FROM learn_portions p WHERE p.list_id=l.id AND p.idx=i.idx AND p.taken_by IS NULL)))::int taken,
      count(*) FILTER (WHERE i.done)::int done,
      count(*) FILTER (WHERE EXISTS(SELECT 1 FROM learn_portions p WHERE p.list_id=l.id AND p.idx=i.idx AND p.taken_by IS NOT NULL) AND EXISTS(SELECT 1 FROM learn_portions p WHERE p.list_id=l.id AND p.idx=i.idx AND p.taken_by IS NULL))::int partial,
      count(*) FILTER (WHERE i.taken_by=$2 OR EXISTS(SELECT 1 FROM learn_portions p WHERE p.list_id=l.id AND p.idx=i.idx AND p.taken_by=$2))::int mine
    FROM learn_lists l LEFT JOIN learn_items i ON i.list_id=l.id LEFT JOIN users cu ON nullif(current_setting('familye.family_group_id',true),'')::int=ANY(cu.family_group_ids) AND cu.id=l.created_by
    WHERE ${sideSql('l.side', 1)} GROUP BY l.id, cu.name ORDER BY (l.target_date IS NULL OR l.target_date < CURRENT_DATE), l.target_date, l.id DESC`, [mySides(u), u.id]);
  return { lists: rows.map((r) => ({ ...r, days: r.target_date ? daysUntil(r.target_date) : null })), masechtos: MASECHTOS };
});
async function visibleList(u: User, id: number) {
  const l = await q1(`SELECT l.*,${learningTitleSql(2)} niftar FROM learn_lists l WHERE l.id=$1 AND ${familySql('l')}`, [id,mySides(u)]);
  if (!l || !canSee(u, l.side)) throw new HttpError(404, 'נישט געטראפן');
  return l;
}
app.get('/api/lists/:id', async (req) => {
  const u = await member(req); const l = await visibleList(u, Number((req.params as any).id));
  const items = await q(`SELECT i.idx,i.taken_by,i.done,tu.name taken_name FROM learn_items i LEFT JOIN users tu ON nullif(current_setting('familye.family_group_id',true),'')::int=ANY(tu.family_group_ids) AND tu.id=i.taken_by WHERE list_id=$1 ORDER BY idx`, [l.id]);
  const counts = await q(`SELECT idx,count(*)::int total,count(taken_by)::int taken,count(*) FILTER(WHERE done)::int done FROM learn_portions WHERE list_id=$1 GROUP BY idx`,[l.id]);
  const help = await q(`SELECT h.*,u.name requested_name,v.name helper_name FROM learn_help_requests h LEFT JOIN users u ON u.id=h.requested_by AND nullif(current_setting('familye.family_group_id',true),'')::int=ANY(u.family_group_ids) LEFT JOIN users v ON nullif(current_setting('familye.family_group_id',true),'')::int=ANY(v.family_group_ids) AND v.id=h.helper_id WHERE h.list_id=$1 AND h.resolved_at IS NULL ORDER BY h.created_at`,[l.id]);
  const clock = reminderClock(), units = await remainingLearning(async (sql,params)=>({rows:await q(sql,params)}),l.id,u.id,l.kind);
  return { daily_plan:dailyLearning(l.kind,units,l.target_date,clock.date), remaining_units:units.length, plan_date:clock.date, reminder_hour:config.learningReminderHour, reminder_timezone:config.timezone, list: { ...l, days: l.target_date ? daysUntil(l.target_date) : null }, items: items.map(i=>({...i,parts:counts.find(c=>c.idx===i.idx)||null})), help, masechtos: MASECHTOS };
});
app.post('/api/lists', async (req) => {
  const u = await member(req); const b: any = req.body || {};
  const kind = b.kind === 'mishnayos' ? 'mishnayos' : b.kind === 'tehillim' ? 'tehillim' : '';
  if (!kind) throw bad('קלייב אויס תהילים אדער משניות');
  let niftar = str(b.niftar, 150), side = b.side, yid: number | null = b.yahrzeit_id ? Number(b.yahrzeit_id) : null, target = str(b.target_date, 10) || null;
  if (yid) {
    const y = (await listYahrzeits(u)).find(y=>y.id===yid);
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
  if (!managesFamily(u) && l.created_by !== u.id) throw new HttpError(403, 'נאר דער וואס האט עס געמאכט אדער דער אדמין');
  await q('DELETE FROM learn_lists WHERE id=$1', [l.id]);
  return { ok: true };
});
function learningScope(kind: string, idx: number, body: any) {
  const chapter=Number(body?.chapter ?? 0), mishnah=Number(body?.mishnah ?? 0);
  if (![idx,chapter,mishnah].every(Number.isSafeInteger) || chapter<0 || mishnah<0 || (mishnah && !chapter)) throw bad('קלייב אויס א ריכטיגן חלק');
  if (kind==='tehillim') { if(idx<1||idx>150||chapter||mishnah) throw bad('קלייב אויס א קאפיטל'); }
  else {
    const chapters=MASECHTOS[idx]?.chapters;
    if(!chapters || chapter>chapters.length || (mishnah && mishnah>chapters[chapter-1])) throw bad('קלייב אויס א ריכטיגן פרק אדער משנה');
  }
  return {chapter,mishnah};
}
app.get('/api/lists/:id/items/:idx/parts',async req=>{
  const u=await member(req), l=await visibleList(u,Number((req.params as any).id)),idx=Number((req.params as any).idx);
  learningScope(l.kind,idx,{});
  if(l.kind!=='mishnayos') throw bad('נאר פאר משניות');
  const root=await q1(`SELECT i.*,u.name taken_name FROM learn_items i LEFT JOIN users u ON u.id=i.taken_by AND nullif(current_setting('familye.family_group_id',true),'')::int=ANY(u.family_group_ids) WHERE list_id=$1 AND idx=$2`,[l.id,idx]);
  if(!root) throw new HttpError(404,'נישט געטראפן');
  const saved=await q(`SELECT p.*,u.name taken_name FROM learn_portions p LEFT JOIN users u ON u.id=p.taken_by AND nullif(current_setting('familye.family_group_id',true),'')::int=ANY(u.family_group_ids) WHERE list_id=$1 AND idx=$2 ORDER BY chapter,mishnah`,[l.id,idx]);
  const items=saved.length?saved:MASECHTOS[idx].chapters.flatMap((count,c)=>Array.from({length:count},(_,m)=>({chapter:c+1,mishnah:m+1,taken_by:root.taken_by,taken_name:root.taken_name,done:root.done})));
  return {items};
});
app.post('/api/lists/:id/items/:idx', async req => {
  const u=await member(req),l=await visibleList(u,Number((req.params as any).id)),idx=Number((req.params as any).idx),body:any=req.body||{};
  const {chapter,mishnah}=learningScope(l.kind,idx,body),act=body.action;
  if(!['take','give','done','undone'].includes(act)) throw bad('קלייב אויס אן אקציע');
  return tx(async c=>{
    // Every claim, including a whole masechta, shares this lock. Overlapping scopes cannot race.
    const root=(await c.query('SELECT * FROM learn_items WHERE list_id=$1 AND idx=$2 FOR UPDATE',[l.id,idx])).rows[0];
    if(!root) throw new HttpError(404,'נישט געטראפן');
    let rows;
    if(l.kind==='mishnayos') {
      const count=(await c.query('SELECT 1 FROM learn_portions WHERE list_id=$1 AND idx=$2 LIMIT 1',[l.id,idx])).rows.length;
      if(!count) {
        const parts=MASECHTOS[idx].chapters.flatMap((n,c)=>Array.from({length:n},(_,m)=>({chapter:c+1,mishnah:m+1})));
        await c.query(`INSERT INTO learn_portions(list_id,idx,chapter,mishnah,taken_by,taken_at,done)
          SELECT $1,$2,p.chapter,p.mishnah,$4,$5,$6 FROM jsonb_to_recordset($3::jsonb) p(chapter int,mishnah int)`,[l.id,idx,JSON.stringify(parts),root.taken_by,root.taken_at,root.done]);
      }
      rows=(await c.query('SELECT taken_by,done FROM learn_portions WHERE list_id=$1 AND idx=$2 AND ($3::int=0 OR chapter=$3) AND ($4::int=0 OR mishnah=$4)',[l.id,idx,chapter,mishnah])).rows;
    } else rows=[root];
    if(act==='take' && rows.some(r=>r.taken_by && r.taken_by!==u.id)) throw new HttpError(409,'א חלק איז שוין גענומען. עפן די פרקים און קלייב א פרייען חלק.');
    if(act!=='take' && rows.some(r=>r.taken_by!==u.id) && !(act==='give'&&managesFamily(u))) throw new HttpError(403,'דו קענסט נאר טוישן דיין אייגענעם חלק');
    const table=l.kind==='mishnayos'?'learn_portions':'learn_items';
    const condition=l.kind==='mishnayos'?' AND ($3::int=0 OR chapter=$3) AND ($4::int=0 OR mishnah=$4)':'';
    const params:any[]=l.kind==='mishnayos'?[l.id,idx,chapter,mishnah]:[l.id,idx];
    let update=act==='give'?'taken_by=NULL,taken_at=NULL,done=false':act==='done'?'done=true':act==='undone'?'done=false':`taken_by=$${params.length+1},taken_at=now(),done=false`;
    if(act==='take')params.push(u.id);
    await c.query(`UPDATE ${table} SET ${update} WHERE list_id=$1 AND idx=$2${condition}${act==='take'?' AND taken_by IS NULL':''}`,params);
    if(l.kind==='mishnayos') await c.query(`UPDATE learn_items SET taken_by=s.owner,done=s.done,taken_at=CASE WHEN s.owner IS NULL THEN NULL ELSE coalesce(taken_at,now()) END FROM
      (SELECT CASE WHEN count(taken_by)=count(*) AND count(DISTINCT taken_by)=1 THEN min(taken_by) ELSE NULL END owner,bool_and(done) done FROM learn_portions WHERE list_id=$1 AND idx=$2) s
      WHERE list_id=$1 AND idx=$2`,[l.id,idx]);
    return {ok:true};
  });
});
app.post('/api/lists/:id/items/:idx/help',async req=>{
  const u=await member(req),l=await visibleList(u,Number((req.params as any).id)),idx=Number((req.params as any).idx),b:any=req.body||{};
  const {chapter,mishnah}=learningScope(l.kind,idx,b);
  const h=await q1(`INSERT INTO learn_help_requests(list_id,idx,chapter,mishnah,requested_by,note) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(list_id,idx,chapter,mishnah,requested_by) WHERE resolved_at IS NULL DO UPDATE SET note=excluded.note RETURNING id`,[l.id,idx,chapter,mishnah,u.id,str(b.note,500)]);
  return {request:h};
});
app.post('/api/lists/:id/help/:helpId',async req=>{
  const u=await member(req),l=await visibleList(u,Number((req.params as any).id)),id=Number((req.params as any).helpId),act=(req.body as any)?.action;
  const h=await q1('SELECT * FROM learn_help_requests WHERE id=$1 AND list_id=$2 AND resolved_at IS NULL',[id,l.id]);
  if(!h) throw new HttpError(404,'נישט געטראפן');
  if(act==='help') {
    if(h.requested_by===u.id) throw bad('דאס איז דיין אייגענע בקשה');
    const r=await q1('UPDATE learn_help_requests SET helper_id=$1 WHERE id=$2 AND resolved_at IS NULL AND (helper_id IS NULL OR helper_id=$1) RETURNING id',[u.id,id]);
    if(!r)throw new HttpError(409,'איינער האט שוין אנגענומען צו העלפן');
  } else if(act==='resolve') {
    if(h.requested_by!==u.id&&!managesFamily(u)) throw new HttpError(403,'נאר דער בעטער אדער אדמין');
    await q('UPDATE learn_help_requests SET resolved_at=now() WHERE id=$1',[id]);
  } else throw bad('קלייב אויס אן אקציע');
  return {ok:true};
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
  const requestedId = (req.query as any).id;
  const id = requestedId === undefined ? null : Number(requestedId);
  if (id !== null && (!Number.isSafeInteger(id) || id < 1)) throw bad('אינוויטעישן נישט גילטיג');
  const rows = await q(`SELECT s.*, f.filename file_name, f.mime file_mime, cu.name created_by_name,
      coalesce(sum(r.people) FILTER (WHERE r.answer='yes'),0)::int yes_people, count(*) FILTER (WHERE r.answer='yes')::int yes_count,
      count(*) FILTER (WHERE r.answer='no')::int no_count,
      max(r.answer) FILTER (WHERE r.user_id=$2) my_answer, max(r.people) FILTER (WHERE r.user_id=$2) my_people,
      coalesce(json_agg(json_build_object('name',ru.name,'answer',r.answer,'people',r.people) ORDER BY ru.name) FILTER (WHERE r.user_id IS NOT NULL),'[]') rsvps
    FROM simchas s LEFT JOIN files f ON f.id=s.file_id LEFT JOIN users cu ON nullif(current_setting('familye.family_group_id',true),'')::int=ANY(cu.family_group_ids) AND cu.id=s.created_by
    LEFT JOIN rsvps r ON r.simcha_id=s.id LEFT JOIN users ru ON nullif(current_setting('familye.family_group_id',true),'')::int=ANY(ru.family_group_ids) AND ru.id=r.user_id
    WHERE ${sideSql('s.audience', 1)} AND ($4::int IS NULL AND ${past ? 's.gdate < $3' : 's.gdate >= $3'} OR s.id=$4)
    GROUP BY s.id, f.filename, f.mime, cu.name ORDER BY s.gdate ${past ? 'DESC' : 'ASC'}, s.id LIMIT 200`, [mySides(u), u.id, todayYmd(), id]);
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
const mayEditSim = (u: User, s: any) => managesFamily(u) || s.created_by === u.id;
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
  const filename = (part.filename || 'invitation').replace(/[\\/\r\n"]/g, '_').slice(0, 120);
  await q('INSERT INTO files(id,filename,mime,size,uploaded_by,content) VALUES($1,$2,$3,$4,$5,$6)', [id, filename, mime, buf.length, u.id,buf]);
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
  const f = await q1('SELECT * FROM files WHERE id=$1',[id]);
  if(!f)throw new HttpError(404,'נישט געטראפן');
  if(f.chat_room) {
    try {await chatRoom(u,f.chat_room);}catch {throw new HttpError(404,'נישט געטראפן');}
    if(f.uploaded_by!==u.id&&!await q1('SELECT 1 FROM messages WHERE file_id=$1',[id]))throw new HttpError(404,'נישט געטראפן');
  } else {
    const sim=await q1('SELECT audience FROM simchas WHERE file_id=$1',[id]);
    if(!sim||!canSee(u,sim.audience))throw new HttpError(404,'נישט געטראפן');
  }
  const p = path.join(UPLOADS, f.id); if (!f.content && !existsSync(p)) throw new HttpError(404, 'נישט געטראפן');
  const dl = (req.query as any).dl === '1' || f.mime === 'application/octet-stream';
  reply.header('Content-Type', f.mime).header('Content-Length', f.content ? f.content.length : statSync(p).size)
    .header('Content-Disposition', `${dl ? 'attachment' : 'inline'}; filename="invitation${extOf(f.mime)}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`)
    .header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff');
  // images get a locked-down CSP; PDFs get none so the browser's own PDF viewer can open them (a sandbox CSP blocks it)
  if (f.mime !== 'application/pdf') reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  else reply.removeHeader('Content-Security-Policy');
  return reply.send(f.content || createReadStream(p));
});
const extOf = (m: string) => ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'application/pdf': '.pdf', 'image/heic': '.heic' } as any)[m] || '';

// ---------------- cousins directory ----------------
const dirSelect = `SELECT d.*, ou.name owner_name FROM directory d LEFT JOIN users ou ON nullif(current_setting('familye.family_group_id',true),'')::int=ANY(ou.family_group_ids) AND ou.id=d.owner_id`;
async function listDir(u: User) {
  const rows=await q(`${dirSelect} WHERE ${sideSql('d.side',1)} ORDER BY d.id`,[mySides(u)]);
  const people=await q(`${personSelect()} WHERE ${personSideSql('p',1)}`,[mySides(u)]);
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
// Household links must use people accessible in this selected family, not the wider tree workspace.
app.get('/api/directory-people', async req => {
  const u = await member(req);
  return { people: await q(`${personSelect()} WHERE ${personSideSql('p',1)} ORDER BY p.id`, [mySides(u)]) };
});
app.get('/api/directory', async (req) => { const u = await member(req); return { families: await listDir(u) }; });
const mayEditDir = (u: User, d: any) => managesFamily(u) || d.owner_id === u.id || d.created_by === u.id;
async function saveDirectory(u:User,b:any,id?:number) {
  return tx(async c=>{
    await c.query('SELECT pg_advisory_xact_lock(68427301)');
    const old=id?(await c.query('SELECT * FROM directory WHERE id=$1 FOR UPDATE',[id])).rows[0]:null;
    if (id && (!old || !canSee(u,old.side) || old.family_group_id!==familyContext.getStore()?.id)) throw new HttpError(404,'נישט געטראפן');
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
      if(!p || !canSee(u,p.side) || !(await c.query(`SELECT 1 FROM people WHERE id=$1 AND ${personSql()}`,[person])).rows.length || (p.side!=='both' && p.side!==side)) throw bad('דער מענטש דארף זיין אויף דער זעלבער סייד');
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
async function chatPeers(u: User) {
  return q(`SELECT id,name FROM users WHERE ${familyContext.getStore()!.id}=ANY(family_group_ids) AND status='active' AND (id=$1 OR is_admin OR sides && $2::text[]) ORDER BY name`,[u.id,mySides(u)]);
}
async function chatRoom(u: User, room: string) {
  if(roomsFor(u).includes(room)) return;
  const match=/^dm:([1-9][0-9]*):([1-9][0-9]*)$/.exec(room);
  if(!match) throw new HttpError(403,'נישט דיין גרופע');
  const ids=[Number(match[1]),Number(match[2])];
  if(!ids.every(Number.isSafeInteger)||ids[0]>=ids[1]||!ids.includes(u.id)) throw new HttpError(403,'נישט דיין פריוואטע שמועס');
  if(!(await chatPeers(u)).some(p=>p.id===ids.find(id=>id!==u.id))) throw new HttpError(403,'נישט דיין פריוואטע שמועס');
}
async function membersOfRoom(u: User,room: string) {
  await chatRoom(u,room);
  const dm=room.startsWith('dm:')?room.slice(3).split(':').map(Number):null;
  return q(`SELECT u.id,u.name,p.seen_at>now()-interval '75 seconds' online,p.active_at>now()-interval '45 seconds' active
    FROM users u LEFT JOIN chat_presence p ON p.user_id=u.id AND p.room=$3 AND p.family_group_id=nullif(current_setting('familye.family_group_id',true),'')::int
    WHERE ${familyContext.getStore()!.id}=ANY(u.family_group_ids) AND u.status='active' AND ($1::int[] IS NULL OR u.id=ANY($1))
      AND ($2::text='all' OR $1::int[] IS NOT NULL OR u.is_admin OR $2=ANY(u.sides)) ORDER BY u.name`,[dm,room,room]);
}
app.get('/api/chat-members',async req=>({members:await chatPeers(await member(req))}));
const messageSelect=`SELECT m.id,m.body,m.created_at,m.user_id,m.reply_to,u.name,f.filename,f.mime,f.size,m.file_id,
  r.body reply_body,ru.name reply_name,
  coalesce((SELECT json_agg(json_build_object('id',mu.id,'name',mu.name)) FROM message_mentions mm JOIN users mu ON nullif(current_setting('familye.family_group_id',true),'')::int=ANY(mu.family_group_ids) AND mu.id=mm.user_id WHERE mm.message_id=m.id),'[]') mentions
  FROM messages m LEFT JOIN users u ON u.id=m.user_id AND m.family_group_id=ANY(u.family_group_ids) LEFT JOIN files f ON f.id=m.file_id
  LEFT JOIN messages r ON r.id=m.reply_to AND r.room=m.room LEFT JOIN users ru ON nullif(current_setting('familye.family_group_id',true),'')::int=ANY(ru.family_group_ids) AND ru.id=r.user_id`;
app.get('/api/chat/:room',async req=>{
  const u=await member(req),room=String((req.params as any).room);await chatRoom(u,room);
  const after=Number((req.query as any).after)||0;
  const rows=after?await q(`${messageSelect} WHERE ${familySql('m')} AND m.room=$1 AND m.id>$2 ORDER BY m.id LIMIT 200`,[room,after])
    :(await q(`${messageSelect} WHERE ${familySql('m')} AND m.room=$1 ORDER BY m.id DESC LIMIT 100`,[room])).reverse();
  return {messages:rows,members:await membersOfRoom(u,room)};
});
app.post('/api/chat/:room/presence',async req=>{
  const u=await member(req),room=String((req.params as any).room);await chatRoom(u,room);
  await q(`INSERT INTO chat_presence(user_id,room,active_at) VALUES($1,$2,CASE WHEN $3 THEN now() ELSE '-infinity'::timestamptz END)
    ON CONFLICT(user_id) DO UPDATE SET family_group_id=excluded.family_group_id,room=$2,seen_at=now(),active_at=CASE WHEN $3 THEN now() WHEN chat_presence.room=$2 THEN chat_presence.active_at ELSE '-infinity'::timestamptz END`,[u.id,room,!!(req.body as any)?.active]);
  return {ok:true};
});
app.post('/api/chat/:room/attachment',async req=>{
  const u=await member(req),room=String((req.params as any).room);await chatRoom(u,room);
  const part=await req.file();if(!part)throw bad('קלייב אויס א פייל');
  const buf=await part.toBuffer();if(!buf.length)throw bad('די פייל איז ליידיג');
  const mime=sniff(buf)||'application/octet-stream',id=tok(18),filename=(part.filename||'attachment').replace(/[\\/\r\n"]/g,'_').slice(0,120);
  await q('INSERT INTO files(id,filename,mime,size,uploaded_by,chat_room,content) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,filename,mime,buf.length,u.id,room,buf]);
  return {file:{id,filename,mime,size:buf.length}};
});
app.post('/api/chat/:room',{config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async req=>{
  const u=await member(req),room=String((req.params as any).room);await chatRoom(u,room);
  const b:any=req.body||{},body=str(b.body,2000),fileId=str(b.file_id,100)||null,replyId=b.reply_to?Number(b.reply_to):null;
  if(!body&&!fileId)throw bad('שרייב א מעסעדזש אדער לייג צו א פייל');
  if(replyId&&(!Number.isSafeInteger(replyId)||!await q1('SELECT 1 FROM messages WHERE id=$1 AND room=$2',[replyId,room]))) throw bad('דער מעסעדזש איז נישט אין דעם שמועס');
  const mentions=Array.isArray(b.mention_ids)?[...new Set<number>(b.mention_ids.map(Number))]:[];
  const allowed=await membersOfRoom(u,room);
  if(mentions.length>30||mentions.some(id=>!Number.isSafeInteger(id)||!allowed.some(p=>p.id===id)))throw bad('מען קען נאר דערמאנען א מעמבער פון דעם שמועס');
  const message=await tx(async c=>{
    if(fileId) {
      const f=(await c.query('SELECT * FROM files WHERE id=$1 AND uploaded_by=$2 AND chat_room=$3 FOR UPDATE',[fileId,u.id,room])).rows[0];
      if(!f || (await c.query('SELECT 1 FROM messages WHERE file_id=$1',[fileId])).rows.length)throw bad('די פייל באלאנגט נישט צו דעם מעסעדזש');
    }
    const m=(await c.query('INSERT INTO messages(room,user_id,body,reply_to,file_id) VALUES($1,$2,$3,$4,$5) RETURNING id,body,created_at,user_id',[room,u.id,body,replyId,fileId])).rows[0];
    if(mentions.length)await c.query('INSERT INTO message_mentions(message_id,user_id) SELECT $1,unnest($2::int[])',[m.id,mentions]);
    return m;
  });
  return {message};
});
app.delete('/api/chat/message/:id',async req=>{
  const u=await member(req),id=Number((req.params as any).id),m=await q1('SELECT user_id,room FROM messages WHERE id=$1',[id]);
  if(!m)throw new HttpError(404,'נישט געטראפן');await chatRoom(u,m.room);
  if(m.user_id!==u.id&&!managesFamily(u))throw new HttpError(403,'נאר דיינע');
  await q('DELETE FROM messages WHERE id=$1',[id]);return {ok:true};
});
app.get('/api/chat-summary',async req=>{
  const u=await member(req),peers=await chatPeers(u);
  const dm=peers.filter(p=>p.id!==u.id).map(p=>'dm:'+Math.min(u.id,p.id)+':'+Math.max(u.id,p.id));
  return {rooms:await q(`SELECT r room,(SELECT max(id) FROM messages WHERE ${familySql()} AND room=r) last_id,
    (SELECT count(*)::int FROM message_mentions mm JOIN messages m ON m.id=mm.message_id WHERE ${familySql('m')} AND m.room=r AND mm.user_id=$2) mentions
    FROM unnest($1::text[]) r`,[[...roomsFor(u),...dm],u.id])};
});

// ---------------- home ----------------
app.get('/api/home', async (req) => {
  const u = await member(req);
  const yz = (await listYahrzeits(u)).filter((y) => y.next).slice(0, 3);
  const sims = (await q(`SELECT s.id,s.kind,s.whose,s.gdate,s.time_text,s.hdate_text,s.hall,s.address,s.audience FROM simchas s WHERE ${sideSql('s.audience', 1)} AND s.gdate >= $2 ORDER BY s.gdate LIMIT 4`, [mySides(u), todayYmd()]))
    .map((s) => ({ ...s, hebrew: s.hdate_text || hebrewForYmd(s.gdate), days: daysUntil(s.gdate) }));
  const msgs = await q(`SELECT m.id,m.room,m.body,m.created_at,u.name FROM messages m LEFT JOIN users u ON u.id=m.user_id AND m.family_group_id=ANY(u.family_group_ids) WHERE ${familySql('m')} AND m.room = ANY($1::text[]) ORDER BY m.id DESC LIMIT 5`, [roomsFor(u)]);
  const lists = await q(`SELECT l.id,l.kind,${learningTitleSql(1)} niftar,l.target_date,count(*) FILTER (WHERE i.taken_by IS NOT NULL OR (EXISTS(SELECT 1 FROM learn_portions p WHERE p.list_id=l.id AND p.idx=i.idx) AND NOT EXISTS(SELECT 1 FROM learn_portions p WHERE p.list_id=l.id AND p.idx=i.idx AND p.taken_by IS NULL)))::int taken,count(i.idx)::int total FROM learn_lists l JOIN learn_items i ON i.list_id=l.id
    WHERE ${sideSql('l.side', 1)} AND (l.target_date IS NULL OR l.target_date >= $2) GROUP BY l.id ORDER BY l.target_date NULLS LAST LIMIT 4`, [mySides(u), todayYmd()]);
  const counts = await q1(`SELECT (SELECT count(*) FROM users WHERE ${familyContext.getStore()!.id}=ANY(family_group_ids) AND status='active')::int members, (SELECT count(*) FROM users WHERE ${familyContext.getStore()!.id}=ANY(family_group_ids) AND status='pending')::int pending`);
  return { yahrzeits: yz, simchas: sims, messages: msgs, lists, members: (await chatPeers(u)).length, pending: u.is_admin ? counts.pending : 0, today: hebrewForYmd(todayYmd()) };
});

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'נישט געטראפן' });
  return reply.sendFile('index.html');
});

startJobs(app.log);
await app.listen({ port: config.port, host: config.host });

