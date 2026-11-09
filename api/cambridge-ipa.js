'use strict';
/* Optional OFFICIAL Cambridge Dictionary API integration.
   A Cambridge API development licence and an API access key are required.
   Never scrape dictionary.cambridge.org pages or expose this key client-side. */
const BASE='https://dictionary.cambridge.org/api/v1/dictionaries/';
function decodeEntities(value){return String(value||'').replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,match=>{
  const n=match.slice(1,-1);const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
  if(named[n])return named[n];if(n[0]==='#'){const cp=n[1]==='x'?parseInt(n.slice(2),16):parseInt(n.slice(1),10);return Number.isFinite(cp)&&cp>0&&cp<0x110000?String.fromCodePoint(cp):match;}return match;});}
function extractIpa(content){
  const html=String(content||'');const results={uk:'',us:'',generic:''};
  const re=/<(?:span|div)[^>]*class\s*=\s*["'][^"']*\bipa\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div)>/gi;
  let m;while((m=re.exec(html))){
    const value=decodeEntities(m[1].replace(/<[^>]+>/g,'')).trim();
    if(!value||value.length>100)continue;
    const context=html.slice(Math.max(0,m.index-500),m.index).toLowerCase();
    const region=/(?:\b(?:region|pron|uk|us)\b)[\s\S]{0,50}$/i;
    const nearest=context.match(/(?:\buk\b|\bus\b|british|american)(?![\s\S]*(?:\buk\b|\bus\b|british|american))/i);
    const v=value.startsWith('/')?value:`/${value}/`;
    if(nearest){const group=nearest[0];const key=/us|american/i.test(group)?'us':'uk';if(!results[key])results[key]=v;}
    else if(!results.generic)results.generic=v;
  }
  return results;
}
function firstEntry(payload){
  if(payload?.entryContent)return payload;
  const direct=payload?.entry||payload?.result||payload?.searchResults?.[0]||payload?.entries?.[0]||payload?.results?.[0]||null;
  if(direct?.entryContent)return direct;
  const entryId=direct?.entryId||payload?.entryId||payload?.searchResult?.entryId||null;
  return {entryId};
}
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','private, max-age=86400');
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  const word=String(req.query?.word||'').trim().toLowerCase();
  if(!/^[a-z]+(?:['’-][a-z]+)*$/.test(word)||word.length>70)return res.status(400).json({error:'Invalid word'});
  const secret=process.env.CAMBRIDGE_DICTIONARY_ACCESS_KEY||'';
  if(!secret)return res.status(204).end();
  // Cambridge specifies dictionary codes from its licensed getDictionaries API.
  const code=String(process.env.CAMBRIDGE_DICTIONARY_CODE||'british');
  if(!/^[a-z0-9_-]{2,40}$/i.test(code))return res.status(500).json({error:'Invalid dictionary code'});
  const header={accessKey:secret,Accept:'application/json'};
  try{
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),7000);
    try{
      const url=BASE+encodeURIComponent(code)+'/search/first?q='+encodeURIComponent(word)+'&format=html';
      let r=await fetch(url,{headers:header,signal:ctrl.signal});
      if(!r.ok)return res.status(r.status===403?403:502).json({error:'Cambridge official API returned '+r.status});
      let data=await r.json();let item=firstEntry(data);
      if(!item.entryContent&&item.entryId){
        const entryUrl=BASE+encodeURIComponent(code)+'/entries/'+encodeURIComponent(item.entryId)+'?format=html';
        r=await fetch(entryUrl,{headers:header,signal:ctrl.signal});
        if(!r.ok)return res.status(502).json({error:'Cambridge entry returned '+r.status});
        item=await r.json();
      }
      const ipa=extractIpa(item.entryContent||'');
      if(!ipa.uk&&!ipa.us&&!ipa.generic)return res.status(204).end();
      return res.status(200).json({phoneticUK:ipa.uk,phoneticUS:ipa.us,genericIPA:ipa.generic,source:'Cambridge Dictionary API (licensed)'});
    }finally{clearTimeout(timer);}
  }catch(err){return res.status(502).json({error:'Cambridge API unavailable'});}
};
