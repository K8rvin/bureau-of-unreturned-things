import { ARENA, BOSS_ATTACKS, ENEMY_TYPES, HEIGHT, WIDTH } from "./content.js";
import { drawMap } from "./map.js";
import { DWARF_FILTERS, DWARF_TOOLS } from "./dwarf.js";
import { iconPath } from "./icon-paths.js";

const TAU = Math.PI * 2;
const BIG = new Set(["boss", "umbrellaBoss", "sorterBoss", "finalBoss", "chemistBoss", "calibratorBoss", "riftWarden", "guardian"]);
const FLOOR_THEMES = [
  { floor: "#3d422b", grid: "#4d5335", center: "#555b38", accent: "#7a6c42", wall: "#5e5136", obstacle: "#70583d", top: "#a58c5d" },
  { floor: "#34382b", grid: "#464a34", center: "#4d5135", accent: "#8d774b", wall: "#73623e", obstacle: "#66573d", top: "#ad915c" },
  { floor: "#483c2c", grid: "#65513a", center: "#69523b", accent: "#ad7a50", wall: "#866042", obstacle: "#795337", top: "#c28d5c" },
  { floor: "#31323b", grid: "#424452", center: "#4d4f5b", accent: "#8c8c9b", wall: "#686979", obstacle: "#5e5968", top: "#aaa2b5" },
  { floor: "#30362f", grid: "#454d42", center: "#4e5847", accent: "#8a9172", wall: "#5c674f", obstacle: "#635a44", top: "#a4986d" },
  { floor: "#49412b", grid: "#655738", center: "#70603a", accent: "#b69b5c", wall: "#817044", obstacle: "#7a623a", top: "#c5a66b" },
];
const MEMORY_ICONS = { memoryUmbrella: "alarm-clock", memoryFire: "fire", memoryChalk: "sewing-needle", memoryMagnet: "echo-ripples", memoryEcho: "alarm-clock" };

function bossAction(enemy) {
  if (enemy.type === "sorterBoss") {
    if (enemy.attackType === "summonPackers") return "special";
    if (enemy.attackType === "sort") return "attack2";
  }
  if (enemy.type === "finalBoss") {
    if (["memoryUmbrella", "memoryEcho"].includes(enemy.attackType)) return "attack2";
    if (enemy.attackType === "memoryMagnet") return "special";
  }
  if (enemy.type === "chemistBoss") {
    if (enemy.attackType === "cloud") return "attack2";
    if (enemy.attackType === "summonMoths") return "special";
  }
  if (enemy.type === "calibratorBoss") {
    if (enemy.attackType === "beamSweep") return "attack2";
    if (enemy.attackType === "beamGrid") return "special";
  }
  return null;
}

