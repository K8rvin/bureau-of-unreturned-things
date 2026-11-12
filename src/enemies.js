import { ARENA } from "./content.js";

function moveEnemy(game, enemy, dt, direction = 1, orbit = 0) {
  const dx = game.player.x - enemy.x;
  const dy = game.player.y - enemy.y;
  const distance = Math.hypot(dx, dy) || 1;
  const slow = enemy.slowTimer > 0 || enemy.webTimer > 0 ? 0.7 : enemy.poisonTimer > 0 ? 0.85 : 1;
  const phaseSpeed = enemy.phased ? 1.35 : 1;
  game.moveBody(enemy, (dx / distance * direction - dy / distance * orbit) * enemy.speed * slow * phaseSpeed * dt, (dy / distance * direction + dx / distance * orbit) * enemy.speed * slow * phaseSpeed * dt);
}

function finishTelegraph(game, enemy, dt) {
  if (enemy.telegraph <= 0) return false;
  enemy.telegraph -= dt;
  if (enemy.telegraph <= 0) performSpecialEnemyAttack(game, enemy);
  return true;
}

function updateWraith(game, enemy, dt) {
  if (enemy.phased) {
    enemy.phaseTimer = Math.max(0, enemy.phaseTimer - dt);
    if (enemy.phaseTimer <= 0) {
      enemy.phased = false;
      const position = game.safeSpawnPosition(enemy.x, enemy.y, enemy.r, true);
      if (position) Object.assign(enemy, position);
      enemy.contactTimer = 0.4;
      game.emit("materialize", { enemy });
    }
  }
  if (finishTelegraph(game, enemy, dt)) return;
  enemy.attackTimer -= dt;
  const distance = Math.hypot(game.player.x - enemy.x, game.player.y - enemy.y);
  moveEnemy(game, enemy, dt, enemy.phased ? 1 : distance > 105 ? 1 : -0.5, enemy.id % 2 ? 0.35 : -0.35);
  if (enemy.phased) return;
  if (enemy.attackTimer <= 0) game.beginTelegraph(enemy, "wraithCast", 0.65);
}

function updateCurseCaster(game, enemy, dt) {
  enemy.blinkCooldown = Math.max(0, enemy.blinkCooldown - dt);
  if (finishTelegraph(game, enemy, dt)) return;
  enemy.attackTimer -= dt;
  const distance = Math.hypot(game.player.x - enemy.x, game.player.y - enemy.y);
  moveEnemy(game, enemy, dt, distance > 150 ? 1 : distance < 95 ? -0.6 : 0, enemy.id % 2 ? 0.4 : -0.4);
  if (enemy.attackTimer > 0) return;
  if (distance < 80 && enemy.blinkCooldown <= 0) {
    const x = ARENA.right - (game.player.x - ARENA.left);
    const y = ARENA.top + 36 + enemy.id * 31 % 130;
    enemy.riftTarget = game.safeSpawnPosition(x, y, enemy.r, true);
    enemy.blinkCooldown = 4;
    game.beginTelegraph(enemy, "curseBlink", 0.65);
  } else {
    const attack = enemy.attackIndex++ % 2 === 0 ? "curseZone" : "curseFan";
    game.beginTelegraph(enemy, attack, attack === "curseZone" ? 0.85 : 0.75);
  }
}

export function updateSpecialEnemy(game, enemy, dt) {
  if (enemy.type === "wraith") {
    updateWraith(game, enemy, dt);
    return true;
  }
  if (enemy.type === "curseCaster") {
    updateCurseCaster(game, enemy, dt);
    return true;
  }
  return false;
}

export function performSpecialEnemyAttack(game, enemy) {
  if (enemy.dead) return true;
  if (enemy.attackType === "wraithCast") {
    for (const offset of [-0.14, 0.14]) game.fireEnemy(enemy, enemy.aimAngle + offset, 80, { source: "ghostOrb", r: 3 });
    enemy.phaseTimer = 1.1;
    enemy.phased = true;
    enemy.attackTimer = 2.4;
    game.emit("phase", { enemy });
    return true;
  }
  if (enemy.attackType === "curseZone") {
    game.environment?.queueDrop(game.player.x, game.player.y, { delay: 0.85, radius: 22, kind: "curse", force: true, source: "Печать имени" });
    enemy.attackTimer = 2.2;
    game.emit("enemyShot", { enemy });
    return true;
  }
  if (enemy.attackType === "curseFan") {
    for (const offset of [-0.24, -0.12, 0, 0.12, 0.24]) game.fireEnemy(enemy, enemy.aimAngle + offset, 88, { source: "curse", r: 4, puddle: true });
    enemy.attackTimer = 2.1;
    game.emit("enemyShot", { enemy });
    return true;
  }
  if (enemy.attackType === "curseBlink") {
    if (enemy.riftTarget) Object.assign(enemy, enemy.riftTarget);
    enemy.riftTarget = null;
    enemy.attackTimer = 1.2;
    game.emit("spawn", { enemy });
    return true;
  }
  return false;
}
