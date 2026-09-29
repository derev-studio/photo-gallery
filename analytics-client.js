(() => {
  const MEASUREMENT_ID = 'G-DMHK1XGDE6';
  const VISITOR_KEY = 'derev_visitor_id_v1';
  const FIRST_SEEN_KEY = 'derev_visitor_first_seen_v1';
  const OWNER_KEY = 'derev_owner_browser_v1';

  // ===== STORAGE BRIDGE =====
  // The old gallery code still calls ImgBB. Intercept only that upload call
  // and transparently send the heavy image to Cloudinary instead.
  // Firebase continues to store only the returned URL and gallery metadata.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async function(input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.startsWith('https://api.imgbb.com/1/upload')) {
      const oldBody = init && init.body;
      const file = oldBody instanceof FormData ? oldBody.get('image') : null;
      if (!(file instanceof Blob)) {
        throw new Error('Фото не найдено для загрузки в Cloudinary');
      }

      const fd = new FormData();
      fd.append('file', file);
      fd.append('upload_preset', 'kaktus');

      const cloudinaryResponse = await nativeFetch(
        'https://api.cloudinary.com/v1_1/i1lysqxk/image/upload',
        { method: 'POST', body: fd }
      );
      const cloudinaryData = await cloudinaryResponse.json();
      if (!cloudinaryResponse.ok || !cloudinaryData.secure_url) {
        throw new Error((cloudinaryData.error && cloudinaryData.error.message) || 'Cloudinary upload failed');
      }

      // Return an ImgBB-shaped response so the existing gallery code keeps working.
      return new Response(JSON.stringify({
        success: true,
        data: { url: cloudinaryData.secure_url }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return nativeFetch(input, init);
  };

  function makeId() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return 'V-' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  let visitorId = localStorage.getItem(VISITOR_KEY);
  if (!visitorId) {
    visitorId = makeId();
    localStorage.setItem(VISITOR_KEY, visitorId);
  }

  let firstSeen = localStorage.getItem(FIRST_SEEN_KEY);
  if (!firstSeen) {
    firstSeen = new Date().toISOString();
    localStorage.setItem(FIRST_SEEN_KEY, firstSeen);
  }

  const ownerMark = localStorage.getItem(OWNER_KEY) === '1' ? 'owner' : 'visitor';

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function(){ dataLayer.push(arguments); };

  if (!document.querySelector(`script[src*="googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}"]`)) {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
    document.head.appendChild(s);
  }

  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID, { send_page_view: false });
  gtag('set', 'user_properties', {
    visitor_id: visitorId,
    visitor_owner: ownerMark,
    visitor_first_seen: firstSeen.slice(0, 10)
  });

  gtag('event', 'visitor_profile', {
    visitor_id: visitorId,
    visitor_owner: ownerMark,
    visitor_first_seen: firstSeen.slice(0, 10),
    page_location: location.href,
    page_title: document.title,
    screen_size: `${screen.width}x${screen.height}`,
    viewport_size: `${innerWidth}x${innerHeight}`,
    timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    browser_language: navigator.language || '',
    touch_points: Number(navigator.maxTouchPoints || 0),
    referrer_host: (() => { try { return document.referrer ? new URL(document.referrer).hostname : 'direct'; } catch { return 'direct'; } })()
  });

  window.DerevVisitor = {
    id: visitorId,
    firstSeen,
    isOwner: ownerMark === 'owner',
    markOwner() {
      localStorage.setItem(OWNER_KEY, '1');
      return true;
    },
    unmarkOwner() {
      localStorage.removeItem(OWNER_KEY);
      return true;
    }
  };
})();
