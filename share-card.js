/* Prompt Efficiently - before/after share card.
   Runs entirely on the device. Nothing is sent anywhere: the card is built from text
   the user already has on screen, shown in full, and only copied if the user taps Copy. */
(function (root) {
  'use strict';
  var LINK = 'https://promptefficiently.com/?ref=share-card';
  var MAX_CHARS = 160;
  function tokens(t) { var w = String(t || '').trim().split(/\s+/).filter(Boolean).length; return Math.round(w * 1.3); }
  function clip(t) {
    t = String(t || '').replace(/\s+/g, ' ').trim();
    if (t.length <= MAX_CHARS) return { text: t, cut: false };
    var s = t.slice(0, MAX_CHARS); var i = s.lastIndexOf(' ');
    if (i > MAX_CHARS * 0.6) s = s.slice(0, i);
    return { text: s.replace(/[\s,.;:!?-]+$/, '') + '\u2026', cut: true };
  }
  function build(original, rewritten) {
    var a = tokens(original), b = tokens(rewritten);
    var saved = a - b;
    if (!(saved > 0) || !String(rewritten || '').trim()) return null; /* nothing to brag about, so no card */
    var pct = Math.round(saved / a * 100);
    var o = clip(original), r = clip(rewritten);
    var lines = [
      'Before (about ' + a + ' tokens): \u201c' + o.text + '\u201d',
      'After (about ' + b + ' tokens): \u201c' + r.text + '\u201d',
      'Saved about ' + saved + ' tokens (' + pct + '%) with Prompt Efficiently. Rough estimate.',
      LINK
    ];
    return { before: o.text, after: r.text, beforeTokens: a, afterTokens: b, saved: saved, pct: pct, link: LINK, lines: lines, text: lines.join('\n'), truncated: o.cut || r.cut };
  }
  /* Builds the card as DOM using textContent only, so prompt text can never run as markup. */
  function render(doc, card) {
    var box = doc.createElement('div'); box.className = 'pe-share-card';
    box.style.cssText = 'box-sizing:border-box;border:1px solid #bfe6d7;border-radius:12px;background:#f0faf5;color:#17102e;padding:12px;font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;text-align:left;max-width:100%';
    function row(label, body, tint) {
      var r = doc.createElement('div'); r.style.cssText = 'margin:0 0 8px;padding:8px 10px;border-radius:8px;background:' + tint + ';overflow-wrap:anywhere';
      var l = doc.createElement('div'); l.textContent = label; l.style.cssText = 'font:600 11px/1.3 ui-monospace,Menlo,monospace;letter-spacing:.06em;text-transform:uppercase;color:#5b5566;margin-bottom:3px';
      var p = doc.createElement('div'); p.textContent = body; r.appendChild(l); r.appendChild(p); return r;
    }
    box.appendChild(row('Before \u00b7 about ' + card.beforeTokens + ' tokens', '\u201c' + card.before + '\u201d', '#fff'));
    box.appendChild(row('After \u00b7 about ' + card.afterTokens + ' tokens', '\u201c' + card.after + '\u201d', '#fff'));
    var s = doc.createElement('div'); s.textContent = 'Saved about ' + card.saved + ' tokens (' + card.pct + '%) with Prompt Efficiently. Rough estimate.'; s.style.cssText = 'font-weight:700;margin:2px 0 4px;color:#0a8757'; box.appendChild(s);
    var k = doc.createElement('div'); k.textContent = card.link; k.style.cssText = 'font-size:12px;color:#5b5566;overflow-wrap:anywhere'; box.appendChild(k);
    return box;
  }
  var api = { build: build, render: render, tokens: tokens, MAX_CHARS: MAX_CHARS, LINK: LINK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PEShare = api;
})(typeof window !== 'undefined' ? window : this);
