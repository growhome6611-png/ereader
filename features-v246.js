'use strict';
/* E-Reader Pro V24.6: in-app chapter audio library + contextual cloze practice.
   Existing Drive OAuth, book parsing, translations and TTS remain unchanged. */
(function(){
  const el=id=>document.getElementById(id);
  let audioRows=[],remoteRows=[],playerURL='',audioListSerial=0,trainingQuestions=[];
  const sentenceLimit=360;

  function clean(value){return String(value||'').trim().replace(/\s+/g,' ');}
  function audioStatus(value){el('audioLibraryStatus').textContent=value;}
  function labelForAudio(row){
    if(row.bookTitle){return row.bookTitle+' · '+(row.chapterTitle||('Chương '+(Number(row.chapter)+1)));}
    if(row.name && !/^chapter-[a-f0-9]{64}\.wav$/i.test(row.name))return row.name.replace(/\.wav$/i,'');
    return 'Bản ghi cũ · '+String(row.id||'').slice(0,10);
  }
  function formatSize(bytes){return Number(bytes)>0?(Number(bytes)/1048576).toFixed(1)+' MB':'Audio WAV';}
  function saveRowsLocal(){return dbAll('chapterAudio').catch(()=>[]);}
  async function renderAudioLibrary({refreshDrive=false}={}){
    const serial=++audioListSerial, list=el('chapterAudioLibraryList');
    const locals=await saveRowsLocal();if(serial!==audioListSerial)return;
    if(refreshDrive){
      if(cloudEnabledForScope()&&window.EReaderCloud?.listChapterAudios){
        audioStatus('Đang đọc danh sách audio từ Google Drive…');
        try{remoteRows=await window.EReaderCloud.listChapterAudios(settings.chapterDriveFolder||'Sách nói');}
        catch(e){if(serial===audioListSerial)audioStatus('Không tải được danh sách Drive: '+e.message+' · Có thể nghe các file đã lưu trên thiết bị.');}
      }else{
        remoteRows=[];
        audioStatus('Drive chưa kết nối. Các file trên máy vẫn có thể nghe. Vào biểu tượng tài khoản để kết nối Google.');
      }
    }
    if(serial!==audioListSerial)return;
    const merged=new Map();
    for(const row of locals){if(row?.id&&row.blob?.size)merged.set(row.id,{...row,local:true,size:row.blob.size});}
    for(const row of remoteRows){
      const existing=merged.get(row.id)||{};
      merged.set(row.id,{...existing,...row,local:!!existing.local,remote:true,
        // Cloud metadata may not exist for old files, so keep useful local labels.
        bookTitle:row.bookTitle||existing.bookTitle||'',chapterTitle:row.chapterTitle||existing.chapterTitle||'',
        name:existing.name||row.name,size:row.size||existing.size||0});
    }
    if(currentBook){
      try{
        const snap=currentChapterSnapshot();
        const key=await chapterAudioIdentity(snap);
        const candidate=merged.get(key);
        if(candidate&&!candidate.bookTitle){
          candidate.bookTitle=currentBook.title||currentBook.name||'';
          candidate.chapterTitle=currentBook.chapters[currentIndex]?.title||'';
          candidate.bookId=currentBook.id;candidate.chapter=currentIndex;
        }
      }catch{}
    }
    if(serial!==audioListSerial)return;
    audioRows=[...merged.values()].sort((a,b)=>{
      const ta=Date.parse(a.modifiedTime||'')||a.createdAt||0;
      const tb=Date.parse(b.modifiedTime||'')||b.createdAt||0;
      return tb-ta;
    });
    list.replaceChildren();
    if(!audioRows.length){
      const msg=document.createElement('div');msg.className='audio-library-empty';msg.textContent='Chưa có bản ghi trong kho audio đã chọn. Hãy tạo file chương, hoặc kết nối Google Drive và bấm “Tải danh sách”.';list.append(msg);
    }else{
      for(const row of audioRows){
        const item=document.createElement('div');item.className='audio-library-item';
        const title=document.createElement('strong');title.textContent=labelForAudio(row);
        const caption=document.createElement('small');
        caption.textContent=[row.remote?'☁ Google Drive':'',row.local?'✓ Có trên máy':'',row.voice||'',formatSize(row.size)].filter(Boolean).join(' · ');
        const left=document.createElement('div');left.className='audio-library-detail';left.append(title,caption);
        const play=document.createElement('button');play.type='button';play.className='secondary-btn compact';play.textContent='▶ Nghe';
        play.addEventListener('click',()=>playSavedAudio(row));
        item.append(left,play);
        if(row.remote&&row.webUrl){
          const link=document.createElement('a');link.textContent='↗ Drive';link.className='audio-library-drive-link';link.href=row.webUrl;link.target='_blank';link.rel='noopener noreferrer';link.title='Mở vị trí file trên Drive nếu cần';item.append(link);
        }
        list.append(item);
      }
      if(!el('chapterLibraryPlayer').src || !el('chapterLibraryPlayer').currentSrc){
        audioStatus('Có '+audioRows.length+' tệp audio. Chạm ▶ Nghe để phát ngay trong E-Reader. File lấy từ Drive sẽ được lưu lại trên thiết bị.');
      }
    }
  }
  function stopLibraryPlayer(){
    const player=el('chapterLibraryPlayer');player.pause();player.removeAttribute('src');player.load();player.hidden=true;
    if(playerURL){URL.revokeObjectURL(playerURL);playerURL='';}
  }
  async function playSavedAudio(row){
    const player=el('chapterLibraryPlayer');
    try{
      audioStatus('Đang chuẩn bị file: '+labelForAudio(row));
      let local=await dbGet('chapterAudio',row.id).catch(()=>null);
      if(!local?.blob?.size){
        if(!cloudEnabledForScope())throw Error('Bản ghi chỉ có trên Drive. Hãy đăng nhập Google Drive để tải xuống.');
        if(!row.fileId)throw Error('Thiếu thông tin file trên Drive. Bấm tải lại danh sách.');
        const blob=await window.EReaderCloud.downloadChapterAudioByFileId(row.fileId,settings.chapterDriveFolder||'Sách nói');
        if(!blob?.size)throw Error('Tệp Drive rỗng hoặc không tải được.');
        local={id:row.id,blob,name:row.name||'chapter-'+row.id+'.wav',bookId:row.bookId||'',chapter:row.chapter,
          bookTitle:row.bookTitle||'',chapterTitle:row.chapterTitle||'',voice:row.voice||'',provider:row.provider||'',
          createdAt:Date.now(),driveSyncedAt:Date.now()};
        await dbPut('chapterAudio',local);
        row.local=true;
      }
      // Ensure chapter audio playback does not compete with TTS playback.
      stopSpeech();stopLibraryPlayer();
      playerURL=URL.createObjectURL(local.blob);player.src=playerURL;player.playbackRate=Math.min(2.5,Math.max(.5,Number(settings.rate)||1));player.hidden=false;
      chapterAudioReady=local;
      audioStatus('Đang nghe: '+labelForAudio(row)+' · Đã có bản ghi nên không gọi API.');
      try{await player.play();}catch(e){audioStatus('Nhấn ▶ trên trình phát để bắt đầu. '+(e.name==='NotAllowedError'?'Trình duyệt yêu cầu tương tác người dùng.':''));}
    }catch(e){audioStatus('Không phát được audio: '+e.message);notify('Không phát được audio: '+e.message,6000);}
  }
  async function playCurrentSavedAudio(){
    if(!currentBook)return notify('Hãy mở sách trước.');
    const candidates=audioRows.filter(r=>r.bookId===currentBook.id&&Number(r.chapter)===currentIndex);
    if(candidates.length){await playSavedAudio(candidates[0]);return;}
    try{
      const snapshot=currentChapterSnapshot();
      const key=await chapterAudioIdentity(snapshot);
      const match=audioRows.find(r=>r.id===key);
      if(match){await playSavedAudio(match);return;}
      const cached=await findSavedChapterAudio(snapshot);
      if(cached?.blob?.size){await renderAudioLibrary();await playSavedAudio({...cached,local:true});return;}
    }catch(e){if(!/Chọn Google Cloud|Hãy chọn ngôn ngữ/.test(e.message))audioStatus(e.message);}
    audioStatus('Chưa xác định bản ghi của chương hiện tại. Hãy chọn một file ở danh sách bên dưới, hoặc bấm Tạo file chương.');
  }

  function normalizeWord(text){return clean(text).normalize('NFKC').toLocaleLowerCase();}
  function escapeRegex(s){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
  function findWordSpan(sentence,term){
    if(!term)return null;
    const expression=escapeRegex(term).replace(/\s+/g,'\\s+');
    const re=new RegExp('(^|[^\\p{L}\\p{N}])('+expression+')(?=$|[^\\p{L}\\p{N}])','iu');
    const found=re.exec(sentence);if(!found)return null;
    const start=found.index+found[1].length;
    return {start,end:start+found[2].length};
  }
  function ensureHistory(){
    if(!currentState)return [];
    if(!Array.isArray(currentState.lookedUpWords))currentState.lookedUpWords=[];
    return currentState.lookedUpWords;
  }
  function captureLookup(snapshot){
    if(!snapshot||!currentState||!currentBook||snapshot.kind==='sentence')return;
    const term=clean(snapshot.text);
    if(!term||term.length<2||term.length>70||!/[\p{L}]/u.test(term))return;
    const list=ensureHistory(),key=normalizeWord(term);
    const prior=list.find(w=>normalizeWord(w.text)===key);
    if(prior){prior.lastAt=Date.now();prior.count=(prior.count||1)+1;
      if(snapshot.context)prior.context=snapshot.context;if(Number.isInteger(snapshot.chapter))prior.chapter=snapshot.chapter;
      if(snapshot.translation)prior.translation=snapshot.translation;
    }else list.push({text:term,translation:snapshot.translation||'',context:snapshot.context||'',chapter:snapshot.chapter,lastAt:Date.now(),count:1});
    if(list.length>800)list.splice(0,list.length-800);
    currentState.updatedAt=Date.now();scheduleSave();
  }
  window.EReaderPractice={recordTranslation(snapshot,translation){
    if(!currentState||!snapshot?.text||!translation)return;
    const term=normalizeWord(snapshot.text);
    const entry=ensureHistory().find(item=>normalizeWord(item.text)===term);
    if(entry){entry.translation=String(translation).trim().slice(0,600);currentState.updatedAt=Date.now();scheduleSave();}
  }};
  function getPracticeVocabulary(){
    const map=new Map();
    const add=(raw,meaning='',chapter=-1,context='')=>{
      const term=clean(raw);if(term.length<2||term.length>70||!/\p{L}/u.test(term))return;
      const key=normalizeWord(term),prior=map.get(key);
      if(!prior || (meaning&&!prior.meaning))map.set(key,{term,meaning:clean(meaning),chapter,context});
    };
    for(const entry of (currentState?.lookedUpWords||[]))add(entry.text,entry.translation||'',entry.chapter,entry.context);
    for(const entry of (currentState?.words||[])){
      if(entry.kind==='sentence')continue;
      add(entry.source,entry.translation||'',entry.chapter,entry.context||'');
    }
    return [...map.values()];
  }
  function shuffle(list){
    for(let i=list.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[list[i],list[j]]=[list[j],list[i]];}
    return list;
  }
  function exerciseSourceSentences(scope){
    if(scope==='chapter'){
      const dom=[...document.querySelectorAll('#readerContent .sentence-unit .sentence-text')]
        .map(node=>clean(node.textContent)).filter(Boolean);
      if(dom.length)return dom.map(sentence=>({sentence,chapter:currentIndex}));
    }
    const chapters=scope==='chapter'?[currentBook.chapters[currentIndex]]:currentBook.chapters;
    const all=[];
    for(let i=0;i<chapters.length;i++){
      const c=chapters[i],index=scope==='chapter'?currentIndex:i;
      // Reuse the reader's sentence splitter; do not introduce new punctuation rules.
      const segments=segmentSentences(c.plain||'');
      for(const s of segments){if(s.text?.trim())all.push({sentence:clean(s.text),chapter:index});}
      if(all.length>20000)break;
    }
    return all;
  }
  function buildPractice(){
    const scope=el('exerciseScope').value;
    const n=Math.max(1,Math.min(15,Number(el('exerciseCount').value)||10));
    const vocab=shuffle(getPracticeVocabulary());
    const source=exerciseSourceSentences(scope);
    const entries=[],usedTerm=new Set(),usedSentence=new Set();
    // First prefer recent vocabulary; avoid repeating a sentence or target in one quiz.
    for(const word of vocab){
      const needle=word.term.toLocaleLowerCase();
      let matches=source.filter(row=>row.sentence.length>=16&&row.sentence.length<=sentenceLimit&&row.sentence.toLocaleLowerCase().includes(needle)&&findWordSpan(row.sentence,word.term));
      if(!matches.length&&scope==='book'&&word.context){
        const sentence=clean(word.context);
        if(sentence.length<=sentenceLimit && findWordSpan(sentence,word.term))matches=[{sentence,chapter:word.chapter}];
      }
      if(!matches.length)continue;
      const candidates=shuffle(matches);
      const selected=candidates.find(row=>!usedSentence.has(row.chapter+'|'+row.sentence));
      if(!selected)continue;
      const key=normalizeWord(word.term);if(usedTerm.has(key))continue;
      const span=findWordSpan(selected.sentence,word.term);if(!span)continue;
      entries.push({...selected,term:selected.sentence.slice(span.start,span.end),start:span.start,end:span.end,
        meaning:word.meaning,hint:word.meaning||`${[...word.term].length} ký tự`});
      usedTerm.add(key);usedSentence.add(selected.chapter+'|'+selected.sentence);
      if(entries.length>=n)break;
    }
    return shuffle(entries);
  }
  function renderPractice(){
    const list=el('exerciseQuestions');list.replaceChildren();
    if(!trainingQuestions.length){
      list.innerHTML='';
      const empty=document.createElement('p');empty.className='audio-library-empty';
      empty.textContent='Chưa tìm được từ đã tra trong phạm vi chọn. Hãy chạm tra một vài từ trong chương hoặc lưu từ vào Sổ tay, rồi tạo bài tập; bạn cũng có thể chọn Toàn bộ sách.';
      list.append(empty);el('exerciseStatus').textContent='Chưa có câu phù hợp.';return;
    }
    el('exerciseStatus').textContent=`${trainingQuestions.length} câu · Điền từ bị ẩn trong đoạn gốc, sau đó bấm Chấm bài.`;
    trainingQuestions.forEach((q,i)=>{
      const card=document.createElement('div');card.className='exercise-question';
      const head=document.createElement('div');head.className='exercise-question-head';
      head.textContent=`${i+1}. Chương ${Number(q.chapter)+1}`;
      const body=document.createElement('div');body.className='exercise-passage';body.lang='en';
      body.append(document.createTextNode(q.sentence.slice(0,q.start)));
      const input=document.createElement('input');input.type='text';input.autocomplete='off';input.autocapitalize='off';input.spellcheck=false;
      input.className='exercise-blank';input.dataset.answer=String(i);input.placeholder='Điền từ…';
      input.setAttribute('aria-label','Điền từ còn thiếu trong câu '+(i+1));
      input.style.width=`${Math.min(23,Math.max(9,[...q.term].length+3))}ch`;
      body.append(input,document.createTextNode(q.sentence.slice(q.end)));
      const hint=document.createElement('div');hint.className='exercise-hint';
      hint.textContent='Gợi ý: '+q.hint;
      const result=document.createElement('div');result.className='exercise-answer';result.id='exerciseAnswer'+i;result.hidden=true;
      card.append(head,body,hint,result);list.append(card);
    });
  }
  function startPractice(){
    if(!currentBook||!currentState){notify('Hãy mở một cuốn sách trước.');return;}
    trainingQuestions=buildPractice();renderPractice();
  }
  function checkPractice(reveal=false){
    if(!trainingQuestions.length)return;
    let correct=0;
    const entries=[...el('exerciseQuestions').querySelectorAll('input.exercise-blank')];
    entries.forEach((input,i)=>{
      const q=trainingQuestions[i];
      const good=normalizeWord(input.value)===normalizeWord(q.term);
      if(good)correct++;
      input.classList.toggle('is-correct',good);input.classList.toggle('is-wrong',!good);
      input.setAttribute('aria-invalid',String(!good));
      const result=el('exerciseAnswer'+i);result.hidden=false;
      result.textContent=good?'✓ Đúng!':(reveal?'Đáp án: '+q.term:'Chưa đúng · Thử lại hoặc bấm Xem đáp án');
    });
    el('exerciseStatus').textContent=reveal?`Đã hiện đáp án · ${correct}/${trainingQuestions.length} câu đúng`:
      `Kết quả: ${correct}/${trainingQuestions.length} câu đúng (${Math.round(correct/trainingQuestions.length*100)}%).`;
    if(!reveal&&currentState){
      if(!currentState.exerciseStats)currentState.exerciseStats={};
      const id=String(Date.now());currentState.exerciseStats[id]={correct,total:trainingQuestions.length,chapter:currentIndex,updatedAt:Date.now()};
      const keys=Object.keys(currentState.exerciseStats);if(keys.length>60)delete currentState.exerciseStats[keys[0]];
      currentState.updatedAt=Date.now();scheduleSave();
    }
  }
  function initV246(){
    const originalLookup=openLookup;
    openLookup=function(...args){
      const prior=lookupToken;
      const task=originalLookup.apply(this,args);
      if(currentBook&&currentState&&lookupToken!==prior&&lookupSnapshot)captureLookup(lookupSnapshot);
      return task;
    };
    // The original Audio button opens the creation dialog. Keep it, but extend the
    // same popup with a real library and a player sourced from IndexedDB or Drive.
    el('chapterAudioButton')?.addEventListener('click',()=>renderAudioLibrary({refreshDrive:true}).catch(e=>audioStatus(e.message)));
    el('loadChapterAudioLibrary')?.addEventListener('click',()=>renderAudioLibrary({refreshDrive:true}).catch(e=>audioStatus(e.message)));
    el('playCurrentChapterAudio')?.addEventListener('click',playCurrentSavedAudio);
    el('chapterDriveFolder')?.addEventListener('change',()=>{remoteRows=[];renderAudioLibrary({refreshDrive:true}).catch(e=>audioStatus(e.message));});
    el('makeChapterAudio')?.addEventListener('click',()=>setTimeout(()=>renderAudioLibrary().catch(()=>{}),1400));
    el('uploadChapterAudio')?.addEventListener('click',()=>setTimeout(()=>renderAudioLibrary({refreshDrive:true}).catch(()=>{}),2000));
    // Ensure old audio is stopped when the dialog is dismissed.
    document.querySelectorAll('[data-dismiss="chapterAudioModal"]').forEach(b=>b.addEventListener('click',stopLibraryPlayer));
    el('cancelChapterAudio')?.addEventListener('click',()=>{if(!chapterExportBusy)stopLibraryPlayer();});
    el('chapterAudioModal')?.addEventListener('click',e=>{if(e.target===e.currentTarget)stopLibraryPlayer();});

    el('exerciseButton')?.addEventListener('click',()=>{if(!currentBook)return notify('Hãy mở một cuốn sách.');
      el('exerciseModal').hidden=false;startPractice();});
    el('exerciseGenerate')?.addEventListener('click',startPractice);
    el('exerciseCheck')?.addEventListener('click',()=>checkPractice(false));
    el('exerciseReveal')?.addEventListener('click',()=>checkPractice(true));
    el('exerciseModal')?.addEventListener('keydown',e=>{
      if(e.key==='Enter'&&e.target.matches('.exercise-blank')){e.preventDefault();checkPractice(false);}
    });
  }
  document.addEventListener('DOMContentLoaded',initV246);
})();
