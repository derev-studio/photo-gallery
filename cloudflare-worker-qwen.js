const FIREBASE_API_KEY = 'AIzaSyB2X3o7KwYFkMfsskKoWpQYBrws8L-Mn9w';
const OWNER_EMAIL_SHA256 = '9dc9231a1eb41216aa77db40cfec6336ccbbec33c24198693f2220aa10d5dcdf';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigin = 'https://derev-studio.github.io';
    const cors = {
      'Access-Control-Allow-Origin': origin === allowedOrigin ? origin : allowedOrigin,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin'
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);
    if (!env.QWEN_API_KEY) return json({ error: 'QWEN_API_KEY is not configured' }, 500, cors);

    try {
      const auth = request.headers.get('Authorization') || '';
      const idToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!idToken) return json({ error: 'Сначала войдите через Google' }, 401, cors);

      const user = await verifyFirebaseUser(idToken);
      if (!user) return json({ error: 'Сессия Google недействительна. Войдите снова.' }, 401, cors);

      const emailHash = await sha256(String(user.email || '').trim().toLowerCase());
      const isOwner = emailHash === OWNER_EMAIL_SHA256;

      const body = await request.json();
      if (body.action === 'whoami') {
        return json({ ok: true, isOwner, name: user.displayName || '', email: user.email || '' }, 200, cors);
      }

      const model = String(body.model || '');
      const prompt = String(body.prompt || '').trim();
      const image = String(body.image || '');
      const mode = body.mode === 'generate' ? 'generate' : 'edit';

      if (!['qwen-image-2.0', 'qwen-image-3.0-pro'].includes(model)) {
        return json({ error: 'Model is not allowed' }, 400, cors);
      }
      if (!prompt) return json({ error: 'Prompt is required' }, 400, cors);
      if (mode === 'edit' && !image.startsWith('data:image/')) {
        return json({ error: 'Image is required' }, 400, cors);
      }
      if (model === 'qwen-image-3.0-pro' && !isOwner) {
        return json({ error: 'Qwen 3.0 Pro доступен только владельцу сайта' }, 403, cors);
      }

      const host = 'https://ws-jhgwe40j4chzmyh2.ap-southeast-1.maas.aliyuncs.com';
      let url, payload;

      if (model === 'qwen-image-3.0-pro') {
        url = host + '/compatible-mode/v1/images/generations';
        payload = {
          model,
          prompt,
          n: 1,
          prompt_extend: true,
          prompt_extend_mode: 'direct',
          enable_thinking: true,
          watermark: false
        };
        if (mode === 'edit') payload.image = image;
      } else {
        url = host + '/api/v1/services/aigc/multimodal-generation/generation';
        const content = mode === 'edit' ? [{ image }, { text: prompt }] : [{ text: prompt }];
        payload = {
          model,
          input: { messages: [{ role: 'user', content }] },
          parameters: { n: 1, prompt_extend: true, watermark: false }
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
        return json({ error: data?.error?.message || data?.message || data?.code || 'Qwen request failed' }, r.status, cors);
      }

      let out = '';
      if (model === 'qwen-image-3.0-pro') out = data?.data?.[0]?.url || '';
      else out = data?.output?.choices?.[0]?.message?.content?.find?.(item => item?.image)?.image || data?.output?.results?.[0]?.url || '';

      if (!out) return json({ error: 'Qwen returned no image URL' }, 502, cors);
      return json({ url: out, usage: data?.usage || null }, 200, cors);
    } catch (e) {
      return json({ error: e?.message || 'Server error' }, 500, cors);
    }
  }
};

async function verifyFirebaseUser(idToken) {
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken })
  });
  if (!r.ok) return null;
  const data = await r.json();
  return data?.users?.[0] || null;
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' }
  });
}
