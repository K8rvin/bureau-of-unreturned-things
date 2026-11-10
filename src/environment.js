import { ARENA } from "./content.js";

const ACTIVE_ROOMS = new Set(["combat", "challenge", "vault", "boss", "rift"]);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const circleRect = (x, y, radius, rect) => {
  const nx = clamp(x, rect.x, rect.x + rect.w);
  const ny = clamp(y, rect.y, rect.y + rect.h);
  return (x - nx) ** 2 + (y - ny) ** 2 < radius ** 2;
};

export class RoomEnvironment {
  constructor(game, room) {
    this.game = game;
    this.room = room;
    this.floorIndex = game.floor?.index ?? game.floorIndex;
    this.enabled = ACTIVE_ROOMS.has(room.type);
    this.randomState = (room.encounterSeed ^ 0xa53c9e17) >>> 0;
    this.belts = [];
    this.drops = [];
    this.leaks = [];
    this.beams = [];
    this.boostTimer = 0;
    this.nextDrop = 1.6;
    this.nextLeak = 1.4;
    this.nextBeam = room.type === "rift" ? 2.4 : 1.8;
    this.moving = room.event === "movingShelves" ? game.obstacles.slice(0, 2).map((obstacle, index) => ({ obstacle, baseX: obstacle.x, baseY: obstacle.y, phase: index * Math.PI })) : [];
    if (this.floorIndex === 2 && this.enabled) {
      const flip = this.random() < 0.5 ? -1 : 1;
      this.belts = [88, 184].map((y, index) => ({ x: 72, y, w: 336, h: 26, direction: flip * (index % 2 === 0 ? 1 : -1) }));
    }
  }

