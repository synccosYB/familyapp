import { AsyncLocalStorage } from 'node:async_hooks';

// A new store is created for every request. Never trust a family id from a body.
export const familyContext = new AsyncLocalStorage<{ id?: number; peopleGroups?: number[] }>();
export function familySql(alias = ''): string {
  const id = familyContext.getStore()?.id;
  if (!Number.isSafeInteger(id) || !id || id < 1) throw new Error('Family context is required');
  return `${alias ? alias + '.' : ''}family_group_id=${id}`;
}

export function personGroupsSql(): string {
  const ctx=familyContext.getStore(), groups=ctx?.peopleGroups || (ctx?.id?[ctx.id]:[]);
  if(!groups.length || groups.some(id=>!Number.isSafeInteger(id)||id<1))throw new Error('Family context is required');
  return `ARRAY[${groups.join(',')}]::int[]`;
}
export function personSql(alias='people', groups=personGroupsSql()): string {
  return `(${alias}.family_group_id=ANY(${groups}) OR EXISTS(SELECT 1 FROM person_family_access access WHERE access.person_id=${alias}.id AND access.family_group_id=ANY(${groups})))`;
}
