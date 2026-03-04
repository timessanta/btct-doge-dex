/**
 * translate.js — Ollama LLM 자동 번역
 * 1) 채팅 실시간 번역 : autoTranslate(text, resultEl)
 * 2) 페이지 DOM 자동 번역 : pageAutoTranslate(root)
 *    — DOMContentLoaded 시 자동 실행 (index.html은 MutationObserver로 #app 감시)
 */
(function () {
  'use strict';

  // ── 언어 감지 ────────────────────────────────────────────────
  const rawLang  = navigator.language || navigator.userLanguage || 'en';
  const userLang = rawLang.split('-')[0].toLowerCase();

  // ── 캐시 ─────────────────────────────────────────────────────
  const cache = new Map();

  // ── 배치 API 호출 ────────────────────────────────────────────
  async function apiBatch(texts) {
    if (!texts || texts.length === 0) return texts;
    const missing = [], idxs = [];
    texts.forEach((t, i) => {
      if (!cache.has(userLang + ':' + t)) { missing.push(t); idxs.push(i); }
    });
    if (missing.length > 0) {
      try {
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts: missing, targetLang: userLang }),
        });
        const data = await res.json();
        (data.translations || missing).forEach((tr, j) => {
          cache.set(userLang + ':' + missing[j], tr);
        });
      } catch (e) {
        missing.forEach(t => cache.set(userLang + ':' + t, t));
      }
    }
    return texts.map(t => cache.get(userLang + ':' + t) || t);
  }

  // ── 단일 번역 ────────────────────────────────────────────────
  async function translate(text) {
    if (!text) return text;
    const key = userLang + ':' + text;
    if (cache.has(key)) return cache.get(key);
    return (await apiBatch([text]))[0];
  }

  // ── 채팅 수신 자동번역 (resultEl에 번역문 삽입) ───────────────
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
    const translated = await apiBatch(texts);
    nodes.forEach((n, i) => {
      if (translated[i] && translated[i] !== texts[i]) {
        n.nodeValue = n.nodeValue.replace(texts[i], translated[i]);
        if (n.parentElement) n.parentElement.dataset.translated = '1';
      }
    });
  }

  window.pageAutoTranslate = pageAutoTranslate;

  // ── 자동 실행 ────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const appEl = document.getElementById('app');
    if (appEl) {
      // SPA (index.html) — MutationObserver로 #app 변경 감시
      let debounceTimer = null;
      new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => pageAutoTranslate(appEl), 600);
      }).observe(appEl, { childList: true, subtree: false });
      // nav 정적 영역
      const nav = document.querySelector('nav') || document.querySelector('header');
      if (nav) pageAutoTranslate(nav);
    } else {
      // 정적 페이지 (about, guide)
      pageAutoTranslate();
    }
  });

  window.Translator = { lang: userLang, translate, batch: apiBatch };

})();
