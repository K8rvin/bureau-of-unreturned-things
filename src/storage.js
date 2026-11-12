const RUN_KEY = "library.run.v1";

export function saveCheckpoint(snapshot) {
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify({ ...snapshot, version: 2, savedAt: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function loadCheckpoint() {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.version !== 2 || !Number.isInteger(data.seed) || !Array.isArray(data.rooms) || typeof data.currentRoomId !== "string") {
      localStorage.removeItem(RUN_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function clearCheckpoint() {
  try {
    localStorage.removeItem(RUN_KEY);
  } catch {
    return;
  }
}
