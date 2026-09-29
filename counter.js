(()=>{
  const script=document.currentScript;
  const pathSite=location.pathname.split('/').filter(Boolean)[0]||'site';
  const site=(script&&script.dataset.site)||pathSite;

  // Guarantee that every site using the shared counter also has the shared GA4 client.
  if(!document.querySelector('script[src*="/photo-gallery/analytics-client.js"]')){
    const a=document.createElement('script');
    a.defer=true;
    a.src='https://derev-studio.github.io/photo-gallery/analytics-client.js';
    document.head.appendChild(a);
  }

  // Old lightweight hit counter: once per tab session.
  const once='ds-counted-'+site;
  if(!sessionStorage.getItem(once)){
    sessionStorage.setItem(once,'1');
    fetch('https://countapi.mileshilliard.com/api/v1/hit/derev-studio-'+encodeURIComponent(site)).catch(()=>{});
  }

  // Realtime heartbeat. It is invisible and is sent only while the tab is visible.
  function presence(){
    if(document.visibilityState!=='visible'||typeof window.gtag!=='function')return;
    window.gtag('event','derev_presence',{
      site_id:site,
      page_location:location.href,
      page_title:`${site} | ${document.title}`
    });
  }
  setTimeout(presence,15000);
  setInterval(presence,45000);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible')presence();
  });

  // Put the existing photo editor back into the Photo Gallery UI.
  if(site==='photo-gallery' && !location.pathname.endsWith('/editor.html')){
    const addEditorLink=()=>{
      if(document.getElementById('derev-editor-link'))return;
      const host=document.querySelector('.header-controls')||document.querySelector('.tabs')||document.body;
      const link=document.createElement('a');
      link.id='derev-editor-link';
      link.href='editor.html';
      link.textContent='🎨 Редактор';
      link.title='Открыть фоторедактор';
      link.style.cssText='display:inline-flex;align-items:center;justify-content:center;text-decoration:none;background:#1a3a6b;color:#fff;border-radius:40px;padding:7px 16px;font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;box-shadow:0 3px 10px rgba(26,58,107,.18)';
      host.appendChild(link);
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',addEditorLink,{once:true});
    else addEditorLink();
  }
})();
