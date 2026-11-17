/* Public notices only. No household profile, credentials or application submission. */
(function(root){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data=null,error=null,pending=null,refreshError=false;
const filters={query:'',region:'metro',status:'active'};
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
function schedules(n){const rows=n.lh_detail?.application_schedules||n.application_schedules||[];const specific=rows.filter(x=>x.label!=='접수 전체');return specific.length?specific:rows;}
function status(n,day=today()){
 if(n.superseded_by)return 'revised';
 const dates=schedules(n).filter(x=>x.start_date&&x.end_date);
 if(!dates.length)return n.source==='lh'&&n.source_status==='공고중'?'announcement':'unknown';
 if(dates.some(x=>x.start_date<=day&&day<=x.end_date))return 'current';
 if(dates.some(x=>x.start_date>day))return 'upcoming';
 return 'closed';
}
function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&['www.applyhome.co.kr','applyhome.co.kr','apply.lh.or.kr'].includes(u.hostname)&&!u.username&&!u.password?u.href:null}catch{return null}}
function external(url,label){const href=safeUrl(url);return href?`<a class="button compact" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`:''}
function formatPrice(value){return Number.isFinite(value)&&value>0?`${(value/1e8).toLocaleString('ko-KR',{maximumFractionDigits:2})}억원`:null;}
function priceSummary(n){const highest=(n.models||[]).map(x=>x.max_supply_price_krw).filter(x=>Number.isFinite(x)&&x>0);const lh=n.lh_detail||n;const average=(lh.models||[]).map(x=>x.average_supply_price_krw).filter(x=>Number.isFinite(x)&&x>0);const parts=[];
 if(highest.length)parts.push(`주택형별 최고분양금액 ${formatPrice(Math.min(...highest))}${Math.min(...highest)!==Math.max(...highest)?' ~ '+formatPrice(Math.max(...highest)):''}`);
 if(average.length)parts.push(`LH 주택형별 평균분양가격 ${formatPrice(Math.min(...average))}${Math.min(...average)!==Math.max(...average)?' ~ '+formatPrice(Math.max(...average)):''}`);
 return parts.length?parts.join(' · '):'분양금액은 공식 공고에서 확인';
}
function matches(n,day=today()){
 const s=status(n,day);if(filters.status==='active'&&!['current','upcoming','announcement'].includes(s))return false;
 if(filters.status!=='active'&&s!==filters.status)return false;
 if(filters.region==='metro'&&!['서울','경기','인천'].includes(n.region))return false;
 if(!['metro','all'].includes(filters.region)&&n.region!==filters.region)return false;
 return `${n.name} ${n.address||''}`.toLowerCase().includes(filters.query.toLowerCase());
}
function card(n){const s=status(n),lh=n.lh_detail||(n.source==='lh'?n:null);const label={current:'접수 일정 중',upcoming:'접수 예정',closed:'접수 일정 경과',announcement:'LH 공고중 · 원문 일정 확인',unknown:'일정 확인 필요'}[s];
 const rows=schedules(n);const schedule=rows.map(x=>`<li><strong>${esc(x.label)}</strong> ${esc(x.start_date)}${x.start_time?' '+esc(x.start_time):''} ~ ${esc(x.end_date)}${x.end_time?' '+esc(x.end_time):''}</li>`).join('');
 const models=(n.models||[]).map(x=>`<tr><td>${esc(x.house_type)}</td><td>${esc(x.exclusive_area_m2??x.supply_area_m2??'—')}${x.exclusive_area_m2?' (전용)':x.supply_area_m2?' (공급)':''}</td><td>${esc(Number.isFinite(x.max_supply_price_krw??x.average_supply_price_krw)?(x.max_supply_price_krw??x.average_supply_price_krw).toLocaleString('ko-KR')+'원':'공고 확인')}</td><td>${x.average_supply_price_krw?'LH 평균분양가격':'청약홈 최고분양금액'}</td></tr>`).join('');
 const averages=n.lh_detail?(n.lh_detail.models||[]).map(x=>`<tr><td>${esc(x.house_type)}</td><td>${esc(x.exclusive_area_m2)} (전용)</td><td>${esc(Number.isFinite(x.average_supply_price_krw)?x.average_supply_price_krw.toLocaleString('ko-KR')+'원':'공고 확인')}</td><td>LH 평균분양가격</td></tr>`).join(''):'';
 const visual=(lh?.images||[]).find(x=>safeUrl(x.url)&&x.url.startsWith('https://apply.lh.or.kr/upload/Files/'));const image=visual?`<figure class="subscription-visual"><a href="${esc(safeUrl(visual.source_url))}" target="_blank" rel="noopener noreferrer"><img src="${esc(visual.url)}" alt="${esc(visual.caption)}" loading="lazy" referrerpolicy="no-referrer"></a><figcaption>${esc(visual.caption)} · 출처 LH</figcaption></figure>`:'';const materials=lh?.materials||[];return `<article class="panel subscription-card"><div class="subscription-meta"><span class="badge ${s==='current'?'confirmed':'calculated'}">${label}</span><span>${esc(n.region)} · ${n.source==='lh'?'LH':'청약홈'}${n.lh_detail?' + LH':''}</span></div><h2>${esc(n.name)}</h2>${image}<p class="subscription-price">${esc(priceSummary(n))}</p><p class="help">공고 ${esc(n.publication_date)}${n.move_in_month_raw?' · 입주예정 '+esc(String(n.move_in_month_raw).replace(/^(\d{4})-?(\d{2})$/, '$1년 $2월')):''}</p><ul class="subscription-dates">${schedule}</ul><div class="actions">${external(n.official_notice_url,n.link_kind==='LIST_FIND_BY_NAME'?'LH 목록에서 공고 찾기':'공식 공고 보기')}${lh?external(lh.official_notice_url,'LH 공고·도면 보기'):''}</div><details><summary>면적별 가격·신청 전 준비사항</summary><div class="subscription-table"><table><thead><tr><th>주택형</th><th>면적 ㎡</th><th>금액</th><th>가격 기준</th></tr></thead><tbody>${models}${averages}</tbody></table></div><p class="help">표시 금액의 기준은 평균 또는 최고분양금액입니다. 옵션·계약 동호별 가격과 계약금·중도금·잔금은 공고문에서 확인하세요.</p><p>공고일 기준 자격 → 계약 전 마련할 돈 → 입주 시 대출과 월 부담 → 전매·거주 조건 순서로 확인하세요.</p>${materials.length?`<p>공식 자료: ${materials.map(x=>esc(x.name)).join(' · ')}</p>`:'<p>사진·평면도는 공식 공고와 분양 자료에서 확인하세요.</p>'}<p class="help">신청 자격과 5·10년 투자 수익은 아직 평가하지 않았습니다. 실제 접수 시간·휴일 운영은 공식 접수처에서 확인하세요.</p></details></article>`;
}
function draw(){const el=root.document?.getElementById('subscriptions-panel');if(!el)return;
 if(!data){el.innerHTML=error?'<div class="panel"><h2>청약 자료를 불러오지 못했습니다.</h2><p>공고가 없다는 뜻은 아닙니다.</p><button data-sub-retry>다시 읽기</button></div>':'<p role="status">공식 청약 자료를 불러오는 중입니다.</p>';el.querySelector('[data-sub-retry]')?.addEventListener('click',()=>{error=null;pending=null;load()});return}
 const day=today();const selected=data.notices.filter(x=>matches(x,day)).sort((a,b)=>{const order={current:0,upcoming:1,announcement:2,closed:3};const sa=order[status(a,day)]??4,sb=order[status(b,day)]??4;return sa-sb||(sa===3?b.publication_date.localeCompare(a.publication_date):0)||(schedules(a).filter(x=>x.end_date>=day).map(x=>x.start_date).sort()[0]||'9999').localeCompare(schedules(b).filter(x=>x.end_date>=day).map(x=>x.start_date).sort()[0]||'9999')||a.name.localeCompare(b.name)});
 const stale=Date.now()-Date.parse(data.applyhome_fetched_at)>24*3600000;
 el.innerHTML=`<header class="page-head"><div><p class="eyebrow">실거주와 내 집 마련</p><h1>새 아파트 청약, 일정을 놓치지 마세요</h1><p class="muted">일정과 분양금액을 보고, 공식 공고에서 자격과 돈 일정을 확인하세요.</p></div></header><div class="notice ${stale||refreshError?'warning':''}"><strong>${stale||refreshError?'마지막 정상 수집 자료':'공식 공고 업데이트'}</strong> · 청약홈 ${esc(data.applyhome_fetched_at.slice(0,16).replace('T',' '))} · LH 확인 ${esc(data.lh_observed_at.slice(0,10))}<p class="help">청약홈: 최근 1년 게시 공고. LH: ${data.lh_collection_mode==='PUBLIC_WEB_REFRESH'?'공개 분양공고 자동 수집':'상세 2건 확인 표본'}. 유형별 접수일이 없는 LH 공고는 원문 일정을 확인하세요. 전국 전체 청약을 포함하지 않습니다.${refreshError?' 최근 갱신이 실패했습니다.':''}${stale?' 수집 후 하루가 지나 최신 변경을 다시 확인해야 합니다.':''}</p></div><form class="subscription-filters"><div class="field"><label for="sub-search">단지·주소 검색</label><input id="sub-search" name="query" value="${esc(filters.query)}" placeholder="예: 과천, 신혼희망"></div><div class="field"><label for="sub-region">지역</label><select id="sub-region" name="region">${[['metro','수도권'],['all','전국'],['서울','서울'],['경기','경기'],['인천','인천']].map(([v,l])=>`<option value="${v}" ${filters.region===v?'selected':''}>${l}</option>`).join('')}</select></div><div class="field"><label for="sub-status">접수 일정</label><select id="sub-status" name="status">${[['active','현재·예정'],['upcoming','예정'],['current','접수 일정 중'],['closed','일정 경과'],['announcement','LH 공고중 · 원문 확인']].map(([v,l])=>`<option value="${v}" ${filters.status===v?'selected':''}>${l}</option>`).join('')}</select></div><button type="submit">찾기</button><button type="button" data-sub-refresh>최신 수집 자료 읽기</button></form><p role="status">${selected.length}건 · ${esc(day)} 기준 날짜 분류 · 투자 추천 순위가 아닙니다.</p><div class="subscription-grid">${selected.slice(0,80).map(card).join('')||'<div class="panel"><h2>선택한 조건에 해당하는 공고가 없습니다.</h2><p>지역이나 접수 일정 범위를 바꿔보세요.</p></div>'}</div>${selected.length>80?'<p>최근 80건을 표시했습니다. 단지 이름으로 검색하면 범위를 좁힐 수 있습니다.</p>':''}<p class="help">사진을 임의로 생성하지 않습니다. 조감도·평면도·팸플릿은 각 공식 공고에서 볼 수 있습니다.</p>`;
 el.querySelector('form').addEventListener('submit',e=>{e.preventDefault();const values=new FormData(e.target);for(const key of Object.keys(filters))filters[key]=String(values.get(key)||'');draw()});
 el.querySelector('[data-sub-refresh]').addEventListener('click',()=>{pending=null;load()});
}
async function load(){if(pending)return pending;pending=(async()=>{try{const response=await root.fetch('subscriptions.json',{cache:'no-store'});if(!response.ok)throw Error('HTTP');const next=await response.json();if(next.schema_version!=='subscription-public-1'||!Array.isArray(next.notices))throw Error('CONTRACT');data=next;error=null;try{const statusResponse=await root.fetch('refresh-status.json',{cache:'no-store'});refreshError=statusResponse.ok&&(await statusResponse.json()).status==='FAILED'}catch{} }catch{error='LOAD_FAILED';refreshError=Boolean(data)}draw()})();return pending;}
if(root.document)root.setInterval(()=>{if(root.document.getElementById('subscriptions-panel')){pending=null;load()}},60000);
const api={view:()=>'<section id="subscriptions-panel" aria-label="청약 공고"></section>',afterRender:()=>{draw();load()},status,schedules,safeUrl,priceSummary,filters,matches};
root.WorkspaceSubscriptions=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='undefined'?globalThis:window);
