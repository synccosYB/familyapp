import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import { calendarEvents, calendarMonth, parseCalendarDates } from '../dist/family-calendar.js';
import { relationshipPath } from '../web/family-relationships.js';

test('Hebrew calendar handles Adar and recurring dates and lists a shared anniversary once', () => {
  assert.equal(parseCalendarDates({ birthday:{day:30,month:'IYYAR'} }),null);
  assert.equal(parseCalendarDates({ birthday:{day:14,month:'ADAR_II',year:5786} }),null);
  assert.equal(calendarMonth('5786','13'),null);
  const month = calendarMonth('5784','13','2024-03-24');
  assert.equal(month.days[13].date,'2024-03-24');
  assert.deepEqual(month.next,{ year:5784,month:1 });
  const date = { day:14,month:'ADAR_II',year:5779 };
  const people = [
    { id:1,name:'First',spouse_id:2,calendar_dates:{ birthday:date,anniversary:date } },
    { id:2,name:'Second',spouse_id:1,calendar_dates:{ anniversary:date } },
  ];
  const memorial = { id:1,person_id:3,name:'Memorial',hday:14,hmonth:'ADAR_II',death_year:5779 };
  const events = calendarEvents(5784,13,people,[memorial]);
  assert.deepEqual(events.map(event=>event.kind).sort(),['anniversary','birthday','yahrzeit']);
  assert.ok(events.every(event=>event.date==='2024-03-24'));
});

test('relationship paths use the second marriage and stop at the visible family boundary', () => {
  const people = [{id:1,second_spouse_id:2},{id:2},{id:3,mother_id:2},{id:4,parent_id:99}];
  assert.deepEqual(relationshipPath(people,1,3),[{id:1,relation:null},{id:2,relation:'spouse'},{id:3,relation:'child'}]);
  assert.deepEqual(relationshipPath(people,3,1),[{id:3,relation:null},{id:2,relation:'mother'},{id:1,relation:'spouse'}]);
  assert.equal(relationshipPath(people,1,4),null);
  assert.equal(relationshipPath(people,4,99),null);
});

