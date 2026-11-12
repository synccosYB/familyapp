import { config } from './config.js';
import { pool } from './db.js';
import { emailReady, escapeEmailHtml, normalizeEmail, sendEmail } from './email.js';
import { personSql } from './family-scope.js';
import { MONTH_YI, nextYahrzeit } from './hebrew.js';
import { availableMishnayosSql } from './learning-dedications.js';
import { reminderClock } from './learning-reminders.js';
import { word } from './wording.js';
import type { EmailMessage } from './email.js';
import type { Occurrence } from './hebrew.js';

export const YAHRZEIT_REMINDER_DAYS = 3;

function reminderScopesSql(where: string) {
  return `SELECT u.id AS user_id, u.email, u.family_group_id AS primary_group_id, g.id AS family_group_id,
    CASE WHEN u.yahrzeit_ancestor_emails AND g.id=ANY(u.family_group_ids) THEN u.person_id END AS profile_id,
    CASE WHEN u.is_admin OR (u.is_family_admin AND u.family_group_id=g.id) THEN ARRAY['a','b'] ELSE u.sides END AS sides
    FROM users u JOIN family_groups g ON u.is_admin OR g.id=ANY(u.family_group_ids)
    WHERE u.status='active' AND NOT g.is_quarantine AND g.archived_at IS NULL AND (${where})`;
}

const sideVisible = (alias: string) => `(${alias}.side IN ('both','all') OR ${alias}.side=ANY(s.sides))`;
const personVisible = (alias: string) => `${personSql(alias, 'ARRAY[s.family_group_id]')} AND ${sideVisible(alias)}`;
// Follow parent links in one family at a time. UNION also stops cycles in legacy data.
const ancestorIds = `WITH RECURSIVE branch(id) AS (
    SELECT p.id FROM people p WHERE p.id=s.profile_id AND ${personVisible('p')}
    UNION
    SELECT p.id FROM branch b JOIN people child ON child.id=b.id
    JOIN people p ON p.id IN (child.father_id,child.mother_id,child.parent_id) AND ${personVisible('p')}
  ) SELECT id FROM branch WHERE id<>s.profile_id`;

export function yahrzeitAncestorIdsSql(userId: string) {
  return `SELECT a.id FROM (${reminderScopesSql(`u.id=${userId} AND u.yahrzeit_ancestor_emails`)}) s
    CROSS JOIN LATERAL (${ancestorIds}) a`;
}

interface YahrzeitDate { id: number; hday: number; hmonth: string; death_year: number | null }
interface Recipient extends YahrzeitDate { user_id: number; family_group_id: number; email: string; name: string; father_name: string | null; list_id: number | null }

const recipientSql = `WITH due AS (SELECT * FROM unnest($1::int[], $2::date[]) AS x(id,occurrence_date)),
  scopes AS MATERIALIZED (
    SELECT s.*, ARRAY(${ancestorIds}) AS ancestors FROM (${reminderScopesSql(
      'u.email_verified_at IS NOT NULL AND ($4::int IS NULL OR u.id=$4) AND (u.yahrzeit_ancestor_emails OR EXISTS (SELECT 1 FROM yahrzeit_reminders r JOIN due ON due.id=r.yahrzeit_id WHERE r.user_id=u.id AND r.enabled))'
    )}) s
  )
  SELECT DISTINCT ON (s.user_id,y.id) s.user_id,s.family_group_id,s.email,y.id,y.hday,y.hmonth,y.death_year,
    CASE WHEN p.id IS NULL THEN y.name ELSE concat_ws(' ',nullif(p.title,''),p.name) END AS name,
    CASE WHEN p.id IS NULL THEN y.father_name
      WHEN father.id IS NOT NULL THEN concat_ws(' ',nullif(p.lineage_term,''),nullif(father.title,''),father.name)
    END AS father_name, learning.id AS list_id
  FROM due JOIN yahrzeits y ON y.id=due.id CROSS JOIN scopes s
  LEFT JOIN yahrzeit_reminders r ON r.user_id=s.user_id AND r.yahrzeit_id=y.id
  LEFT JOIN people p ON p.id=y.person_id
  LEFT JOIN people father ON father.id=p.father_id AND ${personVisible('father')}
  LEFT JOIN LATERAL (
    SELECT l.id FROM learning_dedications d JOIN learn_lists l ON l.id=d.list_id
    WHERE d.yahrzeit_id=y.id AND l.family_group_id=s.family_group_id AND l.kind='mishnayos' AND ${sideVisible('l')}
      AND (l.target_date IS NULL OR l.target_date >= $3::date) AND EXISTS (${availableMishnayosSql('l.id')})
    ORDER BY (l.target_date=due.occurrence_date) DESC NULLS LAST, l.id DESC LIMIT 1
  ) learning ON true
  WHERE y.archived_at IS NULL AND ${sideVisible('y')}
    AND ((p.id IS NULL AND y.family_group_id=s.family_group_id) OR (p.id IS NOT NULL AND ${personVisible('p')}))
    AND coalesce(r.enabled, y.person_id=ANY(s.ancestors), false)
    AND NOT EXISTS (SELECT 1 FROM yahrzeit_email_deliveries d WHERE d.user_id=s.user_id
      AND d.yahrzeit_id=y.id AND d.occurrence_date=due.occurrence_date AND d.sent_at IS NOT NULL)
  ORDER BY s.user_id,y.id,(learning.id IS NOT NULL) DESC,(s.family_group_id=s.primary_group_id) DESC,s.family_group_id`;

