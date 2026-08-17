/**
 * 文本渲染器（M3）：只读 GameState 输出可读文本，零逻辑
 * 将来图形 UI 替换本层
 */
import type { BattleEvent, GameState, PlayerState, CardInstance } from "../core/state";
import { alivePlayers } from "../core/state";
import { CARD_BY_ID } from "../config/cards";
import { expToUpgrade } from "../config/economy";

const QUALITY_LABEL: Record<string, string> = {
  green: "绿",
  blue: "蓝",
  purple: "紫",
  orange: "橙",
  gold: "金",
};

export function cardLabel(c: CardInstance): string {
  const config = CARD_BY_ID.get(c.configId)!;
  const lv = c.level === 2 ? "★金" : "";
  return `#${c.uid} ${config.name}${lv}(${QUALITY_LABEL[config.quality]}) ${c.atk}攻/${c.hp}血`;
}

export function renderShop(p: PlayerState): string {
  const lines: string[] = [];
  const upgradeCost = expToUpgrade(p.shopLevel);
  lines.push(
    `商店Lv${p.shopLevel} | 金币 ${p.gold} | 经验 ${p.exp}${upgradeCost !== null ? `/${upgradeCost}` : "（满级）"} | 免费刷新 ${p.freeRefresh}`,
  );
  lines.push(
    "商店: " +
      p.shop
        .map((id, i) => {
          if (id === null) return `[${i}] 空`;
          const c = CARD_BY_ID.get(id)!;
          return `[${i}] ${c.name}(${QUALITY_LABEL[c.quality]}) ${c.atk}攻/${c.hp}血 价${c.price}`;
        })
        .join("  |  "),
  );
  lines.push("手牌: " + (p.hand.map(cardLabel).join("  |  ") || "（空）"));
  const board = p.board
    .map((c, i) => {
      const pos = `${i + 1}${i < 3 ? "前" : "后"}`;
      return c ? `${pos}:${cardLabel(c)}` : `${pos}:空`;
    })
    .join("  |  ");
  lines.push("棋盘: " + board);
  return lines.join("\n");
}

export function renderScoreboard(state: GameState): string {
  const lines: string[] = [`第 ${state.round} 回合`];
  for (const p of state.players) {
    const tag = p.id === 0 ? "（你）" : p.eliminated ? "（出局）" : "";
    const rank = p.rank !== null ? ` 第${p.rank}名` : "";
    lines.push(`  玩家${p.id}${tag}: 血量 ${p.hp}/30${rank}`);
  }
  return lines.join("\n");
}

export function renderBattleLog(log: BattleEvent[], state: GameState): string {
  const lines: string[] = ["── 本回合战斗 ──"];
  const name = (uid: number) => {
    for (const p of state.players) {
      const c = p.board.find((x) => x !== null && x.uid === uid);
      if (c) return `${CARD_BY_ID.get(c.configId)!.name}#${uid}`;
      const h = p.hand.find((x) => x.uid === uid);
      if (h) return `${CARD_BY_ID.get(h.configId)!.name}#${uid}`;
    }
    return `#${uid}`;
  };
  for (const e of log) {
    switch (e.type) {
      case "BATTLE_START":
        lines.push(`玩家${e.a} vs 玩家${e.b}:`);
        break;
      case "ATTACK":
        lines.push(`  ${name(e.from)} → ${name(e.to)} -${e.dmg}`);
        break;
      case "DEATH":
        lines.push(`  ${name(e.who)} 阵亡`);
        break;
      case "BATTLE_END":
        if (e.winner === null) lines.push(`  ⚖ 平局（双方各扣 3）`);
        else {
          const hp = e.survivors.reduce((s, x) => s + x.hp, 0);
          lines.push(`  🏆 玩家${e.winner} 胜（存活血量 ${hp}）`);
        }
        break;
      case "COMBINE":
        lines.push(`  ✨ 三合一：${CARD_BY_ID.get(e.configId)!.name} 金卡`);
        break;
    }
  }
  return lines.join("\n");
}

export function renderFinal(state: GameState): string {
  const lines = ["═══ 对局结束 ═══"];
  const sorted = [...state.players].sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9));
  for (const p of sorted) {
    lines.push(`第${p.rank}名: 玩家${p.id}（剩余血量 ${p.hp}）`);
  }
  return lines.join("\n");
}

export function renderHumanSummary(state: GameState): string {
  return `${renderScoreboard(state)}\n\n${renderShop(state.players[0]!)}`;
}

export function aliveCount(state: GameState): number {
  return alivePlayers(state).length;
}
