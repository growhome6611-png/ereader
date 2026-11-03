'use strict';
/* E-Reader V24.2. Fixed, reviewed RSS allowlist. No user supplied URLs, no proxying paywalled articles. */
const VOA = 'https://learningenglish.voanews.com';
const SOURCES=Object.freeze({
  'voa-asit':{url:VOA+'/api/zkm-ql-vomx-tpej-rqi',label:'VOA · As It Is',country:'US',lang:'en',host:'learningenglish.voanews.com',voa:true},
  'voa-science':{url:VOA+'/api/zmg_pl-vomx-tpeymtm',label:'VOA · Science & Technology',country:'US',lang:'en',host:'learningenglish.voanews.com',voa:true},
  'voa-health':{url:VOA+'/api/zmmpql-vomx-tpey-_q',label:'VOA · Health & Lifestyle',country:'US',lang:'en',host:'learningenglish.voanews.com',voa:true},
  'voa-words':{url:VOA+'/api/zmypyl-vomx-tpeyry_',label:'VOA · Words and Their Stories',country:'US',lang:'en',host:'learningenglish.voanews.com',voa:true},
  'voa-america':{url:VOA+'/api/zbmroml-vomx-tpeqboo_',label:'VOA · All About America',country:'US',lang:'en',host:'learningenglish.voanews.com',voa:true},
  npr:{url:'https://feeds.npr.org/1001/rss.xml',label:'NPR',country:'US',lang:'en',host:'npr.org'},
  bbc:{url:'https://feeds.bbci.co.uk/news/world/rss.xml',label:'BBC News',country:'GB',lang:'en',host:'bbc.com'},
  guardian:{url:'https://www.theguardian.com/world/rss',label:'The Guardian',country:'GB',lang:'en',host:'theguardian.com'},
  xinhua:{url:'https://www.xinhuanet.com/world/news_world.xml',label:'Tân Hoa Xã',country:'CN',lang:'zh',host:'news.cn'},
  tass:{url:'https://tass.com/rss/v2.xml',label:'TASS',country:'RU',lang:'en',host:'tass.com'}
});
function decode(s){return String(s||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
 .replace(/&#(x[0-9a-f]+|\d+);/gi,(_,a)=>{let n=a[0]?.toLowerCase()==='x'?parseInt(a.slice(1),16):+a;return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';})
 .replace(/&(?:amp|lt|gt|quot|apos|nbsp|hellip|mdash|ndash|rsquo|lsquo|ldquo|rdquo|bull);/gi,m=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' ','&hellip;':'…','&mdash;':'—','&ndash;':'–','&rsquo;':'’','&lsquo;':'‘','&ldquo;':'“','&rdquo;':'”','&bull;':'•'}[m.toLowerCase()]||m));}
