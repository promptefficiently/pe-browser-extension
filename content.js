/* Prompt Efficiently - content script.
   Reads the prompt box on supported AI sites and shows the live cost bubble.
   Sign-in required before any estimate. Estimates stay local. Opt-in rewrite UI is a held candidate; runtime service remains disabled pending validation. */
(function () {
  'use strict';
  document.documentElement.dataset.peLoaded = '1';

  var FREE_DAILY_LIMIT = 5;

  /* ---------- native-currency plan prices ----------
     Vendor-published local prices where verified (22 Nov); otherwise an
     approximate conversion, marked with ~=. */
  var PE_LOCAL_PLAN_PRICES = {
    'chatgpt.go':   { EUR: '€8' },
    'chatgpt.plus': { GBP: '£20', EUR: '€23' },
    'claude.pro':   { GBP: '£18', EUR: '€21.60' },
    'gemini.aipro': { GBP: '£18.99', EUR: '€21.99' },
  };
  var PE_FX = { GBP: [0.79, '£'], EUR: [0.92, '€'], CAD: [1.40, 'CA$'], AUD: [1.53, 'A$'] };
  function peCurrency() {
    var region = ((navigator.language || 'en-US').split('-')[1] || 'US').toUpperCase();
    if (region === 'GB') return 'GBP';
    if (region === 'CA') return 'CAD';
    if (region === 'AU') return 'AUD';
    var euro = ['AT','BE','CY','DE','EE','ES','FI','FR','GR','HR','IE','IT','LT','LU','LV','MT','NL','PT','SI','SK'];
    if (euro.indexOf(region) !== -1) return 'EUR';
    return 'USD';
  }
  function pePlanLabel(plan) {
    var m = /^(.+?)\s\$(\d+(?:\.\d+)?)(\/mo)?$/.exec(plan.label);
    if (!m) return plan.label;
    var cur = peCurrency();
    if (cur === 'USD') return plan.label;
    var local = (PE_LOCAL_PLAN_PRICES[platform.id + '.' + plan.id] || {})[cur];
    var price = local;
    if (!price) {
      var fx = PE_FX[cur];
      price = fx[1] + Math.max(1, Math.round(parseFloat(m[2]) * fx[0]));
    }
    return m[1] + ' ' + price + (m[3] || '');
  }

  var SITE_MAP = [
    [/^(www\.)?chatgpt\.com$/, 'chatgpt'],
    [/^claude\.ai$/, 'claude'],
    [/^gemini\.google\.com$/, 'gemini'],
    [/^(www\.)?grok\.com$/, 'grok'],
    [/^(www\.)?x\.ai$/, 'grok'],
    [/^([a-z0-9-]+\.)?town\.com$/, 'town'],
    [/^(www\.)?manus\.im$/, 'manus'],
    [/^(www\.)?lovable\.dev$/, 'lovable'],
    [/^(www\.)?bolt\.new$/, 'bolt'],
    [/^(www\.)?replit\.com$/, 'replit'],
    [/^platform\.openai\.com$/, 'openai_api'],
    [/^console\.anthropic\.com$/, 'anthropic_api'],
    [/^aistudio\.google\.com$/, 'gemini_api'],
    [/^platform\.deepseek\.com$/, 'deepseek'],
    [/^console\.x\.ai$/, 'xai_api'],
    [/^console\.mistral\.ai$/, 'mistral'],
    [/^console\.groq\.com$/, 'groq'],
    [/^cloud\.together\.ai$/, 'together'],
    [/^(app\.)?fireworks\.ai$/, 'fireworks'],
    [/^openrouter\.ai$/, 'openrouter'],
    [/^modelstudio\.console\.alibabacloud\.com$/, 'qwen'],
    [/^dashscope\.console\.aliyun\.com$/, 'qwen'],
    [/^(www\.)?bigmodel\.cn$/, 'zhipu'],
    [/^(www\.)?z\.ai$/, 'zhipu'],
    [/^platform\.moonshot\.(ai|cn)$/, 'moonshot'],
    [/^dashboard\.cohere\.com$/, 'cohere'],
    [/^localhost$/, 'lovable'], /* dev mock only; not in the shipped manifest */
  ];

  var platform = null;
  for (var i = 0; i < SITE_MAP.length; i++) {
    if (SITE_MAP[i][0].test(location.hostname)) {
      platform = PLATFORMS.find(function (p) { return p.id === SITE_MAP[i][1]; });
      break;
    }
  }
  var demoId = null;
  try { demoId = window.PE_DEMO_PLATFORM || new URLSearchParams(location.search).get('pe_demo'); } catch (e) {}
  if (demoId) {
    var dp = PLATFORMS.find(function (p) { return p.id === demoId; });
    if (dp) platform = dp;
  }
  if (!platform) return;

  /* Auto AI select (default on): the extension follows the open site.
     Off: the settings Default AI is used everywhere. Resolved at render
     time because the synced settings hydrate after script start. */
  function resolvePlatform() {
    if (demoId) return; /* website demo: keep the chosen AI */
    if (PE_LS.getItem('cap_auto_ai') === '0') {
      var u0 = null;
      try { u0 = JSON.parse(PE_LS.getItem('cap_user') || 'null'); } catch (e) {}
      var base0 = u0 && u0.email ? '_' + u0.email : '';
      var dfltAi = PE_LS.getItem('cap_default_ai' + base0) || PE_LS.getItem('cap_default_ai');
      if (dfltAi) {
        var dfltPlat = PLATFORMS.find(function (p) { return p.id === dfltAi; });
        if (dfltPlat) { platform = dfltPlat; return; }
      }
    }
    for (var i = 0; i < SITE_MAP.length; i++) {
      if (SITE_MAP[i][0].test(location.hostname)) {
        platform = PLATFORMS.find(function (p) { return p.id === SITE_MAP[i][1]; });
        return;
      }
    }
  }

  /* ---------- account helpers (same keys as the web app) ---------- */
  function currentUser() {
    try { return JSON.parse(PE_LS.getItem('cap_user') || 'null'); } catch (e) { return null; }
  }
  function dayKey() { return new Date().toISOString().slice(0, 10); }
  function getCount() {
    try {
      var o = JSON.parse(PE_LS.getItem('cap_count') || '{}');
      return o.day === dayKey() ? (o.n || 0) : 0;
    } catch (e) { return 0; }
  }
  function bumpCount() {
    PE_LS.setItem('cap_count', JSON.stringify({ day: dayKey(), n: getCount() + 1 }));
  }
  function planKey() { return 'cap_plan_' + platform.id; }
  function savedPlan() {
    var id = PE_LS.getItem(planKey());
    return (platform.plans || []).find(function (pl) { return pl.id === id; }) || null;
  }
  function defaultPlan() {
    var u = currentUser();
    var base = u && u.email ? '_' + u.email : '';
    var planId = PE_LS.getItem('cap_default_plan' + base) || PE_LS.getItem('cap_default_plan');
    if (planId) {
      var p = (platform.plans || []).find(function (pl) { return pl.id === planId; });
      if (p) return p;
    }
    return null;
  }

  /* ---------- prompt box discovery ---------- */
  var BOX_SELECTORS = [
    '#prompt-textarea',                       /* chatgpt, lovable-style */
    'div.ProseMirror[contenteditable="true"]',/* claude, grok, manus */
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'textarea[placeholder]',
    'textarea',
  ];
  function findBox() {
    for (var i = 0; i < BOX_SELECTORS.length; i++) {
      var els = document.querySelectorAll(BOX_SELECTORS[i]);
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        var r = el.getBoundingClientRect();
        if (r.width > 120 && r.height > 20 && r.bottom > 0 && r.top < innerHeight) return el;
      }
    }
    return null;
  }
  function boxText(el) {
    if (!el) return '';
    return (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') ? el.value : (el.innerText || '');
  }
  function sizeFromTokens(t) {
    if (t < 300) return 'small';
    if (t < 1200) return 'medium';
    return 'big';
  }

  /* ---------- bubble ---------- */
  var bubble = null;
  function peIconUrl() {
    try { return chrome.runtime.getURL('icons/icon48-light.png'); } catch (e) { return ''; }
  }
  function peBrand() {
    var u = peIconUrl();
    return '<div class="pe-brand">' + (u ? '<img src="' + u + '" alt="">' : '') + '<span>Prompt Efficiently</span></div>';
  }
  function peMark() {
    var u = peIconUrl();
    return u ? '<img class="pe-mark" src="' + u + '" alt="">' : '';
  }
  function ensureBubble() {
    if (bubble) {
      if (!bubble.isConnected) document.documentElement.appendChild(bubble);
      return bubble;
    }
    bubble = document.createElement('div');
    bubble.className = 'pe-bubble pe-hidden';
    document.documentElement.appendChild(bubble);
    return bubble;
  }
  function hideBubble() { if (bubble) bubble.classList.add('pe-hidden'); }
  var pePosition = null, peDrag = null, peExpanded = false, peDidDrag = false;
  try { pePosition = JSON.parse(PE_LS.getItem('pe_widget_position') || 'null'); } catch (e) {}
  function peClamp(x,y) {
    var w=bubble.offsetWidth||300,h=bubble.offsetHeight||100;
    return {x:Math.max(8,Math.min(x,innerWidth-w-8)),y:Math.max(8,Math.min(y,innerHeight-h-8))};
  }
  function pePlace(x,y,save) {
    var p=peClamp(x,y);bubble.style.left=p.x+'px';bubble.style.top=p.y+'px';
    if(save){pePosition={x:p.x,y:p.y};PE_LS.setItem('pe_widget_position',JSON.stringify(pePosition));}
  }
  function peReset(){pePosition=null;PE_LS.removeItem('pe_widget_position');positionBubble();}
  function peControls() {
    if(bubble.querySelector('.pe-movebar'))return;
    var bar=document.createElement('div');bar.className='pe-movebar';
    var move=document.createElement('button');move.type='button';move.className='pe-drag-handle';move.textContent='⠿';move.title='Drag to move. Arrow keys move 10 pixels; Shift moves 1 pixel.';move.setAttribute('aria-label','Show estimate details, or drag to move');move.setAttribute('aria-expanded',String(peExpanded));move.title='Click for details. Drag to move. Arrow keys move 10 pixels; Shift moves 1 pixel.';
    var reset=document.createElement('button');reset.type='button';reset.className='pe-reset-position';reset.textContent='↺';reset.title='Reset position';reset.setAttribute('aria-label','Reset widget position');reset.onclick=peReset;
    bar.append(move,reset);bubble.prepend(bar);bubble.classList.toggle('pe-expanded',peExpanded);var detail=bubble.querySelector('.pe-expanded-details');if(detail)detail.hidden=!peExpanded;
    move.addEventListener('pointerdown',function(e){if(e.button!==0)return;var r=bubble.getBoundingClientRect();peDidDrag=false;peDrag={x:e.clientX-r.left,y:e.clientY-r.top,sx:e.clientX,sy:e.clientY};move.setPointerCapture(e.pointerId);e.preventDefault();});
    move.addEventListener('pointermove',function(e){if(!peDrag)return;if(Math.hypot(e.clientX-peDrag.sx,e.clientY-peDrag.sy)>4)peDidDrag=true;if(peDidDrag)pePlace(e.clientX-peDrag.x,e.clientY-peDrag.y,false);});
    function stop(){if(!peDrag)return;if(peDidDrag){var r=bubble.getBoundingClientRect();pePlace(r.left,r.top,true);}peDrag=null;}
    move.addEventListener('click',function(){if(peDidDrag){peDidDrag=false;return;}peExpanded=!peExpanded;var detail=bubble.querySelector('.pe-expanded-details');if(detail)detail.hidden=!peExpanded;bubble.classList.toggle('pe-expanded',peExpanded);move.setAttribute('aria-expanded',String(peExpanded));positionBubble();});
    move.addEventListener('pointerup',stop);move.addEventListener('pointercancel',stop);
    move.addEventListener('keydown',function(e){var d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(!d)return;e.preventDefault();var r=bubble.getBoundingClientRect(),step=e.shiftKey?1:10;pePlace(r.left+d[0]*step,r.top+d[1]*step,true);});
  }
  function showBubble() { try { pePosition=JSON.parse(PE_LS.getItem('pe_widget_position')||'null'); } catch(e) { pePosition=null; } bubble.classList.remove('pe-hidden');peControls();positionBubble(); }
  function positionBubble() {
    if(!bubble)return;
    bubble.style.position='fixed';bubble.style.zIndex='2147483647';
    if(pePosition&&Number.isFinite(pePosition.x)&&Number.isFinite(pePosition.y)){pePlace(pePosition.x,pePosition.y,false);return;}
    var box=findBox();if(!box)return;var r=box.getBoundingClientRect();pePlace(r.left,r.top-bubble.offsetHeight-10,false);
  }

  /* ---------- sign-in gate ---------- */
  function renderGate() {
    resolvePlatform();
    var b = ensureBubble();
    b.className = 'pe-bubble pe-gate';
    b.innerHTML = peBrand() + '<a class="pe-btn" href="https://promptefficiently.com/app.html" target="_blank" rel="noopener noreferrer">Sign in on promptefficiently.com</a>';
    showBubble();
  }

  /* ---------- plan ask (first visit per site) ---------- */
  function renderPlanAsk() {
    resolvePlatform();
    var b = ensureBubble();
    b.className = 'pe-bubble pe-ask';
    var opts = platform.kind === 'tokens' ? [{ id: 'api', label: 'Pay per use' }] : (platform.plans || [{ id: 'free', label: 'Free' }]);
    b.innerHTML =
      '<div class="pe-gate-title">' + peMark() + 'Which ' + platform.name + ' plan are you on?</div>' +
      '<div class="pe-gate-sub">Asked once. Change it any time in settings on promptefficiently.com.</div>' +
      '<div class="pe-plan-row">' + opts.map(function (pl) {
        return '<button type="button" class="pe-plan-btn" data-plan="' + pl.id + '">' + pePlanLabel(pl) + '</button>';
      }).join('') + '</div>';
    b.querySelectorAll('.pe-plan-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        PE_LS.setItem(planKey(), btn.dataset.plan);
        renderEstimate();
      });
    });
    showBubble();
  }

  /* ---------- main estimate ---------- */
  var lastLoggedText = '';
  var pePermit=null,pePending=false,pePermitText='',pePermitError=null,pePermitAt=0;
  function authorizeEstimate(text){
    if(pePending)return;
    pePending=true;pePermit=null;pePermitError=null;pePermitText=text;permitSession=PE_LS.getItem('cap_session')||'';
    var requestId=crypto.randomUUID();
    chrome.runtime.sendMessage({type:'pe-authorize',requestId:requestId},function(result){
      pePending=false;
      if(chrome.runtime.lastError||!result?.ok)pePermitError=result?.error||'connection_required';
      else {pePermit=result;pePermitAt=Date.now();}
      renderEstimate();
    });
  }
  var peLastInputAt=0;
  function renderEstimate() {
    if(peLastInputAt && Date.now()-peLastInputAt<1000){clearTimeout(debounce);debounce=setTimeout(renderEstimate,1000-(Date.now()-peLastInputAt));return;}
    if(document.getElementById('peRewritePanel'))return;
    resolvePlatform();
    if (captureShowing) return;
    if (!currentUser() || !PE_LS.getItem('cap_session')) { renderGate(); return; }
    var plan = savedPlan();
    if (!plan && PE_LS.getItem('cap_auto_ai') === '0') {
      plan = defaultPlan();
      if (plan) PE_LS.setItem(planKey(), plan.id);
    }
    if (!plan) { renderPlanAsk(); return; }
    var box = findBox();
    var text = boxText(box).trim();
    if(!box){hideBubble();return;}
    if(!text){var empty=ensureBubble();empty.className='pe-bubble pe-live';empty.innerHTML='<span class="pe-range">0</span><span class="pe-actions"><button type="button" class="pe-link" disabled>Prompt Efficiently</button></span>';showBubble();return;}
    if(text===lastLoggedText){hideBubble();return;}

    if(pePermit?.pro && Date.now()-pePermitAt>60000){pePermit=null;pePermitError=null;}
    if(!pePermit && !pePermitError && !pePending){authorizeEstimate(text);return;}
    if(pePermit)pePermitText=text;
    if(pePending)return;
    if(!pePermit){
      var errorBubble=ensureBubble();errorBubble.className='pe-bubble pe-over';
      errorBubble.textContent=pePermitError==='daily_limit'?"That's your 5 free estimates for today.":'Connect and sign in on promptefficiently.com to check your plan.';
      var action=document.createElement('a');action.href='https://promptefficiently.com/app#upgrade';action.target='_blank';action.rel='noopener';action.className='pe-link';action.textContent=pePermitError==='daily_limit'?'Upgrade to Pro':'Sign in';errorBubble.appendChild(document.createElement('br'));errorBubble.appendChild(action);
      showBubble();return;
    }
    var isPro = pePermit.pro===true;
    var left = pePermit.remaining;
    var b = ensureBubble();
    if (false) {
      b.className = 'pe-bubble pe-over';
      b.innerHTML = '<span class="pe-range">' + peMark() + 'That\'s your 5 free estimates for today.</span>' +
        '<span class="pe-sub">Come back tomorrow.</span>';
      showBubble();
      return;
    }

    var tokens = estimateTokens(text);
    var size = sizeFromTokens(tokens);
    var tt = detectTaskType(text);
    var est = computeEstimate(platform, size, plan, tt && tt.key, tokens);
    try {
      var beforeBal = readBalance();
      PE_LS.setItem('cap_pending_balance', JSON.stringify({ platform: platform.name, predicted: est.rangeText, before: beforeBal, ts: Date.now() }));
    } catch (e) {}
    b.className = 'pe-bubble pe-live pe-' + est.verdict;
    var fitHtml = '';
    try {
      if (platform.kind === 'tokens') {
        fitHtml = '<span class="pe-fit">Pay-per-use API, billed per token. No free tier tracked.</span>';
      } else if (platform.kind === 'credits' && platform.freeAllowance && platform.freeUnit && platform.freePeriod) {
        fitHtml = '<span class="pe-fit">Rough guide: ' + platform.name + "'s free plan is " + Number(platform.freeAllowance).toLocaleString('en-GB') + ' ' + platform.freeUnit + ' a ' + platform.freePeriod + '. Check their current limits first.</span>';
      }
    } catch (e) {}
    b.innerHTML = '<span class="pe-range" title="Rough task estimate, not a quote or remaining balance. Actual usage depends on model, context, output and tools.">About ' + est.rangeText + '</span>' +
      '<span class="pe-actions"><button type="button" class="pe-link" id="peOpt" title="Ask for a shorter rewrite. Review before copying; meaning and savings are not guaranteed.">Prompt Efficiently</button></span>' + fitHtml;
    var detail=document.createElement('div');detail.className='pe-expanded-details';detail.hidden=true;b.appendChild(detail);
    b.querySelector('#peOpt').addEventListener('click', function () { openRewrite(text); });
    showBubble();
  }

  function openRewrite(original) {
    var old=document.getElementById('peRewritePanel');if(old)old.remove();
    var panel=document.createElement('section');panel.id='peRewritePanel';panel.className='pe-rewrite-panel';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','Review AI rewrite');
    function el(tag,text){var n=document.createElement(tag);if(text)n.textContent=text;panel.appendChild(n);return n;}
    var heading=el('h2','AI rewrite');heading.hidden=true;
    var notice=el('p','');notice.hidden=true;
    var originalView=el('details');var originalTitle=document.createElement('summary');originalTitle.textContent='View original';originalView.appendChild(originalTitle);var before=document.createElement('textarea');before.readOnly=true;before.value=original;originalView.appendChild(before);
    var modeLabel=el('label');modeLabel.textContent='Rewrite mode: ';
    var modeSel=document.createElement('select');
    [['shorter','Shorter'],['clearer','Clearer'],['more_specific','More specific']].forEach(function(m){var o=document.createElement('option');o.value=m[0];o.textContent=m[1];modeSel.appendChild(o);});
    modeLabel.appendChild(modeSel);
    var label=el('label');var consent=document.createElement('input');consent.type='checkbox';label.appendChild(consent);label.appendChild(document.createTextNode(' 18+; send this prompt to our server and an outside AI service.'));
    var status=el('p','Uses your rewrite allowance. Estimates stay local.');status.setAttribute('role','status');
    var generate=el('button','Rewrite');generate.type='button';generate.disabled=true;
    consent.addEventListener('change',function(){generate.disabled=!consent.checked;});
    var afterLabel=el('h3','Rewrite');afterLabel.hidden=true;var after=el('textarea');after.readOnly=true;after.hidden=true;
    var copy=el('button','Copy rewrite');copy.type='button';copy.hidden=true;
    copy.addEventListener('click',async function(){try{await navigator.clipboard.writeText(after.value);status.textContent='Copied. Compare with your original before pasting.';}catch{after.focus();after.select();status.textContent='Copy was blocked. Select and copy the rewrite manually.';}});
    var close=el('button','Close');close.type='button';function dismiss(){panel.remove();if(bubble){bubble.classList.remove('pe-rewriting');positionBubble();}}close.addEventListener('click',dismiss);
    generate.addEventListener('click',function(){
      generate.disabled=true;consent.disabled=true;status.textContent='Rewriting. Your original prompt is unchanged.';
      var id='rw_'+crypto.randomUUID().replace(/-/g,'');
      if(typeof chrome==='undefined'||!chrome.runtime){status.textContent='Install and sign in to the extension to rewrite.';return;}
      chrome.runtime.sendMessage({type:'pe-rewrite',requestId:id,text:original,consent:true,adult:true,mode:modeSel.value},function(result){
        if(chrome.runtime.lastError||!result?.ok){status.textContent=result?.message||'Rewrite unavailable. Your original prompt is unchanged. No automatic retry was made.';return;}
        after.value=result.rewrite;after.hidden=false;afterLabel.hidden=true;copy.hidden=false;generate.hidden=true;label.hidden=true;
        status.textContent=result.unchanged?'No safer version returned. Original kept.':'Review meaning. Lower costs are not guaranteed.';positionBubble();
      });
    });
    var card=ensureBubble();card.appendChild(panel);card.classList.add('pe-rewriting');positionBubble();close.focus();
    panel.addEventListener('keydown',function(e){if(e.key==='Escape')dismiss();});
  }

  /* ---------- send detection: count the estimate, log to dashboard ---------- */
  function onSend(sentText) {
    var box = findBox();
    var text = typeof sentText === 'string' ? sentText : boxText(box).trim();
    if (!text || !currentUser() || text === lastLoggedText) return;
    if (!pePermit || pePermitText !== text) return;
    lastLoggedText = text;
    pePermit=null;pePermitText='';
    bumpCount();
    var plan = savedPlan() || { label: 'Free' };
    var tokens = estimateTokens(text);
    var size = sizeFromTokens(tokens);
    var tt = detectTaskType(text);
    var est = computeEstimate(platform, size, plan, tt && tt.key, tokens);
    var checks = [];
    try { checks = JSON.parse(PE_LS.getItem('cap_checks') || '[]'); } catch (e) {}
    checks.push({ ts: Date.now(), platform: platform.name, size: ({ small: 'A single task or question', medium: 'A small project or feature', big: 'A big build, many steps' })[size], range: est.rangeText });
    PE_LS.setItem('cap_checks', JSON.stringify(checks));
    hideBubble();
  }

  /* ---------- balance capture: real cost from before/after balances ---------- */
  function readBalance() {
    var els = document.querySelectorAll('span, div, button, a, p');
    var n = Math.min(els.length, 3000);
    for (var i = 0; i < n; i++) {
      var el = els[i];
      if (el.closest('.pe-bubble, .pe-rewrite-panel')) continue;
      if (el.children.length > 2) continue;
      var t = (el.innerText || '').trim();
      if (!t || t.length > 60) continue;
      var m = /([\d][\d,\.]*?)\s*(credits?|tokens?|messages?)\b/i.exec(t);
      if (m && /left|remaining|balance|of\s[\d,]+/i.test(t)) {
        var v = parseFloat(m[1].replace(/,/g, ''));
        if (isFinite(v) && v >= 0 && v < 1000000) return v;
      }
    }
    return null;
  }

  function pendingBal() {
    try { return JSON.parse(PE_LS.getItem('cap_pending_balance') || 'null'); } catch (e) { return null; }
  }

  function writeCalibration(actual, predicted) {
    var cals = [];
    try { cals = JSON.parse(PE_LS.getItem('cap_calibrations') || '[]'); } catch (e) {}
    cals.push({ platform: platform.id, predicted: predicted, actual: actual, ts: Date.now() });
    PE_LS.setItem('cap_calibrations', JSON.stringify(cals));
  }

  var captureShowing = false;
  function showCaptureAsk(est) {
    captureShowing = true;
    var b = ensureBubble();
    b.className = 'pe-bubble pe-capture';
    b.innerHTML =
      peBrand() +
      '<div class="pe-gate-sub">What does your balance say now? Tap to capture - I\'ll work out the real cost.</div>' +
      '<button type="button" class="pe-btn" id="peCap">Capture</button>';
    b.querySelector('#peCap').addEventListener('click', function () {
      var now = readBalance();
      if (now === null) { showCaptureManual(est); return; }
      finishCapture(est, now);
    });
    showBubble();
  }

  function showCaptureManual(est) {
    var b = ensureBubble();
    b.className = 'pe-bubble pe-capture';
    b.innerHTML =
      peBrand() +
      '<div class="pe-gate-sub">Type the balance you see:</div>' +
      '<input type="text" inputmode="decimal" class="pe-input" id="peBal" placeholder="e.g. 255">' +
      '<button type="button" class="pe-btn" id="peCapGo">Save</button>';
    b.querySelector('#peCapGo').addEventListener('click', function () {
      var v = parseFloat((b.querySelector('#peBal').value || '').replace(/,/g, ''));
      if (!isFinite(v) || v < 0) return;
      finishCapture(est, v);
    });
    showBubble();
  }

  function finishCapture(est, now) {
    captureShowing = false;
    var pend = pendingBal();
    var b = ensureBubble();
    var predicted = (est && est.rangeText) || (pend && pend.predicted) || '';
    if (pend && pend.platform === platform.name && pend.before !== null && pend.before !== undefined) {
      var actual = pend.before - now;
      if (actual > 0) {
        writeCalibration(actual, pend.predicted || predicted);
        b.className = 'pe-bubble pe-live';
        b.innerHTML = '<span class="pe-range">' + peMark() + 'Real cost: about ' + fmt(actual) + '.</span>' +
          '<span class="pe-sub">Logged. Every capture sharpens your next estimate.</span>';
        PE_LS.setItem('cap_pending_balance', JSON.stringify({ platform: platform.name, predicted: predicted, before: now, ts: Date.now() }));
        showBubble();
        return;
      }
    }
    PE_LS.setItem('cap_pending_balance', JSON.stringify({ platform: platform.name, predicted: predicted, before: now, ts: Date.now() }));
    b.className = 'pe-bubble pe-live';
    b.innerHTML = '<span class="pe-range">' + peMark() + 'Balance noted.</span>' +
      '<span class="pe-sub">Capture again after your next task and I\'ll work out the real cost.</span>';
    showBubble();
  }

  /* ---------- wiring ---------- */
  var peOptimising=false;
  var debounce = null;
  function schedule() {
    clearTimeout(debounce);
    debounce = setTimeout(renderEstimate, 1000);
  }
  var permitSession=PE_LS.getItem('cap_session')||'';
  window.addEventListener('pe-storage-updated', function(){var next=PE_LS.getItem('cap_session')||'';if(next!==permitSession){permitSession=next;pePermit=null;pePermitError=null;pePermitText='';}schedule();});
  peWhenReady(function () {
    document.addEventListener('input', function (e) {
      if(peOptimising)return;
      var box = findBox();
      if (box && (e.target === box || box.contains(e.target))) {
        peLastInputAt=Date.now();
        if (boxText(box).trim() !== lastLoggedText) captureShowing = false;
        if(!boxText(box).trim()){peLastInputAt=0;renderEstimate();return;}
        schedule();
      }
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        var box = findBox();
        if (box && (e.target === box || box.contains(e.target))) onSend(boxText(box).trim());
      }
    }, true);
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('button[type="submit"], button[aria-label*="Send" i], button[data-testid*="send" i]');
      if (btn) onSend(boxText(findBox()).trim());
    }, true);
    window.addEventListener('scroll', positionBubble, true);
    window.addEventListener('resize', positionBubble);
    renderEstimate(); // gate shows immediately when signed out
    // poll for SPA loads where the box appears late; self-heal if the host app removes the bubble
    var tries = 0;
    var poll = setInterval(function () {
      tries++;
      if (findBox()) { clearInterval(poll); renderEstimate(); return; }
      if (!bubble || !bubble.isConnected) renderEstimate();
      if (tries > 120) clearInterval(poll);
    }, 500);
  });
})();
