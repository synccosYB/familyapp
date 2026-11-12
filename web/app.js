'use strict';
import { familyUnits, treeViewportLayout } from './tree-layout.js';
import { marriageChildren, childParents } from './family-relationships.js';
import { automaticHebrewDate } from './hebrew-date.js';
// Familye client: one file, no framework. All server data is members-only; nothing secret lives here.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let ME = null, EMAIL_READY = false, S = {}, STATE = { side: 'all', room: 'all', q: '', treeView: window.innerWidth < 800 ? 'list' : 'tree', treeSide: null };
let POLL = null, LASTMSG = 0, SEEN = JSON.parse(localStorage.getItem('fam_seen') || '{}');

function toast(t) { const e = $('ts'); e.textContent = t; e.style.display = 'block'; clearTimeout(e._t); e._t = setTimeout(() => (e.style.display = 'none'), 2600); }
function modal(html, wide) { $('mb').className = 'mbox' + (wide ? ' wide' : ''); $('mb').innerHTML = html; $('md').classList.add('on'); const f = $('mb').querySelector('input:not([type=file]),select,textarea'); if (f && window.innerWidth > 800) f.focus(); }
let learningDialogTrigger = null;
function closeModal() {
  $('md').classList.remove('on'); $('mb').innerHTML = '';
  if (!learningDialogTrigger) return;
  for (const attr of ['role','aria-modal','aria-labelledby']) $('mb').removeAttribute(attr);
  for (const id of ['top','nav','m','tabs']) $(id).inert=false;
  if (learningDialogTrigger.isConnected) learningDialogTrigger.focus();
  learningDialogTrigger=null;
}

async function api(path, opts = {}) {
  const o = { method: opts.method || 'GET', headers: { 'x-familye': '1' }, credentials: 'same-origin' };
  if(ME?.acting)o.headers['x-family-act']=ME.acting.context;
  if(ME?.selected_family_group_id && !/^\/(me|auth)(\/|$)/.test(path))o.headers['x-family-group']=String(ME.selected_family_group_id);
  if (opts.body instanceof FormData) o.body = opts.body;
  else if (opts.body !== undefined) { o.body = JSON.stringify(opts.body); o.headers['content-type'] = 'application/json'; }
  const r = await fetch('/api' + path, o);
  let j = {}; try { j = await r.json(); } catch { /* */ }
  if (!r.ok) { const e = new Error(j.error || 'פעלער ' + r.status); e.status = r.status; e.details=j.details; throw e; }
  return j;
}
const fail = (e) => { if (e && e.status === 401) { ME = null; go(); } toast('⚠️ ' + (e.message || e)); };

// ---------- words ----------
const DAYS = ['זונטאג', 'מאנטאג', 'דינסטאג', 'מיטוואך', 'דאנערשטאג', 'פרייטאג', 'שבת'];
const MONTHS = ['יאנואר', 'פעברואר', 'מערץ', 'אפריל', 'מיי', 'יוני', 'יולי', 'אויגוסט', 'סעפטעמבער', 'אקטאבער', 'נאוועמבער', 'דעצעמבער'];
const HMONTHS = [['TISHREI', 'תשרי'], ['CHESHVAN', 'חשון'], ['KISLEV', 'כסלו'], ['TEVET', 'טבת'], ['SHVAT', 'שבט'], ['ADAR', 'אדר (נישט קיין עיבור יאר)'], ['ADAR_I', 'אדר א'], ['ADAR_II', 'אדר ב'], ['NISAN', 'ניסן'], ['IYYAR', 'אייר'], ['SIVAN', 'סיון'], ['TAMUZ', 'תמוז'], ['AV', 'אב'], ['ELUL', 'אלול']];
const SIMKINDS = ['חתונה', 'בר מצוה', 'בת מצוה', 'שלום זכר', 'ברית', 'קידוש', 'אופשערן', 'תנאים', 'ווארט', 'פדיון הבן', 'סיום', 'אנדערע'];
function gdate(ymd) { if (!ymd) return ''; const [y, m, d] = ymd.split('-').map(Number); const dt = new Date(y, m - 1, d); return `${DAYS[dt.getDay()]}, ${d} ${MONTHS[m - 1]} ${y}`; }
function inDays(n) { return n === 0 ? 'היינט!' : n === 1 ? 'מארגן' : n < 0 ? `פאר ${-n} טעג` : `אין ${n} טעג`; }
function heb(n) { const o = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'], t = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ']; let s = ''; if (n >= 100) { s += 'ק'; n -= 100; } if (n === 15) s += 'טו'; else if (n === 16) s += 'טז'; else s += t[Math.floor(n / 10)] + o[n % 10]; return s; }
const hebD = (n) => { const s = heb(n); return s.length > 1 ? s.slice(0, -1) + '״' + s.slice(-1) : s + '׳'; };
function hm(ts) { const d = new Date(ts); return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, ''); }
function dayKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function dayLabel(ts) { const d = new Date(ts), t = new Date(); const diff = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5); return diff === 0 ? 'היינט' : diff === 1 ? 'נעכטן' : `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`; }

