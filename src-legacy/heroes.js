export const HEROES = [
  { id: "archivist", name: "Архивист", sprite: "archivist", hp: 6, itemId: null },
  { id: "student", name: "Стажёр", sprite: "student", hp: 6, itemId: "chalk" },
  { id: "witch", name: "Ведьма хранилища", sprite: "witch", hp: 5, itemId: "fire" },
  { id: "scout", name: "Следопыт", sprite: "scout", hp: 5, itemId: "magnet", passive: "noHitSecret", trait: "Безошибочный бой: открывает тайник" },
];

export const HERO_BY_ID = new Map(HEROES.map((hero) => [hero.id, hero]));
export const HERO_ALIASES = {
  keeper: "archivist",
  intern: "student",
  priestess: "witch",
  fireKnight: "witch",
  courier: "scout",
  surveyor: "scout",
};
export const DEFAULT_HERO = "archivist";

export function canonicalHeroId(id) {
  return HERO_ALIASES[id] || id;
}

export function getHero(id) {
  return HERO_BY_ID.get(canonicalHeroId(id)) || HERO_BY_ID.get(DEFAULT_HERO);
}
