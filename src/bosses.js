import { BOSS_ATTACKS } from "./content.js";
import { fireEnemyLaser } from "./weapon.js";

const TAU = Math.PI * 2;
const MEMORY_ATTACKS = [
  ["umbrella", "memoryUmbrella"],
  ["fire", "memoryFire"],
  ["chalk", "memoryChalk"],
  ["magnet", "memoryMagnet"],
];

export function getFinalMemoryAttacks(game) {
  const attacks = MEMORY_ATTACKS.filter(([itemId]) => !game.hasItem(itemId)).map(([, attack]) => attack);
  return attacks.length ? attacks : ["memoryEcho"];
}

function moveBoss(game, enemy, dt) {
  const dx = game.player.x - enemy.x;
  const dy = game.player.y - enemy.y;
  const distance = Math.hypot(dx, dy) || 1;
  const direction = distance > 120 ? 1 : distance < 80 ? -0.5 : 0;
  const orbit = enemy.attackIndex % 2 ? 0.3 : -0.3;
  const slow = enemy.slowTimer > 0 || enemy.webTimer > 0 ? 0.7 : enemy.poisonTimer > 0 ? 0.85 : 1;
  game.moveBody(enemy, (dx / distance * direction - dy / distance * orbit) * enemy.speed * slow * dt, (dy / distance * direction + dx / distance * orbit) * enemy.speed * slow * dt);
}

export function updateSorterBoss(game, enemy, dt) {
  if (enemy.telegraph > 0) {
    enemy.telegraph -= dt;
    if (enemy.telegraph <= 0) performSorterAttack(game, enemy);
    return;
  }
  enemy.attackTimer -= dt;
  moveBoss(game, enemy, dt);
  if (enemy.attackTimer <= 0) {
    const attacks = enemy.phase === 1 ? ["stamp", "sort", "summonPackers"] : ["stamp", "sort", "sweep", "summonPackers"];
    const attack = attacks[enemy.attackIndex++ % attacks.length];
    game.beginTelegraph(enemy, attack, BOSS_ATTACKS[attack].telegraph);
  }
}

export function performSorterAttack(game, enemy) {
  if (enemy.dead) return;
  const attack = enemy.attackType;
  if (attack === "stamp") {
    for (const offset of [-56, 0, 56]) game.environment?.queueDrop(game.player.x + offset, game.player.y, { delay: 0.85, radius: 20 });
    game.emit("telegraph", { enemy, attackType: attack });
  } else if (attack === "sort") {
    game.environment?.boost(2.8);
    game.player.knockX += (game.player.x >= enemy.x ? 1 : -1) * 90;
    for (const offset of [-0.18, 0, 0.18]) game.fireEnemy(enemy, enemy.aimAngle + offset, 105);
    game.emit("sweep", { enemy });
  } else if (attack === "summonPackers") {
    const minions = game.enemies.filter((other) => !other.dead && other.type === "packer").length;
    if (enemy.summonCount < 3 && minions < 3) {
      game.spawnEnemy("packer", 0.1, 0.25);
      game.spawnEnemy("packer", 0.9, 0.25);
      enemy.summonCount++;
    } else {
      for (let i = 0; i < 8; i++) game.fireEnemy(enemy, i / 8 * TAU + 0.2, 86);
    }
    game.emit("summon", { enemy });
  } else if (attack === "sweep") {
    for (let i = 0; i < 16; i++) game.fireEnemy(enemy, i / 16 * TAU + enemy.attackIndex * 0.12, 95);
    game.emit("sweep", { enemy });
  }
  enemy.attackTimer = BOSS_ATTACKS[attack].cooldown * (enemy.phase === 2 ? 0.85 : 1);
}

export function updateFinalBoss(game, enemy, dt) {
  if (enemy.phase === 2 && !enemy.phase2Summoned) {
    enemy.phase2Summoned = true;
    game.spawnEnemy("skeleton", 0.12, 0.28);
    game.spawnEnemy("skeleton", 0.88, 0.28);
    game.emit("summon", { enemy });
  }
  if (enemy.telegraph > 0) {
    enemy.telegraph -= dt;
    if (enemy.telegraph <= 0) performFinalAttack(game, enemy);
    return;
  }
  enemy.attackTimer -= dt;
  moveBoss(game, enemy, dt);
  if (enemy.attackTimer <= 0) {
    const attacks = enemy.memoryAttacks.length ? enemy.memoryAttacks : ["memoryEcho"];
    const attack = enemy.phase === 2 && enemy.attackIndex % 4 === 3 ? "memoryEcho" : attacks[enemy.attackIndex % attacks.length];
    enemy.attackIndex++;
    game.beginTelegraph(enemy, attack, BOSS_ATTACKS[attack].telegraph);
  }
}

