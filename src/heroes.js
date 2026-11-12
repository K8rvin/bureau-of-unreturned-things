export const HEROES = [
  { id: "child", name: "Ребёнок", sprite: "child", hp: 6, itemId: null },
];

export const HERO_BY_ID = new Map(HEROES.map((hero) => [hero.id, hero]));
export const HERO_ALIASES = {
  keeper: "child",
  intern: "child",
  priestess: "child",
  fireKnight: "child",
  courier: "child",
  surveyor: "child",
  archivist: "child",
  student: "child",
  witch: "child",
  scout: "child",
};
export const DEFAULT_HERO = "child";

export function canonicalHeroId(id) {
  return HERO_ALIASES[id] || id;
}

export function getHero(id) {
  return HERO_BY_ID.get(canonicalHeroId(id)) || HERO_BY_ID.get(DEFAULT_HERO);
}
