/* 원고 편집기 — 기기에 먼저 저장하고, 연결되면 구글 드라이브와 맞춘다 */
(() => {
'use strict';
const $ = s => document.querySelector(s);
const paper = $('#paper'), app = $('#app');
const narrow = () => matchMedia('(max-width:820px)').matches;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const hhmm = t => new Date(t).toLocaleTimeString('ko-KR', {hour: '2-digit', minute: '2-digit'});

/* ---------- 이 기기 설정 ---------- */
const LS = 'wongo-';
function lsGet(k, d){ try{ const v = localStorage.getItem(LS + k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } }
function lsSet(k, v){ try{ localStorage.setItem(LS + k, JSON.stringify(v)); }catch(e){} }
function lsDel(k){ try{ localStorage.removeItem(LS + k); }catch(e){} }
const prefs = Object.assign({font: $('#font').options[0].value, fs: 16, lh: 1.9, indent: true, focus: false, side: true, ls: 0, wrap: 'char'}, lsGet('prefs', {}));
prefs.ls = 0; prefs.wrap = 'char';  // 자간 0, 글자 단위 줄 나눔으로 고정
const savePrefs = () => lsSet('prefs', prefs);
function applyPrefs(){
  $('#font').value = prefs.font; if($('#font').selectedIndex < 0) $('#font').selectedIndex = 0;
  $('#fsize').value = prefs.fs; $('#fsVal').textContent = prefs.fs; $('#lh').value = prefs.lh; $('#lhVal').textContent = String(Math.round(prefs.lh * 100) / 100);
  $('#indent').checked = prefs.indent;
  paper.style.setProperty('--font', $('#font').value);
  paper.style.setProperty('--fs', prefs.fs + 'px');
  paper.style.setProperty('--lh', prefs.lh);
  paper.classList.toggle('indent', !!prefs.indent);
  paper.style.setProperty('--ls', (prefs.ls / 100) + 'em');
  paper.style.setProperty('--wb', prefs.wrap === 'word' ? 'keep-all' : 'normal');
  app.classList.toggle('focus', !!prefs.focus);
  app.classList.toggle('side-off', !prefs.side);
}

/* ---------- 기기 저장소 (IndexedDB) ----------
   원고 한 편: {id, title, html, chars, updatedAt, dirty, deleted, fileId, rev}
   dirty = 드라이브에 아직 올라가지 않은 변경이 있음 */
const DB = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((ok, bad) => {
    const r = indexedDB.open('wongo', 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if(!d.objectStoreNames.contains('ms')) d.createObjectStore('ms', {keyPath: 'id'});
      if(!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error);
  }));
  const run = async (name, mode, body) => {
    const d = await open();
    return new Promise((ok, bad) => {
      const t = d.transaction(name, mode); let out;
      t.oncomplete = () => ok(out); t.onerror = () => bad(t.error); t.onabort = () => bad(t.error);
      body(t.objectStore(name), v => { out = v; });
    });
  };
  return {
    all: () => run('ms', 'readonly', (s, set) => { const q = s.getAll(); q.onsuccess = () => set(q.result); }),
    get: id => run('ms', 'readonly', (s, set) => { const q = s.get(id); q.onsuccess = () => set(q.result); }),
    put: rec => run('ms', 'readwrite', s => { s.put(rec); }),
    del: id => run('ms', 'readwrite', s => { s.delete(id); }),
    /* 읽고-고치고-쓰기를 한 번에: fn이 null이면 지우고, undefined면 그대로 둔다 */
    update: (id, fn) => run('ms', 'readwrite', (s, set) => {
      const q = s.get(id);
      q.onsuccess = () => { const nv = fn(q.result); if(nv === null) s.delete(id); else if(nv !== undefined) s.put(nv); set(nv); };
    })
  };
})();
if(navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ---------- 상태 ---------- */
let cur = null, list = [], dirty = false, saving = false, timer = null;
const titleVal = () => $('#title').value.trim() || '제목 없는 원고';
function setSave(state, msg){
  const el = $('#saveState');
  el.classList.toggle('err', state === 'error');
  el.textContent = msg || {pending: '입력 중', saving: '저장 중…', saved: '기기에 저장됨', error: '저장 실패'}[state] || '';
  if(state === 'error' && narrow()) toast(el.textContent);
}
function notice(text, btnLabel, onBtn){
  $('#noticeText').textContent = text; $('#notice').hidden = false;
  const b = $('#noticeBtn'); b.hidden = !btnLabel; b.textContent = btnLabel || ''; b.onclick = onBtn || null;
}
$('#noticeClose').onclick = () => { $('#notice').hidden = true; };

/* ---------- 통계 · 목차 ---------- */
const plain = () => paper.innerText.replace(/ /g, ' ');
const countChars = () => plain().replace(/\n/g, '').length;
function stats(){
  const t = plain(), chars = t.replace(/\n/g, '').length;
  $('#sChars').textContent = chars.toLocaleString();
  $('#sNoSp').textContent = t.replace(/\s/g, '').length.toLocaleString();
  $('#sPages').textContent = (chars / 200).toFixed(1);
  paper.classList.toggle('blank', t.trim() === '');
}
const chapRe = /^(제\s*\d+\s*[장화부막편]|\d+\s*[.)]\s|#\s)/;
let olTimer;
function outlineSoon(){ clearTimeout(olTimer); olTimer = setTimeout(outline, 500); }
function outline(){
  const ul = $('#outline'); ul.textContent = '';
  const items = [...paper.children].filter(el => el.classList.contains('chap') || chapRe.test(el.innerText.trim()));
  if(!items.length){ const li = document.createElement('li'); li.className = 'empty'; li.textContent = '아직 항목이 없습니다'; ul.appendChild(li); return; }
  for(const el of items){
    const li = document.createElement('li'), b = document.createElement('button');
    b.textContent = el.innerText.trim().replace(/^#\s*/, '').slice(0, 40) || '(제목 없음)';
    b.onclick = () => { el.scrollIntoView({behavior: 'smooth', block: 'start'}); if(narrow()) drawer(false); };
    li.appendChild(b); ul.appendChild(li);
  }
}

/* ---------- 원고 목록 ---------- */
function fmtWhen(t){
  if(!t) return '';
  const d = new Date(t);
  return d.toDateString() === new Date().toDateString() ? hhmm(t) : (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
}
let trash = [];
async function refreshList(){
  const all = (await DB.all()).filter(r => !r.deleted);
  list = all.filter(r => !r.trashed); trash = all.filter(r => r.trashed);
  renderList(); renderTrash();
}
function renderList(){
  const ul = $('#msList'); ul.textContent = '';
  const items = list.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if(!items.length){ const li = document.createElement('li'); li.className = 'hint'; li.textContent = '원고가 없습니다'; ul.appendChild(li); return; }
  for(const m of items){
    const li = document.createElement('li'); li.className = 'ms' + (cur && cur.id === m.id ? ' on' : '');
    const open = document.createElement('button'); open.className = 'ms-open';
    const t = document.createElement('span'); t.className = 'ms-t'; t.textContent = m.title || '제목 없는 원고';
    const mm = document.createElement('span'); mm.className = 'ms-m';
    mm.textContent = ((m.chars || 0) / 200).toFixed(1) + '매 · ' + fmtWhen(m.updatedAt);
    if(m.dirty && Drive.enabled()){ const dot = document.createElement('span'); dot.className = 'dot'; dot.textContent = ' · 올릴 내용 있음'; mm.appendChild(dot); }
    open.append(t, mm); open.onclick = () => openMs(m.id);
    const del = document.createElement('button'); del.className = 'ms-del'; del.textContent = '삭제'; del.title = '휴지통으로 옮기기';
    del.onclick = () => trashMs(m.id);
    li.append(open, del); ul.appendChild(li);
  }
}

/* ---------- 열기 · 저장 ---------- */
function setContent(html, title){
  paper.innerHTML = html && html.trim() ? html : '<div><br></div>';
  $('#title').value = title && title !== '제목 없는 원고' ? title : '';
  stats(); outline();
}
async function openMs(id){
  if(cur && cur.id === id){ if(narrow()) drawer(false); return; }
  await flush();
  const r = await DB.get(id);
  if(!r || r.deleted){ await refreshList(); return; }
  cur = {id};
  setContent(r.html, r.title);
  lsSet('last', id);
  renderList();
  setSave('saved', '');
  if(narrow()) drawer(false);
}
function schedule(ms){ clearTimeout(timer); timer = setTimeout(() => flush(), ms); }
function onEdit(){
  if(!cur) return;
  dirty = true; setSave('pending'); stats(); outlineSoon();
  schedule(800);
}
async function flush(){
  if(!cur || !dirty) return;
  if(saving){ schedule(300); return; }
  saving = true; dirty = false; clearTimeout(timer);
  const id = cur.id, html = paper.innerHTML, title = titleVal(), chars = countChars(), now = Date.now();
  try{
    await DB.update(id, r => Object.assign({id, fileId: null, rev: null}, r || {}, {title, html, chars, updatedAt: now, dirty: true, deleted: false}));
    setSave('saved', '기기에 저장됨 · ' + hhmm(now));
    const m = list.find(x => x.id === id);
    if(m){ Object.assign(m, {title, chars, updatedAt: now, dirty: true}); renderList(); } else refreshList();
    Drive.soon(4000);
  }catch(e){
    dirty = true;
    setSave('error', e && e.name === 'QuotaExceededError' ? '기기 저장 공간이 부족합니다' : '기기에 저장하지 못했습니다');
  }finally{ saving = false; }
  if(dirty) schedule(800);
}
async function newMs(title, html){
  await flush();
  const id = newId();
  cur = {id};
  setContent(html || '', title || '');
  dirty = true; await flush();
  lsSet('last', id); await refreshList();
  paper.focus();
}
/* ---------- 휴지통 ---------- */
const TRASH_DAYS = 30;
function renderTrash(){
  const ul = $('#trashList'); ul.textContent = '';
  $('#trashToggle').hidden = !trash.length;
  $('#trashCount').textContent = trash.length ? '(' + trash.length + ')' : '';
  if(!trash.length){ $('#trashPanel').hidden = true; $('#trashToggle').setAttribute('aria-expanded', 'false'); return; }
  for(const m of trash.slice().sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0))){
    const li = document.createElement('li'); li.className = 'ms';
    const info = document.createElement('div'); info.className = 'ms-open';
    const t = document.createElement('span'); t.className = 'ms-t'; t.textContent = m.title || '제목 없는 원고';
    const mm = document.createElement('span'); mm.className = 'ms-m';
    const left = Math.max(0, TRASH_DAYS - Math.floor((Date.now() - (m.trashedAt || Date.now())) / 86400000));
    mm.textContent = ((m.chars || 0) / 200).toFixed(1) + '매 · ' + left + '일 뒤 지워짐';
    info.append(t, mm);
    const btns = document.createElement('div'); btns.className = 'tr-btns';
    const back = document.createElement('button'); back.className = 'tr-btn'; back.textContent = '되살리기';
    back.onclick = () => restoreMs(m.id);
    const del = document.createElement('button'); del.className = 'tr-btn del'; del.textContent = '완전 삭제';
    let armT;
    del.onclick = () => {
      if(!del.classList.contains('arm')){ del.classList.add('arm'); del.textContent = '정말 삭제'; armT = setTimeout(() => { del.classList.remove('arm'); del.textContent = '완전 삭제'; }, 3000); return; }
      clearTimeout(armT); purgeMs([m.id]);
    };
    btns.append(back, del); li.append(info, btns); ul.appendChild(li);
  }
}
$('#trashToggle').onclick = () => {
  const open = $('#trashPanel').hidden;
  $('#trashPanel').hidden = !open; $('#trashToggle').setAttribute('aria-expanded', String(open));
};
let emptyArmT;
$('#trashEmpty').onclick = () => {
  const b = $('#trashEmpty');
  if(!b.classList.contains('arm')){ b.classList.add('arm'); b.textContent = '정말 비우기 (' + trash.length + '편)'; emptyArmT = setTimeout(() => { b.classList.remove('arm'); b.textContent = '휴지통 비우기'; }, 3000); return; }
  clearTimeout(emptyArmT); b.classList.remove('arm'); b.textContent = '휴지통 비우기';
  purgeMs(trash.map(x => x.id));
};
async function openNext(){
  cur = null; dirty = false;
  const next = list.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  if(next) await openMs(next.id); else await newMs();
}
async function trashMs(id){
  if(cur && cur.id === id) await flush();
  const r = await DB.get(id); if(!r) return;
  if(!r.fileId && isBlank(r)) await DB.del(id);  // 아무것도 안 쓴 새 원고는 바로 지움
  else await DB.update(id, x => x ? Object.assign({}, x, {trashed: true, trashedAt: Date.now(), dirty: true}) : undefined);
  await refreshList();
  if(cur && cur.id === id) await openNext();
  if(r.fileId || !isBlank(r)) notice('「' + (r.title || '제목 없는 원고') + '」을(를) 휴지통으로 옮겼습니다.', '되돌리기', () => { $('#notice').hidden = true; restoreMs(id); });
  Drive.soon(1500);
}
async function restoreMs(id){
  await DB.update(id, x => x ? Object.assign({}, x, {trashed: false, trashedAt: null, dirty: true}) : undefined);
  await refreshList();
  await openMs(id);
  setSave('saved', '휴지통에서 되살렸습니다');
  Drive.soon(1500);
}
async function purgeMs(ids){
  for(const id of ids) await DB.update(id, r => !r ? undefined : r.fileId ? Object.assign({}, r, {deleted: true, dirty: false}) : null);
  await refreshList();
  Drive.soon(500);
}
async function purgeOldTrash(){
  const limit = Date.now() - TRASH_DAYS * 86400000;
  const old = (await DB.all()).filter(r => r.trashed && !r.deleted && (r.trashedAt || 0) < limit).map(r => r.id);
  if(old.length) await purgeMs(old);
}
async function removeMs(id){
  await DB.update(id, r => !r ? undefined : r.fileId ? Object.assign({}, r, {deleted: true, dirty: false}) : null);
  if(cur && cur.id === id){ cur = null; dirty = false; }
  await refreshList();
  if(!cur){
    const next = list.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if(next) await openMs(next.id); else await newMs();
  }
  Drive.soon(500);
}

const isBlank = r => !r.chars && (!r.title || r.title === '제목 없는 원고');
/* 드라이브에서 바뀐 내용이 들어왔을 때 */
async function onRemote(ch){
  if(cur && ch.added.size && !dirty){
    const r = await DB.get(cur.id);
    if(r && !r.fileId && isBlank(r) && !paper.innerText.trim()){  // 처음 열 때 만든 빈 원고는 치우고 받은 원고를 연다
      await DB.del(cur.id); cur = null;
      await refreshList();
      const next = list.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
      if(next) await openMs(next.id); else await newMs();
    }
  }
  await refreshList();
  if(cur && ch.removed.has(cur.id)){
    cur = null; dirty = false;
    const next = list.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
    if(next) await openMs(next.id); else await newMs();
    notice('지금 열려 있던 원고가 다른 기기에서 삭제되었습니다.');
  } else if(cur && ch.updated.has(cur.id) && !list.find(x => x.id === cur.id)){
    await openNext();
    notice('지금 열려 있던 원고를 다른 기기에서 휴지통으로 옮겼습니다.');
  } else if(cur && ch.updated.has(cur.id) && !dirty){
    const r = await DB.get(cur.id), top = $('#scroll').scrollTop;
    if(r){ setContent(r.html, r.title); $('#scroll').scrollTop = top; setSave('saved', '다른 기기의 내용을 받았습니다'); }
  }
  if(ch.conflicts.length) notice('「' + ch.conflicts.join('」, 「') + '」을(를) 두 기기에서 따로 고쳐서, 다른 기기의 내용은 「… (다른 기기 사본)」으로 따로 남겼습니다. 필요한 부분을 옮긴 뒤 사본을 지우세요.');
}

/* ---------- 메뉴 접기 · 목록 ---------- */
function setFocus(on){ prefs.focus = on; savePrefs(); app.classList.toggle('focus', on); if(on){ drawer(false); closeMenu(); } }
function drawer(on){ app.classList.toggle('drawer', on); }
$('#hideBtn').onclick = () => setFocus(true);
$('#fab').onclick = () => setFocus(false);
$('#sideBtn').onclick = () => {
  if(narrow()) drawer(!app.classList.contains('drawer'));
  else { prefs.side = !prefs.side; savePrefs(); app.classList.toggle('side-off', !prefs.side); }
};
$('#backdrop').onclick = () => drawer(false);

/* ---------- 도구 ---------- */
$('#tools').addEventListener('mousedown', e => { if(e.target.closest('button')) e.preventDefault(); });
document.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', () => { paper.focus(); document.execCommand(b.dataset.cmd); onEdit(); }));
function curBlock(){
  const s = getSelection(); if(!s.rangeCount) return null;
  let n = s.anchorNode; if(!paper.contains(n)) return null;
  while(n && n.parentNode !== paper) n = n.parentNode;
  return n && n !== paper ? n : null;
}
if($('#chapBtn')) $('#chapBtn').onclick = () => {
  let b = curBlock(); if(!b){ paper.focus(); return; }
  if(b.nodeType !== 1 || /^(BR|B|I|SPAN|STRONG|EM)$/.test(b.tagName)){ const d = document.createElement('div'); paper.insertBefore(d, b); d.appendChild(b); b = d; }
  b.classList.toggle('chap'); onEdit(); outline();
};
$('#font').onchange = () => { prefs.font = $('#font').value; savePrefs(); applyPrefs(); };
$('#fsize').oninput = () => { const v = +$('#fsize').value; if(v >= 11 && v <= 30){ prefs.fs = v; savePrefs(); applyPrefs(); } };
$('#lh').oninput = () => { prefs.lh = +$('#lh').value; savePrefs(); applyPrefs(); };
$('#indent').onchange = () => { prefs.indent = $('#indent').checked; savePrefs(); applyPrefs(); };

$('#title').addEventListener('input', onEdit);
$('#newBtn').onclick = () => newMs();

/* ---------- 찾기 · 바꾸기 ---------- */
function textNodes(){ const w = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT); const a = []; let n; while((n = w.nextNode())) a.push(n); return a; }
function replaceIn(f, r, once){
  if(!f) return 0; let done = 0;
  for(const n of textNodes()){
    if(!n.nodeValue.includes(f)) continue;
    if(once){ n.nodeValue = n.nodeValue.replace(f, () => r); return 1; }
    const parts = n.nodeValue.split(f); done += parts.length - 1; n.nodeValue = parts.join(r);
  }
  return done;
}
function openFind(){ $('#findbox').hidden = false; if(prefs.focus) setFocus(false); $('#fFind').focus(); $('#fFind').select(); }
$('#findBtn').onclick = () => { if($('#findbox').hidden) openFind(); else $('#findbox').hidden = true; };
$('#fClose').onclick = () => { $('#findbox').hidden = true; paper.focus(); };
$('#fCount').onclick = () => { const f = $('#fFind').value; $('#fInfo').textContent = f ? (plain().split(f).length - 1) + '건 있습니다' : '찾을 말을 입력하세요'; };
$('#fOne').onclick = () => { const n = replaceIn($('#fFind').value, $('#fRep').value, true); $('#fInfo').textContent = n ? '1건 바꿨습니다' : '찾는 말이 없습니다'; if(n) onEdit(); };
$('#fAll').onclick = () => { const n = replaceIn($('#fFind').value, $('#fRep').value, false); $('#fInfo').textContent = n + '건 바꿨습니다'; if(n) onEdit(); };

/* ---------- 키보드 · 입력 ---------- */
document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if(mod && e.key.toLowerCase() === 'f'){ e.preventDefault(); openFind(); }
  else if(mod && e.key.toLowerCase() === 's'){ e.preventDefault(); flush().then(() => Drive.soon(0)); }
  else if(e.key === 'Escape'){
    if(openPop) closePops();
    else if(!$('#findbox').hidden && $('#findbox').contains(document.activeElement)){ $('#findbox').hidden = true; paper.focus(); }
    else if(app.classList.contains('drawer')) drawer(false);
    else setFocus(!prefs.focus);
  }
});
paper.addEventListener('input', e => {
  if(e.inputType === 'insertParagraph'){
    const b = curBlock(), pr = b && b.previousElementSibling;
    if(b && b.nodeType === 1 && pr && b.classList.contains('chap') && pr.classList.contains('chap')){
      if(!pr.innerText.trim()) pr.classList.remove('chap'); else b.classList.remove('chap');
    }
  }
  onEdit();
});
paper.addEventListener('paste', e => {
  e.preventDefault();
  document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain'));
});
document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') flush(); else Drive.soon(300); });
window.addEventListener('pagehide', () => { flush(); });

