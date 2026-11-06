(function () {
  'use strict';
  const { World, SHIPS, STAGES, W, H, clamp } = Starfalcon;
  const $ = id => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;
  const world = new World();
  const keys = new Set();
  let selectedShip = 0, pointer = null, lastTime = 0, accumulator = 0, uiTimer = 0, sceneTime = 0;
  let bannerTimer = 0, best = 0, muted = false, audio = null, shotSoundAt = 0, resultSaved = false;
  try { best = Math.max(0, Number(localStorage.getItem('starfalcon-best-v1')) || 0); muted = localStorage.getItem('starfalcon-muted') === '1'; } catch (_) { /* Private browsing remains playable. */ }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Pixel matrices are drawn with integer rectangles, rather than external images.
  const sprites = {
    player: [
      '.......1.......', '......121......', '......121......', '.....11211.....', '.....12221.....',
      '..1..12221..1..', '..11.12321.11..', '..11112321111..', '.1111222221111.', '111112222211111',
      '111.1222221.111', '1...1122211...1', '....1141411....', '.....4.4.4.....', '.....4...4.....'
    ],
    scout: [ '..11...11..', '..1211121..', '...12221...', '11112221111', '12222222221', '.111232111.', '....121....', '.....1.....' ],
    dart: [ '...111...', '...121...', '.1112111.', '122222221', '.1112111.', '...131...', '...121...', '....1....' ],
    bomber: [ '....11...11....', '...122111221...', '....1222221....', '111112222211111', '122222222222221', '111112232211111', '....1222221....', '.....12221.....', '......111......' ],
    armor: [ '....1111111....', '....1222221....', '.....12221.....', '...111222111...', '111122222221111', '122222222222221', '111122232221111', '..12122322121..', '..11112221111..', '......111......' ],
    sniper: [ '....11111....', '....12221....', '.....121.....', '..111222111..', '1122222222211', '.11112221111.', '.....131.....', '.....121.....', '......1......' ],
    boss: [
      '.........111111111.........', '.........122222221.........', '..........1222221..........',
      '..........1222221..........', '.....11..112222211..11.....', '..11122111222222211122111..',
      '112222222222222222222222211', '122222222222222222222222221', '111112211122333221112211111',
      '....1221..1233321..1221....', '....1111..1222221..1111....', '..........1222221..........',
      '...........12221...........', '............111............'
    ]
  };
  function matrix(c, sprite, x, y, size, palette, flip = false) {
    const width = sprite[0].length, height = sprite.length;
    const ox = Math.round(x - width * size / 2), oy = Math.round(y - height * size / 2);
    for (let row = 0; row < height; row++) for (let col = 0; col < sprite[row].length; col++) {
      const n = sprite[row][col]; if (n === '.' || !palette[n]) continue;
      c.fillStyle = palette[n]; c.fillRect(ox + col * size, oy + (flip ? height - 1 - row : row) * size, size, size);
    }
  }
  function shipPalette(index, hit = false) {
    const s = SHIPS[index];
    return hit ? { 1: '#754d43', 2: '#fff3d7', 3: '#384c58', 4: '#e57d37' } : { 1: s.color, 2: ['#ef7751', '#468ab8', '#d59b35'][index], 3: '#fff2bb', 4: Math.sin(sceneTime * 12) > 0 ? '#e78a3b' : '#f5ca63' };
  }
  function preview(target, index) {
    const c = target.getContext('2d'); c.clearRect(0, 0, target.width, target.height);
    matrix(c, sprites.player, target.width / 2, target.height / 2 - 1, 3, shipPalette(index));
  }
  const clouds = Array.from({ length: 7 }, (_, i) => ({ x: (i * 137 + 35) % 540 - 30, y: i * 137, size: i % 3 === 0 ? 3 : 2, speed: 10 + (i % 3) * 4 }));
  function initAudio() {
    if (!audio) { const Audio = window.AudioContext || window.webkitAudioContext; if (Audio) audio = new Audio(); }
    if (audio?.state === 'suspended') audio.resume().catch(() => {});
  }
  function tone(freq, duration, volume, type = 'square', end = freq) {
    if (muted || !audio || audio.state !== 'running') return;
    const osc = audio.createOscillator(), gain = audio.createGain(), t = audio.currentTime;
    osc.type = type; osc.frequency.setValueAtTime(freq, t); osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + duration);
    gain.gain.setValueAtTime(volume, t); gain.gain.exponentialRampToValueAtTime(.001, t + duration);
    osc.connect(gain); gain.connect(audio.destination); osc.start(t); osc.stop(t + duration);
  }
  function sound(type, value) {
    if (type === 'shoot') { if (sceneTime - shotSoundAt < .12) return; shotSoundAt = sceneTime; tone(value === 2 ? 630 : 900, .055, .018, 'square', 240); }
    if (type === 'kill') tone(130, .14, .045, 'sawtooth', 32);
    if (type === 'hurt') tone(220, .25, .08, 'sawtooth', 35);
    if (type === 'pickup' || type === 'weapon') tone(520, .13, .04, 'sine', 1100);
    if (type === 'skill') tone(90, .65, .09, 'sawtooth', 700);
    if (type === 'boss') tone(190, .8, .05, 'sawtooth', 70);
    if (type === 'victory' || type === 'upgrade') { tone(440, .2, .05, 'triangle', 660); setTimeout(() => tone(660, .4, .05, 'triangle', 880), 180); }
    if (type === 'defeat') tone(330, .8, .055, 'triangle', 60);
  }
  function showOverlay(html) { $('overlay').innerHTML = '<div class="overlay-content">' + html + '</div>'; $('overlay').classList.remove('hidden'); }
  function hideOverlay() { $('overlay').classList.add('hidden'); $('game').focus({ preventScroll: true }); }
  function updateShip() {
    const ship = SHIPS[selectedShip];
    $('ship-name').textContent = ship.name; $('ship-role').textContent = ship.role; $('ship-code').textContent = 'F-0' + (selectedShip + 1);
    $('skill').firstElementChild.textContent = '✦ ' + ship.skill; preview($('ship-preview'), selectedShip);
    $('skill-hint').textContent = selectedShip === 2 ? '满能量后清弹、重击敌机并回复 1 点耐久' : '满能量后清除弹幕，获得护盾和双倍射速';
    const desc = $('ship-description'); if (desc) desc.innerHTML = ship.desc.replace('｜', '<br>');
    document.querySelectorAll('[data-ship]').forEach(el => el.classList.toggle('active', +el.dataset.ship === selectedShip));
    if (world.state === 'menu') { world.player = world.newPlayer(selectedShip); world.shipIndex = selectedShip; }
    updateUI();
  }
  function showMenu() {
    world.start(selectedShip); world.drainEvents(); world.state = 'menu'; pointer = null; keys.clear();
    bannerTimer = 0; $('event-banner').classList.remove('visible');
    showOverlay('<div class="eyebrow">A PERFECT DAY TO FLY / 晴空出击</div><div class="hero-pixel">✦</div><h2>准备好出击了吗</h2><p class="subtitle">螺旋桨转起来，今天的天空刚刚好。<br>挑一架小飞机，穿过白云出发吧。</p><div class="ship-choices">' + SHIPS.map((s, i) => '<button class="ship-choice" data-ship="' + i + '"><canvas id="choice-' + i + '" width="60" height="60"></canvas><strong>' + s.name + '</strong><small>' + s.role + '</small></button>').join('') + '</div><div id="ship-description" class="ship-description"></div><button id="start" class="primary-button">启 动 引 擎 <span>→</span></button><div class="overlay-note">自动开火 · 7 波 / 章 · 三章战役 · 建议佩戴耳机</div>');
    SHIPS.forEach((_, i) => preview($('choice-' + i), i));
    document.querySelectorAll('[data-ship]').forEach(el => el.addEventListener('click', () => { selectedShip = +el.dataset.ship; updateShip(); }));
    $('start').addEventListener('click', startGame); updateShip();
  }
  function startGame() {
    initAudio(); resultSaved = false; keys.clear(); pointer = null; world.start(selectedShip); accumulator = 0;
    hideOverlay(); processEvents(); updateUI();
  }
  function showPause() {
    showOverlay('<div class="eyebrow">TAKE A BREATH</div><div class="hero-pixel">Ⅱ</div><h2>航行已暂停</h2><p class="subtitle">休息一下，准备好再起飞。</p><button id="resume" class="primary-button">继 续 航 行 <span>→</span></button><button id="return-menu" class="secondary-button">结束本局，返回机库</button><div class="overlay-note">按 P / ESC 也可继续</div>');
    $('resume').addEventListener('click', togglePause); $('return-menu').addEventListener('click', () => { saveRecord(); showMenu(); });
  }
  function togglePause() {
    if (!['playing', 'paused'].includes(world.state)) return;
    keys.clear(); pointer = null; world.pause(); processEvents(); updateUI();
  }
  function showUpgrade() {
    showOverlay('<div class="eyebrow">SECTOR CLEAR / 航线已清空</div><div class="hero-pixel">◇</div><h2>下一站，更强一点</h2><p class="subtitle">' + STAGES[world.stage].boss + '已击破。机体回复 2 点耐久、35 能量。<br>选择一项永久强化，前往' + STAGES[world.stage + 1].name + '。</p><div class="upgrade-choices"><button class="upgrade-choice" data-upgrade="damage"><strong>01 / 高能弹仓</strong><small>所有武器和技能伤害 ×1.20，可叠加</small></button><button class="upgrade-choice" data-upgrade="hull"><strong>02 / 复合装甲</strong><small>耐久上限 +2，立即回复 3 点耐久</small></button><button class="upgrade-choice" data-upgrade="reactor"><strong>03 / 星核反应堆</strong><small>每秒能量 +1.5，速度 +20，拾取半径 +35</small></button></div>');
    document.querySelectorAll('[data-upgrade]').forEach(el => el.addEventListener('click', () => {
      if (world.chooseUpgrade(el.dataset.upgrade)) { keys.clear(); pointer = null; hideOverlay(); processEvents(); updateUI(); }
    }));
  }
  function saveRecord() {
    best = Math.max(best, world.score);
    try { localStorage.setItem('starfalcon-best-v1', String(best)); } catch (_) {}
  }
  function showResult(victory) {
    const newBest = world.score > best; saveRecord(); resultSaved = true;
    showOverlay('<div class="eyebrow">' + (victory ? 'MISSION ACCOMPLISHED' : 'SIGNAL LOST / 航行结束') + '</div><div class="hero-pixel">' + (victory ? '✧' : '⌁') + '</div><h2>' + (victory ? '漂亮！满载而归' : '下一次，飞得更远') + '</h2><p class="subtitle">' + (victory ? '空中母舰已坠落，三条航线全部打通。<br>带着好成绩，回家吃个冰淇淋吧。' : '在第 ' + (world.stage + 1) + ' 章停下了航迹。<br>试试切换武器，或为满能量的爆发留出时机。') + '</p><div class="result-grid"><div><span>' + (newBest ? '✦ 新纪录' : '本次得分') + '</span><strong>' + world.score.toLocaleString() + '</strong></div><div><span>击破目标</span><strong>' + world.kills + '</strong></div><div><span>飞行用时</span><strong>' + formatTime(world.elapsed) + '</strong></div><div><span>战役进度</span><strong>' + (victory ? '3 / 3' : world.stage + ' / 3') + '</strong></div></div><button id="restart" class="primary-button">再 次 出 击 <span>↗</span></button><button id="hangar" class="secondary-button">返回机库 · 更换战机</button>');
    $('restart').addEventListener('click', startGame); $('hangar').addEventListener('click', showMenu);
  }
  function banner(message) { $('event-banner').textContent = message; $('event-banner').classList.add('visible'); bannerTimer = 3; }
  function processEvents() {
    for (const e of world.drainEvents()) {
      sound(e.type, e.value);
      if (e.type === 'banner') banner(e.value);
      if (e.type === 'pause') showPause();
      if (e.type === 'resume') { hideOverlay(); accumulator = 0; }
      if (e.type === 'upgrade') { saveRecord(); showUpgrade(); }
      if (e.type === 'victory') showResult(true);
      if (e.type === 'defeat') showResult(false);
    }
  }
  const pad = v => String(Math.floor(v)).padStart(6, '0');
  function formatTime(t) { return Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0'); }
  function updateUI() {
    const p = world.player, menu = world.state === 'menu';
    $('score').textContent = pad(world.score); $('best').textContent = pad(Math.max(best, world.score));
    $('record-footer').textContent = 'BEST ' + pad(Math.max(best, world.score));
    $('hp-text').textContent = p.hp + ' / ' + p.maxHp;
    const health = Array.from({ length: p.maxHp }, (_, i) => '<i' + (i >= p.hp ? ' class="empty"' : '') + '></i>').join('');
    if ($('health').innerHTML !== health) $('health').innerHTML = health;
    $('energy-text').textContent = Math.floor(p.energy) + '%'; $('energy-fill').style.width = p.energy + '%';
    $('skill').disabled = $('touch-skill').disabled = p.energy < 100 || world.state !== 'playing';
    $('touch-skill').textContent = p.energy >= 100 ? '✦ 爆发就绪' : '✦ 能量 ' + Math.floor(p.energy) + '%';
    $('touch-weapon').textContent = ['脉冲机炮', '扇形霰弹', '贯穿光矛'][p.weapon] + ' ⇄';
    $('mobile-hp').textContent = '♥ ' + p.hp + '/' + p.maxHp; $('mobile-score').textContent = pad(world.score); $('mobile-energy').textContent = '⚡' + Math.floor(p.energy);
    $('weapon-level').textContent = 'LV.0' + p.level + (p.level === 5 ? ' / MAX' : '');
    document.querySelectorAll('[data-weapon]').forEach(el => el.classList.toggle('selected', +el.dataset.weapon === p.weapon));
    $('combo').textContent = world.combo > 1 ? world.combo + ' CHAIN  /  得分 ×' + world.multiplier().toFixed(1) : '每一次击落，都值得被记住。';
    $('stage-label').textContent = 'SECTOR 0' + (world.stage + 1) + ' / ' + STAGES[world.stage].name;
    document.querySelectorAll('[data-stage]').forEach(el => { el.classList.toggle('active', +el.dataset.stage === world.stage); el.classList.toggle('done', +el.dataset.stage < world.stage || world.state === 'victory'); });
    const progress = world.state === 'victory' || world.state === 'upgrade' ? 100 : world.boss ? 88 + 12 * (1 - world.boss.hp / world.boss.maxHp) : menu ? 0 : Math.min(87, world.stageTime / 65 * 87);
    $('mission-fill').style.width = progress + '%'; $('progress-label').textContent = Math.floor(progress) + '%';
    $('wave-label').textContent = menu ? '准备出击' : world.boss ? '首领战 · ' + STAGES[world.stage].boss : '敌机波次 ' + Math.min(world.wave, 7) + ' / 7';
    $('flight-status').textContent = ({ menu: '等待飞行员就绪', playing: '自动开火中 · 保持移动', paused: '航行暂停', upgrade: '航线清空 · 选择强化', victory: '所有航线已解放', defeat: '信号已中断' })[world.state];
    $('boss-hud').hidden = !world.boss;
    if (world.boss) { $('boss-name').textContent = STAGES[world.stage].boss; $('boss-phase').textContent = 'BOSS / PHASE 0' + world.boss.phase; $('boss-fill').style.width = Math.max(0, world.boss.hp / world.boss.maxHp * 100) + '%'; }
    $('pause').disabled = !['playing', 'paused'].includes(world.state);
    $('pause').innerHTML = world.state === 'paused' ? '▶ <span>继续</span>' : 'Ⅱ <span>暂停</span>';
    $('sound').textContent = muted ? '音效 OFF' : '音效 ON';
    $('intel').textContent = world.event?.type === 'meteor' ? '陨石可以被击碎，撞击仍会损伤机体。开阔的扇形火力更适合穿越陨石雨。' : world.boss ? '首领耐久低于 50% 后进入狂暴阶段。保留能量爆发，在密集弹幕中创造撤离通道。' : '重甲机抵挡普通子弹的 35% 伤害。切换光矛，从正面突破。';
  }
  function background() {
    const stage = STAGES[world.stage]; ctx.fillStyle = stage.bg; ctx.fillRect(0, 0, W, H);
    const t = sceneTime;
    // Calm scenery scrolls well behind the battle, with no grid, glow or scanlines.
    if (world.stage < 2) {
      for (let i = 0; i < 3; i++) {
        const x = i % 2 ? W - 48 : -26, y = (i * 370 + t * 15) % 1100 - 180;
        ctx.fillStyle = world.stage === 0 ? '#c9dcb2' : '#d7c596';
        ctx.fillRect(x - 24, y + 24, 120, 94); ctx.fillRect(x - 6, y, 82, 142);
        ctx.fillStyle = world.stage === 0 ? '#b2cc9f' : '#cdbb8d';
        ctx.fillRect(x + 12, y + 20, 42, 94); ctx.fillRect(x - 10, y + 52, 92, 34);
      }
    }
    const cloudPattern = ['.....111111.........','...1122222211.......','.11222222222211.....','122222222222222111..','1222222222222222221.','.11111111111111111..'];
    for (const cloud of clouds) {
      const y = (cloud.y + t * cloud.speed) % 950 - 100;
      matrix(ctx, cloudPattern, cloud.x, y, cloud.size * 3, { 1: world.stage === 1 ? '#eee3c9' : '#c8e2e6', 2: world.stage === 1 ? '#f4ead5' : '#e4eff0' });
    }
    if (world.event?.type === 'ion') { ctx.fillStyle = '#9d8fc41a'; ctx.fillRect(0, 0, W, H); }
  }
  function drawPlayer() {
    const p = world.player;
    if (world.state === 'defeat' || world.state === 'victory') return;
    if (p.inv > 0) ctx.globalAlpha = .7;
    const y = p.y + (world.state === 'menu' ? Math.sin(sceneTime * 2) * 4 : 0);
    ctx.fillStyle = '#486c7622'; ctx.fillRect(p.x - 15, y + 20, 30, 8);
    matrix(ctx, sprites.player, p.x, y, 3, shipPalette(world.shipIndex));
    if (p.boost > 0) { ctx.fillStyle = '#ffb16c'; ctx.fillRect(p.x - 6, y + 23, 4, 16 + Math.sin(sceneTime * 42) * 6); ctx.fillRect(p.x + 3, y + 23, 4, 16); }
    ctx.globalAlpha = 1;
    if (p.shield > 0) {
      ctx.strokeStyle = '#317951'; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI * 2; const x = p.x + Math.cos(a) * 31, py = y + Math.sin(a) * 31; if (!i) ctx.moveTo(x, py); else ctx.lineTo(x, py); }
      ctx.stroke(); ctx.fillStyle = '#fff4ba33'; ctx.fill();
    }
    ctx.fillStyle = '#08131d'; ctx.fillRect(p.x - 4, y - 4, 8, 8); ctx.fillStyle = '#fff'; ctx.fillRect(p.x - 2, y - 2, 4, 4);
    if (keys.has('ShiftLeft') || keys.has('ShiftRight')) { ctx.strokeStyle = '#243f57'; ctx.lineWidth = 1; ctx.strokeRect(p.x - 6, y - 6, 12, 12); }
  }
  function drawEnemy(e) {
    if (e.dead) return;
    if (e.type === 'meteor') {
      ctx.save(); ctx.translate(Math.round(e.x), Math.round(e.y)); ctx.rotate(Math.round((e.spin + e.age * .7) * 8) / 8);
      const pattern = [ '...1111...', '.1122221..', '122232221.', '1223322221', '1222223221', '.12222221.', '..112211..' ];
      matrix(ctx, pattern, 0, 0, 5, { 1: e.hit ? '#fff' : '#685d65', 2: e.hit ? '#fff' : '#a38b80', 3: '#594957' }); ctx.restore(); return;
    }
    const fills = { scout: '#d95c57', dart: '#cf8035', bomber: '#9470ae', armor: '#71846c', sniper: '#b65c85' };
    matrix(ctx, sprites[e.type], e.x, e.y, e.type === 'armor' ? 4 : 3, { 1: '#584e50', 2: e.hit > 0 ? '#fff2cd' : fills[e.type], 3: '#ffe3a0' });
    if (e.hp < e.maxHp) { ctx.fillStyle = '#f7edd7'; ctx.fillRect(e.x - e.r - 1, e.y - e.r - 11, e.r * 2 + 2, 5); ctx.fillStyle = '#a13c42'; ctx.fillRect(e.x - e.r, e.y - e.r - 10, e.r * 2 * e.hp / e.maxHp, 3); }
    if (e.warning > 0) {
      ctx.save(); ctx.setLineDash([5, 6]); ctx.lineWidth = 2; ctx.strokeStyle = '#a53948'; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.targetX, e.targetY); ctx.stroke(); ctx.restore();
    }
  }
  function render() {
    ctx.save();
    if (!reducedMotion && world.shake > 0) ctx.translate(Math.sin(sceneTime * 50) * Math.min(2, world.shake), Math.cos(sceneTime * 45) * Math.min(1, world.shake * .15));
    background();
    for (const item of world.items) {
      const colors = { power: '#a15023', repair: '#286647', energy: '#355d92', shield: '#795492' }, symbols = { power: 'P', repair: '+', energy: 'E', shield: 'S' }, color = colors[item.type];
      const x = Math.round(item.x), y = Math.round(item.y + Math.sin(item.age * 4) * 3);
      ctx.fillStyle = '#fff7d9'; ctx.fillRect(x - 13, y - 13, 26, 26); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(x - 12, y - 12, 24, 24);
      ctx.fillStyle = color; ctx.font = 'bold 15px Consolas,monospace'; ctx.textAlign = 'center'; ctx.fillText(symbols[item.type], x, y + 5);
    }
    for (const s of world.shots) { const color = ['#287263', '#a76724', '#74519e'][s.weapon]; ctx.fillStyle = color; ctx.fillRect(Math.round(s.x - s.r / 2 - 1), Math.round(s.y - 7), s.r + 2, s.weapon === 2 ? 30 : 14); ctx.fillStyle = '#fff2b5'; ctx.fillRect(Math.round(s.x - 1), Math.round(s.y - 6), 2, s.weapon === 2 ? 25 : 10); }
    for (const e of world.enemies) drawEnemy(e);
    if (world.boss) {
      const b = world.boss;
      matrix(ctx, sprites.boss, b.x, b.y, world.stage === 2 ? 5 : 4, { 1: '#55565a', 2: b.hit > 0 ? '#f2d59b' : b.phase === 2 ? '#b56855' : ['#78966a', '#b59151', '#8f83a3'][world.stage], 3: '#ffe6a1' });
      ctx.fillStyle = '#ff9d81'; ctx.fillRect(Math.round(b.x - 5), Math.round(b.y + 33), 10, 7 + Math.sin(sceneTime * 20) * 3);
    }
    for (const b of world.bullets) { const x = Math.round(b.x), y = Math.round(b.y); ctx.fillStyle = '#fff7df'; ctx.fillRect(x - b.r - 2, y - b.r - 2, b.r * 2 + 4, b.r * 2 + 4); ctx.fillStyle = '#973d46'; ctx.fillRect(x - b.r - 1, y - b.r - 1, b.r * 2 + 2, b.r * 2 + 2); ctx.fillStyle = '#dd6456'; ctx.fillRect(x - b.r + 1, y - b.r + 1, b.r * 2 - 2, b.r * 2 - 2); ctx.fillStyle = '#ffe7b5'; ctx.fillRect(x - 1, y - 1, 2, 2); }
    drawPlayer();
    for (const p of world.particles) { ctx.globalAlpha = clamp(p.life / .4, 0, 1); ctx.fillStyle = p.color; ctx.fillRect(Math.round(p.x), Math.round(p.y), Math.ceil(p.size), Math.ceil(p.size)); }
    ctx.globalAlpha = 1;
    for (const f of world.floaters) { ctx.globalAlpha = Math.min(1, f.life * 2); ctx.font = 'bold 12px Consolas,"Microsoft YaHei",monospace'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = '#fff8e5'; ctx.strokeText(f.text, Math.round(f.x), Math.round(f.y)); ctx.fillStyle = '#365644'; ctx.fillText(f.text, Math.round(f.x), Math.round(f.y)); }
    ctx.globalAlpha = 1;
    if (world.player.energy >= 100 && world.state === 'playing') { ctx.fillStyle = '#fff5d9'; ctx.fillRect(W / 2 - 104, H - 33, 208, 23); ctx.fillStyle = '#365d3c'; ctx.font = 'bold 11px Consolas,"Microsoft YaHei",monospace'; ctx.textAlign = 'center'; ctx.fillText('✦ SPACE · 能量爆发就绪', W / 2, H - 18); }
    // Skill feedback stays around the aircraft; avoid a full-screen white flash.
    if (world.flash > 0 && !reducedMotion) { ctx.strokeStyle = '#a36132'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(world.player.x, world.player.y, (1 - world.flash / .55) * 160 + 30, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
  }
  function frame(timestamp) {
    const dt = Math.min(.1, (timestamp - (lastTime || timestamp)) / 1000); lastTime = timestamp;
    if (world.state === 'playing' || world.state === 'menu') sceneTime += dt;
    if (world.state === 'playing') {
      accumulator = Math.min(accumulator + dt, .12);
      while (accumulator >= 1 / 120) {
        world.update(1 / 120, { left: keys.has('KeyA') || keys.has('ArrowLeft'), right: keys.has('KeyD') || keys.has('ArrowRight'), up: keys.has('KeyW') || keys.has('ArrowUp'), down: keys.has('KeyS') || keys.has('ArrowDown'), slow: keys.has('ShiftLeft') || keys.has('ShiftRight'), pointer });
        accumulator -= 1 / 120;
        if (world.state !== 'playing') break;
      }
    } else { accumulator = 0; if (world.state !== 'paused') { world.updateEffects(dt); world.flash = Math.max(0, world.flash - dt); world.shake = Math.max(0, world.shake - 24 * dt); } }
    processEvents();
    if (world.state === 'playing' && bannerTimer > 0) { bannerTimer -= dt; if (bannerTimer <= 0) $('event-banner').classList.remove('visible'); }
    uiTimer += dt; if (uiTimer > .07) { updateUI(); uiTimer = 0; }
    render(); requestAnimationFrame(frame);
  }
  const gameKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Digit1', 'Digit2', 'Digit3', 'KeyP', 'Escape', 'ShiftLeft', 'ShiftRight'];
  window.addEventListener('keydown', e => {
    if (gameKeys.includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); return; }
    if (e.code === 'Enter' && world.state === 'menu') { startGame(); return; }
    keys.add(e.code);
    if (world.state !== 'playing') return;
    if (e.code === 'Space') { initAudio(); world.skill(); processEvents(); updateUI(); }
    if (['Digit1', 'Digit2', 'Digit3'].includes(e.code)) world.setWeapon(+e.code.slice(-1) - 1);
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  function clearInput() { keys.clear(); pointer = null; if (world.state === 'playing') togglePause(); }
  window.addEventListener('blur', clearInput);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });
  function pointerPosition(e) { const rect = canvas.getBoundingClientRect(); return { x: clamp((e.clientX - rect.left) / rect.width * W, 20, W - 20), y: clamp((e.clientY - rect.top) / rect.height * H - (e.pointerType === 'touch' ? 35 : 0), 40, H - 26) }; }
  canvas.addEventListener('pointerdown', e => { if (world.state !== 'playing' || e.button > 0) return; initAudio(); canvas.setPointerCapture(e.pointerId); pointer = pointerPosition(e); e.preventDefault(); });
  canvas.addEventListener('pointermove', e => { if (canvas.hasPointerCapture(e.pointerId)) pointer = pointerPosition(e); });
  canvas.addEventListener('pointerup', e => { if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId); pointer = null; });
  canvas.addEventListener('pointercancel', () => { pointer = null; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  $('pause').addEventListener('click', togglePause); $('touch-pause').addEventListener('click', togglePause);
  function activateSkill() { initAudio(); world.skill(); processEvents(); updateUI(); }
  $('skill').addEventListener('click', activateSkill); $('touch-skill').addEventListener('click', activateSkill);
  $('touch-weapon').addEventListener('click', () => { if (world.state === 'playing') { world.setWeapon((world.player.weapon + 1) % 3); updateUI(); } });
  document.querySelectorAll('[data-weapon]').forEach(el => el.addEventListener('click', () => { world.setWeapon(+el.dataset.weapon); updateUI(); }));
  $('sound').addEventListener('click', () => { initAudio(); muted = !muted; try { localStorage.setItem('starfalcon-muted', muted ? '1' : '0'); } catch (_) {} updateUI(); });
  window.addEventListener('pagehide', () => { if (!resultSaved) saveRecord(); });
  // Read-only status is useful for diagnostics without changing gameplay.
  window.StarfalconApp = Object.freeze({ snapshot: () => ({ state: world.state, stage: world.stage, wave: world.wave, score: world.score, hp: world.player.hp, energy: world.player.energy, enemies: world.enemies.length, bullets: world.bullets.length, shots: world.shots.length, weapon: world.player.weapon, elapsed: world.elapsed, boss: world.boss ? { hp: world.boss.hp, phase: world.boss.phase } : null }) });
  showMenu(); requestAnimationFrame(frame);
})();
