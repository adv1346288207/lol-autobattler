/**
 * 配置合法性校验（启动 / 测试时执行）
 * 覆盖：商店概率、价格表、卡池规模、地区/职业分布、法力范围、技能与目标规则合法性、资产路径映射。
 */
import { CARD_POOL, HERO_CARDS, LEGACY_CARDS, DUPLICATOR_CARD, WEAPON_CARDS } from "./cards";
import type { CardConfig } from "./cards";
import { PROFESSIONS, REGIONS, TRAIT_BY_ID } from "./traits";
import { shopConfig } from "./shop";
import { economyConfig } from "./economy";
import type { SkillEffectName, TargetRule } from "../core/state";

const TARGET_RULES: TargetRule[] = [
  "frontmost",
  "backmost",
  "lowest_hp",
  "lowest_hp_backline",
  "current_target",
  "same_column",
  "all_enemies",
  "random_enemy",
  "random_backline",
  "self",
  "lowest_hp_ally",
  "all_allies",
  "random_ally",
  "same_as_previous",
];

const SKILL_EFFECTS: SkillEffectName[] = [
  "damage",
  "heal",
  "shield",
  "stun",
  "charm",
  "attack_buff",
  "damage_reduction",
  "break_shield",
  "mana_gain",
  "execute",
];

function checkStarPair(label: string, pair: readonly number[] | undefined, errors: string[], positive = true): void {
  if (!pair) return;
  if (pair.length !== 2) {
    errors.push(`${label} 星级数值必须是 [一星, 二星] 两项，当前 ${JSON.stringify(pair)}`);
    return;
  }
  for (const v of pair) {
    if (!Number.isFinite(v) || (positive ? v < 0 : v <= 0)) {
      errors.push(`${label} 数值非法：${v}`);
    }
  }
}

function validateHeroSkill(card: CardConfig, errors: string[]): void {
  const skill = card.skill;
  if (!skill) {
    errors.push(`英雄 ${card.id} 缺少主动技能配置`);
    return;
  }
  if (!skill.id || !skill.name || !skill.desc) {
    errors.push(`英雄 ${card.id} 技能缺少 id/name/desc`);
  }
  if (skill.steps.length === 0) {
    errors.push(`英雄 ${card.id} 技能步骤为空`);
  }
  for (const [i, step] of skill.steps.entries()) {
    const at = `英雄 ${card.id} 技能第 ${i + 1} 步`;
    if (!SKILL_EFFECTS.includes(step.effect)) errors.push(`${at} 未知效果 ${step.effect}`);
    if (!TARGET_RULES.includes(step.target)) errors.push(`${at} 未知目标规则 ${step.target}`);
    checkStarPair(`${at} value`, step.value, errors);
    checkStarPair(`${at} atkScale`, step.atkScale, errors, false);
    checkStarPair(`${at} hits`, step.hits, errors, false);
    checkStarPair(`${at} duration`, step.duration, errors, false);
    checkStarPair(`${at} maxTargets`, step.maxTargets, errors, false);
    checkStarPair(`${at} shieldPerHit`, step.shieldPerHit, errors);
    if (step.threshold) {
      checkStarPair(`${at} threshold`, step.threshold, errors, false);
      if (step.threshold.some((v) => v > 1)) errors.push(`${at} 斩杀阈值应 ≤ 1`);
    }
    if (step.ratio) checkStarPair(`${at} ratio`, step.ratio, errors, false);
    if (step.healRatioOfDamage) checkStarPair(`${at} healRatioOfDamage`, step.healRatioOfDamage, errors, false);
    if (
      !step.value &&
      !step.atkScale &&
      !step.shieldPerHit &&
      !step.ratio &&
      !step.duration &&
      !step.healRatioOfDamage &&
      step.effect !== "break_shield"
    ) {
      errors.push(`${at} 缺少数值（value / atkScale / shieldPerHit / ratio / duration / healRatioOfDamage）`);
    }
  }
  for (const [i, p] of card.passives.entries()) {
    if (!p.value && !p.ratio) errors.push(`英雄 ${card.id} 被动 ${i + 1} 缺少 value/ratio`);
    checkStarPair(`英雄 ${card.id} 被动 ${i + 1} value`, p.value, errors);
    checkStarPair(`英雄 ${card.id} 被动 ${i + 1} ratio`, p.ratio, errors, false);
  }
}

