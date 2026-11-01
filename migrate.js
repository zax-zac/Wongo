/* 이 주소(zax-zac.github.io/Wongo)는 2026년 11월에 https://lightning-write.github.io/ 로 옮겼다.
   아래쪽 띠의 「새 주소로 옮기기」를 누르면: 드라이브에 연결되어 있으면 먼저 올려 두고,
   이 기기의 설정(라이트닝 주소·서식·받은 표시)을 실어 새 주소를 연다.
   드라이브에 연결되지 않은 기기에 원고가 있으면 백업부터 권한다.

   홈 화면에 설치한 앱 안에서는 다른 주소로 넘어가면 앱이 아니라 잠깐 띄운 브라우저 창(위에 주소가 보이는 창)으로 열린다.
   그래서 설치한 앱에서는 넘어가지 않고, 새 주소를 사파리·크롬에서 열어 다시 설치하라고 안내한다.
   옮기기를 마치면 기록해 두고(moved), 띠를 닫으면 다시 띄우지 않는다(move-hide). */
(function(){
  const NEW = 'https://lightning-write.github.io/', NEW_SHORT = 'lightning-write.github.io';
  const ls = k => { try{ const v = localStorage.getItem('wongo-' + k); return v == null ? null : JSON.parse(v); }catch(e){ return null; } };
  const lsSet = (k, v) => { try{ localStorage.setItem('wongo-' + k, JSON.stringify(v)); }catch(e){} };
  if(ls('move-hide')) return;
  const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const nap = ms => new Promise(r => setTimeout(r, ms));
  const installed = () => { try{ return navigator.standalone === true || ['standalone', 'fullscreen', 'minimal-ui'].some(m => matchMedia('(display-mode: ' + m + ')').matches); }catch(e){ return false; } };
  const moveUrl = () => NEW + '#move=' + b64(JSON.stringify({lt: ls('lt-url'), prefs: ls('prefs'), seen: ls('lt-seen')}));
  const css = document.createElement('style');
  css.textContent = '#moveBar{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(52px + env(safe-area-inset-bottom));z-index:80;width:min(560px,calc(100% - 24px));max-height:calc(100% - 90px);overflow:auto;background:var(--paper,#fff);color:var(--ink,#222);border:1px solid var(--accent,#2c4a6e);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:12px 14px;font-size:14px;line-height:1.6}'
    + '#moveBar p{margin:0 0 8px}#moveBar ol{margin:0 0 8px;padding-left:1.4em}#moveBar li{margin:2px 0}#moveBar .btns{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}#moveBar button{font:inherit;font-size:14px;padding:7px 14px;border-radius:8px;border:1px solid var(--line,#ccc);background:transparent;color:inherit;cursor:pointer}'
    + '#moveBar button.primary{background:var(--accent,#2c4a6e);border-color:var(--accent,#2c4a6e);color:var(--accent-ink,#fff)}#moveBar button:disabled{opacity:.6}#moveBar .addr{user-select:all;-webkit-user-select:all;font-weight:600}';
  document.head.appendChild(css);
  const bar = document.createElement('div'); bar.id = 'moveBar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', '새 주소 안내');
  document.body.appendChild(bar);
  const show = (html, btns) => {
    bar.hidden = false; bar.textContent = '';
    const p = document.createElement('div'); p.innerHTML = html; bar.appendChild(p);
    const row = document.createElement('div'); row.className = 'btns';
    for(const [label, fn, primary] of btns){ const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if(primary) b.className = 'primary'; b.onclick = () => fn(b); row.appendChild(b); }
    bar.appendChild(row);
  };
  async function copy(text, b, label){
    let ok = false;
    try{ await navigator.clipboard.writeText(text); ok = true; }catch(e){}
    if(!ok){
      try{
        const t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
        document.body.appendChild(t); t.select(); t.setSelectionRange(0, text.length); ok = document.execCommand('copy'); t.remove();
      }catch(e){}
    }
    b.textContent = ok ? '복사했습니다' : '복사하지 못했습니다';
    setTimeout(() => { b.textContent = label; }, 2500);
  }
  const close = () => { lsSet('move-hide', true); bar.hidden = true; };
  const go = () => { location.href = moveUrl(); };
  const W = () => window.__wongo;

  /* 동기화가 이미 돌고 있으면 끝나기를 기다렸다가 한 번 더 올린다 */
  async function upload(D){
    const end = Date.now() + 60000;   // 다 해서 1분까지만 기다린다
    const wait = async () => { while(D.state() === 'syncing' && Date.now() < end) await nap(500); };
    await wait();
    if(D.state() === 'syncing') return 'syncing';
    await Promise.race([D.sync().catch(() => {}), nap(Math.max(0, end - Date.now()))]);
    await wait();
    return D.state();
  }
  async function move(force){
    const w = W();
    if(!w){ lsSet('moved', {at: Date.now(), drive: false}); done(); if(!installed()) go(); return; }
    show('옮길 준비를 하는 중입니다…', []);
    try{ await w.flush(); }catch(e){}
    let drive = false;
    if(w.Drive.enabled()){
      show('드라이브에 원고를 올리는 중입니다…', []);
      const st = await upload(w.Drive);
      if(st !== 'ok'){ first(st === 'syncing' ? '드라이브가 아직 답하지 않습니다. 잠시 뒤 다시 눌러 주세요.' : '드라이브에 올리지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.'); return; }
      drive = true;
    } else if(ls('drive-on')){ first('드라이브 연결이 끊겨 있습니다. 원고 목록 아래 <b>드라이브 연결</b>을 누른 뒤 다시 <b>새 주소로 옮기기</b>를 눌러 주세요. 그래야 이 기기에서 고친 원고가 새 주소로 따라갑니다.'); return; }
    else {
      let n = 0;
      try{ n = (await w.DB.all()).filter(r => !r.deleted && (r.chars || 0) > 0).length; }catch(e){}
      if(n && !force){
        show('<p>이 기기는 드라이브에 연결되어 있지 않아 원고 ' + n + '편이 새 주소로 저절로 따라가지 않습니다. <b>백업 받기</b>로 파일을 받아 두고, 새 주소에서 <b>불러오기 → 이 기기의 파일</b>로 그 파일을 여세요.</p>',
          [['백업 받기', () => { const b = document.getElementById('exBackup'); if(b) b.click(); }], ['그래도 옮기기', () => move(true), true]]);
        return;
      }
    }
    lsSet('moved', {at: Date.now(), drive});
    done();
    if(!installed()) go();
  }
  function first(note){
    show('<p>' + (note ? note + '<br>' : '') + 'MYWONGO가 새 주소로 옮겼습니다: <b>' + NEW_SHORT + '</b><br>이 주소는 더 고치지 않습니다. 새 주소에서는 앱을 다시 설치하고 드라이브를 한 번 다시 연결합니다.</p>',
      [['새 주소로 옮기기', () => move(false), true]]);
  }
  /* 옮기기를 마친 뒤 */
  function done(){
    const m = ls('moved') || {}, lt = ls('lt-url');
    const head = m.drive ? '<b>원고를 드라이브에 다 올렸습니다.</b> ' : '';
    if(installed()){
      const btns = [['새 주소 복사', b => copy(moveUrl(), b, '새 주소 복사'), true]];
      if(lt) btns.push(['라이트닝 주소 복사', b => copy(lt, b, '라이트닝 주소 복사')]);
      btns.push(['닫기', close]);
      show('<p>' + head + '이제 새 앱을 설치하면 됩니다. 홈 화면에 설치한 앱 안에서는 새 주소가 앱이 아니라 잠깐 띄운 브라우저 창으로 열려서(위에 주소가 보이던 창), 거기서는 설치할 수 없습니다.</p>'
        + '<ol><li><b>새 주소 복사</b>를 누르고 사파리(안드로이드·컴퓨터는 크롬) 주소창에 붙여 넣어 엽니다. 직접 칠 때는 <span class="addr">' + NEW_SHORT + '</span></li>'
        + '<li>아이폰·아이패드는 공유 → <b>홈 화면에 추가</b>, 안드로이드는 메뉴 → <b>앱 설치</b>(또는 홈 화면에 추가), 컴퓨터는 주소창 오른쪽의 설치 단추.</li>'
        + '<li>새 앱의 원고 목록 아래 <b>드라이브 연결</b>을 누르면 원고가 내려옵니다.' + (lt ? ' 번개를 처음 누를 때 라이트닝 주소를 물으면 <b>라이트닝 주소 복사</b>로 복사해 둔 주소를 넣습니다.' : '') + '</li></ol>'
        + '<p>새 앱이 잘 열리면 이 앱은 홈 화면에서 지워도 됩니다.</p>', btns);
    } else {
      show('<p>' + head + '새 주소 <b>' + NEW_SHORT + '</b>를 열었습니다. 앞으로는 새 주소를 즐겨찾기나 홈 화면에 추가해 쓰세요. 이 주소는 더 고치지 않습니다.</p>',
        [['새 주소 열기', go, true], ['닫기', close]]);
    }
  }
  if(ls('moved')) done(); else first('');
  // 새 주소로 넘어갔다가 뒤로 돌아온 경우
  window.addEventListener('pageshow', e => { if(e.persisted && ls('moved') && !ls('move-hide')) done(); });
})();
