/* home-story-1.0: 한 집을 '내가 들어가 살 집'으로 읽은 쉬운 설명.
 * 대표님(2026-09-26): "몇 년 된 건물에 용적률에 뭐가 좋은지 딱 눈에 안 들어온다. 네가 살 집을 찾는다고 생각해 봐."
 * 점수 대신 네 질문에 답한다 — 들어가 살 만한가 / 값이 적당한가 / 앞으로 값이 버틸까·오를까 / 직접 봐야 아는 것.
 * 원칙: 모든 문장은 이 집 자료의 숫자에서 나온다. 좋다·나쁘다는 같은 유형 후보 분포(상·하위 25%)나 명시한 기준으로만 가른다.
 * 자료가 없으면 지어내지 않고 '직접 봐야 아는 것'으로 보낸다(외관·내부 상태 등).
 * 표시 전용: v8 순서·판정·대출 계산은 바꾸지 않는다. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkspaceHomeStory = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 'home-story-1.0';
  // 2026-09-18 공개 스냅샷 후보(아파트 2,982곳·빌라 4,344곳)의 25%·75% 값. [낮은 쪽, 높은 쪽]
  const Q = Object.freeze({
    아파트: { stores: [79, 294], households: [100, 558], far: [220, 322], oldShare: [10, 41] },
    빌라: { stores: [136, 349], far: [167, 211], land: [0.49, 0.64], oldShare: [10.5, 34.3] },
    peerGap: [-13, 14], momentum: [1.4, 6.3]
  });
  const PYEONG = 3.305785;
  const WALK_M_PER_MIN = 67; // 시속 4km

  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const won = v => {
    if (num(v) === null) return '확인 필요';
    const n = Math.round(Math.abs(v) / 10000) * 10000, eok = Math.floor(n / 1e8), man = Math.round(n % 1e8 / 1e4);
    return (v < 0 ? '−' : '') + (eok ? `${eok.toLocaleString('ko-KR')}억 ` : '') + (man ? `${man.toLocaleString('ko-KR')}만 ` : '') + '원';
  };
  const pct = (v, d = 0) => `${Math.abs(v).toFixed(d)}%`;
  const line = (tone, label, text, basis) => ({ tone, label, text, basis: basis || null });

  function kindOf(l, p) {
    const k = l?.kind || (p?.propertyType === 'apartment' ? '아파트' : p?.propertyType ? '빌라' : null);
    return k === '아파트' ? '아파트' : '빌라';
  }

  function live(l, p, kind) {
    const out = [], area = num(l?.area) ?? num(p?.area?.sqm), age = num(l?.age), year = num(l?.year);
    if (area !== null) {
      const py = area / PYEONG, cls = area <= 60 ? '소형' : area <= 85 ? '중형(국민주택규모 85㎡ 이하)' : '국민주택규모(85㎡)를 넘는 넓은 편';
      out.push(line('neutral', `전용 ${py.toFixed(0)}평`, `전용 ${area.toFixed(1)}㎡(약 ${py.toFixed(1)}평) — ${cls}. 방 개수·구조는 자료에 없어 평면도로 확인하세요.`));
    }
    if (age !== null) {
      const it = l?.interior || {}, repair = num(it['부분수리']) !== null ? ` 수리비를 예산에 넣으세요: 부분 수리 약 ${won(it['부분수리'])}, 전체 수리 약 ${won(it['올수리'])}(평당 100만·180만 원 가정).` : '';
      const when = year ? `${year}년 준공, ` : '';
      if (age <= 10) out.push(line('neutral', `${age}년 된 건물`, `${when}${age}년 된 건물입니다. 신축 여부와 실제 하자·수리 상태는 현장에서 확인하세요.`));
      else if (age < 20) out.push(line('neutral', `${age}년 된 건물`, `${when}${age}년 된 건물입니다. 욕실·주방 수리 이력을 확인하세요.`));
      else if (age < 30) out.push(line('neutral', `${age}년 된 건물`, `${when}${age}년 된 건물입니다. 배관·창호 교체 여부를 확인하세요.${repair}`));
      else out.push(line('bad', `${age}년 된 구축`, `${when}${age}년 된 오래된 건물입니다.${repair || ' 수리비를 예산에 넣으세요.'}`, '수리비는 공표 통계가 아닌 계획용 가정'));
    }
    const st = l?.station, d = num(st?.dist_m);
    if (d !== null) {
      const walk = `${st.name || '가까운 역'}까지 직선 ${Math.round(d)}m — 걸어서 약 ${Math.ceil(d / WALK_M_PER_MIN)}분 이상`;
      if (d <= 500) out.push(line('good', `역 ${Math.round(d)}m`, `${walk}. 직선거리라 실제로는 조금 더 걸립니다.`, '브이월드 장소검색 좌표 기준'));
      else if (d <= 1000) out.push(line('neutral', `역 ${Math.round(d)}m`, `${walk}. 버스 연결도 확인하세요.`, '브이월드 장소검색 좌표 기준'));
      else out.push(line('bad', '역에서 멂', `${walk}. 역까지 버스를 타야 할 수 있습니다.`, '브이월드 장소검색 좌표 기준'));
    }
    const commute = num(l?.commute);
    const C = { 1: ['good', '잠실 40분 안쪽', '잠실역까지 환승 0~1회, 약 40분 안쪽입니다.'], 2: ['neutral', '잠실 40~60분', '잠실역까지 환승 1~2회, 약 40~60분입니다.'], 3: ['bad', '잠실 1시간 안팎', '잠실역까지 약 55~75분입니다.'], 4: ['bad', '잠실 통근 어려움', '잠실역까지 80분 넘게 걸리는 지역입니다.'] };
    if (C[commute]) out.push(line(C[commute][0], C[commute][1], C[commute][2], '노선을 보고 잡은 추정 — 실측 아님'));
    const stores = num(l?.stores), qs = Q[kind].stores;
    if (stores !== null) {
      if (stores >= qs[1]) out.push(line('good', '주변 가게 많음', `반경 250m 안 상가 ${stores}곳 — ${kind} 후보 중 많은 편(상위 25%)이라 장보기·생활이 편한 동네입니다.`, '소상공인시장진흥공단 상가(상권)정보 · 반경 250m'));
      else if (stores <= qs[0]) out.push(line('bad', '주변 가게 적음', `반경 250m 안 상가 ${stores}곳 — ${kind} 후보 중 적은 편(하위 25%)입니다. 조용할 수 있지만 생활 편의는 떨어집니다.`, '소상공인시장진흥공단 상가(상권)정보 · 반경 250m'));
      else out.push(line('neutral', `상가 ${stores}곳`, `반경 250m 안 상가 ${stores}곳 — ${kind} 후보 중 보통입니다.`, '소상공인시장진흥공단 상가(상권)정보 · 반경 250m'));
    }
    const hh = num(l?.households);
    if (hh !== null && kind === '아파트') {
      if (hh < Q.아파트.households[0]) out.push(line('bad', `${hh}세대 소단지`, `${hh}세대 작은 단지입니다. 관리비 부담이 크고, 팔 때 찾는 사람이 적을 수 있습니다.`, '건축물대장 세대수'));
      else if (hh >= Q.아파트.households[1]) out.push(line('good', `${hh.toLocaleString('ko-KR')}세대 대단지`, `${hh.toLocaleString('ko-KR')}세대 큰 단지입니다. 관리·편의시설과 되팔기에 유리한 편입니다.`, '건축물대장 세대수'));
      else out.push(line('neutral', `${hh}세대 단지`, `${hh}세대 중간 규모 단지입니다.`, '건축물대장 세대수'));
    } else if (hh !== null) out.push(line('neutral', `${hh}세대 건물`, `한 건물 ${hh}세대입니다.`, '건축물대장 세대수'));
    if (num(l?.mgmt) !== null) out.push(line('neutral', '관리비 가정', `관리비는 월 약 ${won(l.mgmt)}으로 잡았습니다(전용 ㎡당 ${kind === '아파트' ? '2,000' : '800'}원 가정, 난방·전기 별도). 관리사무소에 실제 금액을 물어보세요.`, '계획용 가정'));
    return out;
  }

  function price(l, kind) {
    const out = [], peer = l?.inv?.peer_price_comparison, samples = Array.isArray(l?.transaction_samples) ? l.transaction_samples : [];
    const bt = l?.buy && typeof l.buy === 'object' ? (Array.isArray(l.buy.types) ? l.buy.types[l.buy.main] : l.buy) : null;
    if (bt && num(bt.est) !== null) out.push(line('neutral', `추정 시세 ${won(bt.est)}`, `${bt.label || '대표 평형'}의 추정 시세는 ${won(bt.est)}입니다(같은 평형 최근 12개월 중개거래 ${num(bt.n12) ?? '?'}건을 지역 흐름으로 보정한 중간값, 기준층). 보통 ${won(bt.lo)}~${won(bt.hi)} 사이에서 거래됐습니다. 지금 파는 호가와는 다릅니다.`, '국토교통부 실거래 · 평형별 추정'));
    else if (num(l?.price) !== null) out.push(line('neutral', `최근 대표가 ${won(l.price)}`, `최근 90일 거래 ${num(l?.deals) ?? '?'}건의 중간값이 ${won(l.price)}입니다.${samples[0] ? ` 가장 최근 거래는 ${samples[0].date} ${won(samples[0].price_krw)}(${num(samples[0].area_m2)?.toFixed(1) ?? '?'}㎡, ${samples[0].floor ?? '?'}층)입니다.` : ''} 지금 파는 호가와는 다릅니다.`, '국토교통부 실거래 신고'));
    const bp = l?.buy && typeof l.buy === 'object' ? l.buy.peers : null;
    if (bp && num(bp.gap) !== null && num(bp.count) !== null) {
      const g = bp.gap * 100, villa = kind === '빌라', base = `같은 동의 비슷한 집(면적 ±20%·연식 ±10년) ${bp.count}곳의 추정 시세와 비교해 ㎡당 ${pct(g, 1)} ${g < 0 ? '쌉니다' : '비쌉니다'}`;
      const basis = '국토교통부 실거래 · 대표 평형 추정 시세 비교 · 층·향·수리상태 미조정';
      if (g <= Q.peerGap[0]) out.push(line(villa ? 'good' : 'neutral', `비슷한 집보다 ${pct(g)} 쌈`, `${base}. ${villa ? '빌라는 주변보다 싸게 거래된 집이 이후 손해가 적은 편이었습니다(자료 2년).' : '아파트에서는 주변보다 싸다는 것이 이후 손해율을 꾸준히 가르지 못했습니다.'} 층·상태 등 싼 이유를 확인하세요.`, basis));
      else if (g >= Q.peerGap[1]) out.push(line(villa ? 'bad' : 'neutral', `비슷한 집보다 ${pct(g)} 비쌈`, `${base}. 비싼 이유(층·향·수리)가 없으면 흥정 여지를 확인하세요.`, basis));
      else out.push(line('neutral', '비슷한 집과 비슷한 값', `${base}. 주변 시세 수준입니다.`, basis));
    } else if (peer?.status === 'available' && num(peer.gap_pct) !== null) {
      const g = peer.gap_pct, base = `같은 동·같은 유형·면적 ±20%·연식 ±10년 거래 ${peer.peer_count}건과 비교해 ㎡당 ${pct(g, 1)} ${g < 0 ? '낮게' : '높게'} 거래됐습니다`;
      if (g <= Q.peerGap[0]) out.push(line('good', `비슷한 집보다 ${pct(g)} 쌈`, `${base}. 과거 비교 거래 대비 낮은 가격일 뿐 현재 호가나 향후 상승을 뜻하지 않습니다. 층·상태 등 싼 이유를 확인하세요.`, '국토교통부 실거래 · 층·향·수리상태 미조정'));
      else if (g >= Q.peerGap[1]) out.push(line('bad', `비슷한 집보다 ${pct(g)} 비쌈`, `${base}. 비싸게 거래된 이유(층·향·수리)가 없으면 흥정 여지를 확인하세요.`, '국토교통부 실거래 · 층·향·수리상태 미조정'));
      else out.push(line('neutral', '비슷한 집과 비슷한 값', `${base}. 주변 시세 수준입니다.`, '국토교통부 실거래 · 층·향·수리상태 미조정'));
      if (num(peer.own_transaction_count) !== null && peer.own_transaction_count <= 2) out.push(line('neutral', '거래 적음', `이 집 거래가 ${peer.own_transaction_count}건뿐이라 한두 건에 값이 흔들릴 수 있습니다.`));
    }
    const nb = l?.market_signals?.neighborhood, m = num(nb?.recent_price_change_pct);
    if (m !== null) {
      const t = `이 동네 비슷한 집의 ㎡당 거래가가 최근 3개월에 직전 3개월보다 ${m >= 0 ? '+' : '−'}${pct(m, 1)} 움직였습니다`;
    const why = '2020~2026 실거래로 검증해 보니 동네 오름세가 이후 값을 맞히는 방향은 시기마다 뒤집혔습니다. 좋은 점·나쁜 점으로 세지 않습니다';
      if (m >= Q.momentum[1]) out.push(line('neutral', `동네 값 오름세 +${pct(m, 1)}`, `${t} — 후보 중 빠른 편(상위 25%). ${why}.`, '국토교통부 실거래 · 3개월 창 비교'));
      else if (m <= 0) out.push(line('neutral', '동네 값 흐름 약함', `${t} — 흐름이 약합니다. ${why}.`, '국토교통부 실거래 · 3개월 창 비교'));
      else out.push(line('neutral', `동네 값 +${pct(m, 1)}`, `${t}. ${why}.`, '국토교통부 실거래 · 3개월 창 비교'));
    }
    const j = num(l?.jeonse);
    if (j !== null && j >= 60) out.push(line('good', `전세가율 ${Math.round(j)}%`, `전세가가 매매가의 ${Math.round(j)}%입니다. 전세를 끼고 사면 처음 드는 현금이 크게 줄어듭니다${l?.regulated ? '(규제지역이면 실거주 의무부터 확인)' : ''}.`, '국토교통부 전월세 실거래'));
    if (l?.occupancy === '실거주 전용') out.push(line('neutral', '2년 실거주 의무', '토지거래허가구역이라 사면 2년은 직접 살아야 합니다. 전세를 끼고 살 수 없습니다.', '국토교통부 토지거래허가구역 지정'));
    return out;
  }

  function future(l, kind) {
    const out = [], age = num(l?.age), pz = l?.parcel_zone?.verdict, redev = l?.redev || {};
    if (pz === 'redevelopment_confirmed') out.push(line('good', '이 집 땅이 정비구역 안', `필지·고시 대조상 정비구역 포함 근거가 있습니다. 현재 단계, 이 매수자의 조합원 자격·승계 가능 여부와 추가분담금은 별도 원문 확인이 필요합니다.`, '토지이음 고시 · 필지 대조'));
    else if (pz === 'pre_designation') out.push(line('neutral', '구역 지정 전 행위제한', '건축행위 제한이 관측되지만 정비구역 지정 또는 사업 성사를 뜻하지 않습니다. 고시의 법적 효과를 확인하세요.', '토지이음 고시 · 필지 대조'));
    else if (pz === 'outside') out.push(line('neutral', '이 집 땅은 구역 밖', '이 집 필지는 정비구역 밖입니다. 아래 주변 사업은 동네 전체에 주는 간접 효과만 기대할 수 있습니다.', '토지이음 고시 · 필지 대조'));
    const entry = Array.isArray(redev.entry) ? redev.entry.filter(x => typeof x === 'string') : [], blocked = Array.isArray(redev.blocked) ? redev.blocked.filter(x => typeof x === 'string') : [];
    if (entry.length) out.push(line('neutral', `같은 동 정비사업 ${entry.length}건`, `같은 동에서 관측된 정비사업: ${entry.slice(0, 3).join(' / ')}${entry.length > 3 ? ` 외 ${entry.length - 3}건` : ''}. 이 집의 필지 편입·권리·수혜를 뜻하지는 않습니다.`, '서울 정비사업 정보몽땅·시청 자료'));
    if (blocked.length) out.push(line('neutral', `진행 단계 확인할 사업 ${blocked.length}건`, `같은 동에 권리 승계 제한을 확인해야 할 사업이 ${blocked.length}건 있습니다: ${blocked.slice(0, 2).join(' / ')}. 적용 여부는 사업·시점·매수자별로 확인하세요.`, '정비사업 공식 단계 · 개별 권리 확인 필요'));
    const far = num(l?.far_actual), cap = num(l?.far_cap), head = num(l?.far_headroom), zone = l?.zone;
    const farWhat = '용적률은 땅 넓이 대비 건물 바닥면적 합계입니다. 일반 상한과의 차이는 산술 참고값일 뿐 실제 허용 규모·사업성은 별도 확인이 필요합니다';
    if (far !== null && cap !== null && head !== null) {
      const base = `지금 용적률 ${far.toFixed(0)}%, 이 땅(${zone || '용도지역'}) 기준 상한 ${cap.toFixed(0)}%`;
      if (head >= 100) out.push(line('neutral', `용적률 차이 ${head.toFixed(0)}%p`, `${base} — 일반 상한과 ${head.toFixed(0)}%p 차이가 있지만 실제 추가 건축 가능 면적은 확인되지 않았습니다. (${farWhat}.)`, '건축물대장 · 브이월드 용도지역 · 일반 상한 참고값'));
      else if (head <= 0) out.push(line('bad', '용적률 여유 없음', `${base} — 이미 상한만큼(또는 넘게) 지어져 다시 지어도 늘릴 면적이 거의 없습니다. 재건축 기대는 약합니다. (${farWhat}.)`, '건축물대장 · 브이월드 용도지역 · 일반 상한 참고값'));
      else out.push(line('neutral', `용적률 여유 ${head.toFixed(0)}%p`, `${base} — 여유가 ${head.toFixed(0)}%p로 크지 않습니다. (${farWhat}.)`, '건축물대장 · 브이월드 용도지역 · 일반 상한 참고값'));
    } else if (far !== null) {
      const qf = Q[kind].far;
      const rel = far <= qf[0] ? `${kind} 후보 중 낮은 편(하위 25%)` : far >= qf[1] ? `${kind} 후보 중 높은 편(상위 25%)` : `${kind} 후보 중 보통`;
      out.push(line(far >= qf[1] ? 'bad' : 'neutral', `용적률 ${far.toFixed(0)}%`, `지금 용적률 ${far.toFixed(0)}% — ${rel}입니다. 이 땅의 상한은 확인하지 못했습니다. (${farWhat}.)`, '건축물대장 대표 건물 값'));
    }
    const land = num(l?.land_share), area = num(l?.area);
    if (land !== null && area && kind === '빌라') {
      const r = land / area, ql = Q.빌라.land;
      const registered=l?.land_share_evidence?.registered_verified===true;
      const txt = `대지권 참고 면적 ${land.toFixed(1)}㎡(전용의 ${r.toFixed(2)}배) — ${registered?'등기 확인 자료':'해당 호실 등기 대지권과 권리가액은 미확인'}입니다`;
      out.push(line(registered&&r >= ql[1] ? 'good' : r <= ql[0] ? 'bad' : 'neutral', r >= ql[1] ? '대지권 참고 면적 큰 편' : r <= ql[0] ? '대지권 참고 면적 작은 편' : `대지권 참고 ${land.toFixed(0)}㎡`, `${txt}. 빌라 후보 중 ${r >= ql[1] ? '상위 25%' : r <= ql[0] ? '하위 25%' : '중간 범위'}입니다.`, l?.land_share_basis || '신고·추정 대지권면적 · 등기 미검증'));
    }
    const old = num(l?.old_share), qo = Q[kind].oldShare;
    if (old !== null) {
      const t = `이 동네에서 거래된 건물 중 ${Math.round(old)}%가 30년 넘은 건물입니다`;
      if (old >= qo[1]) out.push(line('neutral', `동네 노후도 ${Math.round(old)}%`, `${t} — 거래 표본의 노후 비율일 뿐 정비구역의 법정 노후도나 향후 가격 상승 근거는 아닙니다.`, '국토교통부 실거래 건축연도 집계'));
      else if (old <= qo[0]) out.push(line('neutral', `동네 노후도 ${Math.round(old)}%`, `${t} — 새 건물이 많은 동네라 동네 전체 재개발 가능성은 낮은 편입니다.`, '국토교통부 실거래 건축연도 집계'));
      else out.push(line('neutral', `동네 노후도 ${Math.round(old)}%`, `${t}.`, '국토교통부 실거래 건축연도 집계'));
    }
    if (age !== null && age >= 30 && !out.some(x => x.tone === 'good')) out.push(line('neutral', '오래됐지만 개발 근거 약함', `${age}년 된 건물이지만 위 자료로는 재건축·재개발 근거가 약합니다. '오래됐으니 곧 재건축'을 기대하기보다 살기 편한지로 판단하세요.`));
    return out;
  }

  function visit(l) {
    return [
      line('neutral', '외관·내부 상태', '건물 외관, 집 안 상태, 수리 이력은 자료에 없습니다. 아래 사진 버튼(로드뷰·매물 사진)으로 먼저 보고, 방문해서 확인하세요.'),
      line('neutral', '구조·향·주차', '방 개수, 구조, 향, 주차, 엘리베이터 여부는 자료에 없습니다. 매물 정보와 방문으로 확인하세요.'),
      line('neutral', '동네 체감', '소음, 경사, 학교, 밤길은 자료에 없습니다. 낮과 저녁에 한 번씩 걸어 보세요.'),
      line('neutral', '지금 파는지', `지금 매물이 있는지, 호가가 얼마인지는 자료에 없습니다(확인된 온라인 호가 ${num(l?.observed_listing_count) ?? 0}건). 중개사에게 확인하세요.`)
    ];
  }

  // complete=false: 상세 자료 전(목록용 공개 색인 일부만) — 연식·용적률·가격 비교가 비어 있을 수 있다.
  function build({ property = null, legacy = null, complete = !!legacy, suppressLegacyCommute = false } = {}) {
    const kind = kindOf(legacy, property);
    const sections = [
      { key: 'live', title: '들어가 살 만한가', lines: live(suppressLegacyCommute&&legacy?{...legacy,commute:null}:legacy, property, kind) },
      { key: 'price', title: '값은 적당한가', lines: price(legacy, kind) },
      { key: 'future', title: '앞으로 값이 버틸까·오를까', lines: future(legacy, kind) },
      { key: 'visit', title: '직접 봐야 아는 것', lines: visit(legacy) }
    ];
    const pick = tone => sections.slice(0, 3).flatMap(s => s.lines.filter(x => x.tone === tone).map(x => x.label));
    return { version: VERSION, kind, complete: !!complete, good: pick('good').slice(0, 4), bad: pick('bad').slice(0, 3), sections };
  }

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const MARK = { good: '✓', bad: '✗', neutral: '·' };
  function html(story) {
    if (!story) return '';
    const head = `<div class="story-head"><h2>이 집, 내가 산다면</h2><p class="help">점수 대신 들어가 살 사람의 네 가지 질문에 답했습니다. 좋다·나쁘다는 수집된 같은 유형 후보 안의 상대 비교이며, 실제 생활 상태는 별도 확인이 필요합니다.</p>${story.good.length || story.bad.length ? `<p class="story-chips">${story.good.map(x => `<span class="story-good">✓ ${esc(x)}</span>`).join('')}${story.bad.map(x => `<span class="story-bad">✗ ${esc(x)}</span>`).join('')}</p>` : ''}</div>`;
    const lineHtml = x => `<li class="story-${x.tone}"><span class="story-mark" aria-hidden="true">${MARK[x.tone]}</span><div><strong>${esc(x.label)}</strong><p>${esc(x.text)}</p>${x.basis ? `<small>${esc(x.basis)}</small>` : ''}</div></li>`;
    const body = story.sections.map(s => `<section class="story-section story-${s.key}"><h3>${esc(s.title)}</h3>${s.lines.length ? `<ul>${s.lines.slice(0,3).map(lineHtml).join('')}</ul>${s.lines.length>3?`<details data-disclosure="story-${s.key}"><summary>나머지 ${s.lines.length-3}가지도 보기</summary><ul>${s.lines.slice(3).map(lineHtml).join('')}</ul></details>`:''}` : '<p class="help">판단할 자료가 아직 부족해요. 현장과 원문에서 확인해 주세요.</p>'}</section>`).join('');
    return `<section class="panel home-story" id="section-story" data-home-story="${esc(story.version)}">${head}${story.complete ? '' : '<p class="notice">상세 자료를 불러오는 중입니다. 잠시 뒤 연식·용적률·주변 사업이 채워집니다.</p>'}<div class="story-grid">${body}</div></section>`;
  }
  return Object.freeze({ VERSION, Q, build, html });
});
