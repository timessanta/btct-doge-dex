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

  // ---- Mob Definitions ----
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
    orc: {
      name: 'Orc',
      hp: 150, atk: 18, speed: 35, detectRange: 140, atkRange: 26, atkCooldown: 2000,
      bitReward: 80, expReward: 30,
      color: '#556B2F', eyeColor: '#f44', size: 20,
    },
  };

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
        canvas.width = s * 2;
        canvas.height = s * 2;
        const ctx = canvas.getContext('2d');

        if (this.type === 'slime') {
          // Slime: jiggly blob
          ctx.fillStyle = this.def.color;
          ctx.beginPath();
          ctx.ellipse(s, s + 2, s - 2, s - 4, 0, 0, Math.PI * 2);
          ctx.fill();
          // Highlight
          ctx.fillStyle = 'rgba(255,255,255,0.3)';
          ctx.beginPath();
          ctx.ellipse(s - 3, s - 2, 4, 3, -0.3, 0, Math.PI * 2);
          ctx.fill();
          // Eyes
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(s - 4, s, 3, 0, Math.PI * 2);
          ctx.arc(s + 4, s, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#222';
          ctx.beginPath();
          ctx.arc(s - 3, s + 1, 1.5, 0, Math.PI * 2);
          ctx.arc(s + 5, s + 1, 1.5, 0, Math.PI * 2);
          ctx.fill();
        } else if (this.type === 'goblin') {
          // Goblin: small humanoid
          ctx.fillStyle = '#6B8E23';
          ctx.beginPath();
          ctx.ellipse(s, s + 2, s - 3, s - 2, 0, 0, Math.PI * 2);
          ctx.fill();
          // Head
          ctx.fillStyle = '#9ACD32';
          ctx.beginPath();
          ctx.arc(s, s - 4, 7, 0, Math.PI * 2);
          ctx.fill();
          // Ears
          ctx.fillStyle = '#9ACD32';
          ctx.beginPath();
          ctx.moveTo(s - 8, s - 6);
          ctx.lineTo(s - 12, s - 12);
          ctx.lineTo(s - 5, s - 8);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(s + 8, s - 6);
          ctx.lineTo(s + 12, s - 12);
          ctx.lineTo(s + 5, s - 8);
          ctx.fill();
          // Eyes
          ctx.fillStyle = '#ff0';
          ctx.beginPath();
          ctx.arc(s - 3, s - 5, 2, 0, Math.PI * 2);
          ctx.arc(s + 3, s - 5, 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.arc(s - 3, s - 4.5, 1, 0, Math.PI * 2);
          ctx.arc(s + 3, s - 4.5, 1, 0, Math.PI * 2);
          ctx.fill();
        } else if (this.type === 'orc') {
          // Orc: large brute
          ctx.fillStyle = '#556B2F';
          ctx.beginPath();
          ctx.ellipse(s, s + 2, s - 1, s, 0, 0, Math.PI * 2);
          ctx.fill();
          // Head
          ctx.fillStyle = '#6B8E23';
          ctx.beginPath();
          ctx.arc(s, s - 6, 9, 0, Math.PI * 2);
          ctx.fill();
          // Tusks
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.moveTo(s - 5, s - 1);
          ctx.lineTo(s - 4, s + 4);
          ctx.lineTo(s - 2, s);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(s + 5, s - 1);
          ctx.lineTo(s + 4, s + 4);
          ctx.lineTo(s + 2, s);
          ctx.fill();
          // Eyes
          ctx.fillStyle = '#f44';
          ctx.beginPath();
          ctx.arc(s - 4, s - 7, 2.5, 0, Math.PI * 2);
          ctx.arc(s + 4, s - 7, 2.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.arc(s - 4, s - 6.5, 1.2, 0, Math.PI * 2);
          ctx.arc(s + 4, s - 6.5, 1.2, 0, Math.PI * 2);
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
          if (this._onBitChange) this._onBitChange(this.bitBalance);
          if (this._onHpChange) this._onHpChange(this.playerHp, this.playerMaxHp);
          this.updateHUD();
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

      // Random type based on player level
      const level = this.playerStats.level;
      let types = ['slime'];
      if (level >= 2) types.push('slime', 'goblin');
      if (level >= 4) types.push('goblin', 'orc');
      if (level >= 6) types.push('orc');
      const type = types[Math.floor(Math.random() * types.length)];

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
          this.playerStats.maxHp = 100 + (result.level - 1) * 10;
          this.playerStats.atk = 10 + (result.level - 1) * 2;
          this.playerMaxHp = this.playerStats.maxHp;
          this.playerHp = this.playerMaxHp;
          if (this._onHpChange) this._onHpChange(this.playerHp, this.playerMaxHp);
          if (this._onLevelUp) this._onLevelUp(result.level);
          this.showLevelUpEffect();
          this.updateHUD();
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
      this._hpBarBg.setDepth(99994);
      this._hpBarBg.setAlpha(0.7);
      this._hpBarBg.setStrokeStyle(0.5, 0x4ecca3, 0.4);

      this._hpBarFill = scene.add.rectangle(0, 0, 30, 5, 0x44cc44);
      this._hpBarFill.setOrigin(0.5);
      this._hpBarFill.setDepth(99995);

      this._hpBarText = scene.add.text(0, 0, '', {
        fontSize: '7px', fontFamily: 'Arial, sans-serif', fontStyle: 'bold',
        color: '#fff', stroke: '#000', strokeThickness: 1,
      });
      this._hpBarText.setOrigin(0.5);
      this._hpBarText.setDepth(99996);

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
      const barY = y - 18;
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
      return ITEMS[itemId] || null;
    },

    getShopItems() {
      return Object.entries(ITEMS).map(([id, item]) => ({ id, ...item }));
    },
  };

  // ---- Expose globally ----
  window.TownMobs = TownMobs;
  window.MOB_TYPES = MOB_TYPES;
  window.ITEMS = ITEMS;

})();
