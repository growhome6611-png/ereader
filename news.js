'use strict';
/* E-Reader V24.2 · VOA-first RSS/allowed full text, local-first translation,
   existing Google/Gemini TTS audio cache and Google Drive sync. */
(()=>{
const SOURCES=[
 {id:'voa-asit',name:'VOA · As It Is',country:'US',lang:'en',site:'https://learningenglish.voanews.com/',full:true},
 {id:'voa-science',name:'VOA · Science & Technology',country:'US',lang:'en',site:'https://learningenglish.voanews.com/z/1579',full:true},
 {id:'voa-health',name:'VOA · Health & Lifestyle',country:'US',lang:'en',site:'https://learningenglish.voanews.com/',full:true},
 {id:'voa-words',name:'VOA · Words and Their Stories',country:'US',lang:'en',site:'https://learningenglish.voanews.com/z/987',full:true},
 {id:'voa-america',name:'VOA · All About America',country:'US',lang:'en',site:'https://learningenglish.voanews.com/',full:true},
 {id:'npr',name:'NPR (tóm tắt RSS)',country:'US',lang:'en',site:'https://www.npr.org/'},
 {id:'bbc',name:'BBC (tóm tắt RSS)',country:'GB',lang:'en',site:'https://www.bbc.com/news'},
 {id:'guardian',name:'The Guardian (tóm tắt RSS)',country:'GB',lang:'en',site:'https://www.theguardian.com/'},
 {id:'xinhua',name:'Tân Hoa Xã (tóm tắt RSS)',country:'CN',lang:'zh',site:'https://www.news.cn/'},
 {id:'tass',name:'TASS (tóm tắt RSS)',country:'RU',lang:'en',site:'https://tass.com/'}
];
const countryNames={US:'🇺🇸 Mỹ',GB:'🇬🇧 Anh',CN:'🇨🇳 Trung Quốc',RU:'🇷🇺 Nga'};
const $=id=>document.getElementById(id),pref='ereader_news_v242_';
const state={country:'US',source:'voa-asit',articles:[],selected:null,loading:false,request:0,controller:null,savedMode:false};
const cachedTranslations=read('translations',{});let cloudTranslations={};let currentReadingToken=0;let cloudLoadPromise=null;let cloudChecked=false;
function read(key,def){try{const value=JSON.parse(localStorage.getItem(pref+key));return value??def;}catch{return def;}}
function write(key,value){try{localStorage.setItem(pref+key,JSON.stringify(value));}catch(e){status('Bộ nhớ trên thiết bị có thể đã đầy, vui lòng đồng bộ/sao lưu dữ liệu.');}}
function el(type,text,props={}){const node=document.createElement(type);if(text!==undefined)node.textContent=text;for(const [k,v] of Object.entries(props))node.setAttribute(k,String(v));return node;}
function source(id=state.source){return SOURCES.find(s=>s.id===id)||SOURCES[0];}
function date(text){const n=new Date(text||'');return Number.isFinite(n.getTime())?n.toLocaleDateString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric'}):'Chưa rõ ngày';}
function status(text){const n=$('newsInfo');if(n)n.textContent=String(text||'');}
function errMsg(v){if(typeof v==='string')return v;if(!v)return 'Lỗi chưa xác định';return String(v.error?.message||v.error||v.detail||v.message||v.code||'Phản hồi không hợp lệ').slice(0,220);}
function sentenceParts(input,lang){const text=String(input||'').replace(/\s+/g,' ').trim();if(!text)return[];let parts=[];try{parts=[...new Intl.Segmenter(lang||'en',{granularity:'sentence'}).segment(text)].map(v=>v.segment.trim()).filter(Boolean);}catch{}
 if(!parts.length)parts=(text.match(/[^.!?。！？]+[.!?。！？]+["'”’]?|[^.!?。！？]+$/gu)||[text]).map(s=>s.trim()).filter(Boolean);
 // Avoid breaking individual short quotes/paragraphs on markup boundaries.
 return parts.filter(Boolean).slice(0,280);
}
async function sha(text){if(!crypto?.subtle)return null;const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');}
async function translationKey(text,lang){return sha(JSON.stringify(['news-vi-v1',lang,'vi',String(text).replace(/\s+/g,' ').trim()]));}
async function cloudRefresh(){const cloud=window.EReaderCloud;if(!cloud?.isSignedIn())return;if(cloudLoadPromise)return cloudLoadPromise;cloudLoadPromise=(async()=>{try{const entries=await cloud.pullNewsTranslations();cloudTranslations=entries||{};let updated=0;
 for(const [key,value] of Object.entries(cloudTranslations)){if(!cachedTranslations[key]||(value.updatedAt||0)>=(cachedTranslations[key].updatedAt||0)){cachedTranslations[key]=value;updated++;}}
 for(const [key,record] of Object.entries(cachedTranslations)){if(!cloudTranslations[key]||(record.updatedAt||0)>(cloudTranslations[key].updatedAt||0))cloud.queueNewsTranslation?.(key,record);}
 cloudChecked=true;
 if(updated){saveTranslations();if(state.selected)drawDetail();}status('Google Drive: đã kiểm tra '+Object.keys(entries).length+' bản dịch báo đã lưu.');
 }catch(e){cloudChecked=false;status('Tin vẫn đọc được; bản dịch Drive chưa tải: '+String(e.message).slice(0,125));throw e;}})();
 try{return await cloudLoadPromise;}finally{cloudLoadPromise=null;}}
function saveTranslations(){const items=Object.entries(cachedTranslations).sort((a,b)=>(b[1]?.updatedAt||0)-(a[1]?.updatedAt||0)).slice(0,2200);write('translations',Object.fromEntries(items));}
async function savedTranslation(text,lang){const k=await translationKey(text,lang);if(!k)return null;return cachedTranslations[k]?.vi||cloudTranslations[k]?.vi||null;}
async function translate(text,lang){const key=await translationKey(text,lang);if(key&&(cachedTranslations[key]?.vi||cloudTranslations[key]?.vi))return cachedTranslations[key]?.vi||cloudTranslations[key]?.vi;
 const cloud=window.EReaderCloud;
 if(cloud?.isSignedIn()&&!cloudChecked){try{await cloudRefresh();}catch{throw Error('Chưa kiểm tra được bản dịch trên Google Drive. Hãy đồng bộ lại trước để tránh mất thêm lượt API.');}
   if(key&&(cachedTranslations[key]?.vi||cloudTranslations[key]?.vi))return cachedTranslations[key]?.vi||cloudTranslations[key]?.vi;}

 const apiKey=(()=>{try{return localStorage.getItem('ereader_google_translate_api_key_v1')||'';}catch{return '';}})();let translated='';
 if(apiKey){const r=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:apiKey,q:text,target:'vi',source:lang||'en'})});const data=await r.json();if(!r.ok)throw Error(errMsg(data));translated=data?.data?.translations?.[0]?.translatedText||'';}
 else{if(text.length>460)throw Error('Câu dài hơn 460 ký tự; hãy nhập Google Translate API Key trong Cài đặt.');const r=await fetch('https://api.mymemory.translated.net/get?q='+encodeURIComponent(text)+'&langpair='+encodeURIComponent((lang||'en')+'|vi'));const data=await r.json();if(!r.ok||+data.responseStatus!==200)throw Error(errMsg(data));translated=data.responseData?.translatedText||'';}
 if(!translated||/MYMEMORY WARNING/i.test(translated))throw Error('Dịch vụ dịch chưa trả về kết quả hợp lệ.');const ta=document.createElement('textarea');ta.innerHTML=translated;const record={vi:ta.value,updatedAt:Date.now()};
 if(key){cachedTranslations[key]=record;saveTranslations();window.EReaderCloud?.queueNewsTranslation?.(key,record);}
 return record.vi;
}
function makeControls(block,text,lang){const controls=el('div',undefined,{class:'news-sentence-actions'}),t=el('button','⇄ Dịch câu',{type:'button'}),s=el('button','🔊 Nghe câu',{type:'button'}),lookup=el('button','⌕ Tra từ',{type:'button'}),ans=el('blockquote');ans.hidden=true;
 t.onclick=async()=>{if(!ans.hidden){ans.hidden=true;t.textContent='⇄ Hiện bản dịch';return;}if(ans.dataset.loaded){ans.hidden=false;t.textContent='⇄ Ẩn bản dịch';return;}t.disabled=true;t.textContent='Đang dịch…';try{ans.textContent=await translate(text,lang);ans.dataset.loaded='1';ans.hidden=false;t.textContent='⇄ Ẩn bản dịch';}catch(e){status('Không dịch được: '+String(e.message).slice(0,155));t.textContent='⇄ Dịch câu';}finally{t.disabled=false;}};
 s.onclick=()=>say(text,s,lang);
 lookup.onclick=()=>openLookupFromSelection(text);
 controls.append(t,s,lookup);block.append(controls,ans);
 savedTranslation(text,lang).then(v=>{if(v&&block.isConnected){ans.textContent=v;ans.dataset.loaded='1';t.textContent='⇄ Hiện bản dịch';}}).catch(()=>{});
 return block;
}
function say(text,btn,lang){const bridge=window.EReaderNewsBridge;if(bridge?.speak){bridge.speak(text,btn);return;}
 if(!('speechSynthesis' in window)){status('Thiết bị không hỗ trợ đọc thành tiếng.');return;}
 speechSynthesis.cancel();const utt=new SpeechSynthesisUtterance(text);utt.lang=lang==='zh'?'zh-CN':lang==='ru'?'ru-RU':'en-US';utt.rate=.9;btn.disabled=true;btn.textContent='Đang nghe…';utt.onend=utt.onerror=()=>{btn.disabled=false;btn.textContent='🔊 Nghe câu';};speechSynthesis.speak(utt);
}
function paragraphsFor(article){if(article.fullParagraphs?.length)return article.fullParagraphs;return [article.summary||article.title];}
function updateCountry(){const root=$('newsCountries');root.replaceChildren();for(const id of ['US','all','GB','CN','RU']){const label=id==='all'?'🌍 Tất cả':countryNames[id];const btn=el('button',label,{type:'button',class:'news-country'+(state.country===id?' active':''),'aria-pressed':state.country===id});btn.onclick=()=>{state.country=id;const items=SOURCES.filter(s=>id==='all'||s.country===id);if(!items.some(s=>s.id===state.source))state.source=items[0].id;state.savedMode=false;$('newsSaved').textContent='☆ Tin đã lưu';updateCountry();updateSources();loadFeed(false);};root.append(btn);}}
function updateSources(){const sel=$('newsSource');sel.replaceChildren();for(const s of SOURCES.filter(s=>state.country==='all'||s.country===state.country))sel.append(el('option',s.name,{value:s.id}));sel.value=state.source;}
async function loadFeed(force){const id=state.source,n=++state.request;state.controller?.abort();const controller=new AbortController();state.controller=controller;const timeout=setTimeout(()=>controller.abort(),15000);state.loading=true;state.selected=null;$('newsMain').classList.remove('show-reader');$('newsArticleDetail').replaceChildren();$('newsArticleList').replaceChildren(el('p','Đang tải bài viết…',{class:'news-empty'}));status('Đang lấy RSS '+source(id).name+'…');
 const cache=read('feed_'+id,null);if(!force&&cache?.items?.length&&Date.now()-cache.timestamp<12*60*1000){state.articles=cache.items;drawList();status('Đã tải '+cache.items.length+' tin từ bộ nhớ. Nhấn Làm mới để kiểm tra tin mới.');clearTimeout(timeout);state.loading=false;return;}
 try{const resp=await fetch('/api/news?source='+encodeURIComponent(id),{signal:controller.signal,cache:'no-store'});const raw=await resp.text();let data;try{data=JSON.parse(raw);}catch{throw Error('Máy chủ không trả JSON (HTTP '+resp.status+').');}
 if(!resp.ok)throw Error(errMsg(data));if(!Array.isArray(data.articles)||!data.articles.length)throw Error('Chưa có bản tin trong RSS nguồn này.');if(n!==state.request)return;
 state.articles=data.articles;write('feed_'+id,{timestamp:Date.now(),items:data.articles});status(source(id).name+' · '+data.articles.length+' bài · '+(data.via==='voa-fallback'?'RSS VOA dự phòng':data.via==='google-news-fallback'?'RSS tìm kiếm dự phòng':'RSS chính thức'));drawList();
 }catch(e){if(n!==state.request)return;if(cache?.items?.length){state.articles=cache.items;status('Không tải được tin mới; dùng tin đã lưu. '+String(e.message).slice(0,160));}else{state.articles=[];status('Lỗi nguồn tin: '+String(e.name==='AbortError'?'Quá thời gian chờ':e.message).slice(0,180));}drawList();}
 finally{clearTimeout(timeout);if(n===state.request)state.loading=false;}
}
function drawList(){const root=$('newsArticleList');root.replaceChildren();const q=$('newsSearch').value.trim().toLocaleLowerCase();const list=state.savedMode?read('favorites',[]):state.articles;const items=list.filter(a=>(a.title+' '+(a.summary||'')).toLocaleLowerCase().includes(q));if(!items.length){const panel=el('div',undefined,{class:'news-empty'});panel.append(el('p',list.length?'Không tìm thấy tiêu đề phù hợp.':'Chưa có bản tin. Hãy thử Làm mới hoặc đổi nguồn.'));panel.append(el('a','↗ Mở '+source().name,{class:'news-open-publisher',href:source().site,target:'_blank',rel:'noopener noreferrer'}));root.append(panel);return;}
 for(const item of items){const btn=el('button',undefined,{type:'button',class:'news-item'+(state.selected?.link===item.link?' active':'')});btn.append(el('small',item.source||source(item.sourceId).name));btn.append(el('b',item.title));btn.append(el('span',date(item.publishedAt),{class:'news-date'}));btn.onclick=()=>{state.selected=item;drawList();drawDetail();$('newsMain').classList.add('show-reader');if(item.canReadFull)loadFullArticle(item);};root.append(btn);}}
async function loadFullArticle(a){const version=++currentReadingToken;const cached=read('full_'+hashSimple(a.link),null);if(cached?.paragraphs?.length){a.fullParagraphs=cached.paragraphs;drawDetail();return;}
 status('Đang tải bài đầy đủ VOA Learning English…');try{const r=await fetch('/api/article?url='+encodeURIComponent(a.link),{cache:'default'});const data=await r.json();if(version!==currentReadingToken||state.selected?.link!==a.link)return;if(!r.ok)throw Error(errMsg(data));
 if(data.full&&Array.isArray(data.paragraphs)&&data.paragraphs.length){a.fullParagraphs=data.paragraphs;write('full_'+hashSimple(a.link),{paragraphs:data.paragraphs.slice(0,100),storedAt:Date.now()});status('Đang đọc bản toàn văn VOA · ghi nguồn learningenglish.voanews.com');}
 else{a.fullUnavailable=data.reason||'Trang gốc không có văn bản có thể đọc trực tiếp.';status(a.fullUnavailable);}
 drawDetail();}catch(e){if(version!==currentReadingToken)return;a.fullUnavailable='Không lấy được toàn văn: '+e.message;status(a.fullUnavailable);drawDetail();}}
function hashSimple(s){let v=2166136261;for(const c of String(s)){v^=c.charCodeAt(0);v=Math.imul(v,16777619);}return (v>>>0).toString(16);}
function drawDetail(){const a=state.selected,root=$('newsArticleDetail');root.replaceChildren();if(!a)return;const wrap=el('div',undefined,{class:'news-reader-inner'}),back=el('button','‹ Danh sách tin',{type:'button',class:'news-back'});back.onclick=()=>$('newsMain').classList.remove('show-reader');wrap.append(back);
 wrap.append(el('div',(source(a.sourceId).name)+' · '+date(a.publishedAt),{class:'news-byline'}));wrap.append(el('h2',a.title));
 const head=el('section',undefined,{class:'news-head-controls'});makeControls(head,a.title,a.lang);wrap.append(head);
 const actions=el('div',undefined,{class:'news-actions'});actions.append(el('a','↗ Bài gốc trên VOA / báo',{href:a.link,target:'_blank',rel:'noopener noreferrer'}));const favs=read('favorites',[]),saved=favs.some(x=>x.link===a.link);const star=el('button',saved?'★ Đã lưu':'☆ Lưu tin',{type:'button'});star.onclick=()=>{let all=read('favorites',[]);const existing=all.some(x=>x.link===a.link);all=existing?all.filter(x=>x.link!==a.link):[a,...all].slice(0,150);write('favorites',all);star.textContent=existing?'☆ Lưu tin':'★ Đã lưu';};actions.append(star);wrap.append(actions);
 let note='';if(a.fullParagraphs?.length)note='Bản văn VOA Learning English. Ghi nguồn: learningenglish.voanews.com. Hình ảnh và nội dung thuộc các hãng tin khác không được nhập vào.';
 else if(a.canReadFull)note=a.fullUnavailable||'Đang kiểm tra toàn văn VOA. Trong lúc này bạn có thể đọc bản tóm tắt RSS.';
 else note='Nguồn này chỉ cung cấp tiêu đề và tóm tắt RSS. Bấm Bài gốc để đọc nội dung đầy đủ trên website của tòa soạn.';
 wrap.append(el('p',note,{class:'news-disclaimer'}));wrap.append(el('div',a.fullParagraphs?.length?'ĐỌC BÀI VOA · DỊCH & NGHE TỪNG CÂU':'BẢN TÓM TẮT RSS · DỊCH & NGHE TỪNG CÂU',{class:'news-section-title'}));
 let index=0;for(const para of paragraphsFor(a)){for(const part of sentenceParts(para,a.lang)){const block=el('section',undefined,{class:'news-sentence'});const p=el('p',part);p.lang=a.lang||'en';p.title='Chạm một từ để tra nhanh · quét chọn cụm từ để tra';p.addEventListener('click',ev=>tapWord(ev,p,part));block.append(p);makeControls(block,part,a.lang);wrap.append(block);if(++index>=240)break;}if(index>=240)break;}
 if(a.fullParagraphs?.length)wrap.append(el('p','Nguồn: VOA Learning English (learningenglish.voanews.com). Chỉ sử dụng phần văn bản được xác định là nội dung VOA; không đưa hình ảnh, âm thanh hoặc nội dung của AP, Reuters hay AFP vào ứng dụng.',{class:'news-disclaimer'}));
 root.append(wrap);
}
function tapWord(event,node,context){const sel=window.getSelection();if(sel&&!sel.isCollapsed&&sel.toString().trim())return;let range=null;try{range=document.caretRangeFromPoint?.(event.clientX,event.clientY)||document.caretPositionFromPoint?.(event.clientX,event.clientY);}catch{}const textNode=range?.startContainer||range?.offsetNode;const offset=range?.startOffset??range?.offset;if(!textNode||textNode.nodeType!==Node.TEXT_NODE)return;const content=textNode.textContent||'';let hit='';for(const m of content.matchAll(/[\p{L}]+(?:['’\-][\p{L}]+)*/gu)){if(offset>=m.index&&offset<=m.index+m[0].length){hit=m[0];break;}}if(hit)quickLookup(hit,context);}
function openLookupFromSelection(context){const sel=window.getSelection()?.toString().trim();if(sel&&sel.length<=110){quickLookup(sel,context);return;}status('Hãy chạm từ trong câu hoặc bôi đen một cụm từ, sau đó bấm Tra từ.');}
async function quickLookup(word,context){const modal=$('newsLookupModal'),body=$('newsLookupBody');if(!modal||!body)return;modal.hidden=false;body.replaceChildren(el('b',word),el('p','Đang tra nghĩa…'));
 const close=$('newsLookupClose');close.onclick=()=>modal.hidden=true;const lang=source(state.selected?.sourceId).lang;
 let meaning='';try{meaning=await translate(word,lang);}catch(e){meaning='Chưa dịch được: '+e.message;}
 if(modal.hidden)return;body.replaceChildren(el('h3',word),el('p',meaning,{class:'news-word-meaning'}));
 if(lang==='en'&&!/\s/.test(word)){
 try{const r=await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/'+encodeURIComponent(word.toLowerCase()));const data=await r.json();if(r.ok&&Array.isArray(data)&&data[0]){const d=data[0];if(modal.hidden)return;const ipa=d.phonetic||d.phonetics?.find(p=>p.text)?.text;if(ipa)body.append(el('p',ipa,{class:'news-ipa'}));const meanings=d.meanings?.slice(0,2)||[];for(const m of meanings){if(m.partOfSpeech)body.append(el('small',m.partOfSpeech,{class:'news-part'}));const example=m.definitions?.find(v=>v.example);if(example)body.append(el('p','Ví dụ: '+example.example,{class:'news-small-example'}));}}}catch{}
 }
 if(context&&context!==word)body.append(el('p','Trong bài: '+context,{class:'news-small-example'}));
 const buttons=el('div',undefined,{class:'news-actions'}),hear=el('button','🔊 Nghe',{type:'button'}),save=el('button','☆ Lưu từ',{type:'button'});hear.onclick=()=>say(word,hear,lang);save.onclick=()=>{const entries=read('savedWords',[]);if(!entries.some(v=>v.word===word&&v.context===context))entries.unshift({word,meaning,context,link:state.selected?.link||'',createdAt:Date.now()});write('savedWords',entries.slice(0,500));save.textContent='✓ Đã lưu';};buttons.append(hear,save);body.append(buttons);
}
function onSelection(){if($('newsLayer')?.hidden)return;const selected=window.getSelection()?.toString().trim()||'';const bar=$('newsSelectionActions');if(!bar)return;if(selected.length>1&&selected.length<160){bar.hidden=false;bar.querySelector('span').textContent=selected.length>34?selected.slice(0,34)+'…':selected;}else bar.hidden=true;}
function display(){const layer=$('newsLayer');layer.hidden=false;document.body.style.overflow='hidden';updateCountry();updateSources();if(state.articles.length)drawList();else loadFeed(false);cloudRefresh();}
function hide(){window.EReaderNewsBridge?.stop?.();$('newsLayer').hidden=true;$('newsLookupModal').hidden=true;$('newsSelectionActions').hidden=true;document.body.style.overflow='';}
function init(){if(!$('newsOpen'))return;$('newsOpen').onclick=display;$('newsClose').onclick=hide;$('newsSource').onchange=e=>{state.source=e.target.value;loadFeed(false);};$('newsSearch').oninput=drawList;$('newsRefresh').onclick=()=>loadFeed(true);$('newsSaved').onclick=()=>{state.savedMode=!state.savedMode;$('newsSaved').textContent=state.savedMode?'‹ Trở về nguồn':'☆ Tin đã lưu';state.selected=null;$('newsMain').classList.remove('show-reader');if(state.savedMode){drawList();status('Tin đã lưu trên thiết bị này.');}else loadFeed(false);};$('newsLookupClose').onclick=()=>$('newsLookupModal').hidden=true;
 const selBar=$('newsSelectionActions');selBar.querySelector('button').onclick=()=>{openLookupFromSelection(state.selected?.title||'');selBar.hidden=true;};document.addEventListener('selectionchange',()=>setTimeout(onSelection,100));document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('newsLayer').hidden)hide();});updateCountry();updateSources();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