export function performFinalAttack(game, enemy) {
  if (enemy.dead) return;
  const attack = enemy.attackType;
  const secondPhase = enemy.phase === 2;
  if (attack === "memoryUmbrella") {
    for (let i = -4; i <= 4; i++) game.fireEnemy(enemy, enemy.aimAngle + i * 0.14, 118, { r: 2.5 });
    const count = secondPhase ? 12 : 8;
    for (let i = 0; i < count; i++) game.fireEnemy(enemy, i / count * TAU + 0.15, 84, { r: 2.5 });
  } else if (attack === "memoryFire") {
    const angles = secondPhase ? [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3] : [-0.24, -0.12, 0, 0.12, 0.24];
    for (const offset of angles) game.fireEnemy(enemy, enemy.aimAngle + offset, 96, { puddle: true, burning: true, r: 3.5 });
  } else if (attack === "memoryChalk") {
    const angles = secondPhase ? [-0.26, -0.13, 0, 0.13, 0.26] : [-0.13, 0, 0.13];
    for (const offset of angles) game.fireEnemy(enemy, enemy.aimAngle + offset, secondPhase ? 130 : 125, { bounces: 1, source: "memoryChalk" });
  } else if (attack === "memoryMagnet") {
    const angle = Math.atan2(enemy.y - game.player.y, enemy.x - game.player.x);
    const force = secondPhase ? 110 : 90;
    game.player.knockX += Math.cos(angle) * force;
    game.player.knockY += Math.sin(angle) * force;
    const angles = secondPhase ? [-0.3, -0.15, 0, 0.15, 0.3] : [-0.2, 0, 0.2];
    for (const offset of angles) game.fireEnemy(enemy, enemy.aimAngle + offset, 82, { source: "memoryMagnet", homingTime: 2.4, life: 4 });
    game.emit("slam", { x: enemy.x, y: enemy.y });
  } else if (attack === "memoryEcho") {
    for (let i = 0; i < 16; i++) game.fireEnemy(enemy, i / 16 * TAU + game.time * 0.2, 92);
  }
  enemy.attackTimer = BOSS_ATTACKS[attack].cooldown * (secondPhase ? 0.85 : 1);
  game.emit("enemyShot", { enemy });
}

export function updateChemistBoss(game, enemy, dt) {
  if (enemy.telegraph > 0) {
    enemy.telegraph -= dt;
    if (enemy.telegraph <= 0) performChemistAttack(game, enemy);
    return;
  }
  enemy.attackTimer -= dt;
  moveBoss(game, enemy, dt);
  if (enemy.attackTimer <= 0) {
    const attacks = enemy.phase === 1 ? ["cloud", "toxicFan", "summonMoths"] : ["toxicFan", "cloud", "toxicRing", "summonMoths"];
    const attack = attacks[enemy.attackIndex++ % attacks.length];
    game.beginTelegraph(enemy, attack, BOSS_ATTACKS[attack].telegraph);
  }
}

export function performChemistAttack(game, enemy) {
  if (enemy.dead) return;
  const attack = enemy.attackType;
  if (attack === "cloud") {
    const offsets = enemy.phase === 2 ? [-64, 0, 64] : [-48, 48];
    for (const offset of offsets) game.environment?.queueLeak(game.player.x + offset, game.player.y, { delay: 0.85, radius: 24, duration: 3.2 });
  } else if (attack === "toxicFan") {
    const angles = enemy.phase === 2 ? [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3] : [-0.24, -0.12, 0, 0.12, 0.24];
    for (const offset of angles) game.fireEnemy(enemy, enemy.aimAngle + offset, 96, { puddle: true, acid: true, r: 3.5 });
  } else if (attack === "summonMoths") {
    const moths = game.enemies.filter((other) => !other.dead && other.type === "moth").length;
    if (enemy.summonCount < 3 && moths < 4) {
      game.spawnEnemy("moth", 0.12, 0.25);
      game.spawnEnemy("moth", 0.88, 0.25);
      enemy.summonCount++;
    } else {
      for (let i = 0; i < 8; i++) game.fireEnemy(enemy, i / 8 * TAU, 82, { puddle: true, acid: true });
    }
    game.emit("summon", { enemy });
  } else if (attack === "toxicRing") {
    for (let i = 0; i < 16; i++) game.fireEnemy(enemy, i / 16 * TAU + 0.12, 82, { puddle: true, acid: true });
  }
  enemy.attackTimer = BOSS_ATTACKS[attack].cooldown * (enemy.phase === 2 ? 0.82 : 1);
  game.emit("enemyShot", { enemy });
}

