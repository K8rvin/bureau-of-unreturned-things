import { getFloorDefinition } from "./content.js";

const DIRECTIONS = {
  N: { dx: 0, dy: -1, opposite: "S" },
  S: { dx: 0, dy: 1, opposite: "N" },
  E: { dx: 1, dy: 0, opposite: "W" },
  W: { dx: -1, dy: 0, opposite: "E" },
};
const DIRECTION_NAMES = Object.keys(DIRECTIONS);
const SPECIAL_TYPES = ["treasure", "shop", "challenge", "secret"];
const EXPECTED_TYPES = {
  start: 1,
  combat: 3,
  treasure: 1,
  shop: 1,
  challenge: 1,
  boss: 1,
  secret: 1,
};
const MIN_BOSS_DISTANCE = 4;

const TEMPLATES = [
  {
    main: [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]],
    branches: [[0, 0], [1, 0], [2, 0], [3, 0]],
    secretSlots: [1, 2, 3],
  },
  {
    main: [[0, 0], [1, 0], [1, 1], [2, 1], [3, 1]],
    branches: [[0, -1], [1, -1], [1, 2], [2, 2]],
    secretSlots: [1, 2, 3],
  },
  {
    main: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]],
    branches: [[-1, 0], [-1, 1], [2, 1], [0, 2]],
    secretSlots: [3],
  },
];