/* ---------- 문단 모델 (내보내기용) ---------- */
function paragraphs(root){
  const paras = []; let p = null;
  const start = chap => { p = {runs: [], chap}; };
  const end = () => { if(p){ paras.push(p); p = null; } };
  (function walk(node, fmt, chap){
    for(const n of node.childNodes){
      if(n.nodeType === 3){ if(!p) start(chap); if(n.nodeValue) p.runs.push({t: n.nodeValue, b: fmt.b, i: fmt.i, r: fmt.r || 1}); }
      else if(n.nodeType === 1){
        const tag = n.tagName;
        if(tag === 'BR'){ if(!p) start(chap); end(); continue; }
        const f = {b: fmt.b || tag === 'B' || tag === 'STRONG' || /bold|[6-9]00/.test(n.style.fontWeight), i: fmt.i || tag === 'I' || tag === 'EM' || n.style.fontStyle === 'italic', r: n.classList && n.classList.contains('fs') ? (Number(n.dataset.r) || 1) : (fmt.r || 1)};
        if(/^(DIV|P|H[1-6]|LI)$/.test(tag)){
          end(); const c = chap || n.classList.contains('chap'); const before = paras.length;
          walk(n, f, c);
          if(p) end(); else if(paras.length === before){ start(c); end(); }
        } else walk(n, f, chap);
      }
    }
  })(root, {b: false, i: false, r: 1}, false);
  end();
  return paras;
}
function escapeHtml(s){ return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function parasToHtml(paras){
  return paras.map(p => {
    const inner = p.runs.map(r => { let s = escapeHtml(r.t.replace(/\t/g, ' ')); if(r.i) s = '<i>' + s + '</i>'; if(r.b) s = '<b>' + s + '</b>'; if(r.r && r.r !== 1) s = '<span class="fs" data-r="' + r.r + '" style="font-size:' + r.r + 'em">' + s + '</span>'; return s; }).join('');
    return '<div' + (p.chap ? ' class="chap"' : '') + '>' + (inner || '<br>') + '</div>';
  }).join('');
}

/* ---------- 불러오기 ---------- */
const importErrors = {
  hwp_password: '암호가 걸린 한글 문서는 열 수 없습니다. 한글에서 암호를 풀고 다시 저장해 주세요',
  hwp_distribution: '배포용 문서는 열 수 없습니다. 한글에서 일반 문서로 저장해 주세요',
  hwp_empty: '문서에서 본문을 찾지 못했습니다', hwpx_empty: '문서에서 본문을 찾지 못했습니다',
  unknown_format: '한글 문서 형식이 아닙니다', backup: '원고 편집기 백업 파일이 아닙니다',
  unsupported: 'HWP·HWPX·TXT 파일이나 원고 백업(.json)만 불러올 수 있습니다'
};
$('#importBtn').addEventListener('keydown', e => { if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); $('#fileIn').click(); } });
let toastT;
function toast(msg, ms){ const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms || 6000); }
$('#toast').addEventListener('click', () => { $('#toast').hidden = true; });
$('#importBtn').addEventListener('click', () => {
  let opened = false;
  const mark = () => { opened = true; };
  window.addEventListener('blur', mark, {once: true});
  document.addEventListener('visibilitychange', mark, {once: true});
  $('#fileIn').addEventListener('change', mark, {once: true});
  setTimeout(() => {
    window.removeEventListener('blur', mark); document.removeEventListener('visibilitychange', mark);
    if(!opened) toast('이 화면에서는 기기의 파일 선택 창이 열리지 않습니다. 크롬이나 사파리에서 열어 주세요.', 10000);
  }, 1500);
});
$('#fileIn').onchange = async () => {
  const f = $('#fileIn').files[0]; $('#fileIn').value = ''; if(!f) return;
  const ext = ((f.name.match(/\.([^.]+)$/) || [])[1] || '').toLowerCase();
  const title = f.name.replace(/\.(txt|hwp|hwpx|json)$/i, '');
  setSave('saving', '불러오는 중…');
  try{
    if(ext === 'json'){ const n = await importBackup(await f.text()); setSave('saved', '원고 ' + n + '편을 불러왔습니다'); return; }
    const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
    const binary = (head[0] === 0x50 && head[1] === 0x4B) || (head[0] === 0xD0 && head[1] === 0xCF);
    if(!binary && ext && ext !== 'txt' && ext !== 'text') throw new Error('unsupported');
    let html;
    if(binary) html = parasToHtml(await Hangul.read(f));
    else {
      const buf = await f.arrayBuffer(); let text;
      try{ text = new TextDecoder('utf-8', {fatal: true}).decode(buf); }catch(e){ text = new TextDecoder('euc-kr').decode(buf); }
      text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
      html = text.split('\n').map(l => l.trim() ? '<div>' + escapeHtml(l) + '</div>' : '<div><br></div>').join('');
    }
    await newMs(title, html);
    setSave('saved', f.name + ' 불러옴');
  }catch(e){ setSave('error', importErrors[e && e.message] || '이 파일을 읽지 못했습니다'); }
};
async function importBackup(text){
  const data = JSON.parse(text);
  const items = Array.isArray(data) ? data : data && Array.isArray(data.manuscripts) ? data.manuscripts : null;
  if(!items) throw new Error('backup');
  let n = 0;
  await flush();
  if(cur){  // 아무것도 쓰지 않은 처음 원고는 치운다
    const r = await DB.get(cur.id);
    if(r && !r.fileId && isBlank(r) && !paper.innerText.trim()){ await DB.del(cur.id); cur = null; }
  }
  for(const m of items){
    if(!m || typeof m.html !== 'string') continue;
    const id = newId() + n;
    await DB.put({id, title: m.title || '제목 없는 원고', html: m.html, chars: m.chars || 0, updatedAt: m.updatedAt || Date.now(), dirty: true, fileId: null, rev: null});
    n++;
  }
  await refreshList();
  const first = list.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  if(first && (!cur || n)){ cur = null; await openMs(first.id); }
  else if(!first) await newMs();
  Drive.soon(500);
  return n;
}

