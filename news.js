'use strict';
/* News browser V24. Lists RSS headlines/summaries only; full story belongs to publisher. */
(()=>{
const SOURCES=[
{id:'npr',name:'NPR',country:'US',lang:'en',site:'https://www.npr.org/'},
{id:'nyt',name:'The New York Times',country:'US',lang:'en',site:'https://www.nytimes.com/section/world'},
{id:'bbc',name:'BBC News',country:'GB',lang:'en',site:'https://www.bbc.com/news/world'},
{id:'guardian',name:'The Guardian',country:'GB',lang:'en',site:'https://www.theguardian.com/world'},
{id:'xinhua',name:'Tân Hoa Xã / 新华社',country:'CN',lang:'zh',site:'https://www.news.cn/'},
{id:'chinadaily',name:'China Daily (qua Google News)',country:'CN',lang:'en',site:'https://www.chinadaily.com.cn/'},
{id:'tass',name:'TASS',country:'RU',lang:'en',site:'https://tass.com/'},
{id:'ria',name:'RIA Novosti / РИА Новости',country:'RU',lang:'ru',site:'https://ria.ru/'},
{id:'meduza',name:'Meduza (độc lập, tiếng Anh)',country:'RU',lang:'en',site:'https://meduza.io/en'}
];
const labels={US:'🇺🇸 Mỹ',GB:'🇬🇧 Anh',CN:'🇨🇳 Trung Quốc',RU:'🇷🇺 Nga'};
const $=id=>document.getElementById(id);
const state={country:'all',source:'npr',articles:[],selected:null,loading:false,fromCache:false,savedMode:false,requestId:0,controller:null,lastError:''};
const prefix='ereader_news_v24_';
function get(key,fallback){try{const v=JSON.parse(localStorage.getItem(prefix+key));return v??fallback;}catch{return fallback;}}
function set(key,value){try{localStorage.setItem(prefix+key,JSON.stringify(value));}catch{}}
function el(tag,text,attrs={}){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n;}
function dateLabel(date){if(!date)return 'Không rõ ngày';const d=new Date(date);return Number.isFinite(d.getTime())?d.toLocaleString('vi-VN',{dateStyle:'short',timeStyle:'short'}):'Không rõ ngày';}
function source(id){return SOURCES.find(s=>s.id===(id||state.source))||SOURCES[0];}
function sentenceParts(value,lang){const text=String(value||'').trim();if(!text)return [];
 let pieces=[];try{if(Intl.Segmenter)pieces=[...new Intl.Segmenter(lang==='zh'?'zh':lang==='ru'?'ru':'en',{granularity:'sentence'}).segment(text)].map(p=>p.segment.trim()).filter(Boolean);}catch{}
 if(!pieces.length)pieces=(text.match(/[^.!?。！？]+[.!?。！？]*["'”’]*/g)||[text]).map(s=>s.trim()).filter(Boolean);
 return pieces.slice(0,12);
}
function updateCountries(){const root=$('newsCountries');root.replaceChildren();for(const id of ['all','US','GB','CN','RU']){const btn=el('button',id==='all'?'🌍 Tất cả':labels[id],{type:'button',class:'news-country'+(state.country===id?' active':''),'aria-pressed':state.country===id});btn.addEventListener('click',()=>{state.country=id;state.savedMode=false;$('newsSaved').textContent='☆ Tin đã lưu';const available=SOURCES.filter(s=>id==='all'||s.country===id);if(!available.some(s=>s.id===state.source))state.source=available[0].id;updateCountries();updateSources();load(false);});root.append(btn);}}
function updateSources(){const sel=$('newsSource');sel.replaceChildren();for(const s of SOURCES.filter(s=>state.country==='all'||s.country===state.country)){sel.append(el('option',s.name,{value:s.id}));}sel.value=state.source;}
function showStatus(text){$('newsInfo').textContent=text;}
function errorText(payload){
 if(typeof payload==='string')return payload.slice(0,180);
 if(!payload || typeof payload!=='object')return 'Không rõ nguyên nhân';
 const parts=[];
 for(const x of [payload.error,payload.message,payload.detail,payload.cause]){
  const value=typeof x==='string'?x:(x && typeof x==='object'?x.message || x.detail || x.code:'');
  if(value && !parts.includes(value))parts.push(String(value));
 }
 return parts.join(' — ').slice(0,230)||'Máy chủ trả về lỗi không xác định';
}
async function load(force){
 const requestedSource=state.source;
 const reqId=++state.requestId;
 if(state.controller)state.controller.abort();
 const ctrl=new AbortController();state.controller=ctrl;
 const timeout=setTimeout(()=>ctrl.abort(),13000);
 state.savedMode=false;$('newsSaved').textContent='☆ Tin đã lưu';state.loading=true;state.articles=[];state.selected=null;state.lastError='';
 $('newsMain').classList.remove('show-reader');$('newsArticleList').replaceChildren(el('p','Đang tải bản tin…',{class:'news-empty'}));$('newsArticleDetail').replaceChildren();
 showStatus('Đang kết nối '+source(requestedSource).name+'…');
 const cache=get('feed_'+requestedSource,null);
 if(!force && cache?.articles?.length && Date.now()-cache.timestamp<10*60*1000){
  clearTimeout(timeout);if(state.controller===ctrl)state.controller=null;
  state.articles=cache.articles;state.fromCache=true;state.loading=false;drawList();
  showStatus('Tin từ '+source(requestedSource).name+' · bản tạm lưu gần đây · nhấn Làm mới để cập nhật');return;
 }
 try{
  const r=await fetch('/api/news?source='+encodeURIComponent(requestedSource),{headers:{Accept:'application/json'},signal:ctrl.signal,cache:'no-store'});
  const body=await r.text();let data=null;
  try{data=JSON.parse(body);}catch{}
  if(!r.ok){
   if(r.status===404)throw Error('Không tìm thấy /api/news (HTTP 404). Kiểm tra tệp api/news.js trên GitHub và lần triển khai Vercel.');
   throw Error((data?errorText(data):'Máy chủ trả HTTP '+r.status)+' (HTTP '+r.status+')');
  }
  if(!data || !Array.isArray(data.articles))throw Error('API trả dữ liệu không hợp lệ. Kiểm tra tệp api/news.js trong Vercel.');
  if(!data.articles.length)throw Error('Nguồn báo chưa có bản tin trong RSS.');
  if(reqId!==state.requestId)return;
  state.articles=data.articles;state.fromCache=false;
  set('feed_'+requestedSource,{articles:state.articles,timestamp:Date.now()});
  showStatus('Nguồn: '+source(requestedSource).name+' · '+state.articles.length+' tin · '+(data.via==='google-news-fallback'?'Google News dự phòng':'RSS chính')+' · '+new Date().toLocaleTimeString('vi-VN'));
 }catch(e){
  if(reqId!==state.requestId)return;
  const message=e?.name==='AbortError'?'Kết nối quá thời gian chờ (13 giây)':String(e?.message || 'Không xác định được lỗi');
  state.lastError=message;
  if(cache?.articles?.length){state.articles=cache.articles;state.fromCache=true;showStatus('Chưa tải được tin mới; đang xem tin đã lưu: '+message.slice(0,190));}
  else showStatus('Không tải được tin từ '+source(requestedSource).name+': '+message.slice(0,220));
 }finally{
  clearTimeout(timeout);if(state.controller===ctrl)state.controller=null;
  if(reqId===state.requestId){state.loading=false;drawList();}
 }
}
function drawList(){const root=$('newsArticleList');root.replaceChildren();const q=$('newsSearch').value.trim().toLocaleLowerCase();const list=state.savedMode?get('favs',[]):state.articles;const matches=list.filter(x=>(x.title+' '+x.summary).toLocaleLowerCase().includes(q));
 if(!matches.length){
  const box=el('div',undefined,{class:'news-empty'});
  box.append(el('p',list.length?'Không tìm thấy bài có từ khóa này.':'Chưa có bản tin từ nguồn này. '+(state.lastError?'Bạn có thể thử lại hoặc đổi nguồn.':'Bạn có thể mở báo gốc.')));
  if(!state.savedMode){box.append(el('a','↗ Mở trang '+source().name,{href:source().site,target:'_blank',rel:'noopener noreferrer',class:'news-open-publisher'}));}
  root.append(box);return;
 }
 matches.forEach((a)=>{const row=el('button',undefined,{type:'button',class:'news-item'+(state.selected?.link===a.link?' active':'')});const itemSource=source(a.sourceId);row.append(el('small',itemSource.name+' · '+labels[itemSource.country]));row.append(el('b',a.title));row.append(el('span',dateLabel(a.publishedAt),{class:'news-date'}));row.addEventListener('click',()=>{state.selected=a;drawList();drawDetail();$('newsMain').classList.add('show-reader');});root.append(row);});}
function translateUrl(){return 'https://translate.google.com/?sl=auto&tl=vi&text=';}
async function translate(text,lang){const id='tr_'+lang+'_'+text;let cached=get(id,null);if(cached)return cached;
 const apiKey=(()=>{try{return localStorage.getItem('ereader_google_translate_api_key_v1')||'';}catch{return '';}})();
 let result;
 if(apiKey){const r=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:apiKey,q:text,target:'vi',source:lang})});const j=await r.json();if(!r.ok)throw Error(j?.error?.message||'Google Translate trả lỗi');result=j?.data?.translations?.[0]?.translatedText;}
 else{if(text.length>460)throw Error('Đoạn dài quá giới hạn dịch miễn phí. Hãy nhập Google Translate API Key trong Cài đặt.');const r=await fetch('https://api.mymemory.translated.net/get?q='+encodeURIComponent(text)+'&langpair='+encodeURIComponent(lang+'|vi'));const j=await r.json();if(!r.ok||j.responseStatus!==200)throw Error(j.responseDetails||'Không dịch được');result=j.responseData?.translatedText;}
 if(!result||/MYMEMORY WARNING/i.test(result))throw Error('Không nhận được bản dịch hợp lệ');const area=document.createElement('textarea');area.innerHTML=String(result);result=area.value;set(id,result);return result;
}
function speak(text,language,button){if(!('speechSynthesis'in window)){showStatus('Trình duyệt này không hỗ trợ giọng đọc trên thiết bị.');return;}
 try{speechSynthesis.cancel();const utt=new SpeechSynthesisUtterance(text);utt.lang=language==='zh'?'zh-CN':language==='ru'?'ru-RU':'en-US';utt.rate=0.9;button.disabled=true;button.textContent='Đang nghe…';utt.onend=utt.onerror=()=>{button.disabled=false;button.textContent='🔊 Nghe câu';};speechSynthesis.speak(utt);}catch(e){button.disabled=false;button.textContent='🔊 Nghe câu';showStatus('Giọng đọc trên thiết bị không khả dụng.');}}
function drawDetail(){const a=state.selected,root=$('newsArticleDetail');root.replaceChildren();if(!a)return;const itemSource=source(a.sourceId);const wrapper=el('div',undefined,{class:'news-reader-inner'});
 wrapper.append(el('button','‹ Danh sách tin',{type:'button',class:'news-back'}));wrapper.lastChild.onclick=()=>$('newsMain').classList.remove('show-reader');
 wrapper.append(el('div',labels[itemSource.country]+' · '+itemSource.name+' · '+dateLabel(a.publishedAt),{class:'news-byline'}));wrapper.append(el('h2',a.title));
 const titleControls=el('div',undefined,{class:'news-sentence-actions'});
 const titleTranslate=el('button','⇄ Dịch tiêu đề',{type:'button'});
 const titleSpeak=el('button','🔊 Nghe tiêu đề',{type:'button'});
 const translatedTitle=el('blockquote');translatedTitle.hidden=true;
 titleTranslate.addEventListener('click',async()=>{if(!translatedTitle.hidden){translatedTitle.hidden=true;titleTranslate.textContent='⇄ Hiện bản dịch';return;}if(translatedTitle.dataset.loaded){translatedTitle.hidden=false;titleTranslate.textContent='⇄ Ẩn bản dịch';return;}titleTranslate.disabled=true;titleTranslate.textContent='Đang dịch…';try{translatedTitle.textContent=await translate(a.title,a.lang);translatedTitle.dataset.loaded='yes';translatedTitle.hidden=false;titleTranslate.textContent='⇄ Ẩn bản dịch';}catch(e){titleTranslate.textContent='⇄ Dịch tiêu đề';showStatus('Lỗi dịch: '+String(e.message).slice(0,120));}finally{titleTranslate.disabled=false;}});
 titleSpeak.addEventListener('click',()=>speak(a.title,a.lang,titleSpeak));
 titleControls.append(titleTranslate,titleSpeak);wrapper.append(titleControls,translatedTitle);
 const bar=el('div',undefined,{class:'news-actions'});
 const orig=el('a','↗ Đọc bài gốc',{href:a.link,target:'_blank',rel:'noopener noreferrer'});bar.append(orig);
 const favs=get('favs',[]);const isSaved=favs.some(v=>v.link===a.link);const fav=el('button',isSaved?'★ Đã lưu':'☆ Lưu tin',{type:'button'});fav.addEventListener('click',()=>{let list=get('favs',[]);const exists=list.some(v=>v.link===a.link);list=exists?list.filter(v=>v.link!==a.link):[{...a,country:itemSource.country},...list].slice(0,100);set('favs',list);fav.textContent=exists?'☆ Lưu tin':'★ Đã lưu';});bar.append(fav);
 wrapper.append(bar);
 wrapper.append(el('div','Đây là tiêu đề và đoạn giới thiệu được nguồn RSS cung cấp, không phải toàn văn bài báo. Để đọc trọn bài hãy chọn “Đọc bài gốc”.',{class:'news-disclaimer'}));
 wrapper.append(el('div','ĐỌC NHANH · DỊCH / NGHE TỪNG CÂU',{class:'news-section-title'}));
 const summary=a.summary?.trim()?a.summary:a.title;
 sentenceParts(summary,a.lang).forEach((sentence)=>{const block=el('section',undefined,{class:'news-sentence'});block.append(el('p',sentence));const controls=el('div',undefined,{class:'news-sentence-actions'});
 const trans=el('button','⇄ Dịch câu',{type:'button'});const voice=el('button','🔊 Nghe câu',{type:'button'});const answer=el('blockquote');answer.hidden=true;
 trans.addEventListener('click',async()=>{if(!answer.hidden){answer.hidden=true;trans.textContent='⇄ Hiện bản dịch';return;}if(answer.dataset.loaded){answer.hidden=false;trans.textContent='⇄ Ẩn bản dịch';return;}
 trans.disabled=true;trans.textContent='Đang dịch…';try{answer.textContent=await translate(sentence,a.lang);answer.dataset.loaded='yes';answer.hidden=false;trans.textContent='⇄ Ẩn bản dịch';}catch(err){showStatus('Lỗi dịch: '+String(err.message).slice(0,130));trans.textContent='⇄ Dịch câu';}finally{trans.disabled=false;}});
 voice.addEventListener('click',()=>speak(sentence,a.lang,voice));controls.append(trans,voice);block.append(controls,answer);wrapper.append(block);});
 wrapper.append(el('p','Nguồn tin có thể giới hạn bản quyền, yêu cầu đăng nhập hoặc thu phí. E-Reader không tự sao chép toàn văn và không vượt qua tường phí.',{class:'news-disclaimer'}));root.append(wrapper);}
function show(){const layer=$('newsLayer');layer.hidden=false;document.body.style.overflow='hidden';updateCountries();updateSources();if(!state.articles.length)load(false);else{drawList();if(state.selected)drawDetail();}}
function hide(){try{window.speechSynthesis?.cancel();}catch{}$('newsLayer').hidden=true;document.body.style.overflow='';}
function init(){if(!$('newsOpen'))return;$('newsOpen').addEventListener('click',show);$('newsClose').addEventListener('click',hide);$('newsSource').addEventListener('change',e=>{state.source=e.target.value;load(false);});$('newsSaved').addEventListener('click',()=>{state.savedMode=!state.savedMode;state.selected=null;$('newsSaved').textContent=state.savedMode?'‹ Trở về nguồn báo':'☆ Tin đã lưu';$('newsMain').classList.remove('show-reader');if(state.savedMode){showStatus('Danh sách tin đã lưu trên thiết bị này');drawList();$('newsArticleDetail').replaceChildren();}else load(false);});$('newsRefresh').addEventListener('click',()=>load(true));$('newsSearch').addEventListener('input',drawList);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('newsLayer').hidden)hide();});updateCountries();updateSources();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
