/* 이 주소(zax-zac.github.io/Wongo)는 2026년 11월에 https://lightning-write.github.io/ 로 옮겼다.
   아래쪽 띠의 「새 주소로 옮기기」를 누르면: 드라이브에 연결되어 있으면 먼저 올려 두고,
   이 기기의 설정(라이트닝 주소·서식·받은 표시)을 실어 새 주소를 연다.
   드라이브에 연결되지 않은 기기에 원고가 있으면 백업부터 권한다. */
(function(){
  const NEW = 'https://lightning-write.github.io/';
  const ls = k => { try{ const v = localStorage.getItem('wongo-' + k); return v == null ? null : JSON.parse(v); }catch(e){ return null; } };
  const b64 = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const css = document.createElement('style');
  css.textContent = '#moveBar{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(52px + env(safe-area-inset-bottom));z-index:80;width:min(560px,calc(100% - 24px));background:var(--paper,#fff);color:var(--ink,#222);border:1px solid var(--accent,#2c4a6e);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:12px 14px;font-size:14px;line-height:1.6}'
    + '#moveBar p{margin:0 0 8px}#moveBar .btns{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}#moveBar button{font:inherit;font-size:14px;padding:7px 14px;border-radius:8px;border:1px solid var(--line,#ccc);background:transparent;color:inherit;cursor:pointer}'
    + '#moveBar button.primary{background:var(--accent,#2c4a6e);border-color:var(--accent,#2c4a6e);color:var(--accent-ink,#fff)}#moveBar button:disabled{opacity:.6}';
  document.head.appendChild(css);
  const bar = document.createElement('div'); bar.id = 'moveBar'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', '새 주소 안내');
  document.body.appendChild(bar);
  const show = (text, btns) => {
    bar.textContent = '';
    const p = document.createElement('p'); p.innerHTML = text; bar.appendChild(p);
    const row = document.createElement('div'); row.className = 'btns';
    for(const [label, fn, primary] of btns){ const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if(primary) b.className = 'primary'; b.onclick = fn; row.appendChild(b); }
    bar.appendChild(row);
  };
  const go = () => { location.href = NEW + '#move=' + b64(JSON.stringify({lt: ls('lt-url'), prefs: ls('prefs'), seen: ls('lt-seen')})); };
  const W = () => window.__wongo;
  async function move(force){
    const w = W();
    if(!w){ go(); return; }
    show('옮길 준비를 하는 중입니다…', []);
    try{ await w.flush(); }catch(e){}
    if(w.Drive.enabled()){
      show('드라이브에 원고를 올리는 중입니다…', []);
      try{ await w.Drive.sync(); }catch(e){}
      if(w.Drive.state() !== 'ok'){ first('드라이브에 올리지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.'); return; }
      go(); return;
    }
    if(ls('drive-on')){ first('드라이브 연결이 끊겨 있습니다. 원고 목록 아래 <b>드라이브 연결</b>을 누른 뒤 다시 <b>새 주소로 옮기기</b>를 눌러 주세요. 그래야 이 기기에서 고친 원고가 새 주소로 따라갑니다.'); return; }
    let n = 0;
    try{ n = (await w.DB.all()).filter(r => !r.deleted && (r.chars || 0) > 0).length; }catch(e){}
    if(n && !force){
      show('이 기기는 드라이브에 연결되어 있지 않아 원고 ' + n + '편이 새 주소로 저절로 따라가지 않습니다. <b>백업 받기</b>로 파일을 받아 두고, 새 주소에서 <b>불러오기 → 이 기기의 파일</b>로 그 파일을 여세요.',
        [['백업 받기', () => { const b = document.getElementById('exBackup'); if(b) b.click(); }], ['그래도 옮기기', () => move(true), true]]);
      return;
    }
    go();
  }
  function first(note){
    show((note ? note + '<br>' : '') + 'MYWONGO가 새 주소로 옮겼습니다: <b>lightning-write.github.io</b><br>이 주소는 더 고치지 않습니다. 새 주소에서는 앱을 다시 설치하고 드라이브를 한 번 다시 연결합니다.',
      [['새 주소로 옮기기', () => move(false), true]]);
  }
  first('');
})();
