/* Evidence-led villa screening. This is a research order, not an investment return score. */
(function(root){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const directGroups=new Set(['정비사업','소규모 정비사업','재정비촉진사업']);
const finished=s=>/준공|입주(?!자)|사업\s*완료|이전\s*고시|해제|취소/.test(String(s||'').replace(/\s/g,''));
const date=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\d/.test(v)?v.slice(0,10):null;
const officialUrl=v=>{try{const u=new URL(v);return u.protocol==='https:'&&(/(^|\.)eum\.go\.kr$/).test(u.hostname)?u.href:null}catch{return null}};
function stage(legacy={}){
  const parcel=legacy.parcel_zone||{},verdict=parcel.verdict||null;
  const inside=(legacy.seoul_zone?.zones||[]).filter(z=>z?.relation==='포함'&&directGroups.has(z.kind_group));
  const active=inside.filter(z=>!finished(z.stage));
  const complete=inside.length>0&&!active.length;
  const conflict=active.length>0&&['outside','conservation','released'].includes(verdict);
  const names=[...new Set(active.map(z=>z.zone).filter(Boolean))];
  const stages=[...new Set(active.map(z=>z.stage).filter(Boolean))];
  const checked=date(legacy.seoul_zone?.checked_at)||date(parcel.updated)||date(legacy.source_collected_at);
  const documentUrl=verdict==='redevelopment_confirmed'?(parcel.documents||[]).map(d=>officialUrl(d?.url)).find(Boolean)||null:null;
  if(conflict)return {kind:'CONFLICT',label:'자료가 서로 어긋남',detail:'지도상 정비구역 포함과 필지 조회 결과가 일치하지 않습니다.',checked};
  if(complete)return {kind:'COMPLETED',label:'이미 완료된 사업',detail:'정비구역 기록은 있으나 현재 사업 단계가 완료로 표기됩니다.',checked};
  if(active.length){const named=stages.length===1?stages[0]:null,pending=/추진중|예정|신청|심의|자문|검토|공모|접수|진행중/.test(named||''),construction=/착공/.test(named||'');
    const formal=!!named&&!pending&&/구역지정|지구지정|조합설립|사업시행|관리처분|착공/.test(named);
    return {kind:'DIRECT',label:'정비구역 직접 중첩',detail:`${names.slice(0,2).join('·')||'공식 구역'} · ${named||'사업 단계 원문 확인'}${pending?' · 추진·예정 표기는 인가 완료가 아님':''}${construction?' · 기존 건물 존치·실거주 가능 여부 확인 필요':''}`,checked,documentUrl,evidenceBand:construction?0:formal?2:named?1:0,construction,relocationRisk:/관리처분|착공/.test(named||'')};}
  if(verdict==='redevelopment_confirmed')return {kind:'DIRECT',label:'필지 정비구역 포함',detail:'필지·고시 대조 결과입니다. 현재 사업 단계와 승계 권리는 별도 확인해야 합니다.',checked,documentUrl,evidenceBand:0};
  if(verdict==='pre_designation'||verdict==='zone_unverified')return {kind:'EARLY',label:'초기·미검증 신호',detail:'구역 지정 또는 고시 원문이 확정적으로 연결되지 않았습니다.',checked};
  if(['outside','conservation','released'].includes(verdict))return {kind:'NONE',label:'직접 정비 수혜 근거 없음',detail:'필지 조회상 구역 밖·보존형·해제 기록입니다. 주변 사업은 별도 맥락입니다.',checked};
  if((legacy.seoul_zone?.zones||[]).some(z=>z?.relation==='경계 인접')||(legacy.redev?.entry||[]).length)return {kind:'NEARBY',label:'주변 사업만 관측',detail:'가까운 사업이나 같은 동네 사업을 이 집의 사업으로 보지 않습니다.',checked};
  return {kind:'NONE',label:'직접 정비 근거 없음',detail:'현재 수집 자료에서 개별 집의 정비사업 연결을 확인하지 못했습니다.',checked};
}
function land(legacy={}){
  const e=legacy.land_share_evidence||{},sqm=finite(legacy.land_share),verified=e.registered_verified===true&&e.ratio_validated===true&&sqm!==null;
  if(verified)return {kind:'REGISTERED',sqm,label:'등기 확인 대지권',detail:'면적과 권리 단위가 확인된 자료입니다.'};
  if(e.basis==='reported_transaction'&&e.ratio_validated===true&&sqm!==null)return {kind:'REPORTED',sqm,label:'실거래 신고 대지권면적',detail:'같은 물건·면적대의 신고값입니다. 해당 호실의 등기 대지권은 미확인입니다.'};
  if(e.basis==='area_allocation_estimate'&&e.ratio_validated===true&&sqm!==null)return {kind:'ESTIMATE',sqm,label:'면적 배분 추정',detail:'등기 대지권이 아니며 지분·권리가액을 뜻하지 않습니다.'};
  return {kind:'UNKNOWN',sqm:null,label:'대지권 자료 없음',detail:'해당 호실의 등기 대지권과 전용면적을 연결해 확인해야 합니다.'};
}
function evaluate(property,legacy={},profile=null,analysis=null){
  if(property?.propertyType!=='villa')return null;
  const project=stage(legacy),ground=land(legacy),area=finite(property?.area?.sqm)??finite(legacy.area),age=finite(legacy.age);
  const station=finite(legacy.station?.dist_m),asking=property.currentPrice?.kind==='asking'&&property.granularity==='unit';
  const requiredArea=(profile?.needs||[]).find(n=>n.key==='minArea'&&n.required===true)?.value;
  const areaFails=finite(Number(requiredArea))!==null&&requiredArea!==undefined&&requiredArea!==null&&area!==null&&area<Number(requiredArea);
  const personalFail=analysis?.decision==='NOT_FIT'||analysis?.personalFit?.status==='NOT_FIT'||areaFails;
  const holds=[];
  if(ground.kind!=='REGISTERED')holds.push('해당 호실 등기 대지권 확인');
  if(!asking)holds.push('현재 판매 중인 호실·호가 확인');
  holds.push('실내 상태·구조·주차·소음 현장 확인');
  if(project.kind==='DIRECT')holds.push('조합원 승계 가능 여부·권리가액·추가분담금 원문 확인');
  if(project.relocationRisk)holds.push('이주·철거 일정과 5~10년 거주 가능 여부 확인');
  if(project.kind==='CONFLICT')holds.unshift('정비구역·필지 자료 충돌 해소');
  if(area===null)holds.push('전용면적 확인');
  const key=personalFail?'PERSONAL_FAIL':project.kind==='DIRECT'?'DIRECT_RESEARCH':project.kind==='EARLY'?'EARLY_RESEARCH':project.kind==='CONFLICT'?'CONFLICT':project.kind==='COMPLETED'?'COMPLETED':project.kind==='NEARBY'?'NEARBY':'NO_DIRECT';
  const title={PERSONAL_FAIL:'내 필수 조건에 맞지 않음',DIRECT_RESEARCH:'직접 정비 근거가 있는 조사 후보',EARLY_RESEARCH:'초기 신호만 있는 조사 후보',CONFLICT:'공식 자료 대조 필요',COMPLETED:'완료된 사업 · 새 정비 기대 제외',NEARBY:'주변 사업 참고 후보',NO_DIRECT:'직접 정비 근거 없는 후보'}[key];
  return {key,title,project,ground,area,age,station,asking,personalFail,holds,priceComparable:legacy.inv?.peer_price_comparison?.status==='available',
    readiness:'RESEARCH_ONLY',sourceDate:date(legacy.source_collected_at),hasVerifiedHabitability:false};
}
const tier={DIRECT_RESEARCH:0,EARLY_RESEARCH:1,NEARBY:2,NO_DIRECT:3,CONFLICT:4,COMPLETED:5,PERSONAL_FAIL:6};
const landOrder={REGISTERED:0,REPORTED:1,ESTIMATE:2,UNKNOWN:3};
function order(rows,getLegacy,profile){return rows.map((row,i)=>({row,i,result:evaluate(row.property,getLegacy(row.property),profile,row.analysis)})).filter(x=>x.result).sort((a,b)=>
  tier[a.result.key]-tier[b.result.key]||(b.result.project.evidenceBand||0)-(a.result.project.evidenceBand||0)||landOrder[a.result.ground.kind]-landOrder[b.result.ground.kind]||
  Number(b.result.area!==null)-Number(a.result.area!==null)||Number(b.result.priceComparable)-Number(a.result.priceComparable)||a.i-b.i).map(x=>x.row)}
function evidence(result){const r=result;if(!r)return '';
  const lead=r.project.kind==='DIRECT'?`<strong>${esc(r.project.label)}</strong><span>${esc(r.project.detail)}</span>`:`<strong>${esc(r.project.label)}</strong><span>${esc(r.project.detail)}</span>`;
  return `<div class="villa-evidence"><p class="villa-verdict">${esc(r.title)} <small>매수 추천 아님</small></p><div class="villa-facts"><div>${lead}<small>자료 확인 ${esc(r.project.checked||'일자 미상')}</small>${r.project.documentUrl?`<a href="${esc(r.project.documentUrl)}" target="_blank" rel="noopener noreferrer">해당 필지 고시 참고 ↗</a>`:''}</div><div><strong>${esc(r.ground.label)}${r.ground.sqm!==null?` ${r.ground.sqm.toFixed(1)}㎡`:''}</strong><span>${esc(r.ground.detail)}</span></div><div><strong>지금 살기: 일부 자료만 확인</strong><span>${r.area!==null?`전용 ${r.area.toFixed(1)}㎡`:'면적 확인 필요'} · ${r.age!==null?`${r.age}년 경과`:'연식 확인 필요'} · ${r.station!==null?`역까지 직선 ${Math.round(r.station)}m`:'역 거리 확인 필요'} · 내부·구조·주차 미확인</span></div><div><strong>현재 매입조건: ${r.asking?'호가 기록 있음':'판매 여부·호가 확인 필요'}</strong><span>${r.priceComparable?'유사 실거래 비교 가능 · 매입가 우위는 별도 확인':'유사 거래 비교 자료 부족'} · 추가분담금 미확인</span></div></div><p class="villa-holds"><strong>결론 전 확인:</strong> ${esc(r.holds.join(' · '))}</p></div>`;
}
function page(rows,{getLegacy,profile,sourceDate,limit=40}={}){
  const ordered=order(rows,getLegacy,profile),counts={};for(const row of ordered){const key=evaluate(row.property,getLegacy(row.property),profile,row.analysis).key;counts[key]=(counts[key]||0)+1}
  const link=id=>'#/properties/'+encodeURIComponent(id);
  return `<section class="villa-intro panel"><p class="eyebrow">빌라 · 재개발 근거별 보기</p><h1>살 집을 먼저 고르고, 정비 근거를 따로 확인하세요.</h1><p>서울·경기 실거래 기반 후보를 공식 사업의 직접 연결 → 대지권 자료 수준 → 현재 살기 자료 순으로 조사합니다. 수익률·재개발 성공확률·입주권을 예측하지 않습니다.</p><p><strong>${ordered.length.toLocaleString('ko-KR')}곳</strong> 중 직접 정비 근거 ${counts.DIRECT_RESEARCH||0}곳 · 초기 신호 ${counts.EARLY_RESEARCH||0}곳 · 자료 충돌 ${counts.CONFLICT||0}곳. 모든 후보의 현재 매수조건·대지권·현장 거주상태는 추가 확인이 필요합니다.</p><p class="help">자료 게시 ${esc(date(sourceDate)||'일자 미상')} · 대지권 신고·추정치는 등기 대지권이 아닙니다. 화면 순서는 임장 조사 순서이며 매수 권유가 아닙니다.</p><div class="actions"><a class="button" href="#/explore">지역·가격 조건 바꾸기</a><a class="button" href="#/conditions">면적·자금 조건 입력하기</a></div></section><div class="villa-list">${ordered.slice(0,limit).map(({property:p,analysis:a},i)=>{const r=evaluate(p,getLegacy(p),profile,a);return `<article class="candidate villa-candidate"><div class="candidate-head"><div><h2><a href="${esc(link(p.id))}">${esc(p.name)}</a></h2><p>${esc(p.addressLabel||p.regionCode||'위치 확인 필요')}</p></div><small>조사 순서 ${i+1}</small></div><p>${esc(p.currentPrice?.amountKrw?Number(p.currentPrice.amountKrw).toLocaleString('ko-KR')+'원':'가격 확인 필요')} · ${esc(p.currentPrice?.kind==='asking'?'호가 기록':'과거 거래·참고 가격')} · 현재 판매 여부 미확인</p>${evidence(r)}<a class="button primary" href="${esc(link(p.id))}">이 집의 근거·위험 자세히 보기 →</a></article>`}).join('')||'<div class="panel empty"><h2>현재 조건에 맞는 빌라가 없습니다.</h2><p>집 찾기에서 지역·가격·유형을 조정해 보세요.</p></div>'}</div>${ordered.length>limit?`<button type="button" class="list-more" data-action="show-more">다음 ${Math.min(40,ordered.length-limit)}곳 더 보기 · ${limit}/${ordered.length}</button>`:''}`;
}
const api={stage,land,evaluate,order,evidence,page};root.WorkspaceVillaRedevelopment=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
