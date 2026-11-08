const FIREBASE_API_KEY = 'AIzaSyB2X3o7KwYFkMfsskKoWpQYBrws8L-Mn9w';
const OWNER_EMAIL_SHA256 = '9dc9231a1eb41216aa77db40cfec6336ccbbec33c24198693f2220aa10d5dcdf';
const IRINA_EMAIL_SHA256 = '261ef6021295b44e0ecd450541c7f0be9377b493819285f1c9d1704db9d64872';
const GA4_PROPERTY_ID = '556452970';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowedOrigins = ['https://derev-studio.github.io', 'https://irina-photo.github.io'];
    const allowedOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
    const cors = {
      'Access-Control-Allow-Origin': origin === allowedOrigin ? origin : allowedOrigin,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Vary': 'Origin'
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method === 'GET' && new URL(request.url).pathname === '/health') {
      return json({ ok: true, robotReview: 'qwen3-vl-flash' }, 200, cors);
    }
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);

    try {
      const auth = request.headers.get('Authorization') || '';
      const idToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!idToken) return json({ error: 'Сначала войдите через Google' }, 401, cors);

      const user = await verifyFirebaseUser(idToken);
      if (!user) return json({ error: 'Сессия Google недействительна. Войдите снова.' }, 401, cors);

      // ImgBB uploads use multipart/form-data. Keep the ImgBB API key on the
      // Worker (Cloudflare secret), never in the public GitHub Pages source.
      if ((request.headers.get('Content-Type') || '').toLowerCase().includes('multipart/form-data')) {
        if (origin !== 'https://derev-studio.github.io') {
          return json({ error: 'Недопустимый источник загрузки' }, 403, cors);
        }
        return handleImgBBUpload(request, user, env, cors);
      }

      const emailHash = await sha256(String(user.email || '').trim().toLowerCase());
      const isOwner = emailHash === OWNER_EMAIL_SHA256 || emailHash === IRINA_EMAIL_SHA256;

      const body = await request.json();
      if (body.action === 'whoami') {
        return json({ ok: true, isOwner, name: user.displayName || '', email: user.email || '' }, 200, cors);
      }

      // GitHub bridge for Irina admin. The PAT stays only in Cloudflare Secret.
      // Strictly limited to the Contents API of one repository.
      if (body.action === 'irinaGithub') {
        if (!isOwner) return json({ error: 'Нет доступа к админке Ирины' }, 403, cors);
        if (origin !== 'https://irina-photo.github.io') return json({ error: 'Недопустимый источник' }, 403, cors);
        if (!env.GITHUB_TOKEN) return json({ error: 'GITHUB_TOKEN is not configured' }, 500, cors);

        const method = String(body.method || 'GET').toUpperCase();
        if (!['GET', 'PUT', 'DELETE'].includes(method)) return json({ error: 'GitHub method is not allowed' }, 405, cors);

        const path = String(body.path || '');
        const prefix = '/repos/irina-photo/irina-photo.github.io/contents/';
        if (!path.startsWith(prefix) || path.includes('..') || path.includes('?')) {
          return json({ error: 'GitHub path is not allowed' }, 400, cors);
        }

        const ghHeaders = {
          'Authorization': 'Bearer ' + env.GITHUB_TOKEN,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        };
        const options = { method, headers: ghHeaders };
        if (method !== 'GET') options.body = JSON.stringify(body.payload || {});
        const gh = await fetch('https://api.github.com' + path, options);
        const raw = await gh.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = {}; }
        if (!gh.ok) {
          return json({
            error: data?.message || ('GitHub HTTP ' + gh.status),
            githubStatus: gh.status,
            documentationUrl: data?.documentation_url || '',
            acceptedPermissions: gh.headers.get('X-Accepted-GitHub-Permissions') || '',
            oauthScopes: gh.headers.get('X-OAuth-Scopes') || '',
            raw: data?.message ? '' : raw.slice(0, 500)
          }, gh.status, cors);
        }
        return json(data, gh.status, cors);
      }

      if (body.action === 'analytics') {
        if (!isOwner) return json({ error: 'Analytics доступна только владельцу' }, 403, cors);
        return handleAnalytics(body, env, cors);
      }

      if (body.action === 'realtime') {
        if (!isOwner) return json({ error: 'Realtime доступен только владельцу' }, 403, cors);
        return handleRealtime(body, env, cors);
      }

      if (body.action === 'robotReview') {
        if (origin !== 'https://derev-studio.github.io') return json({ error: 'Недопустимый источник' }, 403, cors);
        // Paid vision requests are owner-only until public-user quotas are configured.
        if (!isOwner) return json({ error: 'Разговор с настоящим ИИ пока доступен владельцу галереи' }, 403, cors);
        return handleRobotReview(body, env, cors);
      }

      if (!env.QWEN_API_KEY) return json({ error: 'QWEN_API_KEY is not configured' }, 500, cors);

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

