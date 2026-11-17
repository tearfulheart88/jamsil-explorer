/* Geographic browsing only: preserve the existing investment order and loan model. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./workspace-loan-estimate.js'):root.WorkspaceLoanEstimate);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.WorkspaceRegions=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(loan){
  'use strict';
  const VERIFIED_AT='2026-09-20';
  const SOURCE='https://rt.molit.go.kr/pt/gis/gis.do';
  const GYEONGGI=new Set(['가평','고양','과천','광명','광주','구리','군포','김포','남양주','동두천','부천','성남','수원','시흥','안산','안성','안양','양주','양평','여주','연천','오산','용인','의왕','의정부','이천','파주','평택','포천','하남','화성']);
  function info(property){
    const p=typeof property==='string'?{regionCode:property}:property||{};
    let code=String(p.regionCode||'').trim();
    if(/^\d+$/.test(code)){
      const head=String(p.id||'').split('|')[0].trim();
      if(/[가-힣]/.test(head))code=head;
    }
    const tokens=code.replace(/^서울특별시\s+/,'서울 ').replace(/^인천광역시\s+/,'인천 ').replace(/^경기도\s+/,'경기 ').split(/\s+/);
    let province='',city='',district='';
    const geography=loan.geography(code);
    if(geography.capitalArea===false){
      province=geography.province;city=tokens[1]||'전역';district=tokens[2]||'';
    }else if(tokens[0]==='서울'||tokens[0]==='인천'){
      province=tokens[0];city=tokens[1]||'';
      if(!/(구|군)$/.test(city))city='';
    }else{
      const t=tokens[0]==='경기'?tokens.slice(1):tokens;
      const stem=(t[0]||'').replace(/(시|군)$/,'');
      if(GYEONGGI.has(stem)){
        province='경기';city=stem+(['가평','양평','연천'].includes(stem)?'군':'시');
        district=/(구)$/.test(t[1]||'')?t[1]:'';
      }
    }
    const canonical=province==='경기'?(district?`${city.replace(/시$/,'')} ${district}`:city):province&&city?`${province} ${city}`:code;
    const regulated=loan?.regulation(canonical)?.regulated??null;
    return {province,city,district,canonical,regulated,groupKey:province&&city?`${province} ${city}`:'지역 확인 필요',regionCode:String(p.regionCode||code)};
  }
  function matches(property,filters={}){
    const r=info(property);
    if(filters.province&&r.province!==filters.province)return false;
    if(filters.city&&r.city!==filters.city)return false;
    if(filters.regulation==='regulated'&&r.regulated!==true)return false;
    if(filters.regulation==='nonregulated'&&r.regulated!==false)return false;
    if(filters.regulation==='unknown'&&r.regulated!==null)return false;
    return true;
  }
  function facets(properties,filters={}){
    const list=properties.map(info),sorted=a=>[...new Set(a.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
    return {provinces:sorted(list.map(r=>r.province)),cities:sorted(list.filter(r=>!filters.province||r.province===filters.province).map(r=>r.city)),regions:[...new Map(list.filter(r=>(!filters.province||r.province===filters.province)&&(!filters.city||r.city===filters.city)).map(r=>[r.regionCode,r.canonical])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'ko'))};
  }
  function groupRows(rows){
    const groups=new Map();
    for(const row of rows){const r=info(row.property);if(!groups.has(r.groupKey))groups.set(r.groupKey,{key:r.groupKey,province:r.province,city:r.city,rows:[],regionCodes:[],statuses:new Set()});const g=groups.get(r.groupKey);g.rows.push(row);g.regionCodes.push(r.regionCode);g.statuses.add(r.regulated)}
    return [...groups.values()].map(g=>({...g,regionCodes:[...new Set(g.regionCodes)],regulationLabel:g.statuses.has(null)?'규제 여부 확인 필요':g.statuses.size>1?'규제·비규제 혼재':g.statuses.has(true)?'규제지역':'비규제지역'})).sort((a,b)=>a.key.localeCompare(b.key,'ko'));
  }
  const regulationLabel=p=>info(p).regulated===true?'규제지역':info(p).regulated===false?'비규제지역':'규제 여부 확인 필요';
  return {VERIFIED_AT,SOURCE,info,matches,facets,groupRows,regulationLabel};
});
