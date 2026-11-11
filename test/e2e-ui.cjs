
const { chromium } = require('playwright-core');
const fs = require('fs');
const BASE = process.argv[2], OUT = process.argv[3], QA_PHONE = process.argv[4], QA_PW = process.argv[5], TAG = process.argv[6] || 'local';
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const exe = fs.existsSync(EXE) ? EXE : fs.readdirSync(process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243').map((d) => process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1243/' + d + '/chrome-headless-shell').find((p) => fs.existsSync(p));
  const br = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const mob = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
  const desk = await br.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const admc = await br.newContext({ viewport: { width: 1280, height: 860 } });
  const A = await mob.newPage(), B = await desk.newPage(), AD = await admc.newPage();
  const errs = [];
  for (const [n, p] of [['A', A], ['B', B], ['AD', AD]]) { p.on('pageerror', (e) => errs.push(n + ' pageerror ' + e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(n + ' console ' + m.text()); }); p.on('dialog', (d) => d.accept()); }
  const shot = async (p, name, full = true) => { await sleep(400); await p.screenshot({ path: `${OUT}/familye-${TAG}-${name}.png`, fullPage: full }); log('shot', name); };
  const toast = async (p) => (await p.locator('#ts').textContent()).trim();
  const ph = Date.now() % 10000, phA = `555-010-${String(ph).padStart(4, '0')}`, phB = `555-010-${String((ph + 1) % 10000).padStart(4, '0')}`;
  // --- sign up A (mobile, side a) and B (desktop, side b)
  await A.goto(BASE); await A.waitForSelector('[data-form=login]'); await shot(A, 'login-390', false);
  await A.click('[data-act=authmode][data-v=signup]'); await A.fill('#fn', 'טעסט קאזין א'); await A.fill('#fp', phA); await A.fill('#fw', 'test-pass-1');
  await A.click('[data-act=pick][data-v=a]'); await A.fill('#fnote', 'QA טעסט'); await shot(A, 'signup-390', true);
  await A.click('[data-form=signup] button.btn:not([type=button])'); await A.waitForSelector('[data-act=recheck]'); await shot(A, 'pending-390', false);
  await B.goto(BASE); await B.click('[data-act=authmode][data-v=signup]'); await B.fill('#fn', 'טעסט קאזין ב'); await B.fill('#fp', phB); await B.fill('#fw', 'test-pass-2');
  await B.click('[data-act=pick][data-v=b]'); await B.click('[data-form=signup] button.btn:not([type=button])'); await B.waitForSelector('[data-act=recheck]');
  log('signed up', phA, phB);
  // --- admin approves
  await AD.goto(BASE); await AD.fill('#fp', QA_PHONE); await AD.fill('#fw', QA_PW); await AD.click('[data-form=login] button.btn'); await AD.waitForSelector('nav.side a');
  await AD.goto(BASE + '/#admin'); await AD.waitForSelector('[data-act=approve]'); await shot(AD, 'admin-1280');
  for (let i = 0; i < 2; i++) { await AD.click('[data-act=approve]'); await sleep(900); }
  log('approved; pending left:', await AD.locator('h2').first().textContent());
  // --- A: home, yahrzeit
  await A.click('[data-act=recheck]'); await A.waitForSelector('.tabbar a'); await shot(A, 'home-empty-390', false);
  await A.goto(BASE + '/#yz'); await A.waitForSelector('[data-act=edityz][data-id="0"]'); await A.click('[data-act=edityz][data-id="0"]');
  await A.fill('#yn', 'ר׳ אברהם באכנער'); await A.fill('#yf', 'בן ר׳ יצחק ז״ל'); await A.fill('#yr', 'זיידע'); await A.selectOption('#yd', '23'); await A.selectOption('#ym', 'KISLEV'); await A.fill('#yk', 'מאנסי');
  await shot(A, 'yz-form-390', false); await A.click('[data-form=yz] button.btn:not([type=button])'); await A.waitForSelector('.row [data-act=remind]');
  await A.click('[data-act=remind]'); await sleep(800); log('remind toast:', await toast(A));
  const yzText = await A.locator('.row').first().innerText(); log('yz row:', yzText.replace(/\n/g, ' | '));
  await shot(A, 'yahrzeits-390', false);
  // --- A: tree
  await A.goto(BASE + '/#tree'); await A.waitForSelector('[data-act=editp][data-id="0"]'); await A.click('[data-act=editp][data-id="0"]');
  await A.fill('#pn', 'ר׳ אברהם באכנער'); await A.fill('#psp', 'מרת שרה'); await A.check('#pnif'); await A.click('[data-form=person] button.btn:not([type=button])'); await A.waitForSelector('.pn');
  for (const [n, sp] of [['ר׳ משה', 'רחל'], ['ר׳ יעקב', 'לאה']]) { await A.click('.pn >> nth=0'); await A.click('[data-act=addchild]'); await A.fill('#pn', n); await A.fill('#psp', sp); await A.click('[data-form=person] button.btn:not([type=button])'); await sleep(700); }
  await A.click('.pn:has-text("ר׳ משה")'); await A.click('[data-act=addchild]'); await A.fill('#pn', 'יואל'); await A.click('[data-form=person] button.btn:not([type=button])'); await sleep(700);
  log('tree nodes:', await A.locator('.pn').count()); await shot(A, 'tree-390', false);
  // --- A: tehillim list from yahrzeit
  await A.goto(BASE + '/#yz'); await A.waitForSelector('[data-act=newlist]'); await A.click('[data-act=newlist]'); await A.waitForSelector('#lk');
  await A.click('[data-form=list] button.btn:not([type=button])'); await A.waitForSelector('.perek');
  await A.click('.perek .pk >> nth=0'); await sleep(700); await A.click('.perek .pk >> nth=22'); await sleep(700); log('take toast:', await toast(A));
  await A.click('.perek .pk >> nth=0'); await A.click('[data-act=itemact][data-v=done]'); await sleep(700);
  await shot(A, 'tehillim-390', false);
  const listUrl = A.url();
  // mishnayos list
  await A.goto(BASE + '/#learn'); await A.waitForSelector('[data-act=newlist]'); await A.click('[data-act=newlist][data-yz="0"]'); await A.selectOption('#lk', 'mishnayos'); await A.fill('#ln', 'ר׳ חיים בן ר׳ שמעון ז״ל'); await A.selectOption('#ls', 'a');
  await A.click('[data-form=list] button.btn:not([type=button])'); await A.waitForSelector('.ms'); log('masechtos:', await A.locator('.ms .pk').count());
  await A.click('.ms .pk:has-text("ברכות")'); await sleep(700); await shot(A, 'mishnayos-390', false);
  // --- A: simcha with invitation upload
  await A.goto(BASE + '/#sim'); await A.waitForSelector('[data-act=editsim][data-id="0"]'); await A.click('[data-act=editsim][data-id="0"]');
  await A.selectOption('#sk', 'בר מצוה'); await A.fill('#sw', 'טעסט קאזין א'); await A.fill('#sd', '2026-12-06'); await A.fill('#stt', '7:30 נאכמיטאג'); await A.fill('#sp', 'אולם בית שמחה'); await A.fill('#sa', '51 Forest Rd, Monroe, NY 10950');
  await A.setInputFiles('#sf', '/tmp/famtest/test-invitation.jpg'); await A.selectOption('#ss', 'all'); await shot(A, 'sim-form-390', false);
  await A.click('#simsave'); await A.waitForSelector('.simgrid .card img.inv'); await A.click('[data-act=ppl][data-d="1"]'); await A.click('[data-act=ppl][data-d="1"]'); await A.click('[data-act=rsvp][data-v=yes]'); await sleep(900);
  log('rsvp:', await A.locator('[data-act=who]').first().textContent()); await shot(A, 'simchas-390', true);
  const gm = await A.locator('.simgrid a.gm').first().getAttribute('href'), wz = await A.locator('.simgrid a.wz').first().getAttribute('href'); log('maps', gm, wz);
  const imgOk = await A.evaluate(() => { const i = document.querySelector('img.inv'); return i.complete && i.naturalWidth; }); log('invitation img width', imgOk);
  await A.click('[data-act=showinv]'); await sleep(800); await shot(A, 'invitation-big-390', false); await A.click('#mb [data-act=close]');
  // --- B (desktop, other side): sees simcha (all), RSVPs, cannot see side-a list
  await B.click('[data-act=recheck]'); await B.waitForSelector('nav.side a'); await B.goto(BASE + '/#sim'); await B.waitForSelector('.simgrid .card');
  await B.click('[data-act=rsvp][data-v=yes]'); await sleep(800); log('B sees rsvp:', await B.locator('[data-act=who]').first().textContent());
  const dl = await Promise.all([B.waitForEvent('download'), B.click('.simgrid a:has-text("דאונלאוד")')]); log('download', dl[0].suggestedFilename()); 
  await shot(B, 'simchas-1280', false);
  await B.goto(BASE + '/#learn/' + listUrl.split('/').pop()); await sleep(1200); log('B on side-a list:', (await B.locator('main').innerText()).slice(0, 80).replace(/\n/g, ' '));
  // B makes own tehillim list for side b and A shouldn't see it
  // --- chat both ways
  await A.goto(BASE + '/#chat'); await A.waitForSelector('#ci'); log('A rooms:', await A.locator('[data-act=room]').count());
  await B.goto(BASE + '/#chat'); await B.waitForSelector('#ci'); log('B rooms:', await B.locator('[data-act=room]').count());
  await B.fill('#ci', 'שלום פון סייד ב! 👋'); await B.press('#ci', 'Enter'); await sleep(500);
  await A.fill('#ci', 'גוט וואך אלעמען! ווער קומט צום בר מצוה?'); await A.click('[data-form=chat] button'); 
  await sleep(4500); log('A chat has B msg:', (await A.locator('#cb').innerText()).includes('סייד ב'), ' B has A msg:', (await B.locator('#cb').innerText()).includes('בר מצוה'));
  await shot(A, 'chat-390', false); await shot(B, 'chat-1280', false);
  // --- directory
  await A.goto(BASE + '/#people'); await A.waitForSelector('[data-mine="1"]'); await A.click('[data-act=editdir][data-mine="1"]');
  await A.fill('#dw', 'מרת טעסט'); await A.fill('#dp', 'זון פון ר׳ משה באכנער'); await A.fill('#da', '12 Main St, Monsey, NY 10952'); await A.fill('#dph', '845-555-0101'); await A.fill('#dpw', '845-555-0102');
  await A.click('[data-form=dir] button.btn:not([type=button])'); await A.waitForSelector('#dirlist .card');
  await A.fill('#q', 'Monsey'); await sleep(300); log('search count:', await A.locator('#qn').textContent()); await shot(A, 'cousins-390', false);
  const csv = await Promise.all([A.waitForEvent('download'), A.click('a:has-text("Excel")')]); const cp = await csv[0].path(); const cb = fs.readFileSync(cp); log('csv', csv[0].suggestedFilename(), 'BOM', cb.slice(0, 3).toString('hex'), cb.toString('utf8').split('\n')[1]);
  // --- home screens
  await A.goto(BASE + '/#home'); await A.waitForSelector('h1'); await sleep(500); await shot(A, 'home-390', true);
  await A.click('[data-act=more]'); await sleep(300); await shot(A, 'more-menu-390', false); await A.click('#mb [data-act=close]');
  await B.goto(BASE + '/#home'); await B.waitForSelector('h1'); await sleep(500); await shot(B, 'home-1280', true);
  await AD.goto(BASE + '/#tree'); await AD.waitForSelector('.pn'); await shot(AD, 'tree-1280', false);
  await AD.goto(BASE + '/#yz'); await AD.waitForSelector('.row'); await shot(AD, 'yahrzeits-1280', false);
  // horizontal overflow check on phone
  for (const v of ['home', 'yz', 'tree', 'learn', 'sim', 'chat', 'people']) { await A.goto(BASE + '/#' + v); await sleep(700); const o = await A.evaluate(() => document.documentElement.scrollWidth); if (o > 391) log('OVERFLOW', v, o); }
  log('errors:', JSON.stringify(errs));
  fs.writeFileSync(`${OUT}/qa-phones-${TAG}.json`, JSON.stringify({ phA, phB }));
  await br.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