  random() {
    this.randomState = (Math.imul(this.randomState, 1664525) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }

  clear() {
    this.drops = [];
    this.leaks = [];
    this.beams = [];
    this.moving = [];
    this.boostTimer = 0;
  }

  boost(duration = 2.8) {
    this.boostTimer = Math.max(this.boostTimer, duration);
  }

  queueDrop(x, y, { delay = 0.9, radius = 20, kind = "fall", force = false, source = "Падение невозвращённой вещи" } = {}) {
    if (!this.enabled || (!force && this.floorIndex < 2)) return null;
    if (this.drops.length >= 12) this.drops.shift();
    const drop = {
      x: clamp(x, ARENA.left + radius, ARENA.right - radius),
      y: clamp(y, ARENA.top + radius, ARENA.bottom - radius),
      r: radius,
      time: delay,
      duration: delay,
      impact: 0,
      hit: false,
      kind,
      source,
    };
    this.drops.push(drop);
    return drop;
  }

  update(dt) {
    if (!this.enabled || this.room.cleared || this.game.waveIntro > 0 || !["wave", "boss"].includes(this.game.state)) return;
    this.boostTimer = Math.max(0, this.boostTimer - dt);
    if (this.moving.length) this.updateMovingShelves(dt);
    if (this.floorIndex === 2) this.updateBelts(dt);
    if (this.floorIndex === 3 || this.drops.length) this.updateDrops(dt);
    if (this.floorIndex === 4) this.updateLeaks(dt);
    if (this.floorIndex === 5 || this.room.type === "rift") this.updateBeams(dt);
  }

  updateMovingShelves(dt) {
    for (const entry of this.moving) {
      const obstacle = entry.obstacle;
      obstacle.x = entry.baseX + Math.sin(this.game.time * 0.85 + entry.phase) * 16;
      obstacle.y = entry.baseY + Math.cos(this.game.time * 0.65 + entry.phase) * 4;
      for (const body of [this.game.player, ...this.game.enemies]) {
        if (body.dead || body.flying || body.spawnTime > 0) continue;
        if (!circleRect(body.x, body.y, body.r, obstacle)) continue;
        const sides = [
          { x: obstacle.x - body.r - body.x, y: 0, distance: Math.abs(body.x - obstacle.x + body.r) },
          { x: obstacle.x + obstacle.w + body.r - body.x, y: 0, distance: Math.abs(obstacle.x + obstacle.w + body.r - body.x) },
          { x: 0, y: obstacle.y - body.r - body.y, distance: Math.abs(body.y - obstacle.y + body.r) },
          { x: 0, y: obstacle.y + obstacle.h + body.r - body.y, distance: Math.abs(obstacle.y + obstacle.h + body.r - body.y) },
        ].sort((a, b) => a.distance - b.distance);
        for (const side of sides) {
          const previous = { x: body.x, y: body.y };
          this.game.moveBody(body, side.x, side.y);
          if (!circleRect(body.x, body.y, body.r, obstacle)) break;
          Object.assign(body, previous);
        }
        if (circleRect(body.x, body.y, body.r, obstacle)) {
          const position = this.game.safeSpawnPosition(body.x, body.y, body.r, true);
          if (position) Object.assign(body, position);
        }
      }
    }
  }

  updateBelts(dt) {
    const speed = 18 * (this.boostTimer > 0 ? 2.2 : 1) * dt;
    for (const belt of this.belts) {
      for (const body of [this.game.player, ...this.game.enemies]) {
        if (body.dead || body.flying || body.spawnTime > 0 || body.freezeTimer > 0) continue;
        if (body.x < belt.x || body.x > belt.x + belt.w || body.y < belt.y || body.y > belt.y + belt.h) continue;
        this.game.moveBody(body, belt.direction * speed, 0);
      }
    }
  }

  updateDrops(dt) {
    if (this.floorIndex === 3) {
      this.nextDrop -= dt;
      if (this.nextDrop <= 0) {
        const angle = this.random() * Math.PI * 2;
        const distance = 25 + this.random() * 45;
        this.queueDrop(this.game.player.x + Math.cos(angle) * distance, this.game.player.y + Math.sin(angle) * distance * 0.6);
        this.nextDrop = this.room.type === "boss" ? 3.6 : 2.8;
      }
    }
    for (const drop of this.drops) {
      if (!drop.hit) {
        drop.time -= dt;
        if (drop.time <= 0) {
          drop.hit = true;
          drop.impact = 0.28;
          if (Math.hypot(this.game.player.x - drop.x, this.game.player.y - drop.y) <= drop.r + this.game.player.r) {
            this.game.hurtPlayer(1, drop.source);
          }
          if (drop.kind !== "curse") {
            for (const enemy of [...this.game.enemies]) {
              if (Math.hypot(enemy.x - drop.x, enemy.y - drop.y) <= drop.r + enemy.r) this.game.damageEnemy(enemy, 4);
            }
          }
          this.game.emit("slam", { x: drop.x, y: drop.y, environment: true });
        }
      } else {
        drop.impact -= dt;
      }
    }
    this.drops = this.drops.filter((drop) => !drop.hit || drop.impact > 0);
  }

  queueLeak(x, y, { delay = 1, duration = 3.2, radius = 23 } = {}) {
    if (!this.enabled || this.floorIndex !== 4) return null;
    if (this.leaks.length >= 8) this.leaks.shift();
    const leak = {
      x: clamp(x, ARENA.left + radius, ARENA.right - radius),
      y: clamp(y, ARENA.top + radius, ARENA.bottom - radius),
      r: radius,
      time: delay,
      duration: delay,
      life: duration,
      tick: 0,
    };
    this.leaks.push(leak);
    return leak;
  }

  updateLeaks(dt) {
    this.nextLeak -= dt;
    if (this.nextLeak <= 0) {
      this.queueLeak(ARENA.left + 60 + this.random() * (ARENA.right - ARENA.left - 120), ARENA.top + 35 + this.random() * (ARENA.bottom - ARENA.top - 70));
      this.nextLeak = 4.2;
    }
    for (const leak of this.leaks) {
      if (leak.time > 0) {
        leak.time -= dt;
        if (leak.time > 0) continue;
      }
      leak.life -= dt;
      leak.tick -= dt;
      if (leak.tick <= 0) {
        leak.tick = 0.75;
        if (!this.game.hasItem("sole") && Math.hypot(this.game.player.x - leak.x, this.game.player.y - leak.y) <= leak.r + this.game.player.r) {
          this.game.hurtPlayer(1, "Кислота лаборатории");
        }
        for (const enemy of [...this.game.enemies]) {
          if (Math.hypot(enemy.x - leak.x, enemy.y - leak.y) <= leak.r + enemy.r) this.game.damageEnemy(enemy, 1);
        }
      }
    }
    this.leaks = this.leaks.filter((leak) => leak.life > 0);
  }

  queueBeam(axis, position, { delay = 1, duration = 0.25 } = {}) {
    if (!this.enabled || (this.floorIndex !== 5 && this.room.type !== "rift")) return null;
    if (this.beams.length >= 8) this.beams.shift();
    const beam = { axis, time: delay, duration: delay, life: duration, hit: false };
    if (axis === "vertical") {
      const x = clamp(position, ARENA.left + 12, ARENA.right - 12);
      Object.assign(beam, { x1: x, y1: ARENA.top, x2: x, y2: ARENA.bottom });
    } else {
      const y = clamp(position, ARENA.top + 12, ARENA.bottom - 12);
      Object.assign(beam, { x1: ARENA.left, y1: y, x2: ARENA.right, y2: y });
    }
    this.beams.push(beam);
    return beam;
  }

  updateBeams(dt) {
    this.nextBeam -= dt;
    if (this.nextBeam <= 0) {
      const vertical = this.random() < 0.5;
      this.queueBeam(vertical ? "vertical" : "horizontal", vertical ? this.game.player.x : this.game.player.y);
      this.nextBeam = 3.4;
    }
    for (const beam of this.beams) {
      if (beam.time > 0) {
        beam.time -= dt;
        if (beam.time > 0) continue;
      }
      beam.life -= dt;
      if (!beam.hit) {
        beam.hit = true;
        const playerDistance = beam.axis === "vertical" ? Math.abs(this.game.player.x - beam.x1) : Math.abs(this.game.player.y - beam.y1);
        if (playerDistance <= this.game.player.r + 3) this.game.hurtPlayer(1, "Лазерная решётка");
        for (const enemy of [...this.game.enemies]) {
          const enemyDistance = beam.axis === "vertical" ? Math.abs(enemy.x - beam.x1) : Math.abs(enemy.y - beam.y1);
          if (enemyDistance <= enemy.r + 3) this.game.damageEnemy(enemy, 4);
        }
        this.game.emit("slam", { x: beam.axis === "vertical" ? beam.x1 : 240, y: beam.axis === "horizontal" ? beam.y1 : 140, environment: true });
      }
    }
    this.beams = this.beams.filter((beam) => beam.time > 0 || beam.life > 0);
  }
}

export function createEnvironment(game, room) {
  return new RoomEnvironment(game, room);
}
