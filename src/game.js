import { ARENA, BOSS_ATTACKS, ENEMY_TYPES, FLOOR_COUNT, FLOOR_ENCOUNTERS, ITEMS, ITEM_BY_ID, SYNERGIES } from "./content.js";
import { generateFloor } from "./floor.js";
import { getRoomLayout } from "./layouts.js";
import { getHero } from "./heroes.js";
import { createEnvironment } from "./environment.js";
import { getFinalMemoryAttacks, updateFinalBoss, updateSorterBoss, updateChemistBoss, updateCalibratorBoss, updateRiftWarden } from "./bosses.js";
import { firePlayerLaser, getProjectileRadius, getVolleyAngles, getWeaponStats } from "./weapon.js";
import { createRiftRoom, getChainHint, riftDestinations } from "./secrets.js";

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angleDifference = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const circleRect = (x, y, radius, rect) => {
  const nx = clamp(x, rect.x, rect.x + rect.w);
  const ny = clamp(y, rect.y, rect.y + rect.h);
  return (x - nx) ** 2 + (y - ny) ** 2 < radius ** 2;
};
const segmentDistance = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const DIRECTIONS = {
  N: { x: 0, y: -1, opposite: "S" },
  S: { x: 0, y: 1, opposite: "N" },
  E: { x: 1, y: 0, opposite: "W" },
  W: { x: -1, y: 0, opposite: "E" },
};

