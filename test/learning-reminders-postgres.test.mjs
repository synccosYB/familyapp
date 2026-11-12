import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import pg from 'pg';

test('daily worker persists delivery, retries idempotently and enforces membership/preferences',{skip:!process.env.TEST_DATABASE_URL,timeout:60000},async()=>{
 const schema='reminders_'+randomBytes(8).toString('hex');
 const admin=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
 await admin.query(`CREATE SCHEMA ${schema}`);
 const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options',`-c search_path=${schema}`);
 const env={...process.env,DATABASE_URL:url.toString(),ADMIN_NAME:'',ADMIN_PHONE:'',QA_PHONE_PREFIX:'',FAMILYE_DATA:'/tmp/'+schema};
 const boot=spawn(process.execPath,['dist/bootstrap.js'],{env,stdio:['ignore','pipe','pipe']});let logs='';boot.stderr.on('data',d=>logs+=d);
 assert.equal((await once(boot,'exit'))[0],0,logs);
 const previous=process.env.DATABASE_URL;process.env.DATABASE_URL=url.toString();
 // This file has its own Node test process, so these module instances use this isolated database.
 const {config}=await import('../dist/config.js');config.databaseUrl=url.toString();config.resendApiKey='fake';config.resendFromEmail='mail@example.test';config.learningReminderHour=9;
 const {pool}=await import('../dist/db.js');const {runLearningReminders}=await import('../dist/learning-reminders.js');
 try {
  const group=(await pool.query("INSERT INTO family_groups(name) VALUES('Reminders family') RETURNING id")).rows[0].id;
  const other=(await pool.query("INSERT INTO family_groups(name) VALUES('Other family') RETURNING id")).rows[0].id;
  const user=(await pool.query(`INSERT INTO users(name,phone,email,email_verified_at,status,sides,family_group_id,learning_email_reminders)
    VALUES('Member','15555550001','member@example.test',now(),'active','{a}',$1,true) RETURNING id`,[group])).rows[0].id;
  const list=(await pool.query(`INSERT INTO learn_lists(kind,niftar,side,target_date,family_group_id) VALUES('tehillim','Test','a','2026-11-14',$1) RETURNING id`,[group])).rows[0].id;
  await pool.query('INSERT INTO learn_items(list_id,idx,taken_by,taken_at) SELECT $1,g,$2,now() FROM generate_series(1,10) g',[list,user]);
  const now=new Date('2026-11-12T15:00:00Z'),errors=[],log={error:(o,m)=>errors.push(m)};let payload,keys=[],calls=0,fail=true;
  const send=async(url,options)=>{calls++;keys.push(options.headers['Idempotency-Key']);payload=JSON.parse(options.body);return fail?new Response('{}',{status:503}):Response.json({id:'sent'});};
  await runLearningReminders(log,new Date('2026-11-12T13:00:00Z'),send);assert.equal(calls,0,'before 9 AM');
  await runLearningReminders(log,now,send);assert.equal(calls,1);assert.equal(errors.length,1);
  fail=false;await runLearningReminders(log,now,send);assert.equal(calls,2);assert.equal(keys[0],keys[1]);
  await runLearningReminders(log,now,send);assert.equal(calls,2,'no duplicate after success');
  assert.match(payload.text,/קאפיטל 4/);assert.doesNotMatch(payload.text,/קאפיטל 5/);
  assert.equal((await pool.query('SELECT provider_id FROM learning_email_deliveries')).rows[0].provider_id,'sent');
  const next=new Date('2026-11-13T15:00:00Z');
  for(const change of ["learning_email_reminders=false","learning_email_reminders=true,email_verified_at=NULL","email_verified_at=now(),status='rejected'","status='active',sides='{b}'",`sides='{a}',family_group_id=${other},family_group_ids=ARRAY[${other}]`]) {
    await pool.query(`UPDATE users SET ${change} WHERE id=$1`,[user]);await runLearningReminders(log,next,send);assert.equal(calls,2,change);
  }
  await pool.query('UPDATE users SET family_group_id=$1,family_group_ids=ARRAY[$1::int] WHERE id=$2',[group,user]);
  await pool.query('UPDATE learn_items SET done=true WHERE list_id=$1',[list]);await runLearningReminders(log,next,send);assert.equal(calls,2,'completed');
  await pool.query('UPDATE learn_items SET done=false,taken_by=NULL WHERE list_id=$1',[list]);await runLearningReminders(log,next,send);assert.equal(calls,2,'relinquished');
  assert.equal(errors.length,1,'only deliberate failure logged');
 } finally {await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();process.env.DATABASE_URL=previous;}
});
