/**
 * 确定性随机源（地基原则 2.1）
 * 全对局唯一的随机来源；禁止使用 Math.random() / Date.now()
 * mulberry32：seed 相同 → 序列完全相同 → 回放/联机校验的基础
 */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 从 Rng 抽取 [min, max] 整数（含两端） */
export function randInt(rng: Rng, min: number, max: number): number {
  if (min > max) throw new Error(`randInt: min(${min}) > max(${max})`);
  return min + Math.floor(rng() * (max - min + 1));
}

/** 从数组随机取一个元素（空数组抛错） */
export function pick<T>(rng: Rng, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error("pick: empty array");
  const i = randInt(rng, 0, arr.length - 1);
  return arr[i]!;
}

/** 按权重表抽取一个 key。weights 形如 { green: 70, blue: 20, ... }，合计应为 100 */
export function pickWeighted<T extends string>(
  rng: Rng,
  weights: Readonly<Record<T, number>>,
): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng() * total;
  for (const [key, w] of entries) {
    roll -= w;
    if (roll < 0) return key;
  }
  return entries[entries.length - 1]![0]; // 浮点容错兜底
}
