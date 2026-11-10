'use strict';
/* E-Reader V25.1 Word Lab: source-based IPA analysis, conservative morphology,
   Openverse images with attribution, offline-friendly text flashcards. */
(function(){
 const $=id=>document.getElementById(id);
 const validWord=s=>/^[a-z]+(?:['’-][a-z]+)*$/i.test(String(s||''))&&String(s).length<75;
 const secureUrl=s=>{try{const u=new URL(String(s||''));return u.protocol==='https:'?u.href:'';}catch{return '';}};
 let current=null,chosenImage=null,imageResults=[],fetchController=null,reviewIdx=0,reviewBack=false;
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
  const raw=ctx.ipaUK||ctx.ipaUS||ctx.ipa||'';
  const ipa=e('div','wordlab-ipa',raw||'Chưa có IPA từ nguồn từ điển hiện tại');p.append(ipa);
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
 function preview(){
  const slot=$('wordLabPreview');if(!slot||!current)return;
  slot.hidden=false;slot.replaceChildren();
  if(chosenImage?.thumbnail){const image=e('img');image.src=chosenImage.thumbnail;image.alt='Ảnh minh họa '+current.word;image.loading='lazy';image.referrerPolicy='no-referrer';image.onerror=()=>{image.remove();};slot.append(image);}
  slot.append(e('strong','',current.word));if(current.ipaUK||current.ipaUS||current.ipa)slot.append(e('span','wordlab-help',current.ipaUK||current.ipaUS||current.ipa));
  slot.append(e('p','',current.meaning||'Bấm tra/dịch để có nghĩa tiếng Việt.'));
  if(chosenImage){const cr=e('div','wordlab-help','Nguồn ảnh: '+(chosenImage.creator||'không ghi tác giả')+' · '+(chosenImage.license||'')+' · '+(chosenImage.source||'Openverse'));slot.append(cr);if(chosenImage.sourcePage){const a=e('a','', 'Xem ảnh gốc và giấy phép ↗');a.href=chosenImage.sourcePage;a.target='_blank';a.rel='noopener noreferrer';slot.append(a);}}
 }
 function imageCards(){const slot=$('wordLabImages');slot.replaceChildren();imageResults.forEach(item=>{
   const btn=e('button','wordlab-image-card'+(chosenImage?.id===item.id?' selected':''));btn.type='button';
   const img=e('img');img.src=item.thumbnail;img.loading='lazy';img.alt=item.title||('Ảnh gợi nhớ '+current.word);img.referrerPolicy='no-referrer';img.onerror=()=>{img.style.display='none';};
   btn.append(img,e('small','',(item.creator||'Tác giả chưa rõ')+' · '+item.license));
   btn.addEventListener('click',()=>{chosenImage=item;imageCards();preview();});slot.append(btn);
  });}
 async function findImages(){if(!current)return;
  const id=current.word;fetchController?.abort();const controller=new AbortController();fetchController=controller;
  $('wordLabFindImages').disabled=true;setStatus('Đang tìm ảnh có giấy phép dùng lại qua Openverse…');
  try{const res=await fetch('/api/flashcard-images?word='+encodeURIComponent(id),{signal:controller.signal,credentials:'same-origin'});
   const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||'Không truy cập được Openverse');
   if(!current||current.word!==id||controller.signal.aborted)return;
   imageResults=Array.isArray(data.items)?data.items:[];imageCards();
   setStatus(imageResults.length?'Chọn ảnh phù hợp nghĩa của từ. Kiểm tra giấy phép tại liên kết nguồn trước khi chia sẻ.':'Chưa tìm được ảnh phù hợp. Bạn vẫn có thể lưu flashcard không ảnh hoặc dùng liên kết AI.');
  }catch(err){if(!controller.signal.aborted)setStatus('Không tải được ảnh: '+err.message+'. Dùng Openverse hoặc AI qua liên kết bên dưới.');}
  finally{if(fetchController===controller)$('wordLabFindImages').disabled=false;}
 }
 function refresh(){
  const x=context(),btn=$('wordLabToggle'),panel=$('wordLabPanel');if(!btn)return;
  const valid=!!(x&&validWord(x.word));btn.hidden=!valid;
  if(!valid){panel.hidden=true;return;}
  if(current?.word===x.word&&current?.chapter===x.chapter){
   const differs=JSON.stringify([current.ipaUK,current.ipaUS,current.ipa,current.meaning])!==JSON.stringify([x.ipaUK,x.ipaUS,x.ipa,x.meaning]);
   current=x;if(differs&&!panel.hidden){renderAnalysis(x);preview();}
  }
 }
 function reset(){current=null;imageResults=[];chosenImage=null;fetchController?.abort();if($('wordLabPanel'))$('wordLabPanel').hidden=true;
  if($('wordLabToggle'))$('wordLabToggle').setAttribute('aria-expanded','false');if($('wordLabImages'))$('wordLabImages').replaceChildren();}
 function toggle(){const x=context();if(!x||!validWord(x.word))return;
  const panel=$('wordLabPanel');if(!panel.hidden&&current?.word===x.word){panel.hidden=true;$('wordLabToggle').setAttribute('aria-expanded','false');return;}
  current=x;chosenImage=savedImage(x.word);imageResults=[];panel.hidden=false;$('wordLabToggle').setAttribute('aria-expanded','true');
  setStatus('IPA lấy từ nguồn từ điển đang kết nối; ảnh tìm trực tiếp qua Openverse khi bạn yêu cầu.');renderAnalysis(x);updateLinks(x.word);preview();$('wordLabImages').replaceChildren();
 }
 function save(){if(!current)return;
  const card={word:current.word,meaning:current.meaning,ipa:current.ipa,ipaUK:current.ipaUK,ipaUS:current.ipaUS,context:current.context||'',image:chosenImage?{...chosenImage}:null};
  if(bridge()?.save(card)){setStatus('Đã lưu flashcard vào sổ tay cuốn sách; khi đồng bộ Drive, thông tin ảnh/nguồn sẽ đi theo dữ liệu sách.');}
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
  const card=e('button','wordlab-review-card');card.type='button';const ctrls=e('div','wordlab-review-controls');const prev=e('button','','← Trước'),flip=e('button','','Lật thẻ'),next=e('button','','Tiếp →');[prev,flip,next].forEach(b=>{b.type='button';ctrls.append(b);});
  dialog.append(head,card,ctrls);mask.append(dialog);mask.hidden=false;reviewIdx=0;reviewBack=false;
  function paint(){const item=cards[reviewIdx];count.textContent='Flashcard '+(reviewIdx+1)+'/'+cards.length;card.replaceChildren();
   if(!reviewBack){if(item.image?.thumbnail){const img=e('img');img.src=item.image.thumbnail;img.alt=item.word;img.onerror=()=>img.remove();card.append(img);}card.append(e('strong','',item.word),e('span','wordlab-help','Chạm để xem nghĩa tiếng Việt'));}
   else{card.append(e('strong','',item.meaning||'Chưa có nghĩa'),e('p','',item.ipaUK||item.ipaUS||item.ipa||''));if(item.context)card.append(e('small','',item.context));if(item.image?.creator)card.append(e('small','wordlab-help','Ảnh: '+item.image.creator+' · '+(item.image.license||'')));}
  }
  card.onclick=()=>{reviewBack=!reviewBack;paint();};flip.onclick=card.onclick;
  prev.onclick=()=>{reviewIdx=(reviewIdx+cards.length-1)%cards.length;reviewBack=false;paint();};next.onclick=()=>{reviewIdx=(reviewIdx+1)%cards.length;reviewBack=false;paint();};
  mask.onclick=evt=>{if(evt.target===mask)mask.hidden=true;};paint();
 }
 function initialize(){
  const btn=$('wordLabToggle');if(!btn)return;
  btn.addEventListener('click',toggle);$('wordLabFindImages').addEventListener('click',findImages);
  $('wordLabSave').addEventListener('click',save);$('wordLabPrompt').addEventListener('click',aiPrompt);
  $('wordLabReview').addEventListener('click',review);$('wordLabSidebar')?.addEventListener('click',review);
  const el=$('lookupSource');const mo=new MutationObserver(refresh);mo.observe(el,{subtree:true,childList:true,characterData:true});refresh();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize);else initialize();
 window.EReaderWordLab={reset,refresh,splitIPA,chooseRule};
})();
