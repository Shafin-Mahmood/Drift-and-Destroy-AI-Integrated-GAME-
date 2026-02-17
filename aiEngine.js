class PredatorAI {
  constructor(opts = {}) {
    this.grid = opts.grid || 16;
    this.heatSize = opts.heatSize || 64;
    this.heat = new Float32Array(this.heatSize * this.heatSize);
    this.state = "SEARCH";
    this.stateT = 0;

    this.lastSeen = null;
    this.lastSeenT = 0;

    this.aggression = 0.55;
    this.focus = 0.55;
    this.lostTimeout = 2.2;

    this.moveHist = [];
    this.maxHist = 160;

    this.shotHist = [];
    this.maxShotHist = 90;

    this.target = null;
    this.targetT = 0;

    this._rnd = Math.random;
  }

  reset() {
    this.heat.fill(0);
    this.state = "SEARCH";
    this.stateT = 0;
    this.lastSeen = null;
    this.lastSeenT = 0;
    this.aggression = 0.55;
    this.focus = 0.55;
    this.moveHist = [];
    this.shotHist = [];
    this.target = null;
    this.targetT = 0;
  }

  getUIState() {
    return this.state;
  }

  observePlayer(px, py, worldW, worldH, dt, playerWasVisible, playerShot, shotDirX, shotDirY) {
    this._stampHeat(px, py, worldW, worldH, dt);

    this.moveHist.push({ x: px, y: py, t: performance.now() * 0.001 });
    if (this.moveHist.length > this.maxHist) this.moveHist.shift();

    if (playerShot) {
      const now = performance.now() * 0.001;
      this.shotHist.push({ t: now, dx: shotDirX, dy: shotDirY, x: px, y: py });
      if (this.shotHist.length > this.maxShotHist) this.shotHist.shift();
    }

    if (playerWasVisible) {
      this.lastSeen = { x: px, y: py };
      this.lastSeenT = 0;
    } else {
      this.lastSeenT += dt;
    }

    this._adapt(worldW, worldH, dt);
  }

  decide(predX, predY, worldW, worldH, dt) {
    this.stateT += dt;

    if (this.lastSeen && this.lastSeenT < this.lostTimeout) {
      this._setState("CHASE");
    } else if (this.state === "CHASE" && (!this.lastSeen || this.lastSeenT >= this.lostTimeout)) {
      this._setState("HUNT");
    }

    if (this.state === "CHASE") {
      return this._chase(predX, predY, dt);
    }
    if (this.state === "HUNT") {
      return this._hunt(predX, predY, worldW, worldH, dt);
    }
    return this._search(predX, predY, worldW, worldH, dt);
  }

  _setState(s) {
    if (this.state !== s) {
      this.state = s;
      this.stateT = 0;
      this.target = null;
      this.targetT = 0;
    }
  }

  _adapt(worldW, worldH, dt) {
    for (let i = 0; i < this.heat.length; i++) this.heat[i] *= (1 - Math.min(0.45, dt * 0.08));

    const acc = this._playerAccuracyEstimate();
    const moveVar = this._movementVarianceEstimate();
    const shotRate = this._shotRateEstimate();

    const baseAgg = 0.45 + Math.min(0.35, shotRate * 0.18) + Math.min(0.25, acc * 0.25);
    this.aggression = this._lerp(this.aggression, this._clamp(baseAgg, 0.35, 0.95), Math.min(1, dt * 0.8));

    const baseFocus = 0.40 + Math.min(0.40, (1 - moveVar) * 0.45) + Math.min(0.20, acc * 0.25);
    this.focus = this._lerp(this.focus, this._clamp(baseFocus, 0.35, 0.95), Math.min(1, dt * 0.7));

    this.lostTimeout = this._clamp(2.8 - this.focus * 1.2, 1.3, 2.8);
  }

  _playerAccuracyEstimate() {
    if (this.shotHist.length < 8) return 0.4;
    let straight = 0;
    for (let i = 1; i < this.shotHist.length; i++) {
      const a = this.shotHist[i - 1];
      const b = this.shotHist[i];
      const dot = a.dx * b.dx + a.dy * b.dy;
      if (dot > 0.85) straight++;
    }
    const v = straight / Math.max(1, this.shotHist.length - 1);
    return this._clamp(v, 0, 1);
  }

  _movementVarianceEstimate() {
    const n = this.moveHist.length;
    if (n < 30) return 0.6;
    let cx = 0, cy = 0;
    for (let i = 0; i < n; i++) { cx += this.moveHist[i].x; cy += this.moveHist[i].y; }
    cx /= n; cy /= n;
    let v = 0;
    for (let i = 0; i < n; i++) {
      const dx = this.moveHist[i].x - cx;
      const dy = this.moveHist[i].y - cy;
      v += dx * dx + dy * dy;
    }
    v /= n;
    return this._clamp(v / (900 * 900), 0, 1);
  }

  _shotRateEstimate() {
    const now = performance.now() * 0.001;
    let c = 0;
    for (let i = this.shotHist.length - 1; i >= 0; i--) {
      if (now - this.shotHist[i].t <= 6) c++;
      else break;
    }
    return this._clamp(c / 6, 0, 6);
  }

  _chase(x, y, dt) {
    const tx = this.lastSeen ? this.lastSeen.x : x;
    const ty = this.lastSeen ? this.lastSeen.y : y;

    const dx = tx - x;
    const dy = ty - y;
    const d = Math.hypot(dx, dy) || 1;

    const speed = this._lerp(220, 360, this.aggression);

    return {
      ax: (dx / d) * speed,
      ay: (dy / d) * speed,
      desireShoot: this.aggression > 0.62 && d < 540,
      desireDash: this.aggression > 0.78 && d < 320
    };
  }

  _hunt(x, y, worldW, worldH, dt) {
    this.targetT += dt;
    if (!this.target || this.targetT > this._lerp(1.3, 0.75, this.focus)) {
      this.target = this._pickHeatTarget(worldW, worldH, true);
      this.targetT = 0;
    }

    const tx = this.target ? this.target.x : worldW * 0.5;
    const ty = this.target ? this.target.y : worldH * 0.5;

    const dx = tx - x;
    const dy = ty - y;
    const d = Math.hypot(dx, dy) || 1;

    const speed = this._lerp(190, 310, this.focus);

    return {
      ax: (dx / d) * speed,
      ay: (dy / d) * speed,
      desireShoot: d < 520 && this.focus > 0.55,
      desireDash: d < 280 && this.focus > 0.70
    };
  }

  _search(x, y, worldW, worldH, dt) {
    this.targetT += dt;
    if (!this.target || this.targetT > this._lerp(2.1, 1.2, this.focus)) {
      this.target = this._pickHeatTarget(worldW, worldH, false);
      this.targetT = 0;
    }

    const tx = this.target ? this.target.x : worldW * 0.5;
    const ty = this.target ? this.target.y : worldH * 0.5;

    const dx = tx - x;
    const dy = ty - y;
    const d = Math.hypot(dx, dy) || 1;

    const speed = this._lerp(150, 240, this.focus);

    return {
      ax: (dx / d) * speed,
      ay: (dy / d) * speed,
      desireShoot: false,
      desireDash: false
    };
  }

  _pickHeatTarget(worldW, worldH, preferHot) {
    let best = -1e9;
    let bestIx = 0;

    const tries = 36;
    for (let i = 0; i < tries; i++) {
      const ix = (this._rnd() * this.heatSize) | 0;
      const iy = (this._rnd() * this.heatSize) | 0;
      const idx = iy * this.heatSize + ix;
      const v = this.heat[idx];

      const edgePenalty = this._edgePenalty(ix, iy);
      const score = (preferHot ? v : (0.6 * v + 0.4 * this._rnd())) - edgePenalty;

      if (score > best) {
        best = score;
        bestIx = idx;
      }
    }

    const ix = bestIx % this.heatSize;
    const iy = (bestIx / this.heatSize) | 0;

    const x = (ix + 0.5) / this.heatSize * worldW;
    const y = (iy + 0.5) / this.heatSize * worldH;

    return { x, y };
  }

  _edgePenalty(ix, iy) {
    const m = this.heatSize - 1;
    const nx = Math.min(ix, m - ix) / (m * 0.5);
    const ny = Math.min(iy, m - iy) / (m * 0.5);
    const t = Math.min(nx, ny);
    return (1 - t) * 0.22;
  }

  _stampHeat(x, y, worldW, worldH, dt) {
    const ix = this._clamp(((x / worldW) * this.heatSize) | 0, 0, this.heatSize - 1);
    const iy = this._clamp(((y / worldH) * this.heatSize) | 0, 0, this.heatSize - 1);

    const r = 1;
    const add = dt * 0.9;
    for (let yy = iy - r; yy <= iy + r; yy++) {
      for (let xx = ix - r; xx <= ix + r; xx++) {
        if (xx < 0 || yy < 0 || xx >= this.heatSize || yy >= this.heatSize) continue;
        const d = Math.hypot(xx - ix, yy - iy);
        const w = Math.max(0, 1 - d * 0.85);
        this.heat[yy * this.heatSize + xx] += add * w;
      }
    }
  }

  _lerp(a, b, t) { return a + (b - a) * t; }
  _clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
}

window.PredatorAI = PredatorAI;
