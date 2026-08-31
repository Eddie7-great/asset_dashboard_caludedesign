(function initAssetTaxRules(root) {
  'use strict';

  const SOURCES = [
    {
      id: 'income-tax-foreign-deduction',
      authority: '법제처 국가법령정보센터',
      title: '소득세법 제103조 · 주식 양도소득 기본공제',
      url: 'https://www.law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1031623847',
      expected: ['제103조', '연 250만원'],
    },
    {
      id: 'income-tax-stock-rate',
      authority: '법제처 국가법령정보센터',
      title: '소득세법 제104조 · 주식 양도소득세율',
      url: 'https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsId=001565&lsJoLnkSeq=1001062655&print=print',
      expected: ['제104조', '100분의 20'],
    },
    {
      id: 'income-tax-withholding',
      authority: '법제처 국가법령정보센터',
      title: '소득세법 제129조 · 배당·연금·기타소득 원천징수세율',
      url: 'https://www.law.go.kr/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=1000226030',
      expected: ['제129조', '배당소득', '100분의 14', '연금소득', '기타소득'],
    },
    {
      id: 'local-income-special-withholding',
      authority: '법제처 국가법령정보센터',
      title: '지방세법 제103조의13 · 개인지방소득세 특별징수',
      url: 'https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1031061107',
      expected: ['제103조의13', '거주자', '100분의 10', '개인지방소득세'],
    },
    {
      id: 'local-income-stock-rate',
      authority: '법제처 국가법령정보센터',
      title: '지방세법 제103조의3 · 주식 양도 개인지방소득세율',
      url: 'https://www.law.go.kr/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=1000384946',
      expected: ['제103조의3', '주식등', '1천분의 20'],
    },
    {
      id: 'isa-tax-benefit',
      authority: '법제처 국가법령정보센터',
      title: '조세특례제한법 제91조의18 · 개인종합자산관리계좌 과세특례',
      url: 'https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=1000928713',
      expected: ['제91조의18', '400만원', '200만원', '100분의 9'],
    },
    {
      id: 'gift-deduction',
      authority: '법제처 국가법령정보센터',
      title: '상속세 및 증여세법 제53조 · 증여재산 공제',
      url: 'https://www.law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1017648003',
      expected: ['제53조', '거주자', '10년 이내', '6억원', '5천만원', '2천만원', '1천만원', '4촌', '3촌'],
    },
    {
      id: 'gift-prior-aggregation',
      authority: '법제처 국가법령정보센터',
      title: '상속세 및 증여세법 제47조 · 종전 증여재산 과세가액 합산',
      url: 'https://law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1023532195',
      expected: ['제47조', '10년 이내', '동일인', '1천만원'],
    },
    {
      id: 'gift-law-revision-history',
      authority: '법제처 국가법령정보센터',
      title: '상속세 및 증여세법 제정·개정이유 · 친족 범위 변경 이력',
      url: 'https://www.law.go.kr/LSW/lsRvsRsnListP.do?chrClsCd=010102&lsId=001561',
      expected: ['상속세 및 증여세법', '제정·개정이유'],
    },
    {
      id: 'gift-marriage-birth',
      authority: '법제처 국가법령정보센터',
      title: '상속세 및 증여세법 제53조의2 · 혼인·출산 증여재산 공제',
      url: 'https://www.law.go.kr/lsLinkCommonInfo.do?lsJoLnkSeq=1029616213',
      expected: ['제53조의2', '전후 2년', '1억원', '출생일'],
    },
    {
      id: 'gift-annuity-discount',
      authority: '법제처 국가법령정보센터',
      title: '상속세 및 증여세법 시행규칙 제19조의2 · 정기금 평가 이자율',
      url: 'https://www.law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=02&joNo=0019&lsiSeq=284609&urlMode=lsScJoRltInfoR',
      expected: ['제19조의2', '1,000분의 30'],
    },
    {
      id: 'securities-transaction-tax-2026',
      authority: '법제처 국가법령정보센터',
      title: '증권거래세법 시행령 제5조 · 2026년 탄력세율',
      url: 'https://www.law.go.kr/LSW/lsSideInfoP.do?docCls=jo&joBrNo=00&joNo=0005&lsiSeq=280901&urlMode=lsScJoRltInfoR',
      expected: ['제5조', '1만분의 5', '1만분의 20'],
    },
    {
      id: 'securities-transaction-tax-history',
      authority: '법제처 국가법령정보센터',
      title: '증권거래세법 시행령 제정·개정이유 · 연도별 탄력세율 이력',
      url: 'https://www.law.go.kr/LSW/lsRvsRsnListP.do?chrClsCd=010102&lsId=005028',
      expected: ['증권거래세법 시행령', '제정·개정이유'],
    },
    {
      id: 'rural-special-tax',
      authority: '법제처 국가법령정보센터',
      title: '농어촌특별세법 제5조 · 유가증권시장 거래 농어촌특별세율',
      url: 'https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1031850593',
      expected: ['제5조', '1만분의 15'],
    },
    {
      id: 'financial-income-guide',
      authority: '법제처 국가법령정보센터',
      title: '소득세법 제14조 · 금융소득 종합과세 기준',
      url: 'https://law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1032724885',
      expected: ['제14조', '2천만원', '이자소득', '배당소득'],
    },
    {
      id: 'high-dividend-separate-tax',
      authority: '법제처 국가법령정보센터',
      title: '조세특례제한법 제104조의27 · 고배당기업 배당소득 분리과세',
      url: 'https://law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1032247693',
      expected: ['제104조의27', '고배당기업', '배당소득'],
    },
    {
      id: 'domestic-market-return-account',
      authority: '법제처 국가법령정보센터',
      title: '조세특례제한법 제91조의26 · 국내시장복귀계좌 과세특례',
      url: 'https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1033071489',
      expected: ['제91조의26', '국내시장복귀계좌', '2026년 12월 31일'],
    },
  ];

  const COMMON_SOURCE_IDS = [
    'income-tax-foreign-deduction',
    'income-tax-stock-rate',
    'income-tax-withholding',
    'local-income-special-withholding',
    'local-income-stock-rate',
    'isa-tax-benefit',
    'gift-deduction',
    'gift-prior-aggregation',
    'gift-law-revision-history',
    'gift-marriage-birth',
    'gift-annuity-discount',
    'financial-income-guide',
    'securities-transaction-tax-history',
  ];

  function valuesForYear(year) {
    const transactionRate = year >= 2026 ? 0.002 : year === 2025 ? 0.0015 : 0.0018;
    const kospiSecuritiesRate = year >= 2026 ? 0.0005 : year === 2025 ? 0 : 0.0003;
    return {
      dividend: {
        generalWithholdingNationalRate: 0.14,
        generalWithholdingCombinedRate: 0.154,
        comprehensiveIncomeThresholdKrw: 20_000_000,
        highDividendSeparateTaxActive: year >= 2026 && year <= 2029,
        highDividendSeparateTaxModeled: false,
      },
      isa: {
        generalExemptionKrw: 2_000_000,
        lowIncomeAndFarmerExemptionKrw: 4_000_000,
        separateTaxNationalRate: 0.09,
        separateTaxCombinedRate: 0.099,
      },
      pension: {
        taxDeferredAtTrade: true,
        pensionReceiptMinRate: 0.033,
        pensionReceiptMaxRate: 0.055,
        otherIncomeWithdrawalRate: 0.165,
      },
      capitalGains: {
        foreignStockBasicDeductionKrw: 2_500_000,
        foreignStockNationalRate: 0.20,
        foreignStockCombinedRate: 0.22,
        domesticListedMinorityCapitalGainRate: 0,
        kospiSecuritiesTransactionRate: kospiSecuritiesRate,
        kospiRuralSpecialTaxRate: 0.0015,
        kospiTotalTransactionRate: transactionRate,
        kosdaqSecuritiesTransactionRate: transactionRate,
        kosdaqTotalTransactionRate: transactionRate,
      },
      gift: {
        deductionLookbackYears: 10,
        priorGiftAggregationYears: 10,
        priorGiftAggregationMinimumKrw: 10_000_000,
        spouseDeductionKrw: 600_000_000,
        adultLinealAscendantDeductionKrw: 50_000_000,
        minorLinealAscendantDeductionKrw: 20_000_000,
        linealDescendantDeductionKrw: 50_000_000,
        otherRelativeDeductionKrw: 10_000_000,
        marriageBirthAdditionalDeductionKrw: 100_000_000,
        marriageBirthCombinedCapKrw: 100_000_000,
        marriageWindowBeforeYears: 2,
        marriageWindowAfterYears: 2,
        birthAdoptionWindowAfterYears: 2,
        otherRelativeScope: year >= 2026
          ? '4촌 이내 혈족·3촌 이내 인척'
          : year === 2025
            ? '2025-03-14 전 6촌 이내 혈족·4촌 이내 인척, 이후 4촌 이내 혈족·3촌 이내 인척'
            : '6촌 이내 혈족·4촌 이내 인척',
        annuityDiscountRate: 0.03,
      },
    };
  }

  function disclosuresForYear(year) {
    return {
      dividend: {
        title: '배당·금융소득 규칙',
        sourceIds: [
          'income-tax-withholding',
          'local-income-special-withholding',
          'financial-income-guide',
          'isa-tax-benefit',
          ...(year >= 2026 ? ['high-dividend-separate-tax'] : []),
        ],
        assumptions: [
          '국내 일반 배당은 소득세 14%와 개인지방소득세를 합친 15.4% 원천징수로 단순 계산합니다.',
          'ISA는 계좌 유지기간 전체 손익을 알 수 없어, 일반형 200만원을 소유주별 연간 예상 배당에 적용한 현금흐름 참고치로만 계산합니다.',
          '금융소득 종합과세 근접도는 앱에 등록된 일반계좌 배당만 합산합니다.',
        ],
        exclusions: [
          '예·적금 이자, 채권 이자, 앱 밖의 배당과 다른 금융소득은 포함하지 않습니다.',
          '해외 배당의 현지 원천징수, 외국납부세액공제, 금융상품별 배당소득 계산 차이는 반영하지 않습니다.',
          '실제 ISA 비과세 한도는 매년이 아니라 계좌 유지기간 전체의 최종 순소득에 적용되며 금융회사가 만기·해지 시 정산합니다.',
          'ISA 서민·농어민형 400만원 자격과 계좌 내 전체 이자·배당·매매손익은 자동 판정하지 않습니다.',
          year >= 2026
            ? '2026년 지급분부터 가능한 고배당기업 배당 분리과세는 기업 자격과 신청 여부를 확인할 수 없어 계산에서 제외합니다.'
            : '고배당기업 배당 분리과세는 2026년 지급분부터 적용되므로 이 연도 계산에는 적용하지 않습니다.',
          '연금 수령·중도인출 단계의 실제 세금은 계산하지 않습니다.',
        ],
      },
      capitalGains: {
        title: '양도소득·계좌 과세 규칙',
        sourceIds: [
          'income-tax-foreign-deduction',
          'income-tax-stock-rate',
          'local-income-stock-rate',
          'isa-tax-benefit',
          'securities-transaction-tax-history',
          ...(year >= 2026 ? ['securities-transaction-tax-2026', 'rural-special-tax'] : []),
          ...(year === 2026 ? ['domestic-market-return-account'] : []),
        ],
        assumptions: [
          '거주자의 일반적인 과세대상 국외주식은 소유주별·과세기간별 원화 실현손익을 통산한 뒤 주식 양도소득 기본공제 250만원과 개인지방소득세 포함 22%를 적용합니다.',
          '국내주식은 대주주가 아닌 개인의 장내 양도로 가정합니다.',
          'ISA 입력값은 계좌 전체 손익을 알 수 없는 상태에서 일반형 비과세 200만원을 연간 입력 순소득에 적용한 참고치입니다.',
        ],
        exclusions: [
          '거래별 취득가·선입선출·결제일 환율·수수료·외국납부세액공제는 자동 산출하지 않습니다.',
          '손실은 같은 과세기간의 과세대상 주식 손익통산만 가정하며 전년도 손실 이월공제는 반영하지 않습니다.',
          '국내 과세대상 주식도 주식 양도소득 기본공제를 함께 사용할 수 있으나 이 앱은 해당 거래를 합산하지 않습니다.',
          '비거주자·국외전출자 등 거주자 일반 사례와 다른 납세 요건은 판정하지 않습니다.',
          '국내주식 대주주·장외거래·비상장주식·특수관계 거래는 계산하지 않습니다.',
          'KOSPI·KOSDAQ 장내 거래세와 농어촌특별세는 참고율만 표시하며 예상 납부세액 합계에는 더하지 않습니다. KONEX·K-OTC·장외거래는 제외합니다.',
          'ISA 서민·농어민형, 만기·중도해지, 계좌 내 상품별 비과세 여부는 자동 판정하지 않습니다.',
          'ISA에서는 직접 국외주식을 매수할 수 없으며, 화면의 ISA 손익은 계좌 내 적격 상품의 법정 손익통산을 단순화한 입력값입니다.',
          '국외상장 중소기업 등 특수세율과 외국납부세액공제는 반영하지 않습니다.',
          ...(year === 2026 ? ['2026년 국내시장복귀계좌 양도소득 특례는 계좌·보유일·재투자 요건을 확인할 수 없어 반영하지 않습니다.'] : []),
        ],
      },
      gift: {
        title: '증여재산 공제·유기정기금 규칙',
        sourceIds: ['gift-deduction', 'gift-prior-aggregation', 'gift-marriage-birth', 'gift-annuity-discount', 'gift-law-revision-history'],
        assumptions: [
          '증여재산공제 사용액은 배우자·직계존속·직계비속·기타 친족 등 관계별로 각 증여일 전 10년 내 공제받은 금액을 확인해 입력합니다.',
          '증여세 과세가액 합산은 동일 증여자 기준이며, 증여자가 직계존속이면 그 배우자를 포함하고 종전 증여 과세가액 합계가 1천만원 이상인 경우를 전제로 합니다.',
          '자녀 정기증여 현재가치는 법령의 연도별 정기금 평가를 월말 동일액 납입으로 근사해 연 3%를 월이율로 나눠 계산합니다.',
          '미래 계획 기간에도 현재 규칙이 유지된다는 가정으로 규모만 비교합니다.',
        ],
        exclusions: [
          '증여세율·누진공제·세대생략 할증·신고세액공제·증여자별 합산 관계는 계산하지 않습니다.',
          '공제는 거주자인 수증자를 전제로 하며 사실혼 배우자는 배우자 공제 대상이 아닙니다. 직계존속·직계비속의 법정 포함 범위도 자동 판정하지 않습니다.',
          '미성년 여부는 증여일 현재 기준이며, 기타 친족 범위는 2025-03-14에 6촌 혈족·4촌 인척에서 4촌 혈족·3촌 인척으로 바뀌었습니다.',
          '혼인·출산 추가공제는 직계존속 증여만 대상입니다. 혼인 신고일 전후 2년과 출생·입양일 이후 2년, 수증자 1인 합계 1억원 요건을 자동 판정하지 않습니다.',
          '혼인 무효·기한 내 미혼인 경우의 수정신고, 간주·의제증여재산 제외 등 혼인·출산 공제의 사후 요건은 계산하지 않습니다.',
          '증여일별 rolling 10년 창과 실제 자산 평가액·신고기한은 자동 계산하지 않습니다.',
          '정기 이체 누락·변경·해지 및 과세관청의 개별 판단은 반영하지 않습니다.',
        ],
      },
    };
  }

  function makePeriod(year, version, archived) {
    return {
      id: version,
      effectiveFrom: `${year}-01-01`,
      effectiveTo: `${year}-12-31`,
      verifiedAt: '2026-08-31',
      nextReviewAt: archived ? null : '2026-09-30',
      archived: Boolean(archived),
      values: valuesForYear(year),
      disclosures: disclosuresForYear(year),
      sourceIds: [
        ...COMMON_SOURCE_IDS,
        ...(year >= 2026 ? ['securities-transaction-tax-2026', 'rural-special-tax', 'high-dividend-separate-tax'] : []),
        ...(year === 2026 ? ['domestic-market-return-account'] : []),
      ],
    };
  }

  const MANIFEST = {
    schemaVersion: 1,
    manifestVersion: 'kr-tax-gift-2026.3',
    jurisdiction: '대한민국',
    timezone: 'Asia/Seoul',
    monitoring: {
      officialSourceCheck: 'daily',
      humanReviewIntervalDays: 31,
      policy: '공식 출처 변경은 자동으로 세율을 바꾸지 않고 사람 검토 이슈를 생성합니다.',
    },
    sources: SOURCES,
    periods: [
      makePeriod(2024, 'kr-tax-gift-2024.1', true),
      makePeriod(2025, 'kr-tax-gift-2025.1', true),
      makePeriod(2026, 'kr-tax-gift-2026.3', false),
    ],
  };

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  function yearOf(value) {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isInteger(value)) return value;
    const text = String(value);
    const match = text.match(/^(\d{4})/);
    if (match) return Number(match[1]);
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    try {
      return Number(new Intl.DateTimeFormat('en', { timeZone: MANIFEST.timezone, year: 'numeric' }).format(date));
    } catch (_error) {
      return date.getFullYear();
    }
  }

  function rulesFor(value) {
    const year = yearOf(value == null ? new Date() : value);
    if (!year) return null;
    return MANIFEST.periods.find(period => Number(period.effectiveFrom.slice(0, 4)) === year) || null;
  }

  function valueAt(path, fallback, when) {
    const period = rulesFor(when == null ? new Date() : when);
    if (!period) return fallback;
    let current = period.values;
    for (const key of String(path || '').split('.').filter(Boolean)) {
      if (!current || !Object.prototype.hasOwnProperty.call(current, key)) return fallback;
      current = current[key];
    }
    return current == null ? fallback : current;
  }

  function dateValue(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(`${value}T23:59:59+09:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function statusFor(when, referenceDate) {
    const period = rulesFor(when);
    if (!period) return { state: 'unsupported', label: '지원하지 않는 적용 연도', period: null };
    if (period.archived) return { state: 'historical', label: '과거 연도 수치 확인본', period };
    const today = dateValue(referenceDate || new Date());
    const due = dateValue(period.nextReviewAt);
    if (!today || !due || today.getTime() > due.getTime()) {
      return { state: 'stale', label: '공식 근거 재검토 필요', period };
    }
    const remainingDays = Math.ceil((due.getTime() - today.getTime()) / 86_400_000);
    if (remainingDays <= 7) return { state: 'due', label: `검토 예정 · ${remainingDays}일`, period };
    return { state: 'verified', label: '공식 근거 확인됨', period };
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatKrw(value) {
    const amount = Number(value) || 0;
    if (amount >= 100_000_000 && amount % 100_000_000 === 0) return `${amount / 100_000_000}억원`;
    if (amount >= 10_000 && amount % 10_000 === 0) return `${(amount / 10_000).toLocaleString('ko-KR')}만원`;
    return `${Math.round(amount).toLocaleString('ko-KR')}원`;
  }

  function formatPct(value) {
    const percent = (Number(value) || 0) * 100;
    return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
  }

  function appliedItems(scope, period) {
    const values = period.values;
    if (scope === 'gift') {
      return [
        `10년 합산 · 배우자 ${formatKrw(values.gift.spouseDeductionKrw)}`,
        `직계존속 공제 · 성년 ${formatKrw(values.gift.adultLinealAscendantDeductionKrw)} / 미성년 ${formatKrw(values.gift.minorLinealAscendantDeductionKrw)}`,
        `직계비속 ${formatKrw(values.gift.linealDescendantDeductionKrw)} · 기타 친족 ${formatKrw(values.gift.otherRelativeDeductionKrw)}`,
        `혼인·출산 추가공제 최대 ${formatKrw(values.gift.marriageBirthCombinedCapKrw)} · 자동 계산 제외`,
        `유기정기금 평가 할인율 연 ${formatPct(values.gift.annuityDiscountRate)}`,
      ];
    }
    if (scope === 'dividend') {
      return [
        `일반계좌 원천징수 ${formatPct(values.dividend.generalWithholdingCombinedRate)}`,
        `금융소득 종합과세 기준 ${formatKrw(values.dividend.comprehensiveIncomeThresholdKrw)}`,
        `ISA 유지기간 정산: 일반형 ${formatKrw(values.isa.generalExemptionKrw)} 비과세 · 초과 ${formatPct(values.isa.separateTaxCombinedRate)} · 화면은 연간 현금흐름 근사`,
        values.dividend.highDividendSeparateTaxActive
          ? '고배당기업 분리과세 · 대상/신청 여부 자동 판정 제외'
          : '고배당기업 분리과세 · 적용 전 연도',
      ];
    }
    return [
      `해외주식 인별 기본공제 ${formatKrw(values.capitalGains.foreignStockBasicDeductionKrw)} · 세율 ${formatPct(values.capitalGains.foreignStockCombinedRate)}`,
      `ISA 유지기간 정산: 일반형 ${formatKrw(values.isa.generalExemptionKrw)} 비과세 · 초과 ${formatPct(values.isa.separateTaxCombinedRate)} · 화면은 연간 근사`,
      `국내 장내 소액주주 양도차익 비과세 가정`,
      `KOSPI·KOSDAQ 장내 매도 부담 참고 ${formatPct(values.capitalGains.kospiTotalTransactionRate)} · 세액 합계에서는 제외`,
    ];
  }

  function disclosureHtml(scope, when) {
    const year = yearOf(when == null ? new Date() : when);
    const status = statusFor(year);
    if (!status.period) {
      return `<div class="tax-rule-disclosure is-unsupported" role="note"><b>${escapeHtml(year || '선택')}년 규칙 미지원</b><span>이 연도는 검증된 규칙 버전이 없어 세액을 최신 규칙으로 단정할 수 없습니다.</span></div>`;
    }
    const period = status.period;
    const disclosure = period.disclosures[scope] || period.disclosures.capitalGains;
    const sourceMap = new Map(MANIFEST.sources.map(source => [source.id, source]));
    const sources = disclosure.sourceIds.map(id => sourceMap.get(id)).filter(Boolean);
    const sourceLinks = sources.map(source =>
      `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.title)}</a><span>${escapeHtml(source.authority)}</span></li>`
    ).join('');
    const periodLabel = `${period.effectiveFrom.slice(0,4)}년 계산값`;
    return `<details class="tax-rule-disclosure" data-tax-rule-version="${escapeHtml(period.id)}">
      <summary>
        <span class="tax-rule-badge">${escapeHtml(year)}년 적용</span>
        <span class="tax-rule-summary-title">${escapeHtml(disclosure.title)} · ${escapeHtml(period.id)}</span>
        <span class="tax-rule-status is-${escapeHtml(status.state)}">${escapeHtml(status.label)}</span>
      </summary>
      <div class="tax-rule-body">
        <div class="tax-rule-meta"><span>계산 대상 <b>${escapeHtml(periodLabel)}</b></span><span>사람 검토 <b>${escapeHtml(period.verifiedAt)}</b></span><span>다음 검토 <b>${escapeHtml(period.nextReviewAt || '과거 수치 확인본')}</b></span></div>
        <div class="tax-rule-columns">
          <section><h4>계산에 적용</h4><ul>${appliedItems(scope, period).map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>
          <section><h4>계산 가정</h4><ul>${disclosure.assumptions.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>
          <section><h4>제외·주의</h4><ul>${disclosure.exclusions.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>
        </div>
        <section class="tax-rule-sources"><h4>공식 기준 출처</h4><ul>${sourceLinks}</ul></section>
        <p class="tax-rule-disclaimer">공식 출처는 매일 자동 확인하고, 변경·접속 실패·검토기한 초과 시 사람 검토가 필요하도록 알립니다. 이 계산은 신고나 세무 자문을 대신하지 않습니다.</p>
      </div>
    </details>`;
  }

  deepFreeze(MANIFEST);
  root.ASSET_TAX_RULES = MANIFEST;
  root.assetTaxRulesFor = rulesFor;
  root.assetTaxRuleValue = valueAt;
  root.assetTaxRuleStatus = statusFor;
  root.assetTaxRuleDisclosureHtml = disclosureHtml;
})(typeof window !== 'undefined' ? window : globalThis);