export function validateConfig(): string[] {
  const errors: string[] = [];

  // 概率表每行合计必须 100
  for (const row of shopConfig.qualityOdds) {
    const sum = row.green + row.blue + row.purple + row.orange + row.gold;
    if (sum !== 100) {
      errors.push(`商店等级 ${row.level} 概率合计=${sum}，应为 100`);
    }
  }

  // 卡价必须与价格表一致
  for (const card of CARD_POOL) {
    const expected = shopConfig.priceByQuality[card.quality];
    if (card.price !== expected) {
      errors.push(`卡牌 ${card.id}(${card.name}) 售价 ${card.price} ≠ 品质价目表 ${expected}`);
    }
    if (card.atk < 0 || card.hp < 0) {
      errors.push(`卡牌 ${card.id}(${card.name}) 攻血为负`);
    }
  }

  // 升级经验表单调递增
  for (let i = 1; i < economyConfig.upgradeExpCosts.length - 1; i++) {
    if (economyConfig.upgradeExpCosts[i]! >= economyConfig.upgradeExpCosts[i + 1]!) {
      errors.push(`升级经验表非单调递增（下标 ${i}）`);
    }
  }

  /* ── 卡池规模与唯一性 ── */
  if (HERO_CARDS.length !== 20) errors.push(`正式卡池英雄数应为 20，当前 ${HERO_CARDS.length}`);
  if (WEAPON_CARDS.length === 0) errors.push("武器卡池不能为空");
  const expectedPool = HERO_CARDS.length + 1 + WEAPON_CARDS.length;
  if (CARD_POOL.length !== expectedPool) {
    errors.push(`正式卡池应为 ${HERO_CARDS.length} 英雄 + 1 英雄复制器 + ${WEAPON_CARDS.length} 武器 = ${expectedPool}，当前 ${CARD_POOL.length}`);
  }
  const ids = new Set<string>();
  for (const card of [...CARD_POOL, ...LEGACY_CARDS]) {
    if (ids.has(card.id)) errors.push(`卡牌 ID 重复：${card.id}`);
    ids.add(card.id);
  }
  for (const legacyCard of LEGACY_CARDS) {
    if (CARD_POOL.some((c) => c.id === legacyCard.id)) {
      errors.push(`旧卡 ${legacyCard.id} 不得进入正式商店卡池 CARD_POOL`);
    }
  }

  /* ── 武器卡：不参与羁绊、走武器线万能牌 ── */
  const weaponWildcards = WEAPON_CARDS.filter((c) => c.wildcard === "weapon");
  if (weaponWildcards.length !== 1) {
    errors.push(`武器线应有且仅有 1 张金色万能牌，当前 ${weaponWildcards.length}`);
  }
  for (const card of WEAPON_CARDS) {
    if (card.type !== "weapon") errors.push(`WEAPON_CARDS 内出现非武器卡：${card.id}`);
    if (card.region !== null || card.professions.length > 0) {
      errors.push(`武器 ${card.id} 不得带地区或职业（不参与羁绊）`);
    }
    if (!card.itemId) errors.push(`武器 ${card.id} 缺少 itemId`);
    if (card.image !== `/assets/lol/items/${card.itemId}.png`) {
      errors.push(`武器 ${card.id} 图标路径格式不符合 /assets/lol/items/<itemId>.png`);
    }
    if (card.atk <= 0) errors.push(`武器 ${card.id} 攻击力必须为正`);
    if (card.skill !== null || card.maxMana !== 0) errors.push(`武器 ${card.id} 不应有主动技能或法力`);
    if (card.wildcard === "weapon" && card.quality !== "gold") {
      errors.push(`武器万能牌 ${card.id} 必须是金卡品质`);
    }
    if (card.wildcard === "role") errors.push(`武器 ${card.id} 不能是英雄线万能牌`);

    // 被动：绿卡与金色万能牌不带被动，蓝卡及以上各带且仅带 1 条
    const wantPassive = card.quality !== "green" && card.wildcard !== "weapon";
    if (wantPassive && card.passives.length !== 1) {
      errors.push(`武器 ${card.id} 应带且仅带 1 条被动，当前 ${card.passives.length}`);
    }
    if (!wantPassive && card.passives.length !== 0) {
      errors.push(`武器 ${card.id} 不应带被动（绿卡与金色万能牌只有数值）`);
    }
    for (const [i, p] of card.passives.entries()) {
      const at = `武器 ${card.id} 被动 ${i + 1}`;
      if (!p.value && !p.ratio) errors.push(`${at} 缺少 value/ratio`);
      checkStarPair(`${at} value`, p.value, errors);
      checkStarPair(`${at} ratio`, p.ratio, errors, false);
      if (!p.desc) errors.push(`${at} 缺少 desc（图鉴要展示）`);
      if (!card.weaponDesc?.includes("/") && p.value && p.value[0] !== p.value[1]) {
        // 一星/二星数值不同时，卡面说明必须写成 "a/b" 形式，避免玩家看不懂
        errors.push(`武器 ${card.id} 的 weaponDesc 应写出一星/二星两档数值`);
      }
    }
  }
  // 每个品质档在武器池里都要有卡，否则对应商店等级永远刷不出武器
  for (const quality of ["green", "blue", "purple", "orange", "gold"] as const) {
    if (!WEAPON_CARDS.some((c) => c.quality === quality)) {
      errors.push(`武器池缺少 ${quality} 品质的卡`);
    }
  }

  /* ── 英雄复制器：不参与羁绊、无技能 ── */
  if (DUPLICATOR_CARD.wildcard !== "role") errors.push("英雄复制器必须是 role 万能牌");
  if (DUPLICATOR_CARD.region !== null || DUPLICATOR_CARD.professions.length > 0) {
    errors.push("英雄复制器不得带地区或职业（不参与羁绊）");
  }
  if (DUPLICATOR_CARD.skill !== null || DUPLICATOR_CARD.maxMana !== 0) {
    errors.push("英雄复制器不得有主动技能或法力");
  }
  if (!CARD_POOL.some((c) => c.id === DUPLICATOR_CARD.id)) errors.push("英雄复制器必须在正式卡池内");

  /* ── 地区 / 职业分布 ── */
  const regionCount = new Map<string, number>();
  const professionCount = new Map<string, number>();
  for (const card of HERO_CARDS) {
    if (!card.region || !REGIONS.includes(card.region)) {
      errors.push(`英雄 ${card.id} 地区非法：${String(card.region)}`);
    } else {
      regionCount.set(card.region, (regionCount.get(card.region) ?? 0) + 1);
    }
    if (card.professions.length === 0 || card.professions.length > 2) {
      errors.push(`英雄 ${card.id} 职业数量必须为 1~2，当前 ${card.professions.length}`);
    }
    const seen = new Set<string>();
    for (const prof of card.professions) {
      if (!PROFESSIONS.includes(prof)) errors.push(`英雄 ${card.id} 职业非法：${prof}`);
      if (seen.has(prof)) errors.push(`英雄 ${card.id} 职业重复：${prof}`);
      seen.add(prof);
      professionCount.set(prof, (professionCount.get(prof) ?? 0) + 1);
    }
    if (card.type !== "hero") errors.push(`HERO_CARDS 内出现非英雄卡：${card.id}`);
    if (!card.dataDragonId) errors.push(`英雄 ${card.id} 缺少 dataDragonId`);
    if (card.image !== `/assets/lol/champions/${card.dataDragonId}.png`) {
      errors.push(`英雄 ${card.id} 头像路径格式不符合 /assets/lol/champions/<DataDragonId>.png`);
    }
    if (card.portrait !== `/assets/lol/portraits/${card.dataDragonId}.jpg`) {
      errors.push(`英雄 ${card.id} 立绘路径格式不符合 /assets/lol/portraits/<DataDragonId>.jpg`);
    }
    // 法力范围
    if (card.maxMana <= 0) errors.push(`英雄 ${card.id} maxMana 必须为正`);
    if (card.maxMana > 200) errors.push(`英雄 ${card.id} maxMana 超出范围（≤200）`);
    if (card.startMana < 0 || card.startMana > card.maxMana) {
      errors.push(`英雄 ${card.id} startMana(${card.startMana}) 必须在 0~maxMana(${card.maxMana}) 内`);
    }
    validateHeroSkill(card, errors);
  }
  for (const region of REGIONS) {
    const n = regionCount.get(region) ?? 0;
    if (n !== 4) errors.push(`地区 ${region} 应有 4 名英雄，当前 ${n}`);
  }
  for (const prof of PROFESSIONS) {
    const n = professionCount.get(prof) ?? 0;
    if (n < TRAIT_BY_ID.get(prof)!.thresholds[1]) {
      errors.push(`职业 ${prof} 人数 ${n} 不足以激活 4 人羁绊`);
    }
  }

  /* ── 羁绊配置 ── */
  for (const trait of TRAIT_BY_ID.values()) {
    if (trait.thresholds[0] !== 2 || trait.thresholds[1] !== 4) {
      errors.push(`羁绊 ${trait.id} 阈值应为 [2,4]，当前 ${JSON.stringify(trait.thresholds)}`);
    }
    if (trait.desc.length !== 2) errors.push(`羁绊 ${trait.id} 需要 2 人/4 人两档说明`);
  }

  return errors;
}
