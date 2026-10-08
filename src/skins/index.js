'use strict';

/**
 * 伪装皮肤注册表
 *
 * 设计原则：牌局信息一条都不删，只换壳。
 * 每个壳必须自洽 —— hex 是真字节、JSON 能解析、diff 能 apply、日志时间戳单调递增。
 * 这样盯屏幕的人看到的是「他在 dump 日志 / 看 diff」，而不是「他在打牌」。
 */

const hex = require('./hex');
const log = require('./log');
const json = require('./json');
const diff = require('./diff');
const packet = require('./packet');

const LIST = [log, hex, json, diff];
const MAP = {};
LIST.forEach(function (s) { MAP[s.key] = s; });

let current = null;   // null = 原生牌桌
let session = null;

function randHex(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)];
  return s;
}

function newSession() {
  return {
    pool: randHex(4).toUpperCase(),
    seq: 0,
    t0: Date.now(),
    clock: Date.now(),
    lastYaml: null,
  };
}
session = newSession();

function setKey(k) {
  if (!k || k === 'term' || k === 'off' || k === 'false') { current = null; session = newSession(); return; }
  if (!MAP[k]) throw new Error('没有这个皮肤：' + k);
  current = k;
  session = newSession();
  if (MAP[k].reset) MAP[k].reset(session);
}

/** 默认就是摸鱼模式 —— 只有显式选 term 才回原生牌桌 */
const DEFAULT_SKIN = 'log';
setKey(DEFAULT_SKIN);

function getKey() { return current || 'term'; }
function isActive() { return !!current; }
function currentSkin() { return current ? MAP[current] : null; }

/** 换一局 / 重开时重置，但保留皮肤选择 */
function reset() {
  session = newSession();
  if (current && MAP[current].reset) MAP[current].reset(session);
}

/** 伪装皮肤是多行追加输出，不清屏才像真的日志流 */
function appends() { return !!current; }

/**
 * @returns {null|string} null 表示走原生渲染
 */
function render(view, seat, opts) {
  if (!current) return null;
  const skin = MAP[current];
  session.seq++;
  session.clock = Math.max(Date.now(), session.clock + 37);
  const p = packet.build(view, seat);
  p.pool = session.pool;
  return skin.render(p, session);
}

function prompt() {
  if (!current) return null;
  return MAP[current].prompt();
}

function help(rules) {
  if (!current) return null;
  return MAP[current].help(rules);
}

function message(text) {
  if (!current) return null;
  return MAP[current].message(text);
}

/** 给菜单/--list-skins 用 */
function list() {
  return LIST.map(function (s) {
    return { key: s.key, name: s.name, desc: s.desc };
  });
}

module.exports = {
  DEFAULT_SKIN: DEFAULT_SKIN,
  setKey: setKey,
  getKey: getKey,
  isActive: isActive,
  currentSkin: currentSkin,
  reset: reset,
  appends: appends,
  render: render,
  prompt: prompt,
  help: help,
  message: message,
  list: list,
  packet: packet,
  session: function () { return session; },
};
