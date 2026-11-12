import {test} from 'node:test';
import assert from 'node:assert/strict';
import {config} from '../dist/config.js';
import {dailyLearning,reminderClock,sendLearningEmail,remainingLearning} from '../dist/learning-reminders.js';
import {MASECHTOS} from '../dist/masechtos.js';
import {learningText} from '../dist/learning-text.js';
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
test('bundled Hebrew text covers every selectable Mishnah and Tehillim chapter',()=>{
 for (const [idx,masechta] of MASECHTOS.entries()) {
   for (const [chapter,count] of masechta.chapters.entries()) {
     for (let mishnah=1;mishnah<=count;mishnah++) {
       assert.match(learningText('mishnayos',{idx,chapter:chapter+1,mishnah}),/[א-ת]/);
     }
   }
 }
 for (let idx=1;idx<=150;idx++) assert.match(learningText('tehillim',{idx,chapter:0,mishnah:0}),/[א-ת]/);
 const withoutMarks = text => text.replace(/\p{M}/gu,'');
 assert.match(withoutMarks(learningText('mishnayos',{idx:0,chapter:1,mishnah:1})),/^מאימתי קורין את שמע/);
 assert.equal(learningText('tehillim',{idx:119,chapter:0,mishnah:0}).split('\n').length,176);
});
test('learning email sends escaped content, exact units and retry key through Resend',async()=>{
 config.resendApiKey='synthetic';config.resendFromEmail='Family <mail@example.test>';config.publicUrl='https://example.test';
 let body;
 const text=learningText('mishnayos',{idx:0,chapter:1,mishnah:1});
 const mail={title:'משניות <test>',lines:['ברכות — פרק 1, משנה 1'],texts:[text],target:'2026-11-14',days:3,remaining:10,link:'https://example.test/#learn/1'};
 assert.equal(await sendLearningEmail('member@example.test',mail,'daily-key',async(url,options)=>{
   assert.equal(url,'https://api.resend.com/emails');assert.equal(options.headers['Idempotency-Key'],'daily-key');body=JSON.parse(options.body);return Response.json({id:'mail-1'});
 }),'mail-1');
 assert.match(body.html,/&lt;test&gt;/);assert.match(body.text,/פרק 1, משנה 1/);assert.match(body.text,/#me/);
 assert.ok(body.html.includes(text) && body.text.includes(text));
 assert.match(body.html,/dir="rtl" lang="he"/);
 assert.equal(body.attachments,undefined);
 assert.deepEqual(body.to,['member@example.test']);
 const longMail={...mail,lines:['First passage','Long passage','Last passage'],texts:[text,text.repeat(300),'סוף הלימוד']};
 await sendLearningEmail('member@example.test',longMail,'long-key',async(url,options)=>{
   body=JSON.parse(options.body);return Response.json({id:'mail-2'});
 });
 assert.ok(body.html.includes('First passage'));
 assert.doesNotMatch(body.html,/Last passage/);
 assert.ok(Buffer.byteLength(body.html)<70*1024);
 assert.match(Buffer.from(body.attachments[0].content,'base64').toString('utf8'),/Last passage\nסוף הלימוד/);
 await assert.rejects(sendLearningEmail('member@example.test',mail,'key',async()=>new Response('{}',{status:429})),/429/);
 await assert.rejects(sendLearningEmail('member@example.test',mail,'key',async()=>Response.json({})),/did not accept/);
});
