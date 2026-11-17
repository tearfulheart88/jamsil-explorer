/* Local UI integration for the canonical Personal Fit policy. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./personal-fit-policy.js'));
  else root.WorkspacePersonalization = factory(root.PersonalFitPolicy);
})(typeof window !== 'undefined' ? window : this, function (policy) {
  'use strict';
  if (!policy) throw new Error('PersonalFitPolicy is required');

  const VERSION = 'workspace-personalization-2.0';
  const HOUSEHOLDS = new Set(['single', 'couple_single_income', 'couple_dual_income', 'other']);
  const PURPOSES = new Set(['owner', 'investment', 'mixed']);
  const FINANCE_LEVELS = new Set(['VERIFIED', 'ESTIMATED', 'INSUFFICIENT']);
  const REDEVELOPMENT = new Set(['avoid', 'neutral', 'accept', 'prefer']);
  const LIQUIDITY = new Set(['high', 'medium', 'low']);
  const UNCERTAINTY = new Set(['low', 'medium', 'high']);
  const DIMENSION_LABELS = {
    affordability: '자금 적합도', commute: '출퇴근', housing_household: '주거·가구 적합도',
    location_lifestyle: '지역·생활 선호', investment_preference_fit: '투자 성향 적합도'
  };
  const evaluations = new Map();
  const presentations = new Map();
  const publicIndex = new Map();
  // 번호가 없는 프로필(예전에 저장한 조건)에 부를 때마다 새 번호를 주면, 같은 프로필인데 후보마다 번호가 달라진다.
  // 같은 프로필 객체에는 같은 번호를 준다(personal-fit-policy 의 revisionFor 와 같은 방식).
  const revisionIds = new WeakMap();
  const text = value => value === null || value === undefined ? '' : String(value);
  const escapeHtml = value => text(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);

  function stableRevision(profile) {
    if (!profile || typeof profile !== 'object') return policy.newRevisionId();
    if (/^pf-[a-zA-Z0-9-]{8,80}$/.test(text(profile.personalFitProfileRevision))) return profile.personalFitProfileRevision;
    if (!revisionIds.has(profile)) revisionIds.set(profile, policy.newRevisionId());
    return revisionIds.get(profile);
  }

  function normalizeProfile(profile = {}) {
    const requirements = profile.personalFitRequirements && typeof profile.personalFitRequirements === 'object' ? profile.personalFitRequirements : {};
    return {
      ...profile,
      schemaVersion: profile.schemaVersion || '1.0',
      personalFitProfileRevision: stableRevision(profile),
      householdType: HOUSEHOLDS.has(profile.householdType) ? profile.householdType : null,
      purchasePurpose: PURPOSES.has(profile.purchasePurpose) ? profile.purchasePurpose : null,
      financeVerificationLevel: FINANCE_LEVELS.has(profile.financeVerificationLevel) ? profile.financeVerificationLevel : null,
      redevelopmentTolerance: REDEVELOPMENT.has(profile.redevelopmentTolerance) ? profile.redevelopmentTolerance : null,
      liquidityPreference: LIQUIDITY.has(profile.liquidityPreference) ? profile.liquidityPreference : null,
      uncertaintyTolerance: UNCERTAINTY.has(profile.uncertaintyTolerance) ? profile.uncertaintyTolerance : null,
      preferredRegions: typeof profile.preferredRegions === 'string' ? profile.preferredRegions : '',
      avoidRegions: typeof profile.avoidRegions === 'string' ? profile.avoidRegions : '',
      personalFitRequirements: {
        affordability: requirements.affordability === true,
        monthlyBurden: requirements.monthlyBurden === true,
        commute: requirements.commute === true,
        moveIn: requirements.moveIn === true
      }
    };
  }

  function profileIsActive(profile) {
    try { return policy.evaluatePersonalFit({ profile: normalizeProfile(profile), generatedAt: '2000-01-01T00:00:00.000Z' }).active; }
    catch (_) { return false; }
  }

  function weightsFor(profile) {
    const purpose = normalizeProfile(profile).purchasePurpose;
    return purpose ? { ...policy.WEIGHTS[purpose] } : null;
  }

  function evaluateCandidate({ property = {}, context = {}, analysis = {}, profile = {}, generatedAt } = {}) {
    return policy.evaluatePersonalFit({ candidate: property, context: context?.legacy || context || {}, analysis, profile: normalizeProfile(profile), generatedAt: generatedAt || analysis?.generatedAt });
  }

  function presentationFor(propertyId) { return presentations.get(propertyId) || null; }

  function enrichAnalysis(property, context, analysis, profile) {
    const legacy = context?.legacy || context || {};
    const fit = evaluateCandidate({ property, context: legacy, analysis, profile });
    const investmentQuality = policy.readInvestmentQuality(legacy);
    const evidenceConfidence = {
      score: investmentQuality.evidenceCoverage,
      status: investmentQuality.evidenceCoverage === null ? 'UNKNOWN' : investmentQuality.evidenceCoverage >= 70 ? 'HIGH' : investmentQuality.evidenceCoverage >= 50 ? 'MEDIUM' : 'LOW',
      label: '현재 공개 근거 범위'
    };
    const matrix = policy.classifyMatrix(investmentQuality, fit);
    const enriched = { ...analysis, personalFit: fit, personalization: fit, investmentQuality, evidenceConfidence, recommendationMatrix: matrix };
    evaluations.set(property.id, fit);
    presentations.set(property.id, { fit, investmentQuality, evidenceConfidence, matrix });
    return enriched;
  }

  function rerank(rows, options = {}) {
    return policy.sortRows(rows, options.mode || 'default').map((row, index) => ({
      ...row,
      rank: index + 1,
      rankScope: ['personal-fit', 'investment', 'matrix', 'needs-check'].includes(options.mode) ? ({
        'personal-fit': '사용자가 선택한 Personal Fit 순', investment: '사용자가 선택한 Investment Quality 순',
        matrix: '사용자가 선택한 Investment × Fit 매트릭스 순', 'needs-check': '사용자가 선택한 확인 필요 순'
      })[options.mode] : row.rankScope
    }));
  }

  function install(core) {
    if (!core || core.__personalizationInstalled) return core;
    const originalEmptyProfile = core.emptyProfile;
    const originalValidateProfile = core.validateProfile;
    const originalBuildAnalysis = core.buildAnalysis;
    const originalRankCandidates = core.rankCandidates;
    core.emptyProfile = function () { return normalizeProfile({ ...originalEmptyProfile(), personalFitProfileRevision: policy.newRevisionId() }); };
    core.validateProfile = function (profile) {
      const result = originalValidateProfile(profile), errors = [...(result.errors || [])];
      const add = (key, message) => errors.push({ key, message });
      if (profile?.householdType && !HOUSEHOLDS.has(profile.householdType)) add('householdType', '가구 구성을 확인하세요.');
      if (profile?.purchasePurpose && !PURPOSES.has(profile.purchasePurpose)) add('purchasePurpose', '매수 목적을 확인하세요.');
      if (profile?.financeVerificationLevel && !FINANCE_LEVELS.has(profile.financeVerificationLevel)) add('financeVerificationLevel', '금융 확인상태를 확인하세요.');
      if (profile?.redevelopmentTolerance && !REDEVELOPMENT.has(profile.redevelopmentTolerance)) add('redevelopmentTolerance', '정비사업 선호를 확인하세요.');
      if (profile?.liquidityPreference && !LIQUIDITY.has(profile.liquidityPreference)) add('liquidityPreference', '유동성 선호를 확인하세요.');
      if (profile?.uncertaintyTolerance && !UNCERTAINTY.has(profile.uncertaintyTolerance)) add('uncertaintyTolerance', '불확실성 허용도를 확인하세요.');
      if (profile?.personalFitProfileRevision && !/^pf-[a-zA-Z0-9-]{8,80}$/.test(profile.personalFitProfileRevision)) add('personalFitProfileRevision', '프로필 revision 형식을 확인하세요.');
      for (const field of ['preferredRegions', 'avoidRegions']) if (profile?.[field] != null && typeof profile[field] !== 'string') add(field, '지역 목록은 쉼표로 구분한 문자열이어야 합니다.');
      if (profile?.personalFitRequirements != null && (Array.isArray(profile.personalFitRequirements) || typeof profile.personalFitRequirements !== 'object')) add('personalFitRequirements', '필수조건 설정 형식을 확인하세요.');
      try { policy.adaptWorkspaceProfileV1(profile); } catch (error) { add('personalFit', error.message); }
      return { ...result, valid: errors.length === 0, errors };
    };
    core.buildAnalysis = function (property, options = {}) {
      const profile = normalizeProfile(options.profile || core.emptyProfile());
      const result = originalBuildAnalysis(property, { ...options, profile });
      const context = Object.keys(options.context || {}).length ? options.context : publicIndex.get(property.id) || {};
      return enrichAnalysis(property, context, result, profile);
    };
    core.rankCandidates = function (rows, options = {}) { return rerank(originalRankCandidates(rows, options), options); };
    core.__personalizationInstalled = true;
    return core;
  }

  function statusLabel(status) {
    return ({ STRONG_FIT: '매우 잘 맞음', GOOD_FIT: '잘 맞음', MIXED_FIT: '일부 맞음', WEAK_FIT: '적합도 낮음', NOT_FIT: '필수 조건 미충족', UNKNOWN_FIT: '확인 필요',
      AFFORDABLE: '자금 범위 적합', STRETCHED: '부담 경계', LIKELY_INFEASIBLE: '현재 조건상 어려움', NEEDS_FINANCE_CHECK: '금융 확인 필요', NEEDS_PRICE_CHECK: '현재 가격 확인 필요',
      EXCELLENT: '매우 양호', GOOD: '양호', ACCEPTABLE: '수용 가능', POOR: '부족', PROXY_ONLY: '프록시만 있음', AVAILABLE: '평가 가능', UNKNOWN: '미확인' })[status] || status;
  }
  function axisValue(score, suffix = '점') { return score === null || score === undefined ? '확인 필요' : `${Number(score).toFixed(0)}${suffix}`; }
  function axesHtml(bundle) {
    if (!bundle) return '';
    const { investmentQuality: investment, fit, evidenceConfidence: evidence, matrix } = bundle;
    return `<div class="fit-axis-grid" aria-label="독립 평가 세 축"><div><span>투자가치</span><strong>${escapeHtml(axisValue(investment.score))}</strong><small>${escapeHtml(investment.status)}</small></div><div><span>내 조건 적합도</span><strong>${escapeHtml(axisValue(fit.score))}</strong><small>${escapeHtml(statusLabel(fit.status))} · coverage ${escapeHtml(axisValue(fit.coverage, '%'))}</small></div><div><span>근거 확인상태</span><strong>${escapeHtml(axisValue(evidence.score, '%'))}</strong><small>${escapeHtml(evidence.status)}</small></div></div><p class="fit-matrix ${escapeHtml(matrix.tier.toLowerCase())}"><strong>${escapeHtml(matrix.label)}</strong></p>`;
  }
  function dimensionHtml(item) {
    const reasons = item.reasons?.length ? `<ul>${item.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : '';
    const assumptions = item.assumptions?.length ? `<details><summary>가정·제약</summary><ul>${item.assumptions.map(reason => `<li>${escapeHtml(reason)}</li>`).join('')}</ul></details>` : '';
    return `<article class="personal-category ${escapeHtml(item.status.toLowerCase())}"><div><strong>${escapeHtml(item.label || DIMENSION_LABELS[item.id])}</strong><span>${item.score === null ? '점수 보류' : `${item.score.toFixed(0)}점`} · ${escapeHtml(statusLabel(item.status))}</span></div><p>자료 가용 ${item.availabilityPct.toFixed(0)}% · 입력상태 ${escapeHtml(item.inputQuality)}</p>${reasons}${assumptions}</article>`;
  }
  function resultExplanation(fit) {
    if (fit.status === 'NOT_FIT') return fit.hard_gates[0]?.reason || '확인된 필수조건을 충족하지 못했습니다.';
    if (fit.status === 'UNKNOWN_FIT') return fit.verification_holds[0]?.reason || '프로필 또는 후보 자료를 보완해야 합니다.';
    return fit.positive_drivers[0]?.reason || '입력한 조건과 확인 가능한 후보 특성을 비교한 결과입니다.';
  }

  function savedProfileFields() {
    if (typeof localStorage === 'undefined') return {};
    const mode = new URLSearchParams(location.search).get('mode') === 'demo' ? 'demo' : 'live';
    try { return normalizeProfile(JSON.parse(localStorage.getItem(`jamsil.workspace:${mode}:profile:v1`) || '{}')); } catch (_) { return {}; }
  }
  function selectedValue(key, fallback = '') {
    try { return sessionStorage.getItem(`jamsil.personal:${key}`) ?? savedProfileFields()[key] ?? fallback; } catch (_) { return savedProfileFields()[key] ?? fallback; }
  }
  function selectedRequirement(key) {
    try { const session = sessionStorage.getItem(`jamsil.personal:requirement:${key}`); if (session !== null) return session === 'true'; } catch (_) {}
    return savedProfileFields().personalFitRequirements?.[key] === true;
  }
  function option(value, label, selected) { return `<option value="${value}" ${value === selected ? 'selected' : ''}>${label}</option>`; }

  function enhanceProfileForm() {
    const form = document.getElementById('conditions-form');
    if (!form || form.querySelector('#personal-profile-basics')) return;
    const grid = form.querySelector('.form-grid');
    if (!grid) return;
    const household = selectedValue('householdType'), purpose = selectedValue('purchasePurpose');
    const finance = selectedValue('financeVerificationLevel'), redevelopment = selectedValue('redevelopmentTolerance');
    const liquidity = selectedValue('liquidityPreference'), uncertainty = selectedValue('uncertaintyTolerance');
    const preferred = selectedValue('preferredRegions'), avoid = selectedValue('avoidRegions');
    const block = document.createElement('details');
    block.id = 'personal-profile-basics'; block.className = 'personal-profile-basics';
    block.innerHTML = `<h3>Personal Fit 기준</h3><p class="help">Investment Quality와 별도입니다. 모르는 값은 비워두며, 추정 금융·직선거리 통근으로 필수 실패를 만들지 않습니다.</p><div class="form-grid"><div class="field"><label for="household-type">가구 구성</label><select id="household-type" name="householdType">${option('', '정하지 않음', household)}${option('single', '싱글', household)}${option('couple_single_income', '부부 · 외벌이', household)}${option('couple_dual_income', '부부 · 맞벌이', household)}${option('other', '기타 가구', household)}</select></div><div class="field"><label for="purchase-purpose">주된 목적</label><select id="purchase-purpose" name="purchasePurpose">${option('', '정하지 않음', purpose)}${option('owner', '실거주 중심', purpose)}${option('investment', '투자 중심', purpose)}${option('mixed', '실거주·투자 혼합', purpose)}</select></div><div class="field"><label for="finance-level">금융 확인상태</label><select id="finance-level" name="financeVerificationLevel">${option('', '확인상태 미입력', finance)}${option('INSUFFICIENT', '필수 입력 부족', finance)}${option('ESTIMATED', '사용자 추정 시나리오', finance)}${option('VERIFIED', '금융기관 조건 확인', finance)}</select></div><div class="field"><label for="redevelopment-tolerance">정비사업 선호</label><select id="redevelopment-tolerance" name="redevelopmentTolerance">${option('', '정하지 않음', redevelopment)}${option('avoid', '피하고 싶음', redevelopment)}${option('neutral', '중립', redevelopment)}${option('accept', '감수 가능', redevelopment)}${option('prefer', '선호', redevelopment)}</select></div><div class="field"><label for="liquidity-preference">환금성 선호</label><select id="liquidity-preference" name="liquidityPreference">${option('', '정하지 않음', liquidity)}${option('high', '매우 중요', liquidity)}${option('medium', '보통', liquidity)}${option('low', '낮아도 됨', liquidity)}</select></div><div class="field"><label for="uncertainty-tolerance">불확실성 허용</label><select id="uncertainty-tolerance" name="uncertaintyTolerance">${option('', '정하지 않음', uncertainty)}${option('low', '낮음', uncertainty)}${option('medium', '보통', uncertainty)}${option('high', '높음', uncertainty)}</select></div><div class="field"><label for="preferred-regions">선호 지역</label><input id="preferred-regions" name="preferredRegions" value="${escapeHtml(preferred)}" autocomplete="off"><p class="help">쉼표로 구분 · soft score</p></div><div class="field"><label for="avoid-regions">절대 제외 지역</label><input id="avoid-regions" name="avoidRegions" value="${escapeHtml(avoid)}" autocomplete="off"><p class="help">입력 시 MUST 조건</p></div></div><fieldset class="fit-requirements"><legend>명시적 MUST 조건</legend><label class="check"><input type="checkbox" name="personalFitRequirements.affordability" ${selectedRequirement('affordability') ? 'checked' : ''}><span>확인된 시나리오에서 초기자금·예비비 충족</span></label><label class="check"><input type="checkbox" name="personalFitRequirements.monthlyBurden" ${selectedRequirement('monthlyBurden') ? 'checked' : ''}><span>확인된 시나리오에서 월 부담 상한 준수</span></label><label class="check"><input type="checkbox" name="personalFitRequirements.commute" ${selectedRequirement('commute') ? 'checked' : ''}><span>모든 입력 거점의 확인된 문전 이동시간 준수</span></label></fieldset>`;
    block.insertAdjacentHTML('afterbegin', '<summary>선택 입력 · 생활·투자 선호 자세히</summary>');
    grid.insertAdjacentElement('afterend', block);
    block.addEventListener('change', event => { try { if (event.target.name?.startsWith('personalFitRequirements.')) sessionStorage.setItem(`jamsil.personal:requirement:${event.target.name.split('.').at(-1)}`, String(event.target.checked)); else sessionStorage.setItem(`jamsil.personal:${event.target.name}`, event.target.value); } catch (_) {} });
  }

  function enhanceCandidateCards() {
    for (const card of document.querySelectorAll('.candidate[data-property]')) {
      if (card.dataset.decisionFoundation === 'true') continue;
      const bundle = presentationFor(card.dataset.property), anchor = card.querySelector('.candidate-money');
      if (!bundle?.fit?.active || !anchor) continue;
      const signature = `${bundle.fit.score}:${bundle.fit.coverage}:${bundle.fit.status}:${bundle.matrix.tier}`;
      let block = card.querySelector('.personal-summary');
      if (!block) { block = document.createElement('section'); block.className = 'personal-summary'; anchor.parentElement.insertBefore(block, anchor); }
      if (block.dataset.signature === signature) continue;
      block.dataset.signature = signature;
      block.innerHTML = `${axesHtml(bundle)}<p>${escapeHtml(resultExplanation(bundle.fit))}</p>`;
    }
    const list = document.querySelector('.candidate-list');
    if (list && !document.querySelector('.personal-ranking-note') && [...evaluations.values()].some(item => item.active)) {
      const note = document.createElement('div'); note.className = 'notice warning personal-ranking-note';
      note.textContent = '기본 순서는 유지됩니다. Personal Fit·매트릭스 정렬은 직접 선택할 때만 적용되며 Investment Quality와 합산하지 않습니다.';
      list.parentElement.insertBefore(note, list);
    }
  }

  function enhancePropertyPage() {
    const match = location.hash.match(/^#\/properties\/(.+)$/), fitAnchor = document.getElementById('section-fit');
    if (!match || !fitAnchor) return;
    const id = decodeURIComponent(match[1]), bundle = presentationFor(id);
    if (!bundle?.fit?.active) return;
    const fit = bundle.fit, signature = `${fit.score}:${fit.coverage}:${fit.status}:${bundle.matrix.tier}`;
    let section = document.getElementById('section-personal');
    if (!section) { section = document.createElement('details'); section.id = 'section-personal'; section.className = 'panel'; fitAnchor.parentElement.insertBefore(section, fitAnchor); }
    if (section.dataset.signature === signature) return;
    section.dataset.signature = signature;
    const gates = fit.hard_gates.length ? `<div class="notice risk"><strong>필수 조건 미충족</strong><ul>${fit.hard_gates.map(item => `<li>${escapeHtml(item.reason)}</li>`).join('')}</ul></div>` : '';
    const holds = fit.verification_holds.length ? `<div class="notice warning"><strong>확인 후 순위 가능</strong><ul>${fit.verification_holds.map(item => `<li>${escapeHtml(item.reason)}</li>`).join('')}</ul></div>` : '';
    section.innerHTML = `<summary>내 생활·투자 조건과 얼마나 맞는지 자세히</summary><h2>내 조건 평가</h2><p class="personal-explanation">${escapeHtml(resultExplanation(fit))}</p>${gates}${holds}<p class="personal-weights"><strong>${escapeHtml(fit.policy)}</strong> · 각 축은 확인 가능한 항목만 정규화하고 coverage를 별도로 표시합니다.</p><div class="personal-category-grid">${policy.DIMENSIONS.map(id => dimensionHtml(fit.dimensions[id])).join('')}</div><p class="help">개인 자금·소득·부채·정확한 직장 위치는 이 결과에 복제하거나 공개 자료로 보내지 않습니다. 금융 결과는 대출 승인이 아닙니다.</p>`;
  }

  function enhanceUi() { enhanceProfileForm(); enhanceCandidateCards(); enhancePropertyPage(); }
  function installUi() {
    if (typeof document === 'undefined') return;
    // 덧붙이는 동안에는 감시를 끈다. 켜 둔 채 쓰면 내가 넣은 카드 요약이 다시 감시를 깨워 전체 카드를 한 번 더 훑는다.
    const target = document.documentElement, options = { childList: true, subtree: true };
    const observer = new MutationObserver(run);
    function run() { observer.disconnect(); try { enhanceUi(); } finally { observer.observe(target, options); } }
    observer.observe(target, options);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true }); else run();
  }

  function setPublicIndex(payload) {
    policy.assertPublicArtifact(payload);
    publicIndex.clear();
    for (const entry of Array.isArray(payload?.entries) ? payload.entries : []) if (entry && typeof entry.id === 'string' && entry.legacy && typeof entry.legacy === 'object') publicIndex.set(entry.id, entry.legacy);
    return publicIndex.size;
  }

  function clearSessionProfile() {
    if (typeof sessionStorage === 'undefined') return 0;
    const keys = [];
    for (let index = 0; index < sessionStorage.length; index += 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith('jamsil.personal:')) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
    return keys.length;
  }
  async function loadPublicIndex() {
    if (typeof window === 'undefined' || new URLSearchParams(location.search).get('mode') === 'demo') return 0;
    try {
      const response = await fetch('workspace-data/personalization_index.json', { cache: 'no-cache' });
      if (!response.ok) return 0;
      const payload = await response.json();
      if (payload.schemaVersion !== '1.0' || payload.dataMode !== 'live') return 0;
      // 화면에 알리는 것은 indexReady(약속)로 한다. 예전처럼 hashchange 를 흉내 내면 화면이 이미 계산해 둔
      // 분석을 그대로 다시 그려 순서가 안 바뀌고(색인이 늦게 온 느린 연결), 열어 둔 근거 창도 닫혔다.
      return setPublicIndex(payload);
    } catch (_) { return 0; }
  }

  // 목록 판정 안내가 집별 v8 분야 점수·필지 사실을 읽는다(상세 자료를 열기 전에도).
  function publicContext(id) { return publicIndex.get(id) || null; }

  let indexReady = Promise.resolve(0);
  if (typeof window !== 'undefined' && window.WorkspaceCore) { install(window.WorkspaceCore); installUi(); indexReady = loadPublicIndex(); }
  return { VERSION, indexReady, publicContext, POLICY: policy.POLICY, DIMENSION_LABELS, normalizeProfile, profileIsActive, weightsFor, evaluateCandidate, rerank, install, setPublicIndex, clearSessionProfile, presentationFor, _evaluations: evaluations, _presentations: presentations };
});