async function handleRobotReview(body, env, cors) {
  if (!env.QWEN_API_KEY) return json({ error: 'Ключ Qwen не настроен' }, 503, cors);
  const image = String(body.image || '');
  if (!/^data:image\/jpeg;base64,[a-zA-Z0-9+/=]+$/.test(image) || image.length > 1800000) {
    return json({ error: 'Не удалось подготовить фотографию для ИИ' }, 413, cors);
  }

  const host = 'https://ws-jhgwe40j4chzmyh2.ap-southeast-1.maas.aliyuncs.com';
  const requestBody = {
    model: 'qwen3-vl-flash',
    messages: [
      { role: 'system', content: 'Ты смотришь на фотографию и пишешь два НЕЗАВИСИМЫХ комментария по-русски. Педант — вдумчивая женщина-фотокритик: точно оценивает композицию, свет, сюжет и предлагает одно конкретное улучшение. Циник — остроумный мужчина-художник: замечает сюжет, характер и неожиданные смыслы; говорит по-доброму, иронично, без грубости. Они должны иметь РАЗНЫЕ мнения и не повторять фразы. Не придумывай предметы, которых не видно. Ответь только JSON-объектом с двумя строками: pedant и cynic, по 2-3 предложения в каждой.' },
      { role: 'user', content: [
        { type: 'image_url', image_url: { url: image } },
        { type: 'text', text: 'Обсудите конкретно эту фотографию как два разных собеседника, с художественным вкусом. Укажи только то, что реально видно.' }
      ] }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.82,
    max_tokens: 480,
    enable_thinking: false
  };
  const response = await fetch(host + '/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + env.QWEN_API_KEY },
    body: JSON.stringify(requestBody)
  });
  let data = {};
  try { data = await response.json(); } catch { /* Remote service may be unavailable. */ }
  if (!response.ok) {
    return json({ error: data?.error?.message || data?.message || 'Служба Qwen сейчас недоступна' }, 502, cors);
  }
  const answer = data?.choices?.[0]?.message?.content;
  const raw = typeof answer === 'string' ? answer : Array.isArray(answer) ? answer.map(part => part.text || '').join('') : '';
  let review;
  try { review = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || ''); }
  catch { return json({ error: 'ИИ прислал неполный ответ. Попробуйте ещё раз' }, 502, cors); }
  if (typeof review?.pedant !== 'string' || typeof review?.cynic !== 'string' || !review.pedant.trim() || !review.cynic.trim()) {
    return json({ error: 'ИИ пока не сформулировал два разных мнения' }, 502, cors);
  }
  return json({ pedant: review.pedant.slice(0, 700), cynic: review.cynic.slice(0, 700) }, 200, cors);
}

