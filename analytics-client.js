(() => {
  const MEASUREMENT_ID = 'G-DMHK1XGDE6';
  const VISITOR_KEY = 'derev_visitor_id_v1';
  const FIRST_SEEN_KEY = 'derev_visitor_first_seen_v1';
  const OWNER_KEY = 'derev_owner_browser_v1';
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
      this.isOwner = true;
      gtag('set', 'user_properties', { visitor_owner: 'owner' });
      return true;
    },
    unmarkOwner() {
      localStorage.removeItem(OWNER_KEY);
      this.isOwner = false;
      gtag('set', 'user_properties', { visitor_owner: 'visitor' });
      return true;
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    const oldAdminLink = document.querySelector('.top a[href="admin.html"]');
    if (oldAdminLink) {
      oldAdminLink.href = 'index.html';
      oldAdminLink.textContent = '← Фотогалерея';
    }

    const status = document.getElementById('userStatus');
    if (!status || !window.firebase) return;

    status.style.cursor = 'pointer';
    status.title = 'Нажмите, чтобы войти через Google';

    const analyticsLink = document.createElement('a');
    analyticsLink.href = 'analytics.html';
    analyticsLink.textContent = '📊 Аналитика';
    analyticsLink.className = 'lang-btn';
    analyticsLink.style.textDecoration = 'none';
    analyticsLink.style.display = 'none';
    analyticsLink.style.alignItems = 'center';
    const controls = status.parentElement;
    if (controls && !controls.querySelector('a[href="analytics.html"]')) controls.appendChild(analyticsLink);

    async function verifyOwner(user) {
      analyticsLink.style.display = 'none';
      if (!user) {
        window.DerevVisitor.unmarkOwner();
        return false;
      }
      try {
        const token = await user.getIdToken();
        const r = await fetch(WORKER_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ action: 'whoami' })
        });
        const data = await r.json();
        if (r.ok && data.isOwner === true) {
          window.DerevVisitor.markOwner();
          analyticsLink.style.display = 'inline-flex';
          return true;
        }
      } catch (e) {
        console.warn('Owner check failed:', e);
      }
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
              analyticsLink.style.display = 'none';
              window.DerevVisitor.unmarkOwner();
              status.textContent = '👤 Войти через Google';
              status.title = 'Нажмите, чтобы войти через Google';
            }
          });
          status.onclick = async () => {
            try {
              if (auth.currentUser) {
                await auth.signOut();
              } else {
                const provider = new firebase.auth.GoogleAuthProvider();
                await auth.signInWithPopup(provider);
              }
            } catch (e) {
              console.error('Google login error:', e);
              alert('Не удалось войти через Google: ' + (e.message || e));
            }
          };
        } catch (e) {
          console.error('Firebase Auth init error:', e);
        }
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
