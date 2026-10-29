// Google Cloud Text-to-Speech proxy. BYOK: khóa của người dùng không lưu tại máy chủ.
// Không cache câu / audio; chỉ có các yêu cầu POST do người đọc chủ động kích hoạt.
const ALLOWED=new Set([
  'vi-VN-Neural2-A','vi-VN-Neural2-D','vi-VN-Chirp3-HD-Kore','vi-VN-Chirp3-HD-Puck',
  'en-US-Neural2-F','en-US-Neural2-J','en-US-Chirp3-HD-Kore','en-US-Chirp3-HD-Puck'
]);
module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:{message:'Chỉ hỗ trợ POST.'}});
  const origin=req.headers.origin;
  if(origin){try{if(new URL(origin).host!==req.headers.host)return res.status(403).json({error:{message:'Yêu cầu không cùng miền.'}});}
    catch{return res.status(403).json({error:{message:'Nguồn yêu cầu không hợp lệ.'}});}}
  let body=req.body;
  try{if(typeof body==='string')body=JSON.parse(body);}catch{return res.status(400).json({error:{message:'Dữ liệu JSON không hợp lệ.'}});}
  const {key,text,voiceName,languageCode,rate}=body||{};
  if(typeof key!=='string'||key.length<15||key.length>300||typeof text!=='string'||!text.trim()||Buffer.byteLength(text,'utf8')>3500||typeof voiceName!=='string'||!ALLOWED.has(voiceName)||languageCode!==voiceName.slice(0,5)||typeof rate!=='number'||rate<0.6||rate>1.8)
    return res.status(400).json({error:{message:'Khóa API, ngôn ngữ, giọng đọc hoặc độ dài đoạn không hợp lệ.'}});
  const config={audioEncoding:'MP3'};
  if(!voiceName.includes('Chirp3-HD'))config.speakingRate=rate;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),22000);
  try{
    const upstream=await fetch('https://texttospeech.googleapis.com/v1/text:synthesize',{
      method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},
      body:JSON.stringify({input:{text},voice:{languageCode,name:voiceName},audioConfig:config}),signal:controller.signal});
    const data=await upstream.json().catch(()=>({error:{message:'Phản hồi Google Cloud TTS không hợp lệ.'}}));
    if(!upstream.ok)return res.status(upstream.status>=400&&upstream.status<500?upstream.status:502).json({error:{message:String(data?.error?.message||'Google Cloud TTS không phản hồi.').slice(0,500)}});
    if(typeof data?.audioContent!=='string')return res.status(502).json({error:{message:'Google không trả về âm thanh.'}});
    return res.status(200).json({audioContent:data.audioContent});
  }catch(e){return res.status(502).json({error:{message:e.name==='AbortError'?'Google Cloud TTS quá thời gian chờ.':'Không kết nối được Google Cloud TTS.'}});}
  finally{clearTimeout(timer);}
};
