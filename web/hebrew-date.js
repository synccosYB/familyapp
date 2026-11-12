// Use a fixed time zone: a date-only event must not shift with the viewer's device.
const formatter = new Intl.DateTimeFormat('en-u-ca-hebrew', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const months = { Tishri:'תשרי', Tishrei:'תשרי', Heshvan:'חשון', Cheshvan:'חשון', Kislev:'כסלו', Tevet:'טבת', Shevat:'שבט', Adar:'אדר', 'Adar I':'אדר א', 'Adar II':'אדר ב', Nisan:'ניסן', Iyar:'אייר', Sivan:'סיון', Tamuz:'תמוז', Tammuz:'תמוז', Av:'אב', Elul:'אלול' };
function gem(n) {
  const ones=['','א','ב','ג','ד','ה','ו','ז','ח','ט'], tens=['','י','כ','ל','מ','נ','ס','ע','פ','צ'], hundreds=['','ק','ר','ש','ת','תק','תר','תש','תת','תתק'];
  let s=hundreds[Math.floor(n/100)]; n%=100;
  s+=n===15?'טו':n===16?'טז':tens[Math.floor(n/10)]+ones[n%10];
  return s.length>1?s.slice(0,-1)+'״'+s.slice(-1):s+'׳';
}
export function automaticHebrewDate(ymd, afterSunset=false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return '';
  const date=new Date(ymd+'T12:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10)!==ymd) return '';
  if (afterSunset) date.setUTCDate(date.getUTCDate()+1);
  const parts=Object.fromEntries(formatter.formatToParts(date).map(p=>[p.type,p.value]));
  const month=months[parts.month];
  return month?`${gem(Number(parts.day))} ${month} ${gem(Number(parts.year)%1000)}`:'';
}
