import { config } from './config.js';
import { pool } from './db.js';
import { emailReady, normalizeEmail } from './email.js';
import { MASECHTOS } from './masechtos.js';

export interface LearningUnit { idx: number; chapter: number; mishnah: number }
export interface LearningMail { title: string; lines: string[]; target: string | null; days: number | null; remaining: number; link: string; sender?: string; settingsLink?: string }
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function reminderClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23' }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}
export function dailyLearning(kind: string, units: LearningUnit[], target: string | null, today: string) {
  // UTC date arithmetic measures calendar days, including across DST transitions.
  const days = target ? Math.round((Date.parse(target)-Date.parse(today))/86400000)+1 : null;
  if (!units.length || (days !== null && days < 1)) return null;
  const count = days === null ? units.length : Math.ceil(units.length/days);
  const selected = [...units].sort((a,b)=>a.idx-b.idx || a.chapter-b.chapter || a.mishnah-b.mishnah).slice(0,count);
  const lines = selected.map(u => kind === 'tehillim' ? `תהילים — קאפיטל ${u.idx}` : `${MASECHTOS[u.idx].name} — פרק ${u.chapter}, משנה ${u.mishnah}`);
  return { lines, days, remaining: units.length };
}
export async function sendLearningEmail(to: string, mail: LearningMail, key: string, send: typeof fetch = fetch) {
  if (!emailReady()) throw new Error('Email is not configured');
  const subject = 'דיין טעגליכער לימוד — '+mail.title;
  const note = mail.target ? `ביז ${mail.target} · נאך ${mail.days} טעג (מיט היינט)` : 'קיין ענד דאטום איז נישט באשטימט. דאס זענען אלע דיינע איבעריגע חלקים.';
  const settings = mail.settingsLink || config.publicUrl+'/#me';
  const response = await send('https://api.resend.com/emails', {
    method:'POST',signal:AbortSignal.timeout(8000),
    headers:{Authorization:`Bearer ${config.resendApiKey}`,'Content-Type':'application/json','Idempotency-Key':key},
    body:JSON.stringify({from:mail.sender || config.resendFromEmail,to:[to],subject,
      text:`${mail.title}\n${note}\n\nהיינט לערנען:\n${mail.lines.join('\n')}\n\nעפן דיין ליסט און צייכן אפ וואס דו האסט געענדיגט: ${mail.link}\nאויסלעשן טעגליכע אימעילס: ${settings}`,
      html:`<!doctype html><html lang="yi" dir="rtl"><body style="font-family:Arial,sans-serif;background:#f4f6f5;color:#19362d"><main style="max-width:540px;margin:24px auto;padding:24px;background:white;border-radius:16px"><p>אונזער משפחה</p><h1 style="font-size:24px">${escape(mail.title)}</h1><p>${escape(note)}</p><h2>היינט לערנען</h2><ul>${mail.lines.map(l=>`<li>${escape(l)}</li>`).join('')}</ul><p>צייכן אפ אין דער ליסט וואס דו האסט געענדיגט, כדי דער קומענדיגער פלאן זאל זיין ריכטיג.</p><p><a href="${escape(mail.link)}">עפן מיין ליסט</a></p><p><a href="${escape(settings)}">אימעיל איינשטעלונגען / אויסלעשן</a></p></main></body></html>`})
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
  const result = await response.json() as {id?:string};
  if (!result.id) throw new Error('Email provider did not accept the message');
  return result.id;
}

export async function remainingLearning(query: (sql:string,params:unknown[])=>Promise<{rows:any[]}>, listId:number, userId:number, kind:string):Promise<LearningUnit[]> {
  const portions = (await query(`SELECT idx,chapter,mishnah FROM learn_portions WHERE list_id=$1 AND taken_by=$2 AND NOT done
    UNION ALL SELECT idx,0,0 FROM learn_items i WHERE list_id=$1 AND taken_by=$2 AND NOT done
    AND NOT EXISTS(SELECT 1 FROM learn_portions p WHERE p.list_id=i.list_id AND p.idx=i.idx)`,[listId,userId])).rows;
  return portions.flatMap(p => kind==='mishnayos' && !p.chapter
    ? MASECHTOS[p.idx].chapters.flatMap((n,chapter)=>Array.from({length:n},(_,mishnah)=>({idx:p.idx,chapter:chapter+1,mishnah:mishnah+1}))) : [p]);
}

// Explicit membership and side checks are required here: jobs have no request family context.
export async function runLearningReminders(log: {error:(o:object,m:string)=>void}, now = new Date(), send: typeof fetch = fetch) {
  if (!emailReady()) return;
  const clock = reminderClock(now);
  if (clock.hour < config.learningReminderHour) return;
  const c = await pool.connect();
  let locked = false;
  try {
    locked = (await c.query('SELECT pg_try_advisory_lock(19761112,21) locked')).rows[0].locked;
    if (!locked) return;
    const rows = (await c.query(`SELECT l.id,l.kind,l.niftar,l.target_date,l.family_group_id,u.id user_id,u.email FROM learn_lists l
      JOIN users u ON l.family_group_id=ANY(u.family_group_ids)
      JOIN family_groups g ON g.id=l.family_group_id AND NOT g.is_quarantine AND g.archived_at IS NULL
      WHERE u.status='active' AND u.email_verified_at IS NOT NULL AND u.learning_email_reminders
      AND (u.is_admin OR (u.is_family_admin AND u.family_group_id=l.family_group_id) OR l.side='both' OR l.side=ANY(u.sides))
      AND (l.target_date IS NULL OR l.target_date >= $1::date)
      AND EXISTS(SELECT 1 FROM learn_items i WHERE i.list_id=l.id AND
        ((i.taken_by=u.id AND NOT i.done AND NOT EXISTS(SELECT 1 FROM learn_portions p WHERE p.list_id=i.list_id AND p.idx=i.idx))
        OR EXISTS(SELECT 1 FROM learn_portions p WHERE p.list_id=i.list_id AND p.idx=i.idx AND p.taken_by=u.id AND NOT p.done)))`,[clock.date])).rows;
    for (const row of rows) {
      try {
        const email = normalizeEmail(row.email); if (!email) continue;
        const units = await remainingLearning((sql,params)=>c.query(sql,params),row.id,row.user_id,row.kind);
        const plan = dailyLearning(row.kind,units,row.target_date,clock.date); if (!plan) continue;
        const mail:LearningMail = {...plan,title:`${row.kind==='tehillim'?'תהילים':'משניות'} — לעילוי נשמת ${row.niftar}`,target:row.target_date,link:`${config.publicUrl}/#learn/${row.id}/${row.family_group_id}`,sender:config.resendFromEmail,settingsLink:config.publicUrl+'/#me'};
        // Commit the immutable request before sending. Retry with the same provider key after a crash.
        await c.query(`INSERT INTO learning_email_deliveries(user_id,list_id,local_date,recipient,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[row.user_id,row.id,clock.date,email,JSON.stringify(mail)]);
        const delivery = (await c.query(`SELECT * FROM learning_email_deliveries WHERE user_id=$1 AND list_id=$2 AND local_date=$3 AND sent_at IS NULL
          AND created_at > now()-interval '20 hours' AND recipient=$4`,[row.user_id,row.id,clock.date,email])).rows[0];
        if (!delivery) continue;
        // Do not email obsolete portions after a failed send if the claim/progress changed.
        if (JSON.stringify(delivery.payload.lines) !== JSON.stringify(mail.lines)) continue;
        const eligible = (await c.query(`SELECT 1 FROM users u JOIN learn_lists l ON l.id=$2
          WHERE u.id=$1 AND u.status='active' AND u.learning_email_reminders AND u.email_verified_at IS NOT NULL
          AND lower(trim(u.email))=$3 AND l.family_group_id=ANY(u.family_group_ids)
          AND (u.is_admin OR (u.is_family_admin AND u.family_group_id=l.family_group_id) OR l.side='both' OR l.side=ANY(u.sides))`,[row.user_id,row.id,email])).rowCount;
        if (!eligible) continue;
        const id = await sendLearningEmail(email,delivery.payload,`familye/learning/${row.user_id}/${row.id}/${clock.date}`,send);
        await c.query('UPDATE learning_email_deliveries SET sent_at=now(),provider_id=$4 WHERE user_id=$1 AND list_id=$2 AND local_date=$3',[row.user_id,row.id,clock.date,id]);
      } catch(e) { log.error({list_id:row.id,user_id:row.user_id,error:String(e)},'learning reminder failed; will retry'); }
    }
    await c.query("DELETE FROM learning_email_deliveries WHERE local_date < $1::date-90",[clock.date]);
  } finally {
    if (locked) await c.query('SELECT pg_advisory_unlock(19761112,21)').catch(()=>{});
    c.release();
  }
}
