'use strict';
/* vi-forge · probe：打印真实数值（ELBO 轨迹、后验、混淆矩阵、精确证据对照、多种子健壮性） */

const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
new Function(html.match(/<script id="engine">([\s\S]*?)<\/script>/)[1])();
const VI = globalThis.VI;

function say(s) { console.log(s); }
function bar(v, n, ch) { let s = ''; const k = Math.max(0, Math.min(n, Math.round(v * n))); for (let i = 0; i < k; i++) s += (ch || '#'); return s; }

say('='.repeat(72));
say('  vi-forge · 变分推断 (Mean-Field CAVI) · 真实数值探针');
say('='.repeat(72));

/* ---------- 1. 特殊函数抽查 ---------- */
say('\n[1] 特殊函数抽查');
say('  digamma(1)   = ' + VI.digamma(1).toFixed(15) + '   (-γ = ' + (-0.5772156649015329).toFixed(15) + ')');
say('  digamma(0.5) = ' + VI.digamma(0.5).toFixed(15));
say('  lgamma(8)    = ' + VI.lgamma(8).toFixed(12) + '   (ln 5040 = ' + Math.log(5040).toFixed(12) + ')');
say('  lgamma(0.5)  = ' + VI.lgamma(0.5).toFixed(12) + '   (ln √π  = ' + Math.log(Math.sqrt(Math.PI)).toFixed(12) + ')');

/* ---------- 2. 主运行 ---------- */
const MEANS = [[-3.1, -3.0], [3.0, -3.2], [0.0, 3.3]];
const rng = VI.mulberry32(1234);
const data = VI.makeData(rng, MEANS, 70, 0.7);
const X = data.X, L = data.labels, K = 3;

const st = VI.caviBest(X, { K: K, seed: 42, restarts: 6 });

say('\n[2] CAVI 主运行 (K=3, N=' + X.length + ', D=2, σ²=0.49, σ₀²=25, α₀=0.5)');
say('  ELBO 轨迹 (' + st.elboHist.length + ' 次迭代):');
let prev = null;
st.elboHist.forEach((e, i) => {
  const d = prev === null ? '' : '  Δ=' + (e - prev).toExponential(2);
  say('    iter ' + String(i + 1).padStart(2) + '  ELBO = ' + e.toFixed(6) + d);
  prev = e;
});

say('\n  后验簇参数 q(μ_k):');
for (let k = 0; k < K; k++) {
  const sd = st.s2[k].map(Math.sqrt);
  say('    k=' + k + '  m=[' + st.m[k].map(v => v.toFixed(3)).join(', ') + ']' +
    '  σ=[' + sd.map(v => v.toFixed(3)).join(', ') + ']' +
    '  α=' + st.alpha[k].toFixed(2) + '  E[π]=' + (st.alpha[k] / st.alpha.reduce((a, b) => a + b, 0)).toFixed(4));
}
say('  真中心: ' + MEANS.map(v => '[' + v.join(', ') + ']').join('  '));

/* ---------- 3. 混淆矩阵 ---------- */
say('\n[3] 混淆矩阵（行=真实簇, 列=argmax r）');
const hard = VI.hardAssign(st.r);
const cm = [];
for (let k = 0; k < K; k++) cm.push(new Array(K).fill(0));
for (let n = 0; n < L.length; n++) cm[L[n]][hard[n]]++;
say('        ' + Array.from({ length: K }, (_, k) => ('  c' + k).padStart(7)).join(''));
for (let k = 0; k < K; k++) {
  say('   真 k=' + k + '  ' + cm[k].map(v => String(v).padStart(6)).join(' '));
}
say('  准确率(置换不变) = ' + (VI.clusterAcc(L, hard, K) * 100).toFixed(2) + '%');

/* ---------- 4. 责任度硬度 ---------- */
let maxR = 0, sumEnt = 0;
for (let n = 0; n < X.length; n++) {
  maxR = Math.max(maxR, Math.max(...st.r[n]));
  for (let k = 0; k < K; k++) if (st.r[n][k] > 0) sumEnt -= st.r[n][k] * Math.log(st.r[n][k]);
}
say('\n[4] 责任度 r_nk 统计');
say('  max_n,k r_nk = ' + maxR.toFixed(12) + '  (≈1 ⇒ 实质硬分配)');
say('  平均簇不确定性 H(r_n) = ' + (sumEnt / X.length).toExponential(2) + ' nats');