function clean(text,max=400){return decode(String(text||'')).replace(/<(?:script|style|figure|aside|iframe|noscript)\b[^>]*>[\s\S]*?<\/\s*(?:script|style|figure|aside|iframe|noscript)\s*>/gi,' ').replace(/<\/?(?:p|br|div|li|h\d|span|section)\b[^>]*>/gi,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}
function tag(s,name){const q=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const m=s.match(new RegExp('<'+q+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+q+'>','i'));return m?.[1]||'';}
function legalArticleURL(link){try{const u=new URL(String(link||''));return u.protocol==='https:' && u.hostname==='learningenglish.voanews.com' && /^\/a\/[a-z0-9\-_%]+\/\d+\.html$/i.test(u.pathname) && !u.username && !u.password ?u:null;}catch{return null;}}
function parse(xml,src){let parts=[...String(xml).matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].slice(0,70).map(x=>x[1]);if(!parts.length)parts=[...String(xml).matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].slice(0,70).map(x=>x[1]);let out=[];
 for(const p of parts){const title=clean(tag(p,'title'),290);const raw=decode(tag(p,'link')||tag(p,'guid')||'');let href=p.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1]||raw;let u;try{u=new URL(href);if(!['http:','https:'].includes(u.protocol))continue;if(src.voa&&u.hostname==='learningenglish.voanews.com'&&u.protocol==='http:')u.protocol='https:';}catch{continue;}
  if(src.voa && !legalArticleURL(u.href))continue; if(!title)continue;
  const summary=clean(tag(p,'description')||tag(p,'summary')||tag(p,'content:encoded'),1000);const dat=Date.parse(clean(tag(p,'pubDate')||tag(p,'published')||tag(p,'updated'),100));
  out.push({title,summary,link:u.href,publishedAt:Number.isFinite(dat)?new Date(dat).toISOString():null,source:src.label,sourceId:src.id,lang:src.lang,canReadFull:!!src.voa});if(out.length===35)break;
 }
 out.sort((a,b)=>Date.parse(b.publishedAt||0)-Date.parse(a.publishedAt||0));return out;
}
function backup(src){const rg=src.lang==='zh'?['zh-CN','CN','CN:zh-Hans']:['en-US','US','US:en'];return 'https://news.google.com/rss/search?'+new URLSearchParams({q:'site:'+src.host+' when:14d',hl:rg[0],gl:rg[1],ceid:rg[2]});}
async function retrieve(url,timeout){const abort=new AbortController();const clock=setTimeout(()=>abort.abort(),timeout);try{const r=await fetch(url,{headers:{'Accept':'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9','User-Agent':'EReader/24.2 (RSS Reader)'},redirect:'follow',signal:abort.signal});if(!r.ok)throw Error('RSS HTTP '+r.status);const headerSize=Number(r.headers.get('content-length')||0);if(headerSize>1_700_000)throw Error('RSS quá lớn');const text=await r.text();if(text.length>1_700_000)throw Error('RSS quá lớn');if(!/<(?:rss|feed|rdf:RDF)\b/i.test(text.slice(0,5000)))throw Error('Phản hồi không phải RSS/Atom');return text;}finally{clearTimeout(clock);}}
function reason(err){return err?.name==='AbortError'?'quá thời gian chờ':String(err?.message||err).slice(0,140);}
module.exports=async(req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');if(req.method!=='GET')return res.status(405).json({error:'Chỉ hỗ trợ GET'});
 if(String(req.query?.health||'')==='1')return res.status(200).json({ok:true,version:'24.2',sources:Object.keys(SOURCES)});
 const id=String(req.query?.source||'').trim().toLowerCase();if(!Object.hasOwn(SOURCES,id))return res.status(400).json({error:'Nguồn báo không tồn tại',code:'INVALID_SOURCE'});
 const src={...SOURCES[id],id};const tries=[{url:src.url,via:'rss'}];
 // VOA uses only official VOA RSS: fall back to another learning-English program, not Google News links.
 if(src.voa)tries.push({url:SOURCES[id==='voa-asit'?'voa-science':'voa-asit'].url,via:'voa-fallback'});
 else if(!src.voa)tries.push({url:backup(src),via:'google-news-fallback'});
 const errors=[];for(const t of tries){try{const parsedSource=t.via==='voa-fallback'?{...SOURCES[id==='voa-asit'?'voa-science':'voa-asit'],id:id==='voa-asit'?'voa-science':'voa-asit'}:src;
      const articles=parse(await retrieve(t.url,5500),parsedSource);if(!articles.length)throw Error('RSS không có liên kết bài viết phù hợp');res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');return res.status(200).json({source:id,via:t.via,articles});}catch(err){errors.push(t.via+': '+reason(err));}}
 res.setHeader('Cache-Control','no-store');return res.status(502).json({error:'Không tải được tin '+src.label,detail:errors.join('; '),code:'SOURCE_UNAVAILABLE',site:'https://'+src.host});
};
module.exports._test={parse,legalArticleURL,clean,SOURCES};
