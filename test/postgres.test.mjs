import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
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
 const capture=path.join(data,'email.jsonl');
 const env={...process.env,DATABASE_URL:conn.toString(),FAMILYE_DATA:data,ADMIN_NAME:'Build test admin',ADMIN_PHONE:'8455550100',SETUP_TOKEN_SHA256:createHash('sha256').update(setup).digest('hex'),QA_PHONE_PREFIX:'',COOKIE_SECURE:'false',PORT:'18080',HOST:'127.0.0.1',LOG_LEVEL:'error',RESEND_API_KEY:'test-only',RESEND_FROM_EMAIL:'Family <noreply@example.test>',FAMILYE_EMAIL_CAPTURE:capture,NODE_OPTIONS:'--import='+new URL('./resend-mock.mjs',import.meta.url).pathname};
 let child;let logs='';
 const run=(entry)=>{const p=spawn(process.execPath,[entry],{env,stdio:['ignore','pipe','pipe']});p.stdout.on('data',x=>logs+=x);p.stderr.on('data',x=>logs+=x);return p;};
 const base='http://127.0.0.1:18080';
 const request=async(endpoint,body,cookie='',method=body===undefined?'GET':'POST',ip='127.0.0.1')=>{
  const r=await fetch(base+'/api'+endpoint,{method,headers:{'x-familye':'1','x-forwarded-for':ip,...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
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
  // Invitation audiences are fixed by the server, for one side or both.
  const inviteRequest=(endpoint,body,cookie='',method=body===undefined?'GET':'POST')=>request(endpoint,body,cookie,method,'127.0.0.44');
  assert.equal((await inviteRequest('/family-invitations',{sides:['a']})).status,401);
  assert.equal((await inviteRequest('/family-invitations',{sides:['a','b']},a.cookie)).status,403);
  assert.equal((await inviteRequest('/family-invitations',{sides:['invalid']},admin.cookie)).status,400);
  for(const sides of [['a'],['b'],['a','b']]) {
    const made=await inviteRequest('/family-invitations',{sides},sides.length===1?(sides[0]==='a'?a:b).cookie:admin.cookie);
    assert.equal(made.status,200,JSON.stringify(made.body));
    const token=made.body.link.split('#join=')[1];assert.equal(token.length,32);
    assert.deepEqual((await inviteRequest('/family-invitations/'+token)).body.sides,sides);
    const newcomer=await inviteRequest('/auth/signup',{name:'Invited cousin '+sides.join(''),phone:'84555502'+(sides.length===2?'03':sides[0]==='a'?'01':'02'),password:'invited-password',sides:['a','b'],invitation_token:token});
    assert.equal(newcomer.status,200,JSON.stringify(newcomer.body));
    assert.deepEqual(newcomer.body.user.sides,sides,'ignore client attempts to add another side');
    assert.equal(newcomer.body.user.status,'pending');
    assert.equal((await inviteRequest('/people',undefined,newcomer.cookie)).status,403);
    assert.equal((await inviteRequest('/family-invitations',{sides},newcomer.cookie)).status,403);
    const db=new pg.Pool({connectionString:conn.toString()});
    try {
      const row=(await db.query('SELECT invited_by FROM users WHERE id=$1',[newcomer.body.user.id])).rows[0];
      assert.equal(row.invited_by,sides.length===1?(sides[0]==='a'?a:b).body.user.id:admin.body.user.id);
      await db.query('UPDATE family_invitations SET expires_at=now()-interval \'1 second\' WHERE token_hash=$1',[createHash('sha256').update(token).digest('hex')]);
    } finally {await db.end();}
    assert.equal((await inviteRequest('/family-invitations/'+token)).status,404);
    assert.equal((await inviteRequest('/auth/signup',{name:'Expired',phone:'8455550299',password:'invited-password',invitation_token:token})).status,404);
  }
  assert.equal((await inviteRequest('/family-invitations/not-a-token')).status,400);
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
  const addressParts={address_line1:'12 Main St',address_line2:'Apt 2B',city:'Monsey',state:'NY',postal_code:'01001',country:'United States'};
  assert.equal((await request('/directory/'+familyId,addressParts,admin.cookie,'PUT')).status,200);
  let savedAddress=(await request('/directory',undefined,admin.cookie)).body.families.find(f=>f.id===familyId);
  for(const [key,value] of Object.entries(addressParts))assert.equal(savedAddress[key],value);
  assert.equal(savedAddress.address,'12 Main St, Apt 2B, Monsey NY 01001, United States');
  await request('/directory/'+familyId,{phone_h:'8455550123'},admin.cookie,'PUT');
  savedAddress=(await request('/directory',undefined,admin.cookie)).body.families.find(f=>f.id===familyId);
  assert.equal(savedAddress.postal_code,'01001','unrelated edits preserve structured address and leading zeroes');
  await request('/directory/'+familyId,{address:'Old free-text address'},admin.cookie,'PUT');
  savedAddress=(await request('/directory',undefined,admin.cookie)).body.families.find(f=>f.id===familyId);
  assert.equal(savedAddress.address,'Old free-text address');assert.equal(savedAddress.address_line1,null);
  await request('/directory/'+familyId,{...addressParts,address_line2:''},admin.cookie,'PUT');
  const csv=await fetch(base+'/api/directory.csv',{headers:{Cookie:admin.cookie}});
  assert.equal(csv.status,200);assert.match(await csv.text(),/12 Main St, Monsey NY 01001, United States/);
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
  // Replit schema sync can create the DDL before bootstrap records migration 003.
  // Running the migration SQL again preserves data and completes its backfills.
  const familyMigration=await readFile(new URL('../db/migrations/003_family_memberships.sql',import.meta.url),'utf8');
  await adminPool.query(`SET search_path TO ${schema}`);
  await adminPool.query(familyMigration);
  // Family memberships describe ancestry/marriage and never grant account access.
  const memberA=await request('/people/'+father.id,{new_family:'Family A'},admin.cookie,'PUT');
  assert.equal(memberA.status,200,JSON.stringify(memberA.body));
  const readPerson=async id=>(await request('/people',undefined,admin.cookie)).body.people.find(p=>p.id===id);
  const familyA=(await readPerson(father.id)).families[0];
  assert.equal((await request('/people/'+father.id,{new_family:'Family B'},admin.cookie,'PUT')).status,200);
  const memberships=(await readPerson(father.id)).families;
  assert.equal(memberships.length,2);
  assert.equal((await request('/people/'+son.id,{family_ids:memberships.map(f=>f.id)},admin.cookie,'PUT')).status,200);
  assert.equal((await request('/people/'+son.id,{note:'Preserve affiliations'},admin.cookie,'PUT')).status,200);
  assert.equal((await readPerson(son.id)).families.length,2);
  assert.equal((await request('/people/'+son.id,{name:'Must roll back',family_ids:[2147483647],new_family:'Rollback family'},admin.cookie,'PUT')).status,400);
  assert.equal((await readPerson(son.id)).name,'Structured son');
  assert.equal((await request('/people/'+son.id,{family_ids:[],new_family:'family a'},admin.cookie,'PUT')).status,200);
  assert.deepEqual((await readPerson(son.id)).families.map(f=>f.id),[familyA.id]);
  assert.equal((await request('/people/'+son.id,{family_ids:[]},admin.cookie,'PUT')).status,200);
  assert.equal((await readPerson(son.id)).families.length,0);
  assert.equal((await request('/people',undefined,b.cookie)).body.people.some(p=>p.id===father.id),false);
  assert.equal((await readPerson(father.id)).lineage_term,'בן');
  assert.equal((await readPerson(mother.id)).lineage_term,'בת');
  const grandparent=await createPerson({name:'Lineage grandfather',title:'Rabbi'});
  assert.equal((await request('/people/'+father.id,{father_id:grandparent.id},admin.cookie,'PUT')).status,200);
  const linkedCalendar=(await request('/yahrzeits',undefined,admin.cookie)).body.yahrzeits.find(y=>y.person_id===father.id);
  assert.equal(linkedCalendar.father_name,'בן Rabbi Lineage grandfather');
  assert.equal(linkedCalendar.families.length,2);
  assert.equal((await request('/people/'+father.id,{lineage_term:'wrong'},admin.cookie,'PUT')).status,400);
  // Saving a household is transactional, and does not overwrite canonical names.
  assert.equal((await request('/directory/'+familyId,{husband:'Stale copy',wife:'Stale copy',side:'a'},admin.cookie,'PUT')).status,200);
  assert.equal((await request('/directory',undefined,admin.cookie)).body.families.find(f=>f.id===familyId).husband,'Structured son');
  assert.equal((await request('/people/'+father.id,{name:'Renamed father',side:'a',death_hday:null,death_hmonth:null},admin.cookie,'PUT')).status,200);
  assert.equal((await request('/yahrzeits',undefined,admin.cookie)).body.yahrzeits.length,0);

  // Public recovery never reveals account existence or creates a reset token.
  assert.equal((await request('/auth/forgot-password',{phone:'123'})).status,400);
  const recovery=await request('/auth/forgot-password',{phone:'(845) 555-0101'});
  assert.deepEqual(recovery.body,{ok:true});
  assert.deepEqual((await request('/auth/forgot-password',{phone:'8455550999'})).body,recovery.body);
  assert.deepEqual((await request('/auth/forgot-password',{phone:'+1 845 555 0101'})).body,recovery.body);
  assert.equal((await request('/admin/users',undefined,a.cookie)).status,401);
  assert.equal((await request('/admin/users',undefined,b.cookie)).status,403);
  const recoveryUsers=(await request('/admin/users',undefined,admin.cookie)).body.users;
  assert.ok(recoveryUsers.find(u=>u.id===a.body.user.id).reset_requested_at);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM password_reset_requests')).rows[0].n,1);
  assert.equal((await request(`/admin/users/${a.body.user.id}/reset-link`,{},b.cookie)).status,403);
  const first=await request(`/admin/users/${a.body.user.id}/reset-link`,{},admin.cookie);
  assert.equal(first.status,200);assert.equal(first.body.hours,1);
  const firstToken=first.body.link.split('#setpw=')[1];
  const second=await request(`/admin/users/${a.body.user.id}/reset-link`,{},admin.cookie);
  const secondToken=second.body.link.split('#setpw=')[1];
  assert.equal((await request('/auth/token/'+firstToken)).status,404,'issuing another link invalidates the previous one');
  assert.equal((await request('/auth/token/'+secondToken)).status,200);
  assert.equal((await request('/auth/set-password',{token:secondToken,password:'short'})).status,400);
  const resetRace=await Promise.all([1,2].map(()=>request('/auth/set-password',{token:secondToken,password:'new-member-password'})));
  assert.deepEqual(resetRace.map(r=>r.status).sort(),[200,404],'one reset may consume the token');
  const winner=resetRace.find(r=>r.status===200);
  assert.equal((await request('/people',undefined,winner.cookie)).status,200);
  assert.equal((await request('/people',undefined,again.cookie)).status,401,'previous sessions revoked');
  assert.equal((await request('/auth/login',{phone:'8455550101',password:'build-member-password'})).status,401);
  assert.equal((await request('/auth/login',{phone:'8455550101',password:'new-member-password'})).status,200);
  assert.equal((await request('/auth/token/'+secondToken)).status,404);
  assert.equal((await request('/admin/users',undefined,admin.cookie)).body.users.find(u=>u.id===a.body.user.id).reset_requested_at,null);
  const expired=await request(`/admin/users/${a.body.user.id}/reset-link`,{},admin.cookie);
  const expiredToken=expired.body.link.split('#setpw=')[1];
  await adminPool.query("UPDATE password_tokens SET expires_at=now()-interval '1 minute' WHERE user_id=$1",[a.body.user.id]);
  assert.equal((await request('/auth/token/'+expiredToken)).status,404);
  assert.equal((await request('/auth/set-password',{token:expiredToken,password:'must-not-change'})).status,404);
  assert.equal((await request('/auth/forgot-password',{phone:'8455550101'})).status,200);
  assert.equal((await request('/auth/forgot-password',{phone:'8455550101'})).status,429,'public requests are rate limited');

  const mailRequest=(endpoint,body,cookie,method)=>request(endpoint,body,cookie,method,'192.0.2.30');
  const emails=async()=>(await readFile(capture,'utf8')).trim().split('\n').map(JSON.parse);
  const verificationToken=m=>m.text.match(/#verifyemail=([A-Za-z0-9_-]+)/)[1];
  assert.equal((await mailRequest('/me',{name:'Build test admin',email:'not-email'},admin.cookie,'PATCH')).status,400);
  assert.equal((await mailRequest('/me',{name:'Build test admin',email:'Owner@Example.TEST'},admin.cookie,'PATCH')).status,200);
  assert.equal((await mailRequest('/me/email-verification',{password:'wrong'},admin.cookie)).status,400);
  assert.equal((await mailRequest('/me/email-verification',{password:'build-admin-password'},admin.cookie)).status,200);
  const mail1=(await emails()).at(-1);assert.deepEqual(mail1.to,['owner@example.test']);
  const verifyToken=verificationToken(mail1);
  assert.equal((await mailRequest('/auth/verify-email',{token:verifyToken})).status,200);
  assert.equal((await mailRequest('/auth/verify-email',{token:verifyToken})).status,400,'verification is single use');
  assert.equal((await mailRequest('/me',undefined,admin.cookie)).body.user.email_verified,true);
  const before=(await emails()).length;
  assert.equal((await mailRequest('/auth/forgot-password',{phone:'8455550100'})).status,200);
  const resetEmail=(await emails()).at(-1);assert.equal((await emails()).length,before+1);
  const resetToken=resetEmail.text.match(/#setpw=([A-Za-z0-9_-]+)/)[1];
  assert.equal((await mailRequest('/auth/token/'+resetToken)).status,200);
  await mailRequest('/auth/forgot-password',{phone:'8455550100'});
  assert.equal((await emails()).length,before+1,'duplicate requests must not resend');
  assert.equal((await mailRequest('/me',{name:'Side B test',email:'owner@example.test'},b.cookie,'PATCH')).status,200);
  assert.equal((await mailRequest('/me/email-verification',{password:'build-member-password'},b.cookie)).status,409,'a verified email cannot belong to two accounts');
  await mailRequest('/me',{name:'Build test admin',email:'changed@example.test'},admin.cookie,'PATCH');
  assert.equal((await mailRequest('/me',undefined,admin.cookie)).body.user.email_verified,false);
  assert.equal((await mailRequest('/auth/token/'+resetToken)).status,404,'changing email invalidates outstanding recovery links');
  await mailRequest('/me/email-verification',{password:'build-admin-password'},admin.cookie);
  const stale=verificationToken((await emails()).at(-1));
  await mailRequest('/me',{name:'Build test admin',email:'failure@example.test'},admin.cookie,'PATCH');
  assert.equal((await mailRequest('/auth/verify-email',{token:stale})).status,400,'a link for a changed address cannot verify the new email');
  assert.equal((await mailRequest('/me/email-verification',{password:'build-admin-password'},admin.cookie)).status,503,'provider failure is reported without confirming the email');

  // Phone changes require this member's password and preserve a stable owner identity.
  assert.equal((await request('/me/phone',{phone:'8455550109',password:'build-admin-password'},a.cookie)).status,401);
  assert.equal((await request('/me/phone',{phone:'123',password:'build-admin-password'},admin.cookie)).status,400);
  assert.equal((await request('/me/phone',{phone:'8455550109',password:'wrong'},admin.cookie)).status,400);
  assert.equal((await request('/me/phone',{phone:'8455550102',password:'build-admin-password'},admin.cookie)).status,409);
  const otherAdminSession=await request('/auth/login',{phone:'8455550100',password:'build-admin-password'});
  const samePhone=await request('/me/phone',{phone:'(845) 555-0100',password:'build-admin-password'},admin.cookie);
  assert.equal(samePhone.status,200);assert.equal(samePhone.body.user.phone,'18455550100');
  assert.equal((await request('/people',undefined,otherAdminSession.cookie)).status,200,'saving the same phone keeps other sessions');
  const ownerReset=await request(`/admin/users/${admin.body.user.id}/reset-link`,{},admin.cookie);
  const changedPhone=await request('/me/phone',{phone:'+1 (845) 555-0109',password:'build-admin-password',user_id:b.body.user.id},admin.cookie);
  assert.equal(changedPhone.status,200);assert.equal(changedPhone.body.user.phone,'18455550109');
  assert.equal(changedPhone.body.user.id,admin.body.user.id,'only the signed-in account can change');
  assert.equal((await request('/me',undefined,admin.cookie)).body.user.phone,'18455550109');
  assert.equal((await request('/people',undefined,otherAdminSession.cookie)).status,401,'other sessions expire');
  assert.equal((await request('/auth/token/'+ownerReset.body.link.split('#setpw=')[1])).status,404,'old reset links expire');
  assert.equal((await request('/auth/login',{phone:'8455550100',password:'build-admin-password'})).status,401);
  assert.equal((await request('/auth/login',{phone:'8455550109',password:'build-admin-password'})).status,200);
  const reboot=run('dist/bootstrap.js');assert.equal((await once(reboot,'exit'))[0],0,logs);
  assert.equal((await adminPool.query('SELECT count(*)::int n FROM users WHERE is_admin')).rows[0].n,1,'bootstrap must not recreate the owner at the old number');
  assert.equal((await request('/admin/users',undefined,admin.cookie)).body.owner_phone,'18455550109');
  await request('/admin/users/'+b.body.user.id,{is_admin:true},admin.cookie,'PATCH');
  assert.equal((await request('/admin/users/'+admin.body.user.id,{is_admin:false},b.cookie,'PATCH')).status,403);
  assert.equal((await request('/admin/users/'+admin.body.user.id,undefined,b.cookie,'DELETE')).status,403);
  const phoneRace=await Promise.all([
    request('/me/phone',{phone:'8455550199',password:'new-member-password'},winner.cookie),
    request('/me/phone',{phone:'+1 845 555 0199',password:'build-member-password'},b.cookie)
  ]);
  assert.deepEqual(phoneRace.map(r=>r.status).sort(),[200,409],'two accounts cannot claim the same phone');

 }finally{
  if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}
  await adminPool.query(`DROP SCHEMA ${schema} CASCADE`);await adminPool.end();await rm(data,{recursive:true,force:true});
 }
});

