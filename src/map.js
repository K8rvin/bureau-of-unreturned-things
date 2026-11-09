import { HEIGHT, WIDTH } from "./content.js";

const DIRECTIONS = {
  N: { dx: 0, dy: -1, opposite: "S" },
  S: { dx: 0, dy: 1, opposite: "N" },
  E: { dx: 1, dy: 0, opposite: "W" },
  W: { dx: -1, dy: 0, opposite: "E" },
};
const DIRECTION_NAMES = Object.keys(DIRECTIONS);
const ROOM_STYLES = {
  start: { color: "#f0d49b", label: "S" },
  combat: { color: "#b98478", label: "" },
  treasure: { color: "#e8bd67", label: "T" },
  shop: { color: "#81c9c3", label: "$" },
  challenge: { color: "#d48bc7", label: "!" },
  boss: { color: "#e47272", label: "B" },
  secret: { color: "#aa9adb", label: "?" },
  rift: { color: "#d6b0ef", label: "R" },
};

function secretEdgeFound(a, b) {
  return Boolean(a.secretFound || b.secretFound);
}

function secretIsKnown(room, byId) {
  if (room.secretFound) return true;
  return DIRECTION_NAMES.some((direction) => {
    const neighbor = byId.get(room.doors?.[direction]);
    return neighbor && neighbor.type !== "secret" && neighbor.secretFound;
  });
}

