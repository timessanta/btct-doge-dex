// ======================== BTCT Town — Mob & Combat System ========================
// Client-side mob spawning, AI, combat, HP, BIT rewards
// Mobs are LOCAL only — other players don't see your mobs

(function () {
  'use strict';

  const TILE = 32;
  const MAP_W = 30;
  const MAP_H = 22;

  // ---- Item / Shop Definitions ----
  const ITEMS = {
    drink_s: { name: 'Energy Drink (S)', emoji: '🧃', type: 'consumable', hpRestore: 30, price: 50, desc: 'Restore 30 HP' },
    drink_m: { name: 'Energy Drink (M)', emoji: '🥤', type: 'consumable', hpRestore: 60, price: 120, desc: 'Restore 60 HP' },
    drink_l: { name: 'Energy Drink (L)', emoji: '🍹', type: 'consumable', hpRestore: 9999, price: 250, desc: 'Full HP restore' },
  };

  // ---- Weapon Definitions ----
  const WEAPONS = {
    iron_sword:   { name: 'Iron Sword',   emoji: '⚔️',  type: 'weapon', atk: 8,  critBonus: 0,    price: 400,  desc: '+8 ATK' },
    steel_sword:  { name: 'Steel Sword',  emoji: '🗡️',  type: 'weapon', atk: 18, critBonus: 0,    price: 1000, desc: '+18 ATK' },
    magic_staff:  { name: 'Magic Staff',  emoji: '🔮',  type: 'weapon', atk: 15, critBonus: 0.05, price: 1500, desc: '+15 ATK, +5% Crit' },
    dark_blade:   { name: 'Dark Blade',   emoji: '💀',  type: 'weapon', atk: 30, critBonus: 0.03, price: 3000, desc: '+30 ATK, +3% Crit' },
    dragon_blade: { name: 'Dragon Blade', emoji: '🔥',  type: 'weapon', atk: 50, critBonus: 0.05, price: 8000, desc: '+50 ATK, +5% Crit' },
  };

  // ---- Mob Definitions ----
  const MAX_LEVEL = 50;

  const MOB_TYPES = {
    slime: {
      name: 'Slime',
      hp: 30, atk: 3, speed: 30, detectRange: 80, atkRange: 20, atkCooldown: 1500,
      bitReward: 10, expReward: 5,
      color: '#44cc66', eyeColor: '#fff', size: 14,
    },
    goblin: {
      name: 'Goblin',
      hp: 70, atk: 8, speed: 50, detectRange: 110, atkRange: 22, atkCooldown: 1200,
      bitReward: 30, expReward: 12,
      color: '#8B4513', eyeColor: '#ff0', size: 16,
    },
    zombie: {
      name: 'Zombie',
      hp: 120, atk: 12, speed: 20, detectRange: 90, atkRange: 22, atkCooldown: 2200,
      bitReward: 45, expReward: 18,
      color: '#7a9a6a', eyeColor: '#f00', size: 17,
    },
    wolf: {
      name: 'Wolf',
      hp: 110, atk: 20, speed: 75, detectRange: 150, atkRange: 20, atkCooldown: 850,
      bitReward: 60, expReward: 25,
      color: '#8a8a8a', eyeColor: '#ff8800', size: 16,
    },
    orc: {
      name: 'Orc',
      hp: 280, atk: 30, speed: 35, detectRange: 140, atkRange: 26, atkCooldown: 1800,
      bitReward: 90, expReward: 35,
      color: '#556B2F', eyeColor: '#f44', size: 20,
    },
    skeleton: {
      name: 'Skeleton',
      hp: 200, atk: 28, speed: 50, detectRange: 160, atkRange: 24, atkCooldown: 1200,
      bitReward: 110, expReward: 45,
      color: '#e8e8d0', eyeColor: '#4af', size: 17,
    },
    dark_mage: {
      name: 'Dark Mage',
      hp: 180, atk: 40, speed: 55, detectRange: 170, atkRange: 24, atkCooldown: 1000,
      bitReward: 140, expReward: 60,
      color: '#5b21b6', eyeColor: '#f0f', size: 16,
    },
    golem: {
      name: 'Golem',
      hp: 700, atk: 42, speed: 18, detectRange: 120, atkRange: 28, atkCooldown: 2500,
      bitReward: 200, expReward: 80,
      color: '#7a6048', eyeColor: '#f80', size: 24,
    },
    vampire: {
      name: 'Vampire',
      hp: 340, atk: 55, speed: 65, detectRange: 180, atkRange: 22, atkCooldown: 850,
      bitReward: 240, expReward: 100,
      color: '#8b0000', eyeColor: '#f55', size: 18,
    },
    dragon: {
      name: 'Dragon',
      hp: 1500, atk: 90, speed: 32, detectRange: 200, atkRange: 30, atkCooldown: 1200,
      bitReward: 400, expReward: 150,
      color: '#cc2200', eyeColor: '#ff0', size: 26,
    },
  };

  // ---- Mob level spawn table ----
  const MOB_LEVEL_TABLE = [
    { type: 'slime',     minLv: 1,  maxLv: 8  },
    { type: 'goblin',    minLv: 3,  maxLv: 14 },
    { type: 'zombie',    minLv: 6,  maxLv: 20 },
    { type: 'wolf',      minLv: 10, maxLv: 26 },
    { type: 'orc',       minLv: 15, maxLv: 32 },
    { type: 'skeleton',  minLv: 20, maxLv: 38 },
    { type: 'dark_mage', minLv: 25, maxLv: 43 },
    { type: 'golem',     minLv: 30, maxLv: 48 },
    { type: 'vampire',   minLv: 35, maxLv: 50 },
    { type: 'dragon',    minLv: 40, maxLv: 50 },
  ];

  // ---- Spawn Zones (grass tiles, avoid paths/buildings/water) ----
  // We'll compute walkable spawn positions from MAP data
  let spawnPositions = [];

  function computeSpawnPositions(mapData, blocked) {
    spawnPositions = [];
    for (let y = 2; y < MAP_H - 2; y++) {
      for (let x = 2; x < MAP_W - 2; x++) {
        const tile = mapData[y][x];
        if (tile === 0 || tile === 8) { // grass or flower
          spawnPositions.push({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 });
        }
      }
    }
  }

  // ---- Mob Class ----
  class Mob {
    constructor(scene, type, x, y) {
      this.scene = scene;
      this.type = type;
      this.def = MOB_TYPES[type];
      this.hp = this.def.hp;
      this.maxHp = this.def.hp;
      this.x = x;
      this.y = y;
      this.spawnX = x;
      this.spawnY = y;
      this.state = 'idle'; // idle, chase, attack, return, dead
      this.atkTimer = 0;
      this.moveTimer = 0;
      this.wanderDir = { x: 0, y: 0 };
      this.dead = false;
      this.deathTime = 0;
      this.hitFlash = 0;

      // Create sprite (simple colored circle with eyes)
      this.createSprite(scene);
    }

    createSprite(scene) {
      const s = this.def.size;
      const key = `mob_${this.type}`;

      if (!scene.textures.exists(key)) {
        const canvas = document.createElement('canvas');
        // Dragon/Golem/DarkMage need extra canvas space for horns/hat/tall body
        const extraH = (this.type === 'dragon' || this.type === 'golem') ? Math.round(s * 0.6) :
                        (this.type === 'dark_mage') ? Math.round(s * 0.5) : 0;
        const extraW = (this.type === 'wolf') ? Math.round(s * 0.3) :
                        (this.type === 'dragon' || this.type === 'golem') ? Math.round(s * 0.3) : 0;
        canvas.width = s * 2 + extraW * 2;
        canvas.height = s * 2 + extraH;
        // Shift drawing origin down by extraH so top decorations aren't clipped
        const ox = extraW; // x offset
        const oy = extraH; // y offset
        const ctx = canvas.getContext('2d');
        ctx.translate(ox, oy);

        if (this.type === 'slime') {
          // Slime: 물방울+물결 일체형 젤리
          // 그림자
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.beginPath();
          ctx.ellipse(s, s * 2 - 3, s - 3, 3, 0, 0, Math.PI * 2);
          ctx.fill();
          // 몸통 하단 (넓적한 바닥)
          ctx.fillStyle = '#2aaa4a';
          ctx.beginPath();
          ctx.ellipse(s, s + 4, s - 3, s - 7, 0, 0, Math.PI * 2);
          ctx.fill();
          // 몸통 메인 (물방울)
          ctx.fillStyle = this.def.color;
          ctx.beginPath();
          ctx.moveTo(s, 3);
          ctx.bezierCurveTo(s + s - 3, 3, s + s - 2, s + 2, s, s + 6);
          ctx.bezierCurveTo(s - s + 2, s + 2, s - s + 3, 3, s, 3);
          ctx.fill();
          // 내부 광택
          ctx.fillStyle = 'rgba(255,255,255,0.22)';
          ctx.beginPath();
          ctx.ellipse(s - 3, s - 2, 4, 5, -0.3, 0, Math.PI * 2);
          ctx.fill();
          // 물결 무늬
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(s - 1, s + 1, 5, Math.PI * 0.3, Math.PI * 0.9);
          ctx.stroke();
          // 눈
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(s - 4, s + 1, 3.5, 0, Math.PI * 2);
          ctx.arc(s + 4, s + 1, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#1a6b30';
          ctx.beginPath();
          ctx.arc(s - 3, s + 2, 2, 0, Math.PI * 2);
          ctx.arc(s + 5, s + 2, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.arc(s - 3, s + 2, 1, 0, Math.PI * 2);
          ctx.arc(s + 5, s + 2, 1, 0, Math.PI * 2);
          ctx.fill();
          // 하이라이트 점
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.beginPath();
          ctx.arc(s - 4.5, s + 0.5, 1, 0, Math.PI * 2);
          ctx.arc(s + 3.5, s + 0.5, 1, 0, Math.PI * 2);
          ctx.fill();

        } else if (this.type === 'goblin') {
          // Goblin: 구부정한 2등신 소인, 단검 장착
          // 다리 (구부정)
          ctx.fillStyle = '#5a7a10';
          ctx.fillRect(s - 6, s + 5, 4, 7);
          ctx.fillRect(s + 2, s + 5, 4, 7);
          // 신발
          ctx.fillStyle = '#3a2a10';
          ctx.fillRect(s - 7, s + 11, 5, 3);
          ctx.fillRect(s + 2, s + 11, 5, 3);
          // 상체 (사다리꼴, 구부정)
          ctx.fillStyle = '#6B8E23';
          ctx.beginPath();
          ctx.moveTo(s - 7, s + 6);
          ctx.lineTo(s + 7, s + 6);
          ctx.lineTo(s + 5, s - 1);
          ctx.lineTo(s - 5, s - 1);
          ctx.closePath();
          ctx.fill();
          // 허리 벨트
          ctx.fillStyle = '#3a2a10';
          ctx.fillRect(s - 7, s + 4, 14, 2);
          // 팔 (왼쪽 단검 든 팔)
          ctx.fillStyle = '#6B8E23';
          ctx.fillRect(s - 11, s - 1, 5, 8);
          ctx.fillRect(s + 6, s - 1, 5, 8);
          // 단검
          ctx.fillStyle = '#aaa';
          ctx.fillRect(s - 12, s - 7, 2, 9);
          ctx.fillStyle = '#8B4513';
          ctx.fillRect(s - 13, s + 1, 4, 2);
          // 머리
          ctx.fillStyle = '#9ACD32';
          ctx.beginPath();
          ctx.arc(s, s - 5, 8, 0, Math.PI * 2);
          ctx.fill();
          // 귀
          ctx.fillStyle = '#9ACD32';
          ctx.beginPath();
          ctx.moveTo(s - 7, s - 7); ctx.lineTo(s - 13, s - 13); ctx.lineTo(s - 4, s - 9); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(s + 7, s - 7); ctx.lineTo(s + 13, s - 13); ctx.lineTo(s + 4, s - 9); ctx.fill();
          // 눈
          ctx.fillStyle = '#ff0';
          ctx.beginPath();
          ctx.arc(s - 3, s - 6, 2.2, 0, Math.PI * 2);
          ctx.arc(s + 3, s - 6, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.arc(s - 3, s - 5.5, 1.1, 0, Math.PI * 2);
          ctx.arc(s + 3, s - 5.5, 1.1, 0, Math.PI * 2);
          ctx.fill();
          // 이빨
          ctx.fillStyle = '#eee';
          ctx.fillRect(s - 2, s - 1, 2, 3);
          ctx.fillRect(s + 1, s - 1, 2, 3);

        } else if (this.type === 'orc') {
          // Orc: 역삼각형 근육질 체형, 철 갑옷 조각
          // 다리 (굵고 짧음)
          ctx.fillStyle = '#3a4a18';
          ctx.fillRect(s - 8, s + 5, 7, 9);
          ctx.fillRect(s + 1, s + 5, 7, 9);
          // 부츠
          ctx.fillStyle = '#222';
          ctx.fillRect(s - 9, s + 12, 8, 3);
          ctx.fillRect(s, s + 12, 8, 3);
          // 상체 (역삼각형)
          ctx.fillStyle = '#556B2F';
          ctx.beginPath();
          ctx.moveTo(s - 11, s + 5);
          ctx.lineTo(s + 11, s + 5);
          ctx.lineTo(s + 7, s - 3);
          ctx.lineTo(s - 7, s - 3);
          ctx.closePath();
          ctx.fill();
          // 갑옷 판
          ctx.fillStyle = '#5a5a5a';
          ctx.beginPath();
          ctx.moveTo(s - 8, s + 1);
          ctx.lineTo(s + 8, s + 1);
          ctx.lineTo(s + 6, s - 3);
          ctx.lineTo(s - 6, s - 3);
          ctx.closePath();
          ctx.fill();
          // 갑옷 중앙선
          ctx.strokeStyle = '#333';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(s, s - 3); ctx.lineTo(s, s + 1); ctx.stroke();
          // 어깨 갑옷 스파이크
          ctx.fillStyle = '#777';
          ctx.beginPath();
          ctx.moveTo(s - 11, s - 1); ctx.lineTo(s - 14, s - 6); ctx.lineTo(s - 8, s - 2); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(s + 11, s - 1); ctx.lineTo(s + 14, s - 6); ctx.lineTo(s + 8, s - 2); ctx.fill();
          // 팔 (굵음)
          ctx.fillStyle = '#556B2F';
          ctx.fillRect(s - 14, s - 2, 5, 9);
          ctx.fillRect(s + 9, s - 2, 5, 9);
          // 머리 (크고 각짐)
          ctx.fillStyle = '#6B8E23';
          ctx.beginPath();
          ctx.roundRect(s - 9, s - 15, 18, 14, 3);
          ctx.fill();
          // 어금니
          ctx.fillStyle = '#ffe';
          ctx.beginPath();
          ctx.moveTo(s - 5, s - 3); ctx.lineTo(s - 4, s + 3); ctx.lineTo(s - 2, s - 1); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(s + 5, s - 3); ctx.lineTo(s + 4, s + 3); ctx.lineTo(s + 2, s - 1); ctx.fill();
          // 눈
          ctx.fillStyle = '#f44';
          ctx.beginPath();
          ctx.arc(s - 4, s - 9, 3, 0, Math.PI * 2);
          ctx.arc(s + 4, s - 9, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#900';
          ctx.beginPath();
          ctx.arc(s - 4, s - 8.5, 1.5, 0, Math.PI * 2);
          ctx.arc(s + 4, s - 8.5, 1.5, 0, Math.PI * 2);
          ctx.fill();
          // 이마 주름
          ctx.strokeStyle = '#4a6a10';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(s - 4, s - 13); ctx.lineTo(s + 4, s - 13); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(s - 3, s - 11); ctx.lineTo(s + 3, s - 11); ctx.stroke();

        } else if (this.type === 'zombie') {
          // Zombie: 비틀린 자세, 한 팔 뻗음, 해진 옷
          // 다리 (비틀림, 하나는 구부러짐)
          ctx.fillStyle = '#4a5a3a';
          ctx.fillRect(s - 6, s + 5, 4, 9);
          ctx.save();
          ctx.translate(s + 4, s + 5);
          ctx.rotate(0.25);
          ctx.fillRect(0, 0, 4, 8);
          ctx.restore();
          // 신발 (너덜너덜)
          ctx.fillStyle = '#2a1a0a';
          ctx.fillRect(s - 7, s + 13, 6, 2);
          ctx.fillRect(s + 3, s + 12, 5, 2);
          // 몸통 (직사각, 찢긴 옷)
          ctx.fillStyle = '#5a7a4a';
          ctx.fillRect(s - 6, s - 2, 12, 8);
          // 찢긴 옷 텍스처
          ctx.fillStyle = '#4a6a3a';
          ctx.fillRect(s - 6, s + 1, 3, 2);
          ctx.fillRect(s + 3, s + 3, 4, 2);
          ctx.fillRect(s - 2, s + 5, 5, 2);
          // 피 자국
          ctx.fillStyle = 'rgba(180,0,0,0.55)';
          ctx.fillRect(s, s - 1, 2, 5);
          ctx.fillRect(s - 4, s + 2, 2, 4);
          // 왼팔 (앞으로 뻗음)
          ctx.fillStyle = '#5a7a4a';
          ctx.save();
          ctx.translate(s - 7, s - 2);
          ctx.rotate(-0.5);
          ctx.fillRect(-4, 0, 4, 9);
          ctx.restore();
          // 오른팔 (수직)
          ctx.fillStyle = '#5a7a4a';
          ctx.fillRect(s + 6, s - 2, 4, 8);
          // 머리
          ctx.fillStyle = '#7a9a6a';
          ctx.beginPath();
          ctx.arc(s, s - 6, 8, 0, Math.PI * 2);
          ctx.fill();
          // 부패 패치
          ctx.fillStyle = '#5a7a4a';
          ctx.beginPath();
          ctx.arc(s + 3, s - 4, 3, 0, Math.PI * 2);
          ctx.fill();
          // 눈 (한쪽만 빛남)
          ctx.fillStyle = '#f00';
          ctx.shadowBlur = 4; ctx.shadowColor = '#f00';
          ctx.beginPath();
          ctx.arc(s - 3, s - 7, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#555'; // 죽은 눈
          ctx.beginPath();
          ctx.arc(s + 3, s - 7, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#800';
          ctx.beginPath();
          ctx.arc(s - 3, s - 6.5, 1.2, 0, Math.PI * 2);
          ctx.fill();
          // 들쭉날쭉 입
          ctx.strokeStyle = '#333';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(s - 3, s - 2); ctx.lineTo(s - 1, s); ctx.lineTo(s + 1, s - 2); ctx.lineTo(s + 3, s); ctx.stroke();

        } else if (this.type === 'wolf') {
          // Wolf: 4족 동물 — 긴 몸통, 앞다리, 꼬리
          // 꼬리
          ctx.fillStyle = '#7a7a7a';
          ctx.beginPath();
          ctx.moveTo(s + 8, s + 2);
          ctx.quadraticCurveTo(s + s - 1, s - 4, s + s - 3, s - s + 5);
          ctx.quadraticCurveTo(s + s - 5, s - s + 4, s + 7, s - 1);
          ctx.closePath();
          ctx.fill();
          // 꼬리 끝 흰색
          ctx.fillStyle = '#ddd';
          ctx.beginPath();
          ctx.arc(s * 2 - 5, s - s + 5, 3, 0, Math.PI * 2);
          ctx.fill();
          // 몸통 (옆으로 긴 타원)
          ctx.fillStyle = '#8a8a8a';
          ctx.beginPath();
          ctx.ellipse(s, s + 3, s - 3, s - 7, 0, 0, Math.PI * 2);
          ctx.fill();
          // 배 (밝은 색)
          ctx.fillStyle = '#b0b0b0';
          ctx.beginPath();
          ctx.ellipse(s - 1, s + 5, s - 8, s - 12, 0, 0, Math.PI * 2);
          ctx.fill();
          // 뒷다리
          ctx.fillStyle = '#6a6a6a';
          ctx.fillRect(s + 3, s + 6, 4, 8);
          ctx.fillRect(s + 7, s + 9, 3, 5);
          // 앞다리
          ctx.fillStyle = '#7a7a7a';
          ctx.fillRect(s - 9, s + 4, 4, 9);
          ctx.fillRect(s - 5, s + 4, 4, 9);
          // 발
          ctx.fillStyle = '#555';
          ctx.fillRect(s - 10, s + 12, 5, 3);
          ctx.fillRect(s - 5, s + 12, 5, 3);
          ctx.fillRect(s + 3, s + 13, 4, 2);
          ctx.fillRect(s + 7, s + 13, 4, 2);
          // 목
          ctx.fillStyle = '#9a9a9a';
          ctx.beginPath();
          ctx.moveTo(s - 7, s); ctx.lineTo(s - 10, s - 5); ctx.lineTo(s - 2, s - 3); ctx.lineTo(s - 1, s); ctx.fill();
          // 머리
          ctx.fillStyle = '#8a8a8a';
          ctx.beginPath();
          ctx.arc(s - 6, s - 6, 8, 0, Math.PI * 2);
          ctx.fill();
          // 뾰족 귀
          ctx.fillStyle = '#8a8a8a';
          ctx.beginPath();
          ctx.moveTo(s - 11, s - 9); ctx.lineTo(s - 14, s - 16); ctx.lineTo(s - 7, s - 11); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(s - 2, s - 10); ctx.lineTo(s - 1, s - 17); ctx.lineTo(s + 3, s - 11); ctx.fill();
          ctx.fillStyle = '#c08080';
          ctx.beginPath();
          ctx.moveTo(s - 11, s - 10); ctx.lineTo(s - 12, s - 14); ctx.lineTo(s - 7, s - 12); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(s - 2, s - 11); ctx.lineTo(s - 1, s - 15); ctx.lineTo(s + 2, s - 12); ctx.fill();
          // 주둥이
          ctx.fillStyle = '#a0a0a0';
          ctx.beginPath();
          ctx.ellipse(s - 5, s - 3, 5, 3.5, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#444';
          ctx.beginPath();
          ctx.ellipse(s - 5, s - 4, 2.5, 2, 0, 0, Math.PI * 2);
          ctx.fill();
          // 눈
          ctx.fillStyle = '#ff8800';
          ctx.beginPath();
          ctx.arc(s - 9, s - 7, 2.5, 0, Math.PI * 2);
          ctx.arc(s - 3, s - 7, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.arc(s - 9, s - 6.5, 1.2, 0, Math.PI * 2);
          ctx.arc(s - 3, s - 6.5, 1.2, 0, Math.PI * 2);
          ctx.fill();

        } else if (this.type === 'skeleton') {
          // Skeleton: 뼈대 직접 묘사 (척추+갈비+팔다리)
          // 다리뼈
          ctx.strokeStyle = '#d8d8c0';
          ctx.lineWidth = 3;
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(s - 3, s + 5); ctx.lineTo(s - 4, s + 14); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(s + 3, s + 5); ctx.lineTo(s + 4, s + 14); ctx.stroke();
          // 발뼈
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(s - 4, s + 14); ctx.lineTo(s - 8, s + 14); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(s + 4, s + 14); ctx.lineTo(s + 8, s + 14); ctx.stroke();
          // 골반뼈
          ctx.fillStyle = '#c8c8b0';
          ctx.beginPath();
          ctx.arc(s, s + 5, 5, 0, Math.PI, true);
          ctx.fill();
          ctx.strokeStyle = '#a8a890'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(s, s + 5, 5, 0, Math.PI, true); ctx.stroke();
          // 척추
          ctx.strokeStyle = '#d0d0b8';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(s, s + 4); ctx.lineTo(s, s - 4); ctx.stroke();
          // 갈비뼈 (3쌍)
          ctx.strokeStyle = '#c8c8b0';
          ctx.lineWidth = 1.5;
          for (let i = 0; i < 3; i++) {
            const ry = s - 1 + i * 2.5;
            ctx.beginPath();
            ctx.moveTo(s, ry);
            ctx.quadraticCurveTo(s - 7, ry - 1, s - 7, ry + 1.5);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(s, ry);
            ctx.quadraticCurveTo(s + 7, ry - 1, s + 7, ry + 1.5);
            ctx.stroke();
          }
          // 팔뼈
          ctx.strokeStyle = '#d0d0b8'; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.moveTo(s - 7, s - 3); ctx.lineTo(s - 12, s + 2); ctx.lineTo(s - 10, s + 8); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(s + 7, s - 3); ctx.lineTo(s + 12, s + 2); ctx.lineTo(s + 10, s + 8); ctx.stroke();
          // 쇄골
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(s - 6, s - 3); ctx.lineTo(s + 6, s - 3); ctx.stroke();
          // 두개골
          ctx.fillStyle = '#e8e8d0';
          ctx.beginPath();
          ctx.arc(s, s - 10, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#c0c0a8'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(s, s - 10, 9, 0, Math.PI * 2); ctx.stroke();
          // 관자놀이 균열
          ctx.strokeStyle = '#aaa890'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(s - 6, s - 16); ctx.lineTo(s - 4, s - 12); ctx.stroke();
          // 안와
          ctx.fillStyle = '#4af';
          ctx.shadowBlur = 5; ctx.shadowColor = '#4af';
          ctx.beginPath();
          ctx.arc(s - 3.5, s - 11, 3.2, 0, Math.PI * 2);
          ctx.arc(s + 3.5, s - 11, 3.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#0a1a33';
          ctx.beginPath();
          ctx.arc(s - 3.5, s - 11, 1.6, 0, Math.PI * 2);
          ctx.arc(s + 3.5, s - 11, 1.6, 0, Math.PI * 2);
          ctx.fill();
          // 이빨
          ctx.fillStyle = '#e8e8d0';
          for (let i = -2; i <= 2; i++) {
            ctx.fillRect(s + i * 2.0, s - 4.5, 1.6, 2.5);
          }
          ctx.fillStyle = '#555';
          for (let i = -1; i <= 1; i++) {
            ctx.fillRect(s + i * 2.0 + 1.6, s - 4.5, 0.8, 2);
          }

        } else if (this.type === 'dark_mage') {
          // Dark Mage: 뾰족 마법사 모자 + 긴 로브 + 지팡이
          // 지팡이 (오른쪽)
          ctx.strokeStyle = '#5b3a8a';
          ctx.lineWidth = 2.5;
          ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(s + 10, s + 12); ctx.lineTo(s + 8, s - 12); ctx.stroke();
          // 지팡이 오브
          ctx.fillStyle = '#7b3ab6';
          ctx.beginPath();
          ctx.arc(s + 8, s - 13, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#f0f';
          ctx.shadowBlur = 8; ctx.shadowColor = '#f0f';
          ctx.beginPath();
          ctx.arc(s + 8, s - 13, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          // 로브 (사다리꼴, 항아리형)
          ctx.fillStyle = '#2a0a6a';
          ctx.beginPath();
          ctx.moveTo(s - 8, s - 2);
          ctx.lineTo(s + 8, s - 2);
          ctx.bezierCurveTo(s + 11, s + 5, s + 10, s + 12, s + 7, s + 15);
          ctx.lineTo(s - 7, s + 15);
          ctx.bezierCurveTo(s - 10, s + 12, s - 11, s + 5, s - 8, s - 2);
          ctx.closePath();
          ctx.fill();
          // 로브 하단 지그재그
          ctx.fillStyle = '#4a1a9a';
          for (let i = 0; i < 5; i++) {
            ctx.beginPath();
            ctx.moveTo(s - 7 + i * 3.5, s + 15);
            ctx.lineTo(s - 5.5 + i * 3.5, s + 13);
            ctx.lineTo(s - 4 + i * 3.5, s + 15);
            ctx.fill();
          }
          // 로브 장식 선
          ctx.strokeStyle = '#7b3ab6';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(s, s - 2); ctx.lineTo(s, s + 12);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(s - 4, s + 2); ctx.lineTo(s + 4, s + 2);
          ctx.stroke();
          // 팔 (로브 안에서 약간 나옴)
          ctx.fillStyle = '#2a0a6a';
          ctx.fillRect(s - 11, s - 2, 4, 8);
          // 왼손 (보라빛 마법 파티클)
          ctx.fillStyle = 'rgba(200,50,255,0.5)';
          ctx.shadowBlur = 6; ctx.shadowColor = '#f0f';
          ctx.beginPath();
          ctx.arc(s - 10, s + 7, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          // 머리 (피부)
          ctx.fillStyle = '#d4a0c0';
          ctx.beginPath();
          ctx.arc(s, s - 7, 7, 0, Math.PI * 2);
          ctx.fill();
          // 발광 눈
          ctx.fillStyle = '#f0f';
          ctx.shadowBlur = 5; ctx.shadowColor = '#f0f';
          ctx.beginPath();
          ctx.arc(s - 3, s - 8, 2.2, 0, Math.PI * 2);
          ctx.arc(s + 3, s - 8, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          // 모자 (뾰족, 챙 포함)
          ctx.fillStyle = '#1a0050';
          ctx.beginPath();
          ctx.moveTo(s, s - 23); // 꼭대기
          ctx.lineTo(s + 8, s - 12);
          ctx.lineTo(s - 8, s - 12);
          ctx.closePath();
          ctx.fill();
          // 모자 챙
          ctx.fillStyle = '#1a0050';
          ctx.beginPath();
          ctx.ellipse(s, s - 13, 10, 3, 0, 0, Math.PI * 2);
          ctx.fill();
          // 모자 장식 버클
          ctx.fillStyle = '#f0c030';
          ctx.fillRect(s - 2, s - 15, 4, 3);
          ctx.fillStyle = '#000';
          ctx.fillRect(s - 1, s - 14.5, 2, 2);

        } else if (this.type === 'golem') {
          // Golem: 사각형 바위 몸통, 굵은 팔, 이음새
          // 다리 (사각형 돌 기둥)
          ctx.fillStyle = '#5a4030';
          ctx.fillRect(s - 10, s + 5, 8, 10);
          ctx.fillRect(s + 2, s + 5, 8, 10);
          // 다리 이음새
          ctx.strokeStyle = '#3a2010';
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(s - 10, s + 9); ctx.lineTo(s - 2, s + 9); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(s + 2, s + 9); ctx.lineTo(s + 10, s + 9); ctx.stroke();
          // 발 (더 넓음)
          ctx.fillStyle = '#4a3020';
          ctx.fillRect(s - 11, s + 14, 10, 3);
          ctx.fillRect(s + 1, s + 14, 10, 3);
          // 몸통 (굵은 사각형)
          ctx.fillStyle = '#6a5038';
          ctx.fillRect(s - 11, s - 4, 22, 10);
          // 몸통 균열
          ctx.strokeStyle = '#3a2010';
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(s - 8, s - 4); ctx.lineTo(s - 5, s + 2); ctx.lineTo(s + 3, s); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(s + 7, s - 2); ctx.lineTo(s + 5, s + 4); ctx.stroke();
          // 몸통 음영 (입체감)
          ctx.fillStyle = 'rgba(0,0,0,0.18)';
          ctx.fillRect(s + 5, s - 4, 6, 10);
          // 팔 (사각형, 매우 굵음)
          ctx.fillStyle = '#5a4030';
          ctx.fillRect(s - 17, s - 4, 7, 12);
          ctx.fillRect(s + 10, s - 4, 7, 12);
          // 팔 이음새
          ctx.strokeStyle = '#3a2010'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(s - 17, s + 3); ctx.lineTo(s - 10, s + 3); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(s + 10, s + 3); ctx.lineTo(s + 17, s + 3); ctx.stroke();
          // 주먹
          ctx.fillStyle = '#4a3020';
          ctx.fillRect(s - 18, s + 7, 9, 6);
          ctx.fillRect(s + 9, s + 7, 9, 6);
          // 머리 (사각형, 크고 납작)
          ctx.fillStyle = '#7a6048';
          ctx.fillRect(s - 10, s - 17, 20, 14);
          // 머리 균열
          ctx.strokeStyle = '#3a2010'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(s - 3, s - 17); ctx.lineTo(s, s - 12); ctx.lineTo(s + 5, s - 14); ctx.stroke();
          // 발광 눈 (사각형)
          ctx.fillStyle = '#f80';
          ctx.shadowBlur = 10; ctx.shadowColor = '#f80';
          ctx.fillRect(s - 8, s - 13, 6, 5);
          ctx.fillRect(s + 2, s - 13, 6, 5);
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#ff4400';
          ctx.fillRect(s - 6, s - 12, 3, 3);
          ctx.fillRect(s + 3, s - 12, 3, 3);
          // 콧구멍
          ctx.fillStyle = '#3a2010';
          ctx.fillRect(s - 2, s - 7, 2, 2);
          ctx.fillRect(s + 1, s - 7, 2, 2);

        } else if (this.type === 'vampire') {
          // Vampire: 망토 활짝 펼침 + 연미복 스타일
          // 망토 그림자
          ctx.fillStyle = '#220000';
          ctx.beginPath();
          ctx.moveTo(s, s - 4);
          ctx.bezierCurveTo(s - s + 1, s - 2, s - s, s + 8, s - s + 2, s + 15);
          ctx.lineTo(s, s + 6);
          ctx.lineTo(s + s - 2, s + 15);
          ctx.bezierCurveTo(s + s, s + 8, s + s - 1, s - 2, s, s - 4);
          ctx.fill();
          // 망토 안쪽 (붉은빛)
          ctx.fillStyle = '#550000';
          ctx.beginPath();
          ctx.moveTo(s - 5, s - 2);
          ctx.bezierCurveTo(s - 9, s + 2, s - 8, s + 10, s - 5, s + 14);
          ctx.lineTo(s + 5, s + 14);
          ctx.bezierCurveTo(s + 8, s + 10, s + 9, s + 2, s + 5, s - 2);
          ctx.closePath();
          ctx.fill();
          // 망토 V자 칼라
          ctx.fillStyle = '#cc0020';
          ctx.beginPath();
          ctx.moveTo(s - 6, s - 3);
          ctx.lineTo(s, s + 2);
          ctx.lineTo(s + 6, s - 3);
          ctx.lineTo(s + 3, s - 4);
          ctx.lineTo(s, s - 1);
          ctx.lineTo(s - 3, s - 4);
          ctx.closePath();
          ctx.fill();
          // 몸통 (연미복)
          ctx.fillStyle = '#1a0000';
          ctx.beginPath();
          ctx.moveTo(s - 5, s - 3);
          ctx.lineTo(s + 5, s - 3);
          ctx.lineTo(s + 4, s + 6);
          ctx.lineTo(s - 4, s + 6);
          ctx.closePath();
          ctx.fill();
          // 흰 셔츠
          ctx.fillStyle = '#eee';
          ctx.beginPath();
          ctx.moveTo(s - 2, s - 3);
          ctx.lineTo(s + 2, s - 3);
          ctx.lineTo(s + 1, s + 4);
          ctx.lineTo(s - 1, s + 4);
          ctx.closePath();
          ctx.fill();
          // 타이
          ctx.fillStyle = '#cc0000';
          ctx.beginPath();
          ctx.moveTo(s - 1, s - 1);
          ctx.lineTo(s + 1, s - 1);
          ctx.lineTo(s + 0.5, s + 4);
          ctx.lineTo(s, s + 5);
          ctx.lineTo(s - 0.5, s + 4);
          ctx.closePath();
          ctx.fill();
          // 팔 (망토 안에서 뻗음)
          ctx.fillStyle = '#1a0000';
          ctx.fillRect(s - 9, s - 2, 5, 7);
          ctx.fillRect(s + 4, s - 2, 5, 7);
          // 손
          ctx.fillStyle = '#c0a080';
          ctx.beginPath();
          ctx.arc(s - 6, s + 6, 3, 0, Math.PI * 2);
          ctx.arc(s + 6, s + 6, 3, 0, Math.PI * 2);
          ctx.fill();
          // 머리 (창백)
          ctx.fillStyle = '#c8a888';
          ctx.beginPath();
          ctx.arc(s, s - 8, 8, 0, Math.PI * 2);
          ctx.fill();
          // 뾰족 검은 머리
          ctx.fillStyle = '#111';
          ctx.beginPath();
          ctx.arc(s, s - 12, 8, Math.PI * 1.1, Math.PI * 2.0);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(s - 2, s - 14); ctx.lineTo(s - 5, s - 19); ctx.lineTo(s + 1, s - 14); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(s + 2, s - 15); ctx.lineTo(s + 6, s - 20); ctx.lineTo(s + 4, s - 14); ctx.fill();
          // 눈 (붉은 발광)
          ctx.fillStyle = '#f55';
          ctx.shadowBlur = 5; ctx.shadowColor = '#f00';
          ctx.beginPath();
          ctx.arc(s - 3, s - 9, 2.5, 0, Math.PI * 2);
          ctx.arc(s + 3, s - 9, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#900';
          ctx.beginPath();
          ctx.arc(s - 3, s - 8.5, 1, 0, Math.PI * 2);
          ctx.arc(s + 3, s - 8.5, 1, 0, Math.PI * 2);
          ctx.fill();
          // 송곳니
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.moveTo(s - 2, s - 4); ctx.lineTo(s - 1.5, s); ctx.lineTo(s - 0.2, s - 4); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(s + 0.2, s - 4); ctx.lineTo(s + 1.5, s); ctx.lineTo(s + 2, s - 4); ctx.fill();

        } else if (this.type === 'dragon') {
          // Dragon: 날개 활짝, 비늘 몸통, 뿔
          // 날개 (좌우 비막)
          ctx.fillStyle = '#771100';
          // 왼쪽 날개
          ctx.beginPath();
          ctx.moveTo(s - 5, s - 3);
          ctx.bezierCurveTo(s - 14, s - 10, s - s + 2, s - 8, s - s + 1, s + 3);
          ctx.bezierCurveTo(s - s + 3, s + 6, s - 12, s + 4, s - 6, s + 1);
          ctx.closePath();
          ctx.fill();
          // 오른쪽 날개
          ctx.beginPath();
          ctx.moveTo(s + 5, s - 3);
          ctx.bezierCurveTo(s + 14, s - 10, s + s - 2, s - 8, s + s - 1, s + 3);
          ctx.bezierCurveTo(s + s - 3, s + 6, s + 12, s + 4, s + 6, s + 1);
          ctx.closePath();
          ctx.fill();
          // 날개 뼈대
          ctx.strokeStyle = '#cc3300';
          ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(s - 5, s - 3); ctx.bezierCurveTo(s - 10, s - 7, s - s + 3, s - 5, s - s + 2, s + 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(s - 5, s - 1); ctx.lineTo(s - 12, s + 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(s + 5, s - 3); ctx.bezierCurveTo(s + 10, s - 7, s + s - 3, s - 5, s + s - 2, s + 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(s + 5, s - 1); ctx.lineTo(s + 12, s + 2); ctx.stroke();
          // 꼬리
          ctx.fillStyle = '#aa2200';
          ctx.beginPath();
          ctx.moveTo(s, s + 12);
          ctx.bezierCurveTo(s - 3, s + 14, s - 6, s + 16, s - 4, s + 18);
          ctx.bezierCurveTo(s - 2, s + 20, s + 2, s + 18, s + 1, s + 15);
          ctx.bezierCurveTo(s + 3, s + 13, s + 4, s + 11, s, s + 12);
          ctx.fill();
          // 몸통 (굵은 원통형)
          ctx.fillStyle = '#cc2200';
          ctx.beginPath();
          ctx.ellipse(s, s + 4, s - 6, s - 6, 0, 0, Math.PI * 2);
          ctx.fill();
          // 비늘 (겹쳐진 반원들)
          ctx.fillStyle = '#aa1a00';
          for (let row = 0; row < 3; row++) {
            for (let col = 0; col < 3; col++) {
              ctx.beginPath();
              ctx.arc(s - 6 + col * 6, s - 1 + row * 5, 4, Math.PI, 0);
              ctx.fill();
            }
          }
          // 배 비늘 (밝은 색)
          ctx.fillStyle = '#ee6633';
          ctx.beginPath();
          ctx.ellipse(s, s + 5, 5, 7, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#dd4422';
          ctx.strokeStyle = '#bb3300';
          ctx.lineWidth = 0.5;
          for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            ctx.arc(s + i * 4, s + 4, 2.5, Math.PI, 0);
            ctx.fill();
            ctx.stroke();
          }
          // 다리
          ctx.fillStyle = '#aa2200';
          ctx.fillRect(s - 9, s + 10, 6, 7);
          ctx.fillRect(s + 3, s + 10, 6, 7);
          // 발톱
          ctx.fillStyle = '#888';
          ctx.beginPath();
          ctx.moveTo(s - 9, s + 17); ctx.lineTo(s - 11, s + 20); ctx.lineTo(s - 8, s + 17); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(s - 6, s + 17); ctx.lineTo(s - 7, s + 20); ctx.lineTo(s - 4, s + 17); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(s + 3, s + 17); ctx.lineTo(s + 2, s + 20); ctx.lineTo(s + 5, s + 17); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(s + 7, s + 17); ctx.lineTo(s + 8, s + 20); ctx.lineTo(s + 10, s + 17); ctx.fill();
          // 목
          ctx.fillStyle = '#cc2200';
          ctx.beginPath();
          ctx.moveTo(s - 6, s - 3);
          ctx.lineTo(s - 7, s - 9);
          ctx.lineTo(s + 7, s - 9);
          ctx.lineTo(s + 6, s - 3);
          ctx.closePath();
          ctx.fill();
          // 머리
          ctx.fillStyle = '#dd3300';
          ctx.beginPath();
          ctx.roundRect(s - 10, s - 22, 20, 14, 2);
          ctx.fill();
          // 뿔 (2개)
          ctx.fillStyle = '#661100';
          ctx.beginPath();
          ctx.moveTo(s - 7, s - 21); ctx.lineTo(s - 11, s - 28); ctx.lineTo(s - 4, s - 20); ctx.fill();
          ctx.beginPath();
          ctx.moveTo(s + 7, s - 21); ctx.lineTo(s + 11, s - 28); ctx.lineTo(s + 4, s - 20); ctx.fill();
          // 머리 비늘 줄
          ctx.strokeStyle = '#bb2200'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(s - 10, s - 16); ctx.lineTo(s + 10, s - 16); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(s - 9, s - 13); ctx.lineTo(s + 9, s - 13); ctx.stroke();
          // 콧구멍 + 불꽃
          ctx.fillStyle = '#661100';
          ctx.fillRect(s - 4, s - 11, 3, 2);
          ctx.fillRect(s + 1, s - 11, 3, 2);
          ctx.fillStyle = 'rgba(255,140,0,0.7)';
          ctx.shadowBlur = 6; ctx.shadowColor = '#f80';
          ctx.beginPath(); ctx.ellipse(s - 2, s - 8, 2, 3, -0.3, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(s + 2, s - 8, 2, 3, 0.3, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          // 눈 (크고 발광)
          ctx.fillStyle = '#ff0';
          ctx.shadowBlur = 7; ctx.shadowColor = '#ff0';
          ctx.beginPath();
          ctx.arc(s - 5, s - 17, 3.5, 0, Math.PI * 2);
          ctx.arc(s + 5, s - 17, 3.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#cc0000';
          ctx.beginPath();
          ctx.arc(s - 5, s - 17, 1.8, 0, Math.PI * 2);
          ctx.arc(s + 5, s - 17, 1.8, 0, Math.PI * 2);
          ctx.fill();

        } else {
          // Fallback: generic enemy
          ctx.fillStyle = this.def.color;
          ctx.beginPath();
          ctx.arc(s, s, s - 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = this.def.eyeColor;
          ctx.beginPath();
          ctx.arc(s - 4, s - 2, 3, 0, Math.PI * 2);
          ctx.arc(s + 4, s - 2, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.arc(s - 4, s - 1, 1.5, 0, Math.PI * 2);
          ctx.arc(s + 4, s - 1, 1.5, 0, Math.PI * 2);
          ctx.fill();
        }

        scene.textures.addCanvas(key, canvas);
      }

      this.sprite = scene.add.image(this.x, this.y, key);
      this.sprite.setDepth(this.y);
      this.sprite.setAlpha(1);

      // HP bar background
      this.hpBarBg = scene.add.rectangle(this.x, this.y - this.def.size - 6, 24, 4, 0x333333);
      this.hpBarBg.setDepth(99990);
      this.hpBarBg.setAlpha(0.7);

      // HP bar fill
      this.hpBar = scene.add.rectangle(this.x - 12, this.y - this.def.size - 6, 24, 4, 0x44cc44);
      this.hpBar.setOrigin(0, 0.5);
      this.hpBar.setDepth(99991);

      // Name label
      this.label = scene.add.text(this.x, this.y - this.def.size - 12, this.def.name, {
        fontSize: '9px', fontFamily: 'Arial, sans-serif', fontStyle: 'bold',
        color: '#ff8888', stroke: '#000', strokeThickness: 2,
      });
      this.label.setOrigin(0.5);
      this.label.setDepth(99992);
    }

    update(time, delta, playerX, playerY) {
      if (this.dead) return;

      const dist = Phaser.Math.Distance.Between(this.x, this.y, playerX, playerY);
      const spawnDist = Phaser.Math.Distance.Between(this.x, this.y, this.spawnX, this.spawnY);

      // State machine
      switch (this.state) {
        case 'idle':
          // Wander randomly
          this.moveTimer -= delta;
          if (this.moveTimer <= 0) {
            this.wanderDir = { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2 };
            this.moveTimer = 1500 + Math.random() * 2000;
          }
          this.x += this.wanderDir.x * this.def.speed * delta / 1000 * 0.3;
          this.y += this.wanderDir.y * this.def.speed * delta / 1000 * 0.3;

          // Detect player
          if (dist < this.def.detectRange) {
            this.state = 'chase';
          }

          // Don't wander too far from spawn
          if (spawnDist > 100) {
            this.state = 'return';
          }
          break;

        case 'chase':
          // Move toward player
          const angle = Math.atan2(playerY - this.y, playerX - this.x);
          this.x += Math.cos(angle) * this.def.speed * delta / 1000;
          this.y += Math.sin(angle) * this.def.speed * delta / 1000;

          if (dist < this.def.atkRange) {
            this.state = 'attack';
          } else if (dist > this.def.detectRange * 2 || spawnDist > 200) {
            this.state = 'return';
          }
          break;

        case 'attack':
          // Attack player
          this.atkTimer -= delta;
          if (this.atkTimer <= 0) {
            if (dist <= this.def.atkRange * 1.5) {
              TownMobs.onMobAttack(this.def.atk, this);
              this.atkTimer = this.def.atkCooldown;
            }
          }
          // Chase again if player moves away
          if (dist > this.def.atkRange * 2) {
            this.state = 'chase';
          }
          // Return if too far from spawn
          if (spawnDist > 200) {
            this.state = 'return';
          }
          break;

        case 'return':
          // Move back to spawn point
          const retAngle = Math.atan2(this.spawnY - this.y, this.spawnX - this.x);
          this.x += Math.cos(retAngle) * this.def.speed * delta / 1000 * 1.5;
          this.y += Math.sin(retAngle) * this.def.speed * delta / 1000 * 1.5;
          this.hp = Math.min(this.maxHp, this.hp + delta / 1000 * 5); // Regen while returning

          if (spawnDist < 20) {
            this.state = 'idle';
            this.hp = this.maxHp;
          }
          // Re-detect player while returning
          if (dist < this.def.detectRange * 0.7) {
            this.state = 'chase';
          }
          break;
      }

      // Clamp to map bounds
      const margin = TILE;
      this.x = Phaser.Math.Clamp(this.x, margin, MAP_W * TILE - margin);
      this.y = Phaser.Math.Clamp(this.y, margin, MAP_H * TILE - margin);

      // Update visuals
      this.sprite.setPosition(this.x, this.y);
      this.sprite.setDepth(this.y);

      // Hit flash effect
      if (this.hitFlash > 0) {
        this.hitFlash -= delta;
        this.sprite.setTint(0xff4444);
      } else {
        this.sprite.clearTint();
      }

      // HP bar
      const hpRatio = Math.max(0, this.hp / this.maxHp);
      this.hpBar.setSize(24 * hpRatio, 4);
      this.hpBar.setPosition(this.x - 12, this.y - this.def.size - 6);
      this.hpBarBg.setPosition(this.x, this.y - this.def.size - 6);
      const hpColor = hpRatio > 0.5 ? 0x44cc44 : (hpRatio > 0.25 ? 0xcccc44 : 0xcc4444);
      this.hpBar.setFillStyle(hpColor);

      this.label.setPosition(this.x, this.y - this.def.size - 12);
    }

    takeDamage(amount) {
      if (this.dead) return false;
      this.hp -= amount;
      this.hitFlash = 150;

      // Show damage number
      const dmgText = this.scene.add.text(this.x + (Math.random() - 0.5) * 16, this.y - this.def.size - 16, `-${amount}`, {
        fontSize: '12px', fontFamily: 'Arial', fontStyle: 'bold',
        color: '#ff4444', stroke: '#000', strokeThickness: 2,
      });
      dmgText.setOrigin(0.5);
      dmgText.setDepth(99999);
      this.scene.tweens.add({
        targets: dmgText,
        y: dmgText.y - 20,
        alpha: 0,
        duration: 600,
        onComplete: () => dmgText.destroy(),
      });

      if (this.hp <= 0) {
        this.die();
        return true; // killed
      }

      // Switch to chase if hit while idle
      if (this.state === 'idle') {
        this.state = 'chase';
      }
      return false;
    }

    die() {
      this.dead = true;
      this.deathTime = Date.now();

      // Death animation
      this.scene.tweens.add({
        targets: this.sprite,
        alpha: 0, scaleX: 0.3, scaleY: 0.3,
        duration: 400,
        onComplete: () => {
          this.sprite.setVisible(false);
        },
      });
      this.hpBar.setVisible(false);
      this.hpBarBg.setVisible(false);
      this.label.setVisible(false);

      // BIT reward popup
      const rewardText = this.scene.add.text(this.x, this.y - 10, `+${this.def.bitReward} BIT`, {
        fontSize: '13px', fontFamily: 'Arial', fontStyle: 'bold',
        color: '#f5c542', stroke: '#000', strokeThickness: 3,
      });
      rewardText.setOrigin(0.5);
      rewardText.setDepth(99999);
      this.scene.tweens.add({
        targets: rewardText,
        y: rewardText.y - 30,
        alpha: 0,
        duration: 1200,
        onComplete: () => rewardText.destroy(),
      });

      // EXP popup
      const expText = this.scene.add.text(this.x, this.y - 24, `+${this.def.expReward} EXP`, {
        fontSize: '10px', fontFamily: 'Arial', fontStyle: 'bold',
        color: '#88ccff', stroke: '#000', strokeThickness: 2,
      });
      expText.setOrigin(0.5);
      expText.setDepth(99999);
      this.scene.tweens.add({
        targets: expText,
        y: expText.y - 25,
        alpha: 0,
        duration: 1000,
        delay: 200,
        onComplete: () => expText.destroy(),
      });
    }

    respawn() {
      // Pick new spawn position
      if (spawnPositions.length > 0) {
        const pos = spawnPositions[Math.floor(Math.random() * spawnPositions.length)];
        this.x = pos.x;
        this.y = pos.y;
        this.spawnX = pos.x;
        this.spawnY = pos.y;
      }
      this.hp = this.maxHp;
      this.dead = false;
      this.state = 'idle';
      this.sprite.setVisible(true);
      this.sprite.setAlpha(1);
      this.sprite.setScale(1);
      this.sprite.clearTint();
      this.hpBar.setVisible(true);
      this.hpBarBg.setVisible(true);
      this.label.setVisible(true);
    }

    destroy() {
      if (this.sprite) this.sprite.destroy();
      if (this.hpBar) this.hpBar.destroy();
      if (this.hpBarBg) this.hpBarBg.destroy();
      if (this.label) this.label.destroy();
    }
  }

  // ======================== TownMobs Controller ========================
  const TownMobs = {
    enabled: false,
    scene: null,
    mobs: [],
    maxMobs: 8,
    spawnInterval: 5000, // ms
    spawnTimer: 0,
    respawnDelay: 8000, // ms
    afkTimer: 0,
    afkTimeout: 300000, // 5 min
    lastMoveTime: 0,

    // Player combat stats (modifiable by equipment later)
    playerStats: {
      atk: 10,
      critRate: 0.05,
      critDmg: 1.5,
      atkSpd: 0.8, // seconds
      def: 0,
      hp: 100,
      maxHp: 100,
      level: 1,
    },
    playerHp: 100,
    playerMaxHp: 100,
    atkCooldown: 0,
    hpRegen: 2, // HP per second
    regenTimer: 0,
    playerDead: false,
    deathTimer: 0,
    deathDuration: 3000,

    // BIT balance (client cache)
    bitBalance: 0,
    inventory: [],

    // Callbacks
    _onHpChange: null,
    _onBitChange: null,
    _onDeath: null,
    _onWeaponLoaded: null,
    _onLevelUp: null,

    init(scene, mapData, blocked) {
      this.scene = scene;
      computeSpawnPositions(mapData, blocked);

      // Load hunt mode from localStorage
      this.enabled = localStorage.getItem('town_hunt_mode') === 'true';

      // Load player data from server
      this.loadPlayerData();
    },

    async loadPlayerData() {
      try {
        const addr = typeof getActiveBtctAddr === 'function' ? getActiveBtctAddr() : '';
        if (!addr) return;
        const data = await fetch(`/api/town/player/${addr}`).then(r => r.json());
        if (data.btct_address) {
          this.bitBalance = Number(data.bit_balance) || 0;
          this.playerStats.level = data.level || 1;
          this.playerStats.atk = data.atk || 10;
          this.playerStats.def = data.def || 0;
          this.playerStats.maxHp = data.max_hp || 100;
          this.playerStats.hp = this.playerStats.maxHp;
          this.playerHp = this.playerStats.maxHp;
          this.playerMaxHp = this.playerStats.maxHp;
          this.inventory = data.inventory || [];
          this.equippedWeapon = data.weapon_id || null;
          // Apply weapon crit bonus
          const wpDef = data.weapon_id ? WEAPONS[data.weapon_id] : null;
          this.playerStats.critRate = 0.05 + (wpDef ? (wpDef.critBonus || 0) : 0);
          if (this._onBitChange) this._onBitChange(this.bitBalance);
          if (this._onHpChange) this._onHpChange(this.playerHp, this.playerMaxHp);
          this.updateHUD();
          // Notify scene to refresh weapon on character sprite
          if (this._onWeaponLoaded) this._onWeaponLoaded(data.weapon_id || null);
        }
      } catch (e) {
        console.warn('[Mob] loadPlayerData:', e.message);
      }
    },

    toggle() {
      this.enabled = !this.enabled;
      localStorage.setItem('town_hunt_mode', this.enabled);
      if (!this.enabled) {
        this.destroyAllMobs();
      }
      this.updateHUD();
      return this.enabled;
    },

    update(time, delta) {
      if (!this.enabled || !this.scene || !this.scene.player) return;

      const playerX = this.scene.player.x;
      const playerY = this.scene.player.y;

      // AFK check
      const isMoving = this.scene.player.body && (this.scene.player.body.velocity.x !== 0 || this.scene.player.body.velocity.y !== 0);
      if (isMoving) {
        this.lastMoveTime = time;
        this.afkTimer = 0;
      } else {
        this.afkTimer += delta;
      }

      const isAfk = this.afkTimer > this.afkTimeout;

      // Spawn mobs
      if (!isAfk && !this.playerDead) {
        this.spawnTimer -= delta;
        if (this.spawnTimer <= 0 && this.getAliveMobs().length < this.maxMobs) {
          this.spawnMob();
          this.spawnTimer = this.spawnInterval;
        }
      }

      // Update mobs
      for (const mob of this.mobs) {
        if (!mob.dead) {
          mob.update(time, delta, playerX, playerY);
        } else {
          // Respawn dead mobs after delay
          if (Date.now() - mob.deathTime > this.respawnDelay && !isAfk) {
            mob.respawn();
          }
        }
      }

      // Player HP regen
      if (!this.playerDead && this.playerHp < this.playerMaxHp) {
        this.regenTimer += delta;
        if (this.regenTimer >= 1000) {
          this.regenTimer -= 1000;
          this.playerHp = Math.min(this.playerMaxHp, this.playerHp + this.hpRegen);
          if (this._onHpChange) this._onHpChange(this.playerHp, this.playerMaxHp);
          this.updateHpBar();
        }
      }

      // Player death timer
      if (this.playerDead) {
        this.deathTimer -= delta;
        if (this.deathTimer <= 0) {
          this.respawnPlayer();
        }
      }

      // Attack cooldown
      if (this.atkCooldown > 0) this.atkCooldown -= delta / 1000;
    },

    spawnMob() {
      if (spawnPositions.length === 0) return;

      const pos = spawnPositions[Math.floor(Math.random() * spawnPositions.length)];

      // Random type based on player level (level table)
      const level = this.playerStats.level;
      const eligible = MOB_LEVEL_TABLE.filter(m => level >= m.minLv && level <= m.maxLv + 5);
      const pool = eligible.length > 0 ? eligible : [{ type: 'slime' }];
      const type = pool[Math.floor(Math.random() * pool.length)].type;

      const mob = new Mob(this.scene, type, pos.x, pos.y);
      this.mobs.push(mob);
    },

    getAliveMobs() {
      return this.mobs.filter(m => !m.dead);
    },

    // Player attacks (called when pressing 1 key)
    playerAttack() {
      if (this.playerDead || !this.enabled || this.atkCooldown > 0) return;
      if (!this.scene || !this.scene.player) return;

      this.atkCooldown = this.playerStats.atkSpd;

      const px = this.scene.player.x;
      const py = this.scene.player.y;
      const atkRange = 40;

      // Attack animation — slash effect
      this.showSlashEffect(px, py);

      // Find mobs in range
      let hit = false;
      for (const mob of this.mobs) {
        if (mob.dead) continue;
        const dist = Phaser.Math.Distance.Between(px, py, mob.x, mob.y);
        if (dist <= atkRange) {
          // Calculate damage
          let dmg = this.playerStats.atk;
          let isCrit = false;

          if (Math.random() < this.playerStats.critRate) {
            dmg = Math.round(dmg * this.playerStats.critDmg);
            isCrit = true;
          }

          const killed = mob.takeDamage(dmg);

          if (isCrit) {
            this.showCritText(mob.x, mob.y - 20);
          }

          if (killed) {
            this.onMobKilled(mob);
          }
          hit = true;
        }
      }

      // Play sound
      if (typeof TownSounds !== 'undefined') {
        TownSounds.playInteraction();
      }
    },

    showSlashEffect(px, py) {
      if (!this.scene) return;
      const slash = this.scene.add.text(px + 16, py - 8, '⚔️', {
        fontSize: '20px',
      });
      slash.setOrigin(0.5);
      slash.setDepth(99999);
      this.scene.tweens.add({
        targets: slash,
        alpha: 0, angle: 45, scaleX: 1.5, scaleY: 1.5,
        duration: 300,
        onComplete: () => slash.destroy(),
      });
    },

    showCritText(x, y) {
      if (!this.scene) return;
      const crit = this.scene.add.text(x, y, 'CRIT!', {
        fontSize: '14px', fontFamily: 'Arial', fontStyle: 'bold',
        color: '#ff6600', stroke: '#000', strokeThickness: 3,
      });
      crit.setOrigin(0.5);
      crit.setDepth(99999);
      this.scene.tweens.add({
        targets: crit,
        y: crit.y - 20, alpha: 0, scaleX: 1.3, scaleY: 1.3,
        duration: 700,
        onComplete: () => crit.destroy(),
      });
    },

    async onMobKilled(mob) {
      const bits = mob.def.bitReward;
      const exp = mob.def.expReward;

      // Update local cache
      this.bitBalance += bits;
      if (this._onBitChange) this._onBitChange(this.bitBalance);
      this.updateHUD();

      // Send to server
      try {
        const addr = typeof getActiveBtctAddr === 'function' ? getActiveBtctAddr() : '';
        if (!addr) return;
        const result = await fetch('/api/town/reward', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: addr, bits, exp }),
        }).then(r => r.json());

        if (result.levelUp) {
          this.playerStats.level = result.level;
          this.playerStats.maxHp = result.max_hp || (100 + (result.level - 1) * 10);
          this.playerStats.atk = result.atk || (10 + (result.level - 1) * 2);
          this.playerStats.def = (result.def !== undefined) ? result.def : Math.floor((result.level - 1) * 0.8);
          this.playerMaxHp = this.playerStats.maxHp;
          this.playerHp = this.playerMaxHp;
          if (this._onHpChange) this._onHpChange(this.playerHp, this.playerMaxHp);
          if (this._onLevelUp) this._onLevelUp(result.level);
          this.showLevelUpEffect();
          this.updateHUD();
        }
        // Max level (Lv.50) reward
        if (result.maxLevel) {
          setTimeout(() => {
            if (typeof townShowToast === 'function')
              townShowToast('🏆 MAX LEVEL! +5000 BIT & ✨ Golden Aura unlocked!', 6000);
          }, 500);
          // Unlock Golden Aura button
          const auraBtn = document.getElementById('char-type-aura-btn');
          if (auraBtn) {
            auraBtn.disabled = false;
            auraBtn.style.opacity = '1';
            auraBtn.style.cursor = 'pointer';
            const lock = document.getElementById('aura-lock');
            if (lock) lock.remove();
          }
        }
        // Sync server balance
        if (result.bit_balance !== undefined) {
          this.bitBalance = Number(result.bit_balance);
          if (this._onBitChange) this._onBitChange(this.bitBalance);
          this.updateHUD();
        }
      } catch (e) {
        console.warn('[Mob] reward error:', e.message);
      }
    },

    showLevelUpEffect() {
      if (!this.scene || !this.scene.player) return;
      const px = this.scene.player.x;
      const py = this.scene.player.y;

      const lvlText = this.scene.add.text(px, py - 40, `⬆ LEVEL ${this.playerStats.level}!`, {
        fontSize: '16px', fontFamily: 'Arial', fontStyle: 'bold',
        color: '#f5c542', stroke: '#000', strokeThickness: 3,
      });
      lvlText.setOrigin(0.5);
      lvlText.setDepth(99999);
      this.scene.tweens.add({
        targets: lvlText,
        y: lvlText.y - 40, alpha: 0, scaleX: 1.3, scaleY: 1.3,
        duration: 2000,
        onComplete: () => lvlText.destroy(),
      });

      // Particle burst
      for (let i = 0; i < 12; i++) {
        const star = this.scene.add.text(px, py, '✨', { fontSize: '14px' });
        star.setDepth(99999);
        const angle = (i / 12) * Math.PI * 2;
        this.scene.tweens.add({
          targets: star,
          x: px + Math.cos(angle) * 50,
          y: py + Math.sin(angle) * 50,
          alpha: 0,
          duration: 800,
          ease: 'Power2',
          onComplete: () => star.destroy(),
        });
      }
    },

    // Called when a mob attacks the player
    onMobAttack(damage, mob) {
      if (this.playerDead) return;

      const actualDmg = Math.max(1, damage - this.playerStats.def);
      this.playerHp -= actualDmg;

      // Flash player sprite
      if (this.scene && this.scene.player) {
        this.scene.player.setTint(0xff4444);
        this.scene.time.delayedCall(150, () => {
          if (this.scene && this.scene.player) this.scene.player.clearTint();
        });

        // Damage number on player
        const px = this.scene.player.x;
        const py = this.scene.player.y;
        const dmgText = this.scene.add.text(px + (Math.random() - 0.5) * 16, py - 30, `-${actualDmg}`, {
          fontSize: '11px', fontFamily: 'Arial', fontStyle: 'bold',
          color: '#ff6666', stroke: '#000', strokeThickness: 2,
        });
        dmgText.setOrigin(0.5);
        dmgText.setDepth(99999);
        this.scene.tweens.add({
          targets: dmgText,
          y: dmgText.y - 18, alpha: 0,
          duration: 500,
          onComplete: () => dmgText.destroy(),
        });
      }

      if (this.playerHp <= 0) {
        this.playerHp = 0;
        this.playerDie();
      }

      if (this._onHpChange) this._onHpChange(this.playerHp, this.playerMaxHp);
      this.updateHpBar();
    },

    playerDie() {
      this.playerDead = true;
      this.deathTimer = this.deathDuration;

      if (this.scene && this.scene.player) {
        this.scene.player.setTint(0x444444);
        this.scene.player.setAlpha(0.5);
      }

      // Death text
      if (this.scene) {
        const px = this.scene.player ? this.scene.player.x : 400;
        const py = this.scene.player ? this.scene.player.y : 300;
        const deathText = this.scene.add.text(px, py - 30, '💀 YOU DIED', {
          fontSize: '16px', fontFamily: 'Arial', fontStyle: 'bold',
          color: '#e94560', stroke: '#000', strokeThickness: 3,
        });
        deathText.setOrigin(0.5);
        deathText.setDepth(99999);
        this.scene.tweens.add({
          targets: deathText,
          y: deathText.y - 25, alpha: 0,
          duration: 2500,
          onComplete: () => deathText.destroy(),
        });
      }

      // Report death to server
      try {
        const addr = typeof getActiveBtctAddr === 'function' ? getActiveBtctAddr() : '';
        if (addr) {
          fetch('/api/town/death', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: addr }),
          });
        }
      } catch (e) { /* ignore */ }

      if (this._onDeath) this._onDeath();
    },

    respawnPlayer() {
      this.playerDead = false;
      this.playerHp = this.playerMaxHp;
      if (this.scene && this.scene.player) {
        this.scene.player.clearTint();
        this.scene.player.setAlpha(1);
        // Move to spawn
        this.scene.player.setPosition(15 * TILE + TILE / 2, 15 * TILE + TILE / 2);
      }
      if (this._onHpChange) this._onHpChange(this.playerHp, this.playerMaxHp);
      this.updateHpBar();
    },

    // Use consumable
    async useItem(itemId) {
      const item = ITEMS[itemId];
      if (!item || item.type !== 'consumable') return;

      const owned = this.inventory.find(i => i.item_id === itemId);
      if (!owned || owned.quantity <= 0) {
        if (typeof townShowToast === 'function') townShowToast('You don\'t have this item!', 2000);
        return;
      }

      // Apply effect
      if (item.hpRestore) {
        this.playerHp = Math.min(this.playerMaxHp, this.playerHp + item.hpRestore);
        if (this._onHpChange) this._onHpChange(this.playerHp, this.playerMaxHp);
        this.updateHpBar();

        // Visual feedback
        if (this.scene && this.scene.player) {
          const healText = this.scene.add.text(this.scene.player.x, this.scene.player.y - 30, `+${Math.min(item.hpRestore, this.playerMaxHp)} HP`, {
            fontSize: '12px', fontFamily: 'Arial', fontStyle: 'bold',
            color: '#44ff44', stroke: '#000', strokeThickness: 2,
          });
          healText.setOrigin(0.5);
          healText.setDepth(99999);
          this.scene.tweens.add({
            targets: healText,
            y: healText.y - 20, alpha: 0,
            duration: 800,
            onComplete: () => healText.destroy(),
          });
        }
      }

      // Server: consume item
      try {
        const addr = typeof getActiveBtctAddr === 'function' ? getActiveBtctAddr() : '';
        await fetch('/api/town/item/use', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: addr, itemId }),
        });
        // Update local inventory
        owned.quantity--;
        if (owned.quantity <= 0) {
          this.inventory = this.inventory.filter(i => i.item_id !== itemId);
        }
        this.updateHUD();
      } catch (e) { console.warn('[Mob] useItem error:', e.message); }
    },

    // Buy from shop
    async buyItem(itemId) {
      const item = ITEMS[itemId];
      if (!item) return;
      if (this.bitBalance < item.price) {
        if (typeof townShowToast === 'function') townShowToast('Not enough BIT!', 2000);
        return;
      }

      try {
        const addr = typeof getActiveBtctAddr === 'function' ? getActiveBtctAddr() : '';
        const result = await fetch('/api/town/shop/buy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: addr, itemId, price: item.price }),
        }).then(r => r.json());

        if (result.error) {
          if (typeof townShowToast === 'function') townShowToast(result.error, 2000);
          return;
        }

        this.bitBalance = Number(result.bit_balance);
        this.inventory = result.inventory || [];
        if (this._onBitChange) this._onBitChange(this.bitBalance);
        this.updateHUD();
        if (typeof townShowToast === 'function') townShowToast(`Bought ${item.emoji} ${item.name}!`, 2000);
      } catch (e) {
        console.warn('[Mob] buyItem error:', e.message);
      }
    },

    destroyAllMobs() {
      for (const mob of this.mobs) {
        mob.destroy();
      }
      this.mobs = [];
    },

    // ---- HUD Updates ----
    updateHUD() {
      // BIT display
      const bitEl = document.getElementById('bit-display');
      if (bitEl) bitEl.textContent = this.bitBalance.toLocaleString() + ' BIT';

      // Level display
      const lvlEl = document.getElementById('level-display');
      if (lvlEl) lvlEl.textContent = 'Lv.' + this.playerStats.level;

      // Hunt mode button
      const huntBtn = document.getElementById('hunt-toggle-btn');
      if (huntBtn) {
        if (this.enabled) {
          huntBtn.classList.add('hunt-active');
          huntBtn.title = 'Hunt Mode ON';
        } else {
          huntBtn.classList.remove('hunt-active');
          huntBtn.title = 'Hunt Mode OFF';
        }
      }

      // Inventory counts — quick slot
      const drinkBtn = document.getElementById('quick-drink');
      if (drinkBtn) {
        const owned = this.inventory.find(i => i.item_id === 'drink_s');
        drinkBtn.textContent = `🧃 ${owned ? owned.quantity : 0}`;
        drinkBtn.disabled = !owned || owned.quantity <= 0;
      }
    },

    // Create in-game HP bar above player sprite
    createPlayerHpBar(scene) {
      this._hpBarBg = scene.add.rectangle(0, 0, 30, 5, 0x222222);
      this._hpBarBg.setOrigin(0.5);
      this._hpBarBg.setDepth(100000);
      this._hpBarBg.setAlpha(0.7);
      this._hpBarBg.setStrokeStyle(0.5, 0x4ecca3, 0.4);

      this._hpBarFill = scene.add.rectangle(0, 0, 30, 5, 0x44cc44);
      this._hpBarFill.setOrigin(0.5);
      this._hpBarFill.setDepth(100001);

      this._hpBarText = scene.add.text(0, 0, '', {
        fontSize: '7px', fontFamily: 'Arial, sans-serif', fontStyle: 'bold',
        color: '#fff', stroke: '#000', strokeThickness: 1,
      });
      this._hpBarText.setOrigin(0.5);
      this._hpBarText.setDepth(100002);

      this._hpBarVisible = false;
      this._setHpBarVisible(false);
    },

    _setHpBarVisible(v) {
      this._hpBarVisible = v;
      if (this._hpBarBg) this._hpBarBg.setVisible(v);
      if (this._hpBarFill) this._hpBarFill.setVisible(v);
      if (this._hpBarText) this._hpBarText.setVisible(v);
    },

    // Call every frame from town.js update()
    updatePlayerHpBarPos(x, y) {
      const show = this.enabled;
      if (show !== this._hpBarVisible) this._setHpBarVisible(show);
      if (!show) return;
      const barY = y - 32;
      if (this._hpBarBg) this._hpBarBg.setPosition(x, barY);
      if (this._hpBarFill) this._hpBarFill.setPosition(x, barY);
      if (this._hpBarText) this._hpBarText.setPosition(x, barY);
    },

    updateHpBar() {
      const ratio = Math.max(0, this.playerHp / this.playerMaxHp);
      if (this._hpBarFill) {
        this._hpBarFill.setSize(30 * ratio, 5);
        const color = ratio > 0.5 ? 0x44cc44 : (ratio > 0.25 ? 0xcccc44 : 0xcc4444);
        this._hpBarFill.setFillStyle(color);
      }
      if (this._hpBarText) {
        this._hpBarText.setText(`${Math.max(0, Math.round(this.playerHp))}/${this.playerMaxHp}`);
      }
    },

    getItemDef(itemId) {
      return ITEMS[itemId] || WEAPONS[itemId] || null;
    },

    getShopItems(tab) {
      if (tab === 'weapons') return Object.entries(WEAPONS).map(([id, w]) => ({ id, ...w }));
      return Object.entries(ITEMS).map(([id, item]) => ({ id, ...item }));
    },

    // ---- Item Market ----
    async getMarketListings() {
      try {
        const addr = typeof getActiveBtctAddr === 'function' ? getActiveBtctAddr() : '';
        const r = await fetch(`/api/town/market?address=${encodeURIComponent(addr)}`);
        return r.ok ? await r.json() : [];
      } catch (e) { return []; }
    },

    async listItemForSale(itemId, itemType, priceBit) {
      const addr = typeof getActiveBtctAddr === 'function' ? getActiveBtctAddr() : '';
      if (!addr) { if (typeof townShowToast === 'function') townShowToast('Wallet not connected', 2000); return null; }
      try {
        const r = await fetch('/api/town/market/list', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: addr, itemId, itemType, priceBit })
        });
        const data = await r.json();
        if (!r.ok) { if (typeof townShowToast === 'function') townShowToast(data.error || 'Failed', 2500); return null; }
        this.inventory = data.inventory;
        if (data.weapon_id !== undefined) this.equippedWeapon = data.weapon_id || null;
        if (this._onBitChange) this._onBitChange(this.bitBalance);
        if (typeof townShowToast === 'function') townShowToast('📦 Listed on market!', 2000);
        return data;
      } catch (e) { console.warn('[Market] list error:', e.message); return null; }
    },

    async buyMarketItem(listingId) {
      const addr = typeof getActiveBtctAddr === 'function' ? getActiveBtctAddr() : '';
      if (!addr) { if (typeof townShowToast === 'function') townShowToast('Wallet not connected', 2000); return null; }
      try {
        const r = await fetch(`/api/town/market/buy/${listingId}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: addr })
        });
        const data = await r.json();
        if (!r.ok) { if (typeof townShowToast === 'function') townShowToast(data.error || 'Purchase failed', 2500); return null; }
        this.bitBalance = Number(data.bit_balance);
        this.inventory = data.inventory;
        if (this._onBitChange) this._onBitChange(this.bitBalance);
        if (typeof townShowToast === 'function') townShowToast('✅ Purchased! Check your inventory.', 2500);
        return data;
      } catch (e) { console.warn('[Market] buy error:', e.message); return null; }
    },

    async cancelMarketListing(listingId) {
      const addr = typeof getActiveBtctAddr === 'function' ? getActiveBtctAddr() : '';
      if (!addr) return null;
      try {
        const r = await fetch(`/api/town/market/cancel/${listingId}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: addr })
        });
        const data = await r.json();
        if (!r.ok) { if (typeof townShowToast === 'function') townShowToast(data.error || 'Cancel failed', 2500); return null; }
        this.inventory = data.inventory;
        const prevWeapon = this.equippedWeapon;
        this.equippedWeapon = data.weapon_id || null;
        // playerStats 재반영
        if (data.atk !== undefined) this.playerStats.atk = Number(data.atk);
        if (data.def !== undefined) this.playerStats.def = Number(data.def);
        const wDef = this.equippedWeapon ? WEAPONS[this.equippedWeapon] : null;
        this.playerStats.critRate = 0.05 + (wDef ? (wDef.critBonus || 0) : 0);
        this.updateHUD();
        if (this._onBitChange) this._onBitChange(this.bitBalance);
        // 무기 변경 시 쮨릭 업데이트
        if (this._onWeaponLoaded && this.equippedWeapon !== prevWeapon) {
          this._onWeaponLoaded(this.equippedWeapon);
        }
        if (typeof townShowToast === 'function') townShowToast('↩️ Listing cancelled', 2000);
        return data;
      } catch (e) { console.warn('[Market] cancel error:', e.message); return null; }
    },

    async equipWeaponFromInventory(weaponId) {
      const addr = typeof getActiveBtctAddr === 'function' ? getActiveBtctAddr() : '';
      if (!addr) return null;
      try {
        const r = await fetch('/api/town/weapon/equip', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: addr, weaponId })
        });
        const data = await r.json();
        if (!r.ok) { if (typeof townShowToast === 'function') townShowToast(data.error || 'Equip failed', 2500); return null; }
        const prevWeapon = this.equippedWeapon;
        this.equippedWeapon = weaponId;
        this.playerStats.atk = Number(data.atk);
        this.playerStats.def = Number(data.def);
        const wDef = WEAPONS[weaponId];
        this.playerStats.critRate = 0.05 + (wDef ? (wDef.critBonus || 0) : 0);
        this.inventory = data.inventory;
        if (this._onBitChange) this._onBitChange(this.bitBalance);
        this.updateHUD();
        // 텍스처 변경 + 다른 플레이어에게 broadcast (_onWeaponLoaded 콜백)
        if (this._onWeaponLoaded) this._onWeaponLoaded(weaponId);
        if (typeof townShowToast === 'function') townShowToast(`⚔️ Equipped ${wDef ? wDef.emoji + ' ' + wDef.name : weaponId}!`, 2500);
        return { ...data, prevWeapon };
      } catch (e) { console.warn('[Market] equip error:', e.message); return null; }
    },

    getEquippedWeapon() {
      return this.equippedWeapon ? (WEAPONS[this.equippedWeapon] || null) : null;
    },

    async buyWeapon(weaponId) {
      const w = WEAPONS[weaponId];
      if (!w) return;
      const addr = typeof getActiveBtctAddr === 'function' ? getActiveBtctAddr() : '';
      if (!addr) { if (typeof townShowToast === 'function') townShowToast('Wallet not connected', 2000); return; }
      try {
        const result = await fetch('/api/town/weapon/buy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: addr, weaponId }),
        }).then(r => r.json());
        if (result.error) {
          if (typeof townShowToast === 'function') townShowToast(result.error, 2500);
          return;
        }
        this.inventory = result.inventory || this.inventory;
        this.bitBalance = Number(result.bit_balance);
        if (this._onBitChange) this._onBitChange(this.bitBalance);
        this.updateHUD();
        if (typeof townShowToast === 'function') townShowToast(`${w.emoji} ${w.name} added to inventory! Equip it from the Items tab.`, 3000);
        return result;
      } catch (e) {
        console.warn('[Mob] buyWeapon error:', e.message);
      }
    },

    // ---- Stats Modal ----
    async openStatsModal() {
      const modal = document.getElementById('stats-modal');
      const content = document.getElementById('stats-content');
      if (!modal || !content) return;
      modal.classList.remove('hidden');
      content.innerHTML = '<div style="text-align:center;color:rgba(255,255,255,0.4);font-size:13px;padding:20px 0;">Loading...</div>';

      const addr = typeof getActiveBtctAddr === 'function' ? getActiveBtctAddr() : '';
      if (!addr) {
        content.innerHTML = '<div style="text-align:center;color:rgba(255,80,80,0.8);font-size:13px;padding:20px 0;">Wallet not connected</div>';
        return;
      }

      try {
        const data = await fetch(`/api/town/player/${addr}`).then(r => r.json());
        const lvl = data.level || 1;
        const exp = Number(data.exp) || 0;
        const expForLevel = 100 * lvl * (lvl - 1);  // cumulative EXP at start of this level
        const expNeeded = 200 * lvl;                 // EXP needed for this level
        const expThisLevel = exp - expForLevel;
        const expPercent = Math.min(100, (expThisLevel / expNeeded) * 100);
        const kills = data.mobs_killed || 0;
        const deaths = data.deaths || 0;
        const bits = Number(data.bit_balance) || 0;
        const hp = this.playerHp;
        const maxHp = data.max_hp || 100;
        const atk = data.atk || 10;
        const def = data.def || 0;
        const crit = Math.round((this.playerStats.critRate || 0.05) * 100);
        const spd = this.playerStats.atkSpd || 0.8;
        const inv = data.inventory || [];
        const equippedId = data.weapon_id || null;
        const equippedDef = equippedId ? this.getItemDef(equippedId) : null;

        // Equipment 섹션 HTML
        const equipHtml = `
          <div class="stats-equip-row">
            <div class="stats-equip-slot ${equippedDef ? 'occupied' : 'empty'}">
              <span class="stats-equip-slot-label">⚔️ Weapon</span>
              ${equippedDef ? `
                <div class="stats-equip-item-info">
                  <span class="stats-equip-item-name">${equippedDef.emoji} ${equippedDef.name}</span>
                  <span class="stats-equip-item-bonus">${equippedDef.desc}</span>
                </div>
                <button class="stats-inv-use stats-unequip-btn" onclick="statsUnequipWeapon()">Unequip</button>
              ` : `<span class="stats-equip-empty">— None —</span>`}
            </div>
          </div>`;

        // Inventory: 소모품 + 비장착 무기 모두 포함
        const invItems = inv.filter(slot => slot.quantity > 0);
        let invHtml = '';
        if (invItems.length === 0) {
          invHtml = '<div class="stats-empty-inv">Inventory is empty</div>';
        } else {
          invHtml = '<div class="stats-inv-list">';
          invItems.forEach(slot => {
            const def2 = this.getItemDef(slot.item_id);
            if (!def2) return;
            const isWeapon = def2.type === 'weapon';
            const actionBtn = isWeapon
              ? `<button class="stats-inv-use" style="background:#4a1f9a;" onclick="statsEquipWeapon('${slot.item_id}')">Equip</button>`
              : `<button class="stats-inv-use" onclick="TownMobs.useItem('${slot.item_id}');TownMobs.openStatsModal();">\u25b6 Use</button>`;
            invHtml += `<div class="stats-inv-item">
              <span class="stats-inv-name">${def2.emoji} ${def2.name}</span>
              <span class="stats-inv-qty">×${slot.quantity}</span>
              ${actionBtn}
            </div>`;
          });
          invHtml += '</div>';
        }

        content.innerHTML = `
          <!-- EXP -->
          <div class="stats-section-title">Experience</div>
          <div class="stats-exp-wrap">
            <span class="stats-exp-label">Lv.${lvl}</span>
            <div class="stats-exp-bar-bg">
              <div class="stats-exp-bar-fill" style="width:${expPercent}%"></div>
            </div>
            <span class="stats-exp-text">${expThisLevel}/${expNeeded}</span>
          </div>
          <hr class="stats-divider">

          <!-- Vitals -->
          <div class="stats-section-title">Vitals &amp; Combat</div>
          <div class="stats-grid">
            <div class="stats-cell">
              <span class="stats-cell-icon">❤️</span>
              <span class="stats-cell-label">HP</span>
              <span class="stats-cell-value">${Math.max(0,Math.round(hp))} / ${maxHp}</span>
            </div>
            <div class="stats-cell">
              <span class="stats-cell-icon">⚔️</span>
              <span class="stats-cell-label">ATK</span>
              <span class="stats-cell-value">${atk}</span>
            </div>
            <div class="stats-cell">
              <span class="stats-cell-icon">🎯</span>
              <span class="stats-cell-label">CRIT</span>
              <span class="stats-cell-value">${crit}%</span>
            </div>
            <div class="stats-cell">
              <span class="stats-cell-icon">🛡️</span>
              <span class="stats-cell-label">DEF</span>
              <span class="stats-cell-value">${def}</span>
            </div>
            <div class="stats-cell">
              <span class="stats-cell-icon">⚡</span>
              <span class="stats-cell-label">SPD</span>
              <span class="stats-cell-value">${spd}s</span>
            </div>
          </div>
          <hr class="stats-divider">

          <!-- Battle Record -->
          <div class="stats-section-title">Battle Record</div>
          <div class="stats-battle-row">
            <div class="stats-battle-cell">
              <span class="stats-battle-icon">🏆</span>
              <span class="stats-battle-label">Kills</span>
              <span class="stats-battle-value">${kills.toLocaleString()}</span>
            </div>
            <div class="stats-battle-cell">
              <span class="stats-battle-icon">💀</span>
              <span class="stats-battle-label">Deaths</span>
              <span class="stats-battle-value">${deaths.toLocaleString()}</span>
            </div>
            <div class="stats-battle-cell">
              <span class="stats-battle-icon">💰</span>
              <span class="stats-battle-label">BIT</span>
              <span class="stats-battle-value" style="color:#f5c542">${bits.toLocaleString()}</span>
            </div>
          </div>
          <hr class="stats-divider">

          <!-- Equipment -->
          <div class="stats-section-title">Equipment</div>
          ${equipHtml}
          <hr class="stats-divider">

          <!-- Inventory -->
          <div class="stats-section-title">Inventory</div>
          ${invHtml}
        `;
      } catch (e) {
        content.innerHTML = '<div style="text-align:center;color:rgba(255,80,80,0.8);font-size:13px;padding:16px 0;">Failed to load stats</div>';
      }
    },

    closeStatsModal() {
      const modal = document.getElementById('stats-modal');
      if (modal) modal.classList.add('hidden');
    },
  };

  // ---- Expose globally ----
  window.TownMobs = TownMobs;
  window.MOB_TYPES = MOB_TYPES;
  window.ITEMS = ITEMS;
  window.openStatsModal = () => TownMobs.openStatsModal();
  window.closeStatsModal = () => TownMobs.closeStatsModal();
  window.statsUnequipWeapon = async () => {
    const addr = typeof getActiveBtctAddr === 'function' ? getActiveBtctAddr() : '';
    if (!addr) return;
    try {
      const r = await fetch('/api/town/weapon/unequip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: addr })
      }).then(res => res.json());
      if (r.error) { alert(r.error); return; }
      TownMobs.equippedWeapon = null;
      TownMobs.playerStats.atk = r.atk;
      TownMobs.inventory = r.inventory || TownMobs.inventory;
      if (TownMobs._onWeaponLoaded) TownMobs._onWeaponLoaded(null);
      const s = window.game && game.scene && game.scene.scenes.find(sc => sc.myCharConfig);
      if (s && s.player) {
        s.myCharConfig.weapon = null;
        const k = getOrCreateCharTexture(s, s.myCharConfig);
        s.player.setTexture(k, 0);
        playCharAnim(s.player, 'down');
        if (window.socket && socket.connected) socket.emit('townCharUpdate', { character: s.myCharConfig });
      }
      TownMobs.openStatsModal();
    } catch (e) { alert('Failed to unequip'); }
  };

  window.statsEquipWeapon = async (weaponId) => {
    const r = await TownMobs.equipWeaponFromInventory(weaponId);
    if (!r) return;
    const s = window.game && game.scene && game.scene.scenes.find(sc => sc.myCharConfig);
    if (s && s.player) {
      s.myCharConfig.weapon = weaponId;
      const k = getOrCreateCharTexture(s, s.myCharConfig);
      s.player.setTexture(k, 0);
      playCharAnim(s.player, 'down');
      // broadcast 안전장치 (_onWeaponLoaded 콜백이 실행됐지만 emit 실패 시 대비)
      if (window.socket && socket.connected) {
        socket.emit('townCharUpdate', { character: s.myCharConfig });
      }
    }
    TownMobs.openStatsModal();
  };

})();
