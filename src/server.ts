import { connectDB, migrate } from './db.js';
import { hashPassword } from './auth.js';
import { randomUUID } from 'node:crypto';
import { createApp } from './app.js';
const production=process.env.NODE_ENV==='production';
const origin=process.env.APP_ORIGIN??'http://localhost:3000';
if(production&&!origin.startsWith('https://')) throw new Error('APP_ORIGIN must be an HTTPS origin in production');
if(new URL(origin).origin!==origin) throw new Error('APP_ORIGIN must not contain a trailing slash or path');
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const db=connectDB(process.env.DATABASE_URL);
await migrate(db);
if(process.env.ADMIN_LOGIN&&process.env.ADMIN_PASSWORD) {
 if(process.env.ADMIN_PASSWORD.length<8) throw new Error('ADMIN_PASSWORD requires at least 8 characters');
 await db.query(`INSERT INTO users(id,name,login,password_hash,sides,is_admin) VALUES($1,$2,$3,$4,ARRAY['f','m'],true) ON CONFLICT(login) DO NOTHING`,
 [randomUUID(),process.env.ADMIN_NAME??'אדמין',process.env.ADMIN_LOGIN.trim().toLowerCase(),await hashPassword(process.env.ADMIN_PASSWORD)]);
}
const trustedProxyHops=Number(process.env.TRUST_PROXY_HOPS??0);
if(!Number.isInteger(trustedProxyHops)||trustedProxyHops<0||trustedProxyHops>5) throw new Error('TRUST_PROXY_HOPS must be 0 through 5');
const app=await createApp(db,{origin,production,logger:true,trustedProxyHops});
await app.listen({host:'0.0.0.0',port:Number(process.env.PORT??3000)});
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,async()=>{await app.close();await db.end();process.exit(0);});
