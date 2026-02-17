(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const $ = (id) => document.getElementById(id);

  const ui = {
    score: $("score"),
    wave: $("wave"),
    fps: $("fps"),
    hpFill: $("hpFill"),
    hpText: $("hpText"),
    armorFill: $("armorFill"),
    armorText: $("armorText"),
    nitroFill: $("nitroFill"),
    nitroText: $("nitroText"),
    best: $("best"),
    mode: $("mode"),
    hint: $("hint"),
    overlay: $("overlay"),
    panelTitle: $("panelTitle"),
    panelSub: $("panelSub"),
    panelNote: $("panelNote"),
    startBtn: $("startBtn"),
    howBtn: $("howBtn"),
    resumeBtn: $("resumeBtn"),
    restartBtn: $("restartBtn"),
    soundDot: $("soundDot"),
    soundLabel: $("soundLabel"),
    mobileControls: $("mobileControls")
  };

  const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp = (a,b,t)=>a+(b-a)*t;
  const rand = (a,b)=>a+Math.random()*(b-a);
  const dist2 = (ax,ay,bx,by)=>{ const dx=ax-bx, dy=ay-by; return dx*dx+dy*dy; };

  function isCoarsePointer(){
    return matchMedia && matchMedia("(pointer: coarse)").matches;
  }

  let W=0,H=0,DPR=1;
  function resize(){
    DPR = Math.max(1, Math.min(2.25, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    W = Math.floor(rect.width);
    H = Math.floor(rect.height);
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  window.addEventListener("resize", resize);

  const input = {
    left:false, right:false, gas:false, brake:false, fire:false, nitro:false,
    justFire:false, justStartAudio:false,
    mute:false
  };

  const keyMap = {
    ArrowLeft:"left", KeyA:"left",
    ArrowRight:"right", KeyD:"right",
    ArrowUp:"gas", KeyW:"gas",
    ArrowDown:"brake", KeyS:"brake",
    Space:"fire",
    ShiftLeft:"nitro", ShiftRight:"nitro"
  };

  window.addEventListener("keydown", (e)=>{
    if (e.code === "KeyM"){
      input.mute = !input.mute;
      setMuted(input.mute);
      return;
    }
    if (e.code === "Escape"){
      togglePause();
      return;
    }
    const act = keyMap[e.code];
    if (!act) return;
    e.preventDefault();
    if (act === "fire" && !input.fire) input.justFire = true;
    input[act] = true;
    input.justStartAudio = true;
  }, {passive:false});

  window.addEventListener("keyup", (e)=>{
    const act = keyMap[e.code];
    if (!act) return;
    e.preventDefault();
    input[act] = false;
  }, {passive:false});

  function bindPad(){
    const pads = document.querySelectorAll(".pad");
    const setAct = (act, val)=>{
      if (act === "fire" && val && !input.fire) input.justFire = true;
      input[act] = val;
      input.justStartAudio = true;
    };

    pads.forEach(btn=>{
      const act = btn.getAttribute("data-act");
      const down = (ev)=>{ ev.preventDefault(); setAct(act, true); btn.classList.add("down"); };
      const up = (ev)=>{ ev.preventDefault(); setAct(act, false); btn.classList.remove("down"); };

      btn.addEventListener("pointerdown", down, {passive:false});
      btn.addEventListener("pointerup", up, {passive:false});
      btn.addEventListener("pointercancel", up, {passive:false});
      btn.addEventListener("pointerleave", up, {passive:false});
    });
  }

  let audioCtx = null;
  let master = null;
  let sfxGain = null;
  let musicGain = null;
  let muted = false;

  function ensureAudio(){
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    master = audioCtx.createGain();
    sfxGain = audioCtx.createGain();
    musicGain = audioCtx.createGain();
    sfxGain.gain.value = 0.9;
    musicGain.gain.value = 0.25;
    master.gain.value = muted ? 0 : 1;
    sfxGain.connect(master);
    musicGain.connect(master);
    master.connect(audioCtx.destination);
    startMusic();
  }

  function setMuted(m){
    muted = !!m;
    if (master) master.gain.value = muted ? 0 : 1;
    ui.soundDot.style.background = muted ? "rgba(255,59,92,.95)" : "rgba(42,255,158,.95)";
    ui.soundDot.style.boxShadow = muted ? "0 0 10px rgba(255,59,92,.35)" : "0 0 10px rgba(42,255,158,.35)";
    ui.soundLabel.textContent = muted ? "Sound: OFF" : "Sound: ON";
  }
  setMuted(false);

  function beep({freq=440, dur=0.08, type="sine", gain=0.25, slide=0, when=0}){
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + when;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide !== 0) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq+slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(sfxGain);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noiseBurst({dur=0.12, gain=0.2, when=0}){
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime + when;
    const bufferSize = Math.floor(audioCtx.sampleRate * dur);
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i=0;i<bufferSize;i++){
      const t = i / bufferSize;
      const env = Math.pow(1 - t, 2.2);
      data[i] = (Math.random()*2-1) * env;
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const g = audioCtx.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(sfxGain);
    src.start(t0);
    src.stop(t0 + dur + 0.01);
  }

  let music = { osc1:null, osc2:null, lfo:null, filter:null, gain:null, started:false };
  function startMusic(){
    if (!audioCtx || music.started) return;
    music.started = true;

    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 680;

    const g = audioCtx.createGain();
    g.gain.value = 0.0001;

    const o1 = audioCtx.createOscillator();
    const o2 = audioCtx.createOscillator();
    o1.type = "triangle";
    o2.type = "sine";
    o1.frequency.value = 70;
     o2.frequency.value = 140;

    const lfo = audioCtx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.18;

    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 160;

    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    o1.connect(filter);
    o2.connect(filter);
    filter.connect(g);
    g.connect(musicGain);

    const t0 = audioCtx.currentTime;
    g.gain.exponentialRampToValueAtTime(0.14, t0 + 0.8);

    o1.start();
    o2.start();
    lfo.start();

    music = { osc1:o1, osc2:o2, lfo, filter, gain:g, started:true };
  }

  function musicIntensity(x){
    if (!audioCtx || !music.started) return;
    const t = audioCtx.currentTime;
    const base = 520 + x * 520;
    music.filter.frequency.setTargetAtTime(base, t, 0.06);
    music.gain.gain.setTargetAtTime(0.08 + x * 0.18, t, 0.08);
    musicGain.gain.setTargetAtTime(0.18 + x * 0.22, t, 0.12);
  }

  const state = {
    running:false,
    paused:false,
    gameOver:false,
    time:0,
    score:0,
    wave:1,
    best: Number(localStorage.getItem("dd_best") || 0),
    lastFrame: performance.now(),
    fps: 0,
    fpsAcc: 0,
    fpsN: 0,

    roadX: 0,
    roadHalfW: 0,
    scroll: 0,
    camShake: 0,

    bullets: [],
    particles: [],
    enemies: [],
    pickups: [],

    difficulty: 1
  };

  ui.best.textContent = state.best;

  function makePlayer(){
    return {
      x: W/2,
      y: H*0.74,
      vx:0, vy:0,
      speed:0,
      maxSpeed: 820,
      accel: 1180,
      brake: 1420,
      turn: 7.5,
      drift: 0,
      driftHeat: 0,
      nitro: 100,
      nitroMax: 100,
      nitroUse: 28,
      nitroRegen: 11,
      hp: 100,
      hpMax: 100,
      armor: 60,
      armorMax: 60,
      fireCd: 0,
      fireRate: 0.12,
      comboHeat: 0,
      alive:true
    };
  }

  let player = makePlayer();

  function resetGame(){
    state.running = true;
    state.paused = false;
    state.gameOver = false;
    state.time = 0;
    state.score = 0;
    state.wave = 1;
    state.scroll = 0;
    state.camShake = 0;
    state.bullets.length = 0;
    state.particles.length = 0;
    state.enemies.length = 0;
    state.pickups.length = 0;
    state.difficulty = 1;
    player = makePlayer();
    ui.wave.textContent = "1";
    ui.score.textContent = "0";
    hideOverlay();
    ui.hint.style.display = "none";
    if (isCoarsePointer()) ui.mobileControls.style.display = "flex";
  }

  function togglePause(){
    if (!state.running || state.gameOver) return;
    state.paused = !state.paused;
    if (state.paused){
      showOverlay("Paused", "Press Resume", "Tip: Use Nitro to break through tough waves.");
    } else hideOverlay();
  }

  function showOverlay(title, sub, note){
    ui.overlay.style.display = "flex";
    ui.panelTitle.textContent = title;
    ui.panelSub.textContent = sub;
    ui.panelNote.textContent = note || "";
  }
  function hideOverlay(){ ui.overlay.style.display = "none"; }

  function setGameOver(){
    state.gameOver = true;
    state.running = false;
    state.paused = false;

    if (state.score > state.best){
      state.best = state.score;
      localStorage.setItem("dd_best", String(state.best));
      ui.best.textContent = state.best;
    }

    showOverlay("Wrecked", `Score: ${state.score}  •  Best: ${state.best}`, "Restart and try a cleaner drift line.");
    bigExplosion(player.x, player.y);
    beep({freq:140, dur:0.22, type:"sawtooth", gain:0.22, slide:-60});
    noiseBurst({dur:0.18, gain:0.22});
  }

  function spawnEnemy(kind="raider"){
    const lanes = 5;
    const laneW = (state.roadHalfW*2) / lanes;
    const lane = Math.floor(rand(0, lanes));
    const x = state.roadX - state.roadHalfW + laneW*(lane+0.5) + rand(-10, 10);
    const y = -80;

    const base = {
      kind,
      x, y,
      vx:0, vy:0,
      angle:0,
      speed: rand(420, 640) * state.difficulty,
      maxSpeed: rand(520, 820) * state.difficulty,
      hpMax: kind==="tank" ? 120 : 70,
      hp: kind==="tank" ? 120 : 70,
      armorMax: kind==="tank" ? 40 : 20,
      armor: kind==="tank" ? 40 : 20,
      w: kind==="tank" ? 30 : 24,
      h: kind==="tank" ? 56 : 48,
      fireCd: rand(0.2, 0.8),
      fireRate: kind==="sniper" ? 0.26 : 0.34,
      nitro: 60,
      brain: AIEngine.buildEnemyBrain({seed: Math.floor(rand(0,1e9))}),
      alive:true
    };
    state.enemies.push(base);
  }

  function spawnPickup(type){
    state.pickups.push({
      type,
      x: state.roadX + rand(-state.roadHalfW*0.7, state.roadHalfW*0.7),
      y: -40,
      vy: rand(320, 420),
      r: 14,
      t: 0
    });
  }

  function fireBullet(owner, x, y, vx, vy, dmg){
    state.bullets.push({
      owner, x, y, vx, vy,
      r: owner==="player" ? 4 : 4,
      dmg,
      t: 0
    });
    if (owner === "player"){
      beep({freq: 620, dur: 0.04, type:"square", gain:0.12, slide: 120});
    } else {
      beep({freq: 360, dur: 0.05, type:"sine", gain:0.10, slide: -60});
    }
  }

  function hitSpark(x,y, n=10){
    for (let i=0;i<n;i++){
      state.particles.push({
        x, y,
        vx: rand(-220, 220),
        vy: rand(-220, 220),
        life: rand(0.25, 0.55),
        t: 0,
        kind:"spark"
      });
    }
  }

  function bigExplosion(x,y){
    noiseBurst({dur:0.14, gain:0.22});
    beep({freq: 220, dur: 0.12, type:"sawtooth", gain:0.18, slide:-120});
    for (let i=0;i<48;i++){
      state.particles.push({
        x, y,
        vx: rand(-420, 420),
        vy: rand(-420, 420),
        life: rand(0.35, 0.95),
        t: 0,
        kind:"boom"
      });
    }
    state.camShake = Math.max(state.camShake, 10);
  }

  function applyDamage(target, dmg){
    let left = dmg;
    if (target.armor > 0){
      const aTake = Math.min(target.armor, left * 0.65);
      target.armor -= aTake;
      left -= aTake;
    }
    target.hp -= left;
    if (target.hp <= 0){
      target.hp = 0;
      target.alive = false;
    }
  }

  function updateUI(){
    ui.score.textContent = state.score;
    ui.wave.textContent = state.wave;

    const hpP = clamp(player.hp / player.hpMax, 0, 1);
    const arP = clamp(player.armor / player.armorMax, 0, 1);
    const niP = clamp(player.nitro / player.nitroMax, 0, 1);

    ui.hpFill.style.width = (hpP*100).toFixed(1)+"%";
    ui.armorFill.style.width = (arP*100).toFixed(1)+"%";
    ui.nitroFill.style.width = (niP*100).toFixed(1)+"%";

    ui.hpText.textContent = Math.round(player.hp);
    ui.armorText.textContent = Math.round(player.armor);
    ui.nitroText.textContent = Math.round(player.nitro);
  }

  function roadSetup(){
    state.roadX = W/2;
    state.roadHalfW = Math.min(280, W*0.38);
  }

  function teamAI(){
    AIEngine.teamCoordinator({
      enemies: state.enemies,
      player,
      roadX: state.roadX,
      roadHalfW: state.roadHalfW
    });
  }

  function step(dt){
    state.time += dt;
    state.scroll += (player.speed * dt) * 0.95;

    state.fpsAcc += 1/dt;
    state.fpsN += 1;
    if (state.fpsN >= 14){
      state.fps = state.fpsAcc / state.fpsN;
      ui.fps.textContent = Math.round(state.fps);
      state.fpsAcc = 0;
      state.fpsN = 0;
    }

    const targetDiff = 1 + (state.wave-1)*0.11 + Math.min(0.55, state.score/18000);
    state.difficulty = lerp(state.difficulty, targetDiff, 0.03);

    player.fireCd = Math.max(0, player.fireCd - dt);

    const steer = (input.left ? -1 : 0) + (input.right ? 1 : 0);
    const gas = input.gas ? 1 : 0;
    const brake = input.brake ? 1 : 0;

    const wantNitro = input.nitro && player.nitro > 1 && player.speed > 260;

    const maxSpeed = player.maxSpeed * (wantNitro ? 1.18 : 1.0);
    const accel = player.accel * (wantNitro ? 1.06 : 1.0);

    if (gas) player.speed += accel * dt;
    if (brake) player.speed -= player.brake * dt;

    player.speed -= player.speed * (0.18 * dt);
    player.speed = clamp(player.speed, 0, maxSpeed);

    if (wantNitro){
      player.nitro -= player.nitroUse * dt;
      player.nitro = clamp(player.nitro, 0, player.nitroMax);
      if (Math.random() < 0.12) state.particles.push({
        x: player.x + rand(-10, 10),
        y: player.y + 24,
        vx: rand(-60, 60),
        vy: rand(220, 380),
        life: rand(0.12, 0.25),
        t: 0,
        kind:"nitro"
      });
      musicIntensity(0.85);
    } else {
      player.nitro += player.nitroRegen * dt;
      player.nitro = clamp(player.nitro, 0, player.nitroMax);
      musicIntensity(clamp(player.speed / player.maxSpeed, 0, 1));
    }

    const speedN = clamp(player.speed / player.maxSpeed, 0, 1);
    const driftGain = Math.abs(steer) * speedN;
    player.drift = lerp(player.drift, driftGain, 0.12);

    const lateral = (player.turn * (0.55 + speedN*0.9)) * steer;
    player.vx = lerp(player.vx, lateral*120, 0.18);

    player.x += player.vx * dt;
    const roadL = state.roadX - state.roadHalfW + 26;
    const roadR = state.roadX + state.roadHalfW - 26;

    if (player.x < roadL){
      player.x = roadL;
      player.speed *= 0.92;
      state.camShake = Math.max(state.camShake, 2.6);
      hitSpark(player.x-16, player.y, 6);
      beep({freq:240, dur:0.05, type:"sine", gain:0.08, slide:-40});
    }
    if (player.x > roadR){
      player.x = roadR;
      player.speed *= 0.92;
      state.camShake = Math.max(state.camShake, 2.6);
      hitSpark(player.x+16, player.y, 6);
      beep({freq:240, dur:0.05, type:"sine", gain:0.08, slide:-40});
    }

    player.comboHeat = lerp(player.comboHeat, clamp(player.drift*1.25, 0, 1), 0.05);

    if ((input.fire || input.justFire) && player.fireCd <= 0){
      player.fireCd = player.fireRate;
      const spread = (0.6 - speedN*0.35) * (1 + player.drift*0.7);
      const vx = rand(-40, 40) * spread;
      fireBullet("player", player.x, player.y - 28, vx, -1120 - player.speed*0.55, 18);
      if (Math.random() < 0.25) state.camShake = Math.max(state.camShake, 1.2);
    }
    input.justFire = false;

    const spawnRate = 0.72 / state.difficulty;
    if (state.enemies.length < 6 + state.wave){
      if (Math.random() < dt * (1/spawnRate)){
        const r = Math.random();
        const kind = r < 0.12 ? "tank" : (r < 0.28 ? "sniper" : "raider");
        spawnEnemy(kind);
      }
    }

    if (Math.random() < dt * (0.06 + state.wave*0.004)){
      const t = Math.random();
      spawnPickup(t < 0.45 ? "nitro" : (t < 0.75 ? "armor" : "hp"));
    }

    teamAI();

    const incomingPlayerBullets = state.bullets.filter(b=>b.owner==="player");
    for (let i=0;i<state.enemies.length;i++){
      const e = state.enemies[i];
      if (!e.alive) continue;

      e.fireCd = Math.max(0, e.fireCd - dt);

      const ai = AIEngine.updateBrain(e.brain, dt, {
        player,
        enemy: { x:e.x, y:e.y, vx:e.vx, hp:e.hp, hpMax:e.hpMax },
        incomingBullets: incomingPlayerBullets,
        roadX: state.roadX,
        roadHalfW: state.roadHalfW
      });

      const desiredVX = ai.steer * 180;
      e.vx = lerp(e.vx, desiredVX, 0.08);

      let eSpeed = e.speed;
      if (ai.wantNitro && e.nitro > 0){
        eSpeed *= 1.12;
        e.nitro -= 24 * dt;
        if (Math.random() < 0.08) state.particles.push({
          x: e.x + rand(-8, 8),
          y: e.y + 24,
          vx: rand(-50, 50),
          vy: rand(170, 300),
          life: rand(0.12, 0.22),
          t: 0,
          kind:"nitro2"
        });
      } else {
        e.nitro = clamp(e.nitro + 10*dt, 0, 60);
      }

      e.y += (eSpeed * dt) * 0.65 + (player.speed * dt) * 0.32;
      e.x += e.vx * dt;

      const eRoadL = state.roadX - state.roadHalfW + 26;
      const eRoadR = state.roadX + state.roadHalfW - 26;
      e.x = clamp(e.x, eRoadL, eRoadR);

      if (ai.wantShoot && e.fireCd <= 0){
        e.fireCd = e.fireRate;
        const dx = player.x - e.x;
        const aim = clamp(dx / 220, -1, 1);
        fireBullet("enemy", e.x, e.y + 20, aim*240, 980, 14);
      }
    }

    for (let i=state.bullets.length-1;i>=0;i--){
      const b = state.bullets[i];
      b.t += dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      if (b.y < -120 || b.y > H + 140 || b.x < -120 || b.x > W + 120){
        state.bullets.splice(i,1);
        continue;
      }

      if (b.owner === "player"){
        for (let j=0;j<state.enemies.length;j++){
          const e = state.enemies[j];
          if (!e.alive) continue;
          const rr = e.w;
          if (dist2(b.x,b.y,e.x,e.y, ) < (rr*rr)){
            applyDamage(e, b.dmg);
            hitSpark(b.x,b.y, 10);
            state.bullets.splice(i,1);

            state.score += 18;
            if (!e.alive){
              bigExplosion(e.x, e.y);
              state.score += 250 + Math.floor(60*state.difficulty);
              if (Math.random() < 0.18) spawnPickup(Math.random()<0.5?"nitro":"armor");
            }
            break;
          }
        }
      } else {
        const rr = 22;
        if (dist2(b.x,b.y,player.x,player.y) < rr*rr){
          applyDamage(player, b.dmg);
          hitSpark(b.x,b.y, 10);
          state.bullets.splice(i,1);
          state.camShake = Math.max(state.camShake, 4.5);
          noiseBurst({dur:0.08, gain:0.12});
          beep({freq:200, dur:0.06, type:"sine", gain:0.10, slide:-40});
          if (player.hp <= 0) setGameOver();
        }
      }
    }

    for (let i=state.enemies.length-1;i>=0;i--){
      const e = state.enemies[i];
      if (e.y > H + 140 || !e.alive){
        if (!e.alive) state.enemies.splice(i,1);
        else {
          state.enemies.splice(i,1);
          state.score = Math.max(0, state.score - 40);
        }
      }
    }

    for (let i=state.pickups.length-1;i>=0;i--){
      const p = state.pickups[i];
      p.t += dt;
      p.y += (p.vy * dt) + (player.speed * dt) * 0.22;

      const rr = p.r + 18;
      if (dist2(p.x,p.y,player.x,player.y) < rr*rr){
        if (p.type === "hp"){
          player.hp = clamp(player.hp + 22, 0, player.hpMax);
          beep({freq:520, dur:0.07, type:"sine", gain:0.13, slide:90});
        } else if (p.type === "armor"){
          player.armor = clamp(player.armor + 24, 0, player.armorMax);
          beep({freq:420, dur:0.08, type:"triangle", gain:0.12, slide:70});
        } else {
          player.nitro = clamp(player.nitro + 32, 0, player.nitroMax);
          beep({freq:680, dur:0.08, type:"square", gain:0.12, slide:160});
        }
        hitSpark(p.x,p.y, 12);
        state.pickups.splice(i,1);
        state.score += 40;
        continue;
      }

      if (p.y > H + 80){
        state.pickups.splice(i,1);
      }
    }

    for (let i=state.particles.length-1;i>=0;i--){
      const pa = state.particles[i];
      pa.t += dt;
      pa.x += pa.vx * dt;
      pa.y += pa.vy * dt;
      pa.vx *= (1 - 0.6*dt);
      pa.vy *= (1 - 0.6*dt);
      if (pa.t >= pa.life) state.particles.splice(i,1);
    }

    const waveTarget = 1200 + state.wave * 420;
    if (state.score >= waveTarget){
      state.wave += 1;
      ui.wave.textContent = state.wave;
      beep({freq:780, dur:0.12, type:"square", gain:0.12, slide:180});
      beep({freq:980, dur:0.08, type:"sine", gain:0.10, slide:80, when:0.04});
      state.score += 120;
      if (state.wave % 3 === 0) spawnEnemy("tank");
    }

    updateUI();
  }

  function draw(){
    ctx.clearRect(0,0,W,H);

    const shake = state.camShake;
    if (shake > 0){
      state.camShake = Math.max(0, shake - 22 * (1/60));
    }
    const sx = (shake>0? rand(-shake, shake) : 0);
    const sy = (shake>0? rand(-shake, shake) : 0);

    ctx.save();
    ctx.translate(sx, sy);

    drawBackground();
    drawRoad();
    drawPickups();
    drawBullets();
    drawCars();
    drawParticles();
    drawVignette();

    ctx.restore();
  }

  function drawBackground(){
    const g = ctx.createLinearGradient(0,0,0,H);
    g.addColorStop(0, "#060712");
    g.addColorStop(1, "#0b1024");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);

    ctx.globalAlpha = 0.12;
    for (let i=0;i<16;i++){
      const x = (i/15)*W;
      ctx.fillStyle = i%2===0 ? "rgba(0,229,255,0.25)" : "rgba(124,92,255,0.22)";
      ctx.fillRect(x, 0, 1.2, H);
    }
    ctx.globalAlpha = 1;
  }

  function drawRoad(){
    const rx = state.roadX;
    const half = state.roadHalfW;

    ctx.save();

    const bg = ctx.createLinearGradient(rx-half,0,rx+half,0);
    bg.addColorStop(0, "rgba(10,13,26,.85)");
    bg.addColorStop(0.5, "rgba(18,22,42,.85)");
    bg.addColorStop(1, "rgba(10,13,26,.85)");
    ctx.fillStyle = bg;
    roundRect(rx-half, 0, half*2, H, 18);
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,229,255,0.28)";
    roundRect(rx-half, 0, half*2, H, 18);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,43,214,0.20)";
    ctx.lineWidth = 1;
    roundRect(rx-half+6, 6, half*2-12, H-12, 16);
    ctx.stroke();

    const lanes = 5;
    const laneW = (half*2)/lanes;
    ctx.lineWidth = 2;

    for (let i=1;i<lanes;i++){
      const x = rx-half + laneW*i;
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.beginPath();
      ctx.moveTo(x,0); ctx.lineTo(x,H);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const dashLen = 34;
    const gap = 20;
    const speed = player.speed * 0.9;
    const offset = (state.scroll * 0.85) % (dashLen + gap);

    ctx.strokeStyle = "rgba(0,229,255,0.70)";
    ctx.lineWidth = 3;
    const midX = rx;
    ctx.beginPath();
    for (let y = -dashLen; y < H + dashLen; y += dashLen + gap){
      const yy = y + offset;
      ctx.moveTo(midX, yy);
      ctx.lineTo(midX, yy + dashLen);
    }
    ctx.stroke();

    ctx.globalAlpha = 0.12 + clamp(speed/player.maxSpeed,0,1)*0.14;
    ctx.fillStyle = "rgba(124,92,255,0.35)";
    for (let i=0;i<18;i++){
      const xx = rx + rand(-half*0.9, half*0.9);
      const yy = ((i/18)*H + offset*2) % H;
      ctx.fillRect(xx, yy, 2, 28);
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  function drawCars(){
    drawCar(player, true);

    for (let i=0;i<state.enemies.length;i++){
      const e = state.enemies[i];
      if (!e.alive) continue;
      drawCar(e, false);
      drawEnemyBars(e);
    }
  }

  function drawCar(c, isPlayer){
    const w = isPlayer ? 26 : (c.w || 24);
    const h = isPlayer ? 54 : (c.h || 48);

    const glow = isPlayer ? "rgba(0,229,255,0.55)" : "rgba(255,43,214,0.45)";
    const glow2 = isPlayer ? "rgba(124,92,255,0.45)" : "rgba(255,204,0,0.20)";

    ctx.save();
    ctx.translate(c.x, c.y);

    const tilt = clamp((c.vx || 0) / 220, -1, 1);
    const driftTilt = isPlayer ? (player.drift*0.55) * (tilt) : tilt*0.35;
    ctx.rotate(driftTilt * 0.18);

    ctx.shadowColor = glow;
    ctx.shadowBlur = 18;

    const bodyGrad = ctx.createLinearGradient(-w, -h, w, h);
    bodyGrad.addColorStop(0, isPlayer ? "rgba(0,229,255,0.18)" : "rgba(255,43,214,0.16)");
    bodyGrad.addColorStop(0.5, "rgba(255,255,255,0.07)");
    bodyGrad.addColorStop(1, isPlayer ? "rgba(124,92,255,0.18)" : "rgba(255,59,92,0.12)");

    ctx.fillStyle = bodyGrad;
    roundRect(-w/2, -h/2, w, h, 10);
    ctx.fill();

    ctx.shadowBlur = 0;

    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1.5;
    roundRect(-w/2, -h/2, w, h, 10);
    ctx.stroke();

    ctx.fillStyle = isPlayer ? "rgba(0,229,255,0.75)" : "rgba(255,43,214,0.72)";
    roundRect(-w/2 + 6, -h/2 + 10, w-12, 10, 6);
    ctx.fill();

    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(-w/2 + 6, -h/2 + 22, w-12, 16, 7);
    ctx.fill();

    ctx.fillStyle = glow2;
    roundRect(-w/2 + 4, h/2 - 10, w-8, 6, 6);
    ctx.fill();

    if (isPlayer && input.nitro && player.nitro > 0 && player.speed > 250){
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = "rgba(255,43,214,0.65)";
      roundRect(-w/2 + 7, h/2 - 4, 6, 16, 5);
      roundRect(w/2 - 13, h/2 - 4, 6, 16, 5);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  function drawEnemyBars(e){
    const w = 46, h = 7;
    const x = e.x - w/2;
    const y = e.y - (e.h||48)/2 - 14;

    const hpP = clamp(e.hp / e.hpMax, 0, 1);
    const arP = clamp(e.armor / e.armorMax, 0, 1);

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    roundRect(x, y, w, h, 999);
    ctx.fill();

    ctx.fillStyle = "rgba(42,255,158,0.75)";
    roundRect(x, y, w*hpP, h, 999);
    ctx.fill();

    ctx.globalAlpha = 0.75;
    ctx.fillStyle = "rgba(124,92,255,0.70)";
    roundRect(x, y+h+4, w*arP, 5, 999);
    ctx.fill();
    ctx.restore();
  }

  function drawBullets(){
    for (let i=0;i<state.bullets.length;i++){
      const b = state.bullets[i];
      ctx.save();
      ctx.translate(b.x, b.y);

      ctx.fillStyle = b.owner==="player" ? "rgba(0,229,255,0.95)" : "rgba(255,59,92,0.9)";
      ctx.shadowColor = b.owner==="player" ? "rgba(0,229,255,0.6)" : "rgba(255,59,92,0.5)";
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(0,0,b.r,0,Math.PI*2);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = b.owner==="player" ? "rgba(124,92,255,0.35)" : "rgba(255,204,0,0.25)";
      ctx.fillRect(-1, -14, 2, 12);
      ctx.restore();
    }
  }

  function drawPickups(){
    for (let i=0;i<state.pickups.length;i++){
      const p = state.pickups[i];
      const pulse = 0.5 + 0.5*Math.sin(p.t*6);

      let col = "rgba(0,229,255,0.85)";
      let glow = "rgba(0,229,255,0.45)";
      let label = "N";
      if (p.type==="hp"){ col="rgba(42,255,158,0.85)"; glow="rgba(42,255,158,0.4)"; label="HP"; }
      if (p.type==="armor"){ col="rgba(124,92,255,0.85)"; glow="rgba(124,92,255,0.4)"; label="AR"; }

      ctx.save();
      ctx.translate(p.x, p.y);

      ctx.shadowColor = glow;
      ctx.shadowBlur = 18;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = col;
      roundRect(-p.r, -p.r, p.r*2, p.r*2, 10);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.22 + pulse*0.18;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      roundRect(-p.r-6, -p.r-6, p.r*2+12, p.r*2+12, 14);
      ctx.stroke();

      ctx.globalAlpha = 0.95;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.font = "900 10px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, 0, 0);

      ctx.restore();
    }
  }

  function drawParticles(){
    for (let i=0;i<state.particles.length;i++){
      const p = state.particles[i];
      const t = p.t / p.life;
      const a = clamp(1 - t, 0, 1);

      let col = "rgba(0,229,255,0.7)";
      if (p.kind==="boom") col = "rgba(255,43,214,0.7)";
      if (p.kind==="nitro") col = "rgba(255,43,214,0.65)";
      if (p.kind==="nitro2") col = "rgba(255,204,0,0.55)";

      ctx.save();
      ctx.globalAlpha = 0.9*a;
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 12;
      const r = p.kind==="boom" ? (3 + (1-t)*4) : (2 + (1-t)*2);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawVignette(){
    const g = ctx.createRadialGradient(W/2,H/2, Math.min(W,H)*0.25, W/2,H/2, Math.max(W,H)*0.7);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.58)");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);
  }

  function roundRect(x,y,w,h,r){
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y, x+w, y+h, rr);
    ctx.arcTo(x+w, y+h, x, y+h, rr);
    ctx.arcTo(x, y+h, x, y, rr);
    ctx.arcTo(x, y, x+w, y, rr);
    ctx.closePath();
  }

  function init(){
    resize();
    roadSetup();
    bindPad();

    ui.startBtn.addEventListener("click", ()=>{
      input.justStartAudio = true;
      ensureAudio();
      resetGame();
    });

    ui.howBtn.addEventListener("click", ()=>{
      ui.hint.style.display = "none";
      if (isCoarsePointer()) ui.mobileControls.style.display = "flex";
    });

    ui.resumeBtn.addEventListener("click", ()=>{
      if (state.gameOver){
        resetGame();
      } else {
        state.paused = false;
        hideOverlay();
      }
      input.justStartAudio = true;
      ensureAudio();
    });

    ui.restartBtn.addEventListener("click", ()=>{
      input.justStartAudio = true;
      ensureAudio();
      resetGame();
    });

    canvas.addEventListener("pointerdown", ()=>{
      input.justStartAudio = true;
      ensureAudio();
      if (!state.running && !state.gameOver){
        resetGame();
      }
    }, {passive:true});

    ui.hint.style.display = "flex";
    ui.mobileControls.style.display = isCoarsePointer() ? "flex" : "none";

    requestAnimationFrame(loop);
  }

  function loop(now){
    const dt = clamp((now - state.lastFrame) / 1000, 0, 1/18);
    state.lastFrame = now;

    if (input.justStartAudio){
      ensureAudio();
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
      input.justStartAudio = false;
    }

    if (state.running && !state.paused && !state.gameOver){
      step(dt);
    }
    draw();

    requestAnimationFrame(loop);
  }

  updateUI();
  init();
})();
