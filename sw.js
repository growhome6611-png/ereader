/* Sau lần truy cập đầu tiên có mạng, lưu các thư viện tĩnh cho lần sau sử dụng offline. */
const CACHE='ereader-pwa-v21';
const ROOT=['/','/index.html','/style.css','/app.js','/cloud-sync.js','/drive-config.js','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png'];
const VENDORS=[
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.2.6/purify.min.js'
];
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await cache.addAll(ROOT);
    await Promise.allSettled(VENDORS.map(async url=>{
      const response=await fetch(new Request(url,{mode:'no-cors'}));
      if(response)await cache.put(url,response);
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('ereader-pwa-')&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  const isVendor=VENDORS.includes(url.href);
  if(url.origin!==self.location.origin && !isVendor)return;
  if(isVendor){
    event.respondWith((async()=>{
      const hit=await caches.match(request,{ignoreSearch:true});if(hit)return hit;
      const response=await fetch(request);
      const cache=await caches.open(CACHE);await cache.put(request,response.clone());return response;
    })());
  }else{
    event.respondWith((async()=>{
      try{
        const response=await fetch(request);
        if(response.ok){const cache=await caches.open(CACHE);cache.put(request,response.clone()).catch(()=>{});}
        return response;
      }catch(e){return (await caches.match(request,{ignoreSearch:true}))||(url.pathname==='/'?await caches.match('/index.html'):Response.error());}
    })());
  }
});
