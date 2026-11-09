export const HEROES = [
  { id: "keeper", name: "Кладовщик", sprite: "player", hp: 6, itemId: null },
  { id: "intern", name: "Стажёр", sprite: "intern", hp: 6, itemId: "chalk" },
  { id: "priestess", name: "Хранительница дождя", sprite: "priestess", hp: 6, itemId: "umbrella" },
  { id: "fireKnight", name: "Огненный рыцарь", sprite: "fireKnight", hp: 5, itemId: "fire" },
  { id: "courier", name: "Курьер", sprite: "courier", hp: 5, itemId: "magnet" },
  { id: "surveyor", name: "Картограф", sprite: "surveyor", hp: 5, itemId: "lens", passive: "noHitSecret", trait: "Безошибочный бой: открывает тайник" },
];

export const HERO_BY_ID = new Map(HEROES.map((hero) => [hero.id, hero]));
export const DEFAULT_HERO = "keeper";

export function getHero(id) {
  return HERO_BY_ID.get(id) || HERO_BY_ID.get(DEFAULT_HERO);
}