function createLayout(rooms, area, expanded) {
  const xs = rooms.map((room) => room.x);
  const ys = rooms.map((room) => room.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  const nodeSize = expanded ? 22 : 9;
  const maxStep = expanded ? 40 : 14;
  const fitX = spanX ? (area.width - nodeSize) / spanX : maxStep;
  const fitY = spanY ? (area.height - nodeSize) / spanY : maxStep;
  const step = Math.max(nodeSize + 3, Math.floor(Math.min(maxStep, fitX, fitY)));
  const mapWidth = spanX * step + nodeSize;
  const mapHeight = spanY * step + nodeSize;
  const originX = area.x + (area.width - mapWidth) / 2 + nodeSize / 2;
  const originY = area.y + (area.height - mapHeight) / 2 + nodeSize / 2;
  const points = new Map();
  for (const room of rooms) {
    points.set(room.id, {
      x: Math.round(originX + (room.x - minX) * step),
      y: Math.round(originY + (room.y - minY) * step),
    });
  }
  return { nodeSize, points };
}

function drawPanel(context, x, y, width, height, expanded) {
  context.fillStyle = expanded ? "rgba(12, 15, 21, 0.94)" : "rgba(12, 15, 21, 0.68)";
  context.fillRect(x, y, width, height);
  context.strokeStyle = expanded ? "#815a52" : "#55464b";
  context.lineWidth = 1;
  context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
}

function drawEdges(context, rooms, byId, visible, points, expanded) {
  const drawn = new Set();
  context.lineWidth = expanded ? 2 : 1;
  for (const room of rooms) {
    for (const direction of DIRECTION_NAMES) {
      const neighbor = byId.get(room.doors?.[direction]);
      if (!neighbor || !visible.has(neighbor.id)) continue;
      const key = JSON.stringify([room.id, neighbor.id].sort());
      if (drawn.has(key)) continue;
      drawn.add(key);
      const hidden = room.type === "secret" || neighbor.type === "secret";
      if (hidden && !secretEdgeFound(room, neighbor)) continue;
      const a = points.get(room.id);
      const b = points.get(neighbor.id);
      context.strokeStyle = hidden ? "#aa91c5" : "#75645a";
      context.setLineDash(hidden ? (expanded ? [5, 4] : [2, 2]) : []);
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.stroke();
    }
  }
  context.setLineDash([]);
}

function drawRoom(context, room, point, nodeSize, current, expanded) {
  const style = ROOM_STYLES[room.type] || { color: "#b7ad9f", label: "" };
  const left = Math.round(point.x - nodeSize / 2);
  const top = Math.round(point.y - nodeSize / 2);
  const active = room.visited || current;
  context.globalAlpha = active ? 1 : 0.68;
  context.fillStyle = room.cleared ? "#202a27" : "#271d25";
  context.fillRect(left, top, nodeSize, nodeSize);
  context.strokeStyle = style.color;
  context.lineWidth = expanded ? 2 : 1;
  context.setLineDash(room.cleared ? [] : (expanded ? [3, 2] : [2, 2]));
  context.strokeRect(left + 0.5, top + 0.5, nodeSize - 1, nodeSize - 1);
  context.setLineDash([]);

  if (style.label) {
    context.fillStyle = style.color;
    context.font = '8px "Archive Pixel", monospace';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(style.label, point.x, point.y + 0.5);
  } else {
    context.fillStyle = style.color;
    const dot = expanded ? 3 : 2;
    context.fillRect(point.x - dot / 2, point.y - dot / 2, dot, dot);
  }

  if (room.cleared) {
    context.strokeStyle = "#a7c995";
    context.lineWidth = expanded ? 2 : 1;
    context.beginPath();
    context.moveTo(left + 2, top + nodeSize - 2.5);
    context.lineTo(left + nodeSize - 2, top + nodeSize - 2.5);
    context.stroke();
  }

  if (current) {
    context.strokeStyle = "#fff0bd";
    context.lineWidth = expanded ? 2 : 1;
    context.strokeRect(left - 2.5, top - 2.5, nodeSize + 5, nodeSize + 5);
    context.fillStyle = "#fff0bd";
    context.beginPath();
    context.arc(point.x, top - (expanded ? 5 : 3), expanded ? 2 : 1, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}

function drawLensHints(context, room, byId, point, nodeSize, expanded) {
  if (!room || !Array.isArray(room.hidden)) return;
  for (const direction of room.hidden) {
    const data = DIRECTIONS[direction];
    if (!data) continue;
    const neighbor = byId.get(room.doors?.[direction]);
    if (!neighbor || secretEdgeFound(room, neighbor)) continue;
    const half = nodeSize / 2;
    const tipDistance = half + (expanded ? 8 : 5);
    const baseDistance = half + (expanded ? 3 : 1);
    const width = expanded ? 3 : 2;
    const tipX = point.x + data.dx * tipDistance;
    const tipY = point.y + data.dy * tipDistance;
    const baseX = point.x + data.dx * baseDistance;
    const baseY = point.y + data.dy * baseDistance;
    context.fillStyle = "#a4eee5";
    context.strokeStyle = "#193f43";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(tipX, tipY);
    context.lineTo(baseX - data.dy * width, baseY + data.dx * width);
    context.lineTo(baseX + data.dy * width, baseY - data.dx * width);
    context.closePath();
    context.fill();
    context.stroke();
  }
}

export function drawMap(context, floor, currentRoomId, { expanded = false, hasLens = false } = {}) {
  if (!context || !floor || !Array.isArray(floor.rooms) || !floor.rooms.length) return;
  const byId = new Map(floor.rooms.map((room) => [room.id, room]));
  const visibleRooms = floor.rooms.filter((room) => {
    if (room.type === "secret") return secretIsKnown(room, byId);
    return room.visited || room.id === currentRoomId;
  });
  if (!visibleRooms.length) return;
  const visible = new Set(visibleRooms.map((room) => room.id));

  context.save();
  if (expanded) {
    context.fillStyle = "rgba(5, 7, 12, 0.78)";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    drawPanel(context, 44, 22, 392, 226, true);
    context.fillStyle = "#f0d49b";
    context.font = '16px "Archive Pixel", monospace';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(floor.name || `Этаж ${floor.index + 1}`, WIDTH / 2, 39);
  } else {
    drawPanel(context, WIDTH - 134, 40, 126, 72, false);
  }

  const area = expanded
    ? { x: 60, y: 55, width: 360, height: 142 }
    : { x: WIDTH - 128, y: 46, width: 114, height: 60 };
  const { nodeSize, points } = createLayout(visibleRooms, area, expanded);
  drawEdges(context, visibleRooms, byId, visible, points, expanded);
  for (const room of visibleRooms) {
    drawRoom(context, room, points.get(room.id), nodeSize, room.id === currentRoomId, expanded);
  }
  if (hasLens) {
    const currentRoom = byId.get(currentRoomId);
    if (currentRoom && visible.has(currentRoomId)) {
      drawLensHints(context, currentRoom, byId, points.get(currentRoomId), nodeSize, expanded);
    }
  }

  if (expanded) {
    context.globalAlpha = 1;
    context.font = '8px "Archive Pixel", monospace';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#c5bcab";
    context.fillText("S старт   T склад   $ лавка   ! испытание", WIDTH / 2, 209);
    context.fillText("B босс   ? тайник", WIDTH / 2, 221);
    context.fillStyle = "#8f8580";
    context.fillText("светлая рамка — вы здесь", WIDTH / 2, 232);
    context.fillText("черта снизу — очищено", WIDTH / 2, 243);
  }
  context.restore();
}