export function mulberry32(seed) {
  return function random() {
    let t = seed += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Game {
  constructor(onEvent) {
    this.onEvent = onEvent;
    this.reset(1);
  }

  reset(seed) {
    this.seed = seed >>> 0;
    this.nextId = 1;
    this.rngCalls = 0;
    const next = mulberry32(this.seed);
    this.random = () => {
      this.rngCalls++;
      return next();
    };
    this.state = "title";
    this.mode = "run";
    this.heroId = "keeper";
    this.hero = getHero(this.heroId);
    this.time = 0;
    this.kills = 0;
    this.floorIndex = 0;
    this.floor = null;
    this.rooms = [];
    this.obstacles = [];
    this.currentRoomId = "";
    this.items = [];
    this.questItems = [];
    this.choices = [];
    this.afterChoice = "room";
    this.choiceReadyAt = 0;
    this.enemies = [];
    this.environment = null;
    this.projectiles = [];
    this.bombs = [];
    this.puddles = [];
    this.pickups = [];
    this.arcs = [];
    this.lasers = [];
    this.echoQueue = [];
    this.grazed = new Set();
    this.arcTimer = 0;
    this.waveIntro = 0;
    this.doorLock = 0;
    this.roomClears = 0;
    this.shotCounter = 0;
    this.hitCounter = 0;
    this.webCounter = 0;
    this.coatUsed = false;
    this.repeatReward = null;
    this.chain = { sigil: false, npc: false, terminal: false, wardenDefeated: false };
    this.riftUsedFloor = false;
    this.memory = { umbrellaAwakened: false, mothAwakened: false, thermosAwakened: false, mirrorAwakened: false };
    this.memoryProgress = { umbrella: 0, moth: 0, thermos: 0, mirror: 0 };
    this.familiar = { x: 240, y: 220, cooldown: 0, gearCooldown: 0, gearHitTimer: 0, angle: 0 };
    this.lastDamage = "Архив";
    this.player = {
      x: 240, y: 220, knockX: 0, knockY: 0, slideX: 0, slideY: 0,
      r: 6, hp: 6, maxHp: 6, speed: 80, coins: 0, keys: 0,
      fireTimer: 0, attackTimer: 0, invuln: 0, bombs: 2, bombCooldown: 0,
      umbrellaTimer: 0, slowTimer: 0, aimAngle: -Math.PI / 2,
      springTime: 0, mirrorTimer: 0, noDamageRoom: true,
    };
  }

  emit(type, data = {}) {
    this.onEvent?.({ type, ...data });
  }

  room() {
    return this.rooms.find((room) => room.id === this.currentRoomId);
  }

  start(seed = this.seed, { bossOnly = false, floorIndex = 0, heroId = "keeper" } = {}) {
    this.reset(seed);
    this.mode = bossOnly ? "boss" : "run";
    this.heroId = getHero(heroId).id;
    this.hero = getHero(this.heroId);
    this.player.hp = this.hero.hp;
    this.player.maxHp = this.hero.hp;
    if (this.hero.itemId) this.addItem(this.hero.itemId);
    this.floorIndex = floorIndex;
    this.floor = generateFloor(this.seed, this.floorIndex);
    this.floorIndex = this.floor.index;
    this.rooms = clone(this.floor.rooms);
    this.floor.rooms = this.rooms;
    this.startRoom(bossOnly ? this.floor.bossId : this.floor.startId);
  }

  nextFloor() {
    if (this.state !== "floorComplete") return false;
    if (this.floorIndex >= FLOOR_COUNT - 1) {
      this.state = "victory";
      this.emit("victory", this.stats());
      return true;
    }
    this.floorIndex++;
    this.coatUsed = false;
    this.riftUsedFloor = false;
    this.floor = generateFloor(this.seed, this.floorIndex);
    this.floorIndex = this.floor.index;
    this.rooms = clone(this.floor.rooms);
    this.floor.rooms = this.rooms;
    this.emit("floor", { floorIndex: this.floorIndex, name: this.floor.name });
    this.startRoom(this.floor.startId);
    return true;
  }

  startRoom(id, { entry = null, restoreSnapshot = null } = {}) {
    this.currentRoomId = id;
    const room = this.room();
    room.visited = true;
    this.floor.riftId = this.rooms.find((entry) => entry.type === "rift")?.id || null;
    const layout = getRoomLayout(room);
    this.obstacles = layout.obstacles.map((obstacle) => room.event === "movingShelves" ? { ...obstacle } : obstacle);
    room.layoutName = layout.name;
    this.encounterRandom = mulberry32(room.encounterSeed);
    this.enemies = [];
    this.environment = createEnvironment(this, room);
    this.projectiles = [];
    this.bombs = [];
    this.puddles = [];
    this.pickups = [];
    this.arcs = [];
    this.lasers = [];
    this.echoQueue = [];
    this.grazed = new Set();
    this.doorLock = 0.45;
    this.waveIntro = room.cleared ? 0 : ["boss", "rift"].includes(room.type) ? 1.1 : 0.75;
    this.memoryProgress = { ...this.memoryProgress, umbrella: 0, moth: 0, mirror: 0 };
    this.familiar.x = this.player.x;
    this.familiar.y = this.player.y;
    this.player.knockX = 0;
    this.player.knockY = 0;
    this.player.slideX = 0;
    this.player.slideY = 0;
    this.player.springTime = 0;
    this.player.noDamageRoom = true;
    this.player.x = 240;
    this.player.y = 220;
    if (entry === "N") Object.assign(this.player, { x: 240, y: ARENA.bottom - this.player.r - 5 });
    if (entry === "S") Object.assign(this.player, { x: 240, y: ARENA.top + this.player.r + 5 });
    if (entry === "E") Object.assign(this.player, { x: ARENA.left + this.player.r + 5, y: 140 });
    if (entry === "W") Object.assign(this.player, { x: ARENA.right - this.player.r - 5, y: 140 });

    if (!room.cleared) this.spawnEncounter(room);
    this.state = ["boss", "rift"].includes(room.type) && !room.cleared ? "boss" : room.cleared ? "room" : "wave";
    if (room.type === "secret" && !room.loreFound) this.spawnPickup("lore", 240, 132);
    this.emit("room", { room, floor: this.floor, entry });

    const restoredState = restoreSnapshot?.state;
    if (restoredState === "choice") {
      this.afterChoice = restoreSnapshot.afterChoice;
      this.choices = restoreSnapshot.choices.map((itemId) => ITEM_BY_ID.get(itemId));
      this.state = "choice";
      this.choiceReadyAt = Date.now() + 500;
      this.emit("choice", { choices: this.choices });
    } else if (room.type === "treasure" && !room.rewardClaimed) {
      this.openItemChoice("room");
    } else if (restoredState === "shop") {
      this.openShop();
    } else if (restoredState === "contract") {
      this.openContract();
    } else if (restoredState === "riftMenu") {
      this.openRiftMenu();
    } else if (restoredState === "floorComplete") {
      this.state = "floorComplete";
      this.emit("floorComplete", this.stats());
    } else if (restoredState === "victory") {
      this.state = "victory";
      this.emit("victory", this.stats());
    }
    if (restoreSnapshot?.pickups) this.pickups = clone(restoreSnapshot.pickups);
    this.checkpoint();
  }

  hasItem(id) {
    return this.items.includes(id);
  }

  activeSynergies() {
    return SYNERGIES.filter((synergy) => synergy.ids.every((id) => this.hasItem(id)));
  }

  makeChoices() {
    const available = ITEMS.filter((item) => item.pool !== false && !this.hasItem(item.id));
    const pool = [...available];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const result = [];
    const partner = available.find((item) => item.partner && this.hasItem(item.partner));
    if (partner) result.push(partner);
    for (const item of pool) {
      if (result.length >= 3) break;
      if (!result.includes(item)) result.push(item);
    }
    return result;
  }

  openItemChoice(afterChoice) {
    this.afterChoice = afterChoice;
    this.choices = this.room().type === "rift" ? [ITEM_BY_ID.get("riftPass")] : this.makeChoices();
    this.choiceReadyAt = Date.now() + 3000;
    this.state = "choice";
    this.projectiles = this.projectiles.filter((projectile) => projectile.owner === "player");
    this.emit("choice", { choices: this.choices });
    this.checkpoint();
  }

  addItem(id) {
    if (!ITEM_BY_ID.has(id) || this.hasItem(id)) return false;
    const before = new Set(this.activeSynergies().map((synergy) => synergy.name));
    this.items.push(id);
    this.emit("pickup", { item: ITEM_BY_ID.get(id), x: this.player.x, y: this.player.y });
    for (const synergy of this.activeSynergies()) {
      if (!before.has(synergy.name)) this.emit("synergy", { name: synergy.name });
    }
    return true;
  }

  chooseItem(id) {
    if (this.state !== "choice" || Date.now() < this.choiceReadyAt || !this.choices.some((item) => item.id === id)) return false;
    if (!this.addItem(id)) return false;
    this.choices = [];
    this.room().rewardClaimed = true;
    if (this.afterChoice === "floorComplete") {
      this.state = "floorComplete";
      this.emit("floorComplete", this.stats());
    } else if (this.afterChoice === "victory") {
      this.state = "victory";
      this.emit("victory", this.stats());
    } else {
      this.state = "room";
      this.emit("roomResumed", { room: this.room() });
    }
    this.checkpoint();
    return true;
  }

  openShop() {
    const room = this.room();
    if (!room.stock) {
      const offers = this.makeChoices().slice(0, 2).map((item) => ({ id: `item-${item.id}`, type: "item", itemId: item.id, price: 5 + this.floorIndex * 2, sold: false }));
      if (this.floorIndex === 0 && !this.questItems.includes("brokenToy")) offers.push({ id: "broken-toy", type: "toy", price: 3, sold: false });
      room.stock = offers;
    }
    this.state = "shop";
    this.emit("shop", { stock: room.stock, repairAvailable: this.canRepairToy() });
    this.checkpoint();
  }

  closeShop() {
    if (this.state !== "shop") return;
    this.state = "room";
    this.emit("roomResumed", { room: this.room() });
    this.checkpoint();
  }

  buyItem(offerId) {
    if (this.state !== "shop") return false;
    const offer = this.room().stock?.find((entry) => entry.id === offerId && !entry.sold);
    if (!offer || this.player.coins < offer.price) return false;
    if (offer.type === "item" && this.hasItem(offer.itemId)) return false;
    this.player.coins -= offer.price;
    offer.sold = true;
    if (offer.type === "item") this.addItem(offer.itemId);
    else {
      this.questItems.push("brokenToy");
      this.emit("quest", { id: "brokenToy" });
    }
    this.emit("shopUpdate", { stock: this.room().stock, repairAvailable: this.canRepairToy() });
    this.checkpoint();
    return true;
  }

  canRepairToy() {
    return this.floorIndex === 1 && this.questItems.includes("brokenToy") && !this.hasItem("archivMoth");
  }

  repairToy() {
    if (this.state !== "shop" || !this.canRepairToy()) return false;
    this.questItems = this.questItems.filter((id) => id !== "brokenToy");
    this.addItem("archivMoth");
    this.emit("secret", { id: "toyRepair", name: "Не продавать" });
    this.emit("shopUpdate", { stock: this.room().stock, repairAvailable: false });
    this.checkpoint();
    return true;
  }

  interact() {
    if (this.state !== "room") return false;
    const room = this.room();
    const near = (x, y, radius) => Math.hypot(this.player.x - x, this.player.y - y) <= radius;
    if (room.type === "rift" && room.cleared && near(240, 140, 44)) {
      this.startRoom(room.returnTo);
      this.emit("riftReturn", { room: this.room() });
      return true;
    }
    if (room.event === "sigil" && !this.chain.sigil && near(240, 120, 42)) {
      this.chain.sigil = true;
      this.emit("chain", { step: "sigil" });
      this.checkpoint();
      return true;
    }
    if (room.event === "riftTerminal" && near(240, 140, 42)) {
      if (this.chain.wardenDefeated) {
        this.emit("locked", { message: "Разрез уже стабилен" });
        return false;
      }
      if (this.chain.terminal) {
        this.emit("locked", { message: "Проход уже открыт" });
        return false;
      }
      if (!this.chain.sigil || !this.chain.npc) {
        this.emit("locked", { message: getChainHint(this.chain) });
        return false;
      }
      return this.openRift();
    }
    if (room.event === "contract" && !room.contractHandled && near(240, 140, 42)) {
      this.openContract();
      return true;
    }
    if (room.type !== "shop" || !near(240, 132, 52)) return false;
    if (this.chain.sigil && !this.chain.npc) {
      this.chain.npc = true;
      this.emit("chain", { step: "npc" });
    }
    this.openShop();
    return true;
  }

  openContract() {
    const room = this.room();
    if (this.state !== "room" || room.event !== "contract" || room.contractHandled || !room.cleared) return false;
    this.state = "contract";
    this.emit("contract", { room });
    this.checkpoint();
    return true;
  }

  chooseContract(kind) {
    if (this.state !== "contract") return false;
    const room = this.room();
    if (room.contractHandled) return false;
    if (kind === "hp") {
      if (this.player.maxHp <= 3) return false;
      this.player.maxHp--;
      this.player.hp = Math.min(this.player.hp, this.player.maxHp);
      room.contractHandled = true;
      this.openItemChoice("room");
      return true;
    }
    if (kind !== "elite") return false;
    const target = this.contractTarget();
    if (!target) {
      this.emit("locked", { message: "Не осталось незачищенных боевых комнат" });
      return false;
    }
    target.eliteContract = true;
    room.contractHandled = true;
    this.state = "room";
    this.emit("contractAccepted", { kind: "elite", room: target });
    this.checkpoint();
    return true;
  }

  contractTarget() {
    const combatRooms = this.rooms.filter((entry) => entry.type === "combat");
    const index = combatRooms.findIndex((entry) => entry.id === this.currentRoomId);
    if (index < 0) return null;
    return [...combatRooms.slice(index + 1), ...combatRooms.slice(0, index)].find((entry) => !entry.cleared) || null;
  }

  closeContract() {
    if (this.state !== "contract") return;
    this.state = "room";
    this.emit("roomResumed", { room: this.room() });
    this.checkpoint();
  }

  openRift() {
    const source = this.room();
    if (this.state !== "room" || source?.event !== "riftTerminal" || !source.cleared || !this.chain.sigil || !this.chain.npc || this.chain.terminal || this.chain.wardenDefeated) return false;
    const room = createRiftRoom(this, source);
    if (!room) return false;
    this.chain.terminal = true;
    this.emit("chain", { step: "terminal" });
    this.startRoom(room.id);
    return true;
  }

  openRiftMenu() {
    if (!this.hasItem("riftPass")) {
      this.emit("locked", { message: "Сначала найдите Сервисный пропуск" });
      return false;
    }
    if (this.riftUsedFloor) {
      this.emit("locked", { message: "Пропуск уже использован в этом отделе" });
      return false;
    }
    if (this.state !== "room") return false;
    const rooms = riftDestinations(this);
    if (!rooms.length) {
      this.emit("locked", { message: "Нужна ещё одна зачищенная комната" });
      return false;
    }
    this.state = "riftMenu";
    this.emit("riftMenu", { rooms });
    this.checkpoint();
    return true;
  }

  useRift(id) {
    if (this.state !== "riftMenu" || this.riftUsedFloor || !this.hasItem("riftPass")) return false;
    const target = this.rooms.find((room) => room.id === id && room.visited && room.cleared && room.id !== this.currentRoomId);
    if (!target) return false;
    this.riftUsedFloor = true;
    this.startRoom(id, { entry: "service" });
    this.emit("riftTravel", { room: target });
    return true;
  }

  closeRiftMenu() {
    if (this.state !== "riftMenu") return;
    this.state = "room";
    this.emit("roomResumed", { room: this.room() });
    this.checkpoint();
  }

  interactionHint() {
    if (this.state !== "room") return null;
    const room = this.room();
    const near = (x, y, radius) => Math.hypot(this.player.x - x, this.player.y - y) <= radius;
    if (room.type === "rift" && room.cleared && near(240, 140, 44)) return "вернуться";
    if (room.event === "sigil" && !this.chain.sigil && near(240, 120, 42)) return "взять отпечаток трещины";
    if (room.event === "contract" && !room.contractHandled && near(240, 140, 42)) return "калибровка";
    if (room.event === "riftTerminal" && near(240, 140, 42)) return "сервисный терминал";
    if (room.type === "shop" && near(240, 132, 52)) return "поговорить с Оценщиком";
    return null;
  }

  tryDoor(direction) {
    const room = this.room();
    const targetId = room.doors[direction];
    if (!targetId) return false;
    const target = this.rooms.find((entry) => entry.id === targetId);
    if ((room.hidden.includes(direction) && !room.secretFound) || (target.type === "secret" && !target.secretFound)) return false;
    if (target.type === "treasure" && this.floorIndex >= 1 && !target.unlocked && !target.rewardClaimed) {
      if (this.player.keys <= 0) {
        this.emit("locked", { message: "Для сокровищницы нужен ключ" });
        return false;
      }
      this.player.keys--;
      target.unlocked = true;
      this.emit("unlocked", { room: target });
    }
    this.startRoom(targetId, { entry: direction });
    return true;
  }

  checkDoors(input) {
    if (this.state !== "room" || this.doorLock > 0) return;
    const p = this.player;
    if (input.moveY < -0.3 && p.y <= ARENA.top + p.r + 2 && Math.abs(p.x - 240) < 35) this.tryDoor("N");
    else if (input.moveY > 0.3 && p.y >= ARENA.bottom - p.r - 2 && Math.abs(p.x - 240) < 35) this.tryDoor("S");
    else if (input.moveX > 0.3 && p.x >= ARENA.right - p.r - 2 && Math.abs(p.y - 140) < 38) this.tryDoor("E");
    else if (input.moveX < -0.3 && p.x <= ARENA.left + p.r + 2 && Math.abs(p.y - 140) < 38) this.tryDoor("W");
  }

  checkpoint() {
    if (this.restoring || this.state === "victory" || this.state === "dead") return;
    this.emit("checkpoint", { snapshot: this.serialize() });
  }

  serialize() {
    return {
      seed: this.seed,
      heroId: this.heroId,
      mode: this.mode,
      floorIndex: this.floorIndex,
      currentRoomId: this.currentRoomId,
      state: this.state,
      afterChoice: this.afterChoice,
      choices: this.choices.map((item) => item.id),
      rooms: this.rooms,
      player: this.player,
      items: this.items,
      chain: this.chain,
      riftUsedFloor: this.riftUsedFloor,
      questItems: this.questItems,
      memory: this.memory,
      memoryProgress: this.memoryProgress,
      coatUsed: this.coatUsed,
      repeatReward: this.repeatReward,
      roomClears: this.roomClears,
      shotCounter: this.shotCounter,
      hitCounter: this.hitCounter,
      webCounter: this.webCounter,
      pickups: this.pickups,
      time: this.time,
      kills: this.kills,
      rngCalls: this.rngCalls,
      nextId: this.nextId,
    };
  }

  restore(data) {
    this.reset(data.seed);
    this.restoring = true;
    this.heroId = getHero(data.heroId).id;
    this.hero = getHero(this.heroId);
    this.mode = data.mode || "run";
    this.chain = { sigil: false, npc: false, terminal: false, wardenDefeated: false, ...(data.chain || {}) };
    this.riftUsedFloor = Boolean(data.riftUsedFloor);
    this.floorIndex = data.floorIndex;
    this.floor = generateFloor(this.seed, this.floorIndex);
    this.floorIndex = this.floor.index;
    this.rooms = clone(data.rooms);
    this.floor.rooms = this.rooms;
    Object.assign(this.player, data.player);
    this.items = [...data.items];
    this.questItems = [...data.questItems];
    this.memory = { ...data.memory };
    this.coatUsed = data.coatUsed;
    this.repeatReward = data.repeatReward || null;
    this.memoryProgress = { ...data.memoryProgress };
    this.roomClears = data.roomClears;
    this.shotCounter = data.shotCounter;
    this.hitCounter = data.hitCounter;
    this.webCounter = data.webCounter;
    this.kills = data.kills;
    for (let i = 0; i < data.rngCalls; i++) this.random();
    this.startRoom(data.currentRoomId, { restoreSnapshot: data });
    this.nextId = data.nextId;
    this.time = data.time;
    this.restoring = false;
    this.checkpoint();
    this.emit("restore", { floor: this.floor, room: this.room() });
  }

  spawnEncounter(room) {
    if (room.type === "rift") {
      this.spawnEnemy("riftWarden", 0.5, 0.16);
      return;
    }
    if (room.type === "boss") {
      this.spawnEnemy(this.floor.bossType, 0.5, 0.16);
      return;
    }
    const points = this.floorIndex < 2
      ? [[0.2, 0.24], [0.8, 0.24], [0.5, 0.2], [0.2, 0.62], [0.8, 0.62], [0.36, 0.42], [0.64, 0.42], [0.5, 0.62]]
      : [0.18, 0.37, 0.56, 0.75].flatMap((y) => [0.16, 0.38, 0.62, 0.84].map((x) => [x, y]));
    for (let i = points.length - 1; i > 0; i--) {
      const j = Math.floor(this.encounterRandom() * (i + 1));
      [points[i], points[j]] = [points[j], points[i]];
    }
    const combatRooms = this.rooms.filter((entry) => entry.type === "combat");
    const encounterIndex = combatRooms.findIndex((entry) => entry.id === room.id);
    const encounter = FLOOR_ENCOUNTERS[this.floorIndex] || FLOOR_ENCOUNTERS[0];
    const required = room.type === "challenge" ? encounter.challenge : encounter.normal[encounterIndex % encounter.normal.length];
    const count = room.type === "challenge" ? 8 + this.floorIndex * 2 : Math.min(12, 6 + this.floorIndex + encounterIndex);
    const types = Array.from({ length: count }, (_, index) => required[index % required.length]);
    types.forEach((type, index) => {
      const [x, y] = points[index % points.length];
      this.spawnEnemy(type, x, y);
    });
    if (room.eliteContract) {
      this.spawnEnemy(required[0], 0.35, 0.32, { elite: true });
      this.spawnEnemy(required[0], 0.65, 0.32, { elite: true });
    }
  }

  spawnEnemy(type, nx, ny, extra = {}) {
    const width = ARENA.right - ARENA.left;
    const height = ARENA.bottom - ARENA.top;
    let x = ARENA.left + nx * width;
    let y = ARENA.top + ny * height;
    const radius = extra.small ? 5 : ENEMY_TYPES[type].radius;
    if (Math.hypot(x - this.player.x, y - this.player.y) < 68) {
      for (let i = 0; i < 12; i++) {
        const tx = ARENA.left + 25 + this.encounterRandom() * (width - 50);
        const ty = ARENA.top + 25 + this.encounterRandom() * (height - 70);
        if (this.canSpawnAt(tx, ty, radius, extra.allowClose)) {
          x = tx;
          y = ty;
          break;
        }
      }
    }
    return this.createEnemy(type, x, y, extra);
  }

  spawnBlocked(x, y, radius) {
    if (x - radius < ARENA.left || x + radius > ARENA.right || y - radius < ARENA.top || y + radius > ARENA.bottom) return true;
    return this.obstacles.some((obstacle) => circleRect(x, y, radius, obstacle));
  }

  canSpawnAt(x, y, radius, allowClose = false) {
    if (this.spawnBlocked(x, y, radius)) return false;
    if (!allowClose && Math.hypot(x - this.player.x, y - this.player.y) < 68) return false;
    return this.enemies.every((enemy) => enemy.dead || Math.hypot(x - enemy.x, y - enemy.y) >= radius + enemy.r + 3);
  }

  safeSpawnPosition(x, y, radius, allowClose = false) {
    if (this.canSpawnAt(x, y, radius, allowClose)) return { x, y };
    for (let ring = 12; ring <= 64; ring += 13) {
      for (let i = 0; i < 16; i++) {
        const angle = i / 16 * TAU + this.encounterRandom() * 0.1;
        const tx = x + Math.cos(angle) * ring;
        const ty = y + Math.sin(angle) * ring;
        if (this.canSpawnAt(tx, ty, radius, allowClose)) return { x: tx, y: ty };
      }
    }
    for (let ty = ARENA.top + 16; ty <= ARENA.bottom - 16; ty += 18) {
      for (let tx = ARENA.left + 16; tx <= ARENA.right - 16; tx += 18) {
        if (this.canSpawnAt(tx, ty, radius, allowClose)) return { x: tx, y: ty };
      }
    }
    return null;
  }

  createEnemy(type, x, y, extra = {}) {
    const { allowClose = false, ...enemyExtra } = extra;
    const base = ENEMY_TYPES[type];
    const boss = Boolean(base.boss);
    const radius = enemyExtra.small ? 5 : base.radius;
    const position = this.safeSpawnPosition(x, y, radius, allowClose);
    if (!position) throw new Error(`No safe spawn position for ${type}`);
    x = position.x;
    y = position.y;
    const enemy = {
      id: this.nextId++, type, name: base.name, x, y, vx: 0, vy: 0,
      r: radius, hp: base.hp, maxHp: base.hp, speed: base.speed, color: base.color,
      flying: Boolean(base.flying), attackAnimation: 0,
      attackTimer: 0.8 + this.encounterRandom() * 0.8, telegraph: 0, attackType: "", aimAngle: 0,
      spawnTime: boss ? 1.1 : 0.65, flash: 0, slowTimer: 0, freezeTimer: 0,
      contactTimer: 0, charging: 0, eatTimer: 0, growth: 0,
      phase: 1, attackIndex: 0, dead: false, small: false,
      burn: 0, burnTick: 0, burnDepth: 0, cold: 0, webTimer: 0,
      poisonTimer: 0, poisonTick: 0.5, bleedTimer: 0, bleedTick: 0.5,
      shieldedBy: null, protectTarget: null, disguise: type === "mimic",
      coins: 0, summonCount: 0, shieldTimer: 0, phase2Summoned: false,
      memoryAttacks: type === "finalBoss" ? getFinalMemoryAttacks(this) : [],
      ...enemyExtra,
    };
    if (this.hasItem("alarm")) enemy.attackTimer += boss ? 0.25 : 0.7;
    if (enemy.small) {
      enemy.r = 5;
      enemy.hp = 4;
      enemy.maxHp = 4;
      enemy.speed = 38;
      enemy.spawnTime = 0.25;
    }
    if (enemy.elite) {
      enemy.hp = Math.round(enemy.hp * 1.35);
      enemy.maxHp = enemy.hp;
      enemy.speed *= 1.1;
    }
    this.enemies.push(enemy);
    this.emit("spawn", { enemy });
    return enemy;
  }

  update(dt, input) {
    if (!["room", "wave", "boss"].includes(this.state)) return;
    this.time += dt;
    this.waveIntro = Math.max(0, this.waveIntro - dt);
    this.doorLock = Math.max(0, this.doorLock - dt);
    this.updatePlayer(dt, input);
    this.updateBombs(dt);
    this.updateEnemies(dt);
    this.environment?.update(dt);
    this.updateProjectiles(dt);
    this.updatePuddles(dt);
    this.updateThread(dt);
    this.updateFamiliars(dt);
    this.updateEcho(dt);
    this.updatePickups();
    for (const arc of this.arcs) arc.life -= dt;
    for (const laser of this.lasers) laser.life -= dt;
    this.arcs = this.arcs.filter((arc) => arc.life > 0);
    this.lasers = this.lasers.filter((laser) => laser.life > 0);
    this.enemies = this.enemies.filter((enemy) => !enemy.dead);
    this.projectiles = this.projectiles.filter((projectile) => !projectile.dead);
    this.bombs = this.bombs.filter((bomb) => !bomb.dead);
    this.pickups = this.pickups.filter((pickup) => !pickup.dead);

    const room = this.room();
    if ((this.state === "wave" || this.state === "boss") && this.waveIntro <= 0 && !room.cleared && !this.enemies.some((enemy) => !enemy.dead)) this.completeRoom();
  }

  completeRoom() {
    const room = this.room();
    if (room.clearHandled) return;
    room.cleared = true;
    room.clearHandled = true;
    if (this.hero.passive === "noHitSecret" && this.player.noDamageRoom) {
      for (const direction of room.hidden) {
        const target = this.rooms.find((entry) => entry.id === room.doors[direction]);
        if (target?.type === "secret" && !target.secretFound) {
          room.secretFound = true;
          target.secretFound = true;
          this.emit("secret", { id: "surveyorReveal", name: "Картограф: чистый бой" });
        }
      }
    }
    this.environment?.clear();
    this.projectiles = this.projectiles.filter((projectile) => projectile.owner === "player");
    if (room.type === "rift") {
      this.chain.wardenDefeated = true;
      this.emit("secret", { id: "rift", name: "Сервисный разрез" });
      this.openItemChoice("room");
      return;
    }
    if (room.type === "boss") {
      if (this.mode === "boss") {
        this.state = "victory";
        this.emit("victory", this.stats());
      } else {
        this.openItemChoice(this.floorIndex >= FLOOR_COUNT - 1 ? "victory" : "floorComplete");
      }
      return;
    }
    if (room.type === "challenge") {
      this.openItemChoice("room");
      return;
    }
    if (room.eliteContract) {
      this.openItemChoice("room");
      return;
    }
    this.state = "room";
    this.roomClears++;
    this.grantRoomReward(room);
    this.emit("roomClear", { room });
    this.checkpoint();
  }

  grantRoomReward(room) {
    const types = ["coin", "coin", "key", "bomb", "heart"];
    const type = types[Math.floor(this.random() * types.length)];
    this.spawnPickup(type, 240, 140, { amount: type === "coin" ? 2 : 1 });
    if (this.repeatReward) {
      this.spawnPickup(this.repeatReward, 252, 140, { amount: this.repeatReward === "coin" ? 2 : 1 });
      this.repeatReward = null;
    }
    if (this.hasItem("repeat") && this.roomClears % 4 === 0) this.repeatReward = type;
    room.rewardClaimed = true;
  }

  spawnPickup(type, x, y, extra = {}) {
    const pickup = { id: this.nextId++, type, x, y, r: type === "lore" ? 6 : 4, amount: 1, dead: false, ...extra };
    this.pickups.push(pickup);
    return pickup;
  }

  updatePickups() {
    for (const pickup of this.pickups) {
      if (pickup.dead || distance(pickup, this.player) > pickup.r + this.player.r + 3) continue;
      pickup.dead = true;
      if (pickup.type === "coin") this.player.coins += pickup.amount;
      else if (pickup.type === "key") this.player.keys += pickup.amount;
      else if (pickup.type === "bomb") this.player.bombs = Math.min(5, this.player.bombs + pickup.amount);
      else if (pickup.type === "heart") this.player.hp = Math.min(this.player.maxHp, this.player.hp + pickup.amount);
      else if (pickup.type === "lore") {
        this.room().loreFound = true;
        this.emit("secret", { id: "tag0", name: "Номерок 0" });
      }
      this.emit("resource", { pickup });
      this.checkpoint();
    }
  }

  updatePlayer(dt, input) {
    const p = this.player;
    p.fireTimer = Math.max(0, p.fireTimer - dt);
    p.attackTimer = Math.max(0, p.attackTimer - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.bombCooldown = Math.max(0, p.bombCooldown - dt);
    p.umbrellaTimer = Math.max(0, p.umbrellaTimer - dt);
    p.slowTimer = Math.max(0, p.slowTimer - dt);
    p.mirrorTimer = Math.max(0, p.mirrorTimer - dt);

    let mx = input.moveX;
    let my = input.moveY;
    const m = Math.hypot(mx, my);
    if (m > 1) {
      mx /= m;
      my /= m;
    }
    const itemSpeed = this.moveSpeed();
    const speed = itemSpeed * (p.slowTimer > 0 && !this.hasItem("sole") ? 0.75 : 1);
    if (this.hasItem("boots") && m > 0.05) {
      p.slideX = mx * 19;
      p.slideY = my * 19;
    } else {
      p.slideX *= Math.max(0, 1 - dt * 8);
      p.slideY *= Math.max(0, 1 - dt * 8);
    }
    p.springTime = m < 0.05 ? p.springTime + dt : 0;
    p.knockX *= Math.max(0, 1 - dt * 7);
    p.knockY *= Math.max(0, 1 - dt * 7);
    this.moveBody(p, (mx * speed + p.knockX + p.slideX) * dt, (my * speed + p.knockY + p.slideY) * dt);
    this.checkDoors(input);
    if (input.interactPressed) this.interact();

    const ax = input.aimX - p.x;
    const ay = input.aimY - p.y;
    if (Math.hypot(ax, ay) > 2) p.aimAngle = Math.atan2(ay, ax);
    if (input.fire && p.fireTimer <= 0) {
      this.firePlayer();
      p.fireTimer = getWeaponStats(this).fireInterval;
    }
    if (input.bombPressed && p.bombs > 0 && p.bombCooldown <= 0) {
      p.bombs--;
      p.bombCooldown = 0.4;
      this.bombs.push({ id: this.nextId++, x: p.x, y: p.y, timer: 0.9, dead: false });
      this.emit("bomb", { x: p.x, y: p.y });
    }
  }

  moveSpeed() {
    return this.player.speed * (this.hasItem("boots") ? 1.12 : 1) * (this.hasItem("sole") ? 0.95 : 1);
  }

  firePlayer() {
    const p = this.player;
    p.attackTimer = 0.24;
    this.shotCounter++;
    const laser = this.hasItem("laser");
    const angles = getVolleyAngles(this);
    for (const offset of angles) {
      if (laser) firePlayerLaser(this, p.aimAngle + offset);
      else this.spawnPlayerShot(p.aimAngle + offset, "shot");
    }
    if (this.hasItem("heavy") && this.hasItem("quad") && this.shotCounter % 4 === 0) {
      const angle = angles[Math.floor(angles.length / 2)];
      if (laser) firePlayerLaser(this, p.aimAngle + angle, 2);
      else this.spawnPlayerShot(p.aimAngle + angle, "shot", 2);
    }
    if (this.hasItem("echo") && this.shotCounter % 5 === 0) {
      for (const offset of angles) this.echoQueue.push({ time: 0.4, angle: p.aimAngle + offset, x: p.x, y: p.y, weapon: laser ? "laser" : "shot" });
    }
    if (this.hasItem("ticket") && this.shotCounter % 2 === 0) {
      if (laser) firePlayerLaser(this, p.aimAngle + Math.PI, 0.6);
      else this.spawnPlayerShot(p.aimAngle + Math.PI, "shot", 0.6);
    }
    this.emit("shot", { x: p.x, y: p.y });
  }

  spawnPlayerShot(angle, source, scale = 1, origin = this.player) {
    const p = this.player;
    const spring = this.hasItem("spring") && source === "shot" && p.springTime >= 0.7;
    const stats = getWeaponStats(this, source, scale);
    const speed = (stats.projectileSpeed ?? 185) * (this.hasItem("magnet") && source === "shot" ? 0.9 : 1);
    this.createProjectile({
      owner: "player", source, x: origin.x + Math.cos(angle) * 9, y: origin.y + Math.sin(angle) * 9,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      r: stats.projectileRadius, baseRadius: stats.projectileRadius, damage: stats.damage, baseDamage: stats.damage, life: 2.1,
      pierce: stats.pierce,
      bounces: stats.bounces,
      spring,
    });
    if (spring) p.springTime = 0;
  }

  updateEcho(dt) {
    for (const echo of this.echoQueue) {
      echo.time -= dt;
      if (echo.time <= 0 && !echo.done) {
        echo.done = true;
        if (echo.weapon === "laser") firePlayerLaser(this, echo.angle, 0.5, { x: echo.x, y: echo.y });
        else this.spawnPlayerShot(echo.angle, "echo", 0.5, { x: echo.x, y: echo.y });
      }
    }
    this.echoQueue = this.echoQueue.filter((echo) => !echo.done);
  }

  createProjectile(options) {
    if (this.projectiles.length > 140) this.projectiles.shift();
    const projectile = {
      id: this.nextId++, dead: false, traveled: 0, pierce: 0, bounces: 0,
      hitIds: new Set(), puddle: false, ...options,
    };
    projectile.baseDamage ??= projectile.damage;
    projectile.baseRadius ??= projectile.r;
    this.projectiles.push(projectile);
    return projectile;
  }

  fireEnemy(enemy, angle, speed = 100, options = {}) {
    this.createProjectile({
      owner: "enemy", source: "enemy", x: enemy.x + Math.cos(angle) * (enemy.r + 3),
      y: enemy.y + Math.sin(angle) * (enemy.r + 3), vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed, r: 3, damage: 1, life: 6, ...options,
    });
  }

  updateEnemies(dt) {
    for (const enemy of this.enemies) enemy.shieldedBy = null;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      enemy.flash = Math.max(0, enemy.flash - dt);
      enemy.slowTimer = Math.max(0, enemy.slowTimer - dt);
      const wasFrozen = enemy.freezeTimer > 0;
      enemy.freezeTimer = Math.max(0, enemy.freezeTimer - dt);
      if (wasFrozen && enemy.freezeTimer <= 0 && this.memory.thermosAwakened) this.coldBurst(enemy);
      enemy.webTimer = Math.max(0, enemy.webTimer - dt);
      enemy.contactTimer = Math.max(0, enemy.contactTimer - dt);
      enemy.eatTimer = Math.max(0, enemy.eatTimer - dt);
      enemy.shieldTimer = Math.max(0, enemy.shieldTimer - dt);
      if (enemy.burn > 0) {
        enemy.burn -= dt;
        enemy.burnTick -= dt;
        if (enemy.burnTick <= 0) {
          enemy.burnTick = 0.5;
          this.damageEnemy(enemy, 0.5, { source: "fire" });
        }
      }
      if (enemy.poisonTimer > 0) {
        enemy.poisonTimer = Math.max(0, enemy.poisonTimer - dt);
        enemy.poisonTick -= dt;
        if (enemy.poisonTick <= 0) {
          enemy.poisonTick += 0.5;
          this.damageEnemy(enemy, 0.35, { source: "poison" });
        }
      }
      if (enemy.bleedTimer > 0) {
        enemy.bleedTimer = Math.max(0, enemy.bleedTimer - dt);
        enemy.bleedTick -= dt;
        if (enemy.bleedTick <= 0) {
          enemy.bleedTick += 0.5;
          this.damageEnemy(enemy, 0.75, { source: "bleed" });
        }
      }
      if (enemy.dead || enemy.spawnTime > 0 || this.waveIntro > 0) {
        enemy.spawnTime = Math.max(0, enemy.spawnTime - dt);
        continue;
      }
      if (enemy.freezeTimer > 0) continue;
      if (enemy.type === "boss") this.updateBoss(enemy, dt);
      else if (enemy.type === "umbrellaBoss") this.updateUmbrellaBoss(enemy, dt);
      else if (enemy.type === "sorterBoss") updateSorterBoss(this, enemy, dt);
      else if (enemy.type === "finalBoss") updateFinalBoss(this, enemy, dt);
      else if (enemy.type === "chemistBoss") updateChemistBoss(this, enemy, dt);
      else if (enemy.type === "calibratorBoss") updateCalibratorBoss(this, enemy, dt);
      else if (enemy.type === "riftWarden") updateRiftWarden(this, enemy, dt);
      else this.updateEnemy(enemy, dt);
      if (!enemy.dead && !enemy.disguise && distance(enemy, this.player) < enemy.r + this.player.r && enemy.contactTimer <= 0) {
        this.hurtPlayer(1, enemy.name);
        enemy.contactTimer = 0.8;
      }
    }
  }

  updateEnemy(enemy, dt) {
    enemy.attackAnimation = Math.max(0, enemy.attackAnimation - dt);
    const p = this.player;
    const dx = p.x - enemy.x;
    const dy = p.y - enemy.y;
    const d = Math.hypot(dx, dy) || 1;
    const slow = enemy.slowTimer > 0 || enemy.webTimer > 0 ? 0.7 : enemy.poisonTimer > 0 ? 0.85 : 1;
    if (enemy.type === "mimic" && enemy.disguise) {
      if (d < 55) this.beginTelegraph(enemy, "reveal", 0.6);
      else return;
    }
    if (enemy.charging > 0) {
      enemy.charging -= dt;
      if (this.moveBody(enemy, enemy.vx * dt, enemy.vy * dt)) enemy.charging = 0;
      return;
    }
    if (enemy.telegraph > 0) {
      enemy.telegraph -= dt;
      if (enemy.telegraph <= 0) this.performEnemyAttack(enemy);
      return;
    }
    if (enemy.type === "skeleton" && enemy.shieldTimer > 0) return;

    enemy.attackTimer -= dt;
    let mx = 0;
    let my = 0;
    if (["lost", "dust", "moth", "mushroom", "rat"].includes(enemy.type)) {
      const sway = enemy.type === "moth" ? Math.sin(this.time * 4 + enemy.id) * 0.5 : enemy.type === "rat" ? Math.sin(this.time * 7 + enemy.id) * 0.3 : 0;
      mx = dx / d - dy / d * sway;
      my = dy / d + dx / d * sway;
    } else if (enemy.type === "shooter" || enemy.type === "inker") {
      const direction = d > 135 ? 1 : d < 90 ? -1 : 0;
      mx = dx / d * direction + -dy / d * 0.35 * Math.sin(this.time + enemy.id);
      my = dy / d * direction + dx / d * 0.35 * Math.sin(this.time + enemy.id);
      if (enemy.attackTimer <= 0) this.beginTelegraph(enemy, enemy.type, enemy.type === "shooter" ? 0.6 : 0.75);
    } else if (enemy.type === "hanger") {
      const orbit = enemy.id % 2 ? 1 : -1;
      mx = dx / d * (d > 120 ? 0.7 : -0.15) + -dy / d * orbit;
      my = dy / d * (d > 120 ? 0.7 : -0.15) + dx / d * orbit;
      if (enemy.attackTimer <= 0) this.beginTelegraph(enemy, "charge", 0.55);
    } else if (enemy.type === "skeleton") {
      mx = dx / d;
      my = dy / d;
      if (enemy.attackTimer <= 0) {
        const attack = enemy.attackIndex++ % 2 === 0 ? "skeletonShield" : "skeletonAttack";
        this.beginTelegraph(enemy, attack, attack === "skeletonShield" ? 0.55 : 0.45);
      }
    } else if (enemy.type === "goblin") {
      const direction = d > 145 ? 1 : d < 95 ? -1 : 0;
      const zigzag = Math.sin(this.time * 3.6 + enemy.id) * 0.9;
      mx = dx / d * direction - dy / d * zigzag;
      my = dy / d * direction + dx / d * zigzag;
      if (enemy.attackTimer <= 0) this.beginTelegraph(enemy, "goblin", 0.65);
    } else if (enemy.type === "flyingEye" || enemy.type === "bat") {
      const direction = d > 140 ? 1 : d < 95 ? -1 : 0;
      const orbit = enemy.id % 2 ? 0.7 : -0.7;
      mx = dx / d * direction - dy / d * orbit;
      my = dy / d * direction + dx / d * orbit;
      if (enemy.attackTimer <= 0) this.beginTelegraph(enemy, enemy.type, enemy.type === "flyingEye" ? 0.65 : 0.5);
    } else if (enemy.type === "guardian") {
      if (enemy.attackTimer <= 0) this.beginTelegraph(enemy, "guardian", 0.65);
    } else if (enemy.type === "packer") {
      const target = this.enemies.filter((other) => !other.dead && other.id !== enemy.id).sort((a, b) => distance(enemy, a) - distance(enemy, b))[0];
      if (target && distance(enemy, target) < 130) {
        enemy.protectTarget = target.id;
        target.shieldedBy = enemy.id;
      } else enemy.protectTarget = null;
      const direction = d > 160 ? 1 : d < 110 ? -1 : 0;
      mx = dx / d * direction;
      my = dy / d * direction;
      if (enemy.attackTimer <= 0) this.beginTelegraph(enemy, "shooter", 0.7);
    } else if (enemy.type === "mimic") {
      mx = dx / d;
      my = dy / d;
    } else if (enemy.type === "thief") {
      const coin = this.pickups.filter((pickup) => !pickup.dead && pickup.type === "coin").sort((a, b) => distance(enemy, a) - distance(enemy, b))[0];
      if (coin) {
        const tx = coin.x - enemy.x;
        const ty = coin.y - enemy.y;
        const td = Math.hypot(tx, ty) || 1;
        mx = tx / td;
        my = ty / td;
        if (td < enemy.r + coin.r + 2) {
          coin.dead = true;
          enemy.coins += coin.amount;
          this.emit("resource", { stolen: true, pickup: coin });
        }
      } else {
        mx = dx / d;
        my = dy / d;
      }
    } else if (enemy.type === "sniper") {
      const direction = d > 175 ? 1 : d < 125 ? -1 : 0;
      mx = dx / d * direction;
      my = dy / d * direction;
      if (enemy.attackTimer <= 0) this.beginTelegraph(enemy, "laser", 1);
    } else if (enemy.type === "spawner") {
      if (enemy.attackTimer <= 0 && enemy.summonCount < 3) this.beginTelegraph(enemy, "summon", 0.85);
    }
    const m = Math.hypot(mx, my) || 1;
    this.moveBody(enemy, mx / m * enemy.speed * slow * dt, my / m * enemy.speed * slow * dt);
  }

  beginTelegraph(enemy, attackType, duration) {
    enemy.attackType = attackType;
    enemy.telegraph = duration;
    enemy.telegraphDuration = duration;
    enemy.attackAnimation = duration + 0.25;
    enemy.aimAngle = Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x);
    if (ENEMY_TYPES[enemy.type]?.boss || ["sniper", "spawner"].includes(enemy.type)) this.emit("telegraph", { enemy, attackType });
  }

  performEnemyAttack(enemy) {
    if (enemy.dead) return;
    if (enemy.attackType === "shooter") {
      for (const offset of [-0.16, 0, 0.16]) this.fireEnemy(enemy, enemy.aimAngle + offset, 110);
      enemy.attackTimer = 2.1 + this.encounterRandom() * 0.5;
      this.emit("enemyShot", { enemy });
    } else if (enemy.attackType === "inker") {
      this.fireEnemy(enemy, enemy.aimAngle, 78, { puddle: true, r: 4 });
      enemy.attackTimer = 2.6 + this.encounterRandom() * 0.5;
      this.emit("enemyShot", { enemy });
    } else if (enemy.attackType === "charge") {
      enemy.charging = 0.48;
      enemy.vx = Math.cos(enemy.aimAngle) * 185;
      enemy.vy = Math.sin(enemy.aimAngle) * 185;
      enemy.attackTimer = 2.3 + this.encounterRandom() * 0.5;
      this.emit("charge", { enemy });
    } else if (enemy.attackType === "skeletonShield") {
      enemy.shieldTimer = 1.25;
      enemy.attackTimer = 0.5;
      this.emit("shield", { enemy, x: enemy.x, y: enemy.y });
    } else if (enemy.attackType === "skeletonAttack") {
      enemy.charging = 0.34;
      enemy.vx = Math.cos(enemy.aimAngle) * 150;
      enemy.vy = Math.sin(enemy.aimAngle) * 150;
      enemy.attackTimer = 2.5;
      this.emit("charge", { enemy });
    } else if (enemy.attackType === "goblin") {
      this.fireEnemy(enemy, enemy.aimAngle, 95, { r: 4 });
      enemy.attackTimer = 2.2;
      this.emit("enemyShot", { enemy });
    } else if (enemy.attackType === "flyingEye") {
      this.fireEnemy(enemy, enemy.aimAngle, 120, { r: 3 });
      enemy.attackTimer = 1.9;
      this.emit("enemyShot", { enemy });
    } else if (enemy.attackType === "bat") {
      for (const offset of [-0.12, 0.12]) this.fireEnemy(enemy, enemy.aimAngle + offset, 105, { r: 2.5 });
      enemy.attackTimer = 2.3;
      this.emit("enemyShot", { enemy });
    } else if (enemy.attackType === "guardian") {
      const offset = enemy.attackIndex++ * Math.PI / 8;
      for (let i = 0; i < 8; i++) this.fireEnemy(enemy, offset + i / 8 * TAU, 88);
      enemy.attackTimer = 2.2;
      this.emit("sweep", { enemy });
    } else if (enemy.attackType === "reveal") {
      enemy.disguise = false;
      enemy.attackTimer = 0.8;
      this.emit("spawn", { enemy });
    } else if (enemy.attackType === "laser") {
      const angle = Math.atan2(this.player.y - enemy.y, this.player.x - enemy.x);
      if (angleDifference(angle, enemy.aimAngle) < 0.13) this.hurtPlayer(1, "Луч Ревизора");
      this.lasers.push({ x1: enemy.x, y1: enemy.y, x2: enemy.x + Math.cos(enemy.aimAngle) * 280, y2: enemy.y + Math.sin(enemy.aimAngle) * 280, life: 0.18 });
      enemy.attackTimer = 2.5;
      this.emit("enemyShot", { enemy });
    } else if (enemy.attackType === "summon") {
      enemy.summonCount++;
      this.spawnEnemy("lost", 0.5, 0.35);
      enemy.attackTimer = 3;
      this.emit("summon", { enemy });
    }
  }

  updateBoss(enemy, dt) {
    const p = this.player;
    const dx = p.x - enemy.x;
    const dy = p.y - enemy.y;
    const d = Math.hypot(dx, dy) || 1;
    if (enemy.telegraph > 0) {
      enemy.telegraph -= dt;
      if (enemy.telegraph <= 0) this.performBossAttack(enemy);
      return;
    }
    enemy.attackTimer -= dt;
    const direction = d > 115 ? 1 : d < 75 ? -0.5 : 0;
    const orbit = enemy.attackIndex % 2 ? 0.3 : -0.3;
    const slow = enemy.slowTimer > 0 || enemy.webTimer > 0 ? 0.7 : enemy.poisonTimer > 0 ? 0.85 : 1;
    this.moveBody(enemy, (dx / d * direction - dy / d * orbit) * enemy.speed * slow * dt, (dy / d * direction + dx / d * orbit) * enemy.speed * slow * dt);
    if (enemy.attackTimer <= 0) {
      const attacks = enemy.phase === 1 ? ["fan", "summon", "sweep"] : ["slam", "fan", "sweep", "summon"];
      const attack = attacks[enemy.attackIndex % attacks.length];
      enemy.attackIndex++;
      this.beginTelegraph(enemy, attack, BOSS_ATTACKS[attack].telegraph);
    }
  }

  performBossAttack(enemy) {
    if (enemy.dead) return;
    const attack = enemy.attackType;
    if (attack === "fan") {
      for (let i = -4; i <= 4; i++) this.fireEnemy(enemy, enemy.aimAngle + i * 0.16, 112);
      this.emit("enemyShot", { enemy });
    } else if (attack === "summon") {
      this.spawnEnemy("hanger", 0.06, 0.48);
      this.spawnEnemy("hanger", 0.94, 0.48);
      this.emit("summon", { enemy });
    } else if (attack === "sweep") {
      for (let i = 0; i < 16; i++) this.fireEnemy(enemy, i / 16 * TAU + this.time * 0.2, 84);
      this.emit("sweep", { enemy });
    } else if (attack === "slam") {
      if (distance(enemy, this.player) < 70) this.hurtPlayer(1, "Удар Швейцара");
      for (let i = 0; i < 10; i++) this.fireEnemy(enemy, i / 10 * TAU + 0.15, 72);
      this.emit("slam", { x: enemy.x, y: enemy.y });
    }
    enemy.attackTimer = BOSS_ATTACKS[attack].cooldown;
  }

  updateUmbrellaBoss(enemy, dt) {
    const p = this.player;
    const dx = p.x - enemy.x;
    const dy = p.y - enemy.y;
    const d = Math.hypot(dx, dy) || 1;
    if (enemy.shieldTimer > 0) enemy.aimAngle = Math.atan2(dy, dx);
    if (enemy.telegraph > 0) {
      enemy.telegraph -= dt;
      if (enemy.telegraph <= 0) this.performUmbrellaAttack(enemy);
      return;
    }
    enemy.attackTimer -= dt;
    const direction = d > 120 ? 1 : d < 85 ? -0.5 : 0;
    const slow = enemy.slowTimer > 0 || enemy.webTimer > 0 ? 0.7 : enemy.poisonTimer > 0 ? 0.85 : 1;
    this.moveBody(enemy, dx / d * direction * enemy.speed * slow * dt, dy / d * direction * enemy.speed * slow * dt);
    if (enemy.attackTimer <= 0) {
      const attacks = enemy.phase === 1 ? ["shield", "rain", "gust"] : ["rain", "shield", "gust", "rain"];
      const attack = attacks[enemy.attackIndex % attacks.length];
      enemy.attackIndex++;
      this.beginTelegraph(enemy, attack, attack === "gust" ? 0.95 : 0.75);
    }
  }

  performUmbrellaAttack(enemy) {
    if (enemy.attackType === "shield") {
      enemy.shieldTimer = enemy.phase === 2 ? 2.8 : 2.1;
      enemy.attackTimer = 1.2;
      this.emit("shield", { x: enemy.x, y: enemy.y, boss: true });
    } else if (enemy.attackType === "rain") {
      for (let i = -5; i <= 5; i++) this.fireEnemy(enemy, enemy.aimAngle + i * 0.15, 105, { r: 2.5 });
      if (enemy.phase === 2) for (let i = 0; i < 8; i++) this.fireEnemy(enemy, i / 8 * TAU, 76, { r: 2.5 });
      enemy.attackTimer = 1.1;
      this.emit("enemyShot", { enemy });
    } else if (enemy.attackType === "gust") {
      const angle = Math.atan2(enemy.y - this.player.y, enemy.x - this.player.x);
      this.player.knockX += Math.cos(angle) * 145;
      this.player.knockY += Math.sin(angle) * 145;
      for (let i = 0; i < 6; i++) this.fireEnemy(enemy, i / 6 * TAU, 68);
      enemy.attackTimer = 1.5;
      this.emit("slam", { x: enemy.x, y: enemy.y });
    }
  }

  updateProjectiles(dt) {
    for (const projectile of this.projectiles) {
      if (projectile.dead) continue;
      if (projectile.owner === "player" && this.hasItem("magnet") && projectile.source === "shot") this.homeProjectile(projectile, dt);
      if (projectile.owner === "enemy" && projectile.homingTime > 0) this.homeEnemyProjectile(projectile, dt);
      const previousX = projectile.x;
      const previousY = projectile.y;
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
      projectile.traveled += Math.hypot(projectile.x - previousX, projectile.y - previousY);
      projectile.life -= dt;
      if (projectile.life <= 0) {
        projectile.dead = true;
        continue;
      }
      if (projectile.owner === "player" && this.hasItem("mercury") && projectile.source === "shot") {
        const growth = Math.min(1.5, projectile.traveled / 110);
        projectile.damage = projectile.baseDamage * (1 + growth);
        projectile.r = getProjectileRadius(projectile.damage);
      }
      if (projectile.owner === "player" && this.tryMothEat(projectile)) continue;
      if (this.projectileHitsWorld(projectile)) {
        if (projectile.owner === "player" && projectile.bounces > 0 && this.bounceProjectile(projectile, previousX, previousY)) continue;
        if (projectile.owner === "enemy" && projectile.bounces > 0 && this.bounceEnemyProjectile(projectile, previousX, previousY)) continue;
        if (projectile.owner === "player" && this.hasItem("needle") && projectile.source === "shot") this.spawnShards(projectile);
        if (projectile.puddle) this.spawnPuddle(projectile.x, projectile.y, false, projectile.burning, projectile.acid);
        projectile.dead = true;
        this.emit("wallHit", { x: previousX, y: previousY });
        continue;
      }

      if (projectile.owner === "player") {
        let blocked = false;
        for (const boss of this.enemies) {
          if (boss.type !== "umbrellaBoss" || boss.dead || boss.shieldTimer <= 0) continue;
          const angle = Math.atan2(projectile.y - boss.y, projectile.x - boss.x);
          if (angleDifference(angle, boss.aimAngle) < 0.95) {
            projectile.dead = true;
            blocked = true;
            this.emit("shield", { x: projectile.x, y: projectile.y, boss: true });
            break;
          }
        }
        if (blocked) continue;
        for (const enemy of this.enemies) {
          if (enemy.dead || enemy.spawnTime > 0 || this.waveIntro > 0 || projectile.hitIds.has(enemy.id)) continue;
          if (distance(projectile, enemy) > projectile.r + enemy.r) continue;
          projectile.hitIds.add(enemy.id);
          this.damageEnemy(enemy, projectile.damage, projectile);
          this.projectileEffects(enemy, projectile);
          this.emit("projectileHit", { x: projectile.x, y: projectile.y, enemy });
          if (projectile.pierce > 0) projectile.pierce--;
          else {
            projectile.dead = true;
            break;
          }
        }
      } else {
        const d = distance(projectile, this.player);
        if (this.hasItem("mirror") && this.player.mirrorTimer <= 0 && !this.grazed.has(projectile.id) && d < projectile.r + this.player.r + 9 && d >= projectile.r + this.player.r) {
          this.grazed.add(projectile.id);
          this.player.mirrorTimer = 0.4;
          if (this.room().type === "boss" && !this.memory.mirrorAwakened) {
            this.memoryProgress.mirror++;
            if (this.memoryProgress.mirror >= 10) {
              this.memory.mirrorAwakened = true;
              this.emit("memory", { id: "mirror", name: "Зеркальце вспомнило владельца" });
            }
          }
          const target = this.enemies.filter((enemy) => !enemy.dead).sort((a, b) => distance(this.player, a) - distance(this.player, b))[0];
          if (target) this.spawnPlayerShot(Math.atan2(target.y - this.player.y, target.x - this.player.x), "mirror", 0.75);
          this.emit("shield", { x: this.player.x, y: this.player.y, graze: true });
        }
        if (d < projectile.r + this.player.r) {
          if (this.hasItem("umbrella") && this.player.umbrellaTimer <= 0) this.blockWithUmbrella(projectile);
          else this.hurtPlayer(projectile.damage, "Вражеский снаряд");
          if (projectile.puddle) this.spawnPuddle(projectile.x, projectile.y, false, projectile.burning, projectile.acid);
          projectile.dead = true;
        }
      }
    }
  }

  homeProjectile(projectile, dt) {
    const target = this.enemies.filter((enemy) => !enemy.dead && enemy.spawnTime <= 0 && distance(projectile, enemy) < 180).sort((a, b) => distance(projectile, a) - distance(projectile, b))[0];
    if (!target) return;
    const speed = Math.hypot(projectile.vx, projectile.vy);
    const desired = Math.atan2(target.y - projectile.y, target.x - projectile.x);
    const current = Math.atan2(projectile.vy, projectile.vx);
    const difference = Math.atan2(Math.sin(desired - current), Math.cos(desired - current));
    const angle = current + clamp(difference, -dt * 2.4, dt * 2.4);
    projectile.vx = Math.cos(angle) * speed;
    projectile.vy = Math.sin(angle) * speed;
  }

  homeEnemyProjectile(projectile, dt) {
    projectile.homingTime = Math.max(0, projectile.homingTime - dt);
    const speed = Math.hypot(projectile.vx, projectile.vy);
    const desired = Math.atan2(this.player.y - projectile.y, this.player.x - projectile.x);
    const current = Math.atan2(projectile.vy, projectile.vx);
    const difference = Math.atan2(Math.sin(desired - current), Math.cos(desired - current));
    const angle = current + clamp(difference, -dt * 1.5, dt * 1.5);
    projectile.vx = Math.cos(angle) * speed;
    projectile.vy = Math.sin(angle) * speed;
  }

  bounceEnemyProjectile(projectile, previousX, previousY) {
    projectile.x = previousX;
    projectile.y = previousY;
    const speed = Math.hypot(projectile.vx, projectile.vy);
    const angle = Math.atan2(this.player.y - previousY, this.player.x - previousX) + (projectile.id % 2 ? 0.08 : -0.08);
    projectile.vx = Math.cos(angle) * speed;
    projectile.vy = Math.sin(angle) * speed;
    projectile.bounces--;
    this.emit("bounce", { x: previousX, y: previousY, enemy: true });
    return true;
  }

  projectileEffects(enemy, projectile) {
    if (this.hasItem("ink") && ["shot", "laser"].includes(projectile.source)) this.spawnPuddle(enemy.x, enemy.y, true);
    if (this.hasItem("poison")) {
      enemy.poisonTimer = 4;
      enemy.poisonTick = Math.min(enemy.poisonTick, 0.5);
    }
    if (this.hasItem("bleed")) {
      enemy.bleedTimer = 4;
      enemy.bleedTick = Math.min(enemy.bleedTick, 0.5);
    }
    if (this.hasItem("fire")) {
      this.hitCounter++;
      if (this.hitCounter % 4 === 0) this.ignite(enemy, 3);
    }
    if (this.hasItem("thermos")) {
      enemy.cold++;
      if (enemy.cold >= 5) {
        enemy.cold = 0;
        if (ENEMY_TYPES[enemy.type]?.boss) enemy.slowTimer = 1.2;
        else {
          enemy.freezeTimer = 1.2;
          this.memoryProgress.thermos++;
          if (this.memoryProgress.thermos >= 8 && !this.memory.thermosAwakened) {
            this.memory.thermosAwakened = true;
            this.emit("memory", { id: "thermos", name: "Термос вспомнил ледяной шум" });
          }
        }
      }
    }
    if (this.hasItem("web")) {
      this.webCounter++;
      if (this.webCounter % 3 === 0) {
        enemy.webTimer = 2;
        const other = this.enemies.filter((entry) => !entry.dead && entry.id !== enemy.id && distance(enemy, entry) < 45).sort((a, b) => distance(enemy, a) - distance(enemy, b))[0];
        if (other && !ENEMY_TYPES[enemy.type]?.boss) {
          const angle = Math.atan2(other.y - enemy.y, other.x - enemy.x);
          this.moveBody(enemy, Math.cos(angle) * 5, Math.sin(angle) * 5);
        }
      }
    }
    if (projectile.spring) {
      for (const other of this.projectiles) {
        if (other.owner === "enemy" && distance(enemy, other) < 32) other.dead = true;
      }
      const angle = Math.atan2(enemy.y - this.player.y, enemy.x - this.player.x);
      this.moveBody(enemy, Math.cos(angle) * 7, Math.sin(angle) * 7);
    }
  }

  coldBurst(enemy) {
    for (const offset of [-0.6, 0.6]) {
      const angle = Math.atan2(enemy.y - this.player.y, enemy.x - this.player.x) + offset;
      this.createProjectile({
        owner: "player", source: "coldShard", x: enemy.x, y: enemy.y,
        vx: Math.cos(angle) * 90, vy: Math.sin(angle) * 90,
        r: 2, damage: 0, life: 0.65,
      });
    }
  }

  ignite(enemy, duration, depth = 0) {
    enemy.burn = Math.max(enemy.burn, duration);
    enemy.burnDepth = depth;
  }

  tryMothEat(projectile) {
    for (const enemy of this.enemies) {
      if (enemy.dead || enemy.type !== "moth" || enemy.spawnTime > 0 || enemy.eatTimer > 0) continue;
      if (distance(projectile, enemy) > 19 + enemy.growth * 4) continue;
      projectile.dead = true;
      enemy.eatTimer = 1.1;
      if (enemy.growth < 3) {
        enemy.growth++;
        enemy.hp = Math.min(enemy.maxHp + 6, enemy.hp + 2);
        enemy.r += 0.8;
      }
      this.emit("eat", { enemy });
      return true;
    }
    return false;
  }

  projectileHitsWorld(projectile) {
    const p = projectile;
    if (p.x - p.r < ARENA.left || p.x + p.r > ARENA.right || p.y - p.r < ARENA.top || p.y + p.r > ARENA.bottom) return true;
    return this.obstacles.some((obstacle) => circleRect(p.x, p.y, p.r, obstacle));
  }

  bounceProjectile(projectile, previousX, previousY) {
    const target = this.enemies.filter((enemy) => !enemy.dead && enemy.spawnTime <= 0).sort((a, b) => distance(projectile, a) - distance(projectile, b))[0];
    if (!target) return false;
    projectile.x = previousX;
    projectile.y = previousY;
    const angle = Math.atan2(target.y - previousY, target.x - previousX);
    const speed = Math.hypot(projectile.vx, projectile.vy);
    projectile.vx = Math.cos(angle) * speed;
    projectile.vy = Math.sin(angle) * speed;
    projectile.bounces--;
    projectile.hitIds.clear();
    this.emit("bounce", { x: previousX, y: previousY, mercury: this.hasItem("mercury") });
    return true;
  }

  spawnShards(projectile) {
    const base = Math.atan2(-projectile.vy, -projectile.vx);
    for (const offset of [-0.55, 0, 0.55]) {
      const angle = base + offset;
      this.createProjectile({
        owner: "player", source: "shard", x: projectile.x, y: projectile.y,
        vx: Math.cos(angle) * 135, vy: Math.sin(angle) * 135,
        r: getProjectileRadius(projectile.baseDamage * 0.25), damage: projectile.baseDamage * 0.25, life: 0.7,
      });
    }
  }

  blockWithUmbrella(projectile) {
    const p = this.player;
    p.umbrellaTimer = 10;
    this.memoryProgress.umbrella++;
    if (this.memoryProgress.umbrella >= 3 && !this.memory.umbrellaAwakened) {
      this.memory.umbrellaAwakened = true;
      this.emit("memory", { id: "umbrella", name: "Зонт вспомнил дождь" });
    }
    const count = this.memory.umbrellaAwakened ? 8 : 6;
    for (let i = 0; i < count; i++) {
      const angle = i / count * TAU;
      this.createProjectile({ owner: "player", source: "drop", x: p.x, y: p.y, vx: Math.cos(angle) * 110, vy: Math.sin(angle) * 110, r: 2, damage: 1, life: 0.8 });
    }
    if (this.memory.umbrellaAwakened) this.spawnPuddle(p.x, p.y, true);
    this.emit("shield", { x: p.x, y: p.y, blocked: projectile.id });
  }

  updateThread(dt) {
    this.arcTimer = Math.max(0, this.arcTimer - dt);
    if (!this.hasItem("thread") || this.arcTimer > 0) return;
    const shots = this.projectiles.filter((projectile) => projectile.owner === "player" && !projectile.dead).slice(0, 10);
    const hit = new Set();
    let count = 0;
    for (let i = 0; i < shots.length && count < 3; i++) {
      for (let j = i + 1; j < shots.length && count < 3; j++) {
        const a = shots[i];
        const b = shots[j];
        this.arcs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, life: 0.12 });
        count++;
        for (const enemy of this.enemies) {
          if (enemy.dead || enemy.spawnTime > 0 || hit.has(enemy.id)) continue;
          if (segmentDistance(enemy.x, enemy.y, a.x, a.y, b.x, b.y) < enemy.r + 2) {
            hit.add(enemy.id);
            this.damageEnemy(enemy, 0.4, { source: "thread" });
          }
        }
      }
    }
    this.arcTimer = 0.2;
  }

  spawnPuddle(x, y, friendly, burning = false, acid = false) {
    if (this.puddles.length > 30) this.puddles.shift();
    this.puddles.push({ id: this.nextId++, x, y, r: friendly ? 13 : 15, friendly, burning, acid, life: 2, maxLife: 2 });
    this.emit("puddle", { x, y, friendly, burning, acid });
  }

  updatePuddles(dt) {
    for (const puddle of this.puddles) {
      puddle.life -= dt;
      if (puddle.friendly) {
        for (const enemy of this.enemies) if (!enemy.dead && distance(puddle, enemy) < puddle.r + enemy.r) enemy.slowTimer = 0.2;
      } else if (!this.hasItem("sole") && distance(puddle, this.player) < puddle.r + this.player.r) {
        if (puddle.acid) this.hurtPlayer(1, "Кислота лаборатории");
        else if (puddle.burning) this.hurtPlayer(1, "Вечный огонь Первого невозврата");
        else this.player.slowTimer = 0.2;
      }
    }
    this.puddles = this.puddles.filter((puddle) => puddle.life > 0);
  }

  updateBombs(dt) {
    for (const bomb of this.bombs) {
      if (bomb.dead) continue;
      bomb.timer -= dt;
      if (bomb.timer > 0) continue;
      bomb.dead = true;
      for (const enemy of this.enemies) if (!enemy.dead && enemy.spawnTime <= 0 && distance(bomb, enemy) < 48 + enemy.r) this.damageEnemy(enemy, 14, bomb);
      for (const projectile of this.projectiles) if (projectile.owner === "enemy" && distance(bomb, projectile) < 55) projectile.dead = true;
      const d = distance(bomb, this.player);
      if (d < 48 + this.player.r) {
        const angle = d > 0.1 ? Math.atan2(this.player.y - bomb.y, this.player.x - bomb.x) : this.random() * TAU;
        const force = this.hasItem("button") ? 165 : 95;
        this.player.knockX += Math.cos(angle) * force;
        this.player.knockY += Math.sin(angle) * force;
        if (!this.hasItem("button")) this.hurtPlayer(1, "Своя петарда");
        else this.emit("rubber", { x: this.player.x, y: this.player.y });
      }
      this.checkSecretExplosion(bomb);
      this.emit("explosion", { x: bomb.x, y: bomb.y });
    }
  }

  checkSecretExplosion(bomb) {
    const room = this.room();
    if (room.secretFound || !room.hidden.length) return;
    const walls = {
      N: { x: 240, y: ARENA.top }, S: { x: 240, y: ARENA.bottom },
      E: { x: ARENA.right, y: 140 }, W: { x: ARENA.left, y: 140 },
    };
    for (const direction of room.hidden) {
      const point = walls[direction];
      if (distance(bomb, point) > 65) continue;
      room.secretFound = true;
      const secret = this.rooms.find((entry) => entry.id === room.doors[direction]);
      if (secret) secret.secretFound = true;
      this.emit("secret", { id: "dustWall", name: "Пыль идёт не туда", direction });
      this.checkpoint();
      return;
    }
  }

  updateFamiliars(dt) {
    const f = this.familiar;
    const p = this.player;
    f.angle += dt * 2.2;
    f.cooldown = Math.max(0, f.cooldown - dt);
    f.gearCooldown = Math.max(0, f.gearCooldown - dt);
    f.gearHitTimer = Math.max(0, f.gearHitTimer - dt);
    f.x += (p.x - 15 - f.x) * Math.min(1, dt * 4);
    f.y += (p.y + 12 - f.y) * Math.min(1, dt * 4);
    if (this.hasItem("archivMoth") && f.cooldown <= 0) {
      const projectile = this.projectiles.find((entry) => entry.owner === "enemy" && !entry.dead && distance(f, entry) < 23);
      if (projectile) {
        projectile.dead = true;
        this.memoryProgress.moth++;
        if (this.memoryProgress.moth >= 5 && !this.memory.mothAwakened) {
          this.memory.mothAwakened = true;
          this.emit("memory", { id: "archivMoth", name: "Моль насытилась" });
        }
        f.cooldown = this.memory.mothAwakened ? 4.5 : 6;
        this.emit("eat", { enemy: f });
      }
    }
    if (this.hasItem("gear")) {
      const gear = { x: p.x + Math.cos(f.angle) * 20, y: p.y + Math.sin(f.angle) * 20 };
      if (f.gearCooldown <= 0) {
        const projectile = this.projectiles.find((entry) => entry.owner === "enemy" && !entry.dead && distance(gear, entry) < 6);
        if (projectile) {
          projectile.dead = true;
          f.gearCooldown = 6;
          this.emit("shield", { x: gear.x, y: gear.y, gear: true });
        }
      }
      if (f.gearHitTimer <= 0) {
        const enemy = this.enemies.find((entry) => !entry.dead && distance(gear, entry) < entry.r + 5);
        if (enemy) {
          this.damageEnemy(enemy, 0.5, { source: "gear" });
          f.gearHitTimer = 0.25;
        }
      }
      f.gearX = gear.x;
      f.gearY = gear.y;
    }
  }

  moveBody(body, dx, dy) {
    const previousX = body.x;
    const previousY = body.y;
    const obstacles = body.flying ? [] : this.obstacles;
    let collided = false;
    body.x += dx;
    const minX = ARENA.left + body.r;
    const maxX = ARENA.right - body.r;
    if (body.x < minX || body.x > maxX) {
      body.x = clamp(body.x, minX, maxX);
      collided = true;
    }
    for (const obstacle of obstacles) {
      if (!circleRect(body.x, body.y, body.r, obstacle)) continue;
      body.x = dx > 0 ? obstacle.x - body.r : dx < 0 ? obstacle.x + obstacle.w + body.r : previousX;
      collided = true;
    }
    body.y += dy;
    const minY = ARENA.top + body.r;
    const maxY = ARENA.bottom - body.r;
    if (body.y < minY || body.y > maxY) {
      body.y = clamp(body.y, minY, maxY);
      collided = true;
    }
    for (const obstacle of obstacles) {
      if (!circleRect(body.x, body.y, body.r, obstacle)) continue;
      body.y = dy > 0 ? obstacle.y - body.r : dy < 0 ? obstacle.y + obstacle.h + body.r : previousY;
      collided = true;
    }
    return collided;
  }

  damageEnemy(enemy, amount) {
    if (!enemy || enemy.dead || enemy.spawnTime > 0 || this.waveIntro > 0) return false;
    if (enemy.disguise) enemy.disguise = false;
    if (enemy.type === "skeleton" && enemy.shieldTimer > 0) {
      amount *= 0.2;
      this.emit("shield", { enemy, x: enemy.x, y: enemy.y, skeleton: true });
    }
    const protector = enemy.shieldedBy && this.enemies.find((other) => other.id === enemy.shieldedBy && !other.dead);
    if (protector) amount *= 0.5;
    enemy.hp -= amount;
    enemy.flash = 0.08;
    this.emit("hit", { enemy, amount });
    if (enemy.hp <= 0) this.killEnemy(enemy);
    else if (ENEMY_TYPES[enemy.type]?.boss && enemy.phase === 1 && enemy.hp <= enemy.maxHp * 0.6) {
      enemy.phase = 2;
      enemy.telegraph = 0;
      enemy.attackTimer = 0.7;
      this.emit("bossPhase", { enemy, phase: 2 });
    }
    return true;
  }

  killEnemy(enemy) {
    if (enemy.dead) return;
    enemy.dead = true;
    this.kills++;
    this.emit("kill", { enemy });
    if (this.hasItem("poison") && this.hasItem("bleed") && enemy.poisonTimer > 0 && enemy.bleedTimer > 0 && !enemy.synergySpread) {
      const targets = this.enemies.filter((other) => !other.dead && !other.synergySpread && other.id !== enemy.id && distance(enemy, other) < 60).sort((a, b) => distance(enemy, a) - distance(enemy, b)).slice(0, 2);
      for (const target of targets) {
        target.poisonTimer = Math.max(target.poisonTimer, 2);
        target.bleedTimer = Math.max(target.bleedTimer, 2);
        target.poisonTick = Math.min(target.poisonTick, 0.5);
        target.bleedTick = Math.min(target.bleedTick, 0.5);
        target.synergySpread = true;
      }
      this.emit("synergySpread", { enemy, targets });
    }
    if (enemy.type === "dust" && !enemy.small) {
      this.createEnemy("dust", enemy.x - 7, enemy.y, { small: true, allowClose: true });
      this.createEnemy("dust", enemy.x + 7, enemy.y, { small: true, allowClose: true });
    }
    if (enemy.type === "thief" && enemy.coins > 0) this.spawnPickup("coin", enemy.x, enemy.y, { amount: enemy.coins });
    if (enemy.burn > 0 && enemy.burnDepth < 2) {
      const target = this.enemies.filter((other) => !other.dead && other.id !== enemy.id && distance(enemy, other) < 70).sort((a, b) => distance(enemy, a) - distance(enemy, b))[0];
      if (target) this.ignite(target, 2, enemy.burnDepth + 1);
    }
  }

  hurtPlayer(amount, source) {
    const p = this.player;
    if (p.invuln > 0 || this.state === "dead" || this.state === "victory") return false;
    p.noDamageRoom = false;
    if (this.hasItem("coat") && !this.coatUsed) {
      this.coatUsed = true;
      p.invuln = 0.75;
      this.emit("shield", { x: p.x, y: p.y, coat: true });
      return false;
    }
    p.hp = Math.max(0, p.hp - amount);
    p.invuln = 0.75;
    this.lastDamage = source;
    this.emit("hurt", { amount, source, hp: p.hp, x: p.x, y: p.y });
    if (p.hp <= 0) {
      this.state = "dead";
      this.emit("dead", this.stats());
    }
    return true;
  }

  buildStats() {
    const stats = getWeaponStats(this);
    return {
      ...stats,
      moveSpeed: this.moveSpeed(),
      health: this.player.hp,
      maxHealth: this.player.maxHp,
      bombs: this.player.bombs,
      coins: this.player.coins,
      keys: this.player.keys,
      umbrellaCooldown: this.hasItem("umbrella") ? 10 : null,
      umbrellaRemaining: this.hasItem("umbrella") ? this.player.umbrellaTimer : null,
    };
  }

  stats() {
    return {
      seed: this.seed,
      kills: this.kills,
      time: this.time,
      floor: this.floorIndex + 1,
      items: [...this.items],
      lastDamage: this.lastDamage,
      mode: this.mode,
    };
  }

  debugClearRoom() {
    for (let pass = 0; pass < 6; pass++) {
      for (const enemy of [...this.enemies]) {
        if (!enemy.dead) {
          enemy.spawnTime = 0;
          this.waveIntro = 0;
          this.damageEnemy(enemy, 9999);
        }
      }
    }
  }
}
