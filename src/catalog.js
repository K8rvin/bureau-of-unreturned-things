const KEY = "bureau.catalog.v1";
const EMPTY = { items: [], bosses: [], synergies: [], secrets: [] };

export class Catalog {
  constructor() {
    this.data = this.read();
  }

  read() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || "null");
      const result = {};
      for (const key of Object.keys(EMPTY)) result[key] = Array.isArray(parsed?.[key]) ? [...new Set(parsed[key])] : [];
      return result;
    } catch {
      return structuredClone(EMPTY);
    }
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      return;
    }
  }

  record(kind, id) {
    if (!EMPTY[kind] || !id || this.data[kind].includes(id)) return false;
    this.data[kind].push(id);
    this.save();
    return true;
  }

  has(kind, id) {
    return Boolean(EMPTY[kind] && this.data[kind].includes(id));
  }

  count(kind) {
    return this.data[kind]?.length || 0;
  }
}