test('profile photos, calendar records and ordinary suggestions respect the family boundary',
  { skip:!process.env.TEST_DATABASE_URL,timeout:60000 },async () => {
    const db = new pg.Pool({ connectionString:process.env.TEST_DATABASE_URL });
    const schema = 'family_tools_'+randomBytes(6).toString('hex');
    const directory = await mkdtemp(tmpdir()+'/kobor-family-tools-');
    const connection = new URL(process.env.TEST_DATABASE_URL);
    connection.searchParams.set('options',`-c search_path=${schema}`);
    const env = { ...process.env,DATABASE_URL:connection.toString(),FAMILYE_DATA:directory,PORT:'18086',HOST:'127.0.0.1',
      LOG_LEVEL:'error',ADMIN_NAME:'',ADMIN_PHONE:'',QA_PHONE_PREFIX:'',COOKIE_SECURE:'false',RESEND_API_KEY:'',WHATSAPP_ACCESS_TOKEN:'' };
    let server, logs = '';
    const start = entry => {
      const child = spawn(process.execPath,[entry],{env,stdio:['ignore','ignore','pipe']});
      child.stderr.on('data',data=>logs+=data);
      return child;
    };
    let sequence = 0;
    const request = (path, cookie='', body, method=body===undefined?'GET':'POST') => fetch('http://127.0.0.1:18086/api'+path,{
      method,headers:{cookie,'x-familye':'1','x-forwarded-for':`127.0.2.${++sequence}`,
        ...(body && !(body instanceof FormData)?{'content-type':'application/json'}:{})},
      body:body instanceof FormData?body:JSON.stringify(body),
    });
    const json = async response => {
      const body = await response.json();
      assert.equal(response.status,200,JSON.stringify(body)+'\n'+logs);
      return body;
    };
    const cookieFor = response => response.headers.get('set-cookie').split(';')[0];
    const signup = async (name,phone,extra) => {
      const response = await request('/auth/signup','',{name,phone,password:'family-test-password',...extra});
      await json(response);
      return cookieFor(response);
    };
    try {
      await db.query(`CREATE SCHEMA ${schema}`);
      assert.equal((await once(start('dist/bootstrap.js'),'exit'))[0],0,logs);
      server = start('dist/index.js');
      for (let i=0;i<80;i++) {
        try { if ((await request('/health')).ok) break; } catch {}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      const owner = await signup('Owner','8455551801',{create_family:'First family'});
      const outsider = await signup('Other owner','8455551802',{create_family:'Second family'});
      const invitation = await json(await request('/family-invitations',owner,{sides:['a']}));
      const member = await signup('Cousin','8455551803',{invitation_token:invitation.link.split('#join=')[1]});
      const birthday = { day:8,month:'CHESHVAN',year:5760 };
      const { person } = await json(await request('/people',owner,{ name:'Visible cousin',side:'a',calendar_dates:{birthday} }));
      await json(await request('/people',outsider,{ name:'Private cousin',side:'a',calendar_dates:{birthday} }));
      await json(await request('/people',owner,{ name:'Grandparent',side:'a',life_status:'deceased',death_hday:8,death_hmonth:'CHESHVAN' }));
      const calendar = await json(await request('/family-calendar?year=5787&month=8',member));
      assert.deepEqual(calendar.events.map(event=>event.name).sort(),['Grandparent','Visible cousin']);
      assert.doesNotMatch(JSON.stringify(calendar),/Private cousin/);

      const photo = await sharp({create:{width:40,height:40,channels:3,background:'#7766aa'}}).png().toBuffer();
      const form = (bytes,type='image/png') => {
        const body=new FormData();body.append('photo',new Blob([bytes],{type}),'photo.png');return body;
      };
      const photoPath = '/people/'+person.id+'/photo';
      assert.equal((await request(photoPath,member,form(photo),'PUT')).status,403);
      assert.equal((await request(photoPath,owner,form('<svg/>'),'PUT')).status,400);
      await json(await request(photoPath,owner,form(photo),'PUT'));
      assert.equal((await request(photoPath,outsider)).status,404);
      assert.equal((await request(photoPath)).status,401);
      const visiblePhoto = await request(photoPath,member);
      assert.equal(visiblePhoto.status,200);
      assert.equal(visiblePhoto.headers.get('content-type'),'image/jpeg');
      assert.equal((await sharp(Buffer.from(await visiblePhoto.arrayBuffer())).metadata()).format,'jpeg');
      assert.equal((await json(await request('/people',member))).people.find(row=>row.id===person.id).has_photo,true);

      const proposal = { name:'New relative',side:'a',father_id:person.id,request_key:randomUUID(),suggestion_note:'Please check this link' };
      const result = await json(await request('/people/suggestions',member,proposal));
      assert.equal((await json(await request('/people/suggestions',member,proposal))).pending_review,result.pending_review);
      assert.ok(!(await json(await request('/people',owner))).people.some(row=>row.name==='New relative'));
      assert.equal((await json(await request('/person-reviews',outsider))).reviews.length,0);
      const resolution = '/person-reviews/'+result.pending_review+'/resolve';
      assert.equal((await request(resolution,member,{action:'approve'})).status,403);
      assert.equal((await request(resolution,outsider,{action:'approve'})).status,404);
      assert.equal((await json(await request(resolution,owner,{action:'approve'}))).person.father_id,person.id);
      const edit = await json(await request('/people/'+person.id+'/suggestions',member,{note:'Suggested correction'}));
      await json(await request('/people/'+person.id,owner,{note:'Newer correction'},'PUT'));
      assert.equal((await request('/person-reviews/'+edit.pending_review+'/resolve',owner,{action:'approve'})).status,409);
    } finally {
      if (server && server.exitCode===null) { const exited=once(server,'exit');server.kill();await exited; }
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await db.end();
      await rm(directory,{recursive:true,force:true});
    }
  });
