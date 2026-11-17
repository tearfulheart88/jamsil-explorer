(function () {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = v => (v / 100000000).toLocaleString('ko-KR',{maximumFractionDigits:3}) + '억';
  const recommendation = base => base?.inv?.recommendation || {};
  function recommendationLabel(base) {
    const status=base?.inv?.assessment?.status;
    if(status==='top') return '최상위 · 먼저 볼 곳';
    return base?.inv?.assessment?.label || recommendation(base).bucket || '투자 근거 확인';
  }
  function recommendationPriority(base) {
    const status=base?.inv?.assessment?.status;
    const conviction=recommendation(base).conviction;
    return status==='top'?0:conviction==='strong'?1:conviction==='moderate'?2:3;
  }
  function leadReason(base) {
    return recommendation(base).theses?.[0]?.title || recommendation(base).reasons?.[0]
      || base?.inv?.assessment?.reasons?.[0] || '투자 판단 근거는 후보 상세에서 확인하세요.';
  }
  function render(data, items, profile, state, container) {
    if (!container) return;
    const observations = data.listing_observations || [];
    if (!observations.length) { container.replaceChildren(); return; }
    const rows = observations.map(o=> {
      const base=items.find(it=>`${it.sgg}|${it.dong}|${it.apt}`===o.candidate_key && it.kind===o.kind);
      const it={...base,...o,regulated:base?.regulated ?? true};
      return {o,base,it,f:Advisor.calculate(it,profile,state.firstTime),priority:recommendationPriority(base)};
    }).filter(({o,base,f})=>state.kinds.has(o.kind) && base && state.regions.has(base.region) && o.price>=state.pmin && o.price<=state.pmax
      && (!state.onlyFeasible || profile.cash==null || f.cash+(profile.reserve||0)<=profile.cash)
      && (!state.onlyDsr || f.dsrKnown && f.dsr<=.40001)
      && (!state.onlyMonthly || f.monthlyFits===true)
      && (!state.noBlocked || !base?.parcel?.blocked?.length)
      && (!state.onlyJeonse || base?.regulated===false)
      && (!state.commuteMax || (base.commute!=null && base.commute<=state.commuteMax)))
      .sort((a,b)=>a.priority-b.priority || Number(b.base?.inv?.recommendation?.score||-1)-Number(a.base?.inv?.recommendation?.score||-1) || String(a.o.apt).localeCompare(String(b.o.apt)));
    const wasOpen=container.querySelector('details')?.open ?? false;
    container.innerHTML=`<details style="border-bottom:1px solid var(--line);padding:12px 18px;background:var(--panel-2)" ${wasOpen?'open':''}>
      <summary style="font-weight:700;cursor:pointer">확인한 온라인 호가 <span class="num">${rows.length}</span>건 <small style="font-weight:400">· 투자 추천과 함께 보기 · 일부 표본</small></summary>
      <p style="font-size:12px;color:var(--ink-3);margin:8px 0">호가는 현재 확인된 광고 표본이고, 추천은 과거 실거래 기반 투자 판단입니다. 호가가 투자점수를 올리거나 매도 가능을 확정하지 않습니다.</p>
      <div style="max-height:300px;overflow:auto;display:grid;gap:10px">${rows.map(({o,base,f})=>{
        const age=(Date.now()-Date.parse(o.observed_at))/3600000;
        const stale=!Number.isFinite(age)||age<0||age>(o.ttl_hours||24);
        const occupied=o.tenant_deposit!=null&&o.tenant_deposit>0;
        const url=/^https:\/\/fin\.land\.naver\.com\/articles\/\d+$/.test(o.source_url)?o.source_url:null;
        const score=base?.inv?.recommendation?.score;
        const status=base?.inv?.assessment?.status;
        const tone=status==='top'?'var(--accent)':status==='blocked'?'var(--warn)':'var(--panel-2)';
        return `<article style="padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--panel)">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><b>${esc(o.apt)} ${esc(o.building)}</b><strong class="num">${money(o.price)}</strong></div>
          <div style="margin-top:7px"><span style="display:inline-block;padding:3px 7px;border-radius:5px;background:${tone};font-size:11px">${esc(recommendationLabel(base))}${score!=null?` · 투자 매력 ${Number(score).toFixed(1)}점`:''}</span></div>
          <div style="font-size:12px;color:var(--ink-2);margin-top:6px"><b>추천 근거</b> · ${esc(leadReason(base))}</div>
          <div style="font-size:12px;margin:5px 0">${esc(o.area)}㎡ · ${esc(o.floor)}층 · ${esc(o.move_in)}</div>
          <div style="font-size:12px;color:var(--ink-2)">${occupied?`임차보증금 ${money(o.tenant_deposit)} · 입주·대출요건 확인 필요`:`필요현금 가정 ${money(f.cash)}${profile.reserve?' + 예비비':''} · ${f.dsrKnown?'입력 DSR 반영':'소득 미입력'}`}</div>
          <div style="font-size:11px;color:var(--ink-3);margin-top:7px">광고 확인일 ${esc(o.source_confirmed_at)} · 화면 조회 ${esc(o.observed_at.slice(0,16).replace('T',' '))}${stale?' · 재확인 필요':''}</div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">${url?`<a style="font-size:12px;display:inline-block;margin-top:7px" href="${esc(url)}" target="_blank" rel="noopener noreferrer">원문에서 현재 호가·입주조건 확인 ↗</a>`:''}<button type="button" class="btn ghost" data-observed-candidate="${esc(base.id)}" style="margin-top:7px">투자 근거·후보 상세 보기</button></div>
        </article>`;
      }).join('')||'<p style="font-size:12px">현재 조건에 맞는 확인 표본이 없습니다. 아래 실거래 후보에서 원문 매물을 확인할 수 있습니다.</p>'}</div>
    </details>`;
  }
  window.Observations={render};
})();
