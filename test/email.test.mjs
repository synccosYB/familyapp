import {test} from 'node:test';
import assert from 'node:assert/strict';
import {config} from '../dist/config.js';
import {normalizeEmail,sendAccountEmail,emailReady} from '../dist/email.js';
test('recovery email validation and Resend payload',async()=>{
  assert.equal(normalizeEmail(' Owner@Example.TEST '),'owner@example.test');
  for(const email of ['bad','x@y','a\r\nb@x.test','<a>@x.test'])assert.equal(normalizeEmail(email),'');
  config.resendApiKey='';config.resendFromEmail='';assert.equal(emailReady(),false);
  await assert.rejects(sendAccountEmail('owner@example.test','verify','https://example.test/#verifyemail=abc','hash'),/not configured/);
  config.resendApiKey='synthetic-test-key';config.resendFromEmail='Family <noreply@example.test>';
  let payload;
  const id=await sendAccountEmail('owner@example.test','reset','https://example.test/#setpw=abc&x="<>','hashed-token',async(url,options)=>{
    assert.equal(url,'https://api.resend.com/emails');assert.equal(options.headers.Authorization,'Bearer synthetic-test-key');
    assert.equal(options.headers['Idempotency-Key'],'familye/reset/hashed-token');
    payload=JSON.parse(options.body);return Response.json({id:'accepted'});
  });
  assert.equal(id,'accepted');assert.deepEqual(payload.to,['owner@example.test']);assert.match(payload.html,/dir="rtl"/);
  assert.match(payload.html,/&amp;x=&quot;&lt;&gt;/);assert.ok(!payload.html.includes('synthetic-test-key'));
  await assert.rejects(sendAccountEmail('owner@example.test','verify','https://example.test','hash',async()=>new Response('{}',{status:403})),/403/);
  await assert.rejects(sendAccountEmail('owner@example.test','verify','https://example.test','hash',async()=>Response.json({})),/did not accept/);
});


test('invitation mail sends privately through Resend with a stable retry key',async()=>{
 const {sendInvitationEmail}=await import('../dist/invitation-emails.js');
 config.resendApiKey='synthetic-test-key';config.resendFromEmail='Family <noreply@example.test>';
 let payload;
 assert.equal(await sendInvitationEmail('member@example.test',{title:'Wedding <test>',lines:['Hall & address'],link:'https://example.test/#sim/3/3'},'familye/invitation/3/4',async(url,options)=>{
  assert.equal(url,'https://api.resend.com/emails');assert.equal(options.headers['Idempotency-Key'],'familye/invitation/3/4');payload=JSON.parse(options.body);return Response.json({id:'accepted'});
 }),'accepted');
 assert.deepEqual(payload.to,['member@example.test']);assert.equal(payload.cc,undefined);assert.equal(payload.bcc,undefined);
 assert.match(payload.html,/Wedding &lt;test&gt;/);assert.match(payload.html,/Hall &amp; address/);assert.match(payload.text,/#sim\/3\/3/);
 await assert.rejects(sendInvitationEmail('member@example.test',{title:'Test',lines:[],link:'https://example.test'},'retry-key',async()=>new Response('{}',{status:429})),/429/);
});
