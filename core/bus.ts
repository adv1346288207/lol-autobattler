/**
 * 事件总线（词条扩展点）
 * trigger 分发：快手/遗言/成长/消灭/护盾等将来全部挂在这里
 * 本期只实现 turn_start（商店阶段被动：兰/龙野）
 */
import type { CardInstance, PlayerState } from "./state";
import { CARD_BY_ID } from "../config/cards";
import { effectRegistry } from "./effects";

export type TriggerName =
  | "turn_start"
  | "on_attack"
  | "on_death"
  | "on_kill"
  | "on_battle_start"
  | "on_hurt"
  | "on_shop_refresh";

/** 触发某玩家全部卡牌（手牌 + 场上 1→6 顺序，保证确定性）的指定 trigger */
export function triggerForPlayer(player: PlayerState, trigger: TriggerName): void {
  const boardCards = player.board.filter((c): c is CardInstance => c !== null);
  for (const card of [...player.hand, ...boardCards]) {
    const config = CARD_BY_ID.get(card.configId);
    if (!config) continue;
    for (const skill of config.skills) {
      if (skill.trigger !== trigger) continue;
      const effect = effectRegistry[skill.effect];
      if (!effect) throw new Error(`triggerForPlayer: 未注册的效果 ${skill.effect}`);
      effect(player, skill.params, card.level);
    }
  }
}
