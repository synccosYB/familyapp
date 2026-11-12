import { word, htmlWord } from './wording.js';
import { config } from './config.js';

export const emailReady = () => !!(config.resendApiKey && config.resendFromEmail);
export function normalizeEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : '';
}
export const escapeEmailHtml = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export interface EmailMessage { from: string; to: string[]; subject: string; text: string; html: string }
export async function sendEmail(message: EmailMessage, key: string, send: typeof fetch = fetch) {
  if (!emailReady()) throw new Error('Email is not configured');
  const response = await send('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(message)
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
  const result = await response.json() as { id?: string };
  if (!result.id) throw new Error('Email provider did not accept the message');
  return result.id;
}

export function learningRequestEmail(name: string, link: string) {
  const subject=word("email_learning.learning_request_email.01", { value: name.replace(/\s+/g,' ').trim() });
  const intro=word("email_learning.learning_request_email.02");
  const action=word("email_learning.learning_request_email.03");
  return {
    subject,
    text:`${subject}

${intro}

${action}: ${link}

${word("email_learning.learning_request_email.04")}`,
    html:`<!doctype html><html lang="yi" dir="rtl"><body style="font-family:Arial,sans-serif;color:#19362d"><h1>${escapeEmailHtml(subject)}</h1><p>${escapeEmailHtml(intro)}</p><p><a href="${escapeEmailHtml(link)}">${escapeEmailHtml(action)}</a></p><p>${htmlWord("email_learning.learning_request_email.04")}</p></body></html>`
  };
}

export async function sendLearningRequestBatch(recipients: string[], message: ReturnType<typeof learningRequestEmail>, key: string) {
  if(!emailReady())throw new Error('Email is not configured');
  const response=await fetch('https://api.resend.com/emails/batch',{
    method:'POST',signal:AbortSignal.timeout(8000),
    headers:{Authorization:`Bearer ${config.resendApiKey}`,'Content-Type':'application/json','Idempotency-Key':key,'x-batch-validation':'strict'},
    body:JSON.stringify(recipients.map(to=>({from:config.resendFromEmail,to:[to],...message})))
  });
  if(!response.ok)throw new Error(`Email provider returned ${response.status}`);
  const result=await response.json() as {data?:{id:string}[]};
  if(result.data?.length!==recipients.length || result.data.some(item=>!item.id))throw new Error('Email provider did not accept the batch');
}

export async function sendAccountEmail(to: string, kind: 'verify' | 'reset', link: string, requestKey: string, send: typeof fetch = fetch) {
  const action = kind === 'verify' ? word("email_account.send_account_email.01") : word("email_account.send_account_email.02");
  const subject = kind === 'verify' ? word("email_account.send_account_email.03") : word("email_account.send_account_email.04");
  const intro = kind === 'verify' ? word("email_account.send_account_email.05") : word("email_account.send_account_email.06");
  const note = word("email_account.send_account_email.07");
  return sendEmail({ from: config.resendFromEmail, to: [to], subject,
    text: `${intro}\n\n${action}: ${link}\n\n${note}`,
    html: `<!doctype html><html lang="yi" dir="rtl"><body style="margin:0;background:#f4f6f5;color:#19362d;font-family:Arial,sans-serif"><div style="max-width:540px;margin:32px auto;padding:32px;background:white;border-radius:16px"><p style="font-size:14px;color:#61776d">${htmlWord("email_account.send_account_email.08")}</p><h1 style="font-size:25px">${escapeEmailHtml(subject.split(' — ')[0])}</h1><p style="line-height:1.8">${escapeEmailHtml(intro)}</p><p style="margin:28px 0"><a href="${escapeEmailHtml(link)}" style="background:#28634e;color:white;padding:14px 22px;border-radius:9px;display:inline-block;text-decoration:none">${escapeEmailHtml(action)}</a></p><p style="font-size:14px;line-height:1.8;color:#61776d">${escapeEmailHtml(note)}</p><p style="font-size:12px;word-break:break-all" dir="ltr">${escapeEmailHtml(link)}</p></div></body></html>`
  }, `familye/${kind}/${requestKey}`, send);
}
