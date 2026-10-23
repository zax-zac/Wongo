/* 한글 문서(HWP·HWPX) 읽기와 HWPX 만들기 — 브라우저 전용, 외부 라이브러리 없음 */
const Hangul = (() => {
'use strict';

/* ---------- 압축 ---------- */
async function pipe(u8, stream){
  const s = new Blob([u8]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}
const deflateRaw = u8 => pipe(u8, new CompressionStream('deflate-raw'));
const canDeflate = typeof CompressionStream === 'function';

/* deflate 풀기: 마지막 블록에서 멈추므로 뒤에 덧붙은 바이트가 있어도 된다.
   (한글이 저장한 HWP는 압축 데이터 뒤에 여분이 붙기도 하는데, 브라우저 내장 풀기는 이를 오류로 처리한다) */
const LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const LEXT = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const DEXT = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
const CLORDER = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
function huff(lengths, n){
  const count = new Uint16Array(16), offs = new Uint16Array(16), symbol = new Uint16Array(n);
  for(let i = 0; i < n; i++) count[lengths[i]]++;
  count[0] = 0;
  for(let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
  for(let i = 0; i < n; i++) if(lengths[i]) symbol[offs[lengths[i]]++] = i;
  return {count, symbol};
}
let FIXED = null;
function fixedTables(){
  if(FIXED) return FIXED;
  const l = new Uint8Array(288);
  for(let i = 0; i < 144; i++) l[i] = 8;
  for(let i = 144; i < 256; i++) l[i] = 9;
  for(let i = 256; i < 280; i++) l[i] = 7;
  for(let i = 280; i < 288; i++) l[i] = 8;
  const d = new Uint8Array(30).fill(5);
  return (FIXED = {lit: huff(l, 288), dist: huff(d, 30)});
}
function inflateJs(src){
  let pos = 0, bitbuf = 0, bitcnt = 0, olen = 0;
  let out = new Uint8Array(Math.max(4096, src.length * 4));
  const bits = n => {
    while(bitcnt < n){ if(pos >= src.length) throw new Error('inflate_eof'); bitbuf |= src[pos++] << bitcnt; bitcnt += 8; }
    const v = bitbuf & ((1 << n) - 1); bitbuf >>>= n; bitcnt -= n; return v;
  };
  const room = n => {
    if(olen + n <= out.length) return;
    let m = out.length * 2; while(m < olen + n) m *= 2;
    const o = new Uint8Array(m); o.set(out.subarray(0, olen)); out = o;
  };
  const decode = h => {
    let code = 0, first = 0, index = 0;
    for(let len = 1; len < 16; len++){
      code |= bits(1);
      const c = h.count[len];
      if(code - c < first) return h.symbol[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new Error('inflate_code');
  };
  let final;
  do{
    final = bits(1);
    const type = bits(2);
    if(type === 0){
      bitbuf = 0; bitcnt = 0;
      if(pos + 4 > src.length) throw new Error('inflate_eof');
      const len = src[pos] | (src[pos + 1] << 8); pos += 4;
      if(pos + len > src.length) throw new Error('inflate_eof');
      room(len); out.set(src.subarray(pos, pos + len), olen); olen += len; pos += len;
      continue;
    }
    let lit, dist;
    if(type === 1){ ({lit, dist} = fixedTables()); }
    else if(type === 2){
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      const cl = new Uint8Array(19);
      for(let i = 0; i < ncode; i++) cl[CLORDER[i]] = bits(3);
      const clh = huff(cl, 19), lens = new Uint8Array(nlen + ndist);
      for(let i = 0; i < nlen + ndist;){
        const sym = decode(clh);
        if(sym < 16){ lens[i++] = sym; continue; }
        let rep, val = 0;
        if(sym === 16){ if(!i) throw new Error('inflate_rep'); val = lens[i - 1]; rep = 3 + bits(2); }
        else if(sym === 17) rep = 3 + bits(3);
        else rep = 11 + bits(7);
        if(i + rep > nlen + ndist) throw new Error('inflate_rep');
        while(rep--) lens[i++] = val;
      }
      lit = huff(lens.subarray(0, nlen), nlen); dist = huff(lens.subarray(nlen), ndist);
    } else throw new Error('inflate_type');
    for(;;){
      const sym = decode(lit);
      if(sym < 256){ room(1); out[olen++] = sym; }
      else if(sym === 256) break;
      else {
        const s = sym - 257; if(s >= 29) throw new Error('inflate_len');
        const len = LBASE[s] + bits(LEXT[s]);
        const ds = decode(dist); if(ds >= 30) throw new Error('inflate_dist');
        const d = DBASE[ds] + bits(DEXT[ds]);
        if(d > olen) throw new Error('inflate_dist');
        room(len);
        for(let k = 0; k < len; k++){ out[olen] = out[olen - d]; olen++; }
      }
    }
  } while(!final);
  return out.subarray(0, olen);
}
async function inflateRaw(u8){
  if(typeof DecompressionStream === 'function'){
    try{ return await pipe(u8, new DecompressionStream('deflate-raw')); }catch(e){ /* 아래 방식으로 다시 */ }
  }
  return inflateJs(u8);
}

/* ---------- ZIP 읽기 ---------- */
async function unzip(buf){
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for(let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--){ if(dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; } }
  if(eocd < 0) throw new Error('zip');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder(), out = new Map();
  for(let k = 0; k < n; k++){
    if(dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    const raw = u8.subarray(start, start + csize);
    out.set(name, {method, raw});
    p += 46 + nl + xl + cl;
  }
  return {
    names: [...out.keys()],
    async get(name){ const e = out.get(name); if(!e) return null; return e.method === 8 ? inflateRaw(e.raw) : e.raw; },
    async text(name){ const b = await this.get(name); return b ? new TextDecoder().decode(b) : null; }
  };
}

/* ---------- ZIP 쓰기 ---------- */
const CRC = (() => { const t = new Uint32Array(256); for(let n = 0; n < 256; n++){ let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b){ let c = 0xFFFFFFFF; for(let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
async function zip(files){
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  for(const f of files){
    const name = enc.encode(f.name), d = f.data, crc = crc32(d);
    let body = d, method = 0;
    if(!f.store && canDeflate && d.length > 64){ body = await deflateRaw(d); method = 8; }
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true); h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true); h.setUint32(18, body.length, true); h.setUint32(22, d.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, body);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true); c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, d.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), name);
    off += 30 + name.length + body.length;
  }
  const cd = central.reduce((s, a) => s + a.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cd, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)]);
}

/* ---------- 문단 모델 ----------
   paras: [{runs:[{t,b,i}], chap:boolean}] */
function pushText(para, t, fmt){
  if(!t) return;
  const last = para.runs[para.runs.length - 1];
  const h = fmt.h || 0;
  if(last && last.b === !!fmt.b && last.i === !!fmt.i && last.h === h) last.t += t;
  else para.runs.push({t, b: !!fmt.b, i: !!fmt.i, h});
}
/* 글자 크기: 가장 많이 쓰인 크기를 기준(1)으로 삼아 나머지는 비율(r)로 바꾼다 */
function sizesToRatio(paras){
  const w = new Map();
  for(const p of paras) for(const r of p.runs) if(r.h) w.set(r.h, (w.get(r.h) || 0) + r.t.length);
  let base = 0, best = -1; for(const [h, n] of w) if(n > best){ best = n; base = h; }
  for(const p of paras) for(const r of p.runs){
    let ratio = r.h && base ? Math.round(r.h / base * 100) / 100 : 1;
    if(Math.abs(ratio - 1) < 0.05) ratio = 1;
    delete r.h; if(ratio !== 1) r.r = ratio;
  }
  return paras;
}

/* ---------- HWPX 읽기 ---------- */
async function readHwpx(buf){
  const z = await unzip(buf);
  const parser = new DOMParser();
  const fmts = {};
  const header = await z.text('Contents/header.xml');
  if(header){
    const hd = parser.parseFromString(header, 'application/xml');
    for(const cp of hd.getElementsByTagNameNS('*', 'charPr')){
      const kids = [...cp.children].map(c => c.localName);
      fmts[cp.getAttribute('id')] = {b: kids.includes('bold'), i: kids.includes('italic'), h: Number(cp.getAttribute('height')) || 0};
    }
  }
  const secs = z.names.map(n => [n, /^Contents\/section(\d+)\.xml$/i.exec(n)]).filter(x => x[1]).sort((a, b) => a[1][1] - b[1][1]).map(x => x[0]);
  if(!secs.length) throw new Error('hwpx_empty');
  const paras = [];
  for(const s of secs){
    const doc = parser.parseFromString(await z.text(s), 'application/xml');
    const root = doc.documentElement;
    for(const p of root.children){
      if(p.localName !== 'p') continue;
      let para = {runs: [], chap: false}; paras.push(para);
      for(const run of p.children){
        if(run.localName !== 'run') continue;
        const fmt = fmts[run.getAttribute('charPrIDRef')] || {b: false, i: false};
        for(const t of run.children){
          if(t.localName !== 't') continue;
          for(const n of t.childNodes){
            if(n.nodeType === 3) pushText(para, n.nodeValue, fmt);
            else if(n.nodeType === 1){
              const k = n.localName;
              if(k === 'tab') pushText(para, '\t', fmt);
              else if(k === 'lineBreak'){ para = {runs: [], chap: false}; paras.push(para); }
              else if(k === 'nbSpace' || k === 'fwSpace') pushText(para, ' ', fmt);
              else if(k === 'hyphen') pushText(para, '-', fmt);
            }
          }
        }
      }
    }
  }
  return sizesToRatio(paras);
}

/* ---------- CFB(복합 문서) 읽기 ---------- */
function cfb(buf){
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if(dv.getUint32(0, true) !== 0xE011CFD0 || dv.getUint32(4, true) !== 0xE11AB1A1) throw new Error('not_hwp');
  const ss = 1 << dv.getUint16(0x1E, true), mss = 1 << dv.getUint16(0x20, true);
  const nFat = dv.getUint32(0x2C, true), dirStart = dv.getUint32(0x30, true), cutoff = dv.getUint32(0x38, true);
  const miniFatStart = dv.getUint32(0x3C, true), difStart = dv.getUint32(0x44, true);
  const sec = s => (s + 1) * ss;
  const END = 0xFFFFFFFA;
  const fatSecs = [];
  for(let i = 0; i < 109 && fatSecs.length < nFat; i++){ const s = dv.getUint32(0x4C + i * 4, true); if(s < END) fatSecs.push(s); }
  let d = difStart, guard = 0;
  while(d < END && fatSecs.length < nFat && guard++ < 1e5){
    for(let i = 0; i < ss / 4 - 1 && fatSecs.length < nFat; i++){ const s = dv.getUint32(sec(d) + i * 4, true); if(s < END) fatSecs.push(s); }
    d = dv.getUint32(sec(d) + ss - 4, true);
  }
  const fat = new Uint32Array(fatSecs.length * ss / 4);
  fatSecs.forEach((s, k) => { for(let i = 0; i < ss / 4; i++) fat[k * ss / 4 + i] = dv.getUint32(sec(s) + i * 4, true); });
  function chain(start, table){
    const out = []; let s = start, g = 0;
    while(s < END && g++ < 1e7){ out.push(s); s = table[s]; }
    return out;
  }
  function readBig(start, size){
    const ch = chain(start, fat), out = new Uint8Array(ch.length * ss);
    ch.forEach((s, k) => out.set(u8.subarray(sec(s), sec(s) + ss), k * ss));
    return size == null ? out : out.subarray(0, size);
  }
  const dirBytes = readBig(dirStart);
  const ddv = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  const entries = [];
  for(let o = 0; o + 128 <= dirBytes.length; o += 128){
    const nl = ddv.getUint16(o + 0x40, true);
    let name = ''; for(let i = 0; i < Math.max(0, nl / 2 - 1); i++) name += String.fromCharCode(ddv.getUint16(o + i * 2, true));
    entries.push({name, type: dirBytes[o + 0x42], left: ddv.getUint32(o + 0x44, true), right: ddv.getUint32(o + 0x48, true), child: ddv.getUint32(o + 0x4C, true), start: ddv.getUint32(o + 0x74, true), size: ddv.getUint32(o + 0x78, true)});
  }
  const root = entries[0];
  const ministream = root && root.start < END ? readBig(root.start, root.size) : new Uint8Array(0);
  let minifat = new Uint32Array(0);
  if(miniFatStart < END){ const b = readBig(miniFatStart); minifat = new Uint32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - b.length % 4)); }
  const paths = new Map();
  (function walk(idx, prefix, seen){
    if(idx >= END || idx >= entries.length || seen.has(idx)) return; seen.add(idx);
    const e = entries[idx];
    walk(e.left, prefix, seen); walk(e.right, prefix, seen);
    const path = prefix + e.name;
    if(e.type === 2) paths.set(path, e);
    else if(e.type === 1) walk(e.child, path + '/', seen);
  })(root ? root.child : END, '', new Set());
  return {
    has: p => paths.has(p),
    read(p){
      const e = paths.get(p); if(!e) return null;
      if(e.size < cutoff){
        const ch = chain(e.start, minifat), out = new Uint8Array(ch.length * mss);
        ch.forEach((s, k) => out.set(ministream.subarray(s * mss, s * mss + mss), k * mss));
        return out.subarray(0, e.size);
      }
      return readBig(e.start, e.size);
    }
  };
}

/* ---------- HWP 5.0 읽기 ---------- */
function* records(u8){
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let p = 0;
  while(p + 4 <= u8.length){
    const h = dv.getUint32(p, true); p += 4;
    const tag = h & 0x3FF, level = (h >>> 10) & 0x3FF; let size = h >>> 20;
    if(size === 0xFFF){ if(p + 4 > u8.length) return; size = dv.getUint32(p, true); p += 4; }
    yield {tag, level, data: u8.subarray(p, p + size)};
    p += size;
  }
}
const EXT8 = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
async function readHwp(buf){
  const f = cfb(buf);
  const fh = f.read('FileHeader');
  if(!fh || new TextDecoder().decode(fh.subarray(0, 17)) !== 'HWP Document File') throw new Error('not_hwp');
  const props = new DataView(fh.buffer, fh.byteOffset).getUint32(36, true);
  if(props & 2) throw new Error('hwp_password');
  if(props & 4) throw new Error('hwp_distribution');
  const compressed = !!(props & 1);
  const load = async p => {
    const raw = f.read(p); if(!raw) return null; if(!compressed) return raw;
    try{ return inflateJs(raw); }catch(e){ throw new Error('hwp_damaged'); }
  };
  const shapes = [];
  const di = await load('DocInfo');
  if(di) for(const r of records(di)){
    if(r.tag === 21 && r.data.length >= 50){
      const pr = new DataView(r.data.buffer, r.data.byteOffset).getUint32(46, true);
      shapes.push({i: !!(pr & 1), b: !!(pr & 2), h: new DataView(r.data.buffer, r.data.byteOffset).getInt32(42, true)});
    }
  }
  const paras = [];
  for(let s = 0; ; s++){
    const body = await load('BodyText/Section' + s);
    if(!body) break;
    let cur = null;
    const finish = () => {
      if(!cur) return;
      const marks = cur.shape.length ? cur.shape : [[0, 0]];
      let para = {runs: [], chap: false}; paras.push(para);
      for(const [pos, ch] of cur.chars){
        let id = 0; for(const [mp, mid] of marks){ if(mp <= pos) id = mid; else break; }
        const fmt = shapes[id] || {b: false, i: false};
        if(ch === '\n'){ para = {runs: [], chap: false}; paras.push(para); }
        else pushText(para, ch, fmt);
      }
      cur = null;
    };
    for(const r of records(body)){
      if(r.tag === 66 && r.level === 0){ finish(); cur = {chars: [], shape: []}; }
      else if(r.tag === 67 && r.level === 1 && cur){
        const dv = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength), n = r.data.length >> 1;
        for(let k = 0; k < n;){
          const c = dv.getUint16(k * 2, true);
          if(c >= 32){ cur.chars.push([k, String.fromCharCode(c)]); k++; }
          else if(c === 9){ cur.chars.push([k, '\t']); k += 8; }
          else if(EXT8.has(c)) k += 8;
          else {
            if(c === 10) cur.chars.push([k, '\n']);
            else if(c === 24) cur.chars.push([k, '-']);
            else if(c === 30 || c === 31) cur.chars.push([k, ' ']);
            k++;
          }
        }
      }
      else if(r.tag === 68 && r.level === 1 && cur){
        const dv = new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength);
        for(let o = 0; o + 8 <= r.data.length; o += 8) cur.shape.push([dv.getUint32(o, true), dv.getUint32(o + 4, true)]);
      }
    }
    finish();
  }
  if(!paras.length) throw new Error('hwp_empty');
  return sizesToRatio(paras);
}

