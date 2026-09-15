'use strict';
/* vi-forge · 无头不变量验证（16 条）
   跑法: node _smoke.js
   引擎从 index.html 的 <script id="engine"> 中提取，原生执行（无 DOM）。 */

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const m = html.match(/<script id="engine">([\s\S]*?)<\/script>/);
if (!m) { console.error('FATAL: engine script not found'); process.exit(1); }
new Function(m[1])();
const VI = globalThis.VI;
if (!VI) { console.error('FATAL: globalThis.VI missing'); process.exit(1); }

let pass = 0, fail = 0;
function ok(name, cond, info) {
  if (cond) { pass++; console.log('  \u2713 ' + name + (info ? '  [' + info + ']' : '')); }
  else { fail++; console.log('  \u2717 ' + name + (info ? '  [' + info + ']' : '')); }
}
function section(t) { console.log('\n' + t); }

const GAMMA = 0.5772156649015329;

/* ===================== A. 特殊函数 ===================== */
section('A. 特殊函数（digamma / lgamma）');

{
  let mx = 0;
  const xs = [0.3, 0.7, 1.5, 2.9, 4.2, 9.7, 23.5];
  for (const x of xs) mx = Math.max(mx, Math.abs(VI.digamma(x + 1) - (VI.digamma(x) + 1 / x)));
  ok('digamma 递推 ψ(x+1)=ψ(x)+1/x', mx < 1e-11, 'maxAbs=' + mx.toExponential(2));
}

{
  const t1 = Math.abs(VI.digamma(1) - (-GAMMA));
  const t2 = Math.abs(VI.digamma(2) - (1 - GAMMA));
  const t3 = Math.abs(VI.digamma(0.5) - (-GAMMA - 2 * Math.log(2)));
  const mx = Math.max(t1, t2, t3);
  ok('digamma 已知值 ψ(1),ψ(2),ψ(1/2)', mx < 1e-11, 'maxAbs=' + mx.toExponential(2));
}

{
  let mx = 0;
  for (const x of [0.4, 1.0, 2.5, 5.0, 11.3]) {
    mx = Math.max(mx, Math.abs(VI.lgamma(x + 1) - (Math.log(x) + VI.lgamma(x))));
  }
  const t1 = Math.abs(VI.lgamma(1));
  const t2 = Math.abs(VI.lgamma(5) - Math.log(24));
  const t3 = Math.abs(VI.lgamma(0.5) - Math.log(Math.sqrt(Math.PI)));
  mx = Math.max(mx, t1, t2, t3);
  ok('lgamma 递推 Γ(x+1)=xΓ(x) + 已知值', mx < 1e-10, 'maxAbs=' + mx.toExponential(2));
}

/* ===================== B. 数据 + CAVI 主运行 ===================== */
section('B. CAVI 主运行（well-separated, K=3, N=210, D=2）');

const rng = VI.mulberry32(1234);
const MEANS = [[-3.1, -3.0], [3.0, -3.2], [0.0, 3.3]];
const data = VI.makeData(rng, MEANS, 70, 0.7);
const X = data.X, LABELS = data.labels, K = 3;
const OPTS = { K: K, seed: 42, restarts: 6 };

let st;
{
  const t0 = Date.now();
  st = VI.caviBest(X, OPTS);
  console.log('  (耗时 ' + (Date.now() - t0) + ' ms, iters=' + st.iters + ', ELBO=' +
    st.elboHist[st.elboHist.length - 1].toFixed(4) + ')');
}

{
  let minD = Infinity;
  for (let i = 1; i < st.elboHist.length; i++) minD = Math.min(minD, st.elboHist[i] - st.elboHist[i - 1]);
  ok('ELBO 全历史单调不减（CAVI 定理）', minD > -1e-8,
    'iters=' + st.elboHist.length + ' minΔ=' + minD.toExponential(2));
}

{
  let mx = 0;
  for (let n = 0; n < X.length; n++) {
    let s = 0;
    for (let k = 0; k < K; k++) s += st.r[n][k];
    mx = Math.max(mx, Math.abs(s - 1));
  }
  ok('责任度行和 = 1', mx < 1e-10, 'maxDev=' + mx.toExponential(2));
}

