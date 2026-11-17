/* User-entered cash-flow assumptions only; no price forecast or tax determination.
 * Pure calculation API is also exported for regression tests. No network/storage.
 */
(function (root) {
  'use strict';
  const blank = value => value == null || (typeof value === 'string' && value.trim() === '');
  const read = (value, fallback) => blank(value) ? fallback : Number(value);
  const won = value => Math.round(value).toLocaleString('ko-KR') + '원';

  function amortization(principal, annualRatePct, termYears, months) {
    if (![principal, annualRatePct, termYears, months].every(Number.isFinite) ||
        principal < 0 || annualRatePct < 0 || annualRatePct > 100 || termYears <= 0 ||
        termYears > 60 || months < 0 || months > 720 || !Number.isInteger(months)) {
      throw new RangeError('대출금·금리·만기·보유기간을 확인해 주세요.');
    }
    const term = Math.round(termYears * 12), rate = annualRatePct / 1200;
    if (term < 1) throw new RangeError('대출 만기는 1개월 이상이어야 합니다.');
    const scheduled = principal === 0 ? 0 : rate === 0 ? principal / term :
      principal * rate / -Math.expm1(-term * Math.log1p(rate));
    let balance = principal, interestPaid = 0, totalPaid = 0;
    const payments = [];
    for (let month = 0; month < months; month++) {
      const interest = month < term ? balance * rate : 0;
      const payment = month >= term || balance <= 0 ? 0 :
        month === term - 1 ? balance + interest : Math.min(scheduled, balance + interest);
      balance = Math.max(0, balance + interest - payment);
      interestPaid += interest;
      totalPaid += payment;
      payments.push(payment);
    }
    return {remainingLoan: balance, principalPaid: principal - balance, interestPaid,
      totalPaid, scheduledMonthly: scheduled, payments};
  }

  function calculate(it, fin, assumptions = {}) {
    const price = read(it && it.price, NaN), loan = read(fin && fin.loan, NaN);
    const initialCapital = read(fin && fin.cash, NaN);
    const mortgageRate = read(fin && fin.mortgageRate, NaN), loanYears = read(fin && fin.loanYears, NaN);
    const years = read(assumptions.holdingYears, 5);
    const annualNetRent = read(assumptions.annualNetRent, 0);
    const annualHoldingCost = read(assumptions.annualHoldingCost, 0);
    const saleCosts = read(assumptions.saleCosts, 0);
    const taxKnown = !blank(assumptions.capitalGainsTax);
    const capitalGainsTax = read(assumptions.capitalGainsTax, 0);
    const salePrice = read(assumptions.salePrice, null);
    const all = [price, loan, initialCapital, mortgageRate, loanYears, years,
      annualNetRent, annualHoldingCost, saleCosts, capitalGainsTax];
    if (!all.every(Number.isFinite) || price <= 0 || loan < 0 || loan > price || initialCapital < 0 ||
        mortgageRate < 0 || mortgageRate > 100 || loanYears <= 0 || loanYears > 60 || Math.round(loanYears * 12) < 1 ||
        years < 1 / 12 || years > 60 || annualHoldingCost < 0 || saleCosts < 0 || capitalGainsTax < 0 ||
        (salePrice !== null && (!Number.isFinite(salePrice) || salePrice <= 0))) {
      return {status: 'invalid', message: '가격·금액·기간을 확인해 주세요. 보유기간은 1개월~60년, 비용은 0 이상입니다.'};
    }
    if (salePrice === null) return {status: 'pending', message: '미래 매도가를 직접 입력하면 손익 가정을 계산합니다. 자동 가격 예측은 하지 않습니다.'};
    const months = Math.round(years * 12);
    const mortgage = amortization(loan, mortgageRate, loanYears, months);
    let cumulativeNetCashFlow = 0, lowestCashBalance = 0;
    for (const payment of mortgage.payments) {
      cumulativeNetCashFlow += (annualNetRent - annualHoldingCost) / 12 - payment;
      lowestCashBalance = Math.min(lowestCashBalance, cumulativeNetCashFlow);
    }
    // Principal has already been paid through monthly cash flow. Only its remaining
    // balance is deducted at exit; deducting original principal again would double count.
    const netSaleProceeds = salePrice - mortgage.remainingLoan - saleCosts - capitalGainsTax;
    const holdingAdditionalCashNeeded = -lowestCashBalance;
    // A sale below the remaining debt/costs may require more cash at closing.
    lowestCashBalance = Math.min(lowestCashBalance, cumulativeNetCashFlow + netSaleProceeds);
    const additionalCashNeeded = -lowestCashBalance;
    const saleClosingCashNeeded = Math.max(0, additionalCashNeeded - holdingAdditionalCashNeeded);
    const profit = netSaleProceeds + cumulativeNetCashFlow - initialCapital;
    return {status: taxKnown ? 'tax_entered' : 'pre_tax', months, initialCapital,
      salePrice, saleCosts, capitalGainsTax, taxKnown,
      remainingLoan: mortgage.remainingLoan, mortgagePayments: mortgage.totalPaid,
      principalPaid: mortgage.principalPaid, interestPaid: mortgage.interestPaid,
      netSaleProceeds, cumulativeNetCashFlow, additionalCashNeeded,
      holdingAdditionalCashNeeded, saleClosingCashNeeded,
      totalCashRequired: initialCapital + additionalCashNeeded, profit,
      omittedSaleCosts: blank(assumptions.saleCosts),
      omittedHoldingCosts: blank(assumptions.annualHoldingCost)};
  }

  function render(it, fin, hostEl) {
    if (!hostEl || !hostEl.ownerDocument) return;
    const doc = hostEl.ownerDocument, details = doc.createElement('details');
    details.className = 'investment-scenario';
    const mgmt = Number(it && it.mgmt);
    const defaultAnnualCost = Number.isFinite(mgmt) && mgmt >= 0 ? mgmt * 12 : 0;
    const baseline = Number(it && it.price);
    details.innerHTML = `<style>
      .investment-scenario{margin:16px 0;border:1px solid #cbd5e1;border-radius:12px;background:#f8fafc;color:#263449}
      .investment-scenario summary{cursor:pointer;padding:14px 16px;font-weight:700;font-size:14px}
      .investment-scenario .isc-body{padding:0 16px 16px;font-size:12px;line-height:1.6}
      .investment-scenario .isc-note{color:#64748b;margin:4px 0 12px}
      .investment-scenario .isc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .investment-scenario label{display:block;font-size:12px}
      .investment-scenario input{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:8px;border:1px solid #cbd5e1;border-radius:7px;background:white;color:#0f172a;font:inherit}
      .investment-scenario input:focus{outline:2px solid #3b82f6;outline-offset:1px}
      .investment-scenario .isc-result{margin-top:14px;padding:12px;border-radius:8px;background:white;border:1px solid #e2e8f0}
      .investment-scenario .isc-row{display:flex;justify-content:space-between;gap:10px;margin:5px 0}
      .investment-scenario .isc-profit{border-top:1px solid #e2e8f0;padding-top:9px;margin-top:9px;font-weight:700}
      .investment-scenario .isc-small{font-size:11px;color:#64748b;margin:8px 0 0}
      @media(max-width:420px){.investment-scenario .isc-grid{grid-template-columns:1fr}}
    </style>
    <summary>미래 매도가에 따른 손익 가정</summary>
    <div class="isc-body">
      <p class="isc-note">매입 기준은 과거 대표 실거래 ${Number.isFinite(baseline) ? won(baseline) : '미확인'}입니다. 현재 매물 호가가 아닙니다. 위 자금계획의 대출·취득비 가정을 함께 사용합니다.</p>
      <div class="isc-grid">
        <label>가정할 미래 매도가 (만원)<input data-field="salePrice" type="number" inputmode="decimal" min="0" step="any" placeholder="직접 입력 · 예측값 없음"></label>
        <label>보유기간 (년)<input data-field="holdingYears" type="number" inputmode="decimal" min="0.1" max="60" step="any" value="5"></label>
        <label>연간 순임대소득 (만원)<input data-field="annualNetRent" type="number" inputmode="decimal" step="any" value="0"></label>
        <label>연간 별도 보유비용 (만원)<input data-field="annualHoldingCost" type="number" inputmode="decimal" min="0" step="any" value="${Number((defaultAnnualCost / 10000).toFixed(2))}"></label>
        <label>매도비용 합계 (만원)<input data-field="saleCosts" type="number" inputmode="decimal" min="0" step="any" placeholder="중개·중도상환 등 직접 입력"></label>
        <label>양도세 가정 (만원)<input data-field="capitalGainsTax" type="number" inputmode="decimal" min="0" step="any" placeholder="모르면 공란 · 세전 표시"></label>
      </div>
      <p class="isc-small">순임대소득은 임대 운영비를 뺀 금액입니다. 보유비용에는 중복되지 않는 보유세·관리·수선비를 입력하세요. 기본 보유비용에는 표시된 관리비만 연간 환산했습니다. 실제 세금·수선비는 직접 더해야 합니다.</p>
      <div class="isc-result" data-result role="status" aria-live="polite"></div>
      <p class="isc-small">고정금리·원리금균등상환, 소득·비용의 월별 균등 발생 가정입니다. 이 물건의 주담대만 반영하며 전세보증금·추가 차입·기존 개인채무·기회비용은 제외합니다. 양도세를 계산하거나 투자수익률을 예측하는 도구가 아닙니다.</p>
    </div>`;
    function update() {
      const assumptions = {};
      details.querySelectorAll('[data-field]').forEach(input => {
        assumptions[input.dataset.field] = blank(input.value) ? null :
          Number(input.value) * (input.dataset.field === 'holdingYears' ? 1 : 10000);
      });
      const result = calculate(it, fin, assumptions), target = details.querySelector('[data-result]');
      if (result.status === 'pending' || result.status === 'invalid') {
        target.textContent = result.message;
        return;
      }
      const row = (label, value, cls = '') => `<div class="isc-row ${cls}"><span>${label}</span><span>${won(value)}</span></div>`;
      target.innerHTML = row('최초 투입자금', result.initialCapital) +
        row('보유 중 필요한 추가현금', result.holdingAdditionalCashNeeded) +
        (result.saleClosingCashNeeded > 0 ? row('매도 정산 시 추가현금', result.saleClosingCashNeeded) : '') +
        row('총 필요 자기자금', result.totalCashRequired) +
        row('매도 시 남은 주담대', result.remainingLoan) +
        row('매도 후 순회수액', result.netSaleProceeds) +
        row('보유기간 누적 순현금흐름', result.cumulativeNetCashFlow) +
        row(result.taxKnown ? '입력 양도세 반영 손익 가정' : '양도세 차감 전 손익 가정', result.profit, 'isc-profit') +
        `<p class="isc-small">${result.months}개월 가정. 추가현금은 매도 정산까지 포함한 누적 부족액의 최대값입니다. 손익 = 매도 후 순회수액 + 누적 순현금흐름 − 최초 투입자금.${result.omittedSaleCosts ? ' 매도비용 공란은 0원으로 계산했습니다.' : ''}${result.omittedHoldingCosts ? ' 보유비용 공란은 0원으로 계산했습니다.' : ''}${result.taxKnown ? ' 양도세는 입력한 금액만 반영했습니다.' : ' 양도세 미입력으로 세전 결과입니다.'}</p>`;
    }
    details.addEventListener('input', update);
    hostEl.replaceChildren(details);
    update();
  }

  const api = {amortization, calculate, render};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InvestmentScenario = api;
})(typeof window !== 'undefined' ? window : this);
