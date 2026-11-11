import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { readFile } from 'node:fs/promises';
import multipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DB, Query } from './db.js';
import { digest, token, hashPassword, verifyPassword } from './auth.js';
import { allowed, credentials, registration, side, id, kinds, schemas, recordBody, updateBody } from './validation.js';

type User = {id:string;name:string;login:string;sides:string[];is_admin:boolean};
declare module 'fastify' { interface FastifyRequest { user:User|null; } }
const failure = (statusCode:number,message:string) => Object.assign(new Error(message), {statusCode});
const publicUser = 'id,name,login,sides,is_admin';
export async function createApp(db:DB, options:{origin:string;production?:boolean;logger?:boolean;trustedProxyHops?:number}) {
 const app = Fastify({logger:options.logger??false,bodyLimit:24_000,trustProxy:options.trustedProxyHops?(_address:string,hop:number)=>hop<options.trustedProxyHops!:false});
 app.decorateRequest('user',null);
 await app.register(cookie);
 await app.register(rateLimit,{max:180,timeWindow:'1 minute'});
 await app.register(multipart,{limits:{fileSize:5*1024*1024,files:1,parts:1}});
 app.setErrorHandler((error:any,_req,reply)=>{
  if(error instanceof z.ZodError) return reply.code(400).send({message:'פרטים נישט ריכטיג. ביטע טשעק די פעלדער.',issues:error.issues.map(i=>({path:i.path,message:i.message}))});
  const status=error.statusCode??(error.code==='23505'?409:500);
  if(status>=500) app.log.error(error);
  reply.code(status).send({message:status>=500?'עס איז פארגעקומען א פראבלעם. פרוביר נאכאמאל.':error.code==='23505'?'שוין אין באנוץ.':error.message});
 });
 app.addHook('onSend',async(_req,reply)=>{
  reply.header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer')
   .header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if(options.production) reply.header('Strict-Transport-Security','max-age=31536000');
 });
 app.addHook('onRequest',async(req,reply)=>{
  if(req.url.startsWith('/api/')) {
   reply.header('Cache-Control','no-store');
   if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin!==options.origin) throw failure(403,'Invalid request origin');
   const raw=req.cookies.session;
   if(raw) req.user=(await db.query<User>(`SELECT ${publicUser.split(',').map(x=>'u.'+x).join(',')} FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()`,[digest(raw)])).rows[0]??null;
   if(!req.url.startsWith('/api/auth/')&&!req.user) throw failure(401,'ביטע לאג אריין.');
  }
 });
 function requireUser(req:FastifyRequest):User {if(!req.user) throw failure(401,'ביטע לאג אריין.');return req.user;}
 function admin(req:FastifyRequest) {const u=requireUser(req);if(!u.is_admin) throw failure(403,'נאר פאר אדמין.');return u;}
 async function session(userId:string,reply:any) {
  const raw=token();
  await db.query('DELETE FROM sessions WHERE expires_at<=now()');
  await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",[digest(raw),userId]);
  reply.setCookie('session',raw,{httpOnly:true,secure:!!options.production,sameSite:'strict',path:'/',maxAge:604800});
 }
 app.get('/health/ready',async()=>{await db.query('SELECT 1');return {status:'ready'};});
 app.post('/api/auth/login',{config:{rateLimit:{max:10,timeWindow:'15 minutes'}}},async(req,reply)=>{
  const c=credentials.parse(req.body);
  const u=(await db.query<User&{password_hash:string}>('SELECT * FROM users WHERE login=$1',[c.login])).rows[0];
  // Always run scrypt, including for unknown logins.
  const valid=await verifyPassword(c.password,u?.password_hash??'00000000000000000000000000000000:'+ '00'.repeat(64));
  if(!u||!valid) throw failure(401,'לאגין אדער פעסווארד נישט ריכטיג.');
  await session(u.id,reply);return {ok:true};
 });
 app.post('/api/auth/register',{config:{rateLimit:{max:10,timeWindow:'15 minutes'}}},async(req,reply)=>{
  const c=registration.parse(req.body), userId=randomUUID(), hash=await hashPassword(c.password);
  const result=await db.query(`WITH invitation AS (
   UPDATE invites SET consumed_at=now() WHERE token_hash=$1 AND consumed_at IS NULL AND expires_at>now() RETURNING sides
  ) INSERT INTO users(id,name,login,password_hash,sides) SELECT $2,$3,$4,$5,sides FROM invitation RETURNING id`,[digest(c.token),userId,c.name,c.login,hash]);
  if(!result.rows.length) throw failure(400,'אינווייט נישט גילטיג אדער שוין גענוצט.');
  await session(userId,reply);reply.code(201);return {ok:true};
 });
 app.get('/api/auth/me',async req=>({user:requireUser(req)}));
 app.post('/api/auth/logout',async(req,reply)=>{
  if(req.cookies.session) await db.query('DELETE FROM sessions WHERE token_hash=$1',[digest(req.cookies.session)]);
  reply.clearCookie('session',{path:'/'});return {ok:true};
 });
 app.post('/api/invites',async(req,reply)=>{
  const u=admin(req);const c=z.object({sides:z.array(z.enum(['f','m'])).min(1).max(2)}).parse(req.body);
  const raw=token(), inviteId=randomUUID();
  await db.query("INSERT INTO invites(id,token_hash,sides,created_by,expires_at) VALUES($1,$2,$3,$4,now()+interval '7 days')",[inviteId,digest(raw),[...new Set(c.sides)],u.id]);
  reply.code(201);return {id:inviteId,url:`${options.origin}/#invite=${raw}`};
 });
 app.get('/api/invites',async req=>{admin(req);return {invites:(await db.query('SELECT id,sides,expires_at,consumed_at FROM invites ORDER BY expires_at DESC LIMIT 100')).rows};});
 app.delete('/api/invites/:id',async req=>{admin(req);await db.query('DELETE FROM invites WHERE id=$1',[id.parse((req.params as any).id)]);return {ok:true};});
 async function record(req:FastifyRequest,kind?:string,write=false) {
  const u=requireUser(req), rid=id.parse((req.params as any).id);
  const r=(await db.query('SELECT * FROM records WHERE id=$1 AND (side=ANY($2::text[]) OR side=\'all\')',[rid,u.sides])).rows[0];
  if(!r||(kind&&r.kind!==kind)) throw failure(404,'נישט געפונען.');
  if(write&&!u.is_admin&&r.owner_id!==u.id) throw failure(403,'דו קענסט נאר עדיטן דיינע אייגענע פרטים.');
  return r;
 }
 async function parentCheck(q:Query,kind:string,data:any,scope:string,rid?:string) {
  if(kind!=='person'||!data.parentId) return;
  if(data.parentId===rid) throw failure(400,'A person cannot be their own parent');
  const p=(await q.query("SELECT id FROM records WHERE id=$1 AND kind='person' AND side=$2",[data.parentId,scope])).rows[0];
  if(!p) throw failure(400,'Parent must belong to the same family side');
  if(rid) {
   const cycle=(await q.query(`WITH RECURSIVE ancestors AS (
    SELECT id,data->>'parentId' AS parent FROM records WHERE id=$1
    UNION SELECT r.id,r.data->>'parentId' FROM records r JOIN ancestors a ON r.id::text=a.parent
   ) SELECT id FROM ancestors WHERE id=$2`,[data.parentId,rid])).rows;
   if(cycle.length) throw failure(400,'This relationship would create a cycle');
  }
 }
 // Serialize tree changes across server instances; keep validation and write in one transaction.
 async function mutate<T>(kind:string,run:(tx:Query)=>Promise<T>):Promise<T> {
  if(kind!=='person')return run(db);
  return db.transaction(async tx=>{await tx.query('SELECT pg_advisory_xact_lock(1977)');return run(tx);});
 }
 app.get('/api/records',async req=>{
  const u=requireUser(req), q=z.object({kind:kinds.optional(),side:side.optional()}).parse(req.query);
  if(q.side&&!allowed(u,q.side)) throw failure(403,'קיין צוטריט צו דעם סייד.');
  return {records:(await db.query(`SELECT r.*,u.name AS owner_name, EXISTS(SELECT 1 FROM attachments a WHERE a.record_id=r.id) AS has_attachment
   FROM records r JOIN users u ON u.id=r.owner_id WHERE (r.side=ANY($1::text[]) OR r.side='all')
   AND ($2::text IS NULL OR r.kind=$2) AND ($3::text IS NULL OR r.side=$3) ORDER BY r.created_at,r.id`,[u.sides,q.kind??null,q.side??null])).rows};
 });
 app.post('/api/records',async(req,reply)=>{
  const u=requireUser(req),c=recordBody.parse(req.body);
  if(!allowed(u,c.side)) throw failure(403,'קיין צוטריט צו דעם סייד.');
  const data=schemas[c.kind].parse(c.data);
  const r=await mutate(c.kind,async tx=>{
   await parentCheck(tx,c.kind,data,c.side);
   return tx.query('INSERT INTO records(id,kind,side,owner_id,data,parent_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[randomUUID(),c.kind,c.side,u.id,JSON.stringify(data),c.kind==='person'?(data as any).parentId:null]);
  });
  reply.code(201);return {record:r.rows[0]};
 });
 app.put('/api/records/:id',async req=>{
  const r=await record(req,undefined,true),c=updateBody.parse(req.body),data=schemas[r.kind as keyof typeof schemas].parse(c.data);
  if(r.kind==='learning' && (data as any).kind!==r.data.kind) throw failure(400,'Learning type cannot change after creation');
  const changed=await mutate(r.kind,async tx=>{
   await parentCheck(tx,r.kind,data,r.side,r.id);
   return tx.query('UPDATE records SET data=$1,version=version+1,updated_at=now(),parent_id=$4 WHERE id=$2 AND version=$3 RETURNING *',[JSON.stringify(data),r.id,c.version,r.kind==='person'?(data as any).parentId:null]);
  });
  if(!changed.rows.length) throw failure(409,'עמעצער האט שוין געעדיט. דערפריש און פרוביר נאכאמאל.');
  return {record:changed.rows[0]};
 });
 app.delete('/api/records/:id',async req=>{
  const r=await record(req,undefined,true);
  await mutate(r.kind,async tx=>{
   if(r.kind==='person'&&(await tx.query('SELECT id FROM records WHERE parent_id=$1',[r.id])).rows.length) throw failure(409,'נעם קודם אוועק די קינדער.');
   await tx.query('DELETE FROM records WHERE id=$1',[r.id]);
  });return {ok:true};
 });
 app.get('/api/records/:id/claims',async req=>{
  const r=await record(req,'learning');return {claims:(await db.query('SELECT c.unit,c.user_id,c.completed,u.name FROM claims c JOIN users u ON c.user_id=u.id WHERE record_id=$1 ORDER BY c.unit',[r.id])).rows};
 });
 app.put('/api/records/:id/claims/:unit',async req=>{
  const r=await record(req,'learning'),u=requireUser(req),unit=z.coerce.number().int().min(1).max(r.data.kind==='tehillim'?150:63).parse((req.params as any).unit);
  const c=z.object({completed:z.boolean().default(false)}).parse(req.body);
  const claimed=await db.query(`INSERT INTO claims(record_id,unit,user_id,completed) VALUES($1,$2,$3,$4)
   ON CONFLICT(record_id,unit) DO UPDATE SET completed=EXCLUDED.completed WHERE claims.user_id=EXCLUDED.user_id RETURNING unit`,[r.id,unit,u.id,c.completed]);
  if(!claimed.rows.length) throw failure(409,'שוין גענומען דורך אן אנדערן.');return {ok:true};
 });
 app.delete('/api/records/:id/claims/:unit',async req=>{
  const r=await record(req,'learning'),u=requireUser(req),unit=z.coerce.number().int().parse((req.params as any).unit);
  const removed=await db.query('DELETE FROM claims WHERE record_id=$1 AND unit=$2 AND user_id=$3 RETURNING unit',[r.id,unit,u.id]);
  if(!removed.rows.length) throw failure(409,'דו האסט נישט גענומען דעם חלק.');return {ok:true};
 });
 app.get('/api/records/:id/rsvp',async req=>{
  const r=await record(req,'simcha');return {responses:(await db.query('SELECT r.user_id,r.answer,u.name FROM rsvps r JOIN users u ON r.user_id=u.id WHERE record_id=$1',[r.id])).rows};
 });
 app.put('/api/records/:id/rsvp',async req=>{
  const r=await record(req,'simcha'),u=requireUser(req),c=z.object({answer:z.enum(['yes','no'])}).parse(req.body);
  await db.query('INSERT INTO rsvps(record_id,user_id,answer) VALUES($1,$2,$3) ON CONFLICT(record_id,user_id) DO UPDATE SET answer=EXCLUDED.answer',[r.id,u.id,c.answer]);return {ok:true};
 });
 app.post('/api/records/:id/attachment',async req=>{
  const r=await record(req,'simcha',true),file=await req.file();
  if(!file) throw failure(400,'ביטע קלייב א פייל.');
  const content=await file.toBuffer();
  // Only images with matching magic bytes or PDFs; no SVG/HTML active content.
  const mime=content.subarray(0,5).toString()==='%PDF-'?'application/pdf':content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':content[0]===255&&content[1]===216&&content[2]===255?'image/jpeg':null;
  if(!mime||mime!==file.mimetype) throw failure(400,'נאר PNG, JPG אדער PDF.');
  const filename=file.filename.replace(/[^\p{L}\p{N} ._-]/gu,'_').slice(0,150)||'invitation';
  await db.query('INSERT INTO attachments(record_id,filename,mime,content) VALUES($1,$2,$3,$4) ON CONFLICT(record_id) DO UPDATE SET filename=$2,mime=$3,content=$4',[r.id,filename,mime,content]);return {ok:true};
 });
 app.get('/api/records/:id/attachment',async(req,reply)=>{
  const r=await record(req,'simcha'),f=(await db.query('SELECT filename,mime,content FROM attachments WHERE record_id=$1',[r.id])).rows[0];
  if(!f) throw failure(404,'נישט געפונען.');
  reply.header('Content-Type',f.mime).header('Content-Disposition',`attachment; filename="invitation.${f.mime==='application/pdf'?'pdf':f.mime==='image/png'?'png':'jpg'}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`).header('Content-Security-Policy',"default-src 'none'; sandbox");
  return reply.send(Buffer.from(f.content));
 });
 app.get('/api/messages',async req=>{
  const u=requireUser(req),scope=side.parse((req.query as any).side??'all');
  if(!allowed(u,scope)) throw failure(403,'קיין צוטריט.');
  return {messages:(await db.query('SELECT * FROM (SELECT m.id,m.body,m.user_id,m.created_at,u.name FROM messages m JOIN users u ON m.user_id=u.id WHERE m.side=$1 ORDER BY m.created_at DESC,m.id DESC LIMIT 100) recent ORDER BY created_at,id',[scope])).rows};
 });
 app.post('/api/messages',async(req,reply)=>{
  const u=requireUser(req),c=z.object({side,body:z.string().trim().min(1).max(2000)}).parse(req.body);
  if(!allowed(u,c.side)) throw failure(403,'קיין צוטריט.');
  await db.query('INSERT INTO messages(id,side,user_id,body) VALUES($1,$2,$3,$4)',[randomUUID(),c.side,u.id,c.body]);reply.code(201);return {ok:true};
 });
 for(const [route,file,mime] of [['/','index.html','text/html; charset=utf-8'],['/app.js','app.js','text/javascript; charset=utf-8'],['/app.css','app.css','text/css; charset=utf-8']]) {
  const content=await readFile(new URL('../public/'+file,import.meta.url));
  app.get(route,async(_req,reply)=>reply.header('Cache-Control','no-cache').type(mime).send(content));
 }
 return app;
}
