import { HDate, HebrewCalendar, months } from '@hebcal/core';
import { config } from './config.js';

export const MONTH_CODES = ['TISHREI', 'CHESHVAN', 'KISLEV', 'TEVET', 'SHVAT', 'ADAR', 'ADAR_I', 'ADAR_II', 'NISAN', 'IYYAR', 'SIVAN', 'TAMUZ', 'AV', 'ELUL'] as const;
export const MONTH_YI: Record<string, string> = {
  TISHREI: 'תשרי', CHESHVAN: 'חשון', KISLEV: 'כסלו', TEVET: 'טבת', SHVAT: 'שבט', ADAR: 'אדר', ADAR_I: 'אדר א', ADAR_II: 'אדר ב',
  NISAN: 'ניסן', IYYAR: 'אייר', SIVAN: 'סיון', TAMUZ: 'תמוז', AV: 'אב', ELUL: 'אלול',
};
const NUM: Record<string, number> = { ...months, ADAR: months.ADAR_I } as any;

const ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
/** Plain gematriya without nekudos: 23 -> כ״ג, 5 -> ה׳ */
export function gem(n: number): string {
  let s = '';
  if (n >= 1000) { s += gem(Math.floor(n / 1000)).replace(/[׳״]/g, ''); n %= 1000; }
  const h = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];
  s += h[Math.floor(n / 100)]; n %= 100;
  if (n === 15) s += 'טו'; else if (n === 16) s += 'טז'; else s += tens[Math.floor(n / 10)] + ones[n % 10];
  return s.length > 1 ? s.slice(0, -1) + '״' + s.slice(-1) : s + '׳';
}

/** Today's date in the family's time zone, as a JS Date at local midnight (UTC fields). */
export function todayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const ymdToDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const dateToYmd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A real death date with this day/month, so hebcal's yahrzeit rules (Adar, 30 Cheshvan/Kislev) apply. */
function syntheticDeath(day: number, code: string, deathYear?: number | null): HDate {
  const month = NUM[code];
  const wantLeap = code === 'ADAR_I' || code === 'ADAR_II' ? true : code === 'ADAR' ? false : null;
  const candidates: number[] = [];
  if (deathYear && deathYear > 3000) candidates.push(deathYear);
  for (let y = 5700; y < 5800; y++) candidates.push(y);
  for (const y of candidates) {
    const leap = HDate.isLeapYear(y);
    if (wantLeap !== null && leap !== wantLeap) continue;
    if (day > HDate.daysInMonth(month, y)) continue;
    return new HDate(day, month, y);
  }
  return new HDate(Math.min(day, 29), month, 5785);
}

export interface Occurrence { ymd: string; days: number; hebrew: string }
/** Next yahrzeit on or after today (in the family's time zone). */
export function nextYahrzeit(day: number, code: string, deathYear?: number | null): Occurrence | null {
  const today = ymdToDate(todayYmd());
  const death = syntheticDeath(day, code, deathYear);
  const hy = new HDate(today).getFullYear();
  for (const y of [hy - 1, hy, hy + 1, hy + 2]) {
    if (y <= death.getFullYear()) continue;
    const h = HebrewCalendar.getYahrzeit(y, death);
    if (!h) continue;
    const g = h.greg();
    const days = Math.round((g.getTime() - today.getTime()) / 86400000);
    if (days < 0) continue;
    return { ymd: dateToYmd(g), days, hebrew: hebrewText(h) };
  }
  return null;
}

export function hebrewText(h: HDate): string {
  const mname = h.getMonth() === months.ADAR_I ? (HDate.isLeapYear(h.getFullYear()) ? 'אדר א' : 'אדר')
    : h.getMonth() === months.ADAR_II ? 'אדר ב' : MONTH_YI[Object.keys(months).find((k) => (months as any)[k] === h.getMonth()) as string];
  return `${gem(h.getDate())} ${mname} ${gem(h.getFullYear() % 1000)}`;
}
export function hebrewForYmd(ymd: string): string { return hebrewText(new HDate(ymdToDate(ymd))); }
export function daysUntil(ymd: string): number { return Math.round((ymdToDate(ymd).getTime() - ymdToDate(todayYmd()).getTime()) / 86400000); }
