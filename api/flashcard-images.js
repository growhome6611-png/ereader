'use strict';
/* V25.1 image suggestions: ONLY query fixed Openverse endpoint. Do not fetch
   arbitrary client-provided URLs, and preserve author/licence/source metadata. */
const SOURCE='https://api.openverse.org/v1/images/';
function validHttps(value){try{const x=new URL(String(value||''));return x.protocol==='https:'?x.href:'';}catch{return '';}}
const ALLOWED=new Set(['cc0','pdm','by','by-sa']);
module.exports=async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET')return res.status(405).json({error:'Chỉ hỗ trợ GET'});
 const word=String(req.query?.word||'').trim().toLowerCase();
 if(!/^[a-z]+(?:['’-][a-z]+)*$/i.test(word)||word.length>75)return res.status(400).json({error:'Chỉ hỗ trợ từ tiếng Anh đơn.'});
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),6500);
 try{
  const url=new URL(SOURCE);url.searchParams.set('q',word);url.searchParams.set('page_size','16');url.searchParams.set('mature','false');
  const response=await fetch(url,{signal:abort.signal,headers:{Accept:'application/json','User-Agent':'EReaderWordLab/25.1 (educational flashcards)'}});
  if(!response.ok)return res.status(502).json({error:'Openverse phản hồi HTTP '+response.status});
  const data=await response.json();
  const items=(Array.isArray(data.results)?data.results:[]).filter(v=>ALLOWED.has(String(v.license||'').toLowerCase())).map(v=>({
   id:String(v.id||'').slice(0,100),title:String(v.title||'').slice(0,120),
   thumbnail:validHttps(v.thumbnail),url:validHttps(v.url),
   creator:String(v.creator||'').slice(0,140),
   license:String(v.license||'').slice(0,25),licenseUrl:validHttps(v.license_url),
   sourcePage:validHttps(v.foreign_landing_url),source:'Openverse / '+String(v.source||'').slice(0,45)
  })).filter(v=>v.id&&v.thumbnail&&v.sourcePage).slice(0,6);
  res.setHeader('Cache-Control','public, s-maxage=900, stale-while-revalidate=3600');
  return res.status(200).json({word,items,notice:'Check each image license and attribution before reusing.'});
 }catch(e){return res.status(502).json({error:e?.name==='AbortError'?'Openverse quá thời gian chờ':'Không kết nối được Openverse'});}
 finally{clearTimeout(timer);}
};
