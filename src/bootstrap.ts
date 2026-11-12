// Runs before the API on every start: migrations, settings row, first admin + one-time setup token,
// removal of temporary QA users when QA mode is off, and orphaned upload cleanup. Never wipes real data.
import { readdirSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '@node-rs/argon2';
import { config } from './config.js';
import { pool, q, q1 } from './db.js';
import { normPhoneB } from './phone.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG = path.resolve(__dirname, '../db/migrations');
const log = (m: string) => console.log(`${new Date().toISOString()} [bootstrap] ${m}`);

await q('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort()) {
  if (await q1('SELECT 1 FROM schema_migrations WHERE name=$1', [f])) continue;
  const c = await pool.connect();
  try { await c.query('BEGIN'); await c.query(readFileSync(path.join(MIG, f), 'utf8')); await c.query('INSERT INTO schema_migrations(name) VALUES($1)', [f]); await c.query('COMMIT'); log(`applied ${f}`); }
  catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
if (!(await q1('SELECT 1 FROM settings WHERE id=1'))) {
  const F = config.family;
  await q(`INSERT INTO settings(id,family_yi,family_en,side_a_family_yi,side_a_family_en,side_b_family_yi,side_b_family_en) VALUES(1,$1,$2,$3,$4,$5,$6)`,
    [F.yi || 'אונדזער משפחה', F.en || 'Our Family', F.aYi, F.aEn, F.bYi, F.bEn]);
  log('settings row created');
}
const A = config.admin, phone = normPhoneB(A.phone);
if (phone && A.name) {
  const owner = await q1('SELECT bootstrap_admin_id FROM settings WHERE id=1');
  let u = owner?.bootstrap_admin_id
    ? await q1('SELECT * FROM users WHERE id=$1', [owner.bootstrap_admin_id])
    : await q1('SELECT * FROM users WHERE phone=$1', [phone]);
  if (!u) {
    u = await q1(`INSERT INTO users(name,phone,email,sides,status,is_admin,approved_at) VALUES($1,$2,$3,'{a,b}','active',true,now()) RETURNING *`, [A.name, phone, A.email || null]);
    log(`admin user created (${A.name})`);
  } else if (!u.is_admin || u.status !== 'active') { await q(`UPDATE users SET is_admin=true,status='active' WHERE id=$1`, [u.id]); }
  await q('UPDATE settings SET bootstrap_admin_id=$1 WHERE id=1 AND bootstrap_admin_id IS NULL', [u.id]);
  if (!u.password_hash && A.setupTokenSha256 && !(await q1('SELECT 1 FROM password_tokens WHERE token_hash=$1', [A.setupTokenSha256]))) {
    await q(`INSERT INTO password_tokens(token_hash,user_id,expires_at) VALUES($1,$2,now()+($3||' days')::interval)`, [A.setupTokenSha256, u.id, String(A.setupTokenDays)]);
    log('admin one-time setup token stored');
  }
}
// QA mode (deploy/qa.env present): a QA admin with a known password. Off: every QA user and everything they made is removed.
if (config.qaPhonePrefix && normPhoneB(process.env.QA_ADMIN_PHONE) && process.env.QA_ADMIN_PASSWORD) {
  const p = normPhoneB(process.env.QA_ADMIN_PHONE);
  const h = await hash(process.env.QA_ADMIN_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  await q(`INSERT INTO users(name,phone,sides,status,is_admin,is_qa,password_hash,approved_at) VALUES('QA טעסט אדמין',$1,'{a,b}','active',true,true,$2,now())
    ON CONFLICT (phone) DO UPDATE SET password_hash=$2, is_admin=true, status='active', is_qa=true`, [p, h]);
  log('QA mode on');
} else {
  const r = await q('DELETE FROM users WHERE is_qa RETURNING id');
  if (r.length) log(`removed ${r.length} QA users and their data`);
  await q('DELETE FROM sessions WHERE expires_at < now()');
}
// orphaned uploads
const up = path.resolve(config.dataDir, 'uploads'); mkdirSync(up, { recursive: true });
await q(`DELETE FROM files f WHERE NOT EXISTS (SELECT 1 FROM simchas s WHERE s.file_id=f.id)
  AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.file_id=f.id) AND f.created_at<now()-interval '1 day'`);
const known = new Set((await q('SELECT id FROM files')).map((r: any) => r.id));
let n = 0; for (const f of readdirSync(up)) if (!known.has(f)) { try { unlinkSync(path.join(up, f)); n++; } catch { /* */ } }
if (n) log(`removed ${n} orphaned uploads`);
const c = await q1(`SELECT count(*)::int users, count(*) FILTER (WHERE is_admin)::int admins FROM users`);
log(`ready: ${c.users} users (${c.admins} admin)`);
await pool.end();
