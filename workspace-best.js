/* 내 조건 맞춤 추천 · 계약 전 보고서 (2026-11-17, 대표님: "내일 가서 바로 계약해도 손해가 아닐 정도의 알고리즘으로").
 *
 * 순서의 근거는 scripts/buy_signals.py 가 2020~2026 실거래로 검증해 남긴 workspace-data/buy_model.json 뿐이다.
 *   - 시세 추정: 같은 단지·같은 평형의 최근 12개월 중개거래를 지역 흐름으로 보정한 값
 *   - 가격 위치: 최근 값이 제 흐름보다 높게(불리)·낮게(유리) 형성돼 있는가 — 학습 없이 방향을 고정한 점수
 *   - 웃돈 효과: 추정 시세보다 얼마를 더(덜) 주고 샀는지에 따른 12개월 뒤 손해율
 * '어느 지역·가격대가 더 오른다'는 시기마다 뒤집혀 쓰지 않는다. 시장 전체 하락은 이 순서로 피하지 못한다 — 화면에 그대로 적는다.
 * 개인 자금은 이 브라우저 안에서만 계산한다(공개 자료로 보내지 않는다).
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkspaceBest = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const VERSION = 'best-1.0';
  const SURE_TRADES = 3;          // 같은 평형 12개월 거래가 이만큼은 있어야 시세를 믿는다(3건 이상 추정 오차 중앙값 3.6%, 1건 5.8%)
  const GOOD_DISCOUNT = 0.03;     // '유리한 계약가' = 추정 시세보다 3% 낮은 값
  const PYEONG = 3.305785;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  function won(v) {
    if (num(v) === null) return '확인 필요';
    const n = Math.round(Math.abs(v) / 10000) * 10000, eok = Math.floor(n / 1e8), man = Math.round(n % 1e8 / 1e4);
    if (!eok && !man) return '0원';
    return (v < 0 ? '−' : '') + (eok ? `${eok.toLocaleString('ko-KR')}억` : '') + (eok && man ? ' ' : '') + (man ? `${man.toLocaleString('ko-KR')}만` : '') + ' 원';
  }
  const eok = v => (num(v) === null ? '?' : `${(Math.round(v / 1e6) / 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}억`);
  const pct = (v, d = 0) => `${(Math.abs(v) * 100).toFixed(d)}%`;
  const signed = (v, d = 1) => `${v >= 0 ? '+' : '−'}${(Math.abs(v) * 100).toFixed(d)}%`;
  const ym = v => { const s = String(v || ''); return s.length >= 6 ? `${s.slice(0, 4)}.${s.slice(4, 6)}` : s; };
  const floorTo = (v, unit) => Math.floor(v / unit) * unit;

  // ── 자료 정리 ──
  // 상세 조각의 전체 buy 블록과 목록용 요약(build_personalization_index.compact_buy)을 같은 모양으로 맞춘다.
  function summary(buy) {
    if (!buy || typeof buy !== 'object') return null;
    if (!Array.isArray(buy.types)) return num(buy.est) !== null ? buy : null;
    const t = buy.types[buy.main];
    if (!t || num(t.est) === null) return null;
    const last = (t.trades || []).find(x => x && !x.direct) || null;
    return {
      label: t.label, area: t.area, est: t.est, lo: t.lo, hi: t.hi, n: t.n, n12: t.n12, type_count: buy.types.length, recent3m: t.recent3m || null,
      last: last ? { date: last.date, price: last.price, floor: last.floor } : null, position: t.position || null,
      peers: buy.peers ? { gap: buy.peers.gap, count: buy.peers.count, cheaper_than: buy.peers.cheaper_than, median_ppm: buy.peers.median_ppm } : null,
      deals12: buy.liquidity?.deals12 ?? null, direct12: buy.liquidity?.direct12 ?? null, sgg_mom6: buy.region?.sgg_mom6 ?? null, sgg_mom12: buy.region?.sgg_mom12 ?? null
    };
  }
  const kindKey = p => (p?.propertyType === 'apartment' ? 'apt' : 'rh');
  const ceiling = est => (num(est) === null ? null : { good: floorTo(est * (1 - GOOD_DISCOUNT), 1e6), max: floorTo(est, 1e6) });

  // ── 판정 ──
  const VERDICTS = {
    first: ['계약 검토 1순위', 0], vfirst: ['빌라 계약 검토 후보', 0.5], cond: ['추정 시세 이하일 때만', 1], thin: ['시세 확인이 먼저', 2], pricey: ['지금 값은 불리', 3], nodata: ['판단 자료 부족', 4]
  };
  const V = (key, reason) => ({ key, label: VERDICTS[key][0], order: VERDICTS[key][1], reason });
  // kind 'rh'(빌라)는 가격 위치가 유리해도 아파트 1순위 뒤에 둔다 — 검증 자료가 2년(오르는 장 한 국면)뿐이고 시세 추정 오차도 크다.
  function verdict(buy, kind) {
    const b = summary(buy);
    if (!b) return V('nodata', '최근 2년 중개거래가 없어(직거래뿐이거나 40㎡ 미만) 시세를 추정하지 못했습니다.');
    const grade = b.position?.grade || null, n12 = b.n12 || 0, sure = n12 >= SURE_TRADES;
    const thin = `같은 평형 거래가 12개월 ${n12}건뿐이라 시세부터 확인해야 합니다. 주변 비슷한 집 거래와 중개사 확인이 먼저입니다.`;
    if (grade === 'good' && sure && kind === 'rh') return V('vfirst', '가격 위치가 유리하고 같은 건물 거래도 있습니다. 다만 빌라는 검증 자료가 2년(오르는 장)뿐이고 시세 추정도 아파트보다 크게 빗나갑니다. 주변 거래를 직접 확인하고 가 보세요.');
    if (grade === 'good') return sure ? V('first', '최근 실거래가가 제 흐름보다 낮게 형성돼 있고, 같은 평형 거래가 충분해 시세를 믿을 만합니다. 유리한 계약가 이하인지 확인하고 가 보세요.') : V('thin', `가격 위치는 유리해 보이지만 ${thin}`);
    if (grade === 'bad') return V('pricey', '최근 실거래가가 제 흐름보다 높게 형성돼 있습니다. 추정 시세보다 3% 넘게 싸게 살 수 있을 때만 검토하세요.');
    if (grade === 'mid') return sure ? V('cond', '가격 위치는 보통입니다. 추정 시세 이하로 계약할 수 있는지가 관건입니다.') : V('thin', thin);
    return sure ? V('cond', '최근 3개월 중개거래가 없어 가격 위치는 판정하지 못했습니다. 추정 시세 이하로만 검토하세요.') : V('thin', thin);
  }

  // 순위: 내 돈으로 못 사는 집·필수 조건에 안 맞는 집은 빼고, 판정 → 가격 위치 → 거래 수 순.
  function rank(rows, { sort = 'position' } = {}) {
    const out = [], excluded = { unaffordable: 0, notfit: 0, nodata: 0 };
    let budgetUnknown = 0;
    for (const r of rows || []) {
      const buy = summary(r.buy);
      if (!buy) { excluded.nodata++; continue; }
      const status = r.loan?.screen?.status;
      if (status === 'not_possible') { excluded.unaffordable++; continue; }
      if (r.fit === 'NOT_FIT') { excluded.notfit++; continue; }
      if (status !== 'possible') budgetUnknown++;
      out.push({ ...r, buy, verdict: verdict(buy, r.property ? kindKey(r.property) : r.kind), affordable: status === 'possible' });
    }
    const pos = r => r.buy.position?.pct ?? 1.5, cash = r => r.loan?.cash?.neededKrw ?? Infinity, monthly = r => r.loan?.monthly?.paymentKrw ?? Infinity;
    const byPosition = (a, b) => a.verdict.order - b.verdict.order || pos(a) - pos(b) || (b.buy.n12 || 0) - (a.buy.n12 || 0);
    const cmp = { position: byPosition, cash: (a, b) => cash(a) - cash(b) || byPosition(a, b), monthly: (a, b) => monthly(a) - monthly(b) || byPosition(a, b), area: (a, b) => (b.buy.area || 0) - (a.buy.area || 0) || byPosition(a, b) };
    out.sort(cmp[sort] || byPosition);
    return { rows: out, excluded, budgetUnknown };
  }

  // 가격 위치를 만든 사실들을 사람 말로.
  function reasons(buy, kind) {
    const b = summary(buy), p = b?.position, out = [];
    if (!p) return out;
    if (num(p.own_mom3) !== null && num(p.sgg_mom3) !== null) {
      const d = p.own_mom3 - p.sgg_mom3;
      out.push({ tone: d <= -0.01 ? 'good' : d >= 0.01 ? 'bad' : 'neutral', key: 'spike',
        text: `최근 3개월 실거래가가 직전 3개월보다 ${signed(p.own_mom3)} 움직였습니다(같은 구 평균 ${signed(p.sgg_mom3)}). 구 평균보다 ${(Math.abs(d) * 100).toFixed(1)}%p ${d > 0 ? '더 뛴 값입니다' : '덜 오른 값입니다'}.` });
    }
    if (num(p.vs_peak) !== null) {
      const below = Math.max(0, -p.vs_peak), region = num(p.peak_region) === null ? null : Math.max(0, -p.peak_region);
      const head = below < 0.005 ? '최근 2년 자기 최고가 수준에서 거래되고 있습니다' : `최근 2년 자기 최고가보다 ${pct(below)} 낮게 거래되고 있습니다`;
      out.push({ tone: region === null ? 'neutral' : below > region + 0.01 ? 'good' : below < region - 0.01 ? 'bad' : 'neutral', key: 'peak',
        text: `${head}${region === null ? '' : `(같은 구 보통 ${region < 0.005 ? '최고가 수준' : pct(region) + ' 낮음'})`}.` });
    }
    const deep = (num(p.own_mom3) !== null && num(p.sgg_mom3) !== null && p.own_mom3 - p.sgg_mom3 <= -0.1) || (num(p.vs_peak) !== null && p.vs_peak <= -0.2) || (kind === 'rh' && num(p.peer_gap) !== null && p.peer_gap <= -0.25);
    if (kind === 'rh' && num(p.peer_gap) !== null) {
      out.push({ tone: p.peer_gap <= -0.05 ? 'good' : p.peer_gap >= 0.05 ? 'bad' : 'neutral', key: 'peer',
        text: `같은 동의 비슷한 빌라(면적 ±20%·연식 ±10년)보다 ㎡당 ${pct(p.peer_gap)} ${p.peer_gap < 0 ? '싸게' : '비싸게'} 거래됐습니다.` });
    }
    if (deep) out.push({ tone: 'warn', key: 'deep', text: '값이 유난히 낮게 찍혔습니다. 저층·반지하·수리 상태나 특수한 거래 때문일 수 있으니 싼 이유부터 확인하세요.' });
    return out;
  }

  // ── 검증 근거 꺼내기 ──
  function gradeEvidence(model, kind, price) {
    const k = model?.kinds?.[kind], v = k?.validation;
    if (!v) return null;
    const cap = num(v.cap_krw), scope = cap !== null && num(price) !== null && price <= cap && v.cap?.pooled ? 'cap' : cap !== null && num(price) !== null && price > cap && v.above?.pooled ? 'above' : 'all';
    const e = v[scope];
    if (!e?.pooled) return null;
    return { scope, capKrw: cap, good: e.pooled.good, mid: e.pooled.mid, bad: e.pooled.bad, base: e.pooled.base, cohorts: e.cohort_count, wins: e.good_beats_bad,
      first: e.cohorts?.[0], last: e.cohorts?.[e.cohorts.length - 1], tested: e.tested, worstGood: e.worst_good_loss, worstCohort: e.worst_cohort, oneRegime: (e.cohort_count || 0) < 8 };
  }
  function premiumRows(model, kind, price) {
    const p = model?.kinds?.[kind]?.premium;
    if (!p) return null;
    const useCap = num(p.cap_krw) !== null && num(price) !== null && price <= p.cap_krw && (p.cap || []).length >= 5;
    const rows = useCap ? p.cap : p.all;
    if (!Array.isArray(rows) || !rows.length) return null;
    return { rows, scope: useCap ? 'cap' : 'all', capKrw: p.cap_krw, months: p.months || [], n: useCap ? p.n_cap : p.n,
      consistent: useCap ? p.consistent_months_cap : p.consistent_months, monthCount: useCap ? p.month_count_cap : p.month_count };
  }
  // 호가 점검: 층을 맞춘 추정 시세 대비 웃돈 → 과거 같은 웃돈을 준 거래의 12개월 뒤 손해율.
  function checkAsk(model, kind, type, askKrw, floorKey) {
    if (num(askKrw) === null || askKrw <= 0 || !type || num(type.est) === null) return null;
    const ff = model?.kinds?.[kind]?.floor || {}, mult = num(ff[floorKey]) ?? 1;
    const fair = type.est * mult, premium = askKrw / fair - 1, table = premiumRows(model, kind, askKrw);
    const row = table ? table.rows.find(r => premium > r.lo && premium <= r.hi) || null : null;
    const grade = premium <= -GOOD_DISCOUNT ? 'good' : premium <= 0.01 ? 'ok' : premium <= 0.03 ? 'warn' : 'bad';
    return { fair, premium, row, table, grade, floorAdjusted: mult !== 1 };
  }

  // ── 화면 조각 ──
  let model = null, modelState = 'idle', bound = false, lastUi = null;
  const view = { kind: 'all', region: '', minArea: 0, sure: false, sort: 'position', limit: 12 };
  const typeChoice = new Map(), askState = new Map();
  function loadModel(ui) {
    if (modelState !== 'idle' || typeof root.fetch !== 'function') return;
    modelState = 'loading';
    root.fetch('workspace-data/buy_model.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then(m => { model = m && m.kinds && Object.keys(m.kinds).length ? m : null; modelState = model ? 'ready' : 'empty'; ui?.render?.(); }).catch(() => { modelState = 'error'; ui?.render?.(); });
  }
  const legacyOf = (ui, p) => ui.state.contexts.get(p.id)?.legacy || root.WorkspacePersonalization?.publicContext?.(p.id) || null;
  const chip = (cls, text) => `<span class="best-chip ${cls}">${esc(text)}</span>`;
  const gradeChip = g => (g ? chip(`pos-${g}`, `가격 위치 ${({ good: '유리', mid: '보통', bad: '불리' })[g]}`) : chip('pos-none', '가격 위치 판정 없음'));

  function collect(ui) {
    const st = ui.state, within = root.WorkspaceLocation?.within;
    return st.properties.filter(p => (within ? within(p, st.profile) : true)).map(p => {
      const legacy = legacyOf(ui, p);
      return { property: p, legacy, buy: legacy?.buy || null, loan: ui.loanFor(p), fit: ui.analysisFor(p)?.personalFit?.status || null };
    });
  }
  function filtered(rows) {
    return rows.filter(r => {
      const b = summary(r.buy);
      if (view.kind !== 'all' && r.property.propertyType !== view.kind) return false;
      if (view.region && String(r.property.regionCode) !== view.region) return false;
      if (view.minArea && !(b && b.area >= view.minArea)) return false;
      if (view.sure && !(b && (b.n12 || 0) >= SURE_TRADES)) return false;
      return true;
    });
  }
  function budgetLine(ui) {
    const p = ui.state.profile, L = root.WorkspaceLoanEstimate;
    if (!L?.cashKnown?.(p)) return `<div class="best-budget empty"><div><strong>내 예산을 넣으면 살 수 있는 집만 골라 순서를 매깁니다.</strong><p>현금·연소득·기존 빚(마이너스통장 포함)만 넣으면 됩니다. 이 브라우저 안에서만 계산합니다.</p></div><button class="primary" data-action="loan-edit-conditions">내 예산 입력</button></div>`;
    const cash = Number(p.cashAvailableKrw), reserve = Number(p.reserveKrw || 0), income = p.annualGrossIncomeKrw == null ? null : Number(p.annualGrossIncomeKrw), debts = Array.isArray(p.debts) ? p.debts.length : 0;
    return `<div class="best-budget"><dl><div><dt>쓸 수 있는 현금</dt><dd>${esc(won(cash - reserve))}</dd></div><div><dt>연소득</dt><dd>${income === null ? '미입력' : esc(won(income))}</dd></div><div><dt>기존 빚</dt><dd>${debts ? `${debts}건 반영` : p.noDebtConfirmed ? '없음' : '미입력'}</dd></div></dl><button data-action="loan-edit-conditions">내 예산 수정</button></div>`;
  }
  function rowCard(ui, r, index) {
    const p = r.property, b = r.buy, l = r.legacy || {}, c = ceiling(b.est), kind = kindKey(p), all = reasons(b, kind), why = [...all.filter(x => x.key !== 'deep').slice(0, 2), ...all.filter(x => x.key === 'deep')];
    const station = l.station && num(l.station.dist_m) !== null ? ` · ${esc(l.station.name || '역')} ${Math.round(l.station.dist_m)}m` : '';
    const money = r.loan?.ok ? `<div><span>필요 현금</span><strong>${esc(won(Math.ceil(r.loan.cash.neededKrw / 1e4) * 1e4))}</strong></div><div><span>매달 원금+이자</span><strong>${esc(won(Math.ceil(r.loan.monthly.paymentKrw / 1e4) * 1e4))}</strong></div>` : '';
    return `<article class="best-card v-${r.verdict.key}" data-best-property="${esc(p.id)}"><div class="best-card-head"><span class="best-rank" aria-label="${index + 1}위">${index + 1}</span><div class="best-title"><h3><a href="#/properties/${encodeURIComponent(p.id)}">${esc(p.name)}</a> <small>${esc(b.label || '')} · 전용 ${num(b.area) === null ? '?' : b.area.toFixed(1)}㎡(${num(b.area) === null ? '?' : (b.area / PYEONG).toFixed(0)}평)</small></h3><p>${esc(p.propertyType === 'apartment' ? '아파트' : '빌라')} · ${esc(p.addressLabel || p.regionCode)}${l.year ? ` · ${esc(l.year)}년` : ''}${station}</p></div><span class="best-verdict v-${r.verdict.key}">${esc(r.verdict.label)}</span></div>
<div class="best-numbers"><div class="best-est"><span>추정 시세${kind === 'apt' ? ' (기준층)' : ''}</span><strong>${esc(won(b.est))}</strong><small>${esc(eok(b.lo))}~${esc(eok(b.hi))} · 같은 평형 12개월 ${b.n12 || 0}건</small></div><div class="best-ceiling"><span>유리한 계약가</span><strong>${esc(won(c.good))} 이하</strong><small>추정 시세보다 3% 낮은 값</small></div>${money}</div>
<p class="best-reason">${gradeChip(b.position?.grade)} ${r.verdict.key === 'first' ? '' : esc(r.verdict.reason)}</p>${why.length ? `<ul class="best-why">${why.map(x => `<li class="tone-${x.tone}">${esc(x.text)}</li>`).join('')}</ul>` : ''}
<div class="actions"><a class="button primary" href="#/properties/${encodeURIComponent(p.id)}">계약 전 보고서 보기 →</a><button data-action="compare-toggle" data-id="${esc(p.id)}" aria-pressed="${ui.state.comparison.includes(p.id)}">${ui.state.comparison.includes(p.id) ? '비교 해제' : '비교'}</button></div></article>`;
  }
  function historyChart(history) {
    if (!Array.isArray(history) || history.length < 3) return '';
    const W = 640, H = 190, L = 34, B = 34, T = 12, w = (W - L - 8) / history.length;
    const bars = history.map((h, i) => { const y = T + (H - T - B) * (1 - h.loss), x = L + i * w; return `<rect class="${h.loss >= 0.7 ? 'bar-bad' : h.loss >= 0.45 ? 'bar-mid' : 'bar-good'}" x="${(x + 2).toFixed(1)}" y="${y.toFixed(1)}" width="${(w - 4).toFixed(1)}" height="${(H - B - y).toFixed(1)}" rx="2"><title>${ym(h.t0)} 매수: 1년 뒤 손해 ${Math.round(h.loss * 100)}%</title></rect>${i % 2 === 0 ? `<text x="${(x + w / 2).toFixed(1)}" y="${H - 16}" text-anchor="middle">${String(h.t0).slice(2, 4)}.${String(h.t0).slice(4, 6)}</text>` : ''}<text class="val" x="${(x + w / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle">${Math.round(h.loss * 100)}</text>`; }).join('');
    const grid = [0, 0.5, 1].map(v => { const y = T + (H - T - B) * (1 - v); return `<line x1="${L}" x2="${W - 8}" y1="${y}" y2="${y}"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${v * 100}%</text>`; }).join('');
    return `<figure class="best-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="매수 시점별 1년 뒤 손해 비율"><g class="grid">${grid}</g>${bars}</svg><figcaption>아파트를 그 분기에 샀을 때 1년 뒤 손해(거래비용 3% 포함)였던 비율. 언제 샀느냐가 어느 집을 샀느냐보다 훨씬 컸습니다.</figcaption></figure>`;
  }
  function evidenceHtml(open) {
    if (modelState === 'loading' || modelState === 'idle') return '<p class="help">검증 근거를 불러오는 중입니다.</p>';
    if (!model) return '<div class="notice warning">검증 근거 파일을 읽지 못했습니다. 순서는 표시하지만 근거 수치는 지금 보여 드릴 수 없습니다.</div>';
    const apt = model.kinds.apt, rh = model.kinds.rh, ea = gradeEvidence(model, 'apt', 1), er = gradeEvidence(model, 'rh', 1), pa = apt?.price_accuracy, pr = premiumRows(model, 'apt', 1), rej = apt?.rejected;
    const p100 = v => (num(v) === null ? '?' : Math.round(v * 100));
    const accuracy = pa?.new?.n && pa?.old?.n ? `<li><strong>시세 추정이 얼마나 맞나</strong> — 실제 거래 ${pa.new.n.toLocaleString('ko-KR')}건을 그 전 자료만으로 맞혀 보니 오차 중앙값 ${(pa.new.median_error * 100).toFixed(1)}%, 5% 안에 든 비율 ${p100(pa.new.within5)}%였습니다(예전 방식 ${(pa.old.median_error * 100).toFixed(1)}%·${p100(pa.old.within5)}%). 같은 평형 거래가 1건뿐이면 ${pa.new_single?.n ? `${(pa.new_single.median_error * 100).toFixed(1)}%` : '더 크게'} 빗나갑니다.</li>` : '';
    const position = ea ? `<li><strong>가격 위치가 맞았나</strong> — ${ym(ea.first)}~${ym(ea.last)} ${ea.cohorts}개 매수 시점에서 ${ea.scope === 'cap' && ea.capKrw ? `${eok(ea.capKrw)} 이하 ` : ''}아파트의 1년 뒤 손해 비율은 유리 ${p100(ea.good.loss)}% · 보통 ${p100(ea.mid.loss)}% · 불리 ${p100(ea.bad.loss)}%였고(값이 실제로 내려간 경우만 세면 유리 ${p100(ea.good.nominal)}% · 불리 ${p100(ea.bad.nominal)}%), ${ea.wins}개 시점에서 유리 쪽이 불리 쪽보다 낮았습니다. ‘유리’도 절반 가까이는 1년 안에 팔면 손해였다는 뜻입니다 — 오래 살 집으로 고르세요.</li>` : '';
    const villa = er ? `<li><strong>빌라</strong> — 자료가 ${ym(er.first)}~${ym(er.last)} ${er.cohorts}개 시점(오르는 장 한 국면)뿐입니다. 유리 ${p100(er.good.loss)}% · 불리 ${p100(er.bad.loss)}%로 방향은 같지만 근거는 아파트보다 약합니다. 같은 건물 거래가 드물어 시세 추정도 ${rh?.price_accuracy?.new_all?.over15 != null ? `${p100(rh.price_accuracy.new_all.over15)}%는 15% 넘게` : '크게'} 빗나갑니다.</li>` : '';
    const premium = pr ? `<li><strong>웃돈을 주면</strong> — 추정 시세보다 3~7% 싸게 산 거래는 ${p100(pr.rows.find(r => r.hi === -0.03)?.loss)}%, 시세대로 산 거래는 ${p100(pr.rows.find(r => r.lo === -0.01)?.loss)}%, 3~7% 비싸게 산 거래는 ${p100(pr.rows.find(r => r.lo === 0.03)?.loss)}%가 1년 뒤 손해였습니다(거래 ${(pr.n || 0).toLocaleString('ko-KR')}건, ${pr.monthCount}개 시점 중 ${pr.consistent}개에서 싸게 산 쪽이 덜 손해).</li>` : '';
    const rejected = rej?.auc ? `<li><strong>버린 방법</strong> — 지역 상승세·가격대·연식으로 '더 오를 곳'을 맞히는 모형은 2022년 하락장을 넣자 순위가 거꾸로 맞았습니다(${rej.cohort_count}개 시점 중 ${rej.top10_beats_base}개만 평균보다 나음). 그래서 쓰지 않습니다.</li>` : '';
    return `<details class="best-evidence" data-disclosure="best-evidence"${open ? ' open' : ''}><summary>이 순서를 믿어도 되나요? <span>검증한 것 · 못 하는 것</span></summary><div class="best-evidence-body"><ul>${accuracy}${position}${premium}${villa}${rejected}</ul>${historyChart(apt?.history)}<div class="notice warning"><strong>이 순서가 못 하는 것.</strong> 시장 전체가 내리는 시기는 피하게 해 주지 못합니다 — ${ea ? `가장 나빴던 ${ym(ea.worstCohort)} 매수는 유리한 집도 ${p100(ea.worstGood)}%가 손해였습니다. ` : ''}등기부·실제 호가·집 상태도 이 자료에 없습니다. 손해가 없다는 보장이 아니라, 같은 시점에 살 때 덜 불리한 순서입니다.</div><p class="help">손해 = 1년 뒤 같은 단지·같은 평형 중개거래 중간값이 산 값 + 거래비용 3%에 못 미침 · 자료: 국토교통부 실거래가 공개시스템 ${ym(apt?.trained?.data_from)}~${ym(apt?.trained?.data_to)} ${(apt?.trained?.trades || 0).toLocaleString('ko-KR')}건${model.trained_at ? ` · 검증 ${String(model.trained_at).slice(0, 10)}` : ''}</p></div></details>`;
  }
  function controls(rows) {
    const regions = [...new Map(rows.map(r => [String(r.property.regionCode), String(r.property.regionCode)])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'ko'));
    const sel = (name, value, opts, label) => `<label>${label}<select data-best-filter="${name}">${opts.map(([v, t]) => `<option value="${esc(v)}"${String(value) === String(v) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
    return `<div class="best-controls">${sel('kind', view.kind, [['all', '아파트·빌라 모두'], ['apartment', '아파트만'], ['villa', '빌라만']], '유형')}${sel('region', view.region, [['', '전체 지역'], ...regions], '지역')}${sel('minArea', view.minArea, [[0, '면적 무관'], [40, '40㎡ 이상'], [50, '50㎡ 이상(20평대)'], [59, '59㎡ 이상'], [84, '84㎡ 이상']], '전용면적')}${sel('sort', view.sort, [['position', '가격 위치 유리한 순(검증됨)'], ['cash', '필요 현금 적은 순'], ['monthly', '매달 상환 적은 순'], ['area', '넓은 순']], '순서')}<label class="best-check"><input type="checkbox" data-best-filter="sure"${view.sure ? ' checked' : ''}> 거래가 충분해 시세를 믿을 만한 집만</label></div>`;
  }
  function resultHtml(ui, all, limit) {
    const ranked = rank(filtered(all), { sort: view.sort }), rows = ranked.rows, first = rows.filter(r => r.verdict.key === 'first').length, vfirst = rows.filter(r => r.verdict.key === 'vfirst').length;
    const ex = ranked.excluded, cashKnown = root.WorkspaceLoanEstimate?.cashKnown?.(ui.state.profile);
    const head = `<p class="best-count"><strong>${rows.length.toLocaleString('ko-KR')}곳</strong> 중 계약 검토 1순위 <strong>${first.toLocaleString('ko-KR')}곳</strong>${vfirst ? ` · 빌라 후보 ${vfirst.toLocaleString('ko-KR')}곳` : ''}${cashKnown ? ` · 내 돈으로 못 사 제외 ${ex.unaffordable.toLocaleString('ko-KR')}곳` : ''}${ex.notfit ? ` · 필수 조건 불일치 제외 ${ex.notfit.toLocaleString('ko-KR')}곳` : ''}${ex.nodata ? ` · 시세 추정 불가 ${ex.nodata.toLocaleString('ko-KR')}곳` : ''}</p>${cashKnown && ranked.budgetUnknown ? `<p class="help">예산 입력이 덜 돼(연소득·빚·생애최초 여부) 살 수 있는지 확정하지 못한 집 ${ranked.budgetUnknown.toLocaleString('ko-KR')}곳이 섞여 있습니다.</p>` : ''}`;
    if (!rows.length) return { rows, html: `${head}<div class="panel empty"><h2>조건에 맞는 집이 없습니다.</h2><p>지역·면적 조건을 넓히거나 예산을 확인해 보세요.</p></div>` };
    return { rows, html: `${head}<div class="best-list">${rows.slice(0, limit).map((r, i) => rowCard(ui, r, i)).join('')}</div>${rows.length > limit ? `<div class="actions" style="justify-content:center;margin-top:18px"><button data-best-more>다음 ${Math.min(12, rows.length - limit)}곳 더 보기 (${limit.toLocaleString('ko-KR')} / ${rows.length.toLocaleString('ko-KR')})</button></div>` : ''}` };
  }
  function ready(ui) {
    const st = ui.state;
    if (st.mode === 'demo') return '<div class="notice">맞춤 추천은 실제 자료에서만 볼 수 있습니다. <a href="workspace.html?mode=live#/best">실제 자료로 열기</a></div>';
    if (st.request === 'loading' || st.villaIndexStatus === 'loading') return '<p class="boot-message">실거래 자료와 내 조건을 맞춰 보는 중입니다.</p>';
    if (st.request === 'error' || st.villaIndexStatus === 'error') return '<div class="notice risk" role="alert">자료를 불러오지 못했습니다. 집이 없다는 뜻이 아닙니다. 잠시 뒤 다시 열어 주세요.</div>';
    return null;
  }
  // #/best — 내 조건 맞춤 추천
  function page(ui) {
    lastUi = ui; loadModel(ui);
    const wait = ready(ui);
    const head = `<header class="page-head"><div><p class="eyebrow">내 조건 맞춤 추천</p><h1>내 돈으로 살 수 있고, 지금 값이 덜 불리한 집</h1><p class="muted">내 현금·소득·빚으로 살 수 있는 집만 남기고, 과거 실거래로 검증한 ‘가격 위치’ 순으로 세웠습니다. 집마다 얼마 이하로 계약해야 유리한지 함께 보여 드립니다.</p></div></header>`;
    if (wait) return head + wait;
    const all = collect(ui), res = resultHtml(ui, all, view.limit);
    return `${head}${budgetLine(ui)}${controls(all)}<p class="help">아파트 1순위가 먼저, 그다음 빌라 후보 순입니다. 빌라는 검증 자료가 2년뿐이라 근거가 약합니다. 같은 단계 안에서는 가격 위치가 유리한 순입니다.</p>${res.html}${evidenceHtml(false)}`;
  }
  // 첫 화면 위쪽 요약
  function homeTeaser(ui) {
    lastUi = ui; loadModel(ui);
    if (ready(ui)) return '';
    const cashKnown = root.WorkspaceLoanEstimate?.cashKnown?.(ui.state.profile), ranked = rank(collect(ui), { sort: 'position' }), top = ranked.rows.filter(r => r.verdict.key === 'first' || r.verdict.key === 'vfirst').slice(0, 3), firstCount = ranked.rows.filter(r => r.verdict.key === 'first').length;
    if (!top.length) return '';
    return `<section class="best-home"><div class="page-head"><div><p class="eyebrow">${cashKnown ? '내 예산 기준' : '예산 입력 전 · 전체 기준'}</p><h2>지금 계약을 검토할 만한 집</h2><p class="help">${cashKnown ? '내 돈으로 살 수 있는 집 중' : '전체 후보 중'} 최근 값이 제 흐름보다 낮고 거래가 충분한 아파트 ${firstCount.toLocaleString('ko-KR')}곳에서 위쪽 순서대로입니다. 현재 판매 중인지는 따로 확인해야 합니다.</p></div><a class="button primary" href="#/best">맞춤 추천 전체 보기 →</a></div><div class="best-list">${top.map((r, i) => rowCard(ui, r, i)).join('')}</div></section>`;
  }
  // 목록 카드에 붙는 한 줄
  function cardLine(ui, p) {
    const b = summary(legacyOf(ui, p)?.buy);
    if (!b) return '';
    const c = ceiling(b.est), v = verdict(b, kindKey(p));
    return `<p class="best-line">${chip(`v-${v.key}`, v.label)} ${esc(b.label || '')} 추정 시세 · 유리한 계약가 <strong>${esc(won(c.good))} 이하</strong> · 같은 평형 12개월 ${b.n12 || 0}건</p>`;
  }

  // ── 계약 전 보고서(상세) ──
  function seriesChart(series, est) {
    if (!Array.isArray(series) || series.length < 2) return '';
    const W = 640, H = 200, L = 46, B = 30, T = 14, vals = series.map(s => s[1]).concat(num(est) === null ? [] : [est]), lo = Math.min(...vals) * 0.96, hi = Math.max(...vals) * 1.04;
    const x = i => L + (W - L - 14) * (series.length === 1 ? 0.5 : i / (series.length - 1)), y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
    const path = series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s[1]).toFixed(1)}`).join(' ');
    const dots = series.map((s, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(s[1]).toFixed(1)}" r="${Math.min(7, 3 + s[2])}"><title>${ym(s[0])} 분기: ${won(s[1])} · ${s[2]}건</title></circle>${i % Math.ceil(series.length / 6) === 0 || i === series.length - 1 ? `<text x="${x(i).toFixed(1)}" y="${H - 9}" text-anchor="middle">${String(s[0]).slice(2, 4)}.${String(s[0]).slice(4, 6)}</text>` : ''}`).join('');
    const estLine = num(est) === null ? '' : `<line class="est" x1="${L}" x2="${W - 14}" y1="${y(est).toFixed(1)}" y2="${y(est).toFixed(1)}"/><text class="est" x="${W - 16}" y="${(y(est) - 5).toFixed(1)}" text-anchor="end">추정 시세 ${eok(est)}</text>`;
    const axis = [lo / 0.96, hi / 1.04].map(v => `<text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${eok(v)}</text>`).join('');
    return `<figure class="best-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="분기별 실거래 중간값"><g class="grid">${axis}</g>${estLine}<path class="line" d="${path}"/><g class="dots">${dots}</g></svg><figcaption>분기별 중간 실거래가(같은 평형·중개거래). 점이 클수록 그 분기 거래가 많습니다.</figcaption></figure>`;
  }
  function typePanel(buy, index, kind, id) {
    const t = buy.types[index];
    if (!t) return '';
    const c = ceiling(t.est), trades = t.trades || [], ev = gradeEvidence(model, kind, t.est), why = reasons({ ...buy, main: index }, kind), g = t.position?.grade || null;
    const p100 = v => (num(v) === null ? '?' : Math.round(v * 100));
    const evLine = ev && g ? `<p class="help">근거: 과거 ${ev.cohorts}개 매수 시점 평균으로 이 등급(${({ good: '유리', mid: '보통', bad: '불리' })[g]})의 1년 뒤 손해 비율은 ${p100(ev[g].loss)}%였습니다(유리 ${p100(ev.good.loss)}% · 보통 ${p100(ev.mid.loss)}% · 불리 ${p100(ev.bad.loss)}%, 같은 시점 전체 ${p100(ev.base.loss)}%).${ev.oneRegime ? ' 빌라는 오르는 장 한 국면의 자료뿐이라 근거가 약합니다.' : ''}</p>` : '';
    const recent = t.recent3m ? `최근 3개월 같은 평형대 중개거래 ${t.recent3m.n}건의 ㎡당 중간값을 이 면적으로 환산하면 ${won(t.recent3m.median)}입니다(추정 시세 대비 ${signed(t.recent3m.median / t.est - 1)}, 층 보정 전).` : '최근 3개월에는 이 평형대의 중개거래가 없습니다.';
    const saved = askState.get(id), ask = saved && saved.type === index ? saved : {}, ff = model?.kinds?.[kind]?.floor || {}, floors = Object.values(ff).some(v => v !== 1) ? Object.keys(ff) : [], base = buy.base_floor || floors[0] || '';
    const result = ask.result ? askResultHtml(ask.result, ask.price) : '<p class="help">중개사가 부른 값(호가)과 층을 넣으면, 과거에 그만큼 주고 산 사람들이 1년 뒤 어땠는지 보여 드립니다.</p>';
    return `<div class="best-type" data-best-type-panel="${index}"><div class="best-kpis"><div><span>추정 시세${floors.length ? ` · ${esc(base)} 기준` : ''}</span><strong>${esc(won(t.est))}</strong><small>보통 ${esc(eok(t.lo))}~${esc(eok(t.hi))} 사이에서 거래</small></div><div class="k-good"><span>유리한 계약가</span><strong>${esc(won(c.good))} 이하</strong><small>추정 시세보다 3% 낮은 값</small></div><div class="k-max"><span>넘기지 말 값</span><strong>${esc(won(c.max))}</strong><small>이보다 비싸면 과거 손해 비율이 뚜렷이 높았음</small></div><div><span>시세를 믿을 만한가</span><strong>${(t.n12 || 0) >= 6 ? '충분' : (t.n12 || 0) >= SURE_TRADES ? '보통' : '부족'}</strong><small>같은 평형 12개월 ${t.n12 || 0}건${t.n !== t.n12 ? ` · 추정에 쓴 거래 ${t.n}건` : ''}</small></div></div>
<h3>가격 위치 ${gradeChip(g)}</h3>${why.length ? `<ul class="best-why">${why.map(x => `<li class="tone-${x.tone}">${esc(x.text)}</li>`).join('')}</ul>` : '<p class="help">최근 3개월 중개거래가 없어 가격 위치를 판정하지 못했습니다.</p>'}<p>${esc(recent)}</p>${evLine}
<h3 id="section-ask">호가 점검기</h3><form class="best-ask" data-best-ask="${esc(id)}" data-best-type="${index}"><label>부르는 값(호가)<input name="price" inputmode="decimal" autocomplete="off" placeholder="예: 5억 2천, 5.2억" value="${esc(ask.text || '')}"></label>${floors.length ? `<label>층<select name="floor">${floors.map(f => `<option value="${esc(f)}"${(ask.floor || base) === f ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></label>` : ''}<button class="primary" type="submit">이 값이면 어떤가요?</button></form><div class="best-ask-result" aria-live="polite">${result}</div>
<h3 id="section-trades">실거래 이력 <small>같은 평형(전용 ${esc(t.area)}㎡ ±3%)</small></h3>${seriesChart(t.series, t.est)}${trades.length ? `<div class="table-wrap"><table class="best-table"><thead><tr><th>계약일</th><th>전용·층</th><th>거래가</th><th>구분</th></tr></thead><tbody>${trades.map(x => `<tr${x.direct ? ' class="direct"' : ''}><td>${esc(x.date)}</td><td>${esc(x.area)}㎡ · ${x.floor == null ? '?' : esc(x.floor)}층</td><td>${esc(won(x.price))}</td><td>${x.direct ? '직거래 · 시세 계산 제외' : '중개거래'}</td></tr>`).join('')}</tbody></table></div>` : ''}<p class="help">국토교통부 실거래가 공개시스템 신고 자료입니다. 해제된 거래는 뺐고, 직거래는 가족 간 거래가 섞일 수 있어 시세 계산에서 뺐습니다. 지금 파는 값(호가)이 아닙니다.</p></div>`;
  }
  function askResultHtml(r, price) {
    const p100 = v => (num(v) === null ? '?' : Math.round(v * 100));
    const head = { good: ['good', '유리한 값입니다'], ok: ['mid', '시세 수준입니다'], warn: ['warn', '시세보다 비쌉니다'], bad: ['bad', '많이 비쌉니다 — 깎지 못하면 보류하세요'] }[r.grade];
    const row = r.row ? `과거에 추정 시세 대비 이만큼(${esc(r.row.label)}) 주고 산 ${r.row.n.toLocaleString('ko-KR')}건 중 ${p100(r.row.loss)}%가 1년 뒤 손해였습니다(거래비용 3% 포함, 값이 내려간 경우만 세면 ${p100(r.row.nominal_loss)}%). 시세대로 산 경우는 ${p100(r.table.rows.find(x => x.lo === -0.01)?.loss)}%였습니다.` : '이 유형은 웃돈별 과거 결과 자료가 아직 부족합니다(빌라는 자료 기간이 짧습니다). 추정 시세 이하인지로만 판단하세요.';
    return `<div class="best-ask-out g-${head[0]}"><strong>${esc(won(price))} → 추정 시세${r.floorAdjusted ? '(그 층 기준)' : ''} ${esc(won(r.fair))} 대비 ${signed(r.premium)} · ${head[1]}</strong><p>${row}</p></div>`;
  }
  function peersHtml(buy, t) {
    const peers = buy.peers;
    if (!peers?.list?.length) return '<p class="help">같은 동에 비교할 만한 집(면적 ±20%·연식 ±10년)이 3곳 미만이라 주변 시세표를 만들지 못했습니다.</p>';
    const mine = t.est / t.area, max = Math.max(mine, ...peers.list.map(o => o.ppm));
    const bar = (name, ppm, est, extra, me) => `<tr${me ? ' class="me"' : ''}><th scope="row">${name}</th><td>${extra}</td><td>${esc(won(est))}</td><td class="bar"><span style="width:${(ppm / max * 100).toFixed(1)}%"></span><b>㎡당 ${Math.round(ppm / 1e4).toLocaleString('ko-KR')}만</b></td></tr>`;
    const rows = [bar('이 집', mine, t.est, `${esc(t.area)}㎡`, true), ...peers.list.map(o => bar(`<a href="#/properties/${encodeURIComponent(o.id)}">${esc(o.name)}</a>`, o.ppm, o.est, `${esc(o.area)}㎡${o.year ? ` · ${esc(o.year)}년` : ''} · 12개월 ${esc(o.n12)}건`, false))];
    return `<p>같은 동의 비슷한 집 ${peers.count}곳과 비교하면 ㎡당 <strong>${pct(peers.gap, 1)} ${peers.gap < 0 ? '쌉니다' : '비쌉니다'}</strong>(${peers.count}곳 중 ${peers.cheaper_than}곳이 이 집보다 비쌈).</p><div class="table-wrap"><table class="best-table best-peers"><thead><tr><th>집</th><th>면적·연식·거래</th><th>추정 시세</th><th>㎡당 값</th></tr></thead><tbody>${rows.join('')}</tbody></table></div><p class="help">각 집의 대표 평형 추정 시세끼리 견준 값입니다. 층·향·수리 상태는 맞추지 못했습니다. 아파트에서는 ‘주변보다 싸다’가 이후 손해율을 꾸준히 가르지 못했습니다 — 싼 데는 이유가 있을 수 있으니 이유를 확인하세요.</p>`;
  }
  function mapHtml(p, l) {
    const lat = num(p.location?.latitude) ?? num(l.lat), lon = num(p.location?.longitude) ?? num(l.lon), ext = (href, label) => `<a class="button" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    const station = l.station && num(l.station.dist_m) !== null ? `<p>가장 가까운 역은 <strong>${esc(l.station.name || '역')}</strong>, 직선 ${Math.round(l.station.dist_m)}m(걸어서 약 ${Math.ceil(l.station.dist_m / 67)}분 이상)입니다.</p>` : '';
    if (lat === null || lon === null) return `${station}<p class="help">좌표가 없어 지도를 그리지 못했습니다.</p><div class="actions">${ext(`https://map.kakao.com/link/search/${encodeURIComponent(p.addressLabel || p.name || '')}`, '카카오맵에서 찾기')}</div>`;
    const d = 0.0045, xy = `${lat.toFixed(6)},${lon.toFixed(6)}`, name = encodeURIComponent(String(p.name || '').replace(/,/g, ' '));
    return `${station}<iframe class="best-map" title="${esc(p.name)} 위치 지도" loading="lazy" referrerpolicy="no-referrer" src="https://www.openstreetmap.org/export/embed.html?bbox=${lon - d}%2C${lat - d * 0.7}%2C${lon + d}%2C${lat + d * 0.7}&amp;layer=mapnik&amp;marker=${lat}%2C${lon}"></iframe><div class="actions">${ext(`https://map.kakao.com/link/map/${name},${xy}`, '카카오맵에서 크게 보기')}${ext(`https://map.kakao.com/link/roadview/${xy}`, '로드뷰로 골목·외관 보기')}${ext(`https://map.naver.com/p/search/${encodeURIComponent(p.addressLabel || p.name || '')}`, '네이버 지도')}</div><p class="help">지도: © OpenStreetMap 기여자. 핀은 주소 좌표라 동·출입구와 조금 다를 수 있습니다.</p>`;
  }
  function planHtml(p, l) {
    const safe = v => { try { const u = new URL(v); return ['https:', 'http:'].includes(u.protocol) ? u.href : null; } catch { return null; } };
    const ext = (href, label) => `<a class="button" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`, links = [];
    const complex = l.link_kind === '단지' ? safe(l.link) : null, search = safe(l.naver_search), hogang = safe(l.hogangnono_url);
    if (complex) links.push(ext(complex, '평면도·매물 사진 (네이버 부동산 단지)')); else if (search) links.push(ext(search, '네이버 부동산에서 단지 찾기'));
    if (hogang) links.push(ext(hogang, '호갱노노 단지 정보'));
    const text = p.propertyType === 'apartment'
      ? '아파트 평면도는 네이버 부동산 단지 화면의 ‘단지정보 → 평면도’에서 평형별로 볼 수 있습니다. 평면도 그림은 저작권이 있어 이 화면에 싣지 않고 링크로 안내합니다.'
      : '빌라는 평면도를 모아 둔 공개 자료가 없습니다. 중개사에게 도면을 요청하거나, 정부24·세움터에서 건축물현황도(소유자 동의 필요)를 확인하세요. 실제 구조가 대장과 다르면 불법 증축일 수 있습니다.';
    return `<p>${text}</p>${links.length ? `<div class="actions">${links.join('')}</div>` : ''}<p class="help">방 개수·구조·향·수리 상태는 이 자료에 없습니다. 방문해서 확인하세요.</p>`;
  }
  function redevHtml(p, l) {
    const S = root.WorkspaceHomeStory;
    let lines = [];
    try { lines = S?.build({ property: p, legacy: l, complete: true })?.sections?.find(s => s.key === 'future')?.lines || []; } catch { lines = []; }
    const age = num(l.age), pz = l.parcel_zone?.verdict, head = num(l.far_headroom);
    let label, tone;
    if (pz === 'redevelopment_confirmed') { label = '정비구역 안 — 사업 단계와 조합원 자격부터 확인'; tone = 'good'; }
    else if (pz === 'pre_designation') { label = '구역 지정 전 단계 — 성사 여부 불확실'; tone = 'mid'; }
    else if (age !== null && age >= 30 && head !== null && head >= 50) { label = '오래됐고 용적률 차이는 있음 — 아직 계획은 없음'; tone = 'mid'; }
    else if (age !== null && age >= 30) { label = '오래됐지만 재건축 근거 약함'; tone = 'bad'; }
    else if (age !== null) { label = `준공 ${age}년 — 재건축을 기대할 시기 아님`; tone = 'neutral'; }
    else { label = '판단 자료 부족'; tone = 'neutral'; }
    return `<p class="best-redev g-${tone}"><strong>${esc(label)}</strong></p>${lines.length ? `<ul class="best-facts">${lines.map(x => `<li class="tone-${x.tone === 'good' ? 'good' : x.tone === 'bad' ? 'bad' : 'neutral'}"><strong>${esc(x.label)}</strong> ${esc(x.text)}${x.basis ? ` <small>${esc(x.basis)}</small>` : ''}</li>`).join('')}</ul>` : '<p class="help">용적률·정비구역 자료를 불러오지 못했습니다.</p>'}<p class="help">재건축·재개발 기대만으로 사지 마세요. 사업이 실제로 되는지, 되더라도 내가 조합원이 되는지, 추가 분담금이 얼마인지는 이 자료로 알 수 없습니다. 가격 순서에는 이 기대를 넣지 않았습니다.</p>`;
  }
  function rightsHtml(p, l, buy) {
    const flags = [], pz = l.parcel_zone?.verdict, direct = num(buy?.liquidity?.direct12), ext = (href, label) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    if (pz === 'redevelopment_confirmed') flags.push(['bad', '이 집 땅이 정비구역 안입니다. 사업 단계에 따라 지금 사면 조합원이 못 되고 현금청산될 수 있습니다(재건축은 조합설립인가, 재개발은 관리처분인가 이후 · 투기과열지구 기준). 조합·구청에 단계와 승계 가능 여부를 먼저 확인하세요.']);
    else if (pz === 'pre_designation') flags.push(['warn', '정비구역 지정 전 건축행위 제한 구역입니다. 권리산정기준일 이후에 산 집은 새 집을 못 받을 수 있으니 기준일을 구청에 확인하세요.']);
    if (l.occupancy === '실거주 전용') flags.push(['warn', '토지거래허가구역입니다. 구청 허가를 받아야 계약이 유효하고, 사면 2년은 직접 살아야 합니다(전세 끼고 매수 불가).']);
    if (direct !== null && direct >= 0.3) flags.push(['warn', `최근 1년 거래의 ${Math.round(direct * 100)}%가 직거래입니다. 가족·지인 간 거래가 섞여 실제 시세와 다를 수 있습니다.`]);
    if (p.propertyType === 'villa') {
      if (l.land_share_evidence?.registered_verified !== true) flags.push(['warn', '대지권(땅 지분) 등기 여부를 확인하지 못했습니다. 등기부 표제부에 ‘대지권의 표시’가 있는지 꼭 보세요 — 없으면 대출·재개발 권리에 문제가 생깁니다.']);
      flags.push(['warn', '빌라는 건축물대장의 용도가 ‘다세대·연립주택’인지, ‘위반건축물’ 표시가 없는지 확인하세요. 근린생활시설을 집으로 쓴 곳(근생빌라)은 주택담보대출·전입이 막힐 수 있습니다.']);
    }
    const known = flags.length ? `<ul class="best-facts">${flags.map(([tone, text]) => `<li class="tone-${tone === 'bad' ? 'bad' : 'warn'}">${esc(text)}</li>`).join('')}</ul>` : '<p>공개 자료에서 이 집에만 해당하는 권리 위험 신호는 찾지 못했습니다. 아래 서류 확인은 그래도 필요합니다.</p>';
    return `<div class="notice warning"><strong>권리관계는 이 화면이 대신 확인하지 못합니다.</strong> 등기부등본은 동·호수별로 떼어야 하고 매일 바뀝니다. 계약 당일 발급본으로 직접 확인하세요.</div><h3>공개 자료로 미리 보이는 것</h3>${known}<h3>계약 전에 직접 떼어 볼 서류</h3><ol class="best-docs"><li><strong>등기사항전부증명서</strong> — 갑구: 소유자가 계약 상대와 같은지, 가압류·가처분·신탁·경매 표시. 을구: 근저당(채권최고액)·전세권. 근저당은 잔금일에 말소하는 조건을 계약서에 적습니다. ${ext('https://www.iros.go.kr/', '인터넷등기소(열람 700원)')}</li><li><strong>건축물대장</strong> — 용도, 위반건축물 표시, 전용면적이 계약 내용과 같은지. ${ext('https://www.gov.kr/', '정부24')} · ${ext('https://www.eais.go.kr/', '세움터')}</li><li><strong>토지이용계획확인서</strong> — 용도지역, 정비구역·도시계획시설 저촉. ${ext('https://www.eum.go.kr/', '토지이음')}</li><li><strong>전입세대확인서·임대차 계약서</strong> — 세입자가 있으면 보증금·만기·대항력. 주민센터에서 매도인과 함께 발급.</li><li><strong>국세·지방세 완납증명, 관리비 정산</strong> — 체납 세금은 집에 따라올 수 있습니다.</li><li><strong>실거래가 재확인</strong> — 계약 직전 같은 평형 최신 신고가. ${ext('https://rt.molit.go.kr/', '국토교통부 실거래가 공개시스템')}</li></ol><p class="help">계약금은 등기부상 소유자 명의 계좌로만 보내세요. 대리인이 나오면 위임장·인감증명서를 확인합니다.</p>`;
  }
  function report(ui, p) {
    lastUi = ui; loadModel(ui);
    if (ui.state.mode === 'demo') return '';
    const ctx = ui.state.contexts.get(p.id), l = ctx?.legacy || legacyOf(ui, p) || {}, buy = l.buy, kind = kindKey(p), full = buy && Array.isArray(buy.types) ? buy : null, b = summary(buy);
    if (!b) return `<section class="panel best-report" id="section-report"><h2>계약 전 보고서</h2><p class="notice">이 집은 최근 2년 중개거래가 없어(직거래뿐이거나 40㎡ 미만) 시세를 추정하지 못했습니다. 직거래는 가족 간 거래가 섞일 수 있어 시세로 쓰지 않습니다. 주변 비슷한 집 거래와 중개사 확인이 먼저입니다.</p></section>`;
    const v = verdict(b, kind), loan = ui.loanFor(p), c = ceiling(b.est), status = loan?.screen?.status;
    const moneyText = status === 'possible' ? `내 돈으로 살 수 있습니다 — 필요 현금 ${won(Math.ceil(loan.cash.neededKrw / 1e4) * 1e4)}, 매달 원금+이자 ${won(Math.ceil(loan.monthly.paymentKrw / 1e4) * 1e4)}(추정 시세·최대 대출 가정).` : status === 'not_possible' ? `지금 조건으로는 자금이 모자랍니다 — ${loan.screen.failures?.[0] || loan.screen.reasons?.[0] || '필요한 돈을 확인하세요'}.` : '예산(현금·연소득·기존 빚·생애최초 여부)을 마저 넣으면 살 수 있는지 판정합니다.';
    const index = full ? Math.min(typeChoice.get(p.id) ?? full.main, full.types.length - 1) : 0;
    const tabs = full && full.types.length > 1 ? `<div class="best-tabs" role="tablist" aria-label="평형 선택">${full.types.map((t, i) => `<button role="tab" aria-selected="${i === index}" data-best-type-tab="${i}" data-best-id="${esc(p.id)}">${esc(t.label)} · ${esc(t.area)}㎡ <small>${esc(eok(t.est))}</small></button>`).join('')}</div>` : '';
    const body = full ? `${tabs}<div id="best-type-slot">${typePanel(full, index, kind, p.id)}</div>
<details class="best-fold" data-disclosure="best-peers" open><summary>주변 시세와 비교 <span>같은 동 비슷한 집</span></summary><div id="section-peers">${peersHtml(full, full.types[full.main])}</div></details>
<details class="best-fold" data-disclosure="best-map" open><summary>위치 지도 <span>역·주변</span></summary><div id="section-map">${mapHtml(p, l)}</div></details>
<details class="best-fold" data-disclosure="best-plan"><summary>평면도·사진 <span>구조 확인</span></summary><div>${planHtml(p, l)}</div></details>
<details class="best-fold" data-disclosure="best-redev"><summary>재건축·재개발 가능성 <span>기대해도 되나</span></summary><div id="section-redev">${redevHtml(p, l)}</div></details>
<details class="best-fold" data-disclosure="best-rights" open><summary>권리관계 <span>계약 전에 꼭</span></summary><div id="section-rights2">${rightsHtml(p, l, full)}</div></details>` : '<p class="notice">실거래 이력·주변 시세·지도를 불러오는 중입니다.</p>';
    return `<section class="panel best-report v-${v.key}" id="section-report" data-best-report="${esc(p.id)}"><div class="best-report-head"><div><p class="eyebrow">계약 전 보고서</p><h2>${esc(v.label)}</h2><p>${esc(v.reason)}</p><p class="best-money ${status === 'not_possible' ? 'short' : ''}">${esc(moneyText)}</p></div><div class="best-report-price"><span>${esc(b.label || '')} 추정 시세</span><strong>${esc(won(b.est))}</strong><small>유리한 계약가 ${esc(won(c.good))} 이하</small></div></div>${body}${evidenceHtml(false)}</section>`;
  }

  // ── 동작 연결 ──
  function bind(ui) {
    lastUi = ui;
    if (bound || !root.document) return;
    bound = true;
    const doc = root.document;
    doc.addEventListener('change', e => {
      const el = e.target.closest?.('[data-best-filter]');
      if (!el) return;
      const key = el.dataset.bestFilter;
      view[key] = el.type === 'checkbox' ? el.checked : key === 'minArea' ? Number(el.value) : el.value;
      view.limit = 12;
      lastUi?.render?.();
    });
    doc.addEventListener('click', e => {
      if (e.target.closest?.('[data-best-more]')) { view.limit += 12; const y = root.scrollY; lastUi?.render?.(); root.scrollTo?.(0, y); return; }
      const tab = e.target.closest?.('[data-best-type-tab]');
      if (tab) { typeChoice.set(tab.dataset.bestId, Number(tab.dataset.bestTypeTab)); const y = root.scrollY; lastUi?.render?.(); root.scrollTo?.(0, y); }
    });
    doc.addEventListener('submit', e => {
      const form = e.target.closest?.('[data-best-ask]');
      if (!form) return;
      e.preventDefault();
      const id = form.dataset.bestAsk, ui2 = lastUi, p = ui2?.state.properties.find(x => x.id === id), buy = ui2?.state.contexts.get(id)?.legacy?.buy;
      const text = form.elements.price.value, price = root.WorkspaceLoanEstimate?.parsePriceInput?.(text) ?? null, floor = form.elements.floor?.value || null, slot = form.parentElement.querySelector('.best-ask-result');
      if (!p || !buy || price === null) { if (slot) slot.innerHTML = '<p class="notice warning">금액을 읽지 못했습니다. ‘5억 2천’ 또는 ‘5.2억’처럼 적어 주세요.</p>'; return; }
      const result = checkAsk(model, kindKey(p), buy.types[Number(form.dataset.bestType)], price, floor);
      askState.set(id, { text, price, floor, result, type: Number(form.dataset.bestType) });
      if (slot && result) slot.innerHTML = askResultHtml(result, price);
    });
  }

  return Object.freeze({ VERSION, SURE_TRADES, GOOD_DISCOUNT, summary, ceiling, verdict, rank, reasons, gradeEvidence, premiumRows, checkAsk, page, homeTeaser, cardLine, report, bind,
    _setModel(m) { model = m; modelState = m ? 'ready' : 'empty'; } });
});
