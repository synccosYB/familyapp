import {test} from 'node:test';
import assert from 'node:assert/strict';
import {config} from '../dist/config.js';
import {dailyLearning,reminderClock,sendLearningEmail,remainingLearning} from '../dist/learning-reminders.js';
import {MASECHTOS} from '../dist/masechtos.js';
const units=Array.from({length:10},(_,m)=>({idx:0,chapter:m<5?1:2,mishnah:m%5+1}));
test('daily targets respect remaining work, chapter boundaries, missed days and deadline',()=>{
  const plan=dailyLearning('mishnayos',units,'2026-11-14','2026-11-12');
  assert.equal(plan.lines.length,4);assert.equal(plan.remaining,10);assert.equal(plan.days,3);
  const partial=dailyLearning('mishnayos',units.slice(4),'2026-11-14','2026-11-13');
  assert.deepEqual(partial.lines,['ברכות — פרק 1, משנה 5','ברכות — פרק 2, משנה 1','ברכות — פרק 2, משנה 2']);
  assert.equal(dailyLearning('mishnayos',units,'2026-11-14','2026-11-13').lines.length,5,'missed day increases workload');
  assert.equal(dailyLearning('mishnayos',units,'2026-11-12','2026-11-12').lines.length,10);
  assert.equal(dailyLearning('mishnayos',units,'2026-11-11','2026-11-12'),null);
  assert.equal(dailyLearning('mishnayos',[],'2026-11-12','2026-11-12'),null);
  assert.equal(dailyLearning('mishnayos',units,null,'2026-11-12').days,null);
  assert.deepEqual(dailyLearning('tehillim',[{idx:150,chapter:0,mishnah:0}],null,'2026-11-12').lines,['תהילים — קאפיטל 150']);
  assert.equal(dailyLearning('mishnayos',units,'2026-03-09','2026-03-07').days,3);
});
test('family clock uses New York midnight and DST boundaries',()=>{
 config.timezone='America/New_York';
 assert.deepEqual(reminderClock(new Date('2026-11-12T04:59:00Z')),{date:'2026-11-11',hour:23});
 assert.deepEqual(reminderClock(new Date('2026-11-12T05:00:00Z')),{date:'2026-11-12',hour:0});
 assert.equal(reminderClock(new Date('2026-03-08T07:00:00Z')).hour,3);
});
test('legacy whole masechta expands into real mishnah catalogue units',async()=>{
 const full=await remainingLearning(async()=>({rows:[{idx:0,chapter:0,mishnah:0}]}),1,1,'mishnayos');
 assert.equal(full.length,MASECHTOS[0].chapters.reduce((a,b)=>a+b,0));
 assert.deepEqual(full.at(-1),{idx:0,chapter:9,mishnah:5});
});
test('learning email sends escaped content, exact units and retry key through Resend',async()=>{
 config.resendApiKey='synthetic';config.resendFromEmail='Family <mail@example.test>';config.publicUrl='https://example.test';
 let body;
 const mail={title:'משניות <test>',lines:['ברכות — פרק 1, משנה 1'],target:'2026-11-14',days:3,remaining:10,link:'https://example.test/#learn/1'};
 assert.equal(await sendLearningEmail('member@example.test',mail,'daily-key',async(url,options)=>{
   assert.equal(url,'https://api.resend.com/emails');assert.equal(options.headers['Idempotency-Key'],'daily-key');body=JSON.parse(options.body);return Response.json({id:'mail-1'});
 }),'mail-1');
 assert.match(body.html,/&lt;test&gt;/);assert.match(body.text,/פרק 1, משנה 1/);assert.match(body.text,/#me/);
 assert.deepEqual(body.to,['member@example.test']);
 await assert.rejects(sendLearningEmail('member@example.test',mail,'key',async()=>new Response('{}',{status:429})),/429/);
 await assert.rejects(sendLearningEmail('member@example.test',mail,'key',async()=>Response.json({})),/did not accept/);
});
