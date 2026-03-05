/**
 * translate.js — Ollama LLM 자동 번역 (채팅 전용)
 * autoTranslate(text, resultEl) — 채팅 메시지 수신 시 번역문 삽입
 */
(function () {
  'use strict';

  const rawLang  = navigator.language || navigator.userLanguage || 'en';
  const userLang = rawLang.split('-')[0].toLowerCase();

  // localStorage 캐시 (v2: 서버캐시 도입으로 구버전 무효화)
  const CACHE_KEY = 'tl_v2_' + userLang;
  let cache;
  try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
  catch(e) { cache = {}; }
  try { localStorage.removeItem('tl_cache_' + userLang); } catch(e) {}
  function saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch(e) {}
  }

  // 한국어 타겟일 때 한자 포함 여부 체크
  function hasBadChars(tr) {
    if (userLang === 'ko' && /[\u4e00-\u9fff]/.test(tr)) return true;
    return false;
  }

  async function translate(text) {
    if (!text) return text;
    if (cache[text]) {
      if (hasBadChars(cache[text])) { delete cache[text]; saveCache(); }
      else return cache[text];
    }
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: [text], targetLang: userLang }),
      });
      const data = await res.json();
      const tr = (data.translations || [text])[0];
      // 타겟이 한국어인데 한자가 섞이면 캐시하지 않고 원문 반환
      const hasHanja = /[\u4e00-\u9fff]/.test(tr);
      if (userLang === 'ko' && hasHanja) return text;
      cache[text] = tr;
      saveCache();
      return tr;
    } catch(e) { return text; }
  }

  // 채팅 메시지 실시간 번역
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

  window.Translator = { lang: userLang, translate };

})();
