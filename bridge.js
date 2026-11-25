/* Prompt Efficiently - website bridge.
   Runs only on promptefficiently.com. Two-way sync between the site's
   localStorage and the extension's chrome.storage.local, so:
   - a sign-in on the website reaches the installed extension
   - usage the extension records on AI sites reaches the web dashboard
   Prompt text never leaves the device and is never part of this sync. */
(function () {
  'use strict';
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

  var ACCOUNT_KEYS = ['cap_user', 'cap_session'];
  var LIST_KEYS = ['cap_checks', 'cap_savings', 'cap_calibrations'];
  var SETTING_PREFIXES = ['cap_auto_ai', 'cap_default_ai', 'cap_default_plan', 'cap_plan'];

  function siteGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function siteSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function today() { return new Date().toISOString().slice(0, 10); }

  function sync() {
    chrome.storage.local.get(null, function (ext) {
      if (chrome.runtime && chrome.runtime.lastError) return;
      ext = ext || {};
      var push = {};
      var wroteSite = false;

      /* 1. Account: signed-in site wins; otherwise import from the extension. */
      ACCOUNT_KEYS.forEach(function (k) {
        var site = siteGet(k);
        if (site) push[k] = site;
        else if (ext[k]) chrome.storage.local.remove(k);
      });
      if (ext.cap_accounts) chrome.storage.local.remove('cap_accounts');

      /* 2. Daily usage count: extension format -> site per-day key. */
      try {
        var c = JSON.parse(ext.cap_count || 'null');
        if (c && c.day === today()) {
          var dayKey = 'cap_count_' + today();
          var extN = c.n || 0;
          var siteN = parseInt(siteGet(dayKey) || '0', 10);
          if (extN > siteN) { siteSet(dayKey, String(extN)); wroteSite = true; }
          else if (siteN > extN) push.cap_count = JSON.stringify({day:today(),n:siteN});
        } else { var localN=parseInt(siteGet('cap_count_'+today())||'0',10); if(localN>0) push.cap_count=JSON.stringify({day:today(),n:localN}); }
      } catch (e) {}

      /* 3. History lists: merge both ways (dedupe by timestamp+platform). */
      LIST_KEYS.forEach(function (k) {
        var siteList = [], extList = [];
        try { siteList = JSON.parse(siteGet(k) || '[]'); } catch (e) {}
        try { extList = JSON.parse(typeof ext[k] === 'string' ? ext[k] : '[]'); } catch (e) {}
        var seen = {}, merged = [];
        siteList.concat(extList).forEach(function (item) {
          if (!item || typeof item !== 'object') return;
          var id = String(item.ts) + '|' + String(item.platform || '') + '|' + String(item.range || item.predicted || item.tokens || '');
          if (!seen[id]) { seen[id] = 1; merged.push(item); }
        });
        merged.sort(function (a, b) { return (a.ts || 0) - (b.ts || 0); });
        var mergedStr = JSON.stringify(merged);
        if (merged.length !== siteList.length) { siteSet(k, mergedStr); wroteSite = true; }
        if (merged.length !== extList.length) push[k] = mergedStr;
      });

      /* 4. Default AI/plan settings live on the site; push them to the extension. */
      try {
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          var isSetting = SETTING_PREFIXES.some(function (p) { return k === p || k.indexOf(p + '_') === 0; });
          if (isSetting) {
            var v = siteGet(k);
            if (v !== null && v !== ext[k]) push[k] = v;
          }
        }
      } catch (e) {}

      if (Object.keys(push).length) chrome.storage.local.set(push);

      /* If anything changed on the site side, nudge the app to re-render.
         (Page functions are unreachable from this isolated world; a DOM
         event crosses it.) */
      if (wroteSite) window.dispatchEvent(new Event('pe-sync'));
    });
  }

  sync();
  window.addEventListener('focus', sync);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) sync(); });
  /* Same-tab changes (sign-in, settings) fire no events a content script can
     hear, so poll lightly while the site is open. */
  setInterval(sync, 2000);
})();