const famOf = (c) => (c === 'a' ? S.side_a_family_yi : c === 'b' ? S.side_b_family_yi : '');
const sideName = (c) => (c === 'a' ? S.side_a_yi : c === 'b' ? S.side_b_yi : c === 'all' ? 'אלע קאזינס' : 'ביידע סיידס');
const sideLong = (c) => sideName(c) + (famOf(c) ? ' · משפחת ' + famOf(c) : '');
const sideTag = (c) => `<span class="tag ${c === 'a' || c === 'b' ? c : 'g'}">צוטריט: ${esc(c === 'a' || c === 'b' ? sideLong(c) : 'אלע אין דער משפחה')}</span>`;
const familyTags = (p) => (p.families || []).map(f=>`<span class="tag g family-connection">משפחה: ${esc(f.name)}</span>`).join(' ');
const knownAs = (p) => p.known_as ? `<span class="person-known-as" dir="auto">${esc(p.known_as)}</span>` : '';
const familyChoices = (rows) => [...new Map(rows.flatMap(p=>p.families || []).map(f=>[f.id,f])).values()].sort((a,b)=>a.name.localeCompare(b.name));
const familySelector = (rows,key,label) => field(label,`<select data-change="familyfilter" data-key="${key}"><option value="">אלע משפחות</option>${familyChoices(rows).map(f=>`<option value="${f.id}" ${Number(STATE[key])===f.id?'selected':''}>${esc(f.name)}</option>`).join('')}</select>`);
const isManager = () => ME && (ME.is_admin || ME.is_family_admin);
const managesAccounts = () => isManager() && !ME.acting;
const both = () => ME && (isManager() || (ME.sides.includes('a') && ME.sides.includes('b')));
const mySides = () => (isManager() ? ['a', 'b'] : ME.sides);
const vis = (s) => STATE.side === 'all' || s === STATE.side || s === 'both' || s === 'all';
function seg() { if (!both()) return ''; return `<div class="seg">${[['all', 'אלע גרופעס'], ['a', famOf('a') || sideName('a')], ['b', famOf('b') || sideName('b')]].map(([k, t]) => `<button class="${STATE.side === k ? 'on' : ''}" data-act="side" data-v="${k}">${esc(t)}</button>`).join('')}</div>`; }
function sideOptions(sel, withBoth = true, allLabel) {
  const o = mySides().map((c) => [c, sideLong(c)]);
  if (withBoth && both()) o.push([allLabel ? 'all' : 'both', allLabel || 'ביידע סיידס']);
  else if (allLabel) o.push(['all', allLabel]);
  return o.map(([k, t]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${esc(t)}</option>`).join('');
}
const gmap = (a) => 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(a);
const waze = (a) => 'https://waze.com/ul?q=' + encodeURIComponent(a) + '&navigate=yes';
const navBtns = (a) => (a ? `<a class="btn s gm" href="${gmap(a)}" target="_blank" rel="noopener">🗺️ Google Maps</a><a class="btn s wz" href="${waze(a)}" target="_blank" rel="noopener">🚗 Waze</a>` : '');
const tel = (p) => (p ? `<a href="tel:${esc(p.replace(/[^\d+]/g, ''))}" dir="ltr">📞 ${esc(p)}</a>` : '<span class="muted">—</span>');
const empty = (e, t, btn = '') => `<div class="empty"><div class="e">${e}</div><div>${t}</div>${btn ? `<div style="margin-top:12px">${btn}</div>` : ''}</div>`;
const field = (lbl, inner) => { const id=inner.match(/id="([^"]+)"/); return `<label${id ? ` for="${id[1]}"` : ''}>${lbl}</label>${inner}`; };
const val = (id) => ($(id) ? $(id).value.trim() : '');

// ---------- nav ----------
const PAGES = [['home', '🏠', 'היים'], ['yz', '🕯️', 'יארצייטן'], ['tree', '🌳', 'פעמילי טרי'], ['learn', '📖', 'משניות און תהילים'], ['sim', '🎉', 'שמחות'], ['chat', '💬', 'טשעט'], ['people', '👥', 'קאזינס / אדרעסן']];
let PENDING = 0, UNREAD = false;
function actingBanner() {
  const text=ME?.acting?`דו ביסט אריין אלס ${esc(ME.name)}`:'די צייט אלס מעמבער איז פארביי';
  return `<div class="acting-banner" role="status"><strong>${text}</strong><button type="button" class="btn s l" data-act="stopacting">צוריק צו אדמין</button></div>`;
}
function renderNav(v) {
  const extra = [['me', '👤', 'מיין אקאונט']]; if (managesAccounts()) extra.unshift(['admin', '🛡️', 'אדמין']);
  $('nav').innerHTML = `<div class="lg">${esc(S.family_yi)}</div><div class="sd">${esc(ME.name)} · ${esc(S.family_yi)}</div>` +
    [...PAGES, ...extra].map(([k, i, t]) => `<a class="${v === k ? 'on' : ''}" href="#${k}">${i} ${t}${k === 'admin' && PENDING ? `<span class="badge">${PENDING}</span>` : ''}${k === 'chat' && UNREAD ? '<span class="badge">●</span>' : ''}</a>`).join('') +
    `<a data-act="logout" style="margin-top:14px;opacity:.7">↩ לאג אאוט</a>`;
  const tb = [['home', '🏠', 'היים'], ['yz', '🕯️', 'יארצייטן'], ['sim', '🎉', 'שמחות'], ['chat', '💬', 'טשעט'], ['more', '☰', 'מער']];
  const inMore = !['home', 'yz', 'sim', 'chat'].includes(v);
  $('tabs').innerHTML = tb.map(([k, i, t]) => `<a class="${(k === v || (k === 'more' && inMore)) ? 'on' : ''}" ${k === 'more' ? 'data-act="more"' : `href="#${k}"`}><span class="i">${i}</span>${t}${k === 'chat' && UNREAD ? '<span class="badge">●</span>' : ''}${k === 'more' && PENDING ? `<span class="badge">${PENDING}</span>` : ''}</a>`).join('');
  $('top').innerHTML = `<div class="topbar"><b>🌳 ${esc(S.family_yi)}</b><span>${esc(ME.name.split(' ')[0])}</span></div>${(ME.family_groups||[]).length>1?`<label class="family-switch">משפחה וואס דו קוקסט<select aria-label="משפחה וואס דו קוקסט" data-change="viewgroup">${ME.family_groups.map(g=>`<option value="${g.id}" ${g.id===ME.selected_family_group_id?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label>`:''}`;
  if(ME.acting)$('top').insertAdjacentHTML('afterbegin',actingBanner());
}
function moreSheet() {
  const L = [['tree', '🌳', 'פעמילי טרי'], ['learn', '📖', 'משניות און תהילים'], ['people', '👥', 'קאזינס / אדרעסן'], ...(managesAccounts() ? [['admin', '🛡️', 'אדמין' + (PENDING ? ` (${PENDING} ווארטן)` : '')]] : []), ['me', '👤', 'מיין אקאונט']];
  modal(`<div class="sheet">${L.map(([k, i, t]) => `<a href="#${k}" data-act="close">${i} ${t}</a>`).join('')}<a data-act="logout">↩ לאג אאוט</a></div><button class="btn l" style="width:100%;margin-top:12px" data-act="close">צומאכן</button>`);
}

// ---------- views ----------
const V = {};
V.login = () => {
  const mode = STATE.authMode || 'login';
  const sides = STATE.joinSides || STATE.pickSides || [];
  return `<div class="login"><div style="font-size:54px">🌳</div><h1>${esc(S.family_yi)}</h1><div class="cap">אלע קאזינס אין איין ארט: יארצייטן, פעמילי טרי, לערנען, שמחות און טשעט.</div>
  <div class="seg"><button class="${mode === 'login' ? 'on' : ''}" data-act="authmode" data-v="login">לאג אין</button><button class="${mode === 'signup' ? 'on' : ''}" data-act="authmode" data-v="signup">מאך דיין אייגענע משפחה</button></div>
  <form data-form="${mode}" class="card" style="text-align:right">
  ${mode === 'signup' ? field('דיין נאמען (ווי די משפחה קען דיך)', '<input id="fn" autocomplete="name" placeholder="למשל: יואל באכנער">') : ''}
  ${field('טעלעפאן נומער', '<input id="fp" type="tel" inputmode="tel" autocomplete="tel" class="ltr" placeholder="845-555-1234">')}
  ${field('פאסווארט', `<input id="fw" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" ${mode === 'signup' ? 'placeholder="כאטש 6 אותיות"' : ''}>`)}
  ${mode === 'signup' && STATE.joinSides ? `<div class="card" role="status"><b>איינגעלאדנט צו: ${esc(STATE.joinFamily || '')}</b><p>דו ווערסט אויטאמאטיש צוגעטיילט צו דער משפחה.</p></div>${field('וועמענס קינד/אייניקל ביסטו?', '<input id="fnote">')}` : mode === 'signup' ? `${field('נאמען פון דיין נייע משפחה', '<input id="newfamilyname" maxlength="120" required>')}<p class="muted">דאס מאכט א נייע, באזונדערע משפחה. דו וועסט זיין אדמין נאר פון דער משפחה. צו דזשוינען אן עקזיסטירנדיקע משפחה, בעט אן אינוויטעישן לינק.</p>` : ''}
  <div class="err" id="ferr"></div>
  <button class="btn" style="width:100%">${mode === 'signup' ? 'מאך אן אקאונט' : 'לאג אין'}</button>
  ${mode === 'login' ? '<div class="muted" style="margin-top:12px"><button type="button" class="btn l" data-act="forgotpw">פארגעסן דאס פאסווארט?</button></div>' : `<div class="muted" style="margin-top:12px">${STATE.joinSides ? 'מיט דיין אינוויטעישן קענסטו גלייך אריין.' : 'דיין נייע משפחה וועט זיין באזונדער פון אלע אנדערע.'}</div>`}
  </form></div>`;
};
V.pending = () => `<div class="login"><div style="font-size:54px">⏳</div><h1>שלום ${esc(ME.name.split(' ')[0])}!</h1>
  <div class="card"><b>${ME.status === 'rejected' ? 'דער אקאונט איז נישט אפרובירט געווארן.' : 'דיין אקאונט ווארט אויף אפרוביישן פון דעם אדמין.'}</b>
  <div class="muted" style="margin-top:8px">${ME.status === 'rejected' ? 'רעד מיט דעם אדמין אויב דאס איז א טעות.' : 'ווען ער אפרובירט, קענסטו אריין. דו קענסט אים שרייבן אז דו האסט זיך רעדזשיסטרירט.'}</div>
  <div class="btns" style="justify-content:center;margin-top:14px"><button class="btn" data-act="recheck">🔄 טשעק נאכאמאל</button><button class="btn l" data-act="logout">לאג אאוט</button></div></div></div>`;
V.forgotpw = () => `<div class="login"><div style="font-size:54px">🔑</div><h1>פארגעסן דאס פאסווארט?</h1>
  ${STATE.resetRequested ? '<div class="card" role="status">אויב דער נומער האט אן אקאונט מיט א באשטעטיגטן אימעיל, וועט דארט אנקומען א פאסווארט לינק. קוק אויך אין ספעם. אויב עס קומט נישט אן, רעד מיט דעם אדמין פאר הילף.</div>' : `<p class="cap">שרייב דעם טעלעפאן נומער פון דיין אקאונט. א פאסווארט לינק וועט געשיקט ווערן צו דיין באשטעטיגטן אימעיל. אן א באשטעטיגטן אימעיל קען דער אדמין העלפן.</p><form data-form="forgotpw" class="card">
  ${field('טעלעפאן נומער', `<input id="resetphone" type="tel" inputmode="tel" autocomplete="tel" class="ltr" value="${esc(STATE.resetPhone || '')}">`)}<div class="err" role="alert"></div><button class="btn">בעט א פאסווארט לינק</button></form>`}
  <button class="btn l" style="margin-top:14px" data-act="backlogin">צוריק צו לאג אין</button></div>`;
V.verifyemail = () => `<div class="login"><h1>באשטעטיג דיין אימעיל</h1><p class="cap">דריק אויפן קנעפל צו באשטעטיגן דעם אימעיל פאר דיין אקאונט.</p><form data-form="verifyemail" class="card"><div class="err" role="alert"></div><button class="btn">באשטעטיג מיין אימעיל</button></form></div>`;
V.setpw = () => `<div class="login"><div style="font-size:54px">🔑</div><h1>שטעל איין דיין פאסווארט</h1><div class="cap" id="spn">מען קאנטראלירט דעם לינק…</div>
  <form data-form="setpw" class="card" style="text-align:right">${field('נייע פאסווארט', '<input id="sp1" type="password" autocomplete="new-password" placeholder="כאטש 6 אותיות">')}${field('נאכאמאל', '<input id="sp2" type="password" autocomplete="new-password">')}
  <div class="err" id="ferr" role="alert"></div><button class="btn" id="setpwsubmit" disabled style="width:100%">סעיוו און לאג אין</button></form><button class="btn l" style="margin-top:14px" data-act="forgotpw">בעט א נייעם לינק</button></div>`;

V.home = async () => {
  const h = await api('/home'); PENDING = h.pending;
  const nx = h.yahrzeits[0];
  return `<h1>שלום ${esc(ME.name.split(' ')[0])} 👋</h1><div class="cap">היינט: ${esc(h.today)} · משפחה וואס דו קוקסט: ${esc(S.family_yi)}</div>
  ${h.pending ? `<a class="row" href="#admin" style="text-decoration:none;color:inherit;background:#fffbeb;border-color:#fcd34d"><div class="grow"><b>🛡️ ${h.pending} נייע קאזינס ווארטן אויף אפרוביישן</b></div><span class="btn s">קוק</span></a>` : ''}
  <div class="grid g4"><a class="card" href="#yz" style="text-decoration:none;color:inherit"><div class="muted">נעקסטע יארצייט</div><div class="big" style="font-size:20px">${nx ? esc(nx.hebrew) : '—'}</div><div class="muted">${nx ? inDays(nx.next.days) : 'נאך נישטא'}</div></a>
  <a class="card" href="#sim" style="text-decoration:none;color:inherit"><div class="muted">שמחות וואס קומען</div><div class="big">${h.simchas.length}</div></a>
  <a class="card" href="#learn" style="text-decoration:none;color:inherit"><div class="muted">משניות / תהילים ליסטס</div><div class="big">${h.lists.length}</div></a>
  <a class="card" href="#people" style="text-decoration:none;color:inherit"><div class="muted">קאזינס אין אפ</div><div class="big">${h.members}</div></a></div>
  <h2>🕯️ קומט באלד</h2>${h.yahrzeits.length ? h.yahrzeits.map((y) => `<div class="row"><div class="grow"><b>${esc(y.name)} ${esc(y.father_name)}</b><div class="muted">${esc(y.relation)}${y.relation ? ' · ' : ''}${esc(y.hebrew)} · ${gdate(y.next.ymd)} · <b>${inDays(y.next.days)}</b></div></div>${familyTags(y)}</div>`).join('')
    : empty('🕯️', 'נאך קיין יארצייטן. לייג צו די זיידעס און באבעס.', '<a class="btn s" href="#yz">+ לייג צו א יארצייט</a>')}
  ${h.lists.length ? `<h2>📖 לערנען</h2>${h.lists.map((l) => `<a class="row" href="#learn/${l.id}" style="text-decoration:none;color:inherit"><div class="grow"><b>${l.kind === 'tehillim' ? 'תהילים' : 'משניות'} · ${esc(l.niftar)}</b><div class="bar"><div style="width:${Math.round(100 * l.taken / l.total)}%"></div></div><div class="muted">${l.taken} פון ${l.total} גענומען${l.target_date ? ' · ביז ' + gdate(l.target_date) : ''}</div></div><span class="btn s">נעם</span></a>`).join('')}` : ''}
  <h2>🎉 שמחות</h2>${h.simchas.length ? h.simchas.map((x) => `<div class="row" style="flex-wrap:wrap"><div class="grow"><b>${esc(x.kind)} · ${esc(x.whose)}</b><div class="muted">${gdate(x.gdate)} · ${esc(x.hebrew)}${x.hall ? ' · ' + esc(x.hall) : ''} · ${inDays(x.days)}</div></div><div class="btns">${navBtns(x.address)}<a class="btn s l" href="#sim">RSVP</a></div></div>`).join('')
    : empty('🎉', 'נאך קיין שמחות.', '<a class="btn s" href="#sim">+ נייע שמחה</a>')}
  <h2>💬 לעצטע מעסעדזשעס</h2>${h.messages.length ? h.messages.map((m) => `<a class="row" href="#chat" style="text-decoration:none;color:inherit"><div class="grow"><b>${esc(m.name)}</b> <span class="muted">· ${esc(m.room === 'all' ? 'אלע קאזינס' : famOf(m.room) || sideName(m.room))} · ${hm(m.created_at)}</span><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.body)}</div></div></a>`).join('')
    : empty('💬', 'נאך קיין מעסעדזשעס.', '<a class="btn s" href="#chat">שרייב די ערשטע</a>')}
  <div style="margin-top:18px"><button class="btn l" data-act="familyinvite">📲 אינווייט א קאזין</button></div>`;
};
function familyInviteForm() {
  modal(`<h2>📲 אינווייט א קאזין</h2><p class="muted">קלייב אויס איין סייד אדער ביידע. דער קאזין קען גלייך אריינלאגן מיט דעם לינק.</p>
    <form data-form="familyinvite">${field('צו וועלכע משפחה סייד?', `<select id="inviteSide">${sideOptions(STATE.side === 'all' ? (both() ? 'both' : mySides()[0]) : STATE.side)}</select>`)}
    <div class="err" role="alert"></div><div class="btns"><button class="btn">מאך א לינק</button><button type="button" class="btn l" data-act="close">קענסל</button></div></form>`);
}

// yahrzeits
V.yz = async () => {
  const { yahrzeits } = await api('/yahrzeits'); STATE.yzs = yahrzeits;
  const L = yahrzeits.filter(y => !STATE.yzFamily || (y.families || []).some(f=>f.id===Number(STATE.yzFamily)));
  return `<h1>🕯️ יארצייטן</h1><div class="cap">אלע זיידעס, באבעס און משפחה. דער דאטום פאר דעם יאר ווערט אויסגערעכנט פונעם אידישן דאטום.</div>${familySelector(yahrzeits,'yzFamily','משפחה')}
  ${L.map((y) => `<div class="row" style="flex-wrap:wrap"><div class="grow" style="min-width:220px"><b>${esc(y.name)} ${esc(y.father_name)}</b>
   ${y.families?.length?`<div class="yahrzeit-families">${familyTags(y)}</div>`:''}
   <div class="muted">${esc(y.relation)}${y.relation ? ' · ' : ''}<b style="color:#111827">${esc(y.hebrew)}</b>${y.next ? ` · דעם יאר: ${gdate(y.next.ymd)} · <b style="color:#4338ca">${inDays(y.next.days)}</b>` : ''}</div>
   ${y.kever ? `<div class="muted">🪦 ${esc(y.kever)}</div>` : ''}${y.kever_address?`<div class="muted" dir="auto">📍 ${esc(y.kever_address)}</div><div class="btns">${navBtns(y.kever_address)}</div>`:''}${y.note ? `<div class="muted">${esc(y.note)}</div>` : ''}</div>
   <div class="btns"><button class="btn s ${y.remind ? 'g' : 'l'}" data-act="remind" data-id="${y.id}" data-on="${y.remind ? 0 : 1}">${y.remind ? '🔔 מען דערמאנט דיך' : '🔔 רימיינד מיר'}</button>
   <button class="btn s l" data-act="newlist" data-yz="${y.id}">📖 מאך א ליסט</button><button class="btn s l" data-act="edityz" data-id="${y.id}">✏️ עדיט</button></div></div>`).join('') || empty('🕯️', 'נאך קיין יארצייטן.')}
  <button class="btn" style="margin-top:10px" data-act="edityz" data-id="0">+ נייער יארצייט</button>
  <div class="muted" style="margin-top:10px">🔔 "רימיינד מיר" ווערט געהאלטן פאר דיר; מעסעדזשעס/נאטיפיקעישנס קומען שפעטער.</div>`;
};
async function yzForm(id) {
  const y=(STATE.yzs||[]).find(x=>x.id===id);
  if(y?.person_id)return personForm(y.person_id);
  const {people}=await api('/people');STATE.yzLegacy=y||null;
  modal(`<h2>${y?'פארבינד דעם יארצייט צום מענטש':'נייער יארצייט · אויסקלייבן א מענטש'}</h2><p class="muted">די משפחה, מקום קבורה און פטירה דאטום ווערן געהאלטן אין איין מענטשס פראפיל.</p>
    ${field('א מענטש וואס איז שוין אין פעמילי טרי',`<select id="yzperson"><option value="">— קלייב אויס —</option>${people.map(p=>`<option value="${p.id}">${esc([p.title,p.name].filter(Boolean).join(' '))}</option>`).join('')}</select>`)}
    <div class="btns"><button class="btn" data-act="yzexisting">עפן דעם פראפיל</button><button class="btn l" data-act="yznew">+ נייער מענטש</button><button class="btn l" data-act="close">קענסל</button></div>`);
}
async function yahrzeitPerson(id) {
  const y=STATE.yzLegacy,defaults={life_status:'deceased',requireYahrzeit:true};
  if(y) {
    const {people}=await api('/people'),p=people.find(p=>p.id===id);
    defaults.legacy_yahrzeit_id=y.id;
    if(!id)Object.assign(defaults,{name:y.name,side:y.side,note:y.note,kever:y.kever});
    if(!p?.death_hday||!p?.death_hmonth)Object.assign(defaults,{death_hday:y.hday,death_hmonth:y.hmonth,death_year:y.death_year});
    if(!p?.kever)defaults.kever=y.kever;
  }
  return personForm(id,undefined,defaults);
}

// family tree
V.tree = async () => {
  const { people } = await api('/people'); STATE.people = people;
  const P = people; // Server permissions determine visibility; family membership never cuts spouse/ancestor links.
  const {units,edges,generationConflicts}=familyUnits(P); STATE.treeEdges=edges;
  const graphMode=STATE.treeView==='tree' && !generationConflicts.length;
  const node = p => `<button style="${STATE.treeFamily && (p.families || []).some(f=>f.id===Number(STATE.treeFamily))?'outline:3px solid #4338ca;outline-offset:2px':''}" class="pn family-person ${p.niftar?'d':''}" data-tree-person="${p.id}" data-act="viewperson" data-id="${p.id}"><strong>${esc([p.title,p.name].filter(Boolean).join(' '))}${p.niftar?' ז״ל':''}</strong>${knownAs(p)}${p.spouse_name?`<span class="muted">זיווג ראשון: ${esc(p.spouse_name)}</span>`:''}${p.second_spouse_name?`<span class="muted">זיווג שני: ${esc(p.second_spouse_name)}</span>`:''}${p.father_name?`<span class="muted tree-relation">טאטע: ${esc(p.father_name)}</span>`:''}${p.mother_name?`<span class="muted tree-relation">מאמע: ${esc(p.mother_name)}</span>`:''}${p.spouse && !p.spouse_id?`<span class="muted">מאן / ווייב: ${esc(p.spouse)}</span>`:''}</button>`;
  const couple = unit => `<section class="family-unit ${unit.members.length>1?'married':''}" aria-label="${unit.members.length>1?'זיווגים':'מענטש'}">${unit.members.length>1?'<div class="marriage-label">זיווגים</div>':''}<div class="family-members">${unit.members.map(node).join('')}</div></section>`;
  const levels=[...new Set(units.map(u=>u.level))].sort((a,b)=>a-b);
  const treeHtml=graphMode
    ? `<div class="tree-toolbar" aria-label="בוים פארגרעסערונג"><button class="btn s l" data-act="treezoom" data-v="fit">פאס צום עקראַן</button><button class="btn s l" data-act="treezoom" data-v="-0.1" aria-label="פארקלענערן בוים">−</button><output id="tree-scale" aria-live="polite">100%</output><button class="btn s l" data-act="treezoom" data-v="0.1" aria-label="פארגרעסערן בוים">+</button><button class="btn s l" data-act="treezoom" data-v="actual">100%</button><button class="btn s" data-act="editp" data-id="0">+ לייג צו אין בוים</button></div><div class="family-scroll" id="family-viewport"><div class="family-stage" id="family-stage"><div class="family-map" id="family-map"><svg class="family-lines" aria-hidden="true"></svg>${levels.map(level=>`<div class="family-level">${units.filter(u=>u.level===level).map(couple).join('')}</div>`).join('')}</div></div></div>`
     : `<div class="family-table-scroll"><table class="family-table"><thead><tr><th>נאמען</th><th>מאן / ווייב</th><th>טאטע</th><th>מאמע</th></tr></thead>${units.map(unit=>`<tbody${unit.members.length>1?' class="married-rows"':''}>${unit.members.map(p=>`<tr><td><button class="family-name" data-act="viewperson" data-id="${p.id}">${esc([p.title,p.name].filter(Boolean).join(' '))}${p.niftar?' ז״ל':''}</button>${knownAs(p)} ${familyTags(p)}</td><td>${esc(p.spouse_name?'זיווג ראשון: '+p.spouse_name:p.spouse)||'—'}${p.second_spouse_name?'<br>זיווג שני: '+esc(p.second_spouse_name):''}</td><td>${esc(p.father_name)||'—'}</td><td>${esc(p.mother_name)||'—'}</td></tr>`).join('')}</tbody>`).join('')}</table></div>`;
  return `<h1>🌳 פעמילי טרי</h1><div class="cap">דער בוים ווייזט די מענטשן פון דיינע צוגעטיילטע משפחות, יעדער מענטש נאר איינמאל. דריק אויף א נאמען פאר פרטים.</div>
  ${familySelector(P,'treeFamily','הדגש משפחה (אלע פארבינדונגען בלייבן אין בוים)')}
  <div class="btns" style="margin-bottom:6px">
  <div class="seg"><button class="${STATE.treeView === 'tree' ? 'on' : ''}" data-act="treeview" data-v="tree">בוים</button><button class="${STATE.treeView === 'list' ? 'on' : ''}" data-act="treeview" data-v="list">ליסט</button></div></div>
  ${generationConflicts.length ? '<p class="err" role="alert">די משפחה לינקס שטימען נישט מיט די דורות. מען ווייזט א ליסט ביז די לינקס ווערן איבערגעקוקט.</p>' : ''}
  ${units.length ? `<div class="card">${treeHtml}</div>` : empty('🌳','דער בוים איז נאך ליידיג. הייב אן מיט די זיידע און באבע.')}
  ${graphMode && units.length ? '' : '<button class="btn" style="margin-top:12px" data-act="editp" data-id="0">+ לייג צו אין בוים</button>'}`;
};
let treeObserver;
function drawFamilyLines() {
  const map=$('family-map'); if(!map) return;
  const svg=map.querySelector('svg'), base=map.getBoundingClientRect();
  const scale=base.width/map.offsetWidth || 1;
  svg.setAttribute('width',String(map.offsetWidth)); svg.setAttribute('height',String(map.offsetHeight));
  const paths=[];
  for(const edge of STATE.treeEdges || []) {
    const parent=map.querySelector(`[data-tree-person="${edge.parentId}"]`),child=map.querySelector(`[data-tree-person="${edge.childId}"]`);
    if(!parent || !child) continue;
    const a=parent.getBoundingClientRect(),b=child.getBoundingClientRect();
    const parentUnit=parent.closest('.family-unit').getBoundingClientRect(),childUnit=child.closest('.family-unit').getBoundingClientRect();
    const x1=(a.left+a.width/2-base.left)/scale,y1=(parentUnit.bottom-base.top)/scale,x2=(b.left+b.width/2-base.left)/scale,y2=(childUnit.top-base.top)/scale;
    const bend=Math.max(20,(y2-y1)*0.45);
    paths.push(`<path d="M ${x1} ${y1} C ${x1} ${y1+bend}, ${x2} ${y2-bend}, ${x2} ${y2}"/>`);
  }
  svg.innerHTML=paths.join('');
}
function updateFamilyViewport(point) {
  const map=$('family-map'),viewport=$('family-viewport'),stage=$('family-stage'); if(!map||!viewport||!stage) return;
  const oldScale=Number(map.dataset.scale),oldBounds=map.getBoundingClientRect(),oldViewport=viewport.getBoundingClientRect();
  const focus=point||{x:oldViewport.left+viewport.clientLeft+viewport.clientWidth/2,y:oldViewport.top+viewport.clientTop+viewport.clientHeight/2};
  const anchor=oldScale?{x:(focus.x-oldBounds.left)/oldScale,y:(focus.y-oldBounds.top)/oldScale}:null;
  // Document position is stable when page scroll anchoring changes during zoom.
  const documentTop=viewport.getBoundingClientRect().top+window.scrollY;
  const outerHeight=Math.max(220,Math.floor(window.innerHeight-documentTop-(window.innerWidth<=800?104:40)));
  viewport.style.height=outerHeight+'px';viewport.style.maxHeight=outerHeight+'px';
  const layout=treeViewportLayout(map.offsetWidth,map.offsetHeight,viewport.clientWidth,viewport.clientHeight,STATE.treeZoom);
  const {scale}=layout;STATE.treeScale=scale;
  stage.style.width=layout.stageWidth+'px';stage.style.height=layout.stageHeight+'px';
  map.style.top=layout.top+'px';map.style.right=layout.right+'px';map.style.transform=`scale(${scale})`;map.dataset.scale=String(scale);
  if(STATE.treeZoom==null) {viewport.scrollLeft=0;viewport.scrollTop=0;}
  else if(anchor) {
    const next=map.getBoundingClientRect(),bounds=viewport.getBoundingClientRect();
    viewport.scrollLeft+=next.left+anchor.x*scale-focus.x;
    viewport.scrollTop+=next.top+anchor.y*scale-focus.y;
  }
  if($('tree-scale')) $('tree-scale').textContent=Math.round(scale*100)+'%';
  drawFamilyLines();
}
let treeLayoutFrame=0;
function scheduleFamilyViewport() {
  if(treeLayoutFrame) return;
  treeLayoutFrame=requestAnimationFrame(()=>{treeLayoutFrame=0;updateFamilyViewport();});
}
function observeFamilyTree() {
  treeObserver?.disconnect();
  const map=$('family-map'); if(!map) return;
  // Never observe the scroll viewport: scrollbar changes are an output of zoom.
  // Observing them fed that output back into the next fit calculation.
  if(typeof ResizeObserver!=='undefined') {treeObserver=new ResizeObserver(scheduleFamilyViewport);treeObserver.observe(map);treeObserver.observe($('m'));}
  scheduleFamilyViewport();document.fonts?.ready.then(scheduleFamilyViewport);
}
window.addEventListener('resize',scheduleFamilyViewport);
let treeDrag=null,ignoreTreeClickUntil=0;
document.addEventListener('pointerdown',ev=>{
  const viewport=ev.target.closest('#family-viewport');if(!viewport||ev.button!==0||ev.pointerType!=='mouse')return;
  treeDrag={viewport,id:ev.pointerId,x:ev.clientX,y:ev.clientY,left:viewport.scrollLeft,top:viewport.scrollTop,moved:false};
});
document.addEventListener('pointermove',ev=>{
  const d=treeDrag;if(!d||d.id!==ev.pointerId)return;
  const dx=ev.clientX-d.x,dy=ev.clientY-d.y;
  if(!d.moved&&Math.hypot(dx,dy)<5)return;
  if(!d.moved){d.moved=true;d.viewport.setPointerCapture(ev.pointerId);d.viewport.classList.add('dragging');}
  ev.preventDefault();d.viewport.scrollLeft=d.left-dx;d.viewport.scrollTop=d.top-dy;
});
function endTreeDrag(ev){const d=treeDrag;if(!d||d.id!==ev.pointerId)return;if(d.moved)ignoreTreeClickUntil=Date.now()+400;d.viewport.classList.remove('dragging');if(d.viewport.hasPointerCapture(ev.pointerId))d.viewport.releasePointerCapture(ev.pointerId);treeDrag=null;}
document.addEventListener('pointerup',endTreeDrag);document.addEventListener('pointercancel',endTreeDrag);
document.addEventListener('click',ev=>{if(Date.now()<ignoreTreeClickUntil&&ev.target.closest('#family-viewport')){ev.preventDefault();ev.stopImmediatePropagation();}},true);
document.addEventListener('wheel',ev=>{
  const viewport=ev.target.closest('#family-viewport');if(!viewport)return;
  ev.preventDefault();
  const delta=ev.deltaY*(ev.deltaMode===1?16:ev.deltaMode===2?viewport.clientHeight:1);
  STATE.treeZoom=Math.max(0.2,Math.min(2,(STATE.treeScale||1)*Math.exp(-delta*0.0015)));
  updateFamilyViewport({x:ev.clientX,y:ev.clientY});
},{passive:false});

async function personProfile(id) {
  const {people}=await api('/people'),p=people.find(p=>p.id===id);if(!p)throw new Error('נישט געטראפן');
  const linked=(key,label)=>p[key]?`<div class="row"><span class="muted">${label}</span><button type="button" class="btn l" data-act="viewperson" data-id="${p[key]}">${esc([p[key.replace('_id','_title')],p[key.replace('_id','_name')]].filter(Boolean).join(' '))}</button></div>`:'';
  const childRow=c=>`<div class="row"><button class="btn l" data-act="viewperson" data-id="${c.id}">${esc(c.name)}</button><span class="muted">טאטע: ${esc(c.father_name||'נישט באקאנט')} · מאמע: ${esc(c.mother_name||'נישט באקאנט')}</span></div>`;
  const marriages=[['spouse_id','זיווג ראשון'],['second_spouse_id','זיווג שני']].map(([key,label])=>{
    const spouse=people.find(x=>x.id===p[key]);
    return `<section class="card"><h3>${label}</h3>${spouse?linked(key,'מאן / ווייב'):`<button class="btn l" data-act="addmarriage" data-id="${id}" data-key="${key}">+ לייג צו ${label}</button>`}${spouse?`<h4>קינדער פון ${label}</h4>${marriageChildren(people,id,spouse.id).map(childRow).join('')||'<p class="muted">נאך קיין קינדער צוגעלייגט צו דעם זיווג.</p>'}<button class="btn l" data-act="marriagechild" data-id="${id}" data-spouse="${spouse.id}">+ קינד פון ${label}</button>`:''}</section>`;
  }).join('');
  const otherChildren=marriageChildren(people,id).filter(c=>![p.spouse_id,p.second_spouse_id].includes(c.father_id===id?c.mother_id:c.father_id));
  modal(`<h2>${esc([p.title,p.name].filter(Boolean).join(' '))}${p.life_status==='deceased'?' ז״ל':''}</h2>${knownAs(p)}<div class="btns">${familyTags(p)}</div>
    <p class="muted">${p.life_status==='deceased'?'נפטר / נפטרת':p.life_status==='living'?'לעבט':'לעבנס סטאטוס נישט באקאנט'}</p>
    ${linked('father_id','טאטע')}${linked('mother_id','מאמע')}${marriages}
    ${otherChildren.length?`<h3>קינדער — אנדערער / נישט באקאנטער זיווג</h3>${otherChildren.map(childRow).join('')}`:''}
    <button class="btn l" data-act="addchild" data-id="${id}">+ קינד / קלייב עלטערן</button>
    ${p.death_hday&&p.death_hmonth?`<p><b>יארצייט:</b> ${hebD(p.death_hday)} ${esc(HMONTHS.find(([k])=>k===p.death_hmonth)?.[1]||'')}${p.death_year?' · '+esc(p.death_year):''}</p>`:''}
    ${p.kever?`<p><b>בית החיים / מקום קבורה:</b> ${esc(p.kever)}</p>`:''}${p.kever_address?`<p dir="auto">📍 ${esc(p.kever_address)}</p><div class="btns">${navBtns(p.kever_address)}</div>`:''}${p.note?`<p>${esc(p.note)}</p>`:''}
    <div class="btns"><button class="btn" data-act="editp" data-id="${p.id}">✏️ עדיט פראפיל</button><button class="btn l" data-act="close">צומאכן</button></div>`);
}
const personNameKey=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]/gu,'');
function matchCards(matches,field='person') {
  return matches.map(p=>`<div class="card"><b>${esc(p.name)}</b><div class="muted">${p.father_name?'טאטע: '+esc(p.father_name)+' · ':''}${p.mother_name?'מאמע: '+esc(p.mother_name)+' · ':''}${p.spouse_name?'מאן/ווייב: '+esc(p.spouse_name):''}</div><button type="button" class="btn s" data-act="reuseperson" data-id="${p.id}" data-field="${field}">נוץ דעם עקזיסטירנדיקן מענטש</button></div>`).join('');
}
function renderPersonMatches(field='person',forced) {
  const form=document.querySelector('[data-form="person"]');if(!form)return;
  const query=personNameKey(val(field==='person'?'pn':'new_'+field+'_name'));
  const people=STATE.people||[],id=Number(form.dataset.id);
  const existingName=field==='person'&&people.some(p=>p.id===id&&personNameKey(p.name)===query);
  const matches=forced||(query.length<2||existingName?[]:people.filter(p=>p.id!==id&&personNameKey(p.name).includes(query)).slice(0,12));
  const target=$(field==='person'?'personmatches':'matches_'+field);if(target)target.innerHTML=matches.length?'<p>ביסטו שוין דא? קלייב אן עקזיסטירנדיקן מענטש כדי נישט צו מאכן א דאפלטן רעקארד.</p>'+matchCards(matches,field):'';
}
V.personreviews=async()=>{
  const {reviews}=await api('/person-reviews');
  return `<h1>מענטשן איבערזיכט</h1><p>נוץ דעם עקזיסטירנדיקן מענטש, אדער אפרוביר א באזונדערן מענטש. קיינער ווערט נישט אויטאמאטיש צוזאמענגעשטעלט. ביים אויסקלייבן אן עקזיסטירנדיקן מענטש ווערן די פארגעשלאגענע ענדערונגען נישט אנגעווענדט.</p>${reviews.map(r=>`<section class="card"><h2>${esc(r.payload.name||'עדיט מענטש')}</h2><p>${esc(r.reason)}</p><p>פארגעשלאגענע פארבינדונגען: טאטע: ${esc(r.proposal.father||'נישט באקאנט')} · מאמע: ${esc(r.proposal.mother||'נישט באקאנט')} · מאן/ווייב: ${esc(r.proposal.spouse||'נישט באקאנט')}</p><p>סטאטוס: ${esc(({pending:'ווארט אויף אדמין',approved:'אפרובירט',confirmed:'באשטעטיגט אלס אנדערער מענטש',existing:'עקזיסטירנדיקער מענטש אויסגעקליבן',rejected:'אפגעזאגט'})[r.status])}</p>${r.result_id?`<button class="btn s" data-act="editp" data-id="${r.result_id}">עפן מענטש</button>`:''}${r.status==='pending'&&isManager()?`<div>${r.matches.map(p=>`<p>${esc(p.name)} · ${esc(p.father_name||'')} · ${esc(p.mother_name||'')} · ${esc(p.spouse_name||'')} <button class="btn s" data-act="reviewperson" data-id="${r.id}" data-v="existing" data-person="${p.id}">נוץ דעם</button></p>`).join('')}</div><button class="btn" data-act="reviewperson" data-id="${r.id}" data-v="approve">אפרוביר אלס צווייטער מענטש</button><button class="btn r" data-act="reviewperson" data-id="${r.id}" data-v="reject">אפזאגן</button>`:''}</section>`).join('')||'<p>נאך קיין בקשות</p>'}`;
};
async function personForm(id, parentId, defaults={}) {
  const {people:P}=await api('/people'); STATE.people=P;
  if(id&&!P.some(x=>x.id===id))throw new Error('דער מענטש איז נישט אין דיינע צוגעטיילטע משפחות');
  const p = {...(P.find(x=>x.id===id) || {side:STATE.treeSide || mySides()[0],parent_id:parentId || null}),...defaults};
  const yahrzeit = !!defaults.requireYahrzeit;
  const knownAsField=(inputId,value='')=>field('באקאנט אלס',`<input id="${inputId}" maxlength="160" dir="auto" value="${esc(value)}" placeholder="למשל חוזה פון לובלין">`);
  const choice=(key,label)=>field(label,`<select id="p${key}" data-change="newrelative" data-key="${key}"><option value="">— נישט באקאנט / קיין לינק —</option><option value="new">+ לייג צו א נייעם מענטש</option>${P.filter(x=>x.id!==id).map(x=>`<option value="${x.id}" ${p[key]===x.id?'selected':''}>${esc([x.title,x.name].filter(Boolean).join(' '))}</option>`).join('')}</select><div id="new_${key}" hidden class="card" style="margin-top:8px"><p class="muted">ווערט צוגעלייגט און פארבונדן ווען דו סעיווסט.</p>${field('טיטל', `<input id="new_${key}_title" dir="auto">`)}${field('נאמען', `<input id="new_${key}_name" dir="auto">`)}${knownAsField('new_'+key+'_known_as')}<div id="matches_${key}" aria-live="polite"></div></div>`);
  modal(`<h2 style="margin-top:0">${yahrzeit ? 'נייער יארצייט' : id ? '✏️ ' + esc(p.name) : '+ מענטש אין פעמילי טרי'}</h2><form data-form="person" data-id="${id}" data-yahrzeit="${yahrzeit ? '1' : ''}" data-legacyid="${p.legacy_yahrzeit_id||''}">${p.legacy_yahrzeit_id?'<p class="muted">סעיוון וועט פארבינדן דעם אלטן יארצייט צו דעם פראפיל. די אלטע אינפארמאציע בלייבט געהאלטן.</p>':''}
  <div class="grid g2"><div>${field('טיטל',`<input id="ptitle" value="${esc(p.title)}" placeholder="הרב / מרת">`)}</div><div>${field('נאמען',`<input id="pn" value="${esc(p.name)}">`)}</div></div>
  <div id="personmatches" aria-live="polite"></div>
  ${knownAsField('pknownas',p.known_as)}
  <label><input id="pdistinct" type="checkbox"> דאס איז א צווייטער מענטש</label>
  ${field('פארוואס איז דאס א צווייטער מענטש? (אויב עס איז דא דער זעלבער נאמען)', '<textarea id="pdistinctreason" maxlength="500"></textarea>')}
  <p class="muted">דער זעלבער נאמען מיט דעם זעלבן טאטע אדער מאמע דארף אדמין איבערזיכט.</p>
  <fieldset class="person-family-picker"><legend>משפחות</legend>
  <p class="muted">קלייב איין משפחה אדער מער.${ME.is_admin?' די בחירה באשטימט וואו מען קען זען דעם מענטש.':''}</p>
  <div class="person-family-options">${familyChoices(P).map(f=>`<label><input type="checkbox" name="person_family" value="${f.id}" ${(p.families || []).some(x=>x.id===f.id)?'checked':''}><strong>${esc(f.name)}</strong></label>`).join('')}</div>
  <details><summary>צולייגן א משפחה נאמען</summary>${field('משפחה נאמען',`<input id="pnewfamily" maxlength="80">`)}</details></fieldset>
  ${choice('father_id','טאטע')}${choice('mother_id','מאמע')}${choice('spouse_id','זיווג ראשון')}${choice('second_spouse_id','זיווג שני')}<p class="muted">ביי יעדן קינד קלייב דעם ריכטיגן טאטע און מאמע. א צווייטער זיווג טוישט נישט די עלטערן פון עקזיסטירנדיקע קינדער. די זיווג סדר איז פאר דעם מענטש; מען קען עדיטן דעם סדר ביים אנדערן פראפיל.</p>
  ${p.parent_id ? choice('parent_id','פריערדיגער עלטערן לינק (נאכנישט באשטימט טאטע / מאמע)') : '<input type="hidden" id="pparent_id" value="">'}
  ${p.spouse && !p.spouse_id ? `<p class="muted">פריערדיגער מאן / ווייב נאמען: ${esc(p.spouse)}. קלייב דעם מענטש אויבן צו פארבינדן.</p>` : ''}
  ${field('ייחוס',`<select id="plineage"><option value="">נישט באקאנט</option><option value="בן" ${p.lineage_term==='בן'?'selected':''}>בן</option><option value="בת" ${p.lineage_term==='בת'?'selected':''}>בת</option></select>`)}
  ${field('ווער קען זען (צוטריט גרופע)',`<select id="pside">${sideOptions(p.side)}</select>`)}
  ${yahrzeit ? '<input id="plife" type="hidden" value="deceased">' : field('לעבנס סטאטוס',`<select id="plife"><option value="unknown" ${!p.life_status||p.life_status==='unknown'?'selected':''}>נישט באקאנט</option><option value="living" ${p.life_status==='living'?'selected':''}>לעבט</option><option value="deceased" ${p.life_status==='deceased'?'selected':''}>נפטר / נפטרת</option></select>`)}
  ${yahrzeit ? '<section><h3>אידישער פטירה דאטום</h3>' : `<details ${p.niftar||p.life_status==='deceased'?'open':''}><summary>אידישער פטירה דאטום (אויב באקאנט)</summary>`}
  <div class="grid g2"><div>${field('טאג פון פטירה',`<select id="pday" ${yahrzeit?'required':''}><option value="">— קלייב אויס —</option>${Array.from({length:30},(_,i)=>`<option value="${i+1}" ${p.death_hday===i+1?'selected':''}>${hebD(i+1)}</option>`).join('')}</select>`)}</div>
  <div>${field('חודש פון פטירה',`<select id="pmonth" ${yahrzeit?'required':''}><option value="">— קלייב אויס —</option>${HMONTHS.map(([k,t])=>`<option value="${k}" ${p.death_hmonth===k?'selected':''}>${t}</option>`).join('')}</select>`)}</div></div>
  ${field('יאר פון פטירה',`<input id="pyear" type="number" min="5001" max="5999" value="${esc(p.death_year||'')}">`)}
  <p class="muted">א באקאנטער טאג און חודש לייגן אויטאמאטיש צו דעם יארצייט.</p>${yahrzeit ? '</section>' : '</details>'}
  ${field('בית החיים / מקום קבורה',`<input id="pkever" value="${esc(p.kever)}" placeholder="למשל: הר הזיתים, חלקה / שורה / מספר קבר">`)}
  ${field('אדרעס פון בית החיים (פאר GPS)',`<input id="pkeveraddress" dir="auto" value="${esc(p.kever_address)}" placeholder="גאס, שטאט און לאנד">`)}
  ${field('נאטיץ',`<input id="pno" value="${esc(p.note)}">`)}
  <div class="err" id="ferr"></div><div class="btns"><button class="btn">${yahrzeit ? 'סעיוו דעם יארצייט' : 'סעיוו'}</button><button type="button" class="btn l" data-act="close">קענסל</button>
  ${id ? `<button type="button" class="btn l" data-act="addchild" data-id="${id}">+ קינד</button><button type="button" class="btn r" data-act="delp" data-id="${id}">🗑</button>` : ''}</div></form>`);
  renderPersonMatches();
  if(defaults.openRelative){const key=defaults.openRelative;$('p'+key).value='new';$('new_'+key).hidden=false;$('new_'+key+'_name').focus();}
}

// learning
V.learn = async (arg) => {
  if (arg) return learnDetail(Number(arg));
  const [{ lists },{people}] = await Promise.all([api('/lists'),api('/people')]); STATE.learningLists=lists; const L = lists.filter(l => vis(l.side) && (!STATE.learnFamily || (l.families||[]).some(f=>f.id===Number(STATE.learnFamily))));
  return `<header class="learning-header"><h1>📖 משניות און תהילים</h1><button type="button" class="btn" data-act="newlist">+ נייע ליסט</button></header>
  <p><a href="#me">✉ טעגליכע אימעיל דערמאנונגען — איינשטעלונגען</a></p><div class="cap">פילטער לויט צוטריט גרופע</div>${seg()}${familySelector([...lists,...people],'learnFamily','משפחה')}
  ${L.map((l) => `<a class="card" href="#learn/${l.id}" style="display:block;text-decoration:none;color:inherit;margin-bottom:10px"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:18px">${l.kind === 'tehillim' ? '📜 תהילים' : '📚 משניות'} · לעילוי נשמת ${esc(l.niftar)}</b>${familyTags(l)}</div>
  <div class="muted">${l.target_date ? `ביז ${gdate(l.target_date)} (${inDays(l.days)})` : 'קיין דאטום'}${l.mine ? ` · דו האסט ${l.mine}` : ''}</div>
  <div class="bar"><div style="width:${Math.round(100 * l.taken / l.total)}%"></div></div><div class="muted">${l.taken} פון ${l.total} אינגאנצן גענומען${l.partial?` · ${l.partial} טיילווייז`: ''} · ${l.done} געענדיגט</div></a>`).join('') || empty('📖', 'קיין ליסטס צו ווייזן.')}`;
};
async function learnDetail(id) {
  const group=Number(location.hash.split('/')[2]);
  if(group && group!==ME.selected_family_group_id){
    await api('/me/family-group',{method:'POST',body:{family_group_id:group}});
    await loadMe();
  }
  const { list: l, items, masechtos, help=[], daily_plan, remaining_units, plan_date, reminder_hour, reminder_timezone } = await api('/lists/' + id); STATE.list = { l, items, masechtos, help };
  const taken = items.filter(i => i.parts ? i.parts.taken===i.parts.total : i.taken_by).length, done = items.filter(i => i.parts ? i.parts.done===i.parts.total : i.done).length;
  const partial = items.filter(i=>i.parts && i.parts.taken>0 && i.parts.taken<i.parts.total).length;
  const cls = i => i.done?'pk done':i.taken_by===ME.id?'pk mine':i.taken_by||i.parts?.taken?'pk t':'pk';
  const assignees=i=>{
    const people=i.parts?.assignees||[];
    return people.length?`<small>גענומען דורך ${people.map(p=>esc(p.name)+(people.length>1?' ('+p.count+')':'')).join(' · ')}</small>`:'';
  };
  const body = l.kind === 'tehillim'
    ? `<div class="perek">${items.map((i) => `<button class="${cls(i)}" data-act="item" data-idx="${i.idx}" title="${esc(i.taken_name || '')}">${heb(i.idx)}</button>`).join('')}</div>`
    : [...new Set(masechtos.map((m) => m.seder))].map((sd) => `<h2 style="font-size:17px">סדר ${sd}</h2><div class="ms">${items.filter((i) => masechtos[i.idx].seder === sd).map((i) => `<button class="${cls(i)}" data-act="masechta" data-idx="${i.idx}">${masechtos[i.idx].name} ▾<small>${i.parts ? i.parts.taken + ' / ' + i.parts.total + ' משניות גענומען' : i.taken_by ? esc(i.taken_name || '') + (i.done ? ' ✓' : '') : 'פריי · עפן פרקים / משניות'}</small>${assignees(i)}</button>`).join('')}</div>`).join('');
  return `<a href="#learn" class="muted">→ צוריק צו אלע ליסטס</a><h1 class="learning-title">${l.kind === 'tehillim' ? '📜 תהילים' : '📚 משניות'} לעילוי נשמת ${esc(l.niftar)}</h1>
  <div class="cap">${l.target_date ? `ביז ${gdate(l.target_date)} (${inDays(l.days)})` : ''} ${sideTag(l.side)}${familyTags(l)}</div>
  <div class="card" style="margin-bottom:12px"><div class="bar"><div style="width:${Math.round(100 * taken / items.length)}%"></div></div><div class="muted">${taken} פון ${items.length} אינגאנצן גענומען${partial ? ` · ${partial} טיילווייז` : ''}</div>
  <div class="bar"><div class="dn" style="width:${Math.round(100 * done / items.length)}%"></div></div><div class="muted">${done} געענדיגט</div>
  <div class="muted" style="margin-top:6px"><span class="pk" style="padding:2px 8px">פריי</span> <span class="pk mine" style="padding:2px 8px">דיינס</span> <span class="pk t" style="padding:2px 8px">גענומען</span> <span class="pk done" style="padding:2px 8px">געענדיגט</span></div></div>
  <section class="card" style="margin-bottom:14px"><h2>📖 מיין לימוד פאר היינט</h2><p>${esc(plan_date || '')} · ${remaining_units || 0} ${l.kind==='tehillim'?'קאפיטלעך':'משניות'} איבעריג${daily_plan?.days ? ' · '+daily_plan.days+' טעג מיט היינט' : ''}</p>${daily_plan ? `<details open><summary>${daily_plan.lines.length} חלקים פאר היינט</summary><ul>${daily_plan.lines.map(line=>`<li>${esc(line)}</li>`).join('')}</ul></details>${!l.target_date?'<p class="muted">קיין ענד דאטום — געוויזן ווערן אלע דיינע איבעריגע חלקים.</p>':''}<p>צייכן אפ אונטן וואס דו האסט געענדיגט. דער פלאן ווערט איבערגערעכנט לויט די איבעריגע חלקים.</p>` : `<p>${remaining_units ? 'דער ענד דאטום איז שוין פארביי. די איבעריגע חלקים בלייבן אין דער ליסט; מען שיקט נישט קיין טעגליכע אימעילס.' : 'דו האסט נישט קיין אומגעענדיגטע חלקים אין דער ליסט.'}</p>`}<p><a href="#me">✉ ${ME.learning_email_reminders?'טעגליכע אימעילס איינגעשאלטן':'איינשאלטן טעגליכע אימעילס'}</a> · ${reminder_hour}:00 (${esc(reminder_timezone || '')})</p></section>
  ${help.length ? `<section class="card" style="margin-bottom:14px"><h2>🙋 בקשות פאר הילף</h2>${help.map(h=>`<div class="row"><div class="grow"><b>${esc(h.requested_name)}</b> · ${esc(portionLabel(h.idx,h.chapter,h.mishnah))}<p>${esc(h.note)}</p><small>${h.helper_id ? esc(h.helper_name)+' העלפט' : 'ווארט אויף הילף'}</small></div><div class="btns">${h.requested_by!==ME.id && !h.helper_id ? `<button class="btn s" data-act="learninghelp" data-id="${h.id}" data-v="help">איך קען העלפן</button>`:''}${h.requested_by===ME.id||isManager() ? `<button class="btn s l" data-act="learninghelp" data-id="${h.id}" data-v="resolve">✓ געלייזט</button>`:''}</div></div>`).join('')}</section>`:''}
  <div class="btns" style="margin-bottom:12px"><button class="btn" data-act="sharelearn">📲 לאדן צו נעמען משניות / תהילים</button>${l.kind==='mishnayos'&&managesAccounts()?'<button class="btn l" data-act="emaillearn">✉️ שיק אן אימעיל בקשה</button>':''}</div>
  <div class="card">${body}</div>
  ${isManager() || l.created_by === ME.id ? `<button class="btn r s" style="margin-top:14px" data-act="dellist" data-id="${l.id}">🗑 מעק אויס די ליסט</button>` : ''}`;
}
function itemLabel(idx) { const { l, masechtos } = STATE.list; return l.kind === 'tehillim' ? 'קאפיטל ' + heb(idx) : 'מסכתא ' + masechtos[idx].name; }
async function onItem(idx) {
  const { l, items } = STATE.list; const it = items.find((i) => i.idx === idx);
  if (!it.taken_by) { await api(`/lists/${l.id}/items/${idx}`, { method: 'POST', body: { action: 'take' } }); toast('✓ דו האסט גענומען ' + itemLabel(idx)); return go(); }
  if (it.taken_by !== ME.id) {
    if (isManager()) return modal(`<h2 style="margin-top:0">${itemLabel(idx)}</h2><p>${esc(it.taken_name)} האט דאס גענומען.</p><div class="btns"><button class="btn r" data-act="itemact" data-idx="${idx}" data-v="give">ארויסנעמען (אדמין)</button><button class="btn l" data-act="close">צומאכן</button></div>`);
    return toast(`${itemLabel(idx)} האט שוין ${it.taken_name}`);
  }
  modal(`<h2 style="margin-top:0">${itemLabel(idx)}</h2><p class="muted">דו האסט דאס גענומען.</p><div class="btns">
  ${it.done ? `<button class="btn l" data-act="itemact" data-idx="${idx}" data-v="undone">נאך נישט געענדיגט</button>` : `<button class="btn g" data-act="itemact" data-idx="${idx}" data-v="done">✓ איך האב געענדיגט</button>`}
  <button class="btn r" data-act="itemact" data-idx="${idx}" data-v="give">גיב צוריק</button><button class="btn l" data-act="close">צומאכן</button></div>`);
}
function portionLabel(idx,chapter=0,mishnah=0) {
  return itemLabel(idx)+(chapter?' · פרק '+hebD(chapter):'')+(mishnah?' · משנה '+hebD(mishnah):'');
}
async function openMasechta(idx) {
  const {items}=await api(`/lists/${STATE.list.l.id}/items/${idx}/parts`); STATE.portions={idx,items};
  const chapters=STATE.list.masechtos[idx].chapters;
  modal(`<h2>${esc(itemLabel(idx))}</h2><p class="muted">נעם א גאנצע מסכתא, א פרק, אדער א משנה. עפן א פרק צו זען יעדע משנה.</p><button class="btn" data-act="portion" data-c="0" data-m="0">גאנצע מסכתא · אויסקלייבן / הילף</button>
    ${chapters.map((n,c)=>{const rows=items.filter(p=>p.chapter===c+1);return `<details class="card" style="margin-top:10px"><summary style="cursor:pointer;padding:8px">פרק ${hebD(c+1)} · ${rows.filter(p=>p.taken_by).length}/${n} גענומען</summary><button class="btn s l" data-act="portion" data-c="${c+1}" data-m="0">גאנצער פרק · אויסקלייבן / הילף</button><div class="ms" style="margin-top:10px">${rows.map(p=>`<button class="pk ${p.done?'done':p.taken_by===ME.id?'mine':p.taken_by?'t':''}" data-act="portion" data-c="${p.chapter}" data-m="${p.mishnah}">משנה ${hebD(p.mishnah)}<small>${p.taken_by?esc(p.taken_name):'פריי'}${p.done?' ✓':''}</small></button>`).join('')}</div></details>`;}).join('')}<button class="btn l" data-act="close">צומאכן</button>`,true);
}
function openPortion(chapter,mishnah) {
  const {idx,items}=STATE.portions, rows=items.filter(p=>(!chapter||p.chapter===chapter)&&(!mishnah||p.mishnah===mishnah));
  const own=rows.every(p=>p.taken_by===ME.id),available=rows.every(p=>!p.taken_by||p.taken_by===ME.id),allDone=rows.every(p=>p.done);
  STATE.portionScope={idx,chapter,mishnah};
  modal(`<h2>${esc(portionLabel(idx,chapter,mishnah))}</h2><p>${rows.filter(p=>p.taken_by).length}/${rows.length} משניות גענומען · ${rows.filter(p=>p.done).length} געענדיגט</p><div class="btns">
    ${available&&!own?'<button class="btn" data-act="portionaction" data-v="take">איך נעם דעם חלק</button>':''}
    ${own?`<button class="btn g" data-act="portionaction" data-v="${allDone?'undone':'done'}">${allDone?'נאך נישט געענדיגט':'✓ איך האב געענדיגט'}</button><button class="btn l" data-act="portionaction" data-v="give">גיב צוריק</button>`:''}
    ${isManager()&&!own&&rows.some(p=>p.taken_by)?'<button class="btn r" data-act="portionaction" data-v="give">באפריי דעם חלק (אדמין)</button>':''}
    </div>${!available?'<p class="muted">א טייל איז שוין גענומען. קלייב א פרייען פרק אדער משנה.</p>':''}
    <form data-form="portionhelp" style="margin-top:18px"><h3>🙋 בעט הילף</h3>${field('וואס פאר הילף דארפסטו?', '<textarea id="helpnote" maxlength="500" placeholder="למשל: איך דארף א חברותא אדער הילף צו פארשטיין"></textarea>')}<div class="err" role="alert"></div><button class="btn l">בעט הילף פון דער משפחה</button></form><button class="btn l" style="margin-top:12px" data-act="backmasechta">צוריק צו די פרקים</button>`);
}
const memorialName = (y) => [y.name,y.father_name].filter(Boolean).join(' ');
const memorialSearch = (text) => text.normalize('NFKD').replace(/\p{M}|[׳״'"’“”]/gu,'').toLowerCase();
const selectedMemorialIds = (form) => [...form.querySelectorAll('[name="learning-yahrzeit"]:checked')].map(input=>Number(input.value));

async function listForm(yzId, trigger) {
  const group=ME.selected_family_group_id;
  const route=location.hash;
  const { yahrzeits }=await api('/yahrzeits');
  if (learningDialogTrigger || !trigger.isConnected || location.hash!==route || ME?.selected_family_group_id!==group) return;
  const eligibleMemorials=rows=>rows.filter(y=>y.side==='both'||mySides().includes(y.side));
  const memorials=eligibleMemorials(yahrzeits);
  let byId=new Map(memorials.map(y=>[y.id,y]));
  if (yzId&&!byId.has(yzId)) throw new Error('דער יארצייט איז נישטא אין דער איצטיגער משפחה.');
  const defaultSide=STATE.side==='all' ? mySides()[0] : STATE.side;
  const familyName=ME.family_groups?.find(g=>g.id===group)?.name || S.family_yi;
  const optionsMarkup=(rows,selected)=>rows.map(y=>`<label class="dedication-option" data-search="${esc(memorialSearch(`${memorialName(y)} ${y.hebrew}`))}">
    <input type="checkbox" name="learning-yahrzeit" value="${y.id}" ${selected.has(y.id)?'checked':''}>
    <span><strong>${esc(memorialName(y))}</strong><small>${esc(y.hebrew)}</small></span></label>`).join('');
  modal(`<h2 id="learning-create-title" tabindex="-1">נייע ליסט</h2>
  <form id="learning-create-form" data-form="list">
  <div class="learning-form-body">
    ${field('וואס לערנט מען?', '<select id="lk"><option value="tehillim">תהילים · 150 קאפיטלעך</option><option value="mishnayos">משניות · 63 מסכתות</option></select>')}
    <fieldset class="dedication-picker"><legend>לעילוי נשמת · ${esc(familyName)}</legend>
      <div class="learning-source">
        <label><input type="radio" name="learning-source" checked> קלייב יארצייטן</label>
        <label><input type="radio" name="learning-source" id="learning-custom"> שרייב א נאמען</label>
      </div>
      <div id="learning-picker">
        <div class="learning-search-row">
          <div>${field('זוך א יארצייט', '<input id="learning-search" type="search" autocomplete="off">')}</div>
          <button type="button" id="learning-refresh" class="btn s l">לאד נאכאמאל</button>
        </div>
        <div class="dedication-options" id="learning-options">${optionsMarkup(memorials,new Set([yzId]))}</div>
        <p id="learning-no-results" class="muted" hidden>קיין יארצייט געפונען.</p>
        <div id="learning-selection" class="learning-selection">
          <p id="learning-selected-count" class="muted" role="status"></p>
          <div id="learning-selected-names"></div>
        </div>
      </div>
      <div id="learning-manual" hidden>${field('נאמען', '<input id="ln" maxlength="150" placeholder="ר׳ … בן ר׳ …">')}</div>
    </fieldset>
    <div class="learning-list-settings">
      <div>${field('ביז ווען?', '<input id="ld" type="date" aria-describedby="learning-due-hint">')}<p id="learning-due-hint" class="muted"></p></div>
      <div>${field('ווער קען אנטייל נעמען?', `<select id="ls" aria-describedby="learning-side-hint">${sideOptions(defaultSide)}</select>`)}<p id="learning-side-hint" class="muted" hidden>די יארצייטן קומען פון ביידע זייטן. קלייב ווער קען זען די ליסט.</p></div>
    </div>
  </div>
  <div class="learning-form-footer"><div class="err" role="alert"></div><div class="btns"><button type="submit" class="btn">מאך די ליסט</button><button type="button" class="btn l" data-act="close">קענסל</button></div></div>
  </form>`);

  const box=$('mb'), form=$('learning-create-form'), search=$('learning-search'), audience=$('ls');
  const options=$('learning-options'), reload=$('learning-refresh');
  let audienceChanged=false;
  function updateSelection() {
    const custom=$('learning-custom').checked;
    const selected=custom?[]:selectedMemorialIds(form).map(id=>byId.get(id));
    $('learning-picker').hidden=custom;
    $('learning-manual').hidden=!custom;
    $('ln').required=custom;
    $('learning-selected-count').textContent=selected.length?`${selected.length} אויסגעקליבן`:'קלייב איין יארצייט אדער עטליכע.';
    $('learning-selected-names').innerHTML=selected.map(y=>`<button type="button" data-remove="${y.id}" aria-label="נעם אראפ ${esc(memorialName(y))}"><span>${esc(memorialName(y))}</span><span aria-hidden="true">×</span></button>`).join('');
    const date=selected.map(y=>y.next?.ymd).filter(Boolean).sort()[0];
    $('learning-due-hint').textContent=date?`לאז ליידיג פאר ${gdate(date)}${selected.length>1?' (דער ערשטער יארצייט)':''}`:'מען קען עס לאזן ליידיג.';
    const sides=[...new Set(selected.map(y=>y.side).filter(side=>side==='a'||side==='b'))];
    if (!audienceChanged) {
      audience.value=sides.length===1?sides[0]:selected.length&&!sides.length&&both()?'both':defaultSide;
    }
    $('learning-side-hint').hidden=sides.length!==2;
  }
  function filterOptions() {
    const terms=memorialSearch(search.value).trim().split(/\s+/).filter(Boolean);
    for (const option of options.children) option.hidden=!terms.every(term=>option.dataset.search.includes(term));
    $('learning-no-results').hidden=[...options.children].some(option=>!option.hidden);
    options.scrollTop=0;
  }
  reload.addEventListener('click',async()=>{
    reload.disabled=true;
    try {
      const result=await api('/yahrzeits');
      if (!form.isConnected) return;
      const rows=eligibleMemorials(result.yahrzeits), selected=new Set(selectedMemorialIds(form));
      byId=new Map(rows.map(y=>[y.id,y]));
      options.innerHTML=optionsMarkup(rows,selected);
      filterOptions();
      updateSelection();
    } catch (error) {
      if (form.isConnected) fail(error);
    } finally {
      reload.disabled=false;
    }
  });
  search.addEventListener('input',filterOptions);
  search.addEventListener('keydown',event=>{if(event.key==='Enter')event.preventDefault();});
  form.addEventListener('change',event=>{
    if (event.target===audience) audienceChanged=true;
    if (event.target===audience || event.target.name==='learning-source' || event.target.name==='learning-yahrzeit') {
      form.querySelector('.err').textContent='';
      updateSelection();
    }
  });
  $('learning-selected-names').addEventListener('click',event=>{
    const remove=event.target.closest('[data-remove]');
    if (!remove) return;
    const checkbox=form.querySelector(`[name="learning-yahrzeit"][value="${remove.dataset.remove}"]`);
    checkbox.checked=false;
    updateSelection();
    (checkbox.closest('label').hidden?search:checkbox).focus();
  });
  filterOptions();
  updateSelection();
  box.classList.add('learning-create');
  box.setAttribute('role','dialog');
  box.setAttribute('aria-modal','true');
  box.setAttribute('aria-labelledby','learning-create-title');
  learningDialogTrigger=trigger;
  for (const id of ['top','nav','m','tabs']) $(id).inert=true;
  $('learning-create-title').focus({preventScroll:true});
}

// simchas
V.sim = async (id) => {
  const group = Number(location.hash.split('/')[2]);
  if (id && group && group !== ME.selected_family_group_id) {
    await api('/me/family-group', {method:'POST',body:{family_group_id:group}});
    await loadMe();
  }
  const past = STATE.simPast;
  const { simchas } = await api('/simchas' + (id ? '?id='+encodeURIComponent(id) : past ? '?past=1' : '')); STATE.sims = simchas;
  if (id) return `<h1>🎉 אינוויטעישן</h1><p><a href="#sim">אלע שמחות</a></p>${simchas.length ? simchas.map(simCard).join('') : empty('🎉','די אינוויטעישן איז נישט פאראן אדער דו האסט נישט קיין צוטריט.')}`;
  return `<h1>🎉 שמחות</h1><div class="cap">אינוויטעישנס פאר די משפחה. דריק "איך קום" און זאג וויפיל מענטשן.</div>
  <div class="btns" style="margin-bottom:12px"><button class="btn" data-act="editsim" data-id="0">+ נייע שמחה / אינוויטעישן</button><div class="seg" style="margin:0"><button class="${past ? '' : 'on'}" data-act="simpast" data-v="0">וואס קומט</button><button class="${past ? 'on' : ''}" data-act="simpast" data-v="1">פארביי</button></div></div>
  ${simchas.length ? `<div class="simgrid">${simchas.map(simCard).join('')}</div>` : empty('🎉', past ? 'נאך נישט קיין פארביי שמחות.' : 'נאך קיין שמחות. לייג צו די ערשטע!')}`;
};
function simCard(x) {
  const mine = isManager() || x.created_by === ME.id;
  const file = x.file_id ? (x.file_mime === 'application/pdf'
    ? `<div class="pdf" data-act="showinv" data-id="${x.id}">📄 <div class="grow"><b>אינוויטעישן (PDF)</b><div class="muted">${esc(x.file_name)}</div></div></div>`
    : `<img class="inv" src="/api/files/${x.file_id}" alt="אינוויטעישן" loading="lazy" data-act="showinv" data-id="${x.id}">`) : '';
  const people = x.my_people || 1;
  return `<div class="card"><div style="display:flex;gap:8px;align-items:flex-start"><div class="grow"><b style="font-size:19px">${esc(x.kind)} · ${esc(x.whose)}</b></div>${sideTag(x.audience)}</div>
  <div style="margin:6px 0 10px;display:grid;gap:3px"><div>📅 ${gdate(x.gdate)} <span class="muted">· ${esc(x.hebrew)} · ${inDays(x.days)}</span></div>${x.time_text ? `<div>🕖 ${esc(x.time_text)}</div>` : ''}
  ${x.hall ? `<div>🏛️ ${esc(x.hall)}</div>` : ''}${x.address ? `<div>📍 <span dir="auto">${esc(x.address)}</span></div>` : ''}${x.note ? `<div class="muted">${esc(x.note)}</div>` : ''}</div>
  ${x.address ? `<div class="btns" style="margin-bottom:10px">${navBtns(x.address)}</div>` : ''}
  ${file}
  <div class="btns" style="margin:10px 0">${x.file_id ? `<button class="btn s l" data-act="showinv" data-id="${x.id}">🔍 זע גרויס</button><a class="btn s l" href="/api/files/${x.file_id}?dl=1">⬇ דאונלאוד</a>` : ''}
  ${mine ? `<label class="btn s l" style="cursor:pointer">⬆ ${x.file_id ? 'טויש' : 'אפלאוד'} אינוויטעישן<input type="file" accept="image/*,application/pdf" style="display:none" data-change="upinv" data-id="${x.id}"></label>` : ''}</div>
  <div style="border-top:1px solid #eef0f3;padding-top:10px">
  <div class="btns"><button class="btn s ${x.my_answer === 'yes' ? 'g' : 'l'}" data-act="rsvp" data-id="${x.id}" data-v="yes">✓ איך קום</button>
  <span class="stepper"><button data-act="ppl" data-id="${x.id}" data-d="-1">−</button><span id="ppl${x.id}">${people}</span><button data-act="ppl" data-id="${x.id}" data-d="1">+</button></span><span class="muted">מענטשן</span>
  <button class="btn s ${x.my_answer === 'no' ? 'r' : 'l'}" data-act="rsvp" data-id="${x.id}" data-v="no">✗ קען נישט</button></div>
  <div class="muted" style="margin-top:8px"><a href="#" data-act="who" data-id="${x.id}">${x.yes_count} קומען (${x.yes_people} מענטשן) · ${x.no_count} נישט</a></div></div>
  <div class="btns" style="margin-top:10px"><button class="btn s l" data-act="sharesim" data-id="${x.id}">📲 טייל אינוויטעישן</button><button class="btn s l" data-act="mazeltov" data-id="${x.id}">🎉 שיק א מזל טוב</button>${mine ? `<button class="btn s l" data-act="editsim" data-id="${x.id}">✏️ עדיט</button>` : ''}</div></div>`;
}
function shareSim(x) {
  const link = `${location.origin}/#sim/${x.id}/${ME.selected_family_group_id}`;
  const subject = `${x.kind} · ${x.whose}`;
  const message = [subject, gdate(x.gdate), x.time_text, x.hall, x.address, link].filter(Boolean).join('\n');
  const body = encodeURIComponent(message);
  modal(`<h2>📲 טייל אינוויטעישן</h2><p>דער לינק עפנט די שמחה. מען דארף זיין איינגעלאגט און האבן צוטריט צו דער משפחה.</p><textarea id="rl" readonly rows="7" aria-label="Invitation message">${esc(message)}</textarea><div class="btns"><a class="btn g" href="https://wa.me/?text=${body}" target="_blank" rel="noopener">וואטסעפ</a>${(isManager()||x.created_by===ME.id)?`<button class="btn l" data-act="emailsim" data-id="${x.id}">שיק אימעיל צו מעמבערס</button>`:''}<a class="btn l" href="sms:?body=${body}">SMS</a><button class="btn l" data-act="copy">קאפי מעסעדזש און לינק</button><button class="btn l" data-act="close">צומאכן</button></div>`);
}
async function emailSim(id,scope=ME.is_admin?'all':'family') {
  const p=await api(`/simchas/${id}/email?scope=${scope}`);
  modal(`<h2>שיק אינוויטעישן דורך אימעיל</h2><p>דער סיסטעם שיקט דעם אימעיל גלייך צו יעדן מעמבער באזונדער.</p>${ME.is_admin?field('פאר וועמען',`<select data-change="emailscope" data-id="${id}"><option value="all" ${scope==='all'?'selected':''}>אלע מעמבערס אין אלע משפחות</option><option value="family" ${scope==='family'?'selected':''}>נאר די משפחה פון דער שמחה</option></select>`):''}<p><b>${p.recipients} אימעיל אדרעסן</b> · ${p.skipped} אן א גילטיגן אימעיל / דאפלטע אדרעסן</p>${scope==='all'?'<p>מעמבערס פון אנדערע משפחות באקומען די פרטים אין אימעיל, אבער דער לינק פארלאנגט צוטריט צו דער משפחה.</p>':''}<p>${p.sent} אנגענומען צום שיקן · ${p.queued} אין ריי · ${p.failed} נישט געשיקט</p>${!p.configured?'<p role="alert">אימעיל איז נאך נישט פארבונדן.</p>':''}<form data-form="simemail" data-id="${id}" data-scope="${scope}"><label><input type="checkbox" id="emailconfirm" required> איך באשטעטיג שיקן צו די אויסגעקליבענע מעמבערס</label><p>די זעלבע אינוויטעישן ווערט נאר איינמאל געשיקט צו יעדן אימעיל אדרעס.</p><div class="err" role="alert"></div><div class="btns"><button class="btn" ${!p.configured||!p.recipients?'disabled':''}>שיק דורך אימעיל</button><button type="button" class="btn l" data-act="emailstatus" data-id="${id}" data-scope="${scope}">דערפריש סטאטוס</button><button type="button" class="btn l" data-act="close">קענסל</button></div></form>`);
}
function simForm(id) {
  const x = (STATE.sims || []).find((s) => s.id === id) || { audience: 'all', whose: ME.name, kind: SIMKINDS[0] };
  const afterSunset = !!x.gdate && x.hdate_text === automaticHebrewDate(x.gdate, true);
  const kinds = SIMKINDS.includes(x.kind) ? SIMKINDS : [x.kind, ...SIMKINDS];
  modal(`<h2 style="margin-top:0">${id ? '✏️ עדיט שמחה' : '+ נייע שמחה'}</h2><form data-form="sim" data-id="${id}">
  ${field('וואס', `<select id="sk">${kinds.map((k) => `<option ${x.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select>`)}
  <div id="skow" style="display:none">${field('וואס פאר א שמחה', '<input id="sko">')}</div>
  ${field('פון וועמען', `<input id="sw" value="${esc(x.whose)}">`)}
  <div class="grid g2"><div>${field('דאטום', `<input id="sd" type="date" value="${esc(x.gdate || '')}">`)}</div><div>${field('צייט', `<input id="stt" value="${esc(x.time_text || '')}" placeholder="למשל: 7:00 נאכמיטאג">`)}</div></div>
  ${field('אידישער דאטום (אויטאמאטיש)', `<input id="sh" value="${esc(x.hdate_text || automaticHebrewDate(x.gdate || ''))}" placeholder="קלייב אויס א דאטום אויבן">`)}
  <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><input type="checkbox" id="safter" ${afterSunset?'checked':''}>די שמחה איז נאכן שקיעה</label>
  ${field('ווו (נאמען פון זאל / הויז)', `<input id="sp" value="${esc(x.hall || '')}">`)}
  ${field('אדרעס (פאר GPS)', `<input id="sa" dir="auto" value="${esc(x.address || '')}" placeholder="51 Forest Rd, Monroe, NY">`)}
  ${field('נאטיץ', `<input id="sn" value="${esc(x.note || '')}">`)}
  ${id ? '' : field('אינוויטעישן (בילד אדער PDF)', '<input type="file" id="sf" accept="image/*,application/pdf">')}<div id="ip"></div>
  ${field('שיק צו', `<select id="ss">${sideOptions(x.audience, true, 'אלע קאזינס')}</select>`)}
  <div class="err" id="ferr"></div><div class="btns"><button class="btn" id="simsave">${id ? 'סעיוו' : 'סעיוו און טייל אינוויטעישן'}</button><button type="button" class="btn l" data-act="close">קענסל</button>
  ${id ? `${x.file_id ? `<button type="button" class="btn l" data-act="delinv" data-id="${id}">אוועק אינוויטעישן</button>` : ''}<button type="button" class="btn r" style="margin-right:auto" data-act="delsim" data-id="${id}">🗑</button>` : ''}</div></form>`);
}
function showInv(id) {
  const x = STATE.sims.find((s) => s.id === id); const u = '/api/files/' + x.file_id;
  modal(`<h2 style="margin-top:0">${esc(x.kind)} · ${esc(x.whose)}</h2>${x.file_mime === 'application/pdf' && window.innerWidth <= 800
    ? `<a class="pdf" href="${u}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;padding:28px">📄 <div class="grow"><b>עפן די PDF אינוויטעישן</b><div class="muted">${esc(x.file_name)}</div></div></a>`
    : x.file_mime === 'application/pdf' ? `<iframe src="${u}" style="width:100%;height:65vh;border:1px solid #e6e8ec;border-radius:10px"></iframe>` : `<img src="${u}" style="width:100%;border-radius:10px;border:1px solid #e6e8ec">`}
  <div class="btns" style="margin-top:12px"><a class="btn l" href="${u}?dl=1">⬇ דאונלאוד</a><a class="btn l" href="${u}" target="_blank" rel="noopener">↗ עפן</a><button class="btn l" data-act="close">צומאכן</button></div>`, true);
}

// chat
V.chat = async () => {
  const {members:peers}=await api('/chat-members');STATE.chatPeers=peers;
  const rooms=['all',...mySides()];
  const dm=STATE.room.startsWith('dm:')?Number(STATE.room.split(':').find((x,i)=>i>0&&Number(x)!==ME.id)):0;
  if(!rooms.includes(STATE.room)&&!peers.some(p=>p.id===dm))STATE.room='all';
  STATE.chatReply=null;STATE.chatMentionIds=[];STATE.chatUpload=null;STATE.chatActivity=Date.now();
  await api(`/chat/${STATE.room}/presence`,{method:'POST',body:{active:true}});
  const {messages,members}=await api('/chat/'+STATE.room);STATE.chatMembers=members;STATE.chatMessages=messages;
  LASTMSG=messages.length?messages[messages.length-1].id:0;markSeen(STATE.room,LASTMSG);
  setTimeout(()=>{checkUnread();const c=$('cb');if(c)c.scrollTop=c.scrollHeight;startChatPoll();},0);
  return `<h1>💬 ${dm?'פריוואטע שמועס · '+esc(peers.find(p=>p.id===dm)?.name||''):'משפחה טשעט'}</h1>
    <div class="seg">${rooms.map(k=>`<button class="${STATE.room===k?'on':''}" data-act="room" data-v="${k}">${k==='all'?'אלע קאזינס':esc(famOf(k)||sideName(k))}</button>`).join('')}</div>
    ${field('פריוואטע שמועס',`<select data-change="privatechat"><option value="">— קלייב א קאזין —</option>${peers.filter(p=>p.id!==ME.id).map(p=>`<option value="${p.id}" ${p.id===dm?'selected':''}>${esc(p.name)}</option>`).join('')}</select>`)}
    <div class="card"><div id="chatpresence" class="muted" aria-live="polite">${chatPresence(members)}</div>
    <div class="chat" id="cb">${messages.length?renderMsgs(messages):'<div class="muted" id="cempty">נאך קיין מעסעדזשעס. זאג גוט מארגן! 👋</div>'}</div>
    <div id="chatreply"></div><div id="mentionchoices" class="btns"></div>
    <form data-form="chat"><div style="display:flex;gap:8px;margin-top:10px"><input id="ci" placeholder="שרייב א מעסעדזש… @ צו דערמאנען" style="margin:0" autocomplete="off" enterkeyhint="send"><button class="btn">שיק</button></div>
    <label class="btn l" style="display:inline-block;margin-top:8px;cursor:pointer">📎 לייג צו א פייל<input id="cf" type="file" style="display:none" data-change="chatfile"></label><span id="chatfilename" class="muted"></span><div class="err" role="alert"></div></form></div>`;
};
function chatPresence(members) {
  const online=members.filter(p=>p.online);
  return online.length?online.map(p=>`<span style="display:inline-block;margin:4px 0 8px 12px">🟢 ${esc(p.name)} · ${p.active?'אקטיוו':'אנליין'}</span>`).join(''):'קיינער איז יעצט נישט אקטיוו אין דעם שמועס';
}
function showChatReply() {
  const m=STATE.chatReply;
  $('chatreply').innerHTML=m?`<div class="card" style="padding:8px"><b>ענטפער צו ${esc(m.name)}</b><div>${esc((m.body||m.filename||'פייל').slice(0,160))}</div><button type="button" class="btn s l" data-act="cancelreply">✕ קענסל ענטפער</button></div>`:'';
}
function mentionChoices() {
  const input=$('ci');if(!input)return;const match=/@([^@\n]*)$/.exec(input.value);
  const choices=match?(STATE.chatMembers||[]).filter(p=>p.id!==ME.id&&p.name.toLocaleLowerCase().includes(match[1].toLocaleLowerCase())).slice(0,8):[];
  $('mentionchoices').innerHTML=choices.map(p=>`<button type="button" class="btn s l" data-act="mentionperson" data-id="${p.id}">@${esc(p.name)}</button>`).join('');
}
let LASTDAY = '';
function renderMsgs(ms, cont) {
  if(!cont)LASTDAY='';
  return ms.map(m=>{const k=dayKey(m.created_at),sep=k!==LASTDAY?`<div class="daysep">${dayLabel(m.created_at)}</div>`:'';LASTDAY=k;
    return `${sep}<div class="bub ${m.user_id===ME.id?'me':''}" data-mid="${m.id}"><span class="muted">${m.user_id===ME.id?'דו':esc(m.name)} · ${hm(m.created_at)}</span>
      ${m.reply_to?`<blockquote style="margin:6px 0;padding:6px;border-right:3px solid #818cf8"><small>ענטפער צו ${esc(m.reply_name||'מעסעדזש')}</small><div>${esc((m.reply_body||'פייל').slice(0,160))}</div></blockquote>`:''}
      ${(m.mentions||[]).length?`<small>${m.mentions.map(p=>`<span class="tag ${p.id===ME.id?'y':'g'}">@${esc(p.name)}</span>`).join(' ')}</small>`:''}
      <div style="white-space:pre-wrap">${esc(m.body)}</div>
      ${m.file_id?`<a class="btn s l" href="/api/files/${encodeURIComponent(m.file_id)}?dl=1" target="_blank" rel="noopener">📎 ${esc(m.filename)} · ${Math.ceil(m.size/1024)} KB</a>`:''}
      <button type="button" class="btn s l" data-act="replymessage" data-id="${m.id}">↩ ענטפער</button></div>`;
  }).join('');
}
function startChatPoll() {
  stopPoll();
  POLL=setInterval(async()=>{
    if(curView()!=='chat'||document.hidden)return;
    const room=STATE.room;
    try {
      await api(`/chat/${room}/presence`,{method:'POST',body:{active:Date.now()-(STATE.chatActivity||0)<45000}});
      const {messages,members}=await api(`/chat/${room}?after=${LASTMSG}`);
      if(room!==STATE.room||curView()!=='chat')return;
      STATE.chatMembers=members;if($('chatpresence'))$('chatpresence').innerHTML=chatPresence(members);
      if(messages.length){STATE.chatMessages.push(...messages);appendMsgs(messages);}
    }catch{/* transient network errors do not discard the draft */}
  },3000);
}
function appendMsgs(ms) {
  const c = $('cb'); if (!c) return; ms = ms.filter((m) => !c.querySelector(`[data-mid="${m.id}"]`)); if (!ms.length) return;
  const nearBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 120;
  $('cempty')?.remove(); c.insertAdjacentHTML('beforeend', renderMsgs(ms, true)); LASTMSG = Math.max(LASTMSG, ms[ms.length - 1].id); markSeen(STATE.room, LASTMSG);
  if (nearBottom) c.scrollTop = c.scrollHeight;
}
function stopPoll() { if (POLL) clearInterval(POLL); POLL = null; }
function markSeen(room, id) { if (id && (SEEN[room] || 0) < id) { SEEN[room] = id; if(!ME?.acting)localStorage.setItem('fam_seen', JSON.stringify(SEEN)); } }
async function checkUnread() {
  if (!ME || ME.status !== 'active') return;
  try { const { rooms } = await api('/chat-summary'); const u = rooms.some((r) => r.last_id && r.last_id > (SEEN[r.room] || 0) && !(curView() === 'chat' && STATE.room === r.room));
    if (u !== UNREAD) { UNREAD = u; renderNav(curView()); } } catch { /* */ }
}

// directory
V.people = async () => {
  const rosterPath=STATE.cousinFamilies?'/cousins?groups='+STATE.cousinFamilies.join(','):'/cousins';
  const [{ families }, { members, groups, selected }] = await Promise.all([api('/directory'), api(rosterPath)]); STATE.dir = families;
  const Q = STATE.q.trim(); const L = families.filter((d) => vis(d.side) && (!Q || [d.husband, d.wife, d.address, d.parents, d.phone_h, d.phone_w].join(' ').includes(Q)));
  const hasMine = families.some((d) => d.owner_id === ME.id);
  const groupNames=new Map(groups.map(g=>[g.id,g.name]));
  const memberCard=member=>`<div class="card"><b>${esc(member.name)}</b>${member.id===ME.id?' <span class="tag g">דו</span>':''}
    <div class="muted">${member.group_ids.map(id=>esc(groupNames.get(id))).join(' · ')}</div><div class="btns">
    ${member.id===ME.id?`<button class="btn s l" data-act="editdir" data-id="${families.find(d=>d.owner_id===member.id)?.id||0}" data-mine="1">מיין פרטים</button>`:''}
    ${ME.is_admin?`<button class="btn s l" data-act="linkcousin" data-id="${member.id}">${member.person_id?'טויש בוים פראפיל':'פארבינד צום בוים'}</button>`:''}</div></div>`;
  const byFather=new Map();
  for(const member of members){
    if(!member.father_id)continue;
    if(!byFather.has(member.father_id))byFather.set(member.father_id,[]);
    byFather.get(member.father_id).push(member);
  }
  const siblingSets=[...byFather.values()].filter(set=>set.length>1);
  const siblingIds=new Set(siblingSets.flatMap(set=>set.map(member=>member.id)));
  return `<h1>👥 קאזינס · אדרעסן און טעלעפאנען</h1><div class="cap">יעדער קאזין מיט מאן און ווייב, אדרעס און טעלעפאן. יעדער קען עדיטן זיינע אייגענע פרטים.</div>${seg()}
  <h2>${members.length} קאזינס אין אפ</h2>
  ${groups.length>1?`<fieldset class="person-family-picker"><legend>משפחות</legend><div class="person-family-options">${groups.map(g=>`<label><input type="checkbox" name="cousin-family" data-change="cousinfamily" value="${g.id}" ${selected.includes(g.id)?'checked':''}><strong>${esc(g.name)}</strong></label>`).join('')}</div></fieldset>`:''}
  <div id="memberlist">${siblingSets.map(set=>`<section><h3>${set.every(member=>member.lineage_term==='בן')?'ברידער':'געשוויסטער'} · קינדער פון ${esc(set[0].father_name)}</h3><div class="grid g2">${set.map(memberCard).join('')}</div></section>`).join('')}
  <div class="grid g2">${members.filter(member=>!siblingIds.has(member.id)).map(memberCard).join('')}</div>${members.length?'':'<p class="muted">נאך קיין מעמבערס אין די אויסגעקליבענע משפחות.</p>'}</div><h2>אדרעס בוך · ${esc(S.family_yi)}</h2>
  ${hasMine ? '' : `<div class="row" style="background:#eef2ff;border-color:#c7d2fe"><div class="grow"><b>לייג צו דיין משפחה</b><div class="muted">אז די קאזינס זאלן האבן דיין אדרעס און טעלעפאן</div></div><button class="btn s" data-act="editdir" data-id="0" data-mine="1">+ מיין משפחה</button></div>`}
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px"><input id="q" type="search" placeholder="🔍 סוירטש נאמען, שטאט, טעלעפאן…" value="${esc(STATE.q)}" style="margin:0;max-width:340px" data-input="q"><span class="muted" id="qn">${L.length} משפחות</span>
  <a class="btn s l" href="/api/directory.csv" download>⬇ דאונלאוד ליסט (Excel)</a><button class="btn s" data-act="editdir" data-id="0">+ לייג צו</button></div>
  <div class="grid g2" id="dirlist">${dirCards(L)}</div>
  <button class="btn" style="margin-top:14px" data-act="familyinvite">📲 אינווייט א קאזין</button>`;
};
function dirCards(L) {
  return L.map((d) => `<div class="card" style="padding:14px"><div style="display:flex;gap:10px;align-items:flex-start"><div class="av">${esc((d.husband || d.wife)[0])}</div><div class="grow"><b style="font-size:18px">${esc(d.husband)}${d.husband && d.wife ? ' · ' : ''}${esc(d.wife)}</b><div class="muted">${esc(d.parents)}</div></div>${sideTag(d.side)}</div>
  <div style="margin-top:10px;display:grid;gap:6px"><div>📍 <span dir="auto">${esc(d.address) || '—'}</span></div><div style="display:flex;gap:14px;flex-wrap:wrap">${d.husband ? `<span><span class="muted">מאן:</span> ${tel(d.phone_h)}</span>` : ''}${d.wife ? `<span><span class="muted">ווייב:</span> ${tel(d.phone_w)}</span>` : ''}</div></div>
  <div class="btns" style="margin-top:10px">${isManager() || d.owner_id === ME.id || d.created_by === ME.id ? `<button class="btn s l" data-act="editdir" data-id="${d.id}">✏️ עדיט</button>` : ''}${navBtns(d.address)}</div></div>`).join('') || '<div class="muted">גארנישט געטראפן</div>';
}
async function dirForm(id, mine) {
  const {people}=await api('/directory-people');
  const d = (STATE.dir || []).find((x) => x.id === id) || { side: mySides()[0], husband: mine ? ME.name : '' };
  modal(`<h2 style="margin-top:0">${id ? '✏️ עדיט' : mine ? '+ מיין משפחה' : '+ לייג צו א משפחה'}</h2><form data-form="dir" data-id="${id}" data-mine="${mine ? 1 : 0}">
  <p class="muted">קלייב באזונדערע מענטשן פון פעמילי טרי. זייערע עלטערן און פרטים ווערן גענוצט אין ביידע ערטער.</p>
  ${field('מאן — מענטש אין בוים',`<select id="dhperson"><option value="">— נאכנישט פארבונדן —</option>${people.map(p=>`<option value="${p.id}" ${d.husband_person_id===p.id?'selected':''}>${esc([p.title,p.name].filter(Boolean).join(' '))}</option>`).join('')}</select>`)}
  ${field('ווייב — מענטש אין בוים',`<select id="dwperson"><option value="">— נאכנישט פארבונדן —</option>${people.map(p=>`<option value="${p.id}" ${d.wife_person_id===p.id?'selected':''}>${esc([p.title,p.name].filter(Boolean).join(' '))}</option>`).join('')}</select>`)}
  <a href="#tree">🌳 לייג צו / עדיט א מענטש אין פעמילי טרי</a>
  <p class="muted">מען קען אויך אריינשרייבן נעמען אן א פארבינדונג צום בוים.</p>
  ${field('מאן', `<input id="dh" value="${esc(d.husband)}">`)}${field('ווייב', `<input id="dw" value="${esc(d.wife)}">`)}
  ${field('וועמענס קינד', `<input id="dp" value="${esc(d.parents)}" placeholder="למשל: זון פון ר׳ משה באכנער">`)}
  ${field('סייד', `<select id="ds">${sideOptions(d.side)}</select>`)}
  <h3>אדרעס</h3>${field('גאס און הויז נומער', `<input id="da" dir="auto" autocomplete="address-line1" value="${esc(d.address_line1 ?? d.address)}" placeholder="12 Main St">`)}
  ${field('דירה / אפארטמענט', `<input id="da2" dir="auto" autocomplete="address-line2" value="${esc(d.address_line2)}" placeholder="Apt 2B">`)}
  <div class="grid g2"><div>${field('שטאט', `<input id="dcity" dir="auto" autocomplete="address-level2" value="${esc(d.city)}">`)}</div><div>${field('סטעיט / פראווינץ', `<input id="dstate" dir="auto" autocomplete="address-level1" value="${esc(d.state)}">`)}</div></div>
  <div class="grid g2"><div>${field('זיפ / פאסט קאוד', `<input id="dzip" class="ltr" autocomplete="postal-code" value="${esc(d.postal_code)}">`)}</div><div>${field('לאנד', `<input id="dcountry" dir="auto" autocomplete="country-name" value="${esc(d.country)}">`)}</div></div>
  <div class="grid g2"><div>${field('טעלעפאן מאן', `<input id="dph" type="tel" class="ltr" value="${esc(d.phone_h)}">`)}</div><div>${field('טעלעפאן ווייב', `<input id="dpw" type="tel" class="ltr" value="${esc(d.phone_w)}">`)}</div></div>
  <div class="err" id="ferr"></div><div class="btns"><button class="btn">סעיוו</button><button type="button" class="btn l" data-act="close">קענסל</button>${id ? `<button type="button" class="btn r" style="margin-right:auto" data-act="deldir" data-id="${id}">🗑</button>` : ''}</div></form>`);
}

async function assignFamilies(id,selected) {
  const u=STATE.users.find(u=>u.id===id);if(!u)return;
  const {groups}=await api('/admin/family-groups');STATE.groups=groups;
  const chosen=selected||(u.family_group_ids||[]).filter(id=>groups.some(g=>g.id===id));
  modal(`<h2>בחר משפחות — ${esc(u.name)}</h2><p>קלייב איינס ביז פיר משפחות. דער מעמבער קען זען נאר די צוגעטיילטע משפחות. דאס מאכט נישט קיין קאפיעס פון מענטשן.</p>
  ${!groups.length?'<p role="status">נאך נישטא קיין משפחות. מאך די ערשטע משפחה אונטן.</p>':''}
  <form data-form="memberships" data-id="${id}"><fieldset><legend>משפחות <span id="membershipcount">${chosen.length} / 4</span></legend>
  ${groups.map(g=>`<label style="display:flex;align-items:center;gap:12px;min-height:48px"><input type="checkbox" name="membership" data-change="membershippick" value="${g.id}" ${chosen.includes(g.id)?'checked':chosen.length>=4?'disabled':''}>${esc(g.name)}${g.id===u.family_group_id?' (הויפט משפחה)':''}</label>`).join('')}</fieldset>
  <div class="err" role="alert"></div><div class="btns"><button class="btn" ${groups.length?'':'disabled'}>סעיוו</button><button type="button" class="btn l" data-act="close">קענסל</button></div></form>
  <hr><label for="assignnewgroup">פעלט א משפחה? מאך א נייע</label><input id="assignnewgroup" maxlength="120"><button type="button" class="btn l" data-act="createassigngroup" data-id="${id}">מאך משפחה</button>`);
}

// admin
V.admin = async () => {
  if (!managesAccounts()) return '<div class="muted">נאר פאר אדמין</div>';
  const {groups}=await api('/admin/family-groups'); STATE.groups=groups;
  const options=(id)=>'<option value="">— קלייב א משפחה —</option>'+groups.map(g=>`<option value="${g.id}" ${g.id===id?'selected':''}>${esc(g.name)}</option>`).join('');
  const { users, owner_phone } = await api('/admin/users'); STATE.users = users; PENDING = users.filter((u) => u.status === 'pending').length;
  const pend = users.filter((u) => u.status === 'pending'), rest = users.filter((u) => u.status !== 'pending'), resets = users.filter((u) => u.reset_requested_at);
  const sidesBox = (u) => !ME.is_admin&&(u.family_group_ids||[]).length>1?'<span class="muted">מערערע משפחות — נאר דער הויפט אדמין קען עדיטן</span>':['a', 'b'].map((c) => `<label style="display:inline-flex;align-items:center;font-weight:600;margin-left:10px"><input type="checkbox" data-change="usides" data-id="${u.id}" data-v="${c}" ${u.sides.includes(c) ? 'checked' : ''}>${esc(famOf(c) || sideName(c))}</label>`).join('');
  return `<a class="btn l" href="#personreviews">מענטשן איבערזיכט</a><h1>🛡️ אדמין</h1><div class="cap">אפרובירן נייע קאזינס, טוישן סייד, מאכן אנדערע אדמין.</div>
  ${ME.is_admin?`<section class="card"><h2>משפחה צוטריט</h2>${groups.length?field('משפחה וואס דו קוקסט',`<select data-change="viewgroup">${options(ME.selected_family_group_id)}</select>`):'<p role="status">נאך נישטא קיין צוטריט משפחות. מאך קודם די משפחות אונטן, דערנאך קלייב ביי יעדן מעמבער איינס ביז פיר משפחות.</p>'}<form data-form="newgroup">${field('מאך א נייע משפחה','<input id="groupname" maxlength="120" required>')}<button class="btn">מאך משפחה</button></form><button class="btn l" data-act="unassigned">צוטיילן אלטע רעקארדס</button></section>`:''}
  <form class="card" data-form="renamegroup">${field('עדיט משפחה נאמען',`<select id="renamegroupid" required>${options(ME.is_admin?ME.selected_family_group_id:ME.family_group_id)}</select><input id="renamegroupname" maxlength="120" placeholder="דער ריכטיגער משפחה נאמען" required>`)}<button class="btn">סעיוו משפחה נאמען</button><div class="err"></div></form>
  <h2>🔑 פאסווארט בקשות (${resets.length})</h2><p class="muted">באשטעטיג ווער דער מענטש איז איידער דו שיקסט א לינק. דער לינק איז איינמאליג און גוט פאר איין שעה.</p>
  ${resets.map(u => `<div class="row"><div class="grow"><b>${esc(u.name)}</b> <span dir="ltr">+${esc(u.phone)}</span><div class="muted">${esc(new Date(u.reset_requested_at).toLocaleString())}</div></div><button class="btn s" data-act="resetlink" data-id="${u.id}" ${!ME.is_admin&&(u.family_group_ids||[]).length>1?'disabled':''}>🔑 מאך א לינק</button></div>`).join('') || '<div class="muted">נאך קיין בקשות.</div>'}
  <h2>⏳ ווארטן אויף אפרוביישן (${pend.length})</h2>${pend.map((u) => `<div class="row" style="flex-wrap:wrap"><div class="grow"><b>${esc(u.name)}</b> <span class="muted" dir="ltr">+${esc(u.phone)}</span><div class="muted">${u.sides.map((c) => esc(famOf(c) || sideName(c))).join(' + ')}${u.note ? ' · ' + esc(u.note) : ''}</div></div>
   <div class="btns">${ME.is_admin?`<button class="btn s l" data-act="assignfamilies" data-id="${u.id}">בחר משפחות (ביז 4)</button>`:''}<button class="btn s g" data-act="approve" data-id="${u.id}">✓ אפרובירן</button><button class="btn s r" data-act="reject" data-id="${u.id}">✗ אפזאגן</button></div></div>`).join('') || '<div class="muted">קיינער ווארט נישט.</div>'}
  <h2>👥 אלע מעמבערס (${rest.length})</h2>${ME.is_admin?'<p>געפין דעם מעמבער, דריק <b>בחר משפחות</b>, צייכן אן ביז פיר משפחות און סעיוו. דער מעמבער קען דערנאך טוישן צווישן די צוגעטיילטע משפחות אויבן אין דער אפ.</p>':''}<table class="t resp"><thead><tr><th>נאמען</th><th>טעלעפאן</th><th>סייד</th><th>סטאטוס</th><th></th></tr></thead><tbody>
  ${rest.map((u) => `<tr><td><b>${esc(u.name)}</b>${u.is_admin ? ' <span class="tag y">הויפט אדמין</span>' : u.is_family_admin?' <span class="tag y">משפחה אדמין</span>':''}${u.has_password ? '' : ' <span class="tag">נאך קיין פאסווארט</span>'}</td><td dir="ltr" style="text-align:right">+${esc(u.phone)}</td><td>${sidesBox(u)}${ME.is_admin?`<div>${groups.filter(g=>(u.family_group_ids||[]).includes(g.id)).map(g=>`<span class="tag g">${esc(g.name)}</span>`).join(' ')||'<span class="tag">נאך נישט צוגעטיילט</span>'}</div><button class="btn s l" data-act="assignfamilies" data-id="${u.id}">בחר משפחות (ביז 4)</button>`:''}</td>
   <td>${u.status === 'active' ? '<span class="tag g">אקטיוו</span>' : '<span class="tag b">אפגעזאגט</span>'}</td>
   <td><div class="btns">${u.status !== 'active' ? `<button class="btn s g" data-act="approve" data-id="${u.id}">אפרובירן</button>` : ''}
   ${ME.is_admin && u.status==='active' && !u.is_admin && groups.some(g=>g.id===u.family_group_id)?`<button class="btn s l" data-act="actas" data-id="${u.id}">אריין אלס מעמבער</button>`:''}
   ${ME.is_admin && u.id !== ME.id && u.phone !== owner_phone ? `<button class="btn s l" data-act="mkadmin" data-id="${u.id}" data-v="${u.is_admin ? 0 : 1}">${u.is_admin ? 'נעם אוועק אדמין' : 'מאך אדמין'}</button>` : ''}
   ${!u.is_admin&&u.id!==ME.id&&(ME.is_admin||(u.family_group_ids||[]).length===1)?`<button class="btn s l" data-act="familyadmin" data-id="${u.id}" data-v="${u.is_family_admin?'0':'1'}">${u.is_family_admin?'נעם אוועק משפחה אדמין':'מאך משפחה אדמין'}</button>`:''}
   <button class="btn s l" data-act="resetlink" data-id="${u.id}" ${!ME.is_admin&&(u.family_group_ids||[]).length>1?'disabled':''}>🔑 פאסווארט לינק</button>${ME.is_admin && u.id !== ME.id && u.phone !== owner_phone ? `<button class="btn s r" data-act="deluser" data-id="${u.id}">🗑</button>` : ''}</div></td></tr>`).join('')}</tbody></table>
  ${ME.is_admin?`<h2>⚙️ משפחה נעמען</h2><form data-form="settings" class="card">
  ${field('נאמען פון דער אפ (אידיש)', `<input id="st_family_yi" value="${esc(S.family_yi)}">`)}${field('Name (English)', `<input id="st_family_en" class="ltr" value="${esc(S.family_en)}">`)}
  <div class="grid g2"><div>${field('סייד א (אידיש)', `<input id="st_side_a_yi" value="${esc(S.side_a_yi)}">`)}${field('משפחה נאמען', `<input id="st_side_a_family_yi" value="${esc(S.side_a_family_yi)}">`)}${field('Side A (English)', `<input id="st_side_a_en" class="ltr" value="${esc(S.side_a_en)}">`)}${field('Family name (English)', `<input id="st_side_a_family_en" class="ltr" value="${esc(S.side_a_family_en)}">`)}</div>
  <div>${field('סייד ב (אידיש)', `<input id="st_side_b_yi" value="${esc(S.side_b_yi)}">`)}${field('משפחה נאמען', `<input id="st_side_b_family_yi" value="${esc(S.side_b_family_yi)}">`)}${field('Side B (English)', `<input id="st_side_b_en" class="ltr" value="${esc(S.side_b_en)}">`)}${field('Family name (English)', `<input id="st_side_b_family_en" class="ltr" value="${esc(S.side_b_family_en)}">`)}</div></div>
  <div class="err" id="ferr"></div><button class="btn">סעיוו</button></form>`:''}`;
};
V.me = async () => ME.acting?`<a class="btn l" href="#personreviews">מענטשן איבערזיכט</a><h1>👤 מיין אקאונט</h1><section class="card"><strong>${esc(ME.name)}</strong><p dir="auto">${esc(ME.email||'')}</p></section>`:`<a class="btn l" href="#personreviews">מענטשן איבערזיכט</a><h1>👤 מיין אקאונט</h1><div class="cap">${both() ? 'ביידע סיידס' : esc(sideLong(ME.sides[0]))}${ME.is_admin ? ' · אדמין' : ''} · <span dir="ltr">+${esc(ME.phone)}</span></div>
  <form data-form="me" class="card" style="margin-bottom:14px">${field('נאמען', `<input id="mn" value="${esc(ME.name)}">`)}${field('אימעיל (נישט מוז)', `<input id="mem" type="email" class="ltr" value="${esc(ME.email || '')}">`)}<div class="err" id="ferr"></div><button class="btn">סעיוו</button></form>
  <section class="card" style="margin-bottom:14px"><h2>אימעיל פאר פאסווארט הילף</h2>${ME.email_verified ? '<p role="status">✓ דיין אימעיל איז באשטעטיגט. דו קענסט באקומען א פאסווארט לינק אויף אימעיל.</p>' : !EMAIL_READY ? '<p class="muted">אימעיל איז נאך נישט פארבונדן. דער אדמין קען דערווייל העלפן מיט א פאסווארט לינק.</p>' : !ME.email ? '<p class="muted">סעיוו קודם דיין אימעיל אדרעס אויבן, און באשטעטיג עס דא.</p>' : `<p class="muted">באשטעטיג דיין געסעיווטן אימעיל: <span dir="ltr">${esc(ME.email)}</span></p><form data-form="emailverifyrequest">${field('פאסווארט פאר אימעיל באשטעטיגונג', '<input id="emailverifypw" type="password" autocomplete="current-password" required>')}<div class="err" role="alert"></div><div id="emailverifystatus" role="status"></div><button class="btn">שיק א באשטעטיגונג אימעיל</button></form>`}</section>
  <section class="card" style="margin-bottom:14px"><h2>📖 טעגליכע לימוד דערמאנונגען</h2><p>באקום יעדן טאג אן אימעיל מיט'ן טעקסט פון דיינע חלקים משניות אדער תהילים. מען טיילט די חלקים לויט די טעג ביזן ענד דאטום. אן א דאטום שיקט מען אלע איבעריגע חלקים.</p><p class="muted">מען שיקט אינדערפרי לויט דער משפחה צייטזאנע. צייכן אפ וואס דו האסט געענדיגט אין דער ליסט.</p><button class="btn" data-act="learningreminders" ${!ME.learning_email_reminders && (!EMAIL_READY || !ME.email_verified) ? 'disabled' : ''}>${ME.learning_email_reminders ? 'אויסלעשן טעגליכע אימעילס' : 'איינשאלטן טעגליכע אימעילס'}</button><p role="status">${ME.learning_email_reminders ? '✓ טעגליכע אימעילס זענען איינגעשאלטן' : 'טעגליכע אימעילס זענען אויסגעלאשן'}${!ME.email_verified ? ' · באשטעטיג קודם דיין אימעיל אויבן' : ''}</p></section>
  <form data-form="myphone" class="card" style="margin-bottom:14px"><h2>טויש טעלעפאן נומער</h2><p class="muted">דאס איז דער נומער צו לאג אין. פאר אן אויסלענדישן נומער, לייג צו דעם לאנד קאוד.</p>${field('טעלעפאן נומער', `<input id="mphone" type="tel" class="ltr" autocomplete="tel" value="+${esc(ME.phone)}" required>`)}${field('יעצטיגע פאסווארט', '<input id="mphonepw" type="password" autocomplete="current-password" required>')}<div class="err" id="phoneerr"></div><button class="btn">סעיוו טעלעפאן נומער</button></form>
  <form data-form="mypw" class="card">${field('אלטע פאסווארט', '<input id="mo" type="password" autocomplete="current-password">')}${field('נייע פאסווארט', '<input id="mp" type="password" autocomplete="new-password" placeholder="כאטש 6 אותיות">')}<div class="err" id="ferr2"></div><button class="btn">טויש פאסווארט</button></form>
  <div class="muted" style="margin-top:12px">צו טוישן דיין סייד, רעד מיט דעם אדמין.</div><button class="btn l" style="margin-top:14px" data-act="logout">↩ לאג אאוט</button>`;

// ---------- router ----------
const curView = () => ((location.hash || '#').slice(1).split('/')[0] || 'home');
let RENDER = 0;
async function go() {
  const h = (location.hash || '').slice(1);
  const familyLink=/^(?:sim|learn)\/\d+\/\d+$/.test(h);
  if(!ME && STATE.canStopActing){stopPoll();clearChrome();$('m').innerHTML=`<div class="login">${actingBanner()}</div>`;return;}
  if (h.startsWith('join=')) {
    stopPoll(); clearChrome();
    const [token,...joinOptions] = h.slice(5).split('&');
    const listDestination=new URLSearchParams(joinOptions.join('&')).get('list');
    STATE.joinNext=listDestination==='all'?'#learn':/^[1-9][0-9]*$/.test(listDestination||'')?'#learn/'+listDestination:null;
    if (STATE.joinToken !== token) { STATE.joinToken = token; STATE.joinSides = null; STATE.authMode = 'signup'; }
    try {
      const invitation = await api('/family-invitations/' + encodeURIComponent(token));
      if (location.hash !== '#'+h) return;
      STATE.joinSides = invitation.sides; STATE.joinFamily=invitation.family_name;
      if (ME?.status==='active' && STATE.joinNext) {location.hash=STATE.joinNext;return;}
      if (ME) {
        $('m').innerHTML = `<div class="login"><h1>🌳 משפחה אינוויטעישן</h1><p>איינגעלאדנט צו: ${invitation.sides.map(c => esc(sideLong(c))).join(' + ')}</p><p>דו ביסט שוין איינגעשריבן אלס ${esc(ME.name)}. צו טוישן דיין סייד, רעד מיט דעם אדמין.</p><a class="btn" href="#home">צוריק צו מיין אקאונט</a></div>`;
      } else $('m').innerHTML = V.login();
    } catch (e) { if (location.hash === '#'+h) $('m').innerHTML = `<div class="login"><h1>אינוויטעישן</h1><p role="alert">${esc(e.message)}</p><a class="btn" href="#home">צוריק</a></div>`; }
    return;
  }
  STATE.joinToken = null; STATE.joinSides = null; STATE.joinFamily=null; STATE.joinNext = null;
  if (h.startsWith('verifyemail=')) { stopPoll(); clearChrome(); STATE.verifyEmailToken = h.slice(12); $('m').innerHTML = V.verifyemail(); return; }
  if (h === 'emailverified') { stopPoll(); clearChrome(); $('m').innerHTML = `<div class="login"><h1>✓ אימעיל באשטעטיגט</h1><p>דו קענסט יעצט באקומען א פאסווארט לינק אויף דיין אימעיל.</p><a class="btn" href="${ME ? '#me' : '#home'}">${ME ? 'מיין אקאונט' : 'לאג אין'}</a></div>`; return; }
  if (h.startsWith('setpw=')) { stopPoll(); clearChrome(); const token = STATE.setpwToken = h.slice(6); $('m').innerHTML = V.setpw(); api('/auth/token/' + encodeURIComponent(token)).then((r) => { if (location.hash !== '#setpw=' + token) return; $('spn').textContent = 'שלום ' + r.name + '!'; $('setpwsubmit').disabled = false; }).catch((e) => { if (location.hash !== '#setpw=' + token) return; $('spn').textContent = ''; $('ferr').textContent = e.message; }); return; }
  if (h === 'forgotpw') { stopPoll(); clearChrome(); $('m').innerHTML = V.forgotpw(); return; }
  if (!ME) { if(familyLink)STATE.loginNext='#'+h; stopPoll(); clearChrome(); $('m').innerHTML = V.login(); return; }
  if (ME.status !== 'active') { stopPoll(); clearChrome(); $('m').innerHTML = V.pending(); return; }
  if(ME.is_admin&&!ME.selected_family_group_id&&!familyLink&&!['admin','me'].includes(h)){location.hash='#admin';return;}
  const [v, arg] = h.split('/'); const view = V[v] && !['login', 'pending', 'setpw'].includes(v) ? v : 'home';
  $('m').classList.toggle('tree-workspace',view==='tree' && STATE.treeView==='tree');
  if (view !== 'chat') stopPoll();
  renderNav(view);
  const my = ++RENDER;
  try { const html = await V[view](arg); if (my !== RENDER) return; const keep = STATE.keepScroll; $('m').innerHTML = html; if (!keep) window.scrollTo(0, 0); STATE.keepScroll = false; renderNav(view); observeFamilyTree(); }
  catch (e) { if (my === RENDER) { if (e.status === 401 || e.status === 403) { await loadMe(); if (!ME || ME.status !== 'active') return go(); } $('m').innerHTML = `<div class="empty"><div class="e">⚠️</div>${esc(e.message)}<div style="margin-top:10px"><button class="btn s" data-act="reload">פרוביר נאכאמאל</button></div></div>`; } }
}
const refresh = () => { STATE.keepScroll = true; return go(); };
function clearChrome() { $('m').classList.remove('tree-workspace'); $('nav').innerHTML = ''; $('tabs').innerHTML = ''; $('top').innerHTML = ''; }
async function loadMe() { const r = await api('/me'); ME = r.user; STATE.canStopActing=!!r.can_stop_acting; EMAIL_READY = !!r.email_enabled; S = r.settings || {}; document.title = S.family_yi || 'משפחה'; }

// ---------- actions ----------
const ACT = {
  linkcousin:async el=>{
    const id=Number(el.dataset.id),profile=await api(`/admin/users/${id}/tree-profile`);
    const options=profile.people.map(p=>`<option value="${p.id}" ${p.id===profile.person_id?'selected':''}>${esc([p.title,p.name].filter(Boolean).join(' '))}${p.father_name?' · טאטע: '+esc(p.father_name):''}</option>`).join('');
    modal(`<h2>פארבינד ${esc(profile.name)} צום בוים</h2><form data-form="cousinprofile" data-id="${id}">
      ${field('פראפיל אין פעמילי טרי',`<select id="cousinperson"><option value="">— קלייב אויס —</option>${options}</select>`)}
      <div class="err" role="alert"></div><div class="btns"><button class="btn">סעיוו</button><button type="button" class="btn l" data-act="close">צומאכן</button></div></form>`);
  },
  actas:async el=>{
    el.disabled=true;
    try { await api('/admin/users/'+el.dataset.id+'/act-as',{method:'POST'}); }
    finally { el.disabled=false; }
    history.replaceState(null,'','#home');location.reload();
  },
  stopacting:async()=>{
    await api('/auth/stop-acting',{method:'POST'});
    history.replaceState(null,'','#admin');location.reload();
  },
  assignfamilies:el=>assignFamilies(Number(el.dataset.id)),
  createassigngroup:async el=>{const chosen=[...document.querySelectorAll('[name=membership]:checked')].map(e=>Number(e.value));const {group}=await api('/admin/family-groups',{method:'POST',body:{name:val('assignnewgroup')}});if(chosen.length<4)chosen.push(group.id);await assignFamilies(Number(el.dataset.id),chosen);},
  reuseperson:async el=>{
    const field=el.dataset.field,id=Number(el.dataset.id);
    if(field==='person')return personForm(id);
    const select=$('p'+field);if(![...select.options].some(o=>o.value===String(id)))select.add(new Option(el.closest('.card').querySelector('b').textContent,String(id)));
    select.value=String(id);$('new_'+field).hidden=true;
  },
  reviewperson:async el=>{
    if(!confirm(el.dataset.v==='approve'?'אפרובירן אלס א באזונדערן מענטש?':'באשטעטיגן די החלטה?'))return;
    await api('/person-reviews/'+el.dataset.id+'/resolve',{method:'POST',body:{action:el.dataset.v,existing_person_id:el.dataset.person?Number(el.dataset.person):undefined}});refresh();
  },
  familyadmin:async el=>{await api('/admin/users/'+el.dataset.id,{method:'PATCH',body:{is_family_admin:el.dataset.v==='1'}});refresh();},
  recoverypreview:async f=>{
    const label_groups=Object.fromEntries([...f.querySelectorAll('[data-recovery-label]')].map(e=>[e.dataset.recoveryLabel,Number(e.value)]));
    const plan=await api('/admin/recover-tree/preview',{method:'POST',body:{label_groups}});STATE.recovery={label_groups,token:plan.token};
    modal(`<h2>איבערקוקן דעם אריגינעלן בוים</h2><p>${plan.people.length} עקזיסטירנדיקע מענטשן. די זעלבע רעקארדס און פארבינדונגען בלייבן; מען מאכט נישט קיין קאפיעס. טשעט, אדרעסן און שמחות ווערן נישט געטוישט.</p>${plan.people.map(p=>`<p><b>#${p.id} ${esc(p.name)}</b><br>${p.group_ids.map(id=>esc(plan.groups.find(g=>g.id===id).name)).join(' · ')}${p.inherited?' (לויט ביידע עלטערן)':''}</p>`).join('')}${plan.unknown.length?'<p class="err">עטליכע מענטשן האבן נאך נישט קיין זיכערע משפחה צוטיילונג.</p>':'<button class="btn" data-act="recoverconfirm">שטעל צוריק דעם עקזיסטירנדיקן בוים</button>'}<button class="btn l" data-act="close">קענסל</button>`,true);
  },
  recoverconfirm:async()=>{const r=await api('/admin/recover-tree',{method:'POST',body:STATE.recovery});closeModal();toast(`${r.people} מענטשן צוריקגעשטעלט`);location.hash='#tree';},
  unassigned:async()=>{
    const {records}=await api('/admin/unassigned-records');
    const names={people:'מענטשן',yahrzeits:'יארצייטן',learn_lists:'לערנען',directory:'אדרעסן',simchas:'שמחות',files:'פיילס',messages:'מעסעדזשעס',families:'משפחה נעמען'};
    modal(`<h2>צוטיילן אלטע רעקארדס</h2>${records.people.length?`<form data-form="recoverypreview" class="card"><h3>שטעל צוריק דעם אריגינעלן בוים</h3><p>פארבינד יעדן אלטן משפחה נאמען מיט דער ריכטיגער משפחה. דערנאך זעסטו א קלארן איבערבליק איידער מען סעיווט.</p>${records.families.map(f=>field(esc(f.label),`<select required data-recovery-label="${f.id}"><option value="">— קלייב א משפחה —</option>${STATE.groups.map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select>`)).join('')}<div class="err"></div><button class="btn">ווייז די צוטיילונג</button></form>`:''}<p>די רעקארדס זענען פארבארגן ביז מען טיילט זיי צו. קלייב בלויז רעקארדס פון איין משפחה, מיט זייערע פארבינדונגען. קיין רעקארד ווערט נישט אויסגעמעקט.</p><form data-form="assignrecords">${field('משפחה',`<select id="assigngroup" required><option value="">—</option>${STATE.groups.map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select>`)}${Object.entries(records).map(([table,rows])=>`<details><summary>${names[table]} (${rows.length}${rows.length===500?'+':''})</summary>${rows.map(r=>`<label style="display:block"><input type="checkbox" name="assignrecord" data-table="${table}" value="${esc(r.id)}"> #${esc(r.id)} ${esc(r.label)}${table==='people'?`<small style="display:block;padding-inline-start:28px;font-weight:normal">${[['טאטע',r.father_name,r.father_id],['מאמע',r.mother_name,r.mother_id],['פארבונדן צו',r.parent_name,r.parent_id],['זיווג ראשון',r.spouse_name,r.spouse_id],['זיווג שני',r.second_spouse_name,r.second_spouse_id]].filter(x=>x[2]).map(x=>`${esc(x[0])}: ${esc(x[1]||'—')} (#${esc(x[2])})`).join(' · ')}${r.families?.length?'<br>משפחה נעמען: '+r.families.map(f=>esc(f.name)+' (#'+esc(f.id)+')').join(', '):''}</small>`:''}</label>`).join('')}</details>`).join('')}<div class="err"></div><button class="btn">באשטעטיג צוטיילונג</button></form>`,true);
  },
  emailsim: el=>emailSim(Number(el.dataset.id)),
  emailstatus: el=>emailSim(Number(el.dataset.id),el.dataset.scope),
  sharesim: el=>shareSim(STATE.sims.find(x=>x.id===Number(el.dataset.id))),
  viewperson: el=>personProfile(Number(el.dataset.id)),
  emaillearn:async()=>{
    const listId=STATE.list.l.id;
    const preview=await api(`/lists/${listId}/learning-email`);
    STATE.learningEmail={listId,request_key:crypto.randomUUID(),fingerprint:preview.fingerprint};
    const reason=!preview.available?'אלע חלקים זענען שוין גענומען.':!preview.email_enabled?'אימעיל איז נאך נישט פארבונדן.':!preview.recipient_count?'נאך קיין באשטעטיגטע אימעיל אדרעסן אין דער משפחה.':'';
    modal(`<h2>✉️ בעט די משפחה צו נעמען משניות</h2><p>${esc(preview.family)} · ${preview.recipient_count} באשטעטיגטע אימעיל אדרעסן</p>
      <p><strong>${esc(preview.subject)}</strong></p><textarea readonly aria-label="אימעיל איבערבליק" rows="7">${esc(preview.text)}</textarea>
      <form data-form="sendlearningemail">${reason?`<p class="muted">${reason}</p>`:''}<p id="learning-email-status" role="status"></p><div class="err" role="alert"></div>
      <div class="btns"><button type="submit" class="btn" ${reason?'disabled':''}>שיק אימעיל</button><button type="button" class="btn l" data-act="close">צומאכן</button></div></form>`);
  },
  sharelearn: async ()=>{
    const l=STATE.list.l,lists=(await api('/lists')).lists;
    const sameDedications = (a,b) => a.yahrzeit_ids.length === b.yahrzeit_ids.length &&
      (a.yahrzeit_ids.length ? a.yahrzeit_ids.every(id=>b.yahrzeit_ids.includes(id)) : a.niftar===b.niftar);
    const related=lists.find(x=>x.kind!==l.kind && x.side===l.side && sameDedications(x,l));
    const selected=related?[l,related]:[l];
    const sides=l.side==='both'?mySides():[l.side];
    const invite=await api('/family-invitations',{method:'POST',body:{sides}});
    const links=selected.map(x=>`${x.kind==='mishnayos'?'📚 משניות':'📜 תהילים'}: ${invite.link}&list=${x.id}`);
    const message=`טייערע משפחה, לאמיר צוזאמען לערנען לעילוי נשמת ${l.niftar}.\nמען קען נעמען א גאנצע מסכתא, א פרק, אפילו איין משנה, אדער א קאפיטל תהילים — אדער ביידע! יעדער קליינער חלק איז חשוב.\n${l.target_date?'ביז '+gdate(l.target_date)+'\n':''}דריק אויפן לינק און קלייב אויס דיין חלק:\n${links.join('\n')}\nיישר כח! די אינוויטעישן לינקס זענען גוט פאר 7 טעג.`;
    modal(`<h2>📲 לאדן די משפחה צו לערנען</h2><p class="muted">מיטן לינק קען א קאזין זיך איינשרייבן און גלייך עפענען די ליסט.</p><textarea readonly id="rl" rows="9">${esc(message)}</textarea><div class="btns"><a class="btn g" href="https://wa.me/?text=${encodeURIComponent(message)}" target="_blank" rel="noopener">שיק אויף וואטסעפ</a><button class="btn l" data-act="copy">קאפי מעסעדזש און לינקס</button><button class="btn l" data-act="close">צומאכן</button></div>`);
  },
  replymessage: el=>{STATE.chatReply=STATE.chatMessages.find(m=>String(m.id)===el.dataset.id);showChatReply();$('ci').focus();},
  cancelreply: ()=>{STATE.chatReply=null;showChatReply();},
  mentionperson: el=>{const p=STATE.chatMembers.find(p=>String(p.id)===el.dataset.id);if(!p)return;$('ci').value=$('ci').value.replace(/@([^@\n]*)$/,'@'+p.name+' ');STATE.chatMentionIds=[...new Set([...(STATE.chatMentionIds||[]),p.id])];$('mentionchoices').innerHTML='';$('ci').focus();},
  yzexisting: ()=>{const id=Number(val('yzperson'));if(!id)throw new Error('קלייב אויס א מענטש');return yahrzeitPerson(id);},
  yznew: ()=>yahrzeitPerson(0),
  masechta: el=>openMasechta(Number(el.dataset.idx)),
  portion: el=>openPortion(Number(el.dataset.c),Number(el.dataset.m)),
  backmasechta: ()=>openMasechta(STATE.portions.idx),
  portionaction: async el=>{const scope=STATE.portionScope;await api(`/lists/${STATE.list.l.id}/items/${scope.idx}`,{method:'POST',body:{...scope,action:el.dataset.v}});await go();await openMasechta(scope.idx);toast('✓ געסעיווט');},
  learninghelp: async el=>{await api(`/lists/${STATE.list.l.id}/help/${el.dataset.id}`,{method:'POST',body:{action:el.dataset.v}});await refresh();},
  familyinvite: familyInviteForm,
  forgotpw: () => { STATE.resetPhone = val('fp'); STATE.resetRequested = false; location.hash = '#forgotpw'; },
  backlogin: () => { STATE.authMode = 'login'; STATE.resetRequested = false; history.replaceState(null, '', location.pathname + location.search); go(); },
  close: closeModal, more: moreSheet, reload: () => location.reload(),
  logout: async () => { closeModal(); await api('/auth/logout', { method: 'POST' }).catch(() => {}); ME = null; STATE.canStopActing=false; location.hash = ''; go(); },
  recheck: async () => { await loadMe(); go(); if (ME && ME.status !== 'active') toast('נאך נישט אפרובירט'); },
  authmode: (el) => { STATE.authMode = el.dataset.v; go(); },
  pick: (el) => { if (STATE.joinSides) return; STATE.pickSides = el.dataset.v === 'ab' ? ['a', 'b'] : [el.dataset.v]; const keep = { fn: val('fn'), fp: val('fp'), fw: $('fw').value, fnote: val('fnote') }; $('m').innerHTML = V.login(); for (const k in keep) if ($(k)) $(k).value = keep[k]; },
  side: (el) => { STATE.side = el.dataset.v; refresh(); },
  treezoom: (el) => { STATE.treeZoom=el.dataset.v==='fit'?null:el.dataset.v==='actual'?1:Math.max(0.2,Math.min(2,(STATE.treeScale||1)+Number(el.dataset.v))); updateFamilyViewport(); },
  treeside: (el) => { STATE.treeSide = el.dataset.v; STATE.treeZoom=null; refresh(); }, treeview: (el) => { STATE.treeView = el.dataset.v; refresh(); },
  room: (el) => { STATE.room = el.dataset.v; go(); },
  simpast: (el) => { STATE.simPast = el.dataset.v === '1'; go(); },
  remind: async (el) => { const on = el.dataset.on === '1'; await api(`/yahrzeits/${el.dataset.id}/remind`, { method: 'POST', body: { on } }); toast(on ? '🔔 מען וועט דיך דערמאנען' : 'אפגעשטעלט'); refresh(); },
  edityz: (el) => yzForm(Number(el.dataset.id)),
  delyz: async (el) => { if (!confirm('אויסמעקן דעם יארצייט?')) return; await api('/yahrzeits/' + el.dataset.id, { method: 'DELETE' }); closeModal(); toast('אויסגעמעקט'); refresh(); },
  editp: (el) => personForm(Number(el.dataset.id)),
  addmarriage: el=>personForm(Number(el.dataset.id),undefined,{openRelative:el.dataset.key}),
  marriagechild: async el=>{
    const {people}=await api('/people'),p=people.find(x=>x.id===Number(el.dataset.id)),spouse=people.find(x=>x.id===Number(el.dataset.spouse));
    if(!p||!spouse)throw new Error('די עלטערן זענען נישט געטראפן');
    STATE.childMarriage={person:p,spouse};
    modal(`<h2>+ קינד פון ${esc(p.name)} און ${esc(spouse.name)}</h2><form data-form="marriagechild">${field('ווער איז דער טאטע?',`<select id="childfather" required><option value="">— קלייב דעם טאטע —</option><option value="${p.id}">${esc(p.name)}</option><option value="${spouse.id}">${esc(spouse.name)}</option></select>`)}<p>ביידע עלטערן ווערן פארבונדן צום נייעם קינד. עקזיסטירנדיקע קינדער בלייבן ווי זיי זענען.</p><button class="btn">ווייטער צו קינד</button><button type="button" class="btn l" data-act="close">קענסל</button></form>`);
  },
  addchild: el=>personForm(0, Number(el.dataset.id)),
  delp: async (el) => { if (!confirm('אויסמעקן?')) return; await api('/people/' + el.dataset.id, { method: 'DELETE' }); closeModal(); toast('אויסגעמעקט'); refresh(); },
  newlist: (el) => listForm(Number(el.dataset.yz) || 0,el),
  item: (el) => onItem(Number(el.dataset.idx)),
  itemact: async (el) => { const { l } = STATE.list; const a = el.dataset.v; await api(`/lists/${l.id}/items/${el.dataset.idx}`, { method: 'POST', body: { action: a } }); closeModal(); toast(a === 'give' ? 'צוריקגעגעבן' : a === 'done' ? '✓ יישר כח!' : 'געטוישט'); refresh(); },
  learningreminders: async () => { const r = await api('/me/learning-reminders', {method:'POST',body:{on:!ME.learning_email_reminders}}); ME={...ME,...r.user}; toast('✓ געסעיווט'); await refresh(); },
  dellist: async (el) => { if (!confirm('אויסמעקן די גאנצע ליסט?')) return; await api('/lists/' + el.dataset.id, { method: 'DELETE' }); location.hash = '#learn'; },
  editsim: (el) => simForm(Number(el.dataset.id)),
  delsim: async (el) => { if (!confirm('אויסמעקן די שמחה?')) return; await api('/simchas/' + el.dataset.id, { method: 'DELETE' }); closeModal(); toast('אויסגעמעקט'); refresh(); },
  delinv: async (el) => { await api(`/simchas/${el.dataset.id}/invite`, { method: 'DELETE' }); closeModal(); toast('אינוויטעישן אוועקגענומען'); refresh(); },
  showinv: (el) => showInv(Number(el.dataset.id)),
  ppl: (el) => { const s = $('ppl' + el.dataset.id); s.textContent = Math.max(1, Math.min(50, Number(s.textContent) + Number(el.dataset.d))); },
  rsvp: async (el) => { const id = el.dataset.id, a = el.dataset.v; const x = STATE.sims.find((s) => s.id === Number(id)); const n = Number($('ppl' + id).textContent);
    await api(`/simchas/${id}/rsvp`, { method: 'POST', body: { answer: x.my_answer === a && (a === 'no' || x.my_people === n) ? null : a, people: n } }); toast(a === 'yes' ? `✓ מען ווייסט אז דו קומסט (${n})` : 'מען ווייסט, א שיינעם דאנק'); refresh(); },
  who: (el, ev) => { ev.preventDefault(); const x = STATE.sims.find((s) => s.id === Number(el.dataset.id)); modal(`<h2 style="margin-top:0">ווער קומט · ${esc(x.kind)} ${esc(x.whose)}</h2>${x.rsvps.length ? x.rsvps.map((r) => `<div class="row"><div class="grow">${esc(r.name)}</div>${r.answer === 'yes' ? `<span class="tag g">קומט · ${r.people}</span>` : '<span class="tag b">נישט</span>'}</div>`).join('') : '<div class="muted">נאך קיינער</div>'}<button class="btn l" data-act="close">צומאכן</button>`); },
  mazeltov: async (el) => { await api(`/simchas/${el.dataset.id}/mazeltov`, { method: 'POST', body: {} }); toast('מזל טוב געשיקט אין טשעט! 🎉'); },
  editdir: (el) => dirForm(Number(el.dataset.id), el.dataset.mine === '1'),
  deldir: async (el) => { if (!confirm('אויסמעקן?')) return; await api('/directory/' + el.dataset.id, { method: 'DELETE' }); closeModal(); toast('אויסגעמעקט'); refresh(); },
  approve: async (el) => { await api('/admin/users/' + el.dataset.id, { method: 'PATCH', body: { status: 'active' } }); toast('✓ אפרובירט'); refresh(); },
  reject: async (el) => { if (!confirm('אפזאגן?')) return; await api('/admin/users/' + el.dataset.id, { method: 'PATCH', body: { status: 'rejected' } }); toast('אפגעזאגט'); refresh(); },
  mkadmin: async (el) => { await api('/admin/users/' + el.dataset.id, { method: 'PATCH', body: { is_admin: el.dataset.v === '1' } }); toast('✓ געטוישט'); refresh(); },
  deluser: async (el) => { const u = STATE.users.find((x) => x.id === Number(el.dataset.id)); if (!confirm(`אויסמעקן ${u.name} און אלעס וואס ער האט צוגעלייגט?`)) return; await api('/admin/users/' + u.id, { method: 'DELETE' }); toast('אויסגעמעקט'); refresh(); },
  resetlink: async (el) => { const u = STATE.users.find((x) => x.id === Number(el.dataset.id)); const r = await api(`/admin/users/${u.id}/reset-link`, { method: 'POST', body: {} });
    const msg = `שלום ${u.name}, דא קענסטו איינשטעלן דיין פאסווארט פאר ${S.family_yi}: ${r.link}`;
    await refresh();
    modal(`<h2 style="margin-top:0">🔑 פאסווארט לינק פאר ${esc(u.name)}</h2><p class="muted">איינמאליג, גוט פאר ${r.hours} שעה. באשטעטיג ווער דער מענטש איז און שיק עס נאר צו אים/איר.</p><input readonly class="ltr" id="rl" value="${esc(r.link)}">
    <div class="btns"><a class="btn g" href="https://wa.me/${esc(u.phone)}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">שיק אויף וואטסעפ</a><button class="btn l" data-act="copy">קאפי</button><button class="btn l" data-act="close">צומאכן</button></div>`); },
  copy: async () => { const e = $('rl'); e.select(); try { await navigator.clipboard.writeText(e.value); } catch { document.execCommand('copy'); } toast('✓ קאפירט'); },
};
const CHANGE = {
  emailscope: el=>emailSim(Number(el.dataset.id),el.value),
  cousinfamily:()=>{
    STATE.cousinFamilies=[...document.querySelectorAll('input[name="cousin-family"]:checked')].map(el=>Number(el.value));
    return refresh();
  },
  viewgroup:async el=>{if(!el.value)return;await api('/me/family-group',{method:'POST',body:{family_group_id:Number(el.value)}});location.reload();},
  membershippick:el=>{const boxes=[...document.querySelectorAll('[name=membership]')];const count=boxes.filter(b=>b.checked).length;boxes.forEach(b=>b.disabled=!b.checked&&count>=4);$('membershipcount').textContent=count+' / 4';},
  privatechat: el=>{if(!el.value)return;const id=Number(el.value);STATE.room='dm:'+Math.min(ME.id,id)+':'+Math.max(ME.id,id);return go();},
  chatfile: el=>{const f=el.files[0];STATE.chatUpload=null;if(f&&f.size>10*1024*1024){el.value='';throw new Error('מאקסימום 10 MB');}$('chatfilename').textContent=f?' · '+f.name:'';},
  newrelative: el => { $('new_' + el.dataset.key).hidden = el.value !== 'new'; },
  upinv: async (el) => { const f = el.files[0]; if (!f) return; if (f.size > 10 * 1024 * 1024) return toast('⚠️ די פייל איז צו גרויס (מאקסימום 10 MB)'); toast('⬆ אפלאודינג…');
    const fd = new FormData(); fd.append('file', f); await api(`/simchas/${el.dataset.id}/invite`, { method: 'POST', body: fd }); toast('✓ אינוויטעישן אפלאודעד'); refresh(); },
  usides: async (el) => { const u = STATE.users.find((x) => x.id === Number(el.dataset.id)); const s = new Set(u.sides); el.checked ? s.add(el.dataset.v) : s.delete(el.dataset.v);
    try { await api('/admin/users/' + u.id, { method: 'PATCH', body: { sides: [...s] } }); toast('✓ סייד געטוישט'); } catch (e) { el.checked = !el.checked; throw e; } refresh(); },
};
const FORMS = {
  simemail: async f=>{await api(`/simchas/${f.dataset.id}/email`,{method:'POST',body:{scope:f.dataset.scope,confirmed:$('emailconfirm').checked}});toast('✓ אימעילס צוגעלייגט צום שיקן');await emailSim(Number(f.dataset.id),f.dataset.scope);},
  marriagechild: ()=>{
    const {person,spouse}=STATE.childMarriage;
    return personForm(0,undefined,{...childParents(person.id,spouse.id,Number(val('childfather'))),side:person.side,families:person.families||[]});
  },
  renamegroup:async()=>{await api('/admin/family-groups/'+val('renamegroupid'),{method:'PATCH',body:{name:val('renamegroupname')}});await loadMe();refresh();},
  newgroup:async()=>{const {group}=await api('/admin/family-groups',{method:'POST',body:{name:val('groupname')}});await api('/me/family-group',{method:'POST',body:{family_group_id:group.id}});location.reload();},
  memberships:async f=>{const ids=[...f.querySelectorAll('[name=membership]:checked')].map(e=>Number(e.value));if(!ids.length)throw new Error('קלייב כאטש איין משפחה');await api('/admin/users/'+f.dataset.id+'/family-group',{method:'PUT',body:{family_group_ids:ids}});closeModal();toast('משפחות צוגעטיילט — דער מעמבער דארף נאכאמאל לאגין');await loadMe();refresh();},
  recoverypreview:async f=>ACT.recoverypreview(f),
  assignrecords:async f=>{const records={};for(const e of f.querySelectorAll('[name=assignrecord]:checked'))(records[e.dataset.table]||=[]).push(e.value);await api('/admin/assign-records',{method:'POST',body:{family_group_id:Number(val('assigngroup')),records}});closeModal();toast('צוגעטיילט');refresh();},
  portionhelp: async ()=>{const scope=STATE.portionScope;await api(`/lists/${STATE.list.l.id}/items/${scope.idx}/help`,{method:'POST',body:{...scope,note:val('helpnote')}});closeModal();await go();toast('✓ דיין בקשה איז אין דער ליסט');},
  familyinvite: async () => {
    const side = val('inviteSide');
    const r = await api('/family-invitations', { method: 'POST', body: { sides: side === 'both' ? ['a', 'b'] : [side] } });
    const names = r.sides.map(c => sideLong(c)).join(' + ');
    const message = `${S.family_yi}: דו ביסט איינגעלאדנט צו ${names}. מאך אן אקאונט דא: ${r.link}`;
    modal(`<h2>🌳 אינוויטעישן גרייט</h2><p><b>${esc(names)}</b></p><p class="muted">גוט פאר ${r.days} טעג. מיט דעם לינק קען מען גלייך אריין, אן ווארטן אויף אפרוביישן.</p><input id="rl" readonly class="ltr" aria-label="Invitation link" value="${esc(r.link)}"><div class="btns"><a class="btn g" href="https://wa.me/?text=${encodeURIComponent(message)}" target="_blank" rel="noopener">שיק אויף וואטסעפ</a><button class="btn l" data-act="copy">קאפי לינק</button><button class="btn l" data-act="close">צומאכן</button></div>`);
  },
  forgotpw: async () => { await api('/auth/forgot-password', { method: 'POST', body: { phone: val('resetphone') } }); STATE.resetRequested = true; go(); },
  login: async () => { const r = await api('/auth/login', { method: 'POST', body: { phone: val('fp'), password: $('fw').value } }); ME = r.user; await loadMe(); toast('ברוך הבא! ✓'); location.hash = STATE.loginNext || STATE.joinNext || '#home'; STATE.loginNext=null; go(); },
  signup: async () => { const r = await api('/auth/signup', { method: 'POST', body: { name: val('fn'), phone: val('fp'), password: $('fw').value, sides: STATE.pickSides || [], invitation_token: STATE.joinToken || undefined, create_family:STATE.joinToken?undefined:val('newfamilyname'), note: val('fnote') } }); ME = r.user; await loadMe(); location.hash = STATE.joinNext || '#home'; go(); },
  setpw: async () => { if ($('sp1').value !== $('sp2').value) throw new Error('די צוויי פאסווארטס זענען נישט די זעלבע'); await api('/auth/set-password', { method: 'POST', body: { token: STATE.setpwToken, password: $('sp1').value } }); STATE.setpwToken = null; history.replaceState(null, '', location.pathname + location.search + '#home'); await loadMe(); toast('✓ פאסווארט איינגעשטעלט'); go(); },
  yz: async (f) => { const id = Number(f.dataset.id); const b = { name: val('yn'), father_name: val('yf'), relation: val('yr'), hday: Number(val('yd')), hmonth: val('ym'), death_year: val('yy'), side: val('ys'), kever: val('yk'), note: val('yo') };
    await api(id ? '/yahrzeits/' + id : '/yahrzeits', { method: id ? 'PUT' : 'POST', body: b }); closeModal(); toast('✓ געסעיווט'); refresh(); },
  person: async (f) => { const id = Number(f.dataset.id); const b = {family_ids:[...f.querySelectorAll('[name=person_family]:checked')].map(el=>Number(el.value)),new_family:val('pnewfamily'),lineage_term:val('plineage'),name:val('pn'),title:val('ptitle'),known_as:val('pknownas'),father_id:val('pfather_id'),mother_id:val('pmother_id'),spouse_id:val('pspouse_id'),second_spouse_id:val('psecond_spouse_id'),parent_id:val('pparent_id'),side:val('pside'),life_status:val('plife'),death_hday:val('pday'),death_hmonth:val('pmonth'),death_year:val('pyear'),note:val('pno'),kever:val('pkever'),kever_address:val('pkeveraddress'),legacy_yahrzeit_id:f.dataset.legacyid||undefined,require_yahrzeit:f.dataset.yahrzeit==='1'||undefined};
    b.new_relatives = {};
    for (const key of ['father_id','mother_id','spouse_id','second_spouse_id']) if (b[key] === 'new') {
      b.new_relatives[key] = { name: val('new_' + key + '_name'), title: val('new_' + key + '_title'), known_as: val('new_' + key + '_known_as') }; b[key] = null;
    }
    b.confirm_distinct=$('pdistinct').checked;b.distinct_reason=val('pdistinctreason');
    const fingerprint=JSON.stringify(b);if(f._saveFingerprint!==fingerprint){f._saveKey=crypto.randomUUID();f._saveFingerprint=fingerprint;}b.request_key=f._saveKey;
    let result;try{result=await api(id ? '/people/' + id : '/people', { method: id ? 'PUT' : 'POST', body: b });}
    catch(e){if(e.details?.code==='person_matches')renderPersonMatches(e.details.field,e.details.matches);throw e;}
    closeModal();if(result.pending_review){
      if(result.review_family_group_id){
        await api('/me/family-group',{method:'POST',body:{family_group_id:result.review_family_group_id}});
        await loadMe();
      }
      toast('געשיקט צום אדמין — נאך נישט צוגעלייגט');location.hash='#personreviews';
    }else if (b.require_yahrzeit) {
      STATE.yzFamily='';
      toast('✓ יארצייט געסעיווט');
      if (curView()==='yz') await refresh(); else location.hash='#yz';
    }else{toast('✓ ' + b.name + ' געסעיווט');refresh();} },
  list: async (form) => {
    const custom=$('learning-custom').checked;
    const yahrzeit_ids=custom?[]:selectedMemorialIds(form);
    if (!custom&&!yahrzeit_ids.length) {
      $('learning-search').focus();
      throw new Error('קלייב אויס כאטש איין יארצייט.');
    }
    const r=await api('/lists',{method:'POST',body:{kind:val('lk'),yahrzeit_ids,niftar:custom?val('ln'):'',target_date:val('ld'),side:val('ls')}});
    if (!form.isConnected) return;
    closeModal();
    toast('✓ ליסט געמאכט');
    location.hash=`#learn/${r.list.id}/${r.list.family_group_id}`;
  },
  cousinprofile:async f=>{
    await api(`/admin/users/${f.dataset.id}/tree-profile`,{method:'PUT',body:{person_id:Number(val('cousinperson'))||null}});
    closeModal();toast('✓ געסעיווט');return refresh();
  },
  sendlearningemail:async f=>{
    const button=f.querySelector('button[type="submit"]');
    const {listId,request_key,fingerprint}=STATE.learningEmail;
    button.disabled=true;
    try {
      const result=await api(`/lists/${listId}/learning-email`,{method:'POST',body:{request_key,fingerprint}});
      if(result.sent===result.total){closeModal();toast(`✓ אימעיל געשיקט צו ${result.sent}`);}
      else if($('learning-email-status')) {
        $('learning-email-status').textContent=`${result.sent} פון ${result.total} געשיקט. פרוביר נאכאמאל פאר די איבעריגע.`;
        button.textContent='פרוביר נאכאמאל';
      }
    } finally { button.disabled=false; }
  },
  sim: async (f) => { const id = Number(f.dataset.id); const kind = val('sk') === 'אנדערע' ? (val('sko') || 'שמחה') : val('sk');
    const b = { kind, whose: val('sw'), gdate: val('sd'), time_text: val('stt'), hdate_text: val('sh'), hall: val('sp'), address: val('sa'), note: val('sn'), audience: val('ss') };
    const file = $('sf') && $('sf').files[0]; if (file && file.size > 10 * 1024 * 1024) throw new Error('די פייל איז צו גרויס (מאקסימום 10 MB)');
    $('simsave').disabled = true;
    try { const r = await api(id ? '/simchas/' + id : '/simchas', { method: id ? 'PUT' : 'POST', body: b });
      if (file) { const fd = new FormData(); fd.append('file', file); try { await api(`/simchas/${r.simcha.id}/invite`, { method: 'POST', body: fd }); } catch (e) { toast('⚠️ די שמחה איז געסעיווט, אבער די אינוויטעישן נישט: ' + e.message); closeModal(); return refresh(); } }
      closeModal(); toast('✓ געסעיווט'); STATE.simPast = false; if (curView() === 'sim') await refresh(); else location.hash = '#sim'; if (!id) shareSim(r.simcha); }
    finally { if ($('simsave')) $('simsave').disabled = false; } },
  chat: async ()=>{
    const room=STATE.room,e=$('ci'),text=e.value.trim(),file=$('cf').files[0];if(!text&&!file)return;
    if(file&&!STATE.chatUpload){const fd=new FormData();fd.append('file',file);const r=await api(`/chat/${room}/attachment`,{method:'POST',body:fd});STATE.chatUpload=r.file;}
    const mentionIds=(STATE.chatMentionIds||[]).filter(id=>{const p=(STATE.chatMembers||[]).find(p=>p.id===id);return p&&text.includes('@'+p.name);});
    await api(`/chat/${room}`,{method:'POST',body:{body:text,file_id:STATE.chatUpload?.id,reply_to:STATE.chatReply?.id,mention_ids:mentionIds}});
    if(room!==STATE.room||!$('ci'))return;
    e.value='';$('cf').value='';$('chatfilename').textContent='';STATE.chatUpload=null;STATE.chatMentionIds=[];STATE.chatReply=null;showChatReply();$('mentionchoices').innerHTML='';
    const {messages}=await api(`/chat/${room}?after=${LASTMSG}`);STATE.chatMessages.push(...messages);appendMsgs(messages);const c=$('cb');c.scrollTop=c.scrollHeight;e.focus();
  },
  dir: async (f) => { const id = Number(f.dataset.id); const b = { husband: val('dh'), wife: val('dw'), parents: val('dp'), side: val('ds'), address_line1: val('da'), address_line2: val('da2'), city: val('dcity'), state: val('dstate'), postal_code: val('dzip'), country: val('dcountry'), phone_h: val('dph'), phone_w: val('dpw'), mine: f.dataset.mine === '1',husband_person_id:val('dhperson'),wife_person_id:val('dwperson') };
    await api(id ? '/directory/' + id : '/directory', { method: id ? 'PUT' : 'POST', body: b }); closeModal(); toast('✓ געסעיווט'); refresh(); },
  settings: async () => { const b = {}; document.querySelectorAll('[id^=st_]').forEach((e) => { b[e.id.slice(3)] = e.value.trim(); }); const r = await api('/admin/settings', { method: 'PUT', body: b }); S = r.settings; toast('✓ געסעיווט'); refresh(); },
  me: async () => { const r = await api('/me', { method: 'PATCH', body: { name: val('mn'), email: val('mem') } }); ME = r.user; toast('✓ געסעיווט'); refresh(); },
  myphone: async () => { const r = await api('/me/phone', { method: 'POST', body: { phone: val('mphone'), password: $('mphonepw').value } }); ME = r.user; toast('✓ טעלעפאן נומער געסעיווט'); refresh(); },
  emailverifyrequest: async () => { await api('/me/email-verification', { method: 'POST', body: { password: $('emailverifypw').value } }); $('emailverifypw').value = ''; $('emailverifystatus').textContent = '✓ געשיקט. קוק אין דיין אימעיל און דריק אויפן באשטעטיגונג לינק.'; },
  verifyemail: async () => { await api('/auth/verify-email', { method: 'POST', body: { token: STATE.verifyEmailToken } }); STATE.verifyEmailToken = null; history.replaceState(null, '', location.pathname + location.search + '#emailverified'); await loadMe(); go(); },
  mypw: async () => { await api('/me/password', { method: 'POST', body: { old: $('mo').value, password: $('mp').value } }); $('mo').value = $('mp').value = ''; toast('✓ פאסווארט געטוישט'); },
};
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]'); if (!el) { if (ev.target.id === 'md') closeModal(); return; }
  const f = ACT[el.dataset.act]; if (!f) return; if (el.tagName === 'A' && !el.getAttribute('href')) ev.preventDefault();
  try { await f(el, ev); } catch (e) { fail(e); }
});
document.addEventListener('change', async (ev) => { const el = ev.target.closest('[data-change]'); if (!el || el.dataset.change==='familyfilter') return; try { await CHANGE[el.dataset.change](el); } catch (e) { fail(e); } });
document.addEventListener('input', (ev) => {
  if(ev.target.id==='pn'){if($('pdistinct'))$('pdistinct').checked=false;return renderPersonMatches();}const relative=/^new_(father_id|mother_id|spouse_id|second_spouse_id)_name$/.exec(ev.target.id);if(relative)return renderPersonMatches(relative[1]);
  const el = ev.target;if(el.id==='ci'){STATE.chatActivity=Date.now();mentionChoices();return;} if (el.dataset.input !== 'q') return; STATE.q = el.value;
  const Q = STATE.q.trim(); const L = (STATE.dir || []).filter((d) => vis(d.side) && (!Q || [d.husband, d.wife, d.address, d.parents, d.phone_h, d.phone_w].join(' ').includes(Q)));
  $('dirlist').innerHTML = dirCards(L); $('qn').textContent = L.length + ' משפחות';
});
document.addEventListener('submit', async (ev) => {
  const f = ev.target.closest('[data-form]'); if (!f) return; ev.preventDefault(); if(f.dataset.busy)return;f.dataset.busy='1';
  const err = f.querySelector('.err'); if (err) err.textContent = '';
  const btn = f.querySelector('button:not([type=button])'); if (btn) btn.disabled = true;
  try { await FORMS[f.dataset.form](f); } catch (e) { if (e.status === 401 && f.dataset.form !== 'login') return fail(e); if (err) err.textContent = e.message; else fail(e); }
  finally { delete f.dataset.busy; if (btn && document.body.contains(btn)) btn.disabled = false; }
});
document.addEventListener('change', (ev) => { if(ev.target.dataset.change==='familyfilter') { STATE[ev.target.dataset.key]=ev.target.value; refresh(); } if (ev.target.id === 'sk') $('skow').style.display = ev.target.value === 'אנדערע' ? '' : 'none';
  if (ev.target.id === 'sd' || ev.target.id === 'safter') $('sh').value = automaticHebrewDate(val('sd'), $('safter').checked);
  if (ev.target.id === 'sf') { const f = ev.target.files[0]; $('ip').innerHTML = !f ? '' : f.type === 'application/pdf' ? `<div class="muted" style="margin:-4px 0 12px">📄 ${esc(f.name)}</div>` : `<img src="${URL.createObjectURL(f)}" style="max-width:100%;max-height:200px;border-radius:8px;margin:-4px 0 12px">`; } });
document.addEventListener('pointerdown',()=>{if(curView()==='chat')STATE.chatActivity=Date.now();});
document.addEventListener('keydown', (ev) => {
  if(curView()==='chat')STATE.chatActivity=Date.now();
  if (ev.key==='Escape') closeModal();
  if (ev.key!=='Tab' || !learningDialogTrigger) return;
  const controls=[...$('mb').querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled)')].filter(el=>el.getClientRects().length);
  const first=controls[0], last=controls.at(-1);
  if (ev.shiftKey && [first,$('learning-create-title')].includes(document.activeElement)) { ev.preventDefault(); last.focus(); }
  if (!ev.shiftKey && document.activeElement===last) { ev.preventDefault(); first.focus(); }
});
window.addEventListener('hashchange', () => { closeModal(); go(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && ME) checkUnread(); });
setInterval(checkUnread, 20000);
(async () => { try { await loadMe(); } catch (e) { $('m').innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`; return; } go(); checkUnread(); })();