export class Renderer {
  constructor(canvas, fx, sprites) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.context.imageSmoothingEnabled = false;
    this.fx = fx;
    this.sprites = sprites;
    this.motion = new Map();
    this.corpses = [];
    this.mapExpanded = false;
    this.mapHidden = false;
    this.showTelegraphs = false;
    this.icons = {};
    for (const name of ["keyring", "umbrella", "key", "unlit-bomb", "heart-battery", "paper-clip", "big-gear", "mirror-mirror", "fire", "pencil", "magnet", "echo-ripples", "ink-swirl", "sewing-needle", "laser-blast", "locked-chest", "open-chest", "alarm-clock", "blood", "sewing-string", "poison-bottle", "lab-coat"]) {
      const image = new Image();
      image.src = iconPath(`${name}.svg`);
      this.icons[name] = image;
    }
    this.arrowImage = new Image();
    this.arrowImage.src = "assets/library/projectiles/hunter-arrow.png";
  }

  recordDeath(enemy, time) {
    const sprite = enemy.type === "dust" && enemy.small ? "dustSmall" : ENEMY_TYPES[enemy.type].sprite || enemy.type;
    if (!this.sprites.hasAnimation(sprite, "death")) return;
    this.corpses.push({ sprite, x: enemy.x, y: enemy.y + enemy.r + 4, r: enemy.r, time });
    if (this.corpses.length > 24) this.corpses.shift();
  }

  render(game) {
    const ctx = this.context;
    if (this.corpseRoom !== game.currentRoomId) {
      this.corpses = [];
      this.corpseRoom = game.currentRoomId;
    }
    this.corpses = this.corpses.filter((corpse) => game.time - corpse.time < 1.2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const [shakeX, shakeY] = this.fx.shakeOffset();
    ctx.save();
    ctx.translate(shakeX, shakeY);
    this.drawRoom(game);
    this.drawDoors(game);
    this.drawPuddles(game);
    this.drawEnvironment(game);
    this.fx.drawLayer(ctx, "back");
    this.fx.drawLayer(ctx, "front", true);
    this.drawTelegraphs(game);
    this.drawPickups(game);
    this.drawNpc(game);
    this.drawEvent(game);
    this.drawPackLinks(game);
    this.drawEnemies(game);
    this.drawPlayer(game);
    this.drawBombs(game);
    this.drawFamiliars(game);
    this.drawArcs(game);
    this.drawProjectiles(game);
    this.drawLasers(game);
    this.fx.drawLayer(ctx, "front");
    ctx.restore();
    this.drawIntro(game);
    const showMinimap = this.mapExpanded || (!this.mapHidden && (game.state !== "wave" && game.state !== "boss"));
    if (game.floor && game.state !== "title" && showMinimap) drawMap(ctx, game.floor, game.currentRoomId, { expanded: this.mapExpanded, hasLens: game.hasItem("lens") });
    if (!this.fx.reduced && game.player.invuln > 0.55) {
      ctx.strokeStyle = `rgba(225,70,85,${(game.player.invuln - 0.55) * 1.8})`;
      ctx.lineWidth = 8;
      ctx.strokeRect(2, 2, WIDTH - 4, HEIGHT - 4);
    }
  }

  drawRoom(game) {
    const ctx = this.context;
    const theme = FLOOR_THEMES[game.floor?.index ?? game.floorIndex] || FLOOR_THEMES[0];
    ctx.fillStyle = "#0c0f15";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = theme.floor;
    ctx.fillRect(ARENA.left, ARENA.top, ARENA.right - ARENA.left, ARENA.bottom - ARENA.top);
    const roomImage = this.sprites.roomImage(game.floor?.index ?? game.floorIndex);
    if (roomImage) {
      ctx.drawImage(roomImage, 0, 0, WIDTH, HEIGHT);
    } else {
      ctx.strokeStyle = theme.grid;
      ctx.lineWidth = 1;
      for (let x = ARENA.left + 16; x < ARENA.right; x += 16) {
        ctx.beginPath(); ctx.moveTo(x + 0.5, ARENA.top); ctx.lineTo(x + 0.5, ARENA.bottom); ctx.stroke();
      }
      for (let y = ARENA.top + 16; y < ARENA.bottom; y += 16) {
        ctx.beginPath(); ctx.moveTo(ARENA.left, y + 0.5); ctx.lineTo(ARENA.right, y + 0.5); ctx.stroke();
      }
      ctx.fillStyle = theme.center;
      ctx.strokeStyle = theme.accent;
      ctx.setLineDash([4, 5]);
      if (game.floorIndex === 3) {
        ctx.fillRect(176, 107, 128, 70);
        ctx.strokeRect(188, 116, 104, 52);
      } else {
        ctx.beginPath(); ctx.ellipse(240, 142, 64, 35, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(240, 142, 48, 25, 0, 0, TAU); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.lineWidth = 5;
    ctx.strokeStyle = theme.wall;
    ctx.strokeRect(ARENA.left - 2, ARENA.top - 2, ARENA.right - ARENA.left + 4, ARENA.bottom - ARENA.top + 4);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#17131b";
    ctx.strokeRect(ARENA.left + 2, ARENA.top + 2, ARENA.right - ARENA.left - 4, ARENA.bottom - ARENA.top - 4);
    for (const obstacle of game.obstacles || []) {
      ctx.fillStyle = "#17131b";
      ctx.beginPath(); ctx.roundRect(obstacle.x - 2, obstacle.y + 3, obstacle.w + 4, obstacle.h + 3, 4); ctx.fill();
      ctx.fillStyle = theme.obstacle;
      ctx.beginPath(); ctx.roundRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h, 3); ctx.fill();
      ctx.strokeStyle = theme.top;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(obstacle.x + 4, obstacle.y + 3); ctx.lineTo(obstacle.x + obstacle.w - 4, obstacle.y + 3); ctx.stroke();
      ctx.fillStyle = theme.top;
      for (const x of [obstacle.x + 5, obstacle.x + obstacle.w - 5]) {
        ctx.beginPath(); ctx.ellipse(x, obstacle.y + obstacle.h / 2, 3, Math.max(2, obstacle.h / 2 - 3), 0, 0, TAU); ctx.fill();
      }
    }
    if (game.state === "title") {
      ctx.fillStyle = "#817083";
      ctx.font = '8px "Archive Pixel", monospace';
      ctx.textAlign = "center";
      ctx.fillText("БИБЛИОТЕКА ЖДЁТ ЧИТАТЕЛЯ", 240, 145);
    }
  }

  drawEnvironment(game) {
    const environment = game.environment;
    if (!environment) return;
    const ctx = this.context;
    for (const belt of environment.belts) {
      const boosted = environment.boostTimer > 0;
      ctx.save();
      ctx.fillStyle = boosted ? "#775b354a" : "#39434780";
      ctx.fillRect(belt.x, belt.y, belt.w, belt.h);
      ctx.strokeStyle = boosted ? "#e8b970" : "#828675";
      ctx.lineWidth = boosted ? 2 : 1;
      ctx.strokeRect(belt.x, belt.y, belt.w, belt.h);
      ctx.beginPath(); ctx.rect(belt.x, belt.y, belt.w, belt.h); ctx.clip();
      const offset = this.fx.reduced ? 0 : Math.floor(game.time * 12) % 18;
      for (let x = belt.x + 10 + offset * belt.direction; x < belt.x + belt.w - 5; x += 18) {
        ctx.beginPath();
        ctx.moveTo(x - 3 * belt.direction, belt.y + 7);
        ctx.lineTo(x + 3 * belt.direction, belt.y + belt.h / 2);
        ctx.lineTo(x - 3 * belt.direction, belt.y + belt.h - 7);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const leak of environment.leaks) {
      ctx.save();
      if (leak.time > 0) {
        const progress = Math.max(0, Math.min(1, 1 - leak.time / leak.duration));
        ctx.fillStyle = `rgba(91,160,91,${0.06 + progress * 0.12})`;
        ctx.strokeStyle = `rgba(145,207,116,${0.55 + progress * 0.45})`;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(leak.x, leak.y, leak.r, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(leak.x, leak.y, leak.r * (1 - progress), 0, TAU); ctx.stroke();
      } else {
        ctx.fillStyle = "rgba(91,160,91,0.24)";
        ctx.strokeStyle = "#8bc47a99";
        ctx.beginPath(); ctx.ellipse(leak.x, leak.y + 2, leak.r, leak.r * 0.62, 0, 0, TAU); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
    for (const beam of environment.beams) {
      ctx.save();
      if (beam.time > 0) {
        ctx.strokeStyle = "#d6bd74bb";
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath(); ctx.moveTo(beam.x1, beam.y1); ctx.lineTo(beam.x2, beam.y2); ctx.stroke();
      } else {
        ctx.strokeStyle = "#f0cf83cc";
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(beam.x1, beam.y1); ctx.lineTo(beam.x2, beam.y2); ctx.stroke();
        ctx.strokeStyle = "#fff0bbee";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(beam.x1, beam.y1); ctx.lineTo(beam.x2, beam.y2); ctx.stroke();
      }
      ctx.restore();
    }
    for (const drop of environment.drops) {
      ctx.save();
      if (drop.hit) {
        ctx.fillStyle = `rgba(244,190,125,${drop.impact / 0.28 * 0.35})`;
        ctx.beginPath(); ctx.arc(drop.x, drop.y, drop.r + 4, 0, TAU); ctx.fill();
      } else {
        const progress = Math.max(0, Math.min(1, 1 - drop.time / drop.duration));
        ctx.fillStyle = drop.kind === "curse" ? `rgba(128,72,151,${0.1 + progress * 0.18})` : `rgba(216,84,68,${0.07 + progress * 0.14})`;
        ctx.strokeStyle = drop.kind === "curse" ? `rgba(216,164,232,${0.55 + progress * 0.45})` : `rgba(244,164,115,${0.55 + progress * 0.45})`;
        ctx.lineWidth = 1 + progress;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(drop.x, drop.y, drop.r, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(drop.x, drop.y, drop.r * (1 - progress), 0, TAU); ctx.stroke();
        this.drawIcon(drop.kind === "curse" ? "echo-ripples" : "mirror-mirror", drop.x - 6, drop.y - 34 + progress * 22, 12, "#f2c99b");
      }
      ctx.restore();
    }
  }

  drawDoors(game) {
    const room = game.room();
    if (!room) return;
    const ctx = this.context;
    for (const [direction, targetId] of Object.entries(room.doors)) {
      if (!targetId) continue;
      const target = game.rooms.find((entry) => entry.id === targetId);
      const hidden = room.hidden.includes(direction) && !room.secretFound;
      if (hidden || (target?.type === "secret" && !target.secretFound)) {
        this.drawSecretClue(game, direction);
        continue;
      }
      const open = room.cleared;
      ctx.fillStyle = open ? "#b78c62" : "#49313c";
      ctx.strokeStyle = open ? "#e2bd7e" : "#7b4853";
      if (direction === "N" || direction === "S") {
        const y = direction === "N" ? ARENA.top - 3 : ARENA.bottom - 3;
        ctx.fillRect(222, y, 36, 6);
        ctx.strokeRect(222, y, 36, 6);
        if (!open) for (let x = 226; x < 256; x += 7) {
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 6); ctx.stroke();
        }
      } else {
        const x = direction === "W" ? ARENA.left - 3 : ARENA.right - 3;
        ctx.fillRect(x, 121, 6, 38);
        ctx.strokeRect(x, 121, 6, 38);
        if (!open) for (let y = 125; y < 157; y += 7) {
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 6, y); ctx.stroke();
        }
      }
      if (["treasure", "vault"].includes(target?.type)) {
        const point = direction === "N" ? { x: 240, y: ARENA.top } : direction === "S" ? { x: 240, y: ARENA.bottom } : direction === "W" ? { x: ARENA.left, y: 140 } : { x: ARENA.right, y: 140 };
        const locked = target.type === "vault" ? !target.rewardClaimed : game.floorIndex >= 1 && !target.unlocked && !target.rewardClaimed;
        this.drawIcon(locked ? "locked-chest" : "open-chest", point.x - 7, point.y - 7, 14);
        if (target.type === "treasure" && locked) this.drawIcon("key", point.x + 4, point.y - 2, 8);
      }
    }
  }

  drawSecretClue(game, direction) {
    const room = game.room();
    const ctx = this.context;
    const point = direction === "N" ? { x: 240, y: ARENA.top } : direction === "S" ? { x: 240, y: ARENA.bottom } : direction === "W" ? { x: ARENA.left, y: 140 } : { x: ARENA.right, y: 140 };
    const lens = game.hasItem("lens");
    ctx.save();
    ctx.strokeStyle = lens ? "#d1b17bcc" : "#6b51504f";
    ctx.lineWidth = lens ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(point.x - 11, point.y - 3);
    ctx.lineTo(point.x - 4, point.y + 2);
    ctx.lineTo(point.x + 1, point.y - 2);
    ctx.lineTo(point.x + 9, point.y + 3);
    ctx.stroke();
    ctx.fillStyle = lens ? "#d6bf8c99" : "#9a82662c";
    for (let i = 0; i < 4; i++) {
      const dx = Math.sin(game.time * 0.8 + i * 2) * (8 + i * 2);
      const dy = Math.cos(game.time * 0.6 + i) * 3;
      ctx.fillRect(point.x + dx, point.y + dy, 1, 1);
    }
    ctx.restore();
  }

  drawPuddles(game) {
    const ctx = this.context;
    for (const puddle of game.puddles) {
      ctx.fillStyle = puddle.acid ? `rgba(91,160,91,${0.18 + puddle.life * 0.1})` : puddle.burning ? `rgba(218,103,54,${0.18 + puddle.life * 0.1})` : puddle.friendly ? `rgba(91,151,163,${0.12 + puddle.life * 0.08})` : `rgba(128,72,151,${0.13 + puddle.life * 0.08})`;
      ctx.beginPath(); ctx.ellipse(puddle.x, puddle.y + 2, puddle.r, puddle.r * 0.55, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = puddle.acid ? "#8bc47a99" : puddle.burning ? "#e79a5866" : puddle.friendly ? "#5b97a366" : "#80489766";
      ctx.stroke();
    }
  }

  drawTelegraphs(game) {
    const ctx = this.context;
    for (const enemy of game.enemies) {
      if (enemy.dead || enemy.telegraph <= 0) continue;
      const total = enemy.telegraphDuration || BOSS_ATTACKS[enemy.attackType]?.telegraph || 0.75;
      const progress = 1 - enemy.telegraph / total;
      ctx.save();
      ctx.globalAlpha = 0.28 + progress * 0.55;
      ctx.strokeStyle = "#ff9b75";
      ctx.fillStyle = "#d94c5933";
      ctx.lineWidth = 1 + progress * 2;
      ctx.setLineDash([4, 3]);
      if (["riftStep", "curseBlink"].includes(enemy.attackType) && enemy.riftTarget) {
        ctx.strokeStyle = "#c8a1ed";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(enemy.riftTarget.x, enemy.riftTarget.y, enemy.r + 10 - progress * 6, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(enemy.riftTarget.x - 9, enemy.riftTarget.y); ctx.lineTo(enemy.riftTarget.x + 9, enemy.riftTarget.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(enemy.riftTarget.x, enemy.riftTarget.y - 9); ctx.lineTo(enemy.riftTarget.x, enemy.riftTarget.y + 9); ctx.stroke();
      }
      if (!this.showTelegraphs) {
        ctx.restore();
        continue;
      }
      if (["fan", "rain", "memoryUmbrella", "memoryFire"].includes(enemy.attackType)) {
        ctx.beginPath(); ctx.moveTo(enemy.x, enemy.y);
        ctx.arc(enemy.x, enemy.y, 185, enemy.aimAngle - 0.68, enemy.aimAngle + 0.68);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (enemy.attackType === "riftBeam") {
        const offsets = enemy.phase === 2 ? [-0.18, 0, 0.18] : [-0.1, 0.1];
        for (const offset of offsets) {
          const angle = enemy.aimAngle + offset;
          ctx.beginPath(); ctx.moveTo(enemy.x, enemy.y);
          ctx.lineTo(enemy.x + Math.cos(angle) * 280, enemy.y + Math.sin(angle) * 280);
          ctx.stroke();
        }
      } else if (["shooter", "inker", "charge", "arrow", "goblin", "flyingEye", "bat", "skeletonAttack", "memoryChalk", "sort"].includes(enemy.attackType)) {
        ctx.lineWidth = ["charge", "skeletonAttack"].includes(enemy.attackType) ? 5 : enemy.attackType === "laser" ? 2 : 1;
        ctx.beginPath(); ctx.moveTo(enemy.x, enemy.y);
        ctx.lineTo(enemy.x + Math.cos(enemy.aimAngle) * 280, enemy.y + Math.sin(enemy.aimAngle) * 280);
        ctx.stroke();
      } else if (["slam", "gust", "memoryMagnet"].includes(enemy.attackType)) {
        ctx.setLineDash([]);
        const radius = enemy.attackType === "gust" ? 155 : enemy.attackType === "memoryMagnet" ? 120 : 70;
        ctx.beginPath(); ctx.arc(enemy.x, enemy.y, radius, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(enemy.x, enemy.y, radius * (1 - progress), 0, TAU); ctx.stroke();
      } else if (["sweep", "guardian", "shield", "memoryEcho", "stamp"].includes(enemy.attackType)) {
        ctx.beginPath(); ctx.arc(enemy.x, enemy.y, 34 + progress * 18, 0, TAU); ctx.stroke();
      } else if (["summon", "reveal", "summonPackers"].includes(enemy.attackType)) {
        for (const x of [ARENA.left + 26, ARENA.right - 26]) {
          ctx.beginPath(); ctx.arc(x, 136, 13 - progress * 5, 0, TAU); ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  drawPickups(game) {
    const ctx = this.context;
    for (const pickup of game.pickups) {
      if (pickup.dead) continue;
      if (pickup.type === "coin") {
        ctx.fillStyle = "#efc665";
        ctx.beginPath(); ctx.arc(pickup.x, pickup.y, 4, 0, TAU); ctx.fill();
        ctx.strokeStyle = "#6e4b27"; ctx.stroke();
        if (pickup.amount > 1) {
          ctx.fillStyle = "#fff0ad"; ctx.font = '8px "Archive Pixel", monospace'; ctx.textAlign = "center";
          ctx.fillText(pickup.amount, pickup.x, pickup.y + 2);
        }
        continue;
      }
      const name = pickup.type === "key" ? "key" : pickup.type === "bomb" ? "unlit-bomb" : pickup.type === "heart" ? "heart-battery" : "paper-clip";
      this.drawIcon(name, pickup.x - 11, pickup.y - 11, 22, pickup.type === "lore" ? "#e5b5ff" : "#f3d99a");
      if (pickup.type === "lore") {
        ctx.strokeStyle = "#d8a4e799";
        ctx.beginPath(); ctx.arc(pickup.x, pickup.y, 10 + Math.sin(game.time * 5) * 2, 0, TAU); ctx.stroke();
      }
    }
  }

  drawBombs(game) {
    const ctx = this.context;
    for (const bomb of game.bombs) {
      if (bomb.dead) continue;
      const flash = bomb.timer < 0.35 && Math.floor(bomb.timer * 24) % 2 === 0;
      ctx.fillStyle = "#08090d";
      ctx.beginPath(); ctx.arc(bomb.x, bomb.y, 5, 0, TAU); ctx.fill();
      ctx.fillStyle = flash ? "#fff1ba" : "#b84d52";
      ctx.beginPath(); ctx.arc(bomb.x, bomb.y, 3, 0, TAU); ctx.fill();
      ctx.strokeStyle = bomb.timer < 0.35 ? "#fff0a8" : "#a78b6b";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(bomb.x, bomb.y, 7, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - bomb.timer / (bomb.fuse || 1.5))); ctx.stroke();
      ctx.strokeStyle = "#f4b65e";
      ctx.beginPath(); ctx.moveTo(bomb.x + 2, bomb.y - 4); ctx.lineTo(bomb.x + 6, bomb.y - 9); ctx.stroke();
    }
  }

  drawNpc(game) {
    const ctx = this.context;
    if (game.floorIndex === 0 && game.room()?.type === "start" && this.sprites.has("redHood")) {
      this.sprites.draw(ctx, "redHood", { x: 280, y: 145, time: game.time, moving: false });
      ctx.fillStyle = "#d4bc8b";
      ctx.font = '8px "Archive Pixel", monospace';
      ctx.textAlign = "center";
      ctx.fillText("КРАСНАЯ ШАПОЧКА", 280, 165);
      return;
    }
    if (game.room()?.type === "workshop") {
      this.sprites.draw(ctx, "workshopMonk", { x: 240, y: 140, time: game.time, moving: false });
      ctx.fillStyle = "#4c3834";
      ctx.fillRect(218, 139, 44, 9);
      ctx.fillStyle = "#9a7656";
      ctx.fillRect(218, 139, 44, 2);
      ctx.fillStyle = "#d4bc8b";
      ctx.font = '8px "Archive Pixel", monospace';
      ctx.textAlign = "center";
      ctx.fillText("ХРАНИТЕЛЬ", 240, 158);
      return;
    }
    if (game.room()?.type !== "shop") return;
    this.sprites.draw(ctx, "npc", { x: 240, y: 140, time: game.time, moving: false, scale: 1 });
    ctx.fillStyle = "#4c3834";
    ctx.fillRect(218, 139, 44, 9);
    ctx.fillStyle = "#9a7656";
    ctx.fillRect(218, 139, 44, 2);
    ctx.fillStyle = "#d4bc8b";
    ctx.font = '8px "Archive Pixel", monospace';
    ctx.textAlign = "center";
    ctx.fillText("ХРАНИТЕЛЬ", 240, 158);
  }

  drawPackLinks(game) {
    const ctx = this.context;
    for (const enemy of game.enemies) {
      if (enemy.protectTarget) {
        const target = game.enemies.find((other) => other.id === enemy.protectTarget && !other.dead);
        if (target) {
          ctx.strokeStyle = "#b99ae288";
          ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(enemy.x, enemy.y); ctx.lineTo(target.x, target.y); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      if (enemy.webTimer > 0) {
        const target = game.enemies.filter((other) => !other.dead && other.id !== enemy.id).sort((a, b) => Math.hypot(enemy.x - a.x, enemy.y - a.y) - Math.hypot(enemy.x - b.x, enemy.y - b.y))[0];
        if (target) {
          ctx.strokeStyle = "#d0c8b877";
          ctx.beginPath(); ctx.moveTo(enemy.x, enemy.y); ctx.lineTo(target.x, target.y); ctx.stroke();
        }
      }
    }
  }

  drawEvent(game) {
    const room = game.room();
    if (!room) return;
    const ctx = this.context;
    if (room.event === "chapterClue" && !room.loreFound) {
      ctx.strokeStyle = "#c9b47c";
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.arc(240, 120, 14 + Math.sin(game.time * 3) * 2, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      this.drawIcon("paper-clip", 226, 106, 28, "#ead49b");
    }
    if (room.event === "contract" && !room.contractHandled) {
      ctx.strokeStyle = "#d1b66a";
      ctx.beginPath(); ctx.arc(240, 140, 13, 0, TAU); ctx.stroke();
      this.drawIcon("big-gear", 228, 128, 24, "#edc37b");
    }
    if (room.type === "vault" && !room.rewardClaimed) {
      this.drawIcon(room.vaultHandled && room.cleared ? "open-chest" : "locked-chest", 228, 128, 24, "#edc37b");
    }
    if (room.type === "boss" && room.cleared && game.floor.exitAvailable) {
      ctx.strokeStyle = "#d1b66a";
      ctx.beginPath(); ctx.arc(240, 140, 13, 0, TAU); ctx.stroke();
      this.drawIcon("paper-clip", 230, 130, 20, "#edc37b");
    }
    if (room.event === "riftTerminal" || (room.type === "rift" && room.cleared)) {
      ctx.strokeStyle = "#b99ddd";
      ctx.beginPath(); ctx.arc(240, 140, 13, 0, TAU); ctx.stroke();
      this.drawIcon("keyring", 228, 128, 24, "#c6a2e2");
    }
  }

  drawEnemies(game) {
    const ctx = this.context;
    for (const corpse of this.corpses) {
      this.sprites.draw(ctx, corpse.sprite, {
        x: corpse.x, y: corpse.y, time: game.time - corpse.time,
        action: "death", alpha: Math.min(1, 1.2 - (game.time - corpse.time)),
      });
    }
    for (const enemy of game.enemies) {
      if (enemy.dead) continue;
      const spawning = enemy.spawnTime > 0 || game.waveIntro > 0;
      const moving = this.isMoving(enemy, spawning);
      const spriteKey = enemy.type === "dust" && enemy.small ? "dustSmall" : enemy.type === "chemistBoss" && enemy.phase === 2 ? "queen" : ENEMY_TYPES[enemy.type].sprite || enemy.type;
      let scale = ENEMY_TYPES[enemy.type].bossScale || (BIG.has(enemy.type) ? 1.25 : enemy.small ? 0.75 : enemy.type === "moth" ? 1 + enemy.growth * 0.08 : 1);
      if (enemy.variant === 6) scale *= 1.18;
      const bottom = enemy.y + enemy.r + 4;
      if (enemy.elite) {
        ctx.strokeStyle = "#edc37b";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.ellipse(enemy.x, enemy.y + enemy.r + 2, enemy.r + 6, 6, 0, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = "#08090db0";
      ctx.beginPath(); ctx.ellipse(enemy.x, enemy.y + enemy.r + 2, enemy.r * scale, 3, 0, 0, TAU); ctx.fill();
      if (BIG.has(enemy.type) && enemy.phase === 2) {
        ctx.strokeStyle = "#d95868aa";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.r + 6 + Math.sin(game.time * 8) * 2, 0, TAU); ctx.stroke();
      }
      if (enemy.type === "umbrellaBoss" && enemy.shieldTimer > 0) {
        ctx.strokeStyle = "#a7e0e0";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(enemy.x, enemy.y, 28, enemy.aimAngle - 0.95, enemy.aimAngle + 0.95); ctx.stroke();
      }
      if (enemy.type === "skeleton" && enemy.shieldTimer > 0) {
        ctx.strokeStyle = "#c1d9e5";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.r + 5, -Math.PI * 0.85, Math.PI * 0.85); ctx.stroke();
      }
      const top = this.sprites.draw(ctx, spriteKey, {
        x: enemy.x, y: bottom, time: game.time + enemy.id * 0.13, moving,
        flip: game.player.x < enemy.x, scale,
        alpha: enemy.phased ? 0.3 : spawning ? 0.25 + Math.sin(game.time * 18) * 0.12 : enemy.disguise ? 0.55 : 1,
        flash: enemy.flash > 0 && !this.fx.reduced,
        hit: enemy.flash > 0,
        attacking: enemy.attackAnimation > 0,
        actionTime: enemy.attackAnimation > 0 ? Math.max(0, enemy.telegraphDuration + 0.25 - enemy.attackAnimation) : null,
        action: enemy.type === "skeleton" && enemy.shieldTimer > 0 ? "shield" : enemy.type === "boss" && ["fan", "summon"].includes(enemy.attackType) ? "howl" : ["boss", "lost"].includes(enemy.type) && ["charge", "slam"].includes(enemy.attackType) ? "pounce" : enemy.type === "curseCaster" && enemy.attackType === "curseFan" ? "attack2" : enemy.type === "rat" && enemy.contactTimer > 0.55 ? "gesture" : bossAction(enemy),
        filter: enemy.type === "goblin" ? DWARF_FILTERS[enemy.variant ?? 0] : ENEMY_TYPES[enemy.type].filter || null,
      });
      if (enemy.type === "goblin") this.drawIcon(DWARF_TOOLS[enemy.variant ?? 0], enemy.x + enemy.r - 2, top - 7, 7, "#ead49b");
      if (ENEMY_TYPES[enemy.type].boss) {
        const iconName = (enemy.type === "finalBoss" && enemy.telegraph > 0 ? MEMORY_ICONS[enemy.attackType] : null) || ENEMY_TYPES[enemy.type].icon;
        const icon = this.icons[iconName];
        if (icon?.complete && icon.naturalWidth) this.drawIcon(iconName, enemy.x - 4, bottom - 31, 23, "#f3d99a");
      }
      if (enemy.stampTimer > 0) this.drawIcon("echo-ripples", enemy.x - 4, top - 10, 8, "#edc37b");
      if (enemy.poisonTimer > 0) {
        ctx.strokeStyle = "#91c96b";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.r + 3, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (enemy.bleedTimer > 0) {
        ctx.fillStyle = "#e27878";
        ctx.fillRect(enemy.x + enemy.r + 2, top + 4, 2, 5);
        ctx.fillRect(enemy.x + enemy.r + 4, top + 7, 2, 2);
      }
      if (spawning) {
        ctx.strokeStyle = "#e8c38499";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.r + 5 + Math.sin(game.time * 12) * 2, 0, TAU); ctx.stroke();
      }
      if (enemy.slowTimer > 0 || enemy.freezeTimer > 0) {
        ctx.strokeStyle = "#8fd4dc";
        ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.r + 2, 0, TAU); ctx.stroke();
      }
      if (!BIG.has(enemy.type) && !enemy.disguise && enemy.hp < enemy.maxHp) {
        const width = enemy.r * 2;
        ctx.fillStyle = "#15121a";
        ctx.fillRect(enemy.x - width / 2, top - 5, width, 3);
        ctx.fillStyle = "#d36d68";
        ctx.fillRect(enemy.x - width / 2, top - 5, width * Math.max(0, enemy.hp / enemy.maxHp), 3);
      }
    }
  }

  isMoving(entity, idle) {
    const key = entity.id ?? -1;
    const previous = this.motion.get(key);
    this.motion.set(key, { x: entity.x, y: entity.y });
    return Boolean(!idle && previous && Math.hypot(entity.x - previous.x, entity.y - previous.y) > 0.02);
  }

  drawPlayer(game) {
    const p = game.player;
    if (game.state === "dead" || p.invuln > 0 && Math.floor(p.invuln * 20) % 2 === 0) return;
    const ctx = this.context;
    const moving = this.isMoving({ id: -1, x: p.x, y: p.y }, false);
    ctx.fillStyle = "#08090db0";
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 7, 7, 3, 0, 0, TAU); ctx.fill();
    const top = this.sprites.draw(ctx, game.hero.sprite, {
      x: p.x, y: p.y + p.r + 3, time: game.time, moving,
      flip: Math.cos(p.aimAngle) < 0,
      flash: p.invuln > 0.65 && !this.fx.reduced,
      hit: p.invuln > 0.55,
      attacking: p.attackTimer > 0,
      actionTime: p.attackTimer > 0 ? Math.max(0, 0.24 - p.attackTimer) : null,
      aimAngle: p.aimAngle,
    });
    if (game.hasItem("umbrella") && p.umbrellaTimer <= 0) {
      this.drawIcon("lab-coat", p.x - 8, top - 12, 16, "#a4dcd4");
      ctx.strokeStyle = "#a4dcd4"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, TAU); ctx.stroke();
    }
  }

  drawFamiliars(game) {
    const ctx = this.context;
    if (game.hasItem("archivMoth")) {
      this.sprites.draw(ctx, "moth", { x: game.familiar.x, y: game.familiar.y + 6, time: game.time, moving: true, scale: 0.65, alpha: game.familiar.cooldown > 0 ? 0.5 : 1 });
    }
    if (game.hasItem("gear")) {
      ctx.save();
      ctx.translate(game.familiar.gearX || game.player.x + 20, game.familiar.gearY || game.player.y);
      ctx.rotate(game.familiar.angle * 2);
      ctx.fillStyle = "#c6a66b";
      ctx.fillRect(-3, -3, 6, 6);
      ctx.fillStyle = "#463c3b";
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }
  }

  drawProjectiles(game) {
    const ctx = this.context;
    for (const projectile of game.projectiles) {
      if (projectile.dead) continue;
      ctx.save();
      ctx.translate(projectile.x, projectile.y);
      if (projectile.owner === "player") {
        ctx.fillStyle = projectile.source === "shard" ? "#d4edf0" : "#eaf8ed";
        ctx.strokeStyle = "#27444e";
        ctx.lineWidth = 1;
        if (game.hasItem("needle") && projectile.source === "shot") {
          const angle = Math.atan2(projectile.vy, projectile.vx);
          ctx.rotate(angle);
          const length = projectile.r * 2.5;
          ctx.beginPath(); ctx.moveTo(-length, 0); ctx.lineTo(length, 0); ctx.strokeStyle = "#e6fbff"; ctx.lineWidth = Math.max(1, projectile.r * 0.65); ctx.stroke();
        } else {
          ctx.beginPath(); ctx.arc(0, 0, projectile.r, 0, TAU); ctx.fill(); ctx.stroke();
        }
      } else if (projectile.source === "hunterArrow" && this.arrowImage.complete && this.arrowImage.naturalWidth > 0) {
        ctx.rotate(Math.atan2(projectile.vy, projectile.vx) + Math.PI / 2);
        ctx.drawImage(this.arrowImage, -Math.floor(this.arrowImage.width / 2), -Math.floor(this.arrowImage.height / 2));
      } else {
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = projectile.source === "ghostOrb" ? "#e8cc80" : projectile.burning ? "#ff9b58" : projectile.source === "memoryMagnet" ? "#91ddd5" : projectile.source === "memoryChalk" ? "#d7d1ff" : projectile.puddle ? "#b57ac8" : "#f17878";
        ctx.strokeStyle = "#2b1420";
        ctx.lineWidth = 2;
        ctx.fillRect(-projectile.r, -projectile.r, projectile.r * 2, projectile.r * 2);
        ctx.strokeRect(-projectile.r, -projectile.r, projectile.r * 2, projectile.r * 2);
      }
      ctx.restore();
    }
  }

  drawArcs(game) {
    const ctx = this.context;
    ctx.strokeStyle = "#8ee9e2";
    ctx.lineWidth = 1;
    for (const arc of game.arcs) {
      if (arc.kind === "ring") {
        ctx.globalAlpha = Math.min(1, arc.life * 10);
        ctx.beginPath(); ctx.arc(arc.x1, arc.y1, arc.x2 * (1 - arc.life / 0.2), 0, TAU); ctx.stroke();
        continue;
      }
      const dx = arc.x2 - arc.x1;
      const dy = arc.y2 - arc.y1;
      const d = Math.hypot(dx, dy) || 1;
      const nx = -dy / d;
      const ny = dx / d;
      const steps = this.fx.reduced ? 2 : 6;
      ctx.globalAlpha = Math.min(1, arc.life * 10) * (this.fx.reduced ? 0.55 : 1);
      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const offset = this.fx.reduced || i === 0 || i === steps ? 0 : Math.sin(game.time * 90 + i * 4 + arc.x1) * 2;
        const x = arc.x1 + dx * t + nx * offset;
        const y = arc.y1 + dy * t + ny * offset;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawLasers(game) {
    const ctx = this.context;
    for (const laser of game.lasers) {
      const alpha = Math.min(1, laser.life * 7);
      ctx.strokeStyle = laser.owner === "player" ? `rgba(157,241,239,${alpha})` : `rgba(255,120,112,${alpha})`;
      ctx.lineWidth = laser.width || 3;
      ctx.beginPath(); ctx.moveTo(laser.x1, laser.y1); ctx.lineTo(laser.x2, laser.y2); ctx.stroke();
    }
  }

  drawIcon(name, x, y, size, color) {
    const image = this.icons[name];
    if (!image?.complete || !image.naturalWidth) return;
    const ctx = this.context;
    ctx.save();
    if (color && image.src.endsWith(".svg")) ctx.filter = "invert(90%) sepia(20%) saturate(400%)";
    ctx.drawImage(image, x, y, size, size);
    ctx.restore();
  }

  drawIntro(game) {
    if (game.waveIntro <= 0 || (game.state !== "wave" && game.state !== "boss")) return;
    const ctx = this.context;
    ctx.save();
    ctx.globalAlpha = Math.min(1, game.waveIntro * 1.5);
    ctx.fillStyle = "#0c0e14cc";
    ctx.fillRect(115, 111, 250, 45);
    ctx.strokeStyle = "#815a52";
    ctx.strokeRect(115, 111, 250, 45);
    ctx.fillStyle = "#f0d49b";
    ctx.textAlign = "center";
    const bossName = ENEMY_TYPES[game.room()?.type === "rift" ? "riftWarden" : game.floor?.bossType]?.name.toUpperCase() || "БОСС";
    ctx.font = `${bossName.length > 14 ? 12 : 16}px "Archive Pixel", monospace`;
    ctx.fillText(game.state === "boss" ? bossName : "БОЙ", 240, 130);
    ctx.font = '8px "Archive Pixel", monospace';
    ctx.fillStyle = "#c2b3a2";
    ctx.fillText(game.state === "boss" ? "Приготовьтесь к чтению атак" : "Двери откроются после победы", 240, 145);
    ctx.restore();
  }
}
