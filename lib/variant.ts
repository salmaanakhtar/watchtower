// Positioning variant assignment (A/B/C/D test).
// Deterministic per-IP hash so repeat visitors see the same variant.

const VARIANTS = ["A", "B", "C", "D"] as const;
export type Variant = (typeof VARIANTS)[number];

export function hashVariant(key: string): Variant {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return VARIANTS[h % VARIANTS.length];
}
