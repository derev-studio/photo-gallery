export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = 'https://derev-studio.github.io';
    const cors = {
      'Access-Control-Allow-Origin': origin === allowedOrigin ? origin : allowedOrigin,
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null,{headers:cors});
    if (request.method !== 'POST') return json({error:'POST only'},405,cors);
    if (!env.QWEN_API_KEY) return json({error:'QWEN_API_KEY is not configured'},500,cors);
    try {
      const body = await request.json();
      const model = String(body.model||'');
      const prompt = String(body.prompt||'').trim();
      const image = String(body.image||'');
      const mode = body.mode === 'generate' ? 'generate' : 'edit';
      const ownerCode = String(body.ownerCode||'');
      if (!['qwen-image-2.0','qwen-image-3.0-pro'].includes(model)) return json({error:'Model is not allowed'},400,cors);
      if (!prompt) return json({error:'Prompt is required'},400,cors);
      if (mode==='edit' && !image.startsWith('data:image/')) return json({error:'Image is required'},400,cors);
      if (model==='qwen-image-3.0-pro') {
        if (!env.OWNER_CODE) return json({error:'OWNER_CODE is not configured'},500,cors);
        if (ownerCode !== env.OWNER_CODE) return json({error:'Неверный личный код для Qwen 3.0 Pro'},403,cors);
      }
      const host='https://ws-jhgwe40j4chzmyh2.ap-southeast-1.maas.aliyuncs.com';
      let url,payload;
      if (model==='qwen-image-3.0-pro') {
        url=host+'/compatible-mode/v1/images/generations';
        payload={model,prompt,n:1,prompt_extend:true,prompt_extend_mode:'direct',enable_thinking:true,watermark:false};
        if (mode==='edit') payload.image=image;
      } else {
        url=host+'/api/v1/services/aigc/multimodal-generation/generation';
        const content = mode==='edit' ? [{image},{text:prompt}] : [{text:prompt}];
        payload={model,input:{messages:[{role:'user',content}]},parameters:{n:1,prompt_extend:true,watermark:false}};
      }
      const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.QWEN_API_KEY},body:JSON.stringify(payload)});
      const data=await r.json();
      if(!r.ok) return json({error:data?.error?.message||data?.message||data?.code||'Qwen request failed'},r.status,cors);
      let out='';
      if(model==='qwen-image-3.0-pro') out=data?.data?.[0]?.url||'';
      else out=data?.output?.choices?.[0]?.message?.content?.find?.(item=>item?.image)?.image||data?.output?.results?.[0]?.url||'';
      if(!out) return json({error:'Qwen returned no image URL'},502,cors);
      return json({url:out,usage:data?.usage||null},200,cors);
    } catch(e) { return json({error:e?.message||'Server error'},500,cors); }
  }
};
function json(obj,status,headers){return new Response(JSON.stringify(obj),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}})}
