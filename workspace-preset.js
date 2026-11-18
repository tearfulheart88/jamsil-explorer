/* 개인 링크로 예산 넣기 (2026-11-18, 대표님: "기억하고 있는 예산을 넣어줘 · 여러 번 작업하게 하지 마").
 *
 * 저장은 브라우저·주소마다 따로라, 주소가 바뀌거나 다른 기기에서 열면 예산을 다시 넣어야 했다.
 * 주소 끝의 `~me=<값>` 조각을 읽어 이 기기에 저장하고, 곧바로 주소에서 지운다.
 *   - `#` 뒤 조각은 서버로 전송되지 않는다. 사이트 서버·공개 자료에는 아무것도 남지 않는다.
 *   - 숫자·참거짓·정해진 선택지만 받는다(글자는 받지 않는다). 이미 저장된 예산이 있으면 바꾸기 전에 묻는다.
 *   - 화면 시작(workspace-ui.js) 전에 실행되어야 하므로 workspace.html 에서 그 앞에 둔다.
 * 링크에는 개인 자금이 담기므로 남에게 전달하면 안 된다 — 공유는 조각 없는 주소로 한다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.WorkspacePreset = api; api.run(root); }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MARK = '~me=', MAX_KRW = 1e12, MAX_DEBTS = 5;
  const krw = v => (Number.isSafeInteger(v) && v >= 0 && v <= MAX_KRW ? v : null);

  function toBase64Url(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromBase64Url(text) {
    let s = String(text).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)));
  }
  // 받은 값에서 아는 항목만, 범위 안의 숫자만 남긴다. 하나라도 이상하면 통째로 버린다.
  function sanitize(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o) || o.v !== 1) return null;
    const cash = krw(o.cash), reserve = o.reserve == null ? null : krw(o.reserve), income = o.income == null ? null : krw(o.income);
    if (cash === null || (o.reserve != null && reserve === null) || (o.income != null && income === null)) return null;
    const list = Array.isArray(o.debts) ? o.debts : [];
    if (list.length > MAX_DEBTS) return null;
    const debts = [];
    for (const d of list) {
      if (!d || typeof d !== 'object') return null;
      const balance = krw(d.balance), limit = d.limit == null ? null : krw(d.limit), rate = d.rate == null ? null : d.rate;
      if (balance === null || (d.limit != null && limit === null)) return null;
      if (rate !== null && !(typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= 1)) return null;
      if (limit !== null && limit < balance) return null;
      debts.push({ balance, limit, rate });
    }
    return { v: 1, cash, reserve, income, debts, noDebt: o.noDebt === true && !debts.length,
      first: o.first === true ? true : o.first === false ? false : null, housing: ['none', 'owned'].includes(o.housing) ? o.housing : null };
  }
  const encode = preset => { const p = sanitize(preset); return p ? toBase64Url(JSON.stringify(p)) : null; };
  function decode(payload) { try { return sanitize(JSON.parse(fromBase64Url(payload))); } catch { return null; } }
  // '#/best~me=...' → { hash: '#/best', payload: '...' }
  function split(hash) {
    const h = String(hash || ''), i = h.indexOf(MARK);
    return i < 0 ? { hash: h, payload: null } : { hash: i > 1 ? h.slice(0, i) : '#/', payload: h.slice(i + MARK.length) };
  }
  const money = v => (v === null ? null : String(v));
  function toProfile(preset, empty) {
    return { ...empty, persistOnDevice: true, cashAvailableKrw: money(preset.cash), reserveKrw: money(preset.reserve), annualGrossIncomeKrw: money(preset.income),
      noDebtConfirmed: preset.noDebt, debts: preset.debts.map((d, i) => ({ id: 'd' + (i + 1), balanceKrw: money(d.balance), creditLimitKrw: money(d.limit), annualNominalRate: d.rate, monthlyPaymentKrw: null, maturityDate: null })) };
  }
  // 저장까지 한다. 돌려주는 값: 'none'(조각 없음) | 'saved' | 'kept'(기존 예산 유지) | 'invalid' | 'demo' | 'failed'
  function apply(root) {
    const loc = root.location, s = split(loc.hash);
    if (s.payload === null) return 'none';
    root.history.replaceState(null, '', loc.pathname + loc.search + s.hash);       // 주소에서 먼저 지운다
    if (new URLSearchParams(loc.search).get('mode') === 'demo') return 'demo';
    const preset = decode(s.payload);
    if (!preset) return 'invalid';
    try {
      const C = root.WorkspaceCore, L = root.WorkspaceLoanEstimate, storage = root.localStorage, store = new C.ProfileStore(storage, 'live'), saved = store.readSaved();
      if (saved && saved.cashAvailableKrw != null && !root.confirm('이 기기에 저장된 예산이 있습니다. 링크에 담긴 예산으로 바꿀까요?')) return 'kept';
      store.save(toProfile(preset, C.emptyProfile()));
      if (L) L.saveSettings(storage, 'live', { ...L.loadSettings(storage, 'live'), ...(preset.first === null ? {} : { firstTimeBuyer: preset.first }), ...(preset.housing ? { housingStatus: preset.housing } : {}) });
      return 'saved';
    } catch { return 'failed'; }
  }
  function run(root) {
    if (!root.location || !root.history || !root.addEventListener) return;
    apply(root);
    // 이미 열려 있는 화면에서 개인 링크를 누른 경우: 저장하고 새로 읽는다.
    root.addEventListener('hashchange', () => { if (String(root.location.hash).includes(MARK) && apply(root) === 'saved') root.location.reload(); });
  }
  return Object.freeze({ MARK, sanitize, encode, decode, split, toProfile, apply, run });
});
