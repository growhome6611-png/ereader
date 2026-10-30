'use strict';
/* E-Reader Pro: đọc toàn bộ EPUB, Word DOCX, lưu ở trình duyệt, không sử dụng máy chủ. */
const $ = (id) => document.getElementById(id);
const STORE = 'ereader_settings_v6';
const DEFAULT_SETTINGS = {theme:'light',fontSize:19,lineHeight:1.8,font:'serif',source:'auto',target:'vi',pronunciationAccent:'both',rate:1,voice:'',ttsEngine:'device',ttsLanguage:'auto',cloudVoice:''};
const GOOGLE_KEY_STORE = 'ereader_google_translate_api_key_v1';
const GOOGLE_TTS_KEY_STORE = 'ereader_google_cloud_tts_key_v11';
let googleTtsKey = '';
try { googleTtsKey = localStorage.getItem(GOOGLE_TTS_KEY_STORE) || ''; } catch {}
let googleTranslateKey = '';
try {googleTranslateKey = localStorage.getItem(GOOGLE_KEY_STORE) || '';}catch {}
let settings;
try { settings = {...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORE) || '{}')}; }
catch { settings = {...DEFAULT_SETTINGS}; }
let dbPromise = null;
let currentBook = null;
let currentIndex = 0;
let currentState = null;
let savedBooks = [];
let activeTab = 'library';
let selectedText = '';
let selectedLookupInfo=null;
let latestTranslation = '';
let lookupToken=0;
let lookupSnapshot=null;
let readerPointerStart=null;
const dictionaryRequests=new Map();
const lookupRequests=new Map();
const DICTIONARY_STORE='ereader_dictionary_english_v12';
const LEXICAL_STORE='ereader_lexical_en_v13';
const RELATED_EXAMPLES_STORE='ereader_related_examples_v14';
const DICTIONARY_DEFINITIONS_VI_STORE='ereader_definition_english_vietnamese_v16';
let dictionaryDefinitionsVi={};
try{dictionaryDefinitionsVi=JSON.parse(localStorage.getItem(DICTIONARY_DEFINITIONS_VI_STORE)||'{}')||{};}catch{}
const dictionaryDefinitionRequests=new Map();

const relatedExampleRequests=new Map();
let relatedExampleSaved={};
try{relatedExampleSaved=JSON.parse(localStorage.getItem(RELATED_EXAMPLES_STORE)||'{}')||{};}catch{}

const lexicalRequests=new Map();
let lexicalSaved={};
try {lexicalSaved=JSON.parse(localStorage.getItem(LEXICAL_STORE)||'{}')||{};}catch{}
let dictionarySaved={};
try {dictionarySaved=JSON.parse(localStorage.getItem(DICTIONARY_STORE)||'{}')||{};}catch{}
let speech = {speaking:false, paused:false, chunks:[], index:0, token:0, mode:'device', controller:null, url:null};
const CLOUD_VOICES={
  vi:[{name:'vi-VN-Neural2-A',label:'Nữ · Neural2 A'},{name:'vi-VN-Neural2-D',label:'Nam · Neural2 D'},{name:'vi-VN-Chirp3-HD-Kore',label:'Nữ · Chirp 3 HD Kore'},{name:'vi-VN-Chirp3-HD-Puck',label:'Nam · Chirp 3 HD Puck'}],
  en:[{name:'en-US-Neural2-F',label:'Nữ · Neural2 F'},{name:'en-US-Neural2-J',label:'Nam · Neural2 J'},{name:'en-US-Chirp3-HD-Kore',label:'Nữ · Chirp 3 HD Kore'},{name:'en-US-Chirp3-HD-Puck',label:'Nam · Chirp 3 HD Puck'}]
};

let saveTimer = null;
let stateWriteQueue=Promise.resolve();
const sentenceTranslationInFlight=new Map();
let toastTimer = null;
const imgObjectUrls = new Map();

function notify(message, duration=3500) {
  const el = $('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.hidden = true, duration);
}
function busy(message, visible=true) { $('busyText').textContent = message; $('busyMask').hidden = !visible; }
function shortText(value,max=80) { const s=String(value||'').trim().replace(/\s+/g,' '); return s.length>max?s.slice(0,max-1)+'…':s; }
function fileType(name) { const ext=(name||'').split('.').pop().toLowerCase(); return ext==='epub'?'epub':ext==='docx'?'docx':null; }
function setNodeText(id,value) { $(id).textContent = value == null ? '' : String(value); }
function safeJSONSave(key,value) { try {localStorage.setItem(key,JSON.stringify(value));}catch {} }
function saveSettings() {safeJSONSave(STORE, settings);}
function makeId(file) { // Khóa ổn định khi mở lại cùng tệp; nội dung không được truyền ra mạng.
  const raw = `${file.name}|${file.size}|${file.lastModified}`;
  let h=2166136261;
  for (let i=0;i<raw.length;i++){h^=raw.charCodeAt(i);h=Math.imul(h,16777619);}
  return 'bk_'+(h>>>0).toString(16)+'_'+file.size;
}

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve,reject) => {
    if (!window.indexedDB) {reject(new Error('Trình duyệt không hỗ trợ lưu sách'));return;}
    const request=indexedDB.open('PrivateEReaderBooks',3);
    request.onupgradeneeded=()=>{
      const d=request.result;
      if(!d.objectStoreNames.contains('books'))d.createObjectStore('books',{keyPath:'id'});
      if(!d.objectStoreNames.contains('states'))d.createObjectStore('states',{keyPath:'id'});
      if(!d.objectStoreNames.contains('sentenceCache')){
        const cache=d.createObjectStore('sentenceCache',{keyPath:'key'});
        cache.createIndex('bookChapter','bookChapter',{unique:false});
        cache.createIndex('textKey','textKey',{unique:false});
      }
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error || new Error('Lỗi bộ nhớ'));
  });
  return dbPromise;
}
async function dbOperation(storeName, mode, operation) {
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    let txn;
    try { txn=db.transaction(storeName,mode); } catch(e){reject(e);return;}
    const store=txn.objectStore(storeName);
    let result;
    let req;
    try {req=operation(store);} catch(e){reject(e);return;}
    if(req && typeof req.onsuccess!=='undefined') {req.onsuccess=()=>{result=req.result;};req.onerror=()=>reject(req.error);}
    txn.oncomplete=()=>resolve(result);
    txn.onerror=()=>reject(txn.error);
    txn.onabort=()=>reject(txn.error);
  });
}
const dbGet = (store,id) => dbOperation(store,'readonly',s=>s.get(id));
const dbAll = (store) => dbOperation(store,'readonly',s=>s.getAll());
const dbPut = (store,record) => dbOperation(store,'readwrite',s=>s.put(record));
const dbRemove = (store,id) => dbOperation(store,'readwrite',s=>s.delete(id));
async function getBookState(id) {
  try {return (await dbGet('states',id))||newState(id);} catch {try{return JSON.parse(localStorage.getItem('state_'+id))||newState(id);}catch{return newState(id);}}
}
function newState(id){return{id,chapter:0,offset:0,progress:0,bookmarks:[],words:[],translations:{},translationVisibility:{},lookupCache:{},meaningOverrides:{},partOfSpeechOverrides:{},updatedAt:Date.now()};}
// Serialize book-state writes: an older scroll snapshot must never overwrite a newer translation.
async function persistState() {
  if(!currentBook||!currentState)return;
  const snapshot=JSON.parse(JSON.stringify(currentState));
  stateWriteQueue=stateWriteQueue.catch(()=>{}).then(async()=>{
    try {await dbPut('states',snapshot);}
    catch (err){
      try {localStorage.setItem('state_'+snapshot.id,JSON.stringify(snapshot));}
      catch {throw new Error('Không lưu được dữ liệu đọc trên thiết bị. Hãy kiểm tra dung lượng bộ nhớ trình duyệt.');}
    }
  });
  return stateWriteQueue;
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer=setTimeout(()=>{persistState().catch(e=>notify(e.message,6500));},380); }

// V17: cache bản dịch độc lập với tiến độ đọc. Nội dung gốc + chiều dịch xác định
// một bản dịch; sách/chương xác định trạng thái hiện/ẩn. Không đưa nội dung lên server.
function normalizedSentence(text){return String(text||'').replace(/\s+/gu,' ').trim();}
function sentenceCacheIdentity(bookId,chapter,text,source=settings.source,target=settings.target){
  return {
    key:JSON.stringify([bookId,chapter,source,target,normalizedSentence(text)]),
    bookChapter:JSON.stringify([bookId,chapter,source,target]),
    textKey:JSON.stringify([source,target,normalizedSentence(text)])
  };
}
async function readChapterSentenceCache(bookId,chapter){
  const filter=JSON.stringify([bookId,chapter,settings.source,settings.target]);
  try {return await dbOperation('sentenceCache','readonly',s=>s.index('bookChapter').getAll(filter));}
  catch {return [];}
}
async function readCachedSentenceByText(identity){
  try {return await dbOperation('sentenceCache','readonly',s=>s.index('textKey').get(identity.textKey));}
  catch {return null;}
}
async function saveSentenceCache(identity,translation,visible){
  const record={...identity,translation,visible:!!visible,updatedAt:Date.now()};
  return dbPut('sentenceCache',record);
}

function normalizeZipPath(path) {
  let raw=String(path||'').split('#')[0].split('?')[0].replace(/\\/g,'/');
  try{raw=decodeURIComponent(raw);}catch {}
  const parts=[];
  for(const p of raw.split('/')){if(!p||p==='.')continue;if(p==='..')parts.pop();else parts.push(p);}
  return parts.join('/');
}
function relativeZipPath(base,relative) {return normalizeZipPath(base.slice(0,base.lastIndexOf('/')+1)+relative);}
function getElementsByLocalName(doc, name) {return [...doc.getElementsByTagName('*')].filter(n=>n.localName===name);}
function firstLocal(node,name) {return getElementsByLocalName(node,name)[0]||null;}
function titleFromBody(html,fallback) {
  const template=document.createElement('template');template.innerHTML=html;
  const heading=template.content.querySelector('h1,h2,h3,h4');
  return shortText(heading?.textContent||fallback,120);
}
function textFromHtml(html) {
  const template=document.createElement('template');template.innerHTML=html;
  const chunks=[];
  const blocks=new Set(['P','DIV','H1','H2','H3','H4','H5','H6','LI','UL','OL','BLOCKQUOTE','TR','TD','TH','BR','HR','SECTION','ARTICLE']);
  function walk(node) {
    if(node.nodeType===3){chunks.push(node.textContent);return;}
    if(node.nodeType!==1 && node.nodeType!==11)return;
    const block=blocks.has(node.nodeName);
    if(block)chunks.push(' ');
    for(const child of node.childNodes)walk(child);
    if(block)chunks.push(' ');
  }
  walk(template.content);
  return chunks.join('').replace(/\s+/g,' ').trim();
}
function sanitize(html) {
  if(!window.DOMPurify) throw new Error('Chưa tải được thư viện bảo vệ nội dung. Hãy kết nối mạng và tải lại trang.');
  return DOMPurify.sanitize(html,{
    USE_PROFILES:{html:true},
    FORBID_TAGS:['script','iframe','form','input','button','style','link','meta','object','embed','video','audio','svg','math','base'],
    FORBID_ATTR:['style','srcset','autofocus']
  });
}
function parseXhtmlBody(raw) {
  // EPUB XHTML thường có định dạng XML. Parser HTML tương thích cả XHTML lẫn HTML không chuẩn.
  const doc=new DOMParser().parseFromString(raw,'text/html');
  const body=doc.body;
  if (!body) return '';
  return sanitize(body.innerHTML);
}

async function parseEpub(buffer,name) {
  if(!window.JSZip) throw new Error('Thiếu thư viện đọc EPUB (JSZip). Hãy kết nối mạng và tải lại trang.');
  const zip=await JSZip.loadAsync(buffer);
  const container=zip.file('META-INF/container.xml');
  if(!container)throw new Error('Tệp EPUB thiếu META-INF/container.xml');
  const containerDoc=new DOMParser().parseFromString(await container.async('string'),'application/xml');
  const rootfile=firstLocal(containerDoc,'rootfile');
  const opfPath=normalizeZipPath(rootfile?.getAttribute('full-path')||'');
  const opfFile=zip.file(opfPath);
  if(!opfFile)throw new Error('Không tìm thấy tệp cấu trúc OPF trong EPUB');
  const opf=new DOMParser().parseFromString(await opfFile.async('string'),'application/xml');
  if(opf.querySelector('parsererror')) throw new Error('Tệp cấu trúc EPUB không hợp lệ');
  const metadata=firstLocal(opf,'metadata');
  const metadataTitle=metadata?firstLocal(metadata,'title')?.textContent?.trim():null;
  const author=metadata?firstLocal(metadata,'creator')?.textContent?.trim():'';
  const title=metadataTitle||name.replace(/\.epub$/i,'');
  const manifest=new Map();
  for (const item of getElementsByLocalName(opf,'item')) {
    const id=item.getAttribute('id');
    const href=item.getAttribute('href');
    if(id&&href)manifest.set(id,{id,path:relativeZipPath(opfPath,href),type:item.getAttribute('media-type')||'',properties:item.getAttribute('properties')||''});
  }
  const spine=firstLocal(opf,'spine');
  if(!spine)throw new Error('EPUB không có danh sách chương (spine)');
  const chapters=[];
  const spineRefs=[...spine.children].filter(n=>n.localName==='itemref');
  for(let n=0;n<spineRefs.length;n++){
    const ref=spineRefs[n];
    const file=manifest.get(ref.getAttribute('idref'));
    if(!file)continue;
    const zipFile=zip.file(file.path);
    if(!zipFile)continue;
    // Không giới hạn 5 chương như phiên bản gốc: đọc toàn bộ spine.
    const html=parseXhtmlBody(await zipFile.async('string'));
    if(!html.trim())continue;
    chapters.push({path:file.path,title:titleFromBody(html,`Phần ${chapters.length+1}`),html,plain:textFromHtml(html)});
  }
  if(!chapters.length)throw new Error('Không tìm thấy nội dung chương nào trong EPUB');
  // Phục hồi nhãn mục lục chuẩn EPUB3 (nav.xhtml) hoặc EPUB2 (toc.ncx).
  const navFile=[...manifest.values()].find(m=>m.properties.split(/\s+/).includes('nav'));
  const labelByPath=new Map();
  if(navFile && zip.file(navFile.path)){
    try{
      const doc=new DOMParser().parseFromString(await zip.file(navFile.path).async('string'),'text/html');
      const nav=[...doc.querySelectorAll('nav')].find(n=>(n.getAttribute('epub:type')||'').split(/\s+/).includes('toc') || n.getAttribute('role')==='doc-toc')||doc.querySelector('nav');
      for(const a of (nav?.querySelectorAll('a[href]')||[])){
        const path=relativeZipPath(navFile.path,a.getAttribute('href'));
        if(!labelByPath.has(path))labelByPath.set(path,shortText(a.textContent,140));
      }
    }catch {}
  }
  if(!labelByPath.size){
    const ncx=[...manifest.values()].find(m=>m.type==='application/x-dtbncx+xml');
    if(ncx && zip.file(ncx.path)){
      try{
        const doc=new DOMParser().parseFromString(await zip.file(ncx.path).async('string'),'application/xml');
        for (const np of getElementsByLocalName(doc,'navPoint')){
          const label=firstLocal(np,'text')?.textContent?.trim();
          const src=firstLocal(np,'content')?.getAttribute('src');
          if(src&&label){const path=relativeZipPath(ncx.path,src);if(!labelByPath.has(path))labelByPath.set(path,shortText(label,140));}
        }
      }catch {}
    }
  }
  for(const chapter of chapters){ const label=labelByPath.get(chapter.path);if(label)chapter.title=label; }
  return {kind:'epub',title,author,chapters,zip};
}

async function parseWord(buffer,name) {
  if(!window.mammoth)throw new Error('Thiếu thư viện đọc Word. Hãy kết nối mạng và tải lại trang.');
  const result=await mammoth.convertToHtml({arrayBuffer:buffer},{
    styleMap:["p[style-name='Title'] => h1:fresh","p[style-name='Heading 1'] => h1:fresh","p[style-name='Heading 2'] => h2:fresh","p[style-name='Heading 3'] => h3:fresh"],
    convertImage:mammoth.images.imgElement(async image=>({src:`data:${image.contentType};base64,${await image.read('base64')}`}))
  });
  const cleaned=sanitize(result.value);
  const template=document.createElement('template');template.innerHTML=cleaned;
  const nodes=[...template.content.childNodes].filter(n=>n.nodeType===1||n.textContent?.trim());
  const chunks=[];
  let part=[];let chars=0;let chapterName='Mở đầu';let count=0;
  function flush(){
    if(!part.length)return;
    const html=part.join('');
    if(textFromHtml(html).trim()){chunks.push({path:`word/${chunks.length}`,title:chapterName==='Mở đầu'&&chunks.length?`Phần ${chunks.length+1}`:chapterName,html,plain:textFromHtml(html)});}
    part=[];chars=0;
  }
  for(const node of nodes){
    const tag=node.nodeType===1?node.tagName.toLowerCase():'';
    const content=node.nodeType===1?node.outerHTML:`<p>${node.textContent.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</p>`;
    const length=(node.textContent||'').length;
    if((tag==='h1'||tag==='h2')&&part.length){flush();chapterName=shortText(node.textContent,130)||`Chương ${++count}`;}
    else if(tag==='h1'||tag==='h2') chapterName=shortText(node.textContent,130)||'Chương mới';
    else if(chars>15000 && part.length){flush();if(chapterName==='Mở đầu')chapterName=`Phần ${chunks.length+1}`;}
    part.push(content);chars+=length;
  }
  flush();
  if(!chunks.length)throw new Error('Word không chứa nội dung đọc được (tệp quét ảnh không hỗ trợ OCR).');
  return {kind:'docx',title:name.replace(/\.docx$/i,''),author:'',chapters:chunks};
}