function normalizeSeed(seed) {
  if (typeof seed === "number" && Number.isFinite(seed)) return seed >>> 0;
  const text = String(seed);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mix32(...values) {
  let hash = 0x811c9dc5;
  for (const value of values) {
    hash ^= value >>> 0;
    hash = Math.imul(hash, 0x01000193);
    hash ^= hash >>> 16;
    hash = Math.imul(hash, 0x7feb352d);
    hash ^= hash >>> 15;
  }
  return (hash ^ (hash >>> 16)) >>> 0;
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    let value = state += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function choose(random, values) {
  return values[Math.floor(random() * values.length)];
}

function shuffle(random, values) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

function transformPoint(point, rotation, mirrored) {
  let [x, y] = point;
  if (mirrored) x = -x;
  for (let i = 0; i < rotation; i++) [x, y] = [-y, x];
  return { x, y };
}

function directionBetween(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return DIRECTION_NAMES.find((direction) => {
    const data = DIRECTIONS[direction];
    return data.dx === dx && data.dy === dy;
  });
}

function connect(rooms, aIndex, bIndex) {
  const a = rooms[aIndex];
  const b = rooms[bIndex];
  const direction = directionBetween(a, b);
  if (!direction) throw new Error(`Non-adjacent rooms: ${a.id}, ${b.id}`);
  const opposite = DIRECTIONS[direction].opposite;
  a.doors[direction] = b.id;
  b.doors[opposite] = a.id;
  if (a.type === "secret" || b.type === "secret") {
    a.hidden.push(direction);
    b.hidden.push(opposite);
  }
}

function doorNeighbors(room, byId) {
  const neighbors = [];
  for (const direction of DIRECTION_NAMES) {
    const id = room.doors?.[direction];
    if (typeof id !== "string") continue;
    const neighbor = byId.get(id);
    if (neighbor) neighbors.push({ direction, neighbor });
  }
  return neighbors;
}

export function generateFloor(seed, floorIndex) {
  const definition = getFloorDefinition(floorIndex);
  const index = definition.index;
  const baseSeed = normalizeSeed(seed);
  const random = createRandom(mix32(baseSeed, index, 0x46c6));
  const template = choose(random, TEMPLATES);
  const rotation = Math.floor(random() * 4);
  const mirrored = random() < 0.5;
  const secretSlot = choose(random, template.secretSlots);
  const branchTypes = new Array(4);
  branchTypes[secretSlot] = "secret";
  const remainingTypes = shuffle(random, ["treasure", "shop", "challenge"]);
  for (let slot = 0; slot < 4; slot++) {
    if (slot !== secretSlot) branchTypes[slot] = remainingTypes.pop();
  }

  const points = [...template.main, ...template.branches].map((point) => transformPoint(point, rotation, mirrored));
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  for (const point of points) {
    point.x -= minX;
    point.y -= minY;
  }

  const types = ["start", "combat", "combat", "combat", "boss", ...branchTypes];
  const rooms = points.map((point, roomIndex) => {
    const type = types[roomIndex];
    return {
      id: `r${roomIndex}`,
      x: point.x,
      y: point.y,
      type,
      doors: { N: undefined, S: undefined, E: undefined, W: undefined },
      hidden: [],
      visited: type === "start",
      cleared: type === "start" || type === "shop" || type === "secret" || type === "treasure",
      rewardClaimed: false,
      secretFound: false,
      loreFound: false,
      stock: null,
      encounterSeed: mix32(baseSeed, index, roomIndex, 0xe1c0),
    };
  });

  for (let i = 0; i < 4; i++) {
    connect(rooms, i, i + 1);
    connect(rooms, i, i + 5);
  }

  const loopCandidates = [];
  for (let a = 0; a < 4; a++) {
    if (a === secretSlot) continue;
    for (let b = a + 1; b < 4; b++) {
      if (b === secretSlot) continue;
      if (directionBetween(rooms[a + 5], rooms[b + 5])) loopCandidates.push([a + 5, b + 5]);
    }
  }
  if (!loopCandidates.length) throw new Error("Floor template has no available loop");
  connect(rooms, ...choose(random, loopCandidates));

  for (const room of rooms) {
    room.hidden.sort((a, b) => DIRECTION_NAMES.indexOf(a) - DIRECTION_NAMES.indexOf(b));
  }

  return {
    index,
    name: definition.name,
    bossType: definition.bossType,
    startId: "r0",
    bossId: "r4",
    secretId: `r${secretSlot + 5}`,
    rooms,
  };
}

export function validateFloor(floor) {
  const errors = [];
  if (!floor || !Array.isArray(floor.rooms)) return ["rooms: expected an array"];
  const rooms = floor.rooms;
  if (rooms.length !== 9) errors.push(`rooms: expected 9, got ${rooms.length}`);

  const byId = new Map();
  const counts = {};
  for (let index = 0; index < rooms.length; index++) {
    const room = rooms[index];
    if (!room || typeof room.id !== "string" || !room.id) {
      errors.push(`room ${index}: missing string id`);
      continue;
    }
    if (byId.has(room.id)) errors.push(`room ${room.id}: duplicate id`);
    byId.set(room.id, room);
    counts[room.type] = (counts[room.type] || 0) + 1;
    if (!Object.hasOwn(EXPECTED_TYPES, room.type)) errors.push(`room ${room.id}: unknown type ${room.type}`);
    if (!Number.isFinite(room.x) || !Number.isFinite(room.y)) errors.push(`room ${room.id}: invalid coordinates`);
    if (!Number.isFinite(room.encounterSeed)) errors.push(`room ${room.id}: invalid encounterSeed`);
  }
  for (const [type, expected] of Object.entries(EXPECTED_TYPES)) {
    if (counts[type] !== expected) errors.push(`types: expected ${expected} ${type}, got ${counts[type] || 0}`);
  }

  for (const [key, type] of [["startId", "start"], ["bossId", "boss"], ["secretId", "secret"]]) {
    const id = floor[key];
    if (typeof id !== "string") {
      errors.push(`${key}: expected a string`);
      continue;
    }
    const room = byId.get(id);
    if (!room) errors.push(`${key}: unknown room ${id}`);
    else if (room.type !== type) errors.push(`${key}: ${id} is ${room.type}, expected ${type}`);
  }

  const adjacency = new Map([...byId.keys()].map((id) => [id, new Set()]));
  const edges = new Set();
  for (const room of byId.values()) {
    if (!room.doors || typeof room.doors !== "object") {
      errors.push(`room ${room.id}: doors must be an object`);
      continue;
    }
    for (const key of Object.keys(room.doors)) {
      if (!Object.hasOwn(DIRECTIONS, key)) errors.push(`room ${room.id}: unknown door direction ${key}`);
    }
    for (const direction of DIRECTION_NAMES) {
      const neighborId = room.doors[direction];
      if (neighborId === undefined || neighborId === null) continue;
      if (typeof neighborId !== "string") {
        errors.push(`room ${room.id}: door ${direction} must contain a room id`);
        continue;
      }
      const neighbor = byId.get(neighborId);
      if (!neighbor) {
        errors.push(`room ${room.id}: door ${direction} points to unknown room ${neighborId}`);
        continue;
      }
      if (neighbor.id === room.id) errors.push(`room ${room.id}: door ${direction} points to itself`);
      adjacency.get(room.id).add(neighborId);
      edges.add(JSON.stringify([room.id, neighborId].sort()));

      const data = DIRECTIONS[direction];
      if (neighbor.doors?.[data.opposite] !== room.id) {
        errors.push(`doors: ${room.id} ${direction} is not reciprocal with ${neighborId}`);
      }
      if (Number.isFinite(room.x) && Number.isFinite(room.y) && Number.isFinite(neighbor.x) && Number.isFinite(neighbor.y)
        && (neighbor.x - room.x !== data.dx || neighbor.y - room.y !== data.dy)) {
        errors.push(`doors: ${room.id} ${direction} is not geometrically adjacent to ${neighborId}`);
      }

      if ((room.type === "secret") !== (neighbor.type === "secret")) {
        if (!Array.isArray(room.hidden) || !room.hidden.includes(direction)) {
          errors.push(`secret: ${room.id} is missing hidden direction ${direction}`);
        }
        if (!Array.isArray(neighbor.hidden) || !neighbor.hidden.includes(data.opposite)) {
          errors.push(`secret: ${neighbor.id} is missing hidden direction ${data.opposite}`);
        }
      }
    }
  }

  for (const room of byId.values()) {
    if (!Array.isArray(room.hidden)) {
      errors.push(`room ${room.id}: hidden must be an array`);
      continue;
    }
    const seen = new Set();
    for (const direction of room.hidden) {
      if (!Object.hasOwn(DIRECTIONS, direction)) {
        errors.push(`room ${room.id}: unknown hidden direction ${direction}`);
        continue;
      }
      if (seen.has(direction)) errors.push(`room ${room.id}: duplicate hidden direction ${direction}`);
      seen.add(direction);
      const neighbor = byId.get(room.doors?.[direction]);
      if (!neighbor || (room.type === "secret") === (neighbor.type === "secret")) {
        errors.push(`room ${room.id}: hidden ${direction} does not lead between a normal and secret room`);
        continue;
      }
      if (!Array.isArray(neighbor.hidden) || !neighbor.hidden.includes(DIRECTIONS[direction].opposite)) {
        errors.push(`secret: hidden ${room.id} ${direction} is not reciprocal`);
      }
    }
  }

  let distances = new Map();
  if (byId.has(floor.startId)) {
    distances = new Map([[floor.startId, 0]]);
    const queue = [floor.startId];
    for (let head = 0; head < queue.length; head++) {
      const id = queue[head];
      for (const neighborId of adjacency.get(id) || []) {
        if (distances.has(neighborId)) continue;
        distances.set(neighborId, distances.get(id) + 1);
        queue.push(neighborId);
      }
    }
    if (distances.size !== byId.size) errors.push(`connectivity: reached ${distances.size} of ${byId.size} rooms`);
  } else {
    errors.push("connectivity: no valid start room");
  }

  if (byId.has(floor.bossId)) {
    const distance = distances.get(floor.bossId);
    if (distance === undefined) errors.push("boss: unreachable from start");
    else if (distance < MIN_BOSS_DISTANCE) errors.push(`boss: distance ${distance}, expected at least ${MIN_BOSS_DISTANCE}`);
  }
  if (edges.size < rooms.length) errors.push(`loops: expected at least one additional loop, got ${edges.size} edges`);

  const secret = rooms.find((room) => room?.type === "secret");
  if (secret && byId.get(secret.id) === secret) {
    const neighbors = doorNeighbors(secret, byId);
    if (neighbors.length !== 1) errors.push(`secret: expected one neighboring combat, got ${neighbors.length}`);
    for (const { neighbor } of neighbors) {
      if (neighbor.type !== "combat") errors.push(`secret: neighbor ${neighbor.id} must be combat`);
    }
    for (const id of [floor.startId, floor.bossId]) {
      const room = byId.get(id);
      if (room && Math.abs(room.x - secret.x) + Math.abs(room.y - secret.y) === 1) {
        errors.push(`secret: geometrically adjacent to ${room.type}`);
      }
    }
  }

  const anchors = new Map();
  for (const type of SPECIAL_TYPES) {
    const room = rooms.find((candidate) => candidate?.type === type);
    if (!room) continue;
    const normalNeighbors = doorNeighbors(room, byId).filter(({ neighbor }) => !SPECIAL_TYPES.includes(neighbor.type));
    if (normalNeighbors.length !== 1) {
      errors.push(`branches: ${room.id} must have one normal-room anchor, got ${normalNeighbors.length}`);
      continue;
    }
    const anchorId = normalNeighbors[0].neighbor.id;
    if (anchors.has(anchorId)) errors.push(`branches: ${anchors.get(anchorId)} and ${room.id} share anchor ${anchorId}`);
    else anchors.set(anchorId, room.id);
  }

  return errors;
}
