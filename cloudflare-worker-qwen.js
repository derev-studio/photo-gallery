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

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);
    if (!env.QWEN_API_KEY) return json({ error: 'QWEN_API_KEY is not configured' }, 500, cors);

    try {
      const body = await request.json();
      const model = String(body.model || '');
      const prompt = String(body.prompt || '').trim();
      const image = String(body.image || '');

      if (!['qwen-image-2.0', 'qwen-image-3.0-pro'].includes(model)) {
        return json({ error: 'Model is not allowed' }, 400, cors);
      }
      if (!prompt) return json({ error: 'Prompt is required' }, 400, cors);
      if (!image.startsWith('data:image/')) return json({ error: 'Image is required' }, 400, cors);

      const host = 'https://ws-jhgwe40j4chzmyh2.ap-southeast-1.maas.aliyuncs.com';
      let url;
      let payload;

      if (model === 'qwen-image-3.0-pro') {
        // Official OpenAI-compatible image-to-image endpoint for Qwen Image 3.0.
        // Do not send size="auto"; omitting size lets the model choose a valid resolution.
        url = host + '/compatible-mode/v1/images/generations';
        payload = {
          model,
          prompt,
          image,
          n: 1,
          prompt_extend: true,
          prompt_extend_mode: 'direct',
          enable_thinking: true,
          watermark: false
        };
      } else {
        // Official DashScope multimodal endpoint for Qwen Image 2.0 editing.
        url = host + '/api/v1/services/aigc/multimodal-generation/generation';
        payload = {
          model,
          input: {
            messages: [
              {
                role: 'user',
                content: [
                  { image },
                  { text: prompt }
                ]
              }
            ]
          },
          parameters: {
            n: 1,
            prompt_extend: true,
            watermark: false
          }
        };
      }

      const r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + env.QWEN_API_KEY
        },
        body: JSON.stringify(payload)
      });

      const data = await r.json();
      if (!r.ok) {
        return json({
          error: data?.error?.message || data?.message || data?.code || 'Qwen request failed'
        }, r.status, cors);
      }

      let out = '';
      if (model === 'qwen-image-3.0-pro') {
        out = data?.data?.[0]?.url || '';
      } else {
        out = data?.output?.choices?.[0]?.message?.content?.find?.(item => item?.image)?.image || '';
      }

      if (!out) return json({ error: 'Qwen returned no image URL' }, 502, cors);
      return json({ url: out, usage: data?.usage || null }, 200, cors);
    } catch (e) {
      return json({ error: e?.message || 'Server error' }, 500, cors);
    }
  }
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}
