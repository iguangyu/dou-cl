'use strict';

const rulesMod = require('../core/rules');
const DouDizhu = require('./doudizhu');
const PaoDeKuai = require('./paodekuai');
const FiveTenK = require('./fivek');

const CLASSES = {
  doudizhu: DouDizhu,
  paodekuai: PaoDeKuai,
  fivek: FiveTenK,
};

function create(key) {
  const rules = rulesMod.get(key);
  if (!rules) throw new Error('未知玩法：' + key);
  const Cls = CLASSES[key];
  return new Cls(rules);
}

module.exports = {
  create: create,
  CLASSES: CLASSES,
  keys: Object.keys(CLASSES),
};
