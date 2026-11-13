const STORAGE_KEY = "library.diagnostics.v1";
const MAX_SESSIONS = 8;
const COMBAT_STATES = new Set(["wave", "boss"]);
const copy = (value) => JSON.parse(JSON.stringify(value));

function numeric(value) {
  return Number.isFinite(value) ? value : 0;
}

export class CombatDiagnostics {
  constructor({ enabled = false, storage } = {}) {
    if (storage === undefined) {
      try {
        storage = globalThis.localStorage;
      } catch {
        storage = null;
      }
    }
    this.storage = storage;
    this.enabled = enabled;
    this.visible = false;
    this.run = null;
    this.room = null;
    this.lastRoom = null;
    this.history = [];
    this.historyLoaded = false;
  }

  setEnabled(enabled, game) {
    if (this.enabled === enabled) return;
    if (!enabled) {
      this.finishRoom(game, "disabled");
      this.finishSession(game, "disabled");
    }
    this.enabled = enabled;
    this.visible = enabled;
    if (enabled && game) this.beginRun(game);
  }

  toggle(game) {
    if (this.visible) {
      this.setEnabled(false, game);
      return false;
    }
    this.setEnabled(true, game);
    this.visible = true;
    return true;
  }

  beginRun(game) {
    if (!this.enabled) return;
    this.finishRoom(game, "new-run");
    this.finishSession(game, "new-run");
    this.run = {
      id: `${Date.now()}-${game.seed}`,
      startedAt: new Date().toISOString(),
      seed: game.seed,
      heroId: game.heroId,
      mode: game.mode,
      challengeId: game.challengeId,
      result: "active",
      rooms: [],
      coinsEarned: 0,
      coinsSpent: 0,
      keysEarned: 0,
      keysSpent: 0,
    };
    this.room = null;
    this.lastRoom = null;
    if (COMBAT_STATES.has(game.state) && game.room()) this.startRoom(game);
  }

  startRoom(game) {
    const room = game.room();
    this.room = {
      floor: game.floorIndex + 1,
      id: room.id,
      type: room.type,
      startTime: game.time,
      damage: 0,
      damageTaken: 0,
      hits: 0,
      volleys: 0,
      kills: 0,
      coinsEarned: 0,
      coinsSpent: 0,
      keysEarned: 0,
      keysSpent: 0,
      bombsUsed: 0,
      damageBySource: {},
      lastDamage: null,
    };
  }

  finishRoom(game, reason) {
    if (!this.room || !this.run) return;
    const room = {
      ...this.room,
      duration: Math.max(0, game.time - this.room.startTime),
      items: [...game.items],
      result: reason,
    };
    delete room.startTime;
    this.run.rooms.push(room);
    this.lastRoom = room;
    this.room = null;
    this.persistRun();
  }

  finishSession(game, result) {
    if (!this.run) return;
    this.run.result = result;
    this.run.gameTime = game.time;
    this.run.endedAt = new Date().toISOString();
    this.persistRun();
    this.run = null;
    this.room = null;
  }

  loadHistory() {
    if (this.historyLoaded) return;
    this.historyLoaded = true;
    if (!this.storage) return;
    try {
      const stored = JSON.parse(this.storage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(stored)) this.history = stored.filter((session) => session && typeof session.id === "string" && Array.isArray(session.rooms)).slice(-MAX_SESSIONS);
    } catch {
      this.history = [];
    }
  }

  persistRun() {
    if (!this.run || !this.storage) return;
    this.loadHistory();
    const existing = this.history.findIndex((session) => session.id === this.run.id);
    if (existing >= 0) this.history[existing] = this.run;
    else this.history.push(this.run);
    this.history = this.history.slice(-MAX_SESSIONS);
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.history));
    } catch {
      return;
    }
  }

  resource(event, earnedField, spentField, spent) {
    if (!this.run) return;
    const amount = numeric(event.price ?? event.pickup?.amount ?? event.amount) || 1;
    this.run[earnedField] += spent ? 0 : amount;
    this.run[spentField] += spent ? amount : 0;
    if (this.room) this.room[earnedField] += spent ? 0 : amount;
    if (this.room) this.room[spentField] += spent ? amount : 0;
  }

  handle(event, game) {
    if (!this.enabled) return;
    if (!this.run && game.floor && game.state !== "title") this.beginRun(game);
    switch (event.type) {
      case "room":
        this.finishRoom(game, "exit");
        if (COMBAT_STATES.has(game.state)) this.startRoom(game);
        break;
      case "hit":
        if (!this.room) break;
        this.room.damage += Math.max(0, numeric(event.amount));
        const source = typeof event.source === "string" ? event.source : "unknown";
        this.room.damageBySource[source] = (this.room.damageBySource[source] || 0) + Math.max(0, numeric(event.amount));
        break;
      case "hurt":
        if (!this.room) break;
        this.room.hits++;
        this.room.damageTaken += Math.max(0, numeric(event.amount));
        this.room.lastDamage = typeof event.source === "string" ? event.source : null;
        break;
      case "shot":
        if (this.room) this.room.volleys++;
        break;
      case "kill":
        if (this.room) this.room.kills++;
        break;
      case "resource":
        if (event.pickup?.type === "coin") this.resource(event, "coinsEarned", "coinsSpent", false);
        else if (event.pickup?.type === "key") this.resource(event, "keysEarned", "keysSpent", false);
        break;
      case "buy":
        this.resource(event, "coinsEarned", "coinsSpent", true);
        break;
      case "unlocked":
        this.resource(event, "keysEarned", "keysSpent", true);
        break;
      case "bomb":
        if (this.room) this.room.bombsUsed++;
        break;
      case "roomClear":
        this.finishRoom(game, "clear");
        break;
      case "dead":
      case "victory":
        this.finishRoom(game, event.type);
        this.finishSession(game, event.type);
        break;
    }
  }

  current(game) {
    const room = this.room || this.lastRoom;
    if (!room) return null;
    const duration = this.room ? Math.max(0, game.time - room.startTime) : room.duration;
    return {
      floor: room.floor,
      id: room.id,
      type: room.type,
      duration,
      damage: room.damage,
      damageTaken: room.damageTaken,
      hits: room.hits,
      volleys: room.volleys,
      kills: room.kills,
      dps: duration > 0 ? room.damage / duration : 0,
      coinsEarned: room.coinsEarned,
      coinsSpent: room.coinsSpent,
      keysEarned: room.keysEarned,
      keysSpent: room.keysSpent,
      lastDamage: room.lastDamage,
      items: this.room ? [...game.items] : room.items,
    };
  }

  snapshot() {
    return copy({ enabled: this.enabled, visible: this.visible, run: this.run, lastRoom: this.lastRoom, history: this.history });
  }
}
