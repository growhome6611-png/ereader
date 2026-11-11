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
  let audioFolderId='',audioUploadTimer=null;const audioUploads=new Map();
  const chapterAudioFolders=new Map();let audioFileIndex=null,audioIndexExpires=0;
  let newsSyncTimer=null;const pendingNewsTranslations={};
  const status=m=>hooks.onMessage?.(m);
  const configured=CLIENT_ID.endsWith('.apps.googleusercontent.com');
  const isSignedIn=()=>!!(profile&&accessToken&&Date.now()<expiresAt-30000);
  const getUid=()=>profile?.uid||'';
  const asError=e=>String(e?.message||e||'Error').slice(0,280);
  const encode=name=>encodeURIComponent(name);
  const cleanText=s=>String(s||'').trim();
  function notifyLoggedOut(){if(profile){profile=null;accessToken='';manifest=null;folderId='';audioFolderId='';dataId='';chapterAudioFolders.clear();audioFileIndex=null;audioIndexExpires=0;clearTimeout(timer);hooks.onAuth?.(null);}}
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
      const query=new URLSearchParams({q,fields:'nextPageToken,files(id,name,mimeType,size,modifiedTime,appProperties)',pageSize:'1000',spaces:'drive'});
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
    if(!dataId)return(manifest={version:1,books:{},states:{},sentences:{},newsTranslations:{},prefs:{},modifiedAt:0});
    const response=await request(API+'/'+encode(dataId)+'?alt=media',{raw:true});
    if(!response.ok)throw Error('Không thể tải dữ liệu đồng bộ từ Drive ('+response.status+').');
    const data=await response.json();
    if(!data||data.version!==1)throw Error('Tệp đồng bộ Drive có định dạng không hỗ trợ.');
    return(manifest={version:1,books:data.books||{},states:data.states||{},sentences:data.sentences||{},newsTranslations:data.newsTranslations||{},prefs:data.prefs||{},modifiedAt:data.modifiedAt||0});
  }
  /* News translations share the existing Drive manifest; each record is a small string,
     never a token, source HTML, API key or audio file. Timestamps merge devices. */
  async function pullNewsTranslations(){ensureAuthorized();const remote=await getManifest(true);return remote.newsTranslations||{};}
  async function flushNewsTranslations(){
    ensureAuthorized();if(syncLock)await syncLock;
    const pending=Object.entries(pendingNewsTranslations);if(!pending.length)return 0;
    const data=await getManifest(true);data.newsTranslations=data.newsTranslations||{};
    let count=0;
    for(const [key,record] of pending){
      if(!/^[a-f0-9]{64}$/.test(key)||!record?.vi||String(record.vi).length>5500)continue;
      if(!data.newsTranslations[key]||(record.updatedAt||0)>=(data.newsTranslations[key].updatedAt||0)){
        data.newsTranslations[key]={vi:String(record.vi),updatedAt:record.updatedAt||Date.now()};count++;
      }
    }
    if(Object.keys(data.newsTranslations).length>3200){
      const entries=Object.entries(data.newsTranslations).sort((a,b)=>(b[1]?.updatedAt||0)-(a[1]?.updatedAt||0)).slice(0,3200);
      data.newsTranslations=Object.fromEntries(entries);
    }
    data.modifiedAt=Date.now();
    const blob=new Blob([JSON.stringify(data)],{type:'application/json'});
    if(dataId)await uploadBytes(dataId,blob,'application/json');else dataId=await saveNewFile(DATA_NAME,blob,'application/json');
    manifest=data;
    for(const [key,record] of pending)if(pendingNewsTranslations[key]===record)delete pendingNewsTranslations[key];
    return count;
  }
  function queueNewsTranslation(key,record){
    if(!/^[a-f0-9]{64}$/.test(String(key))||!record?.vi)return;
    pendingNewsTranslations[key]={vi:String(record.vi).slice(0,5500),updatedAt:record.updatedAt||Date.now()};
    if(!isSignedIn())return;
    clearTimeout(newsSyncTimer);
    newsSyncTimer=setTimeout(()=>flushNewsTranslations().catch(e=>status('Bản dịch báo chưa lên Drive: '+asError(e))),2200);
  }
  function bookRecord(b){
    const fields=['id','name','title','type','author','chapterCount','size','added','lastModified','cloudFile'];
    const out={};for(const f of fields)if(b[f]!==undefined)out[f]=b[f];
    out.id=String(b.id);out.cloudFile=!!b.cloudFile;return out;
  }
  function copyState(s){const allowed=['id','chapter','offset','progress','bookmarks','words','lookedUpWords','exerciseStats','annotations','translations','translationVisibility','chapterTranslationVisibility','meaningOverrides','partOfSpeechOverrides','updatedAt'];
    const data={};for(const key of allowed)if(s[key]!==undefined)data[key]=s[key];return data;}
  function mergeList(a,b,keyFn){const map=new Map();for(const item of [...(a||[]),...(b||[])])if(item){const key=keyFn(item);if(!map.has(key)||(item.created||0)>(map.get(key).created||0))map.set(key,item);}return [...map.values()];}
  // V25.1: do not discard a newly-created flashcard when an older device
  // still has a matching vocabulary entry with the same `created` timestamp.
  function mergeWordEntries(a,b){
    const map=new Map();
    for(const item of [...(a||[]),...(b||[])]){
      if(!item)continue;
      const key=[item.kind,item.source,item.context,item.chapter].join('|');
      const prior=map.get(key);
      if(!prior){map.set(key,item);continue;}
      const newer=(item.updatedAt||item.created||0)>(prior.updatedAt||prior.created||0)?item:prior;
      const older=newer===item?prior:item;
      const cf=(item.flashcard?.savedAt||0)>=(prior.flashcard?.savedAt||0)?item.flashcard:prior.flashcard;
      map.set(key,{...older,...newer,...(cf?{flashcard:cf}:{})});
    }
    return [...map.values()];
  }
  function mergeAnnotations(a,b){
    const entries=new Map();for(const item of [...(a||[]),...(b||[])]){
      if(!item?.id)continue;const prior=entries.get(item.id);
      if(!prior||(item.updatedAt||0)>(prior.updatedAt||0))entries.set(item.id,item);
    }return [...entries.values()];
  }
  function mergeLookupHistory(a,b){
    const map=new Map();
    for(const entry of [...(a||[]),...(b||[])]){
      if(!entry?.text)continue;
      const key=String(entry.text).toLocaleLowerCase().trim();
      if(!key)continue;
      const prior=map.get(key);
      if(!prior || (entry.lastAt||0)>(prior.lastAt||0))map.set(key,entry);
    }
    return [...map.values()].sort((a,b)=>(b.lastAt||0)-(a.lastAt||0)).slice(0,800);
  }
  function mergeStates(a,b){
    if(!a)return b;if(!b)return a;
    const newer=(a.updatedAt||0)>=(b.updatedAt||0)?a:b, older=newer===a?b:a;
    return {...older,...newer,bookmarks:mergeList(a.bookmarks,b.bookmarks,x=>(x.chapter||0)+'|'+(x.offset||0)),
      words:mergeWordEntries(a.words,b.words),
      lookedUpWords:mergeLookupHistory(a.lookedUpWords,b.lookedUpWords),
      exerciseStats:{...(older.exerciseStats||{}),...(newer.exerciseStats||{})},
      annotations:mergeAnnotations(a.annotations,b.annotations),
      translations:{...(older.translations||{}),...(newer.translations||{})},
      translationVisibility:{...(older.translationVisibility||{}),...(newer.translationVisibility||{})},
      chapterTranslationVisibility:{...(older.chapterTranslationVisibility||{}),...(newer.chapterTranslationVisibility||{})},
      meaningOverrides:{...(older.meaningOverrides||{}),...(newer.meaningOverrides||{})},
      partOfSpeechOverrides:{...(older.partOfSpeechOverrides||{}),...(newer.partOfSpeechOverrides||{})}};
  }
  async function start(callbacks={}){
    hooks=callbacks;
    if(!configured){status('Chưa cấu hình Google OAuth Client ID trong drive-config.js. Sách vẫn lưu trên máy.');return;}
    if(!window.google?.accounts?.oauth2){status('Không tải được Google Identity Services. Kiểm tra Internet hoặc trình chặn quảng cáo.');return;}
    tokenClient=google.accounts.oauth2.initTokenClient({client_id:CLIENT_ID,scope:SCOPE,callback:()=>{}});
    status('Đã ghi nhớ tài khoản trên thiết bị (nếu đã kết nối trước đó). Khi cần Drive, bấm Tiếp tục với Google để cấp quyền phiên mới.');
  }
  function loginGoogle({reuse=true}={}){
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
          let remembered=null;try{remembered=JSON.parse(localStorage.getItem('ereader_last_drive_account')||'null');}catch{}
          if(reuse && remembered?.uid && remembered.uid!==uid){accessToken='';expiresAt=0;throw Error('Google đang chọn tài khoản khác với thư viện đã lưu. Nhấn Dùng tài khoản Google khác để chuyển tài khoản chủ động.');}
          profile={uid,email:info.emailAddress||'',displayName:info.displayName||''};
          if(previousUid!==uid){folderId='';audioFolderId='';dataId='';manifest=null;chapterAudioFolders.clear();audioFileIndex=null;audioIndexExpires=0;}
          await hooks.onAuth?.(profile);
          status('Đã kết nối Google Drive: '+profile.email);
          resolve(profile);
        }catch(e){reject(e);}
      };
      try{tokenClient.requestAccessToken({prompt:reuse?'':'select_account'});}catch(e){reject(e);}
    });
  }
  async function logout(){
    if(accessToken&&window.google?.accounts?.oauth2?.revoke)google.accounts.oauth2.revoke(accessToken,()=>{});
    notifyLoggedOut();try{localStorage.removeItem('ereader_last_drive_account');}catch{}status('Đã ngắt kết nối Google Drive. Sách trên thiết bị vẫn còn.');
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
  async function ensureAudioFolder(){
    ensureAuthorized();if(audioFolderId)return audioFolderId;
    const folder=await ensureFolder();
    const records=await listFiles("'"+quote(folder)+"' in parents and name = 'Audio Cache' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    audioFolderId=records[0]?.id||(await makeMetadata('Audio Cache','application/vnd.google-apps.folder',folder)).id;
    return audioFolderId;
  }
  async function findAudioFile(id){
    if(!/^[a-f0-9]{64}$/.test(String(id)))throw Error('Mã âm thanh không hợp lệ.');
    const parent=await ensureAudioFolder();
    if(!audioFileIndex || Date.now()>audioIndexExpires){
      const files=await listFiles("'"+quote(parent)+"' in parents and trashed = false");
      audioFileIndex=new Map(files.map(f=>[f.name,f]));audioIndexExpires=Date.now()+30000;
    }
    return audioFileIndex.get('audio-'+id+'.mp3')||audioFileIndex.get('audio-'+id+'.wav')||null;
  }
  async function downloadAudio(id){
    ensureAuthorized();const file=await findAudioFile(id);if(!file)return null;
    const blob=await downloadBytes(file.id);
    if(!blob?.size)return null;
    return new Blob([blob],{type:file.name.endsWith('.wav')?'audio/wav':'audio/mpeg'});
  }
  async function uploadAudio(record){
    ensureAuthorized();if(!record?.id||!record?.blob?.size)throw Error('Không có âm thanh để tải lên.');
    const id=record.id;
    if(audioUploads.has(id))return audioUploads.get(id);
    const task=(async()=>{
      const found=await findAudioFile(id);
      if(!found||Number(found.size||0)===0){
        const mime=record.blob.type.includes('wav')?'audio/wav':'audio/mpeg';
        const filename='audio-'+id+(mime==='audio/wav'?'.wav':'.mp3');
        const meta=found||await makeMetadata(filename,mime,await ensureAudioFolder());
        await uploadBytes(meta.id,record.blob,mime);
        audioFileIndex?.set(filename,{...meta,name:filename,size:record.blob.size});
      }
      await hooks.markAudioSynced?.(id);
      return true;
    })();
    audioUploads.set(id,task);
    try{return await task;}finally{audioUploads.delete(id);}
  }
  function queueAudio(record){
    if(!isSignedIn())return Promise.resolve(false);
    clearTimeout(audioUploadTimer);
    audioUploadTimer=setTimeout(()=>syncPendingAudio().catch(e=>status('Âm thanh chờ đồng bộ: '+asError(e))),1200);
    return Promise.resolve(true);
  }
  async function syncPendingAudio(){
    ensureAuthorized();
    const rows=await hooks.listPendingAudio?.()||[];
    let uploaded=0;
    for(const row of rows){
      if(!isSignedIn())break;
      try{await uploadAudio(row);uploaded++;}catch(e){status('Chưa tải được âm thanh: '+asError(e));break;}
    }
    if(rows.length>=12 && uploaded===rows.length && isSignedIn())setTimeout(()=>syncPendingAudio().catch(e=>status('Âm thanh còn chờ đồng bộ: '+asError(e))),1800);
    return uploaded;
  }
  // Chapter audiobooks are stored as one WAV under EReader Pro / <chosen subfolder>.
  // drive.file only authorizes folders/files this application created or that the
  // user explicitly opened through a Picker, so we never claim access to arbitrary Drive URLs.
  function cleanAudioFolder(name){
    const value=String(name||'Sách nói').trim().replace(/[\\/]/g,' ').slice(0,80);
    if(!value || value==='.' || value==='..')return 'Sách nói';
    return value;
  }
  async function chapterAudioFolder(name){
    ensureAuthorized();name=cleanAudioFolder(name);
    if(chapterAudioFolders.has(name))return chapterAudioFolders.get(name);
    const parent=await ensureFolder();
    const found=await listFiles("'"+quote(parent)+"' in parents and name = '"+quote(name)+"' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    const id=found[0]?.id||(await makeMetadata(name,'application/vnd.google-apps.folder',parent)).id;
    chapterAudioFolders.set(name,id);return id;
  }
  async function findChapterAudio(id,folder){
    if(!/^[a-f0-9]{64}$/.test(String(id)))throw Error('Mã audio chương không hợp lệ.');
    const parent=await chapterAudioFolder(folder);
    const name='chapter-'+id+'.wav';
    const files=await listFiles("'"+quote(parent)+"' in parents and name = '"+name+"' and trashed = false");
    return files[0]||null;
  }
  async function downloadChapterAudio(id,folder){
    ensureAuthorized();const file=await findChapterAudio(id,folder);
    if(!file)return null;
    const blob=await downloadBytes(file.id);
    return blob?.size?new Blob([blob],{type:'audio/wav'}):null;
  }
  function audioAppProperties(record){
    const safe=(v)=>{
      let value='';
      for(const ch of String(v||'')){
        if(new TextEncoder().encode(value+ch).length>115)break;
        value+=ch;
      }
      return value;
    };
    return {bookId:safe(record.bookId),bookTitle:safe(record.bookTitle||record.name||''),
      chapterTitle:safe(record.chapterTitle),chapterNumber:String(Number(record.chapter||0)+1),
      voice:safe(record.voice),provider:safe(record.provider),format:'ereader-v24.6'};
  }
  async function createChapterResumable(name,blob,parent,existingId=null,record=null){
    const target=existingId?UPLOAD+'/'+encode(existingId)+'?uploadType=resumable&fields=id,name,size':UPLOAD+'?uploadType=resumable&fields=id,name,size';
    const response=await fetch(target,{
      method:existingId?'PATCH':'POST',headers:{'Authorization':'Bearer '+accessToken,'Content-Type':'application/json; charset=UTF-8',
        'X-Upload-Content-Type':'audio/wav','X-Upload-Content-Length':String(blob.size)},
      body:JSON.stringify({name,mimeType:'audio/wav',...(record?{appProperties:audioAppProperties(record)}:{}),...(existingId?{}:{parents:[parent]})})
    });
    if(!response.ok){let error='';try{error=(await response.json()).error?.message||'';}catch{}
      throw Error('Google Drive không tạo được phiên tải lên ('+response.status+'): '+error);}
    const location=response.headers.get('Location');
    if(!location)throw Error('Google Drive không trả địa chỉ tải lên tệp lớn. Vui lòng kiểm tra trình duyệt và quyền Drive.');
    return location;
  }
  async function uploadChapterAudio(record,folder='Sách nói'){
    ensureAuthorized();
    if(!record?.id||!record.blob?.size)throw Error('Chưa có file audio chương.');
    if(record.blob.size>=4*1024*1024*1024)throw Error('File vượt giới hạn WAV 4GB.');
    const existing=await findChapterAudio(record.id,folder);
    if(existing?.size&&Number(existing.size)===record.blob.size){
      if(record.bookTitle && !existing.appProperties?.bookTitle){
        await request(API+'/'+encode(existing.id)+'?fields=id,appProperties',{
          method:'PATCH',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({appProperties:audioAppProperties(record)})
        }).catch(()=>{});
      }
      return true;
    }
    const parent=await chapterAudioFolder(folder);
    const location=await createChapterResumable('chapter-'+record.id+'.wav',record.blob,parent,existing?.id||null,record);
    const response=await fetch(location,{method:'PUT',headers:{'Content-Type':'audio/wav'},body:record.blob});
    if(!response.ok)throw Error('Google Drive không nhận đủ file audio ('+response.status+'). Hãy thử tải lại.');
    return true;
  }
  // V24.7: optional Word export upload. Files are app-created and stay in EReader Pro.
  async function uploadExportedWord(name,blob){
    ensureAuthorized();
    if(!blob?.size)throw Error('Chưa có Word để tải lên.');
    if(blob.size>20*1024*1024)throw Error('Tệp Word vượt 20MB. Hãy tải về máy hoặc xuất theo từng chương.');
    const parent=await chapterAudioFolder('Bản dịch Word');
    const safeName=String(name||'Ban dich.docx').replace(/[\/]/g,' ').slice(0,160);
    const mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const metadata=await makeMetadata(safeName,mime,parent);
    await uploadBytes(metadata.id,blob,mime);
    return metadata.id;
  }
  async function listChapterAudios(folder='Sách nói'){
    ensureAuthorized();
    const parent=await chapterAudioFolder(folder);
    const files=await listFiles("'"+quote(parent)+"' in parents and trashed = false");
    return files.filter(f=>/^chapter-[a-f0-9]{64}\.wav$/i.test(f.name)).map(f=>({
      id:f.name.slice(8,-4),fileId:f.id,name:f.name,size:Number(f.size||0),
      modifiedTime:f.modifiedTime||'',bookId:f.appProperties?.bookId||'',
      bookTitle:f.appProperties?.bookTitle||'',chapterTitle:f.appProperties?.chapterTitle||'',
      chapter:Number(f.appProperties?.chapterNumber||0)-1,
      voice:f.appProperties?.voice||'',provider:f.appProperties?.provider||'',
      webUrl:'https://drive.google.com/file/d/'+encode(f.id)+'/view'
    }));
  }
  async function downloadChapterAudioByFileId(fileId,folder='Sách nói'){
    ensureAuthorized();
    const records=await listChapterAudios(folder);
    const found=records.find(f=>f.fileId===fileId);
    if(!found)throw Error('Không tìm thấy file audio trong thư mục EReader Pro được cấp quyền.');
    const blob=await downloadBytes(fileId);
    return new Blob([blob],{type:'audio/wav'});
  }
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
      remote.newsTranslations=remote.newsTranslations||{};
      for(const [key,record] of Object.entries(pendingNewsTranslations))if(!remote.newsTranslations[key]||(record.updatedAt||0)>=(remote.newsTranslations[key].updatedAt||0))remote.newsTranslations[key]=record;
      remote.modifiedAt=Date.now();
      const payload=JSON.stringify(remote);
      if(new TextEncoder().encode(payload).length>27*1024*1024)throw Error('Dữ liệu bản dịch trên Drive vượt 27 MB, hãy sao lưu rồi chia thư viện.');
      const blob=new Blob([payload],{type:'application/json'});
      if(dataId)await uploadBytes(dataId,blob,'application/json');
      else dataId=await saveNewFile(DATA_NAME,blob,'application/json');
      manifest=remote;dirty=false;
      for(const key of Object.keys(pendingNewsTranslations))delete pendingNewsTranslations[key];
      for(const c of (local.sentenceCache||[]))if(c.translation)await hooks.markSentenceSynced?.(c);
      const newAudio=await syncPendingAudio().catch(e=>{status('Âm thanh đang chờ đồng bộ: '+asError(e));return 0;});
      await hooks.onRefresh?.();
      return 'Đã đồng bộ Google Drive: '+Object.keys(remote.books).length+' sách, '+Object.keys(remote.sentences).length+' bản dịch'+(uploads?' · '+uploads+' tệp sách mới':'')+(newAudio?' · '+newAudio+' tệp âm thanh':'')+(errors.length?' · chưa tải: '+errors.join('; '):'')+'.';
    })();
    try{return await syncLock;}finally{syncLock=null;}
  }
  window.EReaderCloud={isConfigured:()=>configured,isSignedIn,getUid,loginGoogle,logout,start,pullLibrary,pullPreferences,
    pullChapterTranslations,findSentence,pullNewsTranslations,queueNewsTranslation,flushNewsTranslations,queuePreferences,queueBookState,queueSentence,queueBook,setSyncBooks,downloadBook,downloadAudio,uploadAudio,downloadChapterAudio,downloadChapterAudioByFileId,listChapterAudios,uploadChapterAudio,uploadExportedWord,queueAudio,syncPendingAudio,syncNow};
})();
