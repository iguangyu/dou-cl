'use strict';

/** 三种玩法的规则开关 */

const DOUDIZHU = {
  key: 'doudizhu',
  name: '斗地主',
  tagline: '3 人 · 17 张 + 3 张底牌 · 有叫分与春天',
  seats: 3,
  deck: { decks: 1, jokers: true },
  handSize: 17,
  bottom: 3,
  minStraight: 5,
  minStraightPair: 3,
  rocket: true,
  flushStraight: false,
  fiftyK: false,
  bid: true,
  teams: true,          // 地主 vs 农民
  baseScore: [1, 2, 3],
  help: [
    '牌型：单张 / 对子 / 三张 / 三带一 / 三带二 / 顺子(5张起) / 连对(3对起)',
    '      飞机(2连三张起，可带单或带对) / 四带二 / 四带两对 / 炸弹 / 王炸',
    '叫分：依次叫 1/2/3 分或不叫，最高者当地主，得 3 张底牌',
    '胜负：地主先出完 → 地主赢；任一农民先出完 → 农民赢',
    '倍数：每个炸弹/王炸 ×2，春天 ×2',
  ],
};

const PAODEKUAI = {
  key: 'paodekuai',
  name: '跑得快',
  tagline: '3 人 · 17 张 · 无大小王 · 先出完即赢',
  seats: 3,
  deck: { decks: 1, jokers: false },
  handSize: 17,
  bottom: 0,
  minStraight: 5,
  minStraightPair: 2,
  rocket: false,
  flushStraight: false,
  fiftyK: false,
  bid: false,
  teams: false,
  firstMoveMustHaveSpade3: true,
  help: [
    '牌型：单张 / 对子 / 三张 / 三带一 / 三带二 / 顺子(5张起) / 连对(2对起)',
    '      飞机(可带单或带对) / 四带二 / 四带两对 / 炸弹（无王炸）',
    '首手：持有 ♠3 的玩家先出，且第一手必须带上 ♠3',
    '胜负：谁先出完手牌谁赢，其余人按剩余张数结算',
  ],
};

const FIVEK = {
  key: 'fivek',
  name: '510K',
  tagline: '4 人 · 两副牌 · 27 张 · 5/10/K 计分',
  seats: 4,
  deck: { decks: 2, jokers: true },
  handSize: 27,
  bottom: 0,
  minStraight: 5,
  minStraightPair: 2,
  rocket: true,
  flushStraight: true,
  fiftyK: true,
  bid: false,
  teams: false,
  scoreRanks: { 5: 5, 10: 10, 13: 10 },
  help: [
    '牌型：单张 / 对子 / 三张 / 顺子(5张起) / 连对(2对起) / 飞机 / 同花顺',
    '      炸弹(4张及以上同点) / 王炸 / 五十K(同花色 5·10·K)',
    '五十K 是“通吃牌型”：除炸弹和王炸外，可以压任何牌型',
    '计分：5=5分，10=10分，K=10分，两副共 200 分',
    '      每一轮结束时，本轮桌面上的分牌全部归本轮最后出牌的人',
    '胜负：谁先出完手牌谁赢，得分作为副榜展示',
  ],
};

const ALL = {
  doudizhu: DOUDIZHU,
  paodekuai: PAODEKUAI,
  fivek: FIVEK,
};

module.exports = {
  DOUDIZHU: DOUDIZHU,
  PAODEKUAI: PAODEKUAI,
  FIVEK: FIVEK,
  ALL: ALL,
  get: function (key) { return ALL[key]; },
};
