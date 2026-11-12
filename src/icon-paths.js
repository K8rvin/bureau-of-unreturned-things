const CHEST_ICONS = new Set(["locked-chest", "open-chest"]);

export function iconPath(icon) {
  if (!icon) return "assets/library/icons/echo-ripples.png";
  if (icon.startsWith("assets/")) return icon;
  const name = icon.endsWith(".svg") ? icon.slice(0, -4) : icon;
  return `assets/library/icons/${CHEST_ICONS.has(name) ? "chest" : name}.png`;
}
