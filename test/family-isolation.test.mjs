import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
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
 const req=async(path,body,cookie='',method=body===undefined?'GET':'POST',group,acting)=>{
  const r=await fetch('http://127.0.0.1:18082/api'+path,{method,headers:{'x-familye':'1','x-forwarded-for':'127.0.1.'+(seq++%240+1),...(cookie?{cookie}:{}),...(group?{'x-family-group':String(group)}:{}),...(acting?{'x-family-act':acting}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
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
  assert.equal(ok(await req('/home',undefined,m.cookie)).members,ok(await req('/chat-members',undefined,m.cookie)).members.length,'dashboard count matches automatic cousin profiles before a household exists');
  assert.deepEqual(ok(await req('/directory',undefined,m.cookie)).families,[],'registered members do not require a household');
  const person=async(owner,name)=>ok(await req('/people',{name,side:'both',life_status:'deceased',death_hday:1,death_hmonth:'TISHREI',new_family:name+' label',family_group_id:gb},owner.cookie)).person;
  const pa=await person(a,'A ancestor'),pb=await person(b,'B ancestor');assert.equal(pa.family_group_id,ga,'body group ignored');
  const ya=ok(await req('/yahrzeits',undefined,a.cookie)).yahrzeits[0],yb=ok(await req('/yahrzeits',undefined,b.cookie)).yahrzeits[0];
  const la=ok(await req('/lists',{kind:'tehillim',yahrzeit_id:ya.id},a.cookie)).list;
  const lb=ok(await req('/lists',{kind:'tehillim',yahrzeit_id:yb.id},b.cookie)).list;
  const da=ok(await req('/directory',{husband_person_id:pa.id,side:'both'},a.cookie)).family;
  const sb=ok(await req('/simchas',{kind:'Wedding',whose:'B private',gdate:'2099-01-01',audience:'all'},b.cookie)).simcha;
  assert.deepEqual(ok(await req('/simchas?id='+sb.id,undefined,m.cookie)).simchas,[]);
  assert.equal(ok(await req('/simchas?id='+sb.id,undefined,b.cookie)).simchas[0].id,sb.id);
  const ma=ok(await req('/chat/all',{body:'A private chat'},a.cookie)).message;
  const mb=ok(await req('/chat/all',{body:'B private chat'},b.cookie)).message;
  for(const endpoint of ['/people','/yahrzeits','/lists','/simchas','/directory','/directory-people','/home','/chat/all','/chat-summary','/chat-members','/directory.csv']){
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
  // A canonical memorial belongs to its person, even when an admin has another family selected.
  await db.query(`UPDATE ${schema}.users SET family_group_ids=ARRAY[family_group_id,$1,$2] WHERE id=$3`,[ga,gb,root.body.user.id]);
  const memorialFather=ok(await req('/people',{name:'Memorial father',side:'both'},root.cookie,'POST',ga)).person;
  const memorialMother=ok(await req('/people',{name:'Memorial mother',side:'both'},root.cookie,'POST',ga)).person;
  const memorialSpouse=ok(await req('/people',{name:'Memorial spouse',side:'both'},root.cookie,'POST',ga)).person;
  const memorialPerson=ok(await req('/people',{name:'Memorial person',side:'both',life_status:'deceased',father_id:memorialFather.id,mother_id:memorialMother.id,spouse_id:memorialSpouse.id},root.cookie,'POST',ga)).person;
  const memorialChild=ok(await req('/people',{name:'Memorial child',side:'both',father_id:memorialPerson.id},root.cookie,'POST',ga)).person;
  ok(await req('/people/'+memorialPerson.id,{note:'Save without a date'},root.cookie,'PUT',gb));
  const dated=ok(await req('/people/'+memorialPerson.id,{death_hday:5,death_hmonth:'ELUL'},root.cookie,'PUT',gb)).person;
  assert.equal(dated.death_hday,5);assert.equal(dated.death_hmonth,'ELUL');
  assert.equal(dated.father_id,memorialFather.id);assert.equal(dated.mother_id,memorialMother.id);assert.equal(dated.spouse_id,memorialSpouse.id);
  assert.equal(ok(await req('/people',undefined,a.cookie)).people.find(p=>p.id===memorialChild.id).father_id,memorialPerson.id);
  const memorial=ok(await req('/yahrzeits',undefined,a.cookie)).yahrzeits.find(y=>y.person_id===memorialPerson.id);
  assert.equal(memorial.family_group_id,ga);assert.equal(memorial.hday,5);assert.equal(memorial.hmonth,'ELUL');
  assert.ok(!ok(await req('/yahrzeits',undefined,b.cookie)).yahrzeits.some(y=>y.person_id===memorialPerson.id));
  ok(await req('/people/'+memorialPerson.id,{death_hday:6},root.cookie,'PUT',gb));
  assert.equal((await db.query(`SELECT count(*)::int n FROM ${schema}.yahrzeits WHERE person_id=$1`,[memorialPerson.id])).rows[0].n,1);
  // Unrelated groups still cannot manufacture cross-family memorial links directly.
  await assert.rejects(db.query(`INSERT INTO ${schema}.yahrzeits(name,side,hday,hmonth,person_id,family_group_id) VALUES('Invalid memorial','both',1,'ELUL',$1,$2)`,[memorialFather.id,gb]),/foreign key/);
  // A checked label resolves to its assigned access group even while another family is open.
  const aLabel=pa.families[0].id,bLabel=pb.families[0].id;
  assert.notEqual(bLabel,gb,'label IDs and access group IDs are independent');
  const fatherBody={name:'Checked family father',side:'both',family_ids:[bLabel],life_status:'deceased',death_hday:5,death_hmonth:'ELUL',request_key:randomBytes(16).toString('hex')};
  const checkedFather=ok(await req('/people',fatherBody,root.cookie,'POST',ga)).person;
  assert.equal(checkedFather.family_group_id,gb);
  assert.deepEqual(checkedFather.families.map(f=>f.id),[bLabel]);
  assert.equal(ok(await req('/people',fatherBody,root.cookie,'POST',ga)).person.id,checkedFather.id,'cross-view retries reuse the person');
  const checkedMother=ok(await req('/people',{name:'Checked family mother',side:'both',family_ids:[bLabel]},root.cookie,'POST',ga)).person;
  const daughter=ok(await req('/people',{name:'Checked family daughter',side:'both',family_ids:[bLabel]},b.cookie)).person;
  const linked=ok(await req('/people/'+daughter.id,{father_id:checkedFather.id,mother_id:checkedMother.id,family_ids:[bLabel]},root.cookie,'PUT',ga)).person;
  assert.equal(linked.father_id,checkedFather.id);
  assert.equal(linked.mother_id,checkedMother.id);
  assert.ok(!ok(await req('/people',undefined,a.cookie)).people.some(p=>p.id===checkedFather.id));
  assert.equal(ok(await req('/yahrzeits',undefined,b.cookie)).yahrzeits.find(y=>y.person_id===checkedFather.id).family_group_id,gb);
  assert.ok(!ok(await req('/yahrzeits',undefined,a.cookie)).yahrzeits.some(y=>y.person_id===checkedFather.id));
  assert.equal((await req('/people',{name:'Forbidden family label',side:'both',family_ids:[bLabel]},a.cookie)).status,404);
  assert.equal((await req('/people/'+daughter.id,{father_id:pa.id},root.cookie,'PUT',ga)).status,400,'unrelated families still cannot link');

  const otherFamilyMiriam=ok(await req('/people',{name:'מרים',side:'both',family_ids:[aLabel]},root.cookie,'POST',ga)).person;
  const miriam=ok(await req('/people',{name:'מרים',side:'both',family_ids:[bLabel]},root.cookie,'POST',ga)).person;
  const sameFamilyMiriam={name:'מרים',side:'both',family_ids:[bLabel]};
  const warningForMiriam=await req('/people',sameFamilyMiriam,root.cookie,'POST',ga);
  assert.equal(warningForMiriam.status,409);
  assert.deepEqual(warningForMiriam.body.details.matches.map(p=>p.id),[miriam.id]);
  assert.equal((await req('/people/'+checkedMother.id,{name:'מרים'},root.cookie,'PUT',ga)).status,409,'renaming still checks for duplicates in the same family');
  ok(await req('/people',{...sameFamilyMiriam,confirm_distinct:true,distinct_reason:'Another relative with the same name',request_key:randomBytes(16).toString('hex')},root.cookie,'POST',ga));
  const linkedMiriam=ok(await req('/people/'+miriam.id,{name:'מרים',father_id:checkedFather.id,family_ids:[bLabel]},root.cookie,'PUT',ga)).person;
  assert.equal(linkedMiriam.father_id,checkedFather.id,'editing the parent of an existing person bypasses the name-only duplicate prompt');
  assert.equal(ok(await req('/people',undefined,a.cookie)).people.find(p=>p.id===otherFamilyMiriam.id).father_id,null);

  const spouse=ok(await req('/people',{name:'Checked family first spouse',side:'both',family_ids:[bLabel]},root.cookie,'POST',ga)).person;
  const remarried=ok(await req('/people/'+checkedMother.id,{family_ids:[bLabel],spouse_id:spouse.id,new_relatives:{second_spouse_id:{name:'Checked family second spouse'}}},root.cookie,'PUT',ga)).person;
  assert.equal(remarried.spouse_id,spouse.id);
  const familyB=ok(await req('/people',undefined,b.cookie)).people;
  assert.equal(familyB.find(p=>p.id===remarried.second_spouse_id).family_group_id,gb);
  assert.equal(familyB.find(p=>p.id===remarried.second_spouse_id).spouse_id,checkedMother.id);
  assert.equal(familyB.find(p=>p.id===daughter.id).mother_id,checkedMother.id);

  const sharedParent=ok(await req('/people',{name:'Checked shared parent',side:'both',family_ids:[bLabel,aLabel],life_status:'deceased',death_hday:5,death_hmonth:'ELUL'},root.cookie,'POST',ga)).person;
  assert.equal(sharedParent.family_group_id,ga);
  const sharedDaughter=ok(await req('/people',{name:'Checked shared daughter',side:'both',family_ids:[bLabel],father_id:sharedParent.id},b.cookie)).person;
  assert.equal(sharedDaughter.father_id,sharedParent.id,'a shared access group allows links across primary owners');
  const adminMemorials=ok(await req('/yahrzeits',undefined,root.cookie,'GET',ga)).yahrzeits;
  assert.deepEqual(adminMemorials.find(y=>y.person_id===sharedParent.id).families.map(f=>f.id),[aLabel,bLabel],'show both permitted checked labels');
  assert.ok(!adminMemorials.some(y=>y.person_id===checkedFather.id),'the other family still has its own yahrzeit list');
  assert.deepEqual(ok(await req('/yahrzeits',undefined,a.cookie)).yahrzeits.find(y=>y.person_id===sharedParent.id).families.map(f=>f.id),[aLabel]);
  assert.deepEqual(ok(await req('/yahrzeits',undefined,b.cookie)).yahrzeits.find(y=>y.person_id===sharedParent.id).families.map(f=>f.id),[bLabel]);
  assert.equal((await req('/people/'+sharedParent.id,{family_ids:[aLabel]},root.cookie,'PUT',ga)).status,400,'grant removal that would break a link rolls back');
  assert.ok(ok(await req('/people',undefined,b.cookie)).people.some(p=>p.id===sharedParent.id));

  // Exercise the migration on records with the old owner's exact shape.
  const [wrong,protectedByGrant,protectedByLink,ambiguous]=(await db.query(`INSERT INTO ${schema}.people(name,side,family_group_id,life_status)
    VALUES('Wrong viewing owner','both',$1,'deceased'),('Recovered grant','both',$1,'unknown'),('Existing family link','both',$1,'unknown'),('Two checked groups','both',$1,'unknown') RETURNING id`,[ga])).rows.map(r=>r.id);
  await db.query(`INSERT INTO ${schema}.person_families(person_id,family_id) SELECT unnest($1::int[]),$2`,[[wrong,protectedByGrant,protectedByLink,ambiguous],bLabel]);
  await db.query(`INSERT INTO ${schema}.person_families(person_id,family_id) VALUES($1,$2)`,[ambiguous,aLabel]);
  await db.query(`INSERT INTO ${schema}.person_family_access(person_id,family_group_id) VALUES($1,$2)`,[protectedByGrant,ga]);
  await db.query(`UPDATE ${schema}.people SET father_id=$1 WHERE id=$2`,[pa.id,protectedByLink]);
  const wrongMemorial=(await db.query(`INSERT INTO ${schema}.yahrzeits(name,side,hday,hmonth,person_id,family_group_id) VALUES('Wrong viewing owner','both',5,'ELUL',$1,$2) RETURNING id`,[wrong,ga])).rows[0].id;
  const archivedMemorial=(await db.query(`INSERT INTO ${schema}.yahrzeits(name,side,hday,hmonth,canonical_id,family_group_id,archived_at) VALUES('Archived memorial','both',5,'ELUL',$1,$2,now()) RETURNING id`,[wrongMemorial,ga])).rows[0].id;
  assert.equal((await req('/people/'+daughter.id,{father_id:wrong},root.cookie,'PUT',ga)).status,400);
  const qaGroup=ok(await req('/admin/family-groups',{name:'QA זיווגים 2026-11-12'},root.cookie)).group.id;
  const qaPerson=ok(await req('/people',{name:'QA marriage fixture',side:'both'},root.cookie,'POST',qaGroup)).person;
  const qaInvite=ok(await req('/family-invitations',{sides:['a','b']},root.cookie,'POST',qaGroup)).link.split('#join=')[1];
  const archive=await readFile(new URL('../db/migrations/022_archive_marriage_qa_family.sql',import.meta.url),'utf8');
  const migration=await readFile(new URL('../db/migrations/023_repair_person_family_owners.sql',import.meta.url),'utf8');
  const repair=await db.connect();
  try {
   await repair.query('BEGIN');
   await repair.query(`SET LOCAL search_path TO ${schema}`);
   await repair.query(archive);
   await repair.query(migration);
   await repair.query('COMMIT');
  } catch(error) {
   await repair.query('ROLLBACK');
   throw error;
  } finally {
   repair.release();
  }
  const repaired=ok(await req('/people/'+daughter.id,{father_id:wrong},root.cookie,'PUT',ga)).person;
  assert.equal(repaired.father_id,wrong);
  const owners=(await db.query(`SELECT id,family_group_id FROM ${schema}.people WHERE id=ANY($1) ORDER BY id`,[[wrong,protectedByGrant,protectedByLink,ambiguous]])).rows;
  assert.deepEqual(owners.map(p=>p.family_group_id),[gb,ga,ga,ga]);
  const memorialOwners=(await db.query(`SELECT family_group_id FROM ${schema}.yahrzeits WHERE id=ANY($1)`,[[wrongMemorial,archivedMemorial]])).rows;
  assert.deepEqual(memorialOwners.map(y=>y.family_group_id),[gb,gb]);
  const correction=ok(await req('/people/'+ambiguous,{family_ids:[bLabel]},root.cookie,'PUT',ga)).person;
  assert.equal(correction.family_group_id,gb,'explicit admin edit can correct a previous assignment');
  assert.ok(!ok(await req('/me',undefined,root.cookie)).user.family_groups.some(g=>g.id===qaGroup));
  assert.ok(!ok(await req('/admin/family-groups',undefined,root.cookie)).groups.some(g=>g.id===qaGroup));
  assert.equal((await req('/me/family-group',{family_group_id:qaGroup},root.cookie)).status,400);
  assert.equal((await req('/people',undefined,root.cookie,'GET',qaGroup)).status,403);
  assert.equal((await req('/family-invitations/'+qaInvite)).status,404);
  assert.equal((await db.query(`SELECT family_group_id FROM ${schema}.people WHERE id=$1`,[qaPerson.id])).rows[0].family_group_id,qaGroup,'QA fixture is recoverable');
  // Legacy records remain hidden; explicit assignment is atomic and checked for cross-family edges.
  const legacy=(await db.query(`INSERT INTO ${schema}.people(name,side) VALUES('Legacy hidden','a') RETURNING id`)).rows[0];
  assert.ok(!JSON.stringify(ok(await req('/people',undefined,a.cookie))).includes('Legacy hidden'));
  const recovery=ok(await req('/admin/unassigned-records',undefined,root.cookie)).records.people.find(p=>p.id===legacy.id);
  assert.equal(recovery.label,'Legacy hidden');assert.equal(recovery.father_id,null);assert.deepEqual(recovery.families,[]);

  ok(await req('/admin/assign-records',{family_group_id:ga,records:{people:[legacy.id]}},root.cookie));
  assert.ok(JSON.stringify(ok(await req('/people',undefined,a.cookie))).includes('Legacy hidden'));
  assert.equal((await req('/admin/assign-records',{family_group_id:gb,records:{people:[legacy.id]}},root.cookie)).status,409);
  await assert.rejects(db.query(`UPDATE ${schema}.people SET father_id=$1 WHERE id=$2`,[pb.id,child.id]),/foreign key/);
  // Recover a connected canonical tree into several families, retaining shared IDs.
  const labels=(await db.query(`INSERT INTO ${schema}.families(name) VALUES('Legacy A'),('Legacy B') RETURNING id`)).rows;
  const lp=(await db.query(`INSERT INTO ${schema}.people(name,side) VALUES('A grandfather','both'),('B grandfather','both'),('Shared husband','both'),('Shared wife','both'),('Unlabelled child','both') RETURNING id`)).rows.map(r=>r.id);
  await db.query(`UPDATE ${schema}.people SET father_id=$1,spouse_id=$2 WHERE id=$3`,[lp[0],lp[3],lp[2]]);
  await db.query(`UPDATE ${schema}.people SET father_id=$1,spouse_id=$2 WHERE id=$3`,[lp[1],lp[2],lp[3]]);
  await db.query(`UPDATE ${schema}.people SET father_id=$1,mother_id=$2 WHERE id=$3`,[lp[2],lp[3],lp[4]]);
  for(const [person,ls] of [[lp[0],[labels[0].id]],[lp[1],[labels[1].id]],[lp[2],labels.map(l=>l.id)],[lp[3],labels.map(l=>l.id)]])for(const label of ls)await db.query(`INSERT INTO ${schema}.person_families(person_id,family_id) VALUES($1,$2)`,[person,label]);
  const recoveredYz=(await db.query(`INSERT INTO ${schema}.yahrzeits(name,side,hday,hmonth,person_id,father_name) VALUES('Shared wife','both',1,'TISHREI',$1,'B grandfather') RETURNING id`,[lp[3]])).rows[0].id;
  const mapping={[labels[0].id]:ga,[labels[1].id]:gb};
  assert.equal((await req('/admin/recover-tree/preview',{label_groups:mapping},a.cookie)).status,403);
  const plan=ok(await req('/admin/recover-tree/preview',{label_groups:mapping},root.cookie));
  assert.deepEqual(plan.unknown,[]);assert.deepEqual(plan.people.find(p=>p.id===lp[4]).group_ids,[ga,gb]);
  assert.equal((await req('/admin/recover-tree',{label_groups:mapping,token:'stale'},root.cookie)).status,409);
  ok(await req('/admin/recover-tree',{label_groups:mapping,token:plan.token},root.cookie));
  const ar=ok(await req('/people',undefined,a.cookie)).people,br=ok(await req('/people',undefined,b.cookie)).people;
  for(const id of lp.slice(2)){assert.equal(ar.filter(p=>p.id===id).length,1);assert.equal(br.filter(p=>p.id===id).length,1);}
  assert.ok(!ar.some(p=>p.id===lp[1]));assert.ok(!br.some(p=>p.id===lp[0]));
  assert.equal(ar.find(p=>p.id===lp[3]).father_id,null);assert.equal(ar.find(p=>p.id===lp[3]).father_name,null);
  assert.equal(br.find(p=>p.id===lp[2]).father_id,null);assert.equal(br.find(p=>p.id===lp[2]).father_name,null);
  assert.ok(ar.find(p=>p.id===lp[2]).families.every(f=>f.id===labels[0].id));
  assert.equal((await req('/people/'+lp[1],{name:'Forbidden'},a.cookie,'PUT')).status,404);
  assert.equal((await req('/people/'+lp[2],{name:'Shared edit'},a.cookie,'PUT')).status,403);
  assert.equal((await db.query(`SELECT count(*)::int n FROM ${schema}.people WHERE id=ANY($1)`,[lp])).rows[0].n,5);
  const yaShared=ok(await req('/yahrzeits',undefined,a.cookie)).yahrzeits.find(y=>y.id===recoveredYz);
  const ybShared=ok(await req('/yahrzeits',undefined,b.cookie)).yahrzeits.find(y=>y.id===recoveredYz);
  assert.ok(yaShared);assert.ok(ybShared);assert.equal(yaShared.father_name,'');assert.equal(ybShared.father_name,'B grandfather');
  const sharedLearning=ok(await req('/lists',{kind:'tehillim',yahrzeit_id:recoveredYz},b.cookie)).list;
  assert.match(sharedLearning.niftar,/B grandfather/);
  assert.ok(!ok(await req('/lists',undefined,a.cookie)).lists.some(l=>l.id===sharedLearning.id),'learning room remains family-private');
  const sharedDirectory=ok(await req('/directory',{husband_person_id:lp[2],wife_person_id:lp[3],side:'both'},b.cookie)).family;
  assert.equal(sharedDirectory.husband_person_id,lp[2]);
  assert.ok(!JSON.stringify(ok(await req('/directory',undefined,b.cookie))).includes('A grandfather'));
  await assert.rejects(db.query(`DELETE FROM ${schema}.person_family_access WHERE person_id=$1 AND family_group_id=$2`,[lp[3],gb]),/foreign key/,'cannot revoke access and leave invalid cross-family links');
  // A new child reuses the shared parent, without cloning the parent.
  const sharedChild=ok(await req('/people',{name:'New cousin',side:'both',father_id:lp[2]},b.cookie)).person;
  assert.equal(sharedChild.father_id,lp[2]);
  assert.ok(!ok(await req('/people',undefined,a.cookie)).people.some(p=>p.id===sharedChild.id));
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
  assert.ok(ok(await req('/people',undefined,switched)).people.some(p=>p.id===pa.id),'canonical tree combines only explicitly assigned families');
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
  // The multi-family roster deduplicates members and only exposes visible tree relationships.
  const memberId=m.body.user.id,bId=b.body.user.id;
  const sibling1=ok(await req('/people',{name:'Roster brother one',side:'both',lineage_term:'בן',father_id:pb.id},root.cookie,'POST',gb)).person;
  const sibling2=ok(await req('/people',{name:'Roster brother two',side:'both',lineage_term:'בן',father_id:pb.id},root.cookie,'POST',gb)).person;
  ok(await req(`/admin/users/${memberId}/tree-profile`,{person_id:sibling1.id},root.cookie,'PUT'));
  assert.equal((await req(`/admin/users/${bId}/tree-profile`,{person_id:pa.id},root.cookie,'PUT')).status,400);
  ok(await req(`/admin/users/${bId}/tree-profile`,{person_id:sibling2.id},root.cookie,'PUT'));
  const roster=ok(await req(`/cousins?groups=${ga},${gb}`,undefined,root.cookie,'GET',ga)).members;
  assert.equal(roster.filter(p=>p.id===memberId).length,1);
  assert.deepEqual(roster.find(p=>p.id===memberId).group_ids,[ga,gb]);
  assert.equal(roster.find(p=>p.id===memberId).father_id,pb.id);
  assert.equal(roster.find(p=>p.id===bId).father_id,pb.id);
  assert.equal((await req(`/cousins?groups=${ga},${gb}`,undefined,bAgain.cookie)).status,403);
  assert.ok(!ok(await req(`/cousins?groups=${ga}`,undefined,root.cookie,'GET',ga)).members.some(p=>p.father_id===pb.id));

  // Act-as uses a temporary identity and preserves the administrator's selected family.
  assert.equal((await req(`/admin/users/${memberId}/act-as`,{},bAgain.cookie)).status,403);
  assert.equal((await req(`/admin/users/${root.body.user.id}/act-as`,{},root.cookie)).status,404);
  const adminCookie=root.cookie+`; fam_group=${ga}`;
  const act=await req(`/admin/users/${bId}/act-as`,{},adminCookie);ok(act);
  assert.match(act.cookie,/^fam_act=/);
  const actCookie=adminCookie+'; '+act.cookie;
  const effective=ok(await req('/me',undefined,actCookie)).user;
  assert.equal(effective.id,bId);assert.equal(effective.selected_family_group_id,gb);assert.equal(effective.is_admin,false);
  assert.equal(effective.acting.admin_id,root.body.user.id);
  const context=effective.acting.context;
  assert.equal((await req('/people',undefined,actCookie)).status,409,'stale admin tabs cannot issue requests as the member');
  assert.equal((await req('/people',undefined,actCookie,'GET',ga,context)).status,403);
  assert.equal((await req('/admin/users',undefined,actCookie,'GET',gb,context)).status,403);
  assert.equal((await req('/me',{name:'Changed email',email:'unsafe@example.test'},actCookie,'PATCH',undefined,context)).status,403);
  const asMember=ok(await req('/people',{name:'Acted on behalf of member',side:'both'},actCookie,'POST',gb,context)).person;
  assert.equal(asMember.created_by,bId);assert.equal(asMember.family_group_id,gb);
  ok(await req('/auth/stop-acting',{},actCookie));
  assert.equal(ok(await req('/me',undefined,adminCookie)).user.selected_family_group_id,ga);
  assert.equal((await req('/people',undefined,actCookie,'GET',gb,context)).status,401);
  assert.equal((await req('/people',undefined,adminCookie,'GET',ga,context)).status,409,'stale member tabs cannot act as admin');
  const events=(await db.query(`SELECT event,route FROM ${schema}.admin_act_as_audit WHERE member_id=$1 ORDER BY id`,[bId])).rows;
  assert.deepEqual(events,[{event:'start',route:null},{event:'request',route:'/api/people'},{event:'stop',route:null}]);
  const expiring=await req(`/admin/users/${bId}/act-as`,{},adminCookie);ok(expiring);
  await db.query(`UPDATE ${schema}.sessions SET expires_at=now()-interval '1 minute' WHERE admin_session_hash IS NOT NULL`);
  const expiredCookie=adminCookie+'; '+expiring.cookie;
  const expired=ok(await req('/me',undefined,expiredCookie));
  assert.equal(expired.user,null);assert.equal(expired.can_stop_acting,true);
  ok(await req('/auth/stop-acting',{},expiredCookie));
 }finally{
  if(server){server.kill('SIGTERM');await once(server,'exit').catch(()=>{});}
  await db.query(`DROP SCHEMA ${schema} CASCADE`);await db.end();await rm(data,{recursive:true,force:true});
 }
});
