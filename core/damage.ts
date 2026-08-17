/**
 * 伤害结算与淘汰（M2）
 * - 胜方：按 BATTLE_END 存活卡剩余血量总和 → 饱和曲线 → 扣败方血（封顶 30）
 * - 平局：双方各扣固定值 3
 * - 血量归零出局，名次 = 出局时场上存活人数（第一个出局 = 第 8 名）
 */
import type { BattleEvent, GameState } from "./state";
import { alivePlayers } from "./state";
import { damageConfig, damageFromSurvivingHp } from "../config/damage";

function applyDamage(state: GameState, playerId: number, dmg: number): void {
  const p = state.players[playerId]!;
  p.hp = Math.max(0, p.hp - dmg);
  if (p.hp <= 0 && !p.eliminated) {
    p.rank = alivePlayers(state).length; // 先算存活数（含自己）：第一个出局 = 第 8 名
    p.eliminated = true;
  }
}

export function applyBattleResult(
  state: GameState,
  aId: number,
  bId: number,
  events: BattleEvent[],
): void {
  const end = events[events.length - 1];
  if (!end || end.type !== "BATTLE_END") {
    throw new Error("applyBattleResult: 事件日志缺少 BATTLE_END");
  }
  if (end.winner === null) {
    applyDamage(state, aId, damageConfig.drawDamage);
    applyDamage(state, bId, damageConfig.drawDamage);
    return;
  }
  const loserId = end.winner === aId ? bId : aId;
  const survivorHp = end.survivors
    .filter((s) => s.player === end.winner)
    .reduce((sum, s) => sum + s.hp, 0);
  applyDamage(state, loserId, damageFromSurvivingHp(survivorHp));
}
