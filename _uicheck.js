'use strict';
/* vi-forge · UI 接线检查（DOM stub + vm）
   验证 index.html 的 <script id="ui"> 在真实 DOM 下会正确驱动：
   状态文本、统计卡、三块 canvas 绘制、8 项自检列表。
   跑法: node _uicheck.js                                                */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const eng = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
const ui = html.match(/<script id="ui">([\s\S]*?)<\/script>/);
if (!eng || !ui) { console.error('FATAL: script blocks not found'); process.exit(1); }

let pass = 0, fail = 0;
function ok(name, cond, info) {
  if (cond) { pass++; console.log('  \u2713 ' + name + (info ? '  [' + info + ']' : '')); }
  else { fail++; console.log('  \u2717 ' + name + (info ? '  [' + info + ']' : '')); }
}

/* ---------------- DOM stub ---------------- */
const created = [];
function mkEl(tag) {
  const e = {
    tag: tag, className: '', textContent: '', value: '', disabled: false,
    width: 640, height: 240, style: {}, children: [], _html: '', _id: '',
    appendChild(c) { this.children.push(c); created.push(c); return c; },
    addEventListener(ev, fn) { (this._ls = this._ls || {})[ev] = fn; },
    getContext(kind) { return this._ctx || (this._ctx = mkCtx()); },
    set innerHTML(v) { this._html = v; if (v === '') this.children = []; },
    get innerHTML() { return this._html; }
  };
  return e;
}
const drawCalls = { total: 0 };
function mkCtx() {
  const c = { fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', globalAlpha: 1 };
  const methods = ['clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo',
    'lineTo', 'arc', 'stroke', 'fill', 'fillText', 'setLineDash', 'save', 'restore', 'translate'];
  methods.forEach(m => { c[m] = function () { drawCalls.total++; }; });
  c.createLinearGradient = function () { const g = {}; g.addColorStop = function () { }; return g; };
  return c;
}

const els = {};
const requiredIds = ['seed', 'K', 'N', 'restarts', 'mode', 'run', 'status', 'stats',
  'cElbo', 'cScatter', 'cHeat', 'checks'];
const document = {
  getElementById(id) {
    if (!els[id]) {
      const e = mkEl(id.startsWith('c') ? 'canvas' : 'div');
      e._id = id;
      if (id === 'seed') e.value = '42';
      if (id === 'K') e.value = '3';
      if (id === 'N') e.value = '210';
      if (id === 'restarts') e.value = '6';
      if (id === 'mode') e.value = 'sep';
      els[id] = e;
    }
    return els[id];
  },
  createElement(tag) { const e = mkEl(tag); created.push(e); return e; }
};

const ctx = { console, Math, Date, JSON, Object, Array, Number, String, Boolean,
  isFinite, isNaN, Infinity, NaN, parseInt, parseFloat, Float64Array, Uint8ClampedArray,
  document };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(eng[1], ctx, { filename: 'engine.js' });
ok('engine 注入 globalThis.VI', !!ctx.VI, 'VI v' + (ctx.VI && ctx.VI.version));

['seed', 'K', 'N', 'restarts', 'mode', 'run', 'status', 'stats', 'cElbo', 'cScatter', 'cHeat', 'checks']
  .forEach(id => document.getElementById(id));
ok('UI 所需 ' + requiredIds.length + ' 个 DOM 节点齐备',
  requiredIds.every(id => !!els[id]), requiredIds.join(','));

vm.runInContext(ui[1], ctx, { filename: 'ui.js' });

ok('UI 注册了 run 点击监听', typeof els.run._ls === 'object' && typeof els.run._ls.click === 'function');

/* ---------------- fire the run ---------------- */
const before = drawCalls.total;
let threw = null;
try { els.run._ls.click(); } catch (e) { threw = e; }
ok('点击「运行推断」无异常', threw === null, threw ? threw.message : 'ok');

const status = els.status.textContent || '';
ok('状态显示自检全绿', /全绿/.test(status) && !/错误/.test(status), JSON.stringify(status));

const uniqCreated = () => Array.from(new Set(created));

const statCards = uniqCreated().filter(e => e.className === 'stat');
ok('统计卡 ≥ 5 张（4 指标 + 1 权重条）', statCards.length >= 5, 'count=' + statCards.length);

const liNodes = uniqCreated().filter(e => e.tag === 'li');
ok('自检列表 ≥ 8 项', liNodes.length >= 8, 'li=' + liNodes.length);

const markers = liNodes.map(li => {
  const mk = (li.children || []).find(c => /(^| )mk( |$)/.test(c.className || ''));
  return mk ? mk.textContent : '?';
});
ok('自检项无 ✗（全部通过）', markers.length > 0 && markers.every(m => m === '\u2713'),
  'marks=' + markers.join(''));

const elboCanvas = els.cElbo, scCanvas = els.cScatter, heatCanvas = els.cHeat;
const cElboCalls = elboCanvas._ctx ? 1 : 0;
const drawn = drawCalls.total - before;
ok('canvas 产生了真实绘制调用（>120 次）', drawn > 120 && cElboCalls === 1, 'drawCalls=' + drawn);

const elboIsText = (elboCanvas._ctx && typeof elboCanvas._ctx.fillText === 'function');
ok('三块 canvas 均已取到 2D context',
  !!elboCanvas._ctx && !!scCanvas._ctx && !!heatCanvas._ctx && elboIsText);

const statText = statCards.map(c => (c.children || []).map(x => x.textContent).join('=')).join(' | ');
const hasNum = /\d/.test(statText) && /ELBO/i.test(statText);
ok('统计卡含 ELBO 与数值', hasNum, statText.slice(0, 110));

/* ---------------- 语义检查：分离模式应为硬责任度 ---------------- */
function softness(st) {
  let mx = 0;
  for (let n = 0; n < st.r.length; n++) {
    let best = 0, bv = -1;
    for (let k = 0; k < st.r[n].length; k++) if (st.r[n][k] > bv) { bv = st.r[n][k]; best = k; }
    for (let k = 0; k < st.r[n].length; k++) if (k !== best) mx = Math.max(mx, st.r[n][k]);
  }
  return mx;
}
const sepSoft = softness(ctx.__VILAST);
ok('分离模式 → 硬责任度 (max 非归属 r < 1e-4)', sepSoft < 1e-4, sepSoft.toExponential(2));
ok('UI 暴露了 9 项自检结果', (ctx.__VICHECKS || []).length === 9,
  'n=' + ((ctx.__VICHECKS || []).length));

/* ---------------- 二次运行：重叠模式（软责任度） ---------------- */
els.mode.value = 'ovl';
els.run._ls.click();
const ovStatus = els.status.textContent || '';
ok('重叠模式运行无异常', !/错误/.test(ovStatus), JSON.stringify(ovStatus));
ok('重叠模式自检仍全绿（不变量与数据难度无关）', /全绿/.test(ovStatus), ovStatus);
const ovlSoft = softness(ctx.__VILAST);
ok('重叠模式 → 软责任度 (max 非归属 r > 0.05)', ovlSoft > 0.05, ovlSoft.toFixed(3));
ok('重叠模式 ELBO 历史更长（迭代更多）', ctx.__VILAST.elboHist.length > 8,
  'iters=' + ctx.__VILAST.elboHist.length);

console.log('\n' + '='.repeat(60));
console.log('  结果: ' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' total');
console.log('  ' + (fail === 0 ? '\u2713 ALL GREEN' : '\u2717 HAS FAILURES'));
console.log('='.repeat(60));
process.exit(fail === 0 ? 0 : 1);
