import pg from 'pg';
import { familyContext } from './family-scope.js';
import { config } from './config.js';

pg.types.setTypeParser(1082, (v) => v); // date -> 'YYYY-MM-DD'
pg.types.setTypeParser(20, (v) => parseInt(v, 10));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.dbPoolMax });
export const q = async <T = any>(sql: string, params: unknown[] = []): Promise<T[]> => {
  if (familyContext.getStore()?.id) return tx(async c => (await c.query(sql, params)).rows as T[]);
  return (await pool.query(sql, params)).rows as T[];
};
export const q1 = async <T = any>(sql: string, params: unknown[] = []) => (await q<T>(sql, params))[0] as T | undefined;

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('familye.family_group_id',$1,true)", [String(familyContext.getStore()?.id || '')]);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
