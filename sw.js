/* 오프라인 실행: 앱 파일을 기기에 보관해 두고, 인터넷이 없어도 열리게 한다.
   앱 파일을 고치면 VERSION을 올려야 기기에 새 버전이 들어간다. */
const VERSION = 'wongo-v9';
const FONTS = 'wongo-fonts';
const SHELL = [
  './', 'index.html', 'app.js', 'hangul.js', 'hwpx-template.js', 'config.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'KoPub_Batang_Light.ttf'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, {cache: 'reload'})))));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== FONTS).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => { if(e.data === 'skip') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  if(url.origin === self.location.origin){
    if(req.mode === 'navigate'){
      e.respondWith(caches.match('index.html').then(r => r || fetch(req)));
      return;
    }
    e.respondWith(caches.match(req, {ignoreSearch: true}).then(r => r || fetch(req)));
    return;
  }

  // 화면 글꼴(Google Fonts): 한 번 받으면 보관해 두고 오프라인에서도 쓴다
  if(url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    e.respondWith(caches.open(FONTS).then(async c => {
      const hit = await c.match(req);
      const net = fetch(req).then(res => { if(res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
  // 구글 로그인·드라이브 요청은 그대로 인터넷으로 보낸다
});
