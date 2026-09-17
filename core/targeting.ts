/**
 * 统一目标选择器（core/battle.ts 的战斗引擎专用）
 * 规则：
 * - 只返回存活单位；后排为空时回退前排（不会返回已死亡单位）
 * - 并列情况按 位置(1→6) → UID 升序 破同分，保证确定性
 * - 只有 random_* 规则才消耗战斗 RNG
 */
import type { TargetRule } from "./state";
import type { BattleContext, BattleUnit } from "./battle";
import { pick } from "./rng";

/** 位置 → 列（1/4 同列、2/5 同列、3/6 同列） */
export function columnOf(position: number): number {
  return (position - 1) % 3;
}

export function isBackline(unit: BattleUnit): boolean {
  return unit.position >= 4;
}

function byPosUid(a: BattleUnit, b: BattleUnit): number {
  return a.position - b.position || a.uid - b.uid;
}

function byHpPosUid(a: BattleUnit, b: BattleUnit): number {
  return a.hp - b.hp || a.position - b.position || a.uid - b.uid;
}

export function aliveEnemiesOf(ctx: BattleContext, self: BattleUnit): BattleUnit[] {
  return ctx.units.filter((u) => u.alive && u.owner !== self.owner).sort(byPosUid);
}

export function aliveAlliesOf(ctx: BattleContext, self: BattleUnit): BattleUnit[] {
  return ctx.units.filter((u) => u.alive && u.owner === self.owner).sort(byPosUid);
}

/** 后排（位置 4~6）；为空时按配置回退前排 */
function backlineOrFallback(enemies: BattleUnit[]): BattleUnit[] {
  const back = enemies.filter(isBackline);
  return back.length > 0 ? back : enemies;
}

/**
 * 选取目标。
 * @param current 本次行动已锁定的目标（current_target / same_column 用）；缺省时按 frontmost 推导
 * @param maxTargets 多目标上限（默认 1；all_* 忽略该值）
 */
export function selectTargets(
  ctx: BattleContext,
  rule: TargetRule,
  self: BattleUnit,
  current: BattleUnit | null = null,
  maxTargets = 1,
): BattleUnit[] {
  const enemies = aliveEnemiesOf(ctx, self);
  const allies = aliveAlliesOf(ctx, self);

  switch (rule) {
    case "frontmost": {
      return enemies.length > 0 ? [enemies[0]!] : [];
    }
    case "backmost": {
      const sorted = [...enemies].sort((a, b) => b.position - a.position || a.uid - b.uid);
      return sorted.length > 0 ? [sorted[0]!] : [];
    }
    case "current_target": {
      const locked = current && current.alive ? current : (enemies[0] ?? null);
      return locked ? [locked] : [];
    }
    case "lowest_hp": {
      const sorted = [...enemies].sort(byHpPosUid);
      return maxTargets > 1 ? sorted.slice(0, maxTargets) : sorted.slice(0, 1);
    }
    case "lowest_hp_backline": {
      const pool = backlineOrFallback(enemies);
      const sorted = [...pool].sort(byHpPosUid);
      return maxTargets > 1 ? sorted.slice(0, maxTargets) : sorted.slice(0, 1);
    }
    case "same_column": {
      const anchor = current && current.alive ? current : (enemies[0] ?? null);
      if (!anchor) return [];
      const col = columnOf(anchor.position);
      return enemies.filter((u) => columnOf(u.position) === col).sort(byPosUid);
    }
    case "all_enemies":
      return enemies;
    case "random_enemy":
      return enemies.length > 0 ? [pick(ctx.rng, enemies)] : [];
    case "random_backline": {
      const pool = backlineOrFallback(enemies);
      return pool.length > 0 ? [pick(ctx.rng, pool)] : [];
    }
    case "self":
      return self.alive ? [self] : [];
    case "lowest_hp_ally": {
      const sorted = [...allies].sort(byHpPosUid);
      return maxTargets > 1 ? sorted.slice(0, maxTargets) : sorted.slice(0, 1);
    }
    case "all_allies":
      return allies;
    case "random_ally":
      return allies.length > 0 ? [pick(ctx.rng, allies)] : [];
    case "same_as_previous":
      return current && current.alive ? [current] : [];
    default:
      return [];
  }
}

/** 该单位普攻锁定的目标（刺客类羁绊会覆盖为后排） */
export function basicAttackTarget(ctx: BattleContext, self: BattleUnit): BattleUnit | null {
  const rule: TargetRule = self.targetRule ?? "frontmost";
  const targets = selectTargets(ctx, rule, self);
  return targets[0] ?? null;
}
