const CACHE_NAME='running-coach-v9.0-progressive-records';
const ASSETS=['./','./index.html','./styles.css?v=9.0','./app.js?v=9.0','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('running-coach-')&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith(caches.open(CACHE_NAME).then(async cache=>{
  if(event.request.mode==='navigate')return (await cache.match('./index.html'))||fetch(event.request);
  const hit=await cache.match(event.request);if(hit)return hit;
  return fetch(event.request);
 }));
});
