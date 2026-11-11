export function normPhoneB(raw: unknown): string {
  const d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 10) return '1' + d;
  if (d.length >= 11 && d.length <= 15) return d;
  return '';
}
