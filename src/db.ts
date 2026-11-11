import pg from 'pg';
import { readFile } from 'node:fs/promises';
export interface Query { query<T = any>(sql: string, values?: any[]): Promise<{rows: T[]}>; }
export interface DB extends Query { transaction<T>(run:(tx:Query)=>Promise<T>):Promise<T>; }
export async function migrate(db:DB) {
 const sql=await readFile(new URL('../migrations/001_initial.sql',import.meta.url),'utf8');
 await db.transaction(async tx=>{await tx.query('SELECT pg_advisory_xact_lock(1976)');await tx.query(sql);});
}
export function connectDB(url:string) {
 const pool=new pg.Pool({connectionString:url,max:10});
 return {
  async query<T=any>(sql:string,values?:any[]) {return {rows:(await pool.query(sql,values)).rows as T[]};},
  async transaction<T>(run:(tx:Query)=>Promise<T>):Promise<T> {
   const client=await pool.connect();
   try{await client.query('BEGIN');const result=await run(client);await client.query('COMMIT');return result;}
   catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  },
  end:()=>pool.end()
 };
}
