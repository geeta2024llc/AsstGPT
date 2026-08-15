(function () {
  if (window.AsstGPTWidgetInitialized) return;
  window.AsstGPTWidgetInitialized = true;

  // Determine host domain
  const scriptTag = document.currentScript || Array.from(document.querySelectorAll('script')).find(s => s.src && s.src.includes('widget.js'));
  const scriptSrc = scriptTag ? scriptTag.src : window.location.origin;
  const baseUrl = new URL(scriptSrc).origin;

  // Create Styles
  const style = document.createElement('style');
  style.textContent = `
    #aiwhisper-widget-container {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    #aiwhisper-launcher-btn {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);
      box-shadow: 0 4px 16px rgba(79, 70, 229, 0.4), 0 2px 4px rgba(0, 0, 0, 0.1);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease;
      outline: none;
    }
    #aiwhisper-launcher-btn:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 20px rgba(79, 70, 229, 0.5);
    }
    #aiwhisper-launcher-btn:active {
      transform: scale(0.95);
    }
    #aiwhisper-iframe-container {
      position: fixed;
      bottom: 92px;
      right: 24px;
      width: 380px;
      height: 580px;
      max-height: calc(100vh - 120px);
      max-width: calc(100vw - 48px);
      background: #0f172a;
      border-radius: 20px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.1);
      overflow: hidden;
      display: none;
      opacity: 0;
      transform: translateY(16px) scale(0.96);
      transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 2147483647;
    }
    #aiwhisper-iframe-container.open {
      display: block;
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    #aiwhisper-widget-iframe {
      width: 100%;
      height: 100%;
      border: none;
      border-radius: 20px;
    }
    @media (max-width: 480px) {
      #aiwhisper-iframe-container {
        bottom: 0;
        right: 0;
        width: 100vw;
        height: 100vh;
        max-height: 100vh;
        max-width: 100vw;
        border-radius: 0;
      }
      #aiwhisper-widget-iframe {
        border-radius: 0;
      }
    }
  `;
  document.head.appendChild(style);

  // Create HTML structure
  const container = document.createElement('div');
  container.id = 'aiwhisper-widget-container';

  const launcher = document.createElement('button');
  launcher.id = 'aiwhisper-launcher-btn';
  launcher.setAttribute('aria-label', 'Open Live Support Chat');
  launcher.innerHTML = `
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
    </svg>
  `;

  const iframeContainer = document.createElement('div');
  iframeContainer.id = 'aiwhisper-iframe-container';

  let iframeLoaded = false;
  let isOpen = false;

  launcher.addEventListener('click', () => {
    isOpen = !isOpen;

    if (isOpen) {
      if (!iframeLoaded) {
        const iframe = document.createElement('iframe');
        iframe.id = 'aiwhisper-widget-iframe';
        iframe.src = `${baseUrl}/widget`;
        iframe.title = 'AsstGPT Live Support Chat';
        iframeContainer.appendChild(iframe);
        iframeLoaded = true;
      }

      iframeContainer.style.display = 'block';
      setTimeout(() => iframeContainer.classList.add('open'), 10);
      launcher.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;
    } else {
      iframeContainer.classList.remove('open');
      setTimeout(() => {
        if (!isOpen) iframeContainer.style.display = 'none';
      }, 250);
      launcher.innerHTML = `
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      `;
    }
  });

  container.appendChild(launcher);
  document.body.appendChild(iframeContainer);
  document.body.appendChild(container);
})();