export function updateCalibratorBoss(game, enemy, dt) {
  if (enemy.telegraph > 0) {
    enemy.telegraph -= dt;
    if (enemy.telegraph <= 0) performCalibratorAttack(game, enemy);
    return;
  }
  enemy.attackTimer -= dt;
  moveBoss(game, enemy, dt);
  if (enemy.attackTimer <= 0) {
    const attacks = enemy.phase === 1 ? ["beamSweep", "beamGrid", "overcharge"] : ["beamGrid", "beamSweep", "overcharge", "beamSweep"];
    const attack = attacks[enemy.attackIndex++ % attacks.length];
    game.beginTelegraph(enemy, attack, BOSS_ATTACKS[attack].telegraph);
  }
}

export function performCalibratorAttack(game, enemy) {
  if (enemy.dead) return;
  const attack = enemy.attackType;
  if (attack === "beamSweep") {
    const angles = enemy.phase === 2 ? [-0.32, -0.16, 0, 0.16, 0.32] : [-0.2, 0, 0.2];
    for (const offset of angles) fireEnemyLaser(game, enemy, enemy.aimAngle + offset, { width: 3, damage: 1 });
  } else if (attack === "beamGrid") {
    game.environment?.queueBeam("vertical", game.player.x, { delay: 0.9 });
    game.environment?.queueBeam("horizontal", game.player.y + (enemy.phase === 2 ? 28 : 0), { delay: 0.9 });
  } else if (attack === "overcharge") {
    for (const offset of [-0.28, -0.14, 0, 0.14, 0.28]) game.fireEnemy(enemy, enemy.aimAngle + offset, 72, { r: 5, damage: 2 });
  }
  enemy.attackTimer = BOSS_ATTACKS[attack].cooldown * (enemy.phase === 2 ? 0.82 : 1);
  game.emit("enemyShot", { enemy });
}

export function updateRiftWarden(game, enemy, dt) {
  if (enemy.telegraph > 0) {
    enemy.telegraph -= dt;
    if (enemy.telegraph <= 0) performRiftAttack(game, enemy);
    return;
  }
  enemy.attackTimer -= dt;
  moveBoss(game, enemy, dt);
  if (enemy.attackTimer <= 0) {
    const attacks = enemy.phase === 1 ? ["riftBeam", "riftStep"] : ["riftGrid", "riftBeam", "riftStep"];
    const attack = attacks[enemy.attackIndex++ % attacks.length];
    if (attack === "riftStep") {
      const x = 90 + enemy.attackIndex * 97 % 300;
      const y = 82 + enemy.attackIndex * 53 % 116;
      enemy.riftTarget = game.safeSpawnPosition(x, y, enemy.r, true);
    }
    game.beginTelegraph(enemy, attack, BOSS_ATTACKS[attack].telegraph);
  }
}

export function performRiftAttack(game, enemy) {
  if (enemy.dead) return;
  const attack = enemy.attackType;
  if (attack === "riftBeam") {
    const offsets = enemy.phase === 2 ? [-0.18, 0, 0.18] : [-0.1, 0.1];
    for (const offset of offsets) fireEnemyLaser(game, enemy, enemy.aimAngle + offset, { width: 3, damage: 1, source: "Луч Смотрителя Разреза" });
  } else if (attack === "riftStep") {
    if (enemy.riftTarget) {
      Object.assign(enemy, enemy.riftTarget);
      game.emit("spawn", { enemy });
    }
    const count = enemy.phase === 2 ? 12 : 8;
    for (let i = 0; i < count; i++) game.fireEnemy(enemy, i / count * TAU + enemy.attackIndex * 0.1, 90);
    game.emit("summon", { enemy });
  } else if (attack === "riftGrid") {
    game.environment?.queueBeam("vertical", game.player.x, { delay: 0.85 });
    game.environment?.queueBeam("horizontal", game.player.y, { delay: 0.85 });
  }
  enemy.attackTimer = BOSS_ATTACKS[attack].cooldown * (enemy.phase === 2 ? 0.85 : 1);
  game.emit("enemyShot", { enemy });
}
