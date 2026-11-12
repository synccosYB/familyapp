'use strict';
import { familyUnits, treeViewportLayout } from './tree-layout.js';
// Familye client: one file, no framework. All server data is members-only; nothing secret lives here.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let ME = null, EMAIL_READY = false, S = {}, STATE = { side: 'all', room: 'all', q: '', treeView: window.innerWidth < 800 ? 'list' : 'tree', treeSide: null };
let POLL = null, LASTMSG = 0, SEEN = JSON.parse(localStorage.getItem('fam_seen') || '{}');

function toast(t) { const e = $('ts'); e.textContent = t; e.style.display = 'block'; clearTimeout(e._t); e._t = setTimeout(() => (e.style.display = 'none'), 2600); }
function modal(html, wide) { $('mb').className = 'mbox' + (wide ? ' wide' : ''); $('mb').innerHTML = html; $('md').classList.add('on'); const f = $('mb').querySelector('input:not([type=file]),select,textarea'); if (f && window.innerWidth > 800) f.focus(); }
function closeModal() { $('md').classList.remove('on'); $('mb').innerHTML = ''; }

async function api(path, opts = {}) {
  const o = { method: opts.method || 'GET', headers: { 'x-familye': '1' }, credentials: 'same-origin' };
  if (opts.body instanceof FormData) o.body = opts.body;
  else if (opts.body !== undefined) { o.body = JSON.stringify(opts.body); o.headers['content-type'] = 'application/json'; }
  const r = await fetch('/api' + path, o);
  let j = {}; try { j = await r.json(); } catch { /* */ }
  if (!r.ok) { const e = new Error(j.error || 'פעלער ' + r.status); e.status = r.status; throw e; }
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
const sideTag = (c) => `<span class="tag ${c === 'a' || c === 'b' ? c : 'g'}">${esc(c === 'a' || c === 'b' ? (famOf(c) || sideName(c)) : sideName(c))}</span>`;
const familyTags = (p) => (p.families || []).map(f=>`<span class="tag g">${esc(f.name)}</span>`).join(' ');
const familyChoices = (rows) => [...new Map(rows.flatMap(p=>p.families || []).map(f=>[f.id,f])).values()].sort((a,b)=>a.name.localeCompare(b.name));
const familySelector = (rows,key,label) => field(label,`<select data-change="familyfilter" data-key="${key}"><option value="">אלע משפחות</option>${familyChoices(rows).map(f=>`<option value="${f.id}" ${Number(STATE[key])===f.id?'selected':''}>${esc(f.name)}</option>`).join('')}</select>`);
const both = () => ME && (ME.is_admin || (ME.sides.includes('a') && ME.sides.includes('b')));
const mySides = () => (ME.is_admin ? ['a', 'b'] : ME.sides);
const vis = (s) => STATE.side === 'all' || s === STATE.side || s === 'both' || s === 'all';
function seg() { if (!both()) return ''; return `<div class="seg">${[['all', 'ביידע סיידס'], ['a', famOf('a') || sideName('a')], ['b', famOf('b') || sideName('b')]].map(([k, t]) => `<button class="${STATE.side === k ? 'on' : ''}" data-act="side" data-v="${k}">${esc(t)}</button>`).join('')}</div>`; }
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
function renderNav(v) {
  const extra = [['me', '👤', 'מיין אקאונט']]; if (ME.is_admin) extra.unshift(['admin', '🛡️', 'אדמין']);
  $('nav').innerHTML = `<div class="lg">${esc(S.family_yi)}</div><div class="sd">${esc(ME.name)} · ${both() ? 'ביידע סיידס' : esc(sideLong(ME.sides[0]))}</div>` +
    [...PAGES, ...extra].map(([k, i, t]) => `<a class="${v === k ? 'on' : ''}" href="#${k}">${i} ${t}${k === 'admin' && PENDING ? `<span class="badge">${PENDING}</span>` : ''}${k === 'chat' && UNREAD ? '<span class="badge">●</span>' : ''}</a>`).join('') +
    `<a data-act="logout" style="margin-top:14px;opacity:.7">↩ לאג אאוט</a>`;
  const tb = [['home', '🏠', 'היים'], ['yz', '🕯️', 'יארצייטן'], ['sim', '🎉', 'שמחות'], ['chat', '💬', 'טשעט'], ['more', '☰', 'מער']];
  const inMore = !['home', 'yz', 'sim', 'chat'].includes(v);
  $('tabs').innerHTML = tb.map(([k, i, t]) => `<a class="${(k === v || (k === 'more' && inMore)) ? 'on' : ''}" ${k === 'more' ? 'data-act="more"' : `href="#${k}"`}><span class="i">${i}</span>${t}${k === 'chat' && UNREAD ? '<span class="badge">●</span>' : ''}${k === 'more' && PENDING ? `<span class="badge">${PENDING}</span>` : ''}</a>`).join('');
  $('top').innerHTML = `<div class="topbar"><b>🌳 ${esc(S.family_yi)}</b><span>${esc(ME.name.split(' ')[0])}</span></div>`;
}
function moreSheet() {
  const L = [['tree', '🌳', 'פעמילי טרי'], ['learn', '📖', 'משניות און תהילים'], ['people', '👥', 'קאזינס / אדרעסן'], ...(ME.is_admin ? [['admin', '🛡️', 'אדמין' + (PENDING ? ` (${PENDING} ווארטן)` : '')]] : []), ['me', '👤', 'מיין אקאונט']];
  modal(`<div class="sheet">${L.map(([k, i, t]) => `<a href="#${k}" data-act="close">${i} ${t}</a>`).join('')}<a data-act="logout">↩ לאג אאוט</a></div><button class="btn l" style="width:100%;margin-top:12px" data-act="close">צומאכן</button>`);
}

// ---------- views ----------
const V = {};
V.login = () => {
  const mode = STATE.authMode || 'login';
  const sides = STATE.pickSides || [];
  return `<div class="login"><div style="font-size:54px">🌳</div><h1>${esc(S.family_yi)}</h1><div class="cap">אלע קאזינס אין איין ארט: יארצייטן, פעמילי טרי, לערנען, שמחות און טשעט.</div>
  <div class="seg"><button class="${mode === 'login' ? 'on' : ''}" data-act="authmode" data-v="login">לאג אין</button><button class="${mode === 'signup' ? 'on' : ''}" data-act="authmode" data-v="signup">נייער קאזין? מאך אן אקאונט</button></div>
  <form data-form="${mode}" class="card" style="text-align:right">
  ${mode === 'signup' ? field('דיין נאמען (ווי די משפחה קען דיך)', '<input id="fn" autocomplete="name" placeholder="למשל: יואל באכנער">') : ''}
  ${field('טעלעפאן נומער', '<input id="fp" type="tel" inputmode="tel" autocomplete="tel" class="ltr" placeholder="845-555-1234">')}
  ${field('פאסווארט', `<input id="fw" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" ${mode === 'signup' ? 'placeholder="כאטש 6 אותיות"' : ''}>`)}
  ${mode === 'signup' ? `<div class="cap" style="margin:8px 0">פון וועלכע סייד ביסטו א קאזין?</div>
   <button type="button" class="sidebtn ${sides.join() === 'a' ? 'on' : ''}" data-act="pick" data-v="a">👨 ${esc(S.side_a_yi)}<div class="muted">${famOf('a') ? 'משפחת ' + esc(famOf('a')) : ''}</div></button>
   <button type="button" class="sidebtn ${sides.join() === 'b' ? 'on' : ''}" data-act="pick" data-v="b">👩 ${esc(S.side_b_yi)}<div class="muted">${famOf('b') ? 'משפחת ' + esc(famOf('b')) : ''}</div></button>
   <button type="button" class="sidebtn ${sides.length === 2 ? 'on' : ''}" style="font-size:16px" data-act="pick" data-v="ab">ביידע סיידס</button>
   ${field('וועמענס קינד/אייניקל ביסטו? (כדי דער אדמין זאל וויסן)', '<input id="fnote" placeholder="למשל: א זון פון משה באכנער">')}` : ''}
  <div class="err" id="ferr"></div>
  <button class="btn" style="width:100%">${mode === 'signup' ? 'מאך אן אקאונט' : 'לאג אין'}</button>
  ${mode === 'login' ? '<div class="muted" style="margin-top:12px"><button type="button" class="btn l" data-act="forgotpw">פארגעסן דאס פאסווארט?</button></div>' : '<div class="muted" style="margin-top:12px">נאכן רעדזשיסטרירן מוז דער אדמין דיך אפרובירן.</div>'}
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
  return `<h1>שלום ${esc(ME.name.split(' ')[0])} 👋</h1><div class="cap">היינט: ${esc(h.today)} · ${both() ? 'דו זעסט ביידע סיידס פון די משפחה' : esc(sideLong(ME.sides[0]))}</div>
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
  <div style="margin-top:18px"><a class="btn l" href="${inviteLink()}" target="_blank" rel="noopener">📲 אינווייט א קאזין (וואטסעפ)</a></div>`;
};
function inviteLink() { return 'https://wa.me/?text=' + encodeURIComponent(`${S.family_yi}: יארצייטן, פעמילי טרי, משניות און תהילים, שמחות און טשעט פאר אלע קאזינס. מאך אן אקאונט דא: ${location.origin}/`); }

// yahrzeits
V.yz = async () => {
  const { yahrzeits } = await api('/yahrzeits'); STATE.yzs = yahrzeits;
  const L = yahrzeits.filter(y => !STATE.yzFamily || (y.families || []).some(f=>f.id===Number(STATE.yzFamily)));
  return `<h1>🕯️ יארצייטן</h1><div class="cap">אלע זיידעס, באבעס און משפחה. דער דאטום פאר דעם יאר ווערט אויסגערעכנט פונעם אידישן דאטום.</div>${familySelector(yahrzeits,'yzFamily','משפחה')}
  ${L.map((y) => `<div class="row" style="flex-wrap:wrap"><div class="grow" style="min-width:220px"><b>${esc(y.name)} ${esc(y.father_name)}</b> ${familyTags(y)}
   <div class="muted">${esc(y.relation)}${y.relation ? ' · ' : ''}<b style="color:#111827">${esc(y.hebrew)}</b>${y.next ? ` · דעם יאר: ${gdate(y.next.ymd)} · <b style="color:#4338ca">${inDays(y.next.days)}</b>` : ''}</div>
   ${y.kever ? `<div class="muted">🪦 ${esc(y.kever)}</div>` : ''}${y.note ? `<div class="muted">${esc(y.note)}</div>` : ''}</div>
   <div class="btns"><button class="btn s ${y.remind ? 'g' : 'l'}" data-act="remind" data-id="${y.id}" data-on="${y.remind ? 0 : 1}">${y.remind ? '🔔 מען דערמאנט דיך' : '🔔 רימיינד מיר'}</button>
   <button class="btn s l" data-act="newlist" data-yz="${y.id}">📖 מאך א ליסט</button><button class="btn s l" data-act="edityz" data-id="${y.id}">✏️ עדיט</button></div></div>`).join('') || empty('🕯️', 'נאך קיין יארצייטן.')}
  <button class="btn" style="margin-top:10px" data-act="edityz" data-id="0">+ נייער יארצייט</button>
  <div class="muted" style="margin-top:10px">🔔 "רימיינד מיר" ווערט געהאלטן פאר דיר; מעסעדזשעס/נאטיפיקעישנס קומען שפעטער.</div>`;
};
async function yzForm(id) {
  const y = (STATE.yzs || []).find((x) => x.id === id) || { side: mySides()[0], hday: 1, hmonth: 'TISHREI' };
  if(y.person_id) return personForm(y.person_id);
  modal(`<h2 style="margin-top:0">${id ? '✏️ עדיט יארצייט' : '+ נייער יארצייט'}</h2><form data-form="yz" data-id="${id}">
  ${field('נאמען', `<input id="yn" value="${esc(y.name)}" placeholder="ר׳ אברהם באכנער">`)}
  ${field('טאטנס נאמען', `<input id="yf" value="${esc(y.father_name)}" placeholder="בן ר׳ יצחק ז״ל / בת ר׳ …">`)}
  ${field('ווער איז ער/זי', `<input id="yr" value="${esc(y.relation)}" placeholder="זיידע, באבע, פעטער…">`)}
  <div class="grid g2" style="grid-template-columns:1fr 2fr"><div>${field('טאג', `<select id="yd">${Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}" ${y.hday === i + 1 ? 'selected' : ''}>${hebD(i + 1)}</option>`).join('')}</select>`)}</div>
  <div>${field('חודש', `<select id="ym">${HMONTHS.map(([k, t]) => `<option value="${k}" ${y.hmonth === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`)}</div></div>
  ${field('יאר פון פטירה (אויב מען ווייסט, למשל 5770)', `<input id="yy" inputmode="numeric" class="ltr" value="${esc(y.death_year || '')}" placeholder="5770">`)}
  ${field('סייד', `<select id="ys">${sideOptions(y.side)}</select>`)}
  ${field('קבר (וואו ער/זי ליגט)', `<input id="yk" value="${esc(y.kever)}" placeholder="למשל: מאנסי, ביה״ק …">`)}
  ${field('נאטיץ', `<input id="yo" value="${esc(y.note)}">`)}
  <div class="err" id="ferr"></div><div class="btns"><button class="btn">סעיוו</button><button type="button" class="btn l" data-act="close">קענסל</button>${id ? `<button type="button" class="btn r" style="margin-right:auto" data-act="delyz" data-id="${id}">🗑 אויסמעקן</button>` : ''}</div></form>`);
}

// family tree
V.tree = async () => {
  const { people } = await api('/people'); STATE.people = people;
  const P = people; // Server permissions determine visibility; family membership never cuts spouse/ancestor links.
  const {units,edges,generationConflicts}=familyUnits(P); STATE.treeEdges=edges;
  const graphMode=STATE.treeView==='tree' && !generationConflicts.length;
  const node = p => `<button style="${STATE.treeFamily && (p.families || []).some(f=>f.id===Number(STATE.treeFamily))?'outline:3px solid #4338ca;outline-offset:2px':''}" class="pn family-person ${p.niftar?'d':''}" data-tree-person="${p.id}" data-act="editp" data-id="${p.id}"><strong>${esc([p.title,p.name].filter(Boolean).join(' '))}${p.niftar?' ז״ל':''}</strong>${p.father_name?`<span class="muted tree-relation">טאטע: ${esc(p.father_name)}</span>`:''}${p.mother_name?`<span class="muted tree-relation">מאמע: ${esc(p.mother_name)}</span>`:''}${p.spouse && !p.spouse_id?`<span class="muted">מאן / ווייב: ${esc(p.spouse)}</span>`:''}</button>`;
  const couple = unit => `<section class="family-unit ${unit.members.length===2?'married':''}" aria-label="${unit.members.length===2?'פארהייראטע פארפאלק':'מענטש'}">${unit.members.length===2?'<div class="marriage-label">פארהייראט</div>':''}<div class="family-members">${unit.members.map(node).join('')}</div></section>`;
  const levels=[...new Set(units.map(u=>u.level))].sort((a,b)=>a-b);
  const treeHtml=graphMode
    ? `<div class="tree-toolbar" aria-label="בוים פארגרעסערונג"><button class="btn s l" data-act="treezoom" data-v="fit">פאס צום עקראַן</button><button class="btn s l" data-act="treezoom" data-v="-0.1" aria-label="פארקלענערן בוים">−</button><output id="tree-scale" aria-live="polite">100%</output><button class="btn s l" data-act="treezoom" data-v="0.1" aria-label="פארגרעסערן בוים">+</button><button class="btn s l" data-act="treezoom" data-v="actual">100%</button><button class="btn s" data-act="editp" data-id="0">+ לייג צו אין בוים</button></div><div class="family-scroll" id="family-viewport"><div class="family-stage" id="family-stage"><div class="family-map" id="family-map"><svg class="family-lines" aria-hidden="true"></svg>${levels.map(level=>`<div class="family-level">${units.filter(u=>u.level===level).map(couple).join('')}</div>`).join('')}</div></div></div>`
     : `<div class="family-table-scroll"><table class="family-table"><thead><tr><th>נאמען</th><th>מאן / ווייב</th><th>טאטע</th><th>מאמע</th></tr></thead>${units.map(unit=>`<tbody${unit.members.length===2?' class="married-rows"':''}>${unit.members.map(p=>`<tr><td><button class="family-name" data-act="editp" data-id="${p.id}">${esc([p.title,p.name].filter(Boolean).join(' '))}${p.niftar?' ז״ל':''}</button> ${familyTags(p)}</td><td>${esc(p.spouse_name||p.spouse)||'—'}</td><td>${esc(p.father_name)||'—'}</td><td>${esc(p.mother_name)||'—'}</td></tr>`).join('')}</tbody>`).join('')}</table></div>`;
  return `<h1>🌳 פעמילי טרי</h1><div class="cap">דריק אויף א נאמען צו עדיטן אדער צולייגן קינדער.</div>
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
function updateFamilyViewport() {
  const map=$('family-map'),viewport=$('family-viewport'),stage=$('family-stage'); if(!map||!viewport||!stage) return;
  const oldScale=Number(map.dataset.scale),oldBounds=map.getBoundingClientRect(),oldViewport=viewport.getBoundingClientRect();
  const anchor=oldScale?{x:(oldViewport.left+viewport.clientLeft+viewport.clientWidth/2-oldBounds.left)/oldScale,
    y:(oldViewport.top+viewport.clientTop+viewport.clientHeight/2-oldBounds.top)/oldScale}:null;
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
    viewport.scrollLeft+=next.left+anchor.x*scale-(bounds.left+viewport.clientLeft+viewport.clientWidth/2);
    viewport.scrollTop+=next.top+anchor.y*scale-(bounds.top+viewport.clientTop+viewport.clientHeight/2);
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
async function personForm(id, parentId) {
  const {people:P}=await api('/people'); STATE.people=P;
  const p = P.find(x=>x.id===id) || {side:STATE.treeSide || mySides()[0],parent_id:parentId || null};
  const choice=(key,label)=>field(label,`<select id="p${key}"><option value="">— נישט באקאנט / קיין לינק —</option>${P.filter(x=>x.id!==id).map(x=>`<option value="${x.id}" ${p[key]===x.id?'selected':''}>${esc([x.title,x.name].filter(Boolean).join(' '))}</option>`).join('')}</select>`);
  modal(`<h2 style="margin-top:0">${id ? '✏️ ' + esc(p.name) : '+ מענטש אין פעמילי טרי'}</h2><form data-form="person" data-id="${id}">
  <div class="grid g2"><div>${field('טיטל',`<input id="ptitle" value="${esc(p.title)}" placeholder="הרב / מרת">`)}</div><div>${field('נאמען',`<input id="pn" value="${esc(p.name)}">`)}</div></div>
  ${choice('father_id','טאטע')}${choice('mother_id','מאמע')}${choice('spouse_id','מאן / ווייב')}
  ${p.parent_id ? choice('parent_id','פריערדיגער עלטערן לינק (נאכנישט באשטימט טאטע / מאמע)') : '<input type="hidden" id="pparent_id" value="">'}
  ${p.spouse && !p.spouse_id ? `<p class="muted">פריערדיגער מאן / ווייב נאמען: ${esc(p.spouse)}. קלייב דעם מענטש אויבן צו פארבינדן.</p>` : ''}
  ${field('ייחוס',`<select id="plineage"><option value="">נישט באקאנט</option><option value="בן" ${p.lineage_term==='בן'?'selected':''}>בן</option><option value="בת" ${p.lineage_term==='בת'?'selected':''}>בת</option></select>`)}
  <fieldset><legend>משפחות (מען קען אויסקלייבן מער ווי איינס)</legend>${familyChoices(P).map(f=>`<label style="display:inline-flex;gap:6px;margin:6px"><input type="checkbox" name="person_family" value="${f.id}" ${(p.families || []).some(x=>x.id===f.id)?'checked':''}>${esc(f.name)}</label>`).join('')}
  ${field('צולייגן א נייע משפחה',`<input id="pnewfamily" maxlength="80" placeholder="משפחה נאמען">`)}</fieldset>
  ${field('ווער קען זען (צוטריט גרופע)',`<select id="pside">${sideOptions(p.side)}</select>`)}
  ${field('לעבנס סטאטוס',`<select id="plife"><option value="unknown" ${!p.life_status||p.life_status==='unknown'?'selected':''}>נישט באקאנט</option><option value="living" ${p.life_status==='living'?'selected':''}>לעבט</option><option value="deceased" ${p.life_status==='deceased'?'selected':''}>נפטר / נפטרת</option></select>`)}
  <details ${p.niftar?'open':''}><summary>אידישער פטירה דאטום (אויב באקאנט)</summary>
  <div class="grid g2"><div>${field('טאג פון פטירה',`<select id="pday"><option value="">— נישט באקאנט —</option>${Array.from({length:30},(_,i)=>`<option value="${i+1}" ${p.death_hday===i+1?'selected':''}>${hebD(i+1)}</option>`).join('')}</select>`)}</div>
  <div>${field('חודש פון פטירה',`<select id="pmonth"><option value="">— נישט באקאנט —</option>${HMONTHS.map(([k,t])=>`<option value="${k}" ${p.death_hmonth===k?'selected':''}>${t}</option>`).join('')}</select>`)}</div></div>
  ${field('יאר פון פטירה',`<input id="pyear" type="number" min="5001" max="5999" value="${esc(p.death_year||'')}">`)}
  <p class="muted">א באקאנטער טאג און חודש לייגן אויטאמאטיש צו דעם יארצייט.</p></details>
  ${field('נאטיץ',`<input id="pno" value="${esc(p.note)}">`)}
  <div class="err" id="ferr"></div><div class="btns"><button class="btn">סעיוו</button><button type="button" class="btn l" data-act="close">קענסל</button>
  ${id ? `<button type="button" class="btn l" data-act="addchild" data-id="${id}">+ קינד</button><button type="button" class="btn r" data-act="delp" data-id="${id}">🗑</button>` : ''}</div></form>`);
}

// learning
V.learn = async (arg) => {
  if (arg) return learnDetail(Number(arg));
  const { lists } = await api('/lists'); const L = lists.filter((l) => vis(l.side));
  return `<h1>📖 משניות און תהילים</h1><div class="cap">נעם א קאפיטל אדער א מסכתא לעילוי נשמת. דריק נאכאמאל צו צוריקגעבן.</div>${seg()}
  ${L.map((l) => `<a class="card" href="#learn/${l.id}" style="display:block;text-decoration:none;color:inherit;margin-bottom:10px"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:18px">${l.kind === 'tehillim' ? '📜 תהילים' : '📚 משניות'} · לעילוי נשמת ${esc(l.niftar)}</b>${sideTag(l.side)}</div>
  <div class="muted">${l.target_date ? `ביז ${gdate(l.target_date)} (${inDays(l.days)})` : 'קיין דאטום'}${l.mine ? ` · דו האסט ${l.mine}` : ''}</div>
  <div class="bar"><div style="width:${Math.round(100 * l.taken / l.total)}%"></div></div><div class="muted">${l.taken} פון ${l.total} גענומען · ${l.done} געענדיגט</div></a>`).join('') || empty('📖', 'נאך קיין ליסטס. מאך איינס פאר א יארצייט.')}
  <button class="btn" data-act="newlist" data-yz="0">+ נייע ליסט</button>`;
};
async function learnDetail(id) {
  const { list: l, items, masechtos } = await api('/lists/' + id); STATE.list = { l, items, masechtos };
  const taken = items.filter((i) => i.taken_by).length, done = items.filter((i) => i.done).length;
  const cls = (i) => (i.taken_by === ME.id ? (i.done ? 'pk done' : 'pk mine') : i.taken_by ? (i.done ? 'pk done' : 'pk t') : 'pk');
  const body = l.kind === 'tehillim'
    ? `<div class="perek">${items.map((i) => `<button class="${cls(i)}" data-act="item" data-idx="${i.idx}" title="${esc(i.taken_name || '')}">${heb(i.idx)}</button>`).join('')}</div>`
    : [...new Set(masechtos.map((m) => m.seder))].map((sd) => `<h2 style="font-size:17px">סדר ${sd}</h2><div class="ms">${items.filter((i) => masechtos[i.idx].seder === sd).map((i) => `<button class="${cls(i)}" data-act="item" data-idx="${i.idx}">${masechtos[i.idx].name}<small>${i.taken_by ? esc(i.taken_name || '') + (i.done ? ' ✓' : '') : 'פריי'}</small></button>`).join('')}</div>`).join('');
  return `<a href="#learn" class="muted">→ צוריק צו אלע ליסטס</a><h1>${l.kind === 'tehillim' ? '📜 תהילים' : '📚 משניות'} לעילוי נשמת ${esc(l.niftar)}</h1>
  <div class="cap">${l.target_date ? `ביז ${gdate(l.target_date)} (${inDays(l.days)})` : ''} ${sideTag(l.side)}</div>
  <div class="card" style="margin-bottom:12px"><div class="bar"><div style="width:${Math.round(100 * taken / items.length)}%"></div></div><div class="muted">${taken} פון ${items.length} גענומען</div>
  <div class="bar"><div class="dn" style="width:${Math.round(100 * done / items.length)}%"></div></div><div class="muted">${done} געענדיגט</div>
  <div class="muted" style="margin-top:6px"><span class="pk" style="padding:2px 8px">פריי</span> <span class="pk mine" style="padding:2px 8px">דיינס</span> <span class="pk t" style="padding:2px 8px">גענומען</span> <span class="pk done" style="padding:2px 8px">געענדיגט</span></div></div>
  <div class="card">${body}</div>
  ${ME.is_admin || l.created_by === ME.id ? `<button class="btn r s" style="margin-top:14px" data-act="dellist" data-id="${l.id}">🗑 מעק אויס די ליסט</button>` : ''}`;
}
function itemLabel(idx) { const { l, masechtos } = STATE.list; return l.kind === 'tehillim' ? 'קאפיטל ' + heb(idx) : 'מסכתא ' + masechtos[idx].name; }
async function onItem(idx) {
  const { l, items } = STATE.list; const it = items.find((i) => i.idx === idx);
  if (!it.taken_by) { await api(`/lists/${l.id}/items/${idx}`, { method: 'POST', body: { action: 'take' } }); toast('✓ דו האסט גענומען ' + itemLabel(idx)); return go(); }
  if (it.taken_by !== ME.id) {
    if (ME.is_admin) return modal(`<h2 style="margin-top:0">${itemLabel(idx)}</h2><p>${esc(it.taken_name)} האט דאס גענומען.</p><div class="btns"><button class="btn r" data-act="itemact" data-idx="${idx}" data-v="give">ארויסנעמען (אדמין)</button><button class="btn l" data-act="close">צומאכן</button></div>`);
    return toast(`${itemLabel(idx)} האט שוין ${it.taken_name}`);
  }
  modal(`<h2 style="margin-top:0">${itemLabel(idx)}</h2><p class="muted">דו האסט דאס גענומען.</p><div class="btns">
  ${it.done ? `<button class="btn l" data-act="itemact" data-idx="${idx}" data-v="undone">נאך נישט געענדיגט</button>` : `<button class="btn g" data-act="itemact" data-idx="${idx}" data-v="done">✓ איך האב געענדיגט</button>`}
  <button class="btn r" data-act="itemact" data-idx="${idx}" data-v="give">גיב צוריק</button><button class="btn l" data-act="close">צומאכן</button></div>`);
}
async function listForm(yzId) {
  let yzs = STATE.yzs; if (!yzs) yzs = STATE.yzs = (await api('/yahrzeits')).yahrzeits;
  modal(`<h2 style="margin-top:0">+ נייע ליסט</h2><form data-form="list">
  ${field('וואס', `<select id="lk"><option value="tehillim">📜 תהילים (150 קאפיטלעך)</option><option value="mishnayos">📚 משניות (אלע 63 מסכתות)</option></select>`)}
  ${field('פאר וועלכן יארצייט', `<select id="lyz"><option value="">— אנדערע (שרייב אונטן) —</option>${yzs.map((y) => `<option value="${y.id}" ${y.id === yzId ? 'selected' : ''}>${esc(y.name)} ${esc(y.father_name)} · ${esc(y.hebrew)}</option>`).join('')}</select>`)}
  ${field('לעילוי נשמת (אויב נישט אויבן)', '<input id="ln" placeholder="ר׳ … בן ר׳ … ז״ל">')}
  ${field('ביז ווען (ליידיג = ביזן יארצייט)', '<input id="ld" type="date">')}
  ${field('פאר וועמען', `<select id="ls">${sideOptions('', true)}</select>`)}
  <div class="err" id="ferr"></div><div class="btns"><button class="btn">מאך די ליסט</button><button type="button" class="btn l" data-act="close">קענסל</button></div></form>`);
  if (yzId) { const y = yzs.find((x) => x.id === yzId); if (y) $('ls').value = y.side === 'both' && !both() ? mySides()[0] : y.side; }
}

// simchas
V.sim = async () => {
  const past = STATE.simPast;
  const { simchas } = await api('/simchas' + (past ? '?past=1' : '')); STATE.sims = simchas;
  return `<h1>🎉 שמחות</h1><div class="cap">אינוויטעישנס פאר די משפחה. דריק "איך קום" און זאג וויפיל מענטשן.</div>
  <div class="btns" style="margin-bottom:12px"><button class="btn" data-act="editsim" data-id="0">+ נייע שמחה / אינוויטעישן</button><div class="seg" style="margin:0"><button class="${past ? '' : 'on'}" data-act="simpast" data-v="0">וואס קומט</button><button class="${past ? 'on' : ''}" data-act="simpast" data-v="1">פארביי</button></div></div>
  ${simchas.length ? `<div class="simgrid">${simchas.map(simCard).join('')}</div>` : empty('🎉', past ? 'נאך נישט קיין פארביי שמחות.' : 'נאך קיין שמחות. לייג צו די ערשטע!')}`;
};
function simCard(x) {
  const mine = ME.is_admin || x.created_by === ME.id;
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
  <div class="btns" style="margin-top:10px"><button class="btn s l" data-act="mazeltov" data-id="${x.id}">🎉 שיק א מזל טוב</button>${mine ? `<button class="btn s l" data-act="editsim" data-id="${x.id}">✏️ עדיט</button>` : ''}</div></div>`;
}
function simForm(id) {
  const x = (STATE.sims || []).find((s) => s.id === id) || { audience: 'all', whose: ME.name, kind: SIMKINDS[0] };
  const kinds = SIMKINDS.includes(x.kind) ? SIMKINDS : [x.kind, ...SIMKINDS];
  modal(`<h2 style="margin-top:0">${id ? '✏️ עדיט שמחה' : '+ נייע שמחה'}</h2><form data-form="sim" data-id="${id}">
  ${field('וואס', `<select id="sk">${kinds.map((k) => `<option ${x.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select>`)}
  <div id="skow" style="display:none">${field('וואס פאר א שמחה', '<input id="sko">')}</div>
  ${field('פון וועמען', `<input id="sw" value="${esc(x.whose)}">`)}
  <div class="grid g2"><div>${field('דאטום', `<input id="sd" type="date" value="${esc(x.gdate || '')}">`)}</div><div>${field('צייט', `<input id="stt" value="${esc(x.time_text || '')}" placeholder="למשל: 7:00 נאכמיטאג">`)}</div></div>
  ${field('אידישער דאטום (אויב ליידיג, רעכנט מען עס אויס)', `<input id="sh" value="${esc(x.hdate_text || '')}" placeholder="למשל: מוצאי שבת, י״ט כסלו">`)}
  ${field('ווו (נאמען פון זאל / הויז)', `<input id="sp" value="${esc(x.hall || '')}">`)}
  ${field('אדרעס (פאר GPS)', `<input id="sa" dir="auto" value="${esc(x.address || '')}" placeholder="51 Forest Rd, Monroe, NY">`)}
  ${field('נאטיץ', `<input id="sn" value="${esc(x.note || '')}">`)}
  ${id ? '' : field('אינוויטעישן (בילד אדער PDF)', '<input type="file" id="sf" accept="image/*,application/pdf">')}<div id="ip"></div>
  ${field('שיק צו', `<select id="ss">${sideOptions(x.audience, true, 'אלע קאזינס')}</select>`)}
  <div class="err" id="ferr"></div><div class="btns"><button class="btn" id="simsave">${id ? 'סעיוו' : 'שיק אינוויטעישן'}</button><button type="button" class="btn l" data-act="close">קענסל</button>
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
  const rooms = ['all', ...mySides()]; if (!rooms.includes(STATE.room)) STATE.room = 'all';
  const { messages } = await api('/chat/' + STATE.room); LASTMSG = messages.length ? messages[messages.length - 1].id : 0;
  markSeen(STATE.room, LASTMSG);
  setTimeout(() => { checkUnread(); const c = $('cb'); if (c) c.scrollTop = c.scrollHeight; startChatPoll(); }, 0);
  return `<h1>💬 טשעט</h1><div class="cap">רעד מיט די קאזינס. יעדע סייד האט א גרופע, און איין גרופע פאר אלעמען.</div>
  <div class="seg">${rooms.map((k) => `<button class="${STATE.room === k ? 'on' : ''}" data-act="room" data-v="${k}">${k === 'all' ? '👨‍👩‍👧 אלע קאזינס' : esc(famOf(k) || sideName(k))}</button>`).join('')}</div>
  <div class="card"><div class="chat" id="cb">${messages.length ? renderMsgs(messages) : '<div class="muted" id="cempty" style="text-align:center;margin:auto">נאך קיין מעסעדזשעס. זאג גוט מארגן! 👋</div>'}</div>
  <form data-form="chat" style="display:flex;gap:8px;margin-top:10px"><input id="ci" placeholder="שרייב א מעסעדזש…" style="margin:0" autocomplete="off" enterkeyhint="send"><button class="btn">שיק</button></form></div>`;
};
let LASTDAY = '';
function renderMsgs(ms, cont) {
  if (!cont) LASTDAY = '';
  return ms.map((m) => { const k = dayKey(m.created_at); const sep = k !== LASTDAY ? `<div class="daysep">${dayLabel(m.created_at)}</div>` : ''; LASTDAY = k;
    return `${sep}<div class="bub ${m.user_id === ME.id ? 'me' : ''}" data-mid="${m.id}"><span class="muted">${m.user_id === ME.id ? 'דו' : esc(m.name)} · ${hm(m.created_at)}</span>${esc(m.body)}</div>`; }).join('');
}
function startChatPoll() {
  stopPoll();
  POLL = setInterval(async () => {
    if (curView() !== 'chat' || document.hidden) return;
    try { const { messages } = await api(`/chat/${STATE.room}?after=${LASTMSG}`); if (messages.length) appendMsgs(messages); } catch { /* keep polling */ }
  }, 3000);
}
function appendMsgs(ms) {
  const c = $('cb'); if (!c) return; ms = ms.filter((m) => !c.querySelector(`[data-mid="${m.id}"]`)); if (!ms.length) return;
  const nearBottom = c.scrollHeight - c.scrollTop - c.clientHeight < 120;
  $('cempty')?.remove(); c.insertAdjacentHTML('beforeend', renderMsgs(ms, true)); LASTMSG = Math.max(LASTMSG, ms[ms.length - 1].id); markSeen(STATE.room, LASTMSG);
  if (nearBottom) c.scrollTop = c.scrollHeight;
}
function stopPoll() { if (POLL) clearInterval(POLL); POLL = null; }
function markSeen(room, id) { if (id && (SEEN[room] || 0) < id) { SEEN[room] = id; localStorage.setItem('fam_seen', JSON.stringify(SEEN)); } }
async function checkUnread() {
  if (!ME || ME.status !== 'active') return;
  try { const { rooms } = await api('/chat-summary'); const u = rooms.some((r) => r.last_id && r.last_id > (SEEN[r.room] || 0) && !(curView() === 'chat' && STATE.room === r.room));
    if (u !== UNREAD) { UNREAD = u; renderNav(curView()); } } catch { /* */ }
}

// directory
V.people = async () => {
  const { families } = await api('/directory'); STATE.dir = families;
  const Q = STATE.q.trim(); const L = families.filter((d) => vis(d.side) && (!Q || [d.husband, d.wife, d.address, d.parents, d.phone_h, d.phone_w].join(' ').includes(Q)));
  const hasMine = families.some((d) => d.owner_id === ME.id);
  return `<h1>👥 קאזינס · אדרעסן און טעלעפאנען</h1><div class="cap">יעדער קאזין מיט מאן און ווייב, אדרעס און טעלעפאן. יעדער קען עדיטן זיינע אייגענע פרטים.</div>${seg()}
  ${hasMine ? '' : `<div class="row" style="background:#eef2ff;border-color:#c7d2fe"><div class="grow"><b>לייג צו דיין משפחה</b><div class="muted">אז די קאזינס זאלן האבן דיין אדרעס און טעלעפאן</div></div><button class="btn s" data-act="editdir" data-id="0" data-mine="1">+ מיין משפחה</button></div>`}
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px"><input id="q" type="search" placeholder="🔍 סוירטש נאמען, שטאט, טעלעפאן…" value="${esc(STATE.q)}" style="margin:0;max-width:340px" data-input="q"><span class="muted" id="qn">${L.length} משפחות</span>
  <a class="btn s l" href="/api/directory.csv" download>⬇ דאונלאוד ליסט (Excel)</a><button class="btn s" data-act="editdir" data-id="0">+ לייג צו</button></div>
  <div class="grid g2" id="dirlist">${dirCards(L)}</div>
  <a class="btn" style="margin-top:14px" href="${inviteLink()}" target="_blank" rel="noopener">📲 אינווייט א קאזין</a>`;
};
function dirCards(L) {
  return L.map((d) => `<div class="card" style="padding:14px"><div style="display:flex;gap:10px;align-items:flex-start"><div class="av">${esc((d.husband || d.wife)[0])}</div><div class="grow"><b style="font-size:18px">${esc(d.husband)}${d.husband && d.wife ? ' · ' : ''}${esc(d.wife)}</b><div class="muted">${esc(d.parents)}</div></div>${sideTag(d.side)}</div>
  <div style="margin-top:10px;display:grid;gap:6px"><div>📍 <span dir="auto">${esc(d.address) || '—'}</span></div><div style="display:flex;gap:14px;flex-wrap:wrap">${d.husband ? `<span><span class="muted">מאן:</span> ${tel(d.phone_h)}</span>` : ''}${d.wife ? `<span><span class="muted">ווייב:</span> ${tel(d.phone_w)}</span>` : ''}</div></div>
  <div class="btns" style="margin-top:10px">${ME.is_admin || d.owner_id === ME.id || d.created_by === ME.id ? `<button class="btn s l" data-act="editdir" data-id="${d.id}">✏️ עדיט</button>` : ''}${navBtns(d.address)}</div></div>`).join('') || '<div class="muted">גארנישט געטראפן</div>';
}
async function dirForm(id, mine) {
  const {people}=await api('/people');
  const d = (STATE.dir || []).find((x) => x.id === id) || { side: mySides()[0], husband: mine ? ME.name : '' };
  modal(`<h2 style="margin-top:0">${id ? '✏️ עדיט' : mine ? '+ מיין משפחה' : '+ לייג צו א משפחה'}</h2><form data-form="dir" data-id="${id}" data-mine="${mine ? 1 : 0}">
  <p class="muted">קלייב באזונדערע מענטשן פון פעמילי טרי. זייערע עלטערן און פרטים ווערן גענוצט אין ביידע ערטער.</p>
  ${field('מאן — מענטש אין בוים',`<select id="dhperson"><option value="">— נאכנישט פארבונדן —</option>${people.map(p=>`<option value="${p.id}" ${d.husband_person_id===p.id?'selected':''}>${esc([p.title,p.name].filter(Boolean).join(' '))}</option>`).join('')}</select>`)}
  ${field('ווייב — מענטש אין בוים',`<select id="dwperson"><option value="">— נאכנישט פארבונדן —</option>${people.map(p=>`<option value="${p.id}" ${d.wife_person_id===p.id?'selected':''}>${esc([p.title,p.name].filter(Boolean).join(' '))}</option>`).join('')}</select>`)}
  <a href="#tree">🌳 לייג צו / עדיט א מענטש אין פעמילי טרי</a>
  <details><summary>פריערדיגע פרטים (ביז מען פארבינדט מענטשן)</summary>
  ${field('מאן', `<input id="dh" value="${esc(d.husband)}">`)}${field('ווייב', `<input id="dw" value="${esc(d.wife)}">`)}
  ${field('וועמענס קינד', `<input id="dp" value="${esc(d.parents)}" placeholder="למשל: זון פון ר׳ משה באכנער">`)}
  </details>
  ${field('סייד', `<select id="ds">${sideOptions(d.side)}</select>`)}
  <h3>אדרעס</h3>${field('גאס און הויז נומער', `<input id="da" dir="auto" autocomplete="address-line1" value="${esc(d.address_line1 ?? d.address)}" placeholder="12 Main St">`)}
  ${field('דירה / אפארטמענט', `<input id="da2" dir="auto" autocomplete="address-line2" value="${esc(d.address_line2)}" placeholder="Apt 2B">`)}
  <div class="grid g2"><div>${field('שטאט', `<input id="dcity" dir="auto" autocomplete="address-level2" value="${esc(d.city)}">`)}</div><div>${field('סטעיט / פראווינץ', `<input id="dstate" dir="auto" autocomplete="address-level1" value="${esc(d.state)}">`)}</div></div>
  <div class="grid g2"><div>${field('זיפ / פאסט קאוד', `<input id="dzip" class="ltr" autocomplete="postal-code" value="${esc(d.postal_code)}">`)}</div><div>${field('לאנד', `<input id="dcountry" dir="auto" autocomplete="country-name" value="${esc(d.country)}">`)}</div></div>
  <div class="grid g2"><div>${field('טעלעפאן מאן', `<input id="dph" type="tel" class="ltr" value="${esc(d.phone_h)}">`)}</div><div>${field('טעלעפאן ווייב', `<input id="dpw" type="tel" class="ltr" value="${esc(d.phone_w)}">`)}</div></div>
  <div class="err" id="ferr"></div><div class="btns"><button class="btn">סעיוו</button><button type="button" class="btn l" data-act="close">קענסל</button>${id ? `<button type="button" class="btn r" style="margin-right:auto" data-act="deldir" data-id="${id}">🗑</button>` : ''}</div></form>`);
}

// admin
V.admin = async () => {
  if (!ME.is_admin) return '<div class="muted">נאר פאר אדמין</div>';
  const { users, owner_phone } = await api('/admin/users'); STATE.users = users; PENDING = users.filter((u) => u.status === 'pending').length;
  const pend = users.filter((u) => u.status === 'pending'), rest = users.filter((u) => u.status !== 'pending'), resets = users.filter((u) => u.reset_requested_at);
  const sidesBox = (u) => ['a', 'b'].map((c) => `<label style="display:inline-flex;align-items:center;font-weight:600;margin-left:10px"><input type="checkbox" data-change="usides" data-id="${u.id}" data-v="${c}" ${u.sides.includes(c) ? 'checked' : ''}>${esc(famOf(c) || sideName(c))}</label>`).join('');
  return `<h1>🛡️ אדמין</h1><div class="cap">אפרובירן נייע קאזינס, טוישן סייד, מאכן אנדערע אדמין.</div>
  <h2>🔑 פאסווארט בקשות (${resets.length})</h2><p class="muted">באשטעטיג ווער דער מענטש איז איידער דו שיקסט א לינק. דער לינק איז איינמאליג און גוט פאר איין שעה.</p>
  ${resets.map(u => `<div class="row"><div class="grow"><b>${esc(u.name)}</b> <span dir="ltr">+${esc(u.phone)}</span><div class="muted">${esc(new Date(u.reset_requested_at).toLocaleString())}</div></div><button class="btn s" data-act="resetlink" data-id="${u.id}">🔑 מאך א לינק</button></div>`).join('') || '<div class="muted">נאך קיין בקשות.</div>'}
  <h2>⏳ ווארטן אויף אפרוביישן (${pend.length})</h2>${pend.map((u) => `<div class="row" style="flex-wrap:wrap"><div class="grow"><b>${esc(u.name)}</b> <span class="muted" dir="ltr">+${esc(u.phone)}</span><div class="muted">${u.sides.map((c) => esc(famOf(c) || sideName(c))).join(' + ')}${u.note ? ' · ' + esc(u.note) : ''}</div></div>
   <div class="btns"><button class="btn s g" data-act="approve" data-id="${u.id}">✓ אפרובירן</button><button class="btn s r" data-act="reject" data-id="${u.id}">✗ אפזאגן</button></div></div>`).join('') || '<div class="muted">קיינער ווארט נישט.</div>'}
  <h2>👥 אלע מעמבערס (${rest.length})</h2><table class="t resp"><thead><tr><th>נאמען</th><th>טעלעפאן</th><th>סייד</th><th>סטאטוס</th><th></th></tr></thead><tbody>
  ${rest.map((u) => `<tr><td><b>${esc(u.name)}</b>${u.is_admin ? ' <span class="tag y">אדמין</span>' : ''}${u.has_password ? '' : ' <span class="tag">נאך קיין פאסווארט</span>'}</td><td dir="ltr" style="text-align:right">+${esc(u.phone)}</td><td>${sidesBox(u)}</td>
   <td>${u.status === 'active' ? '<span class="tag g">אקטיוו</span>' : '<span class="tag b">אפגעזאגט</span>'}</td>
   <td><div class="btns">${u.status !== 'active' ? `<button class="btn s g" data-act="approve" data-id="${u.id}">אפרובירן</button>` : ''}
   ${u.id !== ME.id && u.phone !== owner_phone ? `<button class="btn s l" data-act="mkadmin" data-id="${u.id}" data-v="${u.is_admin ? 0 : 1}">${u.is_admin ? 'נעם אוועק אדמין' : 'מאך אדמין'}</button>` : ''}
   <button class="btn s l" data-act="resetlink" data-id="${u.id}">🔑 פאסווארט לינק</button>${u.id !== ME.id && u.phone !== owner_phone ? `<button class="btn s r" data-act="deluser" data-id="${u.id}">🗑</button>` : ''}</div></td></tr>`).join('')}</tbody></table>
  <h2>⚙️ משפחה נעמען</h2><form data-form="settings" class="card">
  ${field('נאמען פון דער אפ (אידיש)', `<input id="st_family_yi" value="${esc(S.family_yi)}">`)}${field('Name (English)', `<input id="st_family_en" class="ltr" value="${esc(S.family_en)}">`)}
  <div class="grid g2"><div>${field('סייד א (אידיש)', `<input id="st_side_a_yi" value="${esc(S.side_a_yi)}">`)}${field('משפחה נאמען', `<input id="st_side_a_family_yi" value="${esc(S.side_a_family_yi)}">`)}${field('Side A (English)', `<input id="st_side_a_en" class="ltr" value="${esc(S.side_a_en)}">`)}${field('Family name (English)', `<input id="st_side_a_family_en" class="ltr" value="${esc(S.side_a_family_en)}">`)}</div>
  <div>${field('סייד ב (אידיש)', `<input id="st_side_b_yi" value="${esc(S.side_b_yi)}">`)}${field('משפחה נאמען', `<input id="st_side_b_family_yi" value="${esc(S.side_b_family_yi)}">`)}${field('Side B (English)', `<input id="st_side_b_en" class="ltr" value="${esc(S.side_b_en)}">`)}${field('Family name (English)', `<input id="st_side_b_family_en" class="ltr" value="${esc(S.side_b_family_en)}">`)}</div></div>
  <div class="err" id="ferr"></div><button class="btn">סעיוו</button></form>`;
};
V.me = async () => `<h1>👤 מיין אקאונט</h1><div class="cap">${both() ? 'ביידע סיידס' : esc(sideLong(ME.sides[0]))}${ME.is_admin ? ' · אדמין' : ''} · <span dir="ltr">+${esc(ME.phone)}</span></div>
  <form data-form="me" class="card" style="margin-bottom:14px">${field('נאמען', `<input id="mn" value="${esc(ME.name)}">`)}${field('אימעיל (נישט מוז)', `<input id="mem" type="email" class="ltr" value="${esc(ME.email || '')}">`)}<div class="err" id="ferr"></div><button class="btn">סעיוו</button></form>
  <section class="card" style="margin-bottom:14px"><h2>אימעיל פאר פאסווארט הילף</h2>${ME.email_verified ? '<p role="status">✓ דיין אימעיל איז באשטעטיגט. דו קענסט באקומען א פאסווארט לינק אויף אימעיל.</p>' : !EMAIL_READY ? '<p class="muted">אימעיל איז נאך נישט פארבונדן. דער אדמין קען דערווייל העלפן מיט א פאסווארט לינק.</p>' : !ME.email ? '<p class="muted">סעיוו קודם דיין אימעיל אדרעס אויבן, און באשטעטיג עס דא.</p>' : `<p class="muted">באשטעטיג דיין געסעיווטן אימעיל: <span dir="ltr">${esc(ME.email)}</span></p><form data-form="emailverifyrequest">${field('פאסווארט פאר אימעיל באשטעטיגונג', '<input id="emailverifypw" type="password" autocomplete="current-password" required>')}<div class="err" role="alert"></div><div id="emailverifystatus" role="status"></div><button class="btn">שיק א באשטעטיגונג אימעיל</button></form>`}</section>
  <form data-form="myphone" class="card" style="margin-bottom:14px"><h2>טויש טעלעפאן נומער</h2><p class="muted">דאס איז דער נומער צו לאג אין. פאר אן אויסלענדישן נומער, לייג צו דעם לאנד קאוד.</p>${field('טעלעפאן נומער', `<input id="mphone" type="tel" class="ltr" autocomplete="tel" value="+${esc(ME.phone)}" required>`)}${field('יעצטיגע פאסווארט', '<input id="mphonepw" type="password" autocomplete="current-password" required>')}<div class="err" id="phoneerr"></div><button class="btn">סעיוו טעלעפאן נומער</button></form>
  <form data-form="mypw" class="card">${field('אלטע פאסווארט', '<input id="mo" type="password" autocomplete="current-password">')}${field('נייע פאסווארט', '<input id="mp" type="password" autocomplete="new-password" placeholder="כאטש 6 אותיות">')}<div class="err" id="ferr2"></div><button class="btn">טויש פאסווארט</button></form>
  <div class="muted" style="margin-top:12px">צו טוישן דיין סייד, רעד מיט דעם אדמין.</div><button class="btn l" style="margin-top:14px" data-act="logout">↩ לאג אאוט</button>`;

// ---------- router ----------
const curView = () => ((location.hash || '#').slice(1).split('/')[0] || 'home');
let RENDER = 0;
async function go() {
  const h = (location.hash || '').slice(1);
  if (h.startsWith('verifyemail=')) { stopPoll(); clearChrome(); STATE.verifyEmailToken = h.slice(12); $('m').innerHTML = V.verifyemail(); return; }
  if (h === 'emailverified') { stopPoll(); clearChrome(); $('m').innerHTML = `<div class="login"><h1>✓ אימעיל באשטעטיגט</h1><p>דו קענסט יעצט באקומען א פאסווארט לינק אויף דיין אימעיל.</p><a class="btn" href="${ME ? '#me' : '#home'}">${ME ? 'מיין אקאונט' : 'לאג אין'}</a></div>`; return; }
  if (h.startsWith('setpw=')) { stopPoll(); clearChrome(); const token = STATE.setpwToken = h.slice(6); $('m').innerHTML = V.setpw(); api('/auth/token/' + encodeURIComponent(token)).then((r) => { if (location.hash !== '#setpw=' + token) return; $('spn').textContent = 'שלום ' + r.name + '!'; $('setpwsubmit').disabled = false; }).catch((e) => { if (location.hash !== '#setpw=' + token) return; $('spn').textContent = ''; $('ferr').textContent = e.message; }); return; }
  if (h === 'forgotpw') { stopPoll(); clearChrome(); $('m').innerHTML = V.forgotpw(); return; }
  if (!ME) { stopPoll(); clearChrome(); $('m').innerHTML = V.login(); return; }
  if (ME.status !== 'active') { stopPoll(); clearChrome(); $('m').innerHTML = V.pending(); return; }
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
async function loadMe() { const r = await api('/me'); ME = r.user; EMAIL_READY = !!r.email_enabled; S = r.settings || {}; document.title = S.family_yi || 'משפחה'; }

// ---------- actions ----------
const ACT = {
  forgotpw: () => { STATE.resetPhone = val('fp'); STATE.resetRequested = false; location.hash = '#forgotpw'; },
  backlogin: () => { STATE.authMode = 'login'; STATE.resetRequested = false; history.replaceState(null, '', location.pathname + location.search); go(); },
  close: closeModal, more: moreSheet, reload: () => go(),
  logout: async () => { closeModal(); await api('/auth/logout', { method: 'POST' }).catch(() => {}); ME = null; location.hash = ''; go(); },
  recheck: async () => { await loadMe(); go(); if (ME && ME.status !== 'active') toast('נאך נישט אפרובירט'); },
  authmode: (el) => { STATE.authMode = el.dataset.v; go(); },
  pick: (el) => { STATE.pickSides = el.dataset.v === 'ab' ? ['a', 'b'] : [el.dataset.v]; const keep = { fn: val('fn'), fp: val('fp'), fw: $('fw').value, fnote: val('fnote') }; $('m').innerHTML = V.login(); for (const k in keep) if ($(k)) $(k).value = keep[k]; },
  side: (el) => { STATE.side = el.dataset.v; refresh(); },
  treezoom: (el) => { STATE.treeZoom=el.dataset.v==='fit'?null:el.dataset.v==='actual'?1:Math.max(0.2,Math.min(2,(STATE.treeScale||1)+Number(el.dataset.v))); updateFamilyViewport(); },
  treeside: (el) => { STATE.treeSide = el.dataset.v; STATE.treeZoom=null; refresh(); }, treeview: (el) => { STATE.treeView = el.dataset.v; refresh(); },
  room: (el) => { STATE.room = el.dataset.v; go(); },
  simpast: (el) => { STATE.simPast = el.dataset.v === '1'; go(); },
  remind: async (el) => { const on = el.dataset.on === '1'; await api(`/yahrzeits/${el.dataset.id}/remind`, { method: 'POST', body: { on } }); toast(on ? '🔔 מען וועט דיך דערמאנען' : 'אפגעשטעלט'); refresh(); },
  edityz: (el) => yzForm(Number(el.dataset.id)),
  delyz: async (el) => { if (!confirm('אויסמעקן דעם יארצייט?')) return; await api('/yahrzeits/' + el.dataset.id, { method: 'DELETE' }); closeModal(); toast('אויסגעמעקט'); refresh(); },
  editp: (el) => personForm(Number(el.dataset.id)),
  addchild: (el) => personForm(0, Number(el.dataset.id)),
  delp: async (el) => { if (!confirm('אויסמעקן?')) return; await api('/people/' + el.dataset.id, { method: 'DELETE' }); closeModal(); toast('אויסגעמעקט'); refresh(); },
  newlist: (el) => listForm(Number(el.dataset.yz) || 0),
  item: (el) => onItem(Number(el.dataset.idx)),
  itemact: async (el) => { const { l } = STATE.list; const a = el.dataset.v; await api(`/lists/${l.id}/items/${el.dataset.idx}`, { method: 'POST', body: { action: a } }); closeModal(); toast(a === 'give' ? 'צוריקגעגעבן' : a === 'done' ? '✓ יישר כח!' : 'געטוישט'); refresh(); },
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
  upinv: async (el) => { const f = el.files[0]; if (!f) return; if (f.size > 10 * 1024 * 1024) return toast('⚠️ די פייל איז צו גרויס (מאקסימום 10 MB)'); toast('⬆ אפלאודינג…');
    const fd = new FormData(); fd.append('file', f); await api(`/simchas/${el.dataset.id}/invite`, { method: 'POST', body: fd }); toast('✓ אינוויטעישן אפלאודעד'); refresh(); },
  usides: async (el) => { const u = STATE.users.find((x) => x.id === Number(el.dataset.id)); const s = new Set(u.sides); el.checked ? s.add(el.dataset.v) : s.delete(el.dataset.v);
    try { await api('/admin/users/' + u.id, { method: 'PATCH', body: { sides: [...s] } }); toast('✓ סייד געטוישט'); } catch (e) { el.checked = !el.checked; throw e; } refresh(); },
};
const FORMS = {
  forgotpw: async () => { await api('/auth/forgot-password', { method: 'POST', body: { phone: val('resetphone') } }); STATE.resetRequested = true; go(); },
  login: async () => { const r = await api('/auth/login', { method: 'POST', body: { phone: val('fp'), password: $('fw').value } }); ME = r.user; await loadMe(); toast('ברוך הבא! ✓'); location.hash = '#home'; go(); },
  signup: async () => { const r = await api('/auth/signup', { method: 'POST', body: { name: val('fn'), phone: val('fp'), password: $('fw').value, sides: STATE.pickSides || [], note: val('fnote') } }); ME = r.user; await loadMe(); go(); },
  setpw: async () => { if ($('sp1').value !== $('sp2').value) throw new Error('די צוויי פאסווארטס זענען נישט די זעלבע'); await api('/auth/set-password', { method: 'POST', body: { token: STATE.setpwToken, password: $('sp1').value } }); STATE.setpwToken = null; history.replaceState(null, '', location.pathname + location.search + '#home'); await loadMe(); toast('✓ פאסווארט איינגעשטעלט'); go(); },
  yz: async (f) => { const id = Number(f.dataset.id); const b = { name: val('yn'), father_name: val('yf'), relation: val('yr'), hday: Number(val('yd')), hmonth: val('ym'), death_year: val('yy'), side: val('ys'), kever: val('yk'), note: val('yo') };
    await api(id ? '/yahrzeits/' + id : '/yahrzeits', { method: id ? 'PUT' : 'POST', body: b }); closeModal(); toast('✓ געסעיווט'); refresh(); },
  person: async (f) => { const id = Number(f.dataset.id); const b = {family_ids:[...f.querySelectorAll('[name=person_family]:checked')].map(el=>Number(el.value)),new_family:val('pnewfamily'),lineage_term:val('plineage'),name:val('pn'),title:val('ptitle'),father_id:val('pfather_id'),mother_id:val('pmother_id'),spouse_id:val('pspouse_id'),parent_id:val('pparent_id'),side:val('pside'),life_status:val('plife'),death_hday:val('pday'),death_hmonth:val('pmonth'),death_year:val('pyear'),note:val('pno')};
    await api(id ? '/people/' + id : '/people', { method: id ? 'PUT' : 'POST', body: b }); closeModal(); toast('✓ ' + b.name + ' געסעיווט'); refresh(); },
  list: async () => { const r = await api('/lists', { method: 'POST', body: { kind: val('lk'), yahrzeit_id: val('lyz') || null, niftar: val('ln'), target_date: val('ld'), side: val('ls') } }); closeModal(); toast('✓ ליסט געמאכט'); location.hash = '#learn/' + r.list.id; },
  sim: async (f) => { const id = Number(f.dataset.id); const kind = val('sk') === 'אנדערע' ? (val('sko') || 'שמחה') : val('sk');
    const b = { kind, whose: val('sw'), gdate: val('sd'), time_text: val('stt'), hdate_text: val('sh'), hall: val('sp'), address: val('sa'), note: val('sn'), audience: val('ss') };
    const file = $('sf') && $('sf').files[0]; if (file && file.size > 10 * 1024 * 1024) throw new Error('די פייל איז צו גרויס (מאקסימום 10 MB)');
    $('simsave').disabled = true;
    try { const r = await api(id ? '/simchas/' + id : '/simchas', { method: id ? 'PUT' : 'POST', body: b });
      if (file) { const fd = new FormData(); fd.append('file', file); try { await api(`/simchas/${r.simcha.id}/invite`, { method: 'POST', body: fd }); } catch (e) { toast('⚠️ די שמחה איז געסעיווט, אבער די אינוויטעישן נישט: ' + e.message); closeModal(); return refresh(); } }
      closeModal(); toast(id ? '✓ געסעיווט' : '✓ אינוויטעישן געשיקט צו ' + sideName(b.audience)); STATE.simPast = false; if (curView() === 'sim') refresh(); else location.hash = '#sim'; }
    finally { if ($('simsave')) $('simsave').disabled = false; } },
  chat: async () => { const e = $('ci'), t = e.value.trim(); if (!t) return; e.value = ''; try { await api('/chat/' + STATE.room, { method: 'POST', body: { body: t } }); const { messages } = await api(`/chat/${STATE.room}?after=${LASTMSG}`); appendMsgs(messages); const c = $('cb'); c.scrollTop = c.scrollHeight; } catch (er) { e.value = t; throw er; } e.focus(); },
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
  const el = ev.target; if (el.dataset.input !== 'q') return; STATE.q = el.value;
  const Q = STATE.q.trim(); const L = (STATE.dir || []).filter((d) => vis(d.side) && (!Q || [d.husband, d.wife, d.address, d.parents, d.phone_h, d.phone_w].join(' ').includes(Q)));
  $('dirlist').innerHTML = dirCards(L); $('qn').textContent = L.length + ' משפחות';
});
document.addEventListener('submit', async (ev) => {
  const f = ev.target.closest('[data-form]'); if (!f) return; ev.preventDefault();
  const err = f.querySelector('.err'); if (err) err.textContent = '';
  const btn = f.querySelector('button:not([type=button])'); if (btn) btn.disabled = true;
  try { await FORMS[f.dataset.form](f); } catch (e) { if (e.status === 401 && f.dataset.form !== 'login') return fail(e); if (err) err.textContent = e.message; else fail(e); }
  finally { if (btn && document.body.contains(btn)) btn.disabled = false; }
});
document.addEventListener('change', (ev) => { if(ev.target.dataset.change==='familyfilter') { STATE[ev.target.dataset.key]=ev.target.value; refresh(); } if (ev.target.id === 'sk') $('skow').style.display = ev.target.value === 'אנדערע' ? '' : 'none';
  if (ev.target.id === 'sf') { const f = ev.target.files[0]; $('ip').innerHTML = !f ? '' : f.type === 'application/pdf' ? `<div class="muted" style="margin:-4px 0 12px">📄 ${esc(f.name)}</div>` : `<img src="${URL.createObjectURL(f)}" style="max-width:100%;max-height:200px;border-radius:8px;margin:-4px 0 12px">`; } });
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeModal(); });
window.addEventListener('hashchange', () => { closeModal(); go(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && ME) checkUnread(); });
setInterval(checkUnread, 20000);
(async () => { try { await loadMe(); } catch (e) { $('m').innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`; return; } go(); checkUnread(); })();

