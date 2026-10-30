'use strict';
/* E-Reader Pro V19: Google Drive sync; no Firebase or server-side credentials. */
(function(){
  const SCOPE='https://www.googleapis.com/auth/drive.file';
  const API='https://www.googleapis.com/drive/v3/files';
  const UPLOAD='https://www.googleapis.com/upload/drive/v3/files';
  const CLIENT_ID=String(window.EREADER_GOOGLE_CLIENT_ID||'').trim();
  const FOLDER_NAME='EReader Pro';
  const DATA_NAME='ereader-sync-v1.json';
  let accessToken='',expiresAt=0,profile=null,tokenClient=null,folderId='',dataId='',manifest=null;
  let hooks={},syncLock=null,syncBooks=true,dirty=false,timer=null;
  const status=m=>hooks.onMessage?.(m);
  const configured=CLIENT_ID.endsWith('.apps.googleusercontent.com');
  const isSignedIn=()=>!!(profile&&accessToken&&Date.now()<expiresAt-30000);
  const getUid=()=>profile?.uid||'';
  const asError=e=>String(e?.message||e||'Error').slice(0,280);
  const encode=name=>encodeURIComponent(name);
  const cleanText=s=>String(s||'').trim();
  function notifyLoggedOut(){if(profile){profile=null;accessToken='';manifest=null;folderId='';dataId='';clearTimeout(timer);hooks.onAuth?.(null);}}
  function ensureAuthorized(){if(!isSignedIn()){if(profile)status('Phiên Google đã hết hạn. Bấm Kết nối Google để cấp quyền lại.');throw Error('Phiên Google Drive hết hạn. Hãy đăng nhập Google lại.');}}
  async function request(path,options={}){
    if(!accessToken || Date.now()>=expiresAt-30000)throw Error('Phiên Google Drive hết hạn. Vui lòng kết nối lại.');
    const headers=new Headers(options.headers||{});headers.set('Authorization','Bearer '+accessToken);
    const response=await fetch(path,{...options,headers});
    let content;
    if(options.raw)return response;
    const text=await response.text();
    try{content=text?JSON.parse(text):{};}catch{content={error:{message:text.slice(0,250)}};}
    if(!response.ok){
      if(response.status===401){accessToken='';expiresAt=0;}
      throw Error(content.error?.message||('Google Drive '+response.status));
    }
    return content;
  }
  async function listFiles(q){
    const files=[];let pageToken='';
    do{
      const query=new URLSearchParams({q,fields:'nextPageToken,files(id,name,mimeType,size,modifiedTime)',pageSize:'1000',spaces:'drive'});
      if(pageToken)query.set('pageToken',pageToken);
      const data=await request(API+'?'+query);
      files.push(...(data.files||[]));pageToken=data.nextPageToken||'';
    }while(pageToken);
    return files;
  }
  function quote(s){return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'");}
  async function makeMetadata(name,mimeType,parent){
    return request(API+'?fields=id,name,mimeType',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,mimeType,...(parent?{parents:[parent]}:{})})});
  }
  async function ensureFolder(){
    if(folderId)return folderId;
    const found=await listFiles("name = '"+quote(FOLDER_NAME)+"' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    folderId=found[0]?.id||(await makeMetadata(FOLDER_NAME,'application/vnd.google-apps.folder')).id;
    return folderId;
  }
  async function listFolder(){const id=await ensureFolder();return listFiles("'"+quote(id)+"' in parents and trashed = false");}
  async function uploadBytes(id,blob,mimeType){
    const headers={'Content-Type':mimeType};
    return request(UPLOAD+'/'+encode(id)+'?uploadType=media&fields=id,name,size,modifiedTime',{method:'PATCH',headers,body:blob});
  }
  async function saveNewFile(name,blob,mimeType){
    const meta=await makeMetadata(name,mimeType,await ensureFolder());
    await uploadBytes(meta.id,blob,mimeType);
    return meta.id;
  }
  async function downloadBytes(id){
    const response=await request(API+'/'+encode(id)+'?alt=media',{raw:true});
    if(!response.ok)throw Error('Không thể tải tệp sách ('+response.status+').');
    return response.blob();
  }
  async function getManifest(force=false){
    if(manifest&&!force)return manifest;
    const files=await listFolder();
    dataId=files.find(f=>f.name===DATA_NAME)?.id||'';
    if(!dataId)return(manifest={version:1,books:{},states:{},sentences:{},prefs:{},modifiedAt:0});
    const response=await request(API+'/'+encode(dataId)+'?alt=media',{raw:true});
    if(!response.ok)throw Error('Không thể tải dữ liệu đồng bộ từ Drive ('+response.status+').');
    const data=await response.json();
    if(!data||data.version!==1)throw Error('Tệp đồng bộ Drive có định dạng không hỗ trợ.');
    return(manifest={version:1,books:data.books||{},states:data.states||{},sentences:data.sentences||{},prefs:data.prefs||{},modifiedAt:data.modifiedAt||0});
  }
  function bookRecord(b){
    const fields=['id','name','title','type','author','chapterCount','size','added','lastModified','cloudFile'];
    const out={};for(const f of fields)if(b[f]!==undefined)out[f]=b[f];
    out.id=String(b.id);out.cloudFile=!!b.cloudFile;return out;
  }
  function copyState(s){const allowed=['id','chapter','offset','progress','bookmarks','words','translations','translationVisibility','meaningOverrides','partOfSpeechOverrides','updatedAt'];
    const data={};for(const key of allowed)if(s[key]!==undefined)data[key]=s[key];return data;}
  function mergeList(a,b,keyFn){const map=new Map();for(const item of [...(a||[]),...(b||[])])if(item){const key=keyFn(item);if(!map.has(key)||(item.created||0)>(map.get(key).created||0))map.set(key,item);}return [...map.values()];}
  function mergeStates(a,b){
    if(!a)return b;if(!b)return a;
    const newer=(a.updatedAt||0)>=(b.updatedAt||0)?a:b, older=newer===a?b:a;
    return {...older,...newer,bookmarks:mergeList(a.bookmarks,b.bookmarks,x=>(x.chapter||0)+'|'+(x.offset||0)),
      words:mergeList(a.words,b.words,x=>[x.kind,x.source,x.context,x.chapter].join('|')),
      translations:{...(older.translations||{}),...(newer.translations||{})},
      translationVisibility:{...(older.translationVisibility||{}),...(newer.translationVisibility||{})},
      meaningOverrides:{...(older.meaningOverrides||{}),...(newer.meaningOverrides||{})},
      partOfSpeechOverrides:{...(older.partOfSpeechOverrides||{}),...(newer.partOfSpeechOverrides||{})}};
  }
  async function start(callbacks={}){
    hooks=callbacks;
    if(!configured){status('Chưa cấu hình Google OAuth Client ID trong drive-config.js. Sách vẫn lưu trên máy.');return;}
    if(!window.google?.accounts?.oauth2){status('Không tải được Google Identity Services. Kiểm tra Internet hoặc trình chặn quảng cáo.');return;}
    tokenClient=google.accounts.oauth2.initTokenClient({client_id:CLIENT_ID,scope:SCOPE,callback:()=>{}});
    status('Sẵn sàng. Bấm Đăng nhập Google để kết nối Drive.');
  }
  function loginGoogle(){
    if(!configured)throw Error('Cần điền Google OAuth Client ID vào drive-config.js.');
    if(!tokenClient)throw Error('Không tải được thư viện đăng nhập Google. Hãy mở ứng dụng bằng HTTPS và tải lại trang.');
    return new Promise((resolve,reject)=>{
      tokenClient.callback=async result=>{
        if(result.error){reject(Error(result.error_description||result.error));return;}
        try{
          const previousUid=profile?.uid;
          accessToken=result.access_token;expiresAt=Date.now()+Number(result.expires_in||3300)*1000;
          const about=await request('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName,permissionId)');
          const info=about.user||{};
          if(!info.permissionId && !info.emailAddress)throw Error('Google Drive không trả về thông tin tài khoản.');
          const uid=String(info.permissionId||info.emailAddress.toLowerCase());
          profile={uid,email:info.emailAddress||'',displayName:info.displayName||''};
          if(previousUid!==uid){folderId='';dataId='';manifest=null;}
          await hooks.onAuth?.(profile);
          status('Đã kết nối Google Drive: '+profile.email);
          resolve(profile);
        }catch(e){reject(e);}
      };
      try{tokenClient.requestAccessToken({prompt:'select_account'});}catch(e){reject(e);}
    });
  }
  async function logout(){
    if(accessToken&&window.google?.accounts?.oauth2?.revoke)google.accounts.oauth2.revoke(accessToken,()=>{});
    notifyLoggedOut();status('Đã ngắt kết nối Google Drive. Sách trên thiết bị vẫn còn.');
  }
  async function pullLibrary(){
    const state=await getManifest(true);
    return Object.keys(state.books).map(id=>({id,book:state.books[id],state:state.states[id]||null,updatedAt:state.states[id]?.updatedAt||0}));
  }
  async function pullPreferences(){const m=await getManifest();return m.prefs||null;}
  async function findSentence(identity){const m=await getManifest();return m.sentences[identity.key]||null;}
  async function pullChapterTranslations(bookId,chapter,source,target){
    const m=await getManifest();const key=JSON.stringify([bookId,chapter,source,target]);
    const records=Object.values(m.sentences).filter(c=>c.bookChapter===key);
    for(const record of records){
      try{const local=await hooks.getLocalSentence?.(record.key);
        if(!local || (local.updatedAt||0)<(record.updatedAt||0))await hooks.saveLocalSentence?.({...record,cloudSyncedAt:record.updatedAt});}
      catch(e){console.warn('Local translation cache:',e);}
    }
    return records;
  }
  function schedule(){
    if(!isSignedIn())return;
    dirty=true;clearTimeout(timer);
    timer=setTimeout(()=>syncNow().catch(e=>status('Chưa đồng bộ được: '+asError(e))),6500);
  }
  function queueBook(){schedule();}
  function queueBookState(){schedule();}
  function queueSentence(){schedule();}
  function queuePreferences(){schedule();}
  function setSyncBooks(value){syncBooks=!!value;}
  async function downloadBook(record){
    ensureAuthorized();
    if(!record.cloudFile)throw Error('Sách chưa có tệp trên Google Drive. Bật đồng bộ tệp trên thiết bị gốc.');
    const files=await listFolder();const filename='book-'+record.id+'.'+(record.type==='docx'?'docx':'epub');
    const file=files.find(f=>f.name===filename);
    if(!file)throw Error('Không tìm thấy tệp EPUB/Word trên Google Drive. Hãy đồng bộ lại máy gốc.');
    const blob=await downloadBytes(file.id);
    return new File([blob],record.name||filename,{type:blob.type,lastModified:record.lastModified||Date.now()});
  }
  function newer(a,b){if(!a)return b;if(!b)return a;return (a.updatedAt||0)>=(b.updatedAt||0)?a:b;}
  async function syncNow(snapshot){
    ensureAuthorized();if(syncLock)return syncLock;
    clearTimeout(timer);
    syncLock=(async()=>{
      const uid=profile.uid;
      const local=snapshot||await hooks.localSnapshot?.();
      if(!local)throw Error('Không thể đọc dữ liệu cục bộ.');
      const remote=await getManifest(true);
      const files=await listFolder();
      let uploads=0,errors=[];
      for(const b of (local.books||[])){
        if(!isSignedIn()||profile.uid!==uid)throw Error('Tài khoản Google đã thay đổi.');
        const meta=bookRecord(b);const prior=remote.books[b.id]||{};
        if(syncBooks&&b.file&&!prior.cloudFile){
          const filename='book-'+b.id+'.'+(b.type==='docx'?'docx':'epub');
          const existing=files.find(f=>f.name===filename);
          if(b.file.size>25*1024*1024){errors.push((b.name||b.id)+': tệp vượt 25MB');}
          else try{
            if(!existing)await saveNewFile(filename,b.file,b.type==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/epub+zip');
            meta.cloudFile=true;uploads++;
            await hooks.markBookStored?.(b.id);
          }catch(e){errors.push((b.name||b.id)+': '+asError(e));}
        }else if(files.some(f=>f.name==='book-'+b.id+'.'+(b.type==='docx'?'docx':'epub'))){meta.cloudFile=true;}
        remote.books[b.id]={...prior,...meta,cloudFile:!!(prior.cloudFile||meta.cloudFile)};
      }
      for(const s of (local.states||[])){remote.states[s.id]=mergeStates(remote.states[s.id],copyState(s));}
      for(const c of (local.sentenceCache||[])){
        if(!c.translation||!c.key)continue;
        remote.sentences[c.key]=newer(c,remote.sentences[c.key]);
      }
      if(local.prefs)remote.prefs={...remote.prefs,...local.prefs};
      remote.modifiedAt=Date.now();
      const payload=JSON.stringify(remote);
      if(new TextEncoder().encode(payload).length>27*1024*1024)throw Error('Dữ liệu bản dịch trên Drive vượt 27 MB, hãy sao lưu rồi chia thư viện.');
      const blob=new Blob([payload],{type:'application/json'});
      if(dataId)await uploadBytes(dataId,blob,'application/json');
      else dataId=await saveNewFile(DATA_NAME,blob,'application/json');
      manifest=remote;dirty=false;
      for(const c of (local.sentenceCache||[]))if(c.translation)await hooks.markSentenceSynced?.(c);
      await hooks.onRefresh?.();
      return 'Đã đồng bộ Google Drive: '+Object.keys(remote.books).length+' sách, '+Object.keys(remote.sentences).length+' bản dịch'+(uploads?' · '+uploads+' tệp sách mới':'')+(errors.length?' · chưa tải: '+errors.join('; '):'')+'.';
    })();
    try{return await syncLock;}finally{syncLock=null;}
  }
  window.EReaderCloud={isConfigured:()=>configured,isSignedIn,getUid,loginGoogle,logout,start,pullLibrary,pullPreferences,
    pullChapterTranslations,findSentence,queuePreferences,queueBookState,queueSentence,queueBook,setSyncBooks,downloadBook,syncNow};
})();
