import { ITEM_BY_ID } from "./content.js";
import { getHero, HEROES, HERO_ALIASES } from "./heroes.js";

const KEY = "bureau.progress.v1";

export const CHALLENGES = [
  {
    id: "threeSeals",
    name: "Три печати",
    floors: 3,
    maxHp: 4,
    heartDrops: false,
    bulletSpeed: 1.12,
    choiceLimit: 3,
    allowRift: true,
    reward: "returning",
    description: "Пройдите 3 отдела. Максимум 4 HP, сердца не выпадают, вражеские снаряды на 12% быстрее.",
  },
  {
    id: "limitedOffer",
    name: "Урезанная опись",
    floors: 6,
    maxHp: null,
    heartDrops: true,
    bulletSpeed: 1,
    choiceLimit: 2,
    allowRift: false,
    reward: "coil",
    description: "Пройдите всю смену. Только 2 варианта вместо 3 при выборе вещи; сервисные переходы запрещены.",
  },
];

const CHALLENGE_BY_ID = new Map(CHALLENGES.map((challenge) => [challenge.id, challenge]));

export const ITEM_UNLOCKS = {
  laser: { kind: "floor", hero: "student", floor: 3, text: "Стажёр: зачистить 3 отдела" },
  heavy: { kind: "win", hero: "archivist", floor: 6, text: "Архивист: завершить полную смену" },
  quad: { kind: "win", floor: 6, text: "Завершить полную смену любым героем" },
  stamp: { kind: "floor", hero: "witch", floor: 4, text: "Ведьма хранилища: зачистить 4 отдела" },
  returning: { kind: "challenge", challenge: "threeSeals", text: "Выполнить испытание «Три печати»" },
  coil: { kind: "challenge", challenge: "limitedOffer", text: "Выполнить испытание «Урезанная опись»" },
};

function emptyProgress() {
  return { version: 1, unlocked: [], heroFloors: {}, heroWins: {}, challengeWins: {} };
}

export function getChallenge(id) {
  return CHALLENGE_BY_ID.get(id) || null;
}

export class Progression {
  constructor(storage = typeof window !== "undefined" ? window.localStorage : null) {
    this.storage = storage;
    this.data = this.read();
    this.save();
  }

  read() {
    const result = emptyProgress();
    try {
      const saved = JSON.parse(this.storage?.getItem(KEY) || "null");
      if (!saved || saved.version !== 1) return result;
      result.unlocked = Array.isArray(saved.unlocked)
        ? [...new Set(saved.unlocked.filter((id) => Object.hasOwn(ITEM_UNLOCKS, id) && ITEM_BY_ID.has(id)))]
        : [];
      for (const hero of HEROES) {
        const legacyIds = Object.entries(HERO_ALIASES).filter(([, id]) => id === hero.id).map(([id]) => id);
        const ids = [hero.id, ...legacyIds];
        const floor = Math.min(6, Math.max(0, ...ids.map((id) => Math.trunc(saved.heroFloors?.[id]) || 0)));
        const wins = ids.reduce((sum, id) => sum + Math.max(0, Math.trunc(saved.heroWins?.[id]) || 0), 0);
        if (floor) result.heroFloors[hero.id] = floor;
        if (wins) result.heroWins[hero.id] = wins;
      }
      for (const challenge of CHALLENGES) {
        const wins = Math.max(0, Math.trunc(saved.challengeWins?.[challenge.id]) || 0);
        if (wins) result.challengeWins[challenge.id] = wins;
      }
      this.data = result;
      this.evaluateUnlocks();
    } catch {
      return emptyProgress();
    }
    return result;
  }

  save() {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.data));
      return true;
    } catch {
      return false;
    }
  }

  isUnlocked(itemId) {
    return !Object.hasOwn(ITEM_UNLOCKS, itemId) || this.data.unlocked.includes(itemId);
  }

  unlockGoal(itemId) {
    return ITEM_UNLOCKS[itemId]?.text || null;
  }

  unlockedCount(items) {
    return items.filter((item) => this.isUnlocked(item.id)).length;
  }

  challengeWins(id) {
    return this.data.challengeWins[id] || 0;
  }

  recordFloor(stats) {
    if (stats.mode !== "run") return [];
    const heroId = getHero(stats.heroId).id;
    const floor = Math.max(0, Math.min(6, Math.trunc(stats.floor) || 0));
    const previous = this.data.heroFloors[heroId] || 0;
    if (floor <= previous) return [];
    this.data.heroFloors[heroId] = floor;
    const unlocked = this.evaluateUnlocks();
    this.save();
    return unlocked;
  }

  recordVictory(stats) {
    if (stats.mode === "run" && stats.floor >= 6) {
      const heroId = getHero(stats.heroId).id;
      this.data.heroWins[heroId] = (this.data.heroWins[heroId] || 0) + 1;
    } else if (stats.mode === "challenge") {
      const challenge = getChallenge(stats.challengeId);
      if (!challenge || stats.floor < challenge.floors) return [];
      this.data.challengeWins[challenge.id] = this.challengeWins(challenge.id) + 1;
    } else {
      return [];
    }
    const unlocked = this.evaluateUnlocks();
    this.save();
    return unlocked;
  }

  evaluateUnlocks() {
    const unlocked = [];
    for (const [itemId, rule] of Object.entries(ITEM_UNLOCKS)) {
      if (this.data.unlocked.includes(itemId)) continue;
      const eligible = rule.kind === "floor"
        ? (this.data.heroFloors[rule.hero] || 0) >= rule.floor
        : rule.kind === "win"
          ? rule.hero ? (this.data.heroWins[rule.hero] || 0) > 0 : Object.values(this.data.heroWins).some((wins) => wins > 0)
          : this.challengeWins(rule.challenge) > 0;
      if (eligible) {
        this.data.unlocked.push(itemId);
        unlocked.push(itemId);
      }
    }
    if (unlocked.length) this.save();
    return unlocked;
  }
}
