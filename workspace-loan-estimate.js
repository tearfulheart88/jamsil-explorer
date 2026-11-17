/* loan-estimate-1.0: 내 조건(연소득·기존 부채·현금)으로 후보마다 대출 가능액·월 원리금·필요 현금을 어림한다.
 * 은행 심사 결과가 아니다. 정책 값은 references/policy_params.json 과 같아야 한다(workspace-loan-estimate.test.cjs 가 확인).
 * 표시 전용이다 — 투자 순서·개인 적합도(Personal Fit) 판정에는 넣지 않는다(PERSONAL_FIT_DESIGN §8: 금융 추정은 선별용 표시값).
 * 옛 탐색기(advisor.js)와 같은 가정(무주택 1주택 취득세·중개보수 상한·기타 200만 원·스트레스 DSR)을 쓴다. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkspaceLoanEstimate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MODEL_VERSION = 'loan-estimate-1.1';
  // references/policy_params.json (as_of 2026-09-06) 에서 옮긴 값. 바꾸면 테스트가 어긋남을 알린다.
  const POLICY = Object.freeze({
    asOf: '2026-09-06',
    regulatedGyeonggi: Object.freeze(['과천시', '광명시', '성남 분당구', '성남 수정구', '성남 중원구', '수원 영통구', '수원 장안구', '수원 팔달구', '안양 동안구', '용인 수지구', '의왕시', '하남시', '화성 동탄구', '용인 기흥구', '구리시']),
    ltvRegulated: 0.40,
    ltvNonRegulatedSudogwon: 0.70,
    ltvFirstTimeSudogwon: 0.70,
    loanCaps: Object.freeze([[1500000000, 600000000], [2500000000, 400000000], [null, 200000000]]),
    dsrBank: 0.40,
    stressRate: 0.03,
    stressRateOther: 0.0075,
    stressFrom: '2026-07-01',
    stressUntil: '2026-12-31',
    ltvFirstTimeOther: 0.80,
    firstTimeLoanCapOther: 600000000,
    localEducationShare: 0.10,
    ruralTaxRateOver85: 0.002,
    firstTimeExemptionCapKrw: 2000000,
    firstTimeExemptionPriceCapKrw: 1200000000,
    firstTimeExemptionUntil: '2028-12-31',
    brokerageTiers: Object.freeze([[50000000, 0.006, 250000], [200000000, 0.005, 800000], [900000000, 0.004, null], [1200000000, 0.005, null]]),
    brokerageVat: 0.10,
    miscKrw: 2000000
  });
  // 한국은행 ECOS 121Y006 예금은행 가중평균금리(신규취급액 기준), 2026-09-18 조회.
  const RATES = Object.freeze({ month: '2026-07', mortgage: 0.0448, mortgageFixed: 0.0476, mortgageVariable: 0.0435, credit: 0.0597 });
  const SOURCES = Object.freeze([
    { label: '은행연합회 2026-06-30 — 하반기 스트레스 DSR 운영방안 (수도권·규제지역 3%, 지방 비규제 변동형 0.75%p)', url: 'https://www.kif.re.kr/kif2/publication/maildetview.aspx?controlno=364749' },
    { label: '국토교통부 — 규제지역 지정 현황 (2026-09-20 확인)', url: 'https://rt.molit.go.kr/pt/gis/gis.do' },
    { label: '금융위원회 — 생애최초 LTV 80%·최대 6억원 (수도권·규제지역은 후속 강화 규정 적용)', url: 'https://www.fsc.go.kr/po010106/78134' },
    { label: '금융위원회 2026-06-30 — 동탄구·기흥구·구리시 규제지역 추가 (7월 1일 시행)', url: 'https://www.fsc.go.kr/no010101/87222' },
    { label: '금융위원회 2026-09-09 — 생애최초 요건 예외는 금융회사 심사 필요', url: 'https://www.fsc.go.kr/no010101/87675' },
    { label: '금융위원회 2025-06-27 — 생애최초 LTV 70%, 주택구입 6개월 전입', url: 'https://www.fsc.go.kr/no010101/84824' },
    { label: '금융위원회 부동산 시장 안정을 위한 금융 종합대책 (2026-08-13) — LTV·DSR·주택가격별 주담대 한도', url: 'https://fsc.go.kr/no040000?cnId=161&curPage=10&pastPage=385&srchKey=&srchText=' },
    { label: '국토교통부·금융위원회 주택시장 안정화 대책 (2025-10-15) — 규제지역, 스트레스 금리 3%p', url: 'https://www.korea.kr/news/policyNewsView.do?newsId=156722073' },
    { label: '한국은행 ECOS 예금은행 가중평균금리 (신규취급액, 2026년 7월) — 주택담보대출 4.48%(고정형 4.76%·변동형 4.35%), 일반신용대출 5.97%', url: 'https://ecos.bok.or.kr/' },
    { label: '서울시 부동산정보광장 중개보수 요율표', url: 'https://land.seoul.go.kr/land/broker/brokerageCommission.do' },
    { label: '서울시 ETAX 취득세 계산 (주택 유상취득 1~3%)', url: 'https://etax.seoul.go.kr/taxpay/AcqutaxCalcAction.view?gl_gubun=g&gnb_id=0610&lnb_id=0610' },
    { label: '지방세특례제한법 제36조의3 (생애최초 주택 취득세 감면)', url: 'https://www.law.go.kr/lsLinkProc.do?lsNm=%EC%A7%80%EB%B0%A9%EC%84%B8%ED%8A%B9%EB%A1%80%EC%A0%9C%ED%95%9C%EB%B2%95&joNo=003603001&mode=10' }
  ]);
  const YEARS = Object.freeze([10, 15, 20, 25, 30]);
  const DEPOSIT_RATES = Object.freeze([0.05, 0.1, 0.2]);
  const DEFAULTS = Object.freeze({ firstTimeBuyer: null, annualRate: null, years: 30, depositRate: 0.1 });

  const amount = v => {
    if (v === null || v === undefined || v === '') return null;
    const s = typeof v === 'number' ? (Number.isSafeInteger(v) ? String(v) : '') : String(v);
    return /^(0|[1-9]\d*)$/.test(s) && Number(s) <= Number.MAX_SAFE_INTEGER ? Number(s) : null;
  };
  const man = n => Math.round(n / 10000) * 10000;
  // 한국 날짜. toISOString() 은 UTC 라 자정~오전 9시에는 하루 전 날짜가 되어 정책 시작·종료일이 하루 밀린다.
  const todayKst = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);

  function normalizeSettings(s) {
    const x = s && typeof s === 'object' ? s : {}, out = { ...DEFAULTS };
    if (x.firstTimeBuyer === true || x.firstTimeBuyer === false) out.firstTimeBuyer = x.firstTimeBuyer;
    if (typeof x.annualRate === 'number' && Number.isFinite(x.annualRate) && x.annualRate > 0 && x.annualRate <= 0.2) out.annualRate = x.annualRate;
    if (YEARS.includes(x.years)) out.years = x.years;
    if (DEPOSIT_RATES.includes(x.depositRate)) out.depositRate = x.depositRate;
    if (['none', 'owned'].includes(x.housingStatus)) out.housingStatus = x.housingStatus;
    return out;
  }
  const OTHER_PROVINCES = Object.freeze({부산:'부산',부산광역시:'부산',대구:'대구',대구광역시:'대구',광주:'광주',광주광역시:'광주',대전:'대전',대전광역시:'대전',울산:'울산',울산광역시:'울산',세종:'세종',세종특별자치시:'세종',강원:'강원',강원도:'강원',강원특별자치도:'강원',충북:'충북',충청북도:'충북',충남:'충남',충청남도:'충남',전북:'전북',전라북도:'전북',전북특별자치도:'전북',전남:'전남',전라남도:'전남',경북:'경북',경상북도:'경북',경남:'경남',경상남도:'경남',제주:'제주',제주도:'제주',제주특별자치도:'제주'});
  function otherProvince(code) { return OTHER_PROVINCES[String(code || '').trim().split(/\s+/)[0]] || null; }
  function geography(regionCode) {
    const code=String(regionCode || '').trim(), province=otherProvince(code);
    if(province)return {capitalArea:false,province};
    if(/^(서울(?:특별시)?(?:\s|$)|11\d{3}$)/.test(code))return {capitalArea:true,province:'서울'};
    if(/^인천(?:광역시)?(?:\s|$)/.test(code))return {capitalArea:true,province:'인천'};
    if(/^경기(?:도)?(?:\s|$)/.test(code)||regulation(code).regulated!==null||/^(화성|용인|수원|안양)시?$/.test(code))return {capitalArea:true,province:'경기'};
    return {capitalArea:null,province:null};
  }
  // 변동형 신규 은행 주담대. 고정/혼합/주기형은 상품별 적용비율이 달라 별도 확인.
  // 적용기간이 지나면 새 기준을 모르므로 판정을 막는다(expired). 이유가 '지역 확인'과 섞이지 않게 따로 알린다.
  function stressPolicy(regionCode, asOf = todayKst()) {
    const g=geography(regionCode), r=regulation(regionCode);
    const expired=asOf>POLICY.stressUntil, current=asOf>=POLICY.stressFrom&&!expired;
    const local=g.capitalArea===false&&r.regulated===false;
    const known=current&&(g.capitalArea===true||r.regulated===true||local);
    return {...g,known,expired,asOf,from:POLICY.stressFrom,until:POLICY.stressUntil,addon:known&&local?POLICY.stressRateOther:POLICY.stressRate,
      label:g.capitalArea===true?'수도권':local?'수도권 밖 비규제지역':r.regulated===true?'규제지역':'지역 확인 필요'};
  }
  function regulation(regionCode) {
    const code = String(regionCode || '').trim().replace(/^경기도?\s+/, '').replace(/^서울특별시\s+/, '서울 ').replace(/^(성남|수원|안양|용인|화성)시\s+/, '$1 ');
    if (/^서울\s/.test(code) || /^11\d{3}$/.test(code)) return { regulated: true, label: '규제지역(서울 전역)' };
    if (POLICY.regulatedGyeonggi.includes(code)) return { regulated: true, label: '규제지역(경기)' };
    if (otherProvince(code)) return { regulated: false, label: '수도권 밖 비규제지역 (2026-09-20 지정 현황)' };
    if (['화성시', '화성', '용인시', '용인', '수원시', '수원', '안양시', '안양'].includes(code)) return { regulated: null, label: '구 단위 지역 확인 필요' };
    // 후보 자료의 지역 이름은 수도권뿐이다(예: '구리시', '부천 원미구'). 수도권 밖 광역 이름이면 규칙을 모른다고 본다.
    if (/^(인천\s|인천광역시\s|가평군$|군포시$|고양\s|광주시$|김포시$|남양주시$|동두천시$|부천\s|수원 권선구$|시흥시$|안산\s|안성시$|안양 만안구$|양주시$|양평군$|여주시$|연천군$|오산시$|용인 처인구$|의정부시$|이천시$|파주시$|평택시$|포천시$|화성 (만세구|효행구|병점구)$)/.test(code)) return { regulated: false, label: '수도권 비규제지역' };
    return { regulated: null, label: '규제지역 여부 미확인' };
  }
  function annuityFactor(annualRate, years) {
    const n = years * 12, r = annualRate / 12;
    return r === 0 ? 1 / n : r / (1 - Math.pow(1 + r, -n));
  }
  function monthlyPayment(principal, annualRate, years) {
    return principal > 0 ? Math.ceil(principal * annuityFactor(annualRate, years)) : 0;
  }
  // 첫 달 이자 × 12가 아니라, 매월 줄어드는 잔액으로 첫 12회 납입을 합산한다.
  function firstYearRepayment(principal, annualRate, years) {
    const payment = monthlyPayment(principal, annualRate, years);
    let balance = principal, interestKrw = 0, principalKrw = 0;
    const months = Math.min(12, Math.round(years * 12));
    for (let month = 0; month < months && balance > 0; month++) {
      const interest = Math.round(balance * annualRate / 12);
      const repaid = Math.min(balance, Math.max(0, payment - interest));
      interestKrw += interest;
      principalKrw += repaid;
      balance -= repaid;
    }
    return { months, paymentKrw: principalKrw + interestKrw, principalKrw, interestKrw, remainingKrw: balance };
  }
  function loanCap(price) {
    for (const [max, cap] of POLICY.loanCaps) if (max === null || price <= max) return cap;
    return 0;
  }
  function brokerage(price) {
    for (const [max, rate, cap] of POLICY.brokerageTiers) if (price < max) return Math.floor(cap === null ? price * rate : Math.min(price * rate, cap));
    return null;
  }
  function acquisitionTax(price, areaSqm) {
    // 1주택 유상취득: 6억 이하 1%, 6~9억 (가격×2/3억−3)%, 9억 초과 3%. 지방교육세는 취득세의 10%, 전용 85㎡ 초과면 농특세 0.2%.
    const ratePct = price <= 6e8 ? 1 : price <= 9e8 ? price / 1e8 * 2 / 3 - 3 : 3;
    const acq = Math.floor(price * ratePct / 100), edu = Math.floor(acq * POLICY.localEducationShare);
    const areaKnown = typeof areaSqm === 'number' && Number.isFinite(areaSqm) && areaSqm > 0;
    const rural = areaKnown && areaSqm > 85 ? Math.floor(price * POLICY.ruralTaxRateOver85) : 0;
    return { ratePct, acqKrw: acq, eduKrw: edu, ruralKrw: rural, totalKrw: acq + edu + rural, areaKnown };
  }
  function existingDebtService(profile) {
    const debts = Array.isArray(profile?.debts) ? profile.debts : [], notes = [];
    let annual = 0, monthly = 0;
    for (const d of debts) {
      if (!d || typeof d !== 'object') continue;
      const rateKnown = typeof d.annualNominalRate === 'number' && Number.isFinite(d.annualNominalRate);
      const rate = rateKnown ? d.annualNominalRate : RATES.credit;
      if (!rateKnown) notes.push('금리를 적지 않은 부채는 한국은행 일반신용대출 평균 5.97%로 계산했습니다.');
      const reg = amount(d.regulatoryAnnualDebtServiceKrw), limit = amount(d.creditLimitKrw), bal = amount(d.balanceKrw), pay = amount(d.monthlyPaymentKrw);
      if (reg !== null) annual += reg;
      else if (limit) { annual += limit / 5 + limit * rate; notes.push('마이너스통장은 쓴 돈이 아니라 한도 전액을 5년에 나눠 갚는다고 보고 DSR에 넣었습니다.'); }
      else if (pay !== null) annual += pay * 12;
      else if (bal) { annual += bal / 5 + bal * rate; notes.push('월 상환액을 적지 않은 대출은 5년 분할상환으로 보고 DSR에 넣었습니다.'); }
      monthly += pay !== null ? pay : (bal || 0) * rate / 12;
    }
    return { annualKrw: Math.round(annual), monthlyKrw: Math.round(monthly), known: debts.length > 0 || profile?.noDebtConfirmed === true, count: debts.length, notes: [...new Set(notes)] };
  }

  function estimate(property, profile, settings) {
    const cfg = normalizeSettings(settings), price = amount(property?.currentPrice?.amountKrw);
    if (price === null || price <= 0) return { ok: false, modelVersion: MODEL_VERSION, reason: '가격 자료가 없어 대출·필요 현금을 계산하지 않았습니다.' };
    const region = regulation(property.regionCode), first = cfg.firstTimeBuyer;
    const stress = stressPolicy(property.regionCode), local = stress.capitalArea === false && region.regulated === false;
    const rate = cfg.annualRate ?? RATES.mortgage, years = cfg.years, stressRate = rate + stress.addon;
    const ltv = first === true ? (local ? POLICY.ltvFirstTimeOther : POLICY.ltvFirstTimeSudogwon) : region.regulated === false ? POLICY.ltvNonRegulatedSudogwon : POLICY.ltvRegulated;
    const ltvKrw = Math.floor(price * ltv), capKrw = local ? (first === true ? POLICY.firstTimeLoanCapOther : null) : loanCap(price);
    const income = amount(profile?.annualGrossIncomeKrw), debt = existingDebtService(profile);
    let dsrKrw = null;
    if (income !== null) {
      const room = income * POLICY.dsrBank - debt.annualKrw;
      dsrKrw = room <= 0 ? 0 : Math.floor(room / (12 * annuityFactor(stressRate, years)));
    }
    let loan = Math.min(ltvKrw, capKrw ?? Infinity), binding = ltvKrw <= (capKrw ?? Infinity) ? 'ltv' : 'cap';
    if (dsrKrw !== null && dsrKrw < loan) { loan = dsrKrw; binding = 'dsr'; }
    loan = Math.floor(loan / 10000) * 10000;

    const payment = monthlyPayment(loan, rate, years), firstInterest = Math.round(loan * rate / 12);
    const stressPayment = monthlyPayment(loan, stressRate, years);
    const dsrRatio = income ? (stressPayment * 12 + debt.annualKrw) / income : null;
    const tax = acquisitionTax(price, property?.area?.sqm), fee = brokerage(price);
    const feeVat = fee === null ? null : Math.ceil(fee * POLICY.brokerageVat);
    const costsKrw = tax.totalKrw + (fee || 0) + (feeVat || 0) + POLICY.miscKrw;
    const depositKrw = man(price * cfg.depositRate), balanceKrw = Math.max(0, price - depositKrw - loan);
    const cashNeededKrw = price - loan + costsKrw;
    const cash = amount(profile?.cashAvailableKrw), reserve = amount(profile?.reserveKrw);
    const myCashKrw = cash === null ? null : cash - (reserve || 0);
    const cap = amount(profile?.maxMonthlyHousingPaymentKrw);
    const exemption = first === true && price <= POLICY.firstTimeExemptionPriceCapKrw && stress.asOf <= POLICY.firstTimeExemptionUntil ? Math.min(POLICY.firstTimeExemptionCapKrw, tax.acqKrw) : 0;

    const notes = [];
    notes.push(`${stress.label} · 변동형 스트레스 가산 +${(stress.addon*100).toFixed(2)}%p. 은행 DSR 한도는 지역과 관계없이 40%입니다. 실제 원리금은 가산 전 약정금리로 계산합니다.`);
    if (stress.expired) notes.push(`스트레스 DSR 정책표 적용기간(${POLICY.stressFrom}~${POLICY.stressUntil})이 지났습니다. 새 기준으로 정책표를 갱신하기 전까지 +3%p를 보수적 참고값으로 적용하고 가능한 매물로 분류하지 않습니다.`);
    else if (!stress.known) notes.push('지역 또는 스트레스 DSR 적용기간을 확인해야 합니다. +3%p를 보수적 참고값으로 적용했으며 가능한 매물로 분류하지 않습니다.');
    if (income === null) notes.push('연소득을 입력하지 않아 DSR(소득 대비 상환액) 한도를 반영하지 못했습니다. 소득이 낮으면 실제 대출은 더 적습니다.');
    if (income !== null && !debt.known) notes.push('기존 부채를 입력하지 않아 없는 것으로 보고 DSR을 계산했습니다. 부채가 있으면 한도가 줄어듭니다.');
    notes.push(...debt.notes);
    if (first === null && region.regulated !== false) notes.push('생애최초 여부를 고르지 않아 일반 무주택 기준 LTV 40%로 계산했습니다. 생애최초면 70%까지 늘어납니다(6개월 안 전입 조건).');
    notes.push('수도권·규제지역의 신규 주택구입 주담대는 6개월 이내 전입 가정입니다. 생애최초는 은행의 자격 심사를 받아야 하며, 과거 소유 이력의 예외를 자동 인정하지 않습니다.');
    if (region.regulated === null) notes.push('규제지역 여부를 확인하지 못해 규제지역 기준(LTV 40%)으로 보수적으로 계산했습니다.');
    if (fee === null) notes.push('12억 원 이상은 중개보수 요율표 범위 밖이라 중개보수를 넣지 못했습니다.');
    if (!tax.areaKnown) notes.push('전용면적을 몰라 85㎡ 초과 농어촌특별세를 넣지 못했습니다.');

    const debts = Array.isArray(profile?.debts) ? profile.debts : [];
    const balances = debts.map(d => amount(d?.balanceKrw));
    const payments = debts.map(d => amount(d?.monthlyPaymentKrw));
    const debtEntered = debts.length > 0 || profile?.noDebtConfirmed === true;
    const existingBalanceKrw = debtEntered && balances.every(v => v !== null) ? balances.reduce((a,b) => a+b,0) : null;
    const existingPaymentKrw = debtEntered && payments.every(v => v !== null) ? payments.reduce((a,b) => a+b,0) : null;
    const result = {
      ok: true, modelVersion: MODEL_VERSION, priceKrw: price, priceKind: property?.currentPrice?.kind || null, priceAsOf: property?.currentPrice?.asOf || null,
      region, stress, firstTimeBuyer: first, ltv,
      loan: { krw: loan, ltvKrw, capKrw, dsrKrw, binding },
      rate: { annual: rate, stressAnnual: stressRate, stressAddon: stress.addon, source: cfg.annualRate === null ? 'bok' : 'user', bokMonth: RATES.month },
      years,
      annual: firstYearRepayment(loan, rate, years),
      householdDebt: { existingBalanceKrw, totalBalanceKrw: existingBalanceKrw === null ? null : existingBalanceKrw + loan, existingPaymentKrw, totalMonthlyKrw: existingPaymentKrw === null ? null : existingPaymentKrw + payment, annualizedKrw: existingPaymentKrw === null ? null : (existingPaymentKrw + payment) * 12 },
      monthly: { paymentKrw: payment, firstInterestKrw: firstInterest, firstPrincipalKrw: Math.max(0, payment - firstInterest), totalInterestKrw: Math.max(0, payment * years * 12 - loan), stressPaymentKrw: stressPayment, existingDebtKrw: debt.known ? debt.monthlyKrw : null, capKrw: cap, fitsCap: cap === null ? null : payment <= cap },
      dsr: { ratio: dsrRatio, limit: POLICY.dsrBank, existingAnnualKrw: debt.annualKrw, incomeKnown: income !== null, debtKnown: debt.known },
      costs: { tax, brokerageKrw: fee, brokerageVatKrw: feeVat, miscKrw: POLICY.miscKrw, totalKrw: costsKrw, firstTimeExemptionKrw: exemption },
      cash: { depositRate: cfg.depositRate, depositKrw, balanceKrw, neededKrw: cashNeededKrw, myCashKrw, reserveKnown: reserve !== null, gapKrw: myCashKrw === null ? null : myCashKrw - cashNeededKrw },
      notes
    };
    result.screen = screenPurchase(result, profile, cfg);
    return result;
  }

  // 매수 선별용 계산. 신용·실제 담보가치·은행승인과 현재 판매 여부를 확정하지 않는다.
  function screenPurchase(r, profile, settings) {
    if (!r?.ok) return { status: 'needs_check', label: '확인 필요', reasons: ['가격 자료 필요'] };
    const cfg = normalizeSettings(settings), missing = [], failures = [];
    const income = amount(profile?.annualGrossIncomeKrw);
    const debts = Array.isArray(profile?.debts) ? profile.debts : [];
    const debtComplete = debts.length ? profile?.noDebtConfirmed !== true && debts.every(d => {
      if (!d || amount(d.balanceKrw) === null) return false;
      if (amount(d.creditLimitKrw) !== null && amount(d.creditLimitKrw) < amount(d.balanceKrw)) return false;
      if (amount(d.regulatoryAnnualDebtServiceKrw) !== null) return true;
      if (amount(d.creditLimitKrw) > 0) return typeof d.annualNominalRate === 'number' && Number.isFinite(d.annualNominalRate) && d.annualNominalRate >= 0 && d.annualNominalRate <= 1;
      return amount(d.balanceKrw) === 0;
    }) : profile?.noDebtConfirmed === true;
    if (cfg.firstTimeBuyer === null) missing.push('생애최초 또는 일반을 선택하세요');
    if (cfg.housingStatus !== 'none') missing.push(cfg.housingStatus === 'owned' ? '주택 보유자는 처분 조건·은행 규칙 별도 확인' : '현재 무주택 여부를 선택하세요');
    if (income === null) missing.push('연간 세전 소득 입력 필요');
    if (!debtComplete) missing.push('기존 부채의 사용액·DSR 산입액 확인 필요 (마통은 한도·금리, 부채 없으면 없음 선택)');
    if (r.cash.myCashKrw === null) missing.push('사용 가능한 현금 입력 필요');
    if (!r.cash.reserveKnown) missing.push('남길 예비비 입력 필요 (없으면 0)');
    if (r.region.regulated === null) missing.push('규제지역 여부 확인 필요');
    if (r.stress.expired) missing.push(`대출 정책표 적용기간(~${POLICY.stressUntil}) 만료 — 정책표 갱신 필요`);
    else if (!r.stress.known) missing.push('지역별 스트레스 DSR 기준 또는 적용기간 확인 필요');
    if (r.costs.brokerageKrw === null || !r.costs.tax.areaKnown) missing.push('취득 부대비용 일부 미확인');
    const requiredLoanKrw = r.cash.myCashKrw === null ? null : Math.max(0, r.priceKrw + r.costs.totalKrw - r.cash.myCashKrw);
    const requiredMonthlyKrw = requiredLoanKrw === null ? null : monthlyPayment(requiredLoanKrw, r.rate.annual, r.years);
    const requiredAnnualForDsr = requiredLoanKrw === null ? null : monthlyPayment(requiredLoanKrw, r.rate.stressAnnual, r.years) * 12 + r.dsr.existingAnnualKrw;
    const dsrKnown = income !== null && debtComplete;
    const requiredDsr = !dsrKnown || requiredAnnualForDsr === null || income === 0 ? null : requiredAnnualForDsr / income;
    const dsrPass = requiredLoanKrw === 0 ? true : !dsrKnown || requiredAnnualForDsr === null ? null : requiredAnnualForDsr <= income * r.dsr.limit;
    const ltvPass = requiredLoanKrw === null ? null : requiredLoanKrw <= r.loan.ltvKrw;
    const priceCapPass = requiredLoanKrw === null ? null : r.loan.capKrw === null || requiredLoanKrw <= r.loan.capKrw;
    if (ltvPass === false) failures.push(`LTV 한도보다 필요한 대출이 ${won(requiredLoanKrw-r.loan.ltvKrw)} 많음`);
    if (dsrPass === false) failures.push('필요 대출의 원리금이 DSR 한도를 초과');
    if (priceCapPass === false) failures.push('주택가격별 대출 상한 초과');
    if (r.cash.gapKrw !== null && r.cash.gapKrw < 0) failures.push(`현금 ${won(-r.cash.gapKrw)} 부족`);
    if (r.cash.myCashKrw !== null && r.cash.myCashKrw < r.cash.depositKrw) failures.push('대출 실행 전 계약금 마련 부족');
    if (requiredMonthlyKrw !== null && r.monthly.capKrw !== null && requiredMonthlyKrw > r.monthly.capKrw) failures.push('필요 대출의 월 상환액이 입력한 주거비 상한 초과');
    const status = missing.length ? 'needs_check' : failures.length ? 'not_possible' : 'possible';
    return { status, label: { possible:'계산상 가능', not_possible:'현재 가정으로 불가', needs_check:'확인 필요' }[status], reasons: missing.length ? missing : failures,
      requiredLoanKrw, requiredMonthlyKrw, requiredAnnual: requiredLoanKrw === null ? null : firstYearRepayment(requiredLoanKrw, r.rate.annual, r.years), requiredDsr, ltvPass, dsrPass, priceCapPass, debtComplete, missing, failures, policyAsOf: POLICY.asOf };
  }
  function compareBuyerTypes(property, profile, settings) {
    return { first: estimate(property, profile, {...settings, firstTimeBuyer:true}), general: estimate(property, profile, {...settings, firstTimeBuyer:false}) };
  }
  function isPossible(r) { return r?.screen?.status === 'possible'; }

  // 가격 입력: '5억 3천', '5.3억', '5억 3,000만', '530000000', '53000'(만 원) 을 받는다. 못 읽으면 null.
  function parsePriceInput(text) {
    const s = String(text ?? '').replace(/[\s,원]/g, '');
    if (!s) return null;
    if (/^\d+$/.test(s)) { const n = Number(s); return n > 0 ? (n < 100000 ? n * 10000 : n) : null; }
    const m = s.match(/^(?:(\d+(?:\.\d+)?)억)?(?:(\d+)천(?:만)?)?(?:(\d+)만?)?$/);
    if (!m || (!m[1] && !m[2] && !m[3])) return null;
    const n = Math.round(Number(m[1] || 0) * 1e8 + Number(m[2] || 0) * 1e7 + Number(m[3] || 0) * 1e4);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  const cashKnown = profile => amount(profile?.cashAvailableKrw) !== null;
  // 이 후보의 지역·면적과 내 조건으로 필요 현금이 내 현금(예비비 제외) 안에 드는 가장 높은 가격(100만 원 단위).
  function maxAffordablePrice(property, profile, settings) {
    if (!cashKnown(profile)) return null;
    const fits = price => { const r = estimate({ ...property, currentPrice: { ...(property?.currentPrice || {}), amountKrw: String(price) } }, profile, settings); return r.ok && r.cash.gapKrw >= 0; };
    let lo = 1e6, hi = 3e9;
    if (!fits(lo)) return 0;
    if (fits(hi)) return hi;
    while (hi - lo > 1e6) { const mid = Math.floor((lo + hi) / 2e6) * 1e6; if (mid <= lo) break; if (fits(mid)) lo = mid; else hi = mid; }
    return lo;
  }

  // ── 화면 조각 ──
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // 추정값이라 만 원 단위로 반올림해 보여 준다(1만 원 미만만 원 단위).
  function won(v) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '입력 필요';
    const sign = v < 0 ? '−' : '', abs = Math.abs(v);
    if (abs < 10000) return `${sign}${Math.round(abs).toLocaleString('ko-KR')}원`;
    const n = Math.round(abs / 10000) * 10000, eok = Math.floor(n / 1e8), m = Math.round(n % 1e8 / 1e4);
    return sign + (eok ? `${eok.toLocaleString('ko-KR')}억 ` : '') + (m ? `${m.toLocaleString('ko-KR')}만 ` : '') + '원';
  }
  const pct = (x, digits = 0) => `${(x * 100).toFixed(digits)}%`;
  const bokMonth = () => RATES.month.slice(5).replace(/^0/, '');
  const bindingLabel = r => r.loan.binding === 'dsr' ? '소득과 기존 빚을 반영한 한도' : r.loan.binding === 'cap' ? `가격별 상한 ${won(r.loan.capKrw)}` : `집값의 ${pct(r.ltv)}까지 빌리는 가정`;
  const RATE_PRESETS = [['avg', '은행 평균', RATES.mortgage], ['fixed', '고정형', RATES.mortgageFixed], ['variable', '변동형', RATES.mortgageVariable]];
  function ratePreset(s) {
    if (s.annualRate === null) return 'avg';
    const hit = RATE_PRESETS.find(([k, , v]) => k !== 'avg' && Math.abs(v - s.annualRate) < 1e-9);
    return hit ? hit[0] : 'custom';
  }
  function gapLine(r) {
    if (r.cash.gapKrw === null) return '<span class="loan-gap unknown">현금을 입력하면 부족·여유를 보여 드립니다</span>';
    return r.cash.gapKrw >= 0
      ? `<span class="loan-gap ok">계산상 현금 충당 · ${esc(won(r.cash.gapKrw))} 남음</span>`
      : `<span class="loan-gap short">내 현금보다 ${esc(won(-r.cash.gapKrw))} 부족</span>`;
  }
  function meter(r) {
    if (r.cash.myCashKrw === null || r.cash.neededKrw <= 0) return '';
    const f = Math.max(0, Math.min(1, r.cash.myCashKrw / r.cash.neededKrw));
    return `<div class="loan-meter ${f >= 1 ? 'ok' : 'short'}" role="img" aria-label="필요 현금의 ${Math.round(f * 100)}%를 내 현금으로 댈 수 있음"><span style="width:${(f * 100).toFixed(1)}%"></span></div>`;
  }
  function cardHtml(r) {
    if (!r || !r.ok) return '';
    return `<div class="loan-card" data-loan-estimate="${esc(r.modelVersion)}">${screenHtml(r, true)}<p class="help small">${r.firstTimeBuyer === true ? '생애최초' : r.firstTimeBuyer === false ? '일반' : '구분 선택 전'} · LTV ${pct(r.ltv)} · DSR 한도 ${pct(r.dsr.limit)} · 최대 대출 가정</p><p class="help small">${esc(r.stress.label)} · 스트레스 가산 +${(r.rate.stressAddon*100).toFixed(2)}%p</p><div class="loan-card-grid"><div><span>예상 대출</span><b>${esc(won(r.loan.krw))}</b><small>${esc(bindingLabel(r))}</small></div><div><span>필요 현금</span><b>${esc(won(r.cash.neededKrw))}</b><small>${r.costs.brokerageKrw === null ? '중개보수 미포함' : !r.costs.tax.areaKnown ? '일부 세금 미포함' : '세금·수수료 포함'}</small></div><div><span>첫 1년 갚는 돈</span><b>${esc(won(r.annual.paymentKrw))}</b><small>매달 ${esc(won(r.monthly.paymentKrw))} · 원금+이자</small></div></div>${!r.dsr.incomeKnown || !r.screen.debtComplete ? '<p class="loan-gap unknown">소득·기존 부채 입력 후 다시 확인하세요</p>' : gapLine(r)}</div>`;
  }
  function screenHtml(r, compact = false) {
    const s = r?.screen;
    if (!s) return '<span class="loan-status needs_check">확인 필요 · 가격 자료 없음</span>';
    const reasons = s.reasons.length ? s.reasons : ['LTV·DSR·현금·계약금 조건 충족'];
    return `<div class="loan-screen ${s.status}" data-loan-status="${s.status}"><strong class="loan-status ${s.status}">${esc(s.label)}</strong><span>${esc((compact ? reasons.slice(0, 2) : reasons).join(' · '))}</span>${compact ? '' : '<small>입력한 조건과 아래 가정에 따른 선별 결과입니다. 은행 승인·현재 매물 판매 여부는 별도 확인이 필요합니다.</small>'}</div>`;
  }
  function requiredHtml(r) {
    const s = r.screen;
    if (s.requiredLoanKrw === null) return '';
    const dsr = s.requiredLoanKrw === 0 ? '새 주택대출 불필요' : s.requiredDsr === null ? '소득·부채 확인 필요' : `${pct(s.requiredDsr, 1)} / 한도 ${pct(r.dsr.limit)}${s.dsrPass ? ' 이내' : ' 초과'}`;
    return `<div class="loan-required"><strong>내 현금을 쓰면 필요한 대출 ${esc(won(s.requiredLoanKrw))}</strong><span>필요 대출 기준 DSR ${esc(dsr)}</span><span>첫 1년 원금+이자 ${esc(won(s.requiredAnnual.paymentKrw))} · 매달 ${esc(won(s.requiredMonthlyKrw))}</span><small>예비비를 제외한 현금을 먼저 쓰는 가정입니다. 불가·확인 필요인 경우 아래 예상 최대 대출과 비교하세요.</small></div>`;
  }
  function buyerComparisonHtml(comparison, settings) {
    if (!comparison?.first?.ok || !comparison?.general?.ok) return '';
    const cfg = normalizeSettings(settings);
    const cards = [[true, '생애최초', comparison.first], [false, '일반', comparison.general]].map(([first, title, r]) => {
      const selected = cfg.firstTimeBuyer === first;
      const dsr = !r.dsr.incomeKnown || !r.screen.debtComplete ? '소득·부채 확인 필요' : won(r.loan.dsrKrw);
      return `<section class="loan-buyer-option${selected ? ' selected' : ''}"><h3>${title}${selected ? ' <small>선택한 조건</small>' : ''}</h3>${screenHtml(r, true)}<table class="loan-table"><tbody>${row(`LTV ${pct(r.ltv)} 한도`, won(r.loan.ltvKrw), '집값 대비 빌릴 수 있는 금액')}${row('DSR 40% 한도', dsr, `${r.stress.label} · 가산 +${(r.rate.stressAddon*100).toFixed(2)}%p`)}${row('지역·생애최초 대출 상한', capText(r))}${row('예상 최대 대출', won(r.loan.krw), '위 세 한도 중 최솟값', true)}${row('필요 현금', won(r.cash.neededKrw), r.costs.brokerageKrw === null || !r.costs.tax.areaKnown ? '최대 대출 이용 시 · 일부 비용 미포함' : '최대 대출 이용 시 · 세금·수수료 포함')}${row('첫 1년 원금+이자', won(r.annual.paymentKrw), '최대 대출 이용 시')}</tbody></table></section>`;
    }).join('');
    return `<div class="loan-comparison"><h3>생애최초와 일반, 얼마나 달라지나</h3><p class="help small">둘 다 현재 무주택·신규 구입 가정입니다. 생애최초 자격은 은행에서 확인합니다. 소득 한도에 걸리면 생애최초도 대출이 늘지 않습니다.</p><div class="loan-buyer-grid">${cards}</div></div>`;
  }
  // 한 번 눌러 바꾸는 선택 단추(라디오). 폼 change 한 번으로 다시 계산된다.
  function seg(name, legend, options, current, extraClass = '') {
    return `<fieldset class="loan-seg ${extraClass}"><legend>${esc(legend)}</legend><div class="seg">${options.map(([v, l]) => `<label><input type="radio" name="${esc(name)}" value="${esc(v)}"${String(v) === String(current) ? ' checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div></fieldset>`;
  }
  const firstValue = s => s.firstTimeBuyer === true ? 'yes' : s.firstTimeBuyer === false ? 'no' : '';
  const firstSeg = s => seg('firstTimeBuyer', '대출 구분', [['', '선택 전'], ['yes', '생애최초'], ['no', '일반']], firstValue(s), 'loan-seg-first') + seg('housingStatus', '현재 주택 보유', [['', '확인 전'], ['none', '무주택'], ['owned', '주택 보유']], s.housingStatus || '', 'loan-seg-housing');
  function moreFields(s) {
    const preset = ratePreset(s);
    return `${seg('ratePreset', `주담대 금리 (한국은행 ${bokMonth()}월 신규 평균)`, [...RATE_PRESETS.map(([k, l, v]) => [k, `${l} ${(v * 100).toFixed(2)}%`]), ['custom', '직접 입력']], preset)}<div class="loan-rate-custom"><label for="loan-rate">직접 입력 금리 (%)</label><input id="loan-rate" name="annualRatePct" type="number" inputmode="decimal" min="0.1" max="20" step="0.01" placeholder="예: 3.9" value="${preset === 'custom' ? esc(+(s.annualRate * 100).toFixed(3)) : ''}"></div>${seg('years', '대출 기간', YEARS.map(y => [y, `${y}년`]), s.years)}${seg('depositRate', '계약금', DEPOSIT_RATES.map(d => [d, `${Math.round(d * 100)}%`]), s.depositRate)}<p class="help small">무주택 기준입니다. 집이 이미 있으면 대출 조건이 달라지니 은행에 확인하세요.</p>`;
  }
  function settingsSummary(settings) {
    const s = normalizeSettings(settings), preset = ratePreset(s), rate = (s.annualRate ?? RATES.mortgage) * 100;
    const rateLabel = preset === 'custom' ? `직접 ${rate.toFixed(2)}%` : `${RATE_PRESETS.find(x => x[0] === preset)[1]} ${rate.toFixed(2)}%`;
    return `${rateLabel} · ${s.years}년 · 계약금 ${Math.round(s.depositRate * 100)}%`;
  }
  // 후보 목록 위 도구줄: 생애최초·'살 수 있는 곳만'은 늘 보이고, 금리·기간·계약금은 접어 둔다(폰 첫 화면을 덜 밀어내게).
  function settingsBarHtml(settings, opts = {}) {
    const s = normalizeSettings(settings), a = opts.affordable || {};
    const toggle = `<button type="button" class="loan-filter" data-action="loan-affordable-toggle" aria-pressed="${a.on ? 'true' : 'false'}">가능한 매물만${Number.isFinite(a.count) ? ` <b>${a.count.toLocaleString('ko-KR')}곳</b>` : ''}</button>`;
    const counts = a.counts ? `계산상 가능 ${a.counts.possible} · 현재 가정으로 불가 ${a.counts.not_possible} · 확인 필요 ${a.counts.needs_check}` : '';
    return `<form id="loan-estimate-form" class="loan-toolbar" aria-label="대출·필요 현금 추정 가정"><div class="loan-toolbar-top"><strong class="loan-toolbar-title">내가 살 수 있는 집 찾기</strong>${firstSeg(s)}${toggle}</div><p class="help small" role="status">${counts}</p><div class="loan-toolbar-help"><span>LTV·DSR·현금으로 선별합니다. 확인 필요인 매물은 ‘가능한 매물만’에서 제외됩니다.</span><button type="button" class="compact" data-action="loan-edit-conditions">현금·소득·부채 ${a.cashKnown ? '수정' : '입력'}</button></div><details class="loan-more"${opts.open ? ' open' : ''}><summary><span>금리·기간·계약금</span> <b>${esc(settingsSummary(s))}</b> <span class="loan-change">바꾸기</span></summary>${moreFields(s)}</details></form>`;
  }
  function readSettingsForm(form) {
    const get = n => form?.elements?.namedItem?.(n)?.value ?? '';
    const first = get('firstTimeBuyer'), preset = get('ratePreset'), ratePct = String(get('annualRatePct')).trim();
    let annualRate = null;
    if (preset === 'fixed') annualRate = RATES.mortgageFixed;
    else if (preset === 'variable') annualRate = RATES.mortgageVariable;
    else if (preset === 'custom' || (preset === '' && ratePct !== '')) { const r = Number(ratePct) / 100; annualRate = ratePct !== '' && Number.isFinite(r) ? r : null; }
    return normalizeSettings({ firstTimeBuyer: first === 'yes' ? true : first === 'no' ? false : null, housingStatus: get('housingStatus'), annualRate, years: Number(get('years')), depositRate: Number(get('depositRate')) });
  }
  function row(label, value, note = '', strong = false) {
    return `<tr${strong ? ' class="loan-total"' : ''}><th scope="row">${esc(label)}${note ? `<small>${esc(note)}</small>` : ''}</th><td>${esc(value)}</td></tr>`;
  }
  function capText(r) { return r.loan.capKrw === null ? '수도권 가격별 상한 미적용' : won(r.loan.capKrw); }
  function breakdownHtml(r) {
    const t = r.costs.tax, dsrLine = r.dsr.ratio === null ? '연소득 입력 필요' : `${pct(r.dsr.ratio, 1)} (은행 한도 ${pct(r.dsr.limit)})`;
    const loanTable = `<div class="loan-block"><table class="loan-table"><caption>대출</caption><tbody>${row(`LTV ${pct(r.ltv)} 한도`, won(r.loan.ltvKrw), `${r.region.label}${r.firstTimeBuyer === true ? ' · 생애최초' : ''}`)}${row('지역·생애최초 대출 상한', capText(r), r.stress.capitalArea === false ? '지방 비규제 · 은행별 한도 별도' : r.priceKrw <= 15e8 ? '15억 이하 주택' : r.priceKrw <= 25e8 ? '15억 초과~25억 이하 주택' : '25억 초과 주택')}${row('소득(DSR) 한도', r.loan.dsrKrw === null ? '연소득 입력 필요' : won(r.loan.dsrKrw), `${r.stress.label} · 가산 +${(r.rate.stressAddon*100).toFixed(2)}%p → 심사금리 ${(r.rate.stressAnnual * 100).toFixed(2)}%`)}${row('대출 가능(추정)', won(r.loan.krw), '셋 중 가장 작은 값', true)}</tbody></table></div>`;
    const monthTable = `<div class="loan-block"><table class="loan-table"><caption>매달 나가는 돈</caption><tbody>${row('첫 1년 상환액 (원금+이자)', won(r.annual.paymentKrw), `원금 ${won(r.annual.principalKrw)} + 이자 ${won(r.annual.interestKrw)}`, true)}${row('월 원리금', won(r.monthly.paymentKrw), `연 ${(r.rate.annual * 100).toFixed(2)}% · ${r.years}년 원리금균등`, true)}${row('└ 첫 달 이자', won(r.monthly.firstInterestKrw), '갚을수록 줄어듭니다')}${row('└ 첫 달 원금', won(r.monthly.firstPrincipalKrw))}${row(`${r.years}년 이자 합계`, won(r.monthly.totalInterestKrw))}${row('기존 부채 월 상환', r.monthly.existingDebtKrw === null ? '부채 입력 필요' : won(r.monthly.existingDebtKrw), '입력한 월 상환액, 없으면 이자만')}${row('DSR (심사 기준)', dsrLine)}${r.monthly.capKrw === null ? '' : row('월 주거비 상한 대비', r.monthly.fitsCap ? `상한 안 (${won(r.monthly.capKrw)})` : `상한 초과 (${won(r.monthly.capKrw)})`)}</tbody></table></div>`;
    const cashTable = `<div class="loan-block"><table class="loan-table"><caption>필요 현금</caption><tbody>${row('계약금', won(r.cash.depositKrw), `매매가의 ${Math.round(r.cash.depositRate * 100)}%`)}${row('잔금 중 내 돈', won(r.cash.balanceKrw), '매매가 − 계약금 − 대출')}${row('취득세·지방교육세' + (t.ruralKrw ? '·농특세' : ''), won(t.totalKrw), `취득세율 ${t.ratePct.toFixed(2)}% · 1주택 기준`)}${row('중개보수 (부가세 포함)', r.costs.brokerageKrw === null ? '요율표 범위 밖' : won(r.costs.brokerageKrw + r.costs.brokerageVatKrw), '법정 상한 · 협의로 낮출 수 있음')}${row('법무사·등기 등 기타', won(r.costs.miscKrw), '가정값')}${row('합계', won(r.cash.neededKrw), '', true)}</tbody></table>${r.costs.firstTimeExemptionKrw ? `<p class="help small">생애최초 취득세 감면 요건을 채우면 최대 ${esc(won(r.costs.firstTimeExemptionKrw))} 줄어듭니다(합계에는 빼지 않았습니다).</p>` : ''}</div>`;
    return `<div class="loan-grid">${loanTable}${monthTable}${cashTable}</div>`;
  }
  // 상세 구역. opts: propertyId, referencePriceKrw, priceOverridden, priceError, maxPriceKrw, openSettings, openBreakdown
  function detailHtml(r, settings, opts = {}) {
    const s = normalizeSettings(settings);
    const head = '<div class="loan-head"><h2>이 집을 사려면 <span class="badge assumed">예상 금액</span></h2><p class="help">무주택 신규 구입 · 변동형 스트레스 DSR 가정 · 은행 심사 전 참고 계산입니다.</p></div>';
    if (!r || !r.ok) return head + `<div class="notice warning">${esc(r?.reason || '계산할 수 없습니다.')}</div>`;
    const missing = [!r.dsr.incomeKnown && '연소득', r.cash.myCashKrw === null && '현금', !r.dsr.debtKnown && '부채(없으면 "없음")'].filter(Boolean);
    const callout = missing.length ? `<div class="notice loan-callout"><span>${esc(missing.join('·'))}을 넣으면 내 조건에 맞게 계산합니다.</span><button type="button" class="compact" data-action="loan-edit-conditions">조건 입력</button></div>` : '';
    const ref = opts.referencePriceKrw, id = esc(opts.propertyId || '');
    const priceNote = opts.priceOverridden ? `직접 넣은 가격 · 참고가 ${won(ref)}` : `${r.priceKind === 'asking' ? '확인된 호가' : '최근 거래 참고가'}${r.priceAsOf ? ` · ${r.priceAsOf}` : ''} — 실제 호가를 알면 바꿔 넣으세요`;
    const presets = ref ? [[1, '참고가'], [0.95, '−5%'], [0.9, '−10%']].map(([f, l]) => `<button type="button" class="compact" data-action="loan-price-preset" data-id="${id}" data-factor="${f}">${l}</button>`).join('') : '';
    const form = `<form id="loan-estimate-form" class="loan-calc" data-property="${id}" aria-label="대출 계산 가정"><div class="loan-price"><label for="loan-price">매매가</label><div class="loan-price-row"><input id="loan-price" name="loanPrice" type="text" autocomplete="off" enterkeyhint="done" value="${esc(won(r.priceKrw).replace(/ 원$/, ''))}" placeholder="예: 5억 3천"${opts.priceError ? ' aria-invalid="true" aria-describedby="loan-price-error"' : ''}><button type="submit" class="primary compact">가격 적용</button>${presets}</div>${opts.priceError ? `<p id="loan-price-error" class="loan-error" role="alert">${esc(opts.priceError)}</p>` : ''}<p class="help small">${esc(priceNote)}</p></div>${firstSeg(s)}<details class="loan-more"${opts.openSettings ? ' open' : ''}><summary><span>금리·기간·계약금</span> <b>${esc(settingsSummary(s))}</b> <span class="loan-change">바꾸기</span></summary>${moreFields(s)}</details></form>`;
    const gapCls = r.cash.gapKrw === null ? 'unknown' : r.cash.gapKrw >= 0 ? 'ok' : 'short';
    const gapText = r.cash.gapKrw === null ? '조건에 현금을 넣어 주세요' : r.cash.gapKrw >= 0 ? `${won(r.cash.gapKrw)} 남음` : `${won(-r.cash.gapKrw)} 부족`;
    const excluded = [r.costs.brokerageKrw === null && '중개보수 미포함', !r.costs.tax.areaKnown && '면적 미확인으로 일부 세금 미포함'].filter(Boolean);
    const costNote = excluded.length ? excluded.join(' · ') : `세금·수수료 ${won(r.costs.totalKrw)} 포함`;
    const hero = `<div class="loan-hero"><div><span>얼마까지 빌리나</span><b>${esc(won(r.loan.krw))}</b><small>예상 신규 주택대출 · ${esc(bindingLabel(r))}</small></div><div><span>내 현금은 얼마 필요한가</span><b>${esc(won(r.cash.neededKrw))}</b><small${excluded.length ? ' class="loan-error"' : ''}>${esc(costNote)}</small></div><div class="loan-year"><span>첫 1년 동안 갚는 돈</span><b>${esc(won(r.annual.paymentKrw))}</b><small>원금 ${esc(won(r.annual.principalKrw))} + 이자 ${esc(won(r.annual.interestKrw))}</small><small>매달 ${esc(won(r.monthly.paymentKrw))}</small></div></div><p class="loan-cash-summary ${gapCls}">쓸 수 있는 내 현금 ${esc(won(r.cash.myCashKrw))}${r.cash.reserveKnown ? ' (예비비 제외)' : ' (예비비 미입력)'} · <strong>${esc(gapText)}</strong></p><p class="help small">위 금액은 예상 최대 대출을 모두 이용하는 가정입니다. 위 상환액은 새 주택대출만의 금액입니다. 기존 빚의 상환액은 별도입니다. 원리금은 원금과 이자를 합친 금액입니다. 이자를 한 번 더 더하지 않습니다. 첫 12회 납입 기준이며, 표시 금액은 만 원 단위로 반올림합니다.</p>`;
    const household = `<div class="loan-household"><span>기존 빚까지 합치면</span><strong>총부채 ${r.householdDebt.totalBalanceKrw === null ? '기존 부채 입력 필요' : esc(won(r.householdDebt.totalBalanceKrw))}</strong><span>${r.householdDebt.annualizedKrw === null ? '합산 상환액은 기존 부채의 실제 월 상환액 입력 후 표시' : `매달 ${esc(won(r.householdDebt.totalMonthlyKrw))} · 1년 환산 ${esc(won(r.householdDebt.annualizedKrw))}`}</span><small>기존 부채는 현재 입력한 월 납입액이 12개월 유지된다는 가정입니다.</small></div>`;
    const maxLine = Number.isFinite(opts.maxPriceKrw) ? `<p class="loan-max">이 지역·조건이면 내 현금으로 <b>${opts.maxPriceKrw >= 3e9 ? '30억 원 이상' : `약 ${esc(won(opts.maxPriceKrw))}`}</b>까지가 현재 가정의 현금 충당 범위입니다.</p>` : '';
    const steps = `<ol class="loan-steps" aria-label="언제 얼마가 필요한가"><li><span>계약할 때</span><b>${esc(won(r.cash.depositKrw))}</b><small>계약금 ${Math.round(r.cash.depositRate * 100)}%</small></li><li><span>잔금 때</span><b>${esc(won(r.cash.balanceKrw + r.costs.totalKrw))}</b><small>잔금 중 내 돈 ${esc(won(r.cash.balanceKrw))} + 세금·수수료 ${esc(won(r.costs.totalKrw))}</small></li><li><span>그 뒤 매달</span><b>${esc(won(r.monthly.paymentKrw))}</b><small>원리금 · 첫 달 이자 ${esc(won(r.monthly.firstInterestKrw))} · ${r.years}년</small></li></ol>`;
    const notes = r.notes.length ? `<ul class="loan-notes">${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
    const sources = `<details class="disclosure loan-sources"><summary>계산 근거와 출처</summary><ul>${SOURCES.map(x => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.label)}</a></li>`).join('')}</ul><p class="help small">기존 정책 파일 기준일 ${esc(POLICY.asOf)}, LTV·DSR·가격별 상한·추가 규제지역은 2026-09-20 원문 대조. 가격은 담보 시가를 대신한 참고값이며 방공제·보증·신용·은행별 제한은 미반영입니다. 중개보수는 2026-08-28 개정안 확정 여부를 아직 확인하지 못했습니다. 스트레스 DSR은 2026년 하반기 변동형 기준입니다. 수도권·규제지역 +3.00%p, 지방 비규제 +0.75%p이며 실제 납부금리에는 가산하지 않습니다. 금리 선택의 고정형·변동형은 통계금리 예시이고, 고정·혼합·주기형 상품의 스트레스 적용비율은 별도 확인해야 합니다. 은행·상품·신용에 따라 실제 한도와 금리는 달라집니다.</p></details>`;
    return head + `<p class="loan-basis">계산 가격 <strong>${esc(won(r.priceKrw))}</strong> · ${opts.priceOverridden ? '직접 입력' : '최근 거래 참고가'} · 연 ${(r.rate.annual*100).toFixed(2)}% · ${r.years}년</p>` + `<p class="loan-basis">${esc(r.stress.label)} · 은행 DSR 한도 40% · 스트레스 가산 +${(r.rate.stressAddon*100).toFixed(2)}%p · 심사금리 ${(r.rate.stressAnnual*100).toFixed(2)}%<br><small>변동형 신규대출 가정 · 적용기간 ${r.stress.from}~${r.stress.until}. 실제 상환액에는 가산하지 않습니다.</small></p>` + callout + screenHtml(r) + requiredHtml(r) + hero + household + form + buyerComparisonHtml(opts.comparison, s) + steps + `<details class="loan-breakdown"${opts.openBreakdown ? ' open' : ''}><summary>계산 내역 보기</summary>${breakdownHtml(r)}</details>` + `<details class="disclosure"><summary>계산 가정과 빠진 비용 확인</summary>${maxLine}${notes}</details>` + sources;
  }
  // ':scenario' 가 들어간 이름이라 '저장한 조건 삭제'(ProfileStore.clear)가 함께 지운다.
  const STORAGE_SUFFIX = ':scenario-loan-estimate:v1';
  function loadSettings(storage, namespace) {
    try { const raw = storage?.getItem(`jamsil.workspace:${namespace}${STORAGE_SUFFIX}`); return normalizeSettings(raw ? JSON.parse(raw) : null); } catch (_) { return normalizeSettings(null); }
  }
  function saveSettings(storage, namespace, settings) {
    const s = normalizeSettings(settings);
    try { storage?.setItem(`jamsil.workspace:${namespace}${STORAGE_SUFFIX}`, JSON.stringify(s)); } catch (_) { /* 저장이 막혀도 이번 화면에는 적용한다 */ }
    return s;
  }
  return { MODEL_VERSION, POLICY, RATES, SOURCES, DEFAULTS, normalizeSettings, geography, stressPolicy, regulation, annuityFactor, monthlyPayment, firstYearRepayment, loanCap, brokerage, acquisitionTax, existingDebtService, estimate, screenPurchase, compareBuyerTypes, isPossible, screenHtml, buyerComparisonHtml, parsePriceInput, cashKnown, maxAffordablePrice, won, cardHtml, settingsSummary, settingsBarHtml, readSettingsForm, detailHtml, loadSettings, saveSettings };
});
