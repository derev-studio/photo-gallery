(() => {
  const MEASUREMENT_ID = 'G-DMHK1XGDE6';
  const VISITOR_KEY = 'derev_visitor_id_v1';
  const FIRST_SEEN_KEY = 'derev_visitor_first_seen_v1';
  const OWNER_KEY = 'derev_owner_browser_v1';
  const VISIT_PREFIX = 'derev_site_visits_v1:';
  const WORKER_URL = 'https://photo-ai-qwen.qerevv.workers.dev/';
  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyB2X3o7KwYFkMfsskKoWpQYBrws8L-Mn9w',
    authDomain: 'photo-gallery-18193.firebaseapp.com',
    projectId: 'photo-gallery-18193',
    databaseURL: 'https://photo-gallery-18193-default-rtdb.firebaseio.com',
    storageBucket: 'photo-gallery-18193.firebasestorage.app',
    messagingSenderId: '329094770221',
    appId: '1:329094770221:web:b9d076f195f968668212a4'
  };

  function makeId() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return 'V-' + [...bytes].map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function siteId() {
    const parts = location.pathname.split('/').filter(Boolean);
    const first = parts[0] || '';
    // Корневой сайт «Империя»: /, /articles.html, /universe.html и другие одиночные HTML-страницы
    // считаются одним сайтом root. Проекты в подпапках остаются отдельными сайтами.
    if (!first || (parts.length === 1 && /\.html?$/i.test(first))) return 'root';
    return first;
  }

  const site = siteId();
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

  const visitKey = VISIT_PREFIX + site;
  const visitNumber = (Number(localStorage.getItem(visitKey)) || 0) + 1;
  localStorage.setItem(visitKey, String(visitNumber));

  let ownerMark = localStorage.getItem(OWNER_KEY) === '1' ? 'owner' : 'visitor';

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

  function setUserProperties() {
    gtag('set', 'user_properties', {
      visitor_id: visitorId,
      visitor_owner: ownerMark,
      visitor_first_seen: firstSeen.slice(0, 10)
    });
  }

  function sendVisit(eventName='visitor_profile') {
    setUserProperties();
    gtag('event', eventName, {
      visitor_id: visitorId,
      visitor_owner: ownerMark,
      visitor_first_seen: firstSeen.slice(0, 10),
      site_id: site,
      visit_number: visitNumber,
      page_location: location.href,
      page_title: document.title,
      screen_size: `${screen.width}x${screen.height}`,
      viewport_size: `${innerWidth}x${innerHeight}`,
      timezone_name: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      browser_language: navigator.language || '',
      touch_points: Number(navigator.maxTouchPoints || 0),
      referrer_host: (() => { try { return document.referrer ? new URL(document.referrer).hostname : 'direct'; } catch { return 'direct'; } })()
    });
  }

  const analyticsPageTitle = `${site} | ${document.title}`;
  gtag('event', 'page_view', { page_location: location.href, page_title: analyticsPageTitle });
  sendVisit();

  window.DerevVisitor = {
    id: visitorId,
    firstSeen,
    site,
    visitNumber,
    isOwner: ownerMark === 'owner',
    markOwner() {
      localStorage.setItem(OWNER_KEY, '1');
      ownerMark = 'owner';
      this.isOwner = true;
      setUserProperties();
      sendVisit('owner_visit_identified');
      return true;
    },
    unmarkOwner() {
      localStorage.removeItem(OWNER_KEY);
      ownerMark = 'visitor';
      this.isOwner = false;
      setUserProperties();
      return true;
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('a[href="analytics.html"], a[href$="/analytics.html"]').forEach(a => a.remove());
    const status = document.getElementById('userStatus');
    if (!status || !window.firebase) return;
    status.style.cursor = 'pointer';
    status.title = 'Нажмите, чтобы войти через Google';

    async function verifyOwner(user) {
      if (!user) { window.DerevVisitor.unmarkOwner(); return false; }
      try {
        const token = await user.getIdToken();
        const r = await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ action: 'whoami' })
        });
        const data = await r.json();
        if (r.ok && data.isOwner === true) { window.DerevVisitor.markOwner(); return true; }
      } catch (e) { console.warn('Owner check failed:', e); }
      window.DerevVisitor.unmarkOwner();
      return false;
    }

    const startAuth = () => {
      const ready = () => {
        try {
          if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
          const auth = firebase.auth();
          auth.onAuthStateChanged(async user => {
            if (user) {
              const isOwner = await verifyOwner(user);
              const shortName = user.displayName || user.email || 'Google';
              status.textContent = (isOwner ? '👑 ' : '✅ ') + shortName;
              status.title = 'Нажмите, чтобы выйти';
            } else {
              window.DerevVisitor.unmarkOwner();
              status.textContent = '👤 Войти через Google';
              status.title = 'Нажмите, чтобы войти через Google';
            }
          });
          status.onclick = async () => {
            try {
              if (auth.currentUser) await auth.signOut();
              else await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
            } catch (e) {
              console.error('Google login error:', e);
              alert('Не удалось войти через Google: ' + (e.message || e));
            }
          };
        } catch (e) { console.error('Firebase Auth init error:', e); }
      };
      if (firebase.auth) return ready();
      const s = document.createElement('script');
      s.src = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js';
      s.onload = ready;
      s.onerror = () => console.error('Не загрузился Firebase Auth');
      document.head.appendChild(s);
    };
    startAuth();
  });
})();
