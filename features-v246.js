'use strict';
/* E-Reader Pro V24.6: in-app chapter audio library + contextual cloze practice.
   Existing Drive OAuth, book parsing, translations and TTS remain unchanged. */
(function(){
  const el=id=>document.getElementById(id);
  let audioRows=[],remoteRows=[],playerURL='',audioListSerial=0,trainingQuestions=[];
  let practiceMode='cloze',practiceSound=null,practiceSoundUrl='',practiceSpeaking=false,practiceSpeechToken=0;
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
  // Persistent player: modal close only hides the library, never interrupts audio.
  function stopLibraryPlayer(){
    const player=el('chapterLibraryPlayer');
    player.pause();player.removeAttribute('src');player.load();
    el('savedChapterBar').hidden=true;
    el('quickSavedAudioButton')?.classList.remove('is-playing');
    if(playerURL){URL.revokeObjectURL(playerURL);playerURL='';}
  }
  function updateSavedPlayerUi(){
    const player=el('chapterLibraryPlayer'),hasAudio=!!(player.src||player.currentSrc);
    const active=hasAudio&&!player.paused&&!player.ended;
    const toggle=el('savedChapterPlayPause'),shortcut=el('quickSavedAudioButton');
    if(toggle){toggle.textContent=active?'❚❚':'▶';toggle.setAttribute('aria-label',active?'Tạm dừng bản ghi':'Phát bản ghi đã lưu');}
    if(shortcut){shortcut.classList.toggle('is-playing',active);shortcut.setAttribute('aria-label',active?'Tạm dừng audio đang nghe':'Phát audio đã lưu');}
    if(hasAudio){
      const seconds=Number.isFinite(player.duration)?Math.floor(player.duration):0;
      const mm=Math.floor(seconds/60),ss=String(seconds%60).padStart(2,'0');
      const label=el('savedChapterDetail');
      if(label && seconds>0)label.textContent='Đã lưu · '+mm+':'+ss+' · Không gọi lại API';
    }
  }
  async function toggleSavedPlayer(){
    const player=el('chapterLibraryPlayer');
    if(!player.src){return quickPlaySavedChapter();}
    if(!player.paused){player.pause();return;}
    if(player.ended)player.currentTime=0;
    try{await player.play();}catch(e){notify('Bấm ▶ trên trình phát để bắt đầu: '+e.message,4500);}
  }
  async function quickPlaySavedChapter(){
    const player=el('chapterLibraryPlayer');
    // Repeated taps should pause / resume the current recorded chapter.
    if(player.src)return toggleSavedPlayer();
    if(!currentBook)return notify('Hãy mở sách trước khi nghe bản ghi.');
    const btn=el('quickSavedAudioButton');
    if(btn?.disabled)return;
    if(btn)btn.disabled=true;
    try{
      let match=audioRows.find(r=>r.bookId===currentBook.id&&Number(r.chapter)===currentIndex);
      if(!match){
        const locals=await saveRowsLocal();
        match=locals.filter(r=>r?.blob?.size&&r.bookId===currentBook.id&&Number(r.chapter)===currentIndex)
          .sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0];
      }
      if(match){await playSavedAudio(match);return;}
      // A remote-only audio can be found by loading the existing Drive library.
      showChapterAudioDialog();
      await renderAudioLibrary({refreshDrive:true});
      audioStatus('Chọn ▶ Nghe ở bản ghi phù hợp. Nếu chưa có, hãy bấm Tạo file chương.');
    }catch(e){notify('Chưa mở được bản ghi: '+e.message,5000);}
    finally{if(btn)btn.disabled=false;}
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
      // Keep the permanent player in the reading view, not inside the dialog.
      stopSpeech();stopLibraryPlayer();
      playerURL=URL.createObjectURL(local.blob);player.src=playerURL;
      const requestedRate=Number(el('savedChapterRate')?.value)||Number(settings.rate)||1;
      player.playbackRate=Math.min(2.5,Math.max(.5,requestedRate));
      el('savedChapterBar').hidden=false;
      el('savedChapterTitle').textContent=labelForAudio(row);
      el('savedChapterTitle').title=labelForAudio(row);
      el('savedChapterDetail').textContent='Đã lưu · Không gọi lại API';
      chapterAudioReady=local;
      audioStatus('Đang nghe: '+labelForAudio(row)+' · Bấm Đóng để trở về trang sách, audio vẫn tiếp tục phát.');
      updateSavedPlayerUi();
      try{await player.play();}catch(e){audioStatus('Bản ghi đã sẵn sàng ngoài trang đọc. Bấm ▶ để nghe. '+(e.name==='NotAllowedError'?'Trình duyệt yêu cầu chạm lần nữa.':''));}
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
  async function startPractice(){
    if(!currentBook||!currentState){notify('Hãy mở một cuốn sách trước.');return;}
    const requested=el('exerciseMode')?.value||'cloze';
    practiceMode=requested;
    stopPracticeAudio();
    el('exerciseCheck').disabled=true;el('exerciseReveal').disabled=true;
    el('exerciseStatus').textContent='Đang chuẩn bị bài tập từ nội dung sách và dữ liệu đã lưu…';
    el('exerciseQuestions').replaceChildren();
    try{
      if(practiceMode==='cloze'){
        trainingQuestions=buildPractice();renderPractice();
      }else{
        trainingQuestions=await buildExtendedPractice(practiceMode);
        renderExtendedPractice();
      }
      const ready=trainingQuestions.length>0;
      el('exerciseCheck').disabled=!ready;el('exerciseReveal').disabled=!ready;
      updatePracticeProgress();
    }catch(err){
      trainingQuestions=[];
      el('exerciseStatus').textContent='Không tạo được bài tập: '+(err?.message||err);
      el('exerciseCheck').disabled=true;el('exerciseReveal').disabled=true;
    }
  }
  function checkPractice(reveal=false){
    if(practiceMode!=='cloze'){checkExtendedPractice(reveal);return;}
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
      const id=String(Date.now())+'-'+Math.floor(Math.random()*1000);currentState.exerciseStats[id]={mode:'cloze',correct,total:trainingQuestions.length,chapter:currentIndex,updatedAt:Date.now()};
      const keys=Object.keys(currentState.exerciseStats);if(keys.length>60)delete currentState.exerciseStats[keys[0]];
      currentState.updatedAt=Date.now();scheduleSave();
    }
  }

  /* V24.9: reverse translation, 10x copywriting, listening dictation.
     All exercises use locally stored materials. Never synthesize paid TTS without
     an explicit confirmation from the reader. */
  const cleanAnswer=s=>String(s||'').normalize('NFKC').toLocaleLowerCase('en').replace(/[\u2018\u2019]/g,"'")
    .replace(/[^a-z0-9\s']/g,' ').replace(/\s+/g,' ').trim();
  function wordDistance(expected,actual){
    const a=cleanAnswer(expected).split(/\s+/).filter(Boolean),b=cleanAnswer(actual).split(/\s+/).filter(Boolean);
    if(!a.length)return 0;
    const last=Array.from({length:b.length+1},(_,i)=>i);
    for(let i=1;i<=a.length;i++){
      let prev=last[0];last[0]=i;
      for(let j=1;j<=b.length;j++){
        const temp=last[j];last[j]=Math.min(last[j]+1,last[j-1]+1,prev+(a[i-1]===b[j-1]?0:1));prev=temp;
      }
    }
    return Math.max(0,Math.round((1-last[b.length]/Math.max(a.length,b.length))*100));
  }
  function isEnglishSentence(sentence){
    const text=clean(sentence);
    return text.length>=18&&text.length<=360 && /[a-zA-Z]{3,}/.test(text)
      && (text.match(/[a-zA-Z]/g)||[]).length>=Math.max(12,text.length*.48);
  }
  function limitForPractice(){return Math.max(1,Math.min(15,Number(el('exerciseCount').value)||5));}
  function exerciseSentenceSamples(scope){
    const source=exerciseSourceSentences(scope);
    const unique=new Set();return source.filter(row=>{
      if(!isEnglishSentence(row.sentence))return false;
      const id=row.chapter+'|'+clean(row.sentence).toLocaleLowerCase('en');
      if(unique.has(id))return false;unique.add(id);return true;
    });
  }
  async function buildExtendedPractice(mode){
    const scope=el('exerciseScope').value,count=limitForPractice();
    if(mode==='copy'){
      const words=getPracticeVocabulary().filter(w=>/^[a-zA-Z][a-zA-Z'-]*(?:\s+[a-zA-Z][a-zA-Z'-]*){0,3}$/.test(w.term));
      const chapterFirst=words.filter(w=>w.chapter===currentIndex),other=words.filter(w=>w.chapter!==currentIndex);
      // Prefer newly encountered terms; do not invent vocabulary absent from the book.
      const chosen=shuffle(chapterFirst).concat(shuffle(other));
      if(scope==='chapter'){
        const filtered=chosen.filter(w=>w.chapter===currentIndex||exerciseSentenceSamples('chapter').some(row=>findWordSpan(row.sentence,w.term)));
        return filtered.slice(0,count).map(w=>({...w,mode,term:w.term}));
      }
      return chosen.slice(0,count).map(w=>({...w,mode,term:w.term}));
    }
    const source=exerciseSentenceSamples(scope);
    if(mode==='dictation')return shuffle(source.filter(r=>r.sentence.length<=240)).slice(0,count).map(q=>({...q,mode}));
    if(mode==='reverse'){
      const results=[];
      // Pull saved translations only, including translations hidden in the reader.
      // A translation is never generated merely to set up practice.
      const cached=await dbAll('sentenceCache').catch(()=>[]);
      const map=new Map();
      for(const entry of cached){
        if(!entry?.translation)continue;
        let bits;try{bits=JSON.parse(entry.key);}catch{continue;}
        if(!Array.isArray(bits)||bits[0]!==currentBook.id||bits[3]!=='vi')continue;
        const key=bits[1]+'|'+clean(bits[4]).toLocaleLowerCase('en');
        const prior=map.get(key);
        if(!prior||(entry.updatedAt||0)>(prior.updatedAt||0))map.set(key,entry);
      }
      const domMap=new Map();
      for(const unit of document.querySelectorAll('#readerContent .sentence-unit')){
        const original=clean(unit.querySelector('.sentence-text')?.textContent);
        const translated=clean(unit.querySelector('.sentence-translation')?.textContent);
        if(original&&translated&&!/^Không dịch được|^Đang tìm|^Đang dịch/.test(translated)){
          domMap.set(currentIndex+'|'+original.toLocaleLowerCase('en'),translated);
        }
      }
      for(const row of source){
        if(row.sentence.length>260)continue;
        const key=row.chapter+'|'+clean(row.sentence).toLocaleLowerCase('en');
        const translation=domMap.get(key)||map.get(key)?.translation||'';
        if(!translation||translation.length<5)continue;
        results.push({...row,mode,translation});
      }
      return shuffle(results).slice(0,count);
    }
    return [];
  }
  function practiceElement(tag,cls,textValue){
    const node=document.createElement(tag);
    if(cls)node.className=cls;
    if(textValue!==undefined)node.textContent=textValue;
    return node;
  }
  function makePracticeInput(q,index,round=0){
    const isCopy=q.mode==='copy';
    const field=document.createElement(isCopy?'input':'textarea');
    if(isCopy)field.type='text';else field.rows=3;
    field.className=isCopy?'practice-copy-input':'practice-textarea';
    field.dataset.question=index;
    field.dataset.round=round;
    field.autocapitalize='off';field.autocomplete='off';field.spellcheck=false;
    field.placeholder=isCopy?`Lần ${round+1} / 10`:q.mode==='reverse'?'Viết lại câu tiếng Anh…':'Nghe và chép câu tiếng Anh…';
    field.setAttribute('aria-label',isCopy?`Viết từ lần ${round+1}`:`Câu trả lời số ${index+1}`);
    field.addEventListener('input',()=>{
      field.classList.remove('is-correct','is-wrong');
      const result=el('exerciseAnswer'+index);if(result)result.hidden=true;
      updatePracticeProgress();
    });
    return field;
  }
  function renderExtendedPractice(){
    const list=el('exerciseQuestions');list.replaceChildren();
    if(!trainingQuestions.length){
      const message=practiceMode==='reverse'?'Chưa có câu song ngữ đã lưu trong phạm vi chọn. Bạn hãy dịch một số câu trong sách, sau đó quay lại tạo bài tập. Việc tạo bài không gọi API.':
        practiceMode==='copy'?'Chưa có từ mới đã tra/lưu trong phạm vi này. Hãy tra từ trong sách hoặc chọn “Toàn bộ sách”.':
        'Chương chưa có đủ câu tiếng Anh để tạo bài nghe. Hãy thử chương khác hoặc chọn toàn bộ sách.';
      list.append(practiceElement('p','practice-empty',message));
      el('exerciseStatus').textContent=message;return;
    }
    const title=practiceMode==='reverse'?'Nhìn bản dịch tiếng Việt, viết lại câu gốc bằng tiếng Anh.':practiceMode==='copy'?
      'Chép mỗi từ/cụm từ 10 lần. Bạn có thể xem từ mẫu và nghĩa khi viết.':'Nghe câu tiếng Anh rồi chép lại. Văn bản gốc chỉ hiện sau khi chấm hoặc xem đáp án.';
    el('exerciseStatus').textContent=`${trainingQuestions.length} mục · ${title}`;
    trainingQuestions.forEach((q,i)=>{
      const card=practiceElement('section','exercise-question practice-card');
      const head=practiceElement('div','exercise-question-head',`${i+1}. ${practiceMode==='copy'?'TỪ MỚI':`CHƯƠNG ${Number(q.chapter)+1}`}`);
      card.append(head);
      if(practiceMode==='reverse'){
        card.append(practiceElement('div','practice-vi-prompt',q.translation));
        card.append(practiceElement('label','practice-input-label','Viết lại bằng tiếng Anh:'));
        card.append(makePracticeInput(q,i));
      }else if(practiceMode==='copy'){
        card.append(practiceElement('div','practice-copy-source',q.term));
        if(q.meaning)card.append(practiceElement('div','practice-copy-meaning',q.meaning));
        if(q.context)card.append(practiceElement('div','practice-copy-context','Trong sách: '+q.context));
        const grid=practiceElement('div','practice-copy-grid');
        for(let n=0;n<10;n++)grid.append(makePracticeInput(q,i,n));
        card.append(grid);
        card.append(practiceElement('div','practice-copy-counter',`0/10 lần đã viết · 0/10 đúng`));
      }else if(practiceMode==='dictation'){
        const toolbar=practiceElement('div','practice-listen-row');
        const listen=practiceElement('button','secondary-btn compact practice-listen-btn','🔊 Nghe câu');listen.type='button';
        listen.addEventListener('click',()=>playPracticeSentence(q,i,false));
        toolbar.append(listen);
        if(settings.ttsEngine!=='device'){
          const create=practiceElement('button','secondary-btn compact practice-premium-btn','♫ Tạo bằng API (tùy chọn)');create.type='button';
          create.title='Chỉ gọi API sau khi bạn xác nhận; các bản ghi đã có được ưu tiên dùng lại.';
          create.addEventListener('click',()=>playPracticeSentence(q,i,true));
          toolbar.append(create);
        }
        const status=practiceElement('div','practice-listen-status','Giọng đã lưu nếu có; nếu chưa có, dùng giọng miễn phí của thiết bị.');status.id='practiceListenStatus'+i;
        card.append(toolbar,status,makePracticeInput(q,i));
      }
      const result=practiceElement('div','exercise-answer practice-answer');result.id='exerciseAnswer'+i;result.hidden=true;
      card.append(result);list.append(card);
    });
  }
  function updatePracticeProgress(){
    const bar=el('exerciseCompletion'),label=el('exerciseCompletionLabel');if(!bar)return;
    const inputs=[...el('exerciseQuestions').querySelectorAll('input,textarea')];
    const filled=inputs.filter(x=>x.value.trim()).length,total=inputs.length;
    if(practiceMode==='copy'){
      for(const card of el('exerciseQuestions').querySelectorAll('.practice-card')){
        const fields=[...card.querySelectorAll('.practice-copy-input')];
        const counter=card.querySelector('.practice-copy-counter');
        const good=fields.filter(x=>x.classList.contains('is-correct')).length;
        if(counter)counter.textContent=`${fields.filter(x=>x.value.trim()).length}/10 lần đã viết · ${good}/10 đúng`;
      }
    }
    bar.value=total?filled/total*100:0;
    label.textContent=total?`${filled}/${total} ô đã điền`:'Chưa có câu hỏi';
  }
  function recordPracticeStats(correct,total,scorePercent){
    if(!currentState)return;
    if(!currentState.exerciseStats)currentState.exerciseStats={};
    const id=String(Date.now())+'-'+Math.floor(Math.random()*1000);
    currentState.exerciseStats[id]={mode:practiceMode,correct,total,scorePercent,chapter:currentIndex,updatedAt:Date.now()};
    const keys=Object.keys(currentState.exerciseStats).sort((a,b)=>Number((currentState.exerciseStats[b]||{}).updatedAt)-Number((currentState.exerciseStats[a]||{}).updatedAt));
    keys.slice(80).forEach(k=>delete currentState.exerciseStats[k]);
    currentState.updatedAt=Date.now();scheduleSave();
  }
  function checkExtendedPractice(reveal=false){
    if(!trainingQuestions.length)return;
    let correct=0,total=0;
    trainingQuestions.forEach((q,i)=>{
      const card=el('exerciseQuestions').children[i];
      const inputs=[...card.querySelectorAll('input,textarea')];
      const expected=q.mode==='copy'?q.term:q.sentence;
      const result=el('exerciseAnswer'+i);
      let right=0;
      inputs.forEach(input=>{
        const entered=input.value.trim();
        const match=q.mode==='copy'?cleanAnswer(entered)===cleanAnswer(expected):wordDistance(expected,entered)>=90;
        if(match)right++;
        input.classList.toggle('is-correct',match);input.classList.toggle('is-wrong',!!entered&&!match);
        input.setAttribute('aria-invalid',String(!!entered&&!match));
      });
      correct+=right;total+=inputs.length;
      result.hidden=false;
      if(q.mode==='copy'){
        result.textContent=`${right}/10 lần đúng${reveal?' · Từ mẫu: '+q.term:''}.`;
        card.querySelector('.practice-copy-counter').textContent=`${inputs.filter(x=>x.value.trim()).length}/10 lần đã viết · ${right}/10 đúng`;
      }else{
        const percent=wordDistance(expected,inputs[0]?.value||'');
        result.replaceChildren(
          practiceElement('strong','',percent>=90?'✓ Đúng / rất gần bản gốc':`${percent}% trùng khớp bản gốc`),
          practiceElement('p','practice-correct-sentence',`Đáp án gốc: ${expected}`)
        );
      }
    });
    const percent=Math.round(correct/Math.max(1,total)*100);
    updatePracticeProgress();
    el('exerciseStatus').textContent=reveal?`Đã hiện đáp án · ${correct}/${total} mục đúng`:
      `Kết quả: ${correct}/${total} mục đúng (${percent}%). Các câu viết được so sánh theo từ, không phân biệt chữ hoa và dấu câu.`;
    if(!reveal)recordPracticeStats(correct,total,percent);
  }
  function stopPracticeAudio(){
    practiceSpeechToken++;
    try{practiceSound?.pause();if(practiceSound)practiceSound.removeAttribute('src');}catch{}
    if(practiceSoundUrl){URL.revokeObjectURL(practiceSoundUrl);practiceSoundUrl='';}
    if(practiceSpeaking && 'speechSynthesis' in window)try{speechSynthesis.cancel();}catch{}
    practiceSpeaking=false;
  }
  function practiceAudioStatus(i,msg){const target=el('practiceListenStatus'+i);if(target)target.textContent=msg;}
  function deviceDictation(text,index,token){
    if(!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined'){
      practiceAudioStatus(index,'Thiết bị không hỗ trợ giọng đọc miễn phí. Hãy kiểm tra trình duyệt.');return;
    }
    try{
      const say=new SpeechSynthesisUtterance(text);say.lang='en-US';say.rate=Number(el('exerciseListenSpeed')?.value)||1;
      const voices=speechSynthesis.getVoices();const selected=voices.find(v=>v.voiceURI===settings.voice&&v.lang?.toLowerCase().startsWith('en'));
      const fallback=voices.find(v=>v.lang?.toLowerCase().startsWith('en'));
      if(selected||fallback)say.voice=selected||fallback;
      say.onstart=()=>{if(token===practiceSpeechToken)practiceAudioStatus(index,'Đang đọc bằng giọng thiết bị miễn phí…');};
      say.onend=()=>{if(token===practiceSpeechToken)practiceAudioStatus(index,'Đã phát xong. Hãy viết lại câu vừa nghe.');};
      say.onerror=e=>{if(token===practiceSpeechToken)practiceAudioStatus(index,'Lỗi giọng thiết bị: '+(e?.error||'không xác định'));};
      practiceSpeaking=true;speechSynthesis.cancel();
      setTimeout(()=>{if(token===practiceSpeechToken){try{speechSynthesis.speak(say);}catch(e){practiceAudioStatus(index,e.message);}}},70);
    }catch(e){practiceAudioStatus(index,'Không đọc được: '+e.message);}
  }
  async function savedPracticeClip(text,index){
    if(settings.ttsEngine==='device')return null;
    try{
      const {id,profile}=await audioIdentity(text);
      const local=await dbGet('audioCache',id).catch(()=>null);
      if(local?.blob?.size)return {blob:local.blob,source:'thiết bị'};
      if(cloudEnabledForScope()){
        practiceAudioStatus(index,'Đang tìm audio đã lưu trên Google Drive…');
        const blob=await window.EReaderCloud.downloadAudio(id);
        if(blob?.size){await dbPut('audioCache',{id,profile,blob,createdAt:Date.now(),syncedAt:Date.now()}).catch(()=>{});return {blob,source:'Google Drive'};}
      }
    }catch(e){practiceAudioStatus(index,'Không kiểm tra được bản ghi Drive: '+e.message+' · sẽ dùng giọng thiết bị.');}
    return null;
  }
  async function playPracticeSentence(q,index,allowPaid=false){
    if(!q||!el('exerciseModal')||el('exerciseModal').hidden)return;
    stopPracticeAudio();const token=practiceSpeechToken;
    practiceAudioStatus(index,'Đang kiểm tra bản ghi âm đã có…');
    const cached=await savedPracticeClip(q.sentence,index);
    if(token!==practiceSpeechToken)return;
    let clip=cached;
    if(!clip&&allowPaid&&settings.ttsEngine!=='device'){
      if(!window.confirm('Chưa có bản ghi cho câu này. Bạn muốn gọi '+(settings.ttsEngine==='google'?'Google Cloud TTS':'Gemini TTS')+' để tạo âm thanh mới? Yêu cầu có thể phát sinh phí.')){
        practiceAudioStatus(index,'Đã hủy tạo âm thanh trả phí.');return;
      }
      practiceAudioStatus(index,'Đang tạo audio bằng API theo yêu cầu của bạn…');
      try{clip=await getAudioCached(q.sentence,{onStage:msg=>{if(token===practiceSpeechToken)practiceAudioStatus(index,msg);}});}
      catch(e){if(token===practiceSpeechToken)practiceAudioStatus(index,'Tạo audio thất bại: '+e.message);return;}
    }
    if(token!==practiceSpeechToken)return;
    if(clip?.blob?.size){
      try{
        practiceSound=new Audio();practiceSoundUrl=URL.createObjectURL(clip.blob);
        practiceSound.src=practiceSoundUrl;practiceSound.playbackRate=Number(el('exerciseListenSpeed')?.value)||1;
        practiceSound.onended=()=>{if(token===practiceSpeechToken)practiceAudioStatus(index,'Đã phát xong · '+(clip.source||'audio đã lưu'));};
        practiceSound.onerror=()=>{if(token===practiceSpeechToken)practiceAudioStatus(index,'Không mở được tệp âm thanh; thử giọng thiết bị.');};
        await practiceSound.play();practiceAudioStatus(index,'Đang nghe audio từ '+(clip.source||'bộ nhớ')+' · Không gọi API.');
      }catch(e){practiceAudioStatus(index,'Trình duyệt chưa cho phép phát. Hãy bấm nghe lại.');}
    }else{
      practiceAudioStatus(index,'Chưa có bản ghi. Đang sử dụng giọng thiết bị miễn phí.');
      deviceDictation(q.sentence,index,token);
    }
  }
  function adjustPracticeMode(){
    const mode=el('exerciseMode').value;
    const count=el('exerciseCount');const previous=count.value;
    const options=mode==='copy'?[[1,'1 từ × 10 lần'],[3,'3 từ × 10 lần'],[5,'5 từ × 10 lần']]:
      mode==='cloze'?[[5,'5 câu'],[10,'10 câu'],[15,'15 câu']]:[[3,'3 câu'],[5,'5 câu'],[10,'10 câu']];
    count.replaceChildren(...options.map(([v,label])=>new Option(label,String(v))));
    count.value=options.some(([v])=>String(v)===previous)?previous:String(mode==='copy'?3:mode==='cloze'?10:5);
    el('exerciseModeDescription').textContent={
      cloze:'Ẩn các từ bạn đã tra trong đoạn gốc. Điền từ tiếng Anh còn thiếu.',
      reverse:'Xem bản dịch tiếng Việt đã lưu và viết lại câu tiếng Anh. Không tự dịch mới, không tốn API.',
      copy:'Xem từ mới đã tra/lưu và chép đúng 10 lần để luyện ghi nhớ chính tả.',
      dictation:'Nghe tiếng Anh và chép lại cả câu. Ưu tiên audio đã lưu, nếu chưa có dùng giọng thiết bị miễn phí.'
    }[mode];
    el('exerciseListenSpeedRow').hidden=mode!=='dictation';
    el('exerciseQuestions').replaceChildren();
    trainingQuestions=[];el('exerciseCheck').disabled=true;el('exerciseReveal').disabled=true;
    stopPracticeAudio();updatePracticeProgress();
    el('exerciseStatus').textContent='Chọn Tạo bài tập để bắt đầu chế độ '+el('exerciseMode').selectedOptions[0].text+'.';
  }

  function startSingleSentencePractice(q,requestedMode){
    if(!q?.sentence||!currentBook)return;
    const hasTranslation=Boolean(clean(q.translation));
    const mode=requestedMode||(hasTranslation?'reverse':'dictation');
    const effective=mode==='reverse'&&!hasTranslation?'dictation':mode;
    el('exerciseModal').hidden=false;
    el('exerciseMode').value=effective;
    adjustPracticeMode();practiceMode=effective;
    trainingQuestions=[{sentence:clean(q.sentence),translation:clean(q.translation),chapter:Number.isInteger(q.chapter)?q.chapter:currentIndex,mode:effective}];
    el('exerciseCheck').disabled=false;el('exerciseReveal').disabled=false;
    if(effective==='dictation')el('exerciseListenSpeedRow').hidden=false;
    renderExtendedPractice();updatePracticeProgress();
    const choice=el('exerciseCurrentSentenceOptions');
    if(choice){choice.hidden=false;choice.dataset.sentence=clean(q.sentence);choice.dataset.translation=clean(q.translation);choice.dataset.chapter=String(q.chapter);}
  }
  function startSingleWordPractice(q){
    if(!currentBook||!q?.term)return;
    el('exerciseModal').hidden=false;
    el('exerciseMode').value='copy';adjustPracticeMode();practiceMode='copy';
    trainingQuestions=[{term:clean(q.term),meaning:clean(q.meaning),context:clean(q.context),chapter:Number.isInteger(q.chapter)?q.chapter:currentIndex,mode:'copy'}];
    el('exerciseCheck').disabled=false;el('exerciseReveal').disabled=false;
    const choice=el('exerciseCurrentSentenceOptions');if(choice)choice.hidden=true;
    renderExtendedPractice();updatePracticeProgress();
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
    // V24.8: closing any audio dialog NEVER stops the player.
    // Only the explicit × on the permanent player stops the audio.
    el('quickSavedAudioButton')?.addEventListener('click',quickPlaySavedChapter);
    el('savedChapterPlayPause')?.addEventListener('click',toggleSavedPlayer);
    el('savedChapterStop')?.addEventListener('click',stopLibraryPlayer);
    el('savedChapterRate')?.addEventListener('change',e=>{
      el('chapterLibraryPlayer').playbackRate=Math.min(2.5,Math.max(.5,Number(e.target.value)||1));
    });
    const savedPlayer=el('chapterLibraryPlayer');
    for(const eventName of ['play','pause','ended','loadedmetadata','ratechange','emptied'])savedPlayer.addEventListener(eventName,updateSavedPlayerUi);
    savedPlayer.addEventListener('error',()=>{
      if(savedPlayer.error){audioStatus('Không mở được bản ghi. Hãy chọn lại file trong thư viện audio.');notify('Không phát được file audio, hãy kiểm tra tệp đã lưu.',5000);}
    });
    // When changing to live TTS, pause the recorded audio to avoid two voices at once.
    el('readAloudButton')?.addEventListener('click',()=>{if(!savedPlayer.paused)savedPlayer.pause();},true);
    el('readerContent')?.addEventListener('click',e=>{
      if(e.target.closest('.sentence-speak-btn')&&!savedPlayer.paused)savedPlayer.pause();
    },true);

    window.EReaderPractice=Object.assign(window.EReaderPractice||{}, {
      startSentence:startSingleSentencePractice,
      startWord:startSingleWordPractice
    });
    el('exerciseSentenceReverse')?.addEventListener('click',()=>{
      const box=el('exerciseCurrentSentenceOptions');startSingleSentencePractice({sentence:box.dataset.sentence,translation:box.dataset.translation,chapter:Number(box.dataset.chapter)},'reverse');
    });
    el('exerciseSentenceDictation')?.addEventListener('click',()=>{
      const box=el('exerciseCurrentSentenceOptions');startSingleSentencePractice({sentence:box.dataset.sentence,translation:box.dataset.translation,chapter:Number(box.dataset.chapter)},'dictation');
    });
    el('lookupPracticeCopy')?.addEventListener('click',()=>{
      const q=lookupSnapshot;if(!q)return;
      el('translationModal').hidden=true;
      startSingleWordPractice({term:q.text,meaning:q.translation,context:q.context,chapter:q.chapter});
    });
    el('exerciseMode')?.addEventListener('change',adjustPracticeMode);
    adjustPracticeMode();
    el('exerciseButton')?.addEventListener('click',()=>{if(!currentBook)return notify('Hãy mở một cuốn sách.');
      el('exerciseModal').hidden=false;startPractice();});
    el('exerciseGenerate')?.addEventListener('click',()=>{const options=el('exerciseCurrentSentenceOptions');if(options)options.hidden=true;startPractice();});
    el('exerciseCheck')?.addEventListener('click',()=>checkPractice(false));
    el('exerciseReveal')?.addEventListener('click',()=>checkPractice(true));
    el('exerciseModal')?.addEventListener('keydown',e=>{
      if(e.key==='Enter'&&e.target.matches('.exercise-blank')){e.preventDefault();checkPractice(false);}
    });
    el('exerciseModal')?.querySelector('[data-dismiss="exerciseModal"]')?.addEventListener('click',stopPracticeAudio);
    el('exerciseModal')?.addEventListener('click',e=>{if(e.target.id==='exerciseModal')stopPracticeAudio();});
  }
  document.addEventListener('DOMContentLoaded',initV246);
})();
