import { HDate } from '@hebcal/core';
import { gem, hebrewAnniversary, hebrewDateForYmd, hebrewMonth, hebrewText, isHebrewDate, todayYmd, yahrzeitInYear, ymdForHebrewDate } from './hebrew.js';
import { word } from './wording.js';

export const dateKinds = ['birthday', 'anniversary', 'second_anniversary'] as const;
type DateKind = typeof dateKinds[number];
type FamilyDate = { day: number; month: string; year: number | null };
type CalendarDates = Partial<Record<DateKind, FamilyDate>>;

export function parseCalendarDates(input: unknown): CalendarDates | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const result: CalendarDates = {};
  for (const kind of dateKinds) {
    const value = (input as Record<string, unknown>)[kind];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'object' || Array.isArray(value)) return null;
    const { day, month, year } = value as Partial<FamilyDate>;
    const hyear = year ?? null;
    if (typeof day !== 'number' || typeof month !== 'string' || !isHebrewDate(day, month, hyear)) return null;
    result[kind] = { day, month, year: hyear };
  }
  return result;
}

export function calendarMonth(rawYear?: string, rawMonth?: string, today = todayYmd()) {
  const current = hebrewDateForYmd(today);
  const year = rawYear === undefined ? current.getFullYear() : Number(rawYear);
  const month = rawMonth === undefined ? current.getMonth() : Number(rawMonth);
  if (!Number.isInteger(year) || year < 5001 || year > 5999 || !Number.isInteger(month) || month < 1 || month > HDate.monthsInYear(year)) return null;
  const first = new HDate(1, month, year);
  const size = HDate.daysInMonth(month, year);
  const previous = new HDate(first.abs() - 1);
  const next = new HDate(first.abs() + size);
  const key = (date: HDate) => ({ year: date.getFullYear(), month: date.getMonth() });
  return {
    year, month, today,
    label: `${hebrewMonth(first)} ${gem(year % 1000)}`,
    todayLabel: hebrewText(current),
    previous: key(previous), next: key(next),
    startWeekday: first.greg().getDay(),
    days: Array.from({ length: size }, (_, index) => {
      const date = new HDate(index + 1, month, year);
      return { day: gem(index + 1), date: ymdForHebrewDate(date), label: hebrewText(date) };
    }),
  };
}

type CalendarPerson = { id: number; name: string; title: string; life_status: string; calendar_dates: CalendarDates;
  spouse_id: number | null; second_spouse_id: number | null };
type CalendarYahrzeit = { id: number; person_id: number | null; name: string; hday: number; hmonth: string; death_year: number | null };
export function calendarEvents(year: number, month: number, people: CalendarPerson[], yahrzeits: CalendarYahrzeit[]) {
  const events: { kind: DateKind | 'yahrzeit'; date: string; name: string; personId: number | null; yahrzeitId?: number }[] = [];
  const inMonth = (date: HDate | undefined): date is HDate => !!date && date.getFullYear() === year && date.getMonth() === month;
  const visible = new Map(people.map(person => [person.id, person]));
  const fullName = (person: CalendarPerson) => {
    const name = [person.title, person.name].filter(Boolean).join(' ');
    return person.life_status === 'deceased' ? `${name.replace(/\s+ז[״"׳']ל$/u, '')} ${word('tree.node.01')}` : name;
  };
  const marriages = new Set<string>();
  for (const person of people) {
    for (const kind of dateKinds) {
      const value = person.calendar_dates[kind];
      if (!value) continue;
      const date = hebrewAnniversary(year, value.day, value.month, value.year);
      if (!inMonth(date)) continue;
      const spouseId = kind === 'anniversary' ? person.spouse_id : kind === 'second_anniversary' ? person.second_spouse_id : null;
      const spouse = spouseId ? visible.get(spouseId) : undefined;
      const ymd = ymdForHebrewDate(date);
      if (spouse) {
        const marriage = `${Math.min(person.id, spouse.id)}/${Math.max(person.id, spouse.id)}/${ymd}`;
        if (marriages.has(marriage)) continue;
        marriages.add(marriage);
      }
      events.push({ kind, date: ymd, name: spouse ? `${fullName(person)} · ${fullName(spouse)}` : fullName(person), personId: person.id });
    }
  }
  for (const yahrzeit of yahrzeits) {
    const date = yahrzeitInYear(year, yahrzeit.hday, yahrzeit.hmonth, yahrzeit.death_year);
    if (inMonth(date)) events.push({ kind: 'yahrzeit', date: ymdForHebrewDate(date), name: yahrzeit.name,
      personId: yahrzeit.person_id, yahrzeitId: yahrzeit.id });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'he'));
}
