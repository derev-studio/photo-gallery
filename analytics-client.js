(() => {
  const MEASUREMENT_ID = 'G-DMHK1XGDE6';
  const VISITOR_KEY = 'derev_visitor_id_v1';
  const FIRST_SEEN_KEY = 'derev_visitor_first_seen_v1';
  const OWNER_KEY = 'derev_owner_browser_v1';
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
    // On analytics page make the only visible back button return to the gallery,
    // so there is no confusion between two different admin pages.
    const oldAdminLink = document.querySelector('.top a[href="admin.html"]');
    if (oldAdminLink) {
      oldAdminLink.href = 'index.html';
      oldAdminLink.textContent = '← Фотогалерея';
    }

    // Google login for the main gallery. The old "Гость" label becomes clickable.
    const status = document.getElementById('userStatus');
    if (!status || !window.firebase) return;

    status.style.cursor = 'pointer';
    status.title = 'Нажмите, чтобы войти через Google';

    const analyticsLink = document.createElement('a');
    analyticsLink.href = 'analytics.html';
    analyticsLink.textContent = '📊 Аналитика';
    analyticsLink.className = 'lang-btn';
    analyticsLink.style.textDecoration = 'none';
    analyticsLink.style.display = 'inline-flex';
    analyticsLink.style.alignItems = 'center';
    const controls = status.parentElement;
    if (controls && !controls.querySelector('a[href="analytics.html"]')) controls.appendChild(analyticsLink);

    const startAuth = () => {
      const ready = () => {
        try {
          if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
          const auth = firebase.auth();
          auth.onAuthStateChanged(user => {
            if (user) {
              const shortName = user.displayName || user.email || 'Google';
              status.textContent = (localStorage.getItem(OWNER_KEY) === '1' ? '👑 ' : '✅ ') + shortName;
              status.title = 'Нажмите, чтобы выйти';
            } else {
              status.textContent = '👤 Гость — войти Google';
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
