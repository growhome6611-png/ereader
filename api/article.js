'use strict';
/* E-Reader 24.2: text-only VOA Learning English articles, exact host allowlist.
   No images, embedded multimedia, third-party agency dispatches, arbitrary URLs or paywalls. */
const HOST='learningenglish.voanews.com';
function articleURL(raw){try{const u=new URL(String(raw||''));if(u.protocol!=='https:'||u.hostname!==HOST||u.username||u.password||u.port)return null;return /^\/a\/[a-z0-9\-_%]+\/\d+\.html$/i.test(u.pathname)?u:null;}catch{return null;}}
function htmlDecode(s){return String(s||'').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,v)=>{const n=v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/&(?:amp|lt|gt|quot|apos|nbsp|mdash|ndash|hellip|rsquo|lsquo|ldquo|rdquo|bull|copy);/gi,m=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' ','&mdash;':'—','&ndash;':'–','&hellip;':'…','&rsquo;':'’','&lsquo;':'‘','&ldquo;':'“','&rdquo;':'”','&bull;':'•','&copy;':'©'}[m.toLowerCase()]||m));}
function textOnly(html){return htmlDecode(String(html||'').replace(/<(?:script|style|aside|noscript|iframe|figure|figcaption|svg)\b[^>]*>[\s\S]*?<\/\s*(?:script|style|aside|noscript|iframe|figure|figcaption|svg)\s*>/gi,' ').replace(/<br\s*\/?\s*>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();}
function container(body){const patterns=[/<div\b[^>]*class=["'][^"']*\bwsw\b[^"']*["'][^>]*>/i,/<div\b[^>]*class=["'][^"']*\barticle__body\b[^"']*["'][^>]*>/i,/<div\b[^>]*itemprop=["']articleBody["'][^>]*>/i,/<div\b[^>]*id=["']article-content["'][^>]*>/i];
 for(const pattern of patterns){const m=pattern.exec(body);if(!m)continue;const start=m.index;let depth=1,stop=-1;const re=/<\/?div\b[^>]*>/gi;re.lastIndex=start+m[0].length;let match;while((match=re.exec(body))){if(/^<\/div/i.test(match[0]))depth--;else depth++;if(depth===0){stop=match.index;break;}}if(stop>=0)return body.slice(start+m[0].length,stop);}
 return '';
}
function jsonLD(body){for(const block of body.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
 try{const data=JSON.parse(block[1]);const pile=Array.isArray(data)?data:[data];for(const it of pile){for(const item of Array.isArray(it['@graph'])?it['@graph']:[it]){if(typeof item.articleBody==='string'&&item.articleBody.length>400)return item.articleBody;}}}catch{}
 }return '';
}
function extract(html){const candidate=container(html);let paragraphs=[];
 if(candidate){for(const m of candidate.matchAll(/<(?:p|h2|h3)\b[^>]*>([\s\S]*?)<\/(?:p|h2|h3)>/gi)){
 const p=textOnly(m[1]);if(p.length>20&&!/^\s*(?:share|subscribe|listen|download|audio|image:|file -|related|copyright)/i.test(p))paragraphs.push(p);
 }}
 const unique=[];for(const p of paragraphs)if(unique[unique.length-1]!==p)unique.push(p);paragraphs=unique;
 if(paragraphs.join(' ').length<420){const s=jsonLD(html);if(s){paragraphs=s.split(/\n\s*\n|\r\n\r\n/).map(p=>textOnly(p)).filter(p=>p.length>20);}}
 if(paragraphs.join(' ').length<420)return {paragraphs:[],reason:'Không tách được toàn văn từ trang nguồn; bạn vẫn có thể đọc tóm tắt RSS và mở bài gốc.'};
 // Cautious copyright handling: reject content credited to outside news agencies.
 const intro=paragraphs.slice(0,5).join(' ');
 const thirdParty=/(?:^|\b)(?:written by|reported by|provided by|copyright\s*©?\s*)\s*(?:the\s+)?(?:associated press|ap news|reuters|agence france[- ]presse|afp)\b/i.test(intro)||
  /(?:^|\n)\s*(?:Associated Press|Reuters|Agence France-Presse|AFP)\s*[-:]/im.test(intro);
 if(thirdParty)return {paragraphs:[],reason:'Bài này có nội dung ghi nguồn hãng tin bên thứ ba, nên không sao chép toàn văn vào ứng dụng.'};
 paragraphs=paragraphs.filter(p=>p.length<2000).slice(0,85);return {paragraphs,reason:''};
}
module.exports=async (req,res)=>{
 res.setHeader('X-Content-Type-Options','nosniff');if(req.method!=='GET')return res.status(405).json({error:'Chỉ hỗ trợ GET'});
 const url=articleURL(req.query?.url);if(!url)return res.status(400).json({error:'Chỉ hỗ trợ đường dẫn bài viết VOA Learning English hợp lệ',code:'INVALID_ARTICLE_URL'});
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),8500);
 try{
  let next=url.href,response;
  for(let hop=0;hop<3;hop++){
    response=await fetch(next,{signal:controller.signal,headers:{'Accept':'text/html','User-Agent':'EReaderLearningEnglish/24.2'},redirect:'manual'});
    if([301,302,303,307,308].includes(response.status)){
      const target=articleURL(new URL(response.headers.get('location')||'',next).href);
      if(!target)throw Error('Nguồn chuyển hướng ra ngoài bài VOA Learning English được phép');
      next=target.href;continue;
    }
    break;
  }
  if([301,302,303,307,308].includes(response.status))throw Error('Bài VOA chuyển hướng quá nhiều lần');
  if(!response.ok)throw Error('VOA trả HTTP '+response.status);
  const size=Number(response.headers.get('content-length')||0);if(size>3_500_000)throw Error('Trang HTML quá lớn');
  const html=await response.text();if(html.length>3_500_000)throw Error('Trang HTML quá lớn');
  const data=extract(html);res.setHeader('Cache-Control','s-maxage=3600, stale-while-revalidate=7200');
  return res.status(200).json({ok:true,source:'VOA Learning English',attribution:'learningenglish.voanews.com',url:url.href,full:!!data.paragraphs.length,paragraphs:data.paragraphs,reason:data.reason});
 }catch(error){res.setHeader('Cache-Control','no-store');return res.status(502).json({error:'Không tải được nội dung VOA',detail:error?.name==='AbortError'?'Đã quá thời gian chờ':String(error?.message||error).slice(0,160),code:'ARTICLE_UNAVAILABLE'});}finally{clearTimeout(timeout);}
};
module.exports._test={extract,articleURL,container,textOnly};
