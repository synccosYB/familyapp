'use strict';
import { word, htmlWord, applyWording } from './wording.js';
import { familyUnits, treeViewportLayout } from './tree-layout.js';
import { marriageChildren, childParents, relationshipPath } from './family-relationships.js';
import { automaticHebrewDate } from './hebrew-date.js';
import { isDeceased, personName, withMemorialSuffix, yahrzeitName } from './person-names.js';
// Familye client: one file, no framework. All server data is members-only; nothing secret lives here.
const $ = (id) => document.getElementById(id);
const relationName = (peopleById, person, relation, title = false) => {
  const relative = peopleById.get(person[relation + '_id']);
  const name = [title && person[relation + '_title'], person[relation + '_name']].filter(Boolean).join(' ');
  return relative ? personName(relative, name || relative.name) : name;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let ME = null, EMAIL_READY = false, S = {}, STATE = { side: 'all', room: 'all', q: '', treeView: window.innerWidth < 800 ? 'list' : 'tree', treeSide: null };
let POLL = null, LASTMSG = 0, SEEN = JSON.parse(localStorage.getItem('fam_seen') || '{}');
let wordingRevision = -1, wordingLoading = false, wordingNeedsRender = false, editingMainForm = false;

async function loadWording() {
  if (wordingLoading) return;
  wordingLoading = true;
  try {
    const response = await fetch('/api/wording?revision=' + wordingRevision, { signal: AbortSignal.timeout(3500) });
    if (!response.ok) return;
    const snapshot = await response.json();
    if (Number.isSafeInteger(snapshot.revision) && snapshot.revision > wordingRevision && snapshot.overrides) {
      applyWording(snapshot.overrides);
      wordingRevision = snapshot.revision;
      wordingNeedsRender = true;
      document.title = appName();
      if ($('loading')) $('loading').textContent = word("shared.loading");
    }
  } catch { /* Keep the last available wording if the connection drops. */ }
  finally { wordingLoading = false; }
}

async function checkWording() {
  if (document.hidden) return;
  await loadWording();
  // A change can wait while someone is editing a form or using a dialog.
  if (wordingNeedsRender && !editingMainForm && !$('md').classList.contains('on') &&
    !document.activeElement?.matches('input, textarea, select')) await refresh();
}

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
  if (opts.image && r.ok) return r.blob();
  let j = {}; try { j = await r.json(); } catch { /* */ }
  if (!r.ok) { const e = new Error(j.error || `${word("shared.api.01")} ` + r.status); e.status = r.status; e.details=j.details; throw e; }
  return j;
}
const fail = (e) => { if (e && e.status === 401) { ME = null; go(); } toast('⚠️ ' + (e.message || e)); };

