'use strict';
/* E-Reader V25.8 - Flashcard image media manager.
   Binary photos stay in a scoped IndexedDB, never in the Drive JSON manifest.
   When logged in, uploads use Drive's drive.file scope and an app-created folder.
   Direct third-party URLs are never claimed to be offline copies if CORS blocks download. */
(function(){
  const MAX_INPUT=12*1024*1024;
  const MAX_STORED=3*1024*1024;
  const URLs=new Map();
  let uploadRunning=false;
  const bridge=()=>window.EReaderWordLabBridge;
  const cloud=()=>window.EReaderCloud;
  const scope=()=>String(bridge()?.scope?.()||'guest').replace(/[^a-zA-Z0-9_]/g,'_').slice(0,105);
  const imageId=()=>((globalThis.crypto?.randomUUID?.()||('p'+Date.now().toString(36)+Math.random().toString(36).slice(2))).replace(/[^a-zA-Z0-9_-]/g,''));
  const safeUrl=value=>{try{const u=new URL(String(value||'').trim());return u.protocol==='https:'&&u.username===''&&u.password===''&&u.href.length<2048?u.href:'';}catch{return '';}};
  function database(){return new Promise((resolve,reject)=>{
    const req=indexedDB.open('EReaderFlashcardMedia_'+scope(),1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('images'))req.result.createObjectStore('images',{keyPath:'id'});};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||Error('Không mở được bộ nhớ ảnh.'));
  });}
  async function operate(mode,cb){const db=await database();return new Promise((resolve,reject)=>{
    const tx=db.transaction('images',mode);const req=cb(tx.objectStore('images'));let result;
    if(req){req.onsuccess=()=>{result=req.result;};req.onerror=()=>reject(req.error);}
    tx.oncomplete=()=>{db.close();resolve(result);};tx.onerror=()=>{db.close();reject(tx.error);};tx.onabort=()=>{db.close();reject(tx.error);};
  });}
  const get=id=>operate('readonly',s=>s.get(id));
  const put=entry=>operate('readwrite',s=>s.put(entry));
  const all=()=>operate('readonly',s=>s.getAll());
  function objectURL(id,blob){
    if(URLs.has(id))return URLs.get(id);
    const ref=URL.createObjectURL(blob);URLs.set(id,ref);return ref;
  }
  async function convert(file){
    if(!file||!file.size||file.size>MAX_INPUT)throw Error('Chọn ảnh JPG/PNG/WebP/GIF không quá 12 MB.');
    if(!/^image\/(jpeg|png|webp|gif)$/.test(file.type||''))throw Error('Chỉ hỗ trợ JPG, PNG, WebP hoặc GIF (GIF sẽ lấy một khung hình).');
    const temporary=URL.createObjectURL(file);
    try{
      const img=await new Promise((resolve,reject)=>{const el=new Image();el.onload=()=>resolve(el);el.onerror=()=>reject(Error('Không đọc được tệp ảnh.'));el.src=temporary;});
      const w=img.naturalWidth,h=img.naturalHeight;
      if(!w||!h||w*h>90_000_000)throw Error('Kích thước ảnh quá lớn hoặc không hợp lệ.');
      const k=Math.min(1,1000/Math.max(w,h));const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.round(w*k));canvas.height=Math.max(1,Math.round(h*k));
      const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      let out=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.8));
      if(!out?.size)out=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.79));
      if(!out?.size||out.size>MAX_STORED)throw Error('Không thể nén ảnh để lưu an toàn.');
      return out;
    }finally{URL.revokeObjectURL(temporary);}
  }
  async function remember(file,info={}){
    const blob=await convert(file);const id=imageId();
    const doc={id,blob,bookId:String(info.bookId||''),chapter:Number(info.chapter||0),word:String(info.word||''),created:Date.now(),driveFileId:'',mime:blob.type,pending:false};
    await put(doc);
    return {id:'local-'+id,localKey:id,driveFileId:'',thumbnail:'',url:'',mime:blob.type,
      title:file.name||('Ảnh cho '+info.word),source:'Ảnh từ thiết bị',creator:'Ảnh do người dùng chọn',license:'Do người dùng chịu trách nhiệm',sourcePage:'',savedAt:Date.now()};
  }
  async function fromUrl(raw,info={}){
    const href=safeUrl(raw);
    if(!href)throw Error('Cần dán địa chỉ https:// trực tiếp của hình ảnh.');
    if(/\b(google\.com\/search|google\.com\/imghp|bing\.com\/images|openverse\.org\/search)\b/i.test(href))throw Error('Đây là trang tìm kiếm, không phải đường dẫn tệp ảnh. Hãy tải ảnh về máy rồi chọn tệp.');
    try{
      const controller=new AbortController();const t=setTimeout(()=>controller.abort(),14000);
      let response;try{response=await fetch(href,{mode:'cors',signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});}finally{clearTimeout(t);}
      if(!response.ok)throw Error('HTTP '+response.status);
      const declared=response.headers.get('content-length');if(declared&&Number(declared)>MAX_INPUT)throw Error('Ảnh vượt 12MB.');
      const mime=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
      if(!/^image\/(jpeg|png|webp|gif)$/.test(mime))throw Error('URL không trả về ảnh JPG/PNG/WebP/GIF.');
      const buf=await response.blob();if(buf.size>MAX_INPUT)throw Error('Ảnh vượt 12MB.');
      const img=await remember(new File([buf],'image-from-link',{type:mime}),info);
      return {image:{...img,source:'Ảnh tải từ liên kết',sourcePage:href,creator:'Nguồn bên ngoài',license:'Chưa xác minh quyền sử dụng'},offline:true};
    }catch(err){
      // A direct image may be viewable as <img> yet block CORS fetch. Keep the
      // link only, warn explicitly, and never claim Drive upload/offline use.
      return {image:{id:'link-'+imageId(),localKey:'',driveFileId:'',thumbnail:href,url:href,mime:'',title:'Ảnh theo liên kết',
        source:'Liên kết ngoài',sourcePage:href,creator:'Nguồn bên ngoài',license:'Chưa xác minh quyền sử dụng',linkOnly:true},offline:false,
        warning:'Trang ảnh không cho tải tự động (CORS hoặc mạng). Thẻ hiện dùng liên kết, chưa lưu ảnh vào máy/Drive. Muốn dùng ngoại tuyến và đồng bộ, hãy tải ảnh về rồi chọn “Ảnh từ máy”.'};
    }
  }
  async function resolve(ref){
    if(!ref)return '';
    const id=String(ref.localKey||'');
    if(id){const record=await get(id).catch(()=>null);if(record?.blob)return objectURL(id,record.blob);}
    if(ref.driveFileId&&cloud()?.isSignedIn?.()){
      try{
        const blob=await cloud().downloadFlashcardImage(ref.driveFileId);
        if(blob?.size){const key=id||('drive-'+ref.driveFileId);await put({id:key,blob,bookId:'',chapter:0,word:'',created:Date.now(),driveFileId:ref.driveFileId,mime:blob.type,pending:false});return objectURL(key,blob);}
      }catch(err){console.warn('Tải lại ảnh Flashcard:',err);}
    }
    return safeUrl(ref.thumbnail)||safeUrl(ref.url)||'';
  }
  async function markForSync(localKey,info){
    const entry=await get(localKey);if(!entry?.blob)throw Error('Không tìm thấy ảnh đã nhập trong bộ nhớ thiết bị.');
    entry.bookId=String(info?.bookId||entry.bookId||'');entry.chapter=Number(info?.chapter||0);
    entry.word=String(info?.word||entry.word||'');entry.pending=!entry.driveFileId;
    await put(entry);return true;
  }
  async function syncPending(){
    if(uploadRunning||!cloud()?.isSignedIn?.())return 0;
    uploadRunning=true;let n=0;
    try{
      const records=(await all()).filter(r=>r.pending&&r.blob?.size&&r.bookId);
      for(const r of records){
        if(!cloud()?.isSignedIn?.())break;
        try{
          const fileId=r.driveFileId||await cloud().uploadFlashcardImage(r.id,r.blob);
          r.driveFileId=fileId;r.pending=false;await put(r);
          await bridge()?.updateImageRef?.({bookId:r.bookId,chapter:r.chapter,word:r.word,localKey:r.id,driveFileId:fileId});
          window.dispatchEvent(new CustomEvent('ereaderFlashcardImageUploaded',{detail:{localKey:r.id,driveFileId:fileId}}));
          n++;
        }catch(err){console.warn('Ảnh chờ Google Drive:',err);break;}
      }
    }finally{uploadRunning=false;}
    return n;
  }
  function syncSoon(){if(cloud()?.isSignedIn?.())setTimeout(()=>syncPending().catch(console.warn),450);}
  window.EReaderFlashcardMedia={remember,fromUrl,resolve,markForSync,syncPending,syncSoon,safeUrl};
})();