async function handleImgBBUpload(request, user, env, cors) {
  if (!env.IMGBB_API_KEY) return json({ error: 'ImgBB пока не подключён владельцем сайта' }, 503, cors);
  if (!user.email || user.emailVerified !== true) {
    return json({ error: 'Войдите через подтверждённый аккаунт Google' }, 403, cors);
  }

  const form = await request.formData();
  if (form.get('action') !== 'imgbbUpload') return json({ error: 'Неизвестная операция' }, 400, cors);
  const image = form.get('image');
  if (!image || typeof image.size !== 'number' || typeof image.arrayBuffer !== 'function') {
    return json({ error: 'Выберите изображение' }, 400, cors);
  }
  if (!String(image.type || '').startsWith('image/')) {
    return json({ error: 'Разрешены только изображения' }, 415, cors);
  }
  if (image.size === 0 || image.size > 32 * 1024 * 1024) {
    return json({ error: 'Размер изображения должен быть не больше 32 МБ' }, 413, cors);
  }

  const outgoing = new FormData();
  outgoing.set('image', image, String(image.name || 'photo'));
  const response = await fetch('https://api.imgbb.com/1/upload?key=' + encodeURIComponent(env.IMGBB_API_KEY), {
    method: 'POST',
    body: outgoing
  });
  let data = {};
  try { data = await response.json(); } catch (_) { /* Avoid echoing upstream HTML */ }
  const url = data?.data?.image?.url || data?.data?.url || '';
  if (!response.ok || !url || data?.success !== true) {
    return json({ error: data?.error?.message || 'ImgBB не принял фотографию' }, 502, cors);
  }
  return json({ ok: true, url, thumbUrl: data?.data?.thumb?.url || '', storage: 'imgbb' }, 200, cors);
}

