/* Canonical local-only Personal Fit policy. Never reads Investment Quality scores. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PersonalFitPolicy = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const PROFILE_SCHEMA = 'personal-fit-profile/1.0';
  const POLICY_VERSION = 'personal-fit/new-hybrid-1.0';
  const PURPOSES = new Set(['owner', 'investment', 'mixed']);
  const FIT_STATUSES = new Set(['STRONG_FIT', 'GOOD_FIT', 'MIXED_FIT', 'WEAK_FIT', 'NOT_FIT', 'UNKNOWN_FIT']);
  const DIMENSIONS = ['affordability', 'commute', 'housing_household', 'location_lifestyle', 'investment_preference_fit'];
  const WEIGHTS = Object.freeze({
    owner: Object.freeze({ affordability: 35, commute: 25, housing_household: 20, location_lifestyle: 15, investment_preference_fit: 5 }),
    investment: Object.freeze({ affordability: 40, commute: 10, housing_household: 5, location_lifestyle: 15, investment_preference_fit: 30 }),
    mixed: Object.freeze({ affordability: 35, commute: 20, housing_household: 15, location_lifestyle: 15, investment_preference_fit: 15 })
  });
  const THRESHOLDS = Object.freeze({ noScoreBelowCoverage: 40, rankCoverage: 60, strongCoverage: 75, strong: 80, good: 65, mixed: 45 });
  const POLICY = Object.freeze({
    version: POLICY_VERSION,
    profileSchema: PROFILE_SCHEMA,
    dimensions: Object.freeze([...DIMENSIONS]),
    weights: WEIGHTS,
    thresholds: THRESHOLDS,
    hardGateRequires: Object.freeze(['explicit_must', 'profile_present', 'candidate_verified', 'deterministic_violation'])
  });
  const revisionIds = new WeakMap();

  const has = value => value !== null && value !== undefined && value !== '';
  const finite = value => Number.isFinite(Number(value));
  const clamp = value => Math.max(0, Math.min(100, Math.round(Number(value) * 10) / 10));
  const money = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value);
  const text = value => value === null || value === undefined ? '' : String(value);
  const list = value => Array.isArray(value) ? value : [];
  const uniq = values => [...new Set(values.filter(Boolean))];
  const sourceRef = (schema, path) => ({ schema, path });

  function newRevisionId() {
    const cryptoObject = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (cryptoObject && typeof cryptoObject.randomUUID === 'function') return 'pf-' + cryptoObject.randomUUID();
    const random = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return 'pf-' + random.slice(0, 36);
  }

  function revisionFor(profile) {
    if (profile && typeof profile.personalFitProfileRevision === 'string' && /^pf-[a-zA-Z0-9-]{8,80}$/.test(profile.personalFitProfileRevision)) return profile.personalFitProfileRevision;
    if (!profile || typeof profile !== 'object') return newRevisionId();
    if (!revisionIds.has(profile)) revisionIds.set(profile, newRevisionId());
    return revisionIds.get(profile);
  }

  function knownField(value, schema, path, verification = 'USER_DECLARED') {
    return has(value)
      ? { state: 'KNOWN', value, source: sourceRef(schema, path), verification }
      : { state: 'UNKNOWN', source: sourceRef(schema, path), verification: 'INSUFFICIENT' };
  }

  function fieldValue(field) { return field?.state === 'KNOWN' ? field.value : null; }

  function assertObject(profile, schema, expected) {
    if (!profile || Array.isArray(profile) || typeof profile !== 'object') throw new Error(`${schema}: profile must be an object`);
    if (expected === 'workspace' && profile.schemaVersion !== '1.0') throw new Error('workspace-profile-v1: unsupported schemaVersion');
    if (expected === 'private' && String(profile.schema_version) !== '2') throw new Error('private-profile-v2: unsupported schema_version');
  }

  function assertOptionalMoney(value, path) {
    if (has(value) && !money(String(value))) throw new Error(`${path}: won value must be a non-negative integer string`);
  }

  function normalizeStringList(value) {
    if (Array.isArray(value)) return uniq(value.map(item => text(item).trim()).filter(Boolean));
    if (typeof value === 'string') return uniq(value.split(',').map(item => item.trim()).filter(Boolean));
    return [];
  }

  function normalizePrivatePropertyTypes(value) {
    const aliases = { '아파트': 'apartment', apartment: 'apartment', apt: 'apartment', '빌라': 'villa', '다세대': 'villa', '연립': 'villa', villa: 'villa' };
    return uniq(normalizeStringList(value).map(item => aliases[item.toLowerCase?.() || item] || aliases[item] || item));
  }

  function normalizePrivateRegions(value) {
    return uniq(normalizeStringList(value).map(item => {
      const compact = item.replace(/\s+/g, '');
      if (/^서울(?:특별시|권|전체)?/.test(compact)) return '서울';
      if (/^인천(?:광역시|권|전체)?/.test(compact)) return '인천';
      if (/^경기(?:도|권|전체|_)/.test(compact)) return '__GYEONGGI__';
      return item;
    }));
  }

  function normalizedNeed(raw, schema, index) {
    if (!raw || typeof raw !== 'object' || !text(raw.key).trim()) return null;
    return {
      key: text(raw.key).trim(),
      value: has(raw.value) ? raw.value : null,
      required: raw.required === true,
      state: has(raw.value) ? 'KNOWN' : 'UNKNOWN',
      source: sourceRef(schema, `needs.${index}`),
      verification: 'USER_DECLARED'
    };
  }

  function workspaceNeeds(profile) {
    return list(profile.needs).map((item, index) => normalizedNeed(item, 'workspace-profile-v1', index)).filter(Boolean);
  }

  function adaptWorkspaceProfileV1(profile) {
    assertObject(profile, 'workspace-profile-v1', 'workspace');
    for (const key of ['cashAvailableKrw', 'reserveKrw', 'monthlyNetSurplusKrw', 'monthlyNetIncomeKrw', 'monthlyLivingCostKrw', 'monthlyHousingCostKrw', 'annualGrossIncomeKrw', 'maxMonthlyHousingPaymentKrw']) assertOptionalMoney(profile[key], key);
    if (!Array.isArray(profile.workplaces) || profile.workplaces.length > 2) throw new Error('workspace-profile-v1: workplaces must be an array of at most two entries');
    if (!Array.isArray(profile.needs)) throw new Error('workspace-profile-v1: needs must be an array');
    const requirements = profile.personalFitRequirements && typeof profile.personalFitRequirements === 'object' ? profile.personalFitRequirements : {};
    const canonical = {
      schemaVersion: PROFILE_SCHEMA,
      sourceSchema: 'workspace-profile-v1',
      revisionId: revisionFor(profile),
      fields: {
        purpose: knownField(PURPOSES.has(profile.purchasePurpose) ? profile.purchasePurpose : null, 'workspace-profile-v1', 'purchasePurpose'),
        householdType: knownField(profile.householdType || null, 'workspace-profile-v1', 'householdType'),
        householdSize: knownField(profile.householdSize ?? null, 'workspace-profile-v1', 'householdSize'),
        cashAvailableKrw: knownField(profile.cashAvailableKrw, 'workspace-profile-v1', 'cashAvailableKrw'),
        reserveKrw: knownField(profile.reserveKrw, 'workspace-profile-v1', 'reserveKrw'),
        annualGrossIncomeKrw: knownField(profile.annualGrossIncomeKrw, 'workspace-profile-v1', 'annualGrossIncomeKrw'),
        monthlyNetSurplusKrw: knownField(profile.monthlyNetSurplusKrw, 'workspace-profile-v1', 'monthlyNetSurplusKrw'),
        maxMonthlyHousingPaymentKrw: knownField(profile.maxMonthlyHousingPaymentKrw, 'workspace-profile-v1', 'maxMonthlyHousingPaymentKrw'),
        requiredMoveInBy: knownField(profile.requiredMoveInBy, 'workspace-profile-v1', 'requiredMoveInBy'),
        holdMonths: knownField(profile.holdMonths, 'workspace-profile-v1', 'holdMonths'),
        financeVerificationLevel: knownField(['VERIFIED', 'ESTIMATED', 'INSUFFICIENT'].includes(profile.financeVerificationLevel) ? profile.financeVerificationLevel : null, 'workspace-profile-v1', 'financeVerificationLevel'),
        redevelopmentTolerance: knownField(profile.redevelopmentTolerance || null, 'workspace-profile-v1', 'redevelopmentTolerance'),
        liquidityPreference: knownField(profile.liquidityPreference || null, 'workspace-profile-v1', 'liquidityPreference'),
        uncertaintyTolerance: knownField(profile.uncertaintyTolerance || null, 'workspace-profile-v1', 'uncertaintyTolerance'),
        preferredRegions: knownField(normalizeStringList(profile.preferredRegions), 'workspace-profile-v1', 'preferredRegions'),
        avoidRegions: knownField(normalizeStringList(profile.avoidRegions), 'workspace-profile-v1', 'avoidRegions')
      },
      requirements: {
        affordability: requirements.affordability === true,
        monthlyBurden: requirements.monthlyBurden === true,
        commute: requirements.commute === true,
        moveIn: requirements.moveIn === true || has(profile.requiredMoveInBy)
      },
      debts: list(profile.debts).map((debt, index) => ({
        state: debt && typeof debt === 'object' ? 'KNOWN' : 'UNKNOWN',
        source: sourceRef('workspace-profile-v1', `debts.${index}`), verification: 'USER_DECLARED', value: debt
      })),
      workplaces: profile.workplaces.map((workplace, index) => {
        if (!workplace || typeof workplace !== 'object' || !workplace.id) throw new Error(`workspace-profile-v1: workplace ${index} is malformed`);
        return {
          id: text(workplace.id),
          label: knownField(workplace.label || null, 'workspace-profile-v1', `workplaces.${index}.label`),
          exactLocation: knownField(workplace.exactLocation || null, 'workspace-profile-v1', `workplaces.${index}.exactLocation`),
          maxDoorToDoorMinutes: knownField(workplace.maxDoorToDoorMinutes, 'workspace-profile-v1', `workplaces.${index}.maxDoorToDoorMinutes`),
          daysPerWeek: knownField(workplace.daysPerWeek, 'workspace-profile-v1', `workplaces.${index}.daysPerWeek`),
          required: workplace.required === true || requirements.commute === true,
          source: sourceRef('workspace-profile-v1', `workplaces.${index}`)
        };
      }),
      needs: workspaceNeeds(profile),
      futureCashEvents: list(profile.futureCashEvents).map((event, index) => ({ state: event ? 'KNOWN' : 'UNKNOWN', value: event, source: sourceRef('workspace-profile-v1', `futureCashEvents.${index}`), verification: event?.certainty === 'confirmed' ? 'VERIFIED' : 'USER_DECLARED' }))
    };
    return validateCanonicalProfile(canonical);
  }

  function privatePurpose(profile) {
    const value = profile.preferences?.purchase_purpose ?? profile.purchase_purpose;
    return PURPOSES.has(value) ? value : null;
  }

  function adaptPrivateProfileV2(profile) {
    assertObject(profile, 'private-profile-v2', 'private');
    const budget = profile.budget && typeof profile.budget === 'object' ? profile.budget : {};
    for (const [key, value] of Object.entries({ cash_available_krw_low: budget.cash_available_krw_low, cash_available_krw_high: budget.cash_available_krw_high, reserve_after_purchase_krw: budget.reserve_after_purchase_krw, existing_debt_monthly_payment_krw: budget.existing_debt_monthly_payment_krw })) if (has(value) && (!Number.isSafeInteger(value) || value < 0)) throw new Error(`private-profile-v2: budget.${key} must be non-negative integer won`);
    const household = profile.household && typeof profile.household === 'object' ? profile.household : {};
    const preferences = profile.preferences && typeof profile.preferences === 'object' ? profile.preferences : {};
    const allowed = normalizePrivateRegions(profile.regions?.allowed);
    const propertyTypes = normalizePrivatePropertyTypes(profile.property_types);
    const needs = [];
    if (allowed.length) needs.push({ key: 'regions', value: allowed, required: true, state: 'KNOWN', source: sourceRef('private-profile-v2', 'regions.allowed'), verification: 'USER_DECLARED' });
    if (propertyTypes.length) needs.push({ key: 'propertyType', value: propertyTypes, required: true, state: 'KNOWN', source: sourceRef('private-profile-v2', 'property_types'), verification: 'USER_DECLARED' });
    if (has(preferences.min_exclusive_area_m2)) needs.push({ key: 'minArea', value: preferences.min_exclusive_area_m2, required: true, state: 'KNOWN', source: sourceRef('private-profile-v2', 'preferences.min_exclusive_area_m2'), verification: 'USER_DECLARED' });
    if (has(preferences.preferred_exclusive_area_m2)) needs.push({ key: 'preferredArea', value: preferences.preferred_exclusive_area_m2, required: false, state: 'KNOWN', source: sourceRef('private-profile-v2', 'preferences.preferred_exclusive_area_m2'), verification: 'USER_DECLARED' });
    const workplace = profile.workplace && typeof profile.workplace === 'object' ? profile.workplace : null;
    const canonical = {
      schemaVersion: PROFILE_SCHEMA,
      sourceSchema: 'private-profile-v2',
      revisionId: revisionFor(profile),
      fields: {
        purpose: knownField(privatePurpose(profile), 'private-profile-v2', 'preferences.purchase_purpose'),
        householdType: knownField(household.marital_status || null, 'private-profile-v2', 'household.marital_status'),
        householdSize: knownField(household.size ?? profile.income?.household_size ?? null, 'private-profile-v2', 'household.size'),
        cashAvailableKrwLow: knownField(has(budget.cash_available_krw_low) ? String(budget.cash_available_krw_low) : null, 'private-profile-v2', 'budget.cash_available_krw_low'),
        cashAvailableKrw: knownField(has(budget.cash_available_krw_high) ? String(budget.cash_available_krw_high) : null, 'private-profile-v2', 'budget.cash_available_krw_high'),
        reserveKrw: knownField(has(budget.reserve_after_purchase_krw) ? String(budget.reserve_after_purchase_krw) : null, 'private-profile-v2', 'budget.reserve_after_purchase_krw'),
        annualGrossIncomeKrw: knownField(has(profile.income?.annual_krw) ? String(profile.income.annual_krw) : null, 'private-profile-v2', 'income.annual_krw'),
        existingDebtMonthlyPaymentKrw: knownField(has(budget.existing_debt_monthly_payment_krw) ? String(budget.existing_debt_monthly_payment_krw) : null, 'private-profile-v2', 'budget.existing_debt_monthly_payment_krw'),
        requiredMoveInBy: knownField(null, 'private-profile-v2', 'required_move_in_by'),
        holdMonths: knownField(preferences.hold_months ?? null, 'private-profile-v2', 'preferences.hold_months'),
        financeVerificationLevel: knownField(preferences.finance_verification_level || null, 'private-profile-v2', 'preferences.finance_verification_level'),
        redevelopmentTolerance: knownField(preferences.redevelopment_tolerance ?? preferences.redevelopment_interest ?? null, 'private-profile-v2', 'preferences.redevelopment_tolerance'),
        liquidityPreference: knownField(preferences.liquidity_preference || null, 'private-profile-v2', 'preferences.liquidity_preference'),
        uncertaintyTolerance: knownField(preferences.uncertainty_tolerance || null, 'private-profile-v2', 'preferences.uncertainty_tolerance'),
        preferredRegions: knownField([], 'private-profile-v2', 'regions.preferred'),
        avoidRegions: knownField([], 'private-profile-v2', 'regions.avoid')
      },
      requirements: { affordability: has(budget.max_total_price_krw_exclusive), monthlyBurden: false, commute: false, moveIn: false },
      debts: list(budget.debts).map((debt, index) => ({ state: debt ? 'KNOWN' : 'UNKNOWN', value: debt, source: sourceRef('private-profile-v2', `budget.debts.${index}`), verification: 'USER_DECLARED' })),
      workplaces: workplace ? [{
        id: 'private-workplace-1',
        label: knownField(workplace.station || null, 'private-profile-v2', 'workplace.station'),
        exactLocation: knownField(null, 'private-profile-v2', 'workplace.exact_location'),
        maxDoorToDoorMinutes: knownField(null, 'private-profile-v2', 'workplace.max_door_to_door_minutes'),
        daysPerWeek: knownField(null, 'private-profile-v2', 'workplace.days_per_week'),
        required: false,
        source: sourceRef('private-profile-v2', 'workplace')
      }] : [],
      commuteProxies: workplace ? [{ state: Object.keys(workplace.measured_minutes || {}).length ? 'KNOWN' : 'UNKNOWN', verification: 'PROXY_ONLY', source: sourceRef('private-profile-v2', 'workplace.measured_minutes') }] : [],
      needs,
      futureCashEvents: []
    };
    return validateCanonicalProfile(canonical);
  }

  function validateCanonicalProfile(profile) {
    if (!profile || profile.schemaVersion !== PROFILE_SCHEMA || !profile.fields || !profile.requirements || !Array.isArray(profile.workplaces) || !Array.isArray(profile.needs)) throw new Error('personal-fit-profile/1.0: malformed canonical profile');
    const purpose = fieldValue(profile.fields.purpose);
    if (purpose !== null && !PURPOSES.has(purpose)) throw new Error('personal-fit-profile/1.0: invalid purpose');
    if (!/^pf-[a-zA-Z0-9-]{8,80}$/.test(profile.revisionId)) throw new Error('personal-fit-profile/1.0: invalid opaque revision');
    return profile;
  }

  function adaptProfile(profile) {
    if (profile?.schemaVersion === PROFILE_SCHEMA) return validateCanonicalProfile(profile);
    if (profile?.schemaVersion === '1.0') return adaptWorkspaceProfileV1(profile);
    if (String(profile?.schema_version) === '2') return adaptPrivateProfileV2(profile);
    throw new Error('Unsupported Personal Fit profile schema');
  }

  function combineParts(parts) {
    const declared = parts.filter(part => part.declared !== false);
    const available = declared.filter(part => part.score !== null && part.score !== undefined);
    const totalWeight = declared.reduce((sum, part) => sum + part.weight, 0);
    const availableWeight = available.reduce((sum, part) => sum + part.weight, 0);
    return {
      score: availableWeight ? clamp(available.reduce((sum, part) => sum + part.score * part.weight, 0) / availableWeight) : null,
      availabilityPct: totalWeight ? clamp(availableWeight / totalWeight * 100) : 0
    };
  }

  function dimension(id, label, parts, options = {}) {
    const combined = combineParts(parts);
    return {
      id, label, score: combined.score, status: options.status || (combined.score === null ? 'UNKNOWN' : 'AVAILABLE'),
      availabilityPct: combined.availabilityPct, inputQuality: options.inputQuality || (combined.score === null ? 'INSUFFICIENT' : 'USER_DECLARED'),
      weight: 0, contribution: null,
      reasons: uniq(options.reasons || []), blockers: options.blockers || [], assumptions: uniq(options.assumptions || []),
      inputRefs: uniq(options.inputRefs || []), sourceRefs: options.sourceRefs || [],
      hardGates: options.hardGates || [], verificationHolds: options.verificationHolds || []
    };
  }

  function gateById(analysis, id) { return list(analysis?.gates).find(item => item?.id === id) || null; }
  function scalar(scalarValue) { return scalarValue && money(scalarValue.value) && !['missing', 'not_applicable'].includes(scalarValue.status) ? scalarValue : null; }
  function percentRatio(numerator, denominator) {
    if (denominator <= 0n) return numerator >= 0n ? 100 : 0;
    if (numerator <= 0n) return 0;
    return clamp(Number(numerator * 1000n / denominator) / 10);
  }

  function stageText(context) {
    const direct = list(context?.seoul_zone?.zones).find(zone => zone?.relation === '포함');
    return text(context?.seoul_zone?.stage || context?.seoul_zone?.stage_name || direct?.stage || context?.redev?.stage || context?.redev_stage);
  }

  function activeRedevelopment(context) {
    const stage = stageText(context);
    if (/준공|입주(?!자)|사업\s*완료|이전\s*고시|청산/.test(stage)) return false;
    return context?.parcel_zone?.verdict === 'redevelopment_confirmed' || !!stage || !!context?.redev?.headline;
  }

  function affordabilityDimension(candidate, context, analysis, profile) {
    const parts = [], holds = [], hardGates = [], reasons = [], assumptions = [], inputRefs = [];
    const fields = profile.fields, scenario = list(analysis?.scenarios)[0] || null;
    const initial = scalar(scenario?.initialEquity), reserveShortfall = scalar(scenario?.maximumReserveShortfall);
    const cash = fieldValue(fields.cashAvailableKrw), reserve = fieldValue(fields.reserveKrw);
    const listingBound = !!analysis?.listingId && list(candidate?.listingIds).includes(analysis.listingId);
    const scenarioBound = !!scenario?.scenarioId && !!candidate?.id && scenario.scenarioId.startsWith(`${candidate.id}:`) && analysis?.propertyId === candidate.id;
    const priceReady = candidate?.currentPrice?.kind === 'asking' && candidate?.granularity === 'unit' && listingBound;
    if (!priceReady) holds.push({ code: 'NEEDS_PRICE_CHECK', dimension: 'affordability', critical: true, reason: '현재 후보 가격이 개별 호실의 확인된 판매가가 아니어서 실제 필요자금을 확정할 수 없습니다.' });
    if (!scenario) holds.push({ code: 'FINANCE_SCENARIO_MISSING', dimension: 'affordability', critical: true, reason: '매입비용과 조달을 포함한 로컬 금융 시나리오가 필요합니다.' });
    else if (!scenarioBound) holds.push({ code: 'FINANCE_SCENARIO_IDENTITY_UNVERIFIED', dimension: 'affordability', critical: true, reason: '금융 시나리오가 현재 후보와 같은 분석 대상에 묶였는지 확인할 수 없습니다.' });
    if (initial && money(cash) && money(reserve)) {
      const usable = BigInt(cash) - BigInt(reserve), needed = BigInt(initial.value);
      parts.push({ weight: 45, score: percentRatio(usable, needed), declared: true });
      inputRefs.push('profile.cashAvailableKrw', 'profile.reserveKrw', 'scenario.initialEquity');
      reasons.push(usable >= needed ? '현재 입력 범위에서 예비비를 남긴 초기자금 조건을 충족합니다.' : '현재 입력 범위에서는 초기자금 여유가 부족합니다.');
    } else parts.push({ weight: 45, score: null, declared: true });
    if (reserveShortfall) {
      parts.push({ weight: 25, score: BigInt(reserveShortfall.value) === 0n ? 100 : 0, declared: true });
      inputRefs.push('scenario.maximumReserveShortfall');
    } else parts.push({ weight: 25, score: null, declared: true });
    const monthly = gateById(analysis, 'monthly');
    if (monthly && ['pass', 'fail'].includes(monthly.status)) {
      parts.push({ weight: 20, score: monthly.status === 'pass' ? 100 : 0, declared: true });
      inputRefs.push('profile.maxMonthlyHousingPaymentKrw', 'analysis.gates.monthly');
    } else parts.push({ weight: 20, score: null, declared: true });
    const assumedLoan = money(scenario?.assumedLoanPrincipalKrw) && BigInt(scenario.assumedLoanPrincipalKrw) > 0n;
    const financeLevel = fieldValue(fields.financeVerificationLevel);
    const excluded = list(scenario?.excludedCosts);
    const financeReady = !!scenario && scenarioBound && initial?.status === 'complete' && reserveShortfall?.status === 'complete' && !excluded.length && (!assumedLoan || financeLevel === 'VERIFIED');
    parts.push({ weight: 10, score: financeReady ? 100 : null, declared: true });
    if (assumedLoan && financeLevel !== 'VERIFIED') holds.push({ code: 'NEEDS_FINANCE_CHECK', dimension: 'affordability', critical: true, reason: '대출금은 사용자 가정이며 금융기관 확인 전에는 조달 가능액으로 확정하지 않습니다.' });
    if (excluded.length || initial?.status === 'partial' || reserveShortfall?.status === 'partial') holds.push({ code: 'FINANCE_COSTS_INCOMPLETE', dimension: 'affordability', critical: true, reason: '누락되거나 추정된 취득·보유 비용이 있어 금융 결과는 잠정값입니다.' });
    if (activeRedevelopment(context) && !context?.redevelopmentContributionRange && !analysis?.redevelopmentContributionRange) holds.push({ code: 'REDEVELOPMENT_CONTRIBUTION_UNBOUNDED', dimension: 'affordability', critical: true, reason: '정비사업 추가분담금 범위가 확인되지 않았습니다.' });
    if (!financeReady && !holds.some(item => item.code === 'NEEDS_FINANCE_CHECK')) holds.push({ code: 'NEEDS_FINANCE_CHECK', dimension: 'affordability', critical: true, reason: '금융 시나리오의 필수 입력과 확인상태를 보완해야 합니다.' });
    const blockingHold = holds.some(item => item.critical);
    const cashGate = gateById(analysis, 'cash'), monthlyGate = gateById(analysis, 'monthly');
    if (profile.requirements.affordability && cashGate?.status === 'fail' && !blockingHold) hardGates.push({ id: 'affordability:cash', dimension: 'affordability', status: 'FAIL', reason: '필수 초기자금·예비비 조건을 충족하지 못했습니다.' });
    if (profile.requirements.monthlyBurden && monthlyGate?.status === 'fail' && !blockingHold) hardGates.push({ id: 'affordability:monthly', dimension: 'affordability', status: 'FAIL', reason: '필수 월 부담 상한을 충족하지 못했습니다.' });
    const combined = combineParts(parts);
    let status = 'UNKNOWN';
    if (hardGates.length) status = 'LIKELY_INFEASIBLE';
    else if (holds.length) status = holds.some(item => item.code === 'NEEDS_PRICE_CHECK') ? 'NEEDS_PRICE_CHECK' : 'NEEDS_FINANCE_CHECK';
    else if (combined.score !== null) status = combined.score >= 80 ? 'AFFORDABLE' : combined.score >= 55 ? 'STRETCHED' : 'LIKELY_INFEASIBLE';
    assumptions.push('금융 계산은 입력된 로컬 시나리오 범위이며 금융기관의 대출 승인이 아닙니다.');
    return dimension('affordability', '자금 적합도', parts, {
      status, inputQuality: holds.length ? (combined.score === null ? 'INSUFFICIENT' : 'ESTIMATED') : 'VERIFIED', reasons, assumptions,
      inputRefs, sourceRefs: [{ kind: 'calculation', ref: analysis?.modelVersion || 'workspace-finance' }], hardGates, verificationHolds: holds
    });
  }

  function commuteScore(minutes, maximum) {
    const ratio = minutes / maximum;
    if (ratio <= 0.75) return 100;
    if (ratio <= 1) return clamp(100 - (ratio - 0.75) * 80);
    if (ratio <= 1.25) return clamp(80 - (ratio - 1) * 120);
    if (ratio <= 1.75) return clamp(50 - (ratio - 1.25) * 100);
    return 0;
  }

  function verifiedRoute(observation) {
    return observation && finite(observation.minutes) && Number(observation.minutes) > 0 && Number(observation.minutes) <= 300 && (observation.verificationLevel === 'VERIFIED_ROUTE' || ['verified_route', 'user_verified_route'].includes(observation.source));
  }

  function commuteDimension(context, profile) {
    const parts = [], holds = [], hardGates = [], reasons = [], inputRefs = [], sourceRefs = [];
    const workplaces = profile.workplaces;
    if (!workplaces.length) return dimension('commute', '출퇴근', [], { status: 'UNKNOWN', inputQuality: 'INSUFFICIENT', reasons: ['직장 또는 생활 거점을 입력하지 않았습니다.'] });
    const multiple = workplaces.length > 1;
    const missingDayWeights = multiple && workplaces.some(workplace => !finite(fieldValue(workplace.daysPerWeek)) || Number(fieldValue(workplace.daysPerWeek)) <= 0);
    if (missingDayWeights) holds.push({ code: 'WORKPLACE_DAY_WEIGHT_MISSING', dimension: 'commute', critical: profile.requirements.commute, reason: '복수 거점의 주당 이동일수가 없어 임의 비중으로 합산하지 않습니다.' });
    for (const [index, workplace] of workplaces.entries()) {
      const maximum = fieldValue(workplace.maxDoorToDoorMinutes);
      const observation = list(context?.commutes).find(item => item?.workplaceId === workplace.id);
      const required = workplace.required === true;
      inputRefs.push(`profile.workplaces.${index}`);
      if (!finite(maximum) || Number(maximum) <= 0) {
        if (required) holds.push({ code: 'COMMUTE_LIMIT_MISSING', dimension: 'commute', critical: true, reason: '필수 통근 조건의 허용시간을 입력해야 합니다.' });
        continue;
      }
      if (!verifiedRoute(observation)) {
        const invalidVerifiedRoute = observation && (observation.verificationLevel === 'VERIFIED_ROUTE' || ['verified_route', 'user_verified_route'].includes(observation.source));
        const proxy = observation?.verificationLevel === 'PROXY_ONLY' || context?.station;
        if (required) holds.push({ code: invalidVerifiedRoute ? 'COMMUTE_ROUTE_INVALID' : proxy ? 'COMMUTE_PROXY_ONLY' : 'COMMUTE_ROUTE_UNKNOWN', dimension: 'commute', critical: true, reason: invalidVerifiedRoute ? '확인 경로의 이동시간 값이 없거나 허용 가능한 범위를 벗어나 판정하지 않습니다.' : proxy ? '통근 정보가 직선거리 또는 지역 프록시뿐이어서 필수시간 판정을 하지 않습니다.' : '후보별 문전 이동경로가 확인되지 않았습니다.' });
        if (proxy) sourceRefs.push({ kind: 'proxy', ref: context?.station?.distance_basis || 'unverified_commute' });
        continue;
      }
      if (missingDayWeights) continue;
      const days = multiple ? Number(fieldValue(workplace.daysPerWeek)) : 1;
      if (multiple && (!finite(days) || days <= 0)) continue;
      const score = commuteScore(Number(observation.minutes), Number(maximum));
      parts.push({ weight: days, score, declared: true });
      sourceRefs.push({ kind: 'route_observation', ref: observation.sourceRef || observation.source || 'local-observation' });
      reasons.push(score >= 80 ? '확인된 문전 이동경로가 입력한 허용범위 안입니다.' : score >= 50 ? '확인된 문전 이동경로가 허용범위의 경계에 있습니다.' : '확인된 문전 이동경로가 선호 범위보다 깁니다.');
      if (required && Number(observation.minutes) > Number(maximum)) hardGates.push({ id: `commute:${index}`, dimension: 'commute', status: 'FAIL', reason: '확인된 경로가 필수 통근시간 상한을 초과합니다.' });
    }
    if (!parts.length && context?.station) reasons.push('역 직선거리 정보는 참고만 하며 출퇴근 시간으로 변환하지 않습니다.');
    const status = hardGates.length ? 'POOR' : parts.length ? (combineParts(parts).score >= 80 ? 'EXCELLENT' : combineParts(parts).score >= 65 ? 'GOOD' : combineParts(parts).score >= 45 ? 'ACCEPTABLE' : 'POOR') : context?.station ? 'PROXY_ONLY' : 'UNKNOWN';
    return dimension('commute', '출퇴근', parts, { status, inputQuality: parts.length ? 'VERIFIED_ROUTE' : context?.station ? 'PROXY_ONLY' : 'INSUFFICIENT', reasons, assumptions: context?.station ? ['역 거리는 직선거리이며 도보·환승·문전 이동시간이 아닙니다.'] : [], inputRefs, sourceRefs, hardGates, verificationHolds: holds });
  }

  function regionMatch(candidate, choices) {
    const code = text(candidate?.regionCode), address = text(candidate?.addressLabel), terms = normalizeStringList(choices);
    if (!code && !address) return null;
    return terms.some(term => term === '__GYEONGGI__' ? !/^(서울|인천)/.test(code) : code === term || code.startsWith(term) || address.split(/\s+/).some(part => part === term || part.startsWith(term)));
  }

  function needOutcome(need, candidate, context, analysis) {
    if (!has(need.value)) return { known: false, pass: null };
    if (need.key === 'propertyType') {
      const choices = normalizeStringList(need.value === 'both' ? ['apartment', 'villa'] : need.value);
      return { known: !!candidate?.propertyType, pass: choices.includes(candidate?.propertyType) };
    }
    if (need.key === 'minArea' || need.key === 'preferredArea') return { known: finite(candidate?.area?.sqm), pass: finite(candidate?.area?.sqm) ? Number(candidate.area.sqm) >= Number(need.value) : null };
    if (need.key === 'rooms') return { known: finite(context?.rooms), pass: finite(context?.rooms) ? Number(context.rooms) >= Number(need.value) : null };
    if (need.key === 'moveIn') {
      const gate = gateById(analysis, 'moveIn');
      return { known: !!gate && ['pass', 'fail'].includes(gate.status), pass: gate?.status === 'pass' };
    }
    return { known: false, pass: null };
  }

  function housingDimension(candidate, context, analysis, profile) {
    const needs = profile.needs.filter(need => ['propertyType', 'minArea', 'preferredArea', 'rooms', 'moveIn'].includes(need.key));
    if (fieldValue(profile.fields.requiredMoveInBy) && !needs.some(need => need.key === 'moveIn')) needs.push({ key: 'moveIn', value: fieldValue(profile.fields.requiredMoveInBy), required: profile.requirements.moveIn, state: 'KNOWN', source: sourceRef(profile.sourceSchema, 'requiredMoveInBy') });
    const parts = [], holds = [], hardGates = [], reasons = [];
    for (const need of needs) {
      const outcome = needOutcome(need, candidate, context, analysis);
      if (!outcome.known) {
        if (need.required) holds.push({ code: `HOUSING_REQUIRED_UNKNOWN:${need.key}`, dimension: 'housing_household', critical: true, reason: '필수 주거조건을 판정할 후보 자료가 없습니다.' });
        parts.push({ weight: 1, score: null, declared: true });
      } else {
        parts.push({ weight: 1, score: outcome.pass ? 100 : need.required ? 0 : 35, declared: true });
        reasons.push(outcome.pass ? '입력한 주거조건과 후보 특성이 맞습니다.' : '입력한 주거조건과 후보 특성이 다릅니다.');
        if (need.required && !outcome.pass) hardGates.push({ id: `housing:${need.key}`, dimension: 'housing_household', status: 'FAIL', reason: '확인된 후보 특성이 필수 주거조건을 충족하지 못합니다.' });
      }
    }
    return dimension('housing_household', '주거·가구 적합도', parts, { status: hardGates.length ? 'NOT_FIT' : parts.some(part => part.score !== null) ? 'AVAILABLE' : 'UNKNOWN', inputQuality: parts.some(part => part.score !== null) ? 'VERIFIED' : 'INSUFFICIENT', reasons: reasons.length ? reasons : ['평가할 구조화 주거조건이 없습니다.'], inputRefs: needs.map(need => `profile.needs.${need.key}`), sourceRefs: [{ kind: 'candidate_fact', ref: candidate?.id || 'unknown' }], hardGates, verificationHolds: holds });
  }

  function locationDimension(candidate, profile) {
    const parts = [], hardGates = [], reasons = [], inputRefs = [];
    const requiredNeed = profile.needs.find(need => need.key === 'regions');
    if (requiredNeed) {
      const matched = regionMatch(candidate, requiredNeed.value);
      parts.push({ weight: 50, score: matched === null ? null : matched ? 100 : 0, declared: true });
      inputRefs.push('profile.needs.regions');
      if (matched === false && requiredNeed.required) hardGates.push({ id: 'location:required-region', dimension: 'location_lifestyle', status: 'FAIL', reason: '후보가 사용자가 지정한 필수 지역 범위 밖입니다.' });
      if (matched !== null) reasons.push(matched ? '후보가 지정한 지역 범위에 포함됩니다.' : '후보가 지정한 지역 범위 밖입니다.');
    }
    const preferred = fieldValue(profile.fields.preferredRegions) || [];
    if (preferred.length) {
      const matched = regionMatch(candidate, preferred);
      parts.push({ weight: 25, score: matched === null ? null : matched ? 100 : 40, declared: true });
      inputRefs.push('profile.preferredRegions');
      if (matched !== null) reasons.push(matched ? '선호 지역과 일치합니다.' : '필수 제외는 아니지만 선호 지역과 다릅니다.');
    }
    const avoid = fieldValue(profile.fields.avoidRegions) || [];
    if (avoid.length) {
      const matched = regionMatch(candidate, avoid);
      parts.push({ weight: 25, score: matched === null ? null : matched ? 0 : 100, declared: true });
      inputRefs.push('profile.avoidRegions');
      if (matched === true) hardGates.push({ id: 'location:avoid-region', dimension: 'location_lifestyle', status: 'FAIL', reason: '후보가 사용자가 명시한 제외 지역에 포함됩니다.' });
    }
    return dimension('location_lifestyle', '지역·생활 선호', parts, { status: hardGates.length ? 'NOT_FIT' : parts.some(part => part.score !== null) ? 'AVAILABLE' : 'UNKNOWN', inputQuality: parts.some(part => part.score !== null) ? 'VERIFIED' : 'INSUFFICIENT', reasons: reasons.length ? reasons : ['구조화된 지역 선호가 없습니다.'], inputRefs, sourceRefs: [{ kind: 'candidate_fact', ref: candidate?.regionCode || 'unknown' }], hardGates });
  }

  function redevelopmentAlignment(tolerance, active) {
    const table = {
      avoid: active ? 0 : 100,
      neutral: active ? 50 : 75,
      accept: active ? 85 : 65,
      prefer: active ? 100 : 30
    };
    return Object.prototype.hasOwnProperty.call(table, tolerance) ? table[tolerance] : null;
  }

  function investmentPreferenceDimension(context, analysis, profile) {
    const parts = [], reasons = [], assumptions = [], inputRefs = [];
    const tolerance = fieldValue(profile.fields.redevelopmentTolerance);
    const active = activeRedevelopment(context);
    if (has(tolerance)) {
      const score = redevelopmentAlignment(tolerance, active);
      parts.push({ weight: 25, score, declared: true });
      inputRefs.push('profile.redevelopmentTolerance');
      if (score !== null) reasons.push(score >= 75 ? '정비사업 선호와 후보의 확인된 특성이 잘 맞습니다.' : '정비사업 선호와 후보 특성 사이에 차이가 있습니다.');
    } else parts.push({ weight: 25, score: null, declared: true });
    const holdMonths = fieldValue(profile.fields.holdMonths);
    if (has(holdMonths)) {
      parts.push({ weight: 25, score: null, declared: true });
      inputRefs.push('profile.holdMonths');
      assumptions.push('사업·매도 소요기간의 검증된 범위가 없어 보유기간 적합도는 점수화하지 않습니다.');
    } else parts.push({ weight: 25, score: null, declared: true });
    const liquidity = fieldValue(profile.fields.liquidityPreference);
    if (has(liquidity)) {
      parts.push({ weight: 25, score: null, declared: true });
      inputRefs.push('profile.liquidityPreference');
      assumptions.push('현재 공개 로컬 후보에는 Personal Fit용 원시 거래지속성 계약이 없어 유동성 선호를 점수화하지 않습니다.');
    } else parts.push({ weight: 25, score: null, declared: true });
    const uncertainty = fieldValue(profile.fields.uncertaintyTolerance);
    if (has(uncertainty)) {
      const unknownCount = list(analysis?.gates).filter(gate => gate?.status === 'unknown').length + list(analysis?.missingInputs).length;
      const score = uncertainty === 'low' ? (unknownCount ? 25 : 100) : uncertainty === 'medium' ? (unknownCount ? 55 : 85) : uncertainty === 'high' ? 85 : null;
      parts.push({ weight: 25, score, declared: true });
      inputRefs.push('profile.uncertaintyTolerance');
      if (score !== null) reasons.push(score >= 75 ? '후보의 현재 확인상태가 입력한 불확실성 허용도와 맞습니다.' : '현재 확인 필요 항목이 입력한 불확실성 허용도보다 많습니다.');
    } else parts.push({ weight: 25, score: null, declared: true });
    return dimension('investment_preference_fit', '투자 성향 적합도', parts, { status: parts.some(part => part.score !== null) ? 'AVAILABLE' : 'UNKNOWN', inputQuality: parts.some(part => part.score !== null) ? 'PUBLIC_TRAIT' : 'INSUFFICIENT', reasons: reasons.length ? reasons : ['보유기간·유동성·정비사업·불확실성 선호와 비교할 자료가 부족합니다.'], assumptions, inputRefs, sourceRefs: [{ kind: 'candidate_trait', ref: 'public-context-without-investment-score' }] });
  }

  function statusFor(score, coverage, hardGates, criticalHolds) {
    if (hardGates.length) return 'NOT_FIT';
    if (score === null || coverage < THRESHOLDS.rankCoverage || criticalHolds.length) return 'UNKNOWN_FIT';
    if (score >= THRESHOLDS.strong && coverage >= THRESHOLDS.strongCoverage) return 'STRONG_FIT';
    if (score >= THRESHOLDS.good) return 'GOOD_FIT';
    if (score >= THRESHOLDS.mixed) return 'MIXED_FIT';
    return 'WEAK_FIT';
  }

  function profileActive(profile) {
    return fieldValue(profile.fields.purpose) !== null || profile.needs.length > 0 || profile.workplaces.length > 0 || ['cashAvailableKrw', 'reserveKrw', 'holdMonths', 'redevelopmentTolerance', 'liquidityPreference', 'uncertaintyTolerance'].some(key => fieldValue(profile.fields[key]) !== null);
  }

  function evaluatePersonalFit({ candidate = {}, context = {}, analysis = {}, profile, generatedAt } = {}) {
    const canonical = adaptProfile(profile || {}), purpose = fieldValue(canonical.fields.purpose), active = profileActive(canonical);
    const weights = purpose ? WEIGHTS[purpose] : null;
    const dimensions = {
      affordability: affordabilityDimension(candidate, context, analysis, canonical),
      commute: commuteDimension(context, canonical),
      housing_household: housingDimension(candidate, context, analysis, canonical),
      location_lifestyle: locationDimension(candidate, canonical),
      investment_preference_fit: investmentPreferenceDimension(context, analysis, canonical)
    };
    const fallbackWeights = WEIGHTS.mixed;
    const activeWeights = weights || fallbackWeights;
    for (const id of DIMENSIONS) dimensions[id].weight = activeWeights[id];
    const available = DIMENSIONS.filter(id => dimensions[id].score !== null);
    const availableWeight = available.reduce((sum, id) => sum + activeWeights[id], 0);
    const rawScore = availableWeight ? clamp(available.reduce((sum, id) => sum + dimensions[id].score * activeWeights[id], 0) / availableWeight) : null;
    const coverage = clamp(DIMENSIONS.reduce((sum, id) => sum + activeWeights[id] * dimensions[id].availabilityPct / 100, 0));
    const score = coverage < THRESHOLDS.noScoreBelowCoverage ? null : rawScore;
    for (const id of available) dimensions[id].contribution = score === null ? null : clamp(dimensions[id].score * activeWeights[id] / availableWeight);
    const hardGates = DIMENSIONS.flatMap(id => dimensions[id].hardGates);
    const holds = DIMENSIONS.flatMap(id => dimensions[id].verificationHolds);
    if (!purpose) holds.unshift({ code: 'PURPOSE_MISSING', dimension: 'profile', critical: true, reason: '매수 목적을 선택해야 목적별 가중치와 순위 자격을 확정할 수 있습니다.' });
    const criticalHolds = holds.filter(item => item.critical);
    const status = statusFor(score, coverage, hardGates, criticalHolds);
    if (!FIT_STATUSES.has(status)) throw new Error('Personal Fit status contract violated');
    const rankingEligible = active && status !== 'NOT_FIT' && status !== 'UNKNOWN_FIT' && coverage >= THRESHOLDS.rankCoverage && !criticalHolds.length;
    const scoredDimensions = DIMENSIONS.map(id => dimensions[id]).filter(item => item.score !== null).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    return {
      policy: POLICY_VERSION,
      active,
      score,
      coverage,
      status,
      ranking_eligible: rankingEligible,
      dimensions,
      hard_gates: hardGates,
      verification_holds: holds,
      positive_drivers: scoredDimensions.filter(item => item.score >= 75).slice(0, 3).map(item => ({ dimension: item.id, reason: item.reasons[0] || `${item.label}이 상대적으로 잘 맞습니다.` })),
      limitations: uniq(DIMENSIONS.flatMap(id => dimensions[id].assumptions).concat(holds.map(item => item.reason))),
      unknown_dimensions: DIMENSIONS.filter(id => dimensions[id].score === null),
      profile_schema_version: PROFILE_SCHEMA,
      profile_revision: canonical.revisionId,
      candidate_snapshot_id: analysis?.snapshotId || context?.snapshotId || 'unknown',
      generated_at: generatedAt || new Date().toISOString()
    };
  }

  function readInvestmentQuality(context = {}) {
    const inv = context?.inv || context?.legacy?.inv || {};
    const score = finite(inv?.recommendation?.score) ? clamp(inv.recommendation.score) : finite(inv?.total) ? clamp(inv.total) : null;
    const status = text(inv?.assessment?.status || 'data_needed').toLowerCase();
    const coverage = finite(inv?.recommendation?.coverage) ? clamp(inv.recommendation.coverage) : finite(inv?.evidence_coverage_pct) ? clamp(inv.evidence_coverage_pct) : null;
    return { policy: 'v8', score, status, evidenceCoverage: coverage };
  }

  function classifyMatrix(investment, fit) {
    const investmentStatus = text(investment?.status).toLowerCase();
    if (['blocked', 'data_needed', 'verify'].includes(investmentStatus)) return { tier: 'NEEDS_INVESTMENT_EVIDENCE', label: '투자 검토 근거 확인 필요' };
    if (!fit || fit.status === 'UNKNOWN_FIT') return { tier: 'NEEDS_PROFILE_OR_DATA', label: '내 조건 또는 후보 자료 확인 필요' };
    const highInvestment = ['top', 'attractive'].includes(investmentStatus);
    const highFit = ['STRONG_FIT', 'GOOD_FIT'].includes(fit.status);
    if (highInvestment && highFit) return { tier: 'PRIORITY_REVIEW', label: '투자가치와 내 조건 모두 우선 검토' };
    if (highInvestment) return { tier: 'ATTRACTIVE_ASSET_NOT_CURRENT_FIT', label: '좋은 자산이나 현재 내 조건과는 차이' };
    if (highFit) return { tier: 'OWNER_OCCUPIER_OR_LIFESTYLE_FIT', label: '내 조건에는 잘 맞고 투자매력은 상대적으로 낮음' };
    return { tier: 'LOWER_PRIORITY', label: '현재 기준 후순위' };
  }

  function sortRows(rows, mode = 'default') {
    if (mode === 'default' || mode === 'price') return [...rows];
    const indexed = rows.map((row, index) => ({ row, index }));
    const investment = row => row.analysis?.investmentQuality || readInvestmentQuality(row.context || {});
    const fit = row => row.analysis?.personalFit || row.analysis?.personalization || null;
    const investmentBlocked = row => ['blocked', 'data_needed', 'verify'].includes(text(investment(row)?.status).toLowerCase());
    const matrixOrder = { PRIORITY_REVIEW: 0, ATTRACTIVE_ASSET_NOT_CURRENT_FIT: 1, OWNER_OCCUPIER_OR_LIFESTYLE_FIT: 2, LOWER_PRIORITY: 3, NEEDS_PROFILE_OR_DATA: 4, NEEDS_INVESTMENT_EVIDENCE: 5 };
    indexed.sort((a, b) => {
      const ar = a.row, br = b.row, ai = investment(ar), bi = investment(br), af = fit(ar), bf = fit(br);
      if (mode === 'investment') {
        const blocked = Number(investmentBlocked(ar)) - Number(investmentBlocked(br));
        if (blocked) return blocked;
        if (ai.score !== bi.score) return ai.score === null ? 1 : bi.score === null ? -1 : bi.score - ai.score;
      } else if (mode === 'personal-fit') {
        const blocked = Number(investmentBlocked(ar)) - Number(investmentBlocked(br));
        if (blocked) return blocked;
        if (!!af?.ranking_eligible !== !!bf?.ranking_eligible) return af?.ranking_eligible ? -1 : 1;
        if ((af?.score ?? -1) !== (bf?.score ?? -1)) return (bf?.score ?? -1) - (af?.score ?? -1);
        if (af?.status === 'NOT_FIT' !== (bf?.status === 'NOT_FIT')) return af?.status === 'NOT_FIT' ? 1 : -1;
      } else if (mode === 'matrix') {
        const am = classifyMatrix(ai, af), bm = classifyMatrix(bi, bf), delta = (matrixOrder[am.tier] ?? 9) - (matrixOrder[bm.tier] ?? 9);
        if (delta) return delta;
        if ((af?.score ?? -1) !== (bf?.score ?? -1)) return (bf?.score ?? -1) - (af?.score ?? -1);
        if ((ai?.score ?? -1) !== (bi?.score ?? -1)) return (bi?.score ?? -1) - (ai?.score ?? -1);
      } else if (mode === 'needs-check') {
        const aNeeds = af?.status === 'UNKNOWN_FIT' || list(af?.verification_holds).length > 0;
        const bNeeds = bf?.status === 'UNKNOWN_FIT' || list(bf?.verification_holds).length > 0;
        if (aNeeds !== bNeeds) return aNeeds ? -1 : 1;
      }
      return a.index - b.index;
    });
    return indexed.map(item => item.row);
  }

  function assertPublicArtifact(value) {
    const forbidden = /cash|income|debt|workplace|exactlocation|profile(_|)revision|profile(_|)fingerprint|personal(_|)fit/i;
    const walk = (current, path = '') => {
      if (!current || typeof current !== 'object') return;
      for (const [key, item] of Object.entries(current)) {
        const next = path ? `${path}.${key}` : key;
        if (forbidden.test(key)) throw new Error(`PRIVATE_FIELD_IN_PUBLIC_ARTIFACT:${next}`);
        walk(item, next);
      }
    };
    walk(value);
    return true;
  }

  return {
    PROFILE_SCHEMA, POLICY_VERSION, POLICY, WEIGHTS, THRESHOLDS, DIMENSIONS,
    newRevisionId, adaptWorkspaceProfileV1, adaptPrivateProfileV2, validateCanonicalProfile, adaptProfile,
    evaluatePersonalFit, readInvestmentQuality, classifyMatrix, sortRows, assertPublicArtifact,
    _internal: { activeRedevelopment, commuteScore, verifiedRoute, fieldValue, combineParts }
  };
});
