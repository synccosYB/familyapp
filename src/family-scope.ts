import { AsyncLocalStorage } from 'node:async_hooks';

// A new store is created for every request. Never trust a family id from a body.
export const familyContext = new AsyncLocalStorage<{ id?: number }>();
export function familySql(alias = ''): string {
  const id = familyContext.getStore()?.id;
  if (!Number.isSafeInteger(id) || !id || id < 1) throw new Error('Family context is required');
  return `${alias ? alias + '.' : ''}family_group_id=${id}`;
}
