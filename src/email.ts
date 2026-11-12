import { config } from './config.js';

export const emailReady = () => !!(config.resendApiKey && config.resendFromEmail);
export function normalizeEmail(value: unknown): string {
  const email = String(value ?? '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : '';
}
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function learningRequestEmail(name: string, link: string) {
  const subject=`משניות לעילוי נשמת ${name.replace(/\s+/g,' ').trim()}`;
  const intro='טייערע משפחה, לאמיר צוזאמען לערנען. קלייבט א מסכתא, א פרק אדער א משנה פון די פרייע חלקים.';
  const action='קלייב אויס דיין חלק משניות';
  return {
    subject,
    text:`${subject}\n\n${intro}\n\n${action}: ${link}\n\nיישר כח!`,
    html:`<!doctype html><html lang="yi" dir="rtl"><body style="font-family:Arial,sans-serif;color:#19362d"><h1>${escape(subject)}</h1><p>${intro}</p><p><a href="${escape(link)}">${action}</a></p><p>יישר כח!</p></body></html>`
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
  if (!emailReady()) throw new Error('Email is not configured');
  const action = kind === 'verify' ? 'באשטעטיג מיין אימעיל' : 'שטעל איין א נייעם פאסווארט';
  const subject = kind === 'verify' ? 'באשטעטיג דיין אימעיל — אונזער משפחה' : 'א נייעם פאסווארט — אונזער משפחה';
  const intro = kind === 'verify' ? 'באשטעטיג דיין אימעיל צו קענען באקומען א פאסווארט לינק ווען דו דארפסט.' : 'מען האט געבעטן א לינק צו טוישן דיין פאסווארט.';
  const note = 'דער לינק איז גוט פאר איין שעה און קען נאר גענוצט ווערן איין מאל. אויב דו האסט דאס נישט געבעטן, קענסטו איגנארירן דעם אימעיל.';
  const response = await send('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `familye/${kind}/${requestKey}` },
    body: JSON.stringify({ from: config.resendFromEmail, to: [to], subject,
      text: `${intro}\n\n${action}: ${link}\n\n${note}`,
      html: `<!doctype html><html lang="yi" dir="rtl"><body style="margin:0;background:#f4f6f5;color:#19362d;font-family:Arial,sans-serif"><div style="max-width:540px;margin:32px auto;padding:32px;background:white;border-radius:16px"><p style="font-size:14px;color:#61776d">אונזער משפחה</p><h1 style="font-size:25px">${subject.split(' — ')[0]}</h1><p style="line-height:1.8">${intro}</p><p style="margin:28px 0"><a href="${escape(link)}" style="background:#28634e;color:white;padding:14px 22px;border-radius:9px;display:inline-block;text-decoration:none">${action}</a></p><p style="font-size:14px;line-height:1.8;color:#61776d">${note}</p><p style="font-size:12px;word-break:break-all" dir="ltr">${escape(link)}</p></div></body></html>` })
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
  const result = await response.json() as { id?: string };
  if (!result.id) throw new Error('Email provider did not accept the message');
  return result.id;
}
