import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { connectDB } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import { readFile } from 'node:fs/promises';
const origin='http://localhost:3000';
const pg=process.env.TEST_DATABASE_URL?connectDB(process.env.TEST_DATABASE_URL):null;
const lite=pg?null:new PGlite();
const db=pg??lite!;
let app:Awaited<ReturnType<typeof createApp>>;
let admin:string,father:string,mother:string,other:string;
let fatherId:string,otherId:string;
const sessions:Record<string,string>={};
async function call(method:any,url:string,who?:string,payload?:any,headers:Record<string,string>={}) {
 return app.inject({method,url,headers:{origin,...(who?{cookie:sessions[who]}:{}),...headers},payload});
}
async function addUser(login:string,sides:string[],isAdmin=false){
 const uid=randomUUID();await db.query('INSERT INTO users(id,name,login,password_hash,sides,is_admin) VALUES($1,$2,$3,$4,$5,$6)',[uid,login,login,await hashPassword('password-123'),sides,isAdmin]);
 const res=await call('POST','/api/auth/login',undefined,{login,password:'password-123'});assert.equal(res.statusCode,200,res.body);sessions[login]=String(res.headers['set-cookie']).split(';')[0];return uid;
}
async function create(kind:string,side:string,data:any,who=father){const r=await call('POST','/api/records',who,{kind,side,data});assert.equal(r.statusCode,201,r.body);return r.json().record;}
const directory={husband:'Test husband',wife:'Test wife',address:'Test address',phone:'',wifePhone:'',parents:''};
before(async()=>{
 const sql=await readFile(new URL('../migrations/001_initial.sql',import.meta.url),'utf8');
 if(lite)await lite.exec(sql);else await pg!.query(sql);
 app=await createApp(db as any,{origin});
 admin='admin';father='father';mother='mother';other='other';
 await addUser(admin,['f','m'],true);fatherId=await addUser(father,['f']);await addUser(mother,['m']);otherId=await addUser(other,['f']);
});
after(async()=>{await app?.close();if(pg)await pg.end();else await lite!.close();});
test('database readiness and static RTL shell',async()=>{
 assert.equal((await call('GET','/health/ready')).statusCode,200);
 const r=await call('GET','/');assert.equal(r.statusCode,200);assert.match(r.body,/lang="yi" dir="rtl"/);assert.match(String(r.headers['content-security-policy']),/frame-ancestors 'none'/);
});
test('no anonymous data reads; strict origin on mutations',async()=>{
 assert.equal((await call('GET','/api/records')).statusCode,401);
 assert.equal((await call('POST','/api/messages',father,{side:'f',body:'x'},{origin:'https://untrusted.example'})).statusCode,403);
 const noOrigin=await app.inject({method:'POST',url:'/api/auth/logout',headers:{cookie:sessions[father]}});assert.equal(noOrigin.statusCode,403);
});
test('side visibility is enforced for reads and writes, shared records visible to both',async()=>{
 const r=await create('directory','f',directory);
 const shared=await create('directory','all',{...directory,husband:'Shared'});
 const forbidden=await call('POST','/api/records',father,{kind:'directory',side:'m',data:directory});assert.equal(forbidden.statusCode,403);
 const list=(await call('GET','/api/records',mother)).json().records;
 assert.ok(!list.some((x:any)=>x.id===r.id));assert.ok(list.some((x:any)=>x.id===shared.id));
 assert.equal((await call('GET','/api/records?side=f',mother)).statusCode,403);
 assert.equal((await call('PUT','/api/records/'+r.id,mother,{version:1,data:directory})).statusCode,404);
 assert.equal((await call('PUT','/api/records/'+r.id,other,{version:1,data:directory})).statusCode,403);
});
test('record edit persists and stale writes are rejected',async()=>{
 const r=await create('directory','f',directory);
 assert.equal((await call('PUT','/api/records/'+r.id,father,{version:1,data:{...directory,address:'Updated'}})).statusCode,200);
 assert.equal((await call('PUT','/api/records/'+r.id,father,{version:1,data:directory})).statusCode,409);
 const found=(await call('GET','/api/records?kind=directory',father)).json().records.find((x:any)=>x.id===r.id);assert.equal(found.data.address,'Updated');
});
test('invites are admin-only, side-bound and single-use',async()=>{
 assert.equal((await call('POST','/api/invites',father,{sides:['f']})).statusCode,403);
 const inv=await call('POST','/api/invites',admin,{sides:['m']});assert.equal(inv.statusCode,201);
 const token=inv.json().url.split('#invite=')[1];const body={name:'Invited cousin',login:'invited',password:'password-123',token,sides:['f'],is_admin:true};
 const r=await call('POST','/api/auth/register',undefined,body);assert.equal(r.statusCode,201,r.body);
 const who=await app.inject({method:'GET',url:'/api/auth/me',headers:{cookie:String(r.headers['set-cookie']).split(';')[0]}});
 assert.deepEqual(who.json().user.sides,['m']);assert.equal(who.json().user.is_admin,false);
 assert.equal((await call('POST','/api/auth/register',undefined,{...body,login:'replay'})).statusCode,400);
 const stored=(await db.query('SELECT token_hash FROM invites WHERE id=$1',[inv.json().id])).rows[0];assert.notEqual(stored.token_hash,token);
});
test('failed duplicate registration does not consume invite; revocation and expiry work',async()=>{
 const inv=(await call('POST','/api/invites',admin,{sides:['f']})).json();const token=inv.url.split('#invite=')[1];
 assert.equal((await call('POST','/api/auth/register',undefined,{name:'Duplicate',login:'father',password:'password-123',token})).statusCode,409);
 const row=(await db.query('SELECT consumed_at FROM invites WHERE id=$1',[inv.id])).rows[0];assert.equal(row.consumed_at,null);
 await call('DELETE','/api/invites/'+inv.id,admin);
 assert.equal((await call('POST','/api/auth/register',undefined,{name:'Revoked',login:'revoked',password:'password-123',token})).statusCode,400);
 const exp=(await call('POST','/api/invites',admin,{sides:['f']})).json();await db.query("UPDATE invites SET expires_at=now()-interval '1 second' WHERE id=$1",[exp.id]);
 assert.equal((await call('POST','/api/auth/register',undefined,{name:'Expired',login:'expired',password:'password-123',token:exp.url.split('#invite=')[1]})).statusCode,400);
});
test('learning claims cannot be overwritten or released by another cousin',async()=>{
 const r=await create('learning','f',{title:'Test learning',kind:'tehillim',deadline:'2026-12-01'});
 const path='/api/records/'+r.id+'/claims/1';
 const results=await Promise.all([call('PUT',path,father,{}),call('PUT',path,other,{})]);assert.deepEqual(results.map(x=>x.statusCode).sort(),[200,409]);
 const claims=(await call('GET','/api/records/'+r.id+'/claims',father)).json().claims;
 const winner=claims[0].user_id===fatherId?father:other,loser=winner===father?other:father;
 assert.equal((await call('DELETE',path,loser)).statusCode,409);
 assert.equal((await call('PUT',path,winner,{completed:true})).statusCode,200);
 assert.equal((await call('GET','/api/records/'+r.id+'/claims',mother)).statusCode,404);
 assert.equal((await call('PUT','/api/records/'+r.id+'/claims/151',father,{})).statusCode,400);
 assert.equal((await call('DELETE',path,winner)).statusCode,200);
});
test('family tree validates parents, prevents cycles and rejects deleting parents with children',async()=>{
 const a=await create('person','f',{name:'Parent'}),b=await create('person','f',{name:'Child',parentId:a.id});
 assert.equal((await call('PUT','/api/records/'+a.id,father,{version:1,data:{...a.data,parentId:b.id}})).statusCode,400);
 assert.equal((await call('DELETE','/api/records/'+a.id,father)).statusCode,409);
 assert.equal((await call('POST','/api/records',mother,{kind:'person',side:'m',data:{name:'Wrong side',parentId:a.id}})).statusCode,400);
 await call('DELETE','/api/records/'+b.id,father);assert.equal((await call('DELETE','/api/records/'+a.id,father)).statusCode,200);
});
test('concurrent tree edits cannot introduce a cycle',async()=>{
 const a=await create('person','f',{name:'Concurrent A'}),b=await create('person','f',{name:'Concurrent B'});
 const results=await Promise.all([
  call('PUT','/api/records/'+a.id,father,{version:1,data:{...a.data,parentId:b.id}}),
  call('PUT','/api/records/'+b.id,father,{version:1,data:{...b.data,parentId:a.id}})
 ]);
 assert.deepEqual(results.map(x=>x.statusCode).sort(),[200,400]);
});
test('learning campaign type is immutable and invalid payloads fail',async()=>{
 const r=await create('learning','f',{title:'Immutable',kind:'tehillim',deadline:'2026-12-01'});
 assert.equal((await call('PUT','/api/records/'+r.id,father,{version:1,data:{...r.data,kind:'mishnayos'}})).statusCode,400);
 assert.equal((await call('POST','/api/records',father,{kind:'yahrzeit',side:'f',data:{name:'Test',relationship:'',day:31,month:'תשרי',grave:''}})).statusCode,400);
});
test('simcha RSVP is idempotent and side protected',async()=>{
 const r=await create('simcha','f',{title:'Test wedding',host:'Host',date:'2026-12-01',time:'19:00',venue:'Venue',address:'Address'});
 const path='/api/records/'+r.id+'/rsvp';
 await call('PUT',path,father,{answer:'yes'});await call('PUT',path,father,{answer:'yes'});
 assert.equal((await call('GET',path,father)).json().responses.length,1);
 await call('PUT',path,father,{answer:'no'});assert.equal((await call('GET',path,father)).json().responses[0].answer,'no');
 assert.equal((await call('GET',path,mother)).statusCode,404);
});
test('invitation upload requires ownership, matching file type and permitted download',async()=>{
 const r=await create('simcha','f',{title:'Test event',host:'Host',date:'2026-12-01',time:'',venue:'',address:''});
 const path='/api/records/'+r.id+'/attachment';
 const boundary='----testBoundary';
 const payload=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\nTest\r\n--${boundary}--\r\n`);
 const headers={'content-type':'multipart/form-data; boundary='+boundary};
 assert.equal((await call('POST',path,other,payload,headers)).statusCode,403);
 const up=await call('POST',path,father,payload,headers);assert.equal(up.statusCode,200,up.body);
 const downloaded=await call('GET',path,father);assert.equal(downloaded.statusCode,200);assert.match(downloaded.body,/%PDF-1.4/);assert.match(String(downloaded.headers['content-disposition']),/^attachment/);
 assert.equal((await call('GET',path,mother)).statusCode,404);
 const bad=Buffer.from(payload.toString().replace('%PDF-1.4','<script>'));assert.equal((await call('POST',path,father,bad,headers)).statusCode,400);
});
test('chat is persisted, separated by side, and messages remain literal text',async()=>{
 const body='<img src=x onerror=alert(1)>';
 assert.equal((await call('POST','/api/messages',father,{side:'f',body})).statusCode,201);
 assert.equal((await call('GET','/api/messages?side=f',mother)).statusCode,403);
 const messages=(await call('GET','/api/messages?side=f',father)).json().messages;assert.equal(messages.at(-1).body,body);
 await call('POST','/api/messages',father,{side:'all',body:'Shared message'});
 assert.equal((await call('GET','/api/messages?side=all',mother)).json().messages.at(-1).body,'Shared message');
});
test('fresh app instances read saved data; logout revokes server session',async()=>{
 const second=await createApp(db as any,{origin});const res=await second.inject({method:'GET',url:'/api/records',headers:{cookie:sessions[father]}});assert.ok(res.json().records.length>0);await second.close();
 const login=await call('POST','/api/auth/login',undefined,{login:'other',password:'password-123'});const c=String(login.headers['set-cookie']).split(';')[0];
 assert.match(String(login.headers['set-cookie']),/HttpOnly/);assert.match(String(login.headers['set-cookie']),/SameSite=Strict/);
 await app.inject({method:'POST',url:'/api/auth/logout',headers:{origin,cookie:c}});
 assert.equal((await app.inject({method:'GET',url:'/api/auth/me',headers:{cookie:c}})).statusCode,401);
});
