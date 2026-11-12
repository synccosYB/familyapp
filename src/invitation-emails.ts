import { word, htmlWord } from './wording.js';
import { config } from './config.js';
import { pool } from './db.js';
import { emailReady } from './email.js';

export interface InvitationMail { title:string; lines:string[]; link:string; content?: ReturnType<typeof renderInvitationEmail> }
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function renderInvitationEmail(mail: InvitationMail) {
  return {subject:mail.title,
      text:[mail.title,...mail.lines,`${word("email_invitation.send_invitation_email.01")} `+mail.link,word("email_invitation.send_invitation_email.02")].join('\n'),
      html:`<!doctype html><html lang="yi" dir="rtl"><body style="font-family:Arial,sans-serif;background:#f4f6f5;color:#19362d"><main style="max-width:540px;margin:24px auto;background:white;padding:28px;border-radius:16px"><p>${htmlWord("email_invitation.send_invitation_email.03")}</p><h1 style="font-size:24px">${escape(mail.title)}</h1>${mail.lines.map(l=>`<p>${escape(l)}</p>`).join('')}<p><a href="${escape(mail.link)}" style="display:inline-block;background:#28634e;color:white;padding:14px 22px;border-radius:9px;text-decoration:none">${htmlWord("email_invitation.send_invitation_email.04")}</a></p><p style="font-size:13px">${htmlWord("email_invitation.send_invitation_email.02")}</p></main></body></html>`};
}
export async function sendInvitationEmail(to:string, mail:InvitationMail, key:string, send:typeof fetch=fetch) {
  if(!emailReady())throw new Error('Email is not configured');
  const response=await send('https://api.resend.com/emails',{
    method:'POST',signal:AbortSignal.timeout(8000),headers:{Authorization:`Bearer ${config.resendApiKey}`,'Content-Type':'application/json','Idempotency-Key':key},
    body:JSON.stringify({from:config.resendFromEmail,to:[to],...(mail.content ?? renderInvitationEmail(mail))})
  });
  if(!response.ok)throw new Error(`Email provider returned ${response.status}`);
  const result=await response.json() as {id?:string};if(!result.id)throw new Error('Email provider did not accept the message');return result.id;
}

// One message per tick across all replicas. Each recipient has a persistent provider key.
export async function runInvitationEmails(log:{error:(o:object,m:string)=>void}, send:typeof fetch=fetch) {
  if(!emailReady())return;
  const c=await pool.connect();let locked=false;
  try {
    locked=(await c.query('SELECT pg_try_advisory_lock(19761112,22) locked')).rows[0].locked;if(!locked)return;
    const d=(await c.query(`SELECT d.* FROM invitation_email_deliveries d WHERE d.sent_at IS NULL AND d.attempts<8
      AND d.created_at>now()-interval '20 hours' AND d.next_attempt_at<=now() ORDER BY d.created_at,d.simcha_id LIMIT 1`)).rows[0];
    if(!d)return;
    const eligible=(await c.query(`SELECT 1 FROM users u JOIN simchas s ON s.id=$2 JOIN users sender ON sender.id=$3
      WHERE u.id=$1 AND u.status='active' AND lower(trim(u.email))=$4 AND sender.status='active'
      AND (sender.is_admin OR (s.family_group_id=ANY(sender.family_group_ids) AND
        (s.created_by=sender.id OR (sender.is_family_admin AND sender.family_group_id=s.family_group_id))))
      AND (($5::boolean AND sender.is_admin) OR (s.family_group_id=ANY(u.family_group_ids)
        AND (u.is_admin OR (u.is_family_admin AND u.family_group_id=s.family_group_id) OR s.audience='all' OR s.audience=ANY(u.sides))))`,[d.user_id,d.simcha_id,d.queued_by,d.recipient,d.all_families])).rowCount;
    if(!eligible){await c.query("UPDATE invitation_email_deliveries SET attempts=8,last_error='Recipient or sender no longer eligible' WHERE simcha_id=$1 AND recipient=$2",[d.simcha_id,d.recipient]);return;}
    // Persist attempts before calling the provider, so repeated failures are bounded.
    await c.query("UPDATE invitation_email_deliveries SET attempts=attempts+1,next_attempt_at=now()+interval '2 minutes' WHERE simcha_id=$1 AND recipient=$2",[d.simcha_id,d.recipient]);
    try {
      const id=await sendInvitationEmail(d.recipient,d.payload,`familye/invitation/${d.simcha_id}/${d.user_id}`,send);
      await c.query('UPDATE invitation_email_deliveries SET sent_at=now(),provider_id=$3,last_error=NULL WHERE simcha_id=$1 AND recipient=$2',[d.simcha_id,d.recipient,id]);
    } catch(e) {
      await c.query('UPDATE invitation_email_deliveries SET last_error=$3 WHERE simcha_id=$1 AND recipient=$2',[d.simcha_id,d.recipient,String(e).slice(0,200)]);
      log.error({simcha_id:d.simcha_id,error:String(e)},'Invitation email failed; retry scheduled');
    }
  } finally {if(locked)await c.query('SELECT pg_advisory_unlock(19761112,22)').catch(()=>{});c.release();}
}
