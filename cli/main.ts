/**
 * CLI 入口
 * 用法：
 *   npm run sim                        交互模式（玩家0手动，其余7个AI），seed 默认 1
 *   npm run sim -- --seed 42           指定 seed
 *   npm run sim -- --auto              全 AI 观战一局（冒烟测试）
 *   npm run sim -- --batch 100         批量跑 100 局并输出统计（AI 测试主入口）
 */
import * as readline from "node:readline";
import { createGame } from "../core/state";
import { createRng } from "../core/rng";
import { beginRound, resolveRound } from "../core/phase";
import { applyAction, type Action } from "../core/actions";
import { runBotTurn, createBot } from "../bot/random";
import { runAutoGame, runBatch, formatBatchStats } from "../bot/simulation";
import { validateConfig } from "../config/validate";
import { renderFinal, renderHumanSummary, renderBattleLog } from "./render";

function parseArgs(argv: string[]): { seed: number; mode: "interactive" | "auto" | "batch"; batch: number } {
  let seed = 1;
  let mode: "interactive" | "auto" | "batch" = "interactive";
  let batch = 0;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--seed") seed = Number(argv[i + 1]) || 1;
    if (argv[i] === "--auto") mode = "auto";
    if (argv[i] === "--batch") {
      mode = "batch";
      batch = Number(argv[i + 1]) || 0;
    }
  }
  return { seed, mode, batch };
}

const HELP = `命令：
  buy <0|1|2>      购买商店槽位
  sell <uid>       出售手牌/场上卡
  refresh          刷新商店（1金）
  up               升级商店（差多少经验付多少金币，一次性）
  place <uid> <1~6> 上阵/换位
  end              结束商店阶段
  help / quit`;

function parseAction(input: string): Action | null {
  const [cmd, a, b] = input.trim().split(/\s+/);
  const n = (s: string) => Number(s);
  switch (cmd) {
    case "buy":
      if (a === "0" || a === "1" || a === "2") return { type: "buy", player: 0, shopIndex: Number(a) as 0 | 1 | 2 };
      return null;
    case "sell":
      return Number.isInteger(n(a!)) ? { type: "sell", player: 0, cardUid: n(a!) } : null;
    case "refresh":
      return { type: "refresh", player: 0 };
    case "up":
      return { type: "upgradeShop", player: 0 };
    case "place":
      return Number.isInteger(n(a!)) && Number.isInteger(n(b!))
        ? { type: "move", player: 0, cardUid: n(a!), position: n(b!) }
        : null;
    case "end":
      return { type: "endShop", player: 0 };
    default:
      return null;
  }
}

async function interactive(seed: number) {
  const state = createGame(seed);
  const rng = createRng(seed);
  const bots = new Map(state.players.filter((p) => p.id !== 0).map((p) => [p.id, createBot(seed, p.id)]));
  beginRound(state, rng);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));

  for (;;) {
    const p = state.players[0]!;
    if (state.phase === "shop" && !p.shopDone) {
      console.log("\n" + renderHumanSummary(state));
      const input = await ask("\n> ");
      if (input === "quit") {
        console.log("已退出");
        break;
      }
      if (input === "help") {
        console.log(HELP);
        continue;
      }
      const action = parseAction(input);
      if (!action) {
        console.log(`未知命令：${input}（输入 help 查看）`);
        continue;
      }
      try {
        const events = applyAction(state, rng, action);
        for (const e of events) {
          if (e.type === "COMBINE") console.log(`✨ 三合一触发！获得金卡`);
        }
      } catch (err) {
        console.log(`操作失败：${(err as Error).message}`);
      }
      continue;
    }

    // AI 阶段 + 回合结算
    if (state.phase === "shop") {
      for (const p2 of state.players) {
        if (!p2.eliminated && !p2.shopDone) runBotTurn(state, rng, p2.id, bots.get(p2.id)!);
      }
    }
    const log = resolveRound(state, rng);
    if (state.phase === "ended") {
      console.log(renderFinal(state));
      break;
    }
    console.log(renderBattleLog(log, state));
  }
  rl.close();
}

function main() {
  const errors = validateConfig();
  if (errors.length > 0) {
    console.error("[uucard] 配置校验失败：");
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  const { seed, mode, batch } = parseArgs(process.argv.slice(2));
  console.log(`[uucard] 悠悠牌 MVP · seed=${seed}`);

  switch (mode) {
    case "batch": {
      if (batch <= 0) {
        console.error("--batch 需要正整数局数，如 --batch 100");
        process.exit(1);
      }
      console.log(formatBatchStats(runBatch(seed, batch)));
      return;
    }
    case "auto": {
      const state = runAutoGame(seed);
      console.log(renderFinal(state));
      console.log(`seed=${seed} 回合数=${state.round}`);
      return;
    }
    default:
      void interactive(seed);
  }
}

main();
