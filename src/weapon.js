import { ARENA } from "./content.js";

const PRIMARY_SOURCES = new Set(["shot", "echo", "laser"]);

export function getProjectileRadius(damage) {
  return Math.max(1.1, Math.min(10, 1.1 + Math.sqrt(Math.max(0, damage)) * 1.35));
}

export function getLaserWidth(damage) {
  return Math.max(2, Math.min(14, 1 + Math.sqrt(Math.max(0, damage)) * 1.2));
}

export function getVolleyAngles(game) {
  const count = 1 + (game.hasItem("clip") ? 1 : 0) + (game.hasItem("triple") ? 2 : 0) + (game.hasItem("quad") ? 3 : 0);
  return Array.from({ length: count }, (_, index) => (index - (count - 1) / 2) * 0.115);
}

export function getWeaponStats(game, source = "shot", scale = 1) {
  const laser = source === "laser" || (source === "shot" && game.hasItem("laser"));
  const primary = PRIMARY_SOURCES.has(source);
  const count = primary ? 1 + (game.hasItem("clip") ? 1 : 0) + (game.hasItem("triple") ? 2 : 0) + (game.hasItem("quad") ? 3 : 0) : 1;
  const spreadFactor = count > 1 ? count === 2 && game.hasItem("clip") && !game.hasItem("triple") && !game.hasItem("quad") ? 0.65 : 1 / Math.sqrt(count) : 1;
  const damage = (laser ? 5 : 2) * scale * spreadFactor * (primary && game.hasItem("power") ? 1.5 : 1) * (primary && game.hasItem("heavy") ? 3 : 1);
  const fireInterval = (laser ? 0.65 : 0.18) * (game.hasItem("rapid") ? 0.75 : 1) * (game.hasItem("heavy") ? 1.75 : 1);
  const maxDamage = !laser && source === "shot" && game.hasItem("mercury") ? damage * 2.5 : damage;
  const needle = !laser && source === "shot" && game.hasItem("needle");
  const mercury = !laser && source === "shot" && game.hasItem("mercury");
  return {
    weapon: laser ? "Лазер" : "Очередь",
    laser,
    damage,
    maxDamage,
    projectileCount: count,
    fireInterval,
    fireRate: 1 / fireInterval,
    projectileSpeed: laser ? null : needle ? 255 : mercury ? 155 : 185,
    projectileRadius: laser ? getLaserWidth(damage) : getProjectileRadius(damage),
    maxProjectileRadius: laser ? getLaserWidth(maxDamage) : getProjectileRadius(maxDamage),
    pierce: laser ? Infinity : needle || (source === "mirror" && game.memory.mirrorAwakened) ? 1 : 0,
    bounces: !laser && source === "shot" && game.hasItem("chalk") ? 1 : 0,
  };
}

function segmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function rayRectDistance(x, y, dx, dy, rect) {
  let near = 0;
  let far = Infinity;
  for (const axis of ["x", "y"]) {
    const direction = axis === "x" ? dx : dy;
    const point = axis === "x" ? x : y;
    const start = axis === "x" ? rect.x : rect.y;
    const size = axis === "x" ? rect.w : rect.h;
    if (Math.abs(direction) < 1e-9) {
      if (point < start || point > start + size) return Infinity;
      continue;
    }
    let a = (start - point) / direction;
    let b = (start + size - point) / direction;
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return Infinity;
  }
  return near > 0 ? near : Infinity;
}

export function castRay(game, x, y, angle, maxDistance = 480) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let length = maxDistance;
  if (dx > 0) length = Math.min(length, (ARENA.right - x) / dx);
  if (dx < 0) length = Math.min(length, (ARENA.left - x) / dx);
  if (dy > 0) length = Math.min(length, (ARENA.bottom - y) / dy);
  if (dy < 0) length = Math.min(length, (ARENA.top - y) / dy);
  for (const obstacle of game.obstacles) length = Math.min(length, rayRectDistance(x, y, dx, dy, obstacle));
  return { x1: x, y1: y, x2: x + dx * length, y2: y + dy * length };
}

export function firePlayerLaser(game, angle, scale = 1, origin = game.player) {
  const stats = getWeaponStats(game, "laser", scale);
  const beam = castRay(game, origin.x + Math.cos(angle) * 9, origin.y + Math.sin(angle) * 9, angle);
  const width = stats.projectileRadius;
  const targets = game.enemies.filter((enemy) => !enemy.dead && enemy.spawnTime <= 0 && game.waveIntro <= 0 && segmentDistance(enemy.x, enemy.y, beam.x1, beam.y1, beam.x2, beam.y2) <= enemy.r + width / 2)
    .sort((a, b) => Math.hypot(a.x - origin.x, a.y - origin.y) - Math.hypot(b.x - origin.x, b.y - origin.y)).slice(0, 32);
  for (const enemy of targets) {
    const incoming = Math.atan2(beam.y1 - enemy.y, beam.x1 - enemy.x);
    const difference = Math.atan2(Math.sin(incoming - enemy.aimAngle), Math.cos(incoming - enemy.aimAngle));
    const shielded = enemy.type === "umbrellaBoss" && enemy.shieldTimer > 0 && Math.abs(difference) < 0.95;
    if (shielded) {
      game.emit("shield", { x: enemy.x, y: enemy.y, boss: true });
      continue;
    }
    if (game.damageEnemy(enemy, stats.damage, { source: "laser" })) {
      game.projectileEffects(enemy, { source: "laser" });
      game.emit("projectileHit", { x: enemy.x, y: enemy.y, enemy });
    }
  }
  if (game.lasers.length >= 40) game.lasers.shift();
  game.lasers.push({ ...beam, owner: "player", width, life: 0.18, damage: stats.damage });
  game.emit("laser", { ...beam, owner: "player" });
  return beam;
}

export function fireEnemyLaser(game, enemy, angle, { width = 3, damage = 1, source = "Луч Калибратора" } = {}) {
  const beam = castRay(game, enemy.x + Math.cos(angle) * (enemy.r + 3), enemy.y + Math.sin(angle) * (enemy.r + 3), angle);
  if (segmentDistance(game.player.x, game.player.y, beam.x1, beam.y1, beam.x2, beam.y2) <= game.player.r + width / 2) game.hurtPlayer(damage, source);
  if (game.lasers.length >= 40) game.lasers.shift();
  game.lasers.push({ ...beam, owner: "enemy", width, life: 0.22, damage });
  game.emit("enemyShot", { enemy });
  return beam;
}
