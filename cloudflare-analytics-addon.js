// Derev Studio GA4 addon for Cloudflare Worker
// Secret required: GOOGLE_ANALYTICS_SERVICE_ACCOUNT
// GA4 property: 556452970
// Call only AFTER your existing Firebase owner check succeeds.

const GA4_PROPERTY_ID = '556452970';

export async function handleAnalytics(body, env, cors = {}) {
  const rawDays = Number(body?.days ?? 7);
  const days = [0, 7, 30].includes(rawDays) ? rawDays : 7;
  const startDate = days === 0 ? 'today' : `${days - 1}daysAgo`;
  const dateRange = { startDate, endDate: 'today' };

  const sa = JSON.parse(env.GOOGLE_ANALYTICS_SERVICE_ACCOUNT || '{}');
  if (!sa.client_email || !sa.private_key) {
    return json({ error: 'Google Analytics service account secret is missing' }, 500, cors);
  }

  const accessToken = await getGoogleAccessToken(sa);
  const endpoint = `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:batchRunReports`;
  const requests = [
    { dateRanges: [dateRange], metrics: [{name:'activeUsers'},{name:'sessions'},{name:'screenPageViews'}] },
    { dateRanges: [dateRange], dimensions: [{name:'country'}], metrics: [{name:'activeUsers'}], orderBys:[{metric:{metricName:'activeUsers'},desc:true}], limit:'100' },
    { dateRanges: [dateRange], dimensions: [{name:'city'},{name:'country'}], metrics: [{name:'activeUsers'}], orderBys:[{metric:{metricName:'activeUsers'},desc:true}], limit:'200' },
    { dateRanges: [dateRange], dimensions: [{name:'deviceCategory'}], metrics: [{name:'activeUsers'}], orderBys:[{metric:{metricName:'activeUsers'},desc:true}], limit:'20' },
    { dateRanges: [dateRange], dimensions: [{name:'pagePath'}], metrics: [{name:'screenPageViews'},{name:'activeUsers'}], orderBys:[{metric:{metricName:'screenPageViews'},desc:true}], limit:'250' }
  ];

  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests })
  });
  const data = await r.json();
  if (!r.ok) return json({ error: data?.error?.message || 'GA4 Data API error' }, r.status, cors);

  const reports = data.reports || [];
  const summaryVals = reports[0]?.rows?.[0]?.metricValues || [];
  const summary = {
    users: n(summaryVals[0]?.value),
    sessions: n(summaryVals[1]?.value),
    views: n(summaryVals[2]?.value)
  };

  const countries = rows(reports[1]).map(x => ({ name:x.d[0] || 'Не определено', users:n(x.m[0]) }));
  const cities = rows(reports[2]).map(x => ({ name:x.d[0] || 'Не определено', country:x.d[1] || '', users:n(x.m[0]) }));
  const devices = rows(reports[3]).map(x => ({ name:deviceName(x.d[0]), users:n(x.m[0]) }));
  const pageRows = rows(reports[4]).map(x => ({ path:x.d[0] || '/', views:n(x.m[0]), users:n(x.m[1]) }));
  const pages = pageRows.slice(0, 60).map(x => ({ name:x.path, views:x.views, users:x.users }));
  const sites = aggregateSites(pageRows);

  return json({ ok:true, propertyId:GA4_PROPERTY_ID, days, summary, countries, cities, devices, sites, pages }, 200, cors);
}

function rows(report) {
  return (report?.rows || []).map(r => ({
    d: (r.dimensionValues || []).map(v => v.value),
    m: (r.metricValues || []).map(v => v.value)
  }));
}
function n(v){ const x = Number(v || 0); return Number.isFinite(x) ? x : 0; }
function deviceName(v){ return ({desktop:'Компьютер',mobile:'Телефон',tablet:'Планшет',smartTv:'Телевизор'})[v] || v || 'Не определено'; }
function aggregateSites(pageRows){
  const map = new Map();
  for (const r of pageRows) {
    const seg = String(r.path || '/').split('?')[0].split('/').filter(Boolean)[0] || 'root';
    const name = siteName(seg);
    const cur = map.get(name) || {name, users:0, views:0};
    cur.users += r.users; // approximate per-site active users when summed from page rows
    cur.views += r.views;
    map.set(name, cur);
  }
  return [...map.values()].sort((a,b)=>b.views-a.views).slice(0,40);
}
function siteName(seg){
  const names={
    'photo-gallery':'Фотогалерея + AI','elki-palki':'Ёлки-палки','dasha-risunki':'Даша — рисунки',
    'roni':'Рони','toda-poriya':'Toda Poriya','cow-site':'Cow site','derevyashkin-writer':'Сайт писателя',
    'cactus-books':'Книги / кактусы','photo-preview':'Photo Preview','root':'Главная derev-studio.github.io'
  };
  return names[seg] || seg;
}

async function getGoogleAccessToken(sa) {
  const now = Math.floor(Date.now()/1000);
  const header = b64url(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey('pkcs8', pemToArrayBuffer(sa.private_key), {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64urlBytes(new Uint8Array(sig))}`;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt})
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(j.error_description || j.error || 'Google OAuth failed');
  return j.access_token;
}
function pemToArrayBuffer(pem){
  const b64=String(pem).replace(/-----BEGIN PRIVATE KEY-----/g,'').replace(/-----END PRIVATE KEY-----/g,'').replace(/\s+/g,'');
  const bin=atob(b64); const out=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i); return out.buffer;
}
function b64url(s){ return b64urlBytes(new TextEncoder().encode(s)); }
function b64urlBytes(bytes){ let b=''; bytes.forEach(x=>b+=String.fromCharCode(x)); return btoa(b).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'); }
function json(obj,status=200,cors={}){ return new Response(JSON.stringify(obj),{status,headers:{'Content-Type':'application/json; charset=utf-8',...cors}}); }

/*
INTEGRATION INTO YOUR EXISTING WORKER
------------------------------------
1) Put this import at the very top if you use modules/bundling:
   import { handleAnalytics } from './cloudflare-analytics-addon.js';

OR, if editing the Worker as one single file, paste all helper functions from this file at the bottom.

2) In your existing fetch handler, AFTER Firebase owner verification and AFTER:
   const body = await request.json();
add:

   if (body.action === 'analytics') {
     return handleAnalytics(body, env, cors);
   }

Do not place the analytics branch before the existing owner check.
*/
