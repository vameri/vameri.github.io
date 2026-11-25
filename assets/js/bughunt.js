/*
 * Bug Hunt: a small original arcade game for vameri.github.io.
 * Waves of bugs march across the screen; the player (a pizza slice) shoots them,
 * hides behind firewalls and hits the occasional coffee "hotfix" for bonus points.
 * Vanilla JS + <canvas>, no dependencies. Loaded on demand by the launcher button.
 */
(function () {
  'use strict';

  var W = 600, H = 520;                       // logical canvas size (W adapts to the screen shape)
  var COLS = 8, ROWS = 5, SPX = 52, SPY = 38; // formation, set by configure()
  var ROW_KIND = [0, 1, 1, 2, 2];             // 0 = fly, 1 = beetle, 2 = ant
  var KIND_PTS = [30, 20, 10];
  var ROW_COLORS = ['#e8618c', '#9b6bdf', '#5b8def', '#3fb37f', '#f2a541'];
  var CELL = 4, SH_COLS = 14, SH_ROWS = 10;   // firewall grid
  var EXTRA_LIFE_EVERY = 1500, MAX_LIVES = 5;
  var BEST_KEY = 'bughuntBest';

  var S, opts, root, panel, canvas, ctx, hud, screens, lastFocus, themeBtn;
  var raf = 0, running = false, state = 'start';
  var keys = {}, touchActive = false, touchX = null, isTouch = false;
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var stars = [];
  var game;

  for (var si = 0; si < 70; si++) stars.push({ x: Math.random(), y: Math.random(), r: Math.random() < 0.2 ? 1.6 : 1, a: 0.25 + Math.random() * 0.5 });

  function fmt(str, n) { return String(str).replace('{n}', n); }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#232323'; }
  function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
  function readBest() { try { return parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { return 0; } }
  function saveBest(v) { try { localStorage.setItem(BEST_KEY, String(v)); } catch (e) {} }

  /* ---------- Sound (synthesized with Web Audio, no files) ---------- */

  var SOUND_KEY = 'bughuntSound';
  var audio = null, master = null, ufoNodes = null;
  var muted = (function () { try { return localStorage.getItem(SOUND_KEY) === 'off'; } catch (e) { return false; } })();

  // Create/resume the audio context; only call from a user gesture (click or key)
  function unlockAudio() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audio) {
      audio = new AC();
      master = audio.createGain();
      master.gain.value = muted ? 0 : 0.22;
      master.connect(audio.destination);
    }
    if (audio.state === 'suspended') audio.resume();
  }

  function canPlay() { return audio && !muted && audio.state === 'running'; }

  function tone(freq, dur, type, vol, slideTo, delay) {
    if (!canPlay()) return;
    var t = audio.currentTime + (delay || 0);
    var o = audio.createOscillator(), g = audio.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.3, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noise(dur, vol, cutoff) {
    if (!canPlay()) return;
    var t = audio.currentTime;
    var len = Math.floor(audio.sampleRate * dur);
    var buf = audio.createBuffer(1, len, audio.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = audio.createBufferSource(), f = audio.createBiquadFilter(), g = audio.createGain();
    src.buffer = buf; f.type = 'lowpass'; f.frequency.value = cutoff || 1200;
    g.gain.value = vol || 0.3;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  }

  function melody(notes, step, type, vol) {
    notes.forEach(function (n, i) { tone(n, step * 1.6, type || 'square', vol || 0.22, null, i * step); });
  }

  var sfx = {
    shoot:     function () { tone(1150, 0.09, 'square', 0.16, 520); },
    hit:       function () { tone(620, 0.12, 'triangle', 0.45, 140); noise(0.07, 0.18, 2500); },
    block:     function () { noise(0.05, 0.12, 900); },
    playerHit: function () { noise(0.4, 0.55, 700); tone(200, 0.4, 'sawtooth', 0.3, 55); },
    hotfix:    function () { melody([660, 880, 1100, 1320, 1760], 0.06, 'square', 0.18); },
    sprint:    function () { melody([392, 523, 659, 784], 0.09, 'triangle', 0.3); },
    clear:     function () { melody([523, 659, 784, 1046, 1318], 0.08, 'square', 0.2); },
    life:      function () { melody([784, 988, 1318, 1568], 0.07, 'triangle', 0.3); },
    over:      function () { melody([523, 440, 349, 262, 196], 0.18, 'triangle', 0.32); }
  };

  // Wobbling hum while the coffee "hotfix" crosses the top of the screen
  function syncUfoSound() {
    var want = game && game.ufo && state === 'play' && canPlay();
    if (want && !ufoNodes) {
      var o = audio.createOscillator(), lfo = audio.createOscillator(), lg = audio.createGain(), g = audio.createGain();
      o.type = 'sine'; o.frequency.value = 330;
      lfo.frequency.value = 7; lg.gain.value = 60;
      lfo.connect(lg); lg.connect(o.frequency);
      g.gain.value = 0.07;
      o.connect(g); g.connect(master);
      o.start(); lfo.start();
      ufoNodes = { o: o, lfo: lfo };
    } else if (!want && ufoNodes) {
      try { ufoNodes.o.stop(); ufoNodes.lfo.stop(); } catch (e) {}
      ufoNodes = null;
    }
  }

  var SPEAKER_ON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
  var SPEAKER_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
  var soundBtn;

  function syncSoundBtn() {
    if (!soundBtn) return;
    soundBtn.innerHTML = muted ? SPEAKER_OFF : SPEAKER_ON;
    var label = muted ? S.sound_on : S.sound_off;
    soundBtn.setAttribute('aria-label', label);
    soundBtn.setAttribute('aria-pressed', muted ? 'false' : 'true');
    soundBtn.title = label + ' (M)';
  }

  function toggleSound() {
    muted = !muted;
    try { localStorage.setItem(SOUND_KEY, muted ? 'off' : 'on'); } catch (e) {}
    unlockAudio();
    if (master) master.gain.value = muted ? 0 : 0.22;
    syncUfoSound();
    syncSoundBtn();
    if (!muted) tone(880, 0.08, 'triangle', 0.25);
  }

  /* ---------- DOM ---------- */

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function spaceWord() {
    var lang = (document.documentElement.getAttribute('lang') || 'pt').slice(0, 2);
    return { key: lang === 'en' ? 'Space' : (lang === 'es' ? 'Espacio' : 'Espaço'), or: lang === 'en' ? 'or' : (lang === 'es' ? 'o' : 'ou') };
  }

  function keysLegend() {
    var w = spaceWord();
    return '<ul class="bh-keys">' +
      '<li><kbd>&larr;</kbd><kbd>&rarr;</kbd> <span>' + w.or + '</span> <kbd>A</kbd><kbd>D</kbd> ' + S.move + '</li>' +
      '<li><kbd class="bh-wide">' + w.key + '</kbd> ' + S.shoot + '</li>' +
      '<li><kbd>P</kbd> ' + S.pause + '</li>' +
      '<li><kbd>Esc</kbd> ' + S.quit + '</li>' +
      '<li><kbd>M</kbd> ' + S.sound + '</li>' +
    '</ul>';
  }

  var MOON = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
  var SUN = '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function syncThemeBtn() {
    if (!themeBtn) return;
    var dark = isDark();
    themeBtn.innerHTML = dark ? SUN : MOON;
    var label = dark ? S.theme_light : S.theme_dark;
    themeBtn.setAttribute('aria-label', label);
    themeBtn.title = label;
  }

  function toggleTheme() {
    var siteBtn = document.querySelector('.theme-toggle');
    if (siteBtn) siteBtn.click();
    else document.documentElement.setAttribute('data-theme', isDark() ? 'light' : 'dark');
    syncThemeBtn();
    draw();
    panel.focus({ preventScroll: true });
  }

  function build() {
    var w = spaceWord();
    root = el('div', 'bh-overlay');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', S.title);

    panel = el('div', 'bh-panel');
    panel.tabIndex = -1;

    var top = el('div', 'bh-top');
    hud = el('div', 'bh-hud');
    var tools = el('div', 'bh-tools');
    themeBtn = el('button', 'bh-close bh-theme');
    themeBtn.type = 'button';
    themeBtn.addEventListener('click', toggleTheme);
    var close = el('button', 'bh-close', '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>');
    close.type = 'button';
    close.setAttribute('aria-label', S.close);
    close.title = S.close;
    close.addEventListener('click', closeGame);
    soundBtn = el('button', 'bh-close bh-sound');
    soundBtn.type = 'button';
    soundBtn.addEventListener('click', function () { toggleSound(); panel.focus({ preventScroll: true }); });
    tools.appendChild(soundBtn);
    tools.appendChild(themeBtn);
    tools.appendChild(close);
    top.appendChild(hud);
    top.appendChild(tools);

    var stage = el('div', 'bh-stage');
    canvas = el('canvas', 'bh-canvas');
    canvas.setAttribute('aria-hidden', 'true');
    stage.appendChild(canvas);

    screens = {
      start: el('div', 'bh-screen',
        '<h2 class="bh-title">' + S.title + '</h2>' +
        '<p class="bh-sub">' + S.subtitle + '</p>' +
        keysLegend() +
        '<p class="bh-touch">' + S.tips + '</p>' +
        '<p class="bh-touch">' + S.touch + '</p>' +
        '<button type="button" class="bh-btn" data-act="start">' + S.start_button + '</button>' +
        '<p class="bh-hint bh-hint--keys">' + S.start_key.replace(/Espaço|Space|Espacio/, w.key) + '</p>' +
        '<p class="bh-hint bh-hint--touch">' + S.start_touch + '</p>'),
      paused: el('div', 'bh-screen',
        '<h2 class="bh-title">' + S.paused + '</h2>' + keysLegend() +
        '<button type="button" class="bh-btn" data-act="resume">' + S.resume + '</button>'),
      over: el('div', 'bh-screen', '')
    };
    Object.keys(screens).forEach(function (k) { stage.appendChild(screens[k]); });
    stage.addEventListener('click', function (e) {
      var act = e.target.closest && e.target.closest('[data-act]');
      if (!act) return;
      var a = act.getAttribute('data-act');
      if (a === 'start' || a === 'again') startGame();
      if (a === 'resume') setPaused(false);
    });

    var legend = el('p', 'bh-legend',
      '<kbd>&larr;</kbd><kbd>&rarr;</kbd> ' + S.move + ' &middot; <kbd class="bh-wide">' + w.key + '</kbd> ' + S.shoot +
      ' &middot; <kbd>P</kbd> ' + S.pause + ' &middot; <kbd>M</kbd> ' + S.sound + ' &middot; <kbd>Esc</kbd> ' + S.quit);

    panel.appendChild(top);
    panel.appendChild(stage);
    panel.appendChild(legend);
    root.appendChild(panel);

    stage.addEventListener('pointerdown', onPointer);
    stage.addEventListener('pointermove', onPointer);
    window.addEventListener('pointerup', function () { touchActive = false; });

    ctx = canvas.getContext('2d');
  }

  function showScreen(name) {
    Object.keys(screens).forEach(function (k) { screens[k].hidden = k !== name; });
    var btn = name && screens[name] && screens[name].querySelector('.bh-btn');
    if (btn) btn.focus({ preventScroll: true });
  }

  function renderHud() {
    var lives = '';
    for (var i = 0; i < game.lives; i++) lives += '<span class="bh-life" aria-hidden="true"></span>';
    hud.innerHTML =
      '<span><b>' + S.score + '</b> ' + game.score + '</span>' +
      '<span><b>' + S.sprint + '</b> ' + game.sprint + '</span>' +
      '<span class="bh-lives"><b>' + S.lives + '</b> ' + lives + '</span>' +
      '<span class="bh-best"><b>' + S.best + '</b> ' + Math.max(game.best, game.score) + '</span>';
  }

  function configure() {
    if (W < 480) { COLS = 6; SPX = 46; }
    else if (W > 820) { COLS = 11; SPX = 54; }
    else { COLS = 8; SPX = 52; }
  }

  function resize() {
    var stage = canvas.parentNode;
    var maxW = stage.clientWidth;
    var maxH = stage.clientHeight;
    if (maxW < 50 || maxH < 50) return;
    W = Math.round(Math.max(360, Math.min(1000, H * maxW / maxH)));
    configure();
    if (game && game.player) {
      game.player.x = Math.max(24, Math.min(W - 24, game.player.x));
      placeShields(false);
    }
    var scale = Math.min(maxW / W, maxH / H);
    var cssW = Math.floor(W * scale), cssH = Math.floor(H * scale);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    stage.style.setProperty('--bh-w', cssW + 'px');
    stage.style.setProperty('--bh-h', cssH + 'px');
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    draw();
  }

  /* ---------- Firewalls (destructible shields) ---------- */

  function shieldShape() {
    var cells = new Uint8Array(SH_COLS * SH_ROWS);
    for (var r = 0; r < SH_ROWS; r++) {
      for (var c = 0; c < SH_COLS; c++) {
        var on = 1;
        if (r < 3 && (c < 3 - r || c > SH_COLS - 4 + r)) on = 0;                    // rounded top
        if (r > SH_ROWS - 4 && c > 3 && c < SH_COLS - 4) on = 0;                       // arch at the bottom
        cells[r * SH_COLS + c] = on;
      }
    }
    return cells;
  }

  function placeShields(fresh) {
    var n = W < 480 ? 3 : 4;
    var sw = SH_COLS * CELL;
    var y = game.player.y - 92;
    if (fresh || !game.shields || game.shields.length !== n) {
      game.shields = [];
      for (var i = 0; i < n; i++) game.shields.push({ x: 0, y: y, cells: shieldShape() });
    }
    var gap = (W - n * sw) / (n + 1);
    game.shields.forEach(function (s, i) { s.x = gap + i * (sw + gap); s.y = y; });
  }

  // Returns true if a shot moving from y0 to y1 at x hits a firewall cell (and erodes it)
  function hitShield(x, y0, y1) {
    if (!game.shields) return false;
    var step = y1 > y0 ? 2 : -2;
    for (var i = 0; i < game.shields.length; i++) {
      var s = game.shields[i];
      if (x < s.x || x >= s.x + SH_COLS * CELL) continue;
      var c = Math.floor((x - s.x) / CELL);
      for (var y = y0; step > 0 ? y <= y1 : y >= y1; y += step) {
        if (y < s.y || y >= s.y + SH_ROWS * CELL) continue;
        var r = Math.floor((y - s.y) / CELL);
        if (s.cells[r * SH_COLS + c]) { erode(s, c, r); return true; }
      }
    }
    return false;
  }

  function erode(s, c, r) {
    for (var dr = -1; dr <= 1; dr++) {
      for (var dc = -1; dc <= 1; dc++) {
        var rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= SH_ROWS || cc >= SH_COLS) continue;
        if ((dr === 0 && dc === 0) || Math.random() < 0.55) s.cells[rr * SH_COLS + cc] = 0;
      }
    }
  }

  // Bugs that march into a firewall chew through it
  function bugsEatShields(bugs) {
    game.shields.forEach(function (s) {
      bugs.forEach(function (b) {
        if (b.y + 12 < s.y || b.y - 12 > s.y + SH_ROWS * CELL) return;
        for (var r = 0; r < SH_ROWS; r++) {
          for (var c = 0; c < SH_COLS; c++) {
            var cx = s.x + c * CELL + 2, cy = s.y + r * CELL + 2;
            if (Math.abs(cx - b.x) < 16 && Math.abs(cy - b.y) < 13) s.cells[r * SH_COLS + c] = 0;
          }
        }
      });
    });
  }

  /* ---------- Game state ---------- */

  function newGame() {
    game = { score: 0, sprint: 1, lives: 3, killed: 0, best: readBest(), nextLife: EXTRA_LIFE_EVERY, msg: '', msgT: 0, texts: [] };
    game.player = { x: W / 2, y: H - 34, w: 34, h: 36, inv: 0, cool: 0 };
    placeShields(true);
    newSprint();
  }

  function newSprint() {
    var p = game.player;
    p.x = W / 2; p.inv = 0; p.cool = 0;
    game.shots = [];
    game.enemyShots = [];
    game.parts = [];
    game.bugs = [];
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) game.bugs.push({ col: c, row: r, kind: ROW_KIND[r], alive: true, x: 0, y: 0 });
    }
    game.spx = SPX;
    game.fx = (W - (COLS - 1) * SPX) / 2;
    game.fy = 52 + Math.min(game.sprint - 1, 6) * 14;   // each sprint starts a bit lower
    game.dir = 1;
    game.step = 0; game.frame = 0;
    game.enemyTimer = 1.4;
    game.total = game.bugs.length;
    game.ufo = null;
    game.ufoTimer = 12 + Math.random() * 10;
    game.introT = 1.3;
    game.msg = fmt(S.sprint_start, game.sprint);
    game.msgT = 1.3;
    if (game.sprint > 1 && game.sprint % 3 === 1) placeShields(true);  // fresh firewalls every 3 sprints
    layoutBugs();
  }

  function layoutBugs() {
    for (var i = 0; i < game.bugs.length; i++) {
      var b = game.bugs[i];
      b.x = game.fx + b.col * game.spx;
      b.y = game.fy + b.row * SPY;
    }
  }

  function aliveBugs() { return game.bugs.filter(function (b) { return b.alive; }); }

  function addScore(n) {
    game.score += n;
    if (game.score >= game.nextLife) {
      game.nextLife += EXTRA_LIFE_EVERY;
      if (game.lives < MAX_LIVES) {
        game.lives++;
        floatText(game.player.x, game.player.y - 40, S.extra_life, '#3fb37f');
        sfx.life();
      }
    }
    renderHud();
  }

  function floatText(x, y, text, color) { game.texts.push({ x: x, y: y, text: text, color: color, t: 1.2 }); }

  function startGame() {
    unlockAudio();
    newGame();
    renderHud();
    state = 'play';
    showScreen(null);
    panel.focus({ preventScroll: true });
    sfx.sprint();
    loop.last = 0;
    if (!running) { running = true; raf = requestAnimationFrame(loop); }
  }

  function setPaused(p) {
    if (state !== 'play' && state !== 'paused') return;
    state = p ? 'paused' : 'play';
    syncUfoSound();
    showScreen(p ? 'paused' : null);
    if (!p) { panel.focus({ preventScroll: true }); loop.last = 0; }
  }

  function gameOver() {
    state = 'over';
    syncUfoSound();
    sfx.over();
    var isBest = game.score > game.best && game.score > 0;
    if (isBest) saveBest(game.score);
    renderHud();
    screens.over.innerHTML =
      '<h2 class="bh-title">' + S.game_over + '</h2>' +
      '<p class="bh-big">' + fmt(S.result, game.killed) + '</p>' +
      '<p class="bh-sub">' + S.score + ': <b>' + game.score + '</b> &middot; ' + S.sprint + ' ' + game.sprint +
        (isBest ? ' &middot; <b class="bh-new">' + S.new_best + '</b>' : ' &middot; ' + S.best + ': ' + Math.max(game.best, game.score)) + '</p>' +
      '<div class="bh-actions">' +
        '<button type="button" class="bh-btn" data-act="again">' + S.again + '</button>' +
        '<a class="bh-btn bh-btn--ghost" href="' + opts.whatsapp + '" target="_blank" rel="noopener noreferrer">' + S.whatsapp + '</a>' +
        '<a class="bh-btn bh-btn--ghost" href="' + opts.cv + '" download>' + S.cv + '</a>' +
      '</div>';
    showScreen('over');
  }

  /* ---------- Loop ---------- */

  function loop(ts) {
    if (!running) return;
    if (!loop.last) loop.last = ts;
    var dt = Math.min((ts - loop.last) / 1000, 0.05);
    loop.last = ts;
    if (state === 'play') update(dt);
    syncUfoSound();
    draw();
    raf = requestAnimationFrame(loop);
  }

  function update(dt) {
    var p = game.player;
    var speed = 320;

    // Player movement: keyboard or finger position
    var dx = 0;
    if (keys.left) dx -= 1;
    if (keys.right) dx += 1;
    if (dx) p.x += dx * speed * dt;
    else if (touchActive && touchX != null) {
      var diff = touchX - p.x;
      p.x += Math.max(-speed * dt * 1.4, Math.min(speed * dt * 1.4, diff));
    }
    p.x = Math.max(p.w / 2 + 6, Math.min(W - p.w / 2 - 6, p.x));
    if (p.inv > 0) p.inv -= dt;

    // Floating texts, particles and banner always animate
    game.texts.forEach(function (t) { t.y -= 30 * dt; t.t -= dt; });
    game.texts = game.texts.filter(function (t) { return t.t > 0; });
    game.parts.forEach(function (q) { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 260 * dt; q.life -= dt; });
    game.parts = game.parts.filter(function (q) { return q.life > 0; });
    if (game.msgT > 0) game.msgT -= dt;

    // Short pause at the start of each sprint
    if (game.introT > 0) { game.introT -= dt; return; }

    // Shooting (one player shot on screen at a time, like the arcade classics)
    p.cool -= dt;
    if ((keys.fire || (isTouch && touchActive)) && p.cool <= 0 && game.shots.length < 1) {
      game.shots.push({ x: p.x, y: p.y - p.h / 2, v: 600 });
      p.cool = 0.22;
      sfx.shoot();
    }
    game.shots.forEach(function (s) { s.py = s.y; s.y -= s.v * dt; });
    game.shots = game.shots.filter(function (s) {
      if (s.y < -10) return false;
      if (hitShield(s.x, s.py, s.y)) { sfx.block(); return false; }
      return true;
    });

    // Formation movement: faster each sprint and as fewer bugs remain
    var alive = aliveBugs();
    var ratio = 1 - alive.length / game.total;
    var bugSpeed = (26 + game.sprint * 7) * (1 + ratio * 3);
    game.fx += game.dir * bugSpeed * dt;
    layoutBugs();
    var minX = Infinity, maxX = -Infinity, maxY = -Infinity;
    alive.forEach(function (b) { minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x); maxY = Math.max(maxY, b.y); });
    if (maxX > W - 26 && game.dir > 0) { game.dir = -1; game.fy += 14; layoutBugs(); }
    else if (minX < 26 && game.dir < 0) { game.dir = 1; game.fy += 14; layoutBugs(); }
    game.step += dt * (2 + ratio * 5);
    game.frame = Math.floor(game.step) % 2;

    bugsEatShields(alive);

    // Bugs reach the player line: game over
    if (maxY > p.y - 26) { burst(p.x, p.y, '#e8618c', 26); game.lives = 0; renderHud(); gameOver(); return; }

    // Enemy fire: more frequent and more shots at once in later sprints
    game.enemyTimer -= dt;
    var maxEnemyShots = Math.min(1 + game.sprint, 6);
    if (game.enemyTimer <= 0 && alive.length && game.enemyShots.length < maxEnemyShots) {
      var cols = {};
      alive.forEach(function (b) { if (!cols[b.col] || cols[b.col].y < b.y) cols[b.col] = b; });
      var shooters = Object.keys(cols).map(function (k) { return cols[k]; });
      // half the time, aim at the column above the player
      var sh = shooters[Math.floor(Math.random() * shooters.length)];
      if (Math.random() < 0.5) shooters.forEach(function (b) { if (Math.abs(b.x - p.x) < Math.abs(sh.x - p.x)) sh = b; });
      game.enemyShots.push({ x: sh.x, y: sh.y + 14, py: sh.y + 14, v: 170 + game.sprint * 16, t: 0 });
      game.enemyTimer = Math.max(0.28, 1.25 - game.sprint * 0.1 - ratio * 0.45) * (0.6 + Math.random() * 0.8);
    }
    game.enemyShots.forEach(function (s) { s.py = s.y; s.y += s.v * dt; s.t += dt; });
    game.enemyShots = game.enemyShots.filter(function (s) {
      if (s.y > H + 10) return false;
      return !hitShield(s.x, s.py, s.y);
    });

    // Player shot vs enemy shot (they cancel out)
    game.shots.forEach(function (s) {
      game.enemyShots.forEach(function (es) {
        if (Math.abs(s.x - es.x) < 6 && Math.abs(s.y - es.y) < 12) { s.y = -100; es.y = H + 100; burst(es.x, es.y, css('--accent'), 5); }
      });
    });

    // Hotfix bonus crossing the top
    game.ufoTimer -= dt;
    if (!game.ufo && game.ufoTimer <= 0 && alive.length > 4) {
      var fromLeft = Math.random() < 0.5;
      game.ufo = { x: fromLeft ? -30 : W + 30, y: 26, v: fromLeft ? 120 : -120 };
    }
    if (game.ufo) {
      game.ufo.x += game.ufo.v * dt;
      if (game.ufo.x < -40 || game.ufo.x > W + 40) { game.ufo = null; game.ufoTimer = 15 + Math.random() * 12; }
    }

    // Collisions: player shot vs bugs and hotfix
    game.shots.forEach(function (s) {
      if (game.ufo && Math.abs(s.x - game.ufo.x) < 18 && Math.abs(s.y - game.ufo.y) < 14) {
        var bonus = [50, 100, 150, 300][Math.floor(Math.random() * 4)];
        floatText(game.ufo.x, game.ufo.y + 10, fmt(S.hotfix, bonus), '#d98a3a');
        burst(game.ufo.x, game.ufo.y, '#d98a3a', 16);
        game.ufo = null; game.ufoTimer = 15 + Math.random() * 12; s.y = -100;
        sfx.hotfix();
        addScore(bonus);
        return;
      }
      for (var i = 0; i < alive.length; i++) {
        var b = alive[i];
        if (b.alive && Math.abs(s.x - b.x) < 16 && Math.abs(s.y - b.y) < 14) {
          b.alive = false; s.y = -100;
          game.killed++;
          burst(b.x, b.y, ROW_COLORS[b.row % ROW_COLORS.length], 12);
          sfx.hit();
          addScore(KIND_PTS[b.kind]);
          break;
        }
      }
    });

    // Enemy shots vs player
    if (p.inv <= 0) {
      for (var j = 0; j < game.enemyShots.length; j++) {
        var es = game.enemyShots[j];
        if (Math.abs(es.x - p.x) < p.w / 2 - 2 && Math.abs(es.y - p.y) < p.h / 2) {
          es.y = H + 100;
          game.lives--;
          p.inv = 1.6;
          burst(p.x, p.y, '#f6c453', 18);
          sfx.playerHit();
          renderHud();
          if (game.lives <= 0) { gameOver(); return; }
          break;
        }
      }
    }

    // Sprint cleared: bonus, then the next wave starts lower and faster
    if (!aliveBugs().length) {
      addScore(100 * game.sprint);
      sfx.clear();
      floatText(W / 2, H / 2 + 34, fmt(S.sprint_done, game.sprint), css('--heading'));
      game.sprint++;
      newSprint();
      renderHud();
    }
  }

  function burst(x, y, color, n) {
    if (reduceMotion) n = Math.ceil(n / 3);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 160;
      game.parts.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life: 0.4 + Math.random() * 0.4, color: color });
    }
  }

  /* ---------- Drawing ---------- */

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    var ink = css('--heading'), accent = css('--accent'), dark = isDark();

    if (dark) {
      ctx.fillStyle = '#ffffff';
      stars.forEach(function (st) { ctx.globalAlpha = st.a; ctx.fillRect(st.x * W, st.y * (H - 40), st.r, st.r); });
      ctx.globalAlpha = 1;
    }
    if (!game) return;

    // ground line
    ctx.strokeStyle = ink; ctx.globalAlpha = 0.15; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, H - 8); ctx.lineTo(W, H - 8); ctx.stroke(); ctx.globalAlpha = 1;

    // firewalls
    ctx.fillStyle = dark ? '#3fb37f' : '#2f9e6a';
    game.shields.forEach(function (s) {
      for (var r = 0; r < SH_ROWS; r++) for (var c = 0; c < SH_COLS; c++) {
        if (s.cells[r * SH_COLS + c]) ctx.fillRect(s.x + c * CELL, s.y + r * CELL, CELL + 0.6, CELL + 0.6);
      }
    });

    game.bugs.forEach(function (b) { if (b.alive) drawBug(b.x, b.y, ROW_COLORS[b.row % ROW_COLORS.length], game.frame, b.kind); });
    if (game.ufo) drawCoffee(game.ufo.x, game.ufo.y);

    // player shots: little cheese drops
    ctx.fillStyle = '#f6c453';
    game.shots.forEach(function (s) { roundRect(s.x - 2.5, s.y - 9, 5, 14, 2.5); ctx.fill(); });

    // enemy shots: zigzag "errors"
    ctx.strokeStyle = accent; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    game.enemyShots.forEach(function (s) {
      var z = Math.sin(s.t * 30) * 3;
      ctx.beginPath(); ctx.moveTo(s.x - z, s.y - 8); ctx.lineTo(s.x + z, s.y - 3); ctx.lineTo(s.x - z, s.y + 2); ctx.lineTo(s.x + z, s.y + 7); ctx.stroke();
    });

    var p = game.player;
    if (!(p.inv > 0 && Math.floor(p.inv * 10) % 2 === 0)) drawPizza(p.x, p.y);

    game.parts.forEach(function (q) { ctx.globalAlpha = Math.max(0, q.life * 1.8); ctx.fillStyle = q.color; ctx.fillRect(q.x - 2, q.y - 2, 4, 4); });
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    game.texts.forEach(function (t) {
      ctx.globalAlpha = Math.min(1, t.t * 1.5);
      ctx.fillStyle = t.color;
      ctx.font = '800 16px Montserrat, Inter, sans-serif';
      ctx.fillText(t.text, t.x, t.y);
    });
    ctx.globalAlpha = 1;

    if (game.msgT > 0 && state === 'play') {
      ctx.globalAlpha = Math.min(1, game.msgT * 1.5);
      ctx.fillStyle = ink;
      ctx.font = '900 30px Montserrat, Inter, sans-serif';
      ctx.fillText(game.msg, W / 2, H / 2);
      ctx.globalAlpha = 1;
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function drawBug(x, y, color, frame, kind) {
    var leg = frame ? 3 : -3, i;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2; ctx.lineCap = 'round';

    if (kind === 0) {
      // fly: round body with flapping wings
      ctx.globalAlpha = 0.45;
      ctx.beginPath(); ctx.ellipse(x - 9, y - 6 + leg / 2, 8, 5, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + 9, y - 6 + leg / 2, 8, 5, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.ellipse(x, y + 1, 7, 9, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y - 9, 5, 0, Math.PI * 2); ctx.fill();
      for (i = -1; i <= 1; i += 2) { ctx.beginPath(); ctx.moveTo(x + i * 5, y + 7); ctx.lineTo(x + i * 10, y + 12 + (i > 0 ? leg : -leg) / 2); ctx.stroke(); }
    } else if (kind === 1) {
      // beetle: wide shell with spots
      for (i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.moveTo(x - 9, y + i * 5); ctx.lineTo(x - 17, y + i * 6 + (i === 0 ? leg : -leg)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 9, y + i * 5); ctx.lineTo(x + 17, y + i * 6 + (i === 0 ? -leg : leg)); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(x - 3, y - 10); ctx.lineTo(x - 7 - leg / 2, y - 17); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 3, y - 10); ctx.lineTo(x + 7 + leg / 2, y - 17); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y + 2, 11, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y - 9, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.beginPath(); ctx.arc(x - 5, y + 1, 2.2, 0, Math.PI * 2); ctx.arc(x + 5, y + 5, 2.2, 0, Math.PI * 2); ctx.arc(x - 3, y + 8, 1.8, 0, Math.PI * 2); ctx.fill();
    } else {
      // ant: long body with antennae
      for (i = -1; i <= 1; i++) {
        ctx.beginPath(); ctx.moveTo(x - 7, y + i * 5); ctx.lineTo(x - 15, y + i * 6 + (i === 0 ? leg : -leg)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 7, y + i * 5); ctx.lineTo(x + 15, y + i * 6 + (i === 0 ? -leg : leg)); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(x - 3, y - 11); ctx.quadraticCurveTo(x - 6, y - 18, x - 10 - leg / 2, y - 19); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 3, y - 11); ctx.quadraticCurveTo(x + 6, y - 18, x + 10 + leg / 2, y - 19); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x, y + 2, 8, 11, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y - 9, 5.5, 0, Math.PI * 2); ctx.fill();
    }
    // shell line + eyes
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 11); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(x - 2.3, y - 10, 1.5, 0, Math.PI * 2); ctx.arc(x + 2.3, y - 10, 1.5, 0, Math.PI * 2); ctx.fill();
  }

  function drawCoffee(x, y) {
    // the "hotfix": a coffee mug with steam
    ctx.fillStyle = '#d98a3a';
    roundRect(x - 11, y - 8, 20, 18, 4); ctx.fill();
    ctx.strokeStyle = '#d98a3a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x + 11, y + 1, 5, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    ctx.fillStyle = '#6b3d1f';
    ctx.fillRect(x - 8, y - 6, 14, 3);
    ctx.strokeStyle = css('--soft'); ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    var w = Math.sin(performance.now() / 180) * 2;
    ctx.beginPath(); ctx.moveTo(x - 4, y - 11); ctx.quadraticCurveTo(x - 6 + w, y - 16, x - 3, y - 21); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 3, y - 11); ctx.quadraticCurveTo(x + 1 - w, y - 16, x + 4, y - 21); ctx.stroke();
  }

  function drawPizza(x, y) {
    // a slice pointing up: cheese triangle, crust at the bottom, pepperoni
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#f6c453';
    ctx.beginPath(); ctx.moveTo(x, y - 18); ctx.lineTo(x + 16, y + 12); ctx.lineTo(x - 16, y + 12); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#d98a3a'; ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 16, y + 13); ctx.quadraticCurveTo(x, y + 19, x + 16, y + 13); ctx.stroke();
    ctx.fillStyle = '#c8423b';
    ctx.beginPath(); ctx.arc(x - 1, y - 4, 3.2, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x - 6, y + 6, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 6, y + 5, 3, 0, Math.PI * 2); ctx.fill();
  }

  /* ---------- Input ---------- */

  function onKey(e, down) {
    if (!root || root.hidden) return;
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { keys.left = down; e.preventDefault(); }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { keys.right = down; e.preventDefault(); }
    else if (k === ' ' || k === 'Spacebar') {
      var onLink = e.target && e.target.closest && e.target.closest('a');
      if (onLink) return;                       // let links (WhatsApp, CV) work normally
      e.preventDefault();
      if (state === 'start' || state === 'over') { if (down) startGame(); return; }
      keys.fire = down;
    }
    else if (down && k === 'Enter' && state === 'start') { e.preventDefault(); startGame(); }
    else if (down && (k === 'p' || k === 'P')) { e.preventDefault(); setPaused(state === 'play'); }
    else if (down && (k === 'm' || k === 'M')) { e.preventDefault(); toggleSound(); }
    else if (down && k === 'Escape') { e.preventDefault(); e.stopPropagation(); closeGame(); }
    else if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); }
  }
  function onKeyDown(e) { onKey(e, true); }
  function onKeyUp(e) { onKey(e, false); }

  function onPointer(e) {
    if (e.pointerType === 'mouse') return;
    if (e.target.closest && e.target.closest('button, a')) return;
    isTouch = true;
    panel.classList.add('is-touch');
    if (e.type === 'pointerdown') {
      touchActive = true;
      if (state === 'start' || state === 'over') { startGame(); }
    }
    if (!touchActive) return;
    var r = canvas.getBoundingClientRect();
    touchX = (e.clientX - r.left) / r.width * W;
    e.preventDefault();
  }

  function onVisibility() { if (document.hidden && state === 'play') setPaused(true); }

  /* ---------- Open / close ---------- */

  function openGame(options) {
    opts = options;
    S = options.strings;
    if (!root) {
      build();
      document.body.appendChild(root);
    }
    lastFocus = document.activeElement;
    root.hidden = false;
    document.documentElement.classList.add('bh-open');
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    syncThemeBtn();
    syncSoundBtn();
    state = 'start';
    game = null;
    resize();
    newGame();
    renderHud();
    draw();
    showScreen('start');
    running = true;
    loop.last = 0;
    raf = requestAnimationFrame(loop);
  }

  function closeGame() {
    if (!root) return;
    running = false;
    cancelAnimationFrame(raf);
    keys = {}; touchActive = false;
    state = 'closed';
    syncUfoSound();
    if (audio && audio.state === 'running') audio.suspend();
    root.hidden = true;
    document.documentElement.classList.remove('bh-open');
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }

  window.BugHunt = { open: openGame, close: closeGame };
})();
