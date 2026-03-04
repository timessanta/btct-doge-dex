/**
 * translate.js — Ollama LLM 자동 번역
 * 1) 채팅 실시간 번역 : autoTranslate(text, resultEl)
 * 2) 페이지 DOM 자동 번역 : pageAutoTranslate(root)
 */
(function () {
  'use strict';

  // ── 언어 감지 ────────────────────────────────────────────────
  const rawLang  = navigator.language || navigator.userLanguage || 'en';
  const userLang = rawLang.split('-')[0].toLowerCase();

  // ── localStorage 캐시 (세션 간 영속) ─────────────────────────
  const CACHE_KEY = 'tl_cache_' + userLang;
  let cache;
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
  catch(e) { cache = {}; }
  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); }
    catch(e) { /* quota 초과 시 무시 */ }
  }

  // ── 배치 API 호출 (최대 20개씩 청크) ─────────────────────────
  async function apiBatch(texts) {
    if (!texts || texts.length === 0) return texts;
    const CHUNK = 20;
    const result = texts.map(t => cache[t] || null);
    const missing = [], midxs = [];
    result.forEach((v, i) => { if (!v) { missing.push(texts[i]); midxs.push(i); } });
    if (missing.length === 0) return result;

    // 청크 단위 처리
    for (let start = 0; start < missing.length; start += CHUNK) {
      const chunk = missing.slice(start, start + CHUNK);
      try {
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts: chunk, targetLang: userLang }),
        });
        const data = await res.json();
        (data.translations || chunk).forEach((tr, j) => {
          cache[chunk[j]] = tr;
          result[midxs[start + j]] = tr;
        });
      } catch(e) {
        chunk.forEach((t, j) => {
          cache[t] = t;
          result[midxs[start + j]] = t;
        });
      }
    }
    saveCache();
    return result;
  }

  // ── 단일 번역 ────────────────────────────────────────────────
  async function translate(text) {
    if (!text) return text;
    if (cache[text]) return cache[text];
    return (await apiBatch([text]))[0];
  }

  // ── 채팅 수신 자동번역 ────────────────────────────────────────
  window.autoTranslate = async function (text, resultEl) {
    if (!text || !resultEl) return;
    const hasKo = /[\uac00-\ud7a3]/.test(text);
    const hasZh = /[\u4e00-\u9fff]/.test(text);
    const hasJa = /[\u3040-\u30ff]/.test(text);
    const hasAr = /[\u0600-\u06ff]/.test(text);
    const isLatin = !hasKo && !hasZh && !hasJa && !hasAr;
    if (userLang === 'en' && isLatin) return;
    if (userLang === 'ko' && hasKo)   return;
    if (userLang === 'ja' && hasJa)   return;
    if (userLang === 'zh' && hasZh)   return;
    resultEl.textContent = '⏳';
    const tr = await translate(text);
    resultEl.textContent = (tr && tr !== text) ? '↳ ' + tr : '';
  };

  // ── 페이지 DOM 스캔 번역 ──────────────────────────────────────
  const SKIP_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','CANVAS','SVG','CODE','PRE','INPUT','TEXTAREA','SELECT']);
  const SKIP_RE = [
    /^[\d\s.,+\-$%:/()]+$/,
    /^0x[0-9a-f]{4,}/i,
    /^https?:\/\//,
    /^[A-Z]{2,6}$/,
    /^[\u2600-\u27ff]+$/,
  ];

  function shouldSkip(text) {
    const t = text.trim();
    if (t.length < 3) return true;
    return SKIP_RE.some(r => r.test(t));
  }

  async function pageAutoTranslate(root) {
    if (window.location.pathname.includes('-ko')) return;
    const container = root || document.body;
    const walker = document.createTreeWalker(
      container, NodeFilter.SHOW_TEXT,
      { acceptNode: n => {
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        if (p.closest('[data-notranslate]')) return NodeFilter.FILTER_REJECT;
        if (p.dataset && p.dataset.translated) return NodeFilter.FILTER_REJECT;
        const t = n.nodeValue.trim();
        if (!t || shouldSkip(t)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }}
    );
    const nodes = [], texts = [];
    let node;
    while ((node = walker.nextNode())) {
      nodes.push(node);
      texts.push(node.nodeValue.trim());
    }
    if (nodes.length === 0) return;

    // 캐시 히트 즉시 적용 (API 없이)
    nodes.forEach((n, i) => {
      const cached = cache[texts[i]];
      if (cached && cached !== texts[i]) {
        n.nodeValue = n.nodeValue.replace(texts[i], cached);
        if (n.parentElement) n.parentElement.dataset.translated = '1';
      }
    });

    // 캐시 미스만 API 호출
    const missNodes = [], missTexts = [];
    nodes.forEach((n, i) => {
      if (!cache[texts[i]]) { missNodes.push(n); missTexts.push(texts[i]); }
    });
    if (missNodes.length === 0) return;

    const translated = await apiBatch(missTexts);
    missNodes.forEach((n, i) => {
      if (translated[i] && translated[i] !== missTexts[i]) {
        n.nodeValue = n.nodeValue.replace(missTexts[i], translated[i]);
        if (n.parentElement) n.parentElement.dataset.translated = '1';
      }
    });
  }

  window.pageAutoTranslate = pageAutoTranslate;

  // ── 자동 실행 ────────────────────────────────────────────────
  function init() {
    const appEl = document.getElementById('app');
    if (appEl) {
      // SPA (index.html, town.html) — MutationObserver로 #app 감시
      let debounceTimer = null;
      new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => pageAutoTranslate(appEl), 300);
      }).observe(appEl, { childList: true, subtree: false });
      const nav = document.querySelector('nav') || document.querySelector('header');
      if (nav) pageAutoTranslate(nav);
    } else {
      // 정적 페이지 (about, guide)
      pageAutoTranslate();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.Translator = { lang: userLang, translate, batch: apiBatch };

})();
