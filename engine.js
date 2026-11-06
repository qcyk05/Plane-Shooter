/* Starfalcon simulation. Pure JavaScript; no network, DOM or external assets. */
(function (root) {
  'use strict';
  const W = 480, H = 720, TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const SHIPS = [
    { name: '游隼', role: '均衡突击型', hp: 5, speed: 280, damage: 1, color: '#86482f', skill: '超载爆发', shield: 3, burst: 100, boost: 4, desc: '耐久 5 · 速度 280 · 火力 100%｜爆发：100 伤害、3 秒护盾、4 秒双倍射速' },
    { name: '雨燕', role: '高速截击型', hp: 4, speed: 345, damage: .95, color: '#365c7a', skill: '相位跃迁', shield: 4, burst: 80, boost: 6, desc: '耐久 4 · 速度 345 · 火力 95%｜相位：80 伤害、4 秒护盾、6 秒双倍射速' },
    { name: '玄武', role: '重装破阵型', hp: 7, speed: 225, damage: 1.1, color: '#7c6030', skill: '重力震荡', shield: 3, burst: 160, boost: 3, desc: '耐久 7 · 速度 225 · 火力 110%｜震荡：160 伤害、3 秒护盾、回复 1 点耐久' }
  ];
  const STAGES = [
    { name: '晴空海岸', boss: '守门者', hp: 1800, color: '#3e7960', bg: '#aed7df' },
    { name: '金色沙洲', boss: '双生蝎', hp: 2700, color: '#9e7044', bg: '#e6d5ad' },
    { name: '云上要塞', boss: '空中母舰', hp: 3800, color: '#756a9a', bg: '#c8d4e5' }
  ];
  const ENEMIES = {
    scout: { hp: 24, speed: 85, r: 15, score: 100, color: '#fa7e94', interval: 2.3 },
    dart: { hp: 17, speed: 160, r: 12, score: 130, color: '#ffb16c', interval: 2.8 },
    bomber: { hp: 65, speed: 50, r: 22, score: 240, color: '#ae9bff', interval: 2.2 },
    armor: { hp: 110, speed: 40, r: 25, score: 350, color: '#a2b1cd', interval: 2.6 },
    sniper: { hp: 40, speed: 45, r: 17, score: 200, color: '#ff719a', interval: 3.0 },
    meteor: { hp: 50, speed: 140, r: 21, score: 80, color: '#a88c78', interval: 999 }
  };
  class World {
    constructor(seed = Date.now()) {
      this.seed = seed >>> 0 || 1;
      this.events = [];
      this.state = 'menu';
      this.shipIndex = 0;
      this.elapsed = 0;
      this.player = this.newPlayer(0);
      this.stage = 0; this.wave = 0; this.stageTime = 0;
      this.enemies = []; this.bullets = []; this.shots = []; this.items = []; this.particles = []; this.floaters = [];
      this.score = 0; this.kills = 0; this.combo = 0; this.comboTime = 0;
      this.shake = 0; this.flash = 0; this.boss = null; this.event = null;
    }
    rand() { let t = this.seed += 0x6D2B79F5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }
    range(a, b) { return a + this.rand() * (b - a); }
    emit(type, value) { this.events.push({ type, value }); }
    drainEvents() { return this.events.splice(0); }
    newPlayer(index) {
      const s = SHIPS[index];
      return { x: W / 2, y: H - 105, r: 5, hp: s.hp, maxHp: s.hp, speed: s.speed, damage: s.damage, energy: 40, weapon: 0, level: 1, cooldown: 0, inv: 0, shield: 0, boost: 0, magnet: 85, regen: 3, damageBonus: 1 };
    }
    start(index = 0) {
      this.shipIndex = clamp(index | 0, 0, 2); this.player = this.newPlayer(this.shipIndex);
      this.state = 'playing'; this.stage = 0; this.wave = 0; this.stageTime = 0; this.elapsed = 0;
      this.score = 0; this.kills = 0; this.combo = 0; this.comboTime = 0;
      this.enemies = []; this.shots = []; this.bullets = []; this.items = []; this.particles = []; this.floaters = [];
      this.boss = null; this.event = null; this.queue = []; this.nextWave = 2; this.shake = 0; this.flash = 0;
      this.events = []; this.emit('start'); this.emit('banner', 'SECTOR 01 · 晴空海岸');
    }
    pause() { if (this.state === 'playing') { this.state = 'paused'; this.emit('pause'); } else if (this.state === 'paused') { this.state = 'playing'; this.emit('resume'); } }
    setWeapon(index) { if (index >= 0 && index <= 2) { this.player.weapon = index; this.emit('weapon', index); } }
    skill() {
      const p = this.player, s = SHIPS[this.shipIndex];
      if (this.state !== 'playing' || p.energy < 100) return false;
      p.energy = 0; p.shield = Math.max(p.shield, s.shield); p.boost = Math.max(p.boost, s.boost);
      if (this.shipIndex === 2) p.hp = Math.min(p.maxHp, p.hp + 1);
      this.bullets = []; this.shake = 9; this.flash = .55;
      for (const e of [...this.enemies]) this.damageEnemy(e, s.burst * p.damageBonus, true);
      if (this.boss) this.damageBoss(s.burst * p.damageBonus);
      this.burst(p.x, p.y, s.color, 45, 260); this.emit('skill'); this.emit('banner', '✦ ' + s.skill + ' · 弹幕已清除');
      return true;
    }
    spawnEnemy(type, x, y = -40, variant = 0) {
      const base = ENEMIES[type];
      const e = { type, x, y, startX: x, age: 0, hp: base.hp * (1 + .4 * this.stage), maxHp: base.hp * (1 + .4 * this.stage), speed: base.speed * (1 + .15 * this.stage), r: base.r, color: base.color, score: base.score, shoot: this.range(.9, 2), variant, hit: 0, warning: 0, targetX: 0, targetY: 0, dead: false, spin: this.range(0, TAU) };
      this.enemies.push(e); return e;
    }
    spawnWave() {
      this.wave++; const n = 4 + this.stage * 2 + Math.floor(this.wave / 2);
      for (let i = 0; i < n; i++) {
        let type = 'scout'; const roll = this.rand();
        if (this.wave >= 2 && roll < .22) type = 'dart';
        if (this.wave >= 3 && roll > .7) type = 'bomber';
        if ((this.stage > 0 || this.wave >= 5) && roll > .85) type = 'armor';
        if (this.stage >= 1 && roll > .54 && roll < .7) type = 'sniper';
        this.queue.push({ at: this.stageTime + i * .42, type, x: 48 + ((i * 71 + this.wave * 39) % 384), variant: i % 2 });
      }
      this.nextWave = this.stageTime + 9;
      this.emit('wave', this.wave);
      if (this.wave === 3 || this.wave === 5) this.startEvent();
      if (this.wave === 2 || this.wave === 6) this.spawnItem('power', W / 2, -10);
      if (this.wave === 4) this.spawnItem('repair', W / 2, -10);
    }
    startEvent() {
      const types = ['supply', 'meteor', 'ion'];
      const type = types[Math.floor(this.rand() * types.length)];
      this.event = { type, remaining: 7, tick: 0 };
      const names = { supply: '随机事件 · 补给航线开启', meteor: '随机事件 · 陨石雨来袭', ion: '随机事件 · 离子风暴 / 能量回复 ×3' };
      this.emit('banner', names[type]);
    }
    spawnBoss() {
      this.event = null; this.bullets = [];
      const s = STAGES[this.stage];
      this.boss = { x: W / 2, y: -100, r: 57 + this.stage * 5, hp: s.hp, maxHp: s.hp, age: 0, shoot: 1.8, ring: 3, phase: 1, hit: 0, warning: 0, targetX: 0, targetY: 0, volley: 0 };
      this.emit('banner', '⚠ BOSS 接近 · ' + s.boss); this.emit('boss');
    }
    enemyBullet(x, y, vx, vy, r = 4, color = '#ff829c') { this.bullets.push({ x, y, vx, vy, r, color, age: 0 }); }
    aim(x, y, speed, offset = 0, color) {
      const a = Math.atan2(this.player.y - y, this.player.x - x) + offset;
      this.enemyBullet(x, y, Math.cos(a) * speed, Math.sin(a) * speed, 4, color);
    }
    fire() {
      const p = this.player, amp = p.damage * p.damageBonus * (1 + .15 * (p.level - 1));
      const add = (dx, angle, damage, speed, pierce, color, r) => this.shots.push({ x: p.x + dx, y: p.y - 20, vx: Math.sin(angle) * speed, vy: -Math.cos(angle) * speed, damage: damage * amp, pierce, color, r, hit: new Set(), life: 1.8, weapon: p.weapon });
      if (p.weapon === 0) {
        add(-8, 0, 8, 650, false, '#72f5d5', 3); add(8, 0, 8, 650, false, '#72f5d5', 3);
        if (p.level >= 4) add(0, 0, 5, 700, false, '#c9fff2', 3);
        p.cooldown = .16;
      } else if (p.weapon === 1) {
        const count = p.level >= 3 ? 7 : 5;
        for (let i = 0; i < count; i++) add(0, (i - (count - 1) / 2) * .135, 6, 550, false, '#ffb76f', 3);
        p.cooldown = .27;
      } else {
        add(0, 0, 25, 850, true, '#bca8ff', 5); p.cooldown = .34;
      }
      if (p.boost > 0) p.cooldown /= 2;
      this.emit('shoot', p.weapon);
    }
    spawnItem(type, x, y) { this.items.push({ type, x, y, age: 0, r: 12 }); }
    collect(item) {
      const p = this.player; const label = { power: '火力升级', repair: '+2 耐久', energy: '+30 能量', shield: '护盾 5 秒' };
      if (item.type === 'power') { if (p.level < 5) p.level++; else this.score += 300; }
      if (item.type === 'repair') p.hp = Math.min(p.maxHp, p.hp + 2);
      if (item.type === 'energy') p.energy = Math.min(100, p.energy + 30);
      if (item.type === 'shield') p.shield = Math.max(p.shield, 5);
      this.floaters.push({ x: p.x, y: p.y - 30, text: item.type === 'power' && p.level === 5 ? '火力 MAX' : label[item.type], color: '#72f5d5', life: 1.2 });
      item.dead = true; this.emit('pickup', item.type);
    }
    burst(x, y, color, count = 14, speed = 120) {
      for (let i = 0; i < count; i++) { const a = this.range(0, TAU), v = this.range(speed * .2, speed); this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: this.range(.22, .65), max: .65, color, size: this.range(2, 5) }); }
      if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
    }
    damageEnemy(e, amount, pierce = false) {
      if (e.dead) return;
      e.hp -= amount * (e.type === 'armor' && !pierce ? .65 : 1); e.hit = .08;
      if (e.hp <= 0) {
        e.dead = true; this.kills++; this.combo++; this.comboTime = 3.5;
        const value = Math.round(e.score * this.multiplier()); this.score += value;
        this.player.energy = Math.min(100, this.player.energy + (e.type === 'meteor' ? 1 : 3));
        this.burst(e.x, e.y, e.color, 18); this.shake = Math.max(this.shake, 2);
        this.floaters.push({ x: e.x, y: e.y, text: '+' + value, color: '#e3edf7', life: .8 }); this.emit('kill');
        if (e.type !== 'meteor' && this.rand() < .18) {
          const r = this.rand(); let type = r < .35 ? 'energy' : r < .58 ? 'power' : r < .8 ? 'repair' : 'shield';
          if (this.player.hp <= 2 && r < .65) type = 'repair';
          this.spawnItem(type, e.x, e.y);
        }
      }
    }
    multiplier() { return Math.min(2, 1 + Math.floor(this.combo / 3) * .1); }
    damageBoss(amount) {
      if (!this.boss) return;
      const b = this.boss; b.hp -= amount; b.hit = .07;
      if (b.hp <= 0) {
        const x = b.x, y = b.y; this.boss = null; this.score += (this.stage + 1) * 2500; this.kills++;
        this.burst(x, y, '#ffb16c', 80, 300); this.flash = .5; this.shake = 14;
        this.bullets = []; this.shots = []; this.enemies = []; this.items = []; this.queue = []; this.event = null;
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 2); this.player.energy = Math.min(100, this.player.energy + 35);
        this.state = this.stage === 2 ? 'victory' : 'upgrade';
        if (this.state === 'victory') this.score += this.player.hp * 500;
        this.emit(this.state);
      }
    }
    hitPlayer() {
      const p = this.player;
      if (p.inv > 0 || p.shield > 0 || this.state !== 'playing') return false;
      p.hp--; p.inv = 1.5; this.combo = 0; this.comboTime = 0; this.shake = 8; this.flash = .25;
      this.burst(p.x, p.y, '#ff6d86', 22); this.emit('hurt');
      if (p.hp <= 0) { p.hp = 0; this.state = 'defeat'; this.emit('defeat'); }
      return true;
    }
    chooseUpgrade(type) {
      if (this.state !== 'upgrade' || !['damage', 'hull', 'reactor'].includes(type)) return false;
      const p = this.player;
      if (type === 'damage') p.damageBonus *= 1.2;
      if (type === 'hull') { p.maxHp += 2; p.hp = Math.min(p.maxHp, p.hp + 3); }
      if (type === 'reactor') { p.regen += 1.5; p.speed += 20; p.magnet += 35; }
      this.stage++; this.wave = 0; this.stageTime = 0; this.nextWave = 2; this.state = 'playing';
      p.x = W / 2; p.y = H - 105; p.inv = 2; this.combo = 0; this.comboTime = 0;
      this.emit('stage'); this.emit('banner', 'SECTOR 0' + (this.stage + 1) + ' · ' + STAGES[this.stage].name);
      return true;
    }
    update(dt, input = {}) {
      if (this.state !== 'playing') return;
      this.elapsed += dt; this.stageTime += dt;
      const p = this.player; this.shake = Math.max(0, this.shake - 24 * dt); this.flash = Math.max(0, this.flash - dt);
      p.inv = Math.max(0, p.inv - dt); p.shield = Math.max(0, p.shield - dt); p.boost = Math.max(0, p.boost - dt);
      p.energy = Math.min(100, p.energy + p.regen * dt * (this.event?.type === 'ion' ? 3 : 1));
      let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0), dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      if (input.pointer && !dx && !dy) {
        dx = input.pointer.x - p.x; dy = input.pointer.y - p.y; const length = Math.hypot(dx, dy), max = p.speed * dt;
        if (length > 0) { p.x += dx / length * Math.min(length, max); p.y += dy / length * Math.min(length, max); }
      } else { const n = Math.hypot(dx, dy) || 1, v = p.speed * (input.slow ? .42 : 1); p.x += dx / n * v * dt; p.y += dy / n * v * dt; }
      p.x = clamp(p.x, 20, W - 20); p.y = clamp(p.y, 40, H - 26);
      p.cooldown -= dt; if (p.cooldown <= 0) this.fire();
      this.comboTime -= dt; if (this.comboTime <= 0) this.combo = 0;
      if (this.wave < 7 && this.stageTime >= this.nextWave) this.spawnWave();
      while (this.queue.length && this.queue[0].at <= this.stageTime) { const q = this.queue.shift(); this.spawnEnemy(q.type, q.x, -35, q.variant); }
      if (this.wave === 7 && !this.boss && this.stageTime > this.nextWave && !this.queue.length && !this.enemies.some(e => !e.dead)) this.spawnBoss();
      if (this.event) {
        const ev = this.event; ev.remaining -= dt; ev.tick -= dt;
        if (ev.tick <= 0) {
          ev.tick = ev.type === 'meteor' ? .65 : 1.5;
          if (ev.type === 'meteor') this.spawnEnemy('meteor', this.range(35, W - 35));
          if (ev.type === 'supply') this.spawnItem(['energy', 'power', 'shield'][Math.floor(this.rand() * 3)], this.range(50, W - 50), -10);
        }
        if (ev.remaining <= 0) this.event = null;
      }
      this.updateEnemies(dt); this.updateBoss(dt);
      for (const s of this.shots) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; }
      for (const b of this.bullets) { b.x += b.vx * dt; b.y += b.vy * dt; b.age += dt; }
      for (const item of this.items) {
        item.age += dt; item.y += 68 * dt;
        const d = Math.hypot(item.x - p.x, item.y - p.y);
        if (d < p.magnet && d > 0) { item.x += (p.x - item.x) / d * 230 * dt; item.y += (p.y - item.y) / d * 230 * dt; }
        if (Math.hypot(item.x - p.x, item.y - p.y) < 23) this.collect(item);
      }
      this.collisions();
      this.enemies = this.enemies.filter(e => !e.dead && e.y < H + 65);
      this.shots = this.shots.filter(s => !s.dead && s.life > 0 && s.y > -50 && s.x > -25 && s.x < W + 25);
      this.bullets = this.bullets.filter(b => !b.dead && b.x > -30 && b.x < W + 30 && b.y > -40 && b.y < H + 40 && b.age < 12);
      this.items = this.items.filter(i => !i.dead && i.y < H + 30);
      this.updateEffects(dt);
    }
    updateEffects(dt) {
      for (const p of this.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.exp(-2 * dt); p.vy *= Math.exp(-2 * dt); p.life -= dt; }
      for (const f of this.floaters) { f.y -= 28 * dt; f.life -= dt; }
      this.particles = this.particles.filter(p => p.life > 0); this.floaters = this.floaters.filter(f => f.life > 0);
    }
    updateEnemies(dt) {
      for (const e of this.enemies) {
        if (e.dead) continue;
        e.age += dt; e.hit = Math.max(0, e.hit - dt); const factor = 1 + .16 * this.stage;
        if (e.type === 'scout') { e.y += e.speed * dt; e.x = clamp(e.startX + Math.sin(e.age * 2 + e.variant * 3) * 36, 25, W - 25); }
        else if (e.type === 'dart') { e.y += e.speed * dt; e.x += (e.variant ? 1 : -1) * 35 * dt; }
        else if (e.type === 'meteor') { e.y += e.speed * dt; e.x += Math.sin(e.spin) * 30 * dt; }
        else e.y += e.speed * dt;
        if (e.type === 'sniper' && e.warning > 0) {
          e.warning -= dt;
          if (e.warning <= 0) { const a = Math.atan2(e.targetY - e.y, e.targetX - e.x); this.enemyBullet(e.x, e.y + e.r, Math.cos(a) * 300 * factor, Math.sin(a) * 300 * factor, 5, '#ff5d92'); }
        }
        e.shoot -= dt;
        if (e.shoot <= 0 && e.y > 0 && e.y < H - 130) {
          e.shoot = ENEMIES[e.type].interval / (1 + .08 * this.stage);
          if (e.type === 'scout' || e.type === 'dart') this.aim(e.x, e.y + 12, 120 * factor);
          if (e.type === 'bomber') for (const a of [-.32, 0, .32]) this.aim(e.x, e.y + 20, 115 * factor, a, '#b3a0ff');
          if (e.type === 'armor') for (let i = -2; i <= 2; i++) this.enemyBullet(e.x, e.y + 24, i * 40, 130 * factor, 4, '#ffba80');
          if (e.type === 'sniper') { e.warning = .8; e.targetX = this.player.x; e.targetY = this.player.y; }
        }
      }
    }
    updateBoss(dt) {
      const b = this.boss; if (!b) return;
      b.age += dt; b.hit = Math.max(0, b.hit - dt);
      if (b.y < 115) { b.y = Math.min(115, b.y + 70 * dt); return; }
      b.x = W / 2 + Math.sin(b.age * (.65 + this.stage * .08)) * (105 + this.stage * 15);
      if (b.hp < b.maxHp * .5 && b.phase === 1) {
        b.phase = 2; this.bullets = []; b.shoot = 1.2;
        this.emit('banner', '⚠ 装甲破裂 · BOSS 进入狂暴阶段'); this.burst(b.x, b.y, '#ff719a', 30);
      }
      b.shoot -= dt; b.ring -= dt;
      const speed = 120 + this.stage * 18 + (b.phase - 1) * 15;
      if (b.shoot <= 0) {
        b.shoot = b.phase === 1 ? 1.15 - .1 * this.stage : .83 - .08 * this.stage;
        const count = 5 + this.stage * 2;
        for (let i = 0; i < count; i++) this.aim(b.x, b.y + 35, speed, (i - (count - 1) / 2) * .18);
        if (this.stage >= 1) { this.aim(b.x - 44, b.y + 12, speed * 1.15, -.12, '#ffbf80'); this.aim(b.x + 44, b.y + 12, speed * 1.15, .12, '#ffbf80'); }
        b.volley++;
      }
      if (b.ring <= 0) {
        b.ring = b.phase === 1 ? 4 : 3; const count = 12 + this.stage * 4;
        for (let i = 0; i < count; i++) { const a = i / count * TAU + b.age * .2; this.enemyBullet(b.x, b.y, Math.cos(a) * speed * .85, Math.sin(a) * speed * .85, 4, '#c4a0ff'); }
      }
    }
    collisions() {
      const p = this.player;
      for (const s of this.shots) {
        if (s.dead) continue;
        for (const e of this.enemies) {
          if (e.dead || s.hit.has(e)) continue;
          if (Math.abs(s.x - e.x) < e.r + s.r && Math.abs(s.y - e.y) < e.r + (s.weapon === 2 ? 16 : 8)) {
            this.damageEnemy(e, s.damage, s.pierce); s.hit.add(e); this.burst(s.x, s.y, s.color, 2, 45);
            if (!s.pierce) { s.dead = true; break; }
          }
        }
        const b = this.boss;
        if (!s.dead && b && b.y >= 70 && !s.hit.has(b) && Math.abs(s.x - b.x) < b.r && Math.abs(s.y - b.y) < b.r * .65 + 12) {
          this.damageBoss(s.damage); s.hit.add(b); if (!s.pierce) s.dead = true;
          this.burst(s.x, s.y, s.color, 2, 45);
        }
      }
      if (this.state !== 'playing') return;
      for (const b of this.bullets) {
        if (p.shield > 0 && Math.hypot(b.x - p.x, b.y - p.y) < 24) { b.dead = true; continue; }
        if (!b.dead && Math.hypot(b.x - p.x, b.y - p.y) < p.r + b.r) { b.dead = true; this.hitPlayer(); }
      }
      for (const e of this.enemies) if (!e.dead && Math.hypot(e.x - p.x, e.y - p.y) < e.r * .7 + 10) this.hitPlayer();
      if (this.boss && Math.abs(this.boss.x - p.x) < this.boss.r && Math.abs(this.boss.y - p.y) < this.boss.r * .65 + 10) this.hitPlayer();
    }
  }
  const api = { World, SHIPS, STAGES, ENEMIES, W, H, clamp };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Starfalcon = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
