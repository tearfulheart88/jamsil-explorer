(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.WorkspaceBuyerGuide=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  // Presentation only: existing investment policy, finance model and ranking are unchanged.
  //
  // 2026-09-26 판정 기준 변경(대표님 "확인이 먼저인 집만 떠서 할 수 있는 게 없다"):
  // 예전에는 '매수 검토' 판정·개별 원문 근거·Personal Fit 순위 자격을 모두 요구했는데, 지금 자료로는 7,326곳 전부가
  // 이 셋을 못 넘는다(현재 호가·등기 자료가 없으므로). 모든 집에 똑같이 걸리는 확인은 집을 가르지 못하므로
  // '매수 전 공통 확인'으로 따로 보여 주고, 판정은 자료가 실제로 가르는 것 — 자금 가능 여부·v8 투자 등급·
  // 근거 범위·집 고유 위험 — 으로만 한다. '먼저 가볼 집'은 매수 권유가 아니라 방문·문의 우선순위다.
  const COMMON_CHECKS=Object.freeze(['지금 판매 중인지, 실제 호가가 얼마인지','등기부등본(소유자·근저당·압류)','세입자·전입 여부와 비워 주는 날짜']);
  const CAT=Object.freeze({
    PRICE:{name:'가격',low:'유사 거래보다 비싸거나 가격 흐름이 약한 편',high:'유사 거래보다 싸거나 가격 흐름이 좋은 편'},
    PLACE:{name:'입지',low:'역이 멀거나 매수 수요 근거가 약한 편',high:'역과 매수 수요 접근성이 좋은 편'},
    DEV:{name:'개발 여지',low:'재건축·재개발 선택권이 작은 편',high:'재건축·재개발 선택권이 큰 편'},
    LIQ:{name:'거래',low:'거래가 드물어 시세 확인·되팔기가 어려울 수 있음',high:'거래가 활발해 시세 확인·되팔기가 쉬운 편'}
  });
  const WEAK=40,STRONG=60;
  // v8 채점이 남긴 집별 근거(투자 가설). 제목은 scripts/investment_score.py 의 가설 이름을 쉬운 말로 옮긴 것.
  const THESIS=Object.freeze({
    price_demand:'싸게 거래되고 수요도 있음',catchup:'주변과 가격 격차가 줄어드는 중',relative_demand:'주변보다 가격 흐름이 앞섬',
    lagging_option:'주변보다 덜 올라 따라잡을 여지(가설)',development_option:'재건축·재개발 선택권',access_exit:'역이 가깝고 거래가 꾸준함',access:'역이 가까움'
  });
  function thesisNotes(legacy){
    const priced=!!buyOf(legacy),list=(Array.isArray(legacy?.inv?.recommendation?.theses)?legacy.inv.recommendation.theses:[]).filter(t=>!priced||!(PRICE_THESES.has(t?.key)||t?.key==='price_question'));
    const line=t=>`${(t.evidence||[]).filter(x=>typeof x==='string').slice(0,3).join(' · ')}`;
    return {
      strong:list.filter(t=>THESIS[t?.key]).map(t=>`${THESIS[t.key]} — ${line(t)}`),
      weak:list.filter(t=>t?.key==='price_question').map(t=>`주변보다 싼 이유 확인 필요 — ${line(t)}`)
    };
  }
  function categoryNotes(legacy){
    const priced=!!buyOf(legacy),cats=(Array.isArray(legacy?.inv?.cats)?legacy.inv.cats:[]).filter(c=>c&&CAT[c.k]&&Number.isFinite(c.s)&&!(priced&&c.k==='PRICE'));
    return {
      weak:cats.filter(c=>c.s<WEAK).sort((a,b)=>a.s-b.s).map(c=>`${CAT[c.k].low} (${CAT[c.k].name} ${Math.round(c.s)}점)`),
      strong:cats.filter(c=>c.s>=STRONG).sort((a,b)=>b.s-a.s).map(c=>`${CAT[c.k].high} (${CAT[c.k].name} ${Math.round(c.s)}점)`)
    };
  }
  // 필지 자체의 정비구역 사실(parcel_zone). 동 단위 사업 목록(redev.blocked)은 이 집의 사실이 아니라 쓰지 않는다.
  function parcelNote(legacy,regulated){
    const v=legacy?.parcel_zone?.verdict;
    if(v==='redevelopment_confirmed')return regulated===true
      ?{critical:true,text:'이 집 필지가 정비구역 안입니다. 규제지역이라 사업 단계(재건축은 조합설립, 재개발은 관리처분 인가 이후)에 따라 지금 사면 조합원이 못 되고 현금청산될 수 있습니다. 조합·구청에 단계부터 확인하세요.'}
      :{critical:false,text:'이 집 필지가 정비구역 안입니다. 사업 단계·추가 분담금·이주 시기를 조합에 확인하세요.'};
    if(v==='pre_designation')return {critical:false,text:'정비구역 지정 전 건축행위 제한 구역입니다. 권리산정기준일과 입주권 조건을 구청에 확인하세요.'};
    if(v==='zone_unverified')return {critical:false,text:'정비 관련 고시가 있지만 사업 유형을 확인하지 못했습니다. 고시 원문을 확인하세요.'};
    if(v==='conservation')return {critical:false,text:'보존·관리형 구역이라 재개발 대상이 아닐 수 있습니다.'};
    return null;
  }
  const pts=n=>Number.isFinite(n)?`${Math.round(n)}점`:'점수 미확인';
  // 2026-11-17 판정 근거 교체: v8 투자 점수는 과거 실거래로 재현해 보니 이후 가격과 상관이 없었다(순차 검증 AUC 0.49).
  // 실거래로 검증된 것은 '가격 위치'(최근 값이 제 흐름보다 높은가)와 평형별 시세 추정뿐이라, 그 자료(buy)가 있으면 그것으로 판정한다.
  // buy 가 없는 예전 자료는 아래 기존 판정을 그대로 쓴다. 상세 조각(types 배열)과 목록 요약 두 모양을 모두 받는다.
  const SURE_TRADES=3,PRICE_THESES=new Set(['price_demand','catchup','relative_demand','lagging_option']);
  function buyOf(legacy){const b=legacy?.buy;if(!b||typeof b!=='object')return null;const t=Array.isArray(b.types)?b.types[b.main]:b;if(!t||!Number.isFinite(t.est))return null;return {est:t.est,n12:Number.isFinite(t.n12)?t.n12:0,grade:t.position?.grade||null,label:t.label||''}}
  function won(v){const n=Math.round(Math.abs(v)/10000)*10000,eok=Math.floor(n/1e8),man=Math.round(n%1e8/1e4);return (eok?`${eok.toLocaleString('ko-KR')}억`:'')+(eok&&man?' ':'')+(man?`${man.toLocaleString('ko-KR')}만`:'')+' 원'}
  // Personal Fit 보류 중 자금 계열은 대출·필요 현금 계산(workspace-loan-estimate)이 대신 판정하므로 판정을 막지 않는다.
  // 매수 목적(PURPOSE_MISSING)은 Personal Fit 가중치에만 쓰여 이 판정과 무관하다. 남는 보류(필수 통근의 허용시간·거점별 이동일수)는
  // 집이 아니라 내 입력이 빈 것이라 모든 집에 똑같이 걸린다 → 막지 않고 '조건을 채우면 판정'으로 무엇을 넣을지 알린다.
  const NON_BLOCKING_HOLDS=new Set(['NEEDS_PRICE_CHECK','FINANCE_SCENARIO_MISSING','FINANCE_SCENARIO_IDENTITY_UNVERIFIED','NEEDS_FINANCE_CHECK','FINANCE_COSTS_INCOMPLETE','REDEVELOPMENT_CONTRIBUTION_UNBOUNDED','PURPOSE_MISSING']);
  function build({analysis={},view={},loan=null,legacy=null}={}){
    analysis=analysis||{};view=view||{};
    const inv=view.investment||{},fit=view.personalFit||{},ev=view.evidence||{},screen=loan?.screen;
    const hardFailure=analysis.decision==='NOT_FIT'||(fit.hardGates||[]).length>0;
    const moneyFailure=screen?.status==='not_possible';
    const moneyOk=screen?.status==='possible';
    const needsBudget=!loan?.ok||!loan.dsr?.incomeKnown||!loan.dsr?.debtKnown||screen?.debtComplete===false||!Number.isFinite(loan.cash?.myCashKrw)||!loan.cash?.reserveKnown;
    const B=buyOf(legacy),sure=!!B&&B.n12>=SURE_TRADES;
    const attractive=B?B.grade==='good'&&sure:['top','attractive'].includes(inv.status);
    const evidenceOk=B?true:['HIGH','MEDIUM'].includes(ev.status)&&Number.isFinite(ev.conflictCount)&&ev.conflictCount===0;
    const parcel=parcelNote(legacy,loan?.region?.regulated);
    const listedCritical=(view.risks||[]).find(r=>r.severity==='critical');
    const criticalRisk=!!listedCritical||parcel?.critical===true;
    const fitHold=(fit.verificationHolds||[]).find(h=>!NON_BLOCKING_HOLDS.has(h?.id||h?.code));
    const status=moneyFailure||hardFailure||inv.status==='blocked'?'avoid':moneyOk&&attractive&&evidenceOk&&!criticalRisk&&!fitHold?'review':'check';
    // 내가 채울 수 있는 조건(예산·생애최초·무주택)이 비어서 판정을 못 한 집. 집 자료가 비어서 못 한 집과 구분한다.
    const pending=status==='check'&&(!!fitHold&&!criticalRisk&&moneyOk||!moneyOk&&(needsBudget||(screen?.missing||[]).some(m=>/생애최초|무주택|주택 보유자/.test(m))));
    let reason;
    if(moneyFailure)reason=screen.failures?.[0]||screen.reasons?.[0]||'현재 현금과 대출 가정으로는 매수 자금이 부족합니다.';
    else if(hardFailure)reason='입력한 필수 조건에 맞지 않습니다. 맞지 않는 조건을 먼저 확인하세요.';
    else if(inv.status==='blocked')reason='현재 투자 평가에서 제외된 후보입니다. 제외 사유를 먼저 확인하세요.';
    else if(!moneyOk)reason=screen?.missing?.[0]||'내 예산으로 살 수 있는지부터 확인해야 합니다. 현금·소득·부채와 대출 조건을 확인하세요.';
    else if(parcel?.critical)reason='자금은 되지만 지금 사면 입주권 없이 현금청산될 수 있는 정비구역입니다. 사업 단계부터 확인하세요.';
    else if(listedCritical)reason=listedCritical.text||'자금은 되지만 먼저 풀어야 할 위험이 있습니다.';
    else if(fitHold)reason=`내 조건 입력을 마저 해 주세요: ${fitHold.text||'필수 조건의 기준이 비어 있습니다.'}`;
    else if(B&&B.grade==='bad')reason=`자금은 되지만 최근 실거래가가 제 흐름보다 높게 형성돼 있습니다(가격 위치 불리). 추정 시세 ${won(B.est)}보다 3% 넘게 싸게 살 수 있을 때만 검토하세요.`;
    else if(B&&!sure)reason=`자금은 되지만 같은 평형 거래가 12개월 ${B.n12}건뿐이라 시세를 확신하기 어렵습니다. 주변 거래와 중개사 확인이 먼저입니다.`;
    else if(B&&B.grade==='mid')reason=`자금은 되고 가격 위치는 보통입니다. 추정 시세 ${won(B.est)} 이하로 계약할 수 있는지가 관건입니다.`;
    else if(B&&!B.grade)reason=`자금은 되지만 최근 3개월 중개거래가 없어 가격 위치를 판정하지 못했습니다. 추정 시세 ${won(B.est)} 이하로만 검토하세요.`;
    else if(B)reason=`내 돈으로 살 수 있고, 최근 실거래가가 제 흐름보다 낮게 형성돼 있습니다(가격 위치 유리). ${won(Math.floor(B.est*0.97/1e6)*1e6)} 이하로 계약할 수 있는지 확인하고, 판매 여부·등기부를 꼭 확인하세요.`;
    else if(ev.conflictCount>0)reason='자료끼리 서로 달라 판단을 보류합니다. 다른 후보를 먼저 보세요.';
    else if(['data_needed','verify'].includes(inv.status))reason='투자 판단 자료가 부족해 비교용입니다. 먼저 가볼 집부터 보세요.';
    else if(!attractive)reason=`자금은 되지만 투자 점수가 ${inv.status==='conditional'?'조건부':'중간 이하'}(${pts(inv.score)})라 비교용입니다. 먼저 가볼 집부터 보세요.`;
    else if(!evidenceOk)reason=`투자 점수는 좋지만(${pts(inv.score)}) 판단 근거가 좁습니다(근거 범위 ${Number.isFinite(ev.score)?Math.round(ev.score)+'%':'미확인'}). 다른 후보와 비교하세요.`;
    else reason=`내 돈으로 살 수 있고 투자 점수 상위(${pts(inv.score)})입니다. 매수 전에는 판매 여부·실제 호가·등기부를 꼭 확인하세요.`;
    const notes=categoryNotes(legacy),theses=thesisNotes(legacy);
    const drivers=(inv.drivers||[]).filter(d=>d.direction==='positive'&&d.text).map(d=>d.text);
    const posGood=B?.grade==='good'?['최근 값이 제 흐름보다 낮게 형성돼 있음 (가격 위치 유리)']:[],posBad=B?[...(B.grade==='bad'?['최근 값이 제 흐름보다 높게 형성돼 있음 (가격 위치 불리)']:[]),...(!sure?[`같은 평형 거래가 12개월 ${B.n12}건뿐이라 시세가 불확실함`]:[])]:[];
    const strengths=[...posGood,...theses.strong,...notes.strong,...(B?[]:drivers)].slice(0,3);
    const cautions=[...(parcel?[parcel.text]:[]),...posBad,...theses.weak,...notes.weak].slice(0,3);
    const investmentLabel=({top:'우선 살펴볼 만함',attractive:'장점이 있는 후보',conditional:'조건을 따져봐야 함',compare:'다른 집과 비교 필요',verify:'자료 확인이 먼저',data_needed:'판단 자료 부족',blocked:'현재 평가에서 제외'})[inv.status]||'아직 판단하기 어려움';
    const label=pending?'조건을 채우면 판정':({review:'먼저 가볼 집',check:'비교해볼 집',avoid:'지금은 제외할 집'})[status];
    return {status,pending,label,reason,
      moneyLabel:moneyOk?'계산상 마련 가능':moneyFailure?'현재 자금으로 어려움':'내 조건 확인 필요',
      positionBased:!!B,estimateKrw:B?B.est:null,
      investmentLabel:B?`가격 위치 ${({good:'유리',mid:'보통',bad:'불리'})[B.grade]||'판정 없음'}`:Number.isFinite(inv.score)?`${investmentLabel} (${pts(inv.score)})`:investmentLabel,
      evidenceLabel:B?`같은 평형 12개월 ${B.n12}건 · ${B.n12>=6?'충분':sure?'보통':'부족'}`:ev.conflictCount>0?'자료가 서로 다름':Number.isFinite(ev.score)?`근거 범위 ${Math.round(ev.score)}%${evidenceOk?'':' (좁음)'}`:'근거 범위 미확인',
      strengths,cautions,commonChecks:[...COMMON_CHECKS],
      positive:strengths[0]||'확인된 장점을 아직 설명하기 어렵습니다.',
      caution:cautions[0]||'자료로 드러난 이 집만의 약점은 없습니다. 아래 공통 확인만 하세요.',
      next:moneyFailure?'필요한 돈과 부족한 금액을 확인하세요.':fitHold&&moneyOk&&!criticalRisk?'내 조건 화면에서 필수 통근 조건의 허용시간·이동일수를 채우세요.':needsBudget?'내 현금·연소득·기존 부채를 입력하거나 점검하세요.':!moneyOk?screen?.missing?.[0]||'대출 조건과 빠진 비용을 확인하세요.':status==='review'?(B?'중개사에게 판매 여부와 호가를 묻고, 아래 호가 점검기에 그 값을 넣어 보세요. 등기부등본도 떼어 보세요.':'중개사에게 판매 여부와 실제 호가를 묻고, 등기부등본을 떼어 보세요.'):parcel?.critical?'조합·구청에 사업 단계와 조합원 자격을 확인하세요.':'먼저 가볼 집과 가격·장점을 비교하세요.',
      needsBudget,
      cashNeeded:loan?.ok?loan.cash?.neededKrw:null,
      cashShortfall:loan?.ok&&Number.isFinite(loan.cash?.gapKrw)?Math.max(0,-loan.cash.gapKrw):null,
      debt:loan?.ok?loan.loan?.krw:null,monthly:loan?.ok?loan.monthly?.paymentKrw:null,annual:loan?.ok?loan.annual?.paymentKrw:null
    };
  }
  return Object.freeze({build,COMMON_CHECKS});
});
