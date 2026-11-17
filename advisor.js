/* Pure, local-only financing scenarios. Amounts are KRW; this is not a bank approval.
 * Policy inputs: references/policy_params.json (2026-09-06).
 * Sources: https://www.korea.kr/news/policyNewsView.do?newsId=156722073
 * https://fsc.go.kr/po020201/76750
 * https://land.seoul.go.kr/land/broker/brokerageCommission.do
 * https://etax.seoul.go.kr/taxpay/AcqutaxCalcAction.view?gl_gubun=g&gnb_id=0610&lnb_id=0610
 */
(function (root) {
  'use strict';
  const num = (value, fallback = 0) => value == null || value === '' || !Number.isFinite(Number(value)) ? fallback : Math.max(0, Number(value));
  function annuity(principal, annual, years) {
    const n = Math.max(1, years * 12), r = annual / 12;
    if (!principal) return 0;
    return r === 0 ? principal / n : principal * r / (1 - Math.pow(1 + r, -n));
  }
  function debtMonthly(p) {
    // DSR proxy for a credit line: full limit / 5 years + annual interest.
    // Actual bank treatment and utilized interest can differ; never call this cash outflow.
    return num(p.debt) / 60 + num(p.debt) * num(p.rate, 4.7) / 1200;
  }
  function loanCap(p) { return p <= 1.5e9 ? 6e8 : p <= 2.5e9 ? 4e8 : 2e8; }
  function brokerage(p) {
    const tiers = [[5e7,.006,250000],[2e8,.005,800000],[9e8,.004,Infinity],[1.2e9,.005,Infinity],[1.5e9,.006,Infinity],[Infinity,.007,Infinity]];
    for (const [max, rate, cap] of tiers) if (p < max) return Math.floor(Math.min(p * rate, cap));
    return 0;
  }
  function acqTax(p, area, firstTime) {
    // Standard purchase of one residential property. Discounts require eligibility;
    // no first-home exemption is credited before it has been independently confirmed.
    const rate = p <= 6e8 ? .01 : p <= 9e8 ? (p / 1e8 * 2 / 3 - 3) / 100 : .03;
    return Math.floor(p * rate * 1.1 + (area > 85 ? p * .002 : 0));
  }
  function calculate(it, p = {}, firstTime = true) {
    const price = num(it.price), mortgageRate = num(p.mortgageRate,4), stressRate = Math.max(mortgageRate,num(p.stressRate,7));
    const loanYears = Math.min(30,Math.max(1,num(p.loanYears,30)));
    const ltv = firstTime ? .7 : it.regulated === false ? .7 : .4;
    const ltvLoan = Math.min(Math.floor(price * ltv),loanCap(price));
    const monthlyDebt = debtMonthly(p);
    const dsrKnown = p.income != null && p.income !== '' && Number.isFinite(Number(p.income));
    const room = Math.max(0,num(p.income) * .4 / 12 - monthlyDebt);
    const dsrLoan = dsrKnown ? Math.max(0,Math.floor(room / annuity(1,stressRate / 100,loanYears))) : null;
    const loan = dsrLoan === null ? ltvLoan : Math.min(ltvLoan,dsrLoan);
    const tax = acqTax(price,it.area,firstTime), fee = brokerage(price), feeVat = Math.ceil(fee * .1);
    const misc = 2000000 + num(p.extraCash), cash = price - loan + tax + fee + feeVat + misc;
    const monthly = Math.ceil(annuity(loan,mortgageRate / 100,loanYears));
    const stress = Math.ceil(annuity(loan,stressRate / 100,loanYears));
    const debtInterest = Math.ceil(num(p.debt) * num(p.rate,4.7) / 1200);
    const monthlyTotal = monthly + debtInterest + num(it.mgmt);
    const stressMonthlyTotal = stress + debtInterest + num(it.mgmt);
    const dsr = dsrKnown ? num(p.income) > 0 ? (annuity(loan,stressRate / 100,loanYears) + monthlyDebt) * 12 / num(p.income) : (loan || monthlyDebt ? Infinity : 0) : null;
    return {ltv,loan,ltvLoan,dsrLoan,loanReduced:loan < ltvLoan,dsrKnown,dsr,
      tax,fee,feeVat,misc,cash,monthly,stress,monthlyDebt,debtInterest,monthlyTotal,stressMonthlyTotal,
      monthlyFits:p.monthlyBudget == null || p.monthlyBudget === '' ? null : monthlyTotal <= num(p.monthlyBudget),
      mortgageRate,stressRate,loanYears,
      assumed:true, taxExemptionApplied:false, managementKnown:it.mgmt != null,
      assumptions:'1주택 일반 취득세·감면 미반영, 중개보수 상한과 부가세 10%, 기타비용 200만원 가정. DSR은 한도대출 5년 원금환산+이자. 월 지출은 한도 전액 사용 이자 가정이며 원금상환·보유세·수선비는 별도. 임차보증금을 주담대와 중복 차감하지 않음.'};
  }
  const api = {annuity,debtMonthly,loanCap,brokerage,acqTax,calculate};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Advisor = api;
})(typeof window !== 'undefined' ? window : this);
