'use strict';
const $=s=>document.querySelector(s);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SIDES={f:'טאטעס סייד · באכנער',m:'מאמעס סייד · בידערמאן',all:'אלע קאזינס'};
const MONTHS=['תשרי','חשון','כסלו','טבת','שבט','אדר','אדר א׳','אדר ב׳','ניסן','אייר','סיון','תמוז','אב','אלול'];
const TRACTATES=['ברכות','פאה','דמאי','כלאים','שביעית','תרומות','מעשרות','מעשר שני','חלה','ערלה','בכורים','שבת','עירובין','פסחים','שקלים','יומא','סוכה','ביצה','ראש השנה','תענית','מגילה','מועד קטן','חגיגה','יבמות','כתובות','נדרים','נזיר','סוטה','גיטין','קידושין','בבא קמא','בבא מציעא','בבא בתרא','סנהדרין','מכות','שבועות','עדיות','עבודה זרה','אבות','הוריות','זבחים','מנחות','חולין','בכורות','ערכין','תמורה','כריתות','מעילה','תמיד','מדות','קנים','כלים','אהלות','נגעים','פרה','טהרות','מקואות','נדה','מכשירין','זבים','טבול יום','ידים','עוקצין'];
const PAGES=[['home','🏠 היים'],['yahrzeit','🕯️ יארצייטן'],['person','🌳 פעמילי טרי'],['learning','📖 משניות און תהילים'],['simcha','🎉 שמחות'],['chat','💬 טשעט'],['directory','👥 קאזינס / אדרעסן']];
const TITLES=Object.fromEntries(PAGES);
let user=null,records=[],scope='all',page='home',inviteToken='',renderVersion=0,toastTimer;
if(location.hash.startsWith('#invite=')){inviteToken=location.hash.slice(8);history.replaceState(null,'',location.pathname);}
async function api(path,method='GET',body){
 const response=await fetch('/api'+path,{method,credentials:'same-origin',headers:body instanceof FormData?{}:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
 const data=await response.json().catch(()=>({}));
 if(!response.ok){if(response.status===401&&user){user=null;records=[];$('#dialog').close();renderLogin();}throw new Error(data.message||'קיין פארבינדונג. פרוביר נאכאמאל.');}
 return data;
}
function toast(message){clearTimeout(toastTimer);$('#global-status').textContent=message;toastTimer=setTimeout(()=>$('#global-status').textContent='',5000);}
const empty=message=>`<div class="empty">${esc(message||'נאך נישט דא קיין פרטים. לייג צו דעם ערשטן.')}</div>`;
const badge=s=>`<span class="tag ${esc(s)}">${esc(SIDES[s])}</span>`;
const editable=r=>user.is_admin||r.owner_id===user.id;
const visible=kind=>records.filter(r=>(!kind||r.kind===kind)&&(scope==='all'||r.side===scope||r.side==='all'));
const options=(items,value)=>items.map(([v,label])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(label)}</option>`).join('');
const sideOptions=()=>[['all',SIDES.all],...user.sides.map(s=>[s,SIDES[s]])];
function nav(){
 $('#nav').innerHTML=`<div class="lg">אונדזער משפחה</div><div class="sd">${esc(user.name)}</div>`+PAGES.map(([k,v])=>`<a href="#${k}" ${page===k?'class="on" aria-current="page"':''}>${v}</a>`).join('')+(user.is_admin?`<a href="#admin" ${page==='admin'?'class="on" aria-current="page"':''}>⚙️ אינווייטס</a>`:'')+'<button data-action="logout">↩ לאג אאוט</button>';
}
function filter(){return `<div class="side-filter" role="group" aria-label="פאמיליע סייד">${sideOptions().map(([s,label])=>`<button class="btn s l ${scope===s?'on':''}" aria-pressed="${scope===s}" data-action="scope" data-side="${s}">${esc(label)}</button>`).join('')}</div>`;}
const dateLabel=value=>new Intl.DateTimeFormat('en-US',{dateStyle:'medium'}).format(new Date(value+'T12:00:00'));
function maps(address){if(!address)return '';return `<a class="btn s l" target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}">Google Maps</a><a class="btn s l" target="_blank" rel="noopener noreferrer" href="https://waze.com/ul?q=${encodeURIComponent(address)}&navigate=yes">Waze</a>`;}
function controls(r){return editable(r)?`<button class="btn s l" data-action="edit" data-id="${r.id}">עדיט</button><button class="btn s l" data-action="delete" data-id="${r.id}">אויסמעקן</button>`:'';}
function renderLogin(register=!!inviteToken){
 $('#nav').innerHTML='';$('#main').innerHTML=`<div class="login"><h1>🌳 אונזער משפחה</h1><p class="cap">באכנער און בידערמאן · אלע קאזינס אין איין ארט</p><div class="card"><h2>${register?'עפן דיין אקאונט':'לאג אריין'}</h2><form id="login-form">${register?'<label>דיין נאמען<input name="name" autocomplete="name" required maxlength="200"></label>':''}<label>לאגין נאמען<input name="login" autocomplete="username" required maxlength="120" dir="auto"></label><label>פעסווארד<input name="password" type="password" autocomplete="'+(register?'new-password':'current-password')+'" required '+(register?'minlength="8"':'')+' maxlength="256"></label><label><input type="checkbox" data-action="password"> ווייז פעסווארד</label><div class="error" role="alert" hidden></div><button class="btn" type="submit">${register?'עפן אקאונט':'לאג אריין'}</button></form><p class="notice">${register?'דיין אינווייט באשטימט צו וועלכע סיידס דו האסט צוטריט. פעסווארד: כאטש 8 אותיות.':'פאר א נייעם אקאונט, בעט אן אינווייט פון דעם פאמיליע אדמין.'}</p></div></div>`;
 $('#login-form').addEventListener('submit',async event=>{
  event.preventDefault();const f=event.currentTarget,b=f.querySelector('button[type=submit]'),error=f.querySelector('.error');b.disabled=true;error.hidden=true;
  try {const data=Object.fromEntries(new FormData(f));if(register)data.token=inviteToken;await api('/auth/'+(register?'register':'login'),'POST',data);inviteToken='';user=(await api('/auth/me')).user;location.hash='home';await load();}
  catch(e){error.textContent=e.message;error.hidden=false;}finally{b.disabled=false;}
 });
}
async function load(){records=(await api('/records')).records;await render();}
async function render(){
 if(!user)return renderLogin();const version=++renderVersion;page=location.hash.slice(1)||'home';if(!TITLES[page]&&page!=='admin')page='home';nav();
 let body='';
 if(page==='home'){
  const count=k=>records.filter(r=>r.kind===k).length;
  const today=new Date().toLocaleDateString('en-CA');
  const upcoming=records.filter(r=>r.kind==='simcha'&&r.data.date>=today).sort((a,b)=>a.data.date.localeCompare(b.data.date));
  body=`<h1>שלום ${esc(user.name)} 👋</h1><p class="cap">${user.sides.map(s=>esc(SIDES[s])).join(' · ')}</p><div class="grid g4">${[['directory','קאזינס'],['yahrzeit','יארצייטן'],['learning','לערנען'],['simcha','שמחות']].map(([k,t])=>`<a href="#${k}" class="card"><div class="muted">${t}</div><div class="big">${count(k)}</div></a>`).join('')}</div><h2>🎉 קומענדיגע שמחות</h2>${upcoming.map(simchaCard).join('')||empty('קיין קומענדיגע שמחות.')}`;
 } else if(page==='chat'){
  body=`<h1>${TITLES.chat}</h1>${filter()}<p class="cap">${esc(SIDES[scope])} · די לעצטע 100 מעסעדזשעס · דערפרישט יעדע 10 סעקונדעס</p><div class="card"><div id="messages" class="chat" aria-live="polite"></div><form id="chat-form" class="actions"><label class="grow">דיין מעסעדזש<input name="body" maxlength="2000" placeholder="שרייב א מעסעדזש…" required autocomplete="off"></label><button class="btn" type="submit">שיק</button></form></div>`;
 } else if(page==='admin') {
  if(!user.is_admin){body=empty('נאר פאר אדמין.');}else{
   const {invites}=await api('/invites');if(version!==renderVersion)return;
   body=`<h1>אינווייטס</h1><p class="cap">יעדער לינק ארבעט איין מאל, ביז 7 טעג. קלייב די ריכטיגע סיידס.</p><form id="invite-form" class="card"><label><input type="checkbox" name="f" checked> ${SIDES.f}</label><label><input type="checkbox" name="m"> ${SIDES.m}</label><button class="btn">מאך אן אינווייט</button><div id="invite-result" role="status"></div></form><h2>לעצטע אינווייטס</h2>${invites.map(i=>`<div class="row"><div class="grow">${i.sides.map(s=>esc(SIDES[s])).join(' · ')}<div class="muted" dir="ltr">${esc(new Date(i.expires_at).toLocaleString())}</div></div><span>${i.consumed_at?'גענוצט':new Date(i.expires_at)<new Date()?'אויסגעלאפן':'אפן'}</span><button class="btn s l" data-action="revoke" data-id="${i.id}">אויסמעקן</button></div>`).join('')||empty('נאך נישט דא קיין אינווייטס.')}`;
  }
 } else {
  body=`<div class="header"><h1>${TITLES[page]}</h1><button class="btn" data-action="new" data-kind="${page}">+ לייג צו</button></div>${filter()}`;
  const list=visible(page);
  if(page==='directory')body+=`<label>זוך נאמען, טעלעפאן אדער אדרעס<input id="search" type="search" placeholder="זוך…"></label><div class="actions"><button class="btn s l" data-action="export">דאונלאוד ליסט (CSV)</button></div><div class="grid g2" id="directory">${list.map(directoryCard).join('')||empty()}</div>`;
  if(page==='yahrzeit')body+=`<div class="banner">העברעאישע דאטעס ווערן געהאלטן לויט דעם אריינגעגעבענעם טאג און חודש. אויטאמאטישע יערליכע דאטעס און רימיינדערס קומען אין א שפעטערן שריט.</div>${list.map(r=>`<div class="row"><div class="grow"><b>${esc(r.data.name)}</b><div>${r.data.day} ${esc(r.data.month)} · ${esc(r.data.relationship)}</div><div class="muted">${esc(r.data.grave)}</div></div>${badge(r.side)}${controls(r)}</div>`).join('')||empty()}`;
  if(page==='person')body+=`<p class="cap">יעדער מענטש ווערט פארבונדן מיט זיין עלטערן אין דער זעלבער סייד.</p><div class="card forest">${forest(list)}</div>`;
  if(page==='simcha')body+=list.sort((a,b)=>b.data.date.localeCompare(a.data.date)).map(simchaCard).join('')||empty();
  if(page==='learning')body+=list.map(r=>`<div class="card"><h2>${esc(r.data.title)}</h2>${badge(r.side)}<p>${r.data.kind==='tehillim'?'תהילים · 150 קאפיטלעך':'משניות · 63 מסכתות'} · ביז <bdi>${esc(dateLabel(r.data.deadline))}</bdi></p><div class="actions"><button class="btn" data-action="learning" data-id="${r.id}">קלייב א חלק</button>${controls(r)}</div></div>`).join('')||empty();
 }
 if(version!==renderVersion)return;
 $('#main').innerHTML=body+'<footer>אונדזער משפחה · באכנער / בידערמאן</footer>';
 $('#search')?.addEventListener('input',event=>{const q=event.target.value.toLocaleLowerCase();$('#directory').innerHTML=visible('directory').filter(r=>Object.values(r.data).join(' ').toLocaleLowerCase().includes(q)).map(directoryCard).join('')||empty('גארנישט געפונען.');});
 $('#chat-form')?.addEventListener('submit',async event=>{event.preventDefault();const f=event.currentTarget,b=f.querySelector('button');b.disabled=true;try{await api('/messages','POST',{side:scope,body:f.elements.body.value});f.reset();await refreshChat();}catch(e){toast(e.message);}finally{b.disabled=false;}});
 $('#invite-form')?.addEventListener('submit',async event=>{event.preventDefault();const f=event.currentTarget,b=f.querySelector('button');const sides=['f','m'].filter(s=>f.elements[s].checked);if(!sides.length)return toast('קלייב כאטש איין סייד.');b.disabled=true;try{const result=await api('/invites','POST',{sides});$('#invite-result').innerHTML=`<label>קאפיר דעם לינק און שיק צום קאזין<input readonly value="${esc(result.url)}" dir="ltr"></label><p class="notice">דער לינק ווערט נאר דא געוויזן. היט אים ביז דו שיקסט אים.</p>`;}catch(e){toast(e.message);}finally{b.disabled=false;}});
 if(page==='chat')await refreshChat();
}
function directoryCard(r){const d=r.data;return `<div class="card"><h2>${esc(d.husband)}${d.wife?' · '+esc(d.wife):''}</h2>${badge(r.side)}<p class="muted">${esc(d.parents)}</p><p>${esc(d.address)}</p><p>מאן: <bdi>${esc(d.phone||'—')}</bdi> · ווייב: <bdi>${esc(d.wifePhone||'—')}</bdi></p><div class="actions">${controls(r)}${maps(d.address)}</div></div>`;}
function simchaCard(r){const d=r.data;return `<div class="card"><h2>${esc(d.title)} · ${esc(d.host)}</h2>${badge(r.side)}<p><bdi>${esc(dateLabel(d.date))} ${esc(d.time)}</bdi> · ${esc(d.venue)}</p><p>${esc(d.address)}</p><div class="actions">${maps(d.address)}<button class="btn s" data-action="rsvp" data-id="${r.id}">אנטווארטן / זע ווער קומט</button>${r.has_attachment?`<a class="btn s l" href="/api/records/${r.id}/attachment">דאונלאוד אינוויטעישן</a>`:''}${editable(r)?`<button class="btn s l" data-action="upload" data-id="${r.id}">אפלאוד אינוויטעישן</button>`:''}${controls(r)}</div></div>`;}
function forest(list){if(!list.length)return empty();const byParent=new Map();for(const r of list){const parent=list.some(p=>p.id===r.data.parentId)?r.data.parentId:null;if(!byParent.has(parent))byParent.set(parent,[]);byParent.get(parent).push(r);}const seen=new Set();const branch=(parent,depth=0)=>{if(depth>100)return '';return '<ul>'+(byParent.get(parent)||[]).map(r=>{if(seen.has(r.id))return '';seen.add(r.id);return `<li><div class="pn ${r.data.deceased?'d':''}"><div>${esc(r.data.name)}${r.data.deceased?' ז״ל':''}</div><div class="muted">${esc(r.data.spouse)}</div>${badge(r.side)}<div class="actions">${controls(r)}</div></div>${byParent.has(r.id)?branch(r.id,depth+1):''}</li>`;}).join('')+'</ul>';};return branch(null);}
async function refreshChat(){if(page!=='chat'||!user||!$('#messages'))return;const requestedScope=scope;const {messages}=await api('/messages?side='+requestedScope);if(page!=='chat'||scope!==requestedScope||!$('#messages'))return;const box=$('#messages'),nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<80;box.innerHTML=messages.map(m=>`<div class="bub ${m.user_id===user.id?'me':''}"><div class="muted">${esc(m.name)} · ${esc(new Date(m.created_at).toLocaleString())}</div><p>${esc(m.body)}</p></div>`).join('')||empty('שיק דעם ערשטן מעסעדזש.');if(nearBottom)box.scrollTop=box.scrollHeight;}
function dialog(title,body){const d=$('#dialog');d.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${esc(title)}</h2><button class="btn s l" data-action="close" aria-label="פארמאכן">✕</button></div>${body}`;if(!d.open)d.showModal();}
const field=(key,label,value='',type='text',extra='')=>`<label>${esc(label)}<input name="${key}" type="${type}" value="${esc(value)}" ${extra}></label>`;
function editForm(kind,r){
 const data=r?.data||{},creation=!r,defaultSide=scope==='all'?'all':scope;
 const select=(key,label,items,value)=>`<label>${label}<select name="${key}">${options(items,value)}</select></label>`;
 let inputs='';
 if(kind==='directory')inputs=field('husband','מאן',data.husband)+field('wife','ווייב',data.wife)+field('parents','עלטערן',data.parents)+field('address','אדרעס',data.address)+field('phone','מאן טעלעפאן',data.phone,'tel')+field('wifePhone','ווייב טעלעפאן',data.wifePhone,'tel');
 if(kind==='person')inputs=field('name','נאמען',data.name,'text','required maxlength="200"')+field('spouse','מאן / ווייב',data.spouse)+select('parentId','קינד פון',[['','— קיין עלטערן —'],...records.filter(p=>p.kind==='person'&&p.id!==r?.id).map(p=>[p.id,p.data.name+' · '+SIDES[p.side]])],data.parentId||'')+`<label><input name="deceased" type="checkbox" ${data.deceased?'checked':''}> נפטר / נפטרת</label>`;
 if(kind==='yahrzeit')inputs=field('name','נאמען מיט טאטנס נאמען',data.name,'text','required maxlength="200"')+field('relationship','ווער איז ער / זי',data.relationship)+field('day','העברעאישער טאג',data.day||1,'number','min="1" max="30" required')+select('month','חודש',MONTHS.map(m=>[m,m]),data.month||'תשרי')+field('grave','קבר / אדרעס',data.grave);
 if(kind==='simcha')inputs=field('title','וואס פאר א שמחה',data.title,'text','required maxlength="200"')+field('host','פון וועמען',data.host||user.name,'text','required maxlength="200"')+field('date','דאטום',data.date,'date','required')+field('time','צייט',data.time,'time')+field('venue','זאל / פלאץ',data.venue)+field('address','אדרעס פאר GPS',data.address);
 if(kind==='learning')inputs=field('title','לעילוי נשמת / פאר וועמען',data.title,'text','required maxlength="200"')+select('kind','וואס לערנט מען',[['tehillim','תהילים'],['mishnayos','משניות']],data.kind||'tehillim')+field('deadline','ענדיגן ביז',data.deadline,'date','required');
 dialog((creation?'+ לייג צו · ':'עדיט · ')+TITLES[kind],`<form id="record-form">${creation?select('side','ווער קען זען',sideOptions(),defaultSide):`<p>${badge(r.side)}</p>`}<div class="form-grid">${inputs}</div><div class="error" hidden role="alert"></div><div class="actions"><button class="btn" type="submit">סעיוו</button><button class="btn l" type="button" data-action="close">קענסל</button></div></form>`);
 const form=$('#record-form');if(kind==='person'){const syncParents=()=>{const chosen=creation?form.elements.side.value:r.side;for(const option of form.elements.parentId.options){if(!option.value)continue;option.disabled=records.find(p=>p.id===option.value)?.side!==chosen;if(option.disabled&&option.selected)form.elements.parentId.value='';}};form.elements.side?.addEventListener('change',syncParents);syncParents();}
 if(kind==='learning'&&!creation){form.elements.kind.disabled=true;}
 form.addEventListener('submit',async event=>{event.preventDefault();const b=form.querySelector('button[type=submit]'),error=form.querySelector('.error');b.disabled=true;error.hidden=true;try{
  const values=Object.fromEntries(new FormData(form)),selectedSide=values.side;delete values.side;
  if(kind==='person'){values.deceased=form.elements.deceased.checked;values.parentId=values.parentId||null;}
  if(kind==='yahrzeit')values.day=Number(values.day);
  if(kind==='learning'&&!creation)values.kind=data.kind;
  if(creation)await api('/records','POST',{kind,side:selectedSide,data:values});else await api('/records/'+r.id,'PUT',{version:r.version,data:values});
  $('#dialog').close();await load();toast('✓ געזעיווט');
 }catch(e){error.textContent=e.message;error.hidden=false;}finally{b.disabled=false;}});
}
async function learning(r){
 const {claims}=await api('/records/'+r.id+'/claims'),total=r.data.kind==='tehillim'?150:63,complete=claims.filter(c=>c.completed).length;
 dialog(r.data.title,`<p>${claims.length} גענומען · ${complete} געענדיגט · פון ${total}</p><p class="notice">פריי: דריק צו נעמען. דיין חלק: דריק צו ענדיגן אדער צוריקגעבן.</p><div class="perek">${Array.from({length:total},(_,i)=>{const unit=i+1,c=claims.find(c=>c.unit===unit);return `<button class="pk ${c?.completed?'done':c?.user_id===user.id?'mine':c?'t':''}" data-action="claim" data-id="${r.id}" data-unit="${unit}" ${c&&c.user_id!==user.id?'disabled':''}>${r.data.kind==='tehillim'?unit:esc(TRACTATES[i])}<span>${c?esc(c.name)+(c.completed?' ✓':''):'פריי'}</span></button>`;}).join('')}</div>`);
}
async function rsvp(r){const {responses}=await api('/records/'+r.id+'/rsvp'),mine=responses.find(x=>x.user_id===user.id);dialog(r.data.title,`<p>${responses.filter(x=>x.answer==='yes').length} קומען</p><div class="actions"><button class="btn ${mine?.answer==='yes'?'':'l'}" data-action="answer" data-id="${r.id}" data-answer="yes">✓ איך קום</button><button class="btn ${mine?.answer==='no'?'':'l'}" data-action="answer" data-id="${r.id}" data-answer="no">קען נישט</button></div>${responses.map(x=>`<p>${esc(x.name)} · ${x.answer==='yes'?'קומט':'קען נישט'}</p>`).join('')}`);}
function upload(r){dialog('אפלאוד אינוויטעישן',`<p>PNG, JPG אדער PDF · ביז 5 MB · א נייער פייל ערזעצט דעם אלטן.</p><form id="upload-form"><label>קלייב פייל<input name="file" type="file" accept="image/png,image/jpeg,application/pdf" required></label><div class="error" hidden role="alert"></div><button class="btn">אפלאוד</button></form>`);$('#upload-form').addEventListener('submit',async event=>{event.preventDefault();const f=event.currentTarget,b=f.querySelector('button'),error=f.querySelector('.error');b.disabled=true;try{const file=f.elements.file.files[0];if(file.size>5*1024*1024)throw new Error('דער פייל איז גרעסער פון 5 MB.');await api('/records/'+r.id+'/attachment','POST',new FormData(f));$('#dialog').close();await load();toast('✓ אפגעלאודט');}catch(e){error.textContent=e.message;error.hidden=false;}finally{b.disabled=false;}});}
function exportDirectory(){const rows=visible('directory');const csvCell=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';const csv='\uFEFF'+[['מאן','ווייב','אדרעס','טעלעפאן מאן','טעלעפאן ווייב','עלטערן','סייד'],...rows.map(r=>[r.data.husband,r.data.wife,r.data.address,r.data.phone,r.data.wifePhone,r.data.parents,SIDES[r.side]])].map(row=>row.map(csvCell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='family-directory.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
document.addEventListener('click',async event=>{
 const b=event.target.closest('[data-action]');if(!b)return;const action=b.dataset.action,r=records.find(x=>x.id===b.dataset.id);
 if(action==='password'){const input=$('#login-form input[name=password]');if(input)input.type=b.checked?'text':'password';return;}
 b.disabled=true;
 try{
  if(action==='close')$('#dialog').close();
  if(action==='logout'){await api('/auth/logout','POST');user=null;records=[];scope='all';++renderVersion;$('#dialog').close();location.hash='';renderLogin(!!inviteToken);}
  if(action==='scope'){scope=b.dataset.side;await render();}
  if(action==='new')editForm(b.dataset.kind);
  if(action==='edit'&&r)editForm(r.kind,r);
  if(action==='delete'&&r){dialog('אויסמעקן?',`<p>די פרטים ווערן אויסגעמעקט, מיט אלע פארבונדענע אנטווארטן און פיילס.</p><button class="btn" data-action="confirm-delete" data-id="${r.id}">יא, אויסמעקן</button> <button class="btn l" data-action="close">קענסל</button>`);}
  if(action==='confirm-delete'){await api('/records/'+b.dataset.id,'DELETE');$('#dialog').close();await load();toast('אויסגעמעקט');}
  if(action==='learning'&&r)await learning(r);
  if(action==='claim'&&r){const unit=Number(b.dataset.unit),{claims}=await api('/records/'+r.id+'/claims');const mine=claims.find(c=>c.unit===unit);
   if(!mine){await api('/records/'+r.id+'/claims/'+unit,'PUT',{completed:false});await learning(r);}
   else if(mine.user_id===user.id)dialog('דיין חלק',`<p>${esc(r.data.kind==='tehillim'?unit:TRACTATES[unit-1])}</p><button class="btn" data-action="complete" data-id="${r.id}" data-unit="${unit}" data-value="${!mine.completed}">${mine.completed?'מארק נישט געענדיגט':'✓ געענדיגט'}</button> <button class="btn l" data-action="release" data-id="${r.id}" data-unit="${unit}">צוריקגעבן</button>`);
   else toast('שוין גענומען.');
  }
  if(action==='complete'){await api('/records/'+r.id+'/claims/'+b.dataset.unit,'PUT',{completed:b.dataset.value==='true'});await learning(r);}
  if(action==='release'){await api('/records/'+r.id+'/claims/'+b.dataset.unit,'DELETE');await learning(r);}
  if(action==='rsvp'&&r)await rsvp(r);
  if(action==='answer'&&r){await api('/records/'+r.id+'/rsvp','PUT',{answer:b.dataset.answer});await rsvp(r);}
  if(action==='upload'&&r)upload(r);
  if(action==='revoke'){await api('/invites/'+b.dataset.id,'DELETE');await render();}
  if(action==='export')exportDirectory();
 }catch(e){toast(e.message);}finally{b.disabled=false;}
});
window.addEventListener('hashchange',()=>{if(user){$('#dialog').close();render().catch(e=>toast(e.message));}});
setInterval(()=>{if(!document.hidden)refreshChat().catch(e=>toast(e.message));},10000);
(async()=>{try{user=(await api('/auth/me')).user;if(inviteToken){toast('דו ביסט שוין אריינגעלאגט. לאג ארויס פאר א נייעם אינווייט.');}await load();}catch(e){if(!user)renderLogin();else{$('#main').innerHTML='<div class="error">'+esc(e.message)+'</div><button class="btn" data-action="reload">פרוביר נאכאמאל</button>';}}})();
document.addEventListener('click',event=>{if(event.target.closest('[data-action="reload"]'))location.reload();});
