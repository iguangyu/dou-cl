'use strict';

let enabled = !!(process.stdout.isTTY && !process.env.NO_COLOR);

function setEnabled(v) { enabled = !!v; }

function wrap(code, s) {
  if (!enabled) return String(s);
  return '\u001b[' + code + 'm' + s + '\u001b[0m';
}

module.exports = {
  setEnabled: setEnabled,
  isEnabled: function () { return enabled; },
  red: function (s) { return wrap('31', s); },
  green: function (s) { return wrap('32', s); },
  yellow: function (s) { return wrap('33', s); },
  blue: function (s) { return wrap('34', s); },
  magenta: function (s) { return wrap('35', s); },
  cyan: function (s) { return wrap('36', s); },
  gray: function (s) { return wrap('90', s); },
  dim: function (s) { return wrap('2', s); },
  bold: function (s) { return wrap('1', s); },
  // 256 色，用于把牌面染成“日志配色”，比基础色更不显眼
  c256: function (n, s) { return wrap('38;5;' + n, s); },
};
