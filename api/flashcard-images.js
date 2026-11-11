'use strict';
/* V25.7: broader Openverse results with explicit search phrase and relevance
 * ranking. This endpoint never fetches arbitrary third-party URLs and does not
 * scrape Google Images. Keep attribution and licensing metadata on every image.
 */
const SOURCE='https://api.openverse.org/v1/images/';
const ALLOWED=new Set(['cc0','pdm','by','by-sa']);
const stopWords=new Set(['a','an','the','of','in','and','for','to','with','by','on','at','photo','image','images','picture','illustration','illustrated','art','concept','showing','people']);
const https=value=>{try{const u=new URL(String(value||''));return u.protocol==='https:'?u.href:'';}catch{return '';}};
const words=s=>[...new Set(String(s||'').toLowerCase().match(/[a-z]{3,}/g)||[])].filter(w=>!stopWords.has(w));
function relevance(row,query,word){
 const title=String(row.title||'').toLowerCase();
 const tags=(Array.isArray(row.tags)?row.tags:[]).slice(0,30).map(x=>String(x.name||'').toLowerCase()).join(' ');
 const titleTokens=new Set(words(title));const tagTokens=new Set(words(tags));
 let score=0, matched=0;
 for(const key of words(query)){
  const root=key.replace(/(?:ies|ing|ed|ly|s)$/,'');
  const match=token=>token===key||(root.length>=4&&token.startsWith(root));
  const foundTitle=[...titleTokens].some(match),foundTag=[...tagTokens].some(match);
  if(foundTitle||foundTag){matched++;score+=foundTitle?4:2;}
 }
 // A word appearing in the image title is useful even if the user supplies a
 // broader visualization phrase for an abstract word.
 const bare=word.replace(/(?:ies|ing|ed|ly|s)$/,'');
 if(bare.length>=4 && [...titleTokens].some(t=>t.startsWith(bare)))score+=2;
 // Human-emotion study cards should not show random animals just because the
 // photo's tags include an emotional adjective.
 if(/human|person|face|emotion|facial/i.test(query)&&/\b(dog|puppy|cat|kitten|animal|pet|horse|fish|bird)\b/i.test(title+' '+tags))score-=7;
 if(/\b(logo|watermark|icon pack|texture|wallpaper)\b/i.test(title))score-=2;
 // For words about emotions, match the emotional *idea*, not simply any human.
 if(/emotion|facial|expression|feeling/i.test(query) && !/emotion|expression|face|facial|feeling|happ|sad|smil|cry|anger|joy|fear|laugh|worri|excit|mood/i.test(title+' '+tags))score-=9;
 return {score,matched};
}
module.exports=async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Chỉ hỗ trợ GET'});
 const word=String(req.query?.word||'').trim().toLowerCase();
 const query=String(req.query?.q||word).trim().replace(/\s+/g,' ');
 const page=Math.max(1,Math.min(8,Number.parseInt(req.query?.page,10)||1));
 if(!/^[a-z]+(?:['’-][a-z]+)*$/i.test(word)||word.length>75)return res.status(400).json({error:'Từ tra phải là một từ tiếng Anh.'});
 if(query.length<2||query.length>120||!/^[a-z0-9\s,;:'’-]+$/i.test(query))return res.status(400).json({error:'Từ khóa tìm ảnh cần dùng chữ tiếng Anh, tối đa 120 ký tự.'});
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),9500);
 try{
  const url=new URL(SOURCE);url.searchParams.set('q',query);url.searchParams.set('page_size','40');url.searchParams.set('page',String(page));url.searchParams.set('mature','false');url.searchParams.set('filter_dead','true');
  const response=await fetch(url,{signal:abort.signal,headers:{Accept:'application/json','User-Agent':'EReaderWordLab/25.7 (non-commercial educational flashcards)'}});
  if(!response.ok)return res.status(502).json({error:'Openverse phản hồi HTTP '+response.status});
  const data=await response.json();const seen=new Set();
  const rows=(Array.isArray(data.results)?data.results:[]).filter(v=>ALLOWED.has(String(v.license||'').toLowerCase()))
   .map(v=>{
    const id=String(v.id||'').slice(0,100),thumbnail=https(v.thumbnail)||https(v.url),sourcePage=https(v.foreign_landing_url);
    if(!id||!thumbnail||!sourcePage||seen.has(id))return null;seen.add(id);
    const rank=relevance(v,query,word);
    return {id,title:String(v.title||'').slice(0,160),thumbnail,url:https(v.url),
     creator:String(v.creator||'').slice(0,140),license:String(v.license||'').slice(0,25),
     licenseUrl:https(v.license_url),sourcePage,source:'Openverse / '+String(v.source||'').slice(0,45),...rank};
   }).filter(Boolean).sort((a,b)=>b.score-a.score);
  const terms=words(query);
  // Do not pad poor searches with unrelated results. A user can search more
  // broadly or choose a smarter English phrase from the client UI.
  const focused=terms.length>1;
  const relevant=rows.filter(v=>focused?v.matched>=1&&v.score>=2:v.score>=0).slice(0,20);
  const pages=Number(data.page_count)||1;
  res.setHeader('Cache-Control','public, s-maxage=600, stale-while-revalidate=1800');
  return res.status(200).json({word,query,page,hasMore:page<Math.min(8,pages),items:relevant,
   candidateCount:rows.length,notice:'Ảnh từ Openverse: cần đối chiếu tác giả và giấy phép trên trang nguồn trước khi dùng.'});
 }catch(e){return res.status(502).json({error:e?.name==='AbortError'?'Openverse quá thời gian chờ':'Không kết nối được Openverse'});}
 finally{clearTimeout(timer);}
};
