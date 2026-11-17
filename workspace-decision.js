/* P3A decision presentation model. It does not score or rank candidates. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WorkspaceDecision = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const VERSION = 'decision-ux/1.0';
  const INVESTMENT_POLICY = 'v8';
  const PERSONAL_FIT_POLICY = 'personal-fit/new-hybrid-1.0';
  const BLOCKED_INVESTMENT = new Set(['blocked', 'data_needed', 'verify']);
  const OFFICIAL_AUTHORITIES = new Set(['government_law', 'government_notice', 'government_data', 'government_guidance']);
  const FIT_POSITIVE = new Set(['STRONG_FIT', 'GOOD_FIT']);
  const STAGE_DEFINITIONS = Object.freeze([
    ['initial_review', '후보지/초기검토', ['candidate', 'initial_review', '후보지', '초기검토']],
    ['plan_preparation', '정비계획 수립', ['plan_preparation', 'maintenance_plan', '정비계획 수립']],
    ['district_designated', '정비구역 지정', ['district_designated', '정비구역 지정']],
    ['promotion_committee_approved', '추진위원회 승인', ['promotion_committee_approved', '추진위원회 승인']],
    ['association_established', '조합설립인가', ['association_established', '조합설립인가', '조합설립']],
    ['project_implementation_approved', '사업시행계획인가', ['project_implementation_approved', 'project_implementation', '사업시행계획인가', '사업시행인가']],
    ['management_disposition_approved', '관리처분계획인가', ['management_disposition_approved', 'management_disposition', '관리처분계획인가', '관리처분인가']],
    ['relocation_demolition', '이주·철거', ['relocation_demolition', '이주·철거', '이주 철거']],
    ['construction_started', '착공', ['construction_started', 'construction', '착공']],
    ['partially_completed', '준공(일부)', ['partially_completed', 'partial_completion', '준공(일부)', '부분준공']],
    ['completed', '완료', ['completed', 'completion', '사업 완료', '준공', '완료']],
    ['unknown', '단계 미상', ['unknown', '단계 미상', '미상']]
  ]);
  const text = value => value === null || value === undefined ? '' : String(value).trim();
  const list = value => Array.isArray(value) ? value : [];
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const firstText = (...values) => values.map(text).find(Boolean) || null;

  function safeReason(item, fallback, axis) {
    return {
      id: text(item?.code || item?.key || item?.id || `${axis}-reason`),
      axis,
      direction: item?.direction === 'negative' ? 'negative' : item?.direction === 'neutral' ? 'neutral' : 'positive',
      text: firstText(item?.reason, item?.evidence, item?.text, fallback) || fallback,
      state: text(item?.state || item?.confidence || 'unverified').toLowerCase(),
      claimIds: list(item?.claimIds).filter(Boolean),
      calculationIds: list(item?.calculationIds).filter(Boolean),
      sourceRefs: list(item?.sourceRefs).filter(Boolean),
      limitation: firstText(item?.limitation)
    };
  }

  function investmentView(context, analysis) {
    const legacy = context?.legacy || context || {};
    const current = analysis?.investmentQuality || {};
    const inv = legacy?.inv || {};
    const score = finite(current.score) ? current.score
      : finite(inv?.recommendation?.score) ? inv.recommendation.score
      : finite(inv?.total) ? inv.total : null;
    const status = text(current.status || inv?.assessment?.status || 'data_needed').toLowerCase();
    const theses = list(inv?.recommendation?.theses);
    const reasons = theses.length ? theses.map((item, index) => safeReason({ ...item, id: item.key || `v8-thesis-${index + 1}` }, 'v8 판단 근거를 확인하세요.', 'investment'))
      : list(analysis?.reasons).map((item, index) => safeReason({ ...item, id: item.id || `decision-reason-${index + 1}` }, '현재 자료 범위의 투자 판단입니다.', 'investment'));
    return {
      policy: INVESTMENT_POLICY,
      score,
      status,
      rank: Number.isInteger(analysis?.investmentRank) ? analysis.investmentRank : null,
      blocked: BLOCKED_INVESTMENT.has(status),
      drivers: reasons.slice(0, 3),
      penalties: list(analysis?.risks).filter(item => ['critical', 'material'].includes(item?.severity)).slice(0, 3)
        .map((item, index) => safeReason({ ...item, id: item.id || `investment-risk-${index + 1}`, direction: 'negative' }, '투자 위험을 확인하세요.', 'investment')),
      limitations: list(inv?.recommendation?.limitations).map(text).filter(Boolean)
    };
  }

  function fitView(analysis) {
    const fit = analysis?.personalFit || analysis?.personalization || {};
    const active = fit.active === true;
    return {
      policy: PERSONAL_FIT_POLICY,
      active,
      score: active && finite(fit.score) ? fit.score : null,
      coverage: active && finite(fit.coverage) ? fit.coverage : 0,
      status: active ? text(fit.status || 'UNKNOWN_FIT') : 'PROFILE_REQUIRED',
      rankingEligible: active && fit.ranking_eligible === true,
      positiveDrivers: list(fit.positive_drivers).slice(0, 3).map((item, index) => safeReason({ ...item, id: item.code || `fit-driver-${index + 1}` }, '입력 조건과 후보 특성이 맞습니다.', 'personal_fit')),
      hardGates: list(fit.hard_gates).map((item, index) => safeReason({ ...item, id: item.code || `fit-gate-${index + 1}`, direction: 'negative' }, '명시한 필수 조건을 충족하지 못했습니다.', 'personal_fit')),
      verificationHolds: list(fit.verification_holds).map((item, index) => safeReason({ ...item, id: item.code || `fit-hold-${index + 1}`, direction: 'neutral' }, '추가 확인 후 적합도를 판단할 수 있습니다.', 'personal_fit')),
      unknownDimensions: list(fit.unknown_dimensions).map(text).filter(Boolean)
    };
  }

  function evidenceView(context, analysis) {
    const legacy = context?.legacy || context || {};
    const current = analysis?.evidenceConfidence || {};
    const legacyCoverage = legacy?.inv?.recommendation?.coverage ?? legacy?.inv?.evidence_coverage_pct;
    const score = finite(current.score) ? current.score : finite(legacyCoverage) ? legacyCoverage : null;
    const claims = list(context?.claims);
    const sources = list(context?.evidence);
    const conflicts = claims.filter(item => item?.state === 'conflicting').length;
    const status = text(current.status || (score === null ? 'UNKNOWN' : score >= 70 ? 'HIGH' : score >= 50 ? 'MEDIUM' : 'LOW')).toUpperCase();
    return {
      score,
      status,
      basis: sources.length ? 'claim_level' : 'legacy_v8_evidence_coverage',
      precision: sources.length ? 'CLAIM_LEVEL' : 'SUMMARY_ONLY',
      directSourceCount: sources.length,
      conflictCount: conflicts,
      freshness: 'UNKNOWN',
      limitations: sources.length ? [] : ['현재 수치는 공개 근거 범위의 요약이며 개별 원문 확인 수준을 뜻하지 않습니다.']
    };
  }

  function riskView(analysis, fit) {
    const risks = list(analysis?.risks).map((item, index) => ({
      id: text(item?.id || `risk-${index + 1}`),
      severity: ['critical', 'material', 'note'].includes(item?.severity) ? item.severity : 'material',
      text: firstText(item?.text, '개별 권리·판매 상태와 실제 비용을 확인해야 합니다.'),
      claimIds: list(item?.claimIds).filter(Boolean)
    }));
    if (fit.hardGates.length) risks.unshift({ id: fit.hardGates[0].id, severity: 'critical', text: fit.hardGates[0].text, claimIds: fit.hardGates[0].claimIds });
    return risks;
  }

  function nextActions(property, analysis, fit, evidence, risks) {
    const propertyId = encodeURIComponent(text(property?.id));
    const actions = [];
    const add = action => { if (!actions.some(item => item.id === action.id)) actions.push(action); };
    if (!fit.active) add({ id: 'enter-profile', priority: 'NOW', label: '내 조건을 입력해 적합도를 확인하세요.', reason: 'Personal Fit은 프로필이 없으면 낮은 점수로 추정하지 않습니다.', resolves: ['personal_fit'], target: { kind: 'route', href: '/conditions' } });
    for (const hold of fit.verificationHolds) {
      const finance = /finance|afford|cash|price|monthly/i.test(`${hold.id} ${hold.text}`);
      add({ id: `resolve-${hold.id}`, priority: finance ? 'BEFORE_OFFER' : 'BEFORE_VISIT', label: hold.text, reason: '확인 보류를 해소해야 Personal Fit 순위 자격을 판단할 수 있습니다.', resolves: ['personal_fit'], target: { kind: 'route', href: finance ? `/scenario/${propertyId}` : '/conditions' } });
    }
    if (fit.hardGates.length) add({ id: 'review-hard-gate', priority: 'NOW', label: '미충족한 필수 조건을 다시 확인하세요.', reason: fit.hardGates[0].text, resolves: ['personal_fit'], target: { kind: 'route', href: '/conditions' } });
    if (evidence.status === 'LOW' || evidence.status === 'UNKNOWN' || evidence.precision === 'SUMMARY_ONLY') add({ id: 'review-evidence', priority: 'BEFORE_OFFER', label: '판단에 연결된 개별 원문과 적용 대상을 확인하세요.', reason: evidence.limitations[0] || '직접 원문 근거가 충분하지 않습니다.', resolves: ['evidence'], target: { kind: 'section', id: 'section-sources' } });
    if (risks.length) add({ id: 'review-primary-risk', priority: 'BEFORE_CONTRACT', label: risks[0].text, reason: '핵심 위험은 계약 전에 별도 확인해야 합니다.', resolves: ['risk'], target: { kind: 'section', id: 'section-rights' } });
    if (!actions.length) add({ id: 'verify-sale-status', priority: 'BEFORE_VISIT', label: '현재 판매 상태와 최신 가격을 확인하세요.', reason: '과거 거래 후보와 현재 매도 가능 여부는 별개입니다.', resolves: ['listing'], target: { kind: 'manual_check' } });
    return actions.slice(0, 4);
  }

  function narrative(investment, fit, evidence, risks, actions, analysis) {
    const matrixLabel = firstText(analysis?.recommendationMatrix?.label);
    const whyInvestment = investment.drivers[0]?.text || (investment.blocked ? '투자 검토 근거가 부족하거나 차단 상태입니다.' : '현재 v8 상태와 공개 자료 범위에서 검토하는 후보입니다.');
    const whyFit = !fit.active ? '내 조건을 입력하면 이 후보가 나에게 맞는지 별도로 계산합니다.'
      : fit.hardGates[0]?.text || fit.positiveDrivers[0]?.text || fit.verificationHolds[0]?.text || '확인 가능한 Personal Fit 항목이 부족합니다.';
    const risk = risks[0]?.text || evidence.limitations[0] || '현재 판매 상태·권리·최종 비용을 별도로 확인해야 합니다.';
    return {
      headline: matrixLabel || (investment.blocked ? '투자 검토 근거를 먼저 확인할 후보' : '세 축을 따로 확인할 후보'),
      whyInvestment,
      whyFit,
      primaryRisk: risk,
      nextAction: actions[0]?.label || '추가 확인 항목을 검토하세요.'
    };
  }

  function buildCandidateDecision({ property = {}, context = {}, analysis = {}, manifest = {} } = {}) {
    const investment = investmentView(context, analysis);
    const personalFit = fitView(analysis);
    const evidence = evidenceView(context, analysis);
    const risks = riskView(analysis, personalFit);
    const actions = nextActions(property, analysis, personalFit, evidence, risks);
    const result = {
      schemaVersion: VERSION,
      propertyId: text(property.id),
      snapshotId: text(manifest.snapshotId || analysis.snapshotId || context.snapshotId || 'unknown'),
      generatedAt: firstText(manifest.generatedAt, analysis.generatedAt),
      investment,
      personalFit,
      evidence,
      risks,
      nextActions: actions,
      summary: narrative(investment, personalFit, evidence, risks, actions, analysis)
    };
    if (Object.prototype.hasOwnProperty.call(result, 'score') || Object.prototype.hasOwnProperty.call(result, 'overallScore')) throw new Error('OPAQUE_AGGREGATE_SCORE_FORBIDDEN');
    return result;
  }

  function selectComparison(selection = [], propertyId, limit = 4) {
    const current = list(selection).map(text).filter(Boolean), id = text(propertyId);
    if (!id) return { selection: current, status: 'INVALID', message: '비교할 후보를 확인해 주세요.' };
    if (current.includes(id)) return { selection: current.filter(item => item !== id), status: 'REMOVED', message: null };
    if (current.length >= limit) return { selection: current, status: 'LIMIT_REACHED', message: '비교는 최대 4개입니다. 기존 후보를 하나 제거해 주세요.' };
    return { selection: [...current, id], status: 'ADDED', message: null };
  }

  function publicCompareSelection(selection = []) {
    return list(selection).slice(0, 4).map(text).filter(Boolean);
  }

  function relationView(membership) {
    if (!membership) return { state: 'none', label: '사업 연결 미확인', markerEligible: false, verified: false, limitation: '후보와 사업의 적용 관계가 연결되지 않았습니다.' };
    const verified = membership.reviewStatus === 'verified_scope';
    const official = membership.method === 'official_parcel_document_review';
    if (membership.reviewStatus === 'rejected') return { state: 'none', label: '사업 대상 아님', markerEligible: false, verified: true, limitation: firstText(membership.limitation, '검토 범위에서 사업 편입이 부정되었습니다.') };
    if (membership.relation === 'nearby') return { state: 'nearby_only', label: '주변 사업 참고', markerEligible: false, verified, limitation: firstText(membership.limitation, '인접 사업은 이 후보의 사업 단계가 아닙니다.') };
    if (membership.relation === 'direct_confirmed' && verified && official) return { state: 'direct_confirmed', label: '공식 조서 범위 내 직접 연결', markerEligible: true, verified: true, limitation: firstText(membership.limitation) };
    if (membership.relation === 'partial' && verified && official) return { state: 'partial_confirmed', label: '부분 범위 확인', markerEligible: false, verified: true, limitation: firstText(membership.limitation, '완료 범위와 잔여 사업 범위를 따로 확인해야 합니다.') };
    if (membership.method === 'address_only') return { state: 'address_only', label: '주소 일치만 확인', markerEligible: false, verified: false, limitation: firstText(membership.limitation, '주소 일치는 구역 편입을 입증하지 않습니다.') };
    if (membership.method === 'geometry_only') return { state: 'geometry_only', label: '지오메트리 중첩만 확인', markerEligible: false, verified: false, limitation: firstText(membership.limitation, '지도 중첩은 공식 편입 조서를 대신하지 않습니다.') };
    return { state: 'unresolved', label: '사업 관계 확인 필요', markerEligible: false, verified: false, limitation: firstText(membership.limitation, '공식 필지·범위 문서 대조가 필요합니다.') };
  }

  function normalizeStage(value) {
    const raw = text(value), normalizedText = raw.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!raw) return { code: 'unknown', label: '단계 미상', raw: null, conflict: false };
    let scan = normalizedText;
    const matches = [];
    if (scan.includes('준공(일부)') || scan.includes('부분준공') || scan.includes('partially_completed') || scan.includes('partial_completion')) {
      matches.push(STAGE_DEFINITIONS.find(row => row[0] === 'partially_completed'));
      scan = scan.replaceAll('준공(일부)', '').replaceAll('부분준공', '').replaceAll('partially_completed', '').replaceAll('partial_completion', '');
    }
    for (const definition of STAGE_DEFINITIONS) {
      if (definition[0] === 'partially_completed') continue;
      if (definition[2].some(alias => scan === alias || scan.includes(alias))) matches.push(definition);
    }
    const distinct = [...new Map(matches.map(row => [row[0], row])).values()];
    if (distinct.length > 1) return { code: 'UNRESOLVED_STAGE_CONFLICT', label: '상충 미해결', raw, conflict: true };
    const found = distinct[0];
    return found ? { code: found[0], label: found[1], raw, conflict: false } : { code: 'unknown', label: '단계 미상', raw, conflict: false };
  }

  function directlySupportingOfficialEvidence(event, claim, evidenceById, asOf) {
    if (!event || !claim || claim.state !== 'confirmed') return [];
    const claimSupport = new Set(list(claim.evidence).filter(row => row?.relation === 'supports').map(row => row.evidenceId));
    return list(event.evidenceIds).filter(id => claimSupport.has(id)).map(id => evidenceById.get(id)).filter(item => item && OFFICIAL_AUTHORITIES.has(item.authority)
      && dateAtOrBefore(item.publishedOn, asOf) && dateAtOrBefore(item.observedOn, asOf) && dateAtOrBefore(item.checkedAt, asOf) && dateAtOrBefore(item.effectiveFrom, asOf));
  }

  function dateAtOrBefore(value, asOf) {
    if (!value || !asOf) return true;
    return String(value).slice(0, 10) <= String(asOf).slice(0, 10);
  }

  function buildRedevelopmentTimeline({ property = {}, project = null, membership = null, events = [], plans = [], claims = [], evidence = [], asOf = null } = {}) {
    const relation = relationView(membership), claimById = new Map(list(claims).map(item => [item.id, item])), evidenceById = new Map(list(evidence).map(item => [item.id, item]));
    if (!project) return { propertyId: text(property.id), projectId: null, relation, currentMarker: null, currentStage: normalizeStage(null), events: [], completion: null, next: { conditions: [], officialTarget: null, forecastDate: null }, gateFailures: ['PROJECT_NOT_CONNECTED'] };
    const currentStage = normalizeStage(project.observedStage || project.stageLabel), stageClaim = claimById.get(project.stageClaimId);
    const candidates = list(events).filter(event => event.projectId === project.id && event.claimId === project.stageClaimId && event.status === 'valid' && dateAtOrBefore(event.occurredOn, asOf) && dateAtOrBefore(event.publishedOn, asOf) && dateAtOrBefore(event.effectiveFrom, asOf));
    candidates.sort((a, b) => text(a.effectiveFrom || a.occurredOn || a.publishedOn || a.recordedAt).localeCompare(text(b.effectiveFrom || b.occurredOn || b.publishedOn || b.recordedAt)) || text(a.id).localeCompare(text(b.id)));
    const currentEvent = candidates.at(-1) || null;
    const officialEvidence = directlySupportingOfficialEvidence(currentEvent, stageClaim, evidenceById, asOf);
    const gateFailures = [];
    if (!relation.markerEligible) gateFailures.push(relation.state === 'nearby_only' ? 'NEARBY_IS_NOT_MEMBERSHIP' : 'DIRECT_MEMBERSHIP_NOT_VERIFIED');
    if (currentStage.conflict) gateFailures.push('UNRESOLVED_STAGE_CONFLICT');
    if (currentStage.code === 'unknown') gateFailures.push('STAGE_UNKNOWN');
    if (!currentEvent) gateFailures.push('OFFICIAL_EVENT_REQUIRED');
    if (currentEvent && !(currentEvent.occurredOn || currentEvent.publishedOn || currentEvent.effectiveFrom)) gateFailures.push('EVENT_DATE_REQUIRED');
    if (!stageClaim || stageClaim.state !== 'confirmed') gateFailures.push('CONFIRMED_CLAIM_REQUIRED');
    if (!officialEvidence.length) gateFailures.push('DIRECT_OFFICIAL_EVIDENCE_REQUIRED');
    if (currentEvent && list(events).some(event => event.supersedes === currentEvent.id && event.id !== currentEvent.id)) gateFailures.push('CURRENT_EVENT_SUPERSEDED');
    const statedStages = [currentStage, normalizeStage(stageClaim?.value), normalizeStage(currentEvent?.eventType || currentEvent?.label)].filter(stage => stage.code !== 'unknown');
    if (new Set(statedStages.map(stage => stage.code)).size > 1) gateFailures.push('UNRESOLVED_STAGE_CONFLICT');
    const currentMarker = gateFailures.length ? null : { eventId: currentEvent.id, stage: currentStage.code, label: currentStage.label, claimId: stageClaim.id, evidenceIds: officialEvidence.map(item => item.id) };
    const timelineEvents = list(events).filter(event => event.projectId === project.id).map(event => {
      const claim = claimById.get(event.claimId), sources = list(event.evidenceIds).map(id => evidenceById.get(id)).filter(Boolean);
      return {
        id: text(event.id), stage: normalizeStage(event.eventType || event.label), label: firstText(event.label, normalizeStage(event.eventType).label),
        dates: { occurredOn: event.occurredOn || null, publishedOn: event.publishedOn || null, effectiveFrom: event.effectiveFrom || null, recordedAt: event.recordedAt || null },
        status: text(event.status || 'draft'), claimId: text(event.claimId) || null, claimState: text(claim?.state || 'unverified'), evidenceIds: sources.map(item => item.id),
        sources: sources.map(item => ({ id: item.id, authority: item.authority, publishedOn: item.publishedOn || null, title: item.title || null })),
        scope: firstText(claim?.limitation, membership?.limitation), relationToPrevious: event.supersedes ? { kind: 'supersedes', eventId: event.supersedes } : null,
        isCurrent: currentMarker?.eventId === event.id
      };
    }).sort((a, b) => text(a.dates.effectiveFrom || a.dates.occurredOn || a.dates.publishedOn || a.dates.recordedAt).localeCompare(text(b.dates.effectiveFrom || b.dates.occurredOn || b.dates.publishedOn || b.dates.recordedAt)) || a.id.localeCompare(b.id));
    const completed = currentMarker?.stage === 'completed', partial = currentMarker?.stage === 'partially_completed';
    const completion = completed ? { state: 'completed', completedScope: firstText(project.completedScope, '완료 범위는 공식 문서에서 확인해야 합니다.'), remainingScope: '잔여 사업 없음을 별도 확인해야 합니다.', futureUpsideAllowed: false }
      : partial ? { state: 'partial', completedScope: firstText(project.completedScope, '완료 범위 확인 필요'), remainingScope: firstText(project.remainingScope, '잔여 사업 범위 확인 필요'), futureUpsideAllowed: false } : null;
    let officialTarget = null;
    if (!completed && !partial) for (const plan of list(plans)) {
      const targetClaim = claimById.get(plan.completionTargetClaimId), supporting = targetClaim && list(targetClaim.evidence).filter(row => row.relation === 'supports').map(row => evidenceById.get(row.evidenceId)).filter(item => item && OFFICIAL_AUTHORITIES.has(item.authority));
      if (targetClaim?.state === 'confirmed' && supporting.length) { officialTarget = { value: targetClaim.value, unit: targetClaim.unit, claimId: targetClaim.id, evidenceIds: supporting.map(item => item.id), label: '공식 목표일 · 예측일 아님' }; break; }
    }
    return {
      propertyId: text(property.id), projectId: text(project.id), relation, currentMarker, currentStage,
      events: timelineEvents, completion,
      next: { conditions: list(project.nextConditions).map(item => ({ text: text(item.text), status: text(item.status || 'unknown'), claimIds: list(item.claimIds).filter(Boolean) })), officialTarget, forecastDate: null },
      gateFailures: [...new Set(gateFailures)]
    };
  }

  function krw(value) {
    if (value === null || value === undefined || value === '') return null;
    try { return Number(BigInt(String(value))).toLocaleString('ko-KR') + '원'; } catch (_) { return null; }
  }

  function cell(value, state = 'available', limitation = null, trace = {}) {
    return { value: value === null || value === undefined || value === '' ? '비교 보류' : String(value), state, limitation: firstText(limitation), trace: { claimIds: list(trace.claimIds).filter(Boolean), evidenceIds: list(trace.evidenceIds).filter(Boolean), calculationIds: list(trace.calculationIds).filter(Boolean) } };
  }

  function compareRow(input, index) {
    const property = input.property || {}, analysis = input.analysis || {}, context = input.context || {}, view = buildCandidateDecision({ property, analysis, context, manifest: input.manifest || {} });
    const fit = analysis.personalFit || analysis.personalization || {}, scenario = list(analysis.scenarios)[0] || {}, price = property.currentPrice || {}, pa = analysis.priceAnalysis || {};
    const directProject = list(context.membershipLinks).map(link => ({ link, relation: relationView(link) })).find(item => item.relation.state === 'direct_confirmed') || list(context.membershipLinks).map(link => ({ link, relation: relationView(link) }))[0];
    const relation = directProject?.relation || relationView(null), project = list(context.projects).find(item => item.id === directProject?.link?.projectId);
    const financeHold = list(fit.verification_holds).find(item => /finance|afford|cash|price|monthly/i.test(`${item.code || ''} ${item.dimension || ''}`));
    const commuteDimension = fit.dimensions?.commute || {};
    const initial = scenario.initialEquity || {};
    const priceComparable = pa.status === 'available' && Number(pa.sampleCount) >= 5 && (pa.medianKrw || pa.medianPriceKrw);
    const transactionCount = Number.isFinite(Number(pa.sampleCount)) ? Number(pa.sampleCount) : list(context.transactions).filter(item => item.status === 'active').length;
    const legacy = context.legacy || context, turnoverItem = list(legacy?.investment?.categories).flatMap(category => list(category.items)).find(item => item.key === 'turnover' && item.value !== null && item.value !== undefined);
    const relativeGap = priceComparable && price.amountKrw ? (Number(price.amountKrw) / Number(priceComparable) - 1) * 100 : null;
    return {
      propertyId: text(property.id), name: firstText(property.name, property.id, `후보 ${index + 1}`), investmentOrder: Number.isInteger(input.investmentOrder) ? input.investmentOrder : index,
      investmentStatus: view.investment.status, fitStatus: view.personalFit.status, fitRankingEligible: view.personalFit.rankingEligible, evidenceStatus: view.evidence.status,
      hasCriticalHold: list(analysis.risks).some(item => item.severity === 'critical') || list(fit.verification_holds).some(item => item.critical),
      verificationReasons: [...(view.evidence.status === 'LOW' || view.evidence.status === 'UNKNOWN' ? ['EVIDENCE_LOW_OR_UNKNOWN'] : []), ...(financeHold ? ['FINANCE_HOLD'] : []), ...(commuteDimension.status === 'PROXY_ONLY' || commuteDimension.inputQuality === 'PROXY_ONLY' ? ['ROUTE_HOLD'] : []), ...(['unresolved', 'address_only', 'geometry_only'].includes(relation.state) ? ['PROJECT_RELATION_UNRESOLVED'] : [])],
      cells: {
        investment: cell(view.investment.score === null ? null : `${view.investment.score.toFixed(1)}점 · ${view.investment.status}`, view.investment.blocked ? 'blocked' : 'available'),
        personalFit: cell(!view.personalFit.active || view.personalFit.score === null ? null : `${view.personalFit.score.toFixed(1)}점 · ${view.personalFit.status}`, !view.personalFit.active ? 'profile_required' : view.personalFit.rankingEligible ? 'available' : 'verification_required', !view.personalFit.active ? '프로필 미입력' : view.personalFit.rankingEligible ? null : '순위 자격 확인 필요'),
        evidence: cell(view.evidence.score === null ? view.evidence.status : `${view.evidence.score.toFixed(1)}% · ${view.evidence.status}`, view.evidence.status === 'LOW' || view.evidence.status === 'UNKNOWN' ? 'verification_required' : 'available', view.evidence.limitations[0]),
        price: cell(krw(price.amountKrw), price.amountKrw ? 'available' : 'missing', [price.kind, price.asOf].filter(Boolean).join(' · ') || '가격 종류·기준일 확인 필요', { claimIds: price.claimId ? [price.claimId] : [] }),
        relativeValue: cell(priceComparable ? `비교 중위 대비 ${relativeGap >= 0 ? '+' : ''}${relativeGap.toFixed(1)}%` : null, priceComparable ? 'available' : 'incomparable', priceComparable ? `비교 중위값 ${krw(priceComparable)} · 층·상태 차이 자동 보정 없음` : '유효한 동종 표본 5건 이상이 필요합니다.'),
        transactions: cell(transactionCount || turnoverItem ? `${transactionCount}건${turnoverItem ? ` · 회전율 ${Number(turnoverItem.value).toFixed(1)}%` : ''}` : null, transactionCount || turnoverItem ? 'available' : 'missing', '거래 건수·회전율은 매도 기간이나 미래 유동성을 보장하지 않습니다.'),
        redevelopment: cell(project ? `${project.name} · ${relation.label}` : null, relation.state, relation.limitation, { evidenceIds: list(directProject?.link?.evidenceIds) }),
        initialCash: cell(krw(initial.value), initial.value !== null && initial.value !== undefined && initial.status !== 'missing' ? initial.status || 'available' : 'incomparable', initial.missingInputs?.length ? `필요 입력: ${initial.missingInputs.join(', ')}` : '같은 시나리오 조건이 아니면 비교를 보류합니다.', { calculationIds: initial.calculationId ? [initial.calculationId] : [] }),
        finance: cell(financeHold ? 'NEEDS_FINANCE_CHECK' : fit.dimensions?.affordability?.inputQuality || null, financeHold ? 'verification_required' : fit.dimensions?.affordability?.inputQuality ? 'available' : 'missing', financeHold?.reason || '금융기관 승인을 뜻하지 않습니다.'),
        commute: cell(commuteDimension.status || commuteDimension.inputQuality || null, commuteDimension.score === null || commuteDimension.status === 'UNKNOWN' ? 'missing' : commuteDimension.status === 'PROXY_ONLY' || commuteDimension.inputQuality === 'PROXY_ONLY' ? 'proxy_only' : 'available', '실제 route 관측 없이 정확한 이동시간을 표시하지 않습니다.'),
        risk: cell(view.risks[0]?.text || null, view.risks[0]?.severity || 'verification_required', null, { claimIds: view.risks[0]?.claimIds || [] }),
        nextAction: cell(view.nextActions[0]?.label || null, 'action', view.nextActions[0]?.reason)
      }
    };
  }

  function buildCompareDecision({ rows = [] } = {}) {
    if (list(rows).length > 4) throw new Error('COMPARE_LIMIT_EXCEEDED');
    const candidates = list(rows).map(compareRow);
    const eligibleInvestment = candidates.filter(row => !BLOCKED_INVESTMENT.has(row.investmentStatus));
    const investmentBest = eligibleInvestment.sort((a, b) => a.investmentOrder - b.investmentOrder || a.propertyId.localeCompare(b.propertyId))[0] || null;
    const fitBest = candidates.filter(row => row.fitRankingEligible && row.cells.personalFit.value !== '비교 보류').sort((a, b) => Number(b.cells.personalFit.value.split('점')[0]) - Number(a.cells.personalFit.value.split('점')[0]) || a.investmentOrder - b.investmentOrder)[0] || null;
    const balanced = candidates.filter(row => ['top', 'attractive'].includes(row.investmentStatus) && FIT_POSITIVE.has(row.fitStatus) && !['LOW', 'UNKNOWN'].includes(row.evidenceStatus) && !row.hasCriticalHold).sort((a, b) => a.investmentOrder - b.investmentOrder || a.propertyId.localeCompare(b.propertyId))[0] || null;
    const needsVerification = candidates.filter(row => row.verificationReasons.length).map(row => ({ propertyId: row.propertyId, reasons: [...new Set(row.verificationReasons)] }));
    const result = {
      schemaVersion: 'decision-compare/1.0', candidates,
      summary: { investmentBest: investmentBest?.propertyId || null, fitBest: fitBest?.propertyId || null, balanced: balanced?.propertyId || null, needsVerification }
    };
    return result;
  }

  return { VERSION, INVESTMENT_POLICY, PERSONAL_FIT_POLICY, buildCandidateDecision, selectComparison, publicCompareSelection, relationView, normalizeStage, buildRedevelopmentTimeline, buildCompareDecision };
});
