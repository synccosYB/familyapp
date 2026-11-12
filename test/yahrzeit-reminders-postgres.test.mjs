import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';

test('yahrzeit mail follows visible ancestors and explicit choices with one retry-safe delivery', {skip:!process.env.TEST_DATABASE_URL, timeout:60000}, async () => {
  const schema = 'yahrzeit_reminders_' + randomBytes(6).toString('hex');
  const directory = await mkdtemp(path.join(tmpdir(),'familye-yahrzeit-test-'));
  const admin = new pg.Pool({connectionString:process.env.TEST_DATABASE_URL});
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set('options',`-c search_path=${schema}`);
  const { config } = await import('../dist/config.js');
  config.databaseUrl=url.toString();
  config.publicUrl='https://familye.example.test';
  config.resendApiKey='mock';
  config.resendFromEmail='Familye <mail@example.test>';
  config.timezone='America/New_York';
  config.learningReminderHour=9;
  const { pool } = await import('../dist/db.js');
  const { runYahrzeitReminders } = await import('../dist/yahrzeit-reminders.js');
  try {
    await admin.query(`CREATE SCHEMA ${schema}`);
    const env = {...process.env,DATABASE_URL:url.toString(),FAMILYE_DATA:directory,ADMIN_NAME:'',ADMIN_PHONE:'',QA_PHONE_PREFIX:''};
    const bootstrap=spawn(process.execPath,['dist/bootstrap.js'],{env,stdio:['ignore','ignore','pipe']});
    let errors='';
    bootstrap.stderr.on('data',data=>errors+=data);
    assert.equal((await once(bootstrap,'exit'))[0],0,errors);
    const insert=async(sql,params=[]) => (await pool.query(sql+' RETURNING id',params)).rows[0].id;
    const family = name => insert('INSERT INTO family_groups(name) VALUES($1)',[name]);
    const primary = await family('Primary family'), shared = await family('Shared family'), other = await family('Private family');
    const person = (name,group,side='a',father=null,parent=null) => insert(
      'INSERT INTO people(name,family_group_id,side,father_id,parent_id) VALUES($1,$2,$3,$4,$5)',[name,group,side,father,parent]);
    const grandparent = await person('Grandparent <test>',primary);
    const father = await person('Father',primary,'a',null,grandparent);
    const cousin = await person('Cousin',primary,'a',father);
    const spouse = await person('Spouse of ancestor',primary);
    const privateSide = await person('Private side',primary,'b');
    await pool.query('UPDATE people SET spouse_id=$1 WHERE id=$2',[spouse,grandparent]);
    await pool.query('INSERT INTO person_family_access(person_id,family_group_id) SELECT unnest($1::int[]),$2',[[grandparent,father,cousin],shared]);
    const yahrzeit = (name,group,profile=null,side='a') => insert(
      "INSERT INTO yahrzeits(name,side,hday,hmonth,person_id,family_group_id) VALUES($1,$2,5,'KISLEV',$3,$4)",[name,side,profile,group]);
    const ancestor = await yahrzeit('Grandparent',primary,grandparent);
    const muted = await yahrzeit('Father',primary,father);
    await yahrzeit('Spouse of ancestor',primary,spouse);
    const hiddenSide = await yahrzeit('Private side',primary,privateSide,'b');
    const hiddenFamily = await yahrzeit('Private family memorial',other);
    const manual = await yahrzeit('Manually followed memorial',primary);
    const list = await insert("INSERT INTO learn_lists(kind,niftar,side,family_group_id,yahrzeit_id,target_date) VALUES('mishnayos','Learning','a',$1,$2,'2026-11-15')",[shared,ancestor]);
    await pool.query('INSERT INTO learn_items(list_id,idx) VALUES($1,0)',[list]);
    const member = (name,phone,profile=null,verified=true,status='active') => insert(
      `INSERT INTO users(name,phone,email,email_verified_at,status,sides,family_group_id,family_group_ids,person_id,yahrzeit_ancestor_emails)
       VALUES($1,$2,$3,CASE WHEN $4 THEN now() END,$5,'{a}',$6,$7,$8::int,$8::int IS NOT NULL)`,
      [name,phone,`${name}@example.test`,verified,status,primary,[primary,shared],profile]);
    const descendant = await member('descendant','15555551001',cousin);
    const follower = await member('follower','15555551002');
    const unverified = await member('unverified','15555551003',null,false);
    const pending = await member('pending','15555551004',null,true,'pending');
    await pool.query(`INSERT INTO yahrzeit_reminders(user_id,yahrzeit_id,enabled) VALUES
      ($1,$2,false),($3,$4,true),($3,$5,true),($3,$6,true),($7,$4,true),($8,$4,true)`,
      [descendant,muted,follower,manual,hiddenFamily,hiddenSide,unverified,pending]);

    const calls=[], failures=[], log={error:(details)=>failures.push(details)};
    let failDescendant = true;
    const send = async (url,options) => {
      assert.equal(url,'https://api.resend.com/emails');
      const message = JSON.parse(options.body);
      calls.push({key:options.headers['Idempotency-Key'],message});
      return failDescendant && message.to[0]==='descendant@example.test'
        ? new Response('{}',{status:503}) : Response.json({id:'sent-'+calls.length});
    };
    const run = iso => runYahrzeitReminders(log,new Date(iso),send);
    await run('2026-11-11T15:00:00Z');
    await run('2026-11-12T13:59:00Z');
    assert.equal(calls.length,0,'send only during the reminder window and after the configured morning hour');
    await Promise.all([run('2026-11-12T14:10:00Z'),run('2026-11-12T14:10:00Z')]);
    assert.deepEqual(calls.map(call=>call.message.to),[['descendant@example.test'],['follower@example.test']]);
    assert.match(calls[0].message.text,/Grandparent <test> ז״ל/);
    assert.match(calls[0].message.html,/Grandparent &lt;test&gt; ז״ל/);
    assert.match(calls[0].message.text,/2026-11-15/);
    assert.ok(calls[0].message.text.includes(`/#learn/${list}/${shared}`));
    assert.ok(calls[0].message.text.includes(`/#yz/${ancestor}/${shared}`));
    assert.doesNotMatch(calls[1].message.text,/#learn\//);
    assert.equal(failures.length,1);

    await pool.query('UPDATE users SET yahrzeit_ancestor_emails=false WHERE id=$1',[descendant]);
    await run('2026-11-12T14:15:00Z');
    assert.equal(calls.length,2,'a queued retry respects the latest opt-out');
    await pool.query('UPDATE users SET yahrzeit_ancestor_emails=true WHERE id=$1',[descendant]);
    failDescendant=false;
    await run('2026-11-12T14:20:00Z');
    assert.deepEqual(calls[2],calls[0],'retry uses the same persisted body and provider key');
    await run('2026-11-13T14:10:00Z');
    assert.equal(calls.length,3,'once per occurrence across both families and all reminder days');

    Object.assign(config.whatsapp,{token:'mock',sender:'123',version:'v24.0',template:'yahrzeit_notice',language:'en_US'});
    await pool.query('UPDATE users SET yahrzeit_whatsapp_phone=phone WHERE id=ANY($1::int[])',[[descendant,unverified,pending]]);
    const messages = [];
    const sendWhatsApp = async (url,options) => {
      assert.equal(url,'https://graph.facebook.com/v24.0/123/messages');
      messages.push(JSON.parse(options.body));
      return Response.json({messages:[{id:'test-whatsapp-id'}]});
    };
    await runYahrzeitReminders(log,new Date('2026-11-13T14:10:00Z'),sendWhatsApp);
    assert.deepEqual(messages.map(message=>message.to),['15555551001','15555551003'],'only opted-in, active members get WhatsApp');
    assert.ok(messages[0].template.components[0].parameters[1].text.includes(`/#learn/${list}/${shared}`));
    assert.doesNotMatch(JSON.stringify(messages),/Grandparent|Private family|Private side/);
    await runYahrzeitReminders(log,new Date('2026-11-14T14:10:00Z'),sendWhatsApp);
    assert.equal(messages.length,2,'WhatsApp is sent once per occurrence');

    const accountSid = 'AC'+'1'.repeat(32);
    const apiKeySid = 'SK'+'2'.repeat(32);
    const contentSid = 'HX'+'3'.repeat(32);
    const messageSid = 'SM'+'4'.repeat(32);
    const apiKeySecret = 'fake-twilio-secret';
    Object.assign(config.twilioWhatsApp,{accountSid,apiKeySid,apiKeySecret,from:'+15555551000',contentSid});
    await pool.query('UPDATE users SET yahrzeit_whatsapp_phone=phone WHERE id=$1',[follower]);
    const twilioCalls = [];
    const sendTwilio = async (url,options) => {
      assert.equal(url,`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`);
      assert.equal(options.headers.Authorization,`Basic ${Buffer.from(`${apiKeySid}:${apiKeySecret}`).toString('base64')}`);
      assert.equal(options.headers['Content-Type'],'application/x-www-form-urlencoded');
      const fields = Object.fromEntries(options.body);
      assert.equal(fields.From,'whatsapp:+15555551000');
      assert.equal(fields.To,'whatsapp:+15555551002');
      assert.equal(fields.ContentSid,contentSid);
      const variables = JSON.parse(fields.ContentVariables);
      assert.match(variables['1'],/כסלו/);
      assert.equal(variables['2'],`${config.publicUrl}/#yz/${manual}/${primary}`);
      assert.equal(fields.Body,undefined);
      twilioCalls.push(fields);
      return twilioCalls.length===1 ? new Response('{}',{status:429}) : Response.json({sid:messageSid,status:'queued'});
    };
    await runYahrzeitReminders(log,new Date('2026-11-13T14:10:00Z'),sendTwilio);
    await runYahrzeitReminders(log,new Date('2026-11-13T14:15:00Z'),sendTwilio);
    await runYahrzeitReminders(log,new Date('2026-11-14T14:10:00Z'),sendTwilio);
    assert.equal(twilioCalls.length,2,'Twilio retries a rejected rate-limited request, then deduplicates');
    assert.equal((await pool.query('SELECT provider_id FROM yahrzeit_whatsapp_deliveries WHERE user_id=$1 AND yahrzeit_id=$2',[follower,manual])).rows[0].provider_id,messageSid);
  } finally {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
    await rm(directory,{recursive:true,force:true});
  }
});