async function buildBook(file) {
  const kind=fileType(file.name);
  if(!kind)throw new Error('Định dạng được hỗ trợ: EPUB và Word .docx. Tệp .doc cũ cần chuyển sang .docx trước.');
  if(file.size>160*1024*1024)throw new Error('Tệp vượt 160 MB, có thể làm trình duyệt thiếu bộ nhớ.');
  const buffer=await file.arrayBuffer();
  const book=kind==='epub'?await parseEpub(buffer,file.name):await parseWord(buffer,file.name);
  book.id=makeId(file);book.fileName=file.name;book.fileSize=file.size;book.lastModified=file.lastModified;
  return book;
}
function revokeImageUrls(){for(const url of imgObjectUrls.values())URL.revokeObjectURL(url);imgObjectUrls.clear();}
async function replaceEpubImages(container,chapter){
  const imgs=[...container.querySelectorAll('img[src]')];
  for(const image of imgs){
    const src=image.getAttribute('src')||'';
    if(/^(data:|blob:)/i.test(src))continue;
    if(/^(https?:|javascript:|\/\/)/i.test(src)){image.removeAttribute('src');continue;}
    const path=relativeZipPath(chapter.path,src);
    let objectURL=imgObjectUrls.get(path);
    if(!objectURL){
      const zf=currentBook.zip.file(path);
      if(!zf){image.removeAttribute('src');continue;}
      const bytes=await zf.async('uint8array');
      const ext=path.split('.').pop().toLowerCase();
      const mime={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',bmp:'image/bmp',svg:'image/svg+xml'}[ext];
      // SVG có thể chứa nội dung chủ động: không hiển thị trực tiếp từ sách không tin cậy.
      if(!mime||ext==='svg'){image.removeAttribute('src');continue;}
      objectURL=URL.createObjectURL(new Blob([bytes],{type:mime}));imgObjectUrls.set(path,objectURL);
    }
    image.src=objectURL;
    image.loading='lazy';
    image.alt=image.alt||'Hình minh họa';
  }
}
function bindChapterLinks(container,chapter){
  container.querySelectorAll('a[href]').forEach(anchor=>{
    const href=anchor.getAttribute('href')||'';
    if(/^https?:\/\//i.test(href)){anchor.target='_blank';anchor.rel='noopener noreferrer';return;}
    if(/^(javascript:|data:|file:|blob:|\/\/)/i.test(href)){anchor.removeAttribute('href');return;}
    anchor.addEventListener('click',event=>{
      event.preventDefault();
      const [rel,fragment]=href.split('#');
      const target=rel?relativeZipPath(chapter.path,rel):chapter.path;
      const index=currentBook.chapters.findIndex(c=>c.path===target);
      if(index<0){notify('Không tìm thấy vị trí liên kết trong sách.');return;}
      displayChapter(index,0).then(()=>{
        if(fragment){
          let frag=fragment;try{frag=decodeURIComponent(fragment);}catch{}
          const idElement=[...$('readerContent').querySelectorAll('[id]')].find(el=>el.id===frag);
          if(idElement)idElement.scrollIntoView({block:'start'});
        }
      }).catch(e=>notify(e.message));
    });
  });
}

async function importFiles(fileList){
  const files=Array.from(fileList||[]);
  if(!files.length)return;
  let imported=0;
  for(const file of files){
    busy(`Đang mở: ${shortText(file.name,45)}`);
    try{
      const book=await buildBook(file);
      const record={id:book.id,name:file.name,title:book.title,type:book.kind,file,size:file.size,added:Date.now(),author:book.author,chapterCount:book.chapters.length};
      let persisted=true;
      try{await dbPut('books',record);}catch(err){persisted=false;notify('Không lưu được vào thiết bị; sách vẫn có thể đọc trong phiên này.',5500);}
      if(!savedBooks.some(b=>b.id===book.id))savedBooks.unshift(record);
      const state=await getBookState(book.id);
      await useBook(book,state);
      if(!persisted) $('storageLabel').textContent='(không lưu được)';
      imported++;
    }catch(e){console.error(e);notify(`${shortText(file.name,32)}: ${e.message}`,6500);}
    finally{busy('',false);}
  }
  renderLibrary();
  if(imported)notify(`Đã mở ${imported} cuốn sách. Chúc bạn đọc vui!`);
}
async function openFromLibrary(id){
  if(currentBook?.id===id){setTab('toc');closeDrawer();return;}
  busy('Đang mở lại cuốn sách…');
  try{
    const record=await dbGet('books',id);
    if(!record?.file)throw new Error('Không tìm thấy tệp sách trong bộ nhớ trình duyệt.');
    const book=await buildBook(record.file);
    book.id=id;
    const state=await getBookState(id);
    await useBook(book,state);
    closeDrawer();
  }catch(e){console.error(e);notify('Không thể mở sách: '+e.message,6000);}
  finally{busy('',false);}
}
async function useBook(book,state){
  stopSpeech();
  clearTimeout(saveTimer);
  if(currentBook && currentState)await persistState().catch(()=>{});
  revokeImageUrls();
  currentBook=book;
  currentState={...newState(book.id),...state};
  if(!Array.isArray(currentState.bookmarks))currentState.bookmarks=[];
  if(!Array.isArray(currentState.words))currentState.words=[];
  if(!currentState.translations || typeof currentState.translations!=='object' || Array.isArray(currentState.translations))currentState.translations={};
  if(!currentState.translationVisibility || typeof currentState.translationVisibility!=='object' || Array.isArray(currentState.translationVisibility))currentState.translationVisibility={};
  if(!currentState.lookupCache || typeof currentState.lookupCache!=='object' || Array.isArray(currentState.lookupCache))currentState.lookupCache={};
  if(!currentState.meaningOverrides || typeof currentState.meaningOverrides!=='object' || Array.isArray(currentState.meaningOverrides))currentState.meaningOverrides={};
  if(!currentState.partOfSpeechOverrides || typeof currentState.partOfSpeechOverrides!=='object' || Array.isArray(currentState.partOfSpeechOverrides))currentState.partOfSpeechOverrides={};
  lookupToken++;lookupSnapshot=null;
  $('welcomeScreen').hidden=true;$('readerView').hidden=false;
  setNodeText('readerTitle',book.title);
  setNodeText('headerBookTitle',book.title);
  setNodeText('readerFileType',(book.kind==='epub'?'SÁCH EPUB':'TÀI LIỆU WORD')+(book.author?' · '+book.author:''));
  await displayChapter(Math.min(Math.max(0,currentState.chapter),book.chapters.length-1),currentState.offset||0,{quiet:true});
  renderLibrary();renderToc();renderBookmarks();renderWords();
  setTab('toc');
}
async function displayChapter(index,offset=0,{quiet=false}={}){
  if(!currentBook||index<0||index>=currentBook.chapters.length)return;
  stopSpeech();
  lookupToken++;lookupSnapshot=null;
  $('translationModal').hidden=true;
  if(!quiet){currentState.chapter=index;currentState.offset=0;}
  currentIndex=index;
  const chapter=currentBook.chapters[index];
  setNodeText('chapterName',chapter.title);
  const container=document.createElement('div');
  container.className='document-body';
  container.innerHTML=sanitize(chapter.html);
  const reader=$('readerContent');
  reader.replaceChildren(container);
  const cachedSentences=await readChapterSentenceCache(currentBook.id,index);
  prepareSentenceTranslations(container,cachedSentences);
  bindChapterLinks(container,chapter);
  if(currentBook.kind==='epub')await replaceEpubImages(container,chapter);
  $('readingScroller').scrollTop=0;
  // Đợi bố cục hoàn thành, tránh khôi phục vị trí sai sau khi chèn nội dung.
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const sc=$('readingScroller');
  sc.scrollTop=(sc.scrollHeight-sc.clientHeight)*Math.min(1,Math.max(0,offset));
  currentState.chapter=index;
  currentState.offset=Math.min(1,Math.max(0,offset));
  currentState.progress=computeProgress();
  currentState.updatedAt=Date.now();
  updateProgress();updateBookmarkButton();renderToc();scheduleSave();
  selectedText='';selectedLookupInfo=null;$('selectionPanel').hidden=true;
}
function computeProgress(){
  if(!currentBook?.chapters?.length)return 0;
  return Math.min(100,Math.max(0,(currentIndex+(currentState?.offset||0))/currentBook.chapters.length*100));
}
function updateProgress(){
  if(!currentBook)return;
  const p=computeProgress();
  $('progressFill').style.width=p.toFixed(2)+'%';
  $('progressTrack').setAttribute('aria-valuenow',String(Math.round(p)));
  setNodeText('progressText',p.toFixed(1)+'% đã đọc');
  setNodeText('chapterCounter',`${currentIndex+1} / ${currentBook.chapters.length}`);
  $('prevButton').disabled=currentIndex===0;
  $('nextButton').disabled=currentIndex===currentBook.chapters.length-1;
}
async function switchChapter(delta){if(currentBook)await displayChapter(currentIndex+delta,0);}
function updateScrollPosition(){
  if(!currentBook||!currentState)return;
  const sc=$('readingScroller');
  const total=sc.scrollHeight-sc.clientHeight;
  currentState.offset=total>0?Math.min(1,Math.max(0,sc.scrollTop/total)):1;
  currentState.progress=computeProgress();currentState.updatedAt=Date.now();
  updateProgress();scheduleSave();
}
function renderLibrary(){
  const list=$('libraryList');list.replaceChildren();
  if(!savedBooks.length){list.appendChild(emptyNote('Chưa có cuốn sách nào. Nhấn “Thêm sách” để bắt đầu.'));return;}
  for(const book of savedBooks){
    const row=document.createElement('div');row.className='library-entry'+(book.id===currentBook?.id?' active':'');
    const cover=document.createElement('div');cover.className='mini-cover '+book.type;cover.textContent=book.type==='epub'?'▤':'W';
    const details=document.createElement('div');details.className='library-details';
    const title=document.createElement('strong');title.textContent=book.title||book.name;
    const count=document.createElement('small');count.textContent=`${book.type.toUpperCase()} · ${book.chapterCount||'?'} phần`;
    const bar=document.createElement('div');bar.className='mini-progress';
    const fill=document.createElement('div');fill.style.width=(book.id===currentBook?.id?(currentState?.progress||0):(book.progress||0))+'%';bar.appendChild(fill);
    details.append(title,count,bar);row.append(cover,details);
    row.addEventListener('click',()=>openFromLibrary(book.id));
    const del=document.createElement('button');del.className='delete-book';del.textContent='×';del.title='Xóa khỏi thư viện';del.setAttribute('aria-label','Xóa sách');
    del.addEventListener('click',e=>{e.stopPropagation();deleteBook(book.id);});row.append(del);list.append(row);
  }
}
function emptyNote(text){const n=document.createElement('div');n.className='empty-note';n.textContent=text;return n;}
function renderToc(){
  const list=$('tocList');list.replaceChildren();
  if(!currentBook){list.appendChild(emptyNote('Hãy chọn một cuốn sách để xem mục lục.'));return;}
  currentBook.chapters.forEach((chapter,i)=>{
    const b=document.createElement('button');b.className='list-entry'+(i===currentIndex?' active':'');
    const num=document.createElement('small');num.textContent=String(i+1).padStart(2,'0');
    const title=document.createElement('span');title.textContent=chapter.title;
    b.append(num,title);b.addEventListener('click',()=>{displayChapter(i,0).catch(e=>notify(e.message));closeDrawer();});list.append(b);
  });
}
function addBookmark(){
  if(!currentBook)return notify('Hãy mở một cuốn sách trước.');
  const sc=$('readingScroller');
  const at=(sc.scrollHeight-sc.clientHeight)>0?sc.scrollTop/(sc.scrollHeight-sc.clientHeight):0;
  const bookmarks=currentState.bookmarks;
  if(bookmarks.some(b=>b.chapter===currentIndex&&Math.abs(b.offset-at)<.01))return notify('Vị trí này đã được đánh dấu.');
  const item={chapter:currentIndex,offset:at,created:Date.now(),excerpt:shortText(currentBook.chapters[currentIndex].plain.slice(0,95),95)};
  bookmarks.push(item);scheduleSave();renderBookmarks();updateBookmarkButton();notify('Đã lưu dấu trang.');
}
function updateBookmarkButton(){
  const isSaved=!!currentState?.bookmarks?.some(b=>b.chapter===currentIndex&&Math.abs(b.offset-(currentState?.offset||0))<.02);
  $('bookmarkButton').classList.toggle('saved',isSaved);
  $('bookmarkButton').innerHTML=(isSaved?'★ ':'☆ ')+'<span class="hide-small">Dấu trang</span>';
}
function renderBookmarks(){
  const list=$('bookmarkList');list.replaceChildren();
  const marks=currentState?.bookmarks||[];
  if(!marks.length){list.appendChild(emptyNote('Chưa có dấu trang nào trong cuốn sách đang mở.'));return;}
  marks.slice().sort((a,b)=>a.chapter-b.chapter||a.offset-b.offset).forEach(item=>{
    const row=document.createElement('div');row.className='list-entry';
    const text=document.createElement('span');
    const strong=document.createElement('strong');strong.textContent=currentBook.chapters[item.chapter]?.title||`Chương ${item.chapter+1}`;
    const small=document.createElement('small');small.style.display='block';small.textContent=`Vị trí ${Math.round((item.offset||0)*100)}% trong chương`;
    text.append(strong,small);row.append(text);
    row.addEventListener('click',()=>{displayChapter(item.chapter,item.offset||0).catch(e=>notify(e.message));closeDrawer();});
    const del=document.createElement('button');del.textContent='×';del.title='Xóa dấu trang';del.addEventListener('click',e=>{e.stopPropagation();currentState.bookmarks=currentState.bookmarks.filter(b=>b!==item);renderBookmarks();updateBookmarkButton();scheduleSave();});
    row.append(del);list.append(row);
  });
}
function renderWords(){
  const list=$('wordList');list.replaceChildren();const words=currentState?.words||[];
  if(!words.length){list.appendChild(emptyNote('Chạm vào từ để tra, hoặc bôi đen một cụm từ. Từ, cụm từ và câu ví dụ đã lưu sẽ nằm ở đây.'));return;}
  words.slice().reverse().forEach(entry=>{
    const row=document.createElement('div');row.className='list-entry vocab-entry';
    const text=document.createElement('div');text.className='vocab-detail';
    const kind=document.createElement('span');kind.className='vocab-kind';kind.textContent=entry.kind==='sentence'?'CÂU VÍ DỤ':entry.kind==='phrase'?'CỤM TỪ':'TỪ VỰNG';
    const strong=document.createElement('strong');strong.textContent=entry.source;
    const phonetic=document.createElement('small');phonetic.className='vocab-phonetic';
    phonetic.textContent=[entry.phoneticUK?'UK '+entry.phoneticUK:'',entry.phoneticUS?'US '+entry.phoneticUS:'',(!entry.phoneticUK&&!entry.phoneticUS)?entry.phonetic:'',entry.partOfSpeech].filter(Boolean).join(' · ');
    const meaning=document.createElement('span');meaning.className='vocab-meaning';meaning.textContent=(entry.manualMeaning?'✎ ':'')+(entry.translation||'Chưa có bản dịch');
    text.append(kind,strong);if(phonetic.textContent)text.append(phonetic);text.append(meaning);
    if(entry.context && entry.context!==entry.source){
      const ex=document.createElement('span');ex.className='vocab-example';ex.textContent='Trong sách: '+entry.context;text.append(ex);
    }
    row.append(text);
    row.addEventListener('click',e=>{if(e.target.closest('button'))return;closeDrawer();openLookup({text:entry.source,context:entry.context||'',kind:entry.kind,chapter:entry.chapter});});
    const del=document.createElement('button');del.textContent='×';del.title='Xóa mục';del.addEventListener('click',e=>{e.stopPropagation();currentState.words=currentState.words.filter(w=>w!==entry);renderWords();scheduleSave();});
    row.append(del);list.append(row);
  });
}
function exportVocabulary(){
  if(!currentState?.words.length)return notify('Sổ tay chưa có từ vựng để xuất.');
  const quote=s=>{let v=String(s??'');if(/^[\s]*[=+@-]/.test(v))v="'"+v;return '"'+v.replace(/"/g,'""')+'"';};
  const headers=['Loại','Từ / cụm từ / câu','Nghĩa tiếng Việt / dịch','Nghĩa tự chỉnh?','Loại từ','IPA UK','IPA US','IPA (không rõ vùng)','Câu chứa từ / ví dụ','Dạng từ liên quan','Từ đồng nghĩa','Từ trái nghĩa','Nghĩa và ví dụ từ liên quan','Chương','Ngày lưu'];
  const rows=currentState.words.map(w=>[w.kind==='sentence'?'Câu ví dụ':w.kind==='phrase'?'Cụm từ':'Từ vựng',w.source,w.translation,w.manualMeaning?'Có':'Không',w.partOfSpeech||'',w.phoneticUK||'',w.phoneticUS||'',w.phonetic||'',w.context||'',Object.values(w.relatedWords?.forms||{}).flat().filter((v,i,a)=>a.indexOf(v)===i).join(' | '),
    (w.relatedWords?.synonyms||[]).join(' | '),(w.relatedWords?.antonyms||[]).join(' | '),
    Object.entries(w.relatedWords?.details||{}).map(([k,v])=>[k,v.translation||'',v.example||'',v.exampleTranslation||''].filter(Boolean).join(' — ')).join(' | '),
    currentBook?.chapters?.[w.chapter]?.title||'',new Date(w.created).toLocaleString('vi-VN')]);
  const csv='\uFEFF'+[headers,...rows].map(row=>row.map(quote).join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='so-tay-tu-vung-va-cau-vi-du.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
async function deleteBook(id){
  const item=savedBooks.find(b=>b.id===id);if(!item)return;
  if(!window.confirm(`Xóa “${item.title}” và mọi dấu trang/từ vựng liên quan khỏi thiết bị này?`))return;
  try{
    await dbRemove('books',id);await dbRemove('states',id);
    // Không giữ bản dịch riêng của cuốn sách sau khi người đọc đã yêu cầu xóa.
    const allTranslations=await dbAll('sentenceCache');
    for(const record of allTranslations){
      let belongs=false;
      try{belongs=JSON.parse(record.key)[0]===id;}catch{}
      if(belongs)await dbRemove('sentenceCache',record.key);
    }
  }catch(e){notify('Không xóa được toàn bộ dữ liệu sách: '+e.message);return;}
  savedBooks=savedBooks.filter(b=>b.id!==id);
  if(currentBook?.id===id){stopSpeech();currentBook=null;currentState=null;revokeImageUrls();$('readerView').hidden=true;$('welcomeScreen').hidden=false;setNodeText('headerBookTitle','Không gian đọc của bạn');}
  renderLibrary();renderToc();renderBookmarks();renderWords();notify('Đã xóa sách khỏi thư viện trên thiết bị.');
}
function setTab(tab){
  activeTab=tab;
  document.querySelectorAll('.side-tab').forEach(b=>{const on=b.dataset.tab===tab;b.classList.toggle('active',on);b.setAttribute('aria-selected',on?'true':'false');});
  document.querySelectorAll('.side-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===tab));
}
function openDrawer(){$('sidebar').classList.add('open');$('drawerShade').hidden=false;}
function closeDrawer(){$('sidebar').classList.remove('open');$('drawerShade').hidden=true;}
function togglePanel(id){$(id).hidden=!$(id).hidden;}
function applySettings(){
  document.body.dataset.theme=settings.theme;
  document.documentElement.style.setProperty('--reader-size',settings.fontSize+'px');
  document.documentElement.style.setProperty('--reader-line',String(settings.lineHeight));
  document.documentElement.style.setProperty('--reader-font',settings.font==='sans'?"system-ui,-apple-system,'Segoe UI',Arial,sans-serif":"Georgia,'Times New Roman',serif");
  $('fontRange').value=settings.fontSize;setNodeText('fontValue',settings.fontSize+' px');
  $('lineRange').value=settings.lineHeight;setNodeText('lineValue',settings.lineHeight.toFixed(1));
  $('fontSelect').value=settings.font;
  $('sourceLanguage').value=settings.source;
  $('targetLanguage').value=settings.target;
  $('pronunciationAccent').value=settings.pronunciationAccent||'both';
  $('ttsEngine').value=settings.ttsEngine;
  $('ttsLanguage').value=settings.ttsLanguage;
  updateTtsVoiceOptions();
  refreshTtsKeyUI();
  refreshApiKeyUI();
  $('speechRate').value=settings.rate;setNodeText('speechRateValue',Number(settings.rate).toFixed(1)+'×');
  for(const c of document.querySelectorAll('.theme-choice'))c.classList.toggle('selected',c.dataset.setTheme===settings.theme);
}
function selectedFromReader(){
  const selection=window.getSelection();if(!selection||selection.isCollapsed)return '';
  const root=$('readerContent');
  if(!root.contains(selection.anchorNode)||!root.contains(selection.focusNode))return '';
  return selection.toString().trim().slice(0,3000);
}
function handleSelection(){
  if(!currentBook||!$('translationModal').hidden)return;
  const text=selectedFromReader();
  if(text.length>0){selectedText=text;selectedLookupInfo=getSelectionDetails();setNodeText('selectedPreview',shortText(text,130));$('selectionPanel').hidden=false;}
  else if(!$('translationModal').hidden || !selectedText){$('selectionPanel').hidden=true;}
}
function resolveSource(text){
  if(settings.source!=='auto')return settings.source;
  if(/[\u3040-\u30ff]/u.test(text))return 'ja';
  if(/[\uac00-\ud7af]/u.test(text))return 'ko';
  if(/[\u3400-\u9fff]/u.test(text))return 'zh';
  if(/[ăâđêôơưĂÂĐÊÔƠƯàáạảãèéẹẻẽìíịỉĩòóọỏõùúụủũỳýỵỷỹ]/i.test(text))return 'vi';
  return 'en';
}
function googleTranslateURL(text){
  return `https://translate.google.com/?sl=${encodeURIComponent(settings.source)}&tl=${encodeURIComponent(settings.target)}&text=${encodeURIComponent(text)}&op=translate`;
}
// V8: Mỗi câu kết thúc tại . ? ! (hoặc dấu tương đương tiếng Á).
// Một số EPUB chia dòng in thành nhiều <p> mà không có dấu kết thúc câu.
// Ghép lại các đoạn bị ngắt dòng TRƯỚC KHI tạo nút dịch, không cắt theo số ký tự.
function hasSentenceEnding(text){
  return /[.!?。！？]+["'”’»)\]}]*\s*$/u.test(String(text||''));
}
function needsParagraphContinuation(previous,next){
  const a=String(previous||'').trim();const b=String(next||'').trim();
  if(!hasSentenceEnding(a))return true;
  // Lời thoại kết thúc dấu hỏi/chấm than nhưng "he said" / "she asked" vẫn cùng một câu.
  if(/[?!]["'”’»]+\s*$/u.test(a)&&/^(he|she|they|we|i|you|the|asked|said|replied|cried|whispered)\b/i.test(b)&&/^[a-z]/.test(b))return true;
  return false;
}
function isReflowableParagraph(el){
  if(!el || !el.matches?.('p,div'))return false;
  // Không làm hỏng tiêu đề, hình, bảng, danh sách, dấu ngắt chương.
  if(el.querySelector('p,div,h1,h2,h3,h4,h5,h6,li,ul,ol,table,td,th,blockquote,pre,code,img,figure,svg,video,audio,hr'))return false;
  return !!(el.textContent||'').trim();
}
function joinWrappedParagraphs(root){
  const candidates=[...root.querySelectorAll('p,div')];
  const done=new WeakSet();
  for(const start of candidates){
    if(!start.isConnected || done.has(start) || !isReflowableParagraph(start))continue;
    const group=[start];
    let tail=start;
    // Chỉ ghép khi đoạn trước chưa kết thúc bằng dấu câu và đoạn tiếp là đoạn văn cùng cấp.
    while(true){
      const next=tail.nextElementSibling;
      if(!isReflowableParagraph(next))break;
      if(!needsParagraphContinuation(tail.textContent,next.textContent))break;
      group.push(next);tail=next;
      if(group.length>=2000)break;
    }
    if(group.length===1)continue;
    const fragment=document.createDocumentFragment();
    for(let i=0;i<group.length;i++){
      const block=group[i];done.add(block);
      if(i>0)fragment.appendChild(document.createTextNode(' '));
      while(block.firstChild)fragment.appendChild(block.firstChild);
    }
    start.appendChild(fragment);
    for(let i=1;i<group.length;i++)group[i].remove();
  }
}
function segmentSentences(text){
  // Intl.Segmenter không phân tách câu chỉ dựa vào độ dài hoặc xuống dòng.
  // Giữ nguyên offset để bảo toàn định dạng đậm/nghiêng khi dựng lại DOM.
  let pieces;
  if(typeof Intl!=='undefined' && typeof Intl.Segmenter==='function'){
    try {pieces=[...new Intl.Segmenter(undefined,{granularity:'sentence'}).segment(text)].map(p=>p.segment);}catch {}
  }
  if(!pieces){
    pieces=[];let begin=0;
    const punctuation=/[.!?。！？]+["'”’»)\]}]*\s*/gu;
    let hit;
    while((hit=punctuation.exec(text))!==null){
      const end=hit.index+hit[0].length;
      if(end>begin){pieces.push(text.slice(begin,end));begin=end;}
    }
    if(begin<text.length)pieces.push(text.slice(begin));
  }
  const result=[];let offset=0;
  for(const piece of pieces){
    if(!piece.length)continue;
    const start=text.indexOf(piece,offset);
    if(start<0)continue;
    const end=start+piece.length;
    if(piece.trim())result.push({start,end,text:piece.trim()});
    offset=end;
  }
  if(!result.length && text.trim())return [{start:0,end:text.length,text:text.trim()}];
  // Một vài bộ phân câu vẫn nhầm xuống dòng / mảnh dàn trang là hết câu.
  // Nối lại mọi mảnh chưa thật sự kết thúc câu, và vẫn giữ nguyên ký tự gốc.
  const merged=[];
  for(const item of result){
    const prev=merged[merged.length-1];
    if(prev){
      const prevText=prev.text.trim();
      const currentText=item.text.trim();
      const abbreviation=/(?:^|\s)(?:mr|mrs|ms|dr|prof|capt|gen|rev|hon|sr|jr|st|mt)\.$/i.test(prevText);
      const quotedQuestion=/[?!]["'”’»]+$/.test(prevText) && /^[a-z]/.test(currentText);
      const unfinished=!hasSentenceEnding(prevText);
      const hangingPause=/[,;:—–-]["'”’»)]*\s*$/u.test(prevText);
      const nextLooksLikeContinuation=/^(?:[a-z(“"'‘]|\d{1,4}[,)])/.test(currentText);
      if(unfinished || abbreviation || quotedQuestion || (hangingPause && nextLooksLikeContinuation)){
        prev.end=item.end;prev.text=text.slice(prev.start,item.end).trim();
        continue;
      }
    }
    merged.push({...item});
  }
  return merged;
}
function sentenceRanges(block){
  // <br> trong EPUB nhiều khi chỉ là xuống dòng khi dàn trang, không phải hết câu.
  for(const br of [...block.querySelectorAll('br')])br.replaceWith(document.createTextNode(' '));
  const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);
  const nodes=[];let total=0;let node;
  while((node=walker.nextNode())){
    const content=node.textContent||'';
    if(!content)continue;
    nodes.push({node,start:total,end:total+content.length});total+=content.length;
  }
  if(!nodes.length)return [];
  const text=nodes.map(n=>n.node.textContent).join('');
  const segments=segmentSentences(text);
  return segments.map(seg=>{
    const first=nodes.find(n=>n.end>seg.start)||nodes[0];
    const last=nodes.find(n=>n.end>=seg.end)||nodes[nodes.length-1];
    const range=document.createRange();
    range.setStart(first.node,Math.max(0,seg.start-first.start));
    range.setEnd(last.node,Math.min(last.node.length,seg.end-last.start));
    return {text:seg.text,fragment:range.cloneContents()};
  });
}
function restoreLegacySentenceTranslation(state,key,chapter){
  if(typeof state?.translations?.[key]==='string')return state.translations[key];
  // Các bản V7-V16 lưu theo số thứ tự câu. Nếu cập nhật thuật toán tách câu,
  // vẫn thử phục hồi dựa trên dấu vân tay nội dung và chiều dịch.
  const parts=key.split(':');
  const suffix=':'+parts.slice(2).join(':');
  const legacy=Object.keys(state?.translations||{}).find(k=>k.startsWith(chapter+':')&&k.endsWith(suffix));
  return legacy?state.translations[legacy]:null;
}
function paintSentenceTranslation(unit,translation,visible){
  const button=unit.querySelector('.sentence-translate-btn');
  const answer=unit.querySelector('.sentence-translation');
  if(typeof translation==='string'&&translation.length){
    unit.dataset.hasTranslation='true';
    answer.textContent=translation;
    answer.hidden=!visible;
    button.textContent=visible?'⇄ Ẩn bản dịch':'⇄ Hiện bản dịch';
    button.setAttribute('aria-expanded',String(!!visible));
  }else{
    delete unit.dataset.hasTranslation;
    answer.textContent='';answer.hidden=true;
    button.textContent='⇄ Dịch câu';button.setAttribute('aria-expanded','false');
  }
}
function prepareSentenceTranslations(root,cacheRecords=[]){
  joinWrappedParagraphs(root);
  let sentenceCount=0;
  const state=currentState, chapter=currentIndex;
  const cacheMap=new Map(cacheRecords.map(r=>[r.key,r]));
  const candidateSelector='p,h1,h2,h3,h4,h5,h6,li,td,th,figcaption,blockquote,div';
  const blocks=[...root.querySelectorAll(candidateSelector)].filter(block=>{
    if(block.closest('.sentence-unit'))return false;
    if(block.querySelector(candidateSelector))return false;
    if(block.querySelector('img,svg,video,audio,table,pre,code'))return false;
    if((block.textContent||'').trim().length<2)return false;
    return true;
  });
  for(const block of blocks){
    const sentences=sentenceRanges(block);
    if(!sentences.length)continue;
    const replacement=document.createDocumentFragment();
    for(const segment of sentences){
      const number=sentenceCount++;
      const unit=document.createElement('span');unit.className='sentence-unit';unit.dataset.sentence=String(number);
      const original=document.createElement('span');original.className='sentence-text';original.append(segment.fragment);
      const controls=document.createElement('span');controls.className='sentence-controls';
      const button=document.createElement('button');button.type='button';button.className='sentence-translate-btn';
      button.title='Hiện/ẩn bản dịch đã lưu; chỉ gửi API nếu câu chưa từng dịch';
      const answer=document.createElement('span');answer.className='sentence-translation';answer.hidden=true;answer.setAttribute('role','status');
      controls.appendChild(button);unit.append(original,controls,answer);
      const oldKey=sentenceTranslationKey(chapter,number,segment.text);
      const identity=sentenceCacheIdentity(currentBook.id,chapter,segment.text);
      const existing=cacheMap.get(identity.key);
      const legacy=restoreLegacySentenceTranslation(state,oldKey,chapter);
      const translated=legacy||existing?.translation;
      // Nâng cấp V16: câu đã dịch mặc định hiện lại; nếu từng bấm Ẩn thì giữ nguyên.
      const visible=state?.translationVisibility?.[oldKey] ?? existing?.visible ?? true;
      paintSentenceTranslation(unit,translated,visible);
      button.addEventListener('click',()=>toggleSentenceTranslation(unit,segment.text,number));
      replacement.appendChild(unit);
    }
    block.replaceChildren(replacement);
    block.classList.add('has-sentences');
  }
  const note=$('sentenceCount');
  if(note)note.textContent=`${sentenceCount} câu · bản dịch đã lưu tự hiện lại · chạm từ để tra · bôi đen để tra cụm từ`;
}
function sentenceTranslationKey(chapter,number,original){
  let hash=2166136261;
  for(let i=0;i<original.length;i++){hash^=original.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return `${chapter}:${number}:${(hash>>>0).toString(16)}:${settings.source}:${settings.target}`;
}
async function toggleSentenceTranslation(unit,text,number){
  const button=unit.querySelector('.sentence-translate-btn');
  const answer=unit.querySelector('.sentence-translation');
  if(button.disabled||!currentBook||!currentState)return;
  const state=currentState,bookId=currentBook.id,chapter=currentIndex;
  const key=sentenceTranslationKey(chapter,number,text);
  const identity=sentenceCacheIdentity(bookId,chapter,text);
  const active=()=>unit.isConnected&&currentState===state&&currentBook?.id===bookId&&currentIndex===chapter;
  const existing=restoreLegacySentenceTranslation(state,key,chapter);
  const saveVisible=async(translated,visible)=>{
    state.translations[key]=translated;
    state.translationVisibility[key]=visible;
    // Lưu ngay sau mỗi thao tác, không đợi người đọc thoát hoặc đổi chương.
    // Vẫn giữ bản dịch trong state của V16 để có thể phục hồi dữ liệu cũ.
    try {await saveSentenceCache(identity,translated,visible);}
    catch(e){console.warn('Translation cache:',e);}
    if(currentState===state){await persistState();}
  };
  if(!answer.hidden){
    paintSentenceTranslation(unit,answer.textContent,false);
    saveVisible(answer.textContent,false).catch(e=>notify(e.message,6000));
    return;
  }
  if(unit.dataset.hasTranslation==='true'||existing){
    const translation=existing||answer.textContent;
    paintSentenceTranslation(unit,translation,true);
    saveVisible(translation,true).catch(e=>notify(e.message,6000));
    return;
  }
  button.disabled=true;
  answer.hidden=false;answer.textContent='Đang tìm bản dịch đã lưu…';button.textContent='Đang kiểm tra…';
  try{
    // Kiểm tra cache độc lập trước cả khi gọi API, kể cả sách vừa nhập lại.
    const cached=await readCachedSentenceByText(identity);
    let translated=cached?.translation;
    if(!translated){
      answer.textContent='Đang dịch câu…';button.textContent='Đang dịch…';
      let request=sentenceTranslationInFlight.get(identity.textKey);
      if(!request){
        request=translateText(text);
        sentenceTranslationInFlight.set(identity.textKey,request);
        request.finally(()=>{if(sentenceTranslationInFlight.get(identity.textKey)===request)sentenceTranslationInFlight.delete(identity.textKey);}).catch(()=>{});
      }
      translated=await request;
    }
    // Đưa bản dịch lên màn hình và vào state TRƯỚC khi lưu: một lỗi bộ nhớ
    // tuyệt đối không được biến yêu cầu Google đã trả phí thành 'dịch thất bại'.
    state.translations[key]=translated;
    state.translationVisibility[key]=true;
    if(active())paintSentenceTranslation(unit,translated,true);
    const storageResults=await Promise.allSettled([
      saveSentenceCache(identity,translated,true),
      currentState===state?persistState():Promise.resolve()
    ]);
    if(storageResults.every(r=>r.status==='rejected')){
      if(active())notify('Bản dịch đã hiện nhưng thiết bị không lưu được. Kiểm tra dung lượng/bộ nhớ trình duyệt.',6500);
    }
  }catch(e){
    if(active()){
      answer.hidden=false;answer.textContent='Không dịch được: '+e.message;
      button.textContent='↻ Thử dịch lại';
    }
  }finally{button.disabled=false;}
}
function refreshApiKeyUI(){
  const input=$('googleApiKeyInput');if(!input)return;
  if(document.activeElement!==input)input.value=googleTranslateKey;
  const remember=$('rememberApiKey');
  remember.checked=!!(()=>{try{return localStorage.getItem(GOOGLE_KEY_STORE);}catch{return '';}})();
  setNodeText('googleApiStatus',googleTranslateKey?'✓ Đã cấu hình Google Cloud Translation':'Chưa nhập API Key · hiện dùng dịch vụ miễn phí giới hạn');
}
function saveGoogleApiKey(){
  const key=$('googleApiKeyInput').value.trim();
  googleTranslateKey=key;
  try{
    if(key&&$('rememberApiKey').checked)localStorage.setItem(GOOGLE_KEY_STORE,key);
    else localStorage.removeItem(GOOGLE_KEY_STORE);
  }catch{notify('Trình duyệt chặn lưu khóa. Khóa chỉ hoạt động trong phiên này.');}
  refreshApiKeyUI();
  notify(key?'Đã áp dụng Google Cloud Translation API Key.':'Đã bỏ API Key; sử dụng dịch miễn phí giới hạn.');
}
function removeGoogleApiKey(){
  googleTranslateKey='';$('googleApiKeyInput').value='';
  try{localStorage.removeItem(GOOGLE_KEY_STORE);}catch{}
  refreshApiKeyUI();notify('Đã xóa API Key trên thiết bị này.');
}
function decodeTranslationHtml(value){
  // Google Translate v2 đôi khi trả về thực thể HTML dù yêu cầu format=text.
  const el=document.createElement('textarea');el.innerHTML=String(value||'');return el.value;
}
async function requestGoogleTranslation(text,{key=googleTranslateKey,source=settings.source,target=settings.target}={}){
  if(!key)throw new Error('Chưa nhập Google Cloud Translation API Key.');
  const body={key,q:text,target,format:'text'};
  if(source!=='auto')body.source=source;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),18000);
  try{
    let response;
    if(location.protocol==='https:'||location.protocol==='http:'){
      // Bản triển khai trên Vercel dùng đường dẫn serverless cùng miền, không lộ key trên URL.
      try{
        response=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
        if(response.status===404||response.status===405)response=null;
      }catch(e){if(e.name==='AbortError')throw e;response=null;}
    }
    if(!response){
      // Dành cho bản HTML độc lập hoặc máy chủ tĩnh không có hàm /api/translate.
      response=await fetch('https://translation.googleapis.com/language/translate/v2',{
        method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},
        body:JSON.stringify({q:text,target,format:'text',...(source==='auto'?{}:{source})}),signal:controller.signal
      });
    }
    let data;
    try{data=await response.json();}catch{throw new Error('Máy chủ dịch không trả về dữ liệu hợp lệ.');}
    if(!response.ok)throw new Error(data?.error?.message||data?.message||`Google Translate API trả lỗi ${response.status}.`);
    const result=data?.data?.translations?.[0]?.translatedText;
    if(!result)throw new Error('Google Cloud Translation chưa trả bản dịch.');
    return decodeTranslationHtml(result);
  }catch(e){
    if(e.name==='AbortError')throw new Error('Dịch quá thời gian chờ. Kiểm tra kết nối mạng.');
    if(e instanceof TypeError)throw new Error('Không kết nối được Google Cloud Translation. Hãy dùng bản Vercel để có máy chủ chuyển tiếp hoặc kiểm tra kết nối.');
    throw e;
  }finally{clearTimeout(timer);}
}
async function testGoogleApiKey(){
  saveGoogleApiKey();
  if(!googleTranslateKey)return notify('Hãy nhập API Key trước khi kiểm tra.');
  $('testGoogleApiKey').disabled=true;setNodeText('googleApiStatus','Đang kết nối thử Google Cloud…');
  try{const result=await requestGoogleTranslation('Hello.',{source:'en',target:'vi'});setNodeText('googleApiStatus','✓ Kết nối thành công: Hello. → '+result);notify('Google Cloud Translation hoạt động.');}
  catch(e){setNodeText('googleApiStatus','✕ '+e.message);notify('Lỗi kiểm tra API Key: '+e.message,6500);}
  finally{$('testGoogleApiKey').disabled=false;}
}
async function translateText(text){
  if(!text.trim())throw new Error('Chưa chọn từ hoặc câu cần dịch.');
  if(text.length>6000)throw new Error('Đoạn quá dài. Hãy chọn một đoạn ngắn hơn.');
  if(googleTranslateKey)return await requestGoogleTranslation(text);
  if(text.length>480)throw new Error('Câu này dài quá giới hạn dịch miễn phí (480 ký tự). Vào Cài đặt để nhập Google Cloud Translation API Key.');
  const source=resolveSource(text);
  if(source===settings.target)return 'Câu này đang ở ngôn ngữ đích. Hãy đổi mục “Dịch sang” trong Cài đặt.';
  const url=`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(source+'|'+settings.target)}`;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),11000);
  try{
    const res=await fetch(url,{signal:controller.signal});
    if(!res.ok)throw new Error('Dịch vụ miễn phí tạm không khả dụng ('+res.status+').');
    const data=await res.json();
    if(Number(data.responseStatus)!==200 || !data.responseData?.translatedText)throw new Error(data.responseDetails||'Không có bản dịch.');
    const answer=String(data.responseData.translatedText);
    if(/MYMEMORY WARNING|YOU USED ALL AVAILABLE FREE TRANSLATIONS/i.test(answer))throw new Error('Dịch vụ miễn phí đã hết lượt. Nhập API Key Google Cloud để tiếp tục.');
    return decodeTranslationHtml(answer);
  }finally{clearTimeout(timer);}
}
// Tra nhanh V10: không tạo hàng nghìn nút/span cho từng từ trong sách.
// Xác định từ ngay tại điểm chạm bằng caretRangeFromPoint/caretPositionFromPoint.
function isWordChar(ch){return /[\p{L}\p{M}\p{N}'’\-]/u.test(ch||'');}
function getWordAtPoint(x,y){
  let node=null,offset=0;
  if(document.caretPositionFromPoint){const pos=document.caretPositionFromPoint(x,y);if(pos){node=pos.offsetNode;offset=pos.offset;}}
  if((!node||node.nodeType!==Node.TEXT_NODE)&&document.caretRangeFromPoint){const range=document.caretRangeFromPoint(x,y);if(range){node=range.startContainer;offset=range.startOffset;}}
  if(!node||node.nodeType!==Node.TEXT_NODE)return null;
  const parent=node.parentElement;
  const original=parent?.closest('.sentence-text');
  if(!original||!$('readerContent').contains(original))return null;
  const content=node.textContent||'';
  if(!content)return null;
  // Chạm gần ranh giới của chữ vẫn chọn từ, nhưng không bắt một dấu cách xa chữ.
  const ix=Math.max(0,Math.min(content.length-1,offset));
  let pivot=ix;
  if(!isWordChar(content[pivot])&&pivot>0&&isWordChar(content[pivot-1]))pivot--;
  if(!isWordChar(content[pivot]))return null;
  let a=pivot,b=pivot+1;
  while(a>0&&isWordChar(content[a-1]))a--;
  while(b<content.length&&isWordChar(content[b]))b++;
  // Bỏ dấu nháy/gạch nối nằm ngoài từ.
  while(a<b&&/['’\-]/.test(content[a]))a++;
  while(b>a&&/['’\-]/.test(content[b-1]))b--;
  const word=content.slice(a,b).trim();
  if(!word||word.length>80)return null;
  const sentence=original.textContent?.replace(/\s+/g,' ').trim()||'';
  return {text:word,context:sentence,kind:'word',chapter:currentIndex};
}
function getSelectionDetails(){
  const selection=window.getSelection();const text=selectedFromReader();
  if(!selection||!text)return null;
  const node=selection.anchorNode;
  const el=node?.nodeType===1?node:node?.parentElement;
  const sentence=el?.closest?.('.sentence-unit')?.querySelector('.sentence-text');
  const context=sentence?.textContent?.replace(/\s+/g,' ').trim()||'';
  return {text,context,kind:/\s/u.test(text.trim())?'phrase':'word',chapter:currentIndex};
}
function handleReaderPointerUp(event){
  if(!currentBook||!readerPointerStart||event.pointerId!==readerPointerStart.id)return;
  const start=readerPointerStart;readerPointerStart=null;
  if(!event.target.closest('.sentence-text')||event.target.closest('a,button'))return;
  const moved=Math.hypot(event.clientX-start.x,event.clientY-start.y);
  const held=Date.now()-start.time;
  const x=event.clientX,y=event.clientY;
  // Trên điện thoại, giữ lâu để bôi đen phải được phép kéo tay chọn cụm từ.
  setTimeout(()=>{
    if(!currentBook||$('readerView').hidden)return;
    const selection=getSelectionDetails();
    if(selection){
      selectedText=selection.text;handleSelection();
      // Máy tính: kéo chọn xong tự mở kết quả. Điện thoại: chờ người đọc kéo xong hai tay nắm lựa chọn.
      if(event.pointerType==='mouse'&&moved>6&&selection.text.length<=600)openLookup(selection);
      return;
    }
    if(moved>10||held>480)return;
    const detail=getWordAtPoint(x,y);
    if(detail){selectedText='';selectedLookupInfo=null;$('selectionPanel').hidden=true;openLookup(detail);}
  },event.pointerType==='touch'?105:75);
}
function normalizeIPA(text){
  const raw=String(text||'').trim();
  if(!raw)return '';
  return raw.startsWith('/')||raw.startsWith('[')?raw:'/'+raw+'/';
}
function dictionaryAccentFromAudio(url){
  const lower=String(url||'').toLowerCase();
  if(/(?:[-_./])(?:us|american)(?:[-_./]|$)/.test(lower))return 'us';
  if(/(?:[-_./])(?:uk|gb|british)(?:[-_./]|$)/.test(lower))return 'uk';
  return '';
}
function safeDictionaryAudio(url){
  try{const u=new URL(url);return u.protocol==='https:'&&(/(^|\.)dictionaryapi\.dev$|(^|\.)wikimedia\.org$/).test(u.hostname)?u.href:'';}catch{return '';}
}
function parseEnglishDictionary(data){
  const variants={us:{ipa:'',audio:''},uk:{ipa:'',audio:''}}, parts=[], definitionsByPos={};
  const synonymsByPos={},antonymsByPos={};
  const addUnique=(target,values)=>{for(const item of values||[]){
    if(typeof item!=='string')continue;const value=item.trim().toLowerCase();
    if(value&&value.length<=65&&!target.includes(value))target.push(value);
  }};
  let generic='';
  for(const item of data){
    for(const p of item.phonetics||[]){
      const ipa=normalizeIPA(p.text),audio=safeDictionaryAudio(p.audio);
      const accent=dictionaryAccentFromAudio(p.audio);
      if(accent){if(ipa&&!variants[accent].ipa)variants[accent].ipa=ipa;
        if(audio&&!variants[accent].audio)variants[accent].audio=audio;}
      else if(ipa&&!generic)generic=ipa;
    }
    if(!generic)generic=normalizeIPA(item.phonetic);
    for(const meaning of item.meanings||[]){
      const pos=meaning.partOfSpeech;
      if(!pos)continue;
      if(!parts.includes(pos))parts.push(pos);
      if(!definitionsByPos[pos])definitionsByPos[pos]=[];
      if(!synonymsByPos[pos])synonymsByPos[pos]=[];
      if(!antonymsByPos[pos])antonymsByPos[pos]=[];
      addUnique(synonymsByPos[pos],meaning.synonyms);
      addUnique(antonymsByPos[pos],meaning.antonyms);
      for(const d of meaning.definitions||[]){
        if(d.definition&&definitionsByPos[pos].length<4&&!definitionsByPos[pos].includes(d.definition))definitionsByPos[pos].push(d.definition);
        addUnique(synonymsByPos[pos],d.synonyms);
        addUnique(antonymsByPos[pos],d.antonyms);
      }
    }
  }
  return {phonetic:variants.us.ipa||variants.uk.ipa||generic,
    phoneticUS:variants.us.ipa,phoneticUK:variants.uk.ipa,genericIPA:generic,
    audioUS:variants.us.audio,audioUK:variants.uk.audio,
    partOfSpeech:parts.length?(PART_OF_SPEECH[parts[0]]||parts[0]):'',parts,
    definitionsByPos,definitions:parts.length?(definitionsByPos[parts[0]]||[]).slice(0,3):[],
    synonymsByPos,antonymsByPos,lexVersion:2};
}
function renderDictionaryInfo(entry){
  const select=$('lookupPartOfSpeech'),ipa=$('lookupPhonetic'),rows=$('lookupAccentRows'),definitions=$('lookupDefinitions');
  rows.replaceChildren();definitions.replaceChildren();select.replaceChildren();
  const parts=entry?.parts||[];
  if(parts.length){
    for(const part of parts)select.append(new Option(PART_OF_SPEECH[part]||part,part));
    const chosen=lookupSnapshot?.selectedPart;
    if(chosen&&parts.includes(chosen))select.value=chosen;
  }
  const accent=settings.pronunciationAccent||'both';
  if(entry){
    const phonetics=[];
    if(accent==='both'||accent==='uk')phonetics.push(['uk','UK',entry.phoneticUK]);
    if(accent==='both'||accent==='us')phonetics.push(['us','US',entry.phoneticUS]);
    for(const [key,label,value] of phonetics){
      const row=document.createElement('div');row.className='lookup-accent-row';
      const labelEl=document.createElement('strong');labelEl.className='lookup-accent-label';labelEl.textContent=label;
      const phonetic=document.createElement('span');phonetic.className='lookup-ipa';phonetic.textContent=value||'Chưa có IPA riêng';
      const listen=document.createElement('button');listen.type='button';listen.className='lookup-pronounce';listen.textContent='🔊 '+label;
      listen.addEventListener('click',()=>playWordPronunciation(key));
      row.append(labelEl,phonetic,listen);rows.append(row);
    }
    if(entry.genericIPA){
      const shown=phonetics.some(([key,,val])=>val&&val===entry.genericIPA);
      if(!shown){
        const row=document.createElement('div');row.className='lookup-accent-row';
        const l=document.createElement('span');l.className='lookup-accent-label';l.textContent='IPA';
        const value=document.createElement('span');value.className='lookup-ipa';value.textContent=entry.genericIPA;
        row.append(l,value);rows.append(row);
      }
    }
  }
  const chosenPart=select.value;
  const definitionEntries=[];
  for(const def of (entry?.definitionsByPos?.[chosenPart]||entry?.definitions||[]).slice(0,3)){
    if(!definitions.childElementCount){
      const label=document.createElement('small');label.textContent='ĐỊNH NGHĨA SONG NGỮ ANH – VIỆT';definitions.append(label);
      const list=document.createElement('ul');list.className='lookup-bilingual-list';definitions.append(list);
    }
    const li=document.createElement('li');li.className='lookup-bilingual-item';
    const english=document.createElement('div');english.className='lookup-definition-en';english.lang='en';english.textContent=def;
    const vietnamese=document.createElement('div');vietnamese.className='lookup-definition-vi';vietnamese.lang='vi';
    const cached=dictionaryDefinitionsVi[definitionVietnameseKey(def)];
    vietnamese.textContent=cached||'Đang dịch sang tiếng Việt…';
    if(!cached)vietnamese.classList.add('is-pending');
    li.append(english,vietnamese);definitions.querySelector('ul').append(li);
    if(!cached)definitionEntries.push({english:def,node:vietnamese});
  }
  definitions.hidden=!definitions.childElementCount;
  if(definitionEntries.length)hydrateDictionaryDefinitionTranslations(definitionEntries,lookupSnapshot,lookupToken);
  ipa.textContent='';ipa.hidden=true;
  $('lookupMeta').hidden=!rows.childElementCount&&!parts.length;
  if(lookupSnapshot)renderLookupRelations(lookupSnapshot,!lookupSnapshot.lexical);
}
const PART_OF_SPEECH={noun:'danh từ',verb:'động từ',adjective:'tính từ',adverb:'trạng từ',pronoun:'đại từ',preposition:'giới từ',conjunction:'liên từ',interjection:'thán từ',determiner:'từ hạn định',article:'mạo từ',auxiliary:'trợ động từ',exclamation:'thán từ',number:'số từ'};
function isEnglishDictionaryWord(text){
  return !/\s/u.test(text.trim()) && /^[a-zA-Z]+(?:['’\-][a-zA-Z]+)*$/.test(text.trim()) && (settings.source==='auto'||settings.source==='en');
}
async function getDictionaryEntry(word){
  const key=word.trim().toLowerCase();
  if(dictionarySaved[key]?.lexVersion===2)return dictionarySaved[key];
  if(dictionaryRequests.has(key))return dictionaryRequests.get(key);
  const promise=(async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6500);
    try{
      const response=await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/'+encodeURIComponent(key),{signal:controller.signal});
      if(!response.ok)return dictionarySaved[key]||null;
      const data=await response.json();if(!Array.isArray(data)||!data.length)return null;
      const parsed=parseEnglishDictionary(data);
      dictionarySaved[key]=parsed;
      if(Object.keys(dictionarySaved).length>100)delete dictionarySaved[Object.keys(dictionarySaved)[0]];
      safeJSONSave(DICTIONARY_STORE,dictionarySaved);
      return parsed;
    }catch{return dictionarySaved[key]||null;}finally{clearTimeout(timer);}
  })();
  dictionaryRequests.set(key,promise);
  try{return await promise;}finally{dictionaryRequests.delete(key);}
}
function playWordPronunciation(accent='us'){
  const snapshot=lookupSnapshot;if(!snapshot)return;
  const url=accent==='uk'?snapshot.dictionary?.audioUK:snapshot.dictionary?.audioUS;
  function speakFallback(){
    if(!('speechSynthesis' in window))return notify('Thiết bị không hỗ trợ phát âm từ điển.');
    stopSpeech();
    const say=new SpeechSynthesisUtterance(snapshot.text);
    say.lang=accent==='uk'?'en-GB':'en-US';say.rate=Math.min(1.25,Math.max(.7,Number(settings.rate)||1));
    const voices=speechSynthesis.getVoices();
    const chosen=voices.find(v=>v.lang.toLowerCase().startsWith(accent==='uk'?'en-gb':'en-us'));
    if(chosen)say.voice=chosen;
    speechSynthesis.speak(say);
  }
  if(url){
    stopSpeech();
    const player=new Audio(url);window._wordDictionaryAudio=player;
    player.play().catch(()=>speakFallback());
  }else speakFallback();
}

/* V13: Ho tu va quan he ngau nghia - Datamuse + Free Dictionary.
   Quan he tu vung la goi y tu dien, khong phai mot dich sat nghia trong moi cau. */
function uniqueTerms(items,except='',limit=10){
  const seen=new Set(),output=[];
  for(const entry of items||[]){
    const word=typeof entry==='string'?entry:entry?.word;
    if(typeof word!=='string')continue;
    const clean=word.trim().replace(/\s+/g,' ').toLowerCase();
    if(!clean||clean===except.toLowerCase()||clean.length>60||seen.has(clean))continue;
    if(!/^[a-z][a-z' -]*$/i.test(clean))continue;
    seen.add(clean);output.push(clean);
    if(output.length>=limit)break;
  }
  return output;
}
function estimatedLemma(word){
  const w=word.trim().toLowerCase();
  if(w.length<5)return w;
  if(/ied$/.test(w))return w.slice(0,-3)+'y';
  if(/ated$/.test(w))return w.slice(0,-1); // participated => participate
  if(/ed$/.test(w))return w.slice(0,-2).replace(/([b-df-hj-np-tv-z])\1$/,'$1');
  if(/ing$/.test(w))return w.slice(0,-3).replace(/([b-df-hj-np-tv-z])\1$/,'$1');
  if(/ies$/.test(w))return w.slice(0,-3)+'y';
  if(/s$/.test(w)&&!/ss$/.test(w))return w.slice(0,-1);
  return w;
}
function familyPrefix(lemma){
  const word=String(lemma||'').toLowerCase();
  if(word.length<5)return word;
  if(word.endsWith('ate'))return word.slice(0,-2); // particip-a* -> participate, participant, participation
  if(word.endsWith('y'))return word.slice(0,-1);
  if(word.endsWith('e'))return word.slice(0,-1);
  return word;
}
async function fetchDatamuse(params,timeout=6200){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const url=new URL('https://api.datamuse.com/words');
    for(const [key,value] of Object.entries(params))url.searchParams.set(key,String(value));
    const response=await fetch(url.href,{signal:controller.signal});
    if(!response.ok)throw new Error('Datamuse '+response.status);
    const json=await response.json();return Array.isArray(json)?json:[];
  }finally{clearTimeout(timer);}
}
function lexicalPartTags(item){return (item?.tags||[]).filter(tag=>['n','v','adj','adv'].includes(tag));}
function buildWordForms(lookupWord,lemma,found){
  const forms={verb:[],noun:[],adjective:[],adverb:[],ing:[],past:[],singular:[],plural:[]};
  const seen=new Set();
  const prefix=familyPrefix(lemma);
  for(const row of found||[]){
    const word=String(row?.word||'').toLowerCase().trim();
    if(!/^[a-z-]+$/.test(word)||word.length>32||seen.has(word)||!word.startsWith(prefix))continue;
    seen.add(word);
    const tags=lexicalPartTags(row);
    if(tags.includes('v')&&!forms.verb.includes(word))forms.verb.push(word);
    if(tags.includes('n')&&!forms.noun.includes(word))forms.noun.push(word);
    if(tags.includes('adj')&&!forms.adjective.includes(word))forms.adjective.push(word);
    if(tags.includes('adv')&&!forms.adverb.includes(word))forms.adverb.push(word);
    if(word.endsWith('ing')&&tags.includes('v'))forms.ing.push(word);
    if(word.endsWith('ed')&&tags.includes('v'))forms.past.push(word);
  }
  // Lemma is recovered from a dictionary headword or a regular inflection; prefer it over inflected forms.
  if(lemma&&forms.verb.includes(lemma))forms.verb=[lemma,...forms.verb.filter(w=>w!==lemma)];
  const nounRoot=forms.noun.find(w=>!/(?:s|ies)$/.test(w))||forms.noun[0];
  if(nounRoot){
    forms.singular=[nounRoot];
    const pluralCandidates=forms.noun.filter(w=>w!==nounRoot&&(
      w===nounRoot+'s'||w===nounRoot+'es'||(nounRoot.endsWith('y')&&w===nounRoot.slice(0,-1)+'ies')));
    forms.plural=pluralCandidates.slice(0,1);
  }
  for(const key of Object.keys(forms))forms[key]=uniqueTerms(forms[key],'',key==='noun'?4: key==='verb'?3:2);
  return forms;
}
async function getLexicalRelations(word){
  const key=word.trim().toLowerCase();
  if(lexicalSaved[key])return lexicalSaved[key];
  if(lexicalRequests.has(key))return lexicalRequests.get(key);
  const task=(async()=>{
    let exact=[],lemma=estimatedLemma(key);
    try{exact=await fetchDatamuse({sp:key,md:'pd',max:4},4200);}catch{}
    const match=exact.find(row=>row.word?.toLowerCase()===key);
    if(typeof match?.defHeadword==='string'&&/^[a-z-]+$/i.test(match.defHeadword))lemma=match.defHeadword.toLowerCase();
    const prefix=familyPrefix(lemma);
    const requestResults=await Promise.allSettled([
      fetchDatamuse({sp:prefix+'*',md:'p',max:70}),
      fetchDatamuse({rel_syn:lemma,max:18}),
      fetchDatamuse({rel_ant:lemma,max:15})
    ]);
    const getArray=i=>requestResults[i].status==='fulfilled'?requestResults[i].value:[];
    const forms=buildWordForms(key,lemma,getArray(0));
    const value={lemma,forms,synonyms:uniqueTerms(getArray(1),key,10),antonyms:uniqueTerms(getArray(2),key,10),
      complete:requestResults.some(r=>r.status==='fulfilled')};
    if(value.complete){lexicalSaved[key]=value;
      if(Object.keys(lexicalSaved).length>130)delete lexicalSaved[Object.keys(lexicalSaved)[0]];
      safeJSONSave(LEXICAL_STORE,lexicalSaved);}
    return value;
  })();
  lexicalRequests.set(key,task);
  try{return await task;}finally{lexicalRequests.delete(key);}
}
/* V14: Mỗi từ liên quan có một thẻ chứa nghĩa Việt và ví dụ Anh.
   Tra cứu tự động theo hàng đợi, cache; dịch ví dụ chỉ khi người đọc yêu cầu. */
const RELATED_GROUPS=[['verb','động từ'],['noun','danh từ'],['adjective','tính từ'],['adverb','trạng từ'],
  ['ing','V-ing'],['past','V2 / V3'],['singular','số ít'],['plural','số nhiều']];
const RELATED_PART={verb:'verb',noun:'noun',adjective:'adjective',adverb:'adverb',
  ing:'verb',past:'verb',singular:'noun',plural:'noun'};
let relatedExampleRunning=0;
const relatedExampleQueue=[];
function enqueueRelatedExample(job){
  return new Promise((resolve,reject)=>{relatedExampleQueue.push({job,resolve,reject});pumpRelatedExampleQueue();});
}
function pumpRelatedExampleQueue(){
  while(relatedExampleRunning<4&&relatedExampleQueue.length){
    const item=relatedExampleQueue.shift();relatedExampleRunning++;
    Promise.resolve().then(item.job).then(item.resolve,item.reject).finally(()=>{
      relatedExampleRunning--;pumpRelatedExampleQueue();
    });
  }
}
function englishExampleFromEntries(entries,preferredPart){
  const groups=[];
  for(const entry of entries||[])for(const meaning of entry?.meanings||[]){
    if(preferredPart && meaning.partOfSpeech!==preferredPart)continue;
    for(const def of meaning.definitions||[])groups.push({
      definition:String(def.definition||'').slice(0,260),
      example:typeof def.example==='string'?def.example.trim().slice(0,320):''
    });
  }
  const withExample=groups.find(item=>item.example);
  return {definition:withExample?.definition||groups[0]?.definition||'',
    example:withExample?.example||''};
}
async function getRelatedExample(term,preferredPart=''){
  const key=term.toLowerCase().trim()+'|'+preferredPart;
  if(relatedExampleSaved[key])return relatedExampleSaved[key];
  if(relatedExampleRequests.has(key))return relatedExampleRequests.get(key);
  const task=enqueueRelatedExample(async()=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7500);
    try{
      const res=await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/'+encodeURIComponent(term),{signal:controller.signal});
      if(!res.ok)return {definition:'',example:'',available:false};
      const data=await res.json();
      if(!Array.isArray(data))return {definition:'',example:'',available:false};
      const result={...englishExampleFromEntries(data,preferredPart),available:true};
      relatedExampleSaved[key]=result;
      if(Object.keys(relatedExampleSaved).length>250)delete relatedExampleSaved[Object.keys(relatedExampleSaved)[0]];
      safeJSONSave(RELATED_EXAMPLES_STORE,relatedExampleSaved);
      return result;
    }catch{return {definition:'',example:'',available:false};}
    finally{clearTimeout(timer);}
  });
  relatedExampleRequests.set(key,task);
  try{return await task;}finally{relatedExampleRequests.delete(key);}
}
function canUpdateRelated(snapshot){return snapshot&&snapshot===lookupSnapshot&&currentState&&snapshot.chapter!==undefined;}
function relatedDetailFor(snapshot,term){
  if(!snapshot.relatedDetails)snapshot.relatedDetails={};
  return snapshot.relatedDetails[term]||(snapshot.relatedDetails[term]={});
}
function refreshRelatedDetail(snapshot,term){
  if(!canUpdateRelated(snapshot))return;
  const detail=relatedDetailFor(snapshot,term);
  const hasExample=Boolean(detail.dictionaryLoaded && detail.example);
  const compact=!hasExample;
  const nodes=snapshot.relatedCards?.get(term)||[];
  for(const node of nodes){
    const meaning=node.querySelector('.related-meaning');
    const example=node.querySelector('.related-example');
    const source=node.querySelector('.related-example-source');
    const translate=node.querySelector('.related-translate-example');
    const translated=node.querySelector('.related-example-translation');
    // Từ không có ví dụ: chỉ hiển thị từ tiếng Anh + nghĩa tiếng Việt, cùng một hàng nếu đủ chỗ.
    // Không tạo các thông báo "không có ví dụ" hay dòng trống chiếm diện tích.
    node.classList.toggle('related-compact',compact);
    if(detail.translation)meaning.textContent=compact?detail.translation:'Nghĩa: '+detail.translation;
    else if(detail.translationError)meaning.textContent='Chưa dịch được nghĩa';
    else meaning.textContent='Đang dịch…';
    source.hidden=!hasExample;
    example.hidden=!hasExample;
    translate.hidden=!hasExample;
    if(hasExample){
      source.textContent='Ví dụ từ điển';
      example.textContent=detail.example;
      translate.textContent=detail.exampleTranslation?'✓ Đã dịch ví dụ':'⇄ Dịch ví dụ';
    }else{
      source.textContent='';
      example.textContent='';
    }
    translated.hidden=!(hasExample&&detail.exampleTranslation);
    translated.textContent=hasExample?(detail.exampleTranslation||''):'';
  }
}
function richRelatedCard(term,group,snapshot){
  const card=document.createElement('article');card.className='related-rich-card related-compact';
  const top=document.createElement('div');top.className='related-rich-top';
  const word=document.createElement('button');word.type='button';word.className='related-word-link';
  word.textContent=term;word.title='Chạm để mở bảng tra đầy đủ: '+term;
  word.addEventListener('click',()=>openLookup({text:term,kind:/\s/.test(term)?'phrase':'word',context:'',chapter:snapshot.chapter}));
  top.append(word);card.append(top);
  const meaning=document.createElement('div');meaning.className='related-meaning';
  const source=document.createElement('small');source.className='related-example-source';source.hidden=true;
  const example=document.createElement('div');example.className='related-example';example.hidden=true;
  const translated=document.createElement('div');translated.className='related-example-translation';translated.hidden=true;
  const translate=document.createElement('button');translate.type='button';translate.className='related-translate-example';
  translate.textContent='⇄ Dịch ví dụ';translate.hidden=true;
  translate.addEventListener('click',async()=>{
    const data=relatedDetailFor(snapshot,term);
    if(!data.example)return;
    if(data.exampleTranslation){translated.hidden=!translated.hidden;return;}
    translate.disabled=true;translate.textContent='Đang dịch ví dụ…';
    const state=currentState;
    try{const result=await cachedLookupTranslation(data.example,state);
      if(!canUpdateRelated(snapshot)||state!==currentState||!card.isConnected)return;
      data.exampleTranslation=result;refreshRelatedDetail(snapshot,term);scheduleSave();
    }catch(e){if(card.isConnected)translate.textContent='Không dịch được · Thử lại';}
    finally{translate.disabled=false;}
  });
  card.append(meaning,source,example,translated,translate);
  if(!snapshot.relatedCards)snapshot.relatedCards=new Map();
  if(!snapshot.relatedCards.has(term))snapshot.relatedCards.set(term,[]);
  snapshot.relatedCards.get(term).push(card);
  refreshRelatedDetail(snapshot,term);
  return card;
}
function renderLookupRelations(snapshot,loading=false){
  const root=$('lookupLexical');if(!root)return;
  const isWord=isEnglishDictionaryWord(snapshot?.text||'');
  root.hidden=!isWord;
  if(!isWord)return;
  snapshot.relatedCards=new Map();
  const info=snapshot.lexical||null;
  const dictionary=snapshot.dictionary||null;
  const forms=info?.forms||{};
  const grid=$('lookupForms');grid.replaceChildren();
  for(const [key,label] of RELATED_GROUPS){
    const values=(forms[key]||[]).slice(0,key==='noun'?3:2);
    if(!values.length)continue;
    const line=document.createElement('div');line.className='lookup-form-row related-rich-row';
    const tag=document.createElement('span');tag.className='lookup-form-label';tag.textContent=label;
    const terms=document.createElement('div');terms.className='lookup-form-items';
    for(const item of values)terms.append(richRelatedCard(item,key,snapshot));
    line.append(tag,terms);grid.append(line);
  }
  $('lookupFormsNote').textContent=loading?'Đang tìm các dạng của từ…':
    grid.childElementCount?'Chạm tên từ để tra thêm. Chỉ hiển thị ví dụ khi từ điển có dữ liệu.':
    (info&&!info.complete?'Chưa kết nối được nguồn dữ liệu họ từ.':'Chưa có dữ liệu về họ từ này.');
  const pos=snapshot.selectedPart;
  const fromDict=(byPos)=>{const group=byPos?.[pos]||[];return group.length?group:Object.values(byPos||{}).flat().slice(0,8);};
  const synonyms=uniqueTerms([...fromDict(dictionary?.synonymsByPos),...(info?.synonyms||[])],snapshot.text,8);
  const antonyms=uniqueTerms([...fromDict(dictionary?.antonymsByPos),...(info?.antonyms||[])],snapshot.text,8);
  for(const [id,noteId,words,label] of [
    ['lookupSynonyms','lookupSynonymsNote',synonyms,'đồng nghĩa'],
    ['lookupAntonyms','lookupAntonymsNote',antonyms,'trái nghĩa']]){
    const target=$(id);target.replaceChildren();
    for(const term of words)target.append(richRelatedCard(term,label==='đồng nghĩa'?'synonym':'antonym',snapshot));
    $(noteId).textContent=loading&&!words.length?'Đang tìm từ '+label+'…':
      words.length?'Hiển thị nghĩa tiếng Việt; chỉ hiện ví dụ khi có dữ liệu từ điển.':
      'Chưa có dữ liệu từ '+label+' phù hợp.';
  }
  scheduleRelatedEnrichment(snapshot);
}
function scheduleRelatedEnrichment(snapshot){
  clearTimeout(snapshot.relatedTimer);
  snapshot.relatedTimer=setTimeout(()=>{
    if(!canUpdateRelated(snapshot))return;
    const terms=[...snapshot.relatedCards.keys()];
    if(!terms.length)return;
    const state=currentState;
    // Song song: tải ví dụ từ nguồn từ điển, nhưng giới hạn 4 yêu cầu đồng thời.
    for(const term of terms){
      const detail=relatedDetailFor(snapshot,term);
      if(detail.dictionaryLoaded)continue;
      const group=[...snapshot.relatedCards.get(term)][0]?.parentElement?.closest('.lookup-form-row')?.querySelector('.lookup-form-label')?.textContent||'';
      const pos=group.startsWith('danh')||group.startsWith('số ')?'noun':group.startsWith('tính')?'adjective':group.startsWith('trạng')?'adverb':group==='động từ'||group.startsWith('V-')?'verb':snapshot.selectedPart||'';
      getRelatedExample(term,pos).then(result=>{
        if(!canUpdateRelated(snapshot)||currentState!==state)return;
        detail.example=result.example||'';detail.definition=result.definition||'';detail.dictionaryLoaded=true;
        refreshRelatedDetail(snapshot,term);
        updateSavedLookupData(snapshot,state);
      });
    }
    translateRelatedMeanings(snapshot,terms,state);
  },130);
}
async function requestRelatedGoogleBatch(terms,targetLanguage=settings.target,sourceLanguage='en'){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  const body={key:googleTranslateKey,q:terms,target:targetLanguage,source:sourceLanguage};
  try{
    let response=null;
    if(location.protocol==='https:'||location.protocol==='http:'){
      try{response=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
        if(response.status===404||response.status===405)response=null;
      }catch(e){if(e.name==='AbortError')throw e;response=null;}
    }
    if(!response)response=await fetch('https://translation.googleapis.com/language/translate/v2',{method:'POST',
      headers:{'Content-Type':'application/json','x-goog-api-key':googleTranslateKey},
      body:JSON.stringify({q:terms,target:targetLanguage,source:sourceLanguage,format:'text'}),signal:controller.signal});
    const data=await response.json();
    if(!response.ok)throw new Error(data?.error?.message||'Không dịch được danh sách từ.');
    const answers=data?.data?.translations;
    if(!Array.isArray(answers)||answers.length!==terms.length)throw new Error('API dịch chưa hỗ trợ dịch nhiều từ một lần.');
    return answers.map(value=>decodeTranslationHtml(value?.translatedText||''));
  }finally{clearTimeout(timer);}
}
async function translateRelatedMeanings(snapshot,terms,state){
  const targetLanguage=settings.target;
  const pending=terms.filter(term=>!relatedDetailFor(snapshot,term).translation);
  const missing=[];
  for(const term of pending){
    const cache=state?.lookupCache?.[lookupTranslationKey(term)];
    if(typeof cache==='string'&&cache){relatedDetailFor(snapshot,term).translation=cache;refreshRelatedDetail(snapshot,term);}
    else missing.push(term);
  }
  if(!missing.length||!canUpdateRelated(snapshot))return;
  if(googleTranslateKey&&targetLanguage!=='en'){
    for(let i=0;i<missing.length;i+=20){
      const batch=missing.slice(i,i+20);
      try{
        const translations=await requestRelatedGoogleBatch(batch);
        if(!canUpdateRelated(snapshot)||currentState!==state||settings.target!==targetLanguage)return;
        for(let j=0;j<batch.length;j++){
          const term=batch[j],answer=translations[j];if(!answer)continue;
          relatedDetailFor(snapshot,term).translation=answer;
          state.lookupCache[lookupTranslationKey(term)]=answer;
          refreshRelatedDetail(snapshot,term);
        }
        scheduleSave();updateSavedLookupData(snapshot,state);
      }catch{
        // Nếu proxy cũ chưa hỗ trợ q dạng mảng, dịch từng từ để tương thích.
        await translateRelatedIndividually(snapshot,batch,state);
      }
    }
  }else await translateRelatedIndividually(snapshot,missing,state);
}
async function translateRelatedIndividually(snapshot,terms,state){
  let next=0;
  async function worker(){
    while(next<terms.length&&canUpdateRelated(snapshot)){
      const term=terms[next++];
      try{
        const meaning=await cachedLookupTranslation(term,state);
        if(!canUpdateRelated(snapshot)||currentState!==state)return;
        relatedDetailFor(snapshot,term).translation=meaning;
      }catch{relatedDetailFor(snapshot,term).translationError=true;}
      refreshRelatedDetail(snapshot,term);
    }
  }
  await Promise.all(Array.from({length:Math.min(3,terms.length)},worker));
  if(canUpdateRelated(snapshot))updateSavedLookupData(snapshot,state);
}
/* V16: Dịch từng định nghĩa tiếng Anh sang tiếng Việt theo đúng thứ tự.
   Lưu bộ nhớ đệm riêng cho định nghĩa, dùng lại khi mở sách/từ ở lần tiếp theo.
   Không gửi sách lên máy chủ: chỉ gửi tối đa ba định nghĩa đang được hiển thị. */
function definitionVietnameseKey(english){
  return 'en>vi|'+String(english||'').normalize('NFC').replace(/\s+/g,' ').trim().toLocaleLowerCase('en');
}
function saveVietnameseDefinition(english,translation){
  const clean=String(translation||'').trim();if(!clean)return;
  const key=definitionVietnameseKey(english);dictionaryDefinitionsVi[key]=clean;
  const keys=Object.keys(dictionaryDefinitionsVi);
  if(keys.length>220)for(const old of keys.slice(0,keys.length-220))delete dictionaryDefinitionsVi[old];
  safeJSONSave(DICTIONARY_DEFINITIONS_VI_STORE,dictionaryDefinitionsVi);
}
async function requestFreeDefinitionVietnamese(english){
  if(english.length>480)throw new Error('Định nghĩa dài; cần Google Cloud Translation API Key.');
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),11000);
  try{
    const url='https://api.mymemory.translated.net/get?q='+encodeURIComponent(english)+'&langpair=en%7Cvi';
    const response=await fetch(url,{signal:controller.signal});
    if(!response.ok)throw new Error('Không kết nối dịch miễn phí.');
    const json=await response.json();
    const translated=String(json?.responseData?.translatedText||'').trim();
    if(Number(json?.responseStatus)!==200||!translated||/MYMEMORY WARNING|YOU USED ALL AVAILABLE FREE TRANSLATIONS/i.test(translated))throw new Error('Dịch miễn phí chưa khả dụng.');
    return decodeTranslationHtml(translated);
  }finally{clearTimeout(timer);}
}
function loadDictionaryDefinitionTranslations(definitions){
  const unique=[...new Set(definitions.map(t=>String(t||'').trim()).filter(Boolean))];
  const missing=unique.filter(text=>!dictionaryDefinitionsVi[definitionVietnameseKey(text)]&&!dictionaryDefinitionRequests.has(definitionVietnameseKey(text)));
  if(missing.length){
    let batch;
    if(googleTranslateKey){
      batch=requestRelatedGoogleBatch(missing,'vi','en').catch(()=>Promise.all(missing.map(text=>requestGoogleTranslation(text,{source:'en',target:'vi'}))));
    }else{
      // Tối đa ba định nghĩa hiện trên màn hình, không dịch cả từ điển hàng loạt.
      batch=Promise.all(missing.map(requestFreeDefinitionVietnamese));
    }
    missing.forEach((english,index)=>{
      const key=definitionVietnameseKey(english);
      const task=batch.then(values=>{
        const vi=String(values[index]||'').trim();if(!vi)throw new Error('Bản dịch rỗng.');
        saveVietnameseDefinition(english,vi);return vi;
      });
      dictionaryDefinitionRequests.set(key,task);
      task.finally(()=>{if(dictionaryDefinitionRequests.get(key)===task)dictionaryDefinitionRequests.delete(key);}).catch(()=>{});
    });
  }
  return Promise.all(unique.map(async english=>{
    const key=definitionVietnameseKey(english);
    if(dictionaryDefinitionsVi[key])return {english,translation:dictionaryDefinitionsVi[key]};
    try{return {english,translation:await dictionaryDefinitionRequests.get(key)};}
    catch{return {english,translation:''};}
  }));
}
function hydrateDictionaryDefinitionTranslations(items,snapshot,token){
  const pending=items.filter(item=>!dictionaryDefinitionsVi[definitionVietnameseKey(item.english)]);
  if(!pending.length)return;
  loadDictionaryDefinitionTranslations(pending.map(item=>item.english)).then(results=>{
    const translations=new Map(results.map(r=>[definitionVietnameseKey(r.english),r.translation]));
    for(const item of pending){
      // Nếu người dùng đóng bảng tra hoặc chuyển từ/loại từ, không ghi lên nội dung mới.
      if(!item.node.isConnected||lookupSnapshot!==snapshot||lookupToken!==token)continue;
      const value=translations.get(definitionVietnameseKey(item.english));
      item.node.classList.remove('is-pending');
      if(value){item.node.textContent=value;item.node.classList.remove('is-error');}
      else{
        item.node.textContent='Chưa dịch được — chạm để thử lại';
        item.node.classList.add('is-error');
        item.node.setAttribute('role','button');item.node.tabIndex=0;
        const retry=()=>{
          item.node.removeAttribute('role');item.node.removeAttribute('tabindex');item.node.classList.remove('is-error');
          item.node.classList.add('is-pending');item.node.textContent='Đang dịch sang tiếng Việt…';
          hydrateDictionaryDefinitionTranslations([item],snapshot,token);
        };
        item.node.addEventListener('click',retry,{once:true});
        item.node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();item.node.click();}},{once:true});
      }
    }
  }).catch(()=>{});
}
function lookupTranslationKey(text){return `${settings.source}|${settings.target}|${text.toLocaleLowerCase().trim()}`;}
async function cachedLookupTranslation(text, state){
  const cacheKey=lookupTranslationKey(text);
  if(typeof state?.lookupCache?.[cacheKey]==='string')return state.lookupCache[cacheKey];
  const requestKey=(currentBook?.id||'')+'|'+cacheKey;
  if(lookupRequests.has(requestKey))return lookupRequests.get(requestKey);
  const request=translateText(text).then(result=>{
    if(state?.lookupCache){state.lookupCache[cacheKey]=result;
      if(Object.keys(state.lookupCache).length>350)delete state.lookupCache[Object.keys(state.lookupCache)[0]];
      if(currentState===state)scheduleSave();}
    return result;
  });
  lookupRequests.set(requestKey,request);
  try{return await request;}finally{lookupRequests.delete(requestKey);}
}
function meaningOverrideKey(snapshot,target=settings.target){
  const norm=s=>String(s||'').normalize('NFC').replace(/\s+/g,' ').trim().toLocaleLowerCase();
  return JSON.stringify([target,norm(snapshot.text),norm(snapshot.context)]);
}
function currentMeaningOverride(snapshot,state){
  return state?.meaningOverrides?.[meaningOverrideKey(snapshot)]||null;
}
function setLookupMeaningDisplay(snapshot){
  setNodeText('lookupResult',snapshot.translation||'Chưa có bản dịch.');
  $('manualMeaningHint').hidden=!snapshot.manualMeaning;
  $('resetLookupMeaning').hidden=!snapshot.manualMeaning;
}
function toggleLookupMeaningEditor(open){
  $('lookupMeaningEditor').hidden=!open;
  if(open){$('lookupMeaningInput').value=lookupSnapshot?.translation||'';$('lookupMeaningInput').focus();}
}
function saveEditedLookupMeaning(){
  const snapshot=lookupSnapshot;
  if(!snapshot||!currentState)return;
  const value=$('lookupMeaningInput').value.replace(/\s+/g,' ').trim();
  if(!value)return notify('Hãy nhập nghĩa đúng trước khi lưu.');
  if(!currentState.meaningOverrides)currentState.meaningOverrides={};
  currentState.meaningOverrides[meaningOverrideKey(snapshot)]={value,updatedAt:Date.now()};
  snapshot.translation=value;snapshot.manualMeaning=true;
  latestTranslation=value;setLookupMeaningDisplay(snapshot);toggleLookupMeaningEditor(false);
  updateSavedLookupData(snapshot,currentState);scheduleSave();
  notify('Đã lưu nghĩa theo đúng câu này. Lần tra lại sẽ ưu tiên nghĩa đã sửa.');
}
async function resetEditedLookupMeaning(){
  const snapshot=lookupSnapshot;if(!snapshot||!currentState)return;
  if(currentState.meaningOverrides)delete currentState.meaningOverrides[meaningOverrideKey(snapshot)];
  snapshot.manualMeaning=false;snapshot.translation='';
  setLookupMeaningDisplay(snapshot);toggleLookupMeaningEditor(false);scheduleSave();
  const token=lookupToken,state=currentState;
  try{const value=await cachedLookupTranslation(snapshot.text,state);
    if(token!==lookupToken||state!==currentState||lookupSnapshot!==snapshot)return;
    snapshot.translation=value;setLookupMeaningDisplay(snapshot);updateSavedLookupData(snapshot,state);
  }catch(e){setNodeText('lookupResult','Không lấy được bản dịch: '+e.message);}
}
async function translateLookupContext(){
  const snapshot=lookupSnapshot,state=currentState,token=lookupToken;
  if(!snapshot?.context||!state)return;
  const el=$('lookupContextTranslation'),btn=$('translateLookupContext');
  el.hidden=false;el.textContent='Đang dịch cả câu…';btn.disabled=true;
  try{const result=await cachedLookupTranslation(snapshot.context,state);
    if(token===lookupToken&&snapshot===lookupSnapshot&&state===currentState){el.textContent=result;btn.textContent='✓ Đã dịch câu';snapshot.contextTranslation=result;
      const saved=state.words?.find(w=>w.kind==='sentence'&&w.chapter===snapshot.chapter&&w.source===snapshot.context);
      if(saved){saved.translation=result;renderWords();scheduleSave();}
    }}
  catch(e){if(token===lookupToken)el.textContent='Không thể dịch cả câu: '+e.message;}
  finally{btn.disabled=false;}
}
function updateSavedLookupData(snapshot,state){
  if(!snapshot||currentState!==state)return;
  let changed=false;
  for(const entry of state.words){
    if(entry.source!==snapshot.text || entry.chapter!==snapshot.chapter || entry.kind==='sentence' || (entry.context||'')!==(snapshot.context||''))continue;
    if(snapshot.translation&&(snapshot.manualMeaning || !entry.translation || entry.translation==='(Chưa có bản dịch)' || entry.manualMeaning)){entry.translation=snapshot.translation;entry.manualMeaning=!!snapshot.manualMeaning;changed=true;}
    if(snapshot.partOfSpeech&&entry.partOfSpeech!==snapshot.partOfSpeech){entry.partOfSpeech=snapshot.partOfSpeech;changed=true;}
    if(snapshot.phonetic&&!entry.phonetic){entry.phonetic=snapshot.phonetic;changed=true;}
    if(snapshot.dictionary?.phoneticUK&&!entry.phoneticUK){entry.phoneticUK=snapshot.dictionary.phoneticUK;changed=true;}
    if(snapshot.dictionary?.phoneticUS&&!entry.phoneticUS){entry.phoneticUS=snapshot.dictionary.phoneticUS;changed=true;}
    if(snapshot.lexical?.complete){
      const enriched=JSON.stringify(snapshot.lexical);
      if(JSON.stringify(entry.relatedWords||null)!==JSON.stringify({...snapshot.lexical,details:snapshot.relatedDetails||{}})){entry.relatedWords={...snapshot.lexical,details:snapshot.relatedDetails||{}};changed=true;}
    }
  }
  if(changed){renderWords();scheduleSave();}
}
async function openLookup(detail){
  if(!currentBook)return;
  let info=detail&&typeof detail==='object'&&typeof detail.text==='string'?detail:getSelectionDetails();
  if(!info&&selectedLookupInfo)info=selectedLookupInfo;
  if(!info&&selectedText)info={text:selectedText,context:'',kind:/\s/u.test(selectedText)?'phrase':'word',chapter:currentIndex};
  if(!info?.text)return notify('Hãy chạm một từ hoặc bôi đen cụm từ trong sách.');
  const text=info.text.replace(/\s+/g,' ').trim().slice(0,3000);
  if(!text)return;
  const token=++lookupToken;
  const state=currentState;
  lookupSnapshot={text,context:info.context||'',kind:info.kind||(/\s/u.test(text)?'phrase':'word'),chapter:Number.isInteger(info.chapter)?info.chapter:currentIndex,translation:'',phonetic:'',partOfSpeech:'',manualMeaning:false,dictionary:null,lexical:null,selectedPart:''};
  const snapshot=lookupSnapshot;
  selectedText='';selectedLookupInfo=null;$('selectionPanel').hidden=true;
  $('translationModal').hidden=false;
  setNodeText('lookupTitle',snapshot.kind==='sentence'?'Tra câu':snapshot.kind==='phrase'?'Tra cụm từ':'Tra từ nhanh');
  setNodeText('lookupSource',text);
  setNodeText('lookupMeaningLabel','BẢN DỊCH SANG '+({vi:'TIẾNG VIỆT',en:'TIẾNG ANH',zh:'TIẾNG TRUNG'}[settings.target]||'NGÔN NGỮ ĐÍCH'));
  const storedPos=state?.partOfSpeechOverrides?.[meaningOverrideKey(snapshot)];
  if(storedPos)snapshot.selectedPart=storedPos;
  const storedOverride=currentMeaningOverride(snapshot,state);
  if(storedOverride?.value){snapshot.translation=storedOverride.value;snapshot.manualMeaning=true;}
  setNodeText('lookupResult',snapshot.manualMeaning?snapshot.translation:'Đang lấy bản dịch…');
  $('manualMeaningHint').hidden=!snapshot.manualMeaning;
  $('resetLookupMeaning').hidden=!snapshot.manualMeaning;
  toggleLookupMeaningEditor(false);
  setNodeText('lookupContext',snapshot.context||'');
  $('lookupContextBox').hidden=!snapshot.context||snapshot.context===snapshot.text;
  $('lookupContextTranslation').hidden=true;setNodeText('lookupContextTranslation','');
  $('translateLookupContext').textContent='⇄ Dịch cả câu để hiểu nghĩa theo ngữ cảnh';
  $('saveWordButton').textContent=snapshot.kind==='phrase'?'☆ Lưu cụm từ':'☆ Lưu từ';
  $('saveSentenceButton').disabled=!snapshot.context;
  $('saveBothButton').disabled=!snapshot.context;
  renderDictionaryInfo(null);
  renderLookupRelations(snapshot,isEnglishDictionaryWord(text));
  setNodeText('lookupDictionaryStatus',isEnglishDictionaryWord(text)?'Đang tra phiên âm và loại từ…':'Phiên âm và loại từ: chỉ hỗ trợ từ đơn tiếng Anh khi từ điển có dữ liệu.');
  latestTranslation='';
  // Hiển thị ngay, không chờ cả dịch và từ điển; gọi song song.
  if(isEnglishDictionaryWord(text))getDictionaryEntry(text).then(entry=>{
    if(token!==lookupToken||currentState!==state||lookupSnapshot!==snapshot)return;
    if(entry){snapshot.dictionary=entry;snapshot.phonetic=entry.phonetic;snapshot.selectedPart=(snapshot.selectedPart&&entry.parts?.includes(snapshot.selectedPart))?snapshot.selectedPart:(entry.parts?.[0]||'');snapshot.partOfSpeech=PART_OF_SPEECH[snapshot.selectedPart]||snapshot.selectedPart||'';renderDictionaryInfo(entry);
      setNodeText('lookupDictionaryStatus',entry.phonetic||entry.partOfSpeech?'Thông tin từ điển tiếng Anh':'Từ điển chưa có phiên âm hoặc loại từ');}
    else setNodeText('lookupDictionaryStatus','Không tìm thấy thông tin từ điển, vẫn có thể lưu từ.');
    renderLookupRelations(snapshot,!snapshot.lexical);
    updateSavedLookupData(snapshot,state);
  });
  if(isEnglishDictionaryWord(text))getLexicalRelations(text).then(info=>{
    if(token!==lookupToken||currentState!==state||lookupSnapshot!==snapshot)return;
    snapshot.lexical=info;
    renderLookupRelations(snapshot,false);
    updateSavedLookupData(snapshot,state);
  }).catch(()=>{
    if(token!==lookupToken||currentState!==state||lookupSnapshot!==snapshot)return;
    snapshot.lexical={forms:{},synonyms:[],antonyms:[],complete:false};
    renderLookupRelations(snapshot,false);
  });
  if(!snapshot.manualMeaning){
    cachedLookupTranslation(text,state).then(translated=>{
      if(token!==lookupToken||currentState!==state||lookupSnapshot!==snapshot||snapshot.manualMeaning)return;
      snapshot.translation=translated;latestTranslation=translated;
      setLookupMeaningDisplay(snapshot);updateSavedLookupData(snapshot,state);
    }).catch(error=>{
      if(token!==lookupToken||currentState!==state||lookupSnapshot!==snapshot||snapshot.manualMeaning)return;
      setNodeText('lookupResult','Không thể dịch: '+error.message+'\nBạn có thể chọn “Mở Google Dịch”.');
    });
  }
}
function saveLookupEntry(mode){
  if(!currentBook||!lookupSnapshot||!currentState)return;
  const snapshot=lookupSnapshot;
  if(snapshot.kind==='sentence'&&mode==='both')mode='sentence';
  const entries=[];
  if(mode==='term'||mode==='both')entries.push({
    kind:snapshot.kind==='sentence'?'sentence':snapshot.kind==='phrase'?'phrase':'word',
    source:snapshot.text,translation:snapshot.translation||'',phonetic:snapshot.phonetic||'',phoneticUK:snapshot.dictionary?.phoneticUK||'',phoneticUS:snapshot.dictionary?.phoneticUS||'',partOfSpeech:snapshot.partOfSpeech||'',manualMeaning:!!snapshot.manualMeaning,
    context:snapshot.context||'',chapter:snapshot.chapter,created:Date.now(),
    relatedWords:snapshot.lexical?.complete?{...snapshot.lexical,details:snapshot.relatedDetails||{}}:null});
  if((mode==='sentence'||mode==='both')&&snapshot.context)entries.push({
    kind:'sentence',source:snapshot.context,translation:snapshot.contextTranslation||'',context:snapshot.context,
    chapter:snapshot.chapter,created:Date.now()});
  let count=0;
  entries.forEach(entry=>{
    const existing=currentState.words.find(w=>w.kind===entry.kind&&w.source===entry.source&&w.chapter===entry.chapter);
    if(existing){if(!existing.context&&entry.context)existing.context=entry.context;
      if(entry.translation&&(entry.manualMeaning||!existing.translation)){existing.translation=entry.translation;existing.manualMeaning=!!entry.manualMeaning;}
      if(entry.phoneticUK)existing.phoneticUK=entry.phoneticUK;
      if(entry.phoneticUS)existing.phoneticUS=entry.phoneticUS;
      if(entry.partOfSpeech)existing.partOfSpeech=entry.partOfSpeech;
      if(entry.relatedWords)existing.relatedWords=entry.relatedWords;return;}
    currentState.words.push(entry);count++;
  });
  renderWords();scheduleSave();notify(count?`Đã lưu ${count} mục vào sổ tay.`:'Nội dung này đã có trong sổ tay.');
}
function saveWord(){saveLookupEntry('term');}
function saveSentenceFromLookup(){saveLookupEntry('sentence');}
function saveBothFromLookup(){saveLookupEntry('both');}
function searchBook(){
  const term=$('searchInput').value.trim();const list=$('searchResults');list.replaceChildren();
  if(!currentBook)return list.append(emptyNote('Hãy mở sách trước khi tìm kiếm.'));
  if(term.length<2)return list.append(emptyNote('Nhập ít nhất 2 ký tự để tìm kiếm.'));
  const lowered=term.toLocaleLowerCase();let total=0;
  currentBook.chapters.forEach((chapter,index)=>{
    const text=chapter.plain||'';
    const haystack=text.toLocaleLowerCase();
    let pos=haystack.indexOf(lowered);let matches=0;
    while(pos>=0&&matches<6&&total<120){
      const snippet=shortText(text.slice(Math.max(0,pos-70),Math.min(text.length,pos+term.length+110)),175);
      const btn=document.createElement('button');btn.className='search-item';
      const heading=document.createElement('strong');heading.textContent=chapter.title;
      const excerpt=document.createElement('span');excerpt.textContent='…'+snippet+'…';
      btn.append(heading,excerpt);btn.addEventListener('click',()=>{
        $('searchModal').hidden=true;
        displayChapter(index,0).then(()=>scrollToMatch(term)).catch(e=>notify(e.message));
      });list.append(btn);matches++;total++;
      pos=haystack.indexOf(lowered,pos+term.length);
    }
  });
  if(!total)list.append(emptyNote('Không tìm thấy từ khóa trong cuốn sách này.'));
  else if(total>=120){const note=emptyNote('Hiển thị tối đa 120 kết quả đầu tiên. Hãy tìm cụm từ cụ thể hơn.');list.append(note);}
}
function scrollToMatch(term){
  const root=$('readerContent');const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let node;
  while(node=walker.nextNode()){
    const index=(node.textContent||'').toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
    if(index>=0){const range=document.createRange();range.setStart(node,index);range.setEnd(node,Math.min(node.textContent.length,index+term.length));
      const rect=range.getBoundingClientRect();if(rect){const sc=$('readingScroller');sc.scrollTop+=rect.top-sc.getBoundingClientRect().top-95;updateScrollPosition();}
      break;
    }
  }
}
function languageForSpeech(text){
  const source=resolveSource(text);
  return ({zh:'zh-CN',vi:'vi-VN',en:'en-US',fr:'fr-FR',ja:'ja-JP',ko:'ko-KR'})[source]||'vi-VN';
}
function listVoices(){
  if(!('speechSynthesis' in window))return;
  const voices=speechSynthesis.getVoices();
  const select=$('voiceSelect');select.replaceChildren();
  const defaultOpt=new Option('Giọng mặc định theo ngôn ngữ','');select.append(defaultOpt);
  voices.forEach(v=>{select.append(new Option(`${v.name} (${v.lang})`,v.voiceURI));});
  select.value=settings.voice;
  if(![...select.options].some(o=>o.value===settings.voice))select.value='';
}
// Giữ đoạn phát nhỏ hơn 3500 byte UTF-8 / request, để không vượt hạn mức 5000 byte của Google.
function splitCloudSpeech(text,maxBytes=3400){
  const clean=String(text||'').replace(/\s+/g,' ').trim();
  if(!clean)return [];
  const enc=new TextEncoder();const pieces=clean.match(/[^.!?。！？]+[.!?。！？]*\s*/gu)||[clean];
  const out=[];let buffer='';
  function push(){if(buffer.trim())out.push(buffer.trim());buffer='';}
  function appendPart(part){
    part=part.trim();if(!part)return;
    if(enc.encode(part).length>maxBytes){
      push();let remaining=part;
      while(remaining){
        let lo=1,hi=remaining.length,best=1;
        while(lo<=hi){const mid=(lo+hi)>>1;if(enc.encode(remaining.slice(0,mid)).length<=maxBytes){best=mid;lo=mid+1;}else hi=mid-1;}
        let cut=remaining.lastIndexOf(' ',best);if(cut<best/2)cut=best;
        out.push(remaining.slice(0,cut).trim());remaining=remaining.slice(cut).trim();
      }
    }else if(enc.encode(buffer+(buffer?' ':'')+part).length>maxBytes){push();buffer=part;}
    else buffer+=(buffer?' ':'')+part;
  }
  for(const piece of pieces)appendPart(piece);push();return out.filter(Boolean);
}
function splitSpeech(text,max=180){
  const pieces=String(text||'').replace(/\s+/g,' ').match(/[^.!?。！？;；]+[.!?。！？;；]?/gu)||[text];
  const out=[];let acc='';
  function push(){if(acc.trim())out.push(acc.trim());acc='';}
  for(const raw of pieces){let sentence=raw.trim();if(!sentence)continue;
    if(sentence.length>max){push();while(sentence.length>max){let cut=sentence.lastIndexOf(' ',max);if(cut<max/3)cut=max;out.push(sentence.slice(0,cut).trim());sentence=sentence.slice(cut).trim();}}
    if((acc+' '+sentence).length>max)push();acc+=(acc?' ':'')+sentence;
  }
  push();return out;
}
function cloudSpeechLanguage(text=''){
  if(settings.ttsLanguage==='vi'||settings.ttsLanguage==='en')return settings.ttsLanguage;
  const lang=resolveSource(text||currentBook?.chapters?.[currentIndex]?.plain?.slice(0,2000)||'');
  return lang==='vi'?'vi':lang==='en'?'en':null;
}
function updateTtsVoiceOptions(){
  const visible=settings.ttsEngine==='google';$('cloudTtsSettings').hidden=!visible;
  // Giữ riêng lựa chọn theo ngôn ngữ. Dùng khóa hợp lệ thì luôn có một giọng mặc định.
  const source=currentBook?.chapters?.[currentIndex]?.plain?.slice(0,1500)||'';
  const language=cloudSpeechLanguage(source)||'vi';
  const voices=CLOUD_VOICES[language];const sel=$('cloudVoice');sel.replaceChildren();
  voices.forEach(v=>sel.append(new Option(v.label+' ('+v.name+')',v.name)));
  if(voices.some(v=>v.name===settings.cloudVoice))sel.value=settings.cloudVoice;
  else {sel.value=voices[0].name;settings.cloudVoice=sel.value;}
  $('voiceSelect').disabled=visible;
}
function refreshTtsKeyUI(){
  const input=$('googleTtsKeyInput');if(document.activeElement!==input)input.value=googleTtsKey;
  let saved=false;try{saved=!!localStorage.getItem(GOOGLE_TTS_KEY_STORE);}catch{}
  $('rememberTtsKey').checked=saved;
  setNodeText('googleTtsStatus',googleTtsKey?'✓ Đã nhập khóa Google Cloud TTS · chưa xác minh':'Chưa có khóa TTS · giọng miễn phí vẫn hoạt động');
}
function saveGoogleTtsKey(){
  googleTtsKey=$('googleTtsKeyInput').value.trim();
  try{if(googleTtsKey && $('rememberTtsKey').checked)localStorage.setItem(GOOGLE_TTS_KEY_STORE,googleTtsKey);
    else localStorage.removeItem(GOOGLE_TTS_KEY_STORE);}catch{notify('Không lưu được khóa TTS, chỉ dùng trong phiên này.');}
  refreshTtsKeyUI();notify(googleTtsKey?'Đã áp dụng Google Cloud TTS API Key.':'Đã bỏ khóa TTS.');
}
function removeGoogleTtsKey(){googleTtsKey='';$('googleTtsKeyInput').value='';
  try{localStorage.removeItem(GOOGLE_TTS_KEY_STORE);}catch{}
  refreshTtsKeyUI();notify('Đã xóa khóa TTS trên thiết bị.');
}
async function requestCloudAudio(text,{key=googleTtsKey,voiceName=settings.cloudVoice,signal}={}){
  if(!key)throw new Error('Chưa nhập API Key cho Google Cloud Text-to-Speech trong Cài đặt.');
  if(new TextEncoder().encode(text).length>3500)throw new Error('Đoạn đọc quá dài.');
  const languageCode=voiceName.slice(0,5);
  if(!Object.values(CLOUD_VOICES).flat().some(v=>v.name===voiceName))throw new Error('Giọng Google Cloud không hỗ trợ.');
  const body={key,text,voiceName,languageCode,rate:settings.rate};
  let response=null;
  if(location.protocol==='https:'||location.protocol==='http:'){
    try{response=await fetch('/api/tts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
      if(response.status===404||response.status===405)response=null;
    }catch(e){if(e.name==='AbortError')throw e;response=null;}
  }
  if(!response){
    const audioConfig={audioEncoding:'MP3'};
    if(!voiceName.includes('Chirp3-HD'))audioConfig.speakingRate=Number(settings.rate);
    response=await fetch('https://texttospeech.googleapis.com/v1/text:synthesize',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify({input:{text},voice:{languageCode,name:voiceName},audioConfig}),signal});
  }
  let result;try{result=await response.json();}catch{throw new Error('Máy chủ TTS không trả JSON hợp lệ.');}
  if(!response.ok)throw new Error(String(result?.error?.message||'Google Cloud TTS báo lỗi '+response.status).slice(0,300));
  if(!result.audioContent)throw new Error('Không nhận được tệp âm thanh từ Google Cloud.');
  const binary=atob(result.audioContent);const data=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)data[i]=binary.charCodeAt(i);
  return new Blob([data],{type:'audio/mpeg'});
}
async function testGoogleTtsKey(){
  saveGoogleTtsKey();if(!googleTtsKey)return notify('Nhập API Key TTS trước khi nghe thử.');
  $('testGoogleTtsKey').disabled=true;setNodeText('googleTtsStatus','Đang kiểm tra giọng cao cấp (có thể tính phí)…');
  const language=cloudSpeechLanguage(currentBook?.chapters?.[currentIndex]?.plain?.slice(0,1500)||'')||'vi';
  const sample=language==='en'?'Hello! Welcome to your personal library.':'Xin chào! Chúc bạn đọc sách vui vẻ.';
  try{stopSpeech();const blob=await requestCloudAudio(sample);const audio=$('cloudAudio');
    speech.url=URL.createObjectURL(blob);audio.src=speech.url;$('cloudPlayer').hidden=false;
    setNodeText('cloudPlayerStatus','Nghe thử giọng '+settings.cloudVoice);
    setNodeText('googleTtsStatus','✓ Kết nối thành công · đã nhận mẫu MP3 từ Google');
    try{await audio.play();}catch{notify('Đã tạo âm thanh mẫu. Bấm ▶ trên thanh âm thanh để nghe.');}
  }catch(e){setNodeText('googleTtsStatus','✕ '+e.message);notify('TTS: '+e.message,6500);}
  finally{$('testGoogleTtsKey').disabled=false;}
}
function stopSpeech(){
  speech.token++;speech.speaking=false;speech.paused=false;speech.chunks=[];speech.index=0;
  if(speech.controller){speech.controller.abort();speech.controller=null;}
  const audio=$('cloudAudio');if(audio){audio.onended=null;audio.onerror=null;audio.pause();audio.removeAttribute('src');audio.load();}
  if(speech.url){URL.revokeObjectURL(speech.url);speech.url=null;}
  if('speechSynthesis' in window)speechSynthesis.cancel();
  $('cloudPlayer').hidden=true;
  $('readAloudButton').innerHTML='▶ <span class="hide-small">Nghe sách</span>';
}
function startDeviceSpeech(text){
  if(!('speechSynthesis' in window))return notify('Trình duyệt này không hỗ trợ giọng đọc miễn phí.');
  stopSpeech();const chunks=splitSpeech(text);
  if(!chunks.length)return notify('Không có văn bản để đọc.');
  speech.mode='device';speech.speaking=true;speech.chunks=chunks;speech.index=0;
  const token=speech.token;
  $('readAloudButton').innerHTML='❚❚ <span class="hide-small">Tạm dừng</span>';
  function next(){
    if(token!==speech.token||!speech.speaking||speech.paused)return;
    if(speech.index>=speech.chunks.length){stopSpeech();notify('Đã đọc hết đoạn / chương.');return;}
    const chunk=speech.chunks[speech.index++];
    const utter=new SpeechSynthesisUtterance(chunk);
    utter.lang=languageForSpeech(chunk);utter.rate=Number(settings.rate);utter.pitch=1;
    const voice=speechSynthesis.getVoices().find(v=>v.voiceURI===settings.voice);
    if(voice)utter.voice=voice;
    utter.onend=()=>next();
    utter.onerror=e=>{if(token!==speech.token)return;stopSpeech();notify('Giọng đọc không hoạt động: '+(e.error||'không xác định'));};
    speechSynthesis.speak(utter);
  }
  next();
}
async function startCloudSpeech(text){
  if(!googleTtsKey)return notify('Vào Cài đặt → Giọng cao cấp để nhập Google Cloud Text-to-Speech API Key.');
  const language=cloudSpeechLanguage(text);
  if(!language)return notify('Hiện giọng cao cấp hỗ trợ tiếng Việt và tiếng Anh. Chọn đúng ngôn ngữ giọng đọc trong Cài đặt.');
  if(!CLOUD_VOICES[language].some(v=>v.name===settings.cloudVoice)){settings.cloudVoice=CLOUD_VOICES[language][0].name;updateTtsVoiceOptions();saveSettings();}
  if(text.length>12000){
    const approved=window.confirm(`Bạn sắp sử dụng Google Cloud TTS cho khoảng ${text.length.toLocaleString('vi-VN')} ký tự. Nhiều đoạn MP3 sẽ được tạo qua API và có thể phát sinh phí. Tiếp tục?`);
    if(!approved)return;
  }
  const chunks=splitCloudSpeech(text);
  if(!chunks.length)return notify('Không có văn bản để đọc.');
  stopSpeech();speech.mode='google';speech.speaking=true;speech.index=0;speech.chunks=chunks;
  const token=speech.token, voiceName=settings.cloudVoice;
  const audio=$('cloudAudio');$('cloudPlayer').hidden=false;
  $('readAloudButton').innerHTML='❚❚ <span class="hide-small">Dừng nghe</span>';
  async function next(){
    if(token!==speech.token||!speech.speaking)return;
    if(speech.index>=speech.chunks.length){stopSpeech();notify('Đã nghe hết nội dung.');return;}
    const number=++speech.index;
    setNodeText('cloudPlayerStatus',`Đang tạo âm thanh ${number}/${speech.chunks.length} · có thể tính phí`);
    const controller=new AbortController();speech.controller=controller;
    try{
      const blob=await requestCloudAudio(speech.chunks[number-1],{voiceName,signal:controller.signal});
      if(token!==speech.token)return;
      speech.controller=null;
      if(speech.url)URL.revokeObjectURL(speech.url);
      speech.url=URL.createObjectURL(blob);audio.src=speech.url;
      setNodeText('cloudPlayerStatus',`Đang nghe ${number}/${speech.chunks.length} · ${voiceName}`);
      audio.onended=next;
      try{await audio.play();}catch(e){
        if(e.name==='NotAllowedError')notify('Trình duyệt yêu cầu thao tác phát: hãy bấm ▶ trong thanh âm thanh để nghe.',5500);
        else if(e.name!=='AbortError')throw e;
      }
    }catch(e){if(token!==speech.token||e.name==='AbortError')return;
      setNodeText('cloudPlayerStatus','Lỗi: '+e.message);
      speech.speaking=false;$('readAloudButton').innerHTML='▶ <span class="hide-small">Nghe sách</span>';
      notify('Không đọc được giọng cao cấp: '+e.message,6500);
    }
  }
  next();
}
function speakText(text){
  if(settings.ttsEngine==='google')return startCloudSpeech(text);
  return startDeviceSpeech(text);
}
function toggleSpeak(){
  if(!currentBook)return notify('Hãy chọn sách trước.');
  if(speech.speaking){
    if(speech.mode==='google'){stopSpeech();return;}
    if(speech.paused){speech.paused=false;speechSynthesis.resume();$('readAloudButton').innerHTML='❚❚ <span class="hide-small">Tạm dừng</span>';}
    else{speech.paused=true;speechSynthesis.pause();$('readAloudButton').innerHTML='▶ <span class="hide-small">Tiếp tục</span>';}
    return;
  }
  speakText(currentBook.chapters[currentIndex].plain);
}
async function refreshLibrary(){
  try{savedBooks=(await dbAll('books')).sort((a,b)=>b.added-a.added);
    // Đọc thêm tiến độ từ cửa hàng trạng thái để hiển thị cạnh tên sách.
    const states=await dbAll('states');const byId=new Map(states.map(s=>[s.id,s]));
    savedBooks.forEach(b=>{b.progress=byId.get(b.id)?.progress||0;});
    $('storageLabel').textContent='';
  }catch(e){$('storageLabel').textContent='(bị hạn chế lưu trữ)';console.warn(e);}
  renderLibrary();
}
function attachHandlers(){
  const choose=()=>$('fileInput').click();
  $('importButton').addEventListener('click',choose);
  $('welcomeImport').addEventListener('click',choose);
  $('fileInput').addEventListener('change',e=>{importFiles(e.target.files).finally(()=>e.target.value='');});
  $('menuButton').addEventListener('click',openDrawer);$('closeSidebar').addEventListener('click',closeDrawer);$('drawerShade').addEventListener('click',closeDrawer);
  for(const tab of document.querySelectorAll('.side-tab'))tab.addEventListener('click',()=>setTab(tab.dataset.tab));
  $('prevButton').addEventListener('click',()=>switchChapter(-1));
  $('nextButton').addEventListener('click',()=>switchChapter(1));
  $('readingScroller').addEventListener('scroll',updateScrollPosition,{passive:true});
  $('bookmarkButton').addEventListener('click',addBookmark);$('addBookmarkSide').addEventListener('click',addBookmark);
  $('exportWords').addEventListener('click',exportVocabulary);
  $('readAloudButton').addEventListener('click',toggleSpeak);
  $('settingsButton').addEventListener('click',()=>togglePanel('settingsPanel'));
  for(const btn of document.querySelectorAll('[data-dismiss]'))btn.addEventListener('click',()=>$(btn.dataset.dismiss).hidden=true);
  document.querySelectorAll('.modal-mask').forEach(back=>back.addEventListener('click',e=>{if(e.target===back)back.hidden=true;}));
  document.querySelectorAll('.theme-choice').forEach(btn=>btn.addEventListener('click',()=>{settings.theme=btn.dataset.setTheme;applySettings();saveSettings();}));
  $('fontRange').addEventListener('input',e=>{settings.fontSize=Number(e.target.value);applySettings();saveSettings();});
  $('lineRange').addEventListener('input',e=>{settings.lineHeight=Number(e.target.value);applySettings();saveSettings();});
  $('fontSelect').addEventListener('change',e=>{settings.font=e.target.value;applySettings();saveSettings();});
  $('sourceLanguage').addEventListener('change',e=>{settings.source=e.target.value;updateTtsVoiceOptions();saveSettings();if(currentBook)displayChapter(currentIndex,currentState.offset||0).catch(err=>notify(err.message));});
  $('targetLanguage').addEventListener('change',e=>{settings.target=e.target.value;saveSettings();if(currentBook)displayChapter(currentIndex,currentState.offset||0).catch(err=>notify(err.message));});
  $('pronunciationAccent').addEventListener('change',e=>{settings.pronunciationAccent=e.target.value;saveSettings();if(lookupSnapshot)renderDictionaryInfo(lookupSnapshot.dictionary);});
  $('ttsEngine').addEventListener('change',e=>{stopSpeech();settings.ttsEngine=e.target.value;updateTtsVoiceOptions();saveSettings();});
  $('ttsLanguage').addEventListener('change',e=>{settings.ttsLanguage=e.target.value;updateTtsVoiceOptions();saveSettings();});
  $('cloudVoice').addEventListener('change',e=>{settings.cloudVoice=e.target.value;saveSettings();});
  $('saveGoogleTtsKey').addEventListener('click',saveGoogleTtsKey);
  $('testGoogleTtsKey').addEventListener('click',testGoogleTtsKey);
  $('removeGoogleTtsKey').addEventListener('click',removeGoogleTtsKey);
  $('useTranslateKeyForTts').addEventListener('click',()=>{if(!googleTranslateKey)return notify('Bạn chưa có API Key dịch.');$('googleTtsKeyInput').value=googleTranslateKey;notify('Đã điền khóa Google Translate vào ô TTS. Cần bật cả Cloud Text-to-Speech API.');});
  $('cloudStopButton').addEventListener('click',stopSpeech);
  $('googleTtsKeyInput').addEventListener('keydown',e=>{if(e.key==='Enter')saveGoogleTtsKey();});
  $('saveGoogleApiKey').addEventListener('click',saveGoogleApiKey);
  $('testGoogleApiKey').addEventListener('click',testGoogleApiKey);
  $('removeGoogleApiKey').addEventListener('click',removeGoogleApiKey);
  $('googleApiKeyInput').addEventListener('keydown',e=>{if(e.key==='Enter')saveGoogleApiKey();});
  $('voiceSelect').addEventListener('change',e=>{settings.voice=e.target.value;saveSettings();});
  $('speechRate').addEventListener('input',e=>{settings.rate=Number(e.target.value);applySettings();saveSettings();});
  document.addEventListener('selectionchange',()=>{clearTimeout(window._readerSelectionTimer);window._readerSelectionTimer=setTimeout(handleSelection,140);});
  $('readerContent').addEventListener('dblclick',()=>setTimeout(handleSelection,70));
  $('readerContent').addEventListener('pointerdown',event=>{
    if(event.target.closest('button,a')||!event.target.closest('.sentence-text')){readerPointerStart=null;return;}
    readerPointerStart={x:event.clientX,y:event.clientY,time:Date.now(),id:event.pointerId};
  },{passive:true});
  $('readerContent').addEventListener('pointerup',handleReaderPointerUp,{passive:true});
  $('readerContent').addEventListener('pointercancel',()=>{readerPointerStart=null;},{passive:true});
  $('translateSelection').addEventListener('click',()=>openLookup());
  $('speakSelection').addEventListener('click',()=>{const text=selectedText||selectedFromReader();$('selectionPanel').hidden=true;speakText(text);});
  $('saveWordButton').addEventListener('click',saveWord);
  $('saveSentenceButton').addEventListener('click',saveSentenceFromLookup);
  $('saveBothButton').addEventListener('click',saveBothFromLookup);
  $('lookupSpeak').addEventListener('click',()=>{if(!lookupSnapshot)return;
    if(isEnglishDictionaryWord(lookupSnapshot.text))playWordPronunciation(settings.pronunciationAccent==='uk'?'uk':'us');
    else speakText(lookupSnapshot.text);
  });
  $('lookupPartOfSpeech').addEventListener('change',e=>{if(!lookupSnapshot)return;
    const part=e.target.value;lookupSnapshot.selectedPart=part;
    lookupSnapshot.partOfSpeech=PART_OF_SPEECH[part]||part;
    renderDictionaryInfo(lookupSnapshot.dictionary);
    if(!currentState.partOfSpeechOverrides)currentState.partOfSpeechOverrides={};
    currentState.partOfSpeechOverrides[meaningOverrideKey(lookupSnapshot)]=part;
    updateSavedLookupData(lookupSnapshot,currentState);scheduleSave();
  });
  $('editLookupMeaning').addEventListener('click',()=>toggleLookupMeaningEditor(true));
  $('cancelLookupMeaning').addEventListener('click',()=>toggleLookupMeaningEditor(false));
  $('saveLookupMeaning').addEventListener('click',saveEditedLookupMeaning);
  $('resetLookupMeaning').addEventListener('click',resetEditedLookupMeaning);
  $('translateLookupContext').addEventListener('click',translateLookupContext);
  $('externalTranslate').addEventListener('click',()=>{const text=$('lookupSource').textContent;if(text)window.open(googleTranslateURL(text),'_blank','noopener,noreferrer');});
  $('searchButton').addEventListener('click',()=>{if(!currentBook)return notify('Hãy chọn sách trước.');$('searchModal').hidden=false;$('searchResults').replaceChildren();$('searchInput').focus();});
  $('runSearch').addEventListener('click',searchBook);
  $('searchInput').addEventListener('keydown',e=>{if(e.key==='Enter')searchBook();});
  // Khi quét chọn cụm từ trên máy tính, gợi ý xuất hiện sau khi nhả chuột;
  // trên điện thoại giữ nguyên bộ chọn văn bản hệ thống để kéo hai tay nắm.
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){$('settingsPanel').hidden=true;$('selectionPanel').hidden=true;$('searchModal').hidden=true;$('translationModal').hidden=true;closeDrawer();}
    if(e.target.closest('input,select,textarea,button'))return;
    if((e.key==='ArrowRight'||e.key==='ArrowLeft')&&currentBook&&!e.ctrlKey){switchChapter(e.key==='ArrowRight'?1:-1);}
  });
  window.addEventListener('pagehide',()=>{if(currentBook)persistState().catch(()=>{});stopSpeech();});
  window.addEventListener('beforeunload',()=>{if(currentBook){updateScrollPosition();}});
}
async function init(){
  attachHandlers();applySettings();
  renderToc();renderBookmarks();renderWords();
  if('speechSynthesis' in window){listVoices();speechSynthesis.onvoiceschanged=listVoices;}
  await refreshLibrary();
  if('serviceWorker' in navigator && location.protocol==='https:' || 'serviceWorker' in navigator && location.hostname==='localhost'){
    navigator.serviceWorker.register('/sw.js').catch(e=>console.warn('PWA:',e));
  }
  if(!window.JSZip || !window.mammoth || !window.DOMPurify){notify('Cần có Internet lần đầu để tải thư viện đọc EPUB/Word. Hãy kiểm tra kết nối.',6500);}
}
document.addEventListener('DOMContentLoaded',init);
