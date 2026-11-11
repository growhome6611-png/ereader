'use strict';
/* E-Reader V25.1 Word Lab: source-based IPA analysis, conservative morphology,
   Openverse images with attribution, offline-friendly text flashcards. */
(function(){
 const $=id=>document.getElementById(id);
 const validWord=s=>/^[a-z]+(?:['’-][a-z]+)*$/i.test(String(s||''))&&String(s).length<75;
 const secureUrl=s=>{try{const u=new URL(String(s||''));return u.protocol==='https:'?u.href:'';}catch{return '';}};
 let current=null,chosenImage=null,imageResults=[],fetchController=null,reviewIdx=0,reviewBack=false,imagePage=0,hasMoreImages=false,imageQuery="";
 function bridge(){return window.EReaderWordLabBridge;}
 function context(){return bridge()?.context?.()||null;}
 function e(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
 function setStatus(message){const n=$('wordLabStatus');if(n)n.textContent=message||'';}
 function normIpa(raw){return String(raw||'').replace(/^[\/[\s]+/,'').replace(/[\]/\s]+$/,'').trim();}
 function splitIPA(raw){
   const text=normIpa(raw);
   if(!text)return {syllables:[],primary:-1,secondary:-1,hasBoundaries:false};
   const hasBoundaries=text.includes('.')||/[^ˈˌ][ˈˌ]/u.test(text);
   const pieces=text.replace(/([^.ˈˌ])([ˈˌ])/gu,'$1.$2').split('.').filter(Boolean);
   const syllables=pieces.map(piece=>({text:piece.replace(/[ˈˌ]/gu,''),primary:piece.includes('ˈ'),secondary:piece.includes('ˌ')})).filter(p=>p.text);
   return {syllables,primary:syllables.findIndex(p=>p.primary),secondary:syllables.findIndex(p=>p.secondary),hasBoundaries};
 }
 const phonemes=[
  ['tʃ','/tʃ/','âm “ch” như trong chair'],['dʒ','/dʒ/','âm “j” như trong job'],['ʃ','/ʃ/','âm “sh” như trong she'],['ʒ','/ʒ/','âm trong measure'],
  ['θ','/θ/','đưa lưỡi giữa hai răng, thổi hơi'],['ð','/ð/','đưa lưỡi giữa hai răng, có rung thanh'],['ŋ','/ŋ/','âm ng ở cuối sing'],
  ['ə','/ə/','schwa – nguyên âm rất nhẹ, không nhấn'],['ɪ','/ɪ/','âm i ngắn'],['æ','/æ/','âm a bẹt'],['ɜː','/ɜː/','âm ơ kéo dài'],['ɑː','/ɑː/','âm a dài'],['ɔː','/ɔː/','âm o dài']
 ];
 const prefixRules=[
  ['un','phủ định / ngược lại'],['dis','phủ định / tách ra'],['re','làm lại'],['pre','trước'],['mis','sai / nhầm'],['non','không'],
  ['inter','giữa / tương tác'],['anti','chống lại'],['sub','dưới'],['trans','xuyên qua / thay đổi'],['over','quá mức'],['under','dưới mức']
 ];
 const suffixRules=[
  ['ation','thường tạo danh từ chỉ hành động/kết quả'],['tion','thường tạo danh từ'],['sion','thường tạo danh từ'],
  ['ment','thường tạo danh từ'],['ness','trạng thái/tính chất'],['less','thiếu / không có'],['ful','đầy / có'],
  ['able','có thể / đáng được'],['ible','có thể'],['ity','thường tạo danh từ'],['ly','thường tạo trạng từ'],
  ['ize','làm cho / biến thành'],['ise','làm cho / biến thành'],['ism','học thuyết / khuynh hướng'],['ous','mang tính chất'],
  ['ing','dạng V-ing (không phải lúc nào cũng là hậu tố tạo từ)'],['ed','dạng quá khứ/V3 (không phải lúc nào cũng là hậu tố tạo từ)']
 ];
 function chooseRule(word,rules,position){
  return rules.filter(([part])=>word.length-part.length>=3&&(position==='prefix'?word.startsWith(part):word.endsWith(part)))
   .sort((a,b)=>b[0].length-a[0].length)[0]||null;
 }
 function renderAnalysis(ctx){
  const p=$('wordLabPronunciation'),m=$('wordLabMorphology');if(!p||!m)return;
  p.replaceChildren();m.replaceChildren();
  p.append(e('h4','','PHÂN TÍCH PHÁT ÂM VÀ TRỌNG ÂM'));
  const directIPA=ctx.ipaUK||ctx.ipaUS||ctx.ipa||'';
  const raw=directIPA||ctx.lemmaIPA||'';
  const ipa=e('div','wordlab-ipa',raw||'Chưa có IPA từ nguồn từ điển hiện tại');p.append(ipa);
  if(!directIPA&&ctx.lemmaWord&&ctx.lemmaIPA)p.append(e('p','wordlab-help','Phiên âm tham khảo của từ gốc “'+ctx.lemmaWord+'” – không phải IPA xác nhận của “'+ctx.word+'”.'));
  if(ctx.ipaUK&&ctx.ipaUS&&ctx.ipaUK!==ctx.ipaUS){p.append(e('div','wordlab-status','UK: '+ctx.ipaUK+'  ·  US: '+ctx.ipaUS));}
  if(raw){
   const parsed=splitIPA(raw);
   if(parsed.hasBoundaries&&parsed.syllables.length>1){
    const wrap=e('div','wordlab-syllables');parsed.syllables.forEach(s=>{const x=e('span','wordlab-syllable'+(s.primary?' primary':s.secondary?' secondary':''),s.text);x.title=s.primary?'Trọng âm chính':s.secondary?'Trọng âm phụ':'Âm tiết';wrap.append(x);});p.append(wrap);
    if(parsed.primary>=0)p.append(e('div','wordlab-status','Dấu nhấn chính ˈ: âm tiết '+(parsed.primary+1)+' trong cách chia của phiên âm nguồn.'));
   }else p.append(e('p','wordlab-help',/ˈ/u.test(raw)?'Nguồn IPA có dấu trọng âm ˈ nhưng không chia rõ đủ âm tiết: không tự suy ra vị trí.':'Nguồn chưa cung cấp đầy đủ dấu chia âm tiết/trọng âm.'));
   const notes=phonemes.filter(([symbol])=>normIpa(raw).includes(symbol));
   if(notes.length){const block=e('div','wordlab-morph-grid');notes.slice(0,5).forEach(([sym,label,detail])=>{const item=e('div','wordlab-morph-item');item.append(e('strong','',label),e('span','',detail));block.append(item);});p.append(e('h4','','ÂM CẦN CHÚ Ý'),block);}
  }
  m.append(e('h4','','TIỀN TỐ · HẬU TỐ'));
  const word=ctx.word.toLowerCase();const pre=chooseRule(word,prefixRules,'prefix'),suf=chooseRule(word,suffixRules,'suffix');
  const list=e('div','wordlab-morph-grid');
  if(pre){const box=e('div','wordlab-morph-item');box.append(e('strong','','Tiền tố có thể: '+pre[0]+'-'),e('span','',pre[1]));list.append(box);}
  if(suf){const box=e('div','wordlab-morph-item');box.append(e('strong','','Phần cuối: -'+suf[0]),e('span','',suf[1]));list.append(box);}
  if(!pre&&!suf)list.append(e('span','wordlab-help','Chưa nhận diện được tiền tố/hậu tố thông dụng đáng tin cậy.'));
  m.append(list,e('p','wordlab-help','Đây là dấu hiệu hình thái gợi ý, không khẳng định nguồn gốc hay cấu tạo thực tế của từ. Hãy đối chiếu mục Etymology trên Wiktionary.'));
 }
 function updateLinks(word){
  $('wordLabWiktionary').href='https://en.wiktionary.org/wiki/'+encodeURIComponent(word);
  $('wordLabYouGlish').href='https://youglish.com/pronounce/'+encodeURIComponent(word)+'/english';
  $('wordLabOpenverse').href='https://openverse.org/search/image?q='+encodeURIComponent(word);
 }
 function savedImage(word){return bridge()?.cards?.().find(c=>c.word?.toLowerCase()===word.toLowerCase())?.image||null;}
 function media(){return window.EReaderFlashcardMedia;}
 function mediaStatus(msg){const target=$('wordLabMediaStatus');if(target)target.textContent=msg;setStatus(msg);}
 async function setMediaImage(img,ref,owner){
   if(!ref)return;
   const source=await media()?.resolve?.(ref).catch(()=>null);
   if(source&&img.isConnected&&owner())img.src=source;
 }
 async function chooseLocalFile(file){
   if(!current||!file)return;const ctx=current;
   mediaStatus('Đang nén ảnh và lưu trên điện thoại…');
   try{
     const result=await media().remember(file,ctx);
     if(!current||current.word!==ctx.word||current.chapter!==ctx.chapter)return;
     chosenImage=result;preview();imageCards();
     mediaStatus('Đã lưu ảnh trên thiết bị. Bấm “Lưu flashcard” để gắn vào từ và đồng bộ lên Drive khi đã đăng nhập.');
   }catch(err){mediaStatus('Không nhập được ảnh: '+err.message);}
 }
 async function chooseDirectUrl(){
   if(!current)return;const raw=$('wordLabImageUrl')?.value||'';const ctx=current;
   mediaStatus('Đang thử tải ảnh từ liên kết…');
   try{
     const result=await media().fromUrl(raw,ctx);
     if(!current||current.word!==ctx.word||current.chapter!==ctx.chapter)return;
     chosenImage=result.image;preview();imageCards();
     mediaStatus(result.offline?'Đã lưu tệp ảnh từ liên kết trên thiết bị. Bấm “Lưu flashcard” để hoàn tất.':result.warning);
   }catch(err){mediaStatus('Không dùng được liên kết: '+err.message);}
 }
 function preview(){
  const slot=$('wordLabPreview');if(!slot||!current)return;
  slot.hidden=false;slot.replaceChildren();
  if(chosenImage){const ref=chosenImage;const image=e('img');image.alt='Ảnh minh họa '+current.word;image.loading='lazy';image.referrerPolicy='no-referrer';image.onerror=()=>{image.remove();};slot.append(image);
    setMediaImage(image,ref,()=>chosenImage===ref&&slot===document.getElementById('wordLabPreview'));
  }
  slot.append(e('strong','',current.word));
  if(current.ipaUK||current.ipaUS||current.ipa)slot.append(e('span','wordlab-help',current.ipaUK||current.ipaUS||current.ipa));
  else if(current.lemmaIPA)slot.append(e('span','wordlab-help','IPA từ gốc '+current.lemmaWord+': '+current.lemmaIPA));
  slot.append(e('p','',current.meaning||'Bấm tra/dịch để có nghĩa tiếng Việt.'));
  if(chosenImage){const cr=e('div','wordlab-help','Nguồn ảnh: '+(chosenImage.creator||'không ghi tác giả')+' · '+(chosenImage.license||'')+' · '+(chosenImage.source||'Openverse'));slot.append(cr);if(chosenImage.sourcePage){const a=e('a','', 'Xem ảnh gốc và giấy phép ↗');a.href=chosenImage.sourcePage;a.target='_blank';a.rel='noopener noreferrer';slot.append(a);}}
 }
 function suggestedImageQueries(ctx){
  const word=String(ctx.word||'').toLowerCase();const meaning=String(ctx.meaning||'').toLowerCase();
  let q=[];
  // Search for the VISUAL idea rather than the adverb/dictionary headword.
  if(/emot|feeling|exhilar|joy|happ|sad|angry|fear|anxi|depress|worri|stress|excite|enthusias/.test(word)||/cảm xúc|tình cảm|phấn khích|vui vẻ|buồn|lo lắng|hào hứng/.test(meaning))
   q=['human facial expressions emotions','people showing different feelings','emotion illustration','emotional wellbeing'];
  else if(/repet|repeat/.test(word)||/lặp lại|lặp đi lặp lại/.test(meaning))
   q=['repetition pattern illustration','repeated actions concept','repetitive pattern'];
  else if(/audien|spectat/.test(word)||/khán giả/.test(meaning))
   q=['theater audience crowd','audience watching performance','concert crowd'];
  else if(/train|educat|learn|study|teach/.test(word)||/đào tạo|học tập|giảng dạy|giáo dục/.test(meaning))
   q=['people learning in classroom','teacher training students','education illustration'];
  else if(/manag|leader|teamwork|collaborat|productiv/.test(word)||/quản lý|lãnh đạo|làm việc nhóm|hiệu suất/.test(meaning))
   q=['teamwork office meeting','people working together','leadership illustration'];
  else if(/decid|choos|select/.test(word)||/lựa chọn|quyết định/.test(meaning))
   q=['person making decision','crossroads choice illustration'];
  else if(/friend|relationship|communicat|conversation/.test(word)||/bạn bè|quan hệ|giao tiếp/.test(meaning))
   q=['people talking together','friendship illustration','people communication'];
  const root=word.endsWith('ically')?word.slice(0,-4):word.endsWith('ly')&&word.length>6?word.slice(0,-2):word;
  q.push(word+' illustration');
  if(root!==word)q.push(root+' concept');
  q.push(word);
  return [...new Set(q.map(v=>v.trim()).filter(v=>v.length>2))].slice(0,5);
 }
 function updateImageLinks(query){
  const q=String(query||current?.word||'').trim();
  if($('wordLabGoogleImages'))$('wordLabGoogleImages').href='https://www.google.com/search?tbm=isch&q='+encodeURIComponent(q);
  if($('wordLabOpenverse'))$('wordLabOpenverse').href='https://openverse.org/search/image?q='+encodeURIComponent(q);
  const suggestions=$('wordLabImageSuggestions');if(suggestions){
   [...suggestions.children].forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.query===q)));
  }
 }
 function renderSuggestions(ctx){
  const slot=$('wordLabImageSuggestions');if(!slot)return;
  slot.replaceChildren();const qs=suggestedImageQueries(ctx);
  qs.forEach(q=>{const btn=e('button','',''+q);btn.type='button';btn.dataset.query=q;
   btn.title='Tìm ảnh theo gợi ý: '+q;
   btn.addEventListener('click',()=>{const input=$('wordLabImageQuery');if(input)input.value=q;updateImageLinks(q);findImages(false);});
   slot.append(btn);
  });
  const input=$('wordLabImageQuery');if(input)input.value=qs[0]||ctx.word;
  updateImageLinks(input?.value||ctx.word);
 }
 function imageCards(){const slot=$('wordLabImages');slot.replaceChildren();imageResults.forEach(item=>{
   const btn=e('button','wordlab-image-card'+(chosenImage?.id===item.id?' selected':''));btn.type='button';
   const img=e('img');img.src=item.thumbnail;img.loading='lazy';img.alt=item.title||('Ảnh gợi nhớ '+current.word);img.referrerPolicy='no-referrer';
   img.onerror=()=>{if(img.dataset.fallback!=='1'&&item.url&&item.url!==item.thumbnail){img.dataset.fallback='1';img.src=item.url;return;}img.replaceWith(e('div','wordlab-image-broken','Không tải được hình thu nhỏ'));btn.disabled=true;};
   btn.append(img,e('small','',(item.title||item.creator||'Ảnh Openverse').slice(0,65)+' · '+item.license));
   btn.addEventListener('click',()=>{chosenImage=item;imageCards();preview();});slot.append(btn);
  });}
 async function findImages(more=false){if(!current)return;
  const word=current.word,input=$('wordLabImageQuery');const q=String(input?.value||word).trim();
  if(!q){setStatus('Nhập từ khóa tìm ảnh bằng tiếng Anh.');return;}
  if(q.length>120||!/^[a-z0-9\s,;:'’-]+$/i.test(q)){setStatus('Từ khóa chỉ gồm chữ cái tiếng Anh, tối đa 120 ký tự.');return;}
  if(more&&(!hasMoreImages||imageQuery!==q))return;
  const page=more?imagePage+1:1;
  fetchController?.abort();const controller=new AbortController();fetchController=controller;
  $('wordLabFindImages').disabled=true;$('wordLabMoreImages').disabled=true;
  updateImageLinks(q);setStatus(more?'Đang tìm thêm ảnh…':'Đang tìm hình minh họa phù hợp nghĩa, không chỉ khớp chữ…');
  try{
   const url='/api/flashcard-images?word='+encodeURIComponent(word)+'&q='+encodeURIComponent(q)+'&page='+page;
   const res=await fetch(url,{signal:controller.signal,credentials:'same-origin'});
   const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||'Không truy cập được Openverse');
   if(!current||current.word!==word||controller.signal.aborted||String(input?.value||'').trim()!==q)return;
   const incoming=Array.isArray(data.items)?data.items:[];
   const before=more?imageResults:[];const seen=new Set(before.map(x=>x.id));imageResults=before.slice();
   for(const item of incoming){if(item?.id&&!seen.has(item.id)){seen.add(item.id);imageResults.push(item);}}
   imageQuery=q;imagePage=page;hasMoreImages=!!data.hasMore;
   imageCards();$('wordLabMoreImages').hidden=!hasMoreImages;
   const count=$('wordLabImageCount');if(count)count.textContent=imageResults.length+' hình phù hợp đang hiển thị'+(hasMoreImages?' · Có thể xem thêm':'');
   setStatus(imageResults.length?'Chọn ảnh đúng ngữ cảnh; nhấn vào ảnh rồi kiểm tra giấy phép nguồn.':'Không tìm thấy ảnh đủ liên quan. Thử gợi ý khác, nhập cụm từ dễ hình dung hơn hoặc mở Google Hình ảnh.');
  }catch(err){if(!controller.signal.aborted)setStatus('Không tải được ảnh: '+err.message+'. Thử lại hoặc mở Google Hình ảnh bên dưới.');}
  finally{if(fetchController===controller){$('wordLabFindImages').disabled=false;$('wordLabMoreImages').disabled=false;}}
 }
 function refresh(){
  const x=context(),btn=$('wordLabToggle'),panel=$('wordLabPanel');if(!btn)return;
  const valid=!!(x&&validWord(x.word));btn.hidden=!valid;
  if(!valid){panel.hidden=true;return;}
  if(current?.word===x.word&&current?.chapter===x.chapter){
   const differs=JSON.stringify([current.ipaUK,current.ipaUS,current.ipa,current.lemmaWord,current.lemmaIPA,current.meaning])!==JSON.stringify([x.ipaUK,x.ipaUS,x.ipa,x.lemmaWord,x.lemmaIPA,x.meaning]);
   current=x;if(differs&&!panel.hidden){renderAnalysis(x);preview();}
  }
 }
 function reset(){current=null;imageResults=[];chosenImage=null;imageQuery='';imagePage=0;hasMoreImages=false;fetchController?.abort();if($('wordLabPanel'))$('wordLabPanel').hidden=true;
  if($('wordLabToggle'))$('wordLabToggle').setAttribute('aria-expanded','false');if($('wordLabImages'))$('wordLabImages').replaceChildren();}
 function toggle(){const x=context();if(!x||!validWord(x.word))return;
  const panel=$('wordLabPanel');if(!panel.hidden&&current?.word===x.word){panel.hidden=true;$('wordLabToggle').setAttribute('aria-expanded','false');return;}
  current=x;chosenImage=savedImage(x.word);imageResults=[];imagePage=0;hasMoreImages=false;imageQuery='';panel.hidden=false;$('wordLabToggle').setAttribute('aria-expanded','true');
  if($('wordLabImageUrl'))$('wordLabImageUrl').value='';
  setStatus('IPA lấy từ nguồn từ điển; tìm hình ảnh theo nghĩa hoặc tự nhập cụm từ tiếng Anh.');renderAnalysis(x);updateLinks(x.word);renderSuggestions(x);preview();$('wordLabImages').replaceChildren();$('wordLabMoreImages').hidden=true;const count=$('wordLabImageCount');if(count)count.textContent='Bấm Tìm ảnh để xem kết quả từ Openverse.';
 }
 function save(){if(!current)return;
  const card={word:current.word,meaning:current.meaning,ipa:current.ipa,ipaUK:current.ipaUK,ipaUS:current.ipaUS,
    lemmaWord:current.lemmaWord||'',lemmaIPA:current.lemmaIPA||'',
    audioUK:current.audioUK||'',audioUS:current.audioUS||'',genericAudio:current.genericAudio||'',
    context:current.context||'',image:chosenImage?{...chosenImage}:null};
  if(bridge()?.save(card)){
    if(chosenImage?.localKey){
      media()?.markForSync?.(chosenImage.localKey,current).then(()=>{media()?.syncSoon?.();mediaStatus('Đã lưu flashcard và ảnh trên thiết bị. Ảnh sẽ được đồng bộ lên Google Drive khi có quyền kết nối.');})
       .catch(err=>mediaStatus('Đã lưu flashcard nhưng chưa đánh dấu đồng bộ ảnh: '+err.message));
    }else mediaStatus('Đã lưu Flashcard. Ảnh bên ngoài chỉ lưu liên kết; để dùng ngoại tuyến nên tải ảnh về rồi chọn từ máy.');
  }
  else setStatus('Không thể lưu. Hãy mở từ trong một cuốn sách đang đọc.');
 }
 function aiPrompt(){if(!current)return;
  const text='Hãy tạo một hình minh họa flashcard học từ vựng tiếng Anh: "'+current.word+'". Nghĩa trong ngữ cảnh: "'+(current.meaning||'chưa có')+'". Câu ví dụ: "'+(current.context||'không có')+'". Hình vuông, phong cách minh họa giáo dục sáng sủa, dễ nhớ, không có chữ, không có logo, tránh diễn giải sai nghĩa.';
  if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(()=>setStatus('Đã sao chép yêu cầu tạo ảnh. Hãy mở Google AI Studio hoặc ChatGPT phía dưới để dán.'),()=>fallbackCopy(text));
  else fallbackCopy(text);
 }
 function fallbackCopy(text){try{const ta=e('textarea');ta.value=text;document.body.append(ta);ta.select();document.execCommand('copy');ta.remove();setStatus('Đã sao chép yêu cầu tạo ảnh AI.');}catch{setStatus('Không sao chép được. Bạn có thể mở AI từ liên kết bên dưới.');}}
 function review(){const cards=bridge()?.cards?.()||[];if(!cards.length){setStatus('Chưa có flashcard trong cuốn sách đang mở. Hãy chọn ảnh và lưu một từ trước.');return;}
  let mask=$('wordLabReviewMask');if(!mask){mask=e('div','wordlab-review-mask');mask.id='wordLabReviewMask';mask.hidden=true;document.body.append(mask);}
  mask.replaceChildren();const dialog=e('div','wordlab-review-dialog');const head=e('div','wordlab-review-head'),count=e('span','','Ôn flashcard'),exit=e('button','','×');exit.type='button';exit.onclick=()=>{mask.hidden=true;};head.append(count,exit);
  const card=e('button','wordlab-review-card');card.type='button';const ctrls=e('div','wordlab-review-controls');
  const prev=e('button','','← Trước'),flip=e('button','','Lật thẻ'),next=e('button','','Tiếp →');
  const listen=e('button','wordlab-listen','🔊 Nghe từ');listen.type='button';listen.title='Nghe cách phát âm của chính từ trên thẻ, không dùng IPA từ gốc để thay âm thanh.';
  listen.addEventListener('click',()=>{
    const item=cards[reviewIdx];if(!item)return;
    const audio=item.audioUS||item.audioUK||item.genericAudio||'';
    if(!bridge()?.pronounce?.(item.word,audio))setStatus('Không thể đọc từ trên thẻ.');
  });
  [prev,listen,flip,next].forEach(b=>{b.type='button';ctrls.append(b);});
  dialog.append(head,card,ctrls);mask.append(dialog);mask.hidden=false;reviewIdx=0;reviewBack=false;
  function paint(){const item=cards[reviewIdx];count.textContent='Flashcard '+(reviewIdx+1)+'/'+cards.length;card.replaceChildren();
   if(!reviewBack){if(item.image){const ref=item.image;const img=e('img');img.alt=item.word;img.onerror=()=>img.remove();card.append(img);
      setMediaImage(img,ref,()=>!reviewBack&&cards[reviewIdx]===item&&card.isConnected);
     }card.append(e('strong','',item.word),e('span','wordlab-help','Chạm để xem nghĩa tiếng Việt'));}
   else{card.append(e('strong','',item.meaning||'Chưa có nghĩa'));
    const direct=item.ipaUK||item.ipaUS||item.ipa||'';
    if(direct)card.append(e('p','',direct));
    else if(item.lemmaWord&&item.lemmaIPA)card.append(e('p','wordlab-help','Từ gốc '+item.lemmaWord+': '+item.lemmaIPA+' (IPA tham khảo)'));
    if(item.context)card.append(e('small','',item.context));if(item.image?.creator)card.append(e('small','wordlab-help','Ảnh: '+item.image.creator+' · '+(item.image.license||'')));}
  }
  card.onclick=()=>{reviewBack=!reviewBack;paint();};flip.onclick=card.onclick;
  prev.onclick=()=>{reviewIdx=(reviewIdx+cards.length-1)%cards.length;reviewBack=false;paint();};next.onclick=()=>{reviewIdx=(reviewIdx+1)%cards.length;reviewBack=false;paint();};
  mask.onclick=evt=>{if(evt.target===mask)mask.hidden=true;};paint();
 }
 function initialize(){
  const btn=$('wordLabToggle');if(!btn)return;
  btn.addEventListener('click',toggle);$('wordLabFindImages').addEventListener('click',()=>findImages(false));$('wordLabMoreImages').addEventListener('click',()=>findImages(true));$('wordLabImageQuery').addEventListener('input',evt=>updateImageLinks(evt.target.value));$('wordLabImageQuery').addEventListener('keydown',evt=>{if(evt.key==='Enter'){evt.preventDefault();findImages(false);}});
  $('wordLabSave').addEventListener('click',save);$('wordLabPrompt').addEventListener('click',aiPrompt);
  window.addEventListener('ereaderFlashcardImageUploaded',event=>{
    const ref=event.detail;
    if(chosenImage?.localKey===ref?.localKey){chosenImage.driveFileId=ref.driveFileId;preview();mediaStatus('Ảnh Flashcard đã được tải lên Google Drive và có thể mở trên máy khác.');}
  });
  $('wordLabChooseFile')?.addEventListener('click',()=>$('wordLabFileInput')?.click());
  $('wordLabFileInput')?.addEventListener('change',event=>{const file=event.target.files?.[0];if(file)chooseLocalFile(file);event.target.value='';});
  $('wordLabUseUrl')?.addEventListener('click',chooseDirectUrl);
  $('wordLabImageUrl')?.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();chooseDirectUrl();}});
  $('wordLabReview').addEventListener('click',review);$('wordLabSidebar')?.addEventListener('click',review);
  const el=$('lookupSource');const mo=new MutationObserver(refresh);mo.observe(el,{subtree:true,childList:true,characterData:true});refresh();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize);else initialize();
 window.EReaderWordLab={reset,refresh,splitIPA,chooseRule};
})();
