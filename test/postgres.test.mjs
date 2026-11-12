import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

test('PostgreSQL app starts and persists member workflows with side access', {skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
 // Use an isolated schema even when a test database is reused. Never delete existing schemas.
 const schema='familye_build_'+randomBytes(8).toString('hex');
 const adminPool=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
 await adminPool.query(`CREATE SCHEMA ${schema}`);
 const conn=new URL(process.env.TEST_DATABASE_URL);conn.searchParams.set('options',`-c search_path=${schema}`);
 const data=await mkdtemp(path.join(tmpdir(),'familye-build-'));
 const setup=randomBytes(32).toString('hex');
 const env={...process.env,DATABASE_URL:conn.toString(),FAMILYE_DATA:data,ADMIN_NAME:'Build test admin',ADMIN_PHONE:'8455550100',SETUP_TOKEN_SHA256:createHash('sha256').update(setup).digest('hex'),QA_PHONE_PREFIX:'',COOKIE_SECURE:'false',PORT:'18080',HOST:'127.0.0.1',LOG_LEVEL:'error'};
 let child;let logs='';
 const run=(entry)=>{const p=spawn(process.execPath,[entry],{env,stdio:['ignore','pipe','pipe']});p.stdout.on('data',x=>logs+=x);p.stderr.on('data',x=>logs+=x);return p;};
 const base='http://127.0.0.1:18080';
 const request=async(endpoint,body,cookie='',method=body===undefined?'GET':'POST')=>{
  const r=await fetch(base+'/api'+endpoint,{method,headers:{'x-familye':'1',...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
 };
 try{
  const bootstrap=run('dist/bootstrap.js');const [code]=await once(bootstrap,'exit');assert.equal(code,0,logs);
  child=run('dist/index.js');let ready=false;
  for(let i=0;i<80;i++){try{ready=(await fetch(base+'/api/health')).ok;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  assert.ok(ready,logs);
  assert.equal((await request('/people')).status,401);
  const admin=await request('/auth/set-password',{token:setup,password:'build-admin-password'});assert.equal(admin.status,200);
  assert.equal((await request('/auth/set-password',{token:setup,password:'build-admin-password'})).status,404);
  const a=await request('/auth/signup',{name:'Side A test',phone:'8455550101',password:'build-member-password',sides:['a']});assert.equal(a.status,200);
  const b=await request('/auth/signup',{name:'Side B test',phone:'8455550102',password:'build-member-password',sides:['b']});assert.equal(b.status,200);
  assert.equal((await request('/people',undefined,a.cookie)).status,403);
  for(const u of [a,b])assert.equal((await request('/admin/users/'+u.body.user.id,{status:'active'},admin.cookie,'PATCH')).status,200);
  const parent=await request('/people',{name:'A parent',side:'a'},a.cookie);assert.equal(parent.status,200);
  const kid=await request('/people',{name:'A child',side:'a',parent_id:parent.body.person.id},a.cookie);assert.equal(kid.status,200);
  assert.equal((await request('/people/'+parent.body.person.id,{name:'A parent',side:'a',parent_id:kid.body.person.id},a.cookie,'PUT')).status,400);
  assert.equal((await request('/people',undefined,b.cookie)).body.people.length,0);
  assert.equal((await request('/people/'+parent.body.person.id,{name:'Cross-side edit',side:'b'},b.cookie,'PUT')).status,404);
  const list=await request('/lists',{kind:'tehillim',niftar:'Test dedication',side:'both'},admin.cookie);assert.equal(list.status,200);
  const listId=list.body.list.id;
  const competing=await Promise.all([a,b].map(u=>request(`/lists/${listId}/items/1`,{action:'take'},u.cookie)));
  assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);
  const owner=competing[0].status===200?a:b;
  assert.equal((await request(`/lists/${listId}/items/1`,{action:'done'},owner.cookie)).status,200);
  const hidden=await request('/lists',{kind:'mishnayos',niftar:'Side A only',side:'a'},a.cookie);assert.equal(hidden.status,200);
  assert.equal((await request('/lists/'+hidden.body.list.id,undefined,b.cookie)).status,404);
  assert.equal((await request('/lists/'+hidden.body.list.id,undefined,a.cookie)).body.items.length,63);
  const sim=await request('/simchas',{kind:'Wedding',whose:'Test family',gdate:'2099-01-01',audience:'all'},a.cookie);assert.equal(sim.status,200);
  const simId=sim.body.simcha.id;
  for(const answer of ['yes','no','yes'])assert.equal((await request('/simchas/'+simId+'/rsvp',{answer,people:2},b.cookie)).status,200);
  const sims=(await request('/simchas',undefined,a.cookie)).body.simchas;assert.equal(sims[0].yes_count,1);assert.equal(sims[0].yes_people,2);
  assert.equal((await request('/chat/a',{body:'private A'},a.cookie)).status,200);
  assert.equal((await request('/chat/a',undefined,b.cookie)).status,403);
  await request('/auth/logout',{},a.cookie);
  assert.equal((await request('/people',undefined,a.cookie)).status,401);
  const again=await request('/auth/login',{phone:'8455550101',password:'build-member-password'});assert.equal(again.status,200);
  assert.equal((await request('/people',undefined,again.cookie)).body.people.length,2);
 }finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}
  await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);await adminPool.end();await rm(data,{recursive:true,force:true});
 }
});
