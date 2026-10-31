'use strict';
/**
 * Vercel serverless function: Gemini GenerateContent TTS.
 * No key is stored or logged. The user supplies it at request time.
 * Google 3.8 TTS unary generates WAV with a RIFF header (not raw PCM).
 */
module.exports = async function handler(req,res){
  res.setHeader('Cache-Control','private, no-store');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Chỉ hỗ trợ POST.'});}
  try{
    const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
    const key=String(body.key||'').trim();
    const text=String(body.text||'').trim();
    const model=String(body.model||'gemini-3.8-flash-lite-tts');
    const voice=String(body.voice||'Kore');
    if(!key||key.length<12)return res.status(400).json({error:'Chưa có Gemini API Key hợp lệ.'});
    if(!['gemini-3.8-flash-lite-tts','gemini-3.8-flash-tts'].includes(model))return res.status(400).json({error:'Mô hình không được hỗ trợ.'});
    if(!['Kore','Aoede','Puck','Charon','Zephyr','Leda','Orus','Sulafat'].includes(voice))return res.status(400).json({error:'Tên giọng không được hỗ trợ.'});
    if(!text||Buffer.byteLength(text,'utf8')>1400)return res.status(400).json({error:'Văn bản rỗng hoặc quá dài (tối đa 1.400 byte).'});
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);
    let upstream;
    try{
      upstream=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',{
        method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},
        body:JSON.stringify({contents:[{role:'user',parts:[{text}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{voice}}}}),
        signal:controller.signal
      });
    }finally{clearTimeout(timer);}
    const data=await upstream.json().catch(()=>({}));
    if(!upstream.ok)return res.status(upstream.status>=500?502:upstream.status).json({error:String(data.error?.message||'Gemini không tạo được âm thanh ('+upstream.status+').').slice(0,350)});
    const part=data?.candidates?.[0]?.content?.parts?.find(p=>p.inlineData?.data);
    const audioContent=part?.inlineData?.data;
    if(!audioContent)return res.status(502).json({error:'Gemini không trả tệp âm thanh. Hãy kiểm tra mô hình, hạn mức và quyền API.'});
    const mime=(part.inlineData.mimeType||'audio/wav').toLowerCase();
    if(!mime.startsWith('audio/'))return res.status(502).json({error:'Gemini trả loại dữ liệu không phải âm thanh.'});
    // Vercel functions have a response-size cap; advise users to shorten overly long sentences.
    if(audioContent.length>4*1024*1024)return res.status(413).json({error:'Âm thanh quá lớn. Vui lòng chọn câu/đoạn ngắn hơn.'});
    return res.status(200).json({audioContent,mimeType:mime});
  }catch(e){
    const msg=e?.name==='AbortError'?'Gemini phản hồi quá chậm. Hãy thử lại.':'Không kết nối được Gemini TTS.';
    return res.status(502).json({error:msg});
  }
};
