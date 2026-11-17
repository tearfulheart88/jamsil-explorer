/* Local decisions and evidence presentation. No network, logging, or automatic persistence. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorkspaceCore = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const VERSION = 'workspace-core-1.0';
  const DECISIONS = {
    REVIEW_CANDIDATE: '검토 가능', CONDITIONAL_REVIEW: '조건·확인 필요',
    RESEARCH_ONLY: '탐색 참고', NOT_FIT: '필수 조건 미충족', INSUFFICIENT_DATA: '기초 자료 부족'
  };
  const VALUE_STATES = { confirmed: '자료에서 확인', calculated: '계산', assumed: '사용자 가정', unverified: '미확인', conflicting: '자료 충돌', not_applicable: '해당 없음' };
  const clone = value => JSON.parse(JSON.stringify(value));
  const index = list => new Map((list || []).map(x => [x.id, x]));
  const integerMoney = x => typeof x === 'string' && /^-?(0|[1-9]\d*)$/.test(x);
  const hasValue = x => x !== null && x !== undefined && x !== '';
  function isoDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
  function localToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  function stableStringify(value) {
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }
  function localHash(value) {
    let h = 2166136261;
    for (const c of stableStringify(value)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return 'local-' + (h >>> 0).toString(16);
  }
  function parseMoney(value, options = {}) {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') throw new Error('금액은 원화 숫자 또는 억·만 단위로 입력하세요.');
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('정확한 정수 원화 문자열이 필요합니다.');
    let s = String(value).trim().replace(/원$/, '').trim();
    const negative = s.startsWith('-');
    if (negative) s = s.slice(1);
    if (negative && !options.allowNegative) throw new Error('음수 금액은 입력할 수 없습니다.');
    if (s.includes(',') && !/^\d{1,3}(,\d{3})+(?:\s*(?:억|만))?$/.test(s)) throw new Error('쉼표는 세 자리 단위로 입력하세요.');
    s = s.replace(/,/g, '').replace(/\s+/g, '');
    let total = 0n;
    if (/^\d+$/.test(s)) total = BigInt(s);
    else {
      const units = { 조: 1000000000000n, 억: 100000000n, 천만: 10000000n, 백만: 1000000n, 십만: 100000n, 만: 10000n, 천: 1000n, 백: 100n, 십: 10n };
      const re = /(\d+(?:\.\d+)?)(천만|백만|십만|조|억|만|천|백|십)/gy;
      let at = 0, previous = 1000000000000000000n, match;
      while ((match = re.exec(s))) {
        if (match.index !== at) break;
        const scale = units[match[2]];
        if (scale >= previous) throw new Error('큰 단위부터 한 번씩 입력하세요.');
        const [whole, fraction = ''] = match[1].split('.');
        const denominator = 10n ** BigInt(fraction.length);
        const numerator = BigInt(whole + fraction) * scale;
        if (numerator % denominator) throw new Error('1원 미만의 금액은 지원하지 않습니다.');
        total += numerator / denominator; previous = scale; at = re.lastIndex;
      }
      if (at !== s.length) {
        const remainder = s.slice(at);
        if (!at || !/^\d+$/.test(remainder) || BigInt(remainder) >= previous) throw new Error('지원하지 않는 금액입니다. 예: 8.4억, 8억 4천만, 840000000');
        total += BigInt(remainder);
      }
    }
    return ((negative ? -1n : 1n) * total).toString();
  }
  function formatMoney(value) {
    if (!hasValue(value)) return '미확인';
    let n;
    try { if (!integerMoney(String(value))) return '입력 확인 필요'; n = BigInt(value); } catch (_) { return '입력 확인 필요'; }
    const sign = n < 0n ? '−' : ''; n = n < 0n ? -n : n;
    if (n < 10000n) return sign + n.toLocaleString('ko-KR') + '원';
    const eok = n / 100000000n, man = n % 100000000n / 10000n, won = n % 10000n;
    return sign + (eok ? eok.toLocaleString('ko-KR') + '억 ' : '') + (man ? man.toLocaleString('ko-KR') + '만 ' : '') + (won ? won.toLocaleString('ko-KR') : '') + '원';
  }
  function formatRate(value) { return value === null || value === undefined || !Number.isFinite(Number(value)) ? '계산 불가' : (Number(value) * 100).toFixed(2) + '%'; }
  function emptyProfile() {
    return { schemaVersion: '1.0', persistOnDevice: false, cashAvailableKrw: null, reserveKrw: null,
      householdMode: 'net_surplus', monthlyNetSurplusKrw: null, monthlyNetIncomeKrw: null,
      monthlyLivingCostKrw: null, monthlyHousingCostKrw: null, annualGrossIncomeKrw: null,
      noDebtConfirmed: false, debts: [], workplaces: [], holdMonths: null, requiredMoveInBy: null,
      maxMonthlyHousingPaymentKrw: null, futureCashEvents: [], needs: [] };
  }
  function validateProfile(profile) {
    const errors = [], p = profile || {};
    const err = (key, text) => errors.push({ key, message: text });
    if (p.schemaVersion !== '1.0') err('schemaVersion', '지원하지 않는 저장 버전입니다.');
    const moneyKeys = ['cashAvailableKrw', 'reserveKrw', 'monthlyNetSurplusKrw', 'monthlyNetIncomeKrw', 'monthlyLivingCostKrw', 'monthlyHousingCostKrw', 'annualGrossIncomeKrw', 'maxMonthlyHousingPaymentKrw'];
    for (const k of moneyKeys) if (hasValue(p[k]) && (!integerMoney(p[k]) || (k !== 'monthlyNetSurplusKrw' && BigInt(p[k]) < 0n))) err(k, '원 단위 정수 문자열 또는 빈값이어야 합니다.');
    if (!['net_surplus', 'detailed'].includes(p.householdMode)) err('householdMode', '가계 입력 모드를 선택하세요.');
    if (hasValue(p.holdMonths) && (!Number.isInteger(p.holdMonths) || p.holdMonths < 1 || p.holdMonths > 360)) err('holdMonths', '보유기간은 1~360개월입니다.');
    if (hasValue(p.requiredMoveInBy) && !isoDate(p.requiredMoveInBy)) err('requiredMoveInBy', '유효한 날짜가 필요합니다.');
    for (const field of ['debts', 'workplaces', 'futureCashEvents', 'needs']) if (!Array.isArray(p[field])) err(field, '목록 형식이 필요합니다.');
    if ((p.workplaces || []).length > 2) err('workplaces', '목적지는 최대 2개입니다.');
    if (p.noDebtConfirmed && (p.debts || []).length) err('debts', '부채 없음과 부채 내역을 동시에 선택할 수 없습니다.');
    for (const [i, debt] of (Array.isArray(p.debts) ? p.debts : []).entries()) {
      if (!debt || typeof debt !== 'object') { err('debts.' + i, '부채 항목 형식을 확인하세요.'); continue; }
      if (!integerMoney(debt.balanceKrw) || BigInt(debt.balanceKrw) < 0n) err('debts.' + i + '.balanceKrw', hasValue(debt.creditLimitKrw) ? '마이너스통장의 현재 사용액을 입력하세요. 사용하지 않았다면 0을 입력하세요.' : '현재 대출 사용액을 원 단위로 입력하세요. 사용하지 않았다면 0을 입력하세요.');
      for (const k of ['creditLimitKrw', 'monthlyPaymentKrw', 'regulatoryAnnualDebtServiceKrw']) if (hasValue(debt[k]) && (!integerMoney(debt[k]) || BigInt(debt[k]) < 0n)) err('debts.' + i + '.' + k, '유효한 원화 금액이 필요합니다.');
      if (hasValue(debt.maturityDate) && !isoDate(debt.maturityDate)) err('debts.' + i, '대출 만기일을 확인하세요.');
    }
    for (const [i, w] of (Array.isArray(p.workplaces) ? p.workplaces : []).entries()) {
      if (!w || typeof w !== 'object') { err('workplaces.' + i, '목적지 항목 형식을 확인하세요.'); continue; }
      if (!w.id || typeof w.label !== 'string' || w.label.length > 200) err('workplaces.' + i, '목적지 식별·이름을 확인하세요.');
      if (hasValue(w.maxDoorToDoorMinutes) && (!Number.isFinite(w.maxDoorToDoorMinutes) || w.maxDoorToDoorMinutes < 0)) err('workplaces.' + i, '통근 상한을 확인하세요.');
      if (w.exactLocation && (!Number.isFinite(w.exactLocation.latitude) || !Number.isFinite(w.exactLocation.longitude) || Math.abs(w.exactLocation.latitude) > 90 || Math.abs(w.exactLocation.longitude) > 180)) err('workplaces.' + i, '위치 좌표 범위가 유효하지 않습니다.');
    }
    for (const [i, e] of (Array.isArray(p.futureCashEvents) ? p.futureCashEvents : []).entries()) if (!e || !isoDate(e.date) || !integerMoney(e.amountKrw) || !['confirmed', 'conditional', 'user_assumption'].includes(e.certainty)) err('futureCashEvents.' + i, '날짜·금액·재원 상태를 확인하세요.');
    return { valid: !errors.length, errors, value: profile };
  }
  class ProfileStore {
    constructor(storage, namespace = 'live') { if (!['live', 'demo'].includes(namespace)) throw new Error('Invalid data namespace'); this.storage = storage; this.prefix = 'jamsil.workspace:' + namespace + ':'; this.key = this.prefix + 'profile:v1'; }
    readSaved() { const raw = this.storage.getItem(this.key); if (!raw) return null; try { const p = JSON.parse(raw); return validateProfile(p).valid ? p : null; } catch (_) { return null; } }
    save(profile) { const p = clone(profile); p.persistOnDevice = true; const result = validateProfile(p); if (!result.valid) throw new Error(result.errors.map(x => x.message).join(' ')); this.storage.setItem(this.key, JSON.stringify(p)); return p; }
    clear() { const removedKeys = []; for (let i = this.storage.length - 1; i >= 0; i--) { const k = this.storage.key(i); if (k && /^jamsil\.workspace:(live|demo):/.test(k) && /:(profile|analysis|workplace|scenario|compare-private|input-cache)/.test(k)) { this.storage.removeItem(k); removedKeys.push(k); } } return { removedKeys }; }
    migrateLegacy(key = 'jamsil.profile') {
      const raw = this.storage.getItem(key); if (!raw) return { status: 'absent', profile: null, errors: [] };
      try {
        const old = JSON.parse(raw), p = emptyProfile();
        if (!old || Array.isArray(old) || typeof old !== 'object') throw new Error('이전 형식을 확인할 수 없습니다.');
        const mapping = { cash: 'cashAvailableKrw', reserve: 'reserveKrw', income: 'annualGrossIncomeKrw', monthlyBudget: 'maxMonthlyHousingPaymentKrw' };
        for (const [from, to] of Object.entries(mapping)) if (hasValue(old[from])) {
          if (typeof old[from] !== 'number' || !Number.isSafeInteger(old[from]) || old[from] < 0) throw new Error('이전 금액의 원 단위를 검증하지 못했습니다.');
          p[to] = String(old[from]);
        }
        // Legacy debt is a credit limit, not a known loan balance. Preserve the
        // limit as entered but keep current usage explicitly unknown until the
        // user reviews it; never reinterpret the limit as an outstanding debt.
        const notes = [];
        if (hasValue(old.debt)) {
          if (typeof old.debt !== 'number' || !Number.isSafeInteger(old.debt) || old.debt < 0) throw new Error('이전 마이너스통장 한도의 원 단위를 검증하지 못했습니다.');
          p.debts.push({ id: 'legacy-credit-line', balanceKrw: null, creditLimitKrw: String(old.debt), annualNominalRate: null, monthlyPaymentKrw: null, maturityDate: null });
          notes.push('이전 마이너스통장 한도를 가져왔습니다. 실제 사용액은 알 수 없어 비워 두었으니, 사용하지 않았다면 0을 입력하세요.');
        }
        return { status: 'review_required', profile: p, errors: [], notes, originalPreserved: true };
      } catch (e) { return { status: 'invalid', profile: null, errors: [e.message], originalPreserved: true }; }
    }
  }
  function validEvidence(e, { isDemo = false } = {}) {
    if (!e) return false;
    if (isDemo) return e.isDemo === true && e.authority === 'demo' && e.accessScope === 'local_demo';
    if (e.isDemo || e.accessScope !== 'public' || !e.locator?.label || !e.title || !e.issuer) return false;
    if (e.linkStatus === 'failed' || e.withdrawn === true) return false;
    if (e.locator.kind === 'structured_record') return !!e.locator.recordKey && !!e.contentHash;
    if (!e.url) return false;
    let u; try { u = new URL(e.url); } catch (_) { return false; }
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    if ((!u.pathname || u.pathname === '/') && !u.search) return false;
    if (e.locator.kind === 'pdf') return Number.isInteger(e.locator.pageOrdinal) && e.locator.pageOrdinal >= 1;
    return e.locator.kind === 'web' && !!e.locator.heading && !!e.contentHash;
  }
  function resolveClaimState(claimId, resources, stack = new Set()) {
    const claims = index(resources.claims), evidence = index(resources.evidence), calculations = index(resources.calculations), assumptions = index(resources.assumptions);
    if (stack.has(claimId)) return { state: 'conflicting', reasons: ['계산 의존관계가 순환합니다.'] };
    const claim = claims.get(claimId);
    if (!claim) return { state: 'unverified', reasons: ['해당 주장 자료가 없습니다.'] };
    if (claim.state === 'conflicting') return { state: 'conflicting', reasons: ['동일 범위의 근거가 충돌합니다.'] };
    const reasons = [], supports = (claim.evidence || []).filter(x => x.relation === 'supports');
    const contradictions = (claim.evidence || []).filter(x => x.relation === 'contradicts' && validEvidence(evidence.get(x.evidenceId), claim));
    if (contradictions.length) return { state: 'conflicting', reasons: ['반대 근거가 있어 핵심 결론을 확인할 수 없습니다.'] };
    if (claim.state === 'confirmed' && !supports.some(x => validEvidence(evidence.get(x.evidenceId), claim))) return { state: 'unverified', reasons: ['이 주장을 직접 지지하는 개별 원문·위치가 필요합니다.'] };
    if (claim.state === 'assumed' && !(claim.assumptionIds || []).some(id => assumptions.has(id))) return { state: 'unverified', reasons: ['사용자 가정의 입력 이력이 없습니다.'] };
    if (claim.state === 'not_applicable' && !claim.limitation && !supports.length) return { state: 'unverified', reasons: ['해당 없음의 적용 근거가 없습니다.'] };
    if (claim.state === 'calculated') {
      const calculation = calculations.get(claim.calculationId);
      if (!calculation || !Array.isArray(calculation.inputs) || !calculation.inputs.length) return { state: 'unverified', reasons: ['수식과 입력 내역이 없습니다.'] };
      const next = new Set(stack); next.add(claimId);
      for (const input of calculation.inputs) {
        if (!hasValue(input.value)) reasons.push(input.key + ' 미확인');
        if (input.sourceKind === 'claim') { const dependency = resolveClaimState(input.sourceId, resources, next); if (['conflicting', 'unverified'].includes(dependency.state)) reasons.push(...dependency.reasons); }
        else if (input.sourceKind === 'assumption' && !assumptions.has(input.sourceId)) reasons.push(input.key + ' 가정 이력 없음');
        else if (input.sourceKind === 'calculation') {
          const dependency = calculationState(input.sourceId, resources, next);
          if (dependency.state !== 'calculated') reasons.push(...dependency.reasons);
        }
        else if (!['claim', 'assumption', 'calculation'].includes(input.sourceKind)) reasons.push(input.key + ' 입력 출처 미확인');
      }
      if (calculation.status === 'blocked' || reasons.length) return { state: 'unverified', reasons: reasons.length ? reasons : ['필수 계산 입력이 부족합니다.'] };
    }
    return { state: claim.state, reasons };
  }
  function calculationState(id, resources, stack = new Set()) {
    const key = 'calculation:' + id;
    if (stack.has(key)) return { state: 'unverified', reasons: ['계산 의존관계가 순환합니다.'] };
    const calculation = index(resources.calculations).get(id);
    if (!calculation) return { state: 'unverified', reasons: ['계산 이력이 없습니다.'] };
    const next = new Set(stack); next.add(key);
    const syntheticId = 'calculation-claim:' + id;
    return resolveClaimState(syntheticId, { ...resources, claims: [...(resources.claims || []), { id: syntheticId, state: 'calculated', calculationId: id }] }, next);
  }
  function evidenceView(id, resources = {}) {
    const claims = index(resources.claims), evidences = index(resources.evidence), calculations = index(resources.calculations), assumptions = index(resources.assumptions);
    const claim = claims.get(id), calculation = calculations.get(id) || calculations.get(claim?.calculationId), assumption = assumptions.get(id);
    const relations = (claim?.evidence || []).map(r => ({ ...r, evidence: evidences.get(r.evidenceId) || null }));
    const state = claim ? resolveClaimState(id, resources) : calculation ? calculationState(calculation.id, resources) : { state: assumption ? 'assumed' : 'unverified', reasons: [] };
    const inputs = (calculation?.inputs || []).map(x => ({ ...x, claim: x.sourceKind === 'claim' ? claims.get(x.sourceId) || null : null, assumption: x.sourceKind === 'assumption' ? assumptions.get(x.sourceId) || null : null, calculation: x.sourceKind === 'calculation' ? calculations.get(x.sourceId) || null : null }));
    return { id, claim: claim || null, calculation: calculation || null, assumption: assumption || null,
      state: state.state, stateLabel: VALUE_STATES[state.state], title: claim?.predicate || calculation?.formulaId || assumption?.label || '근거 미확인',
      supports: relations.filter(x => x.relation === 'supports'), contradicts: relations.filter(x => x.relation === 'contradicts'), context: relations.filter(x => x.relation === 'context'),
      inputs, limitations: [claim?.limitation, ...state.reasons, ...(calculation?.missingInputs || []), ...(calculation?.excludedCosts || []).map(x => '제외 비용: ' + x)].filter(Boolean) };
  }
  function invalidateDependents(changedIds, claims, calculations) {
    const invalid = new Set(changedIds); let updated = true;
    while (updated) { updated = false;
      for (const c of calculations || []) if (!invalid.has(c.id) && (c.inputs || []).some(x => invalid.has(x.sourceId))) { invalid.add(c.id); updated = true; }
      for (const c of claims || []) if (!invalid.has(c.id) && (invalid.has(c.calculationId) || (c.evidence || []).some(x => invalid.has(x.evidenceId)))) { invalid.add(c.id); updated = true; }
    }
    return [...invalid];
  }
  function quantile(values, p) { if (!values.length) return null; const sorted = [...values].sort((a,b) => a-b), pos = (sorted.length-1)*p, lo=Math.floor(pos), hi=Math.ceil(pos); return sorted[lo]+(sorted[hi]-sorted[lo])*(pos-lo); }
  function analyzePrice(property, transactions = [], options = {}) {
    const asOf = options.asOf || localToday(), cutoff = months => { const d = new Date(asOf + 'T00:00:00Z'), day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - months); const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, end)); return d.toISOString().slice(0,10); };
    const excluded = [], valid = [];
    for (const t of transactions) {
      let reason = null;
      if (t.propertyId !== property.id) reason = '다른 대상';
      else if (t.status !== 'active') reason = t.status === 'cancelled' ? '취소 거래' : '정정 전 이력';
      else if (!isoDate(t.contractDate) || t.contractDate > asOf) reason = '유효하지 않거나 미래 계약일';
      else if (!integerMoney(t.priceKrw) || BigInt(t.priceKrw) <= 0n || !Number.isFinite(t.exclusiveAreaSqm) || t.exclusiveAreaSqm <= 0) reason = '가격·면적 확인 필요';
      else if (property.area?.basis !== 'exclusive' || !property.area?.sqm || Math.abs(t.exclusiveAreaSqm/property.area.sqm - 1) > .05 + 1e-12) reason = '전용면적 ±5% 범위 밖 또는 기준 미확인';
      else if (t.contractDate < cutoff(24)) reason = '최대 24개월 범위 밖';
      if (reason) excluded.push({ transaction: t, id: t.id, reason }); else valid.push(t);
    }
    let selected = valid.filter(t => t.contractDate >= cutoff(12));
    const expanded = selected.length < 5 && valid.length > selected.length;
    if (expanded) selected = valid;
    for (const t of valid) if (!selected.includes(t)) excluded.push({ transaction: t, id: t.id, reason: '기본 12개월 비교 범위 밖' });
    const unitPrices = selected.map(t=>Number(t.priceKrw)/t.exclusiveAreaSqm), median = quantile(unitPrices,.5), q1=quantile(unitPrices,.25), q3=quantile(unitPrices,.75);
    const outliers = selected.filter((t,i)=>selected.length >= 5 && unitPrices[i] < q1-1.5*(q3-q1));
    const filtered = selected.filter(t=>!outliers.includes(t));
    const status = selected.length >= 5 ? 'available' : selected.length >= 2 ? 'reference_only' : 'insufficient';
    const currentUnit = property.currentPrice && property.area?.sqm ? Number(property.currentPrice.amountKrw)/property.area.sqm : null;
    return { status, sampleCount: selected.length, selected, excluded, outliers, periodMonths: expanded ? 24 : 12, expanded,
      ruleVersion: 'price-1.0', comparisonBasis: '동일 대상 · 전용 유사면적 ±5% · 원/㎡', indexAdjustment: '미보정',
      medianKrw: status === 'available' ? String(Math.round(median*property.area.sqm)) : null,
      lowerKrw: status === 'available' ? String(Math.round(quantile(unitPrices,.1)*property.area.sqm)) : null,
      upperKrw: status === 'available' ? String(Math.round(quantile(unitPrices,.9)*property.area.sqm)) : null,
      medianUnitPrice: status === 'available' ? median : null,
      gapPct: status === 'available' && currentUnit != null ? (currentUnit/median-1)*100 : null,
      withoutLowOutliersMedianKrw: outliers.length && filtered.length ? String(Math.round(quantile(filtered.map(t=>Number(t.priceKrw)/t.exclusiveAreaSqm),.5)*property.area.sqm)) : null,
      limitations: [expanded ? '표본 부족으로 24개월까지 확대했습니다.' : '최근 12개월 기준입니다.', '관측 거래 분포이며 미래가격 예측구간이 아닙니다.', '층·향·상태의 차이를 자동 보정하지 않았습니다.', ...(status!=='available'?['표본이 5건 미만이므로 가격 매력 결론을 산출하지 않습니다.']:[])] };
  }
  function deriveProjectState(project, events = [], claims = [], evidence = [], options = {}) {
    const asOf = options.asOf || localToday(), claimsById=index(claims), evidenceById=index(evidence);
    const usable = [], pending = [], risks = [];
    const superseded = new Set(events.filter(e=>e.projectId===project.id && e.status==='valid' && e.effectiveFrom && e.effectiveFrom<=asOf).map(e=>e.supersedes).filter(Boolean));
    for (const event of events.filter(e=>e.projectId===project.id)) {
      const claim=claimsById.get(event.claimId), supported=claim && resolveClaimState(claim.id,{claims,evidence}).state==='confirmed';
      const authority=(event.evidenceIds||[]).some(id=>{const e=evidenceById.get(id);return e && (project.isDemo?e.authority==='demo':['government_notice','government_law'].includes(e.authority));});
      if (event.status!=='valid' || superseded.has(event.id) || !event.effectiveFrom || event.effectiveFrom>asOf || (event.publishedOn && event.publishedOn>asOf) || !supported || !authority) { pending.push(event); continue; }
      usable.push(event);
    }
    usable.sort((a,b)=>(a.effectiveFrom||'').localeCompare(b.effectiveFrom||'') || a.id.localeCompare(b.id));
    const terminalTypes=new Set(['cancelled','cancellation','designation_revoked','district_released','released','approval_revoked','project_cancelled']);
    const stopTypes=new Set(['suspended','execution_stayed','injunction','execution_stay']);
    const latestTerminal=[...usable].reverse().find(e=>terminalTypes.has(e.eventType));
    const latestStay=[...usable].reverse().find(e=>stopTypes.has(e.eventType));
    if(latestTerminal) risks.push('공식 해제·취소 사건이 있습니다. 이전 기대와 관련 분석을 다시 검토해야 합니다.');
    if(latestStay) risks.push('집행정지·중단 사건이 있습니다. 효력과 후속 결정을 확인하세요.');
    if(usable.some(e=>e.eventType==='lawsuit_filed')) risks.push('소송 제기 기록이 있습니다. 제기 사실만으로 집행정지나 사업 취소를 확정하지 않습니다.');
    const progress=usable.filter(e=>!['lawsuit_filed','judgment'].includes(e.eventType));
    const latest=latestTerminal||latestStay||progress.at(-1);
    return { status: latestTerminal?'cancelled':latestStay?'suspended':latest?'observed':'unknown', stage: latest?.eventType||null,
      label: latest?.label||'공식 단계 미확인', latestEvent:latest||null, timeline:usable, pending, risks,
      nextConditions:project.nextConditions||[], completionProbability:null, asOf, invalidatesPriorAnalysis:!!latestTerminal };
  }
  function gate(id,label,status,reason,claimIds=[],critical=true) { return { id,label,status,critical,reason,claimIds,ruleVersionId:null }; }
  function buildAnalysis(property, options = {}) {
    const profile=options.profile||emptyProfile(), context=options.context||{}, asOf=options.asOf||localToday();
    const claims=options.claims||[], evidence=options.evidence||[], priceAnalysis=analyzePrice(property,options.transactions||[],{asOf});
    const gates=[], missing=[], risks=[], reasons=[];
    const foundational=!!property.id && !!property.currentPrice && integerMoney(property.currentPrice.amountKrw) && BigInt(property.currentPrice.amountKrw)>0n;
    if(!foundational) missing.push('대상 식별 또는 가격');
    const addGate=g=>{gates.push(g);if(g.status==='unknown')missing.push(g.label);if(g.status==='fail'||g.status==='unknown')risks.push({text:g.reason,claimIds:g.claimIds,severity:g.status==='fail'?'critical':'material'});};
    for(const g of context.gates||[]) if(g && ['pass','fail','unknown','not_applicable'].includes(g.status)) addGate(g);
    if(!gates.some(g=>g.id==='rights')) {
      const rights=claims.find(c=>c.subjectId===property.id && c.predicate==='basic_rights_review');
      const resolved=rights && resolveClaimState(rights.id,{claims,evidence,calculations:options.calculations,assumptions:options.assumptions});
      addGate(gate('rights','기본 권리·인도',resolved?.state==='confirmed' && rights.value===true?'pass':resolved?.state==='confirmed'&&rights.value===false?'fail':'unknown',resolved?.state==='confirmed'&&rights.value===false?'확인된 자료에서 기본 권리·인도 조건이 맞지 않습니다.':'등기·임대차·인도 확인 자료가 필요합니다.',rights?[rights.id]:[]));
    }
    for(const workplace of profile.workplaces||[]) {
      if(!hasValue(workplace.maxDoorToDoorMinutes)) continue;
      const observation=(context.commutes||[]).find(c=>c.workplaceId===workplace.id);
      const minutes=observation?.minutes, known=Number.isFinite(minutes) && minutes>=0;
      addGate(gate('commute:'+workplace.id,workplace.label+' 통근',!known?'unknown':minutes>workplace.maxDoorToDoorMinutes?'fail':'pass',!known?workplace.label+' 문전 통근시간 미확인':workplace.label+' '+minutes+'분 / 상한 '+workplace.maxDoorToDoorMinutes+'분'+(observation.source==='user_assumption'?' · 사용자 가정':''),observation?.claimIds||[]));
    }
    for(const need of (profile.needs||[]).filter(n=>n.required)) {
      if(need.key==='propertyType' && need.value==='both') { addGate(gate('need:propertyType','주택 유형','not_applicable','사용자가 아파트와 빌라 모두를 선택했습니다.')); continue; }
      if(need.key==='regions') {
        const choices=String(need.value||'').split(',').map(x=>x.trim()).filter(Boolean);
        const code=String(property.regionCode||''), address=String(property.addressLabel||'');
        const matches=choices.some(x=>code===x || (!/^\d+$/.test(x) && (code.startsWith(x) || address.split(/\s+/).some(part=>part===x || part.startsWith(x)))));
        addGate(gate('need:regions','필수 지역',!code&&!address?'unknown':matches?'pass':'fail',!code&&!address?'대상 지역이 미확인입니다.':matches?'선택한 지역 범위에 포함됩니다.':'사용자가 선택한 필수 지역 범위 밖입니다.')); continue;
      }
      const actual=need.key==='minArea'?property.area?.sqm:need.key==='propertyType'?property.propertyType:context[need.key];
      const ok=actual==null?null:need.key==='minArea'||need.key==='rooms'?Number(actual)>=Number(need.value):actual===need.value;
      addGate(gate('need:'+need.key,'필수 조건 '+need.key,ok===null?'unknown':ok?'pass':'fail',ok===null?'필수 조건 '+need.key+' 확인 자료가 없습니다.':ok?'필수 조건 충족':'필수 조건 '+need.key+' 미충족'));
    }
    if(profile.requiredMoveInBy) addGate(gate('moveIn','입주 기한',!context.availableMoveInBy?'unknown':context.availableMoveInBy>profile.requiredMoveInBy?'fail':'pass',!context.availableMoveInBy?'현재 점유·인도 가능일이 미확인입니다.':'인도 가능일 '+context.availableMoveInBy+' / 희망일 '+profile.requiredMoveInBy));
    const scenarios=(options.scenarioResults||[]).map(r=>r.scenario||r), base=scenarios[0];
    const scalarMoney=s=>s && !['missing','not_applicable'].includes(s.status) && integerMoney(s.value)?s.value:null;
    const initial=scalarMoney(base?.initialEquity), maximum=scalarMoney(base?.maximumReserveShortfall);
    const alternative=base?.liquiditySummary?.withConditional?.maximumReserveShortfallKrw;
    const conditionalSolvesShortfall=base?.dependsOnConditionalFunding===true && integerMoney(alternative) && BigInt(alternative)===0n;
    if(!integerMoney(profile.cashAvailableKrw)) addGate(gate('cash','최초 필요자금','unknown','현금과 매수 정산 입력 후 계산합니다.'));
    else if(initial==null) addGate(gate('cash','최초 필요자금','unknown','매입가격·취득비용·보증금·대출 가정을 입력하세요.'));
    else { const reserve=integerMoney(profile.reserveKrw)?BigInt(profile.reserveKrw):null; const failed=BigInt(initial)>BigInt(profile.cashAvailableKrw)-(reserve||0n);const conditional=failed&&conditionalSolvesShortfall;addGate(gate('cash','최초 필요자금',conditional?'unknown':failed?'fail':reserve===null||base?.initialEquity?.status==='partial'?'unknown':'pass',conditional?'확정 재원으로는 최초 자금이 부족하며, 조건부 재원이 실제 확보되어야 예비비를 유지할 수 있습니다.':failed?'가정상 최초 정산에 필요한 현금이 예비비를 남긴 자금보다 큽니다.':reserve===null?'남길 예비비 기준이 미설정입니다.':base?.initialEquity?.status==='partial'?'최초 정산에 누락 항목이 있어 자금 충족을 확정할 수 없습니다.':'입력한 정산 가정에서 최초 자금 조건을 충족합니다.')); }
    if(maximum==null) addGate(gate('liquidity','보유기간 자금','unknown','보유기간 사건·소득·지출이 미완성이라 최대 부족액은 미확인입니다.'));
    else { const short=BigInt(maximum)>0n, partial=base?.maximumReserveShortfall?.status==='partial';addGate(gate('liquidity','보유기간 자금',short&&conditionalSolvesShortfall?'unknown':short?'fail':partial?'unknown':'pass',short&&conditionalSolvesShortfall?'확정 재원 장부에는 '+formatMoney(maximum)+' 부족이 남으며 조건부 재원을 포함할 때만 해소됩니다.':short?'가정상 예비비 유지에 '+formatMoney(maximum)+'이 추가로 필요합니다.':partial?'표시한 비용 범위에서는 부족이 없지만, 누락 비용 확인 전에는 전 기간 자금 충족을 확정하지 않습니다.':'입력된 사건 범위에서는 예비비 부족이 없습니다.')); }
    if(integerMoney(profile.maxMonthlyHousingPaymentKrw)) {
      const payment=context.monthlyHousingPaymentKrw;
      addGate(gate('monthly','월 부담 상한',payment==null?'unknown':BigInt(payment)>BigInt(profile.maxMonthlyHousingPaymentKrw)?'fail':'pass',payment==null?'월 상환·보유비용을 입력해야 월 부담을 비교할 수 있습니다.':'월 부담 '+formatMoney(payment)+' / 상한 '+formatMoney(profile.maxMonthlyHousingPaymentKrw)));
    }
    const listing=options.listing, currentListing=listing?.saleStatus==='confirmed_available' && listing.checkedAt && listing.expiresAt && listing.expiresAt>=asOf+'T00:00:00' && property.granularity==='unit';
    const hasFailure=gates.some(g=>g.critical&&g.status==='fail'), rightsUnknown=gates.some(g=>g.id==='rights'&&g.status==='unknown');
    const assumedLoan=integerMoney(base?.assumedLoanPrincipalKrw)&&BigInt(base.assumedLoanPrincipalKrw)>0n;
    const conditional=scenarios.some(s=>s.dependsOnConditionalFunding) || gates.some(g=>g.status==='unknown') || (base?.excludedCosts||[]).length>0 || context.loanApprovalUnverified===true || assumedLoan;
    const decision=!foundational?'INSUFFICIENT_DATA':hasFailure?'NOT_FIT':!currentListing||rightsUnknown?'RESEARCH_ONLY':conditional?'CONDITIONAL_REVIEW':'REVIEW_CANDIDATE';
    if(!currentListing) risks.push({text:property.currentPrice?.kind==='transaction'||property.currentPrice?.kind==='reference_range'?'과거 거래로 찾은 후보입니다. 현재 호가와 판매 여부를 확인하세요.':'개별 호실·판매 확인 범위와 확인 기간이 부족합니다.',claimIds:property.currentPrice?[property.currentPrice.claimId]:[],severity:'material'});
    if(base?.excludedCosts?.length) risks.unshift({text:'일부 비용 제외: '+base.excludedCosts.join(', '),claimIds:[],severity:'critical'});
    if(assumedLoan) risks.push({text:'입력한 대출금은 사용자 가정입니다. 승인된 규칙과 금융기관 확인 없이 조달 가능액으로 확정하지 않습니다.',claimIds:[],severity:'material'});
    if(property.propertyType==='villa') risks.push({text:'빌라는 개별 권리·건물 상태·환금성 자료를 함께 확인해야 합니다.',claimIds:[],severity:'material'});
    if(priceAnalysis.status==='available') reasons.push({text:'같은 대상의 유사면적 거래 '+priceAnalysis.sampleCount+'건으로 비교할 수 있습니다.',claimIds:[],calculationId:'price:'+property.id});
    if(context.station?.dist_m!=null) reasons.push({text:context.station.name+'까지 직선 '+context.station.dist_m+'m입니다. 도보·문전 통근시간과 다릅니다.',claimIds:[],calculationId:null});
    if(!reasons.length) reasons.push({text:'확인 가능한 거래·입지 자료부터 비교하는 탐색 후보입니다.',claimIds:property.claimIds||[],calculationId:null});
    const inputHash=localHash({profile,scenarios,propertyId:property.id,snapshotId:options.snapshotId});
    return {analysisId:'analysis:'+property.id+':'+inputHash,propertyId:property.id,listingId:listing?.id||null,snapshotId:options.snapshotId||'unknown',inputHash,
      modelVersion:base?.comparisonBasis?.modelVersion||VERSION,ruleVersionIds:[],generatedAt:options.generatedAt||new Date().toISOString(),valuationMode:base?.valuationMode||null,cashflowMode:base?.cashflowMode||null,taxCoverage:base?.taxCoverage||'unknown',comparisonBasis:base?.comparisonBasis||null,calculationStatus:base?.calculationStatus||'blocked',priceKind:property.currentPrice?.kind||null,
      decision,decisionLabel:DECISIONS[decision],gates,scenarios,reasons,risks:risks.length?risks:[{text:'표시된 자료와 사용자 가정 범위의 검토 결과입니다.',claimIds:[],severity:'note'}],missingInputs:[...new Set(missing.concat(scenarios.flatMap(s=>s.missingInputs||[])))],priceAnalysis,
      regulatoryLoanEstimate:null,regulatoryLoanReason:'RULE_NOT_VERIFIED',explanation:hasFailure?gates.find(g=>g.status==='fail').reason:decision==='RESEARCH_ONLY'?'탐색·비교는 가능하며, 개별 매수 판단에는 호가·권리 확인이 필요합니다.':DECISIONS[decision]};
  }
  function rankCandidates(rows, options = {}) {
    const group={REVIEW_CANDIDATE:0,CONDITIONAL_REVIEW:1,RESEARCH_ONLY:2,NOT_FIT:3,INSUFFICIENT_DATA:4};
    // Decide comparability once for the whole status group. Pairwise switching
    // between NPV and dates would yield a non-transitive, unstable comparator.
    const npvGroups=new Set();
    for(const decision of ['REVIEW_CANDIDATE','CONDITIONAL_REVIEW']) {
      const pool=rows.filter(r=>r.analysis.decision===decision);
      if(pool.length && pool.every(row=>compareAnalyses([pool[0],row]).comparable)) npvGroups.add(decision);
    }
    const result=[...rows].sort((a,b)=>{
      const aa=a.analysis,bb=b.analysis,d=(group[aa.decision]??5)-(group[bb.decision]??5); if(d)return d;
      if(npvGroups.has(aa.decision) && options.mode!=='price'){const an=BigInt(aa.scenarios[0].npv.value),bn=BigInt(bb.scenarios[0].npv.value);if(an!==bn)return an>bn?-1:1;}
      if(options.mode==='price' && a.property.currentPrice?.kind===b.property.currentPrice?.kind){const av=a.property.currentPrice?.amountKrw,bv=b.property.currentPrice?.amountKrw;if(av&&bv&&av!==bv)return BigInt(av)<BigInt(bv)?-1:1;}
      const av=aa.priceAnalysis?.status==='available',bv=bb.priceAnalysis?.status==='available';if(av!==bv)return av?-1:1;
      if(av&&bv){const gap=Math.abs(aa.priceAnalysis.gapPct??Infinity)-Math.abs(bb.priceAnalysis.gapPct??Infinity);if(gap)return gap;}
      const dates=(b.property.currentPrice?.asOf||'').localeCompare(a.property.currentPrice?.asOf||'');if(dates)return dates;
      return a.property.id.localeCompare(b.property.id);
    });
    return result.map((row,i)=>({...row,rank:i+1,rankScope:'현재 조건 안에서의 검토 순서',returnComparisonUsed:options.mode!=='price'&&npvGroups.has(row.analysis.decision)}));
  }
  function compareAnalyses(rows) {
    if(rows.length>3)throw new Error('최대 3개 후보를 비교할 수 있습니다.');
    const bases=rows.map(row=>{const a=row.analysis||row;return (a.scenarios||[]).map(s=>s.comparisonBasis);});
    const completeBasis=b=>b && typeof b==='object' && b.modelVersion && isoDate(b.valuationDate) && isoDate(b.exitDate) && b.exitDate>b.valuationDate && ['monthly_scenario','actual_date'].includes(b.valuationMode) && ['asset','equity'].includes(b.cashflowMode) && Number.isFinite(b.annualEffectiveRate) && b.annualEffectiveRate>-1 && ['verified_estimate','user_estimate','partial'].includes(b.taxCoverage) && Array.isArray(b.excludedCosts) && b.exitKind && (b.cashflowMode==='asset'||b.debt&&integerMoney(b.debt.loanPrincipalKrw)&&integerMoney(b.debt.assumedDepositKrw));
    const kinds=rows.map(r=>r.property?.currentPrice?.kind||(r.analysis||r).priceKind||null);
    const priceKindsMatch=kinds.length>0&&kinds.every(Boolean)&&new Set(kinds).size===1;
    const allCalculated=rows.length>0&&rows.every(r=>{const scenarios=(r.analysis||r).scenarios||[];return scenarios.length>0&&scenarios.every(s=>integerMoney(s.npv?.value)&&['available','partial'].includes(s.npv?.status));});
    const signatures=bases.map(list=>stableStringify(list));
    const comparable=allCalculated && bases.every(list=>list.every(completeBasis)) && new Set(signatures).size===1 && priceKindsMatch;
    return {comparable:!!comparable,reason:comparable?'같은 기준일·기간·요구수익률·차입·가격종류·세금 및 비용 범위의 사용자 가정에서 비교합니다.':'기준일·보유기간·요구수익률·차입·가격종류·세금 범위를 명시적으로 맞추기 전에는 투자수익을 순위로 비교하지 않습니다.',rows,priceKindsMatch};
  }
  function makeShareUrl(base, input = {}) {
    const url=new URL(base);url.search='';url.hash='';
    const mode=input.dataMode==='demo'?'demo':'live';url.searchParams.set('mode',mode);
    const values={properties:input.propertyIds,regions:input.regionCodes,types:input.types};
    for(const [k,v] of Object.entries(values))if(Array.isArray(v)&&v.length){const safe=v.filter(x=>typeof x==='string'&&x.length>=1&&x.length<=180&&!/[\u0000-\u001f\u007f]/.test(x)&&(k==='properties'||/^[\w가-힣:.-]+$/.test(x)));if(safe.length)url.searchParams.set(k,safe.slice(0,k==='properties'?4:80).join(','));}
    if(typeof input.snapshotId==='string'&&/^[\w:.-]{1,180}$/.test(input.snapshotId))url.searchParams.set('snapshot',input.snapshotId);
    url.hash=input.propertyIds?.length===1?'/properties/'+encodeURIComponent(input.propertyIds[0]):'/explore';return url.toString();
  }
  function semanticFingerprint(property, analysis) { return localHash({id:property.id,currentPrice:property.currentPrice,claims:property.claimIds,decision:analysis?.decision,risks:analysis?.risks,projectState:analysis?.projectState||null,sourceClaims:analysis?.claimValues||null}); }
  class WatchStore {
    constructor(storage,namespace='live'){if(!['demo','live'].includes(namespace))throw new Error('Invalid namespace');this.storage=storage;this.key='jamsil.workspace:'+namespace+':watch:v1';}
    list(){try{const list=JSON.parse(this.storage.getItem(this.key)||'[]');return Array.isArray(list)?list.filter(x=>x&&typeof x.propertyId==='string'):[];}catch(_){return [];}}
    write(list){this.storage.setItem(this.key,JSON.stringify(list));return list;}
    toggle(property,snapshotId,analysis){let list=this.list();if(list.some(x=>x.propertyId===property.id))return this.write(list.filter(x=>x.propertyId!==property.id));list.push({propertyId:property.id,name:property.name,snapshotId,savedAt:new Date().toISOString(),note:'',fingerprint:semanticFingerprint(property,analysis),publicPrice:property.currentPrice,decisionAtSave:analysis?.decision||null});return this.write(list);}
    updateNote(id,note){if(typeof note!=='string'||note.length>1000)throw new Error('메모는 1,000자 이내로 입력하세요.');const list=this.list(),entry=list.find(x=>x.propertyId===id);if(!entry)throw new Error('관심 후보를 찾을 수 없습니다.');entry.note=note;this.write(list);return entry;}
    remove(id){return this.write(this.list().filter(x=>x.propertyId!==id));}
    clear(){this.storage.removeItem(this.key);}
    changes(entry,property,analysis){const changed=entry.fingerprint!==semanticFingerprint(property,analysis);return {changed,requiresRecalculation:changed,changes:changed?['저장 당시와 가격·핵심 판단 자료가 달라 다시 검토해야 합니다.']:[]};}
  }
  const LEARNING = {
    far:{title:'용적률',definition:'대지에 비해 용적률 산입 연면적이 얼마나 큰지 나타낸 비율입니다.',example:'가상 예시: 산정 대지 4만㎡ × 계획 용적률 300% = 산입 연면적 12만㎡.',why:'계획면적이 늘어도 공사비·공공기여·권리·분담금을 함께 확인해야 합니다.',url:'https://www.easylaw.go.kr/CSP/CnpClsMain.laf?csmSeq=1168&ccfNo=1&cciNo=1&cnpClsNo=1'},
    contribution:{title:'권리가액과 분담금',definition:'사업에서 인정하는 종전자산의 권리가액과 조합원 공급가격의 차이를 검토하는 개념입니다.',example:'가상 예시: 평가액 4억 × 비례율 110% = 권리가액 4.4억. 공급가 8억이면 개념상 차이는 3.6억입니다.',why:'매매가격·기납부금·잔여분담금·별도 부담금은 서로 다른 값입니다.',url:'https://www.easylaw.go.kr/CSP/CnpClsMain.laf?ccfNo=4&cciNo=2&cnpClsNo=1&csmSeq=1168&popMenu=ov'},
    npv:{title:'NPV와 자금 부족',definition:'NPV는 미래 현금흐름을 요구수익률로 현재 가치로 바꿔 합한 값입니다.',example:'가상 예시: 연 유효 요구수익률 6%에서 1년 후 1억 600만원의 현재 가치는 1억원입니다.',why:'NPV가 양수여도 중간에 현금이 부족할 수 있어 사건별 가계 잔액을 따로 봅니다.',url:null},
    evidence:{title:'확인·계산·가정·미확인',definition:'원문에서 확인한 사실과 그 값을 활용한 계산은 서로 다른 상태입니다.',example:'계획 용적률을 확인해도 미래 매도가나 수익이 공식 확인된 것은 아닙니다.',why:'기관 홈페이지는 확인 경로입니다. 개별 주장에는 대상·날짜·원문 위치가 필요합니다.',url:null}
  };
  return {VERSION,DECISIONS,VALUE_STATES,LEARNING,parseMoney,formatMoney,formatRate,emptyProfile,validateProfile,ProfileStore,WatchStore,localHash,localToday,isoDate,validEvidence,resolveClaimState,evidenceView,invalidateDependents,analyzePrice,deriveProjectState,buildAnalysis,rankCandidates,compareAnalyses,makeShareUrl,semanticFingerprint};
});
