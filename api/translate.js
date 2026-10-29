// Vercel Serverless Function: chuyển tiếp yêu cầu dịch bằng API key của chính người dùng.
// Không lưu, không ghi log hoặc gắn API key vào URL.
module.exports = async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:{message:'Chỉ hỗ trợ POST.'}});
  const origin=req.headers.origin;
  if(origin){try{if(new URL(origin).host!==req.headers.host)return res.status(403).json({error:{message:'Không hỗ trợ yêu cầu khác nguồn.'}});}catch{return res.status(403).json({error:{message:'Nguồn yêu cầu không hợp lệ.'}});}}
  let body=req.body;
  try{if(typeof body==='string')body=JSON.parse(body);}catch{return res.status(400).json({error:{message:'Dữ liệu không hợp lệ.'}});}
  const {key,q,target,source}=body||{};
  if(typeof key!=='string'||key.length<15||key.length>300||typeof q!=='string'||!q.trim()||q.length>6000||typeof target!=='string'||!/^[a-z]{2,3}(?:-[A-Za-z]+)?$/.test(target))return res.status(400).json({error:{message:'API Key, ngôn ngữ hoặc câu cần dịch không hợp lệ.'}});
  if(source!==undefined&&(typeof source!=='string'||!/^[a-z]{2,3}(?:-[A-Za-z]+)?$/.test(source)))return res.status(400).json({error:{message:'Ngôn ngữ nguồn không hợp lệ.'}});
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const payload={q,target,format:'text'};if(source)payload.source=source;
    const upstream=await fetch('https://translation.googleapis.com/language/translate/v2',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},body:JSON.stringify(payload),signal:controller.signal});
    const data=await upstream.json().catch(()=>({error:{message:'Phản hồi Google không hợp lệ.'}}));
    if(!upstream.ok)return res.status(upstream.status>=400&&upstream.status<500?upstream.status:502).json({error:{message:String(data?.error?.message||'Google Translate không phản hồi.').slice(0,500)}});
    return res.status(200).json({data:{translations:(data?.data?.translations||[]).map(t=>({translatedText:String(t.translatedText||'')}))}});
  }catch(e){return res.status(502).json({error:{message:e.name==='AbortError'?'Dịch quá thời gian chờ.':'Không kết nối được Google Cloud Translation.'}});}
  finally{clearTimeout(timer);}
};
