/* Prompt Efficiently - storage shim for the extension.
   Sync-read cache over chrome.storage.local. Same keys as the web app. */
const PE_CACHE = {};
let PE_READY = false;
const PE_READY_WAITERS = [];

const PE_LS = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(PE_CACHE, k) ? PE_CACHE[k] : null; },
  setItem(k, v) {
    PE_CACHE[k] = String(v);
    try { chrome.storage.local.set({ [k]: String(v) }); } catch (e) {}
  },
  removeItem(k) {
    delete PE_CACHE[k];
    try { chrome.storage.local.remove(k); } catch (e) {}
  },
};

function PE_CALS() {
  try { return JSON.parse(PE_LS.getItem('cap_calibrations') || '[]'); } catch (e) { return []; }
}

function peStorageInit(done) {
  try {
    chrome.storage.local.get(null, (items) => {
      Object.assign(PE_CACHE, items || {});
      PE_READY = true;
      PE_READY_WAITERS.splice(0).forEach((fn) => fn());
      if (done) done();
    });
  } catch (e) {
    // no extension storage (e.g. unexpected context): run on memory only
    PE_READY = true;
    if (done) done();
  }
}

function peWhenReady(fn) {
  if (PE_READY) fn();
  else PE_READY_WAITERS.push(fn);
}

peStorageInit();

// Keep already-open AI tabs in sync with a website sign-in/sign-out.
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, change] of Object.entries(changes)) {
      if (typeof change.newValue === 'undefined') delete PE_CACHE[key];
      else PE_CACHE[key] = change.newValue;
    }
    window.dispatchEvent(new Event('pe-storage-updated'));
  });
} catch (e) {}
