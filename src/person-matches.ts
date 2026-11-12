// Ignore presentation differences, but do not guess transliterations or merge people.
export const nameKey = (name: unknown) => String(name ?? '').normalize('NFKD')
  .replace(/\p{M}/gu, '').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]/gu, '');
export function sameParent(a: any, b: any): boolean {
  return ['father_id','mother_id','parent_id'].some(k => a[k] && b[k] && Number(a[k])===Number(b[k]));
}
