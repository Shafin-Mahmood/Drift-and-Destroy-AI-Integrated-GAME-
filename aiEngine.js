(function(){
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function rand(seed){
    let t = seed + 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function sign(v){ return v < 0 ? -1 : 1; }

  function buildEnemyBrain(opts){
    const brain = {
      id: opts?.id || Math.floor(Math.random() * 1e9),
      mood: 0.35,
      courage: 0.55,
      teamwork: 0.55,
      dodge: 0.55,
      aim: 0.50,
      laneBias: 0,
      lastSeenX: 0,
      lastSeenVX: 0,
      aggression: 0.45,
      cooldown: 0,
      seed: (opts?.seed ?? Math.floor(Math.random() * 1e9)) >>> 0,
      t: 0
    };
    return brain;
  }

  function updateBrain(brain, dt, world){
    brain.t += dt;

    const p = world.player;
    const e = world.enemy;

    const dx = p.x - e.x;
    const dist = Math.abs(dx) + (p.y - e.y) * 0.15;

    const healthFactor = clamp((e.hp / e.hpMax), 0, 1);
    const playerThreat = clamp((p.speed / (p.maxSpeed || 1)) * 0.65 + (p.comboHeat || 0) * 0.35, 0, 1);

    brain.aggression = clamp(0.25 + (1 - healthFactor) * 0.35 + playerThreat * 0.35, 0.15, 0.95);
    brain.dodge = clamp(0.35 + playerThreat * 0.45, 0.25, 0.90);
    brain.aim = clamp(0.35 + (1 - playerThreat) * 0.35 + (1 - Math.abs(dx) / (world.roadHalfW || 240)) * 0.30, 0.25, 0.92);

    const chaos = (rand(brain.seed + Math.floor(brain.t * 1000)) - 0.5) * 2;

    const targetX = p.x + clamp(p.vx * 220, -180, 180) * (0.45 + brain.aim * 0.55);
    let steerTo = targetX + chaos * 16 + brain.laneBias * 40;

    const incoming = world.incomingBullets || [];
    let dodgePush = 0;
    for (let i = 0; i < incoming.length; i++){
      const b = incoming[i];
      if (b.owner !== "player") continue;
      const dy = (e.y - b.y);
      if (dy > 0 && dy < 260){
        const bx = b.x;
        const ddx = e.x - bx;
        if (Math.abs(ddx) < 28){
          dodgePush += sign(ddx || (chaos || 1)) * (0.8 + brain.dodge) * 1.6;
        }
      }
    }

    steerTo += dodgePush * 90;

    const roadL = world.roadX - world.roadHalfW + 22;
    const roadR = world.roadX + world.roadHalfW - 22;
    steerTo = clamp(steerTo, roadL, roadR);

    const steer = clamp((steerTo - e.x) / 160, -1, 1);

    brain.cooldown = Math.max(0, brain.cooldown - dt);

    const inFront = (p.y < e.y);
    const aligned = Math.abs(dx) < 24;
    const shootChance = brain.aggression * (aligned ? 0.9 : 0.35) * (inFront ? 0.25 : 1.0);

    let wantShoot = false;
    if (brain.cooldown <= 0){
      const r = rand(brain.seed + Math.floor(brain.t * 60));
      if (r < shootChance * 0.55 && dist < 520) wantShoot = true;
      if (aligned && dist < 360 && r < shootChance * 0.85) wantShoot = true;
      if (wantShoot) brain.cooldown = 0.18 + (1 - brain.aim) * 0.12;
    }

    let wantNitro = false;
    if (brain.aggression > 0.65 && dist > 240){
      const r2 = rand(brain.seed + Math.floor(brain.t * 40) + 77);
      if (r2 < 0.02) wantNitro = true;
    }

    return { steer, wantShoot, wantNitro };
  }

  function teamCoordinator(world){
    const enemies = world.enemies || [];
    if (enemies.length < 2) return;

    const p = world.player;
    const roadL = world.roadX - world.roadHalfW + 40;
    const roadR = world.roadX + world.roadHalfW - 40;

    const sorted = enemies.slice().sort((a,b)=> a.y - b.y);
    const lead = sorted[0];
    const wing = sorted[1];

    if (!lead || !wing) return;

    lead.brain.laneBias = clamp(((p.x - world.roadX) / (world.roadHalfW || 1)) * 0.35, -0.6, 0.6);
    wing.brain.laneBias = -lead.brain.laneBias;

    if (Math.abs(wing.x - lead.x) < 80){
      if (wing.x < lead.x) wing.x = clamp(wing.x - 1.5, roadL, roadR);
      else wing.x = clamp(wing.x + 1.5, roadL, roadR);
    }
  }

  window.AIEngine = {
    buildEnemyBrain,
    updateBrain,
    teamCoordinator
  };
})();