{
  let bad = 0;
  for (let n = 0; n < X.length; n++) for (let k = 0; k < K; k++) {
    const v = st.r[n][k];
    if (!(v >= -1e-15 && v <= 1 + 1e-15)) bad++;
  }
  ok('责任度 r_nk ∈ [0,1]', bad === 0, 'violations=' + bad);
}

{
  let asum = 0, epiSum = 0, allPos = true;
  for (let k = 0; k < K; k++) { asum += st.alpha[k]; if (st.alpha[k] <= 0) allPos = false; }
  for (let k = 0; k < K; k++) epiSum += st.alpha[k] / asum;
  ok('E[π] 之和 = 1 且 αₖ > 0', allPos && Math.abs(epiSum - 1) < 1e-12,
    'Σα=' + asum.toFixed(4) + ' ΣE[π]=' + epiSum.toFixed(15));
}

{
  let ok5 = true, minPrec = Infinity;
  for (let k = 0; k < K; k++) for (let d = 0; d < X[0].length; d++) {
    const prec = 1 / st.s2[k][d];
    if (!isFinite(prec) || prec < 1 / 25 - 1e-12) ok5 = false;
    minPrec = Math.min(minPrec, prec);
  }
  ok('q(μ) 精度 ≥ 先验精度 1/σ₀²', ok5, 'minPrec=' + minPrec.toFixed(4) + ' vs prior=' + (1 / 25).toFixed(4));
}

{
  const hard = VI.hardAssign(st.r);
  const acc = VI.clusterAcc(LABELS, hard, K);
  ok('均值场恢复簇准确率 > 99%', acc > 0.99, (acc * 100).toFixed(2) + '%');
}

{
  // q(mu) mean must equal the closed-form prior-shrunk cluster mean:
  //   m_k = (mu0/s0^2 + sum_{i in C_k} x_i / s^2) / (1/s0^2 + n_k/s^2)
  const hard = VI.hardAssign(st.r);
  const S2 = 0.49, S02 = 25, MU0 = 0;
  const nk = new Array(K).fill(0), sum = [];
  for (let k = 0; k < K; k++) sum.push([0, 0]);
  for (let n = 0; n < X.length; n++) {
    const k = hard[n]; nk[k]++;
    sum[k][0] += X[n][0]; sum[k][1] += X[n][1];
  }
  let md = 0, tail = 0;
  for (let k = 0; k < K; k++) {
    const prec = 1 / S02 + nk[k] / S2;
    for (let d = 0; d < 2; d++) {
      const exact = (MU0 / S02 + sum[k][d] / S2) / prec;
      md = Math.max(md, Math.abs(st.m[k][d] - exact));
    }
  }
  // 残差量级应与「责任度软尾」一致（r 非精确 0/1）
  for (let n = 0; n < X.length; n++) for (let k = 0; k < K; k++) {
    if (k !== hard[n]) tail = Math.max(tail, st.r[n][k]);
  }
  ok('q(μ) 均值 == 解析先验收缩解（残差 ≤ 责任度软尾 1e-6）', md < 1e-6,
    'maxΔ=' + md.toExponential(2) + ' · max 非归属 r=' + tail.toExponential(2));
}

{
  // statistical consistency: |learned centre - true generative centre| < 4 sigma/sqrt(n_k)
  const hard = VI.hardAssign(st.r);
  const nk = new Array(K).fill(0);
  for (let n = 0; n < X.length; n++) nk[hard[n]]++;
  // match components to true centres by permutation-invariant sort
  const lk = st.m.map((v, i) => ({ v: v, i: i })).sort((a, b) => (a.v[0] + a.v[1]) - (b.v[0] + b.v[1]));
  const tk = MEANS.map(v => v.slice()).sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
  let md = 0, thr = 0;
  for (let k = 0; k < K; k++) {
    const t = 4 * 0.7 / Math.sqrt(Math.max(1, nk[lk[k].i]));
    thr = Math.max(thr, t);
    for (let d = 0; d < 2; d++) md = Math.max(md, Math.abs(lk[k].v[d] - tk[k][d]));
  }
  ok('|后验均值 − 真中心| < 4σ/√nₖ（统计一致性）', md < thr,
    'maxΔ=' + md.toFixed(4) + ' vs 界=' + thr.toFixed(4));
}