/* ---------- 5. 精确证据对照 ---------- */
say('\n[5] 精确 log 证据对照（穷举全部 K^N 分配）');
{
  const Xs = [[-2.2], [-1.8], [-2.0], [1.7], [2.1], [1.9]];
  const o = { K: 2, sigmaSq: 0.25, sigma0sq: 4, alpha0: 1.0 };
  const ev = VI.exactLogEvidence(Xs, o);
  const s = VI.caviBest(Xs, { K: 2, seed: 5, restarts: 8, sigmaSq: 0.25, sigma0sq: 4, alpha0: 1.0 });
  const el = s.elboHist[s.elboHist.length - 1];
  say('  N=6 K=2（穷举 64 项，D=1）');
  say('    精确 log p(X) = ' + ev.toFixed(9));
  say('    变分 ELBO     = ' + el.toFixed(9));
  say('    间隙          = ' + (ev - el).toFixed(9) + '   (ln 2 = ' + Math.log(2).toFixed(9) + ')');
  say('    ⇒ 均值场对称破缺代价 ≡ ln2：证据含 2 个标签互换的并列模式，均值场只占 1 个');
}
{
  let Xs = [];
  for (let i = 0; i < 12; i++) Xs.push([1.4 * Math.sin(i * 1.7) + 0.3 * i]);
  const o = { K: 1, sigmaSq: 0.49, sigma0sq: 25, alpha0: 0.5 };
  const ev = VI.exactLogEvidence(Xs, o);
  const s = VI.cavi(Xs, { K: 1, seed: 7, maxIter: 200, sigmaSq: 0.49, sigma0sq: 25, alpha0: 0.5 });
  const el = s.elboHist[s.elboHist.length - 1];
  const q = VI.k1ExactPosterior(Xs, o);
  say('\n  N=12 K=1（均值场精确 ⇒ 必须取等）');
  say('    精确 log p(X) = ' + ev.toFixed(12));
  say('    变分 ELBO     = ' + el.toFixed(12));
  say('    |Δ|           = ' + Math.abs(ev - el).toExponential(3));
  say('    q(μ) 均值 Δ   = ' + Math.abs(s.m[0][0] - q.mean[0]).toExponential(3) +
    '   q(μ) 方差 Δ = ' + Math.abs(s.s2[0][0] - q.variance[0]).toExponential(3));
}

/* ---------- 6. VI vs EM ---------- */
say('\n[6] 变分推断 vs ML-EM 对照（同一数据）');
const em = VI.em(X, { K: K, seed: 42 });
say('  CAVI  : 准确率 ' + (VI.clusterAcc(L, VI.hardAssign(st.r), K) * 100).toFixed(2) + '%' +
  '   最终 ELBO ' + st.elboHist[st.elboHist.length - 1].toFixed(4) +
  '   iters ' + st.iters);
say('  EM    : 准确率 ' + (VI.clusterAcc(L, VI.hardAssign(em.r), K) * 100).toFixed(2) + '%' +
  '   最终 loglik ' + em.llHist[em.llHist.length - 1].toFixed(4) +
  '   iters ' + em.iters);
say('  EM 中心: ' + em.m.map(v => '[' + v.map(x => x.toFixed(3)).join(',') + ']').join(' '));

/* ---------- 7. 多种子健壮性 ---------- */
say('\n[7] 多种子健壮性扫描（K=3 恢复准确率）');
say('  ' + 'seed'.padEnd(8) + 'accuracy   ELBO');
const seeds = [42, 1, 7, 99, 2026, 55, 314, 2718];
let mn = 100;
for (const s of seeds) {
  const t = VI.caviBest(X, { K: K, seed: s, restarts: 6 });
  const a = VI.clusterAcc(L, VI.hardAssign(t.r), K) * 100;
  mn = Math.min(mn, a);
  say('  ' + String(s).padEnd(8) + a.toFixed(2).padStart(7) + '%   ' +
    t.elboHist[t.elboHist.length - 1].toFixed(3) + '  ' + bar(a / 100, 28));
}
say('  最低 = ' + mn.toFixed(2) + '%');

say('\n[8] K 选择（ELBO 随 K 变化，本数据真 K=3）');
for (let kk = 1; kk <= 5; kk++) {
  const t = VI.caviBest(X, { K: kk, seed: 42, restarts: 6 });
  say('  K=' + kk + '  ELBO=' + t.elboHist[t.elboHist.length - 1].toFixed(3) +
    '  (Δ vs K-1: ' + (kk === 1 ? '-' : (t.elboHist[t.elboHist.length - 1] - VI.caviBest(X, { K: kk - 1, seed: 42, restarts: 6 }).elboHist.slice(-1)[0]).toFixed(3)) + ')');
}

say('\n' + '='.repeat(72));
say('  probe 结束');
say('='.repeat(72));
