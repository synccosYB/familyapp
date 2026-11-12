// Loaded only by the integration test's child process. Never sends real email.
import {appendFileSync} from 'node:fs';
const originalFetch=globalThis.fetch;
let rejectedLearningBatch=false;
globalThis.fetch=async(url,options)=>{
  if(String(url)==='https://api.resend.com/emails/batch'){
    if(!process.env.FAMILYE_EMAIL_CAPTURE)throw new Error('Missing test email capture');
    const messages=JSON.parse(options.body);
    if(messages.some(m=>m.to[0]==='learning-retry@example.test')&&!rejectedLearningBatch){
      rejectedLearningBatch=true;
      return new Response('{}',{status:503});
    }
    for(const message of messages)appendFileSync(process.env.FAMILYE_EMAIL_CAPTURE,JSON.stringify(message)+'\n');
    return Response.json({data:messages.map((_,i)=>({id:'test-learning-'+i}))});
  }
  if(String(url)!=='https://api.resend.com/emails')return originalFetch(url,options);
  if(!process.env.FAMILYE_EMAIL_CAPTURE)throw new Error('Missing test email capture');
  const message=JSON.parse(options.body);
  if(message.to[0]==='failure@example.test')return new Response('{}',{status:503});
  appendFileSync(process.env.FAMILYE_EMAIL_CAPTURE,JSON.stringify(message)+'\n');
  return Response.json({id:'test-provider-id'});
};
