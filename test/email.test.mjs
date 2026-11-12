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
