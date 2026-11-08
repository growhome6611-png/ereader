/* E-Reader Pro V24.7 — export translations as DOCX and translation/bilingual WAV.
   Uses the existing JSZip, IndexedDB cache and Google Drive TTS cache.
   Never silently translates or synthesizes missing content. */
(() => {
  'use strict';
  const $x=id=>document.getElementById(id);
  let busy=false, controller=null, readyDoc=null, readyAudio=null;
  const mimeDocx='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'');
  const safeName=s=>String(s||'Sach').replace(/[\\/:*?"<>|\x00-\x1F]/g,' ').replace(/\s+/g,' ').trim().slice(0,75)||'Sach';
  const wText=t=>`<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  const paragraph=(text,style='Normal',keep=false)=>`<w:p><w:pPr><w:pStyle w:val="${style}"/>${keep?'<w:keepNext/>':''}</w:pPr>${wText(text||' ')}</w:p>`;
  const normalText=x=>String(x||'').replace(/\s+/gu,' ').trim();
  const clearMessage=()=>{ $x('exportV247Status').textContent=''; };
  function status(msg,percent=null){
    $x('exportV247Status').textContent=msg;
    const p=$x('exportV247Progress');
    if(percent!==null){p.hidden=false;p.value=Math.max(0,Math.min(100,percent));}
  }
  function checkAbort(){if(controller?.signal.aborted)throw new DOMException('Đã dừng tác vụ','AbortError');}
  function setBusy(v){busy=v;$x('exportV247Docx').disabled=v;$x('exportV247Audio').disabled=v;$x('exportV247Modal').dataset.working=String(v);}
  function currentScope(){
    if(!currentBook)throw Error('Hãy mở một cuốn EPUB hoặc Word.');
    const type=$x('exportV247Scope').value;
    const indices=type==='book'?currentBook.chapters.map((_,i)=>i):[currentIndex];
    return {book:currentBook,indices,scope:type};
  }
  function translatedOnly(){return $x('exportV247Mode').value==='translation';}
  function wantAutoTranslate(){return $x('exportV247Missing').checked;}
  const stagePercent=(done,total,start=0,span=100)=>start+span*(done/Math.max(1,total));

  // Extract logical paragraphs / table cells from the real source chapter (no reader buttons).
  function parseChapterBlocks(chapter){
    const root=document.createElement('div');root.innerHTML=sanitize(chapter.html||'');
    try{joinWrappedParagraphs(root);}catch(e){console.warn('Wrapped text:',e);}
    const all=[];
    const contentTag=new Set(['p','h1','h2','h3','h4','h5','h6','li','figcaption','pre']);
    function textOf(element){
      const temp=element.cloneNode(true);
      for(const br of temp.querySelectorAll('br'))br.replaceWith(document.createTextNode(' '));
      return normalText(temp.textContent);
    }
    function collectPara(el){
      const text=textOf(el);if(!text)return null;
      const tag=el.tagName.toLowerCase();
      return {kind:'p',tag:tag==='li'?'li':tag,segments:segmentSentences(text).map(x=>({original:normalText(x.text),translation:''}))};
    }
    function walk(node){
      for(const child of node.children){
        const tag=child.tagName.toLowerCase();
        if(tag==='table'){
          const rows=[];
          for(const tr of child.querySelectorAll('tr')){
            if(tr.closest('table')!==child)continue;
            const cells=[];
            for(const cell of tr.children){
              if(!['td','th'].includes(cell.tagName.toLowerCase()))continue;
              const p=collectPara(cell);cells.push(p||{kind:'p',tag:'td',segments:[]});
            }
            if(cells.length)rows.push(cells);
          }
          if(rows.length)all.push({kind:'table',rows});
        }else if(contentTag.has(tag) || (['td','th'].includes(tag) && !child.closest('table'))){
          const p=collectPara(child);if(p)all.push(p);
        }else if(tag==='blockquote'){
          if(child.querySelector('p'))walk(child);
          else{const p=collectPara(child);if(p)all.push(p);}
        }else if(tag==='div'||tag==='section'||tag==='article'||tag==='main'||tag==='figure'||tag==='ul'||tag==='ol'||tag==='header'||tag==='footer'){
          if(child.children.length)walk(child);else{const p=collectPara(child);if(p)all.push(p);}
        }else if(tag!=='img' && !child.children.length){
          const p=collectPara(child);if(p)all.push(p);
        }else if(child.children.length)walk(child);
      }
    }
    walk(root);
    if(!all.length && chapter.plain?.trim())all.push({kind:'p',tag:'p',segments:segmentSentences(chapter.plain).map(x=>({original:normalText(x.text),translation:''}))});
    return all;
  }
  function allSegments(blocks){
    const out=[];
    for(const b of blocks){if(b.kind==='p')out.push(...b.segments);else for(const row of b.rows)for(const cell of row)out.push(...cell.segments);}
    return out;
  }
  async function loadExportData(){
    const ctx=currentScope();let count=0;
    const items=[];
    for(const index of ctx.indices){
      checkAbort();
      const chapter=ctx.book.chapters[index];
      const blocks=parseChapterBlocks(chapter);
      const cached=await readChapterSentenceCache(ctx.book.id,index);
      const map=new Map(cached.map(x=>[x.key,x.translation]));
      const legacy=await dbGet('states',ctx.book.id).catch(()=>null)||currentState;
      const segments=allSegments(blocks);
      let sentenceNumber=0;
      for(const entry of segments){
        const original=entry.original;
        if(!original)continue;
        const identity=sentenceCacheIdentity(ctx.book.id,index,original);
        entry.identity=identity;
        const key=sentenceTranslationKey(index,sentenceNumber,original);
        const legacyTranslation=restoreLegacySentenceTranslation(legacy,key,index);
        sentenceNumber++;
        entry.translation=map.get(identity.key)||legacyTranslation||'';
        if(!entry.translation && /^[\p{N}\s.,:;()\[\]—–-]+$/u.test(original))entry.translation=original;
        count++;
      }
      items.push({index,title:chapter.title||('Chương '+(index+1)),blocks,segments});
    }
    return {ctx,items,count};
  }
  async function fillTranslations(data){
    const all=data.items.flatMap(item=>item.segments);
    const missing=all.filter(entry=>!entry.translation);
    if(!missing.length)return 0;
    if(!wantAutoTranslate())return missing.length;
    if(!window.confirm(`Có ${missing.length} câu chưa dịch. Dịch các câu này qua dịch vụ hiện có có thể dùng hạn mức/trả phí API. Bạn có muốn dịch bổ sung trước khi xuất?`)){
      throw new Error('Đã hủy dịch bổ sung. Bạn có thể bỏ chọn “Dịch bổ sung câu còn thiếu” để xuất phần đã có.');
    }
    let finished=0;
    for(const entry of missing){
      checkAbort();
      status(`Đang dịch câu ${finished+1}/${missing.length} còn thiếu. Kết quả được lưu ngay sau mỗi câu…`,stagePercent(finished,missing.length,2,43));
      const earlier=await readCachedSentenceByText(entry.identity);
      let translated=earlier?.translation;
      if(!translated && cloudEnabledForScope()){
        try{translated=(await window.EReaderCloud.findSentence(entry.identity))?.translation;}catch{}
      }
      if(!translated)translated=await translateText(entry.original);
      entry.translation=translated;
      await saveSentenceCache(entry.identity,translated,true);
      finished++;
    }
    // Re-render only the currently open chapter to make newly translated text visible.
    for(const item of data.items){
      if(item.index!==currentIndex)continue;
      for(const unit of $x('readerContent').querySelectorAll('.sentence-unit')){
        const key=unit.dataset.cacheKey;
        const entry=item.segments.find(s=>s.identity?.key===key);
        if(entry?.translation && unit.dataset.hasTranslation!=='true')paintSentenceTranslation(unit,entry.translation,true);
      }
    }
    return 0;
  }
  function paraStyle(tag){if(tag==='h1')return 'Heading1';if(tag==='h2')return 'Heading2';if(/^h[3-6]$/.test(tag))return 'Heading3';return 'Normal';}
  function makeParagraphBlock(block,mode){
    const originals=block.segments.map(s=>s.original).filter(Boolean).join(' ');
    const translated=block.segments.map(s=>s.translation||'[Chưa có bản dịch]').join(' ');
    const tag=block.tag;
    const bullet=tag==='li'?'• ':'';
    const result=[];
    if(mode==='bilingual')result.push(paragraph(bullet+originals,paraStyle(tag),false));
    result.push(paragraph(bullet+translated,mode==='bilingual'?'Translation':paraStyle(tag)));
    return result.join('');
  }
  function makeTable(block,mode){
    const cells=block.rows;let rowsXml='';
    const maxCol=Math.max(1,...cells.map(r=>r.length));
    for(const row of cells){
      const tcs=row.map(cell=>{
        const content=makeParagraphBlock(cell,mode);
        return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${content||paragraph(' ')}</w:tc>`;
      }).join('');rowsXml+=`<w:tr>${tcs}</w:tr>`;
    }
    const grid=Array.from({length:maxCol},()=>'<w:gridCol w:w="1600"/>').join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rowsXml}</w:tbl>`;
  }
  async function makeDocx(data){
    if(!window.JSZip)throw Error('Chưa tải thư viện tạo Word. Hãy kết nối mạng rồi tải lại trang.');
    const mode=$x('exportV247Mode').value;
    const zip=new JSZip();let body=paragraph(data.ctx.book.title,'Title');
    body+=paragraph(mode==='translation'?'Bản dịch':'Song ngữ — nguyên văn và bản dịch','Subtitle');
    for(const item of data.items){
      checkAbort();body+=paragraph(`${item.index+1}. ${item.title}`,'Heading1');
      for(const block of item.blocks){checkAbort();body+=block.kind==='table'?makeTable(block,mode):makeParagraphBlock(block,mode);}
    }
    body+='<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1417" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>';
    const documentXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
    const styles=[['Normal','Normal',24,'000000'],['Title','Title',34,'202B26'],['Subtitle','Subtitle',22,'566B61'],['Heading1','Heading 1',30,'202B26'],['Heading2','Heading 2',27,'202B26'],['Heading3','Heading 3',24,'202B26'],['Translation','Translation',24,'226C58']];
    const stylesXml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+styles.map(([id,name,size,color])=>`<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:pPr><w:spacing w:after="140" w:line="340" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="SimSun"/><w:sz w:val="${size}"/><w:color w:val="${color}"/></w:rPr></w:style>`).join('')+'</w:styles>';
    zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
    zip.folder('_rels').file('.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.folder('word').file('document.xml',documentXml);
    zip.folder('word').file('styles.xml',stylesXml);
    zip.folder('word').folder('_rels').file('document.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:6}});
  }
  function downloadFile(blob,name){
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  async function handleDocx(){
    if(busy)return;controller=new AbortController();setBusy(true);readyDoc=null;
    try{
      status('Đang đọc nội dung sách và tìm các bản dịch đã lưu…',2);
      const data=await loadExportData();
      const missing=await fillTranslations(data);
      checkAbort();
      status('Đang đóng gói tài liệu Word…',85);
      const blob=await makeDocx(data);
      const suffix=data.ctx.scope==='book'?'Toan_sach':'Chuong_'+(data.items[0].index+1);
      const kind=translatedOnly()?'Ban_dich':'Song_ngu';
      const name=safeName(data.ctx.book.title)+' - '+suffix+' - '+kind+'.docx';
      readyDoc={blob,name};
      status(`Đã tạo Word (${(blob.size/1024).toFixed(0)} KB). ${missing?'Có '+missing+' câu chưa dịch được đánh dấu trong tệp.':'Đã có bản dịch cho mọi câu.'}`,100);
      downloadFile(blob,name);
    }catch(e){status((e.name==='AbortError'?'Đã dừng: ': 'Không xuất được Word: ')+e.message,null);}
    finally{setBusy(false);controller=null;}
  }
  async function digestText(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
  function voiceForLanguage(engine,language){
    if(engine==='gemini')return settings.geminiVoice;
    const list=CLOUD_VOICES[language];
    return list.some(v=>v.name===settings.cloudVoice)?settings.cloudVoice:list[0].name;
  }
  async function cachedClip(text,language,engine,signal,stage){
    const voice=voiceForLanguage(engine,language);
    const profile={provider:engine,model:engine==='google'?'google-cloud-v1':(settings.geminiModel||'gemini-3.8-flash-lite-tts'),voice,language,rate:1,text:normalizedSentence(text)};
    const id=await digestText(JSON.stringify(profile));
    const local=await dbGet('audioCache',id).catch(()=>null);
    if(local?.blob?.size)return local.blob;
    if(accountDbScope.startsWith('account_')&&!cloudEnabledForScope())throw Error('Phiên Drive chưa được kết nối; hãy kết nối để kiểm tra audio cũ trước khi tạo mới.');
    if(cloudEnabledForScope()){
      stage('Đang tìm bản ghi trên Google Drive…');
      let blob;
      try{blob=await window.EReaderCloud.downloadAudio(id);}catch(e){throw Error('Không kiểm tra được audio trên Drive: '+e.message);}
      if(blob?.size){await dbPut('audioCache',{id,profile,blob,createdAt:Date.now(),syncedAt:Date.now()}).catch(()=>{});return blob;}
    }
    checkAbort();
    stage('Đang tạo âm thanh mới bằng '+(engine==='google'?'Google Cloud':'Gemini')+'…');
    const blob=engine==='google'?await requestCloudAudio(text,{voiceName:voice,signal}):await requestGeminiAudio(text,{signal});
    if(!blob?.size)throw Error('API không trả tệp âm thanh.');
    const record={id,profile,blob,createdAt:Date.now(),syncedAt:0};
    await dbPut('audioCache',record);
    if(settings.saveAudioDrive!==false&&cloudEnabledForScope())window.EReaderCloud.queueAudio(record).catch(()=>{});
    return blob;
  }
  function buildAudioPlan(data,mode){
    const languageTarget=settings.target==='en'?'en':'vi';
    const sourceExplicit=settings.source==='en'||settings.source==='vi'?settings.source:'';
    const first=data.items[0].segments.find(s=>s.original)?.original||'';
    const languageSource=sourceExplicit||(resolveSource(first)==='vi'?'vi':'en');
    const bilingual=mode==='bilingual';const pairs=[];
    for(const item of data.items){
      for(const block of item.blocks){
        const segments=block.kind==='p'?block.segments:block.rows.flatMap(row=>row.flatMap(cell=>cell.segments));
        // Per paragraph: original then its translation, preventing a voice change on every word.
        const original=segments.map(s=>s.original).filter(Boolean).join(' ');
        const translation=segments.map(s=>s.translation).filter(Boolean).join(' ');
        if(!translation)continue;
        if(bilingual&&original)pairs.push({text:original,language:languageSource});
        pairs.push({text:translation,language:languageTarget});
      }
    }
    const chunks=[];
    const maxBytes=settings.ttsEngine==='gemini'?980:1060;
    for(const pair of pairs){for(const text of splitCloudSpeech(pair.text,maxBytes)){if(text)chunks.push({text,language:pair.language});}}
    return chunks;
  }
  async function handleAudio(){
    if(busy)return;
    if(!['google','gemini'].includes(settings.ttsEngine)){status('Hãy chọn Google Cloud TTS hoặc Gemini TTS trong Cài đặt. Giọng thiết bị không thể xuất tệp audio.');return;}
    if($x('exportV247Scope').value==='book'){status('Để tránh tạo tệp WAV quá lớn trên điện thoại, xuất audio theo từng chương. Hãy chọn “Chương đang mở”.');return;}
    controller=new AbortController();setBusy(true);readyAudio=null;
    try{
      status('Đang kiểm tra câu và bản dịch đã lưu…',2);
      const data=await loadExportData();
      const missing=await fillTranslations(data);
      if(missing){throw Error('Còn '+missing+' câu chưa có bản dịch. Bật “Dịch bổ sung” rồi tạo lại audio, hoặc dịch những câu đó trước trong sách.');}
      const mode=$x('exportV247Mode').value;
      const chunks=buildAudioPlan(data,mode);
      if(!chunks.length)throw Error('Chương này chưa có phần bản dịch để tạo âm thanh.');
      const engine=settings.ttsEngine;
      const name=safeName(data.ctx.book.title)+' - '+String(data.items[0].index+1).padStart(2,'0')+' - '+(mode==='bilingual'?'Goc-Dich':'Ban-dich')+'.wav';
      const payload=JSON.stringify({bookId:data.ctx.book.id,index:data.items[0].index,engine,model:settings.geminiModel,googleVoices:CLOUD_VOICES,voice:settings.ttsEngine==='gemini'?settings.geminiVoice:settings.cloudVoice,mode,target:settings.target,chunks});
      const id=await digestText(payload);
      const existing=await dbGet('chapterAudio',id).catch(()=>null);
      if(existing?.blob?.size){readyAudio=existing;status('Tìm thấy WAV đã tạo trước đây. Không sử dụng thêm API.',100);downloadFile(existing.blob,existing.name||name);return;}
      if(cloudEnabledForScope()){
        try{
          const found=await window.EReaderCloud.downloadChapterAudio(id,settings.chapterDriveFolder||'Sách nói');
          if(found?.size){const row={id,blob:found,name,bookId:data.ctx.book.id,chapter:data.items[0].index,bookTitle:data.ctx.book.title,chapterTitle:data.items[0].title,provider:engine,voice:engine==='gemini'?settings.geminiVoice:'UK/US & VI',createdAt:Date.now(),driveSyncedAt:Date.now()};await dbPut('chapterAudio',row);readyAudio=row;status('Đã tìm thấy WAV trên Google Drive, tải về không dùng thêm API.',100);downloadFile(found,name);return;}
        }catch(e){throw Error('Chưa kiểm tra được tệp WAV cũ trên Drive: '+e.message);}
      }
      if(!window.confirm(`Audio ${mode==='bilingual'?'song ngữ gốc–dịch':'chỉ bản dịch'} gồm ${chunks.length} đoạn. Ứng dụng sẽ lấy bản ghi có sẵn trước; các đoạn còn thiếu sẽ gọi API TTS và có thể tính phí. Tiếp tục?`))throw Error('Đã hủy tạo audio, chưa gọi API TTS.');
      const blobs=[];
      for(let i=0;i<chunks.length;i++){
        checkAbort();const chunk=chunks[i];
        const onStage=msg=>status(`${i+1}/${chunks.length} · ${chunk.language.toUpperCase()} · ${msg}`,stagePercent(i,chunks.length,5,77));
        onStage('Đang tìm audio đã lưu…');
        blobs.push(await cachedClip(chunk.text,chunk.language,engine,controller.signal,onStage));
        status(`Đã xử lý ${i+1}/${chunks.length} đoạn âm thanh.`,stagePercent(i+1,chunks.length,5,77));
      }
      status('Đang ghép các đoạn thành một tệp WAV…',83);
      const blob=await wavFromClips(blobs,{signal:controller.signal,onProgress:(i,n)=>status(`Đang ghép ${i}/${n} đoạn…`,stagePercent(i,n,83,16))});
      const record={id,blob,name,bookId:data.ctx.book.id,chapter:data.items[0].index,bookTitle:data.ctx.book.title,chapterTitle:data.items[0].title+' · '+(mode==='bilingual'?'Gốc–dịch':'Bản dịch'),provider:engine,voice:engine==='gemini'?settings.geminiVoice:'EN/VI',createdAt:Date.now(),driveSyncedAt:0};
      await dbPut('chapterAudio',record);readyAudio=record;
      status(`Đã tạo audio ${(blob.size/1048576).toFixed(1)} MB. Đã lưu trong ứng dụng.`,100);
      downloadFile(blob,name);
      if($x('exportV247Drive').checked&&cloudEnabledForScope()){
        status('Đang lưu bản WAV song ngữ/bản dịch lên Google Drive…',99);
        try{await window.EReaderCloud.uploadChapterAudio(record,settings.chapterDriveFolder||'Sách nói');record.driveSyncedAt=Date.now();await dbPut('chapterAudio',record);status('Đã lưu WAV lên Google Drive và tải về máy.',100);}
        catch(e){status('Đã lưu WAV trên thiết bị nhưng chưa lên Drive: '+e.message,100);}
      }
    }catch(e){status((e.name==='AbortError'?'Đã hủy: ': 'Lỗi xuất audio: ')+e.message);}
    finally{setBusy(false);controller=null;}
  }
  async function saveWordDrive(){
    if(!readyDoc?.blob?.size){status('Hãy tạo Word trước rồi mới lưu lên Drive.');return;}
    if(!cloudEnabledForScope()){status('Hãy đăng nhập Google Drive trước khi lưu Word.');return;}
    if(!window.EReaderCloud.uploadExportedWord){status('Thiếu phần đồng bộ Word. Hãy cập nhật cloud-sync.js trong gói V24.7.');return;}
    try{status('Đang lưu '+readyDoc.name+' lên Drive…');await window.EReaderCloud.uploadExportedWord(readyDoc.name,readyDoc.blob);status('Đã lưu Word vào Google Drive / EReader Pro / Bản dịch Word.',100);}
    catch(e){status('Chưa lưu được Word lên Drive: '+e.message);}
  }
  function init(){
    $x('translationExportButton')?.addEventListener('click',()=>{readyDoc=null;readyAudio=null;$x('exportV247Modal').hidden=false;clearMessage();$x('exportV247Progress').hidden=true;});
    $x('exportV247Close')?.addEventListener('click',()=>{if(busy){status('Đang xử lý. Bấm “Dừng” để hủy trước khi đóng.');return;}$x('exportV247Modal').hidden=true;});
    $x('exportV247Docx')?.addEventListener('click',handleDocx);
    $x('exportV247Audio')?.addEventListener('click',handleAudio);
    $x('exportV247WordDrive')?.addEventListener('click',saveWordDrive);
    $x('exportV247Cancel')?.addEventListener('click',()=>{if(controller){controller.abort();status('Đang dừng sau yêu cầu đang xử lý; bản dịch và audio đã hoàn thành vẫn được lưu.');}else $x('exportV247Modal').hidden=true;});
    $x('exportV247Modal')?.addEventListener('click',event=>{if(event.target===event.currentTarget&&!busy)event.currentTarget.hidden=true;});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
