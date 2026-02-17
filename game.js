(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: true });

  const ui = {
    hpFill: document.getElementById("hpFill"),
    stFill: document.getElementById("stFill"),
    ammoFill: document.getElementById("ammoFill"),
    hpText: document.getElementById("hpText"),
    stText: document.getElementById("stText"),
    ammoText: document.getElementById("ammoText"),
    waveText: document.getElementById("waveText"),
    scoreText: document.getElementById("scoreText"),
    aiText: document.getElementById("aiText"),
    statusText: document.getElementById("statusText"),

    btnMute: document.getElementById("btnMute"),
    btnRestart: document.getElementById("btnRestart"),
    btnHow: document.getElementById("btnHow"),
    modal: document.getElementById("modal"),
    btnClose: document.getElementById("btnClose"),
    startOverlay: document.getElementById("startOverlay"),
    btnStart: document.getElementById("btnStart"),

    mobileControls: document.getElementById("mobileControls"),
    leftStick: document.getElementById("leftStick"),
    leftKnob: document.getElementById("leftKnob"),
    rightAim: document.getElementById("rightAim"),
    rightKnob: document.getElementById("rightKnob"),
    btnShoot: document.getElementById("btnShoot"),
    btnReload: document.getElementById("btnReload"),
    btnSprint: document.getElementById("btnSprint"),
  };

  const DPR = Math.min(2, window.devicePixelRatio || 1);
  let W = 1280, H = 720;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    W = Math.max(320, rect.width);
    H = Math.max(320, rect.height);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resize);

  const isTouch = () => matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;

  const keys = new Set();
  window.addEventListener("keydown", (e) => {
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)) e.preventDefault();
    keys.add(e.key.toLowerCase());
  }, { passive: false });

  window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));

  const pointer = {
    x: 0, y: 0, down: false,
    worldX: 0, worldY: 0
  };

  canvas.addEventListener("pointerdown", (e) => {
    pointer.down = true;
    setPointer(e);
  });
  canvas.addEventListener("pointermove", (e) => setPointer(e));
  window.addEventListener("pointerup", () => pointer.down = false);

  function setPointer(e) {
    const r = canvas.getBoundingClientRect();
    pointer.x = (e.clientX - r.left);
    pointer.y = (e.clientY - r.top);
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const rnd = () => Math.random();
  const rand = (a, b) => a + (b - a) * rnd();

  const audio = (() => {
    let ctxA = null;
    let master = null;
    let enabled = true;

    function ensure() {
      if (ctxA) return;
      ctxA = new (window.AudioContext || window.webkitAudioContext)();
      master = ctxA.createGain();
      master.gain.value = 0.9;
      master.connect(ctxA.destination);
    }

    function setEnabled(v) {
      enabled = v;
      if (master) master.gain.value = enabled ? 0.9 : 0.0001;
    }

    function blip(freq, dur, type, gain, glideTo) {
      if (!enabled) return;
      ensure();
      const t0 = ctxA.currentTime;
      const o = ctxA.createOscillator();
      const g = ctxA.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t0);
      if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.12, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(master);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }

    function noiseBurst(dur, gain) {
      if (!enabled) return;
      ensure();
      const sr = ctxA.sampleRate;
      const len = Math.floor(sr * dur);
      const buf = ctxA.createBuffer(1, len, sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctxA.createBufferSource();
      src.buffer = buf;

      const biq = ctxA.createBiquadFilter();
      biq.type = "highpass";
      biq.frequency.value = 600;

      const g = ctxA.createGain();
      g.gain.value = gain || 0.20;

      src.connect(biq);
      biq.connect(g);
      g.connect(master);
      src.start();
    }

    return {
      ensure,
      setEnabled,
      blip,
      noiseBurst
    };
  })();

  const world = {
    w: 2400,
    h: 1600
  };

  const cam = { x: 0, y: 0, shake: 0 };

  const player = {
    x: world.w * 0.5,
    y: world.h * 0.5,
    vx: 0, vy: 0,
    r: 14,
    hp: 100,
    stam: 100,
    ammo: 30,
    ammoMax: 30,
    reloadT: 0,
    fireCd: 0,
    sprint: false,
    aimX: 1, aimY: 0,
    accuracy: 0
  };

  const predator = {
    x: world.w * 0.25,
    y: world.h * 0.35,
    vx: 0, vy: 0,
    r: 20,
    hp: 100,
    dashCd: 0,
    hitT: 0
  };

  const bullets = [];
  const particles = [];
  const decals = [];

  let score = 0;
  let wave = 1;
  let alive = true;
  let started = false;

  const ai = new window.PredatorAI({ heatSize: 64 });

  const input = {
    mx: 0, my: 0,
    ax: 1, ay: 0,
    moveX: 0, moveY: 0,
    shoot: false,
    reload: false,
    sprint: false
  };

  const stick = {
    left: { id: null, ox: 0, oy: 0, x: 0, y: 0, active: false },
    right: { id: null, ox: 0, oy: 0, x: 0, y: 0, active: false }
  };

  function bindTouch() {
    if (!isTouch()) return;

    ui.mobileControls.style.display = "flex";

    const bindPad = (el, which) => {
      el.addEventListener("pointerdown", (e) => {
        el.setPointerCapture(e.pointerId);
        stick[which].id = e.pointerId;
        stick[which].active = true;
        const r = el.getBoundingClientRect();
        stick[which].ox = e.clientX - r.left;
        stick[which].oy = e.clientY - r.top;
        stick[which].x = stick[which].ox;
        stick[which].y = stick[which].oy;
      });

      el.addEventListener("pointermove", (e) => {
        if (!stick[which].active || stick[which].id !== e.pointerId) return;
        const r = el.getBoundingClientRect();
        stick[which].x = e.clientX - r.left;
        stick[which].y = e.clientY - r.top;
      });

      el.addEventListener("pointerup", (e) => {
        if (stick[which].id !== e.pointerId) return;
        stick[which].active = false;
        stick[which].id = null;
        stick[which].x = stick[which].ox;
        stick[which].y = stick[which].oy;
      });
    };

    bindPad(ui.leftStick, "left");
    bindPad(ui.rightAim, "right");

    ui.btnShoot.addEventListener("pointerdown", () => input.shoot = true);
    ui.btnShoot.addEventListener("pointerup", () => input.shoot = false);
    ui.btnShoot.addEventListener("pointercancel", () => input.shoot = false);

    ui.btnReload.addEventListener("click", () => input.reload = true);
    ui.btnSprint.addEventListener("pointerdown", () => input.sprint = true);
    ui.btnSprint.addEventListener("pointerup", () => input.sprint = false);
    ui.btnSprint.addEventListener("pointercancel", () => input.sprint = false);
  }

  function updateSticks() {
    if (!isTouch()) return;

    const norm = (s) => {
      const dx = s.x - s.ox;
      const dy = s.y - s.oy;
      const max = 52;
      const dist = Math.hypot(dx, dy) || 0.0001;
      const k = Math.min(1, dist / max);
      const nx = (dx / dist) * k;
      const ny = (dy / dist) * k;
      return { nx, ny, dx: nx * max, dy: ny * max };
    };

    const L = norm(stick.left);
    ui.leftKnob.style.transform = `translate(calc(-50% + ${L.dx}px), calc(-50% + ${L.dy}px))`;
    input.moveX = L.nx;
    input.moveY = L.ny;

    const R = norm(stick.right);
    ui.rightKnob.style.transform = `translate(calc(-50% + ${R.dx}px), calc(-50% + ${R.dy}px))`;
    const ax = R.nx, ay = R.ny;
    if (Math.hypot(ax, ay) > 0.12) {
      input.ax = ax;
      input.ay = ay;
    }
  }

  function resetGame() {
    score = 0;
    wave = 1;
    alive = true;

    player.x = world.w * 0.5;
    player.y = world.h * 0.5;
    player.vx = 0; player.vy = 0;
    player.hp = 100;
    player.stam = 100;
    player.ammo = player.ammoMax;
    player.reloadT = 0;
    player.fireCd = 0;
    player.aimX = 1; player.aimY = 0;

    predator.x = world.w * 0.22;
    predator.y = world.h * 0.34;
    predator.vx = 0; predator.vy = 0;
    predator.hp = 100;
    predator.dashCd = 0;
    predator.hitT = 0;

    bullets.length = 0;
    particles.length = 0;
    decals.length = 0;

    ai.reset();
    cam.shake = 0;

    ui.statusText.textContent = "Hunt started";
  }

  function openHow(open) {
    ui.modal.style.display = open ? "flex" : "none";
    ui.modal.setAttribute("aria-hidden", open ? "false" : "true");
  }

  ui.btnHow.addEventListener("click", () => openHow(true));
  ui.btnClose.addEventListener("click", () => openHow(false));
  ui.modal.addEventListener("click", (e) => { if (e.target === ui.modal) openHow(false); });

  ui.btnRestart.addEventListener("click", () => {
    if (!started) return;
    resetGame();
  });

  let muted = false;
  ui.btnMute.addEventListener("click", () => {
    muted = !muted;
    audio.setEnabled(!muted);
    ui.btnMute.textContent = muted ? "Sound: OFF" : "Sound: ON";
    if (!muted && started) audio.ensure();
  });

  ui.btnStart.addEventListener("click", async () => {
    started = true;
    ui.startOverlay.style.display = "none";
    audio.ensure();
    if (audio && audio.ensure) {
      try { await (audio.ensure(), Promise.resolve()); } catch {}
    }
    resetGame();
  });

  function spawnParticle(x, y, vx, vy, life, size, glow, kind) {
    particles.push({ x, y, vx, vy, life, t: 0, size, glow, kind });
  }

  function spawnDecal(x, y) {
    decals.push({ x, y, t: 0, life: rand(1.4, 2.6), r: rand(10, 18) });
    if (decals.length > 80) decals.shift();
  }

  function fire(fromX, fromY, dirX, dirY, speed, dmg, owner) {
    const s = speed || 920;
    bullets.push({
      x: fromX, y: fromY,
      vx: dirX * s, vy: dirY * s,
      life: 1.15, t: 0,
      r: 3.2,
      dmg: dmg || 12,
      owner
    });

    cam.shake = Math.max(cam.shake, owner === "player" ? 6 : 4);

    audio.blip(owner === "player" ? 420 : 220, 0.08, "square", 0.11, owner === "player" ? 260 : 140);
    audio.noiseBurst(0.03, owner === "player" ? 0.20 : 0.16);
  }

  function applyDamage(target, amount) {
    target.hp = Math.max(0, target.hp - amount);
    target.hitT = 0.12;
  }

  function circleHit(ax, ay, ar, bx, by, br) {
    const dx = ax - bx;
    const dy = ay - by;
    return (dx * dx + dy * dy) <= (ar + br) * (ar + br);
  }

  function clampWorld(ent) {
    ent.x = clamp(ent.x, ent.r, world.w - ent.r);
    ent.y = clamp(ent.y, ent.r, world.h - ent.r);
  }

  function playerInput(dt) {
    let mx = 0, my = 0;

    const up = keys.has("w") || keys.has("arrowup");
    const down = keys.has("s") || keys.has("arrowdown");
    const left = keys.has("a") || keys.has("arrowleft");
    const right = keys.has("d") || keys.has("arrowright");

    if (up) my -= 1;
    if (down) my += 1;
    if (left) mx -= 1;
    if (right) mx += 1;

    if (!isTouch()) {
      const dx = pointer.x - W * 0.5;
      const dy = pointer.y - H * 0.5;
      const d = Math.hypot(dx, dy) || 1;
      input.ax = dx / d;
      input.ay = dy / d;
      input.moveX = mx;
      input.moveY = my;
      input.shoot = pointer.down;
      input.reload = keys.has("r");
      input.sprint = keys.has("shift");
    } else {
      updateSticks();
    }

    const d = Math.hypot(input.moveX, input.moveY);
    const nx = d > 0.001 ? input.moveX / d : 0;
    const ny = d > 0.001 ? input.moveY / d : 0;

    const baseSpeed = 260;
    const sprintSpeed = 420;
    const wantsSprint = !!input.sprint;

    const canSprint = wantsSprint && player.stam > 4 && d > 0.12 && player.reloadT <= 0;
    const speed = canSprint ? sprintSpeed : baseSpeed;

    if (canSprint) player.stam = Math.max(0, player.stam - dt * 22);
    else player.stam = Math.min(100, player.stam + dt * 12);

    const ax = input.ax, ay = input.ay;
    if (Math.hypot(ax, ay) > 0.001) { player.aimX = ax; player.aimY = ay; }

    const acc = 15;
    player.vx = lerp(player.vx, nx * speed, 1 - Math.exp(-acc * dt));
    player.vy = lerp(player.vy, ny * speed, 1 - Math.exp(-acc * dt));

    player.x += player.vx * dt;
    player.y += player.vy * dt;
    clampWorld(player);

    if (player.reloadT > 0) {
      player.reloadT -= dt;
      if (player.reloadT <= 0) {
        player.ammo = player.ammoMax;
        audio.blip(180, 0.08, "sine", 0.10, 260);
        audio.blip(520, 0.06, "triangle", 0.09, 420);
        ui.statusText.textContent = "Reloaded";
      }
    }

    if (input.reload && player.reloadT <= 0 && player.ammo < player.ammoMax) {
      player.reloadT = 1.15;
      ui.statusText.textContent = "Reloading...";
      audio.blip(130, 0.10, "sawtooth", 0.10, 90);
      input.reload = false;
    }

    if (player.fireCd > 0) player.fireCd -= dt;

    if (alive && input.shoot && player.reloadT <= 0 && player.fireCd <= 0) {
      if (player.ammo > 0) {
        const spread = (1 - clamp(player.stam / 100, 0, 1)) * 0.10 + 0.02;
        const ang = Math.atan2(player.aimY, player.aimX) + rand(-spread, spread);
        const dx = Math.cos(ang), dy = Math.sin(ang);
        fire(player.x + dx * 18, player.y + dy * 18, dx, dy, 980, 12, "player");
        player.ammo -= 1;
        player.fireCd = 0.095;
        spawnParticle(player.x + dx * 18, player.y + dy * 18, rand(-40,40), rand(-40,40), 0.18, 2.2, 1, "muzzle");
      } else {
        player.fireCd = 0.18;
        audio.blip(90, 0.09, "square", 0.08, 70);
        ui.statusText.textContent = "No ammo!";
      }
    }
  }

  function predatorLogic(dt) {
    if (predator.dashCd > 0) predator.dashCd -= dt;
    predator.hitT = Math.max(0, predator.hitT - dt);

    const dxp = player.x - predator.x;
    const dyp = player.y - predator.y;
    const dist = Math.hypot(dxp, dyp) || 1;

    const visRange = 740;
    const canSee = dist < visRange && (Math.abs(dxp) + Math.abs(dyp)) < visRange * 1.25;

    const playerShot = input.shoot && player.fireCd > 0 && player.fireCd < 0.12;
    ai.observePlayer(player.x, player.y, world.w, world.h, dt, canSee, playerShot, player.aimX, player.aimY);

    const decision = ai.decide(predator.x, predator.y, world.w, world.h, dt);

    const ax = decision.ax || 0;
    const ay = decision.ay || 0;
    const acc = 10;
    predator.vx = lerp(predator.vx, ax, 1 - Math.exp(-acc * dt));
    predator.vy = lerp(predator.vy, ay, 1 - Math.exp(-acc * dt));

    predator.x += predator.vx * dt;
    predator.y += predator.vy * dt;
    clampWorld(predator);

    const aimDx = dxp / dist;
    const aimDy = dyp / dist;

    const wantsDash = decision.desireDash && predator.dashCd <= 0 && dist < 340;
    if (wantsDash) {
      predator.dashCd = 1.6;
      predator.vx += aimDx * 420;
      predator.vy += aimDy * 420;
      cam.shake = Math.max(cam.shake, 7);
      for (let i = 0; i < 12; i++) {
        spawnParticle(predator.x, predator.y, rand(-140,140), rand(-140,140), rand(0.22,0.42), rand(1.6,2.8), 1, "dash");
      }
      audio.blip(120, 0.10, "sawtooth", 0.12, 80);
      audio.noiseBurst(0.05, 0.20);
    }

    if (decision.desireShoot && dist < 560) {
      predator._shootCd = predator._shootCd || 0;
      predator._shootCd = Math.max(0, predator._shootCd - dt);
      if (predator._shootCd <= 0) {
        predator._shootCd = lerp(0.38, 0.22, clamp(ai.aggression || 0.6, 0.35, 0.95));
        fire(predator.x + aimDx * 22, predator.y + aimDy * 22, aimDx, aimDy, 860, 10, "pred");
        for (let i = 0; i < 2; i++) spawnParticle(predator.x + aimDx * 22, predator.y + aimDy * 22, rand(-30,30), rand(-30,30), 0.18, 2.2, 1, "muzzle2");
      }
    }

    if (circleHit(player.x, player.y, player.r, predator.x, predator.y, predator.r) && alive) {
      const dmg = 18;
      applyDamage(player, dmg);
      cam.shake = Math.max(cam.shake, 10);
      for (let i = 0; i < 22; i++) {
        spawnParticle(player.x, player.y, rand(-220,220), rand(-220,220), rand(0.25,0.55), rand(1.6,3.0), 1, "hit");
      }
      audio.blip(95, 0.12, "square", 0.14, 55);
      audio.noiseBurst(0.08, 0.26);
      predator.vx -= aimDx * 260;
      predator.vy -= aimDy * 260;
    }
  }

  function bulletsUpdate(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.t += dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      const out = b.x < -40 || b.y < -40 || b.x > world.w + 40 || b.y > world.h + 40;
      if (out || b.t > b.life) {
        bullets.splice(i, 1);
        continue;
      }

      if (b.owner === "player") {
        if (circleHit(b.x, b.y, b.r, predator.x, predator.y, predator.r)) {
          applyDamage(predator, b.dmg);
          spawnDecal(b.x, b.y);
          cam.shake = Math.max(cam.shake, 7);
          for (let k = 0; k < 18; k++) {
            spawnParticle(b.x, b.y, rand(-260,260), rand(-260,260), rand(0.18,0.45), rand(1.4,2.6), 1, "spark");
          }
          audio.blip(240, 0.05, "triangle", 0.10, 360);
          bullets.splice(i, 1);

          score += 15;
          ui.statusText.textContent = "Hit!";
        }
      } else {
        if (alive && circleHit(b.x, b.y, b.r, player.x, player.y, player.r)) {
          applyDamage(player, b.dmg);
          spawnDecal(b.x, b.y);
          cam.shake = Math.max(cam.shake, 8);
          for (let k = 0; k < 16; k++) {
            spawnParticle(b.x, b.y, rand(-240,240), rand(-240,240), rand(0.18,0.44), rand(1.4,2.5), 1, "hit");
          }
          audio.blip(110, 0.08, "square", 0.12, 70);
          audio.noiseBurst(0.05, 0.20);
          bullets.splice(i, 1);
        }
      }
    }
  }

  function particlesUpdate(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= (1 - dt * 3.2);
      p.vy *= (1 - dt * 3.2);
      if (p.t >= p.life) particles.splice(i, 1);
    }

    for (let i = decals.length - 1; i >= 0; i--) {
      const d = decals[i];
      d.t += dt;
      if (d.t >= d.life) decals.splice(i, 1);
    }
  }

  function waveCheck() {
    if (predator.hp <= 0) {
      score += 120 + wave * 25;
      wave += 1;

      predator.hp = 100 + (wave - 1) * 15;
      predator.x = rand(world.w * 0.15, world.w * 0.85);
      predator.y = rand(world.h * 0.15, world.h * 0.85);
      predator.vx = 0; predator.vy = 0;
      predator.dashCd = 0;
      predator._shootCd = 0;

      ai.state = "SEARCH";
      ai.stateT = 0;

      for (let i = 0; i < 60; i++) {
        spawnParticle(predator.x, predator.y, rand(-420,420), rand(-420,420), rand(0.35,0.95), rand(1.6,3.4), 1, "death");
      }
      audio.blip(180, 0.14, "sawtooth", 0.12, 60);
      audio.noiseBurst(0.12, 0.30);

      ui.statusText.textContent = `Wave ${wave} started`;
    }

    if (player.hp <= 0 && alive) {
      alive = false;
      ui.statusText.textContent = "You were hunted. Restart?";
      audio.blip(90, 0.25, "square", 0.14, 45);
      audio.noiseBurst(0.15, 0.32);
    }
  }

  function updateUI() {
    const hp = clamp(player.hp, 0, 100);
    const st = clamp(player.stam, 0, 100);
    const ammo = clamp(player.ammo, 0, player.ammoMax);

    ui.hpFill.style.width = `${hp}%`;
    ui.stFill.style.width = `${st}%`;
    ui.ammoFill.style.width = `${(ammo / player.ammoMax) * 100}%`;

    ui.hpText.textContent = `${Math.round(player.hp)}`;
    ui.stText.textContent = `${Math.round(player.stam)}`;
    ui.ammoText.textContent = `${Math.round(player.ammo)}`;

    ui.waveText.textContent = `${wave}`;
    ui.scoreText.textContent = `${score}`;
    ui.aiText.textContent = ai.getUIState();
  }

  function draw(dt) {
    const shake = cam.shake;
    cam.shake = Math.max(0, cam.shake - dt * 20);
    const sx = (rnd() * 2 - 1) * shake;
    const sy = (rnd() * 2 - 1) * shake;

    cam.x = lerp(cam.x, player.x - W * 0.5, 1 - Math.exp(-dt * 6));
    cam.y = lerp(cam.y, player.y - H * 0.5, 1 - Math.exp(-dt * 6));
    cam.x = clamp(cam.x, 0, world.w - W);
    cam.y = clamp(cam.y, 0, world.h - H);

    ctx.clearRect(0, 0, W, H);

    ctx.save();
    ctx.translate(-cam.x + sx, -cam.y + sy);

    drawWorld();
    drawDecals();
    drawEntities();
    drawBullets();
    drawParticles();
    drawFogAndLight();

    ctx.restore();
  }

  function drawWorld() {
    const g = ctx.createLinearGradient(0, 0, world.w, world.h);
    g.addColorStop(0, "rgba(255,255,255,0.03)");
    g.addColorStop(0.45, "rgba(124,58,237,0.04)");
    g.addColorStop(1, "rgba(34,211,238,0.03)");

    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(0, 0, world.w, world.h);

    ctx.fillStyle = g;
    ctx.fillRect(0, 0, world.w, world.h);

    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    const step = 80;
    for (let x = 0; x <= world.w; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, world.h);
      ctx.stroke();
    }
    for (let y = 0; y <= world.h; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(world.w, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 14; i++) {
      const x = (i * 173) % world.w;
      const y = (i * 229) % world.h;
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.fillRect(x + 120, y + 70, 140, 26);
      ctx.fillStyle = "rgba(124,58,237,0.05)";
      ctx.fillRect(x + 70, y + 160, 220, 36);
    }
    ctx.globalAlpha = 1;
  }

  function drawDecals() {
    for (const d of decals) {
      const a = 1 - d.t / d.life;
      ctx.globalAlpha = 0.35 * a;
      ctx.fillStyle = "rgba(239,68,68,0.25)";
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawEntity(x, y, r, base, glow, hit, label) {
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.2, x, y, r * 2.4);
    g.addColorStop(0, "rgba(255,255,255,0.65)");
    g.addColorStop(0.25, base);
    g.addColorStop(1, "rgba(0,0,0,0)");

    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.05, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = glow;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.08, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = hit > 0 ? 0.85 : 0.55;
    ctx.fillStyle = hit > 0 ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.arc(x, y, r * 0.72, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "800 12px ui-sans-serif,system-ui";
    ctx.fillText(label, x - r, y - r - 10);
    ctx.globalAlpha = 1;
  }

  function drawEntities() {
    drawEntity(player.x, player.y, player.r, "rgba(34,211,238,0.55)", "rgba(34,211,238,0.55)", 0, "YOU");

    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(player.x, player.y);
    ctx.lineTo(player.x + player.aimX * 34, player.y + player.aimY * 34);
    ctx.stroke();
    ctx.globalAlpha = 1;

    drawEntity(predator.x, predator.y, predator.r, "rgba(124,58,237,0.60)", "rgba(124,58,237,0.60)", predator.hitT, "PREDATOR");

    const hpW = 140;
    const hpH = 10;
    const px = predator.x - hpW * 0.5;
    const py = predator.y + predator.r + 16;

    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(px, py, hpW, hpH);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.strokeRect(px, py, hpW, hpH);

    const pHP = clamp(predator.hp / (100 + (wave - 1) * 15), 0, 1);
    const grad = ctx.createLinearGradient(px, py, px + hpW, py);
    grad.addColorStop(0, "rgba(239,68,68,0.95)");
    grad.addColorStop(1, "rgba(124,58,237,0.85)");
    ctx.fillStyle = grad;
    ctx.fillRect(px, py, hpW * pHP, hpH);
    ctx.globalAlpha = 1;
  }

  function drawBullets() {
    for (const b of bullets) {
      const a = 1 - b.t / b.life;
      ctx.globalAlpha = 0.85 * a;
      ctx.fillStyle = b.owner === "player" ? "rgba(34,211,238,0.9)" : "rgba(239,68,68,0.85)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.25 * a;
      ctx.strokeStyle = b.owner === "player" ? "rgba(34,211,238,0.6)" : "rgba(239,68,68,0.55)";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const a = 1 - p.t / p.life;
      const s = p.size * (0.8 + 0.8 * a);
      ctx.globalAlpha = 0.65 * a;

      let col = "rgba(255,255,255,0.7)";
      if (p.kind === "spark") col = "rgba(34,211,238,0.85)";
      if (p.kind === "hit") col = "rgba(239,68,68,0.70)";
      if (p.kind === "dash") col = "rgba(124,58,237,0.75)";
      if (p.kind === "death") col = "rgba(124,58,237,0.55)";
      if (p.kind === "muzzle") col = "rgba(245,158,11,0.85)";
      if (p.kind === "muzzle2") col = "rgba(239,68,68,0.75)";

      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.20 * a;
      ctx.strokeStyle = col;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawFogAndLight() {
    const cx = player.x;
    const cy = player.y;

    const fog = ctx.createRadialGradient(cx, cy, 60, cx, cy, 520);
    fog.addColorStop(0, "rgba(0,0,0,0.0)");
    fog.addColorStop(0.35, "rgba(0,0,0,0.10)");
    fog.addColorStop(1, "rgba(0,0,0,0.72)");

    ctx.globalAlpha = 1;
    ctx.fillStyle = fog;
    ctx.fillRect(cam.x, cam.y, W, H);

    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 220);
    glow.addColorStop(0, "rgba(34,211,238,0.14)");
    glow.addColorStop(1, "rgba(34,211,238,0.0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cam.x, cam.y, W, H);

    const pg = ctx.createRadialGradient(predator.x, predator.y, 0, predator.x, predator.y, 260);
    pg.addColorStop(0, "rgba(124,58,237,0.12)");
    pg.addColorStop(1, "rgba(124,58,237,0.0)");
    ctx.fillStyle = pg;
    ctx.fillRect(cam.x, cam.y, W, H);
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;

    if (started) {
      if (alive) {
        playerInput(dt);
        predatorLogic(dt);
        bulletsUpdate(dt);
        particlesUpdate(dt);
        waveCheck();
      } else {
        particlesUpdate(dt);
      }

      updateUI();
      draw(dt);
    } else {
      resize();
      draw(0.016);
    }

    requestAnimationFrame(loop);
  }

  function init() {
    resize();
    bindTouch();

    ui.btnShoot.addEventListener("click", () => {});
    ui.btnReload.addEventListener("click", () => input.reload = true);

    ui.startOverlay.style.display = "flex";

    setInterval(() => {
      if (!started) return;
      const t = performance.now() * 0.001;
      if (!muted && alive) {
        const pace = 0.90 + Math.sin(t * 0.8) * 0.12;
        const base = 48 + wave * 1.2;
        audio.blip(base, 0.05, "sine", 0.028, base * pace);
      }
    }, 520);

    requestAnimationFrame(loop);
  }

  init();
})();
