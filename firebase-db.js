// Конфигурация ключей
const IMGBB_API_KEY = "b3ef16e01059cc97d198428f28ebc07e";
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB2X3o7KwYFkMfsskKoWpQYBrws8L-Mn9w",
  authDomain: "photo-gallery-18193.firebaseapp.com",
  projectId: "photo-gallery-18193",
  databaseURL: "https://photo-gallery-18193-default-rtdb.firebaseio.com",
  storageBucket: "photo-gallery-18193.firebasestorage.app",
  messagingSenderId: "329094770221",
  appId: "1:329094770221:web:b9d076f195f968668212a4"
};

// Подключение скриптов Firebase
(function() {
  const s1 = document.createElement('script');
  s1.src = "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js";
  document.head.appendChild(s1);

  s1.onload = () => {
    const s2 = document.createElement('script');
    s2.src = "https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js";
    document.head.appendChild(s2);

    s2.onload = initApp;
  };

  function initApp() {
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }
    window.appDatabase = firebase.database();
    console.log("Мост Firebase + ImgBB готов к работе!");
    listenToCloudPhotos();
  }
})();

// Функция загрузки картинки на склад ImgBB
window.uploadToCloud = async function(base64Data) {
  try {
    const cleanBase64 = base64Data.split(',')[1] || base64Data;
    const formData = new FormData();
    formData.append("image", cleanBase64);

    const response = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
      method: "POST",
      body: formData
    });

    const result = await response.json();
    if (result.success) {
      return result.data.url; // Прямая ссылка на фото
    } else {
      console.error("Ошибка ImgBB:", result);
      return base64Data;
    }
  } catch (err) {
    console.error("Сбой отправки на ImgBB:", err);
    return base64Data;
  }
};

// Функция синхронизации фотографий для всех пользователей
function listenToCloudPhotos() {
  const photosRef = window.appDatabase.ref('photos');
  
  photosRef.on('child_added', (snapshot) => {
    const item = snapshot.val();
    const dbName = 'SafeGalleryDB';
    const storeName = 'photos';
    
    const req = indexedDB.open(dbName, 1);
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      
      store.put(item);
      tx.oncomplete = () => {
        if (typeof window.renderCatalog === 'function') {
          window.renderCatalog();
        }
      };
    };
  });
}