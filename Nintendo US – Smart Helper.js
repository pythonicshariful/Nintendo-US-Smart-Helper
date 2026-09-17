// ==UserScript==
// @name         Nintendo US Smart Helper
// @namespace    https://www.nintendo.com/us
// @version      2.0.0
// @description  Smart assistant for Nintendo US: login detection, product tracker, quantity control, price monitor & wishlist alerts.
// @author       Nintendo Helper
// @match        https://www.nintendo.com/us
// @match        https://www.nintendo.com/us/
// @match        https://www.nintendo.com/us/*
// @match        https://accounts.nintendo.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @connect      www.nintendo.com
// @connect      algolia.net
// @connect      *.algolia.net
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // 
  //  CONSTANTS & CONFIG
  // 
  const SCRIPT_ID    = 'ntd-helper';
  const STORE_KEY    = 'ntd_settings';
  const HISTORY_KEY  = 'ntd_price_history';
  const WATCHLIST_KEY = 'ntd_watchlist';

  const defaultSettings = {
    autoQuantity   : 1,
    notifyLogin    : true,
    notifyPrice    : true,
    targetPrice    : '',
    panelOpen      : true,
    theme          : 'dark',
    autoCheckout   : false,
    savedPassword  : '',
    botRunning     : false,   // persistent start/stop state
    minDelay       : 30,      // minimum background check delay (seconds)
    maxDelay       : 60,      // maximum background check delay (seconds)
  };

  let settings = Object.assign({}, defaultSettings, GM_getValue(STORE_KEY, {}));
  function saveSettings() { GM_setValue(STORE_KEY, settings); }

  // Watchlist: array of { url, name, lastStatus }
  var watchlist = GM_getValue(WATCHLIST_KEY, []);
  function saveWatchlist() { GM_setValue(WATCHLIST_KEY, watchlist); }

  // 
  //  INJECT CSS
  // 
  function injectCSS(css) {
    var style = document.createElement('style');
    style.textContent = css;
    document.documentElement.insertAdjacentElement('beforeend', style);
  }
  
  injectCSS(`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');

    /*  Panel wrapper  */
    #${SCRIPT_ID}-root {
      all: initial;
      font-family: 'Inter', system-ui, sans-serif;
      position: fixed;
      bottom: 90px;
      right: 24px;
      z-index: 2147483647;
      width: 340px;
    }

    /*  Toggle FAB  */
    #${SCRIPT_ID}-fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: linear-gradient(135deg, #e60012 0%, #ff4d4d 100%);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 32px rgba(230,0,18,.45), 0 2px 8px rgba(0,0,0,.3);
      transition: transform .2s ease, box-shadow .2s ease;
    }
    #${SCRIPT_ID}-fab:hover {
      transform: scale(1.12);
      box-shadow: 0 12px 40px rgba(230,0,18,.6);
    }
    #${SCRIPT_ID}-fab svg { pointer-events: none; }

    /*  Main Panel  */
    .ntd-panel {
      background: linear-gradient(160deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%);
      border: 1px solid rgba(255,255,255,.10);
      border-radius: 20px;
      box-shadow: 0 24px 80px rgba(0,0,0,.7), 0 0 0 1px rgba(230,0,18,.15) inset;
      overflow: hidden;
      display: none;
      flex-direction: column;
      max-height: 85vh;
      animation: ntd-slide-up .3s cubic-bezier(.34,1.56,.64,1) forwards;
    }
    .ntd-panel.open { display: flex; }

    @keyframes ntd-slide-up {
      from { opacity: 0; transform: translateY(20px) scale(.96); }
      to   { opacity: 1; transform: translateY(0)   scale(1);    }
    }

    /*  Header  */
    .ntd-header {
      background: linear-gradient(135deg, #e60012 0%, #c0000f 100%);
      padding: 14px 18px;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }
    .ntd-header-icon { font-size: 22px; line-height: 1; }
    .ntd-header-title {
      flex: 1;
      font-size: 15px;
      font-weight: 800;
      color: #fff;
      letter-spacing: .3px;
    }
    .ntd-header-sub {
      font-size: 10px;
      font-weight: 500;
      color: rgba(255,255,255,.7);
      letter-spacing: .6px;
      text-transform: uppercase;
    }
    .ntd-close-btn {
      background: rgba(255,255,255,.15);
      border: none;
      border-radius: 8px;
      width: 28px; height: 28px;
      cursor: pointer;
      color: #fff;
      font-size: 16px;
      display: flex; align-items: center; justify-content: center;
      transition: background .15s;
    }
    .ntd-close-btn:hover { background: rgba(255,255,255,.3); }

    /*  Body / Tabs  */
    .ntd-body { overflow-y: auto; flex: 1; }
    .ntd-body::-webkit-scrollbar { width: 4px; }
    .ntd-body::-webkit-scrollbar-track { background: transparent; }
    .ntd-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 4px; }

    .ntd-tabs {
      display: flex;
      border-bottom: 1px solid rgba(255,255,255,.08);
      background: rgba(0,0,0,.2);
      flex-shrink: 0;
    }
    .ntd-tab {
      flex: 1;
      padding: 10px 4px;
      text-align: center;
      font-size: 11px;
      font-weight: 600;
      color: rgba(255,255,255,.45);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all .15s;
      letter-spacing: .4px;
      text-transform: uppercase;
      user-select: none;
    }
    .ntd-tab:hover  { color: rgba(255,255,255,.75); }
    .ntd-tab.active { color: #ff4d4d; border-bottom-color: #e60012; }

    /*  Sections  */
    .ntd-section { display: none; padding: 16px; }
    .ntd-section.active { display: block; }

    /*  Status Badge  */
    .ntd-status {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 14px;
      border-radius: 12px;
      margin-bottom: 12px;
    }
    .ntd-status.logged-out {
      background: rgba(230,0,18,.15);
      border: 1px solid rgba(230,0,18,.35);
    }
    .ntd-status.logged-in {
      background: rgba(16,185,129,.12);
      border: 1px solid rgba(16,185,129,.3);
    }
    .ntd-status-dot {
      width: 10px; height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .logged-out .ntd-status-dot { background: #e60012; box-shadow: 0 0 8px #e60012; animation: ntd-pulse 1.4s infinite; }
    .logged-in  .ntd-status-dot { background: #10b981; box-shadow: 0 0 8px #10b981; }

    @keyframes ntd-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: .5; transform: scale(.8); }
    }

    .ntd-status-text { flex: 1; }
    .ntd-status-title { font-size: 13px; font-weight: 700; color: #fff; }
    .ntd-status-desc  { font-size: 11px; color: rgba(255,255,255,.55); margin-top: 2px; }

    /*  Buttons  */
    .ntd-btn {
      display: block;
      width: 100%;
      padding: 11px;
      border-radius: 10px;
      border: none;
      cursor: pointer;
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 13px;
      font-weight: 700;
      text-align: center;
      transition: all .2s;
      margin-top: 8px;
    }
    .ntd-btn-primary {
      background: linear-gradient(135deg, #e60012 0%, #ff4d4d 100%);
      color: #fff;
      box-shadow: 0 4px 16px rgba(230,0,18,.35);
    }
    .ntd-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(230,0,18,.5); }
    .ntd-btn-secondary {
      background: rgba(255,255,255,.07);
      color: rgba(255,255,255,.8);
      border: 1px solid rgba(255,255,255,.12);
    }
    .ntd-btn-secondary:hover { background: rgba(255,255,255,.12); }
    .ntd-btn-success {
      background: linear-gradient(135deg, #059669 0%, #10b981 100%);
      color: #fff;
      box-shadow: 0 4px 16px rgba(16,185,129,.3);
    }
    .ntd-btn-success:hover { transform: translateY(-1px); }

    /*  Product Card  */
    .ntd-product-name {
      font-size: 15px;
      font-weight: 700;
      color: #fff;
      line-height: 1.35;
      margin-bottom: 12px;
    }
    .ntd-price-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 14px;
    }
    .ntd-price-label { font-size: 11px; color: rgba(255,255,255,.45); font-weight: 500; }
    .ntd-price-value {
      font-size: 26px;
      font-weight: 800;
      background: linear-gradient(135deg, #fff 30%, #e0e0e0 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    /*  Quantity Control  */
    .ntd-qty-label { font-size: 11px; font-weight: 600; color: rgba(255,255,255,.45); text-transform: uppercase; letter-spacing: .6px; margin-bottom: 8px; }
    .ntd-qty-row {
      display: flex;
      align-items: center;
      gap: 0;
      background: rgba(255,255,255,.05);
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 14px;
    }
    .ntd-qty-btn {
      width: 46px; height: 46px;
      border: none;
      background: transparent;
      color: #fff;
      font-size: 22px;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      transition: background .15s;
      user-select: none;
      font-family: 'Inter', system-ui, sans-serif;
    }
    .ntd-qty-btn:hover:not(:disabled) { background: rgba(255,255,255,.1); }
    .ntd-qty-btn:disabled { color: rgba(255,255,255,.2); cursor: default; }
    .ntd-qty-display {
      flex: 1;
      text-align: center;
      font-size: 20px;
      font-weight: 800;
      color: #fff;
      padding: 0 8px;
      min-width: 50px;
      font-family: 'Inter', system-ui, sans-serif;
    }

    /* Watchlist Buttons */
    .ntd-wl-rm {
      width: 24px; height: 24px;
      border: none; border-radius: 6px;
      background: rgba(239,68,68,0.2); color: #ef4444;
      font-size: 16px; font-weight: bold;
      cursor: pointer; display: flex;
      align-items: center; justify-content: center;
      transition: all 0.2s;
    }
    .ntd-wl-rm:hover { background: #ef4444; color: #fff; }
    .ntd-wl-rm::after { content: '×'; line-height: 1; }

    /*  Input  */
    .ntd-input-row { margin-bottom: 12px; }
    .ntd-input-label { font-size: 11px; font-weight: 600; color: rgba(255,255,255,.45); text-transform: uppercase; letter-spacing: .6px; margin-bottom: 6px; display: block; }
    .ntd-input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,.12);
      background: rgba(255,255,255,.06);
      color: #fff;
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 13px;
      outline: none;
      transition: border-color .15s;
    }
    .ntd-input::placeholder { color: rgba(255,255,255,.25); }
    .ntd-input:focus { border-color: rgba(230,0,18,.6); background: rgba(255,255,255,.09); }

    /*  Toggle Switch  */
    .ntd-toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid rgba(255,255,255,.06);
    }
    .ntd-toggle-row:last-child { border-bottom: none; }
    .ntd-toggle-label { font-size: 13px; color: rgba(255,255,255,.75); font-weight: 500; }
    .ntd-toggle-sub   { font-size: 11px; color: rgba(255,255,255,.35); margin-top: 2px; }
    .ntd-switch {
      position: relative;
      width: 40px; height: 22px;
      flex-shrink: 0;
    }
    .ntd-switch input { opacity: 0; width: 0; height: 0; }
    .ntd-slider {
      position: absolute; inset: 0;
      background: rgba(255,255,255,.15);
      border-radius: 22px;
      cursor: pointer;
      transition: background .2s;
    }
    .ntd-slider:before {
      content: '';
      position: absolute;
      width: 16px; height: 16px;
      left: 3px; top: 3px;
      background: #fff;
      border-radius: 50%;
      transition: transform .2s;
    }
    .ntd-switch input:checked + .ntd-slider { background: #e60012; }
    .ntd-switch input:checked + .ntd-slider:before { transform: translateX(18px); }

    /*  Page Badge  */
    .ntd-page-badge {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: .5px;
      text-transform: uppercase;
      margin-bottom: 14px;
    }
    .ntd-page-badge.product { background: rgba(230,0,18,.2); color: #ff7070; border: 1px solid rgba(230,0,18,.3); }
    .ntd-page-badge.store   { background: rgba(99,102,241,.2); color: #a5b4fc; border: 1px solid rgba(99,102,241,.3); }
    .ntd-page-badge.home    { background: rgba(16,185,129,.15); color: #6ee7b7; border: 1px solid rgba(16,185,129,.25); }
    .ntd-page-badge.other   { background: rgba(255,255,255,.08); color: rgba(255,255,255,.5); border: 1px solid rgba(255,255,255,.12); }

    /*  Divider  */
    .ntd-divider { height: 1px; background: rgba(255,255,255,.07); margin: 12px 0; }

    /*  Info row  */
    .ntd-info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;
    }
    .ntd-info-key   { font-size: 11px; color: rgba(255,255,255,.4); }
    .ntd-info-val   { font-size: 12px; color: rgba(255,255,255,.8); font-weight: 600; }

    /*  Toast  */
    .ntd-toast {
      position: fixed;
      bottom: 100px;
      right: 24px;
      z-index: 2147483647;
      padding: 12px 18px;
      border-radius: 12px;
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      box-shadow: 0 8px 32px rgba(0,0,0,.4);
      display: flex;
      align-items: center;
      gap: 8px;
      animation: ntd-toast-in .3s cubic-bezier(.34,1.56,.64,1) forwards;
      max-width: 300px;
    }
    .ntd-toast.success { background: linear-gradient(135deg, #059669, #10b981); }
    .ntd-toast.error   { background: linear-gradient(135deg, #dc2626, #ef4444); }
    .ntd-toast.info    { background: linear-gradient(135deg, #2563eb, #3b82f6); }
    .ntd-toast.warning { background: linear-gradient(135deg, #d97706, #f59e0b); }
    @keyframes ntd-toast-in {
      from { opacity: 0; transform: translateX(20px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    @keyframes ntd-toast-out {
      from { opacity: 1; transform: translateX(0); }
      to   { opacity: 0; transform: translateX(20px); }
    }

    /*  Price History mini log  */
    .ntd-price-history {
      background: rgba(0,0,0,.2);
      border-radius: 10px;
      padding: 10px 12px;
      margin-top: 8px;
    }
    .ntd-ph-title { font-size: 10px; font-weight: 700; color: rgba(255,255,255,.4); text-transform: uppercase; letter-spacing: .6px; margin-bottom: 8px; }
    .ntd-ph-entry {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: rgba(255,255,255,.5);
      padding: 3px 0;
    }
    .ntd-ph-entry .price { color: rgba(255,255,255,.85); font-weight: 600; }
    .ntd-ph-scroll { max-height: 80px; overflow-y: auto; }
    .ntd-ph-scroll::-webkit-scrollbar { width: 3px; }
    .ntd-ph-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 3px; }

    /*  Console  */
    .ntd-console {
      background: rgba(0,0,0,.3);
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 8px;
      padding: 10px;
      height: 250px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 11px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .ntd-console::-webkit-scrollbar { width: 4px; }
    .ntd-console::-webkit-scrollbar-thumb { background: rgba(255,255,255,.2); border-radius: 4px; }
    .ntd-console-entry { display: flex; gap: 8px; line-height: 1.4; }
    .ntd-console-time { color: rgba(255,255,255,.4); flex-shrink: 0; }
    .ntd-console-msg { flex: 1; word-wrap: break-word; }
    .ntd-console-entry.info .ntd-console-msg { color: #60a5fa; }
    .ntd-console-entry.success .ntd-console-msg { color: #34d399; }
    .ntd-console-entry.warning .ntd-console-msg { color: #fbbf24; }
    .ntd-console-entry.error .ntd-console-msg { color: #f87171; }

    /*  Start / Stop bar  */
    .ntd-bot-bar {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 18px;
      background: rgba(0,0,0,.25);
      border-bottom: 1px solid rgba(255,255,255,.07);
      flex-shrink: 0;
    }
    .ntd-bot-indicator {
      width: 8px; height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      transition: background .3s, box-shadow .3s;
    }
    .ntd-bot-indicator.running  { background: #10b981; box-shadow: 0 0 8px #10b981; animation: ntd-pulse 1.2s infinite; }
    .ntd-bot-indicator.stopped  { background: rgba(255,255,255,.25); box-shadow: none; }
    .ntd-bot-label { flex: 1; font-size: 11px; font-weight: 700; color: rgba(255,255,255,.6); text-transform: uppercase; letter-spacing: .5px; }
    .ntd-bot-label span { color: #fff; }
    .ntd-start-stop {
      padding: 5px 14px;
      border-radius: 20px;
      border: none;
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 11px;
      font-weight: 800;
      cursor: pointer;
      letter-spacing: .5px;
      text-transform: uppercase;
      transition: all .2s;
    }
    .ntd-start-stop.start { background: linear-gradient(135deg,#059669,#10b981); color:#fff; box-shadow:0 4px 14px rgba(16,185,129,.4); }
    .ntd-start-stop.start:hover { transform:scale(1.05); }
    .ntd-start-stop.stop  { background: linear-gradient(135deg,#dc2626,#ef4444); color:#fff; box-shadow:0 4px 14px rgba(220,38,38,.4); }
    .ntd-start-stop.stop:hover  { transform:scale(1.05); }
  `);

  // 
  //  UTILITIES
  // 
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }
  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  function showToast(msg, type, dur) {
    type = type || 'info';
    dur  = dur  || 3500;
    const icons = { success: '', error: '', info: '', warning: '' };
    const t = document.createElement('div');
    t.className = 'ntd-toast ' + type;
    t.innerHTML = '<span>' + (icons[type] || '') + '</span><span>' + msg + '</span>';
    document.documentElement.insertAdjacentElement('beforeend', t);
    setTimeout(function () {
      t.style.animation = 'ntd-toast-out .3s forwards';
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, dur);
  }

  function botLog(msg, type) {
    type = type || 'info';
    console.log('[Nintendo Helper Console] ' + msg);
    var consoleEl = document.getElementById(SCRIPT_ID + '-console-output');
    if (!consoleEl) return;
    
    var time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    var entry = document.createElement('div');
    entry.className = 'ntd-console-entry ' + type;
    entry.innerHTML = '<div class="ntd-console-time">[' + time + ']</div><div class="ntd-console-msg">' + msg + '</div>';
    
    consoleEl.insertAdjacentElement('beforeend', entry);
    // Auto-scroll to bottom
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  // 
  //  PAGE DETECTION
  // 
  var url = window.location.href;

  function detectPage() {
    if (url.includes('/us/store/products/') && url.split('?')[0].split('/').filter(Boolean).length > 4) return 'product';
    if (url.includes('/us/store/products')) return 'store';
    if (url.includes('/us/cart')) return 'cart';
    if (url.includes('/us/checkout')) return 'checkout';
    if (url.includes('/us/store')) return 'store';
    if (url.includes('accounts.nintendo.com/reauthenticate')) return 'reauth';
    if (url.endsWith('/us') || url.endsWith('/us/')) return 'home';
    return 'other';
  }

  var pageType = detectPage();
  var pageLabels = {
    product : { icon: '', label: 'Product Page' },
    store   : { icon: '', label: 'Store' },
    cart    : { icon: '', label: 'Cart' },
    checkout: { icon: '', label: 'Checkout' },
    home    : { icon: '', label: 'Homepage' },
    reauth  : { icon: '', label: 'Re-authenticate' },
    other   : { icon: '', label: 'Other Page' },
  };

  // 
  //  LOGIN DETECTION
  // 
  function isLoggedOut() {
    // Strategy 1: Nintendo's specific button classes (_9eU-h _76GDd)
    if (document.querySelector('button._9eU-h._76GDd')) return true;
    if (document.querySelector('button[class*="_9eU-h"]')) return true;

    // Strategy 2: Span with exact login text (React renders text inside spans)
    var spans = $$('span');
    for (var i = 0; i < spans.length; i++) {
      var st = (spans[i].textContent || '').trim();
      if (st === 'Log in / Sign up' || st === 'Log in') return true;
    }

    // Strategy 3: Any button whose full text contains "Log in"
    var allBtns = $$('button');
    for (var j = 0; j < allBtns.length; j++) {
      var bt = (allBtns[j].textContent || '').replace(new RegExp('\\s+', 'g'), ' ').trim();
      if (bt.includes('Log in') || bt.includes('Sign up')) return true;
    }

    // Strategy 4: UserIcon SVG data-testid inside a button (Nintendo's icon)
    var userIcon = document.querySelector('button svg[data-testid="UserIcon"]');
    if (userIcon) {
      // If the UserIcon button also contains login text, it's the logout button
      var parentBtn = userIcon.closest('button');
      if (parentBtn && (parentBtn.textContent || '').includes('Log in')) return true;
    }

    return false;
  }

  var loggedOut = false;

  // Update the live Status panel UI to reflect current login state
  function updateLoginUI(isOut) {
    var statusArea = document.getElementById(SCRIPT_ID + '-login-status-area');
    var loginStateVal = document.getElementById(SCRIPT_ID + '-login-state-val');
    if (statusArea) {
      statusArea.innerHTML = isOut
        ? '<div class="ntd-status logged-out">' +
            '<div class="ntd-status-dot"></div>' +
            '<div class="ntd-status-text">' +
              '<div class="ntd-status-title">Not Logged In</div>' +
              '<div class="ntd-status-desc">Sign in to access wishlist &amp; purchases</div>' +
            '</div>' +
          '</div>' +
          '<button class="ntd-btn ntd-btn-primary" id="' + SCRIPT_ID + '-goto-login"> Go to Login Page</button>'
        : '<div class="ntd-status logged-in">' +
            '<div class="ntd-status-dot"></div>' +
            '<div class="ntd-status-text">' +
              '<div class="ntd-status-title">Logged In </div>' +
              '<div class="ntd-status-desc">Your account is active</div>' +
            '</div>' +
          '</div>';
      // Re-wire login button if it was just injected
      var lb = document.getElementById(SCRIPT_ID + '-goto-login');
      if (lb) lb.addEventListener('click', function () { window.location.href = 'https://accounts.nintendo.com/login'; });
    }
    if (loginStateVal) {
      loginStateVal.textContent = isOut ? 'Logged Out' : 'Logged In';
      loginStateVal.style.color  = isOut ? '#ff7070' : '#6ee7b7';
    }
  }

  function checkLoginState() {
    var prev = loggedOut;
    loggedOut = isLoggedOut();
    if (prev !== loggedOut) updateLoginUI(loggedOut);
    return loggedOut;
  }

  // 
  //  PRODUCT DATA EXTRACTION
  // 
  function extractProductName() {
    var h1 = $('h1');
    return h1 ? h1.innerText.trim() : null;
  }

  function extractPrice() {
    var selectors = ['.W990N', '.QS4uJ', '.RDzZm', '[class*="price" i]'];
    var priceRegex = new RegExp('\\$[\\d,.]+');
    for (var i = 0; i < selectors.length; i++) {
      var el = $(selectors[i]);
      if (el) {
        var text = el.innerText || '';
        var match = text.match(priceRegex);
        if (match) return match[0];
      }
    }
    // Fallback scan
    var spans = $$('span');
    var fallbackRegex = new RegExp('^\\$\\d+\\.\\d{2}$');
    for (var j = 0; j < spans.length; j++) {
      var t = spans[j].innerText.trim();
      if (fallbackRegex.test(t)) return t;
    }
    return null;
  }

  function extractPriceRaw() {
    var p = extractPrice();
    if (!p) return null;
    return parseFloat(p.replace('$', '').replace(',', ''));
  }

  // 
  //  PRICE HISTORY
  // 
  function getHistoryKey(productName) {
    return HISTORY_KEY + '_' + btoa(encodeURIComponent(productName)).slice(0, 20);
  }

  function savePriceHistory(productName, price) {
    if (!productName || !price) return [];
    var key = getHistoryKey(productName);
    var history = GM_getValue(key, []);
    var last = history[history.length - 1];
    if (last && last.price === price) return history;
    history.push({
      price : price,
      date  : new Date().toLocaleDateString(),
      time  : new Date().toLocaleTimeString(),
    });
    if (history.length > 20) history = history.slice(-20);
    GM_setValue(key, history);
    return history;
  }

  function getPriceHistory(productName) {
    if (!productName) return [];
    return GM_getValue(getHistoryKey(productName), []);
  }

  function clearPriceHistory(productName) {
    if (!productName) return;
    GM_setValue(getHistoryKey(productName), []);
  }

  // 
  //  QUANTITY CONTROL (human-like)
  // 
  function getQtyButtons() {
    var addBtn = $('button[aria-label="Add item"], button[title="Add item"]');
    var subBtn = $('button[aria-label="Subtract item"], button[title="Subtract item"]');
    return { addBtn: addBtn, subBtn: subBtn };
  }

  function getCurrentQty() {
    var el = $('.qF1M-');
    return el ? (parseInt(el.innerText.trim(), 10) || 1) : 1;
  }

  function humanClick(btn) {
    return new Promise(function (resolve) {
      if (!btn || btn.disabled) { resolve(false); return; }
      ['mouseover', 'mousedown', 'click', 'mouseup'].forEach(function (ev) {
        btn.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true }));
      });
      setTimeout(function () { resolve(true); }, 80 + Math.random() * 120);
    });
  }

  async function setQuantity(target) {
    target = Math.max(1, Math.min(99, parseInt(target, 10)));
    var current = getCurrentQty();
    var buttons = getQtyButtons();

    if (target === current) { showToast('Quantity already at ' + target, 'info'); return; }

    var diff = target - current;
    if (diff > 0) {
      for (var i = 0; i < diff; i++) {
        var ok = await humanClick(buttons.addBtn);
        if (!ok) { showToast('Add button disabled', 'warning'); break; }
        await wait(200 + Math.random() * 150);
      }
    } else {
      for (var j = 0; j < Math.abs(diff); j++) {
        var ok2 = await humanClick(buttons.subBtn);
        if (!ok2) { showToast('Minimum quantity reached', 'warning'); break; }
        await wait(200 + Math.random() * 150);
      }
    }
    showToast('Quantity set to ' + getCurrentQty(), 'success');
    return getCurrentQty();
  }

  // 
  //  BUILD UI
  // 
  function updateQtyDisplay() {
    var el = document.getElementById(SCRIPT_ID + '-qty-display');
    if (el) el.textContent = getCurrentQty();
  }

  function buildPriceHistoryHTML(history) {
    if (!history || history.length === 0) return '';
    var rows = history.slice().reverse().map(function (h) {
      return '<div class="ntd-ph-entry"><span>' + h.date + ' ' + h.time + '</span><span class="price">' + h.price + '</span></div>';
    }).join('');
    return '<div class="ntd-price-history"><div class="ntd-ph-title"> Price History</div><div class="ntd-ph-scroll">' + rows + '</div></div>';
  }

  function buildUI() {
    var pg = pageLabels[pageType] || pageLabels.other;
    var loginStatus = checkLoginState();

    //  FAB 
    var fab = document.createElement('button');
    fab.id = SCRIPT_ID + '-fab';
    fab.title = 'Nintendo Helper';
    fab.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="26" fill="white"><path d="M25.5 4h-19A6.5 6.5 0 0 0 0 10.5v11A6.5 6.5 0 0 0 6.5 28h19A6.5 6.5 0 0 0 32 21.5v-11A6.5 6.5 0 0 0 25.5 4zM9 22a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm14-1.5h-2v-3h-3v-2h3v-3h2v3h3v2h-3v3z"/></svg>';

    //  Root 
    var root = document.createElement('div');
    root.id = SCRIPT_ID + '-root';

    //  Panel 
    var panel = document.createElement('div');
    panel.className = 'ntd-panel' + (settings.panelOpen ? ' open' : '');

    //  Header 
    var header = document.createElement('div');
    header.className = 'ntd-header';
    header.innerHTML =
      '<div class="ntd-header-icon"></div>' +
      '<div style="flex:1"><div class="ntd-header-title">Nintendo Helper</div><div class="ntd-header-sub">v2.0  Smart Assistant</div></div>' +
      '<button class="ntd-close-btn" id="' + SCRIPT_ID + '-close"></button>';

    //  Start / Stop Bot bar 
    var botBar = document.createElement('div');
    botBar.className = 'ntd-bot-bar';
    botBar.innerHTML =
      '<div class="ntd-bot-indicator ' + (settings.botRunning ? 'running' : 'stopped') + '" id="' + SCRIPT_ID + '-bot-dot"></div>' +
      '<div class="ntd-bot-label">Bot: <span id="' + SCRIPT_ID + '-bot-label">' + (settings.botRunning ? ' Running' : ' Stopped') + '</span></div>' +
      '<button class="ntd-start-stop ' + (settings.botRunning ? 'stop' : 'start') + '" id="' + SCRIPT_ID + '-startstop">' +
        (settings.botRunning ? ' Stop' : ' Start') +
      '</button>';

    //  Tabs 
    var tabsEl = document.createElement('div');
    tabsEl.className = 'ntd-tabs';
    var tabDefs = [
      { id: 'overview',  label: ' Status'   },
      { id: 'product',   label: ' Product'  },
      { id: 'watchlist', label: '[Watch]' },
      { id: 'settings',  label: '[Settings]' }
    ];
    tabDefs.forEach(function (t, i) {
      var el = document.createElement('div');
      el.className = 'ntd-tab' + (i === 0 ? ' active' : '');
      el.dataset.tab = t.id;
      el.textContent = t.label;
      tabsEl.insertAdjacentElement('beforeend', el);
    });

    //  Body 
    var body = document.createElement('div');
    body.className = 'ntd-body';

    //  OVERVIEW 
    var secOverview = document.createElement('div');
    secOverview.className = 'ntd-section active';
    secOverview.dataset.section = 'overview';

    var loginBlock = loginStatus
      ? '<div class="ntd-status logged-out">' +
          '<div class="ntd-status-dot"></div>' +
          '<div class="ntd-status-text">' +
            '<div class="ntd-status-title">Not Logged In</div>' +
            '<div class="ntd-status-desc">Sign in to access wishlist & purchases</div>' +
          '</div>' +
        '</div>' +
        '<button class="ntd-btn ntd-btn-primary" id="' + SCRIPT_ID + '-goto-login"> Go to Login Page</button>'
      : '<div class="ntd-status logged-in">' +
          '<div class="ntd-status-dot"></div>' +
          '<div class="ntd-status-text">' +
            '<div class="ntd-status-title">Logged In </div>' +
            '<div class="ntd-status-desc">Your account is active</div>' +
          '</div>' +
        '</div>';

    secOverview.innerHTML =
      '<div class="ntd-page-badge ' + pageType + '">' + pg.icon + ' ' + pg.label + '</div>' +
      '<div id="' + SCRIPT_ID + '-login-status-area">' + loginBlock + '</div>' +
      '<div class="ntd-divider"></div>' +
      '<div class="ntd-info-row"><span class="ntd-info-key"> Path</span><span class="ntd-info-val" style="font-size:10px;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + window.location.pathname + '</span></div>' +
      '<div class="ntd-info-row"><span class="ntd-info-key"> Loaded</span><span class="ntd-info-val">' + new Date().toLocaleTimeString() + '</span></div>' +
      '<div class="ntd-info-row"><span class="ntd-info-key"> Page Type</span><span class="ntd-info-val">' + pg.label + '</span></div>' +
      '<div class="ntd-info-row"><span class="ntd-info-key"> Login State</span><span class="ntd-info-val" id="' + SCRIPT_ID + '-login-state-val" style="color:' + (loggedOut ? '#ff7070' : '#6ee7b7') + '">' + (loggedOut ? 'Logged Out' : 'Logged In') + '</span></div>';

    //  PRODUCT 
    var secProduct = document.createElement('div');
    secProduct.className = 'ntd-section';
    secProduct.dataset.section = 'product';

    if (pageType === 'product') {
      var pName  = extractProductName() || 'Loading';
      var pPrice = extractPrice()       || 'N/A';
      var history = savePriceHistory(pName, pPrice);
      var histHTML = buildPriceHistoryHTML(history);

      secProduct.innerHTML =
        '<div class="ntd-product-name" id="' + SCRIPT_ID + '-pname">' + pName + '</div>' +
        '<div class="ntd-price-row">' +
          '<span class="ntd-price-label">Regular Price</span>' +
          '<span class="ntd-price-value" id="' + SCRIPT_ID + '-price">' + pPrice + '</span>' +
        '</div>' +
        histHTML +
        '<div class="ntd-divider"></div>' +
        '<div class="ntd-qty-label">Quantity Control</div>' +
        '<div class="ntd-qty-row">' +
          '<button class="ntd-qty-btn" id="' + SCRIPT_ID + '-dec" title="Decrease"></button>' +
          '<div class="ntd-qty-display" id="' + SCRIPT_ID + '-qty-display">' + getCurrentQty() + '</div>' +
          '<button class="ntd-qty-btn" id="' + SCRIPT_ID + '-inc" title="Increase">+</button>' +
        '</div>' +
        '<div class="ntd-input-row">' +
          '<label class="ntd-input-label">Set Exact Quantity</label>' +
          '<div style="display:flex;gap:8px;">' +
            '<input class="ntd-input" type="number" id="' + SCRIPT_ID + '-qty-input" min="1" max="99" placeholder="Enter qty" style="flex:1">' +
            '<button class="ntd-btn ntd-btn-primary" id="' + SCRIPT_ID + '-qty-set" style="width:auto;padding:10px 14px;margin:0;flex-shrink:0;">Set</button>' +
          '</div>' +
        '</div>' +
        '<div class="ntd-divider"></div>' +
        '<button class="ntd-btn ntd-btn-secondary" id="' + SCRIPT_ID + '-refresh-data"> Refresh Data</button>';
    } else {
      secProduct.innerHTML =
        '<div style="text-align:center;padding:30px 10px;">' +
          '<div style="font-size:40px;margin-bottom:12px;"></div>' +
          '<div style="font-size:14px;font-weight:700;color:rgba(255,255,255,.7);">Not on a Product Page</div>' +
          '<div style="font-size:12px;color:rgba(255,255,255,.35);margin-top:6px;">Navigate to a product to see details, price history & quantity controls.</div>' +
          '<a href="https://www.nintendo.com/us/store/games/" style="display:block;margin-top:16px;padding:10px;background:rgba(230,0,18,.15);border:1px solid rgba(230,0,18,.3);border-radius:10px;color:#ff7070;text-decoration:none;font-size:13px;font-weight:600;">Browse Nintendo Store </a>' +
        '</div>';
    }

    //  SETTINGS 
    var secSettings = document.createElement('div');
    secSettings.className = 'ntd-section';
    secSettings.dataset.section = 'settings';
    secSettings.innerHTML =
      '<div class="ntd-toggle-row">' +
        '<div><div class="ntd-toggle-label">Login Alerts</div><div class="ntd-toggle-sub">Warn when not logged in</div></div>' +
        '<label class="ntd-switch"><input type="checkbox" id="' + SCRIPT_ID + '-s-login"' + (settings.notifyLogin ? ' checked' : '') + '><span class="ntd-slider"></span></label>' +
      '</div>' +
      '<div class="ntd-toggle-row">' +
        '<div><div class="ntd-toggle-label">Price Alerts</div><div class="ntd-toggle-sub">Notify on price changes</div></div>' +
        '<label class="ntd-switch"><input type="checkbox" id="' + SCRIPT_ID + '-s-price"' + (settings.notifyPrice ? ' checked' : '') + '><span class="ntd-slider"></span></label>' +
      '</div>' +
      '<div class="ntd-toggle-row">' +
        '<div><div class="ntd-toggle-label"> Auto Checkout</div><div class="ntd-toggle-sub">Cart  Checkout  Auth automatically</div></div>' +
        '<label class="ntd-switch"><input type="checkbox" id="' + SCRIPT_ID + '-s-autocheckout"' + (settings.autoCheckout ? ' checked' : '') + '><span class="ntd-slider"></span></label>' +
      '</div>' +
      '<div class="ntd-divider"></div>' +
      '<div class="ntd-input-row"><label class="ntd-input-label"> Target Price Alert ($)</label>' +
        '<input class="ntd-input" type="number" id="' + SCRIPT_ID + '-s-target" placeholder="e.g. 29.99" value="' + settings.targetPrice + '" step="0.01" min="0">' +
      '</div>' +
      '<div class="ntd-input-row"><label class="ntd-input-label">Default Quantity</label>' +
        '<input class="ntd-input" type="number" id="' + SCRIPT_ID + '-s-qty" placeholder="Default: 1" value="' + settings.autoQuantity + '" min="1" max="99">' +
      '</div>' +
      '<div class="ntd-input-row"><label class="ntd-input-label"> Nintendo Password (for Auto Checkout)</label>' +
        '<input class="ntd-input" type="password" id="' + SCRIPT_ID + '-s-password" placeholder="Stored locally only" value="' + settings.savedPassword + '" autocomplete="off">' +
        '<div style="font-size:10px;color:rgba(255,255,255,.3);margin-top:4px;"> Password saved in Tampermonkey storage only</div>' +
      '</div>' +
      '<div class="ntd-input-row"><label class="ntd-input-label"> Watcher Min Delay (s)</label>' +
        '<input class="ntd-input" type="number" id="' + SCRIPT_ID + '-s-mindelay" placeholder="30" value="' + (settings.minDelay || 30) + '" min="10" max="3600">' +
      '</div>' +
      '<div class="ntd-input-row"><label class="ntd-input-label"> Watcher Max Delay (s)</label>' +
        '<input class="ntd-input" type="number" id="' + SCRIPT_ID + '-s-maxdelay" placeholder="60" value="' + (settings.maxDelay || 60) + '" min="10" max="3600">' +
        '<div style="font-size:10px;color:rgba(255,255,255,.3);margin-top:4px;">Bot will check at a random time between these values</div>' +
      '</div>' +
      '<div class="ntd-divider"></div>' +
      '<button class="ntd-btn ntd-btn-primary" id="' + SCRIPT_ID + '-save-settings"> Save Settings</button>' +
      '<button class="ntd-btn ntd-btn-secondary" id="' + SCRIPT_ID + '-clear-history" style="margin-top:8px"> Clear Price History</button>';

    //  WATCHLIST 
    var secWatchlist = document.createElement('div');
    secWatchlist.className = 'ntd-section';
    secWatchlist.dataset.section = 'watchlist';
    secWatchlist.innerHTML =
      '<div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.5);text-transform:uppercase;margin-bottom:10px">[Watch] Background Stock Watcher</div>' +
      '<div id="' + SCRIPT_ID + '-wl-list"></div>' +
      '<div class="ntd-divider"></div>' +
      '<div class="ntd-input-row">' +
        '<label class="ntd-input-label">[+] Add Product URL</label>' +
        '<input class="ntd-input" type="text" id="' + SCRIPT_ID + '-wl-url" placeholder="https://www.nintendo.com/us/store/products/">' +
      '</div>' +
      '<button class="ntd-btn ntd-btn-primary" id="' + SCRIPT_ID + '-wl-add">[Watch] Watch This Product</button>' +
      '<div style="font-size:10px;color:rgba(255,255,255,.3);margin-top:8px">[Info] Checks via Algolia API. Multiple products checked simultaneously. Only one tab does the work.</div>';

    //  CONSOLE (Permanent Bottom) 
    var secConsole = document.createElement('div');
    secConsole.className = 'ntd-console-container';
    secConsole.innerHTML =
      '<div style="font-size:11px;font-weight:700;color:rgba(255,255,255,.5);text-transform:uppercase;margin:8px 16px;">Live Bot Log</div>' +
      '<div class="ntd-console" id="' + SCRIPT_ID + '-console-output" style="border-radius:0; border:none; border-top:1px solid rgba(255,255,255,.1); max-height:100px;">' +
        '<div class="ntd-console-entry info"><div class="ntd-console-time">[' + new Date().toLocaleTimeString('en-US', {hour12:false}) + ']</div><div class="ntd-console-msg">System initialized.</div></div>' +
      '</div>';

    // Assemble DOM
    body.insertAdjacentElement('beforeend', secOverview);
    body.insertAdjacentElement('beforeend', secProduct);
    body.insertAdjacentElement('beforeend', secWatchlist);
    body.insertAdjacentElement('beforeend', secSettings);
    panel.insertAdjacentElement('beforeend', header);
    panel.insertAdjacentElement('beforeend', botBar);
    panel.insertAdjacentElement('beforeend', tabsEl);
    panel.insertAdjacentElement('beforeend', body);
    panel.insertAdjacentElement('beforeend', secConsole);
    root.insertAdjacentElement('beforeend', panel);
    document.documentElement.insertAdjacentElement('beforeend', root);
    document.documentElement.insertAdjacentElement('beforeend', fab);

    // 
    //  EVENTS
    // 

    // FAB toggle
    fab.addEventListener('click', function () {
      panel.classList.toggle('open');
      settings.panelOpen = panel.classList.contains('open');
      saveSettings();
    });

    // Close button
    var closeBtn = document.getElementById(SCRIPT_ID + '-close');
    if (closeBtn) closeBtn.addEventListener('click', function () {
      panel.classList.remove('open');
      settings.panelOpen = false;
      saveSettings();
    });

    //  Start / Stop button 
    function updateBotBar(running) {
      var dot   = document.getElementById(SCRIPT_ID + '-bot-dot');
      var lbl   = document.getElementById(SCRIPT_ID + '-bot-label');
      var btn   = document.getElementById(SCRIPT_ID + '-startstop');
      if (dot) { dot.className = 'ntd-bot-indicator ' + (running ? 'running' : 'stopped'); }
      if (lbl) { lbl.textContent = running ? ' Running' : ' Stopped'; }
      if (btn) {
        btn.textContent = running ? ' Stop' : ' Start';
        btn.className   = 'ntd-start-stop ' + (running ? 'stop' : 'start');
      }
    }
    var ssBtn = document.getElementById(SCRIPT_ID + '-startstop');
    if (ssBtn) ssBtn.addEventListener('click', function () {
      settings.botRunning = !settings.botRunning;
      saveSettings();
      updateBotBar(settings.botRunning);
      if (settings.botRunning) {
        showToast(' Bot started  Auto Checkout active', 'success', 3000);
        botLog(' Bot STARTED. Auto Checkout active.', 'success');
      } else {
        showToast(' Bot stopped', 'info', 2500);
        botLog(' Bot STOPPED.', 'error');
      }
    });

    // Tabs
    tabsEl.querySelectorAll('.ntd-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabsEl.querySelectorAll('.ntd-tab').forEach(function (t) { t.classList.remove('active'); });
        body.querySelectorAll('.ntd-section').forEach(function (s) { s.classList.remove('active'); });
        tab.classList.add('active');
        var sec = body.querySelector('.ntd-section[data-section="' + tab.dataset.tab + '"]');
        if (sec) sec.classList.add('active');
      });
    });

    // Go to login
    var loginBtn = document.getElementById(SCRIPT_ID + '-goto-login');
    if (loginBtn) loginBtn.addEventListener('click', function () {
      window.location.href = 'https://accounts.nintendo.com/login';
    });

    // Product controls
    if (pageType === 'product') {

      var decBtn = document.getElementById(SCRIPT_ID + '-dec');
      if (decBtn) decBtn.addEventListener('click', async function () {
        await humanClick(getQtyButtons().subBtn);
        updateQtyDisplay();
      });

      var incBtn = document.getElementById(SCRIPT_ID + '-inc');
      if (incBtn) incBtn.addEventListener('click', async function () {
        await humanClick(getQtyButtons().addBtn);
        updateQtyDisplay();
      });

      var qtySetBtn = document.getElementById(SCRIPT_ID + '-qty-set');
      if (qtySetBtn) qtySetBtn.addEventListener('click', async function () {
        var input = document.getElementById(SCRIPT_ID + '-qty-input');
        var val = parseInt(input ? input.value : '1', 10);
        if (!isNaN(val) && val >= 1) {
          await setQuantity(val);
          updateQtyDisplay();
        } else {
          showToast('Please enter a valid quantity (min 1)', 'error');
        }
      });

      //  GLOBAL Auto Checkout: Product Page 
      // If bot is running, auto-add to cart
      var _addCartPoll = setInterval(function () {
        if (!settings.botRunning) return;
        
        var cartBtn = $('button[data-testid="add-to-cart"]') ||
          $('button[aria-label*="cart" i]:not([id^="' + SCRIPT_ID + '"])') ||
          $('button[class*="addToCart" i]:not([id^="' + SCRIPT_ID + '"])') ||
          $$('button, a').find(function (b) { return (!b.id || !b.id.startsWith(SCRIPT_ID)) && new RegExp('add to cart|buy now|pre-order|pre-purchase', 'i').test(b.innerText || b.textContent); });
        
        if (cartBtn && !cartBtn.disabled) {
          clearInterval(_addCartPoll); // Stop polling once clicked
          botLog(' Auto-buy: Found Add to Cart button, clicking...', 'success');
          showToast('Auto-buying product...', 'info');
          humanClick(cartBtn);
        }
      }, 800);

      //  GLOBAL Auto Checkout Watcher 
      // Runs continuously on product pages, triggers if a product is added to cart
      var _cartConfirmed = false;
      var _cartObs = new MutationObserver(function () {
        if (_cartConfirmed || !settings.botRunning) return;

        // PRIMARY: detect the 'Added to cart' h2 heading Nintendo shows in the flyout
        var h2s = document.querySelectorAll('h2');
        for (var hi = 0; hi < h2s.length; hi++) {
          var ht = (h2s[hi].textContent || '').trim().toLowerCase();
          if (ht === 'added to cart' || ht.includes('added to cart')) {
            _cartConfirmed = true;
            _cartObs.disconnect(); // stop watching once triggered
            botLog(' "Added to cart" detected  navigating to cart', 'success');
            setTimeout(function () {
              showToast(' Navigating to cart', 'info');
              window.location.href = 'https://www.nintendo.com/us/cart/';
            }, 700 + Math.random() * 400);
            return;
          }
        }

        // FALLBACK: also watch for the .ZovBS 'View cart' text (belt & braces)
        var zvSpans = document.querySelectorAll('.ZovBS');
        for (var zi = 0; zi < zvSpans.length; zi++) {
          if ((zvSpans[zi].textContent || '').toLowerCase().includes('view cart')) {
            _cartConfirmed = true;
            _cartObs.disconnect();
            botLog(' View Cart link detected  navigating', 'success');
            setTimeout(function () {
              showToast(' Navigating to cart', 'info');
              window.location.href = 'https://www.nintendo.com/us/cart/';
            }, 700 + Math.random() * 400);
            return;
          }
        }
      });
      _cartObs.observe(document.body, { childList: true, subtree: true });

      var refreshBtn = document.getElementById(SCRIPT_ID + '-refresh-data');
      if (refreshBtn) refreshBtn.addEventListener('click', function () {
        var pNameEl  = document.getElementById(SCRIPT_ID + '-pname');
        var priceEl  = document.getElementById(SCRIPT_ID + '-price');
        if (pNameEl) pNameEl.textContent  = extractProductName() || 'N/A';
        if (priceEl) priceEl.textContent  = extractPrice()       || 'N/A';
        updateQtyDisplay();
        showToast('Data refreshed!', 'success');
      });
    }

    // Settings save
    var saveBtn = document.getElementById(SCRIPT_ID + '-save-settings');
    if (saveBtn) saveBtn.addEventListener('click', function () {
      settings.notifyLogin   = document.getElementById(SCRIPT_ID + '-s-login').checked;
      settings.notifyPrice   = document.getElementById(SCRIPT_ID + '-s-price').checked;
      settings.autoCheckout  = document.getElementById(SCRIPT_ID + '-s-autocheckout').checked;
      settings.targetPrice   = document.getElementById(SCRIPT_ID + '-s-target').value;
      settings.autoQuantity  = parseInt(document.getElementById(SCRIPT_ID + '-s-qty').value, 10) || 1;
      settings.savedPassword = document.getElementById(SCRIPT_ID + '-s-password').value;
      settings.minDelay      = parseInt(document.getElementById(SCRIPT_ID + '-s-mindelay').value, 10) || 30;
      settings.maxDelay      = parseInt(document.getElementById(SCRIPT_ID + '-s-maxdelay').value, 10) || 60;
      
      // Ensure min is not greater than max
      if (settings.minDelay > settings.maxDelay) {
        var temp = settings.minDelay;
        settings.minDelay = settings.maxDelay;
        settings.maxDelay = temp;
        document.getElementById(SCRIPT_ID + '-s-mindelay').value = settings.minDelay;
        document.getElementById(SCRIPT_ID + '-s-maxdelay').value = settings.maxDelay;
      }
      saveSettings();
      showToast('Settings saved! ', 'success');
    });

    // Clear history
    var clearBtn = document.getElementById(SCRIPT_ID + '-clear-history');
    if (clearBtn) clearBtn.addEventListener('click', function () {
      var pName = extractProductName();
      if (pName) {
        clearPriceHistory(pName);
        showToast('Price history cleared!', 'info');
      } else {
        showToast('No product detected on this page', 'warning');
      }
    });

    //  Watchlist Events 
    var wlAddBtn = document.getElementById(SCRIPT_ID + '-wl-add');
    if (wlAddBtn) {
      wlAddBtn.addEventListener('click', function () {
        var inputUrl = document.getElementById(SCRIPT_ID + '-wl-url').value.trim();
        if (!inputUrl) return showToast('Please enter a product URL', 'warning');
        if (!inputUrl.includes('nintendo.com/us/store/products/')) return showToast('Invalid Nintendo product URL', 'error');
        
        // Strip query params for clean URL
        var cleanUrl = inputUrl.split('?')[0];
        if (watchlist.find(function(w) { return w.url === cleanUrl; })) {
          return showToast('Product is already in watchlist!', 'info');
        }
        
        // Add to watchlist
        watchlist.push({ url: cleanUrl, name: 'Loading...', lastStatus: 'UNKNOWN' });
        saveWatchlist();
        document.getElementById(SCRIPT_ID + '-wl-url').value = '';
        showToast('Added to background watcher!', 'success');
        renderWatchlistUI();
        checkWatchlist(); // trigger immediate check
      });
    }

    // Initial render
    renderWatchlistUI();
  } // end buildUI

  // 
  //  ALGOLIA-POWERED BACKGROUND STOCK CHECKER ENGINE
  //
  // Discovered from Nintendo's own JS bundle:
  //   appId:  U3B6GR4UA3
  //   appKey: a29c6927638bfd8cee23993e51e721c9  (search-only, public key)
  //   index:  store_hardware_en_us  (returns stockStatus, isSalableQty, availability, url, sku, price)
  //
  var NTD_ALGOLIA_APP    = 'U3B6GR4UA3';
  var NTD_ALGOLIA_KEY    = 'a29c6927638bfd8cee23993e51e721c9';
  var NTD_ALGOLIA_HW_IDX = 'store_hardware_en_us';
  var NTD_ALGOLIA_GM_IDX = 'ncom_game_en_us';

  // BroadcastChannel: ensures only ONE tab does the checking
  var ntdChannel = null;
  var ntdIsLeader = false;
  var ntdLeaderKey = 'ntd_leader_ts';

  function claimLeadership() {
    // Write timestamp to localStorage — the tab with the MOST RECENT timestamp wins
    try {
      localStorage.setItem(ntdLeaderKey, String(Date.now()));
      ntdIsLeader = true;
    } catch(e) { ntdIsLeader = true; } // If localStorage is blocked, always lead
  }

  function isLeader() {
    // Leader = the tab that last set the leader timestamp (most recently active)
    try {
      var ts = parseInt(localStorage.getItem(ntdLeaderKey), 10);
      var myTs = parseInt(localStorage.getItem(ntdLeaderKey + '_me'), 10);
      return !isNaN(myTs) && myTs >= ts;
    } catch(e) { return true; }
  }

  function setupLeadership() {
    try {
      var myTs = Date.now();
      localStorage.setItem(ntdLeaderKey + '_me', String(myTs));
      localStorage.setItem(ntdLeaderKey, String(myTs));
      ntdIsLeader = true;
      // Re-assert leadership every 10 seconds while bot is running
      setInterval(function() {
        if (!settings.botRunning) return;
        var myT = parseInt(localStorage.getItem(ntdLeaderKey + '_me'), 10);
        var curT = parseInt(localStorage.getItem(ntdLeaderKey), 10);
        if (isNaN(curT) || myT >= curT) {
          localStorage.setItem(ntdLeaderKey, String(myT));
          ntdIsLeader = true;
        } else {
          // Another tab is leader
          ntdIsLeader = false;
        }
      }, 10000);
    } catch(e) { ntdIsLeader = true; }
  }

  // buildWatchlistHTML at MODULE LEVEL so renderWatchlistUI (also module-level) can call it.
  // Only uses watchlist[] and SCRIPT_ID — both module-level — so this is safe.
  function buildWatchlistHTML() {
    if (watchlist.length === 0) {
      return '<div style="text-align:center;color:rgba(255,255,255,.35);padding:20px 0;font-size:12px">[Watch] No products being watched.<br>Paste a Nintendo product URL below.</div>';
    }
    return watchlist.map(function (item, idx) {
      var statusColor = item.lastStatus === 'IN_STOCK' ? '#6ee7b7' : item.lastStatus === 'OUT_OF_STOCK' ? '#ff7070' : '#aaa';
      var statusText  = item.lastStatus === 'IN_STOCK' ? '[IN STOCK]' : item.lastStatus === 'OUT_OF_STOCK' ? '[SOLD OUT]' : '[Checking...]';
      var checkedStr  = item.lastChecked ? 'Last checked: ' + new Date(item.lastChecked).toLocaleTimeString('en-US', {hour12:false}) : 'Not yet checked';
      return '<div class="ntd-wl-row">' +
        '<div class="ntd-wl-info">' +
          '<div class="ntd-wl-name">' + (item.name || 'Product #' + (idx+1)) + '</div>' +
          '<div class="ntd-wl-status" style="color:' + statusColor + '">' + statusText + '</div>' +
          '<div style="font-size:9px;color:rgba(255,255,255,.25);margin-top:2px">' + checkedStr + '</div>' +
        '</div>' +
        '<button class="ntd-wl-rm" data-idx="' + idx + '" title="Remove"></button>' +
      '</div>';
    }).join('');
  }

  function renderWatchlistUI() {
    var container = document.getElementById(SCRIPT_ID + '-wl-list');
    if (!container) return;
    container.innerHTML = buildWatchlistHTML();
    var rmBtns = document.querySelectorAll('.ntd-wl-rm');
    for (var k = 0; k < rmBtns.length; k++) {
      rmBtns[k].addEventListener('click', function(e) {
        var idx = parseInt(e.target.dataset.idx, 10);
        watchlist.splice(idx, 1);
        saveWatchlist();
        renderWatchlistUI();
      });
    }
  }

  // Query Algolia for a batch of products by their URL slugs
  // Returns a map of { urlKey -> { stockStatus, name, url, isSalableQty, availability, price } }
  function algoliaCheckBatch(items, indexName, callback) {
    if (items.length === 0) return callback({});

    // Build one multi-query request to check all items simultaneously
    var requests = items.map(function(item) {
      // Extract the URL key (last path segment minus trailing slash)
      var urlKey = item.url.replace(new RegExp('/$'), '').split('/').pop();
      // Note: no restrictSearchableAttributes - allows partial slug matches across all text fields
      return {
        indexName: indexName,
        params: 'query=' + encodeURIComponent(urlKey) +
                '&hitsPerPage=5' +
                '&attributesToRetrieve=title,stockStatus,isSalableQty,availability,url,sku,price,name'
      };
    });

    GM_xmlhttpRequest({
      method: 'POST',
      url: 'https://' + NTD_ALGOLIA_APP + '-dsn.algolia.net/1/indexes/*/queries',
      headers: {
        'Content-Type': 'application/json',
        'X-Algolia-Application-Id': NTD_ALGOLIA_APP,
        'X-Algolia-API-Key': NTD_ALGOLIA_KEY
      },
      data: JSON.stringify({ requests: requests }),
      onload: function(resp) {
        if (resp.status !== 200) { callback({}); return; }
        try {
          var json = JSON.parse(resp.responseText);
          var resultMap = {};
          json.results.forEach(function(r, i) {
            var item = items[i];
            if (!r.hits || r.hits.length === 0) return;
            // Find the hit whose URL best matches our item URL
            var bestHit = null;
            var itemSlug = item.url.replace(new RegExp('/$'), '').split('/').pop().toLowerCase();
            r.hits.forEach(function(h) {
              var hSlug = (h.url || '').replace(new RegExp('/$'), '').split('/').pop().toLowerCase();
              if (hSlug === itemSlug) bestHit = h;
            });
            if (!bestHit) bestHit = r.hits[0]; // fallback: top hit
            resultMap[item.url] = bestHit;
          });
          callback(resultMap);
        } catch(e) {
          botLog('[API] Parse error: ' + e.message, 'error');
          callback({});
        }
      },
      onerror: function() { callback({}); }
    });
  }

  // Fallback: HTML scrape for products not found via Algolia
  // Also used to extract the product name from the page title.
  var NTD_JUNK_TITLES = [
    'Nintendo Official Site', 'Whoops!', 'Loading...', 'Loading',
    'Nintendo', '', 'undefined', 'null', 'Nintendo - Official Site'
  ];

  // Parse a human-readable name from a URL slug as a last resort
  // e.g. "nintendo-switch-2-pro-controller-123674" -> "Nintendo Switch 2 Pro Controller"
  function slugToName(url) {
    var slug = url.replace(new RegExp('/$'), '').split('/').pop();
    // Remove trailing SKU (pure number at the end, after last hyphen)
    slug = slug.replace(new RegExp('-\\d+$'), '');
    // Title-case each word
    return slug.split('-').map(function(w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  function htmlCheckItem(item, retries, onDone) {
    retries = retries || 0;
    GM_xmlhttpRequest({
      method: 'GET',
      url: item.url,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' },
      onload: function(response) {
        if (response.status === 429) {
          if (retries < 3) {
            var backoff = Math.pow(2, retries) * 5000 + Math.random() * 2000;
            botLog('[Watch] Rate limited on ' + (item.name || item.url) + '. Retrying in ' + Math.round(backoff/1000) + 's...', 'warning');
            setTimeout(function() { htmlCheckItem(item, retries + 1, onDone); }, backoff);
          } else {
            botLog('[Watch] Rate limit exhausted for ' + (item.name || item.url), 'error');
            onDone(null);
          }
          return;
        }
        if (response.status !== 200) { onDone(null); return; }
        var html = response.responseText;

        // Try to extract product name from <title> tag
        if (!item.name || NTD_JUNK_TITLES.indexOf(item.name) !== -1) {
          var titleRe = new RegExp('<title>([^<]+)<\/title>', 'i');
          var titleMatch = html.match(titleRe);
          if (titleMatch) {
            var rawTitle = titleMatch[1].split(' - ')[0].split(' | ')[0].trim();
            if (rawTitle && NTD_JUNK_TITLES.indexOf(rawTitle) === -1 && rawTitle.length > 3) {
              item.name = rawTitle;
            }
          }
          // If title is still junk, parse the name from the URL slug
          if (!item.name || NTD_JUNK_TITLES.indexOf(item.name) !== -1) {
            item.name = slugToName(item.url);
          }
        }

        // Determine stock from HTML keywords
        var currentStatus = null;
        var inStockRe = new RegExp('Add to cart|Pre-order|Pre-purchase', 'i');
        if (inStockRe.test(html) || html.includes('aria-label="Add to cart"')) {
          currentStatus = 'IN_STOCK';
        } else if (html.includes('Sold out') || html.includes('out of stock') ||
                   html.includes('temporarily unavailable') || html.includes('isSalableQty":false')) {
          currentStatus = 'OUT_OF_STOCK';
        }
        onDone(currentStatus);
      },
      onerror: function() {
        if (retries < 2) {
          setTimeout(function() { htmlCheckItem(item, retries + 1, onDone); }, 4000);
        } else {
          onDone(null);
        }
      }
    });
  }

  // Purchase queue: ensures multiple simultaneous in-stock events don't conflict
  var ntdPurchaseQueue = [];
  var ntdPurchaseBusy  = false;

  function drainPurchaseQueue() {
    if (ntdPurchaseBusy || ntdPurchaseQueue.length === 0) return;
    ntdPurchaseBusy = true;
    var item = ntdPurchaseQueue.shift();
    botLog('[BUY] Starting purchase for: ' + (item.name || item.url), 'success');
    initiatePurchase(item, function() {
      ntdPurchaseBusy = false;
      // Wait a beat then process any remaining queued items
      if (ntdPurchaseQueue.length > 0) {
        setTimeout(drainPurchaseQueue, 4000);
      }
    });
  }

  // Trigger the purchase flow for one specific product.
  // If we are already ON that product page, click Add to Cart directly.
  // Otherwise open the product URL in the CURRENT tab (SPA navigate) and poll for the button.
  // The watchlist check cycle is NOT paused — it continues in the background.
  function initiatePurchase(item, onDone) {
    onDone = onDone || function() {};

    if (!settings.autoCheckout || !settings.botRunning) {
      // Auto-checkout is off — just alert, don't touch the tab
      botLog('[BUY] Auto Checkout is off. Please buy manually: ' + item.url, 'warning');
      onDone();
      return;
    }

    var productUrl = item.url;
    var currentPage = window.location.href;

    // Helper: click Add to Cart button on the current product page
    function clickAddToCart(done) {
      var maxAttempts = 30; // ~15 seconds
      var attempts = 0;
      var poll = setInterval(function() {
        attempts++;
        // Nintendo's Add to Cart button selectors (multiple fallbacks)
        var btn = document.querySelector('button[aria-label="Add to cart"]') ||
                  document.querySelector('button[data-testid="add-to-cart-button"]') ||
                  document.querySelector('[class*="AddToCartButton"]') ||
                  document.querySelector('[class*="add-to-cart"]') ||
                  (function() {
                    var els = document.querySelectorAll('button, a');
                    for (var i = 0; i < els.length; i++) {
                      var txt = (els[i].textContent || '').trim().toLowerCase();
                      if (txt === 'add to cart' || txt === 'buy now' || txt === 'pre-order' || txt === 'pre-purchase') return els[i];
                    }
                    return null;
                  })();

        if (btn && !btn.disabled) {
          clearInterval(poll);
          botLog('[BUY] Add to Cart button found for ' + (item.name || 'product') + '. Clicking...', 'success');
          // Human-like: small random delay before click
          setTimeout(function() {
            ['mouseover', 'mousedown', 'click', 'mouseup'].forEach(function(ev) {
              btn.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true }));
            });
            botLog('[BUY] Add to Cart clicked. Waiting for cart redirect...', 'success');
            done(true);
          }, 300 + Math.random() * 400);
        } else if (attempts === 3 && !item._hasReloaded) {
          // 1.5s passed, button not found. Force reload to bust cache!
          clearInterval(poll);
          item._hasReloaded = true;
          botLog('[BUY] Button not found after 1.5s. Force reloading page to clear cache...', 'warning');
          GM_setValue('ntd_force_buy', item.url);
          window.location.reload(true);
        } else if (attempts >= maxAttempts) {
          clearInterval(poll);
          botLog('[BUY] Add to Cart button not found within timeout for: ' + (item.name || item.url), 'warning');
          showToast('Could not find Add to Cart for ' + (item.name || 'product') + '. Please buy manually!', 'warning', 10000);
          done(false);
        }
      }, 500);
    }

    // Are we already on this product page?
    if (currentPage.includes(productUrl.replace('https://www.nintendo.com', ''))) {
      botLog('[BUY] Already on product page. Clicking Add to Cart...', 'success');
      clickAddToCart(function(success) {
        onDone();
      });
    } else {
      // Navigate to the product page via SPA (keeps the tab leader, preserves the bot)
      botLog('[BUY] Navigating to product page: ' + productUrl, 'info');
      showToast('Going to: ' + (item.name || 'product'), 'info', 4000);

      // Use history.pushState / location.assign to navigate within the Nintendo SPA
      try {
        window.location.assign(productUrl);
      } catch(e) {
        window.location.href = productUrl;
      }

      // Wait for the page to load the product (the SPA URL watcher will pick it up)
      // Poll for the Add to Cart button after a brief load delay
      setTimeout(function() {
        clickAddToCart(function(success) {
          onDone();
        });
      }, 2500); // give the SPA 2.5s to render the product
    }
  }

  function processStockResult(item, currentStatus, isApi) {
    item.lastChecked = Date.now();
    if (!currentStatus) return; // unknown, skip

    var method = isApi ? '[API]' : '[HTML]';
    var stockLabel = currentStatus === 'IN_STOCK' ? 'IN STOCK' : 'OUT OF STOCK';
    botLog(method + ' ' + (item.name || 'Product') + ': ' + stockLabel, currentStatus === 'IN_STOCK' ? 'success' : 'info');

    if (item.lastStatus !== currentStatus) {
      var prevStatus = item.lastStatus;
      item.lastStatus = currentStatus;
      saveWatchlist();
      renderWatchlistUI();

      if (currentStatus === 'IN_STOCK') {
        botLog('[ALERT] ' + (item.name || 'Product') + ' IS NOW IN STOCK! Queuing purchase...', 'success');
        showToast((item.name || 'Product') + ' IN STOCK!', 'success', 15000);
        try {
          GM_notification({
            title: 'Nintendo Stock Alert',
            text: (item.name || 'product') + ' is IN STOCK! Bot is buying now.',
            image: 'https://www.nintendo.com/favicon.ico',
            onclick: function() { window.open(item.url, '_blank'); }
          });
        } catch(e) {}

        // Guard: don't re-queue if this item is already mid-purchase
        if (!item.buyingInProgress) {
          item.buyingInProgress = true;
          // Add to purchase queue — does NOT block the watchlist check cycle
          ntdPurchaseQueue.push(item);
          drainPurchaseQueue();
        }
        // NOTE: The watchlist check cycle continues running for ALL other products.
        // Only the SPA navigation (when autoCheckout is on) changes the current page —
        // but the scheduleNextCheck timer keeps firing, and Algolia checks keep happening.

      } else if (prevStatus === 'IN_STOCK' && currentStatus === 'OUT_OF_STOCK') {
        item.buyingInProgress = false; // reset flag if it sold out again
        botLog('[Watch] ' + (item.name || 'Product') + ' went out of stock.', 'warning');
      }
    } else {
      // No change — just refresh the last-checked timestamp in the UI
      renderWatchlistUI();
    }
  }

  function checkWatchlist() {
    if (!settings.botRunning) return; // Silent return if stopped

    if (watchlist.length === 0) {
      botLog('[Watch] Watchlist is empty. Add product URLs in the Watch tab.', 'info');
      return;
    }

    // Tab dedup: only the leader tab checks
    if (!ntdIsLeader) {
      botLog('[Watch] Another tab is the active checker. Standby mode.', 'info');
      return;
    }

    botLog('[Watch] Checking stock for ' + watchlist.length + ' product(s) via Algolia API...', 'info');

    // Tier 1: Hardware Algolia index
    algoliaCheckBatch(watchlist, NTD_ALGOLIA_HW_IDX, function(hwMap) {
      // Tier 2: Games Algolia index (for items not found in hardware)
      var notInHw = watchlist.filter(function(item) { return !hwMap[item.url]; });
      algoliaCheckBatch(notInHw, NTD_ALGOLIA_GM_IDX, function(gmMap) {
        // Tier 3: All-products index (catches merch, accessories, edge cases)
        var notInGm = notInHw.filter(function(item) { return !gmMap[item.url]; });
        algoliaCheckBatch(notInGm, 'store_all_products_en_us', function(allMap) {
          watchlist.forEach(function(item) {
            var hit = hwMap[item.url] || gmMap[item.url] || allMap[item.url];

            if (hit) {
              // Got data from Algolia — update name if missing
              if (hit.title && (!item.name || NTD_JUNK_TITLES.indexOf(item.name) !== -1)) {
                item.name = hit.title;
              }
              var stockStatus = hit.stockStatus || (hit.isSalableQty ? 'IN_STOCK' : 'OUT_OF_STOCK');
              // Override: coming soon / pre-order = not purchasable yet
              if (hit.availability && Array.isArray(hit.availability)) {
                if (hit.availability.some(function(a) {
                  return a.toLowerCase().includes('coming soon') || a.toLowerCase().includes('pre-order');
                })) { stockStatus = 'OUT_OF_STOCK'; }
              }
              processStockResult(item, stockStatus, true);
            } else {
              // Tier 4: HTML scrape fallback (also resolves name from URL slug)
              if (!item.name || NTD_JUNK_TITLES.indexOf(item.name) !== -1) {
                item.name = slugToName(item.url); // set tentative slug-based name while loading
                renderWatchlistUI();
              }
              botLog('[Watch] ' + item.name + ' not in Algolia — falling back to HTML check...', 'warning');
              htmlCheckItem(item, 0, function(currentStatus) {
                processStockResult(item, currentStatus, false);
              });
            }
          });
        });
      });
    });
  }

  // 
  //  TARGET PRICE CHECK
  // 
  function checkTargetPrice() {
    if (!settings.notifyPrice || !settings.targetPrice || pageType !== 'product') return;
    var current = extractPriceRaw();
    var target  = parseFloat(settings.targetPrice);
    if (!isNaN(current) && !isNaN(target) && current <= target) {
      showToast(' Price target hit! $' + current.toFixed(2) + '  $' + target.toFixed(2), 'success', 7000);
      console.log('%c[Nintendo Helper]  Price target hit! $' + current.toFixed(2) + '  $' + target.toFixed(2), 'color:#10b981;font-weight:bold');
      try {
        GM_notification({
          title : 'Nintendo Price Alert ',
          text  : 'Price dropped to $' + current.toFixed(2) + '! (Target: $' + target.toFixed(2) + ')',
          image : 'https://www.nintendo.com/favicon.ico',
        });
      } catch(e) {}
    }
  }

  // 
  //  AUTO-CHECKOUT: CHECKOUT PAGE HANDLER
  // 
  function handleCheckoutPage() {
    if (!settings.botRunning) return;

    var attempt = 0;
    var poll = setInterval(function () {
      attempt++;
      var btn = document.getElementById('CheckoutShipping_AddressRegistered_NextButton') ||
                document.querySelector('button[aria-label="Continue to shipping"]') ||
                document.querySelector('.checkoutAddressRegistered--buttonConfirm') ||
                document.querySelector('button[aria-label="Continue to payment"]') ||
                document.querySelector('.checkoutSelectShippingMethod--confirm__button') ||
                document.getElementById('CheckoutPaymentSelection_ReviewButton') ||
                document.querySelector('button[aria-label="Continue to review"]') ||
                document.getElementById('CheckoutConfirmation_Confirm_PlaceOrderButton') ||
                document.querySelector('button[aria-label="Purchase"]');
      if (btn) {
        clearInterval(poll);
        botLog(' Checkout step button found. Clicking...', 'success');
        setTimeout(function () {
          humanClick(btn);
          botLog(' Proceeding to next checkout step...', 'info');
        }, 800 + Math.random() * 400);
      } else if (attempt > 20) {
        clearInterval(poll);
        botLog(' Checkout step button not found.', 'warning');
      }
    }, 500);
  }

  // 
  //  AUTO-CHECKOUT: CART PAGE HANDLER
  // 
  function handleCartPage() {
    if (!settings.botRunning) return;
    botLog(' Cart page detected  waiting for checkout button', 'info');
    showToast(' Auto Checkout: finding checkout button', 'info', 2500);
    var attempts = 0;
    var poll = setInterval(function () {
      attempts++;
      // Target the exact button: aria-label="Proceed to secure checkout"
      var checkoutBtn = $('button[aria-label="Proceed to secure checkout"]') ||
        $$('button').find(function (b) {
          return (b.textContent || '').toLowerCase().includes('secure checkout') ||
                 (b.textContent || '').toLowerCase().includes('to secure checkout');
        });
      if (checkoutBtn && !checkoutBtn.disabled) {
        clearInterval(poll);
        setTimeout(function () {
          showToast(' Proceeding to secure checkout', 'info');
          botLog(' Clicking checkout button', 'success');
          ['mouseover', 'mousedown', 'click', 'mouseup'].forEach(function (ev) {
            checkoutBtn.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true }));
          });
        }, 800 + Math.random() * 500);
      } else if (attempts > 40) { // ~20s timeout
        clearInterval(poll);
        showToast('Checkout button not found. Please proceed manually.', 'warning', 6000);
      }
    }, 500);
  }

  // 
  //  AUTO-CHECKOUT: REAUTHENTICATION PAGE HANDLER
  // 
  function handleReauth() {
    var pwd = settings.savedPassword;
    botLog(' Reauthentication page detected', 'info');

    if (!settings.botRunning || !pwd) {
      botLog(' Auto Checkout off or no password saved. Please fill in manually.', 'warning');
      // Inject a small helper toast even on accounts.nintendo.com
      setTimeout(function () {
        var t = document.createElement('div');
        t.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;background:linear-gradient(135deg,#d97706,#f59e0b);color:#fff;padding:12px 18px;border-radius:12px;font-family:sans-serif;font-size:13px;font-weight:600;box-shadow:0 8px 32px rgba(0,0,0,.4);';
        t.textContent = ' Nintendo Helper: Enable Auto Checkout and save your password to proceed automatically.';
        document.body.insertAdjacentElement('beforeend', t);
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 8000);
      }, 500);
      return;
    }

    // Wait for the password field to appear
    var attempts = 0;
    var poll = setInterval(function () {
      attempts++;
      var pwdInput = document.getElementById('reauthenticate-form_pc_input_0') ||
        $('input[type="password"][name="subject_password"]') ||
        $('input[type="password"]');

      if (pwdInput) {
        clearInterval(poll);
        setTimeout(function () {
          // Fill the password field character by character like a human
          pwdInput.focus();
          
          var nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          var i = 0;
          
          function typeChar() {
            if (i < pwd.length) {
              if (nativeSetter) {
                nativeSetter.call(pwdInput, pwd.substring(0, i + 1));
              } else {
                pwdInput.value = pwd.substring(0, i + 1);
              }
              
              ['input', 'change', 'keyup'].forEach(function (ev) {
                pwdInput.dispatchEvent(new Event(ev, { bubbles: true }));
              });
              
              i++;
              setTimeout(typeChar, 30 + Math.random() * 70); // 30-100ms per char
            } else {
              botLog(' Password filled in automatically', 'success');

              // Click the OK button after a human-like delay
              setTimeout(function () {
                var okBtn = document.getElementById('reauthenticate-form_pc_button_0') ||
                  $('button[aria-label="OK"]') ||
                  $('button[type="submit"]');
                if (okBtn) {
                  ['mouseover', 'mousedown', 'click', 'mouseup'].forEach(function (ev) {
                    okBtn.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true }));
                  });
                  botLog(' Submitted reauthentication', 'success');
                } else {
                  botLog(' OK button not found on reauth page', 'warning');
                }
              }, 600 + Math.random() * 400);
            }
          }
          
          typeChar();

        }, 500 + Math.random() * 300);

      } else if (attempts > 20) { // 10s timeout
        clearInterval(poll);
        botLog(' Password input not found on reauth page', 'error');
      }
    }, 500);
  }

  // 
  //  INIT
  // 
  function init() {
    //  Handle Nintendo reauthentication page (different domain) 
    if (window.location.hostname === 'accounts.nintendo.com' &&
        window.location.pathname.indexOf('reauthenticate') !== -1) {
      handleReauth();
      return;
    }

    // Check if we just forced a reload to buy an item
    var forceBuyUrl = GM_getValue('ntd_force_buy', null);
    if (forceBuyUrl) {
      GM_setValue('ntd_force_buy', null);
      botLog('[BUY] Recovered from cache-busting reload. Resuming purchase...', 'info');
      var recoveredItem = watchlist.find(function(i) { return i.url === forceBuyUrl; });
      if (recoveredItem) {
        recoveredItem._hasReloaded = true; // prevent infinite reload loop
        recoveredItem.buyingInProgress = true;
        ntdPurchaseQueue.push(recoveredItem);
        setTimeout(drainPurchaseQueue, 1500); // give page a moment to render
      }
    }

    // Avoid double-init
    if (document.getElementById(SCRIPT_ID + '-fab')) return;

    buildUI();

    //  Auto Checkout: cart & checkout pages 
    if (pageType === 'cart') { handleCartPage(); }
    if (pageType === 'checkout') { handleCheckoutPage(); }

    console.log('%c Nintendo Helper v2.0 loaded | Page: ' + pageType, 'color:#e60012;font-weight:bold;font-size:14px;background:#fff1f2;padding:4px 8px;border-radius:4px');

    if (settings.notifyLogin && loggedOut) {
      setTimeout(function () { showToast(' Please log in to your Nintendo account!', 'warning', 6000); }, 1000);
    }

    if (pageType === 'product') {
      setTimeout(function () {
        checkTargetPrice();
        setInterval(updateQtyDisplay, 2500);
      }, 1500);
    }

    //  MutationObserver: watch for React rendering the login button 
    // Nintendo's site is a SPA  the header renders AFTER our script runs.
    // We observe the whole body for the login button appearing/disappearing.
    var _loginTimer = null;
    var loginObserver = new MutationObserver(function () {
      var nowOut = isLoggedOut();
      if (nowOut !== loggedOut) {
        if (nowOut === true) {
          if (!_loginTimer) {
            _loginTimer = setTimeout(function() {
              _loginTimer = null;
              if (isLoggedOut()) {
                loggedOut = true;
                updateLoginUI(true);
                botLog(' Login button detected  user is NOT logged in!', 'error');
                if (settings.notifyLogin) showToast(' Please log in to your Nintendo account!', 'warning', 6000);
              }
            }, 3500); // Wait 3.5s to ensure it's not just React hydrating the UI
          }
        } else {
          if (_loginTimer) { clearTimeout(_loginTimer); _loginTimer = null; }
          loggedOut = false;
          updateLoginUI(false);
          botLog(' Login button gone  user appears logged in.', 'success');
        }
      }
    });
    loginObserver.observe(document.body, { childList: true, subtree: true });

    //  SPA URL watcher (navigation) 
    var lastUrl = url;
    setInterval(function () {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        url = lastUrl;
        pageType = detectPage();
        
        // Update UI with new pageType
        var pTypeEl = document.getElementById(SCRIPT_ID + '-page-type-val');
        if (pTypeEl) pTypeEl.textContent = pageLabels[pageType] ? pageLabels[pageType].label : pageType;
        
        // Re-check login after SPA nav
        setTimeout(checkLoginState, 1200);
        
        // Trigger auto-checkout handlers if navigating into them
        if (pageType === 'cart') { setTimeout(handleCartPage, 1000); }
        if (pageType === 'checkout') { setTimeout(handleCheckoutPage, 1000); }
      }
    }, 2000);

    //  Fallback: silent re-check login every 6s (no console spam) 
    setInterval(function () {
      var prev = loggedOut;
      loggedOut = isLoggedOut();
      if (prev !== loggedOut) updateLoginUI(loggedOut);
    }, 6000);

    //  Background Watchlist Checker 
    // Claim tab leadership for deduplication, then start the check cycle
    setupLeadership();
    setTimeout(checkWatchlist, 2000);
    
    function scheduleNextCheck() {
      var minMs = (settings.minDelay || 30) * 1000;
      var maxMs = (settings.maxDelay || 60) * 1000;
      // Ensure max is at least min
      if (maxMs < minMs) maxMs = minMs;
      
      var delayMs = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
      
      if (settings.botRunning && watchlist.length > 0 && ntdIsLeader) {
        botLog(' Next background stock check scheduled in ' + Math.round(delayMs / 1000) + ' seconds...', 'info');
      }
      
      setTimeout(function() {
        checkWatchlist();
        scheduleNextCheck();
      }, delayMs);
    }
    scheduleNextCheck();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 900); });
  } else {
    setTimeout(init, 900);
  }

})();

