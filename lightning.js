/* MYWONGO 라이트닝 — 쓴 데까지 정리하고 이어 쓰기
   지금은 A 방식: 앱이 프롬프트를 만들어 복사해 주면, 작가가 Claude에 붙여 넣고 받은 답을 다시 붙여 넣는다.
   원고는 작가가 하나하나 보고 수락한 것만 바뀐다. */
(() => {
'use strict';

/* ================= 화면과 상관없는 부분 (문장 나누기·프롬프트·답 읽기·비교) ================= */

/* 문장 나누기: 따옴표 안의 마침표에서는 끊지 않고, "…" 하고 처럼 따옴표 뒤에 말이 이어지면 붙여 둔다.
   말줄임(..., …)은 문장 끝으로 보지 않는다. 잘못 나뉘어도 번호로 맞추므로 원고가 어긋나지는 않는다. */
const OPEN = '“‘「『（(〈《[{', CLOSE = '”’」』）)〉》]}';
const STOP = '.?!。？！', TERM = '.?!。？！…⋯';
const AFTER_Q = /^\s*(하고|하며|하면서|하는|하자|하니|하더니|하곤|하였다|했다|한다|하던|라고|라며|라는|라면서|이라고|이라며|고|며)(\s|$|[.,])/;
function splitSents(text){
  const out = [], n = text.length;
  let st = 0, depth = 0, dq = false, sq = false;
  const cut = k => { const s = text.slice(st, k).trim(); if(s) out.push(s); st = k; };
  const tryCut = (k, afterQ) => {
    if(k < n && !/\s/.test(text[k])) return;
    if(afterQ && AFTER_Q.test(text.slice(k))) return;
    cut(k);
  };
  const closeQ = i => { if(!depth && !dq && !sq && i > 0 && TERM.includes(text[i - 1])) tryCut(i + 1, true); };
  for(let i = 0; i < n; i++){
    const c = text[i];
    if(OPEN.includes(c)){ depth++; continue; }
    if(CLOSE.includes(c)){ depth = Math.max(0, depth - 1); closeQ(i); continue; }
    if(c === '"'){ if(dq){ dq = false; closeQ(i); } else dq = true; continue; }
    if(c === "'"){ if(sq){ sq = false; closeQ(i); } else sq = true; continue; }
    if(STOP.includes(c) && !depth && !dq && !sq){
      let j = i; while(j + 1 < n && TERM.includes(text[j + 1])) j++;
      const run = text.slice(i, j + 1);
      i = j;
      if(run.length > 1 && /^[.…⋯]+$/.test(run)) continue;
      tryCut(j + 1, false);
    }
  }
  cut(n);
  return out;
}

const splitKw = s => (s || '').split(/[,，、/]/).map(x => x.trim().replace(/^#/, '')).filter(Boolean).slice(0, 6);
const lenText = len => len === 'para' ? '한 문단(3~5문장)' : '한두 문장';
const clip = (t, k) => t.length > k ? t.slice(0, k) + '…' : t;

function fragLines(frags){
  const L = [];
  if(!frags.length) return L;
  L.push('', '[조각] 작가가 모아 둔 소재');
  for(const f of frags) L.push('{' + f.num + '} ' + (f.k && f.k.length ? '핵심어: ' + f.k.join(', ') : '핵심어 없음') + ' | ' + clip(f.t.replace(/\s+/g, ' '), 300));
  return L;
}
function ctxLines(se, numbered){
  const L = [];
  if(se.before) L.push('', '[앞 문맥] 참고만 하고 고치지 않는다', se.before);
  L.push('', '[원문]');
  for(const p of se.paras){
    if(p.sep) L.push('(장면 구분 ' + p.text + ')');
    else L.push(numbered ? p.sents.map(s => '[' + s.n + '] ' + s.t).join(' ') : p.text);
  }
  L.push('▶');
  if(se.after) L.push('', '[뒤 문맥] 참고만 하고 고치지 않는다', se.after);
  return L;
}

function buildPrompt(se, frags, len){
  const needKw = frags.some(f => !f.k || !f.k.length);
  const L = [];
  L.push('소설가가 생각과 문장을 뒤섞어 빠르게 쓴 원고를 정리해 줘. 가장 중요한 것은 작가의 문체를 지키는 것이다.');
  L.push('');
  L.push('1. [원문]의 번호 붙은 문장을 하나씩 판단한다.');
  L.push('- 그대로 둘 문장 → [번호] =');
  L.push('- 고칠 문장 → [번호] 고친 문장. 오탈자, 맞춤법, 띄어쓰기, 어색한 연결만 고친다. 어휘, 어미, 시제, 시점, 문장 길이, 대사 따옴표 방식은 작가의 것을 따르고 내용은 바꾸지 않는다.');
  L.push('- 겹치거나 군더더기인 문장 → [번호] 삭제');
  L.push('- 소설 문장이 아니라 작가가 스스로에게 남긴 생각이나 메모 → [번호] 메모 | 핵심어, 핵심어');
  if(frags.length) L.push('- [조각]의 소재가 그 자리에 꼭 맞을 때만 새 문장을 넣는다 → [번호+] {조각번호} 새 문장. 그 번호 문장 바로 뒤에 들어간다. 전체에서 많아야 두 개.');
  let step = 2;
  if(needKw) L.push((step++) + '. [조각] 가운데 "핵심어 없음"인 것마다 핵심어를 2~4개 붙인다.');
  L.push(step + '. [원문] 끝 ▶ 자리에서 이어질 문장 후보 3개를 만든다. 셋은 방향이 서로 달라야 하고, 각각 ' + lenText(len) + '이며, 작가의 문체로 쓴다.' + (se.after ? ' [뒤 문맥]으로 자연스럽게 이어져야 한다.' : ''));
  L.push('');
  L.push('답은 아래 형식만 쓴다. 설명, 인사, 마크다운, 코드 블록은 쓰지 않는다. [정리]에는 원문의 모든 번호를 차례대로 적는다.');
  L.push('[정리]', '[1] =', '[2] 고친 문장', '…');
  if(needKw) L.push('[조각 핵심어]', '{조각번호} 핵심어, 핵심어');
  L.push('[이어쓰기]', '[갈래1] 이 후보가 가는 방향 한 줄', '[문장1] 후보 문장', '[갈래2] …', '[문장2] …', '[갈래3] …', '[문장3] …');
  return L.concat(fragLines(frags), ctxLines(se, true)).join('\n');
}

function buildReroll(se, frags, len, cands, k){
  const L = [];
  L.push('소설 원고 [원문] 끝 ▶ 자리에서 이어질 문장 후보 ' + k + '개를 새로 만들어 줘. [이미 나온 후보]와 방향이 겹치지 않아야 하고 서로도 달라야 한다. 각각 ' + lenText(len) + '이며, 작가의 문체(어휘, 어미, 시제, 시점, 문장 길이, 대사 따옴표 방식)를 그대로 따른다.' + (se.after ? ' [뒤 문맥]으로 자연스럽게 이어져야 한다.' : '') + (frags.length ? ' [조각]의 소재는 꼭 맞을 때만 쓴다.' : ''));
  L.push('');
  L.push('답은 아래 형식만 쓴다. 설명, 인사, 마크다운은 쓰지 않는다.');
  for(let i = 1; i <= k; i++) L.push('[갈래' + i + '] 방향 한 줄', '[문장' + i + '] 후보 문장');
  if(cands.length){ L.push('', '[이미 나온 후보]'); cands.forEach(c => L.push('- ' + (c.d ? c.d + ': ' : '') + c.t)); }
  return L.concat(fragLines(frags), ctxLines(se, false)).join('\n');
}

/* 받은 답 읽기. 형식이 조금 흐트러져도(글머리표, 굵게, 코드 블록) 읽고, 모르는 줄은 건너뛴다. */
function parseResp(raw, nSents){
  const res = {ops: {}, ins: [], kw: {}, cands: [], hits: 0};
  const cm = {};
  let sec = '';
  for(const line of String(raw || '').replace(/```[a-zA-Z]*/g, '').split(/\r?\n/)){
    const l = line.trim().replace(/^[-*•>]\s*/, '').replace(/\*\*/g, '').trim();
    if(!l) continue;
    if(/^\[\s*정리\s*\]$/.test(l)){ sec = 't'; continue; }
    if(/^\[\s*조각\s*핵심어\s*\]$/.test(l)){ sec = 'k'; continue; }
    if(/^\[\s*이어\s*쓰기\s*\]$/.test(l)){ sec = 'c'; continue; }
    let m = l.match(/^\[\s*(갈래|문장)\s*(\d+)\s*\]\s*[:：]?\s*(.*)$/);
    if(m){ const c = cm[m[2]] = cm[m[2]] || {}; c[m[1] === '갈래' ? 'd' : 't'] = m[3].trim(); res.hits++; continue; }
    if(sec === 'k' && (m = l.match(/^\{\s*(\d+)\s*\}\s*[:：]?\s*(.*)$/))){ res.kw[+m[1]] = splitKw(m[2]); continue; }
    m = l.match(/^\[\s*(\d+)\s*(\+)?\s*\]\s*(.*)$/);
    if(!m || sec === 'c' || sec === 'k') continue;
    const n = +m[1], rest = m[3].trim();
    if(n < 1 || n > nSents) continue;
    res.hits++;
    if(m[2]){
      const fm = rest.match(/^\{\s*(\d+)\s*\}\s*(.*)$/), t = (fm ? fm[2] : rest).trim();
      if(t) res.ins.push({after: n, frag: fm ? +fm[1] : null, t});
      continue;
    }
    if(!rest || /^[=＝]/.test(rest) || rest === '그대로'){ res.ops[n] = {k: 'same'}; continue; }
    if(/^삭제\.?$/.test(rest)){ res.ops[n] = {k: 'del'}; continue; }
    const mm = rest.match(/^메모\s*(?:[|｜:：]\s*(.*))?$/);
    if(mm){ res.ops[n] = {k: 'memo', kw: splitKw(mm[1])}; continue; }
    res.ops[n] = {k: 'edit', t: rest};
  }
  res.cands = Object.keys(cm).sort((a, b) => a - b).map(k => cm[k]).filter(c => c.t).map(c => ({d: c.d || '', t: c.t, pin: false}));
  return res;
}

/* 글자 단위 비교: 원문에서 빠진 글자와 새로 들어온 글자를 표시한다 */
function cdiff(a, b){
  const n = a.length, m = b.length;
  if(!n || !m || n * m > 160000) return null;
  const dp = []; for(let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
  for(let i = n - 1; i >= 0; i--) for(let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let ops = []; let i = 0, j = 0;
  const push = (t, s) => { const l = ops[ops.length - 1]; if(l && l.t === t) l.s += s; else ops.push({t, s}); };
  while(i < n && j < m){
    if(a[i] === b[j]){ push('=', a[i]); i++; j++; }
    else if(dp[i + 1][j] >= dp[i][j + 1]) push('-', a[i++]);
    else push('+', b[j++]);
  }
  while(i < n) push('-', a[i++]);
  while(j < m) push('+', b[j++]);
  // 바뀐 곳 사이에 낀 한 글자는 바뀐 덩이에 넣어 읽기 쉽게
  const out = []; let del = '', ins = '';
  const flush = () => { if(del) out.push({t: '-', s: del}); if(ins) out.push({t: '+', s: ins}); del = ins = ''; };
  ops.forEach((o, k) => {
    const lone = o.t === '=' && o.s.length === 1 && k > 0 && k < ops.length - 1 && ops[k - 1].t !== '=' && ops[k + 1].t !== '=';
    if(o.t === '-') del += o.s;
    else if(o.t === '+') ins += o.s;
    else if(lone){ del += o.s; ins += o.s; }
    else { flush(); out.push(o); }
  });
  flush();
  return {ops: out, sim: dp[0][0] / Math.max(n, m)};
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function diffHtml(a, b){
  const d = cdiff(a, b);
  if(!d || d.sim < 0.4) return '<del>' + esc(a) + '</del> <ins>' + esc(b) + '</ins>';
  return d.ops.map(o => {
    if(o.t === '=') return esc(o.s);
    const sp = !o.s.trim();  // 띄어쓰기만 바뀐 곳: ∨ 띄우기, ⁀ 붙이기
    if(o.t === '-') return sp ? '<del class="sp" title="붙여 쓰기"><span class="m">⁀</span><span class="s"> </span></del>' : '<del>' + esc(o.s) + '</del>';
    return sp ? '<ins class="sp" title="띄어 쓰기">∨</ins>' : '<ins>' + esc(o.s) + '</ins>';
  }).join('');
}

if(typeof window !== 'undefined') window.__wongoLT = {splitSents, parseResp, cdiff, diffHtml, buildPrompt, buildReroll};

/* ================= 화면 ================= */
const W = typeof window !== 'undefined' && window.__wongo;
if(!W || typeof document === 'undefined') return;
const $ = s => document.querySelector(s);
const paper = $('#paper'), app = $('#app');
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const MAX = 4000, CTX = 500, SESS_KEY = 'wongo-lt-sess', DAY = 86400000;
const CLAUDE_URL = 'https://claude.ai/new';

/* ---------- 원고별 라이트닝 자료 (기기에 저장, 드라이브로 함께 동기화) ----------
   lt = {frags: [{id, t, k: [핵심어], at, src: 'note'|'memo', used}], mark: '마지막으로 정리한 문단의 글'} */
const normLt = x => ({frags: x && Array.isArray(x.frags) ? x.frags.slice() : [], mark: (x && x.mark) || null});
async function ltGet(){ const c = W.cur(); if(!c) return normLt(null); const r = await W.DB.get(c.id); return normLt(r && r.lt); }
async function ltPut(fn){
  const c = W.cur(); if(!c) return null;
  let out = null;
  await W.DB.update(c.id, r => { if(!r) return undefined; out = fn(normLt(r.lt)); return Object.assign({}, r, {lt: out, updatedAt: Date.now(), dirty: true}); });
  W.refreshList(); W.Drive.soon(3000);
  return out;
}

/* ---------- 진행 중인 정리 (이 기기에만, 앱을 오가다 화면이 다시 열려도 이어지게) ---------- */
let sess = null, emptyWhy = null;
function loadSess(){ try{ const s = JSON.parse(localStorage.getItem(SESS_KEY) || 'null'); return s && Date.now() - s.at < DAY ? s : null; }catch(e){ return null; } }
let sessT;
function saveSess(now){
  clearTimeout(sessT);
  const go = () => { try{ if(sess) localStorage.setItem(SESS_KEY, JSON.stringify(sess)); else localStorage.removeItem(SESS_KEY); }catch(e){} };
  if(now) go(); else sessT = setTimeout(go, 300);
}

/* ---------- 원고의 문단 ---------- */
const blocks = () => [...paper.children];
const textOf = el => (el.innerText || el.textContent || '').replace(/\u00a0/g, ' ').replace(/[ \t]*\n[ \t]*/g, ' ').replace(/\s+$/, '');
const norm = s => s.replace(/\s+/g, ' ').trim();
const isEmpty = el => !norm(textOf(el));
const isChap = el => el.classList.contains('chap') || W.chapRe.test(norm(textOf(el)));
const isSep = el => { const t = norm(textOf(el)); return isChap(el) || W.sceneRe.test(t) || W.numRe.test(t); };
function blockOf(node){
  if(!node || !paper.contains(node) || node === paper) return null;
  while(node && node.parentNode !== paper) node = node.parentNode;
  return node && node.nodeType === 1 ? node : null;
}
/* 원고 맨 위에 문단으로 싸이지 않은 글이 있으면 문단으로 감싼다 */
function normalizePaper(){
  let run = null, changed = false;
  for(const n of [...paper.childNodes]){
    const inline = n.nodeType === 3 ? n.nodeValue.trim() !== '' : (n.nodeType === 1 && !/^(DIV|P|H[1-6]|LI|UL|OL|BLOCKQUOTE)$/.test(n.tagName));
    if(inline){ if(!run){ run = document.createElement('div'); paper.insertBefore(run, n); changed = true; } run.appendChild(n); }
    else run = null;
  }
  return changed;
}

/* 커서 자리 기억: 휴대폰에서는 버튼을 누르는 순간 선택이 풀린다 */
let lastNode = null, lastOff = 0, lastSel = null;
document.addEventListener('selectionchange', () => {
  const s = getSelection(); if(!s.rangeCount) return;
  const r = s.getRangeAt(0);
  if(!paper.contains(r.commonAncestorContainer)) return;
  lastNode = r.endContainer; lastOff = r.endOffset; lastSel = r.collapsed ? null : r.cloneRange();
});
function caretBlock(){
  let n = lastNode, off = lastOff;
  const s = getSelection();
  if(s.rangeCount){ const r = s.getRangeAt(0); if(paper.contains(r.endContainer)){ n = r.endContainer; off = r.endOffset; } }
  if(n === paper) n = paper.childNodes[Math.max(0, Math.min(off, paper.childNodes.length) - 1)];
  return blockOf(n);
}
function liveSel(){
  const s = getSelection();
  if(s.rangeCount){ const r = s.getRangeAt(0); if(!r.collapsed && paper.contains(r.commonAncestorContainer) && r.toString().trim()) return r.cloneRange(); }
  return null;
}

/* ---------- 정리할 범위 ----------
   고른 글이 있으면 그 부분. 없으면 커서가 있는 문단까지 거슬러 올라가며,
   지난번 정리한 자리나 장 제목을 만나면 멈추고, 4,000자를 넘지 않게 한다. */
function ctx(bs, i, dir){
  const out = []; let len = 0;
  for(; i >= 0 && i < bs.length && out.length < 3; i += dir){
    if(isEmpty(bs[i])) continue;
    const t = norm(textOf(bs[i]));
    out.push(t); len += t.length;
    if(len >= CTX || (dir < 0 && isChap(bs[i]))) break;
  }
  if(dir < 0) out.reverse();
  const txt = out.join('\n'), cap = CTX * 1.5;
  return txt.length > cap ? (dir < 0 ? '…' + txt.slice(-cap) : txt.slice(0, cap) + '…') : txt;
}
function computeRange(endB, selR, lt){
  const bs = blocks();
  let s = -1, e = -1, how = 'auto';
  if(selR){
    const a = blockOf(selR.startContainer === paper ? paper.childNodes[selR.startOffset] : selR.startContainer);
    const z = blockOf(selR.endContainer === paper ? paper.childNodes[Math.max(0, selR.endOffset - 1)] : selR.endContainer);
    s = bs.indexOf(a); e = bs.indexOf(z);
    if(s < 0 || e < s) selR = null; else how = 'sel';
  }
  if(!selR){
    e = endB ? bs.indexOf(endB) : -1;
    if(e < 0) e = bs.length - 1;
    while(e >= 0 && isEmpty(bs[e])) e--;
    if(e < 0) return {empty: 'none'};
    if(lt.mark && norm(textOf(bs[e])) === lt.mark) return {empty: 'done'};
    s = e;
    let chars = textOf(bs[e]).length;
    while(s > 0){
      const p = bs[s - 1];
      if(lt.mark && norm(textOf(p)) === lt.mark){ how = 'mark'; break; }
      if(isChap(p)){ how = 'chap'; break; }
      const l = textOf(p).length;
      if(chars + l > MAX){ how = 'cap'; break; }
      chars += l; s--;
    }
    if(s === 0 && how === 'auto') how = 'start';
  }
  const paras = []; let n = 0, chars = 0;
  for(let i = s; i <= e; i++){
    const b = bs[i]; if(isEmpty(b)) continue;
    const raw = textOf(b), lead = (raw.match(/^\s+/) || [''])[0], text = raw.trim();
    if(isSep(b)){ paras.push({i, text, lead, sep: true, sents: []}); continue; }
    const sents = splitSents(text).map(t => ({n: ++n, t}));
    chars += text.length;
    paras.push({i, text, lead, sents});
  }
  if(!n) return {empty: 'none'};
  return {how, paras, n, chars, before: ctx(bs, s - 1, -1), after: ctx(bs, e + 1, 1)};
}
const sameParas = (a, b) => a && b && a.length === b.length && a.every((p, i) => p.text === b[i].text);

/* ---------- 열고 닫기 ---------- */
const dlg = $('#ltDlg');
let tab = 't';
function showTab(t){
  tab = t;
  $('#ltTabT').classList.toggle('on', t === 't'); $('#ltTabT').setAttribute('aria-selected', String(t === 't'));
  $('#ltTabF').classList.toggle('on', t === 'f'); $('#ltTabF').setAttribute('aria-selected', String(t === 'f'));
  $('#ltBodyT').hidden = t !== 't'; $('#ltBodyF').hidden = t !== 'f';
  if(t === 'f'){ $('#ltFoot').hidden = true; renderFrags(); }
  else renderTidy();
}
function openDlg(t){
  W.closePops();
  dlg.hidden = false;
  if(sess){ sess.closed = false; saveSess(); }
  showTab(t || 't');
  renderFragCount();
  setTimeout(() => { const b = !sess ? $('#ltClose') : (sess.stage === 'review' ? $('#ltApply') : $('#ltCopy')); if(b && !W.narrow()) b.focus(); }, 0);
}
function closeDlg(){
  dlg.hidden = true;
  if(sess){ sess.closed = true; saveSess(true); }
}
$('#ltClose').onclick = closeDlg;
dlg.addEventListener('click', e => { if(e.target === dlg) closeDlg(); });
$('#ltTabT').onclick = () => showTab('t');
$('#ltTabF').onclick = () => showTab('f');
document.addEventListener('keydown', e => {
  if(e.key === 'Escape' && !dlg.hidden){ closeDlg(); e.stopPropagation(); }
  else if(e.key === 'Escape' && !newPop.hidden){ newPop.hidden = true; e.stopPropagation(); }
}, true);

async function openTidy(endB, selR){
  if(!W.cur()) return;
  await W.flush();
  if(normalizePaper()) W.onEdit();
  const lt = await ltGet();
  const r = computeRange(endB, selR, lt);
  const old = loadSess();
  if(r.empty){ emptyWhy = r.empty; sess = null; }
  else if(old && old.ms === W.cur().id && sameParas(old.paras, r.paras)){ sess = old; emptyWhy = null; }
  else {
    emptyWhy = null;
    sess = Object.assign({ms: W.cur().id, at: Date.now(), len: (old && old.len) || 'short', resp: '', stage: 'ready', fragMap: [], prompt: ''}, r);
    saveSess(true);
  }
  openDlg('t');
}

/* ---------- 정리 1: 프롬프트 복사, 답 붙여 넣기 ---------- */
const HOW = {sel: '고른 부분', mark: '지난번 정리한 다음부터 여기까지', chap: '이 장 처음부터 여기까지', cap: '여기까지 4,000자 안쪽 (앞쪽은 길어서 뺐습니다)', start: '원고 처음부터 여기까지', auto: '여기까지'};
function renderTidy(){
  const rev = !!(sess && sess.stage === 'review' && sess.parsed);
  $('#ltReady').hidden = rev; $('#ltReview').hidden = !rev; $('#ltFoot').hidden = !rev || tab !== 't';
  if(rev) renderReview(); else renderReady();
}
async function renderReady(){
  const on = !!sess;
  ['#ltCopy', '#ltParse', '#ltResp', '#ltPaste', '#ltLenS', '#ltLenP'].forEach(s => { $(s).disabled = !on; });
  $('#ltErr').textContent = ''; $('#ltPromptBox').hidden = true;
  const rg = $('#ltRange');
  if(!on){
    rg.innerHTML = '<span class="lt-rw">' + (emptyWhy === 'done'
      ? '지난번 정리한 뒤로 새로 쓴 글이 없습니다.</span><span class="lt-rn">다른 부분을 정리하려면 글을 끌어서 고른 뒤 번개 버튼이나 Ctrl+Enter를 누르세요.</span>'
      : '정리할 글이 없습니다.</span><span class="lt-rn">몇 줄 쓴 뒤 다시 눌러 주세요.</span>');
    $('#ltFragInfo').textContent = ''; $('#ltResp').value = '';
    return;
  }
  const ps = sess.paras.filter(p => !p.sep), head = ps[0].text, tail = ps[ps.length - 1].text;
  const quote = ps.length === 1 && head.length <= 40 ? '「' + head + '」' : '「' + clip(head, 18) + '」 … 「' + (tail.length > 18 ? '…' + tail.slice(-18) : tail) + '」';
  rg.innerHTML = '<span class="lt-rw">' + esc(HOW[sess.how] || HOW.auto) + '</span><span class="lt-rq">' + esc(quote) + '</span><span class="lt-rn">' + sess.chars.toLocaleString() + '자 · ' + sess.n + '문장</span>';
  $('#ltLenS').classList.toggle('on', sess.len !== 'para'); $('#ltLenP').classList.toggle('on', sess.len === 'para');
  $('#ltResp').value = sess.resp || '';
  const lt = await ltGet();
  $('#ltFragInfo').textContent = lt.frags.length ? '조각 ' + Math.min(lt.frags.length, 30) + '개를 소재로 함께 보냅니다. 꼭 맞는 자리에만 쓰입니다.' : '';
}
function pickFrags(lt){
  const fs = lt.frags.slice(-30); let total = 0; const out = [];
  for(let i = fs.length - 1; i >= 0; i--){ total += Math.min(300, fs[i].t.length); if(total > 4000) break; out.unshift(fs[i]); }
  return out.map((f, i) => ({num: i + 1, id: f.id, k: f.k || [], t: f.t}));
}
async function copyText(t){
  try{ await navigator.clipboard.writeText(t); return true; }catch(e){}
  const ta = $('#ltPromptBox'); ta.hidden = false; ta.value = t; ta.focus(); ta.select();
  try{ if(document.execCommand('copy')){ ta.hidden = true; return true; } }catch(e){}
  return false;
}
async function pasteInto(ta, after){
  try{
    const t = await navigator.clipboard.readText();
    if(t){ ta.value = t; ta.dispatchEvent(new Event('input')); if(after) after(); return; }
  }catch(e){}
  W.toast('클립보드를 읽지 못했습니다. 칸을 길게 눌러 붙여 넣어 주세요.', 5000);
  ta.focus();
}
function flash(btn, msg){ const t = btn.dataset.t || (btn.dataset.t = btn.textContent); btn.textContent = msg; setTimeout(() => { btn.textContent = t; }, 2200); }

$('#ltLenS').onclick = () => { if(!sess) return; sess.len = 'short'; saveSess(); renderReady(); };
$('#ltLenP').onclick = () => { if(!sess) return; sess.len = 'para'; saveSess(); renderReady(); };
$('#ltCopy').onclick = async () => {
  if(!sess) return;
  const lt = await ltGet();
  sess.fragMap = pickFrags(lt);
  sess.prompt = buildPrompt(sess, sess.fragMap, sess.len);
  saveSess(true);
  if(await copyText(sess.prompt)) flash($('#ltCopy'), '복사했습니다');
  else $('#ltErr').textContent = '복사가 막혔습니다. 아래 칸을 길게 눌러 모두 선택한 뒤 복사해 주세요.';
};
const openClaude = () => window.open(CLAUDE_URL, '_blank', 'noopener');
$('#ltOpenClaude').onclick = openClaude;
$('#ltResp').addEventListener('input', () => { if(sess){ sess.resp = $('#ltResp').value; saveSess(); } $('#ltErr').textContent = ''; });
$('#ltPaste').onclick = () => pasteInto($('#ltResp'));
$('#ltParse').onclick = () => {
  if(!sess) return;
  const raw = $('#ltResp').value;
  if(!raw.trim()){ $('#ltErr').textContent = 'Claude의 답을 먼저 붙여 넣어 주세요.'; return; }
  if(!sess.prompt){ $('#ltErr').textContent = '먼저 프롬프트를 복사해 Claude에 보낸 뒤, 그 답을 붙여 넣어 주세요.'; return; }
  const p = parseResp(raw, sess.n);
  if(!p.hits){ $('#ltErr').textContent = '답의 형식을 알아보지 못했습니다. [정리]와 [이어쓰기]가 들어 있는 답을 통째로 붙여 넣어 주세요. 원고는 그대로입니다.'; return; }
  // 원문과 똑같이 '고친' 문장은 그대로 둔 것으로 본다
  const all = {}; sess.paras.forEach(pa => pa.sents.forEach(s => { all[s.n] = s.t; }));
  let missing = 0;
  for(let n = 1; n <= sess.n; n++){
    const op = p.ops[n];
    if(!op) missing++;
    else if(op.k === 'edit' && norm(op.t) === norm(all[n])) p.ops[n] = {k: 'same'};
  }
  p.missing = Object.keys(p.ops).length ? missing : 0;
  sess.parsed = p; sess.cands = p.cands; sess.pick = null; sess.dec = {};
  items().forEach(it => { sess.dec[it.id] = true; });
  sess.stage = 'review'; sess.rrOpen = false; sess.rrResp = '';
  saveSess(true);
  renderTidy();
  $('#ltBodyT').scrollTop = 0;
};

/* ---------- 정리 2: 원문 대비, 수락·거절, 이어 쓸 문장 ---------- */
const KINDS = {edit: '손질', del: '삭제', memo: '조각으로', mat: '소재 넣기'};
const KIND_HELP = {edit: '맞춤법·띄어쓰기·어색한 연결 손질', del: '겹치거나 군더더기라 빼자는 문장', memo: '소설 문장이 아닌 메모라서 조각함으로 옮길 것', mat: '조각의 소재를 살려 새로 넣자는 문장'};
function items(){
  const p = sess.parsed, out = [];
  for(const para of sess.paras) for(const s of para.sents){ const op = p.ops[s.n]; if(op && op.k !== 'same') out.push({id: 's' + s.n, kind: op.k}); }
  p.ins.forEach((x, i) => out.push({id: 'i' + i, kind: 'mat'}));
  return out;
}
function fragLabel(num){
  const f = (sess.fragMap || []).find(x => x.num === num);
  if(!f) return '소재';
  return '조각 ' + num + (f.k && f.k.length ? ' · ' + f.k.slice(0, 2).join(', ') : '');
}
function xspan(id, k, on, inner){
  return '<span class="lt-x k-' + k + (on ? ' on' : '') + '" role="switch" tabindex="0" aria-checked="' + on + '" data-id="' + id + '" title="' + KIND_HELP[k] + ' · 누르면 ' + (on ? '거절' : '수락') + '">' + inner + '</span>';
}
function renderKinds(){
  const its = items(), cnt = {};
  its.forEach(it => { const c = cnt[it.kind] = cnt[it.kind] || {n: 0, on: 0}; c.n++; if(sess.dec[it.id]) c.on++; });
  const kd = $('#ltKinds'); kd.innerHTML = '';
  if(!its.length){ kd.innerHTML = '<p class="hint lt-none">고칠 곳이 없다는 답입니다. 문장은 그대로 둡니다.</p>'; }
  for(const k of ['edit', 'del', 'memo', 'mat']){
    if(!cnt[k]) continue;
    const all = cnt[k].on === cnt[k].n, b = document.createElement('button');
    b.type = 'button'; b.className = 'lt-chip k-' + k; b.setAttribute('aria-pressed', String(all));
    b.textContent = KINDS[k] + ' ' + cnt[k].on + '/' + cnt[k].n;
    b.title = KIND_HELP[k] + ' · 누르면 모두 ' + (all ? '거절' : '수락');
    b.onclick = () => { its.filter(x => x.kind === k).forEach(x => { sess.dec[x.id] = !all; }); saveSess(); renderReview(); };
    kd.appendChild(b);
  }
  $('#ltMissing').hidden = !sess.parsed.missing;
  $('#ltMissing').textContent = sess.parsed.missing ? '답에 빠진 문장 ' + sess.parsed.missing + '개는 그대로 둡니다.' : '';
}
function renderReview(){
  const p = sess.parsed;
  renderKinds();
  let h = '';
  for(const para of sess.paras){
    if(para.sep){ h += '<p class="lt-p sep">' + esc(para.text) + '</p>'; continue; }
    const parts = [];
    for(const s of para.sents){
      const op = p.ops[s.n] || {k: 'same'};
      if(op.k === 'same') parts.push(esc(s.t));
      else {
        const id = 's' + s.n;
        const inner = op.k === 'edit' ? diffHtml(s.t, op.t)
          : op.k === 'memo' ? esc(s.t) + '<span class="lt-tag">조각으로' + (op.kw.length ? ' · ' + esc(op.kw.join(', ')) : '') + '</span>'
          : esc(s.t) + '<span class="lt-tag">삭제</span>';
        parts.push(xspan(id, op.k, !!sess.dec[id], inner));
      }
      p.ins.forEach((x, i) => { if(x.after === s.n) parts.push(xspan('i' + i, 'mat', !!sess.dec['i' + i], esc(x.t) + '<span class="lt-tag">' + esc(fragLabel(x.frag)) + '</span>')); });
    }
    h += '<p class="lt-p">' + parts.join(' ') + '</p>';
  }
  $('#ltDoc').innerHTML = h;
  renderCands();
}
function toggleX(el){
  const id = el.dataset.id, on = !sess.dec[id];
  sess.dec[id] = on; saveSess();
  el.classList.toggle('on', on); el.setAttribute('aria-checked', String(on));
  const k = (el.className.match(/k-(\w+)/) || [])[1];
  el.title = KIND_HELP[k] + ' · 누르면 ' + (on ? '거절' : '수락');
  renderKinds();
}
$('#ltDoc').addEventListener('click', e => { const x = e.target.closest('.lt-x'); if(x) toggleX(x); });
$('#ltDoc').addEventListener('keydown', e => { const x = e.target.closest('.lt-x'); if(x && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); toggleX(x); } });

function renderCands(){
  const cs = sess.cands || [], box = $('#ltCands');
  let h = '<h3 class="lt-h3">이어 쓸 문장</h3>';
  if(!cs.length) h += '<p class="hint">답에 이어 쓸 문장 후보가 없습니다.</p>';
  else h += '<p class="hint">하나를 고르면 정리한 글 다음에 밑줄을 그어 넣습니다. 고쳐 쓰면 밑줄이 사라집니다.</p>';
  h += '<div role="radiogroup" aria-label="이어 쓸 문장">';
  cs.forEach((c, i) => {
    const on = sess.pick === i;
    h += '<div class="lt-c' + (on ? ' on' : '') + '" role="radio" tabindex="0" aria-checked="' + on + '" data-i="' + i + '">'
      + '<div class="lt-cd">' + esc(c.d || '후보 ' + (i + 1)) + '</div>'
      + '<button type="button" class="lt-pin" aria-pressed="' + !!c.pin + '" data-pin="' + i + '" title="다시 받을 때 이 후보는 남깁니다">' + (c.pin ? '고정됨' : '고정') + '</button>'
      + '<div class="lt-ct">' + esc(c.t) + '</div></div>';
  });
  if(cs.length) h += '<div class="lt-c none' + (sess.pick == null ? ' on' : '') + '" role="radio" tabindex="0" aria-checked="' + (sess.pick == null) + '" data-i="-1"><div class="lt-ct">넣지 않고 내가 이어 쓰기</div></div>';
  h += '</div>';
  const k = 3 - cs.filter(c => c.pin).length;
  h += '<div class="lt-reroll">'
    + '<button type="button" id="ltRrBtn"' + (k <= 0 ? ' disabled' : '') + ' aria-expanded="' + !!sess.rrOpen + '">' + (cs.length ? '고정하지 않은 후보 다시 받기' : '후보 받기') + '</button>'
    + '<div id="ltRrBox"' + (sess.rrOpen ? '' : ' hidden') + '>'
    + '<p class="hint">프롬프트를 복사해 Claude에 붙여 넣고, 받은 답을 아래에 붙여 넣으세요.</p>'
    + '<div class="lt-btns"><button type="button" id="ltRrCopy" class="primary">프롬프트 복사</button><button type="button" id="ltRrOpen">Claude 열기</button></div>'
    + '<textarea id="ltRrResp" rows="4" placeholder="[갈래1]로 시작하는 답을 붙여 넣으세요">' + esc(sess.rrResp || '') + '</textarea>'
    + '<div class="lt-btns"><button type="button" id="ltRrPaste">붙여넣기</button><button type="button" id="ltRrApply" class="primary">후보 바꾸기</button></div>'
    + '<p id="ltRrErr" class="lt-err" role="alert"></p></div></div>';
  box.innerHTML = h;
}
function pickCand(i){ sess.pick = i < 0 ? null : i; saveSess(); renderCands(); }
$('#ltCands').addEventListener('click', async e => {
  const t = e.target;
  const pin = t.closest('.lt-pin');
  if(pin){ e.stopPropagation(); const c = sess.cands[+pin.dataset.pin]; c.pin = !c.pin; saveSess(); renderCands(); return; }
  const c = t.closest('.lt-c'); if(c){ pickCand(+c.dataset.i); return; }
  if(t.id === 'ltRrBtn'){ sess.rrOpen = !sess.rrOpen; saveSess(); renderCands(); return; }
  if(t.id === 'ltRrOpen'){ openClaude(); return; }
  if(t.id === 'ltRrPaste'){ pasteInto($('#ltRrResp')); return; }
  if(t.id === 'ltRrCopy'){
    const k = 3 - sess.cands.filter(x => x.pin).length;
    const pr = buildReroll(sess, sess.fragMap || [], sess.len, sess.cands, Math.max(1, k));
    if(await copyText(pr)) flash(t, '복사했습니다');
    else $('#ltRrErr').textContent = '복사가 막혔습니다. 화면 아래 칸에서 직접 복사해 주세요.';
    return;
  }
  if(t.id === 'ltRrApply'){
    const p = parseResp($('#ltRrResp').value, 0);
    if(!p.cands.length){ $('#ltRrErr').textContent = '[갈래1], [문장1] 형식의 후보를 찾지 못했습니다.'; return; }
    const keep = sess.cands.map((c, i) => c.pin ? c : null);
    const fresh = p.cands.slice();
    const next = keep.map(c => c || fresh.shift() || null).filter(Boolean);
    while(next.length < 3 && fresh.length) next.push(fresh.shift());
    if(sess.pick != null && !(sess.cands[sess.pick] && sess.cands[sess.pick].pin)) sess.pick = null;
    sess.cands = next; sess.rrResp = ''; sess.rrOpen = false; saveSess(true);
    renderCands();
  }
});
$('#ltCands').addEventListener('input', e => { if(e.target.id === 'ltRrResp'){ sess.rrResp = e.target.value; saveSess(); } });
$('#ltCands').addEventListener('keydown', e => { const c = e.target.closest('.lt-c'); if(c && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); pickCand(+c.dataset.i); } });

$('#ltBack').onclick = () => { sess.stage = 'ready'; saveSess(); renderTidy(); };

/* ---------- 본문에 반영 ---------- */
let undoSt = null, undoMsg = '';
$('#ltApply').onclick = applyTidy;
async function applyTidy(){
  if(!sess || !sess.parsed) return;
  const p = sess.parsed, bs = blocks();
  // 프롬프트를 만든 뒤 글이 바뀌었을 수 있으니 문단을 글로 다시 찾는다
  const at = []; let from = 0;
  for(const para of sess.paras){
    let f = -1;
    if(bs[para.i] && para.i >= from && norm(textOf(bs[para.i])) === norm(para.text)) f = para.i;
    else for(let j = from; j < bs.length; j++) if(norm(textOf(bs[j])) === norm(para.text)){ f = j; break; }
    at.push(f); if(f >= 0) from = f + 1;
  }
  const found = at.filter(x => x >= 0);
  if(!found.length){ W.toast('정리할 문단을 원고에서 찾지 못했습니다. 그사이 글이 바뀌었다면 번개 버튼을 다시 눌러 새로 시작해 주세요.', 9000); return; }
  const htmlBefore = paper.innerHTML, ltBefore = await ltGet();
  const firstB = bs[found[0]], lastB = bs[found[found.length - 1]];
  const prevOut = firstB.previousElementSibling, nextOut = lastB.nextElementSibling;

  // 1. 고른 이어 쓸 문장: 정리한 글 바로 다음 빈 줄에, 없으면 새 문단으로
  let tail = null;
  const pick = sess.pick != null ? sess.cands[sess.pick] : null;
  if(pick){
    let tgt = nextOut && isEmpty(nextOut) && !nextOut.classList.contains('chap') ? nextOut : null;
    if(!tgt){ tgt = document.createElement('div'); lastB.after(tgt); }
    tgt.textContent = '';
    const sp = document.createElement('span'); sp.className = 'lt-new'; sp.textContent = norm(pick.t);
    tail = document.createTextNode('\u00a0');
    tgt.append(sp, tail);
  }

  // 2. 문단마다 수락한 것만 반영
  const newFrags = [], used = new Map(), cnt = {edit: 0, del: 0, memo: 0, mat: 0};
  let skipped = 0;
  sess.paras.forEach((para, k) => {
    if(para.sep) return;
    const outS = [], pf = [], pu = [], pc = {edit: 0, del: 0, memo: 0, mat: 0};
    let changed = false, memo = null;
    for(const s of para.sents){
      const op = p.ops[s.n] || {k: 'same'}, on = !!sess.dec['s' + s.n];
      if(on && op.k === 'memo'){
        changed = true; pc.memo++;
        if(memo){ memo.t += ' ' + s.t; memo.k = [...new Set(memo.k.concat(op.kw))]; }
        else { memo = {id: newId(), t: s.t, k: op.kw.slice(), at: Date.now(), src: 'memo', used: 0}; pf.push(memo); }
      } else {
        memo = null;
        if(on && op.k === 'edit'){ outS.push(op.t); changed = true; pc.edit++; }
        else if(on && op.k === 'del'){ changed = true; pc.del++; }
        else outS.push(s.t);
      }
      p.ins.forEach((x, i) => {
        if(x.after !== s.n || !sess.dec['i' + i]) return;
        outS.push(x.t); changed = true; pc.mat++; memo = null;
        const fm = (sess.fragMap || []).find(f => f.num === x.frag); if(fm) pu.push(fm.id);
      });
    }
    if(!changed) return;
    const b = at[k] >= 0 ? bs[at[k]] : null;
    if(!b){ skipped++; return; }
    const text = outS.join(' ').trim();
    if(text) b.textContent = para.lead + text; else b.remove();
    newFrags.push(...pf); pu.forEach(id => used.set(id, (used.get(id) || 0) + 1));
    for(const key in pc) cnt[key] += pc[key];
  });

  // 3. 다음 정리는 여기 다음부터
  let mark = null;
  for(let k = at.length - 1; k >= 0 && !mark; k--){ const b = at[k] >= 0 ? bs[at[k]] : null; if(b && b.isConnected && !isEmpty(b)) mark = norm(textOf(b)); }
  if(!mark){ let q = prevOut; while(q && isEmpty(q)) q = q.previousElementSibling; mark = q ? norm(textOf(q)) : null; }
  const kw = p.kw || {};
  await ltPut(lt => {
    for(const [id, n] of used){ const f = lt.frags.find(x => x.id === id); if(f) f.used = (f.used || 0) + n; }
    for(const num in kw){ const fm = (sess.fragMap || []).find(f => f.num === +num); const f = fm && lt.frags.find(x => x.id === fm.id); if(f && !(f.k && f.k.length) && kw[num].length) f.k = kw[num]; }
    lt.frags = lt.frags.concat(newFrags);
    lt.mark = mark;
    return lt;
  });

  W.onEdit(); W.outline();
  // 커서는 이어 쓸 자리로
  const sel = getSelection(), r = document.createRange();
  if(tail){ r.setStart(tail, tail.length); }
  else { let b = null; for(let k = at.length - 1; k >= 0 && !b; k--){ const x = at[k] >= 0 ? bs[at[k]] : null; if(x && x.isConnected) b = x; } if(!b) b = prevOut || paper; r.selectNodeContents(b); r.collapse(false); }
  r.collapse(true);
  if(!W.narrow()) paper.focus({preventScroll: true});
  sel.removeAllRanges(); sel.addRange(r);
  const anchor = tail ? tail.parentNode : r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode;
  if(anchor && anchor.scrollIntoView) anchor.scrollIntoView({block: 'center', behavior: 'smooth'});

  const parts = [];
  for(const k of ['edit', 'del', 'memo', 'mat']) if(cnt[k]) parts.push(KINDS[k] + ' ' + cnt[k]);
  if(pick) parts.push('이어 쓸 문장 1');
  undoMsg = (parts.length ? '정리를 반영했습니다 · ' + parts.join(' · ') : '바꾼 곳 없이 정리를 마쳤습니다') + (skipped ? '. 그사이 바뀐 문단 ' + skipped + '개는 건너뛰었습니다' : '') + '.';
  undoSt = {html: htmlBefore, lt: ltBefore};
  sess = null; saveSess(true);
  dlg.hidden = true;
  W.notice(undoMsg, '되돌리기', undo);
  renderFragCount();
}
async function undo(){
  if(!undoSt) return;
  const u = undoSt; undoSt = null;
  paper.innerHTML = u.html;
  await ltPut(() => u.lt);
  W.onEdit(); W.outline();
  $('#notice').hidden = true;
  W.toast('정리하기 전으로 되돌렸습니다', 3000);
  renderFragCount();
}

/* ---------- 이어 쓴 문장 표시 ----------
   밑줄은 '아직 작가가 손대지 않은 생성 문장'이라는 뜻. 고쳐 쓰거나 '내 문장으로 두기'를 누르면 사라진다. */
const newPop = $('#ltNewPop');
let newPopSpan = null;
paper.addEventListener('click', e => {
  const sp = e.target.closest && e.target.closest('.lt-new');
  if(!sp){ newPop.hidden = true; return; }
  newPopSpan = sp; newPop.hidden = false;
  const rc = sp.getBoundingClientRect();
  newPop.style.top = Math.round(Math.min(rc.bottom + 6, innerHeight - newPop.offsetHeight - 8)) + 'px';
  newPop.style.left = Math.round(Math.max(8, Math.min(rc.left, innerWidth - newPop.offsetWidth - 8))) + 'px';
});
$('#ltKeep').onclick = () => { if(newPopSpan){ newPopSpan.classList.remove('lt-new'); if(!newPopSpan.className) newPopSpan.removeAttribute('class'); W.onEdit(); } newPop.hidden = true; };
$('#ltDrop').onclick = () => { if(newPopSpan){ newPopSpan.remove(); W.onEdit(); } newPop.hidden = true; };
document.addEventListener('click', e => { if(!newPop.hidden && !e.target.closest('#ltNewPop') && !e.target.closest('.lt-new')) newPop.hidden = true; });
$('#scroll').addEventListener('scroll', () => { newPop.hidden = true; }, {passive: true});

/* 이어 쓴 문장 뒤에 둔 줄바꿈 없는 칸(&nbsp;)은, 작가가 이어 쓰기 시작하면 보통 띄어쓰기로 바꾼다 */
function fixGap(){
  const s = getSelection(); if(!s.rangeCount) return;
  const n = s.anchorNode;
  if(!n || n.nodeType !== 3 || !paper.contains(n) || s.anchorOffset < 2) return;
  if(n.data[0] !== '\u00a0' || /\s/.test(n.data[1]) || !n.previousSibling || n.previousSibling.nodeName !== 'SPAN') return;
  n.replaceData(0, 1, ' ');
}
paper.addEventListener('compositionend', () => setTimeout(fixGap, 0));

/* ---------- 엔터 두 번 ----------
   키를 몇 번 눌렀는지 세지 않고, '글 다음에 빈 줄이 생겼는지'를 본다 (한글 입력기가 엔터를 두 번 보내도 헛돌지 않게).
   생긴 빈 줄은 지우고, 커서는 새 줄에 둔 채 정리를 연다. */
paper.addEventListener('input', e => {
  if(undoSt){ undoSt = null; if($('#noticeText').textContent === undoMsg) $('#notice').hidden = true; }
  const s = getSelection();
  if(s.rangeCount){
    const n = s.anchorNode, el = n && (n.nodeType === 1 ? n : n.parentNode);
    const sp = el && el.closest && el.closest('.lt-new');
    if(sp && paper.contains(sp)){ sp.classList.remove('lt-new'); if(!sp.className) sp.removeAttribute('class'); }
  }
  if(!e.isComposing) fixGap();
  if(!W.prefs.lt || e.isComposing || e.inputType !== 'insertParagraph') return;
  const b = caretBlock(); if(!b) return;
  const pr = b.previousElementSibling, pp = pr && pr.previousElementSibling;
  if(!pr || !pp || !isEmpty(b) || !isEmpty(pr) || isEmpty(pp)) return;
  pr.remove(); W.onEdit();
  openTidy(b, null);
});

/* ---------- 켜고 끄기 · 번개 버튼 · 단축키 ---------- */
function setLt(on){
  W.prefs.lt = !!on; W.savePrefs();
  app.classList.toggle('lt-on', !!on);
  $('#ltBtn').setAttribute('aria-pressed', String(!!on));
  $('#ltFab').hidden = !on; $('#ltTag').hidden = !on;
}
$('#ltBtn').onclick = () => {
  const on = !W.prefs.lt; setLt(on);
  W.toast(on ? '라이트닝을 켰습니다. 빈 줄을 만들듯 엔터를 두 번 누르면 거기까지 정리합니다.' : '라이트닝을 껐습니다. 엔터는 평소대로 줄만 바꿉니다.', 5000);
};
let fabSel = null, fabBlock = null;
['pointerdown', 'touchstart', 'mousedown'].forEach(ev => $('#ltFab').addEventListener(ev, () => { fabSel = liveSel() || lastSel; fabBlock = caretBlock(); }, {capture: true, passive: true}));
$('#ltFab').onclick = () => { const s = fabSel, b = fabBlock; fabSel = fabBlock = null; openTidy(b, s); };
document.addEventListener('keydown', e => {
  if(!(e.ctrlKey || e.metaKey) || e.key !== 'Enter' || e.isComposing || !dlg.hidden) return;
  const inPaper = paper.contains(document.activeElement) || document.activeElement === document.body;
  if(!inPaper) return;
  e.preventDefault();
  openTidy(caretBlock(), liveSel());
});

/* ---------- 조각함 ---------- */
async function renderFragCount(){ const lt = await ltGet(); $('#ltFragN').textContent = lt.frags.length ? String(lt.frags.length) : ''; }
const fmtDay = t => { const d = new Date(t); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일'; };
async function renderFrags(){
  const lt = await ltGet(), ul = $('#ltFrags');
  $('#ltFragN').textContent = lt.frags.length ? String(lt.frags.length) : '';
  ul.textContent = '';
  if(!lt.frags.length){ ul.innerHTML = '<li class="hint">아직 조각이 없습니다. 위에 생각을 적어 두거나, 정리할 때 원고 속 메모를 조각으로 옮길 수 있습니다.</li>'; return; }
  for(const f of lt.frags.slice().reverse()){
    const li = document.createElement('li'); li.className = 'lt-f';
    if(f.k && f.k.length){ const kk = document.createElement('div'); kk.className = 'lt-fk'; f.k.forEach(w => { const s = document.createElement('span'); s.textContent = w; kk.appendChild(s); }); li.appendChild(kk); }
    const t = document.createElement('p'); t.className = 'lt-ft'; t.textContent = f.t; li.appendChild(t);
    const m = document.createElement('div'); m.className = 'lt-fm';
    const info = document.createElement('span');
    info.textContent = fmtDay(f.at) + ' · ' + (f.src === 'memo' ? '원고에서 옮김' : '직접 적음') + (f.used ? ' · 본문에 ' + f.used + '번 씀' : '');
    const del = document.createElement('button'); del.type = 'button'; del.className = 'ghost lt-fdel'; del.textContent = '삭제';
    let armT;
    del.onclick = async () => {
      if(!del.classList.contains('arm')){ del.classList.add('arm'); del.textContent = '정말 삭제'; armT = setTimeout(() => { del.classList.remove('arm'); del.textContent = '삭제'; }, 3000); return; }
      clearTimeout(armT);
      await ltPut(lt2 => { lt2.frags = lt2.frags.filter(x => x.id !== f.id); return lt2; });
      renderFrags();
    };
    m.append(info, del); li.appendChild(m); ul.appendChild(li);
  }
}
async function saveNote(){
  const ta = $('#ltNote'), t = ta.value.trim();
  if(!t){ ta.value = ''; return; }
  ta.value = '';
  await ltPut(lt => { lt.frags.push({id: newId(), t, k: [], at: Date.now(), src: 'note', used: 0}); return lt; });
  renderFrags();
  W.toast('조각으로 저장했습니다', 2500);
}
$('#ltNoteSave').onclick = saveNote;
$('#ltNote').addEventListener('input', e => { if(!e.isComposing && /\n[ \t]*\n$/.test($('#ltNote').value)) saveNote(); });

/* ---------- 시작 ---------- */
setLt(!!W.prefs.lt);
// 정리하던 중 다른 앱에 다녀오느라 화면이 새로 열렸으면 이어서 할 수 있게
(function resume(tries){
  const c = W.cur();
  if(!c){ if(tries < 25) setTimeout(() => resume(tries + 1), 200); return; }
  const s = loadSess();
  if(s && s.ms === c.id && !s.closed && s.prompt){
    W.notice('정리하던 것이 남아 있습니다.' + (s.resp ? ' 붙여 넣은 답도 그대로 있습니다.' : ''), '이어서 하기', () => { $('#notice').hidden = true; sess = s; emptyWhy = null; openDlg('t'); });
  }
})(0);
})();