{
  const A = VI.caviBest(X, OPTS), B = VI.caviBest(X, OPTS);
  let same = A.elboHist.length === B.elboHist.length;
  for (let i = 0; same && i < A.elboHist.length; i++) if (A.elboHist[i] !== B.elboHist[i]) same = false;
  ok('确定性：两次运行 ELBO 历史逐位一致', same, 'iters=' + A.elboHist.length);
}

{
  let finite = true;
  for (let k = 0; k < K; k++) {
    for (let d = 0; d < 2; d++) if (!isFinite(st.m[k][d]) || !isFinite(st.s2[k][d])) finite = false;
    if (!isFinite(st.alpha[k])) finite = false;
  }
  for (let i = 0; i < st.elboHist.length; i++) if (!isFinite(st.elboHist[i])) finite = false;
  ok('无 NaN / Inf（参数 + ELBO 历史）', finite, 'all finite');
}

{
  const fin = st.elboHist[st.elboHist.length - 1];
  let ge = true;
  for (let i = 0; i < st.runs.length; i++) if (st.runs[i] > fin + 1e-9) ge = false;
  ok('最优重启的 ELBO ≥ 每个单次重启', ge, 'best=' + fin.toFixed(4) + ' runs=[' + st.runs.map(v => v.toFixed(2)).join(',') + ']');
}

/* ===================== C. 精确证据上界（穷举） ===================== */
section('C. 精确 log 证据交叉验证');

{
  const Xs = [[-2.2], [-1.8], [-2.0], [1.7], [2.1], [1.9]];
  const ex = { K: 2, sigmaSq: 0.25, sigma0sq: 4, alpha0: 1.0 };
  const eExact = VI.exactLogEvidence(Xs, ex);
  const s = VI.caviBest(Xs, { K: 2, seed: 5, restarts: 8, sigmaSq: 0.25, sigma0sq: 4, alpha0: 1.0 });
  const eElbo = s.elboHist[s.elboHist.length - 1];
  const gap = eExact - eElbo;
  console.log('  (exact=' + eExact.toFixed(9) + '  elbo=' + eElbo.toFixed(9) +
    '  gap=' + gap.toFixed(9) + '  ln2=' + Math.log(2).toFixed(9) + ')');
  ok('ELBO ≤ 精确 log p(X)（变分下界成立）', gap >= -1e-9, 'gap=' + gap.toExponential(3));
  // 对称破缺的精确代价：证据 = 2 个并列模式(标签互换)，均值场只占 1 个 ⇒ gap ≡ ln 2
  ok('下界间隙 ≡ ln 2（均值场对称破缺的精确代价）', Math.abs(gap - Math.log(2)) < 1e-6,
    'gap=' + gap.toFixed(9) + ' vs ln2=' + Math.log(2).toFixed(9));
}

{
  // K=1 ⇒ 均值场精确（无分配歧义）⇒ ELBO 必须等于 log p(X)
  let Xs = [];
  for (let i = 0; i < 12; i++) Xs.push([1.4 * Math.sin(i * 1.7) + 0.3 * i]);
  const ex = { K: 1, sigmaSq: 0.49, sigma0sq: 25, alpha0: 0.5 };
  const eExact = VI.exactLogEvidence(Xs, ex);
  const s = VI.cavi(Xs, { K: 1, seed: 7, maxIter: 200, sigmaSq: 0.49, sigma0sq: 25, alpha0: 0.5 });
  const eElbo = s.elboHist[s.elboHist.length - 1];
  ok('K=1：ELBO ≡ 精确 log 证据（均值场精确）', Math.abs(eElbo - eExact) < 1e-9,
    '|Δ|=' + Math.abs(eElbo - eExact).toExponential(2));

  const q = VI.k1ExactPosterior(Xs, { sigmaSq: 0.49, sigma0sq: 25 });
  const dm = Math.abs(s.m[0][0] - q.mean[0]);
  const dv = Math.abs(s.s2[0][0] - q.variance[0]);
  ok('K=1：q(μ) 均值/方差 == 解析后验', Math.max(dm, dv) < 1e-10,
    '|Δmean|=' + dm.toExponential(2) + ' |Δvar|=' + dv.toExponential(2));
}

/* ===================== 汇总 ===================== */
console.log('\n' + '='.repeat(60));
console.log('  结果: ' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' total');
console.log('  ' + (fail === 0 ? '\u2713 ALL GREEN' : '\u2717 HAS FAILURES'));
console.log('='.repeat(60));
process.exit(fail === 0 ? 0 : 1);