// ---------- words ----------
const dayWords = ["calendar.01", "calendar.02", "calendar.03", "calendar.04", "calendar.05", "calendar.06", "calendar.07"];
const monthWords = ["calendar.08", "calendar.09", "calendar.10", "calendar.11", "calendar.12", "calendar.13", "calendar.14", "calendar.15", "calendar.16", "calendar.17", "calendar.18", "calendar.19"];
const HMONTHS = [["TISHREI","calendar.hebrew_month.tishrei"],["CHESHVAN","calendar.hebrew_month.cheshvan"],["KISLEV","calendar.hebrew_month.kislev"],["TEVET","calendar.hebrew_month.tevet"],["SHVAT","calendar.hebrew_month.shvat"],["ADAR","calendar.hebrew_month.adar"],["ADAR_I","calendar.hebrew_month.adar_i"],["ADAR_II","calendar.hebrew_month.adar_ii"],["NISAN","calendar.hebrew_month.nisan"],["IYYAR","calendar.hebrew_month.iyyar"],["SIVAN","calendar.hebrew_month.sivan"],["TAMUZ","calendar.hebrew_month.tamuz"],["AV","calendar.hebrew_month.av"],["ELUL","calendar.hebrew_month.elul"]];
function hebrewMonthLabel(code) {
  const month = HMONTHS.find(([value]) => value === code);
  return month ? word(month[1]) : '';
}
const SIMKINDS = ["חתונה","בר מצוה","בת מצוה","שלום זכר","ברית","קידוש","אופשערן","תנאים","ווארט","פדיון הבן","סיום","אנדערע"];
const simchaWordKeys = new Map([["חתונה","simchas.kind.wedding"],["בר מצוה","simchas.kind.bar_mitzvah"],["בת מצוה","simchas.kind.bat_mitzvah"],["שלום זכר","simchas.kind.shalom_zachar"],["ברית","simchas.kind.bris"],["קידוש","simchas.kind.kiddush"],["אופשערן","simchas.kind.upsherin"],["תנאים","simchas.kind.tenaim"],["ווארט","simchas.kind.vort"],["פדיון הבן","simchas.kind.pidyon_haben"],["סיום","simchas.kind.siyum"],["אנדערע","simchas.kind.other"],["שמחה","simchas.kind.simcha"]]);
const simchaKind = value => simchaWordKeys.has(value) ? word(simchaWordKeys.get(value)) : value;
function gdate(ymd) { if (!ymd) return ''; const [y, m, d] = ymd.split('-').map(Number); const dt = new Date(y, m - 1, d); return monthWords[m - 1] && Number.isFinite(dt.valueOf()) ? `${word(dayWords[dt.getDay()])}, ${d} ${word(monthWords[m - 1])} ${y}` : ''; }
function inDays(n) { return n === 0 ? word("calendar.in_days.01") : n === 1 ? word("calendar.in_days.02") : n < 0 ? word("calendar.in_days.03", { value: -n }) : word("calendar.in_days.04", { count: n }); }
function heb(n) { const o = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'], t = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ']; let s = ''; if (n >= 100) { s += 'ק'; n -= 100; } if (n === 15) s += 'טו'; else if (n === 16) s += 'טז'; else s += t[Math.floor(n / 10)] + o[n % 10]; return s; }
const hebD = (n) => { const s = heb(n); return s.length > 1 ? s.slice(0, -1) + '״' + s.slice(-1) : s + '׳'; };
function hm(ts) { const d = new Date(ts); return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, ''); }
function dayKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function dayLabel(ts) { const d = new Date(ts), t = new Date(); if (!Number.isFinite(d.valueOf())) return ''; const diff = Math.round((new Date(t.getFullYear(), t.getMonth(), t.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5); return diff === 0 ? word("calendar.day_label.01") : diff === 1 ? word("calendar.day_label.02") : `${word(dayWords[d.getDay()])}, ${d.getDate()} ${word(monthWords[d.getMonth()])}`; }

const famOf = (c) => (c === 'a' ? S.side_a_family_yi : c === 'b' ? S.side_b_family_yi : '');
const sideName = (c) => (c === 'a' ? S.side_a_yi : c === 'b' ? S.side_b_yi : c === 'all' ? word("calendar.side_name.01") : word("calendar.side_name.02"));
const sideLong = (c) => sideName(c) + (famOf(c) ? ` ${word("calendar.side_long.01")} ` + famOf(c) : '');
const sideTag = (c) => `<span class="tag ${c === 'a' || c === 'b' ? c : 'g'}">${htmlWord("calendar.side_tag.02", { value: c === 'a' || c === 'b' ? sideLong(c) : word("calendar.side_tag.01") })}</span>`;
const familyTags = (p) => (p.families || []).map(f=>`<span class="tag g family-connection">${htmlWord("calendar.family_tags.01", { name: f.name })}</span>`).join(' ');
const knownAs = (p) => p.known_as ? `<span class="person-known-as" dir="auto">${esc(p.known_as)}</span>` : '';
const photoPath = id => `/people/${id}/photo`;
const profilePhoto = (person, portrait = false) => person.has_photo
  ? `<img class="person-photo${portrait ? ' portrait' : ''}" ${ME.acting ? `data-person-photo="${person.id}"` : `src="/api${photoPath(person.id)}"`} alt="" decoding="async"${portrait ? '' : ' loading="lazy"'}>` : '';
function loadActingPhotos(root) {
  const acting = ME?.acting?.context;
  if (!acting) return;
  for (const img of root.querySelectorAll('img[data-person-photo]')) {
    api(photoPath(img.dataset.personPhoto), { image:true }).then(blob => {
      if (!img.isConnected || ME?.acting?.context !== acting) return;
      const url = URL.createObjectURL(blob);
      img.addEventListener('load', () => URL.revokeObjectURL(url), { once:true });
      img.addEventListener('error', () => URL.revokeObjectURL(url), { once:true });
      img.src = url;
    }).catch(() => img.remove());
  }
}
const familyChoices = (rows) => [...new Map(rows.flatMap(p=>p.families || []).map(f=>[f.id,f])).values()].sort((a,b)=>a.name.localeCompare(b.name));
const familySelector = (rows, key, label) => `<label class="view-picker">${esc(label)}<select data-change="familyfilter" data-key="${key}"><option value="">${htmlWord("calendar.family_selector.01")}</option>${familyChoices(rows).map(f=>`<option value="${f.id}" ${Number(STATE[key])===f.id?'selected':''}>${esc(f.name)}</option>`).join('')}</select></label>`;
const isManager = () => ME && (ME.is_admin || ME.is_family_admin);
const managesAccounts = () => isManager() && !ME.acting;
const both = () => ME && (isManager() || (ME.sides.includes('a') && ME.sides.includes('b')));
const mySides = () => (isManager() ? ['a', 'b'] : ME.sides);
const vis = (s) => STATE.side === 'all' || s === STATE.side || s === 'both' || s === 'all';
function seg() { if (!both()) return ''; return `<div class="seg">${[['all', word("calendar.seg.01")], ['a', famOf('a') || sideName('a')], ['b', famOf('b') || sideName('b')]].map(([k, t]) => `<button class="${STATE.side === k ? 'on' : ''}" data-act="side" data-v="${k}">${esc(t)}</button>`).join('')}</div>`; }
function sideOptions(sel, withBoth = true, allLabel) {
  const o = mySides().map((c) => [c, sideLong(c)]);
  if (withBoth && both()) o.push([allLabel ? 'all' : 'both', allLabel || word("calendar.side_name.02")]);
  else if (allLabel) o.push(['all', allLabel]);
  return o.map(([k, t]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${esc(t)}</option>`).join('');
}
const gmap = (a) => 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(a);
const waze = (a) => 'https://waze.com/ul?q=' + encodeURIComponent(a) + '&navigate=yes';
const navBtns = (a) => (a ? `<a class="btn s gm" href="${gmap(a)}" target="_blank" rel="noopener">🗺️ Google Maps</a><a class="btn s wz" href="${waze(a)}" target="_blank" rel="noopener">🚗 Waze</a>` : '');
const tel = (p) => (p ? `<a href="tel:${esc(p.replace(/[^\d+]/g, ''))}" dir="ltr">📞 ${esc(p)}</a>` : '<span class="muted">—</span>');
const empty = (e, t, btn = '') => `<div class="empty"><div class="e">${e}</div><div>${esc(t)}</div>${btn ? `<div class="empty-action">${btn}</div>` : ''}</div>`;
const field = (lbl, inner) => { const id=inner.match(/id="([^"]+)"/); return `<label${id ? ` for="${id[1]}"` : ''}>${esc(lbl)}</label>${inner}`; };
const val = (id) => ($(id) ? $(id).value.trim() : '');

// ---------- nav ----------
const calendarNav = () => ['calendar', '📅', word('family_tools.calendar.title')];
const pages = () => [['home', '🏠', word("navigation.home")], ['yz', '🕯️', word("navigation.yahrzeits")], calendarNav(), ['tree', '🌳', word("navigation.tree")], ['learn', '📖', word("navigation.learning")], ['sim', '🎉', word("navigation.simchas")], ['chat', '💬', word("navigation.chat")], ['people', '👥', word("navigation.directory")]];
let PENDING = 0, UNREAD = false, familyChanging = false;
const appName = () => (ME?.family_groups?.length > 1 ? word("navigation.app_name") : S.family_yi) || word("account.load_me.01");
function workspacePicker() {
  const groups = ME.family_groups || [];
  if (groups.length < 2) return '';
  return `<label class="view-picker">${htmlWord("navigation.family_context")}<select data-change="viewgroup">${groups.map(group =>
    `<option value="${group.id}" ${group.id === ME.selected_family_group_id ? 'selected' : ''}>${esc(group.name)}</option>`).join('')}</select></label>`;
}
const viewHeader = (title, actions = '') => `<header class="view-header"><h1>${title}</h1>${actions ? `<div class="btns">${actions}</div>` : ''}</header>`;
function actingBanner() {
  const text=ME?.acting?word("navigation.acting_banner.01", { name: ME.name }):word("navigation.acting_banner.02");
  return `<div class="acting-banner" role="status"><strong>${esc(text)}</strong><button type="button" class="btn s l" data-act="stopacting">${htmlWord("navigation.acting_banner.03")}</button></div>`;
}
function renderNav(v) {
  const extra = [['me', '👤', word("navigation.account")]]; if (managesAccounts()) extra.unshift(['admin', '🛡️', word("navigation.admin")]);
  $('nav').innerHTML = `<div class="lg">${esc(appName())}</div><div class="sd">${esc(ME.name)}</div>` +
    [...pages(), ...extra].map(([k, i, t]) => `<a class="${v === k ? 'on' : ''}" href="#${k}">${i} ${esc(t)}${k === 'admin' && PENDING ? `<span class="badge">${PENDING}</span>` : ''}${k === 'chat' && UNREAD ? '<span class="badge">●</span>' : ''}</a>`).join('') +
    `<a data-act="logout" style="margin-top:14px;opacity:.7">${htmlWord("navigation.render_nav.01")}</a>`;
  const tb = [['home', '🏠', word("navigation.home")], ['yz', '🕯️', word("navigation.yahrzeits")], ['sim', '🎉', word("navigation.simchas")], ['chat', '💬', word("navigation.chat")], ['more', '☰', word("navigation.render_nav.02")]];
  const inMore = !['home', 'yz', 'sim', 'chat'].includes(v);
  $('tabs').innerHTML = tb.map(([k, i, t]) => `<a class="${(k === v || (k === 'more' && inMore)) ? 'on' : ''}" ${k === 'more' ? 'data-act="more"' : `href="#${k}"`}><span class="i">${i}</span>${esc(t)}${k === 'chat' && UNREAD ? '<span class="badge">●</span>' : ''}${k === 'more' && PENDING ? `<span class="badge">${PENDING}</span>` : ''}</a>`).join('');
  $('top').innerHTML = `<div class="topbar"><b>🌳 ${esc(appName())}</b><span>${esc(ME.name.split(' ')[0])}</span></div>`;
  if(ME.acting)$('top').insertAdjacentHTML('afterbegin',actingBanner());
}
function moreSheet() {
  const L = [calendarNav(), ['tree', '🌳', word("navigation.tree")], ['learn', '📖', word("navigation.learning")], ['people', '👥', word("navigation.directory")], ...(managesAccounts() ? [['admin', '🛡️', word("navigation.admin") + (PENDING ? ` ${word("navigation.more_sheet.01", { PENDING: PENDING })}` : '')]] : []), ['me', '👤', word("navigation.account")]];
  modal(`<div class="sheet">${L.map(([k, i, t]) => `<a href="#${k}" data-act="close">${i} ${esc(t)}</a>`).join('')}<a data-act="logout">${htmlWord("navigation.render_nav.01")}</a></div><button class="btn l" style="width:100%;margin-top:12px" data-act="close">${htmlWord("navigation.more_sheet.02")}</button>`);
}

// ---------- views ----------
const V = {};
V.login = () => {
  const mode = STATE.authMode || 'login';
  const sides = STATE.joinSides || STATE.pickSides || [];
  return `<div class="login"><div style="font-size:54px">🌳</div><h1>${esc(S.family_yi)}</h1><div class="cap">${htmlWord("account.login.01")}</div>
  <div class="seg"><button class="${mode === 'login' ? 'on' : ''}" data-act="authmode" data-v="login">${htmlWord("account.login.02")}</button><button class="${mode === 'signup' ? 'on' : ''}" data-act="authmode" data-v="signup">${htmlWord("account.login.03")}</button></div>
  <form data-form="${mode}" class="card" style="text-align:right">
  ${mode === 'signup' ? field(word("account.login.04"), `<input id="fn" autocomplete="name" placeholder="${htmlWord("account.login.05")}">`) : ''}
  ${field(word("account.login.06"), '<input id="fp" type="tel" inputmode="tel" autocomplete="tel" class="ltr" placeholder="845-555-1234">')}
  ${field(word("account.login.07"), `<input id="fw" type="password" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" ${mode === 'signup' ? `placeholder="${htmlWord("account.login.08")}"` : ''}>`)}
  ${mode === 'signup' && STATE.joinSides ? `<div class="card" role="status"><b>${htmlWord("account.login.09", { value: STATE.joinFamily || '' })}</b><p>${htmlWord("account.login.10")}</p></div>${field(word("account.login.11"), '<input id="fnote">')}` : mode === 'signup' ? `${field(word("account.login.13"), '<input id="newfamilyname" maxlength="120" required>')}<p class="muted">${htmlWord("account.login.12")}</p>` : ''}
  <div class="err" id="ferr"></div>
  <button class="btn" style="width:100%">${mode === 'signup' ? htmlWord("account.login.14") : htmlWord("account.login.02")}</button>
  ${mode === 'login' ? `<div class="muted" style="margin-top:12px"><button type="button" class="btn l" data-act="forgotpw">${htmlWord("account.login.15")}</button></div>` : `<div class="muted" style="margin-top:12px">${STATE.joinSides ? htmlWord("account.login.16") : htmlWord("account.login.17")}</div>`}
  </form></div>`;
};
V.pending = () => `<div class="login"><div style="font-size:54px">⏳</div><h1>${htmlWord("account.pending.01", { name: ME.name.split(' ')[0] })}</h1>
  <div class="card"><b>${ME.status === 'rejected' ? htmlWord("account.pending.04") : htmlWord("account.pending.05")}</b>
  <div class="muted" style="margin-top:8px">${ME.status === 'rejected' ? htmlWord("account.pending.06") : htmlWord("account.pending.07")}</div>
  <div class="btns" style="justify-content:center;margin-top:14px"><button class="btn" data-act="recheck">${htmlWord("account.pending.02")}</button><button class="btn l" data-act="logout">${htmlWord("account.pending.03")}</button></div></div></div>`;
V.forgotpw = () => `<div class="login"><div style="font-size:54px">🔑</div><h1>${htmlWord("account.login.15")}</h1>
  ${STATE.resetRequested ? `<div class="card" role="status">${htmlWord("account.forgotpw.02")}</div>` : `<p class="cap">${htmlWord("account.forgotpw.03")}</p><form data-form="forgotpw" class="card">
  ${field(word("account.login.06"), `<input id="resetphone" type="tel" inputmode="tel" autocomplete="tel" class="ltr" value="${esc(STATE.resetPhone || '')}">`)}<div class="err" role="alert"></div><button class="btn">${htmlWord("account.forgotpw.04")}</button></form>`}
  <button class="btn l" style="margin-top:14px" data-act="backlogin">${htmlWord("account.forgotpw.01")}</button></div>`;
V.verifyemail = () => `<div class="login"><h1>${htmlWord("account.verifyemail.01")}</h1><p class="cap">${htmlWord("account.verifyemail.02")}</p><form data-form="verifyemail" class="card"><div class="err" role="alert"></div><button class="btn">${htmlWord("account.verifyemail.03")}</button></form></div>`;
V.setpw = () => `<div class="login"><div style="font-size:54px">🔑</div><h1>${htmlWord("account.setpw.01")}</h1><div class="cap" id="spn">${htmlWord("account.setpw.02")}</div>
  <form data-form="setpw" class="card" style="text-align:right">${field(word("account.setpw.05"), `<input id="sp1" type="password" autocomplete="new-password" placeholder="${htmlWord("account.login.08")}">`)}${field(word("account.setpw.06"), '<input id="sp2" type="password" autocomplete="new-password">')}
  <div class="err" id="ferr" role="alert"></div><button class="btn" id="setpwsubmit" disabled style="width:100%">${htmlWord("account.setpw.03")}</button></form><button class="btn l" style="margin-top:14px" data-act="forgotpw">${htmlWord("account.setpw.04")}</button></div>`;

V.home = async () => {
  const h = await api('/home'); PENDING = h.pending;
  const nx = h.yahrzeits[0];
  return `<div class="home-view">${viewHeader(htmlWord("home.01", { name: ME.name.split(' ')[0] }), workspacePicker())}<div class="cap">${htmlWord("home.today", { today: h.today })}</div>
  ${h.pending ? `<a class="row" href="#admin" style="text-decoration:none;color:inherit;background:#fffbeb;border-color:#fcd34d"><div class="grow"><b>${htmlWord("home.11", { pending: h.pending })}</b></div><span class="btn s">${htmlWord("home.12")}</span></a>` : ''}
  <div class="grid g4 home-stats"><a class="card" href="#yz" style="text-decoration:none;color:inherit"><div class="muted">${htmlWord("home.03")}</div><div class="big">${nx ? esc(nx.hebrew) : '—'}</div><div class="muted home-stat-note">${nx ? esc(inDays(nx.next.days)) : htmlWord("home.13")}</div></a>
  <a class="card" href="#sim" style="text-decoration:none;color:inherit"><div class="muted">${htmlWord("home.04")}</div><div class="big">${h.simchas.length}</div></a>
  <a class="card" href="#learn" style="text-decoration:none;color:inherit"><div class="muted">${htmlWord("home.05")}</div><div class="big">${h.lists.length}</div></a>
  <a class="card" href="#people" style="text-decoration:none;color:inherit"><div class="muted">${htmlWord("home.06")}</div><div class="big">${h.members}</div></a></div>
  <h2>${htmlWord("home.07")}</h2>${h.yahrzeits.length ? h.yahrzeits.map((y) => `<div class="row"><div class="grow"><b>${esc(yahrzeitName(y))}</b><div class="muted">${esc(y.relation)}${y.relation ? ' · ' : ''}${esc(y.hebrew)} · ${esc(gdate(y.next.ymd))} · <b>${esc(inDays(y.next.days))}</b></div></div>${familyTags(y)}</div>`).join('')
    : empty('🕯️', word("home.14"), `<a class="btn s" href="#yz">${htmlWord("home.15")}</a>`)}
  ${h.lists.length ? `<h2>${htmlWord("home.16")}</h2>${h.lists.map((l) => `<a class="row" href="#learn/${l.id}" style="text-decoration:none;color:inherit"><div class="grow"><b>${l.kind === 'tehillim' ? htmlWord("home.19") : htmlWord("home.20")} · ${esc(l.niftar)}</b><div class="bar"><div style="width:${Math.round(100 * l.taken / l.total)}%"></div></div><div class="muted">${htmlWord("home.17", { taken: l.taken, total: l.total })}${l.target_date ? ` ${htmlWord("home.21")} ` + esc(gdate(l.target_date)) : ''}</div></div><span class="btn s">${htmlWord("home.18")}</span></a>`).join('')}` : ''}
  <h2>${htmlWord("home.08")}</h2>${h.simchas.length ? h.simchas.map((x) => `<div class="row" style="flex-wrap:wrap"><div class="grow"><b>${esc(simchaKind(x.kind))} · ${esc(x.whose)}</b><div class="muted">${esc(gdate(x.gdate))} · ${esc(x.hebrew)}${x.hall ? ' · ' + esc(x.hall) : ''} · ${esc(inDays(x.days))}</div></div><div class="btns">${navBtns(x.address)}<a class="btn s l" href="#sim">RSVP</a></div></div>`).join('')
    : empty('🎉', word("home.22"), `<a class="btn s" href="#sim">${htmlWord("home.23")}</a>`)}
  <h2>${htmlWord("home.09")}</h2>${h.messages.length ? h.messages.map((m) => `<a class="row" href="#chat" style="text-decoration:none;color:inherit"><div class="grow"><b>${esc(m.name)}</b> <span class="muted">· ${esc(m.room === 'all' ? word("home.24") : famOf(m.room) || sideName(m.room))} · ${hm(m.created_at)}</span><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.body)}</div></div></a>`).join('')
    : empty('💬', word("home.25"), `<a class="btn s" href="#chat">${htmlWord("home.26")}</a>`)}
  <div style="margin-top:12px"><button class="btn l" data-act="familyinvite">${htmlWord("home.10")}</button></div></div>`;
};
function familyInviteForm() {
  modal(`<h2>${htmlWord("home.10")}</h2><p class="muted">${htmlWord("home.family_invite_form.01")}</p>
    <form data-form="familyinvite">${field(word("home.family_invite_form.04"), `<select id="inviteSide">${sideOptions(STATE.side === 'all' ? (both() ? 'both' : mySides()[0]) : STATE.side)}</select>`)}
    <div class="err" role="alert"></div><div class="btns"><button class="btn">${htmlWord("home.family_invite_form.02")}</button><button type="button" class="btn l" data-act="close">${htmlWord("home.family_invite_form.03")}</button></div></form>`);
}

// yahrzeits
async function useLinkedFamily() {
  const group = Number(location.hash.split('/')[2]);
  if (group && group!==ME.selected_family_group_id) {
    await api('/me/family-group',{method:'POST',body:{family_group_id:group}});
    await loadMe();
  }
}
V.yz = async arg => {
  const id = Number(arg);
  const remindersOpen = Boolean($('m').querySelector('.yahrzeit-reminders[open]'));
  if (id) await useLinkedFamily();
  const { yahrzeits, email_days } = await api('/yahrzeits'); STATE.yzs = yahrzeits;
  const L = yahrzeits.filter(y => id ? y.id===id : !STATE.yzFamily || (y.families || []).some(f=>f.id===Number(STATE.yzFamily)));
  const reminders = !ME.acting && `<details class="card yahrzeit-reminders"${remindersOpen ? ' open' : ''}><summary>${htmlWord("yahrzeits.reminders.heading")}</summary>
    <p>${htmlWord("family_tools.reminders.lead",{days:email_days})}</p>
    ${EMAIL_READY ? (ME.email_verified ? '' : `<p class="muted"><a href="#me">${htmlWord("yahrzeits.reminders.verify")}</a></p>`) : `<p class="muted">${htmlWord("shared.emaillearn.02")}</p>`}
    ${ME.person_id ? '' : `<p class="muted">${htmlWord("yahrzeits.reminders.link_profile")}</p>`}
    <button class="btn l" type="button" data-act="ancestorreminders" aria-pressed="${ME.yahrzeit_ancestor_emails}" ${!ME.yahrzeit_ancestor_emails && ((!EMAIL_READY || !ME.email_verified) && !(STATE.whatsappEnabled && ME.whatsapp_yahrzeit_reminders)) ? 'disabled' : ''}>${htmlWord(ME.yahrzeit_ancestor_emails?'yahrzeits.reminders.disable_branch':'yahrzeits.reminders.enable_branch')}</button>
    <label class="reminder-option"><input type="checkbox" data-change="yahrzeitpreference" ${ME.whatsapp_yahrzeit_reminders?'checked':''}
    ${!STATE.whatsappEnabled && !ME.whatsapp_yahrzeit_reminders?'disabled':''}> ${htmlWord('family_tools.reminders.whatsapp')}</label>
    <p class="muted">${STATE.whatsappEnabled ? htmlWord('family_tools.reminders.whatsapp_phone',{phone:`+${ME.phone}`}) : htmlWord('family_tools.reminders.whatsapp_unavailable')}</p>
    </details>`;
  STATE.printYahrzeits = L;
  const add = `<button class="btn s" data-act="edityz" data-id="0">${htmlWord("yahrzeits.add")}</button>`;
  const calendar = `<a href="#calendar" class="btn s l">${htmlWord('family_tools.calendar.title')}</a>`;
  const print = L.length ? `<button class="btn s l" data-act="printyahrzeits">${htmlWord('family_tools.print.action')}</button>` : '';
  return `${viewHeader(htmlWord(id?'yahrzeits.reminders.detail':'yahrzeits.heading'), (id ? '' : add + workspacePicker()) + calendar + print)}
  ${id?`<p><a href="#yz">${htmlWord("yahrzeits.reminders.all")}</a></p>`:`<div class="list-tools">${familySelector(yahrzeits,'yzFamily',word("yahrzeits.family_filter"))}${reminders || ''}</div>`}
  ${L.map((y) => `<div class="row" style="flex-wrap:wrap"><div class="grow" style="min-width:220px"><b>${esc(yahrzeitName(y))}</b>
   ${y.families?.length?`<div class="yahrzeit-families">${familyTags(y)}</div>`:''}
   <div class="muted">${esc(y.relation)}${y.relation ? ' · ' : ''}<b style="color:#111827">${esc(y.hebrew)}</b>${y.next ? ` ${htmlWord("yahrzeits.yz.06", { date: gdate(y.next.ymd) })} <b style="color:#4338ca">${esc(inDays(y.next.days))}</b>` : ''}</div>
   ${y.kever ? `<div class="muted">🪦 ${esc(y.kever)}</div>` : ''}${y.kever_address?`<div class="muted" dir="auto">📍 ${esc(y.kever_address)}</div><div class="btns">${navBtns(y.kever_address)}</div>`:''}${y.note ? `<div class="muted">${esc(y.note)}</div>` : ''}</div>
   <div class="btns">${ME.acting?'':`<button class="btn s ${y.remind ? 'g' : 'l'}" type="button" aria-pressed="${y.remind}" data-act="remind" data-id="${y.id}" data-on="${y.remind ? 0 : 1}">${htmlWord(y.remind?'yahrzeits.reminders.disable_one':'yahrzeits.reminders.enable_one')}</button>`}
   <button class="btn s l" data-act="newlist" data-yz="${y.id}">${htmlWord("yahrzeits.yz.04")}</button><button class="btn s l" data-act="shareyz" data-id="${y.id}">${htmlWord("yahrzeits.reminders.whatsapp")}</button><button class="btn s l" data-act="edityz" data-id="${y.id}">${htmlWord("yahrzeits.yz.05")}</button></div></div>`).join('') || empty('🕯️', word(id?'yahrzeits.reminders.missing':'yahrzeits.yz.09'))}
  ${id ? reminders || '' : ''}`;
};

const eventLabel = kind => word(`family_tools.calendar.${kind}`);
const calendarRow = (event, day) => `<li class="calendar-event"><span class="tag ${event.kind==='yahrzeit'?'b':'g'}">${esc(eventLabel(event.kind))}</span>
  ${event.kind === 'yahrzeit' ? `<a href="#yz/${event.yahrzeitId}/${ME.selected_family_group_id}">${esc(withMemorialSuffix(event.name))}</a>`
    : `<button type="button" class="family-name" data-act="viewperson" data-id="${event.personId}">${esc(event.name)}</button>`}
  <time datetime="${day.date}">${esc(day.label)}</time></li>`;
function calendarAgenda(calendar, selected) {
  const day = calendar.days.find(entry => entry.date === selected);
  const heading = day ? day.date === calendar.today ? word('family_tools.calendar.today_date', { date:day.label }) : day.label : calendar.label;
  const events = day ? calendar.events.filter(event => event.date === day.date) : calendar.events;
  const dates = new Map(calendar.days.map(entry => [entry.date,entry]));
  return `<h2>${esc(heading)}</h2>${events.length ? `<ul class="calendar-events">${events.map(event => calendarRow(event,dates.get(event.date))).join('')}</ul>`
    : `<p class="muted">${htmlWord('family_tools.calendar.empty')}</p>`}`;
}
V.calendar = async () => {
  const { year, month } = STATE.calendarMonth || {};
  const calendar = await api('/family-calendar' + (year ? `?year=${year}&month=${month}` : ''));
  STATE.familyCalendar = calendar;
  if (!year) STATE.calendarDay = calendar.today;
  const counts = new Map();
  for (const event of calendar.events) counts.set(event.date, (counts.get(event.date) || 0) + 1);
  const monthButton = (key, label) => `<button type="button" class="btn s l" data-act="calendarmonth" data-v="${key}">${htmlWord(label)}</button>`;
  return `${viewHeader(htmlWord('family_tools.calendar.title'), workspacePicker() + `<button class="btn s" data-act="calendarmonth" data-v="today">${htmlWord('family_tools.calendar.today')}</button>`)}
  <section class="card calendar-card"><div class="calendar-controls">${monthButton('previous','family_tools.calendar.previous')}<h2>${esc(calendar.label)}</h2>${monthButton('next','family_tools.calendar.next')}</div>
  <div class="calendar-grid">${dayWords.map((key,index) => `<span class="calendar-weekday" title="${htmlWord(key)}">${index===6?htmlWord('family_tools.calendar.shabbos'):esc(hebD(index+1))}</span>`).join('')}
  ${'<span aria-hidden="true"></span>'.repeat(calendar.startWeekday)}
  ${calendar.days.map(day => `<button class="calendar-day" data-act="calendarday" data-v="${day.date}" aria-pressed="${STATE.calendarDay===day.date}" ${calendar.today===day.date?'aria-current="date"':''}
    aria-label="${htmlWord('family_tools.calendar.day_events', { day:day.label, count:counts.get(day.date)||0 })}"><span>${esc(day.day)}</span>${counts.has(day.date)?`<small>${counts.get(day.date)}</small>`:''}</button>`).join('')}</div>
  <button class="btn s l calendar-all" data-act="calendarday" data-v="">${htmlWord('family_tools.calendar.all_month')}</button></section>
  <section id="calendar-agenda" class="card" aria-live="polite">${calendarAgenda(calendar, STATE.calendarDay)}</section>`;
};
async function yzForm(id) {
  const y=(STATE.yzs||[]).find(x=>x.id===id);
  if(y?.person_id)return personForm(y.person_id,undefined,{fromYahrzeit:true});
  const {people}=await api('/people');STATE.yzLegacy=y||null;
  modal(`<h2>${y?htmlWord("yahrzeits.yz_form.05"):htmlWord("yahrzeits.yz_form.06")}</h2><p class="muted">${htmlWord("yahrzeits.yz_form.01")}</p>
    ${field(word("yahrzeits.yz_form.07"),`<select id="yzperson"><option value="">${htmlWord("yahrzeits.yz_form.08")}</option>${people.map(p=>`<option value="${p.id}">${esc(personName(p))}</option>`).join('')}</select>`)}
    <div class="btns"><button class="btn" data-act="yzexisting">${htmlWord("yahrzeits.yz_form.02")}</button><button class="btn l" data-act="yznew">${htmlWord("yahrzeits.yz_form.03")}</button><button class="btn l" data-act="close">${htmlWord("yahrzeits.yz_form.04")}</button></div>`);
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
function treeSpouses(p, relative) {
  return [
    p.spouse_name ? htmlWord("tree.10") + ' ' + esc(relative(p, 'spouse')) : esc(p.spouse),
    p.second_spouse_name ? htmlWord("tree.11") + ' ' + esc(relative(p, 'second_spouse')) : ''
  ].filter(Boolean).join('<br>') || '—';
}
V.tree = async () => {
  const { people } = await api('/people'); STATE.people = people;
  const P = people; // Server permissions determine visibility; family membership never cuts spouse/ancestor links.
  const {units,edges,generationConflicts}=familyUnits(P); STATE.treeEdges=edges;
  STATE.treePrint = { units, hasGenerations: !generationConflicts.length };
  const graphMode=STATE.treeView==='tree' && !generationConflicts.length;
  const peopleById=new Map(P.map(p=>[p.id,p]));
  const relative=(p,key)=>relationName(peopleById,p,key);
  const node = p => `<button class="pn family-person ${isDeceased(p)?'d':''}" data-tree-person="${p.id}" data-act="viewperson" data-id="${p.id}"><span class="person-card-heading">${profilePhoto(p)}<strong>${esc(personName(p))}</strong></span>${knownAs(p)}${p.spouse_name?`<span class="muted">${htmlWord("tree.node.02", { spouse_name: relative(p,'spouse') })}</span>`:''}${p.second_spouse_name?`<span class="muted">${htmlWord("tree.node.03", { second_spouse_name: relative(p,'second_spouse') })}</span>`:''}${p.father_name?`<span class="muted tree-relation">${htmlWord("tree.node.04", { father_name: relative(p,'father') })}</span>`:''}${p.mother_name?`<span class="muted tree-relation">${htmlWord("tree.node.05", { mother_name: relative(p,'mother') })}</span>`:''}${p.spouse && !p.spouse_id?`<span class="muted">${htmlWord("tree.node.06", { spouse: p.spouse })}</span>`:''}</button>`;
  const couple = unit => `<section class="family-unit ${unit.members.length>1?'married':''}" aria-label="${unit.members.length>1?htmlWord("tree.couple.01"):htmlWord("tree.couple.02")}">${unit.members.length>1?`<div class="marriage-label">${htmlWord("tree.couple.01")}</div>`:''}<div class="family-members">${unit.members.map(node).join('')}</div></section>`;
  const levels=[...new Set(units.map(u=>u.level))].sort((a,b)=>a-b);
  const zoom = `<div class="tree-toolbar" role="group" aria-label="${htmlWord("tree.01")}"><button class="btn s l" data-act="treezoom" data-v="fit">${htmlWord("tree.02")}</button><button class="btn s l" data-act="treezoom" data-v="-0.1" aria-label="${htmlWord("tree.03")}">−</button><output id="tree-scale" aria-live="polite">100%</output><button class="btn s l" data-act="treezoom" data-v="0.1" aria-label="${htmlWord("tree.04")}">+</button><button class="btn s l" data-act="treezoom" data-v="actual">100%</button></div>`;
  const treeHtml=graphMode
    ? `<div class="family-scroll" id="family-viewport"><div class="family-stage" id="family-stage"><div class="family-map" id="family-map"><svg class="family-lines" aria-hidden="true"></svg>${levels.map(level=>`<div class="family-level">${units.filter(u=>u.level===level).map(couple).join('')}</div>`).join('')}</div></div></div>`
    : `<div class="family-table-scroll"><table class="family-table"><thead><tr><th>${htmlWord("tree.06")}</th><th>${htmlWord("tree.07")}</th><th>${htmlWord("tree.08")}</th><th>${htmlWord("tree.09")}</th></tr></thead>${units.map(unit=>`<tbody${unit.members.length>1?' class="married-rows"':''}>${unit.members.map(p=>`<tr><td><button class="family-name" data-act="viewperson" data-id="${p.id}">${profilePhoto(p)}${esc(personName(p))}</button>${knownAs(p)} ${familyTags(p)}</td><td>${treeSpouses(p, relative)}</td><td>${esc(relative(p,'father'))||'—'}</td><td>${esc(relative(p,'mother'))||'—'}</td></tr>`).join('')}</tbody>`).join('')}</table></div>`;
  const add = `<button class="btn s" data-act="editp" data-id="0">${htmlWord(isManager() ? "tree.05" : "family_tools.suggestions.add")}</button>`;
  const print = P.length ? `<button class="btn s l" data-act="printtree">🖨️ ${htmlWord('family_tools.print.action')}</button>` : '';
  const relate = P.length > 1 ? `<button class="btn s l" data-act="findrelationship">${htmlWord('family_tools.relationship.title')}</button>` : '';
  return `${viewHeader(htmlWord("tree.12"), add + print + relate)}
  ${generationConflicts.length ? `<p class="err" role="alert">${htmlWord("tree.17")}</p>` : ''}
  ${units.length ? `<div class="list-tools">
    <div class="seg"><button class="${graphMode ? 'on' : ''}" aria-pressed="${graphMode}" data-act="treeview" data-v="tree" ${generationConflicts.length ? 'disabled' : ''}>${htmlWord("tree.14")}</button><button class="${graphMode ? '' : 'on'}" aria-pressed="${!graphMode}" data-act="treeview" data-v="list">${htmlWord("tree.15")}</button></div>
    ${graphMode && familyChoices(P).length > 1 ? familySelector(P,'treeFamily',word("tree.highlight_family")) : ''}
    ${graphMode ? zoom : ''}
  </div><div class="card tree-content">${treeHtml}</div>` : empty('🌳',word("tree.18"))}`;
};

function highlightTreeFamily() {
  const familyId = Number(STATE.treeFamily);
  const people = new Set(STATE.people.filter(person => person.families?.some(family => family.id === familyId)).map(person => person.id));
  for (const node of $('family-map').querySelectorAll('[data-tree-person]')) {
    node.classList.toggle('is-highlighted', people.has(Number(node.dataset.treePerson)));
  }
}

function findRelationship() {
  const people = [...STATE.people].sort((a,b) => personName(a).localeCompare(personName(b),'he'));
  const options = rows => `<option value="">${htmlWord('family_tools.relationship.pick')}</option>` + rows.map(person =>
    `<option value="${person.id}">${esc(personName(person))}${person.father_name ? ` · ${esc(person.father_name)}` : ''}</option>`).join('');
  const picker = key => `<div>${field(word(`family_tools.relationship.${key}`), `<input type="search" id="relation-${key}-search" autocomplete="off">`)}
    <select id="relation-${key}" aria-label="${htmlWord(`family_tools.relationship.${key}`)}" required>${options(people)}</select></div>`;
  modal(`<h2>${htmlWord('family_tools.relationship.title')}</h2><form data-form="relationship"><div class="grid g2">${picker('from')}${picker('to')}</div>
    <div class="btns"><button class="btn">${htmlWord('family_tools.relationship.find')}</button><button type="button" class="btn l" data-act="close">${htmlWord('tree.person_profile.10')}</button></div>
    <div id="relationship-result" aria-live="polite"></div></form>`);
  for (const key of ['from','to']) {
    const search = $(`relation-${key}-search`), select = $(`relation-${key}`);
    search.addEventListener('input', () => {
      const selected = select.value, query = personNameKey(search.value);
      const filtered = people.filter(p => personNameKey(`${personName(p)} ${p.known_as || ''} ${p.father_name || ''}`).includes(query));
      select.innerHTML = options(filtered);
      if (filtered.some(person => String(person.id) === selected)) select.value = selected;
      else if (filtered.length === 1) select.value = String(filtered[0].id);
    });
  }
}

function showRelationship() {
  const people = STATE.people;
  const byId = new Map(people.map(person => [person.id,person]));
  const path = relationshipPath(people, Number(val('relation-from')), Number(val('relation-to')));
  $('relationship-result').innerHTML = path?.length === 1 ? `<p>${htmlWord('family_tools.relationship.same')}</p>` : path
    ? `<ol class="relationship-path">${path.map(step => `<li>${step.relation ? `<small>${htmlWord(`family_tools.relationship.edge_${step.relation}`)}</small>` : ''}<strong>${esc(personName(byId.get(step.id)))}</strong></li>`).join('')}</ol>`
    : `<p>${htmlWord('family_tools.relationship.disconnected')}</p>`;
}

function showPrint(kind, heading, markup) {
  $('family-print')?.remove();
  const section = document.createElement('section');
  section.id = 'family-print';
  section.className = `family-print print-${kind}`;
  const title = kind === 'tree' ? heading : `${heading} · ${S.family_yi}`;
  section.innerHTML = `<h1>${esc(title)}</h1>${markup}`;
  document.body.append(section);
  document.body.classList.add('printing-family');
  const previousTitle = document.title;
  document.title = title;
  window.addEventListener('afterprint', () => {
    section.remove();
    document.body.classList.remove('printing-family');
    document.title = previousTitle;
  }, { once:true });
  window.print();
}

function printFamilyTree() {
  const { units, hasGenerations } = STATE.treePrint;
  const map = $('family-map');
  const scale = map ? Math.min(1, 960 / map.offsetWidth) : 0;
  const title = word('family_tools.print.tree');
  if (map && scale >= 0.8 && map.offsetHeight * scale <= 620) {
    drawFamilyLines();
    const graph = map.cloneNode(true);
    graph.removeAttribute('id');
    graph.querySelectorAll('.is-highlighted').forEach(node => node.classList.remove('is-highlighted'));
    graph.querySelectorAll('img').forEach(photo => photo.style.visibility = 'hidden');
    Object.assign(graph.style,{ right:'0', top:'0', width:`${map.offsetWidth}px`, transform:`scale(${scale})` });
    showPrint('tree', title, `<div class="print-chart" style="height:${Math.ceil(map.offsetHeight*scale)}px">${graph.outerHTML}</div>`);
    return;
  }
  const peopleById = new Map(STATE.people.map(person => [person.id, person]));
  const relative = (person, key) => relationName(peopleById, person, key, true);
  const row = person => {
    const parents = [relative(person, 'father'), relative(person, 'mother')];
    if (person.parent_id && ![person.father_id, person.mother_id].includes(person.parent_id)) parents.push(relative(person, 'parent'));
    return `<tr><th scope="row">${esc(personName(person))}${knownAs(person)}</th><td>${parents.filter(Boolean).map(esc).join('<br>') || '—'}</td>
      <td>${treeSpouses(person, relative)}</td></tr>`;
  };
  const table = group => `<table><thead><tr><th scope="col">${htmlWord("tree.06")}</th><th scope="col">${htmlWord("family_tools.print.parents")}</th>
    <th scope="col">${htmlWord("tree.07")}</th></tr></thead><tbody>${group.flatMap(unit => unit.members).map(row).join('')}</tbody></table>`;
  const generations = [...new Set(units.map(unit => unit.level))].sort((a,b) => a-b);
  const content = hasGenerations ? generations.map(level => `<h2>${htmlWord('family_tools.print.generation', { number:level+1 })}</h2>
    ${table(units.filter(unit => unit.level === level))}`).join('') : table(units);
  showPrint('tree', title, content);
}

function printYahrzeits() {
  const rows = STATE.printYahrzeits.map(y => `<tr><td>${esc(yahrzeitName(y))}</td><td>${esc(y.hebrew)}</td>
    <td>${esc(y.next ? gdate(y.next.ymd) : '—')}</td><td>${esc(y.kever || '—')}</td></tr>`).join('');
  showPrint('yahrzeits', word('family_tools.print.yahrzeits'), `<table><thead><tr><th>${htmlWord('tree.06')}</th><th>${htmlWord('family_tools.print.hebrew_date')}</th>
    <th>${htmlWord('family_tools.print.next_date')}</th><th>${htmlWord('tree.person_profile.16')}</th></tr></thead><tbody>${rows}</tbody></table>`);
}
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
  const zoom = STATE.treeZoom === undefined
    ? Math.max(0.8, Math.min(1, (viewport.clientWidth - 1) / map.offsetWidth))
    : STATE.treeZoom;
  const layout=treeViewportLayout(map.offsetWidth,map.offsetHeight,viewport.clientWidth,viewport.clientHeight,zoom);
  const {scale}=layout;STATE.treeScale=scale;
  stage.style.width=layout.stageWidth+'px';stage.style.height=layout.stageHeight+'px';
  map.style.top=layout.top+'px';map.style.right=layout.right+'px';map.style.transform=`scale(${scale})`;map.dataset.scale=String(scale);
  if(zoom===null) {viewport.scrollLeft=0;viewport.scrollTop=0;}
  else if(!oldScale) viewport.scrollLeft=(viewport.clientWidth-viewport.scrollWidth)/2;
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
  highlightTreeFamily();
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
  const {people}=await api('/people'),p=people.find(p=>p.id===id);if(!p)throw new Error(word("tree.person_profile.01"));
  const byId=new Map(people.map(person=>[person.id,person]));
  const linked=(key,label)=>p[key]?`<div class="row"><span class="muted">${esc(label)}</span><button type="button" class="btn l" data-act="viewperson" data-id="${p[key]}">${esc(relationName(byId,p,key.slice(0,-3),true))}</button></div>`:'';
  const childRow=c=>`<div class="row"><button class="btn l" data-act="viewperson" data-id="${c.id}">${esc(personName(c,c.name))}</button><span class="muted">${htmlWord("tree.child_row.02", { value: relationName(byId,c,'father')||word("tree.child_row.01"), value2: relationName(byId,c,'mother')||word("tree.child_row.01") })}</span></div>`;
  const marriages=[['spouse_id',word("tree.person_profile.02")],['second_spouse_id',word("tree.person_profile.03")]].map(([key,label])=>{
    const spouse=byId.get(p[key]);
    return `<section class="card"><h3>${esc(label)}</h3>${spouse?linked(key,word("tree.07")):`<button class="btn l" data-act="addmarriage" data-id="${id}" data-key="${key}">${htmlWord("tree.person_profile.04", { label: label })}</button>`}${spouse?`<h4>${htmlWord("tree.person_profile.05", { label: label })}</h4>${marriageChildren(people,id,spouse.id).map(childRow).join('')||`<p class="muted">${htmlWord("tree.person_profile.07")}</p>`}<button class="btn l" data-act="marriagechild" data-id="${id}" data-spouse="${spouse.id}">${htmlWord("tree.person_profile.06", { label: label })}</button>`:''}</section>`;
  }).join('');
  const otherChildren=marriageChildren(people,id).filter(c=>![p.spouse_id,p.second_spouse_id].includes(c.father_id===id?c.mother_id:c.father_id));
  const editPhoto = ME.is_admin || ME.person_id === id || (ME.is_family_admin && p.family_group_id === ME.selected_family_group_id);
  modal(`<div class="person-profile-heading">${profilePhoto(p,true)}<div><h2>${esc(personName(p))}</h2>${knownAs(p)}<div class="btns">${familyTags(p)}</div></div></div>
    ${editPhoto ? `<form class="card profile-photo-form" data-form="personphoto" data-id="${id}">${field(word('family_tools.photo.label'), '<input type="file" id="person-photo-file" name="photo" accept="image/jpeg,image/png,image/webp" required>')}
    <div class="err" role="alert"></div><div class="btns"><button class="btn s l">${htmlWord('family_tools.photo.save')}</button>${p.has_photo ? `<button type="button" class="btn s r" data-act="removephoto" data-id="${id}">${htmlWord('family_tools.photo.remove')}</button>` : ''}</div></form>` : ''}
    <p class="muted">${isDeceased(p)?htmlWord("tree.person_profile.11"):p.life_status==='living'?htmlWord("tree.person_profile.12"):htmlWord("tree.person_profile.13")}</p>
    ${linked('father_id',word("tree.08"))}${linked('mother_id',word("tree.09"))}${marriages}
    ${otherChildren.length?`<h3>${htmlWord("tree.person_profile.14")}</h3>${otherChildren.map(childRow).join('')}`:''}
    <button class="btn l" data-act="addchild" data-id="${id}">${htmlWord("tree.person_profile.08")}</button>
    ${p.death_hday&&p.death_hmonth?`<p><b>${htmlWord("tree.person_profile.15")}</b> ${esc(hebD(p.death_hday))} ${esc(hebrewMonthLabel(p.death_hmonth))}${p.death_year?' · '+esc(p.death_year):''}</p>`:''}
    ${p.kever?`<p><b>${htmlWord("tree.person_profile.16")}</b> ${esc(p.kever)}</p>`:''}${p.kever_address?`<p dir="auto">📍 ${esc(p.kever_address)}</p><div class="btns">${navBtns(p.kever_address)}</div>`:''}${p.note?`<p>${esc(p.note)}</p>`:''}
    <div class="btns"><button class="btn" data-act="editp" data-id="${p.id}">${htmlWord(isManager() ? 'tree.person_profile.09' : 'family_tools.suggestions.edit')}</button><button class="btn l" data-act="close">${htmlWord("tree.person_profile.10")}</button></div>`);
  loadActingPhotos($('mb'));
}
const personNameKey=value=>String(value||'').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]/gu,'');
function matchCards(matches,field='person') {
  return matches.map(p=>`<div class="card"><b>${esc(personName(p,p.name))}</b><div class="muted">${p.father_name?`${htmlWord("tree.match_cards.02")} `+esc(p.father_name)+' · ':''}${p.mother_name?`${htmlWord("tree.match_cards.03")} `+esc(p.mother_name)+' · ':''}${p.spouse_name?`${htmlWord("tree.match_cards.04")} `+esc(p.spouse_name):''}</div><button type="button" class="btn s" data-act="reuseperson" data-id="${p.id}" data-field="${field}">${htmlWord("tree.match_cards.01")}</button></div>`).join('');
}
function renderPersonMatches(field='person',forced) {
  const form=document.querySelector('[data-form="person"]');if(!form)return;
  const query=personNameKey(val(field==='person'?'pn':'new_'+field+'_name'));
  const people=STATE.people||[],id=Number(form.dataset.id);
  const existingName=field==='person'&&people.some(p=>p.id===id&&personNameKey(p.name)===query);
  const matches=forced||(query.length<2||existingName?[]:people.filter(p=>p.id!==id&&personNameKey(p.name).includes(query)).slice(0,12));
  const target=$(field==='person'?'personmatches':'matches_'+field);if(target)target.innerHTML=matches.length?`<p>${htmlWord("tree.render_person_matches.01")}</p>`+matchCards(matches,field):'';
}
function proposedPersonChanges(review) {
  const before = review.current || {}, after = review.payload;
  const dateLabel = date => date?.day && date.month ? [hebD(date.day),hebrewMonthLabel(date.month),date.year].filter(Boolean).join(' ') : '';
  const statusLabel = status => word(({ deceased:'tree.person_profile.11', living:'tree.person_profile.12' })[status] || 'tree.person_profile.13');
  const comparison = [
    ['tree.06', before.name, after.name], ['tree.choice.04', before.title, after.title],
    ['tree.known_as_field.01', before.known_as, after.known_as],
    ['tree.08', before.father_name, review.proposal.father], ['tree.09', before.mother_name, review.proposal.mother],
    ['tree.person_profile.02', before.spouse_name, review.proposal.spouse], ['tree.person_profile.03', before.second_spouse_name, review.proposal.secondSpouse],
    ['tree.person_form.23', before.life_status ? statusLabel(before.life_status) : '', after.life_status ? statusLabel(after.life_status) : ''],
    ['tree.person_form.25', dateLabel({day:before.death_hday,month:before.death_hmonth,year:before.death_year}), dateLabel({day:Number(after.death_hday),month:after.death_hmonth,year:Number(after.death_year)})],
    ['tree.person_form.30', before.kever, after.kever], ['tree.person_form.32', before.kever_address, after.kever_address],
    ['tree.person_form.34', before.note, after.note],
    ...dateKinds.map(kind => [`family_tools.calendar.${kind}`, dateLabel(before.calendar_dates?.[kind]), dateLabel(after.calendar_dates?.[kind])]),
  ];
  const changes = comparison.filter(([, previous, next]) => (previous || '') !== (next || ''));
  return changes.length ? `<dl class="person-review-changes">${changes.map(([label,previous,next]) =>
    `<div><dt>${htmlWord(label)}</dt><dd>${previous ? `<del>${esc(previous)}</del> ` : ''}<strong>${esc(next || '—')}</strong></dd></div>`).join('')}</dl>`
    : `<p class="muted">${htmlWord('family_tools.suggestions.no_changes')}</p>`;
}
V.personreviews = async () => {
  const { reviews } = await api('/person-reviews');
  const statuses = { pending:'04',approved:'05',confirmed:'06',existing:'07',rejected:'08' };
  const card = review => {
    const suggestion = review.kind === 'suggestion';
    const resolution = review.status === 'pending' && isManager();
    const button = (action, label, style='', person) => `<button class="btn ${style}" data-act="reviewperson" data-id="${review.id}" data-v="${action}"${person?` data-person="${person}"`:''}>${htmlWord(label)}</button>`;
    return `<section class="card"><h2>${esc(review.payload.name || word('tree.personreviews.10'))}</h2>
    <p class="muted">${htmlWord('family_tools.suggestions.submitted', { name:review.submitted_by })}</p>
    ${review.reason ? `<p>${esc(review.reason)}</p>` : ''}
    ${suggestion ? proposedPersonChanges(review) : `<p>${htmlWord('tree.personreviews.03', { value:review.proposal.father||'—',value2:review.proposal.mother||'—',value3:review.proposal.spouse||'—' })}</p>`}
    <p>${htmlWord('tree.personreviews.09', { value:word('tree.personreviews.'+statuses[review.status]) })}</p>
    ${review.result_id ? `<button class="btn s l" data-act="viewperson" data-id="${review.result_id}">${htmlWord('tree.personreviews.11')}</button>` : ''}
    ${resolution ? `<div>${review.matches.map(p=>`<p>${esc(p.name)} · ${esc(p.father_name||'')} · ${esc(p.mother_name||'')} · ${esc(p.spouse_name||'')} ${button('existing','tree.personreviews.14','s',p.id)}</p>`).join('')}</div>
    <div class="btns">${button('approve',suggestion?'family_tools.suggestions.approve':'tree.personreviews.12')}${button('reject','tree.personreviews.13','r')}</div>` : ''}</section>`;
  };
  return `<h1>${htmlWord('family_tools.suggestions.queue')}</h1>${reviews.length ? reviews.map(card).join('') : `<p>${htmlWord('tree.personreviews.15')}</p>`}`;
};
const dateKinds = ['birthday','anniversary','second_anniversary'];
function calendarDateFields(p,kind) {
  const date = p.calendar_dates?.[kind] || {};
  const id = `person-${kind}`;
  return `<fieldset class="calendar-date-fields"><legend>${esc(eventLabel(kind))}</legend><div class="grid g3">
    <div>${field(word('tree.person_form.26'), `<select id="${id}-day"><option value="">—</option>${Array.from({length:30},(_,i)=>`<option value="${i+1}" ${date.day===i+1?'selected':''}>${esc(hebD(i+1))}</option>`).join('')}</select>`)}</div>
    <div>${field(word('tree.person_form.28'), `<select id="${id}-month"><option value="">—</option>${HMONTHS.map(([key,label])=>`<option value="${key}" ${date.month===key?'selected':''}>${htmlWord(label)}</option>`).join('')}</select>`)}</div>
    <div>${field(word('family_tools.calendar.optional_year'), `<input type="number" id="${id}-year" min="5001" max="5999" value="${date.year || ''}">`)}</div></div></fieldset>`;
}
function readCalendarDates() {
  const dates = {};
  for (const kind of dateKinds) {
    const day=val(`person-${kind}-day`), month=val(`person-${kind}-month`), year=val(`person-${kind}-year`);
    if (day || month || year) dates[kind] = { day:Number(day),month,year:year?Number(year):null };
  }
  return dates;
}
async function personForm(id, parentId, defaults={}) {
  const {people:P}=await api('/people'); STATE.people=P;
  if(id&&!P.some(x=>x.id===id))throw new Error(word("tree.person_form.01"));
  const p = {...(P.find(x=>x.id===id) || {side:STATE.treeSide || mySides()[0],parent_id:parentId || null}),...defaults};
  const yahrzeit = !!defaults.requireYahrzeit;
  const suggestion = !isManager() && !yahrzeit && !defaults.fromYahrzeit;
  const knownAsField=(inputId,value='')=>field(word("tree.known_as_field.01"),`<input id="${inputId}" maxlength="160" dir="auto" value="${esc(value)}" placeholder="${htmlWord("tree.known_as_field.02")}">`);
  const choice=(key,label)=>field(label,`<select id="p${key}" data-change="newrelative" data-key="${key}"><option value="">${htmlWord("tree.choice.01")}</option><option value="new">${htmlWord("tree.choice.02")}</option>${P.filter(x=>x.id!==id).map(x=>`<option value="${x.id}" ${p[key]===x.id?'selected':''}>${esc(personName(x))}</option>`).join('')}</select><div id="new_${key}" hidden class="card" style="margin-top:8px"><p class="muted">${htmlWord("tree.choice.03")}</p>${field(word("tree.choice.04"), `<input id="new_${key}_title" dir="auto">`)}${field(word("tree.06"), `<input id="new_${key}_name" dir="auto">`)}${knownAsField('new_'+key+'_known_as')}<div id="matches_${key}" aria-live="polite"></div></div>`);
  modal(`<h2 style="margin-top:0">${yahrzeit ? htmlWord("tree.person_form.10") : id ? '✏️ ' + esc(personName(p,p.name)) : htmlWord("tree.person_form.11")}</h2><form data-form="person" data-id="${id}" data-yahrzeit="${yahrzeit ? '1' : ''}" data-suggestion="${suggestion?'1':''}" data-legacyid="${p.legacy_yahrzeit_id||''}">${p.legacy_yahrzeit_id?`<p class="muted">${htmlWord("tree.person_form.12")}</p>`:''}
  ${suggestion ? `<p class="muted">${htmlWord('family_tools.suggestions.explain')}</p>` : ''}
  <div class="grid g2"><div>${field(word("tree.choice.04"),`<input id="ptitle" value="${esc(p.title)}" placeholder="${htmlWord("tree.person_form.13")}">`)}</div><div>${field(word("tree.06"),`<input id="pn" value="${esc(p.name)}">`)}</div></div>
  <div id="personmatches" aria-live="polite"></div>
  ${knownAsField('pknownas',p.known_as)}
  <label><input id="pdistinct" type="checkbox"> ${htmlWord("tree.person_form.02")}</label>
  ${field(word("tree.person_form.14"), '<textarea id="pdistinctreason" maxlength="500"></textarea>')}
  <p class="muted">${htmlWord("tree.person_form.03")}</p>
  ${suggestion ? '' : `<fieldset class="person-family-picker"><legend>${htmlWord("tree.person_form.04")}</legend>
  <p class="muted">${htmlWord("tree.person_form.05")}${ME.is_admin?` ${htmlWord("tree.person_form.15")}`:''}</p>
  <div class="person-family-options">${familyChoices(P).map(f=>`<label><input type="checkbox" name="person_family" value="${f.id}" ${(p.families || []).some(x=>x.id===f.id)?'checked':''}><strong>${esc(f.name)}</strong></label>`).join('')}</div>
  <details><summary>${htmlWord("tree.person_form.06")}</summary>${field(word("tree.person_form.16"),`<input id="pnewfamily" maxlength="80">`)}</details></fieldset>`}
  ${choice('father_id',word("tree.08"))}${choice('mother_id',word("tree.09"))}${choice('spouse_id',word("tree.person_profile.02"))}${choice('second_spouse_id',word("tree.person_profile.03"))}<p class="muted">${htmlWord("tree.person_form.07")}</p>
  ${p.parent_id ? choice('parent_id',word("tree.person_form.17")) : '<input type="hidden" id="pparent_id" value="">'}
  ${p.spouse && !p.spouse_id ? `<p class="muted">${htmlWord("tree.person_form.18", { spouse: p.spouse })}</p>` : ''}
  ${field(word("tree.person_form.19"),`<select id="plineage"><option value="">${htmlWord("tree.child_row.01")}</option><option value="בן" ${p.lineage_term==='בן'?'selected':''}>${htmlWord("tree.person_form.20")}</option><option value="בת" ${p.lineage_term==='בת'?'selected':''}>${htmlWord("tree.person_form.21")}</option></select>`)}
  ${field(word("tree.person_form.22"),`<select id="pside">${sideOptions(p.side)}</select>`)}
  ${yahrzeit ? '<input id="plife" type="hidden" value="deceased">' : field(word("tree.person_form.23"),`<select id="plife"><option value="unknown" ${!p.life_status||p.life_status==='unknown'?'selected':''}>${htmlWord("tree.child_row.01")}</option><option value="living" ${p.life_status==='living'?'selected':''}>${htmlWord("tree.person_profile.12")}</option><option value="deceased" ${p.life_status==='deceased'?'selected':''}>${htmlWord("tree.person_profile.11")}</option></select>`)}
  ${yahrzeit ? `<section><h3>${htmlWord("tree.person_form.24")}</h3>` : `<details ${p.niftar||p.life_status==='deceased'?'open':''}><summary>${htmlWord("tree.person_form.25")}</summary>`}
  <div class="grid g2"><div>${field(word("tree.person_form.26"),`<select id="pday" ${yahrzeit?'required':''}><option value="">${htmlWord("tree.person_form.27")}</option>${Array.from({length:30},(_,i)=>`<option value="${i+1}" ${p.death_hday===i+1?'selected':''}>${esc(hebD(i+1))}</option>`).join('')}</select>`)}</div>
  <div>${field(word("tree.person_form.28"),`<select id="pmonth" ${yahrzeit?'required':''}><option value="">${htmlWord("tree.person_form.27")}</option>${HMONTHS.map(([k,t])=>`<option value="${k}" ${p.death_hmonth===k?'selected':''}>${htmlWord(t)}</option>`).join('')}</select>`)}</div></div>
  ${field(word("tree.person_form.29"),`<input id="pyear" type="number" min="5001" max="5999" value="${esc(p.death_year||'')}">`)}
  <p class="muted">${htmlWord("tree.person_form.08")}</p>${yahrzeit ? '</section>' : '</details>'}
  ${field(word("tree.person_form.30"),`<input id="pkever" value="${esc(p.kever)}" placeholder="${htmlWord("tree.person_form.31")}">`)}
  ${field(word("tree.person_form.32"),`<input id="pkeveraddress" dir="auto" value="${esc(p.kever_address)}" placeholder="${htmlWord("tree.person_form.33")}">`)}
  ${field(word("tree.person_form.34"),`<input id="pno" value="${esc(p.note)}">`)}
  ${yahrzeit ? '' : `<details${Object.keys(p.calendar_dates || {}).length?' open':''}><summary>${htmlWord('family_tools.calendar.profile_dates')}</summary>${dateKinds.map(kind=>calendarDateFields(p,kind)).join('')}</details>`}
  ${suggestion ? field(word('family_tools.suggestions.note'), '<textarea id="person-suggestion-note" maxlength="500"></textarea>') : ''}
  <div class="err" id="ferr" role="alert"></div><div class="btns"><button class="btn">${htmlWord(suggestion ? 'family_tools.suggestions.send' : yahrzeit ? 'tree.person_form.35' : 'tree.person_form.36')}</button><button type="button" class="btn l" data-act="close">${htmlWord("tree.person_form.09")}</button>
  ${id ? `<button type="button" class="btn l" data-act="addchild" data-id="${id}">${htmlWord("tree.person_form.37")}</button>${suggestion ? '' : `<button type="button" class="btn r" data-act="delp" data-id="${id}">🗑</button>`}` : ''}</div></form>`);
  renderPersonMatches();
  if(defaults.openRelative){const key=defaults.openRelative;$('p'+key).value='new';$('new_'+key).hidden=false;$('new_'+key+'_name').focus();}
}

// learning
V.learn = async (arg) => {
  if (arg) return learnDetail(Number(arg));
  const [{ lists },{people}] = await Promise.all([api('/lists'),api('/people')]); STATE.learningLists=lists; const L = lists.filter(l => vis(l.side) && (!STATE.learnFamily || (l.families||[]).some(f=>f.id===Number(STATE.learnFamily))));
  return `${viewHeader(htmlWord("learning.heading"), workspacePicker() + `<button type="button" class="btn s" data-act="newlist">${htmlWord("learning.new_list")}</button>`)}
  <div class="list-tools">${seg()}${familySelector([...lists,...people],'learnFamily',word("learning.learn.04"))}<a class="muted" href="#me">${htmlWord("learning.learn.01")}</a></div>
  ${L.map((l) => `<a class="card" href="#learn/${l.id}" style="display:block;text-decoration:none;color:inherit;margin-bottom:10px"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:18px">${l.kind === 'tehillim' ? htmlWord("learning.learn.08") : htmlWord("learning.learn.09")} ${htmlWord("learning.learn.05", { name: l.niftar })}</b>${familyTags(l)}</div>
  <div class="muted">${l.target_date ? htmlWord("learning.learn.10", { date: gdate(l.target_date), days: inDays(l.days) }) : htmlWord("learning.learn.11")}${l.mine ? ` ${htmlWord("learning.learn.12", { mine: l.mine })}` : ''}</div>
  <div class="bar"><div style="width:${Math.round(100 * l.taken / l.total)}%"></div></div><div class="muted">${htmlWord("learning.learn.06", { taken: l.taken, total: l.total })}${l.partial?` ${htmlWord("learning.learn.13", { partial: l.partial })}`: ''} ${htmlWord("learning.learn.07", { done: l.done })}</div></a>`).join('') || empty('📖', word("learning.learn.15"))}`;
};
async function learnDetail(id) {
  await useLinkedFamily();
  const { list: l, items, masechtos, help=[], daily_plan, remaining_units, plan_date, reminder_hour, reminder_timezone } = await api('/lists/' + id); STATE.list = { l, items, masechtos, help };
  const taken = items.filter(i => i.parts ? i.parts.taken===i.parts.total : i.taken_by).length, done = items.filter(i => i.parts ? i.parts.done===i.parts.total : i.done).length;
  const partial = items.filter(i=>i.parts && i.parts.taken>0 && i.parts.taken<i.parts.total).length;
  const cls = i => i.done?'pk done':i.taken_by===ME.id?'pk mine':i.taken_by||i.parts?.taken?'pk t':'pk';
  const assignees=i=>{
    const people=i.parts?.assignees||[];
    return people.length?`<small>${htmlWord("learning.assignees.01")} ${people.map(p=>esc(p.name)+(people.length>1?' ('+p.count+')':'')).join(' · ')}</small>`:'';
  };
  const body = l.kind === 'tehillim'
    ? `<div class="perek">${items.map((i) => `<button class="${cls(i)}" data-act="item" data-idx="${i.idx}" title="${esc(i.taken_name || '')}">${heb(i.idx)}</button>`).join('')}</div>`
    : [...new Set(masechtos.map((m) => m.seder))].map((sd) => `<h2 style="font-size:17px">${htmlWord("learning.learn_detail.01", { sd: sd })}</h2><div class="ms">${items.filter((i) => masechtos[i.idx].seder === sd).map((i) => `<button class="${cls(i)}" data-act="masechta" data-idx="${i.idx}">${masechtos[i.idx].name} ▾<small>${i.parts ? i.parts.taken + ' / ' + i.parts.total + ` ${htmlWord("learning.learn_detail.02")}` : i.taken_by ? esc(i.taken_name || '') + (i.done ? ' ✓' : '') : htmlWord("learning.learn_detail.03")}</small>${assignees(i)}</button>`).join('')}</div>`).join('');
  return `<a href="#learn" class="muted">${htmlWord("learning.learn_detail.04")}</a><h1 class="learning-title">${l.kind === 'tehillim' ? htmlWord("learning.learn.08") : htmlWord("learning.learn.09")} ${htmlWord("learning.learn_detail.05", { name: l.niftar })}</h1>
  <div class="cap">${l.target_date ? htmlWord("learning.learn.10", { date: gdate(l.target_date), days: inDays(l.days) }) : ''} ${sideTag(l.side)}${familyTags(l)}</div>
  <div class="card" style="margin-bottom:12px"><div class="bar"><div style="width:${Math.round(100 * taken / items.length)}%"></div></div><div class="muted">${htmlWord("learning.learn_detail.06", { taken: taken, length: items.length })}${partial ? ` ${htmlWord("learning.learn.13", { partial: partial })}` : ''}</div>
  <div class="bar"><div class="dn" style="width:${Math.round(100 * done / items.length)}%"></div></div><div class="muted">${htmlWord("learning.learn_detail.07", { done: done })}</div>
  <div class="muted" style="margin-top:6px"><span class="pk" style="padding:2px 8px">${htmlWord("learning.learn_detail.08")}</span> <span class="pk mine" style="padding:2px 8px">${htmlWord("learning.learn_detail.09")}</span> <span class="pk t" style="padding:2px 8px">${htmlWord("learning.learn_detail.10")}</span> <span class="pk done" style="padding:2px 8px">${htmlWord("learning.learn_detail.11")}</span></div></div>
  <section class="card" style="margin-bottom:14px"><h2>${htmlWord("learning.learn_detail.12")}</h2><p>${esc(plan_date || '')} · ${remaining_units || 0} ${l.kind==='tehillim'?htmlWord("learning.learn_detail.15"):htmlWord("learning.learn_detail.16")} ${htmlWord("learning.learn_detail.13")}${daily_plan?.days ? ' · '+daily_plan.days+` ${htmlWord("learning.learn_detail.17")}` : ''}</p>${daily_plan ? `<details open><summary>${htmlWord("learning.learn_detail.18", { length: daily_plan.lines.length })}</summary><ul>${daily_plan.lines.map(line=>`<li>${esc(line)}</li>`).join('')}</ul></details>${!l.target_date?`<p class="muted">${htmlWord("learning.learn_detail.20")}</p>`:''}<p>${htmlWord("learning.learn_detail.19")}</p>` : `<p>${remaining_units ? htmlWord("learning.learn_detail.21") : htmlWord("learning.learn_detail.22")}</p>`}<p><a href="#me">✉ ${ME.learning_email_reminders?htmlWord("learning.learn_detail.23"):htmlWord("learning.learn_detail.24")}</a> · ${reminder_hour}:00 (${esc(reminder_timezone || '')})</p></section>
  ${help.length ? `<section class="card" style="margin-bottom:14px"><h2>${htmlWord("learning.learn_detail.25")}</h2>${help.map(h=>`<div class="row"><div class="grow"><b>${esc(h.requested_name)}</b> · ${esc(portionLabel(h.idx,h.chapter,h.mishnah))}<p>${esc(h.note)}</p><small>${h.helper_id ? esc(h.helper_name)+` ${htmlWord("learning.learn_detail.26")}` : htmlWord("learning.learn_detail.27")}</small></div><div class="btns">${h.requested_by!==ME.id && !h.helper_id ? `<button class="btn s" data-act="learninghelp" data-id="${h.id}" data-v="help">${htmlWord("learning.learn_detail.28")}</button>`:''}${h.requested_by===ME.id||isManager() ? `<button class="btn s l" data-act="learninghelp" data-id="${h.id}" data-v="resolve">${htmlWord("learning.learn_detail.29")}</button>`:''}</div></div>`).join('')}</section>`:''}
  <div class="btns" style="margin-bottom:12px"><button class="btn" data-act="sharelearn">${htmlWord("learning.learn_detail.14")}</button>${l.kind==='mishnayos'&&managesAccounts()?`<button class="btn l" data-act="emaillearn">${htmlWord("learning.learn_detail.30")}</button>`:''}</div>
  <div class="card">${body}</div>
  ${isManager() || l.created_by === ME.id ? `<button class="btn r s" style="margin-top:14px" data-act="dellist" data-id="${l.id}">${htmlWord("learning.learn_detail.31")}</button>` : ''}`;
}
function itemLabel(idx) { const { l, masechtos } = STATE.list; return l.kind === 'tehillim' ? `${word("learning.item_label.01")} ` + heb(idx) : `${word("learning.item_label.02")} ` + masechtos[idx].name; }
async function onItem(idx) {
  const { l, items } = STATE.list; const it = items.find((i) => i.idx === idx);
  if (!it.taken_by) { await api(`/lists/${l.id}/items/${idx}`, { method: 'POST', body: { action: 'take' } }); toast(`${word("learning.on_item.01")} ` + itemLabel(idx)); return go(); }
  if (it.taken_by !== ME.id) {
    if (isManager()) return modal(`<h2 style="margin-top:0">${esc(itemLabel(idx))}</h2><p>${htmlWord("learning.on_item.02", { taken_name: it.taken_name })}</p><div class="btns"><button class="btn r" data-act="itemact" data-idx="${idx}" data-v="give">${htmlWord("learning.on_item.03")}</button><button class="btn l" data-act="close">${htmlWord("learning.on_item.04")}</button></div>`);
    return toast(word("learning.on_item.05", { portion: itemLabel(idx), taken_name: it.taken_name }));
  }
  modal(`<h2 style="margin-top:0">${esc(itemLabel(idx))}</h2><p class="muted">${htmlWord("learning.on_item.06")}</p><div class="btns">
  ${it.done ? `<button class="btn l" data-act="itemact" data-idx="${idx}" data-v="undone">${htmlWord("learning.on_item.08")}</button>` : `<button class="btn g" data-act="itemact" data-idx="${idx}" data-v="done">${htmlWord("learning.on_item.09")}</button>`}
  <button class="btn r" data-act="itemact" data-idx="${idx}" data-v="give">${htmlWord("learning.on_item.07")}</button><button class="btn l" data-act="close">${htmlWord("learning.on_item.04")}</button></div>`);
}
function portionLabel(idx,chapter=0,mishnah=0) {
  return itemLabel(idx)+(chapter?` ${word("learning.portion_label.01")} `+hebD(chapter):'')+(mishnah?` ${word("learning.portion_label.02")} `+hebD(mishnah):'');
}
async function openMasechta(idx) {
  const {items}=await api(`/lists/${STATE.list.l.id}/items/${idx}/parts`); STATE.portions={idx,items};
  const chapters=STATE.list.masechtos[idx].chapters;
  modal(`<h2>${esc(itemLabel(idx))}</h2><p class="muted">${htmlWord("learning.open_masechta.01")}</p><button class="btn" data-act="portion" data-c="0" data-m="0">${htmlWord("learning.open_masechta.02")}</button>
    ${chapters.map((n,c)=>{const rows=items.filter(p=>p.chapter===c+1);return `<details class="card" style="margin-top:10px"><summary style="cursor:pointer;padding:8px">${htmlWord("learning.open_masechta.03", { number: hebD(c+1), count: rows.filter(p=>p.taken_by).length, count2: n })}</summary><button class="btn s l" data-act="portion" data-c="${c+1}" data-m="0">${htmlWord("learning.open_masechta.04")}</button><div class="ms" style="margin-top:10px">${rows.map(p=>`<button class="pk ${p.done?'done':p.taken_by===ME.id?'mine':p.taken_by?'t':''}" data-act="portion" data-c="${p.chapter}" data-m="${p.mishnah}">${htmlWord("learning.open_masechta.05", { number: hebD(p.mishnah) })}<small>${p.taken_by?esc(p.taken_name):htmlWord("learning.learn_detail.08")}${p.done?' ✓':''}</small></button>`).join('')}</div></details>`;}).join('')}<button class="btn l" data-act="close">${htmlWord("learning.on_item.04")}</button>`,true);
}
function openPortion(chapter,mishnah) {
  const {idx,items}=STATE.portions, rows=items.filter(p=>(!chapter||p.chapter===chapter)&&(!mishnah||p.mishnah===mishnah));
  const own=rows.every(p=>p.taken_by===ME.id),available=rows.every(p=>!p.taken_by||p.taken_by===ME.id),allDone=rows.every(p=>p.done);
  STATE.portionScope={idx,chapter,mishnah};
  modal(`<h2>${esc(portionLabel(idx,chapter,mishnah))}</h2><p>${htmlWord("learning.open_portion.01", { count: rows.filter(p=>p.taken_by).length, length: rows.length, count2: rows.filter(p=>p.done).length })}</p><div class="btns">
    ${available&&!own?`<button class="btn" data-act="portionaction" data-v="take">${htmlWord("learning.open_portion.05")}</button>`:''}
    ${own?`<button class="btn g" data-act="portionaction" data-v="${allDone?'undone':'done'}">${allDone?htmlWord("learning.on_item.08"):htmlWord("learning.on_item.09")}</button><button class="btn l" data-act="portionaction" data-v="give">${htmlWord("learning.on_item.07")}</button>`:''}
    ${isManager()&&!own&&rows.some(p=>p.taken_by)?`<button class="btn r" data-act="portionaction" data-v="give">${htmlWord("learning.open_portion.06")}</button>`:''}
    </div>${!available?`<p class="muted">${htmlWord("learning.open_portion.07")}</p>`:''}
    <form data-form="portionhelp" style="margin-top:18px"><h3>${htmlWord("learning.open_portion.02")}</h3>${field(word("learning.open_portion.08"), `<textarea id="helpnote" maxlength="500" placeholder="${htmlWord("learning.open_portion.09")}"></textarea>`)}<div class="err" role="alert"></div><button class="btn l">${htmlWord("learning.open_portion.03")}</button></form><button class="btn l" style="margin-top:12px" data-act="backmasechta">${htmlWord("learning.open_portion.04")}</button>`);
}
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
  if (yzId&&!byId.has(yzId)) throw new Error(word("learning.list_form.15"));
  const defaultSide=STATE.side==='all' ? mySides()[0] : STATE.side;
  const familyName=ME.family_groups?.find(g=>g.id===group)?.name || S.family_yi;
  const optionsMarkup=(rows,selected)=>rows.map(y=>`<label class="dedication-option" data-search="${esc(memorialSearch(`${yahrzeitName(y)} ${y.hebrew}`))}">
    <input type="checkbox" name="learning-yahrzeit" value="${y.id}" ${selected.has(y.id)?'checked':''}>
    <span><strong>${esc(yahrzeitName(y))}</strong><small>${esc(y.hebrew)}</small></span></label>`).join('');
  modal(`<h2 id="learning-create-title" tabindex="-1">${htmlWord("learning.list_form.16")}</h2>
  <form id="learning-create-form" data-form="list">
  <div class="learning-form-body">
    ${field(word("learning.list_form.22"), `<select id="lk"><option value="tehillim">${htmlWord("learning.list_form.23")}</option><option value="mishnayos">${htmlWord("learning.list_form.24")}</option></select>`)}
    <fieldset class="dedication-picker"><legend>${htmlWord("learning.list_form.17", { familyName: familyName })}</legend>
      <div class="learning-source">
        <label><input type="radio" name="learning-source" checked> ${htmlWord("learning.list_form.18")}</label>
        <label><input type="radio" name="learning-source" id="learning-custom"> ${htmlWord("learning.list_form.19")}</label>
      </div>
      <div id="learning-picker">
        <div class="learning-search-row">
          <div>${field(word("learning.list_form.03"), '<input id="learning-search" type="search" autocomplete="off">')}</div>
          <button type="button" id="learning-refresh" class="btn s l">${htmlWord("learning.list_form.04")}</button>
        </div>
        <div class="dedication-options" id="learning-options">${optionsMarkup(memorials,new Set([yzId]))}</div>
        <p id="learning-no-results" class="muted" hidden>${htmlWord("learning.list_form.20")}</p>
        <div id="learning-selection" class="learning-selection">
          <p id="learning-selected-count" class="muted" role="status"></p>
          <div id="learning-selected-names"></div>
        </div>
      </div>
      <div id="learning-manual" hidden>${field(word("learning.list_form.25"), `<input id="ln" maxlength="150" placeholder="${htmlWord("learning.list_form.26")}">`)}</div>
    </fieldset>
    <div class="learning-list-settings">
      <div>${field(word("learning.list_form.27"), '<input id="ld" type="date" aria-describedby="learning-due-hint">')}<p id="learning-due-hint" class="muted"></p></div>
      <div>${field(word("learning.list_form.28"), `<select id="ls" aria-describedby="learning-side-hint">${sideOptions(defaultSide)}</select>`)}<p id="learning-side-hint" class="muted" hidden>${htmlWord("learning.list_form.21")}</p></div>
    </div>
  </div>
  <div class="learning-form-footer"><div class="err" role="alert"></div><div class="btns"><button type="submit" class="btn">${htmlWord("learning.list_form.06")}</button><button type="button" class="btn l" data-act="close">${htmlWord("learning.list_form.07")}</button></div></div>
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
    $('learning-selected-count').textContent=selected.length?word("learning.update_selection.01", { length: selected.length }):word("learning.update_selection.02");
    $('learning-selected-names').innerHTML=selected.map(y=>`<button type="button" data-remove="${y.id}" aria-label="${htmlWord("learning.update_selection.03", { value: yahrzeitName(y) })}"><span>${esc(yahrzeitName(y))}</span><span aria-hidden="true">×</span></button>`).join('');
    const date=selected.map(y=>y.next?.ymd).filter(Boolean).sort()[0];
    $('learning-due-hint').textContent=date?word("learning.update_selection.05", { date: gdate(date), value2: selected.length>1?` ${word("learning.update_selection.04")}`:'' }):word("learning.update_selection.06");
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
  if (id) await useLinkedFamily();
  const past = STATE.simPast;
  const { simchas } = await api('/simchas' + (id ? '?id='+encodeURIComponent(id) : past ? '?past=1' : '')); STATE.sims = simchas;
  if (id) return `<h1>${htmlWord("simchas.sim.01")}</h1><p><a href="#sim">${htmlWord("simchas.sim.02")}</a></p>${simchas.length ? simchas.map(simCard).join('') : empty('🎉',word("simchas.sim.03"))}`;
  return `${viewHeader(htmlWord("simchas.sim.04"), workspacePicker() + `<button class="btn s" data-act="editsim" data-id="0">${htmlWord("simchas.sim.06")}</button>`)}
  <div class="list-tools"><div class="seg"><button class="${past ? '' : 'on'}" data-act="simpast" data-v="0">${htmlWord("simchas.sim.07")}</button><button class="${past ? 'on' : ''}" data-act="simpast" data-v="1">${htmlWord("simchas.sim.08")}</button></div></div>
  ${simchas.length ? `<div class="simgrid">${simchas.map(simCard).join('')}</div>` : empty('🎉', past ? word("simchas.sim.09") : word("simchas.sim.10"))}`;
};
function simCard(x) {
  const mine = isManager() || x.created_by === ME.id;
  const file = x.file_id ? (x.file_mime === 'application/pdf'
    ? `<div class="pdf" data-act="showinv" data-id="${x.id}">📄 <div class="grow"><b>${htmlWord("simchas.sim_card.01")}</b><div class="muted">${esc(x.file_name)}</div></div></div>`
    : `<img class="inv" src="/api/files/${x.file_id}" alt="${htmlWord("simchas.sim_card.02")}" loading="lazy" data-act="showinv" data-id="${x.id}">`) : '';
  const people = x.my_people || 1;
  return `<div class="card"><div style="display:flex;gap:8px;align-items:flex-start"><div class="grow"><b style="font-size:19px">${esc(simchaKind(x.kind))} · ${esc(x.whose)}</b></div>${sideTag(x.audience)}</div>
  <div style="margin:6px 0 10px;display:grid;gap:3px"><div>📅 ${esc(gdate(x.gdate))} <span class="muted">· ${esc(x.hebrew)} · ${esc(inDays(x.days))}</span></div>${x.time_text ? `<div>🕖 ${esc(x.time_text)}</div>` : ''}
  ${x.hall ? `<div>🏛️ ${esc(x.hall)}</div>` : ''}${x.address ? `<div>📍 <span dir="auto">${esc(x.address)}</span></div>` : ''}${x.note ? `<div class="muted">${esc(x.note)}</div>` : ''}</div>
  ${x.address ? `<div class="btns" style="margin-bottom:10px">${navBtns(x.address)}</div>` : ''}
  ${file}
  <div class="btns" style="margin:10px 0">${x.file_id ? `<button class="btn s l" data-act="showinv" data-id="${x.id}">${htmlWord("simchas.sim_card.09")}</button><a class="btn s l" href="/api/files/${x.file_id}?dl=1">${htmlWord("simchas.sim_card.10")}</a>` : ''}
  ${mine ? `<label class="btn s l" style="cursor:pointer">⬆ ${x.file_id ? htmlWord("simchas.sim_card.11") : htmlWord("simchas.sim_card.12")} ${htmlWord("simchas.sim_card.02")}<input type="file" accept="image/*,application/pdf" style="display:none" data-change="upinv" data-id="${x.id}"></label>` : ''}</div>
  <div style="border-top:1px solid #eef0f3;padding-top:10px">
  <div class="btns"><button class="btn s ${x.my_answer === 'yes' ? 'g' : 'l'}" data-act="rsvp" data-id="${x.id}" data-v="yes">${htmlWord("simchas.sim_card.03")}</button>
  <span class="stepper"><button data-act="ppl" data-id="${x.id}" data-d="-1">−</button><span id="ppl${x.id}">${people}</span><button data-act="ppl" data-id="${x.id}" data-d="1">+</button></span><span class="muted">${htmlWord("simchas.sim_card.04")}</span>
  <button class="btn s ${x.my_answer === 'no' ? 'r' : 'l'}" data-act="rsvp" data-id="${x.id}" data-v="no">${htmlWord("simchas.sim_card.05")}</button></div>
  <div class="muted" style="margin-top:8px"><a href="#" data-act="who" data-id="${x.id}">${htmlWord("simchas.sim_card.06", { yes_count: x.yes_count, yes_people: x.yes_people, no_count: x.no_count })}</a></div></div>
  <div class="btns" style="margin-top:10px"><button class="btn s l" data-act="sharesim" data-id="${x.id}">${htmlWord("simchas.sim_card.07")}</button><button class="btn s l" data-act="mazeltov" data-id="${x.id}">${htmlWord("simchas.sim_card.08")}</button>${mine ? `<button class="btn s l" data-act="editsim" data-id="${x.id}">${htmlWord("simchas.sim_card.13")}</button>` : ''}</div></div>`;
}
function shareSim(x) {
  const link = `${location.origin}/#sim/${x.id}/${ME.selected_family_group_id}`;
  const subject = `${simchaKind(x.kind)} · ${x.whose}`;
  const message = [subject, gdate(x.gdate), x.time_text, x.hall, x.address, link].filter(Boolean).join('\n');
  const body = encodeURIComponent(message);
  modal(`<h2>${htmlWord("simchas.sim_card.07")}</h2><p>${htmlWord("simchas.share_sim.01")}</p><textarea id="rl" readonly rows="7" aria-label="Invitation message">${esc(message)}</textarea><div class="btns"><a class="btn g" href="https://wa.me/?text=${body}" target="_blank" rel="noopener">${htmlWord("simchas.share_sim.02")}</a>${(isManager()||x.created_by===ME.id)?`<button class="btn l" data-act="emailsim" data-id="${x.id}">${htmlWord("simchas.share_sim.05")}</button>`:''}<a class="btn l" href="sms:?body=${body}">SMS</a><button class="btn l" data-act="copy">${htmlWord("simchas.share_sim.03")}</button><button class="btn l" data-act="close">${htmlWord("simchas.share_sim.04")}</button></div>`);
}
async function emailSim(id,scope=ME.is_admin?'all':'family') {
  const p=await api(`/simchas/${id}/email?scope=${scope}`);
  modal(`<h2>${htmlWord("simchas.email_sim.01")}</h2><p>${htmlWord("simchas.email_sim.02")}</p>${ME.is_admin?field(word("simchas.email_sim.11"),`<select data-change="emailscope" data-id="${id}"><option value="all" ${scope==='all'?'selected':''}>${htmlWord("simchas.email_sim.12")}</option><option value="family" ${scope==='family'?'selected':''}>${htmlWord("simchas.email_sim.13")}</option></select>`):''}<p><b>${htmlWord("simchas.email_sim.03", { recipients: p.recipients })}</b> ${htmlWord("simchas.email_sim.04", { skipped: p.skipped })}</p>${scope==='all'?`<p>${htmlWord("simchas.email_sim.14")}</p>`:''}<p>${htmlWord("simchas.email_sim.05", { sent: p.sent, queued: p.queued, failed: p.failed })}</p>${!p.configured?`<p role="alert">${htmlWord("simchas.email_sim.15")}</p>`:''}<form data-form="simemail" data-id="${id}" data-scope="${scope}"><label><input type="checkbox" id="emailconfirm" required> ${htmlWord("simchas.email_sim.06")}</label><p>${htmlWord("simchas.email_sim.07")}</p><div class="err" role="alert"></div><div class="btns"><button class="btn" ${!p.configured||!p.recipients?'disabled':''}>${htmlWord("simchas.email_sim.08")}</button><button type="button" class="btn l" data-act="emailstatus" data-id="${id}" data-scope="${scope}">${htmlWord("simchas.email_sim.09")}</button><button type="button" class="btn l" data-act="close">${htmlWord("simchas.email_sim.10")}</button></div></form>`);
}
function simForm(id) {
  const x = (STATE.sims || []).find((s) => s.id === id) || { audience: 'all', whose: ME.name, kind: SIMKINDS[0] };
  const afterSunset = !!x.gdate && x.hdate_text === automaticHebrewDate(x.gdate, true);
  const kinds = SIMKINDS.includes(x.kind) ? SIMKINDS : [x.kind, ...SIMKINDS];
  modal(`<h2 style="margin-top:0">${id ? htmlWord("simchas.sim_form.02") : htmlWord("simchas.sim_form.03")}</h2><form data-form="sim" data-id="${id}">
  ${field(word("simchas.sim_form.04"), `<select id="sk">${kinds.map((k) => `<option value="${esc(k)}" ${x.kind === k ? 'selected' : ''}>${esc(simchaKind(k))}</option>`).join('')}</select>`)}
  <div id="skow" style="display:none">${field(word("simchas.sim_form.05"), '<input id="sko">')}</div>
  ${field(word("simchas.sim_form.06"), `<input id="sw" value="${esc(x.whose)}">`)}
  <div class="grid g2"><div>${field(word("simchas.sim_form.07"), `<input id="sd" type="date" value="${esc(x.gdate || '')}">`)}</div><div>${field(word("simchas.sim_form.08"), `<input id="stt" value="${esc(x.time_text || '')}" placeholder="${htmlWord("simchas.sim_form.09")}">`)}</div></div>
  ${field(word("simchas.sim_form.10"), `<input id="sh" value="${esc(x.hdate_text || automaticHebrewDate(x.gdate || ''))}" placeholder="${htmlWord("simchas.sim_form.11")}">`)}
  <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><input type="checkbox" id="safter" ${afterSunset?'checked':''}>${htmlWord("simchas.sim_form.01")}</label>
  ${field(word("simchas.sim_form.12"), `<input id="sp" value="${esc(x.hall || '')}">`)}
  ${field(word("simchas.sim_form.13"), `<input id="sa" dir="auto" value="${esc(x.address || '')}" placeholder="51 Forest Rd, Monroe, NY">`)}
  ${field(word("simchas.sim_form.14"), `<input id="sn" value="${esc(x.note || '')}">`)}
  ${id ? '' : field(word("simchas.sim_form.15"), '<input type="file" id="sf" accept="image/*,application/pdf">')}<div id="ip"></div>
  ${field(word("simchas.sim_form.16"), `<select id="ss">${sideOptions(x.audience, true, word("simchas.sim_form.17"))}</select>`)}
  <div class="err" id="ferr"></div><div class="btns"><button class="btn" id="simsave">${id ? htmlWord("simchas.sim_form.18") : htmlWord("simchas.sim_form.19")}</button><button type="button" class="btn l" data-act="close">${htmlWord("simchas.email_sim.10")}</button>
  ${id ? `${x.file_id ? `<button type="button" class="btn l" data-act="delinv" data-id="${id}">${htmlWord("simchas.sim_form.20")}</button>` : ''}<button type="button" class="btn r" style="margin-right:auto" data-act="delsim" data-id="${id}">🗑</button>` : ''}</div></form>`);
}
function showInv(id) {
  const x = STATE.sims.find((s) => s.id === id); const u = '/api/files/' + x.file_id;
  modal(`<h2 style="margin-top:0">${esc(simchaKind(x.kind))} · ${esc(x.whose)}</h2>${x.file_mime === 'application/pdf' && window.innerWidth <= 800
    ? `<a class="pdf" href="${u}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit;padding:28px">📄 <div class="grow"><b>${htmlWord("simchas.show_inv.02")}</b><div class="muted">${esc(x.file_name)}</div></div></a>`
    : x.file_mime === 'application/pdf' ? `<iframe src="${u}" style="width:100%;height:65vh;border:1px solid #e6e8ec;border-radius:10px"></iframe>` : `<img src="${u}" style="width:100%;border-radius:10px;border:1px solid #e6e8ec">`}
  <div class="btns" style="margin-top:12px"><a class="btn l" href="${u}?dl=1">${htmlWord("simchas.sim_card.10")}</a><a class="btn l" href="${u}" target="_blank" rel="noopener">${htmlWord("simchas.show_inv.01")}</a><button class="btn l" data-act="close">${htmlWord("simchas.share_sim.04")}</button></div>`, true);
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
  return `${viewHeader('💬 ' + (dm ? htmlWord("chat.04") + ' ' + esc(peers.find(p=>p.id===dm)?.name||'') : htmlWord("chat.05")), workspacePicker())}
    <div class="seg">${rooms.map(k=>`<button class="${STATE.room===k?'on':''}" data-act="room" data-v="${k}">${k==='all'?htmlWord("chat.06"):esc(famOf(k)||sideName(k))}</button>`).join('')}</div>
    ${field(word("chat.07"),`<select data-change="privatechat"><option value="">${htmlWord("chat.08")}</option>${peers.filter(p=>p.id!==ME.id).map(p=>`<option value="${p.id}" ${p.id===dm?'selected':''}>${esc(p.name)}</option>`).join('')}</select>`)}
    <div class="card"><div id="chatpresence" class="muted" aria-live="polite">${chatPresence(members)}</div>
    <div class="chat" id="cb">${messages.length?renderMsgs(messages):`<div class="muted" id="cempty">${htmlWord("chat.09")}</div>`}</div>
    <div id="chatreply"></div><div id="mentionchoices" class="btns"></div>
    <form data-form="chat"><div style="display:flex;gap:8px;margin-top:10px"><input id="ci" placeholder="${htmlWord("chat.01")}" style="margin:0" autocomplete="off" enterkeyhint="send"><button class="btn">${htmlWord("chat.02")}</button></div>
    <label class="btn l" style="display:inline-block;margin-top:8px;cursor:pointer">${htmlWord("chat.03")}<input id="cf" type="file" style="display:none" data-change="chatfile"></label><span id="chatfilename" class="muted"></span><div class="err" role="alert"></div></form></div>`;
};
function chatPresence(members) {
  const online=members.filter(p=>p.online);
  return online.length?online.map(p=>`<span style="display:inline-block;margin:4px 0 8px 12px">🟢 ${esc(p.name)} · ${p.active?htmlWord("chat.chat_presence.01"):htmlWord("chat.chat_presence.02")}</span>`).join(''):word("chat.chat_presence.03");
}
function showChatReply() {
  const m=STATE.chatReply;
  $('chatreply').innerHTML=m?`<div class="card" style="padding:8px"><b>${htmlWord("chat.show_chat_reply.01", { name: m.name })}</b><div>${esc((m.body||m.filename||word("chat.show_chat_reply.03")).slice(0,160))}</div><button type="button" class="btn s l" data-act="cancelreply">${htmlWord("chat.show_chat_reply.02")}</button></div>`:'';
}
function mentionChoices() {
  const input=$('ci');if(!input)return;const match=/@([^@\n]*)$/.exec(input.value);
  const choices=match?(STATE.chatMembers||[]).filter(p=>p.id!==ME.id&&p.name.toLocaleLowerCase().includes(match[1].toLocaleLowerCase())).slice(0,8):[];
  $('mentionchoices').innerHTML=choices.map(p=>`<button type="button" class="btn s l" data-act="mentionperson" data-id="${p.id}">@${esc(p.name)}</button>`).join('');
}
let LASTDAY = '';
function renderMsgs(ms, cont) {
  if(!cont)LASTDAY='';
  return ms.map(m=>{const k=dayKey(m.created_at),sep=k!==LASTDAY?`<div class="daysep">${esc(dayLabel(m.created_at))}</div>`:'';LASTDAY=k;
    return `${sep}<div class="bub ${m.user_id===ME.id?'me':''}" data-mid="${m.id}"><span class="muted">${m.user_id===ME.id?htmlWord("chat.render_msgs.02"):esc(m.name)} · ${hm(m.created_at)}</span>
      ${m.reply_to?`<blockquote style="margin:6px 0;padding:6px;border-right:3px solid #818cf8"><small>${htmlWord("chat.render_msgs.04", { value: m.reply_name||word("chat.render_msgs.03") })}</small><div>${esc((m.reply_body||word("chat.show_chat_reply.03")).slice(0,160))}</div></blockquote>`:''}
      ${(m.mentions||[]).length?`<small>${m.mentions.map(p=>`<span class="tag ${p.id===ME.id?'y':'g'}">@${esc(p.name)}</span>`).join(' ')}</small>`:''}
      <div style="white-space:pre-wrap">${esc(m.body)}</div>
      ${m.file_id?`<a class="btn s l" href="/api/files/${encodeURIComponent(m.file_id)}?dl=1" target="_blank" rel="noopener">📎 ${esc(m.filename)} · ${Math.ceil(m.size/1024)} KB</a>`:''}
      <button type="button" class="btn s l" data-act="replymessage" data-id="${m.id}">${htmlWord("chat.render_msgs.01")}</button></div>`;
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
  if (!ME || ME.status !== 'active' || familyChanging) return;
  const group = ME.selected_family_group_id;
  try { const { rooms } = await api('/chat-summary');
    if (familyChanging || group !== ME?.selected_family_group_id) return;
    const u = rooms.some((r) => r.last_id && r.last_id > (SEEN[r.room] || 0) && !(curView() === 'chat' && STATE.room === r.room));
    if (u !== UNREAD) { UNREAD = u; renderNav(curView()); } } catch { /* */ }
}

// directory
V.people = async () => {
  const rosterPath=STATE.cousinFamilies?'/cousins?groups='+STATE.cousinFamilies.join(','):'/cousins';
  const [{ families }, { members, groups, selected }] = await Promise.all([api('/directory'), api(rosterPath)]); STATE.dir = families;
  const Q = STATE.q.trim(); const L = families.filter((d) => vis(d.side) && (!Q || [d.husband, d.wife, d.address, d.parents, d.phone_h, d.phone_w].join(' ').includes(Q)));
  const hasMine = families.some((d) => d.owner_id === ME.id);
  const groupNames=new Map(groups.map(g=>[g.id,g.name]));
  const linkedMembers = members.filter(member => member.person_id != null);
  const unlinkedMembers = members.filter(member => member.person_id == null);
  const memberCard=member=>`<div class="card"><b>${esc(member.name)}</b>${member.id===ME.id?` <span class="tag g">${htmlWord("directory.member_card.01")}</span>`:''}
    <div class="muted">${member.group_ids.map(id=>esc(groupNames.get(id))).join(' · ')}</div><div class="btns">
    ${member.id===ME.id?`<button class="btn s l" data-act="editdir" data-id="${families.find(d=>d.owner_id===member.id)?.id||0}" data-mine="1">${htmlWord("directory.member_card.02")}</button>`:''}
    ${ME.is_admin?`<button class="btn s l" data-act="linkcousin" data-id="${member.id}">${member.person_id?htmlWord("directory.member_card.03"):htmlWord("directory.member_card.04")}</button>`:''}</div></div>`;
  const byFather=new Map();
  for(const member of linkedMembers){
    if(!member.father_id)continue;
    if(!byFather.has(member.father_id))byFather.set(member.father_id,[]);
    byFather.get(member.father_id).push(member);
  }
  const siblingSets=[...byFather.values()].filter(set=>set.length>1);
  const siblingIds=new Set(siblingSets.flatMap(set=>set.map(member=>member.id)));
  const otherLinkedMembers = linkedMembers.filter(member => !siblingIds.has(member.id));
  return `<h1>${htmlWord("directory.people.01")}</h1>
  <h2>${htmlWord("directory.people.03", { length: members.length })}</h2>
  ${groups.length>1?`<fieldset class="cousin-family-filters"><legend>${htmlWord("directory.family_filter")}</legend><div class="btns">${groups.map(g=>`<label><input type="checkbox" name="cousin-family" data-change="cousinfamily" value="${g.id}" ${selected.includes(g.id)?'checked':''}>${esc(g.name)}</label>`).join('')}</div></fieldset>`:''}
  <div id="memberlist">
    ${siblingSets.map(set=>`<section><h3>${set.every(member=>member.lineage_term==='בן')?htmlWord("directory.people.12"):htmlWord("directory.people.13")} ${htmlWord("directory.people.11", { father_name: set[0].father_deceased?withMemorialSuffix(set[0].father_name):set[0].father_name })}</h3><div class="grid g2">${set.map(memberCard).join('')}</div></section>`).join('')}
    ${otherLinkedMembers.length ? `<div class="grid g2">${otherLinkedMembers.map(memberCard).join('')}</div>` : ''}
    ${unlinkedMembers.length ? `<section aria-labelledby="unlinked-cousins-heading">
      <h3 id="unlinked-cousins-heading">${htmlWord("directory.people.18")}</h3>
      <div class="grid g2">${unlinkedMembers.map(memberCard).join('')}</div>
    </section>` : ''}
    ${members.length?'':`<p class="muted">${htmlWord("directory.people.14")}</p>`}
  </div><h2>${htmlWord("directory.people.04", { family: S.family_yi })}</h2>
  <div class="list-tools">${workspacePicker()}${seg()}</div>
  ${hasMine ? '' : `<div class="row" style="background:#eef2ff;border-color:#c7d2fe"><div class="grow"><b>${htmlWord("directory.people.15")}</b><div class="muted">${htmlWord("directory.people.16")}</div></div><button class="btn s" data-act="editdir" data-id="0" data-mine="1">${htmlWord("directory.people.17")}</button></div>`}
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px"><input id="q" type="search" placeholder="${htmlWord("directory.people.05")}" value="${esc(STATE.q)}" style="margin:0;max-width:340px" data-input="q"><span class="muted" id="qn">${htmlWord("directory.people.06", { length: L.length })}</span>
  <a class="btn s l" href="/api/directory.csv" download>${htmlWord("directory.people.07")}</a><button class="btn s" data-act="editdir" data-id="0">${htmlWord("directory.people.08")}</button></div>
  <div class="grid g2" id="dirlist">${dirCards(L)}</div>
  <button class="btn" style="margin-top:14px" data-act="familyinvite">${htmlWord("directory.people.09")}</button>`;
};
function dirCards(L) {
  return L.map((d) => `<div class="card" style="padding:14px"><div style="display:flex;gap:10px;align-items:flex-start"><div class="av">${esc((d.husband || d.wife)[0])}</div><div class="grow"><b style="font-size:18px">${esc(d.husband_deceased?withMemorialSuffix(d.husband):d.husband)}${d.husband && d.wife ? ' · ' : ''}${esc(d.wife_deceased?withMemorialSuffix(d.wife):d.wife)}</b><div class="muted">${esc(d.parents)}</div></div>${sideTag(d.side)}</div>
  <div style="margin-top:10px;display:grid;gap:6px"><div>📍 <span dir="auto">${esc(d.address) || '—'}</span></div><div style="display:flex;gap:14px;flex-wrap:wrap">${d.husband ? `<span><span class="muted">${htmlWord("directory.dir_cards.01")}</span> ${tel(d.phone_h)}</span>` : ''}${d.wife ? `<span><span class="muted">${htmlWord("directory.dir_cards.02")}</span> ${tel(d.phone_w)}</span>` : ''}</div></div>
  <div class="btns" style="margin-top:10px">${isManager() || d.owner_id === ME.id || d.created_by === ME.id ? `<button class="btn s l" data-act="editdir" data-id="${d.id}">${htmlWord("directory.dir_cards.03")}</button>` : ''}${navBtns(d.address)}</div></div>`).join('') || `<div class="muted">${htmlWord("directory.dir_cards.04")}</div>`;
}
async function dirForm(id, mine) {
  const {people}=await api('/directory-people');
  const d = (STATE.dir || []).find((x) => x.id === id) || { side: mySides()[0], husband: mine ? ME.name : '' };
  modal(`<h2 style="margin-top:0">${id ? htmlWord("directory.dir_cards.03") : mine ? htmlWord("directory.people.17") : htmlWord("directory.dir_form.07")}</h2><form data-form="dir" data-id="${id}" data-mine="${mine ? 1 : 0}">
  <p class="muted">${htmlWord("directory.dir_form.01")}</p>
  ${field(word("directory.dir_form.08"),`<select id="dhperson"><option value="">${htmlWord("directory.dir_form.09")}</option>${people.map(p=>`<option value="${p.id}" ${d.husband_person_id===p.id?'selected':''}>${esc(personName(p))}</option>`).join('')}</select>`)}
  ${field(word("directory.dir_form.10"),`<select id="dwperson"><option value="">${htmlWord("directory.dir_form.09")}</option>${people.map(p=>`<option value="${p.id}" ${d.wife_person_id===p.id?'selected':''}>${esc(personName(p))}</option>`).join('')}</select>`)}
  <a href="#tree">${htmlWord("directory.dir_form.02")}</a>
  <p class="muted">${htmlWord("directory.dir_form.03")}</p>
  ${field(word("directory.dir_form.11"), `<input id="dh" value="${esc(d.husband)}">`)}${field(word("directory.dir_form.12"), `<input id="dw" value="${esc(d.wife)}">`)}
  ${field(word("directory.dir_form.13"), `<input id="dp" value="${esc(d.parents)}" placeholder="${htmlWord("directory.dir_form.14")}">`)}
  ${field(word("directory.dir_form.15"), `<select id="ds">${sideOptions(d.side)}</select>`)}
  <h3>${htmlWord("directory.dir_form.04")}</h3>${field(word("directory.dir_form.16"), `<input id="da" dir="auto" autocomplete="address-line1" value="${esc(d.address_line1 ?? d.address)}" placeholder="12 Main St">`)}
  ${field(word("directory.dir_form.17"), `<input id="da2" dir="auto" autocomplete="address-line2" value="${esc(d.address_line2)}" placeholder="Apt 2B">`)}
  <div class="grid g2"><div>${field(word("directory.dir_form.18"), `<input id="dcity" dir="auto" autocomplete="address-level2" value="${esc(d.city)}">`)}</div><div>${field(word("directory.dir_form.19"), `<input id="dstate" dir="auto" autocomplete="address-level1" value="${esc(d.state)}">`)}</div></div>
  <div class="grid g2"><div>${field(word("directory.dir_form.20"), `<input id="dzip" class="ltr" autocomplete="postal-code" value="${esc(d.postal_code)}">`)}</div><div>${field(word("directory.dir_form.21"), `<input id="dcountry" dir="auto" autocomplete="country-name" value="${esc(d.country)}">`)}</div></div>
  <div class="grid g2"><div>${field(word("directory.dir_form.22"), `<input id="dph" type="tel" class="ltr" value="${esc(d.phone_h)}">`)}</div><div>${field(word("directory.dir_form.23"), `<input id="dpw" type="tel" class="ltr" value="${esc(d.phone_w)}">`)}</div></div>
  <div class="err" id="ferr"></div><div class="btns"><button class="btn">${htmlWord("directory.dir_form.05")}</button><button type="button" class="btn l" data-act="close">${htmlWord("directory.dir_form.06")}</button>${id ? `<button type="button" class="btn r" style="margin-right:auto" data-act="deldir" data-id="${id}">🗑</button>` : ''}</div></form>`);
}

async function assignFamilies(id,selected) {
  const u=STATE.users.find(u=>u.id===id);if(!u)return;
  const {groups}=await api('/admin/family-groups');STATE.groups=groups;
  const chosen=selected||(u.family_group_ids||[]).filter(id=>groups.some(g=>g.id===id));
  modal(`<h2>${htmlWord("directory.assign_families.01", { name: u.name })}</h2><p>${htmlWord("directory.assign_families.02")}</p>
  ${!groups.length?`<p role="status">${htmlWord("directory.assign_families.05")}</p>`:''}
  <form data-form="memberships" data-id="${id}"><fieldset><legend>${htmlWord("directory.people.10")} <span id="membershipcount">${chosen.length} / 4</span></legend>
  ${groups.map(g=>`<label style="display:flex;align-items:center;gap:12px;min-height:48px"><input type="checkbox" name="membership" data-change="membershippick" value="${g.id}" ${chosen.includes(g.id)?'checked':chosen.length>=4?'disabled':''}>${esc(g.name)}${g.id===u.family_group_id?` ${htmlWord("directory.assign_families.06")}`:''}</label>`).join('')}</fieldset>
  <div class="err" role="alert"></div><div class="btns"><button class="btn" ${groups.length?'':'disabled'}>${htmlWord("directory.dir_form.05")}</button><button type="button" class="btn l" data-act="close">${htmlWord("directory.dir_form.06")}</button></div></form>
  <hr><label for="assignnewgroup">${htmlWord("directory.assign_families.03")}</label><input id="assignnewgroup" maxlength="120"><button type="button" class="btn l" data-act="createassigngroup" data-id="${id}">${htmlWord("directory.assign_families.04")}</button>`);
}

// admin
V.admin = async () => {
  if (!managesAccounts()) return `<div class="muted">${htmlWord("admin.01")}</div>`;
  const {groups}=await api('/admin/family-groups'); STATE.groups=groups;
  const options=(id)=>`<option value="">${htmlWord("admin.options.01")}</option>`+groups.map(g=>`<option value="${g.id}" ${g.id===id?'selected':''}>${esc(g.name)}</option>`).join('');
  const { users, owner_phone } = await api('/admin/users'); STATE.users = users; PENDING = users.filter((u) => u.status === 'pending').length;
  const pend = users.filter((u) => u.status === 'pending'), rest = users.filter((u) => u.status !== 'pending'), resets = users.filter((u) => u.reset_requested_at);
  const sidesBox = (u) => !ME.is_admin&&(u.family_group_ids||[]).length>1?`<span class="muted">${htmlWord("admin.sides_box.01")}</span>`:['a', 'b'].map((c) => `<label style="display:inline-flex;align-items:center;font-weight:600;margin-left:10px"><input type="checkbox" data-change="usides" data-id="${u.id}" data-v="${c}" ${u.sides.includes(c) ? 'checked' : ''}>${esc(famOf(c) || sideName(c))}</label>`).join('');
  return `<a class="btn l" href="#personreviews">${htmlWord("admin.02")}</a><h1>${htmlWord("admin.03")}</h1><div class="cap">${htmlWord("admin.04")}</div>
  ${ME.is_admin?`<section class="card"><h2>${htmlWord("admin.14")}</h2>${groups.length?field(word("admin.17"),`<select data-change="viewgroup">${options(ME.selected_family_group_id)}</select>`):`<p role="status">${htmlWord("admin.18")}</p>`}<form data-form="newgroup">${field(word("admin.19"),'<input id="groupname" maxlength="120" required>')}<button class="btn">${htmlWord("admin.15")}</button></form><button class="btn l" data-act="unassigned">${htmlWord("admin.16")}</button></section>`:''}
  <form class="card" data-form="renamegroup">${field(word("admin.20"),`<select id="renamegroupid" required>${options(ME.is_admin?ME.selected_family_group_id:ME.family_group_id)}</select><input id="renamegroupname" maxlength="120" placeholder="${htmlWord("admin.21")}" required>`)}<button class="btn">${htmlWord("admin.05")}</button><div class="err"></div></form>
  <h2>${htmlWord("admin.06", { length: resets.length })}</h2><p class="muted">${htmlWord("admin.07")}</p>
  ${resets.map(u => `<div class="row"><div class="grow"><b>${esc(u.name)}</b> <span dir="ltr">+${esc(u.phone)}</span><div class="muted">${esc(new Date(u.reset_requested_at).toLocaleString())}</div></div><button class="btn s" data-act="resetlink" data-id="${u.id}" ${!ME.is_admin&&(u.family_group_ids||[]).length>1?'disabled':''}>${htmlWord("admin.22")}</button></div>`).join('') || `<div class="muted">${htmlWord("admin.23")}</div>`}
  <h2>${htmlWord("admin.08", { length: pend.length })}</h2>${pend.map((u) => `<div class="row" style="flex-wrap:wrap"><div class="grow"><b>${esc(u.name)}</b> <span class="muted" dir="ltr">+${esc(u.phone)}</span><div class="muted">${u.sides.map((c) => esc(famOf(c) || sideName(c))).join(' + ')}${u.note ? ' · ' + esc(u.note) : ''}</div></div>
   <div class="btns">${ME.is_admin?`<button class="btn s l" data-act="assignfamilies" data-id="${u.id}">${htmlWord("admin.26")}</button>`:''}<button class="btn s g" data-act="approve" data-id="${u.id}">${htmlWord("admin.24")}</button><button class="btn s r" data-act="reject" data-id="${u.id}">${htmlWord("admin.25")}</button></div></div>`).join('') || `<div class="muted">${htmlWord("admin.27")}</div>`}
  <h2>${htmlWord("admin.09", { length: rest.length })}</h2>${ME.is_admin?`<p>${htmlWord("admin.28")} <b>${htmlWord("admin.29")}</b>${htmlWord("admin.30")}</p>`:''}<table class="t resp"><thead><tr><th>${htmlWord("admin.10")}</th><th>${htmlWord("admin.11")}</th><th>${htmlWord("admin.12")}</th><th>${htmlWord("admin.13")}</th><th></th></tr></thead><tbody>
  ${rest.map((u) => `<tr><td><b>${esc(u.name)}</b>${u.is_admin ? ` <span class="tag y">${htmlWord("admin.32")}</span>` : u.is_family_admin?` <span class="tag y">${htmlWord("admin.33")}</span>`:''}${u.has_password ? '' : ` <span class="tag">${htmlWord("admin.34")}</span>`}</td><td dir="ltr" style="text-align:right">+${esc(u.phone)}</td><td>${sidesBox(u)}${ME.is_admin?`<div>${groups.filter(g=>(u.family_group_ids||[]).includes(g.id)).map(g=>`<span class="tag g">${esc(g.name)}</span>`).join(' ')||`<span class="tag">${htmlWord("admin.35")}</span>`}</div><button class="btn s l" data-act="assignfamilies" data-id="${u.id}">${htmlWord("admin.26")}</button>`:''}</td>
   <td>${u.status === 'active' ? `<span class="tag g">${htmlWord("admin.36")}</span>` : `<span class="tag b">${htmlWord("admin.37")}</span>`}</td>
   <td><div class="btns">${u.status !== 'active' ? `<button class="btn s g" data-act="approve" data-id="${u.id}">${htmlWord("admin.38")}</button>` : ''}
   ${ME.is_admin && u.status==='active' && !u.is_admin && groups.some(g=>g.id===u.family_group_id)?`<button class="btn s l" data-act="actas" data-id="${u.id}">${htmlWord("admin.39")}</button>`:''}
   ${ME.is_admin && u.id !== ME.id && u.phone !== owner_phone ? `<button class="btn s l" data-act="mkadmin" data-id="${u.id}" data-v="${u.is_admin ? 0 : 1}">${u.is_admin ? htmlWord("admin.40") : htmlWord("admin.41")}</button>` : ''}
   ${!u.is_admin&&u.id!==ME.id&&(ME.is_admin||(u.family_group_ids||[]).length===1)?`<button class="btn s l" data-act="familyadmin" data-id="${u.id}" data-v="${u.is_family_admin?'0':'1'}">${u.is_family_admin?htmlWord("admin.42"):htmlWord("admin.43")}</button>`:''}
   <button class="btn s l" data-act="resetlink" data-id="${u.id}" ${!ME.is_admin&&(u.family_group_ids||[]).length>1?'disabled':''}>${htmlWord("admin.31")}</button>${ME.is_admin && u.id !== ME.id && u.phone !== owner_phone ? `<button class="btn s r" data-act="deluser" data-id="${u.id}">🗑</button>` : ''}</div></td></tr>`).join('')}</tbody></table>
  ${ME.is_admin?`<h2>${htmlWord("admin.44")}</h2><form data-form="settings" class="card">
  ${field(word("admin.46"), `<input id="st_family_yi" value="${esc(S.family_yi)}">`)}${field('Name (English)', `<input id="st_family_en" class="ltr" value="${esc(S.family_en)}">`)}
  <div class="grid g2"><div>${field(word("admin.47"), `<input id="st_side_a_yi" value="${esc(S.side_a_yi)}">`)}${field(word("admin.48"), `<input id="st_side_a_family_yi" value="${esc(S.side_a_family_yi)}">`)}${field('Side A (English)', `<input id="st_side_a_en" class="ltr" value="${esc(S.side_a_en)}">`)}${field('Family name (English)', `<input id="st_side_a_family_en" class="ltr" value="${esc(S.side_a_family_en)}">`)}</div>
  <div>${field(word("admin.49"), `<input id="st_side_b_yi" value="${esc(S.side_b_yi)}">`)}${field(word("admin.48"), `<input id="st_side_b_family_yi" value="${esc(S.side_b_family_yi)}">`)}${field('Side B (English)', `<input id="st_side_b_en" class="ltr" value="${esc(S.side_b_en)}">`)}${field('Family name (English)', `<input id="st_side_b_family_en" class="ltr" value="${esc(S.side_b_family_en)}">`)}</div></div>
  <div class="err" id="ferr"></div><button class="btn">${htmlWord("admin.45")}</button></form>`:''}`;
};
V.me = async () => ME.acting?`<a class="btn l" href="#personreviews">${htmlWord("account.me.01")}</a><h1>${htmlWord("account.me.02")}</h1><section class="card"><strong>${esc(ME.name)}</strong><p dir="auto">${esc(ME.email||'')}</p></section>`:`<a class="btn l" href="#personreviews">${htmlWord("account.me.01")}</a><h1>${htmlWord("account.me.02")}</h1><div class="cap">${both() ? htmlWord("account.me.14") : esc(sideLong(ME.sides[0]))}${ME.is_admin ? ` ${htmlWord("account.me.15")}` : ''} · <span dir="ltr">+${esc(ME.phone)}</span></div>
  <form data-form="me" class="card" style="margin-bottom:14px">${field(word("account.me.16"), `<input id="mn" value="${esc(ME.name)}">`)}${field(word("account.me.17"), `<input id="mem" type="email" class="ltr" value="${esc(ME.email || '')}">`)}<div class="err" id="ferr"></div><button class="btn">${htmlWord("account.me.03")}</button></form>
  <section class="card" style="margin-bottom:14px"><h2>${htmlWord("account.me.04")}</h2>${ME.email_verified ? `<p role="status">${htmlWord("account.me.18")}</p>` : !EMAIL_READY ? `<p class="muted">${htmlWord("account.me.19")}</p>` : !ME.email ? `<p class="muted">${htmlWord("account.me.20")}</p>` : `<p class="muted">${htmlWord("account.me.21")} <span dir="ltr">${esc(ME.email)}</span></p><form data-form="emailverifyrequest">${field(word("account.me.23"), '<input id="emailverifypw" type="password" autocomplete="current-password" required>')}<div class="err" role="alert"></div><div id="emailverifystatus" role="status"></div><button class="btn">${htmlWord("account.me.22")}</button></form>`}</section>
  <section class="card" style="margin-bottom:14px"><h2>${htmlWord("account.me.05")}</h2><p>${htmlWord("account.me.06")}</p><p class="muted">${htmlWord("account.me.07")}</p><button class="btn" data-act="learningreminders" ${!ME.learning_email_reminders && (!EMAIL_READY || !ME.email_verified) ? 'disabled' : ''}>${ME.learning_email_reminders ? htmlWord("account.me.24") : htmlWord("account.me.25")}</button><p role="status">${ME.learning_email_reminders ? htmlWord("account.me.26") : htmlWord("account.me.27")}${!ME.email_verified ? ` ${htmlWord("account.me.28")}` : ''}</p></section>
  <form data-form="myphone" class="card" style="margin-bottom:14px"><h2>${htmlWord("account.me.08")}</h2><p class="muted">${htmlWord("account.me.09")}</p>${field(word("account.login.06"), `<input id="mphone" type="tel" class="ltr" autocomplete="tel" value="+${esc(ME.phone)}" required>`)}${field(word("account.me.29"), '<input id="mphonepw" type="password" autocomplete="current-password" required>')}<div class="err" id="phoneerr"></div><button class="btn">${htmlWord("account.me.10")}</button></form>
  <form data-form="mypw" class="card">${field(word("account.me.30"), '<input id="mo" type="password" autocomplete="current-password">')}${field(word("account.setpw.05"), `<input id="mp" type="password" autocomplete="new-password" placeholder="${htmlWord("account.login.08")}">`)}<div class="err" id="ferr2"></div><button class="btn">${htmlWord("account.me.11")}</button></form>
  <div class="muted" style="margin-top:12px">${htmlWord("account.me.12")}</div><button class="btn l" style="margin-top:14px" data-act="logout">${htmlWord("account.me.13")}</button>`;

// ---------- router ----------
const curView = () => ((location.hash || '#').slice(1).split('/')[0] || 'home');
let RENDER = 0;
async function go() {
  wordingNeedsRender = false;
  editingMainForm = false;
  const h = (location.hash || '').slice(1);
  const familyLink=/^(?:sim|learn|yz)\/\d+\/\d+$/.test(h);
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
        $('m').innerHTML = `<div class="login"><h1>${htmlWord("account.go.01")}</h1><p>${htmlWord("account.go.02")} ${invitation.sides.map(c => esc(sideLong(c))).join(' + ')}</p><p>${htmlWord("account.go.03", { name: ME.name })}</p><a class="btn" href="#home">${htmlWord("account.go.04")}</a></div>`;
      } else $('m').innerHTML = V.login();
    } catch (e) { if (location.hash === '#'+h) $('m').innerHTML = `<div class="login"><h1>${htmlWord("account.go.05")}</h1><p role="alert">${esc(e.message)}</p><a class="btn" href="#home">${htmlWord("account.go.06")}</a></div>`; }
    return;
  }
  STATE.joinToken = null; STATE.joinSides = null; STATE.joinFamily=null; STATE.joinNext = null;
  if (h.startsWith('verifyemail=')) { stopPoll(); clearChrome(); STATE.verifyEmailToken = h.slice(12); $('m').innerHTML = V.verifyemail(); return; }
  if (h === 'emailverified') { stopPoll(); clearChrome(); $('m').innerHTML = `<div class="login"><h1>${htmlWord("account.go.07")}</h1><p>${htmlWord("account.go.08")}</p><a class="btn" href="${ME ? '#me' : '#home'}">${ME ? htmlWord("account.go.09") : htmlWord("account.login.02")}</a></div>`; return; }
  if (h.startsWith('setpw=')) { stopPoll(); clearChrome(); const token = STATE.setpwToken = h.slice(6); $('m').innerHTML = V.setpw(); api('/auth/token/' + encodeURIComponent(token)).then((r) => { if (location.hash !== '#setpw=' + token) return; $('spn').textContent = `${word("account.go.10")} ` + r.name + '!'; $('setpwsubmit').disabled = false; }).catch((e) => { if (location.hash !== '#setpw=' + token) return; $('spn').textContent = ''; $('ferr').textContent = e.message; }); return; }
  if (h === 'forgotpw') { stopPoll(); clearChrome(); $('m').innerHTML = V.forgotpw(); return; }
  if (!ME) { if(familyLink)STATE.loginNext='#'+h; stopPoll(); clearChrome(); $('m').innerHTML = V.login(); return; }
  if (ME.status !== 'active') { stopPoll(); clearChrome(); $('m').innerHTML = V.pending(); return; }
  if(ME.is_admin&&!ME.selected_family_group_id&&!familyLink&&!['admin','me'].includes(h)){location.hash='#admin';return;}
  const [v, arg] = h.split('/'); const view = V[v] && !['login', 'pending', 'setpw'].includes(v) ? v : 'home';
  $('m').classList.toggle('tree-workspace',view==='tree' && STATE.treeView==='tree');
  if (view !== 'chat') stopPoll();
  renderNav(view);
  const my = ++RENDER;
  try { const html = await V[view](arg); if (my !== RENDER) return; const keep = STATE.keepScroll; $('m').innerHTML = html; if (!keep) window.scrollTo(0, 0); STATE.keepScroll = false; renderNav(view); observeFamilyTree(); loadActingPhotos($('m')); }
  catch (e) { if (my === RENDER) { if (e.status === 401 || e.status === 403) { await loadMe(); if (!ME || ME.status !== 'active') return go(); } $('m').innerHTML = `<div class="empty"><div class="e">⚠️</div>${esc(e.message)}<div style="margin-top:10px"><button class="btn s" data-act="reload">${htmlWord("account.go.11")}</button></div></div>`; } }
}
const refresh = () => { STATE.keepScroll = true; return go(); };
function clearChrome() { $('m').classList.remove('tree-workspace'); $('nav').innerHTML = ''; $('tabs').innerHTML = ''; $('top').innerHTML = ''; }
async function loadMe() { const r = await api('/me'); ME = r.user; STATE.canStopActing=!!r.can_stop_acting; EMAIL_READY = !!r.email_enabled; STATE.whatsappEnabled = !!r.whatsapp_enabled; S = r.settings || {}; document.title = appName(); }

// ---------- actions ----------
const ACT = {
  calendarmonth: el => {
    STATE.calendarMonth = el.dataset.v === 'today' ? null : STATE.familyCalendar[el.dataset.v];
    STATE.calendarDay = '';
    return refresh();
  },
  calendarday: el => {
    STATE.calendarDay = el.dataset.v;
    for (const day of document.querySelectorAll('.calendar-day')) day.setAttribute('aria-pressed',String(day.dataset.v===STATE.calendarDay));
    $('calendar-agenda').innerHTML = calendarAgenda(STATE.familyCalendar,STATE.calendarDay);
  },
  findrelationship: findRelationship,
  printtree: printFamilyTree,
  printyahrzeits: printYahrzeits,
  removephoto: async el => {
    if (!confirm(word('family_tools.photo.confirm'))) return;
    await api(photoPath(el.dataset.id), { method:'DELETE' });
    await refresh();
    await personProfile(Number(el.dataset.id));
  },
  linkcousin:async el=>{
    const id=Number(el.dataset.id),profile=await api(`/admin/users/${id}/tree-profile`);
    const options=profile.people.map(p=>`<option value="${p.id}" ${p.id===profile.person_id?'selected':''}>${esc(personName(p))}${p.father_name?` ${htmlWord("shared.linkcousin.01")} `+esc(p.father_name):''}</option>`).join('');
    modal(`<h2>${htmlWord("shared.linkcousin.02", { name: profile.name })}</h2><form data-form="cousinprofile" data-id="${id}">
      ${field(word("shared.linkcousin.05"),`<select id="cousinperson"><option value="">${htmlWord("shared.linkcousin.06")}</option>${options}</select>`)}
      <div class="err" role="alert"></div><div class="btns"><button class="btn">${htmlWord("shared.linkcousin.03")}</button><button type="button" class="btn l" data-act="close">${htmlWord("shared.linkcousin.04")}</button></div></form>`);
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
    if(!confirm(el.dataset.v==='approve'?word("shared.reviewperson.01"):word("shared.reviewperson.02")))return;
    await api('/person-reviews/'+el.dataset.id+'/resolve',{method:'POST',body:{action:el.dataset.v,existing_person_id:el.dataset.person?Number(el.dataset.person):undefined}});refresh();
  },
  familyadmin:async el=>{await api('/admin/users/'+el.dataset.id,{method:'PATCH',body:{is_family_admin:el.dataset.v==='1'}});refresh();},
  recoverypreview:async f=>{
    const label_groups=Object.fromEntries([...f.querySelectorAll('[data-recovery-label]')].map(e=>[e.dataset.recoveryLabel,Number(e.value)]));
    const plan=await api('/admin/recover-tree/preview',{method:'POST',body:{label_groups}});STATE.recovery={label_groups,token:plan.token};
    modal(`<h2>${htmlWord("shared.recoverypreview.01")}</h2><p>${htmlWord("shared.recoverypreview.02", { length: plan.people.length })}</p>${plan.people.map(p=>`<p><b>#${p.id} ${esc(p.name)}</b><br>${p.group_ids.map(id=>esc(plan.groups.find(g=>g.id===id).name)).join(' · ')}${p.inherited?` ${htmlWord("shared.recoverypreview.04")}`:''}</p>`).join('')}${plan.unknown.length?`<p class="err">${htmlWord("shared.recoverypreview.05")}</p>`:`<button class="btn" data-act="recoverconfirm">${htmlWord("shared.recoverypreview.06")}</button>`}<button class="btn l" data-act="close">${htmlWord("shared.recoverypreview.03")}</button>`,true);
  },
  recoverconfirm:async()=>{const r=await api('/admin/recover-tree',{method:'POST',body:STATE.recovery});closeModal();toast(word("shared.recoverconfirm.01", { people: r.people }));location.hash='#tree';},
  unassigned:async()=>{
    const {records}=await api('/admin/unassigned-records');
    const names={people:word("shared.unassigned.01"),yahrzeits:word("shared.unassigned.02"),learn_lists:word("shared.unassigned.03"),directory:word("shared.unassigned.04"),simchas:word("shared.unassigned.05"),files:word("shared.unassigned.06"),messages:word("shared.unassigned.07"),families:word("shared.unassigned.08")};
    modal(`<h2>${htmlWord("shared.unassigned.09")}</h2>${records.people.length?`<form data-form="recoverypreview" class="card"><h3>${htmlWord("shared.unassigned.12")}</h3><p>${htmlWord("shared.unassigned.13")}</p>${records.families.map(f=>field(f.label,`<select required data-recovery-label="${f.id}"><option value="">${htmlWord("shared.unassigned.15")}</option>${STATE.groups.map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select>`)).join('')}<div class="err"></div><button class="btn">${htmlWord("shared.unassigned.14")}</button></form>`:''}<p>${htmlWord("shared.unassigned.10")}</p><form data-form="assignrecords">${field(word("shared.unassigned.16"),`<select id="assigngroup" required><option value="">—</option>${STATE.groups.map(g=>`<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select>`)}${Object.entries(records).map(([table,rows])=>`<details><summary>${esc(names[table])} (${rows.length}${rows.length===500?'+':''})</summary>${rows.map(r=>`<label style="display:block"><input type="checkbox" name="assignrecord" data-table="${table}" value="${esc(r.id)}"> #${esc(r.id)} ${esc(r.label)}${table==='people'?`<small style="display:block;padding-inline-start:28px;font-weight:normal">${[[word("shared.unassigned.17"),r.father_name,r.father_id],[word("shared.unassigned.18"),r.mother_name,r.mother_id],[word("shared.unassigned.19"),r.parent_name,r.parent_id],[word("shared.unassigned.20"),r.spouse_name,r.spouse_id],[word("shared.unassigned.21"),r.second_spouse_name,r.second_spouse_id]].filter(x=>x[2]).map(x=>`${esc(x[0])}: ${esc(x[1]||'—')} (#${esc(x[2])})`).join(' · ')}${r.families?.length?`<br>${htmlWord("shared.unassigned.22")} `+r.families.map(f=>esc(f.name)+' (#'+esc(f.id)+')').join(', '):''}</small>`:''}</label>`).join('')}</details>`).join('')}<div class="err"></div><button class="btn">${htmlWord("shared.unassigned.11")}</button></form>`,true);
  },
  emailsim: el=>emailSim(Number(el.dataset.id)),
  emailstatus: el=>emailSim(Number(el.dataset.id),el.dataset.scope),
  sharesim: el=>shareSim(STATE.sims.find(x=>x.id===Number(el.dataset.id))),
  viewperson: el=>personProfile(Number(el.dataset.id)),
  emaillearn:async()=>{
    const listId=STATE.list.l.id;
    const preview=await api(`/lists/${listId}/learning-email`);
    STATE.learningEmail={listId,request_key:crypto.randomUUID(),fingerprint:preview.fingerprint};
    const reason=!preview.available?word("shared.emaillearn.01"):!preview.email_enabled?word("shared.emaillearn.02"):!preview.recipient_count?word("shared.emaillearn.03"):'';
    modal(`<h2>${htmlWord("shared.emaillearn.04")}</h2><p>${htmlWord("shared.emaillearn.05", { family: preview.family, recipient_count: preview.recipient_count })}</p>
      <p><strong>${esc(preview.subject)}</strong></p><textarea readonly aria-label="${htmlWord("shared.emaillearn.06")}" rows="7">${esc(preview.text)}</textarea>
      <form data-form="sendlearningemail">${reason?`<p class="muted">${reason}</p>`:''}<p id="learning-email-status" role="status"></p><div class="err" role="alert"></div>
      <div class="btns"><button type="submit" class="btn" ${reason?'disabled':''}>${htmlWord("shared.emaillearn.07")}</button><button type="button" class="btn l" data-act="close">${htmlWord("shared.linkcousin.04")}</button></div></form>`);
  },
  sharelearn: async ()=>{
    const l=STATE.list.l,lists=(await api('/lists')).lists;
    const sameDedications = (a,b) => a.yahrzeit_ids.length === b.yahrzeit_ids.length &&
      (a.yahrzeit_ids.length ? a.yahrzeit_ids.every(id=>b.yahrzeit_ids.includes(id)) : a.niftar===b.niftar);
    const related=lists.find(x=>x.kind!==l.kind && x.side===l.side && sameDedications(x,l));
    const selected=related?[l,related]:[l];
    const sides=l.side==='both'?mySides():[l.side];
    const invite=await api('/family-invitations',{method:'POST',body:{sides}});
    const links=selected.map(x=>`${x.kind==='mishnayos'?word("shared.sharelearn.01"):word("shared.sharelearn.02")}: ${invite.link}&list=${x.id}`);
    const message=`${word("shared.sharelearn.03", { name: l.niftar })}
${word("shared.sharelearn.04")}
${word("shared.sharelearn.06", { value: l.target_date?`${word("shared.sharelearn.05")} `+gdate(l.target_date)+'\n':'' })}
${links.join('\n')}
${word("shared.sharelearn.07")}`;
    modal(`<h2>${htmlWord("shared.sharelearn.08")}</h2><p class="muted">${htmlWord("shared.sharelearn.09")}</p><textarea readonly id="rl" rows="9">${esc(message)}</textarea><div class="btns"><a class="btn g" href="https://wa.me/?text=${encodeURIComponent(message)}" target="_blank" rel="noopener">${htmlWord("shared.sharelearn.10")}</a><button class="btn l" data-act="copy">${htmlWord("shared.sharelearn.11")}</button><button class="btn l" data-act="close">${htmlWord("shared.linkcousin.04")}</button></div>`);
  },
  replymessage: el=>{STATE.chatReply=STATE.chatMessages.find(m=>String(m.id)===el.dataset.id);showChatReply();$('ci').focus();},
  cancelreply: ()=>{STATE.chatReply=null;showChatReply();},
  mentionperson: el=>{const p=STATE.chatMembers.find(p=>String(p.id)===el.dataset.id);if(!p)return;$('ci').value=$('ci').value.replace(/@([^@\n]*)$/,'@'+p.name+' ');STATE.chatMentionIds=[...new Set([...(STATE.chatMentionIds||[]),p.id])];$('mentionchoices').innerHTML='';$('ci').focus();},
  yzexisting: ()=>{const id=Number(val('yzperson'));if(!id)throw new Error(word("shared.yzexisting.01"));return yahrzeitPerson(id);},
  yznew: ()=>yahrzeitPerson(0),
  masechta: el=>openMasechta(Number(el.dataset.idx)),
  portion: el=>openPortion(Number(el.dataset.c),Number(el.dataset.m)),
  backmasechta: ()=>openMasechta(STATE.portions.idx),
  portionaction: async el=>{const scope=STATE.portionScope;await api(`/lists/${STATE.list.l.id}/items/${scope.idx}`,{method:'POST',body:{...scope,action:el.dataset.v}});await go();await openMasechta(scope.idx);toast(word("shared.portionaction.01"));},
  learninghelp: async el=>{await api(`/lists/${STATE.list.l.id}/help/${el.dataset.id}`,{method:'POST',body:{action:el.dataset.v}});await refresh();},
  familyinvite: familyInviteForm,
  forgotpw: () => { STATE.resetPhone = val('fp'); STATE.resetRequested = false; location.hash = '#forgotpw'; },
  backlogin: () => { STATE.authMode = 'login'; STATE.resetRequested = false; history.replaceState(null, '', location.pathname + location.search); go(); },
  close: closeModal, more: moreSheet, reload: () => location.reload(),
  logout: async () => { closeModal(); await api('/auth/logout', { method: 'POST' }).catch(() => {}); ME = null; STATE.canStopActing=false; location.hash = ''; go(); },
  recheck: async () => { await loadMe(); go(); if (ME && ME.status !== 'active') toast(word("shared.recheck.01")); },
  authmode: (el) => { STATE.authMode = el.dataset.v; go(); },
  pick: (el) => { if (STATE.joinSides) return; STATE.pickSides = el.dataset.v === 'ab' ? ['a', 'b'] : [el.dataset.v]; const keep = { fn: val('fn'), fp: val('fp'), fw: $('fw').value, fnote: val('fnote') }; $('m').innerHTML = V.login(); for (const k in keep) if ($(k)) $(k).value = keep[k]; },
  side: (el) => { STATE.side = el.dataset.v; refresh(); },
  treezoom: (el) => { STATE.treeZoom=el.dataset.v==='fit'?null:el.dataset.v==='actual'?1:Math.max(0.2,Math.min(2,(STATE.treeScale||1)+Number(el.dataset.v))); updateFamilyViewport(); },
  treeside: (el) => { STATE.treeSide = el.dataset.v; STATE.treeZoom=null; refresh(); }, treeview: (el) => { STATE.treeView = el.dataset.v; refresh(); },
  room: (el) => { STATE.room = el.dataset.v; go(); },
  simpast: (el) => { STATE.simPast = el.dataset.v === '1'; go(); },
  remind: async el => {
    const on = el.dataset.on === '1';
    await api(`/yahrzeits/${el.dataset.id}/remind`, {method:'POST',body:{on}});
    const reachable = (ME.email_verified && EMAIL_READY) || (STATE.whatsappEnabled && ME.whatsapp_yahrzeit_reminders);
    toast(word(on ? (reachable ? 'shared.remind.01' : 'yahrzeits.reminders.saved_pending') : 'shared.remind.02'));
    return refresh();
  },
  ancestorreminders: async () => {
    const result = await api('/me/yahrzeit-reminders',{method:'POST',body:{on:!ME.yahrzeit_ancestor_emails}});
    ME.yahrzeit_ancestor_emails = result.yahrzeit_ancestor_emails;
    toast(word("shared.portionaction.01"));
    return refresh();
  },
  shareyz: el => {
    const y = STATE.yzs.find(y=>y.id===Number(el.dataset.id));
    const link = `${location.origin}/#yz/${y.id}/${ME.selected_family_group_id}`;
    const date = y.next ? `${y.next.hebrew} · ${gdate(y.next.ymd)}` : y.hebrew;
    const message = [word("email_yahrzeit.subject",{name:yahrzeitName(y)}),date,word("email_yahrzeit.evening"),link].join('\n');
    modal(`<h2>${htmlWord("yahrzeits.reminders.share_heading")}</h2><textarea readonly id="rl" rows="5" aria-label="${htmlWord("yahrzeits.reminders.share_label")}">${esc(message)}</textarea><div class="btns"><a class="btn g" href="https://wa.me/?text=${encodeURIComponent(message)}" target="_blank" rel="noopener">${htmlWord("yahrzeits.reminders.share_open")}</a><button class="btn l" data-act="copy">${htmlWord("simchas.share_sim.03")}</button><button class="btn l" data-act="close">${htmlWord("simchas.share_sim.04")}</button></div>`);
  },
  edityz: (el) => yzForm(Number(el.dataset.id)),
  delyz: async (el) => { if (!confirm(word("shared.delyz.01"))) return; await api('/yahrzeits/' + el.dataset.id, { method: 'DELETE' }); closeModal(); toast(word("shared.delyz.02")); refresh(); },
  editp: (el) => personForm(Number(el.dataset.id)),
  addmarriage: el=>personForm(Number(el.dataset.id),undefined,{openRelative:el.dataset.key}),
  marriagechild: async el=>{
    const {people}=await api('/people'),p=people.find(x=>x.id===Number(el.dataset.id)),spouse=people.find(x=>x.id===Number(el.dataset.spouse));
    if(!p||!spouse)throw new Error(word("shared.marriagechild.01"));
    STATE.childMarriage={person:p,spouse};
    modal(`<h2>${htmlWord("shared.marriagechild.02", { name: personName(p,p.name), name2: personName(spouse,spouse.name) })}</h2><form data-form="marriagechild">${field(word("shared.marriagechild.05"),`<select id="childfather" required><option value="">${htmlWord("shared.marriagechild.06")}</option><option value="${p.id}">${esc(personName(p,p.name))}</option><option value="${spouse.id}">${esc(personName(spouse,spouse.name))}</option></select>`)}<p>${htmlWord("shared.marriagechild.03")}</p><button class="btn">${htmlWord("shared.marriagechild.04")}</button><button type="button" class="btn l" data-act="close">${htmlWord("shared.recoverypreview.03")}</button></form>`);
  },
  addchild: el=>personForm(0, Number(el.dataset.id)),
  delp: async (el) => { if (!confirm(word("shared.delp.01"))) return; await api('/people/' + el.dataset.id, { method: 'DELETE' }); closeModal(); toast(word("shared.delyz.02")); refresh(); },
  newlist: (el) => listForm(Number(el.dataset.yz) || 0,el),
  item: (el) => onItem(Number(el.dataset.idx)),
  itemact: async (el) => { const { l } = STATE.list; const a = el.dataset.v; await api(`/lists/${l.id}/items/${el.dataset.idx}`, { method: 'POST', body: { action: a } }); closeModal(); toast(a === 'give' ? word("shared.itemact.01") : a === 'done' ? word("shared.itemact.02") : word("shared.itemact.03")); refresh(); },
  learningreminders: async () => { const r = await api('/me/learning-reminders', {method:'POST',body:{on:!ME.learning_email_reminders}}); ME={...ME,...r.user}; toast(word("shared.portionaction.01")); await refresh(); },
  dellist: async (el) => { if (!confirm(word("shared.dellist.01"))) return; await api('/lists/' + el.dataset.id, { method: 'DELETE' }); location.hash = '#learn'; },
  editsim: (el) => simForm(Number(el.dataset.id)),
  delsim: async (el) => { if (!confirm(word("shared.delsim.01"))) return; await api('/simchas/' + el.dataset.id, { method: 'DELETE' }); closeModal(); toast(word("shared.delyz.02")); refresh(); },
  delinv: async (el) => { await api(`/simchas/${el.dataset.id}/invite`, { method: 'DELETE' }); closeModal(); toast(word("shared.delinv.01")); refresh(); },
  showinv: (el) => showInv(Number(el.dataset.id)),
  ppl: (el) => { const s = $('ppl' + el.dataset.id); s.textContent = Math.max(1, Math.min(50, Number(s.textContent) + Number(el.dataset.d))); },
  rsvp: async (el) => { const id = el.dataset.id, a = el.dataset.v; const x = STATE.sims.find((s) => s.id === Number(id)); const n = Number($('ppl' + id).textContent);
    await api(`/simchas/${id}/rsvp`, { method: 'POST', body: { answer: x.my_answer === a && (a === 'no' || x.my_people === n) ? null : a, people: n } }); toast(a === 'yes' ? word("shared.rsvp.01", { count: n }) : word("shared.rsvp.02")); refresh(); },
  who: (el, ev) => { ev.preventDefault(); const x = STATE.sims.find((s) => s.id === Number(el.dataset.id)); modal(`<h2 style="margin-top:0">${htmlWord("shared.who.01", { type: x.kind, name: x.whose })}</h2>${x.rsvps.length ? x.rsvps.map((r) => `<div class="row"><div class="grow">${esc(r.name)}</div>${r.answer === 'yes' ? `<span class="tag g">${htmlWord("shared.who.02", { people: r.people })}</span>` : `<span class="tag b">${htmlWord("shared.who.03")}</span>`}</div>`).join('') : `<div class="muted">${htmlWord("shared.who.04")}</div>`}<button class="btn l" data-act="close">${htmlWord("shared.linkcousin.04")}</button>`); },
  mazeltov: async (el) => { await api(`/simchas/${el.dataset.id}/mazeltov`, { method: 'POST', body: {} }); toast(word("shared.mazeltov.01")); },
  editdir: (el) => dirForm(Number(el.dataset.id), el.dataset.mine === '1'),
  deldir: async (el) => { if (!confirm(word("shared.delp.01"))) return; await api('/directory/' + el.dataset.id, { method: 'DELETE' }); closeModal(); toast(word("shared.delyz.02")); refresh(); },
  approve: async (el) => { await api('/admin/users/' + el.dataset.id, { method: 'PATCH', body: { status: 'active' } }); toast(word("shared.approve.01")); refresh(); },
  reject: async (el) => { if (!confirm(word("shared.reject.01"))) return; await api('/admin/users/' + el.dataset.id, { method: 'PATCH', body: { status: 'rejected' } }); toast(word("shared.reject.02")); refresh(); },
  mkadmin: async (el) => { await api('/admin/users/' + el.dataset.id, { method: 'PATCH', body: { is_admin: el.dataset.v === '1' } }); toast(word("shared.mkadmin.01")); refresh(); },
  deluser: async (el) => { const u = STATE.users.find((x) => x.id === Number(el.dataset.id)); if (!confirm(word("shared.deluser.01", { name: u.name }))) return; await api('/admin/users/' + u.id, { method: 'DELETE' }); toast(word("shared.delyz.02")); refresh(); },
  resetlink: async (el) => { const u = STATE.users.find((x) => x.id === Number(el.dataset.id)); const r = await api(`/admin/users/${u.id}/reset-link`, { method: 'POST', body: {} });
    const msg = word("shared.resetlink.01", { name: u.name, family: S.family_yi, link: r.link });
    await refresh();
    modal(`<h2 style="margin-top:0">${htmlWord("shared.resetlink.02", { name: u.name })}</h2><p class="muted">${htmlWord("shared.resetlink.03", { hours: r.hours })}</p><input readonly class="ltr" id="rl" value="${esc(r.link)}">
    <div class="btns"><a class="btn g" href="https://wa.me/${esc(u.phone)}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">${htmlWord("shared.sharelearn.10")}</a><button class="btn l" data-act="copy">${htmlWord("shared.resetlink.04")}</button><button class="btn l" data-act="close">${htmlWord("shared.linkcousin.04")}</button></div>`); },
  copy: async () => { const e = $('rl'); e.select(); try { await navigator.clipboard.writeText(e.value); } catch { document.execCommand('copy'); } toast(word("shared.copy.01")); },
};
const CHANGE = {
  yahrzeitpreference: async el => {
    const checked = el.checked;
    el.disabled = true;
    try {
      await api('/me/yahrzeit-reminders', { method:'POST',body:{ whatsapp:checked } });
      await loadMe();
      await refresh();
    } catch (error) { el.checked = !checked; el.disabled = false; throw error; }
  },
  emailscope: el=>emailSim(Number(el.dataset.id),el.value),
  cousinfamily:()=>{
    STATE.cousinFamilies=[...document.querySelectorAll('input[name="cousin-family"]:checked')].map(el=>Number(el.value));
    return refresh();
  },
  viewgroup: async el => {
    const group = Number(el.value);
    if (!group || familyChanging || group === ME.selected_family_group_id) return;
    const main = $('m'), route = location.hash, restoreFocus = document.activeElement === el;
    familyChanging = true;
    main.inert = true;
    main.setAttribute('aria-busy', 'true');
    try {
      await api('/me/family-group', { method: 'POST', body: { family_group_id: group } });
      stopPoll();
      await loadMe();
      STATE.room = STATE.side = 'all';
      STATE.yzFamily = STATE.learnFamily = '';
      UNREAD = false;
      if (curView() === 'people') await refresh();
      else await go();
    } catch (error) {
      el.value = String(ME.selected_family_group_id || '');
      throw error;
    } finally {
      familyChanging = false;
      main.inert = false;
      main.removeAttribute('aria-busy');
      if (restoreFocus && location.hash === route) main.querySelector('[data-change="viewgroup"]')?.focus({ preventScroll: true });
      checkUnread();
    }
  },
  familyfilter: el => {
    STATE[el.dataset.key] = el.value;
    if (el.dataset.key === 'treeFamily') highlightTreeFamily();
    else return refresh();
  },
  membershippick:el=>{const boxes=[...document.querySelectorAll('[name=membership]')];const count=boxes.filter(b=>b.checked).length;boxes.forEach(b=>b.disabled=!b.checked&&count>=4);$('membershipcount').textContent=count+' / 4';},
  privatechat: el=>{if(!el.value)return;const id=Number(el.value);STATE.room='dm:'+Math.min(ME.id,id)+':'+Math.max(ME.id,id);return go();},
  chatfile: el=>{const f=el.files[0];STATE.chatUpload=null;if(f&&f.size>10*1024*1024){el.value='';throw new Error(word("shared.chatfile.01"));}$('chatfilename').textContent=f?' · '+f.name:'';},
  newrelative: el => { $('new_' + el.dataset.key).hidden = el.value !== 'new'; },
  upinv: async (el) => { const f = el.files[0]; if (!f) return; if (f.size > 10 * 1024 * 1024) return toast(word("shared.upinv.01")); toast(word("shared.upinv.02"));
    const fd = new FormData(); fd.append('file', f); await api(`/simchas/${el.dataset.id}/invite`, { method: 'POST', body: fd }); toast(word("shared.upinv.03")); refresh(); },
  usides: async (el) => { const u = STATE.users.find((x) => x.id === Number(el.dataset.id)); const s = new Set(u.sides); el.checked ? s.add(el.dataset.v) : s.delete(el.dataset.v);
    try { await api('/admin/users/' + u.id, { method: 'PATCH', body: { sides: [...s] } }); toast(word("shared.usides.01")); } catch (e) { el.checked = !el.checked; throw e; } refresh(); },
};
const FORMS = {
  relationship: showRelationship,
  personphoto: async form => {
    const id = Number(form.dataset.id);
    await api(photoPath(id), { method:'PUT',body:new FormData(form) });
    await refresh();
    await personProfile(id);
    toast(word('family_tools.photo.saved'));
  },
  simemail: async f=>{await api(`/simchas/${f.dataset.id}/email`,{method:'POST',body:{scope:f.dataset.scope,confirmed:$('emailconfirm').checked}});toast(word("shared.simemail.01"));await emailSim(Number(f.dataset.id),f.dataset.scope);},
  marriagechild: ()=>{
    const {person,spouse}=STATE.childMarriage;
    return personForm(0,undefined,{...childParents(person.id,spouse.id,Number(val('childfather'))),side:person.side,families:person.families||[]});
  },
  renamegroup:async()=>{await api('/admin/family-groups/'+val('renamegroupid'),{method:'PATCH',body:{name:val('renamegroupname')}});await loadMe();refresh();},
  newgroup:async()=>{const {group}=await api('/admin/family-groups',{method:'POST',body:{name:val('groupname')}});await api('/me/family-group',{method:'POST',body:{family_group_id:group.id}});location.reload();},
  memberships:async f=>{const ids=[...f.querySelectorAll('[name=membership]:checked')].map(e=>Number(e.value));if(!ids.length)throw new Error(word("shared.memberships.01"));await api('/admin/users/'+f.dataset.id+'/family-group',{method:'PUT',body:{family_group_ids:ids}});closeModal();toast(word("shared.memberships.02"));await loadMe();refresh();},
  recoverypreview:async f=>ACT.recoverypreview(f),
  assignrecords:async f=>{const records={};for(const e of f.querySelectorAll('[name=assignrecord]:checked'))(records[e.dataset.table]||=[]).push(e.value);await api('/admin/assign-records',{method:'POST',body:{family_group_id:Number(val('assigngroup')),records}});closeModal();toast(word("shared.assignrecords.01"));refresh();},
  portionhelp: async ()=>{const scope=STATE.portionScope;await api(`/lists/${STATE.list.l.id}/items/${scope.idx}/help`,{method:'POST',body:{...scope,note:val('helpnote')}});closeModal();await go();toast(word("shared.portionhelp.01"));},
  familyinvite: async () => {
    const side = val('inviteSide');
    const r = await api('/family-invitations', { method: 'POST', body: { sides: side === 'both' ? ['a', 'b'] : [side] } });
    const names = r.sides.map(c => sideLong(c)).join(' + ');
    const message = word("shared.familyinvite.01", { family: S.family_yi, names: names, link: r.link });
    modal(`<h2>${htmlWord("shared.familyinvite.02")}</h2><p><b>${esc(names)}</b></p><p class="muted">${htmlWord("shared.familyinvite.03", { days: r.days })}</p><input id="rl" readonly class="ltr" aria-label="Invitation link" value="${esc(r.link)}"><div class="btns"><a class="btn g" href="https://wa.me/?text=${encodeURIComponent(message)}" target="_blank" rel="noopener">${htmlWord("shared.sharelearn.10")}</a><button class="btn l" data-act="copy">${htmlWord("shared.familyinvite.04")}</button><button class="btn l" data-act="close">${htmlWord("shared.linkcousin.04")}</button></div>`);
  },
  forgotpw: async () => { await api('/auth/forgot-password', { method: 'POST', body: { phone: val('resetphone') } }); STATE.resetRequested = true; go(); },
  login: async () => { const r = await api('/auth/login', { method: 'POST', body: { phone: val('fp'), password: $('fw').value } }); ME = r.user; await loadMe(); toast(word("shared.login.01")); location.hash = STATE.loginNext || STATE.joinNext || '#home'; STATE.loginNext=null; go(); },
  signup: async () => { const r = await api('/auth/signup', { method: 'POST', body: { name: val('fn'), phone: val('fp'), password: $('fw').value, sides: STATE.pickSides || [], invitation_token: STATE.joinToken || undefined, create_family:STATE.joinToken?undefined:val('newfamilyname'), note: val('fnote') } }); ME = r.user; await loadMe(); location.hash = STATE.joinNext || '#home'; go(); },
  setpw: async () => { if ($('sp1').value !== $('sp2').value) throw new Error(word("shared.setpw.01")); await api('/auth/set-password', { method: 'POST', body: { token: STATE.setpwToken, password: $('sp1').value } }); STATE.setpwToken = null; history.replaceState(null, '', location.pathname + location.search + '#home'); await loadMe(); toast(word("shared.setpw.02")); go(); },
  yz: async (f) => { const id = Number(f.dataset.id); const b = { name: val('yn'), father_name: val('yf'), relation: val('yr'), hday: Number(val('yd')), hmonth: val('ym'), death_year: val('yy'), side: val('ys'), kever: val('yk'), note: val('yo') };
    await api(id ? '/yahrzeits/' + id : '/yahrzeits', { method: id ? 'PUT' : 'POST', body: b }); closeModal(); toast(word("shared.portionaction.01")); refresh(); },
  person: async (f) => { const id = Number(f.dataset.id); const b = {family_ids:[...f.querySelectorAll('[name=person_family]:checked')].map(el=>Number(el.value)),new_family:val('pnewfamily'),lineage_term:val('plineage'),name:val('pn'),title:val('ptitle'),known_as:val('pknownas'),father_id:val('pfather_id'),mother_id:val('pmother_id'),spouse_id:val('pspouse_id'),second_spouse_id:val('psecond_spouse_id'),parent_id:val('pparent_id'),side:val('pside'),life_status:val('plife'),death_hday:val('pday'),death_hmonth:val('pmonth'),death_year:val('pyear'),note:val('pno'),kever:val('pkever'),kever_address:val('pkeveraddress'),legacy_yahrzeit_id:f.dataset.legacyid||undefined,require_yahrzeit:f.dataset.yahrzeit==='1'||undefined};
    const suggestion = f.dataset.suggestion === '1';
    if ($('person-birthday-day')) b.calendar_dates = readCalendarDates();
    if (suggestion) {
      delete b.family_ids;
      delete b.new_family;
      b.suggestion_note = val('person-suggestion-note');
    }
    b.new_relatives = {};
    for (const key of ['father_id','mother_id','spouse_id','second_spouse_id']) if (b[key] === 'new') {
      b.new_relatives[key] = { name: val('new_' + key + '_name'), title: val('new_' + key + '_title'), known_as: val('new_' + key + '_known_as') }; b[key] = null;
    }
    b.confirm_distinct=$('pdistinct').checked;b.distinct_reason=val('pdistinctreason');
    const fingerprint=JSON.stringify(b);if(f._saveFingerprint!==fingerprint){f._saveKey=crypto.randomUUID();f._saveFingerprint=fingerprint;}b.request_key=f._saveKey;
    const path = id ? `/people/${id}` : '/people';
    let result;try{result=await api(suggestion ? path+'/suggestions' : path, { method: id && !suggestion ? 'PUT' : 'POST', body: b });}
    catch(e){if(e.details?.code==='person_matches')renderPersonMatches(e.details.field,e.details.matches);throw e;}
    closeModal();if(result.pending_review){
      if(result.review_family_group_id){
        await api('/me/family-group',{method:'POST',body:{family_group_id:result.review_family_group_id}});
        await loadMe();
      }
      toast(word(suggestion?'family_tools.suggestions.queued':'shared.person.01'));
      if (curView()==='personreviews') await refresh(); else location.hash='#personreviews';
    }else if (b.require_yahrzeit) {
      STATE.yzFamily='';
      toast(word("shared.person.02"));
      if (curView()==='yz') await refresh(); else location.hash='#yz';
    }else{toast('✓ ' + b.name + ` ${word("shared.person.03")}`);refresh();} },
  list: async (form) => {
    const custom=$('learning-custom').checked;
    const yahrzeit_ids=custom?[]:selectedMemorialIds(form);
    if (!custom&&!yahrzeit_ids.length) {
      $('learning-search').focus();
      throw new Error(word("shared.list.02"));
    }
    const r=await api('/lists',{method:'POST',body:{kind:val('lk'),yahrzeit_ids,niftar:custom?val('ln'):'',target_date:val('ld'),side:val('ls')}});
    if (!form.isConnected) return;
    closeModal();
    toast(word("shared.list.01"));
    location.hash=`#learn/${r.list.id}/${r.list.family_group_id}`;
  },
  cousinprofile:async f=>{
    await api(`/admin/users/${f.dataset.id}/tree-profile`,{method:'PUT',body:{person_id:Number(val('cousinperson'))||null}});
    closeModal();toast(word("shared.portionaction.01"));return refresh();
  },
  sendlearningemail:async f=>{
    const button=f.querySelector('button[type="submit"]');
    const {listId,request_key,fingerprint}=STATE.learningEmail;
    button.disabled=true;
    try {
      const result=await api(`/lists/${listId}/learning-email`,{method:'POST',body:{request_key,fingerprint}});
      if(result.sent===result.total){closeModal();toast(word("shared.sendlearningemail.01", { sent: result.sent }));}
      else if($('learning-email-status')) {
        $('learning-email-status').textContent=word("shared.sendlearningemail.02", { sent: result.sent, total: result.total });
        button.textContent=word("shared.sendlearningemail.03");
      }
    } finally { button.disabled=false; }
  },
  sim: async (f) => { const id = Number(f.dataset.id); const kind = val('sk') === 'אנדערע' ? (val('sko') || 'שמחה') : val('sk');
    const b = { kind, whose: val('sw'), gdate: val('sd'), time_text: val('stt'), hdate_text: val('sh'), hall: val('sp'), address: val('sa'), note: val('sn'), audience: val('ss') };
    const file = $('sf') && $('sf').files[0]; if (file && file.size > 10 * 1024 * 1024) throw new Error(word("shared.sim.01"));
    $('simsave').disabled = true;
    try { const r = await api(id ? '/simchas/' + id : '/simchas', { method: id ? 'PUT' : 'POST', body: b });
      if (file) { const fd = new FormData(); fd.append('file', file); try { await api(`/simchas/${r.simcha.id}/invite`, { method: 'POST', body: fd }); } catch (e) { toast(`${word("shared.sim.02")} ` + e.message); closeModal(); return refresh(); } }
      closeModal(); toast(word("shared.portionaction.01")); STATE.simPast = false; if (curView() === 'sim') await refresh(); else location.hash = '#sim'; if (!id) shareSim(r.simcha); }
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
    await api(id ? '/directory/' + id : '/directory', { method: id ? 'PUT' : 'POST', body: b }); closeModal(); toast(word("shared.portionaction.01")); refresh(); },
  settings: async () => { const b = {}; document.querySelectorAll('[id^=st_]').forEach((e) => { b[e.id.slice(3)] = e.value.trim(); }); const r = await api('/admin/settings', { method: 'PUT', body: b }); S = r.settings; toast(word("shared.portionaction.01")); refresh(); },
  me: async () => { const r = await api('/me', { method: 'PATCH', body: { name: val('mn'), email: val('mem') } }); ME = r.user; toast(word("shared.portionaction.01")); refresh(); },
  myphone: async () => { const r = await api('/me/phone', { method: 'POST', body: { phone: val('mphone'), password: $('mphonepw').value } }); ME = r.user; toast(word("shared.myphone.01")); refresh(); },
  emailverifyrequest: async () => { await api('/me/email-verification', { method: 'POST', body: { password: $('emailverifypw').value } }); $('emailverifypw').value = ''; $('emailverifystatus').textContent = word("shared.emailverifyrequest.01"); },
  verifyemail: async () => { await api('/auth/verify-email', { method: 'POST', body: { token: STATE.verifyEmailToken } }); STATE.verifyEmailToken = null; history.replaceState(null, '', location.pathname + location.search + '#emailverified'); await loadMe(); go(); },
  mypw: async () => { await api('/me/password', { method: 'POST', body: { old: $('mo').value, password: $('mp').value } }); $('mo').value = $('mp').value = ''; toast(word("shared.mypw.01")); },
};
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]'); if (!el) { if (ev.target.id === 'md') closeModal(); return; }
  const f = ACT[el.dataset.act]; if (!f) return; if (el.tagName === 'A' && !el.getAttribute('href')) ev.preventDefault();
  try { await f(el, ev); } catch (e) { fail(e); }
});
document.addEventListener('change', async (ev) => { const el = ev.target.closest('[data-change]'); if (!el) return; try { await CHANGE[el.dataset.change](el); } catch (e) { fail(e); } });
document.addEventListener('input', (ev) => {
  if (ev.target.closest('main form')) editingMainForm = true;
  if(ev.target.id==='pn'){if($('pdistinct'))$('pdistinct').checked=false;return renderPersonMatches();}const relative=/^new_(father_id|mother_id|spouse_id|second_spouse_id)_name$/.exec(ev.target.id);if(relative)return renderPersonMatches(relative[1]);
  const el = ev.target;if(el.id==='ci'){STATE.chatActivity=Date.now();mentionChoices();return;} if (el.dataset.input !== 'q') return; STATE.q = el.value;
  const Q = STATE.q.trim(); const L = (STATE.dir || []).filter((d) => vis(d.side) && (!Q || [d.husband, d.wife, d.address, d.parents, d.phone_h, d.phone_w].join(' ').includes(Q)));
  $('dirlist').innerHTML = dirCards(L); $('qn').textContent = L.length + ` ${word("shared.01")}`;
});
document.addEventListener('submit', async (ev) => {
  const f = ev.target.closest('[data-form]'); if (!f) return; ev.preventDefault(); if(f.dataset.busy)return;f.dataset.busy='1';
  const err = f.querySelector('.err'); if (err) err.textContent = '';
  const btn = f.querySelector('button:not([type=button])'); if (btn) btn.disabled = true;
  try { await FORMS[f.dataset.form](f); } catch (e) { if (e.status === 401 && f.dataset.form !== 'login') return fail(e); if (err) err.textContent = e.message; else fail(e); }
  finally { delete f.dataset.busy; if (btn && document.body.contains(btn)) btn.disabled = false; }
});
document.addEventListener('change', (ev) => { if (ev.target.id === 'sk') $('skow').style.display = ev.target.value === 'אנדערע' ? '' : 'none';
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
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkWording(); if (ME) checkUnread(); } });
setInterval(checkUnread, 20000);
setInterval(checkWording, 10000);
(async () => { try { await Promise.all([loadMe(), loadWording()]); } catch (e) { $('m').innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`; return; } go(); checkUnread(); })();

