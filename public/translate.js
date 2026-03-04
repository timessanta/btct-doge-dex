/**
 * translate.js — Ollama LLM 자동 번역 헬퍼
 * 브라우저 언어 감지 → 수신 메시지 실시간 자동 번역
 */
(function () {
  'use strict';

  // ── 언어 감지 ──────────────────────────────────────────────
  const rawLang = navigator.language || navigator.userLanguage || 'en';
  const userLang = rawLang.split('-')[0].toLowerCase(); // 'en-US' → 'en'

  // ── 캐시 ───────────────────────────────────────────────────
  const cache = new Map();

  // ── Core API call ───────────────────────────────────────────
  async function apiBatch(texts) {
    if (!texts || texts.length === 0) return texts;
    // 캐시에 있는 건 바로 반환, 없는 것만 요청
    const missing = [];
    const missingIdx = [];
    texts.forEach((t, i) => {
      const key = userLang + ':' + t;
      if (!cache.has(key)) { missing.push(t); missingIdx.push(i); }
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
        // 실패 시 원문 캐시
        missing.forEach(t => cache.set(userLang + ':' + t, t));
      }
    }

    return texts.map(t => cache.get(userLang + ':' + t) || t);
  }

  // ── Public API ──────────────────────────────────────────────
  const Translator = {
    lang: userLang,
    isKorean,
    enabled: !isKorean,

    /** 단일 텍스트 번역 */
    async translate(text) {
      if (!text || isKorean) return text;
      const key = userLang + ':' + text;
      if (cache.has(key)) return cache.get(key);
      const results = await apiBatch([text]);
      return results[0];
    },

    /** 여러 텍스트 배치 번역 */
    async batch(texts) {
      if (!texts || isKorean) return texts;
      return apiBatch(texts);
    },

    /** DOM Element 텍스트 번역 (textContent 교체) */
    async element(el) {
      if (!el || isKorean) return;
      const original = el.dataset.i18nOrig || el.textContent.trim();
      if (!original) return;
      el.dataset.i18nOrig = original;
      const translated = await Translator.translate(original);
      if (translated && translated !== original) {
        el.textContent = translated;
      }
    },

    /**
     * 채팅 메시지 번역 → 원문 + 번역 같이 표시
     * @returns { content, translated } 객체
     */
    async chat(text) {
      if (!text || isKorean) return { content: text, translated: null };
      // 이미 영어(or 목표언어)인지 간단 휴리스틱
      const hasKorean = /[ㄱ-ㅎ가-힣]/.test(text);
      const hasChinese = /[\u4e00-\u9fff]/.test(text);
      const hasJapanese = /[\u3040-\u30ff]/.test(text);
      // 목표 언어가 영어인데 이미 영문이면 패스
      if (userLang === 'en' && !hasKorean && !hasChinese && !hasJapanese) {
        return { content: text, translated: null };
      }
      const translated = await Translator.translate(text);
      if (!translated || translated === text) return { content: text, translated: null };
      return { content: text, translated };
    },

    /**
     * 페이지 내 [data-i18n] 속성 가진 element 전부 번역
     */
    async page(root) {
      if (isKorean) return;
      const els = Array.from((root || document).querySelectorAll('[data-i18n]'));
      if (els.length === 0) return;
      const texts = els.map(el => el.dataset.i18nOrig || el.textContent.trim());
      const translated = await apiBatch(texts);
      els.forEach((el, i) => {
        if (!el.dataset.i18nOrig) el.dataset.i18nOrig = texts[i];
        if (translated[i] && translated[i] !== texts[i]) el.textContent = translated[i];
      });
    },
  };

  window.Translator = Translator;

  // ── 공통 채팅 번역 버튼 핸들러 ──────────────────────────────
  window.translateChat = async function(btn) {
    const text = btn.dataset.text || '';
    if (!text) return;
    const resultEl = btn.nextElementSibling;
    if (!resultEl) return;
    if (resultEl.style.display === 'block') {
      resultEl.style.display = 'none';
      btn.style.opacity = '0.45';
      return;
    }
    btn.style.opacity = '0.45';
    btn.disabled = true;
    resultEl.style.display = 'block';
    resultEl.textContent = '⏳ translating...';
    try {
      const targetLang = (navigator.language || 'en').split('-')[0];
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: [text], targetLang }),
      });
      const data = await res.json();
      const translated = data?.translations?.[0];
      if (translated && translated.toLowerCase() !== text.toLowerCase()) {
        resultEl.textContent = '↳ ' + translated;
        btn.style.opacity = '1';
      } else {
        resultEl.textContent = '↳ (no translation needed)';
        btn.style.opacity = '0.3';
      }
    } catch (e) {
      resultEl.textContent = '↳ translation failed';
      btn.style.opacity = '0.3';
    }
    btn.disabled = false;
  };

})();
