/* finance-v1.0: pure local scenario arithmetic. No tax/lending policy defaults.
 * Monetary wire values are integer KRW strings; posting uses BigInt, half away
 * from zero. Discounted present values alone use bounded floating arithmetic.
 * This module is intentionally independent of the legacy advisor/scenario UI. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkspaceFinance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MODEL_VERSION = 'finance-v1.0';
  class MissingInput extends Error { constructor(message) { super(message); this.name = 'MissingInput'; } }
  class RuleConflict extends Error { constructor(message) { super(message); this.name = 'RuleConflict'; } }
  function requireMoney(value, allowNegative = false) {
    if (value === null || value === undefined) throw new MissingInput('Missing money is not zero.');
    if (typeof value !== 'bigint' && (typeof value !== 'string' || !/^-?(0|[1-9]\d*)$/.test(value))) throw new TypeError('Expected integer KRW string.');
    const n = BigInt(value);
    if (!allowNegative && n < 0n) throw new RangeError('Expected non-negative KRW.');
    return n;
  }
  function finiteNumber(n, minimum, exclusive = false) {
    if (typeof n !== 'number' || !Number.isFinite(n) || (exclusive ? n <= minimum : n < minimum)) throw new RangeError('Invalid finite rate/area.');
    return n;
  }
  function integer(n, minimum = 0) {
    if (!Number.isSafeInteger(n) || n < minimum) throw new RangeError('Expected integer period/sequence.');
    return n;
  }
  function dateValue(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new RangeError('Expected YYYY-MM-DD date.');
    const t = Date.parse(s + 'T00:00:00.000Z');
    if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== s) throw new RangeError('Invalid calendar date.');
    return t;
  }
  function addMonths(day, month) {
    dateValue(day); integer(month);
    const [y, m, d] = day.split('-').map(Number);
    const end = new Date(Date.UTC(y, m - 1 + month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m - 1 + month, Math.min(d, end))).toISOString().slice(0, 10);
  }
  function monthIndex(day, origin) {
    if (dateValue(day) < dateValue(origin)) throw new RangeError('Cash event precedes valuation date.');
    const a = day.split('-').map(Number), b = origin.split('-').map(Number);
    return (a[0] - b[0]) * 12 + a[1] - b[1];
  }
  function decimalFraction(value) {
    finiteNumber(value, 0);
    const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
    const places = (mantissa.split('.')[1] || '').length - Number(exponent);
    const digits = BigInt(mantissa.replace('.', ''));
    return places >= 0 ? [digits, 10n ** BigInt(places)] : [digits * 10n ** BigInt(-places), 1n];
  }
  function roundDiv(n, d) {
    if (d <= 0n) throw new RangeError('Positive denominator required.');
    return n < 0n ? -roundDiv(-n, d) : (n + d / 2n) / d;
  }
  function paymentFraction(principal, annualNominalRate, months) {
    const p = requireMoney(principal); finiteNumber(annualNominalRate, 0); integer(months, 1);
    if (months > 1200) throw new RangeError('Loan terms above 1200 months are outside this model.');
    if (annualNominalRate === 0) return [p, BigInt(months)];
    const [n, yearD] = decimalFraction(annualNominalRate), d = yearD * 12n;
    const growth = (d + n) ** BigInt(months), base = d ** BigInt(months);
    return [p * n * growth, d * (growth - base)];
  }
  // Unrounded computational helper for the independent reference cases only.
  // Scenario monetary outputs and amortization postings use integer strings.
  function monthlyPayment(principal, annualNominalRate, months) {
    const [n, d] = paymentFraction(principal, annualNominalRate, months);
    return Number(n / d) + Number((n % d) * 1000000000000000n / d) / 1e15;
  }
  function amortizationSchedule(principal, annualNominalRate, months, startDate) {
    const [pn, pd] = paymentFraction(principal, annualNominalRate, months);
    if (startDate != null) dateValue(startDate);
    const scheduled = roundDiv(pn, pd), [rn, rd] = decimalFraction(annualNominalRate);
    let balance = requireMoney(principal), totalInterest = 0n, totalPrincipal = 0n;
    const payments = [];
    for (let month = 1; month <= months; month++) {
      const interest = roundDiv(balance * rn, rd * 12n);
      let principalPaid = month === months ? balance : scheduled - interest;
      if (principalPaid < 0n) throw new RangeError('Rounded payment produces negative amortization.');
      if (principalPaid > balance) principalPaid = balance;
      balance -= principalPaid; totalPrincipal += principalPaid; totalInterest += interest;
      payments.push({month, date: startDate == null ? null : addMonths(startDate, month), principalKrw: String(principalPaid), interestKrw: String(interest), paymentKrw: String(principalPaid + interest), balanceKrw: String(balance)});
    }
    return {scheduledPaymentKrw: String(scheduled), finalBalanceKrw: String(balance), totalPrincipalKrw: String(totalPrincipal), totalInterestKrw: String(totalInterest), payments, rounding: 'half_away_from_zero_each_posting_final_principal_adjustment'};
  }
  function discountableMoney(value) {
    const n = requireMoney(value, true);
    if (n > 9007199254740991n || n < -9007199254740991n) throw new RangeError('Discounted calculation exceeds exact Number input range.');
    return Number(n);
  }
  function compensatedSum(values) {
    let sum = 0, correction = 0;
    for (const x of values) {
      const t = sum + x;
      correction += Math.abs(sum) >= Math.abs(x) ? (sum - t) + x : (x - t) + sum;
      sum = t;
    }
    return sum + correction;
  }
  function monthlyNpv(cashflows, annualEffectiveRate) {
    finiteNumber(annualEffectiveRate, -1, true);
    return compensatedSum(cashflows.map(([month, amount]) => {
      integer(month); return discountableMoney(amount) * Math.exp(-month / 12 * Math.log1p(annualEffectiveRate));
    }));
  }
  function xnpv(cashflows, annualEffectiveRate, valuationDate) {
    finiteNumber(annualEffectiveRate, -1, true); const base = dateValue(valuationDate);
    return compensatedSum(cashflows.map(([day, amount]) => {
      const elapsed = dateValue(day) - base;
      if (elapsed < 0) throw new RangeError('Cash event precedes valuation date.');
      return discountableMoney(amount) * Math.exp(-elapsed / 86400000 / 365 * Math.log1p(annualEffectiveRate));
    }));
  }
  function safeIrr(flows, evaluator) {
    const totals = new Map();
    flows.forEach(([period, amount]) => totals.set(period, (totals.get(period) || 0n) + requireMoney(amount, true)));
    const rows = Array.from(totals).filter(([, n]) => n !== 0n).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    let changes = 0;
    for (let i = 1; i < rows.length; i++) if ((rows[i][1] > 0n) !== (rows[i - 1][1] > 0n)) changes++;
    if (!changes) return {status: 'no_irr', annualRate: null};
    if (changes > 1) return {status: 'multiple_sign_changes', annualRate: null};
    let lo = -0.999999, hi = 1000, vl, vh;
    try { vl = evaluator(rows, lo); vh = evaluator(rows, hi); } catch (_) { return {status: 'not_bracketed', annualRate: null}; }
    if (!Number.isFinite(vl) || !Number.isFinite(vh)) return {status: 'not_bracketed', annualRate: null};
    if (vl === 0) return {status: 'ok', annualRate: lo};
    if (vh === 0) return {status: 'ok', annualRate: hi};
    if ((vl > 0) === (vh > 0)) return {status: 'not_bracketed', annualRate: null};
    for (let i = 0; i < 300; i++) {
      const mid = (lo + hi) / 2, vm = evaluator(rows, mid);
      if (!Number.isFinite(vm)) return {status: 'not_bracketed', annualRate: null};
      if (Math.abs(vm) <= .001 || hi - lo <= 1e-13) return {status: 'ok', annualRate: mid};
      if ((vm > 0) === (vl > 0)) { lo = mid; vl = vm; } else hi = mid;
    }
    return {status: 'not_bracketed', annualRate: null};
  }
  function safeMonthlyIrr(flows) {
    flows.forEach(([m, a]) => { integer(m); requireMoney(a, true); });
    return safeIrr(flows, monthlyNpv);
  }
  function safeXirr(flows, valuationDate) {
    flows.forEach(([d, a]) => { if (dateValue(d) < dateValue(valuationDate)) throw new RangeError('Past cash event.'); requireMoney(a, true); });
    return safeIrr(flows, (rows, rate) => xnpv(rows, rate, valuationDate));
  }
  function closingEquity(price, cost, loan, deposit) {
    const [p, c, l, d] = [price, cost, loan, deposit].map(x => requireMoney(x));
    if (d > p) throw new RangeError('Deposit credit exceeds gross purchase price.');
    const result = p + c - l - d;
    if (result < 0n) throw new RangeError('Excess financing requires separate review.');
    return String(result);
  }
  function saleEquity(price, cost, loanBalance, transferredDeposit) {
    const [p, c, l, d] = [price, cost, loanBalance, transferredDeposit].map(x => requireMoney(x));
    return String(p - c - l - d);
  }
  function contribution(appraisal, ratio, memberPrice) {
    const p = requireMoney(appraisal), m = requireMoney(memberPrice), [n, d] = decimalFraction(ratio);
    const rights = roundDiv(p * n, d), estimate = m - rights;
    return {rightValueKrw: String(rights), contributionKrw: String(estimate), status: estimate < 0n ? 'refund_requires_evidence' : 'illustrative_estimate'};
  }
  function farCapacity(landBasisSqm, plannedFarMultiple, memberArea, otherArea) {
    [landBasisSqm, plannedFarMultiple, memberArea, otherArea].forEach(n => finiteNumber(n, 0));
    const capacity = landBasisSqm * plannedFarMultiple, residual = capacity - memberArea - otherArea;
    if (!Number.isFinite(capacity) || residual < -1e-6) throw new RangeError('Allocated same-basis area exceeds FAR capacity.');
    return {farCountedAreaSqm: capacity, residualSameBasisSqm: Math.max(0, residual)};
  }
  function validateEvent(event) {
    if (!event || typeof event.id !== 'string' || !event.id) throw new TypeError('Event id required.');
    dateValue(event.date); requireMoney(event.amountKrw, true);
    if (event.sequence != null && !Number.isSafeInteger(event.sequence)) throw new TypeError('Integer sequence required.');
    if (event.certainty != null && !['confirmed', 'user_assumption', 'conditional'].includes(event.certainty)) throw new TypeError('Invalid certainty.');
  }
  // Settlement groups contain simultaneous contractual offsets, not separate
  // receipts. Conditional financing is removed BEFORE netting confirmed groups.
  function settlementPostings(events, includeConditionalFunding = false) {
    const groups = new Map(), rows = [], ids = new Set();
    for (const e of events) {
      validateEvent(e);
      if (ids.has(e.id)) throw new RangeError('Duplicate event id.'); ids.add(e.id);
      if (e.certainty === 'conditional' && requireMoney(e.amountKrw, true) > 0n && !includeConditionalFunding) continue;
      if (!e.settlementGroupId) { rows.push({...e}); continue; }
      const key = e.settlementGroupId;
      if (!groups.has(key)) groups.set(key, {...e, id: 'settlement:' + key, amountKrw: '0', eventRefs: []});
      const g = groups.get(key);
      if (g.date !== e.date || (g.sequence ?? null) !== (e.sequence ?? null)) throw new RangeError('Settlement group must share date and sequence.');
      g.amountKrw = String(requireMoney(g.amountKrw, true) + requireMoney(e.amountKrw, true)); g.eventRefs.push(e.id);
    }
    return rows.concat(Array.from(groups.values()));
  }
  function cashLedger(openingCash, reserve, events, includeConditionalFunding = false) {
    let cash = requireMoney(openingCash); const floor = requireMoney(reserve), ids = new Set(), byDay = new Map();
    for (const e of events) {
      validateEvent(e);
      if (ids.has(e.id)) throw new RangeError('Duplicate event id.'); ids.add(e.id);
      if (!byDay.has(e.date)) byDay.set(e.date, []); byDay.get(e.date).push(e);
    }
    const ordered = [], conservativeOrderDays = [];
    for (const day of Array.from(byDay.keys()).sort()) {
      const group = byDay.get(day), known = group.filter(e => e.sequence != null).length;
      if (known && known !== group.length) throw new RangeError('Mixed known and unknown sequence on same date.');
      if (known) {
        if (new Set(group.map(e => e.sequence)).size !== group.length) throw new RangeError('Duplicate sequence on date.');
        group.sort((a, b) => a.sequence - b.sequence);
      } else {
        group.sort((a, b) => Number(requireMoney(a.amountKrw, true) >= 0n) - Number(requireMoney(b.amountKrw, true) >= 0n) || a.id.localeCompare(b.id));
        const included = group.filter(e => includeConditionalFunding || !(e.certainty === 'conditional' && requireMoney(e.amountKrw, true) > 0n));
        if (included.some(e => requireMoney(e.amountKrw, true) < 0n) && included.some(e => requireMoney(e.amountKrw, true) > 0n)) conservativeOrderDays.push(day);
      }
      ordered.push(...group);
    }
    let minimum = cash, maximumReserveShortfall = floor > cash ? floor - cash : 0n;
    let vulnerableDate = maximumReserveShortfall > 0n ? 'opening' : null;
    const trace = [];
    for (const e of ordered) {
      const amount = requireMoney(e.amountKrw, true);
      if (e.certainty === 'conditional' && amount > 0n && !includeConditionalFunding) continue;
      cash += amount; if (cash < minimum) minimum = cash;
      const shortfall = floor > cash ? floor - cash : 0n;
      if (shortfall > maximumReserveShortfall) { maximumReserveShortfall = shortfall; vulnerableDate = e.date; }
      trace.push({eventId: e.id, date: e.date, balanceKrw: String(cash), reserveShortfallKrw: String(shortfall)});
    }
    return {finalCashKrw: String(cash), minimumCashKrw: String(minimum), maximumReserveShortfallKrw: String(maximumReserveShortfall), maximumZeroCashShortfallKrw: String(minimum < 0n ? -minimum : 0n), vulnerableDate, conservativeOrderDays, trace};
  }
  function selectRule(rules, asOf) {
    const day = dateValue(asOf), matches = [];
    for (const r of rules) {
      const start = dateValue(r.effectiveFrom), end = r.effectiveTo == null ? null : dateValue(r.effectiveTo), published = dateValue(r.publishedOn);
      if (end != null && end <= start) throw new RangeError('Rule end must follow start.');
      if (r.reviewState === 'approved' && published <= day && start <= day && (end == null || day < end)) matches.push(r);
    }
    if (matches.length > 1) throw new RuleConflict('Overlapping approved rule scope requires review.');
    return matches[0] || null;
  }
  function classifyCandidate({foundationReady, hasConfirmedFailure, listingConfirmed, rightsStatus, hasConditions}) {
    if (!['pass', 'fail', 'unknown', 'not_applicable'].includes(rightsStatus)) throw new RangeError('Invalid gate status.');
    if (!foundationReady) return 'INSUFFICIENT_DATA';
    if (hasConfirmedFailure || rightsStatus === 'fail') return 'NOT_FIT';
    if (!listingConfirmed || rightsStatus === 'unknown') return 'RESEARCH_ONLY';
    return hasConditions ? 'CONDITIONAL_REVIEW' : 'REVIEW_CANDIDATE';
  }

  function unique(values) { return Array.from(new Set(values)); }
  function makeTrace(input, options) {
    const generatedAt = options.generatedAt || new Date().toISOString();
    const inputBindings = {}, assumptions = [], calculations = [], records = new Map(), notApplicable = new Map();
    function bind(path, value, unit) {
      if (records.has(path)) return records.get(path);
      const supplied = (options.inputBindings || {})[path];
      if (supplied && (!['claim', 'assumption'].includes(supplied.sourceKind) || !supplied.sourceId)) throw new TypeError('Invalid input binding.');
      const binding = supplied ? {...supplied} : {sourceKind: 'assumption', sourceId: 'assumption:' + input.scenarioId + ':' + path};
      if (value === undefined) value = null;
      inputBindings[path] = binding;
      if (binding.sourceKind === 'assumption') assumptions.push({id: binding.sourceId, label: path, value, unit, origin: input.isDemo ? 'demo' : 'user', recordedAt: generatedAt, replacesClaimId: null, ...(binding.originalValue === undefined ? {} : {originalValue: binding.originalValue})});
      // The internal Calculation input contract supports numeric/string/null;
      // booleans remain booleans in Assumption and use an explicit string here.
      const record = {key: path, value: typeof value === 'boolean' ? String(value) : value, unit, sourceKind: binding.sourceKind, sourceId: binding.sourceId};
      records.set(path, record); return record;
    }
    function scalar(metric, value, unit, paths, missing = [], excluded = [], formula = metric, dependencies = []) {
      const id = 'calc:' + input.scenarioId + ':' + metric;
      const status = value == null ? 'blocked' : missing.length || excluded.length ? 'partial' : 'complete';
      const activePaths = paths.filter(p => !notApplicable.has(p) && !(excluded.includes(p) && records.get(p)?.value == null));
      calculations.push({id, formulaId: 'finance-v1.0/' + formula, modelVersion: MODEL_VERSION, inputs: activePaths.map(p => records.get(p)).filter(Boolean).concat(dependencies), output: {value, unit}, status, missingInputs: unique(missing), excludedCosts: unique(excluded), notApplicableInputs: paths.filter(p => notApplicable.has(p)).map(key => ({key, reason: notApplicable.get(key)})), generatedAt});
      return {value, unit, status: value == null ? 'missing' : status === 'partial' ? 'partial' : 'available', calculationId: id, missingInputs: unique(missing)};
    }
    return {generatedAt, inputBindings, assumptions, calculations, bind, scalar, notApplicable: (key, reason) => notApplicable.set(key, reason)};
  }
  function buildScenario(input, options = {}) {
    if (!input || typeof input.scenarioId !== 'string' || !input.scenarioId) throw new TypeError('scenarioId is required.');
    const trace = makeTrace(input, options), missing = [], excludedCosts = [], warnings = [], events = [];
    const values = {}, start = input.valuationDate, end = input.exitDate;
    const moneyKeys = ['purchasePriceKrw', 'acquisitionCostKrw', 'loanPrincipalKrw', 'assumedDepositKrw', 'prepaidContributionKrw', 'remainingContributionKrw', 'salePriceKrw', 'saleCostKrw', 'saleTaxKrw', 'monthlyNetRentKrw', 'monthlyHoldingCostKrw'];
    for (const key of moneyKeys) {
      trace.bind(key, input[key], 'KRW');
      if (input[key] == null) { values[key] = null; if (key === 'saleTaxKrw') excludedCosts.push(key); else missing.push(key); }
      else values[key] = requireMoney(input[key]);
    }
    ['valuationDate', 'exitDate', 'valuationMode', 'cashflowMode', 'exitKind', 'transferRemainingDepositAtExit', 'prepaidIncludedInPrice'].forEach(k => trace.bind(k, input[k], k.endsWith('Date') ? 'date' : 'choice'));
    ['annualEffectiveRate', 'annualNominalLoanRate', 'loanTermMonths'].forEach(k => trace.bind(k, input[k], k.endsWith('Months') ? 'months' : 'annual_rate'));
    if (values.loanPrincipalKrw === 0n) { trace.notApplicable('annualNominalLoanRate', '명시한 신규 대출 원금이 0원입니다.'); trace.notApplicable('loanTermMonths', '명시한 신규 대출 원금이 0원입니다.'); }
    if (values.prepaidContributionKrw === 0n) trace.notApplicable('prepaidIncludedInPrice', '명시한 기납부 분담금이 0원입니다.');
    if (start == null) missing.push('valuationDate'); else dateValue(start);
    if (end == null) missing.push('exitDate'); else dateValue(end);
    if (start && end && dateValue(end) <= dateValue(start)) throw new RangeError('Exit date must follow valuation date.');
    if (input.annualEffectiveRate == null) missing.push('annualEffectiveRate'); else finiteNumber(input.annualEffectiveRate, -1, true);
    if (!['monthly_scenario', 'actual_date'].includes(input.valuationMode)) missing.push('valuationMode');
    if (!['asset', 'equity'].includes(input.cashflowMode)) missing.push('cashflowMode');
    if (!['existing_asset_sale', 'intermediate_right_sale', 'completed_home_sale', 'unrealized_valuation'].includes(input.exitKind)) missing.push('exitKind');
    if (input.valuationMode === 'monthly_scenario') warnings.push('월별 시나리오는 같은 달의 현금흐름을 합산합니다. 일별 자금부족은 별도 원장에서 계산합니다.');
    if (input.exitKind === 'unrealized_valuation') warnings.push('미실현 평가액은 현금 유입이 아닙니다. 수익 지표는 평가 시점의 가정값이며 가계 원장에 매각대금을 넣지 않습니다.');
    if (input.exitKind === 'intermediate_right_sale') warnings.push('중간 단계 권리 매각가는 완공주택 총가격과 다릅니다. 매각 시점의 잔여분담금·권리·남은 기간을 반영한 가격 가정인지 재확인해야 합니다.');
    warnings.push('사용자 대출 가정이며 실제 대출 승인·규제 한도를 의미하지 않습니다.');
    function event(id, date, category, amount, scope, field, group = null, certainty = 'user_assumption') {
      if (!date || amount == null) return;
      if (start && dateValue(date) < dateValue(start)) throw new RangeError('Event precedes valuation.');
      if (end && dateValue(date) > dateValue(end)) throw new RangeError('Event follows exit.');
      events.push({id: input.scenarioId + ':' + id, scenarioId: input.scenarioId, date, sequence: null, category, amountKrw: String(amount), certainty, sourceRef: trace.inputBindings[field] ? trace.inputBindings[field].sourceId : null, settlementGroupId: group ? input.scenarioId + ':' + group : null, ledgerScope: scope});
    }
    let initial = null;
    const closeKeys = ['purchasePriceKrw', 'acquisitionCostKrw', 'loanPrincipalKrw', 'assumedDepositKrw', 'prepaidContributionKrw'];
    if (closeKeys.every(k => values[k] != null)) {
      initial = requireMoney(closingEquity(values.purchasePriceKrw, values.acquisitionCostKrw, values.loanPrincipalKrw, values.assumedDepositKrw));
      if (values.prepaidContributionKrw > 0n) {
        if (typeof input.prepaidIncludedInPrice !== 'boolean') { missing.push('prepaidIncludedInPrice'); initial = null; }
        else if (!input.prepaidIncludedInPrice) initial += values.prepaidContributionKrw;
      }
    }
    event('purchase', start, 'purchase_price', values.purchasePriceKrw == null ? null : -values.purchasePriceKrw, 'asset', 'purchasePriceKrw', 'closing');
    event('acquisition-cost', start, 'acquisition_cost', values.acquisitionCostKrw == null ? null : -values.acquisitionCostKrw, 'asset', 'acquisitionCostKrw', 'closing');
    event('loan-draw', start, 'loan_draw', values.loanPrincipalKrw, 'financing', 'loanPrincipalKrw', 'closing');
    event('deposit-credit', start, 'assumed_deposit_credit', values.assumedDepositKrw, 'financing', 'assumedDepositKrw', 'closing');
    if (input.prepaidIncludedInPrice === false) event('prepaid', start, 'separate_prepaid_contribution', values.prepaidContributionKrw == null ? null : -values.prepaidContributionKrw, 'asset', 'prepaidContributionKrw', 'closing');

    let loanBalance = values.loanPrincipalKrw, amortization = null;
    if (loanBalance != null && loanBalance > 0n) {
      if (input.annualNominalLoanRate == null) missing.push('annualNominalLoanRate');
      if (input.loanTermMonths == null) missing.push('loanTermMonths');
      if (start && end && input.annualNominalLoanRate != null && input.loanTermMonths != null) {
        amortization = amortizationSchedule(loanBalance, input.annualNominalLoanRate, input.loanTermMonths, start);
        for (const row of amortization.payments.filter(r => r.date <= end)) {
          // A scheduled bank debit is not proven simultaneous with sale closing.
          event('loan-payment-' + row.month, row.date, 'loan_payment', -requireMoney(row.paymentKrw), 'financing', 'loanPrincipalKrw');
          loanBalance = requireMoney(row.balanceKrw);
        }
      } else loanBalance = null;
    }
    let depositBalance = values.assumedDepositKrw;
    const depositRows = input.depositReturnEvents || [];
    if (!Array.isArray(depositRows)) throw new TypeError('depositReturnEvents must be an array.');
    const depositIds = new Set();
    depositRows.forEach((row, i) => {
      if (!row.id || depositIds.has(row.id)) throw new RangeError('Unique deposit return id required.'); depositIds.add(row.id);
      const key = 'depositReturnEvents.' + i;
      trace.bind(key + '.date', row.date, 'date'); trace.bind(key + '.amountKrw', row.amountKrw, 'KRW');
      if (row.date == null || row.amountKrw == null) { missing.push(key + (row.date == null ? '.date' : '.amountKrw')); depositBalance = null; return; }
      const amount = requireMoney(row.amountKrw); dateValue(row.date);
      if (depositBalance != null) { depositBalance -= amount; if (depositBalance < 0n) throw new RangeError('Deposit returns exceed assumed obligation.'); }
      event('deposit-return-' + row.id, row.date, 'deposit_return', -amount, 'financing', key + '.amountKrw');
    });
    if (depositBalance != null && depositBalance > 0n && input.transferRemainingDepositAtExit !== true) missing.push('transferRemainingDepositAtExit_or_return_schedule');
    if (depositBalance === 0n) trace.notApplicable('transferRemainingDepositAtExit', '매각 시 남는 승계 보증금 반환 의무가 0원입니다.');
    let contributionTotal = 0n;
    const contributions = input.contributionPayments || [];
    if (!Array.isArray(contributions)) throw new TypeError('contributionPayments must be an array.');
    const contributionIds = new Set();
    contributions.forEach((row, i) => {
      if (!row.id || contributionIds.has(row.id)) throw new RangeError('Unique contribution payment id required.'); contributionIds.add(row.id);
      const key = 'contributionPayments.' + i;
      trace.bind(key + '.date', row.date, 'date'); trace.bind(key + '.amountKrw', row.amountKrw, 'KRW'); trace.bind(key + '.certainty', row.certainty || 'user_assumption', 'choice');
      if (row.date == null || row.amountKrw == null) { missing.push(key + (row.date == null ? '.date' : '.amountKrw')); return; }
      const amount = requireMoney(row.amountKrw); contributionTotal += amount;
      event('contribution-' + row.id, row.date, 'remaining_contribution', -amount, 'asset', key + '.amountKrw', null, row.certainty || 'user_assumption');
    });
    if (values.remainingContributionKrw != null && contributionTotal !== values.remainingContributionKrw) missing.push('contributionPayments_sum_must_match_remainingContributionKrw');
    if (start && end) {
      const count = monthIndex(end, start);
      if (count > 1200) throw new RangeError('Scenario exceeds 1200 months.');
      for (let m = 1; m <= count; m++) {
        const day = addMonths(start, m); if (day > end) break;
        event('rent-' + m, day, 'net_rent_before_separate_holding_cost', values.monthlyNetRentKrw, 'asset', 'monthlyNetRentKrw');
        event('holding-cost-' + m, day, 'holding_cost_not_in_net_rent', values.monthlyHoldingCostKrw == null ? null : -values.monthlyHoldingCostKrw, 'asset', 'monthlyHoldingCostKrw');
      }
    }
    event('sale', end, input.exitKind === 'unrealized_valuation' ? 'unrealized_terminal_value' : 'sale_price', values.salePriceKrw, 'asset', 'salePriceKrw', 'exit');
    event('sale-cost', end, 'sale_cost', values.saleCostKrw == null ? null : -values.saleCostKrw, 'asset', 'saleCostKrw', 'exit');
    event('sale-tax', end, 'sale_tax', values.saleTaxKrw == null ? null : -values.saleTaxKrw, 'asset', 'saleTaxKrw', 'exit');
    event('loan-payoff', end, 'loan_payoff', loanBalance == null ? null : -loanBalance, 'financing', 'loanPrincipalKrw', 'exit');
    if (input.transferRemainingDepositAtExit === true) event('deposit-transfer', end, 'deposit_obligation_transfer', depositBalance == null ? null : -depositBalance, 'financing', 'assumedDepositKrw', 'exit');
    if (input.additionalEvents != null && !Array.isArray(input.additionalEvents)) throw new TypeError('additionalEvents must be an array.');
    (input.additionalEvents || []).forEach((row, i) => {
      validateEvent(row);
      if (!['asset', 'financing', 'household_only'].includes(row.ledgerScope)) throw new TypeError('Event ledgerScope is required.');
      if (!['confirmed', 'user_assumption', 'conditional'].includes(row.certainty)) throw new TypeError('Additional event certainty is required.');
      if (row.scenarioId !== input.scenarioId) throw new RangeError('Event belongs to another scenario.');
      if (start && row.date < start || end && row.date > end) throw new RangeError('Additional event outside scenario.');
      trace.bind('additionalEvents.' + i + '.amountKrw', row.amountKrw, 'KRW');
      trace.bind('additionalEvents.' + i + '.date', row.date, 'date');
      trace.bind('additionalEvents.' + i + '.ledgerScope', row.ledgerScope, 'choice');
      trace.bind('additionalEvents.' + i + '.certainty', row.certainty, 'choice');
      trace.bind('additionalEvents.' + i + '.sequence', row.sequence == null ? 'unknown_outflows_first' : row.sequence, 'sequence');
      trace.bind('additionalEvents.' + i + '.settlementGroupId', row.settlementGroupId || 'separate_event', 'settlement');
      events.push({...row});
    });
    // Validate IDs/group semantics immediately, even when other inputs are missing.
    settlementPostings(events, true);
    const investmentCashflows = {asset: events.filter(e => e.ledgerScope === 'asset'), equity: events.filter(e => e.ledgerScope !== 'household_only')};
    return {input, values, trace, events, investmentCashflows, initialEquityKrw: initial == null ? null : String(initial), remainingLoanKrw: loanBalance == null ? null : String(loanBalance), remainingDepositKrw: depositBalance == null ? null : String(depositBalance), amortization, missingInputs: unique(missing), excludedCosts, warnings, taxCoverage: values.saleTaxKrw == null ? 'partial' : 'user_estimate'};
  }
  function householdLedger(built, profile) {
    const {input, trace} = built, missing = [], events = [];
    if (!profile) return {confirmed: null, withConditional: null, missingInputs: ['profile']};
    function money(key, allowNegative = false) {
      trace.bind('profile.' + key, profile[key], 'KRW');
      if (profile[key] == null) { missing.push('profile.' + key); return null; }
      return requireMoney(profile[key], allowNegative);
    }
    const opening = money('cashAvailableKrw'), reserve = money('reserveKrw');
    trace.bind('profile.householdMode', profile.householdMode, 'choice');
    let surplus = null;
    if (profile.householdMode === 'net_surplus') surplus = money('monthlyNetSurplusKrw', true);
    else if (profile.householdMode === 'detailed') {
      const income = money('monthlyNetIncomeKrw'), living = money('monthlyLivingCostKrw'), housing = money('monthlyHousingCostKrw');
      let debtPayments = 0n;
      trace.bind('profile.noDebtConfirmed', profile.noDebtConfirmed, 'choice');
      if (!Array.isArray(profile.debts) || !profile.debts.length && !profile.noDebtConfirmed) missing.push('profile.debts_or_noDebtConfirmed');
      (profile.debts || []).forEach((debt, i) => {
        trace.bind('profile.debts.' + i + '.monthlyPaymentKrw', debt.monthlyPaymentKrw, 'KRW');
        if (debt.monthlyPaymentKrw == null) missing.push('profile.debts.' + i + '.monthlyPaymentKrw'); else debtPayments += requireMoney(debt.monthlyPaymentKrw);
      });
      if (income != null && living != null && housing != null) surplus = income - living - housing - debtPayments;
    } else missing.push('profile.householdMode');
    if (input.valuationDate && input.exitDate && surplus != null) {
      for (let m = 1; m <= monthIndex(input.exitDate, input.valuationDate); m++) {
        const date = addMonths(input.valuationDate, m); if (date > input.exitDate) break;
        events.push({id: input.scenarioId + ':household-surplus-' + m, scenarioId: input.scenarioId, date, sequence: null, category: 'household_surplus', amountKrw: String(surplus), certainty: 'user_assumption', sourceRef: null, settlementGroupId: null, ledgerScope: 'household_only'});
      }
    }
    (profile.futureCashEvents || []).forEach((row, i) => {
      trace.bind('profile.futureCashEvents.' + i + '.amountKrw', row.amountKrw, 'KRW');
      trace.bind('profile.futureCashEvents.' + i + '.date', row.date, 'date');
      trace.bind('profile.futureCashEvents.' + i + '.certainty', row.certainty, 'choice');
      if (row.amountKrw == null || row.date == null) { missing.push('profile.futureCashEvents.' + i); return; }
      dateValue(row.date); requireMoney(row.amountKrw, true);
      if (!['confirmed', 'user_assumption', 'conditional'].includes(row.certainty)) throw new TypeError('Future cash certainty is required.');
      if (input.valuationDate && row.date < input.valuationDate || input.exitDate && row.date > input.exitDate) return;
      events.push({...row, id: input.scenarioId + ':household:' + row.id, scenarioId: input.scenarioId, sequence: row.sequence ?? null, category: row.label || 'future_household_cash', ledgerScope: 'household_only', settlementGroupId: null});
    });
    // A terminal appraisal is not a bank receipt or an actual closing payoff.
    const bankEvents = built.events.filter(e => input.exitKind !== 'unrealized_valuation' || !(e.settlementGroupId === input.scenarioId + ':exit' && ['unrealized_terminal_value', 'sale_cost', 'sale_tax', 'loan_payoff', 'deposit_obligation_transfer'].includes(e.category))).concat(events);
    const essential = built.missingInputs.filter(k => k !== 'annualEffectiveRate' && k !== 'cashflowMode' && k !== 'valuationMode');
    if (missing.length || essential.length) return {confirmed: null, withConditional: null, missingInputs: unique(missing.concat(essential)), events};
    const confirmed = cashLedger(opening, reserve, settlementPostings(bankEvents, false), false);
    const withConditional = cashLedger(opening, reserve, settlementPostings(bankEvents, true), true);
    return {confirmed, withConditional, missingInputs: [], events};
  }
  function analyzeScenario(input, profile = null, options = {}) {
    const built = buildScenario(input, options), {trace} = built;
    const investmentMissing = built.missingInputs;
    let npvValue = null, irr = {status: 'missing', annualRate: null};
    const investmentEvents = built.investmentCashflows[input.cashflowMode] || [];
    if (!investmentMissing.length) {
      const flows = input.valuationMode === 'monthly_scenario' ? investmentEvents.map(e => [monthIndex(e.date, input.valuationDate), e.amountKrw]) : investmentEvents.map(e => [e.date, e.amountKrw]);
      const npv = input.valuationMode === 'monthly_scenario' ? monthlyNpv(flows, input.annualEffectiveRate) : xnpv(flows, input.annualEffectiveRate, input.valuationDate);
      if (!Number.isFinite(npv) || Math.abs(npv) > Number.MAX_SAFE_INTEGER) throw new RangeError('Present value exceeds supported output range.');
      npvValue = String(npv < 0 ? -Math.round(-npv) : Math.round(npv));
      irr = input.valuationMode === 'monthly_scenario' ? safeMonthlyIrr(flows) : safeXirr(flows, input.valuationDate);
    }
    const liquidity = householdLedger(built, profile), ledgerMissing = liquidity.missingInputs;
    const allPaths = Object.keys(trace.inputBindings), financePaths = allPaths.filter(k => !k.startsWith('profile.')), householdPaths = allPaths;
    const initialMissing = ['purchasePriceKrw', 'acquisitionCostKrw', 'loanPrincipalKrw', 'assumedDepositKrw', 'prepaidContributionKrw', 'prepaidIncludedInPrice'].filter(k => investmentMissing.includes(k));
    const initialEquity = trace.scalar('initialEquity', built.initialEquityKrw, 'KRW', ['purchasePriceKrw', 'acquisitionCostKrw', 'loanPrincipalKrw', 'assumedDepositKrw', 'prepaidContributionKrw', 'prepaidIncludedInPrice'], initialMissing, [], 'gross_price_plus_cost_less_loan_and_deposit_credit');
    const npv = trace.scalar('npv', npvValue, 'KRW', financePaths, investmentMissing, built.excludedCosts, input.valuationMode === 'actual_date' ? 'xnpv_ACT_365' : 'monthly_npv_annual_effective');
    const annualIrr = trace.scalar('annualIrr', irr.annualRate, 'annual_rate', financePaths, investmentMissing, built.excludedCosts, input.valuationMode === 'actual_date' ? 'safe_xirr_ACT_365' : 'safe_annual_irr_monthly');
    if (irr.status !== 'missing' && irr.status !== 'ok') annualIrr.status = 'not_applicable';
    const minimumCash = trace.scalar('minimumCash', liquidity.confirmed ? liquidity.confirmed.minimumCashKrw : null, 'KRW', householdPaths, ledgerMissing, built.excludedCosts, 'confirmed_only_daily_minimum_balance');
    const maximumReserveShortfall = trace.scalar('maximumReserveShortfall', liquidity.confirmed ? liquidity.confirmed.maximumReserveShortfallKrw : null, 'KRW', householdPaths, ledgerMissing, built.excludedCosts, 'max_reserve_less_daily_balance');
    const hasConditionalFunding = liquidity.events ? liquidity.events.some(e => e.certainty === 'conditional' && requireMoney(e.amountKrw, true) > 0n) || built.events.some(e => e.certainty === 'conditional' && requireMoney(e.amountKrw, true) > 0n) : false;
    const depends = !!(hasConditionalFunding && liquidity.confirmed && requireMoney(liquidity.confirmed.maximumReserveShortfallKrw) > 0n && requireMoney(liquidity.withConditional.maximumReserveShortfallKrw) < requireMoney(liquidity.confirmed.maximumReserveShortfallKrw));
    const warnings = [...built.warnings];
    if (liquidity.confirmed && liquidity.confirmed.conservativeOrderDays.length) warnings.push('같은 날 입출금 순서가 없어 지출을 먼저 반영했습니다: ' + liquidity.confirmed.conservativeOrderDays.join(', '));
    if (built.excludedCosts.length) warnings.push('양도세 미입력: 세전 계산이며 매각 후 자금도 세금만큼 줄어들 수 있습니다.');
    if (depends) warnings.push('조건부 자금 유입을 포함할 때만 현금 부족이 감소합니다. 확정 원장은 부족액을 유지합니다.');
    const missingInputs = unique(investmentMissing.concat(ledgerMissing));
    const calculationStatus = investmentMissing.length ? 'blocked' : missingInputs.length || built.excludedCosts.length ? 'partial' : 'complete';
    // Preserve comparisons and both funding cases even when the consumer passes
    // only ScenarioResult, as permitted by the minimal domain contract.
    const comparisonBasis = {modelVersion: MODEL_VERSION, valuationDate: input.valuationDate ?? null, exitDate: input.exitDate ?? null, valuationMode: input.valuationMode ?? null, cashflowMode: input.cashflowMode ?? null, annualEffectiveRate: input.annualEffectiveRate ?? null, exitKind: input.exitKind ?? null, taxCoverage: built.taxCoverage, excludedCosts: [...built.excludedCosts].sort(), debt: input.cashflowMode === 'asset' ? null : {loanPrincipalKrw: input.loanPrincipalKrw ?? null, annualNominalLoanRate: built.values.loanPrincipalKrw === 0n ? null : input.annualNominalLoanRate ?? null, loanTermMonths: built.values.loanPrincipalKrw === 0n ? null : input.loanTermMonths ?? null, assumedDepositKrw: input.assumedDepositKrw ?? null}, isDemo: !!input.isDemo};
    const summarize = ledger => ledger ? {minimumCashKrw: ledger.minimumCashKrw, maximumReserveShortfallKrw: ledger.maximumReserveShortfallKrw, maximumZeroCashShortfallKrw: ledger.maximumZeroCashShortfallKrw, vulnerableDate: ledger.vulnerableDate} : null;
    const scenario = {scenarioId: input.scenarioId, label: input.label || input.scenarioId, isUserAssumption: true, npv, annualIrr, irrStatus: irr.status, initialEquity, minimumCash, maximumReserveShortfall, mostVulnerableDate: liquidity.confirmed ? liquidity.confirmed.vulnerableDate === 'opening' ? input.valuationDate : liquidity.confirmed.vulnerableDate : null, dependsOnConditionalFunding: depends, excludedCosts: built.excludedCosts, eventRefs: built.events.map(e => e.id), calculationStatus, missingInputs, comparisonBasis, valuationMode: input.valuationMode ?? null, cashflowMode: input.cashflowMode ?? null, taxCoverage: built.taxCoverage, liquiditySummary: {confirmed: summarize(liquidity.confirmed), withConditional: summarize(liquidity.withConditional)}, assumedLoanPrincipalKrw: input.loanPrincipalKrw ?? null};
    return {scenario, calculationStatus, calculations: trace.calculations, assumptions: trace.assumptions, inputBindings: trace.inputBindings, events: built.events.concat(liquidity.events || []), investmentCashflows: built.investmentCashflows, liquidity: {confirmed: liquidity.confirmed, withConditional: liquidity.withConditional}, amortization: built.amortization, remainingLoanKrw: built.remainingLoanKrw, remainingDepositKrw: built.remainingDepositKrw, missingInputs, excludedCosts: built.excludedCosts, taxCoverage: built.taxCoverage, warnings, modelVersion: MODEL_VERSION, regulatoryLoan: {value: null, status: 'RULE_NOT_VERIFIED', ruleVersionId: null}};
  }
  return {MODEL_VERSION, MissingInput, RuleConflict, requireMoney, monthlyPayment, amortizationSchedule, monthlyNpv, xnpv, safeMonthlyIrr, safeXirr, closingEquity, saleEquity, contribution, farCapacity, cashLedger, settlementPostings, selectRule, classifyCandidate, addMonths, buildScenario, analyzeScenario};
});
