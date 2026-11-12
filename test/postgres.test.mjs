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
  // Structured relationships are shared by tree, household directory and yahrzeits.
  const createPerson=async body=>{const r=await request('/people',{side:'a',...body},admin.cookie);assert.equal(r.status,200,JSON.stringify(r.body));return r.body.person;};
  const father=await createPerson({name:'Structured father',title:'Rabbi',life_status:'deceased',death_hday:12,death_hmonth:'KISLEV'});
  const mother=await createPerson({name:'Structured mother'});
  const wife=await createPerson({name:'Structured spouse'});
  const son=await createPerson({name:'Structured son',father_id:father.id,mother_id:mother.id,spouse_id:wife.id});
  const personRows=(await request('/people',undefined,admin.cookie)).body.people;
  assert.equal(personRows.find(p=>p.id===wife.id).spouse_id,son.id);
  assert.equal(personRows.find(p=>p.id===mother.id).life_status,'unknown');
  assert.equal(personRows.find(p=>p.id===son.id).mother_name,'Structured mother');
  const directory=await request('/directory',{husband_person_id:son.id,wife_person_id:wife.id,parents:'Legacy note retained',side:'a',mine:true},admin.cookie);
  assert.equal(directory.status,200,JSON.stringify(directory.body));
  const familyId=directory.body.family.id;
  assert.equal((await request('/people/'+father.id,{name:'Renamed father',side:'a',title:'Rabbi'},admin.cookie,'PUT')).status,200);
  const household=(await request('/directory',undefined,admin.cookie)).body.families.find(f=>f.id===familyId);
  assert.match(household.parents,/Renamed father/);
  assert.match(household.parents,/Structured mother/);
  const calendar=(await request('/yahrzeits',undefined,admin.cookie)).body.yahrzeits;
  const fatherYz=calendar.find(y=>y.person_id===father.id);
  assert.ok(fatherYz);assert.equal(fatherYz.name,'Rabbi Renamed father');assert.equal(fatherYz.hday,12);
  assert.equal(calendar.length,1,'unknown dates must not invent yahrzeits');
  assert.equal((await request('/yahrzeits/'+fatherYz.id,{name:'Drift',side:'a',hday:1,hmonth:'AV'},admin.cookie,'PUT')).status,400);
  assert.equal((await request('/people/'+mother.id,{name:'Structured mother',side:'a',mother_id:son.id},admin.cookie,'PUT')).status,400,'reject cycles through mother');
  assert.equal((await request('/people/'+son.id,{name:'Structured son',side:'a',father_id:mother.id,mother_id:mother.id},admin.cookie,'PUT')).status,400);
  assert.equal((await request('/people/'+father.id,undefined,admin.cookie,'DELETE')).status,400,'do not cascade-delete linked family members');
  const sharedPerson=await createPerson({name:'Shared person',side:'both'});
  assert.equal((await request('/people/'+son.id,{name:'Structured son',side:'a',spouse_id:sharedPerson.id},admin.cookie,'PUT')).status,400,'reciprocal spouse links must not expose private people through shared records');
  const hiddenPerson=await createPerson({name:'Hidden B father',side:'b'});
  assert.equal((await request('/people/'+son.id,{name:'Structured son',side:'a',father_id:hiddenPerson.id},admin.cookie,'PUT')).status,400,'do not leak another side via links');
  assert.equal((await request('/directory',undefined,b.cookie)).body.families.length,0);
  assert.equal((await request('/directory/'+familyId,{husband:'unauthorized',side:'a'},b.cookie,'PUT')).status,404);
  assert.equal((await request('/directory',{husband_person_id:son.id,side:'both'},admin.cookie)).status,400,'a shared household cannot expose a private person');
  assert.equal((await request('/people/'+father.id,{name:'Renamed father',side:'b'},admin.cookie,'PUT')).status,400,'reject moving linked data behind another side');
  assert.equal((await request('/people/'+father.id,{name:'Renamed father',side:'a',death_hday:31},admin.cookie,'PUT')).status,400);
  assert.equal((await request('/people/'+wife.id,{name:'Structured spouse',side:'a',spouse_id:null},admin.cookie,'PUT')).status,200);
  assert.equal((await request('/people',undefined,admin.cookie)).body.people.find(p=>p.id===son.id).spouse_id,null);
  assert.equal((await request('/people/'+wife.id,{name:'Structured spouse',side:'a',spouse_id:son.id},admin.cookie,'PUT')).status,200);
  const contenders=await Promise.all([['Race 1','a'],['Race 2','a']].map(([name,side])=>createPerson({name,side})));
  const cycleRace=await Promise.all(contenders.map((p,i)=>request('/people/'+p.id,{name:p.name,side:'a',father_id:contenders[1-i].id},admin.cookie,'PUT')));
  assert.deepEqual(cycleRace.map(r=>r.status).sort(),[200,400]);
  // Saving a household is transactional, and does not overwrite canonical names.
  assert.equal((await request('/directory/'+familyId,{husband:'Stale copy',wife:'Stale copy',side:'a'},admin.cookie,'PUT')).status,200);
  assert.equal((await request('/directory',undefined,admin.cookie)).body.families.find(f=>f.id===familyId).husband,'Structured son');
  assert.equal((await request('/people/'+father.id,{name:'Renamed father',side:'a',death_hday:null,death_hmonth:null},admin.cookie,'PUT')).status,200);
  assert.equal((await request('/yahrzeits',undefined,admin.cookie)).body.yahrzeits.length,0);

 }finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}
  await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);await adminPool.end();await rm(data,{recursive:true,force:true});
 }
});