/* ---------- 내보내기 ---------- */
const fileBase = () => titleVal().replace(/[\\/:*?"<>|]/g, '').slice(0, 80) || '원고';
/* PC(크롬·엣지)에서는 '다른 이름으로 저장' 창을 띄우고, 그 밖에는 일반 내려받기 */
async function download(name, blob){
  if(window.showSaveFilePicker && !narrow()){
    try{
      const ext = name.slice(name.lastIndexOf('.'));
      const h = await window.showSaveFilePicker({suggestedName: name, types: [{description: ext.slice(1).toUpperCase() + ' 파일', accept: {[blob.type || 'application/octet-stream']: [ext]}}]});
      const w = await h.createWritable(); await w.write(blob); await w.close();
      return true;
    }catch(e){ if(e && e.name === 'AbortError') return false; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}
const saved = (ok, msg) => setSave('saved', ok ? msg : '저장을 취소했습니다');
const xmlEsc = s => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function docxBlob(paras, o){
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const sz = Math.round(o.px * 1.5), line = Math.round(Math.max(1, o.lh / 1.3) * 240), ind = sz * 10;
  const body = paras.map(p => {
    const ppr = p.chap
      ? '<w:pPr><w:keepNext/><w:jc w:val="left"/><w:spacing w:before="480" w:after="240" w:line="' + line + '" w:lineRule="auto"/></w:pPr>'
      : '<w:pPr><w:jc w:val="both"/><w:spacing w:after="0" w:line="' + line + '" w:lineRule="auto"/>' + (o.indent ? '<w:ind w:firstLine="' + ind + '" w:firstLineChars="100"/>' : '') + '</w:pPr>';
    const runs = p.runs.map(r => {
      const rpr = (r.b || p.chap ? '<w:b/>' : '') + (r.i ? '<w:i/>' : '') + ((p.chap ? 1.2 : 1) * (r.r || 1) !== 1 ? '<w:sz w:val="' + Math.round(sz * (p.chap ? 1.2 : 1) * (r.r || 1)) + '"/>' : '');
      return '<w:r>' + (rpr ? '<w:rPr>' + rpr + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + xmlEsc(r.t) + '</w:t></w:r>';
    }).join('');
    return '<w:p>' + ppr + runs + '</w:p>';
  }).join('');
  const doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="' + W + '"><w:body>' + body + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>';
  const fa = xmlEsc(o.font), fk = xmlEsc(o.fontKo);
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="' + W + '"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="' + fa + '" w:hAnsi="' + fa + '" w:eastAsia="' + fk + '" w:cs="' + fa + '"/>' + (o.ls ? '<w:spacing w:val="' + Math.round(o.px * 0.75 * 20 * o.ls / 100) + '"/>' : '') + '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:jc w:val="both"/><w:spacing w:after="0" w:line="' + line + '" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>';
  const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
  const R = 'http://schemas.openxmlformats.org/package/2006/relationships', OR = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + R + '"><Relationship Id="rId1" Type="' + OR + 'officeDocument" Target="word/document.xml"/></Relationships>';
  const drels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="' + R + '"><Relationship Id="rId1" Type="' + OR + 'styles" Target="styles.xml"/></Relationships>';
  const enc = new TextEncoder();
  return Hangul.zip([
    {name: '[Content_Types].xml', data: enc.encode(ct)}, {name: '_rels/.rels', data: enc.encode(rels)},
    {name: 'word/document.xml', data: enc.encode(doc)}, {name: 'word/styles.xml', data: enc.encode(styles)},
    {name: 'word/_rels/document.xml.rels', data: enc.encode(drels)}
  ]);
}
const curFont = () => $('#font').selectedOptions[0];
const hwpxBlob = () => Hangul.writeHwpx(paragraphs(paper), {font: curFont().dataset.wk, pt: Math.round(prefs.fs * 0.75 * 2) / 2, lh: prefs.lh, indent: prefs.indent, ls: prefs.ls, wrap: prefs.wrap, title: titleVal()}, HWPX_T);

/* ---------- 아이콘 메뉴 (서식·불러오기·저장) ---------- */
let openPop = null;
function closePops(){
  if(!openPop) return;
  openPop.hidden = true;
  const b = document.querySelector('[data-pop="' + openPop.id + '"]'); if(b) b.setAttribute('aria-expanded', 'false');
  openPop = null;
}
function togglePop(btn){
  const pop = document.getElementById(btn.dataset.pop);
  if(openPop === pop){ closePops(); return; }
  closePops();
  pop.hidden = false; openPop = pop; btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect();
  pop.style.top = Math.round(r.bottom + 6) + 'px';
  pop.style.left = Math.round(Math.max(8, Math.min(r.right - pop.offsetWidth, innerWidth - pop.offsetWidth - 8))) + 'px';
}
document.querySelectorAll('[data-pop]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); togglePop(b); }));
document.addEventListener('click', e => { if(openPop && !e.target.closest('.pop')) closePops(); });
document.querySelectorAll('.pop.menu').forEach(m => m.addEventListener('click', e => { if(e.target.closest('.mi')) setTimeout(closePops, 0); }));
window.addEventListener('resize', closePops);
const closeMenu = closePops;

/* ---------- 글자 크기: 전체(이 기기 설정) + 고른 부분(원고에 저장) ----------
   고른 부분은 <span class="fs" data-r="기준 대비 비율">로 감싼다. 비율이라 전체 크기를 바꾸면 함께 커지고 작아진다. */
let fsLastSel = null, fsRange = null, fsSpans = null;
document.addEventListener('selectionchange', () => {
  const sel = getSelection(); if(!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  if(!paper.contains(r.commonAncestorContainer)) return;
  fsLastSel = r.collapsed ? null : r.cloneRange();
});
function fsCurrentRange(){
  const sel = getSelection();
  if(sel.rangeCount){ const r = sel.getRangeAt(0); if(!r.collapsed && paper.contains(r.commonAncestorContainer)) return r.cloneRange(); }
  return fsLastSel && !fsLastSel.collapsed && paper.contains(fsLastSel.commonAncestorContainer) ? fsLastSel.cloneRange() : null;
}
function fsRatioOf(el){
  for(let n = el; n && n !== paper; n = n.parentNode) if(n.classList && n.classList.contains('fs')) return Number(n.dataset.r) || 1;
  return 1;
}
function fsWrap(range){
  const nodes = [], w = document.createTreeWalker(paper, NodeFilter.SHOW_TEXT); let n;
  while((n = w.nextNode())) if(n.nodeValue && range.intersectsNode(n)) nodes.push(n);
  const spans = [];
  for(let t of nodes){
    const s = t === range.startContainer ? range.startOffset : 0;
    const e = t === range.endContainer ? range.endOffset : t.nodeValue.length;
    if(e <= s) continue;
    if(e < t.nodeValue.length) t.splitText(e);
    if(s > 0) t = t.splitText(s);
    const sp = document.createElement('span'); sp.className = 'fs';
    t.parentNode.insertBefore(sp, t); sp.appendChild(t); spans.push(sp);
  }
  return spans;
}
function fsSet(spans, ratio){
  for(const sp of spans){
    const pr = fsRatioOf(sp.parentNode);
    sp.dataset.r = String(ratio);
    sp.style.fontSize = (Math.round(ratio / pr * 1000) / 1000) + 'em';
  }
}
function fsRangeOf(spans){
  const live = spans.filter(sp => sp.isConnected && sp.firstChild);
  if(!live.length) return null;
  const a = live[0].firstChild, z = live[live.length - 1].lastChild, r = document.createRange();
  r.setStart(a, 0); r.setEnd(z, z.nodeType === 3 ? z.nodeValue.length : z.childNodes.length);
  return r;
}
function fsCleanup(){
  paper.querySelectorAll('span.fs').forEach(sp => {
    if(!sp.textContent || Math.abs((Number(sp.dataset.r) || 1) - fsRatioOf(sp.parentNode)) < 0.001) sp.replaceWith(...sp.childNodes);
  });
}
function fsInit(){
  fsRange = fsCurrentRange(); fsSpans = null;
  const n = fsRange ? fsRange.toString().replace(/\s/g, '').length : 0;
  if(!n) fsRange = null;
  $('#selSize').disabled = !n; $('#selSizeReset').disabled = !n;
  $('#selSizeHint').textContent = n ? '고른 글 ' + n.toLocaleString() + '자' : '글을 끌어서 고른 뒤 열면 그 부분만 바꿀 수 있습니다';
  if(n){
    const c = fsRange.startContainer, el = c.nodeType === 3 ? c.parentNode : c;
    const px = Math.round(prefs.fs * fsRatioOf(el));
    $('#selSize').value = px; $('#selSizeVal').textContent = px;
  } else $('#selSizeVal').textContent = '–';
}
$('#fmtBtn').addEventListener('click', () => { if(!$('#fmtPop').hidden) fsInit(); });
$('#selSize').addEventListener('input', () => {
  if(!fsRange) return;
  const px = +$('#selSize').value;
  if(!fsSpans) fsSpans = fsWrap(fsRange);
  fsSet(fsSpans, Math.round(px / prefs.fs * 1000) / 1000);
  $('#selSizeVal').textContent = px;
});
$('#selSize').addEventListener('change', () => {
  if(!fsSpans) return;
  const r = fsRangeOf(fsSpans); fsCleanup(); fsRange = r; fsSpans = null;
  onEdit();
});
function fsReset(range){
  const sc = range.startContainer, so = range.startOffset, ec = range.endContainer, eo = range.endOffset;
  const mk = () => { const r = document.createRange(); r.setStart(sc, so); r.setEnd(ec, eo); return r; };
  paper.querySelectorAll('span.fs').forEach(sp => {
    if(!sp.isConnected) return;
    const tw = document.createTreeWalker(sp, NodeFilter.SHOW_TEXT), first = tw.nextNode(); if(!first) return;
    let last = first, t; while((t = tw.nextNode())) last = t;
    let cur; try{ cur = mk(); }catch(e){ return; }
    if(cur.comparePoint(first, 0) === 0 && cur.comparePoint(last, last.nodeValue.length) === 0) sp.replaceWith(...sp.childNodes);
  });
  let nr; try{ nr = mk(); }catch(e){ fsCleanup(); return null; }
  const spans = fsWrap(nr); fsSet(spans, 1);
  const after = fsRangeOf(spans); fsCleanup();
  return after;
}
$('#selSizeReset').onclick = () => {
  if(!fsRange) return;
  if(fsSpans){ const r0 = fsRangeOf(fsSpans); fsCleanup(); fsRange = r0 || fsRange; fsSpans = null; }
  const r = fsReset(fsRange); fsRange = r; fsSpans = null;
  $('#selSize').value = prefs.fs; $('#selSizeVal').textContent = prefs.fs;
  onEdit();
};


$('#exHwpx').onclick = async () => { closeMenu(); flush(); saved(await download(fileBase() + '.hwpx', await hwpxBlob()), '한글 파일로 내보냄'); };
$('#exDocx').onclick = async () => { closeMenu(); flush(); saved(await download(fileBase() + '.docx', await docxBlob(paragraphs(paper), {px: prefs.fs, lh: prefs.lh, indent: prefs.indent, ls: prefs.ls, font: curFont().dataset.w, fontKo: curFont().dataset.wk})), 'Word 파일로 내보냄'); };
$('#exTxt').onclick = async () => {
  closeMenu(); flush();
  const txt = paragraphs(paper).map(p => p.runs.map(r => r.t).join('')).join('\r\n');
  saved(await download(fileBase() + '.txt', new Blob(['﻿' + txt], {type: 'text/plain'})), '텍스트로 내보냄');
};
$('#exBackup').onclick = async () => {
  closeMenu(); await flush();
  const all = (await DB.all()).filter(r => !r.deleted && !r.trashed).map(r => ({title: r.title, html: r.html, chars: r.chars, updatedAt: r.updatedAt}));
  const d = new Date(), pad = n => String(n).padStart(2, '0');
  saved(await download('원고백업_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json', new Blob([JSON.stringify({app: 'wongo', v: 1, manuscripts: all})], {type: 'application/json'})), '원고 ' + all.length + '편을 백업했습니다');
};
$('#exDrive').onclick = async () => {
  closeMenu();
  if(!Drive.enabled()){ setSave('error', '구글 드라이브에 연결되어 있지 않습니다. 목록 아래에서 먼저 연결해 주세요'); return; }
  await flush();
  setSave('saving', '드라이브에 한글 파일 올리는 중…');
  try{
    const res = await Drive.saveHwpx(cur.id, titleVal(), await hwpxBlob());
    setSave('saved', '드라이브에 저장함 · ' + titleVal() + '.hwpx');
    if(res && res.webViewLink) notice('드라이브 \'원고 편집기\' 폴더에 「' + titleVal() + '.hwpx」를 저장했습니다.', '드라이브에서 열기', () => window.open(res.webViewLink, '_blank', 'noopener'));
  }catch(e){ setSave('error', Drive.errorText(e)); }
};

/* ---------- 구글 드라이브 ---------- */
const Drive = (() => {
  const CID = ((window.WONGO_CONFIG || {}).googleClientId || '').trim();
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const ROOT = '원고 편집기', DATA = '동기화 자료 (지우지 마세요)';
  let token = null, exp = 0, folders = null, running = false, again = false, soonT = null, lastSync = 0, st = 'idle';
  let wanted = !!lsGet('drive-on', false);
  const saved = lsGet('token', null);
  if(saved && saved.exp > Date.now()){ token = saved.token; exp = saved.exp; }
  const tokenOk = () => !!token && exp > Date.now();

  function loadGis(){
    if(window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    return new Promise((ok, bad) => {
      const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
      s.onload = () => ok(); s.onerror = () => { s.remove(); bad({code: 'network'}); };
      document.head.appendChild(s);
    });
  }
  async function requestToken(){
    await loadGis();
    return new Promise((ok, bad) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CID, scope: SCOPE, prompt: '',
        callback: resp => {
          if(resp && resp.access_token && google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)){
            token = resp.access_token; exp = Date.now() + (Number(resp.expires_in || 3600) - 120) * 1000;
            lsSet('token', {token, exp}); ok();
          } else bad({code: 'denied'});
        },
        error_callback: e => bad({code: e && e.type === 'popup_failed_to_open' ? 'popup' : 'denied'})
      });
      client.requestAccessToken();
    });
  }
  async function api(path, opt){
    opt = opt || {};
    if(!tokenOk()) throw {code: 'auth'};
    let r;
    try{ r = await fetch('https://www.googleapis.com' + path, Object.assign({}, opt, {headers: Object.assign({Authorization: 'Bearer ' + token}, opt.headers || {})})); }
    catch(e){ throw {code: 'network'}; }
    if(r.status === 401){ token = null; exp = 0; lsDel('token'); throw {code: 'auth'}; }
    if(r.status === 404) throw {code: 'notfound'};
    if(!r.ok){ let t = ''; try{ t = await r.text(); }catch(e){} throw {code: 'http', status: r.status, text: t.slice(0, 300)}; }
    if(r.status === 204) return null;
    const txt = await r.text();
    try{ return JSON.parse(txt); }catch(e){ return txt; }
  }
  const enc = encodeURIComponent;
  async function find(q, fields){
    let out = [], page = '';
    do{
      const res = await api('/drive/v3/files?q=' + enc(q) + '&fields=' + enc('nextPageToken,files(' + fields + ')') + '&pageSize=1000&spaces=drive' + (page ? '&pageToken=' + enc(page) : ''));
      out = out.concat(res.files || []); page = res.nextPageToken || '';
    } while(page);
    return out;
  }
  async function folder(name, parent){
    const q = "mimeType='application/vnd.google-apps.folder' and name='" + name.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "' and trashed=false" + (parent ? " and '" + parent + "' in parents" : '');
    const f = await find(q, 'id');
    if(f.length) return f[0].id;
    const body = {name, mimeType: 'application/vnd.google-apps.folder'}; if(parent) body.parents = [parent];
    return (await api('/drive/v3/files?fields=id', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})).id;
  }
  async function ensureFolders(){
    if(folders) return folders;
    const root = await folder(ROOT, null), data = await folder(DATA, root);
    return (folders = {root, data});
  }
  function upload(fileId, meta, body, mime){
    const b = 'wongo' + Math.random().toString(36).slice(2);
    const payload = new Blob(['--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + b + '\r\nContent-Type: ' + mime + '\r\n\r\n', body, '\r\n--' + b + '--\r\n']);
    return api('/upload/drive/v3/files' + (fileId ? '/' + fileId : '') + '?uploadType=multipart&fields=id,version,webViewLink', {method: fileId ? 'PATCH' : 'POST', headers: {'Content-Type': 'multipart/related; boundary=' + b}, body: payload});
  }
  const safeName = t => (t || '제목 없는 원고').replace(/[\\/]/g, ' ').slice(0, 120);

  async function sync(){
    if(!CID || !wanted) return render();
    if(running){ again = true; return; }
    if(navigator.onLine === false){ st = 'offline'; return render(); }
    if(!tokenOk()){ st = 'expired'; return render(); }
    running = true; st = 'syncing'; render();
    const ch = {updated: new Set(), removed: new Set(), added: new Set(), conflicts: []};
    try{
      await flush();
      const {data} = await ensureFolders();
      const files = await find("'" + data + "' in parents and trashed=false and appProperties has { key='kind' and value='ms' }", 'id,version,appProperties');
      const remote = new Map();
      for(const f of files){ const id = f.appProperties && f.appProperties.wpId; if(id && !remote.has(id)) remote.set(id, f); }
      const locals = await DB.all();
      // 1. 이 기기에서 지운 원고 → 드라이브 휴지통으로
      for(const l of locals.filter(x => x.deleted)){
        if(l.fileId){ try{ await api('/drive/v3/files/' + l.fileId + '?fields=id', {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({trashed: true})}); }catch(e){ if(e.code !== 'notfound') throw e; } }
        await DB.del(l.id); remote.delete(l.id);
      }
      // 2. 드라이브에서 바뀐 원고 → 이 기기로
      const known = new Map(locals.map(x => [x.id, x]));
      for(const [id, f] of remote){
        const l = known.get(id);
        if(l && (l.deleted || l.rev === f.version)) continue;
        const raw = await api('/drive/v3/files/' + f.id + '?alt=media');
        const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
        let outcome = null;
        await DB.update(id, r => {
          if(!r){ outcome = 'added'; return {id, title: d.title || '', html: d.html || '', chars: d.chars || 0, updatedAt: d.updatedAt || Date.now(), trashed: !!d.trashed, trashedAt: d.trashedAt || null, dirty: false, fileId: f.id, rev: f.version}; }
          if(r.deleted) return undefined;
          if(!r.dirty){ outcome = 'updated'; return Object.assign({}, r, {title: d.title, html: d.html, chars: d.chars, updatedAt: d.updatedAt, trashed: !!d.trashed, trashedAt: d.trashedAt || null, dirty: false, fileId: f.id, rev: f.version}); }
          if(r.html === d.html && r.title === d.title && !!r.trashed === !!d.trashed) return Object.assign({}, r, {dirty: false, fileId: f.id, rev: f.version});
          outcome = 'conflict'; return Object.assign({}, r, {fileId: f.id, rev: f.version});
        });
        if(outcome === 'added') ch.added.add(id);
        else if(outcome === 'updated') ch.updated.add(id);
        else if(outcome === 'conflict'){
          const cid = newId();
          await DB.put({id: cid, title: (d.title || '제목 없는 원고') + ' (다른 기기 사본)', html: d.html || '', chars: d.chars || 0, updatedAt: d.updatedAt || Date.now(), dirty: true, fileId: null, rev: null});
          ch.added.add(cid); ch.conflicts.push(d.title || '제목 없는 원고');
        }
      }
      // 3. 다른 기기에서 지운 원고
      for(const l of await DB.all()){
        if(l.deleted || !l.fileId || remote.has(l.id)) continue;
        let gone = false;
        await DB.update(l.id, r => { if(!r || r.deleted) return undefined; if(!r.dirty){ gone = true; return null; } return Object.assign({}, r, {fileId: null, rev: null}); });
        if(gone) ch.removed.add(l.id);
      }
      // 4. 이 기기의 변경 → 드라이브로
      for(const l of await DB.all()){
        if(l.deleted || !l.dirty) continue;
        if(!l.fileId && isBlank(l)) continue;  // 아무것도 쓰지 않은 새 원고는 올리지 않음
        const body = JSON.stringify({app: 'wongo', v: 1, id: l.id, title: l.title, html: l.html, chars: l.chars, updatedAt: l.updatedAt, trashed: !!l.trashed, trashedAt: l.trashedAt || null});
        const create = {name: safeName(l.title) + '.json', parents: [data], mimeType: 'application/json', appProperties: {kind: 'ms', wpId: l.id}};
        let res;
        if(l.fileId){
          try{ res = await upload(l.fileId, {name: create.name}, body, 'application/json'); }
          catch(e){ if(e.code === 'notfound') res = await upload(null, create, body, 'application/json'); else throw e; }
        } else res = await upload(null, create, body, 'application/json');
        await DB.update(l.id, r => r ? Object.assign({}, r, {fileId: res.id, rev: res.version, dirty: r.updatedAt !== l.updatedAt}) : undefined);
      }
      lastSync = Date.now(); st = 'ok';
    }catch(e){
      if(e.code === 'notfound') folders = null;
      st = e.code === 'auth' ? 'expired' : (e.code === 'network' || navigator.onLine === false) ? 'offline' : 'error';
      if(st === 'error') console.warn('동기화 실패', e);
    }finally{
      running = false;
      if(ch.added.size || ch.updated.size || ch.removed.size || ch.conflicts.length) await onRemote(ch);
      else await refreshList();
      render();
      if(again){ again = false; soon(500); }
    }
  }
  function soon(ms){ if(!CID || !wanted) return; clearTimeout(soonT); soonT = setTimeout(sync, ms); }

  async function connect(){
    if(navigator.onLine === false){ st = 'offline'; render(); return; }
    try{
      await requestToken();
      wanted = true; lsSet('drive-on', true); folders = null;
      await sync();
    }catch(e){
      st = e.code === 'popup' ? 'popup' : e.code === 'network' ? 'offline' : 'denied'; render();
    }
  }
  function disconnect(){
    wanted = false; lsSet('drive-on', false); token = null; exp = 0; lsDel('token'); st = 'idle'; render();
  }
  async function saveHwpx(id, title, blob){
    if(navigator.onLine === false) throw {code: 'network'};
    if(!tokenOk()) throw {code: 'auth'};
    const {root} = await ensureFolders();
    const ex = await find("'" + root + "' in parents and trashed=false and appProperties has { key='wpId' and value='" + id + "' }", 'id');
    const name = safeName(title) + '.hwpx';
    try{
      return await upload(ex.length ? ex[0].id : null, ex.length ? {name} : {name, parents: [root], mimeType: 'application/hwp+zip', appProperties: {kind: 'hwpx', wpId: id}}, blob, 'application/hwp+zip');
    }catch(e){ if(e.code === 'notfound') folders = null; throw e; }
  }
  function errorText(e){
    const c = e && e.code;
    if(c === 'network') return '인터넷에 연결되어 있지 않습니다. 연결된 뒤 다시 시도해 주세요';
    if(c === 'auth') return '드라이브 연결이 만료되었습니다. 목록 아래 \'다시 연결\'을 눌러 주세요';
    if(c === 'http' && e.status === 403) return '드라이브가 요청을 거절했습니다 (용량이나 권한을 확인해 주세요)';
    return '드라이브에 저장하지 못했습니다';
  }

  function render(){
    const s = $('#syncState'), tag = $('#syncTag'), btn = $('#syncBtn'), now = $('#syncNowBtn');
    s.classList.remove('err'); tag.classList.remove('err');
    const pending = list.filter(x => x.dirty).length;
    const set = (html, tagText, b, showNow, err) => {
      s.innerHTML = html; tag.textContent = tagText;
      btn.hidden = !b; if(b) btn.textContent = b;
      now.hidden = !showNow;
      $('#driveOffBtn').hidden = !(CID && wanted);
      if(err){ s.classList.add('err'); tag.classList.add('err'); }
    };
    if(!CID) return set('<b>구글 드라이브 동기화 꺼짐</b><br>설정 안내서의 2단계를 마치면 켤 수 있습니다. 지금은 이 기기에만 저장됩니다.', '이 기기에 저장', null, false);
    if(!wanted){
      if(st === 'popup') return set('로그인 창이 막혔습니다. 브라우저의 팝업 차단을 풀고 다시 눌러 주세요.', '이 기기에 저장', '드라이브 연결', false, true);
      if(st === 'denied') return set('드라이브 연결을 마치지 못했습니다. 다시 눌러 주세요.', '이 기기에 저장', '드라이브 연결', false, true);
      if(st === 'offline') return set('인터넷에 연결된 뒤 드라이브에 연결할 수 있습니다.', '이 기기에 저장', '드라이브 연결', false);
      return set('<b>구글 드라이브</b><br>연결하면 다른 기기와 원고가 이어집니다.', '이 기기에 저장', '드라이브 연결', false);
    }
    const p = pending ? ' · 올릴 원고 ' + pending + '편' : '';
    if(st === 'syncing') return set('<b>동기화 중…</b>', '동기화 중…', null, false);
    if(st === 'offline') return set('<b>오프라인</b><br>원고는 이 기기에 저장되고, 연결되면 드라이브에 올라갑니다' + p + '.', '오프라인 · 기기에 저장됨' + p, null, false);
    if(st === 'expired' || (!tokenOk() && st !== 'error')) return set('<b>드라이브 연결이 만료되었습니다</b><br>구글 보안 정책상 한 시간마다 다시 연결해야 합니다. 원고는 이 기기에 계속 저장됩니다' + p + '.', '다시 연결 필요' + p, '다시 연결', false, true);
    if(st === 'error') return set('<b>동기화하지 못했습니다</b><br>잠시 뒤 다시 시도합니다' + p + '.', '동기화 실패' + p, null, true, true);
    if(st === 'ok') return set('<b>드라이브와 맞춤</b> · ' + hhmm(lastSync) + p, '드라이브 동기화됨 · ' + hhmm(lastSync) + p, null, true);
    return set('<b>구글 드라이브 연결됨</b>' + p, '드라이브 연결됨' + p, null, true);
  }

  $('#syncBtn').onclick = connect;
  $('#syncNowBtn').onclick = () => { flush().then(sync); };
  $('#driveOffBtn').onclick = () => {
    const b = $('#driveOffBtn');
    if(!b.classList.contains('arm')){ b.classList.add('arm'); b.textContent = '정말 끊기'; setTimeout(() => { b.classList.remove('arm'); b.textContent = '연결 끊기'; }, 3000); return; }
    b.classList.remove('arm'); b.textContent = '연결 끊기'; disconnect();
  };
  window.addEventListener('online', () => soon(300));
  window.addEventListener('offline', () => { if(wanted){ st = 'offline'; render(); } });
  setInterval(() => { if(document.visibilityState === 'visible' && wanted && tokenOk()) sync(); }, 60000);
  setInterval(() => { if(wanted && st === 'ok' && !tokenOk()){ st = 'expired'; render(); } if(st === 'error') soon(0); }, 30000);

  return {
    enabled: () => !!CID && wanted && tokenOk(),
    start(){
      render();
      if(CID && navigator.onLine !== false) loadGis().catch(() => {});  // 로그인 창이 막히지 않도록 미리 불러 둠
      if(CID && wanted) sync();
    },
    soon, sync, saveHwpx, errorText, render
  };
})();

/* ---------- 오프라인 실행 · 앱 설치 ---------- */
if('serviceWorker' in navigator && location.protocol !== 'file:'){
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if(reloading) location.reload(); });
  const offerUpdate = w => notice('새 버전이 준비되었습니다. 지금 쓰는 원고는 저장되어 있습니다.', '새 버전 적용', () => { flush().then(() => { reloading = true; w.postMessage('skip'); }); });
  navigator.serviceWorker.register('sw.js').then(reg => {
    if(reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if(w) w.addEventListener('statechange', () => { if(w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w); });
    });
  }).catch(() => {});
}
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('#installBtn').hidden = false; });
$('#installBtn').onclick = async () => { if(!installEvt) return; installEvt.prompt(); try{ await installEvt.userChoice; }catch(e){} installEvt = null; $('#installBtn').hidden = true; };
window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; });

/* ---------- 시작 ---------- */
window.__wongo = {paragraphs, DB, Drive, flush};
(async function boot(){
  applyPrefs();
  if(narrow()) drawer(false);
  await purgeOldTrash();
  await refreshList();
  const last = lsGet('last', null);
  const pick = list.find(x => x.id === last) || list.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  if(pick) await openMs(pick.id); else await newMs();
  paper.contentEditable = 'true';
  setSave('saved', '');
  Drive.start();
})();
})();