async function handleRealtime(body, env, cors) {
  const site = String(body?.site || '').trim().replace(/[^a-zA-Z0-9_-]/g,'');
  if (!site) return json({ error: 'site is required' }, 400, cors);
  const sa = JSON.parse(env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT || '{}');
  if (!sa.client_email || !sa.private_key) return json({ error: 'Google Analytics service account secret is missing' }, 500, cors);
  const accessToken = await getGoogleAccessToken(sa);
  const endpoint = `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runRealtimeReport`;

  async function realtimeFor(minutesAgo) {
    const requestBody = {
      dimensions: [{name:'unifiedScreenName'}],
      metrics: [{name:'activeUsers'}],
      minuteRanges: [{startMinutesAgo:minutesAgo,endMinutesAgo:0}]
    };
    const r = await fetch(endpoint, {
      method:'POST',
      headers:{'Authorization':`Bearer ${accessToken}`,'Content-Type':'application/json'},
      body:JSON.stringify(requestBody)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || 'GA4 Realtime API error');
    const prefix = `${site} |`;
    let total = 0;
    for (const row of data.rows || []) {
      const title = row.dimensionValues?.[0]?.value || '';
      if (title.toLowerCase().startsWith(prefix.toLowerCase())) total += n(row.metricValues?.[0]?.value);
    }
    return total;
  }

  try {
    const [now,last10] = await Promise.all([realtimeFor(1), realtimeFor(9)]);
    return json({ok:true,site,now,last10,updatedAt:new Date().toISOString()},200,cors);
  } catch (e) {
    return json({error:e?.message || 'GA4 Realtime API error'},500,cors);
  }
}

async function handleAnalytics(body, env, cors) {
  const rawDays = Number(body?.days ?? 7);
  const days = [0, 7, 30].includes(rawDays) ? rawDays : 7;
  const startDate = days === 0 ? 'today' : `${days - 1}daysAgo`;
  const dateRange = { startDate, endDate: 'today' };
  const site = String(body?.site || '').trim().replace(/[^a-zA-Z0-9_-]/g,'');
  const siteFilter = !site ? null : site === 'irina-photo'
    ? {filter:{fieldName:'hostName',stringFilter:{matchType:'EXACT',value:'irina-photo.github.io',caseSensitive:false}}}
    : {filter:{fieldName:'pagePath',stringFilter:{matchType:'BEGINS_WITH',value:`/${site}/`,caseSensitive:false}}};

  const sa = JSON.parse(env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT || '{}');
  if (!sa.client_email || !sa.private_key) {
    return json({ error: 'Google Analytics service account secret is missing' }, 500, cors);
  }

  const accessToken = await getGoogleAccessToken(sa);
  const endpoint = `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:batchRunReports`;

  const requests = [
    report(dateRange, [], ['activeUsers','sessions','screenPageViews','newUsers','engagedSessions','userEngagementDuration']),
    report(dateRange, ['country','region','city'], ['activeUsers','sessions','screenPageViews'], 300),
    report(dateRange, ['deviceCategory','browser','operatingSystem','screenResolution'], ['activeUsers','sessions'], 250),
    report(dateRange, ['browser','browserVersion'], ['activeUsers'], 100),
    report(dateRange, ['operatingSystem','operatingSystemVersion'], ['activeUsers'], 100),
    report(dateRange, ['language'], ['activeUsers'], 100),
    report(dateRange, ['newVsReturning'], ['activeUsers','sessions'], 10),
    report(dateRange, ['sessionSourceMedium','defaultChannelGroup'], ['activeUsers','sessions'], 150),
    report(dateRange, ['hostName','pagePath'], ['screenPageViews','activeUsers'], 500),
    report(dateRange, ['userAgeBracket'], ['activeUsers'], 20),
    report(dateRange, ['userGender'], ['activeUsers'], 10),
    report(dateRange, ['dateHour'], ['activeUsers','sessions','screenPageViews'], 1000),
    report(dateRange, ['dayOfWeekName'], ['activeUsers','sessions'], 10),
    report(dateRange, ['mobileDeviceBranding','mobileDeviceModel'], ['activeUsers'], 100),
    report(dateRange, ['continent','country'], ['activeUsers'], 250)
  ];
  if (siteFilter) requests.forEach(q => q.dimensionFilter = siteFilter);

  const reports = await runInChunks(endpoint, accessToken, requests, 5);
  const s = reports[0]?.rows?.[0]?.metricValues || [];
  const summary = {
    users:n(s[0]?.value), sessions:n(s[1]?.value), views:n(s[2]?.value), newUsers:n(s[3]?.value),
    engagedSessions:n(s[4]?.value), engagementSeconds:n(s[5]?.value)
  };

  const locations = rows(reports[1]).map(x => ({country:x.d[0]||'Не определено',region:x.d[1]||'',city:x.d[2]||'Не определено',users:n(x.m[0]),sessions:n(x.m[1]),views:n(x.m[2])}));
  const deviceProfiles = rows(reports[2]).map(x=>({device:x.d[0]||'Не определено',browser:x.d[1]||'Не определено',os:x.d[2]||'Не определено',screen:x.d[3]||'Не определено',users:n(x.m[0]),sessions:n(x.m[1])}));
  const browserVersions = rows(reports[3]).map(x=>({name:[x.d[0],x.d[1]].filter(Boolean).join(' '),users:n(x.m[0])}));
  const osVersions = rows(reports[4]).map(x=>({name:[x.d[0],x.d[1]].filter(Boolean).join(' '),users:n(x.m[0])}));
  const languages = simpleRows(reports[5]);
  const visitorTypes = rows(reports[6]).map(x=>({name:visitorTypeName(x.d[0]),users:n(x.m[0]),sessions:n(x.m[1])}));
  const sources = rows(reports[7]).map(x=>({name:x.d[0]||'Не определено',channel:x.d[1]||'',users:n(x.m[0]),sessions:n(x.m[1])}));
  const pageRows = rows(reports[8]).map(x=>({host:x.d[0]||'',path:x.d[1]||'/',views:n(x.m[0]),users:n(x.m[1])}));
  const ages = simpleRows(reports[9], ageName);
  const genders = simpleRows(reports[10], genderName);
  const hours = rows(reports[11]).map(x=>({dateHour:x.d[0]||'',users:n(x.m[0]),sessions:n(x.m[1]),views:n(x.m[2])}));
  const weekdays = rows(reports[12]).map(x=>({name:x.d[0]||'',users:n(x.m[0]),sessions:n(x.m[1])}));
  const mobileModels = rows(reports[13]).map(x=>({name:[x.d[0],x.d[1]].filter(Boolean).join(' ')||'Не определено',users:n(x.m[0])}));
  const continents = rows(reports[14]).map(x=>({continent:x.d[0]||'Не определено',country:x.d[1]||'Не определено',users:n(x.m[0])}));

  let visitorProfiles = [];
  let visitorProfilesStatus = 'visitor_id custom dimension is not registered yet';
  try {
    const visitorReqs = [
      report(dateRange, ['customUser:visitor_id','dateHourMinute','country','region','city','deviceCategory','browser','operatingSystem','screenResolution'], ['sessions','screenPageViews','userEngagementDuration'], 500),
      report(dateRange, ['customUser:visitor_id','browserVersion','operatingSystemVersion','language','hostName','pagePath','sessionSourceMedium','newVsReturning'], ['sessions','screenPageViews'], 500)
    ];
    if (siteFilter) visitorReqs.forEach(q => q.dimensionFilter = siteFilter);
    const vr = await runInChunks(endpoint, accessToken, visitorReqs, 5);
    visitorProfiles = mergeVisitorProfiles(vr[0], vr[1]);
    visitorProfilesStatus = 'ok';
  } catch (e) {
    visitorProfilesStatus = String(e?.message || e);
  }

  summary.avgEngagementSeconds = summary.users ? Math.round(summary.engagementSeconds / summary.users) : 0;
  summary.engagementRate = summary.sessions ? Math.round((summary.engagedSessions / summary.sessions) * 1000) / 10 : 0;

  return json({
    ok:true, propertyId:GA4_PROPERTY_ID, days, site, summary,
    locations, deviceProfiles, browserVersions, osVersions, languages, visitorTypes, sources,
    pages:pageRows.slice(0,150), sites:aggregateSites(pageRows), ages, genders, hours, weekdays, mobileModels, continents,
    visitorProfiles, visitorProfilesStatus,
    privacyNote:'Данные агрегированы Google Analytics. География и демография могут быть приблизительными или скрыты порогами конфиденциальности. visitor_id — случайная анонимная метка браузера, не имя человека.'
  }, 200, cors);
}

async function runInChunks(endpoint, accessToken, requests, chunkSize) {
  const all = [];
  for (let i=0;i<requests.length;i+=chunkSize) {
    const chunk = requests.slice(i,i+chunkSize);
    const r = await fetch(endpoint, {
      method:'POST',
      headers:{'Authorization':`Bearer ${accessToken}`,'Content-Type':'application/json'},
      body:JSON.stringify({requests:chunk})
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || 'GA4 Data API error');
    all.push(...(data.reports||[]));
  }
  return all;
}

function report(dateRange, dimensions, metrics, limit) {
  const q={dateRanges:[dateRange],dimensions:dimensions.map(name=>({name})),metrics:metrics.map(name=>({name}))};
  if(limit){q.limit=String(limit);q.orderBys=[{metric:{metricName:metrics[0]},desc:true}];}
  return q;
}
function rows(reportObj){return (reportObj?.rows||[]).map(r=>({d:(r.dimensionValues||[]).map(v=>v.value),m:(r.metricValues||[]).map(v=>v.value)}));}
function simpleRows(reportObj,mapper=(v=>v||'Не определено')){return rows(reportObj).map(x=>({name:mapper(x.d[0]),users:n(x.m[0])}));}
function n(v){const x=Number(v||0);return Number.isFinite(x)?x:0;}
function visitorTypeName(v){return ({new:'Новый',returning:'Вернувшийся'})[v]||v||'Не определено';}
function ageName(v){return ({'18-24':'18–24','25-34':'25–34','35-44':'35–44','45-54':'45–54','55-64':'55–64','65+':'65+'})[v]||v||'Не определено';}
function genderName(v){return ({male:'Мужчины',female:'Женщины'})[v]||v||'Не определено';}

function aggregateSites(pageRows){
  const map=new Map();
  for(const r of pageRows){
    const host=String(r.host||'').toLowerCase();
    const seg=host==='irina-photo.github.io' ? 'irina-photo' : (String(r.path||'/').split('?')[0].split('/').filter(Boolean)[0]||'root');
    const cur=map.get(seg)||{name:seg,users:0,views:0};
    cur.users+=r.users;cur.views+=r.views;map.set(seg,cur);
  }
  return [...map.values()].sort((a,b)=>b.views-a.views).slice(0,60);
}

function mergeVisitorProfiles(reportA, reportB){
  const map=new Map();
  for(const x of rows(reportA)){
    const id=x.d[0]||'unknown'; const cur=map.get(id)||baseVisitor(id);
    const stamp=x.d[1]||''; if(stamp && (!cur.lastSeen || stamp>cur.lastSeen)) cur.lastSeen=stamp;
    cur.country=x.d[2]||cur.country; cur.region=x.d[3]||cur.region; cur.city=x.d[4]||cur.city;
    cur.device=x.d[5]||cur.device; cur.browser=x.d[6]||cur.browser; cur.os=x.d[7]||cur.os; cur.screen=x.d[8]||cur.screen;
    cur.sessions+=n(x.m[0]); cur.views+=n(x.m[1]); cur.engagementSeconds+=n(x.m[2]); map.set(id,cur);
  }
  for(const x of rows(reportB)){
    const id=x.d[0]||'unknown'; const cur=map.get(id)||baseVisitor(id);
    cur.browserVersion=x.d[1]||cur.browserVersion; cur.osVersion=x.d[2]||cur.osVersion; cur.language=x.d[3]||cur.language;
    cur.host=x.d[4]||cur.host; cur.lastPage=x.d[5]||cur.lastPage; cur.source=x.d[6]||cur.source; cur.type=visitorTypeName(x.d[7]||'');
    cur.sessions+=n(x.m[0]); cur.views+=n(x.m[1]); map.set(id,cur);
  }
  return [...map.values()].filter(x=>x.id!=='unknown').sort((a,b)=>String(b.lastSeen).localeCompare(String(a.lastSeen))).slice(0,200);
}
function baseVisitor(id){return {id,lastSeen:'',country:'',region:'',city:'',device:'',browser:'',browserVersion:'',os:'',osVersion:'',screen:'',language:'',host:'',lastPage:'',source:'',type:'',sessions:0,views:0,engagementSeconds:0};}

async function getGoogleAccessToken(sa) {
  const now=Math.floor(Date.now()/1000);
  const header=b64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const claim=b64url(JSON.stringify({iss:sa.client_email,scope:'https://www.googleapis.com/auth/analytics.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}));
  const unsigned=`${header}.${claim}`;
  const key=await crypto.subtle.importKey('pkcs8',pemToArrayBuffer(sa.private_key),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(unsigned));
  const jwt=`${unsigned}.${b64urlBytes(new Uint8Array(sig))}`;
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt})});
  const j=await r.json();
  if(!r.ok||!j.access_token)throw new Error(j.error_description||j.error||'Google OAuth failed');
  return j.access_token;
}
function pemToArrayBuffer(pem){const b64=String(pem).replace(/-----BEGIN PRIVATE KEY-----/g,'').replace(/-----END PRIVATE KEY-----/g,'').replace(/\s+/g,'');const bin=atob(b64);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out.buffer;}
function b64url(s){return b64urlBytes(new TextEncoder().encode(s));}
function b64urlBytes(bytes){let b='';bytes.forEach(x=>b+=String.fromCharCode(x));return btoa(b).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}

async function verifyFirebaseUser(idToken) {
  const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken})});
  if (!r.ok) return null;
  const data = await r.json();
  return data?.users?.[0] || null;
}
async function sha256(text){const data=new TextEncoder().encode(text);const hash=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function json(obj,status,headers){return new Response(JSON.stringify(obj),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8'}});}
