import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import pg from 'pg';

test('families isolate owners, members, invitations, records, chat and direct URLs',{skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
 const db=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
 const schema='isolation_'+randomBytes(8).toString('hex');await db.query(`CREATE SCHEMA ${schema}`);
 const conn=new URL(process.env.TEST_DATABASE_URL);conn.searchParams.set('options',`-c search_path=${schema}`);
 const data=await mkdtemp(tmpdir()+'/family-isolation-'),setup=randomBytes(32).toString('hex');
 const env={...process.env,DATABASE_URL:conn.toString(),FAMILYE_DATA:data,ADMIN_NAME:'Global admin',ADMIN_PHONE:'8455559000',SETUP_TOKEN_SHA256:createHash('sha256').update(setup).digest('hex'),QA_PHONE_PREFIX:'',COOKIE_SECURE:'false',PORT:'18082',HOST:'127.0.0.1',LOG_LEVEL:'error'};
 let logs='',server;
 const start=entry=>{const p=spawn(process.execPath,[entry],{env,stdio:['ignore','pipe','pipe']});p.stdout.on('data',x=>logs+=x);p.stderr.on('data',x=>logs+=x);return p;};
 let seq=1;
 const req=async(path,body,cookie='',method=body===undefined?'GET':'POST',group)=>{
  const r=await fetch('http://127.0.0.1:18082/api'+path,{method,headers:{'x-familye':'1','x-forwarded-for':'127.0.1.'+(seq++%240+1),...(cookie?{cookie}:{}),...(group?{'x-family-group':String(group)}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await r.text();let value;try{value=JSON.parse(text);}catch{value=text;}
  return {status:r.status,body:value,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
 };
 const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.body)+'\n'+logs);return r.body;};
 try{
  const boot=start('dist/bootstrap.js');assert.equal((await once(boot,'exit'))[0],0,logs);
  server=start('dist/index.js');for(let i=0;i<80;i++){try{if((await req('/health')).status===200)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const root=await req('/auth/set-password',{token:setup,password:'test-root-password'});ok(root);
  assert.equal((await req('/auth/signup',{name:'Unassigned',phone:'8455559099',password:'test-password',sides:['a']})).status,403);
  const own=async(name,phone)=>{const r=await req('/auth/signup',{name:name+' owner',phone,password:'test-password',create_family:name,is_admin:true});ok(r);assert.equal(r.body.user.is_admin,false);assert.equal(r.body.user.is_family_admin,true);return r;};
  const a=await own('Bochner-Biderman','8455559001'),b=await own('Parnes','8455559002');
  const ga=a.body.user.family_group_id,gb=b.body.user.family_group_id;assert.notEqual(ga,gb);
  assert.equal((await req('/people',undefined,a.cookie,'GET',gb)).status,403,'cannot spoof another family header');
  assert.equal((await req('/admin/users/'+b.body.user.id,{is_family_admin:true},a.cookie,'PATCH')).status,404);
  assert.equal((await req('/admin/users/'+a.body.user.id,{is_admin:true},a.cookie,'PATCH')).status,403,'family owner cannot promote to global admin');
  assert.equal((await req('/admin/settings',{family_yi:'Overwrite'},a.cookie,'PUT')).status,403);
  assert.equal((await req('/admin/family-groups',{name:'Other'},a.cookie)).status,403);
  assert.equal((await req('/admin/unassigned-records',undefined,a.cookie)).status,403);
  assert.equal(ok(await req('/admin/family-groups',undefined,a.cookie)).groups.length,1);
  const inv=ok(await req('/family-invitations',{sides:['a','b']},a.cookie));const token=inv.link.split('#join=')[1];
  assert.equal(ok(await req('/family-invitations/'+token)).family_name,'Bochner-Biderman');
  const m=await req('/auth/signup',{name:'Cousin',phone:'8455559003',password:'test-password',invitation_token:token,family_group_id:gb,is_family_admin:true,is_admin:true,create_family:'Spoof'},'');ok(m);
  assert.equal(m.body.user.family_group_id,ga);assert.equal(m.body.user.is_family_admin,false);assert.equal(m.body.user.is_admin,false);
  assert.equal((await req('/admin/users',undefined,m.cookie)).status,403);
  const person=async(owner,name)=>ok(await req('/people',{name,side:'both',life_status:'deceased',death_hday:1,death_hmonth:'TISHREI',new_family:name+' label',family_group_id:gb},owner.cookie)).person;
  const pa=await person(a,'A ancestor'),pb=await person(b,'B ancestor');assert.equal(pa.family_group_id,ga,'body group ignored');
  const ya=ok(await req('/yahrzeits',undefined,a.cookie)).yahrzeits[0],yb=ok(await req('/yahrzeits',undefined,b.cookie)).yahrzeits[0];
  const la=ok(await req('/lists',{kind:'tehillim',yahrzeit_id:ya.id},a.cookie)).list;
  const lb=ok(await req('/lists',{kind:'tehillim',yahrzeit_id:yb.id},b.cookie)).list;
  const da=ok(await req('/directory',{husband_person_id:pa.id,side:'both'},a.cookie)).family;
  const sb=ok(await req('/simchas',{kind:'Wedding',whose:'B private',gdate:'2099-01-01',audience:'all'},b.cookie)).simcha;
  const ma=ok(await req('/chat/all',{body:'A private chat'},a.cookie)).message;
  const mb=ok(await req('/chat/all',{body:'B private chat'},b.cookie)).message;
  for(const endpoint of ['/people','/yahrzeits','/lists','/simchas','/directory','/home','/chat/all','/chat-summary','/chat-members','/directory.csv']){
   const r=await req(endpoint,undefined,m.cookie);ok(r);assert.doesNotMatch(JSON.stringify(r.body),/B ancestor|B private|Parnes|B ancestor label/,endpoint);
  }
  for(const [url,body,method] of [
   ['/people/'+pb.id,{name:'Hijack'},'PUT'],['/people/'+pb.id,undefined,'DELETE'],
   ['/people',{name:'Link attack',side:'both',father_id:pb.id},'POST'],
   ['/lists/'+lb.id,undefined,'GET'],['/lists/'+lb.id+'/items/1',{action:'take'},'POST'],
   ['/yahrzeits/'+yb.id+'/remind',{on:true},'POST'],['/yahrzeits/'+yb.id,undefined,'DELETE'],
   ['/lists',{kind:'tehillim',yahrzeit_id:yb.id},'POST'],
   ['/simchas/'+sb.id+'/rsvp',{answer:'yes',people:1},'POST'],
   ['/chat/message/'+mb.id,undefined,'DELETE'],['/chat/all',{body:'Reply attack',reply_to:mb.id},'POST'],
   ['/directory',{husband_person_id:pb.id,side:'both'},'POST']]) assert.equal((await req(url,body,m.cookie,method)).status,404,url);
  const peers=ok(await req('/chat-members',undefined,m.cookie)).members;assert.ok(peers.every(p=>p.id!==b.body.user.id));
  assert.equal((await req('/chat/dm:'+Math.min(m.body.user.id,b.body.user.id)+':'+Math.max(m.body.user.id,b.body.user.id),undefined,m.cookie)).status,403);
  // Family owner can correct another member's content only inside the same family.
  const child=ok(await req('/people',{name:'Member child',side:'a',father_id:pa.id},m.cookie)).person;
  ok(await req('/people/'+child.id,{name:'Corrected child'},a.cookie,'PUT'));
  assert.equal((await req('/people/'+pb.id,{name:'Not mine'},a.cookie,'PUT')).status,404);
  // Global admin can select either family without broadening ordinary membership.
  assert.equal(ok(await req('/people',undefined,root.cookie,'GET',gb)).people[0].id,pb.id);
  ok(await req('/people/'+pb.id,{note:'Global correction'},root.cookie,'PUT',gb));
  // Legacy records remain hidden; explicit assignment is atomic and checked for cross-family edges.
  const legacy=(await db.query(`INSERT INTO ${schema}.people(name,side) VALUES('Legacy hidden','a') RETURNING id`)).rows[0];
  assert.ok(!JSON.stringify(ok(await req('/people',undefined,a.cookie))).includes('Legacy hidden'));
  ok(await req('/admin/assign-records',{family_group_id:ga,records:{people:[legacy.id]}},root.cookie));
  assert.ok(JSON.stringify(ok(await req('/people',undefined,a.cookie))).includes('Legacy hidden'));
  assert.equal((await req('/admin/assign-records',{family_group_id:gb,records:{people:[legacy.id]}},root.cookie)).status,409);
  await assert.rejects(db.query(`UPDATE ${schema}.people SET father_id=$1 WHERE id=$2`,[pb.id,child.id]),/foreign key/);
  // Uploaded files are protected even when the attacker guesses the file URL.
  await db.query(`INSERT INTO ${schema}.files(id,filename,mime,size,content,uploaded_by,chat_room,family_group_id) VALUES('private-b','secret.txt','text/plain',6,$1,$2,'all',$3)`,[Buffer.from('secret'),b.body.user.id,gb]);
  assert.equal((await req('/files/private-b',undefined,m.cookie)).status,404);
  assert.equal((await req('/chat/all',{file_id:'private-b'},m.cookie)).status,404);
  // Concurrent requests must not bleed request-local family defaults or filters.
  const mixed=await Promise.all(Array.from({length:12},(_,i)=>req('/people',{name:'Concurrent '+i,side:'a'},i%2?a.cookie:b.cookie)));
  mixed.forEach((r,i)=>assert.equal(ok(r).person.family_group_id,i%2?ga:gb));
  // Duplicate gate: existing person choices, explicit same-name exceptions and review.
  const duplicate={name:'Corrected child',side:'a',father_id:pa.id};
  const warning=await req('/people',duplicate,m.cookie);assert.equal(warning.status,409);assert.equal(warning.body.details.matches[0].id,child.id);
  const submitted={...duplicate,confirm_distinct:true,distinct_reason:'Two different sons with a similar recorded name',request_key:randomBytes(16).toString('hex')};
  const queued=ok(await req('/people',submitted,m.cookie));assert.ok(queued.pending_review);assert.equal(queued.person,undefined);
  assert.deepEqual(ok(await req('/people',submitted,m.cookie)),queued,'retry returns the same review');
  assert.equal((await req('/person-reviews/'+queued.pending_review+'/resolve',{action:'approve'},m.cookie)).status,403);
  assert.equal((await req('/person-reviews/'+queued.pending_review+'/resolve',{action:'approve'},b.cookie)).status,404);
  const reused=ok(await req('/person-reviews/'+queued.pending_review+'/resolve',{action:'existing',existing_person_id:child.id},a.cookie));assert.equal(reused.person.id,child.id);
  assert.equal(ok(await req('/people',undefined,a.cookie)).people.filter(p=>p.name==='Corrected child').length,1);
  const again=ok(await req('/people',{...submitted,request_key:randomBytes(16).toString('hex')},m.cookie));
  const approved=ok(await req('/person-reviews/'+again.pending_review+'/resolve',{action:'approve'},a.cookie));assert.ok(approved.person.id!==child.id);
  assert.equal((await req('/person-reviews/'+again.pending_review+'/resolve',{action:'approve'},a.cookie)).status,409);
  // Same name alone is allowed only with a deliberate explanation, and repeated saves are idempotent.
  const weak={name:'A ancestor',side:'a',confirm_distinct:true,distinct_reason:'Different relative with the same name',request_key:randomBytes(16).toString('hex')};
  const results=await Promise.all([req('/people',weak,m.cookie),req('/people',weak,m.cookie)]);assert.equal(ok(results[0]).person.id,ok(results[1]).person.id);
  assert.equal((await req('/people',{...weak,name:'Changed payload'},m.cookie)).status,409);
  const before=ok(await req('/people',undefined,a.cookie)).people.length;
  const inline=await req('/people',{name:'Inline duplicate test',side:'a',new_relatives:{father_id:{name:'A ancestor'}}},m.cookie);
  assert.equal(inline.status,409);assert.equal(inline.body.details.field,'father_id');
  assert.equal(ok(await req('/people',undefined,a.cookie)).people.length,before,'blocked inline save leaves no orphan');
  // Naming normalization catches punctuation/spacing variations; another family is never exposed.
  assert.equal((await req('/people',{name:'A  ANCESTOR!',side:'a'},m.cookie)).status,409);
  assert.equal((await req('/people',{name:'B ancestor',side:'a'},m.cookie)).status,200);
  // A review cannot overwrite a person corrected after submission.
  const editCandidate=ok(await req('/people',{name:'Edit original',side:'a'},m.cookie)).person;
  const editQueued=ok(await req('/people/'+editCandidate.id,{...submitted,request_key:randomBytes(16).toString('hex')},m.cookie,'PUT'));
  ok(await req('/people/'+editCandidate.id,{note:'A newer correction'},a.cookie,'PUT'));
  assert.equal((await req('/person-reviews/'+editQueued.pending_review+'/resolve',{action:'approve'},a.cookie)).status,409);
  // Two marriages retain one father, separate mothers, and reciprocal links.
  const wife1=ok(await req('/people',{name:'First wife',side:'a'},a.cookie)).person;
  const wife2=ok(await req('/people',{name:'Second wife',side:'a'},a.cookie)).person;
  const husband=ok(await req('/people',{name:'Shared father',side:'a',spouse_id:wife1.id,second_spouse_id:wife2.id},a.cookie)).person;
  const kid1=ok(await req('/people',{name:'First marriage child',side:'a',father_id:husband.id,mother_id:wife1.id},a.cookie)).person;
  const kid2=ok(await req('/people',{name:'Second marriage child',side:'a',father_id:husband.id,mother_id:wife2.id},a.cookie)).person;
  let family=ok(await req('/people',undefined,a.cookie)).people;
  assert.equal(family.find(p=>p.id===wife2.id).spouse_id,husband.id,'his second marriage can be her first');
  assert.equal(family.find(p=>p.id===husband.id).second_spouse_name,'Second wife');
  assert.equal((await req('/people/'+husband.id,{second_spouse_id:pb.id},a.cookie,'PUT')).status,404);
  assert.equal((await req('/people/'+husband.id,{second_spouse_id:wife1.id},a.cookie,'PUT')).status,400);
  assert.equal((await req('/people',{name:'Third partner blocked',side:'a',spouse_id:husband.id},a.cookie)).status,400);
  const inlineSecond=await req('/people',{name:'Inline second duplicate',side:'a',new_relatives:{second_spouse_id:{name:'Second wife'}}},a.cookie);
  assert.equal(inlineSecond.status,409);assert.equal(inlineSecond.body.details.field,'second_spouse_id');
  // Admin can correct order without changing the children or duplicating anyone.
  ok(await req('/people/'+husband.id,{spouse_id:wife2.id,second_spouse_id:wife1.id},a.cookie,'PUT'));
  family=ok(await req('/people',undefined,a.cookie)).people;
  assert.equal(family.find(p=>p.id===kid1.id).mother_id,wife1.id);
  assert.equal(family.find(p=>p.id===kid2.id).mother_id,wife2.id);
  assert.equal(family.filter(p=>p.name==='Shared father').length,1);
  ok(await req('/people/'+husband.id,{second_spouse_id:null},a.cookie,'PUT'));
  family=ok(await req('/people',undefined,a.cookie)).people;
  assert.equal(family.find(p=>p.id===wife1.id).spouse_id,null);
  assert.equal(family.find(p=>p.id===kid1.id).mother_id,wife1.id);
  await assert.rejects(db.query(`UPDATE ${schema}.people SET second_spouse_id=$1 WHERE id=$2`,[pb.id,husband.id]),/foreign key/);
  // Family ownership can correct its own name but cannot rename another group.
  ok(await req('/admin/family-groups/'+ga,{name:'Bochner-Biderman corrected'},a.cookie,'PATCH'));
  assert.equal((await req('/admin/family-groups/'+gb,{name:'Hijacked'},a.cookie,'PATCH')).status,404);
  // A legacy account in the holding group cannot log in or use an existing session.
  const holding=(await db.query(`SELECT id FROM ${schema}.family_groups WHERE is_quarantine`)).rows[0].id;
  await db.query(`UPDATE ${schema}.users SET family_group_id=$1 WHERE id=$2`,[holding,b.body.user.id]);
  assert.equal((await req('/people',undefined,b.cookie)).status,403);
  assert.equal((await req('/auth/login',{phone:'8455559002',password:'test-password'})).status,403);
  await db.query(`UPDATE ${schema}.users SET family_group_id=$1 WHERE id=$2`,[gb,b.body.user.id]);
  // Reassignment invalidates old sessions, family-admin authority and member-generated invites.
  ok(await req('/admin/users/'+m.body.user.id,{is_family_admin:true},a.cookie,'PATCH'));
  assert.equal(ok(await req('/me',undefined,m.cookie)).user.is_family_admin,true);
  const memberInvite=ok(await req('/family-invitations',{sides:['a']},m.cookie)).link.split('#join=')[1];
  ok(await req('/admin/users/'+m.body.user.id+'/family-group',{family_group_id:gb},root.cookie,'PUT'));
  assert.equal((await req('/people',undefined,m.cookie)).status,401);
  assert.equal((await req('/family-invitations/'+memberInvite)).status,404);
  const moved=await req('/auth/login',{phone:'8455559003',password:'test-password'});ok(moved);assert.equal(moved.body.user.is_family_admin,false);
  assert.doesNotMatch(JSON.stringify(ok(await req('/people',undefined,moved.cookie))),/A ancestor|Corrected child|Legacy hidden/);
  // Explicit one-to-four memberships, with one selected family per request.
  const extra=[];for(const name of ['Third access family','Fourth access family','Fifth access family'])extra.push(ok(await req('/admin/family-groups',{name},root.cookie)).group.id);
  const assigned=[ga,gb,extra[0],extra[1]], uid=a.body.user.id;
  const rowsBefore=(await db.query(`SELECT count(*)::int n FROM ${schema}.people`)).rows[0].n;
  const oldReset=ok(await req('/admin/users/'+uid+'/reset-link',{},root.cookie)).link.split('#setpw=')[1];
  ok(await req('/admin/users/'+uid+'/family-group',{family_group_ids:assigned},root.cookie,'PUT'));
  assert.equal((await req('/auth/token/'+oldReset)).status,404,'membership changes revoke earlier recovery grants');
  assert.equal((await req('/people',undefined,a.cookie)).status,401);
  const multi=await req('/auth/login',{phone:'8455559001',password:'test-password'});ok(multi);
  const profile=ok(await req('/me',undefined,multi.cookie)).user;
  assert.deepEqual(profile.family_group_ids,assigned);assert.equal(profile.family_groups.length,4);
  assert.equal((await db.query(`SELECT count(*)::int n FROM ${schema}.people`)).rows[0].n,rowsBefore,'membership changes never copy people');
  for(const group of assigned)ok(await req('/people',undefined,multi.cookie,'GET',group));
  assert.equal((await req('/people',undefined,multi.cookie,'GET',extra[2])).status,403);
  assert.equal((await req('/admin/users',undefined,multi.cookie,'GET',gb)).status,403,'primary-family admin is an ordinary member in secondary families');
  assert.equal((await req('/admin/users/'+uid+'/family-group',{family_group_ids:[ga,gb]},multi.cookie,'PUT')).status,403,'members cannot grant themselves access');
  for(const ids of [[],[...assigned,extra[2]],[ga,ga],[ga,9999999]])assert.equal((await req('/admin/users/'+uid+'/family-group',{family_group_ids:ids},root.cookie,'PUT')).status,400);
  const switchResult=await req('/me/family-group',{family_group_id:gb},multi.cookie);ok(switchResult);
  const switched=multi.cookie+'; '+switchResult.cookie;
  assert.equal(ok(await req('/me',undefined,switched)).user.selected_family_group_id,gb);
  assert.ok(ok(await req('/people',undefined,switched)).people.some(p=>p.id===pb.id));
  assert.ok(!ok(await req('/people',undefined,switched)).people.some(p=>p.id===pa.id));
  assert.equal((await req('/people/'+pa.id,{note:'wrong view'},switched,'PUT')).status,404);
  const multiPeers=ok(await req('/chat-members',undefined,b.cookie)).members;assert.ok(multiPeers.some(p=>p.id===uid),'secondary members appear in chat');
  const secondaryInvite=ok(await req('/family-invitations',{sides:['a']},switched)).link.split('#join=')[1];
  assert.equal(ok(await req('/family-invitations/'+secondaryInvite)).family_name,'Parnes');
  assert.equal((await req('/me/family-group',{family_group_id:extra[2]},multi.cookie)).status,403);
  await assert.rejects(db.query(`UPDATE ${schema}.users SET family_group_ids=$1 WHERE id=$2`,[[...assigned,extra[2]],uid]));
  await assert.rejects(db.query(`UPDATE ${schema}.users SET family_group_ids=$1 WHERE id=$2`,[[ga,ga],uid]));
  await assert.rejects(db.query(`DELETE FROM ${schema}.family_groups WHERE id=$1`,[extra[0]]),/assigned members/);
  // A primary-family admin cannot recover or alter a shared account's credentials/roles.
  ok(await req('/admin/users/'+m.body.user.id+'/family-group',{family_group_ids:[ga,gb]},root.cookie,'PUT'));
  ok(await req('/admin/users/'+b.body.user.id+'/family-group',{family_group_ids:[gb,extra[0]]},root.cookie,'PUT'));
  const bAgain=await req('/auth/login',{phone:'8455559002',password:'test-password'});ok(bAgain);
  assert.equal((await req('/admin/users/'+m.body.user.id+'/reset-link',{},bAgain.cookie)).status,403);
  assert.equal((await req('/admin/users/'+m.body.user.id,{is_family_admin:true},bAgain.cookie,'PATCH')).status,403);
  // Removing membership revokes sessions and invites; stale cookies cannot restore it.
  ok(await req('/admin/users/'+uid+'/family-group',{family_group_ids:[ga]},root.cookie,'PUT'));
  assert.equal((await req('/people',undefined,switched)).status,401);
  assert.equal((await req('/family-invitations/'+secondaryInvite)).status,404);
  const reduced=await req('/auth/login',{phone:'8455559001',password:'test-password'});ok(reduced);
  assert.equal((await req('/people',undefined,reduced.cookie,'GET',gb)).status,403);
  assert.equal(ok(await req('/me',undefined,reduced.cookie+'; '+switchResult.cookie)).user.selected_family_group_id,ga);
  assert.equal((await db.query(`SELECT count(*)::int n FROM ${schema}.users WHERE family_group_id IS NULL`)).rows[0].n,0);
  assert.equal((await db.query(`SELECT count(*)::int n FROM ${schema}.family_groups WHERE name='Spoof'`)).rows[0].n,0);
 }finally{
  if(server){server.kill('SIGTERM');await once(server,'exit').catch(()=>{});}
  await db.query(`DROP SCHEMA ${schema} CASCADE`);await db.end();await rm(data,{recursive:true,force:true});
 }
});