function yahrzeitEmail(recipient: Recipient, email: string, occurrence: Occurrence): EmailMessage {
  const stripSuffix = (name: string) => name.replace(/\s+/g,' ').trim().replace(/(?:(?:^|\s+)ז(?:[״"“”]|['׳’]{2})ל[.!?]?)+$/u,'');
  const name = stripSuffix([stripSuffix(recipient.name),recipient.father_name].filter(Boolean).join(' ')) + ' ז״ל';
  const subject = word('email_yahrzeit.subject',{name});
  const date = `${occurrence.hebrew} · ${occurrence.ymd}`;
  const evening = word('email_yahrzeit.evening');
  const link = `${config.publicUrl}/#yz/${recipient.id}/${recipient.family_group_id}`;
  const learning = recipient.list_id ? `${config.publicUrl}/#learn/${recipient.list_id}/${recipient.family_group_id}` : null;
  const settings = word('email_yahrzeit.settings');
  const learn = word('email_yahrzeit.learning');
  return { from: config.resendFromEmail, to: [email], subject,
    text: [subject,date,evening,learning && `${learn}\n${learning}`,`${settings}\n${link}`].filter(Boolean).join('\n\n'),
    html: `<!doctype html><html lang="yi" dir="rtl"><body style="font-family:Arial,sans-serif;color:#19362d">
      <h1>${escapeEmailHtml(subject)}</h1><p>${escapeEmailHtml(occurrence.hebrew)} · <bdi>${escapeEmailHtml(occurrence.ymd)}</bdi></p><p>${escapeEmailHtml(evening)}</p>
      ${learning ? `<p><a href="${escapeEmailHtml(learning)}">${escapeEmailHtml(learn)}</a></p>` : ''}
      <p><a href="${escapeEmailHtml(link)}">${escapeEmailHtml(settings)}</a></p></body></html>` };
}

const occurrenceFor = (row: YahrzeitDate, today: string) => Object.hasOwn(MONTH_YI,row.hmonth)
  ? nextYahrzeit(row.hday,row.hmonth,row.death_year,today) : null;

export async function runYahrzeitReminders(log: { error: (o: object,m: string) => void }, now = new Date(), send: typeof fetch = fetch) {
  if (!emailReady()) return;
  const clock = reminderClock(now);
  if (clock.hour < config.learningReminderHour) return;
  const c = await pool.connect();
  let locked = false;
  try {
    locked = (await c.query('SELECT pg_try_advisory_lock(19761112,22) locked')).rows[0].locked;
    if (!locked) return;
    const rows = (await c.query<YahrzeitDate>('SELECT id,hday,hmonth,death_year FROM yahrzeits WHERE archived_at IS NULL')).rows;
    const upcoming = new Map<number,Occurrence>();
    for (const row of rows) {
      const occurrence = occurrenceFor(row,clock.date);
      if (occurrence && occurrence.days > 0 && occurrence.days <= YAHRZEIT_REMINDER_DAYS) upcoming.set(row.id,occurrence);
    }
    if (!upcoming.size) return;
    const recipients = (await c.query<Recipient>(recipientSql,[[...upcoming.keys()],[...upcoming.values()].map(o=>o.ymd),clock.date,null])).rows;
    for (const row of recipients) {
      try {
        const email = normalizeEmail(row.email);
        if (!email) continue;
        const occurrence = upcoming.get(row.id)!;
        const message = yahrzeitEmail(row,email,occurrence);
        await c.query(`INSERT INTO yahrzeit_email_deliveries(user_id,yahrzeit_id,occurrence_date,family_group_id,recipient,payload)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id,yahrzeit_id,occurrence_date) DO NOTHING`,
          [row.user_id,row.id,occurrence.ymd,row.family_group_id,email,JSON.stringify(message)]);
        const delivery = (await c.query<{ id: number; payload: EmailMessage; family_group_id: number }>(`SELECT id,payload,family_group_id
          FROM yahrzeit_email_deliveries WHERE user_id=$1 AND yahrzeit_id=$2 AND occurrence_date=$3 AND recipient=$4
            AND sent_at IS NULL AND created_at > now()-interval '20 hours'`,[row.user_id,row.id,occurrence.ymd,email])).rows[0];
        if (!delivery) continue;
        const current = (await c.query<Recipient>(recipientSql,[[row.id],[occurrence.ymd],clock.date,row.user_id])).rows[0];
        if (!current || normalizeEmail(current.email)!==email || current.family_group_id!==delivery.family_group_id
          || occurrenceFor(current,clock.date)?.ymd!==occurrence.ymd) continue;
        const id = await sendEmail(delivery.payload,`familye/yahrzeit/${delivery.id}`,send);
        await c.query('UPDATE yahrzeit_email_deliveries SET sent_at=now(),provider_id=$2 WHERE id=$1',[delivery.id,id]);
      } catch (error) {
        log.error({user_id:row.user_id,yahrzeit_id:row.id,error:String(error)},'Yahrzeit reminder failed');
      }
    }
  } finally {
    if (locked) await c.query('SELECT pg_advisory_unlock(19761112,22)').catch(()=>{});
    c.release();
  }
}
