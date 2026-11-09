export const LAYOUTS = [
  { id: "open", name: "Открытая арена", obstacles: [] },
  {
    id: "shelves",
    name: "Четыре полки",
    obstacles: [
      { x: 92, y: 79, w: 48, h: 17 },
      { x: 340, y: 79, w: 48, h: 17 },
      { x: 92, y: 190, w: 48, h: 17 },
      { x: 340, y: 190, w: 48, h: 17 },
    ],
  },
  {
    id: "columns",
    name: "Колонны",
    obstacles: [
      { x: 150, y: 82, w: 22, h: 72 },
      { x: 308, y: 82, w: 22, h: 72 },
      { x: 150, y: 174, w: 22, h: 42 },
      { x: 308, y: 174, w: 22, h: 42 },
    ],
  },
  {
    id: "cross",
    name: "Перекрёсток",
    obstacles: [
      { x: 224, y: 73, w: 32, h: 34 },
      { x: 224, y: 173, w: 32, h: 34 },
      { x: 103, y: 123, w: 42, h: 24 },
      { x: 335, y: 123, w: 42, h: 24 },
    ],
  },
  {
    id: "corridors",
    name: "Боковые коридоры",
    obstacles: [
      { x: 58, y: 76, w: 22, h: 60 },
      { x: 58, y: 164, w: 22, h: 52 },
      { x: 400, y: 76, w: 22, h: 60 },
      { x: 400, y: 164, w: 22, h: 52 },
    ],
  },
  {
    id: "diagonal",
    name: "Диагональ",
    obstacles: [
      { x: 96, y: 75, w: 34, h: 18 },
      { x: 350, y: 75, w: 34, h: 18 },
      { x: 136, y: 184, w: 34, h: 18 },
      { x: 310, y: 184, w: 34, h: 18 },
      { x: 190, y: 120, w: 24, h: 16 },
      { x: 266, y: 120, w: 24, h: 16 },
    ],
  },
];

export function getRoomLayout(room) {
  if (room.type === "boss") return LAYOUTS[0];
  if (["start", "shop", "treasure", "secret"].includes(room.type)) return LAYOUTS[1];
  return LAYOUTS[room.encounterSeed % LAYOUTS.length];
}