/* ---------- 불러오기 입구 ---------- */
async function read(file){
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 4));
  if(head[0] === 0x50 && head[1] === 0x4B) return readHwpx(buf);
  if(head[0] === 0xD0 && head[1] === 0xCF) return readHwp(buf);
  throw new Error('unknown_format');
}

/* ---------- HWPX 만들기 ---------- */
const xesc = s => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function buildHeader(xml, o){
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const byName = n => [...doc.getElementsByTagNameNS('*', n)];
  let fontId = 0;
  for(const ff of byName('fontface')){
    const fonts = [...ff.children].filter(c => c.localName === 'font');
    fontId = fonts.length;
    const nf = fonts[fonts.length - 1].cloneNode(true);
    nf.setAttribute('id', String(fontId)); nf.setAttribute('face', o.font);
    ff.appendChild(nf); ff.setAttribute('fontCnt', String(fonts.length + 1));
  }
  const cps = byName('charProperties')[0], cp0 = [...cps.children].find(c => c.getAttribute('id') === '0');
  let nextC = cps.children.length;
  const ids = {};
  const mkChar = (key, height, b, i) => {
    const c = cp0.cloneNode(true), id = nextC++;
    c.setAttribute('id', String(id)); c.setAttribute('height', String(height));
    const fr = [...c.children].find(x => x.localName === 'fontRef');
    const sp = [...c.children].find(x => x.localName === 'spacing');
    for(const a of ['hangul', 'latin', 'hanja', 'japanese', 'other', 'symbol', 'user']){
      fr.setAttribute(a, String(fontId));
      if(sp) sp.setAttribute(a, String(o.spacing || 0));
    }
    const ul = [...c.children].find(x => x.localName === 'underline');
    if(i) c.insertBefore(doc.createElementNS(cp0.namespaceURI, 'hh:italic'), ul);
    if(b) c.insertBefore(doc.createElementNS(cp0.namespaceURI, 'hh:bold'), ul);
    cps.appendChild(c); ids[key] = id;
  };
  const h = o.height;
  mkChar('n', h, false, false); mkChar('b', h, true, false); mkChar('i', h, false, true); mkChar('bi', h, true, true);
  mkChar('c', Math.round(h * 1.2), true, false); mkChar('ci', Math.round(h * 1.2), true, true);
  for(const v of (o.variants || [])) if(!(v.key in ids)) mkChar(v.key, v.height, v.b, v.i);
  cps.setAttribute('itemCnt', String(cps.children.length));

  const pps = byName('paraProperties')[0], pp0 = [...pps.children].find(c => c.getAttribute('id') === '0');
  let nextP = pps.children.length;
  const mkPara = (key, align, intent, prev, next, keep) => {
    const p = pp0.cloneNode(true), id = nextP++;
    p.setAttribute('id', String(id));
    for(const el of p.getElementsByTagNameNS('*', 'align')) el.setAttribute('horizontal', align);
    for(const el of p.getElementsByTagNameNS('*', 'breakSetting')){
      el.setAttribute('keepWithNext', keep ? '1' : '0');
      el.setAttribute('breakLatinWord', 'KEEP_WORD');
      el.setAttribute('breakNonLatinWord', o.wrapWord ? 'KEEP_WORD' : 'BREAK_WORD');
    }
    for(const blk of p.getElementsByTagNameNS('*', 'case')) setMargins(blk, 1);
    for(const blk of p.getElementsByTagNameNS('*', 'default')) setMargins(blk, 2);
    function setMargins(blk, mul){
      for(const el of blk.getElementsByTagNameNS('*', 'intent')) el.setAttribute('value', String(intent * mul));
      for(const el of blk.getElementsByTagNameNS('*', 'prev')) el.setAttribute('value', String(prev * mul));
      for(const el of blk.getElementsByTagNameNS('*', 'next')) el.setAttribute('value', String(next * mul));
      for(const el of blk.getElementsByTagNameNS('*', 'lineSpacing')){ el.setAttribute('type', 'PERCENT'); el.setAttribute('value', String(o.linePct)); }
    }
    pps.appendChild(p); ids[key] = id;
  };
  mkPara('body', 'JUSTIFY', o.indent ? h : 0, 0, 0, false);
  mkPara('chap', 'LEFT', 0, h * 2, h, true);
  pps.setAttribute('itemCnt', String(pps.children.length));
  let out = new XMLSerializer().serializeToString(doc);
  if(!/^<\?xml/.test(out)) out = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' + out;
  return {xml: out, ids};
}
async function writeHwpx(paras, o, T){
  const height = Math.round(o.pt * 100);
  const spacing = Math.max(-50, Math.min(50, Math.round(o.ls || 0)));
  /* 글자 모양 열쇠: 크기 비율(r)이 1이 아니면 그 크기의 글자 모양을 따로 만든다 */
  const charKey = (p, r) => {
    const ratio = (r && r.r) || 1;
    if(ratio === 1) return p.chap ? (r && r.i ? 'ci' : 'c') : (r && r.b && r.i ? 'bi' : r && r.b ? 'b' : r && r.i ? 'i' : 'n');
    const b = p.chap || !!r.b, i = !!r.i, hh = Math.round(height * ratio * (p.chap ? 1.2 : 1));
    return 'v' + (b ? 1 : 0) + (i ? 1 : 0) + '_' + hh;
  };
  const variants = [];
  for(const p of paras) for(const r of p.runs){
    const k = charKey(p, r);
    if(k[0] === 'v' && !variants.some(v => v.key === k)){ const [bi, hh] = k.slice(1).split('_'); variants.push({key: k, b: bi[0] === '1', i: bi[1] === '1', height: +hh}); }
  }
  const {xml: header, ids} = buildHeader(T.header, {font: o.font, height, linePct: Math.round(o.lh * 100), indent: o.indent, spacing, wrapWord: o.wrap === 'word', variants});
  const runXml = (p) => {
    if(!p.runs.length || p.runs.every(r => !r.t)) return '<hp:run charPrIDRef="' + (p.chap ? ids.c : ids.n) + '"><hp:t/></hp:run>';
    return p.runs.filter(r => r.t).map(r => {
      const cp = ids[charKey(p, r)];
      const t = xesc(r.t).replace(/\t/g, '<hp:tab/>');
      return '<hp:run charPrIDRef="' + cp + '"><hp:t>' + t + '</hp:t></hp:run>';
    }).join('');
  };
  const list = paras.length ? paras : [{runs: [], chap: false}];
  let sec = T.sectionHead.replace('paraPrIDRef="0"', 'paraPrIDRef="' + (list[0].chap ? ids.chap : ids.body) + '"') + runXml(list[0]) + '</hp:p>';
  for(let k = 1; k < list.length; k++){
    const p = list[k];
    sec += '<hp:p id="' + (1000 + k) + '" paraPrIDRef="' + (p.chap ? ids.chap : ids.body) + '" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">' + runXml(p) + '</hp:p>';
  }
  sec += '</hs:sec>';
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const hpf = T.hpf.replace('<opf:title/>', '<opf:title>' + xesc(o.title || '') + '</opf:title>').replace(/>synthetic-fixture-author</g, '><').replace(/(name="(?:CreatedDate|ModifiedDate)" content="text">)[^<]*/g, '$1' + now);
  const preview = list.map(p => p.runs.map(r => r.t).join('')).join('\r\n').slice(0, 1000);
  const enc = new TextEncoder();
  return zip([
    {name: 'mimetype', data: enc.encode('application/hwp+zip'), store: true},
    {name: 'version.xml', data: enc.encode(T.version)},
    {name: 'Contents/header.xml', data: enc.encode(header)},
    {name: 'Contents/section0.xml', data: enc.encode(sec)},
    {name: 'Preview/PrvText.txt', data: enc.encode(preview)},
    {name: 'settings.xml', data: enc.encode(T.settings)},
    {name: 'META-INF/container.rdf', data: enc.encode(T.rdf)},
    {name: 'Contents/content.hpf', data: enc.encode(hpf)},
    {name: 'META-INF/container.xml', data: enc.encode(T.container)},
    {name: 'META-INF/manifest.xml', data: enc.encode(T.manifest)}
  ]);
}

return {read, readHwp, readHwpx, writeHwpx, zip, _inflate: inflateJs};
})();
