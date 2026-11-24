// core/stock-search.js — 종목 입력 도우미 — 자동완성·종목 검색, 시장 휴장일, 적립식 상태
// (2026-11-23 script.js 에서 그대로 옮겨 나눈 조각. 로드 순서는 index.html·scripts/tests/_source.mjs)
// =============================================
// 모달 필드 토글
// =============================================
// 자동완성 데이터
// =============================================
// 자동완성: 시장별 로컬DB + price.ts 검색 프록시
// =============================================
const KR_TICKERS = [
  // 코스피 대형주
  {tkr:'005930',name:'삼성전자'},{tkr:'000660',name:'SK하이닉스'},
  {tkr:'005380',name:'현대차'},{tkr:'000270',name:'기아'},
  {tkr:'051910',name:'LG화학'},{tkr:'006400',name:'삼성SDI'},
  {tkr:'055550',name:'신한지주'},{tkr:'105560',name:'KB금융'},
  {tkr:'086790',name:'하나금융지주'},{tkr:'003550',name:'LG'},
  {tkr:'096770',name:'SK이노베이션'},{tkr:'017670',name:'SK텔레콤'},
  {tkr:'030200',name:'KT'},{tkr:'032830',name:'삼성생명'},
  {tkr:'068270',name:'셀트리온'},{tkr:'207940',name:'삼성바이오로직스'},
  {tkr:'028260',name:'삼성물산'},{tkr:'018260',name:'삼성에스디에스'},
  {tkr:'009150',name:'삼성전기'},{tkr:'003490',name:'대한항공'},
  {tkr:'066570',name:'LG전자'},{tkr:'010950',name:'S-Oil'},
  {tkr:'011200',name:'HMM'},{tkr:'012330',name:'현대모비스'},
  {tkr:'032640',name:'LG유플러스'},{tkr:'015760',name:'한국전력'},
  {tkr:'033780',name:'KT&G'},{tkr:'010130',name:'고려아연'},
  {tkr:'000810',name:'삼성화재'},{tkr:'002790',name:'아모레퍼시픽'},
  {tkr:'271560',name:'오리온'},{tkr:'282330',name:'BGF리테일'},
  {tkr:'097950',name:'CJ제일제당'},{tkr:'139480',name:'이마트'},
  {tkr:'004020',name:'현대제철'},{tkr:'005490',name:'POSCO홀딩스'},
  {tkr:'034730',name:'SK'},
  // 코스닥 주요 종목
  {tkr:'035420',name:'NAVER'},{tkr:'035720',name:'카카오'},
  {tkr:'373220',name:'LG에너지솔루션'},{tkr:'196170',name:'알테오젠'},
  {tkr:'247540',name:'에코프로비엠'},{tkr:'086520',name:'에코프로'},
  {tkr:'091990',name:'셀트리온헬스케어'},{tkr:'263750',name:'펄어비스'},
  {tkr:'293490',name:'카카오게임즈'},{tkr:'112040',name:'위메이드'},
  {tkr:'145020',name:'휴젤'},{tkr:'214150',name:'클래시스'},
  {tkr:'259960',name:'크래프톤'},{tkr:'036570',name:'엔씨소프트'},
  {tkr:'251270',name:'넷마블'},{tkr:'078935',name:'GS'},
  {tkr:'034020',name:'두산에너빌리티'},{tkr:'042660',name:'한화오션'},
  {tkr:'047810',name:'한국항공우주'},{tkr:'161390',name:'한국타이어앤테크놀로지'},
  // 네이버/카카오 계열
  {tkr:'035420',name:'네이버'},{tkr:'035420',name:'NAVER(네이버)'},
  {tkr:'302440',name:'SK바이오사이언스'},{tkr:'326030',name:'SK바이오팜'},
  // 로보티즈 등 코스닥
  {tkr:'108490',name:'로보티즈'},{tkr:'090710',name:'휴림로봇'},
  {tkr:'277810',name:'레인보우로보틱스'},{tkr:'215100',name:'에스퓨얼셀'},
  {tkr:'039030',name:'이오테크닉스'},{tkr:'065510',name:'휴비스'},
  {tkr:'078600',name:'대주전자재료'},{tkr:'053800',name:'안랩'},
  {tkr:'950130',name:'엑스페릭스'},{tkr:'241710',name:'코스메카코리아'},
  {tkr:'053210',name:'스카이라이프'},{tkr:'041510',name:'에스엠'},
  {tkr:'035900',name:'JYP Ent'},{tkr:'122870',name:'와이지엔터테인먼트'},
  {tkr:'352820',name:'하이브'},{tkr:'016360',name:'삼성증권'},
  {tkr:'006800',name:'미래에셋증권'},{tkr:'039490',name:'키움증권'},
  {tkr:'071050',name:'한국금융지주'},{tkr:'138040',name:'메리츠금융지주'},
  // ETF
  {tkr:'360750',name:'TIGER 미국S&P500'},{tkr:'069500',name:'KODEX 200'},
  {tkr:'229200',name:'KODEX 코스닥150'},{tkr:'133690',name:'TIGER 미국나스닥100'},
  {tkr:'381170',name:'KODEX 미국S&P500TR'},{tkr:'251340',name:'KODEX 코스피'},
  {tkr:'091160',name:'KODEX반도체'},{tkr:'091180',name:'KODEX 은행'},
  {tkr:'139260',name:'TIGER 200'},{tkr:'148070',name:'KOSEF 200TR'},
  {tkr:'455050',name:'TIGER 미국배당다우존스'},{tkr:'441680',name:'TIGER 미국배당+7%프리미엄다운존스'},
  {tkr:'411060',name:'ACE 미국500'},  {tkr:'460470',name:'TIGER 미국나스닥100커버드콜ATM'},
  {tkr:'385720',name:'TIMEFOLIO Korea플러스배당액티브'},{tkr:'278530',name:'KODEX 200TR'},
];
const CRYPTO_TICKERS = [
  {tkr:'BTC',name:'비트코인'},{tkr:'ETH',name:'이더리움'},
  {tkr:'XRP',name:'리플'},{tkr:'SOL',name:'솔라나'},
  {tkr:'BNB',name:'바이낸스코인'},{tkr:'DOGE',name:'도지코인'},
  {tkr:'ADA',name:'에이다'},{tkr:'AVAX',name:'아발란체'},
];
const US_LOCAL = [
  {symbol:'NVDA',description:'Nvidia Corp'},{symbol:'AAPL',description:'Apple Inc'},
  {symbol:'MSFT',description:'Microsoft Corp'},{symbol:'TSLA',description:'Tesla Inc'},
  {symbol:'AMZN',description:'Amazon.com Inc'},{symbol:'GOOGL',description:'Alphabet Inc'},
  {symbol:'META',description:'Meta Platforms'},{symbol:'JPM',description:'JPMorgan Chase'},
  {symbol:'O',description:'Realty Income Corp'},{symbol:'VOO',description:'Vanguard S&P 500 ETF'},
  {symbol:'QQQ',description:'Invesco QQQ Trust'},{symbol:'SPY',description:'SPDR S&P 500 ETF'},
  {symbol:'SCHD',description:'Schwab US Dividend ETF'},{symbol:'VTI',description:'Vanguard Total Stock Market ETF'},
  {symbol:'JEPI',description:'JPMorgan Equity Premium Income ETF'},{symbol:'JEPQ',description:'JPMorgan Nasdaq Equity Premium Income ETF'},
  {symbol:'VYM',description:'Vanguard High Dividend Yield ETF'},{symbol:'QQQM',description:'Invesco NASDAQ 100 ETF'},
  {symbol:'BRK.B',description:'Berkshire Hathaway'},{symbol:'V',description:'Visa Inc'},
  {symbol:'JNJ',description:'Johnson & Johnson'},{symbol:'XOM',description:'Exxon Mobil'},
  // 레버리지/인버스 ETF
  {symbol:'QLD',description:'ProShares Ultra QQQ (2x)'},
  {symbol:'TQQQ',description:'ProShares UltraPro QQQ (3x)'},
  {symbol:'SQQQ',description:'ProShares UltraPro Short QQQ (-3x)'},
  {symbol:'UPRO',description:'ProShares UltraPro S&P500 (3x)'},
  {symbol:'SPXU',description:'ProShares UltraPro Short S&P500 (-3x)'},
  {symbol:'SOXL',description:'Direxion Daily Semiconductor Bull 3x'},
  {symbol:'SOXS',description:'Direxion Daily Semiconductor Bear 3x'},
  {symbol:'TECL',description:'Direxion Daily Technology Bull 3x'},
  {symbol:'FNGU',description:'MicroSectors FANG+ Index 3x Leveraged'},
  {symbol:'SSO',description:'ProShares Ultra S&P500 (2x)'},
  {symbol:'USD',description:'ProShares Ultra Semiconductors (2x)'},
];

let _searchTimer = null;
let _isComposing = false; // IME 한글 입력 중 플래그
let _hasLocalResults = false; // 로컬 결과 존재 플래그

async function onSearchInput() {
  // IME 조합 중이면 검색 스킵 (한글 입력 완성 전 중간 상태)
  if (_isComposing) return;

  const val = document.getElementById('add-search').value.trim();
  const dd = document.getElementById('search-dropdown');
  const spinner = document.getElementById('search-spinner');
  // 입력 변경 시 이전 검색 결과 패널 숨기기
  const ssr=document.getElementById('stock-search-result');if(ssr)ssr.style.display='none';
  const sse=document.getElementById('stock-search-error');if(sse)sse.style.display='none';
  window._stockSearchResult=null;
  if (!val || val.length < 1) { dd.style.display='none'; _hasLocalResults=false; return; }
  const grp = document.getElementById('add-grp').value;

  // 코인
  if (grp === '가상화폐') {
    const f = CRYPTO_TICKERS.filter(t =>
      t.tkr.toLowerCase().includes(val.toLowerCase()) || t.name.includes(val)
    );
    renderDropdown(f.map(t => ({symbol:t.tkr, description:t.name, market:'CRYPTO'})));
    return;
  }

  if (_searchTimer) clearTimeout(_searchTimer);
  if (spinner) spinner.style.display='block';

  // 한글 포함 또는 6자리 숫자 → KR 검색
  const hasKorean = /[가-힣]/.test(val);
  const isKrCode = /^\d{4,6}$/.test(val);
  const looksKR = hasKorean || isKrCode;

  // 로컬 KR 매칭 먼저 즉시 표시 (중복 제거)
  // ① stocks.json 전수 DB (window._krStocksDB) → ② 소형 KR_TICKERS 배열 순서로 병합
  _hasLocalResults = false;
  if (looksKR) {
    const seen = new Set();
    const combined = [];

    // stocks.json DB에서 검색 (수천 종목)
    const db = window._krStocksDB;
    if (db && (db.byName.size || db.byShort.size || db.byCode.size)) {
      const qRaw = val.trim();
      const qNorm = _normalizeKrName(qRaw);
      const qUpper = qRaw.toUpperCase();
      // 6자리 코드 정확 일치
      if (KR_CODE_RE.test(qUpper)) {
        const meta = db.byCode.get(qUpper.padStart(6, '0'));
        if (meta && !seen.has(meta.code)) {
          seen.add(meta.code);
          combined.push({
            symbol: meta.code + (String(meta.market||'').toUpperCase().includes('KOSDAQ') ? '.KQ' : '.KS'),
            description: meta.name,
            rawTkr: meta.code,
            market: 'KR',
            price: meta.close
          });
        }
      }
      // 부분코드 일치 (숫자 4~5자리 입력 시)
      if (/^\d{1,5}$/.test(qUpper)) {
        for (const [code, meta] of db.byCode) {
          if (code.includes(qUpper)) {
            if (seen.has(code)) continue;
            seen.add(code);
            combined.push({
              symbol: code + (String(meta.market||'').toUpperCase().includes('KOSDAQ') ? '.KQ' : '.KS'),
              description: meta.name,
              rawTkr: code,
              market: 'KR',
              price: meta.close
            });
            if (combined.length >= 20) break;
          }
        }
      }
      // 이름 부분일치 (정규화 후)
      if (qNorm) {
        for (const [nk, meta] of db.byName) {
          if (nk.includes(qNorm)) {
            if (seen.has(meta.code)) continue;
            seen.add(meta.code);
            combined.push({
              symbol: meta.code + (String(meta.market||'').toUpperCase().includes('KOSDAQ') ? '.KQ' : '.KS'),
              description: meta.name,
              rawTkr: meta.code,
              market: 'KR',
              price: meta.close
            });
            if (combined.length >= 20) break;
          }
        }
        if (combined.length < 20) {
          for (const [nk, meta] of db.byShort) {
            if (nk.includes(qNorm)) {
              if (seen.has(meta.code)) continue;
              seen.add(meta.code);
              combined.push({
                symbol: meta.code + (String(meta.market||'').toUpperCase().includes('KOSDAQ') ? '.KQ' : '.KS'),
                description: meta.name,
                rawTkr: meta.code,
                market: 'KR',
                price: meta.close
              });
              if (combined.length >= 20) break;
            }
          }
        }
      }
    }

    // KR_TICKERS 폴백 (DB 로드 실패 시 또는 추가 매칭)
    KR_TICKERS.forEach(t => {
      if (seen.has(t.tkr)) return;
      if (t.tkr.includes(val) || t.name.includes(val)) {
        seen.add(t.tkr);
        combined.push({symbol:t.tkr+'.KS', description:t.name, rawTkr:t.tkr, market:'KR'});
      }
    });

    if (combined.length > 0) {
      renderDropdown(combined);
      _hasLocalResults = true;
    }
  }

  const searchVal = val; // 타이머 콜백에서 사용할 값 캡처
  _searchTimer = setTimeout(async () => {
    // 타이머 실행 시점에 입력값이 변경되었으면 무시
    const currentVal = document.getElementById('add-search').value.trim();
    if (currentVal !== searchVal) { if(spinner) spinner.style.display='none'; return; }

    let found = false;

    try {
      // Node.js 기반의 강력한 검색 API (api/get-stock.ts) 우선 사용
      const res = await authFetch(`/api/get-stock?query=${encodeURIComponent(val)}`);
      const data = await res.json();

      if (data && data.success && data.symbol) {
        const _mkt = data.currency === 'KRW' ? 'KR' : (data.currency === 'JPY' ? 'JP' : 'US');
        renderDropdown([{
          symbol: data.symbol,
          description: data.name,
          rawTkr: data.symbol.replace(/\.(KS|KQ)$/, ''),
          market: _mkt,
          price: data.price
        }]);
        found = true;
      }
    } catch (e) {
      console.warn('[Search API Fallback]', e);
    }

    if (!found) {
      // US 로컬 검색 (오프라인 보조)
      const usF = US_LOCAL.filter(t => t.symbol.toLowerCase().includes(val.toLowerCase()) || t.description.toLowerCase().includes(val.toLowerCase()));
      if (usF.length > 0) { renderDropdown(usF.map(t=>({...t, market:'US'}))); found = true; }
    }

    if (!found && !_hasLocalResults) {
      dd.innerHTML='<div style="padding:12px 14px;font-size:var(--fs-body);color:var(--t3)">종목을 찾을 수 없습니다. (정확한 명칭이나 6자리 코드를 입력하세요)</div>';
      dd.style.display='block';
    }
    if (spinner) spinner.style.display='none';
  }, 400);
}

function renderDropdown(items) {
  const dd = document.getElementById('search-dropdown');
  if (!items || items.length === 0) { dd.style.display='none'; return; }
  const fragment=document.createDocumentFragment();
  items.slice(0,50).forEach(t=>{
    const sym=String(t?.symbol||'').slice(0,32);
    const rawT=String(t?.rawTkr||sym).slice(0,32);
    const desc=String(t?.description||sym).slice(0,160);
    const mktVal=['KR','US','JP'].includes(t?.market)?t.market:'US';
    const priceVal=(typeof t?.price==='number'&&Number.isFinite(t.price)&&t.price>0)?t.price:'';
    const button=document.createElement('button');
    button.type='button';
    button.className='stock-search-option';
    button.style.cssText='width:100%;padding:10px 14px;cursor:pointer;font-size:var(--fs-body);border:0;border-bottom:1px solid var(--border-light);display:flex;justify-content:space-between;align-items:center;color:var(--t1);background:transparent;text-align:left';
    const name=document.createElement('span');
    name.style.cssText='font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px;color:var(--t1)';
    name.textContent=desc;
    const ticker=document.createElement('span');
    ticker.style.cssText='color:var(--t3);font-size:var(--fs-cap);background:var(--border-dark);padding:2px 6px;border-radius:4px;flex-shrink:0;margin-left:8px';
    ticker.textContent=sym;
    button.append(name,ticker);
    button.addEventListener('click',()=>selectTicker(sym,desc,rawT,mktVal,priceVal));
    fragment.appendChild(button);
  });
  dd.replaceChildren(fragment);
  dd.style.display='block';
}

function selectTicker(tkr, name, rawTkr, market, price) {
  const storeTkr = rawTkr || tkr.replace(/\.(KS|KQ)$/, '');
  document.getElementById('add-search').value = name + ' (' + tkr + ')';
  document.getElementById('search-dropdown').style.display='none';
  document.getElementById('add-search').dataset.tkr = storeTkr;
  document.getElementById('add-search').dataset.name = name;
  // stocks.json 종가 등 선택 시점 가격을 avgp 기본값으로 채움 (사용자 수정 가능)
  const _priceNum = parseFloat(price);
  if (Number.isFinite(_priceNum) && _priceNum > 0) {
    const avgpEl = document.getElementById('add-avgp');
    if (avgpEl && !avgpEl.value) {
      avgpEl.value = (market==='KR'||market==='KOSPI'||market==='KOSDAQ'||market==='JP') ? Math.round(_priceNum) : parseFloat(_priceNum.toFixed(4));
    }
  }
  // [3] 선택한 종목의 시장 정보로 hidden input + 화폐 select 자동 세팅
  const mktEl = document.getElementById('add-market');
  const curEl = document.getElementById('add-currency-stock');
  if (market === 'KR' || market === 'KOSPI' || market === 'KOSDAQ') {
    if(mktEl) mktEl.value = 'KR';
    if(curEl) curEl.value = 'KRW';
    document.getElementById('add-search').dataset.market = 'KR';
  } else if (market === 'JP') {
    if(mktEl) mktEl.value = 'JP';
    if(curEl) curEl.value = 'JPY';
    document.getElementById('add-search').dataset.market = 'JP';
  } else if (market === 'CRYPTO') {
    if(mktEl) mktEl.value = 'CRYPTO';
    if(curEl) curEl.value = 'USD';
    document.getElementById('add-search').dataset.market = 'CRYPTO';
  } else {
    if(mktEl) mktEl.value = 'US';
    if(curEl) curEl.value = 'USD';
    document.getElementById('add-search').dataset.market = 'US';
  }
  updateAvgpDecimalMode();
}

// ─── 🔍 get-stock.js 기반 종목 검색 (버튼 클릭) ─────────────────────────
async function searchStockByApi() {
  const val = (document.getElementById('add-search').value || '').trim();
  if (!val) return;

  const loading = document.getElementById('stock-search-loading');
  const result  = document.getElementById('stock-search-result');
  const errBox  = document.getElementById('stock-search-error');
  const manual  = document.getElementById('stock-manual-entry');

  if (result)  result.style.display  = 'none';
  if (errBox)  errBox.style.display  = 'none';
  if (manual)  manual.style.display  = 'none';
  if (loading) loading.style.display = 'block';

  const showManualFallback = (reason) => {
    if (errBox) {
      errBox.innerHTML = `${reason} <br><span style="color:var(--t3);font-size:var(--fs-cap)">외부 조회에 실패했습니다. 아래에서 직접 입력할 수 있습니다.</span>`;
      errBox.style.display = 'block';
    }
    if (manual) {
      // 입력값으로 초기 채우기
      const mTkr = document.getElementById('manual-tkr');
      const mName = document.getElementById('manual-name');
      if (mTkr && !mTkr.value) mTkr.value = /^[A-Za-z0-9.]+$/.test(val) ? val.toUpperCase() : '';
      if (mName && !mName.value) mName.value = val;
      manual.style.display = 'block';
    }
  };

  try {
    const res = await authFetch('/api/get-stock?query=' + encodeURIComponent(val));
    const data = await res.json().catch(()=>null);

    if (loading) loading.style.display = 'none';

    if (data && data.success) {
      // 2. 결과 미리보기 섹션 업데이트
      const nameEl = document.getElementById('result-name');
      const symEl = document.getElementById('result-symbol');
      const priceEl = document.getElementById('result-price');
      const priceStr = fmtPriceNative(data.price, data.currency);

      if (nameEl) nameEl.textContent = data.name;
      if (symEl) symEl.textContent = data.symbol;
      if (priceEl) priceEl.textContent = priceStr;

      window._stockSearchResult = data;
      if (result) result.style.display = 'block';
      if (errBox) errBox.style.display = 'none';
      if (manual) manual.style.display = 'none';
    } else {
      showManualFallback('검색 결과를 찾을 수 없습니다.');
    }
  } catch (e) {
    if (loading) loading.style.display = 'none';
    console.error('[searchStockByApi] Error:', e);
    showManualFallback('네트워크 오류가 발생했습니다.');
  }
}

// 외부 API 실패 시 수동으로 입력한 티커/종목명/현재가 적용
function confirmManualStock() {
  const tkrEl = document.getElementById('manual-tkr');
  const nameEl = document.getElementById('manual-name');
  const priceEl = document.getElementById('manual-price');
  const rawTkr = (tkrEl?.value || '').trim().toUpperCase();
  const name = (nameEl?.value || '').trim() || rawTkr;
  const priceRaw = (priceEl?.value || '').replace(/,/g,'').trim();
  const price = parseFloat(priceRaw);
  if (!rawTkr || isNaN(price) || price <= 0) {
    alert('티커와 현재가를 올바르게 입력하세요.');
    return;
  }
  // 종목 시장 판별
  // KRX 단축코드는 숫자로 시작하는 영숫자 6자리다(0117V0). 숫자만 보면 그런 종목이 미국 주식·달러로 등록된다.
  const isKR = /^[0-9][0-9A-Z]{5}$/.test(rawTkr);
  const isJP = /^\d{4}$/.test(rawTkr) || rawTkr.endsWith('.T');
  const isCrypto = ['BTC','ETH','XRP','SOL','BNB','DOGE','ADA','AVAX','MATIC','DOT','LINK','UNI','ATOM','LTC','TRX'].includes(rawTkr);
  const market = isKR ? 'KR' : (isJP ? 'JP' : (isCrypto ? 'CRYPTO' : 'US'));
  const cur = isKR ? 'KRW' : (isJP ? 'JPY' : 'USD');
  // 일본 4자리 코드는 .T 접미사로 정규화 (Yahoo Finance 조회용)
  const finalTkr = (isJP && /^\d{4}$/.test(rawTkr)) ? rawTkr + '.T' : rawTkr;

  const srch = document.getElementById('add-search');
  if (srch) {
    srch.value = name + ' (' + finalTkr + ')';
    srch.dataset.tkr = finalTkr;
    srch.dataset.name = name;
    srch.dataset.market = market;
  }
  const mktEl = document.getElementById('add-market');
  const curSel = document.getElementById('add-currency-stock');
  if (mktEl) mktEl.value = market;
  if (curSel) curSel.value = cur;
  updateAvgpDecimalMode();

  // 평균단가 입력란 자동 채움 (사용자가 수정 가능)
  const avgpEl = document.getElementById('add-avgp');
  if (avgpEl && !avgpEl.value) avgpEl.value = (isKR || isJP) ? Math.round(price) : parseFloat(price.toFixed(4));

  // 내부 선택 캐시 (confirmStockSelection 호환)
  window._stockSearchResult = {
    name, symbol: rawTkr, price, currency: cur,
    quoteType: isCrypto ? 'CRYPTOCURRENCY' : 'EQUITY', manual: true
  };
  // 결과 카드도 표시
  const result = document.getElementById('stock-search-result');
  const nameOutEl = document.getElementById('result-name');
  const symOutEl = document.getElementById('result-symbol');
  const priceOutEl = document.getElementById('result-price');
  if (nameOutEl) nameOutEl.textContent = name + ' (수동 입력)';
  if (symOutEl) symOutEl.textContent = rawTkr;
  if (priceOutEl) priceOutEl.textContent = fmtPriceNative(price, cur);
  if (result) result.style.display = 'block';
  const manual = document.getElementById('stock-manual-entry'); if (manual) manual.style.display = 'none';
  const errBox = document.getElementById('stock-search-error'); if (errBox) errBox.style.display = 'none';
}

// 검색 결과 확인 → 종목 선택 확정
function confirmStockSelection() {
  const d = window._stockSearchResult;
  if (!d) return;

  const sym    = d.symbol || '';
  const name   = d.name   || sym;
  const isKR   = sym.endsWith('.KS') || sym.endsWith('.KQ');
  const isJP   = sym.endsWith('.T') || d.currency === 'JPY';
  const isCrypto = d.quoteType === 'CRYPTOCURRENCY';
  const market = isKR ? 'KR' : (isJP ? 'JP' : (isCrypto ? 'CRYPTO' : 'US'));
  const rawTkr = isKR ? sym.replace(/\.(KS|KQ)$/, '') : sym;
  const cur    = isKR ? 'KRW' : (isJP ? 'JPY' : 'USD');

  // 검색창에 선택 반영
  const srch = document.getElementById('add-search');
  srch.value = name + ' (' + sym + ')';
  srch.dataset.tkr    = rawTkr;
  srch.dataset.name   = name;
  srch.dataset.market = market;

  // 화폐 자동 세팅
  const mktEl = document.getElementById('add-market');
  const curEl = document.getElementById('add-currency-stock');
  if (mktEl) mktEl.value = market;
  if (curEl) curEl.value = cur;
  updateAvgpDecimalMode();

  // 현재가 평균단가 자동 채우기 (사용자가 수정 가능)
  const avgpEl = document.getElementById('add-avgp');
  if (avgpEl && d.price && !avgpEl.value) {
    avgpEl.value = (isKR || isJP) ? Math.round(d.price) : parseFloat(d.price.toFixed(4));
  }

  // 결과 패널 닫기
  const result = document.getElementById('stock-search-result');
  if (result) result.style.display = 'none';
  document.getElementById('search-dropdown').style.display = 'none';
  window._stockSearchResult = null;
}

function onMarketChange() {
  const market = document.getElementById('add-market').value;
  const currSel = document.getElementById('add-currency-stock');
  // 화폐 줄(#wrap-currency-row)의 표시 여부는 toggleModalFields 가 정한다 — 여기서는 값만 맞춘다.
  if (currSel) {
    if (market === 'US' || market === 'CRYPTO') currSel.value='USD';
    else if (market === 'KR') currSel.value='KRW';
    else if (market === 'JP') currSel.value='JPY';
  }
  updateAvgpDecimalMode();
  document.getElementById('add-search').value='';
  document.getElementById('add-search').dataset.tkr='';
  document.getElementById('add-search').dataset.name='';
  document.getElementById('search-dropdown').style.display='none';
}

function toggleDcaDetail() {
  const isDca = document.getElementById('add-dca').checked;
  document.getElementById('wrap-dca-detail').style.display = isDca ? 'block' : 'none';
  document.getElementById('row-qty-price').style.display = isDca ? 'none' : 'flex';
  if (isDca) { toggleDcaDay(); toggleDcaMode(); }
}

function toggleDcaMode() {
  const mode = document.querySelector('input[name="dca-mode"]:checked')?.value || 'amount';
  const wAmt = document.getElementById('wrap-dca-amt');
  const wQty = document.getElementById('wrap-dca-qty');
  if (wAmt) wAmt.style.display = mode === 'qty' ? 'none' : '';
  if (wQty) wQty.style.display = mode === 'qty' ? '' : 'none';
  const curSel = document.getElementById('add-dca-cur');
  if (curSel) curSel.style.display = mode === 'qty' ? 'none' : '';
}

function toggleDcaDay() {
  const cycle = document.getElementById('add-dca-cycle').value;
  const wk = document.getElementById('wrap-dca-day-week');
  const mo = document.getElementById('wrap-dca-day-month');
  if (wk) wk.style.display = cycle === '매주' ? 'block' : 'none';
  if (mo) mo.style.display = cycle === '매월' ? 'block' : 'none';
}

// ── 시장 휴장일 (NYSE / KRX / JPX) ───────────────────────────────
// 연도별 하드코딩 대신 규칙으로 생성하고, 선거일처럼 규칙화할 수 없는 날짜만 명시한다.
const _MARKET_HOLIDAY_CACHE=new Map();
const _KR_ONE_OFF_HOLIDAYS=new Set(['2026-06-03']); // 전국 단위 선거일 등 확정 공휴일
function _dateAtNoon(y,m,d){return new Date(y,m,d,12,0,0,0);}
function _addDateKey(set,date){set.add(_cfLocalDateKey(date));}
function _nthWeekday(y,m,weekday,n){
  const d=_dateAtNoon(y,m,1);d.setDate(1+((7+weekday-d.getDay())%7)+(n-1)*7);return d;
}
function _lastWeekday(y,m,weekday){
  const d=_dateAtNoon(y,m+1,0);d.setDate(d.getDate()-((7+d.getDay()-weekday)%7));return d;
}
function _addObservedFixed(set,y,m,d){
  const actual=_dateAtNoon(y,m,d);_addDateKey(set,actual);
  const observed=new Date(actual);
  if(actual.getDay()===6)observed.setDate(observed.getDate()-1);
  else if(actual.getDay()===0)observed.setDate(observed.getDate()+1);
  _addDateKey(set,observed);
}
function _easterSunday(y){
  const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
  const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31)-1,day=((h+l-7*m+114)%31)+1;
  return _dateAtNoon(y,month,day);
}
function _usMarketHolidaySet(y){
  const key=`US:${y}`;if(_MARKET_HOLIDAY_CACHE.has(key))return _MARKET_HOLIDAY_CACHE.get(key);
  const set=new Set();
  _addObservedFixed(set,y,0,1);_addObservedFixed(set,y+1,0,1);
  _addDateKey(set,_nthWeekday(y,0,1,3));
  _addDateKey(set,_nthWeekday(y,1,1,3));
  const goodFriday=_easterSunday(y);goodFriday.setDate(goodFriday.getDate()-2);_addDateKey(set,goodFriday);
  _addDateKey(set,_lastWeekday(y,4,1));
  _addObservedFixed(set,y,5,19);_addObservedFixed(set,y,6,4);
  _addDateKey(set,_nthWeekday(y,8,1,1));
  _addDateKey(set,_nthWeekday(y,10,4,4));
  _addObservedFixed(set,y,11,25);
  _MARKET_HOLIDAY_CACHE.set(key,set);return set;
}
function _krLunarParts(date){
  try{
    const parts=new Intl.DateTimeFormat('en-u-ca-chinese',{month:'numeric',day:'numeric'}).formatToParts(date);
    return {month:Number(parts.find(p=>p.type==='month')?.value),day:Number(parts.find(p=>p.type==='day')?.value)};
  }catch(e){return {month:0,day:0};}
}
function _krHolidaySet(y,includeMarketClosures=true){
  const key=`KR:${y}:${includeMarketClosures?'market':'bank'}`;if(_MARKET_HOLIDAY_CACHE.has(key))return _MARKET_HOLIDAY_CACHE.get(key);
  const set=new Set(),substituteGroups=[];
  const addGroup=dates=>{dates.forEach(d=>_addDateKey(set,d));substituteGroups.push(dates);};
  [[0,1],[2,1],[4,5],[5,6],[7,15],[9,3],[9,9],[11,25]].forEach(([m,d])=>_addDateKey(set,_dateAtNoon(y,m,d)));
  _addDateKey(set,_dateAtNoon(y,4,1)); // 금융기관·거래소 근로자의 날 휴무
  if(y>=2026)_addDateKey(set,_dateAtNoon(y,6,17));
  let cursor=_dateAtNoon(y,0,1);
  while(cursor.getFullYear()===y){
    const lunar=_krLunarParts(cursor);
    if((lunar.month===1&&lunar.day===1)||(lunar.month===8&&lunar.day===15)){
      const dates=[-1,0,1].map(offset=>{const d=new Date(cursor);d.setDate(d.getDate()+offset);return d;});addGroup(dates);
    }else if(lunar.month===4&&lunar.day===8){addGroup([new Date(cursor)]);}
    cursor.setDate(cursor.getDate()+1);
  }
  [[2,1],[4,5],[7,15],[9,3],[9,9],[11,25]].forEach(([m,d])=>substituteGroups.push([_dateAtNoon(y,m,d)]));
  substituteGroups.forEach(group=>{
    if(!group.some(d=>d.getDay()===0||d.getDay()===6))return;
    const next=new Date(group[group.length-1]);
    do{next.setDate(next.getDate()+1);}while(next.getDay()===0||next.getDay()===6||set.has(_cfLocalDateKey(next)));
    if(next.getFullYear()===y)_addDateKey(set,next);
  });
  _KR_ONE_OFF_HOLIDAYS.forEach(d=>{if(d.startsWith(String(y)+'-'))set.add(d);});
  if(includeMarketClosures){
    let yearEnd=_dateAtNoon(y,11,31);while(yearEnd.getDay()===0||yearEnd.getDay()===6)yearEnd.setDate(yearEnd.getDate()-1);_addDateKey(set,yearEnd);
  }
  _MARKET_HOLIDAY_CACHE.set(key,set);return set;
}
function _jpEquinoxDay(y,autumn=false){
  return Math.floor((autumn?23.2488:20.8431)+0.242194*(y-1980)-Math.floor((y-1980)/4));
}
function _jpMarketHolidaySet(y){
  const key=`JP:${y}`;if(_MARKET_HOLIDAY_CACHE.has(key))return _MARKET_HOLIDAY_CACHE.get(key);
  const set=new Set(),base=[];
  const add=(m,d)=>{const x=_dateAtNoon(y,m,d);base.push(x);_addDateKey(set,x);};
  add(0,1);add(0,2);add(0,3);_addDateKey(set,_nthWeekday(y,0,1,2));
  add(1,11);add(1,23);add(2,_jpEquinoxDay(y,false));add(3,29);add(4,3);add(4,4);add(4,5);
  _addDateKey(set,_nthWeekday(y,6,1,3));add(7,11);_addDateKey(set,_nthWeekday(y,8,1,3));add(8,_jpEquinoxDay(y,true));
  _addDateKey(set,_nthWeekday(y,9,1,2));add(10,3);add(10,23);add(11,31);
  // 일요일 공휴일의 대체휴일
  Array.from(set).forEach(dateKey=>{
    const [yy,mm,dd]=dateKey.split('-').map(Number),d=_dateAtNoon(yy,mm-1,dd);if(d.getDay()!==0)return;
    do{d.setDate(d.getDate()+1);}while(set.has(_cfLocalDateKey(d)));if(d.getFullYear()===y)_addDateKey(set,d);
  });
  // 두 공휴일 사이의 평일은 국민의 휴일
  for(let d=_dateAtNoon(y,0,2);d.getFullYear()===y;d.setDate(d.getDate()+1)){
    if(d.getDay()===0||d.getDay()===6||set.has(_cfLocalDateKey(d)))continue;
    const prev=new Date(d),next=new Date(d);prev.setDate(prev.getDate()-1);next.setDate(next.getDate()+1);
    if(set.has(_cfLocalDateKey(prev))&&set.has(_cfLocalDateKey(next)))_addDateKey(set,d);
  }
  _MARKET_HOLIDAY_CACHE.set(key,set);return set;
}
function _isKrPublicHoliday(date){return _krHolidaySet(date.getFullYear(),false).has(_cfLocalDateKey(date));}
// 배당 입금 예상일 — 지난 지급일의 '일(日)'을 다른 달에 그대로 옮기면 토·일·공휴일에 떨어진다(2026-11-24 확인).
// 배당금은 국내 증권 계좌로 들어오므로 국내 은행 영업일로 맞춘다: 다음 영업일, 그러다 달이 넘어가면 직전 영업일.
// 배당 화면(향후 90일·월별)·일정(cal2)·현금 흐름 자동 배당 기록이 모두 이 한 함수를 쓴다.
function divPayBusinessDay(y,m0,day){
  const last=new Date(y,m0+1,0).getDate();
  const base=_dateAtNoon(y,m0,Math.max(1,Math.min(Number(day)||1,last)));
  const off=d=>d.getDay()===0||d.getDay()===6||_isKrPublicHoliday(d);
  const fwd=new Date(base);while(off(fwd))fwd.setDate(fwd.getDate()+1);
  if(fwd.getMonth()===m0)return fwd;
  const back=new Date(base);while(off(back))back.setDate(back.getDate()-1);
  return back;
}

function _getDcaMarket(item) {
  if (item.grp === '가상화폐') return 'CRYPTO'; // 24/7 no holidays
  if (item.cur === 'USD') return 'US';
  if (item.cur === 'JPY') return 'JP';
  return 'KR';
}

function _isDcaHoliday(dateObj, market) {
  const d = dateObj.getDay(); // 0=Sun, 6=Sat
  if (market !== 'CRYPTO' && (d === 0 || d === 6)) return true;
  const ds = _cfLocalDateKey(dateObj),y=dateObj.getFullYear();
  if (market === 'US') return _usMarketHolidaySet(y).has(ds);
  if (market === 'KR') return _krHolidaySet(y,true).has(ds);
  if (market === 'JP') return _jpMarketHolidaySet(y).has(ds);
  return false;
}

// ── 적립식 상태 한 벌(2026-11-20) ── 보유 목록 적립식 칸·적립식 매수 화면·고정비 묶음이 이 함수로 같은 집합을 그린다.
// 규칙 = 회당 금액(또는 수량)이 있는 것. 켜짐(dca) × 규칙 유무 네 조합:
//   on(켜짐+규칙) · paused(꺼짐+규칙 — 다시 켜면 그대로 재개) · incomplete(켜짐+금액 0 — 일정·합계는 0) · none(꺼짐+규칙 없음).
// 예전에는 보유 목록이 dca 만, 적립식 화면이 금액만 봐서 중단한 규칙이 한쪽에만 보였다.
function dcaHasRule(i){ return !!i&&(Number(i.dcaAmt)>0||(i.dcaMode==='qty'&&Number(i.dcaQty)>0)); }
function dcaState(i){
  if(!i) return 'none';
  const rule=dcaHasRule(i);
  if(i.dca) return rule?'on':'incomplete';
  return rule?'paused':'none';
}
// 소수점 수량의 미국 주식은 모두 '모으기'(매일 소수점 매수)로 산 종목이다(사용자 설명). 규칙이 없을 때 설정 창의 기본 주기만 '매일'로 둔다.
function dcaFractionalUs(i){
  const q=Number(i&&i.qty)||0;
  return !!i&&i.grp==='주식'&&i.cur==='USD'&&q>0&&Math.abs(q-Math.round(q))>1e-9;
}

// DCA 주기 레이블 (holdings 표시용)
function getDcaCycleLabel(item) {
  if (item.dcaCycle === '매일') return '매일';
  if (item.dcaCycle === '매주') {
    const days = Array.isArray(item.dcaDays) ? item.dcaDays : (item.dcaDay !== undefined ? [item.dcaDay] : [1]);
    const names = ['일','월','화','수','목','금','토'];
    return '매주 ' + days.slice().sort((a,b)=>a-b).map(d => names[d]).join('·');
  }
  const day=Math.max(1,Math.min(31,Number(item.dcaDay)||1));
  return `매월 ${day}일`;
}

// 자산 내역 표의 DCA 주기 칼럼 — 별도 배지 없이 주기만 표시한다.
function getDcaCellHtml(item){
  if (!item || !item.dca) return '<span style="color:var(--t3)">—</span>';
  return `<span class="dca-cycle">${getDcaCycleLabel(item)}</span>`;
}

// 회당 금액(또는 수량) 글자 — 켜짐·중단 두 상태가 같은 글자를 쓴다.
function getDcaAmountText(item){
  const isQty = item.dcaMode === 'qty';
  const sym = curSymbol(item.dcaCur || 'KRW');  // 통화 기호는 CURRENCY_META 단일 출처
  const unit = item.grp === '가상화폐' ? '개' : '주';
  return isQty
    ? (Number(item.dcaQty)||0).toLocaleString(undefined,{maximumFractionDigits:4}) + unit
    : sym + (Number(item.dcaAmt)||0).toLocaleString();
}
// 자산 내역 표의 회당 DCA 금액/수량 칼럼.
function getDcaAmountCellHtml(item){
  if (!item || !item.dca) return '<span style="color:var(--t3)">—</span>';
  return `<span class="dca-amount">${getDcaAmountText(item)}</span>`;
}
// 보유 목록의 '적립식' 한 칸 — 윗줄 주기, 아랫줄 회당 금액. 예전에는 'DCA 주기'·'회당 금액' 두 칸이었는데
// 대부분 '—' 인 두 칸이 표 폭의 13%를 차지해 종목명이 'TIGER 미…'로 잘렸다.
// 상태는 dcaState 한 벌이다. 중단한 규칙은 칸에 드러내지 않고 '—'(설정 없음과 같은 모양)이다(2026-11-20 8차, 사용자 결정) —
// 적립식 매수 화면도 중단한 규칙을 빼므로 두 화면이 같다. 규칙은 지우지 않아 칸을 누르면 설정 창에 그대로 채워지고 켜기만 하면 재개된다.
// pIdx 를 주면(넓은 화면 표) 칸 전체가 적립식 설정 창(cbDcaEdit) 버튼이다. 현금은 적립식 대상이 아니다.
const DCA_STATE_LABEL={on:'진행 중',paused:'중단',incomplete:'금액 미입력',none:'설정 없음'};
function getDcaMergedCellHtml(item, pIdx){
  const st=dcaState(item);
  let inner;
  if (st==='on') inner=getDcaCellHtml(item) + getDcaAmountCellHtml(item);
  else if (st==='incomplete') inner=`<span class="dca-cycle">${getDcaCycleLabel(item)}</span><span class="dca-amount is-missing">금액 미입력</span>`;
  else inner=getDcaCellHtml(item);   // 설정 없음·중단 → '—'
  if (pIdx==null || !item || item.grp==='현금') return inner;
  // 칸이 좁아 긴 요일 목록은 말줄임되므로 전체 규칙을 말풍선(title)에 적는다.
  const full=st==='none'?'적립식 설정 없음':st==='paused'?'적립식 꺼짐':[DCA_STATE_LABEL[st],getDcaCycleLabel(item),st==='incomplete'?'금액 미입력':getDcaAmountText(item)].join(' · ');
  const aria=st==='paused'?'꺼짐':DCA_STATE_LABEL[st];
  return `<button type="button" class="dca-cell-btn" onclick="cbDcaEdit(${Number(pIdx)})" title="${holdingsEsc(full)} — 눌러서 적립식 설정" aria-label="${holdingsEsc(item.name||item.tkr||'종목')} 적립식 설정 · ${aria}">${inner}</button>`;
}
// 평가액 칸 아랫줄의 비중 막대 — 막대 길이는 표에서 가장 큰 평가액 대비(홈 보유 표와 같은 방식),
// 숫자는 위 '평가액' 숫자 카드 합계 대비 비중이다. 새 계산 없이 각 행의 평가액만 쓴다.
function holdingsWeightHtml(val, total, max, cls){
  const v=Number(val)||0;
  const color=(typeof CB_CLS!=='undefined'&&CB_CLS[cls]?.color)||'var(--acc)';
  const width=max>0?Math.max(2,v/max*100):0;
  const pct=total>0?v/total*100:0;
  return `<span class="holdings-weight"><span class="home-weight-bar" aria-hidden="true"><i style="width:${width.toFixed(1)}%;background:${color}"></i></span><span class="holdings-weight-pct">${pct.toFixed(1)}%</span></span>`;
}
function holdingsEsc(s){ return escHtml(s); }
function updateOverflowTooltip(el){
  if (!el) return false;
  const watches = el.querySelectorAll('[data-overflow-watch]');
  const targets = watches.length ? Array.from(watches) : [el];
  const clipped = targets.some(node=>node.scrollWidth > node.clientWidth + 1);
  if (clipped) el.setAttribute('data-tip', el.getAttribute('data-overflow-tip') || '');
  else el.removeAttribute('data-tip');
  return clipped;
}
if (typeof document!=='undefined' && !window._overflowTipEventsBound){
  window._overflowTipEventsBound = true;
  document.addEventListener('mouseover', e=>{
    const el = e.target.closest?.('[data-overflow-tip]');
    if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    updateOverflowTooltip(el);
  }, true);
  document.addEventListener('mouseout', e=>{
    const el = e.target.closest?.('[data-overflow-tip]');
    if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    el.removeAttribute('data-tip');
  }, true);
}
function getTableFloatTip(){
  let tip = document.getElementById('table-float-tip');
  if (!tip){
    tip = document.createElement('div');
    tip.id = 'table-float-tip';
    tip.className = 'table-float-tip';
    tip.setAttribute('role','tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}
function formatTableFloatTipText(text){
  return String(text || '').replace(/([.!?])\s+(?=\S)/g, (all, mark, offset, source) => {
    const before = source.slice(Math.max(0, offset - 12), offset + 1);
    // 회사명·영문 약어 안의 마침표는 문장 경계로 취급하지 않는다.
    if (/(?:Inc|Corp|Co|Ltd|L\.P|S\.A|U\.S|e\.g|i\.e)\.$/i.test(before)) return all;
    return mark + '\n';
  });
}
function positionTableFloatTip(tip, anchor){
  if (!tip || !anchor) return;
  const gap = 8;
  const ar = anchor.getBoundingClientRect();
  const tr = tip.getBoundingClientRect();
  let left = ar.left + Math.min(ar.width/2, 90) - tr.width/2;
  left = Math.max(12, Math.min(left, window.innerWidth - tr.width - 12));
  let top = ar.top - tr.height - gap;
  if (top < 12) top = Math.min(window.innerHeight - tr.height - 12, ar.bottom + gap);
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(Math.max(12,Math.min(top,window.innerHeight-tr.height-12)))}px`;
}
function showTableFloatTip(anchor){
  const text = anchor && anchor.getAttribute('data-tip');
  if (!text) return;
  const tip = getTableFloatTip();
  tip.textContent = formatTableFloatTipText(text);
  tip.style.display = 'block';
  tip._anchor = anchor;
  // 터치 토글은 '이번 탭에서 열린 것'과 '이전 탭에서 이미 열려 있던 것'을 구분해야 한다.
  tip._shownAt = Date.now();
  positionTableFloatTip(tip, anchor);
}
function hideTableFloatTip(anchor){
  const tip = document.getElementById('table-float-tip');
  if (!tip || (anchor && tip._anchor && tip._anchor!==anchor)) return;
  tip.style.display = 'none';
  tip._anchor = null;
}
if (typeof document!=='undefined' && !window._tableFloatTipEventsBound){
  window._tableFloatTipEventsBound = true;
  // 터치로 탭하면 브라우저가 곧바로 mouseover→mousedown→click→mouseout 을 흉내 낸다.
  // 그 흉내 mouseout 이 방금 연 설명을 즉시 닫아버리므로, 터치 직후 짧은 창 동안은
  // 마우스 경로를 통째로 무시한다. (마우스만 쓰는 환경에서는 이 창이 열리지 않는다)
  const TOUCH_MOUSE_GRACE = 900;
  let _tipTouchAt = 0, _tipTouchPointer = false, _tipGestureAt = 0;
  const mouseFromTouch = () => Date.now() - _tipTouchAt < TOUCH_MOUSE_GRACE;

  document.addEventListener('mouseover', e=>{
    if (mouseFromTouch()) return;
    const el = e.target.closest?.('[data-tip]');
    if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    showTableFloatTip(el);
  }, true);
  document.addEventListener('mouseout', e=>{
    if (mouseFromTouch()) return;
    // 오버플로 툴팁은 앞선 mouseout 핸들러가 data-tip을 먼저 제거하므로
    // 원본 data-overflow-tip까지 대상으로 잡아 body 포털이 남지 않게 한다.
    const el = e.target.closest?.('[data-tip],[data-overflow-tip]');
    if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    hideTableFloatTip(el);
  }, true);
  // 키보드에서도 tabindex가 있는 설명 요소의 같은 툴팁을 볼 수 있게 한다.
  document.addEventListener('focusin', e=>{
    const el = e.target.closest?.('[data-tip]');
    if (el) showTableFloatTip(el);
  }, true);
  document.addEventListener('focusout', e=>{
    if (mouseFromTouch()) return;   // 터치는 아래 click 토글이 닫기를 맡는다
    const el = e.target.closest?.('[data-tip]');
    if (el) hideTableFloatTip(el);
  }, true);

  // 터치 기기에는 hover 가 없어 설명(data-tip)을 읽을 방법이 아예 없었다.
  // 탭으로 열고, 같은 곳을 다시 탭하거나 바깥을 누르면 닫는다.
  document.addEventListener('pointerdown', e=>{
    _tipTouchPointer = !!e.pointerType && e.pointerType!=='mouse';
    _tipGestureAt = Date.now();
    if (_tipTouchPointer) _tipTouchAt = _tipGestureAt;
  }, true);
  document.addEventListener('click', e=>{
    const touch = _tipTouchPointer; _tipTouchPointer = false;
    if (!touch) return;
    const el = e.target.closest?.('[data-tip]');
    const tip = document.getElementById('table-float-tip');
    const open = (tip && tip.style.display!=='none') ? tip._anchor : null;
    // 그 자체가 동작하는 요소는 탭이 곧 실행이라 설명을 띄우지 않는다 — 재렌더로 즉시 사라진다.
    if (!el || el.closest('button,a,select,input,textarea,[role="button"]')){
      if (open) hideTableFloatTip(open);
      return;
    }
    // tabindex 가 있는 요소는 탭과 동시에 focusin 이 먼저 툴팁을 연다. 그것까지 '이미 열려
    // 있었다'로 보면 이번 탭이 곧바로 닫아버려 터치에서는 설명이 끝내 안 보인다.
    const openedBefore = open && (tip._shownAt||0) < _tipGestureAt;
    if (open===el && openedBefore) hideTableFloatTip(el); else showTableFloatTip(el);
  }, true);

  // 차트 툴팁: 마우스는 히트 영역의 onmousemove 로, 터치는 여기서 위임 처리한다.
  // SVG <rect> 의 인라인 onpointerdown 은 브라우저가 이벤트 핸들러 속성으로 받아주지
  // 않으므로(onmousemove 와 달리) 인라인이 아니라 문서 위임으로 붙여야 실제로 동작한다.
  document.addEventListener('pointerdown', e=>{
    if (e.pointerType==='mouse') return;
    const hit = e.target.closest?.('[data-chart-hit]');
    if (!hit){
      const t = document.getElementById('cb-perf-tip'); if (t) t.style.display='none';
      const g = document.getElementById('cb-perf-guide'); if (g) g.style.display='none';
      return;
    }
    const [kind, idx] = String(hit.getAttribute('data-chart-hit')||'').split(':');
    const i = Number(idx);
    if (!Number.isFinite(i)) return;
    if (kind==='finNw' && typeof finNwHover==='function') finNwHover(e, i);
    else if (kind==='perf' && typeof cbPerfHover==='function') cbPerfHover(e, i);
  }, true);

  // role="button" tabindex="0" 로 표시한 요소는 Enter·Space 로도 눌려야 한다. 요소마다
  // 인라인 onkeydown 을 복사해 붙이는 대신(같은 스니펫이 네 벌까지 늘어났었다) 여기서 한 번에
  // 처리한다 — 마크업은 role 과 tabindex 만 달면 되고 활성화는 자동으로 따라온다.
  document.addEventListener('keydown', e=>{
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest?.('[role="button"][tabindex="0"]');
    // 진짜 button·a·input 은 브라우저가 이미 Enter/Space 를 처리한다 — 여기서 또 하면 두 번 실행된다.
    if (!el || el.matches('button,a,input,select,textarea')) return;
    e.preventDefault();
    el.click();
  }, true);

  document.addEventListener('scroll', ()=>{
    const tip = document.getElementById('table-float-tip');
    if (tip && tip.style.display!=='none' && tip._anchor) positionTableFloatTip(tip, tip._anchor);
  }, true);
  window.addEventListener('resize', ()=>hideTableFloatTip());
}
function getHoldingsBrokerCellHtml(item){
  const broker = item.broker || '—';
  const account = item.acc || '—';
  // 윗줄 증권사, 아랫줄 계좌 — 한 줄에 '미래에셋증권 / 연금저축'을 이어 쓰면 둘 다 잘렸다.
  // 계좌 앞 색 네모는 세제 유형(일반·ISA·연금 = --acct-*)으로, 계좌별 보기·리밸런싱 트리와 같은 색이다.
  // 이 함수가 '계좌 칸'의 단일 구현이다 — 구성원 비교 표도 cbAccountCell(cobalt.js)로 이것을 쓴다.
  const type=typeof getAccountDivTaxInfo==='function'?getAccountDivTaxInfo(item.acc).type:'일반';
  const kind=type==='ISA'?'isa':(type==='연금'?'pen':'gen');
  return `<span class="holdings-inline-cell holdings-broker-cell cb-acct-cell cb-tip-block" data-overflow-tip="${holdingsEsc(broker+' / '+account)}">`
    + `<span class="broker-txt cb-acct-broker" data-overflow-watch>${holdingsEsc(broker)}</span>`
    + `<span class="holdings-account cb-acct-name" data-overflow-watch><i class="fin-tree-kind ${kind}" aria-hidden="true"></i>${holdingsEsc(account)}</span></span>`;
}
function getHoldingsAssetCellHtml(name,ticker,item,tradeIdx){
  const parts = [name,ticker].filter(Boolean);
  let flag = '';
  if (item) {
    // 국기는 CURRENCY_META 를 따른다. 예전에는 비 USD/JPY 를 전부 'KR' 로 봐서
    // 호주달러 예수금에 태극기가 붙었다. 국기 도안이 없는 통화는 기호 배지로 대신한다.
    const market = curMeta(item.cur).flag;
    if ((item.grp==='주식'||item.grp==='현금') && typeof _mktFlagSvg==='function') {
      flag = (market==='KR'||market==='US'||market==='JP')
        ? `<span class="holdings-asset-flag">${_mktFlagSvg(market,15)}</span>`
        : `<span class="holdings-asset-flag holdings-cur-badge" aria-label="${holdingsEsc(String(item.cur||''))}">${holdingsEsc(curSymbol(item.cur))}</span>`;
    } else if (item.grp==='금') {
      flag = '<span class="holdings-asset-flag" aria-label="금"><svg width="23" height="15" viewBox="0 0 36 24" aria-hidden="true"><polygon points="5,9 14,3.5 30,6 21,11.5" fill="#ffe18a"/><polygon points="5,9 21,11.5 21,19 5,16.2" fill="#d9a520"/><polygon points="21,11.5 30,6 30,13.2 21,19" fill="#a96f0b"/></svg></span>';
    } else if (item.grp==='가상화폐') {
      flag = '<span class="holdings-asset-flag holdings-crypto-flag" aria-label="가상화폐">₿</span>';
    }
  }
  // 윗줄 이름, 아랫줄 티커(국기는 두 줄에 걸쳐 가운데) — CSS .holdings-asset-cell 격자
  return `<span class="holdings-inline-cell holdings-asset-cell cb-tip-block" data-overflow-tip="${holdingsEsc(parts.join(' · '))}">`
    + flag
    // 종목명을 누르면 매수·매도 입력이 열린다(현금·휴대폰 제외). Enter·Space 는 문서 위임이 처리한다.
    + (Number.isInteger(tradeIdx)&&tradeIdx>=0
        ? `<strong class="holdings-inline-name holdings-trade-link" data-overflow-watch role="button" tabindex="0" aria-label="${holdingsEsc(name||'종목')} 매수·매도 입력" onclick="openTradeModal(${tradeIdx})">${holdingsEsc(name||'—')}</strong>`
        : `<strong class="holdings-inline-name" data-overflow-watch>${holdingsEsc(name||'—')}</strong>`)
    + (ticker?`<span class="tkr-txt holdings-inline-ticker" data-overflow-watch>${holdingsEsc(ticker)}</span>`:'')
    + `</span>`;
}
// 보유 목록 정렬 머리글. 숫자 칸은 첫 클릭 내림차순, 글자 칸(소유주·계좌·종목)은 오름차순(sortPortfolioTable).
// 머리글 모양(화살표·aria-sort)은 지금 정렬 상태로 그린다 — 표를 다시 그려도 상태가 남아 있으면 그대로 보인다.
const PORTFOLIO_SORT_FIELDS=['owner','acct','name','dca','qty','avgP','curP','valKRW','profit','profitPct'];
const PORTFOLIO_SORT_ASC_FIRST=['owner','acct','name'];
function portfolioSortHeader(group,field,label,cls){
  const safeGroup=['주식','가상화폐','금','현금'].includes(group)?group:'주식';
  const safeField=PORTFOLIO_SORT_FIELDS.includes(field)?field:'qty';
  const st=(typeof _sortState!=='undefined'&&_sortState[safeGroup])||null;
  const dir=st&&st.field===safeField?st.dir:0;
  return `<th class="sortable${cls?' '+cls:''}${dir===1?' sort-asc':dir===-1?' sort-desc':''}" data-sort-field="${safeField}" aria-sort="${dir===1?'ascending':dir===-1?'descending':'none'}"><button type="button" class="table-sort-btn" onclick="sortPortfolioTable('${safeGroup}','${safeField}',this)">${holdingsEsc(label)}</button></th>`;
}
// 행의 정렬 값(원시 숫자·글자). 표시 문자열(통화 기호·금액 가리기·부호)과 무관하게 정렬된다. 값이 없으면 빈칸 → 끝.
function portfolioSortData(values){
  return Object.entries(values).map(([key,value])=>`data-sort-${key.toLowerCase()}="${typeof value==='string'?holdingsEsc(value):value!=null&&Number.isFinite(Number(value))?Number(value):''}"`).join(' ');
}
// 정렬 값에 쓰는 소유주 순서·계좌 이름·적립식 월 환산(원화). 적립식이 꺼진 종목은 값 없음(끝).
function portfolioSortKeys(i){
  const k=OWNERS.indexOf(i.owner);
  return {owner:k<0?OWNERS.length:k, acct:[i.broker||'',i.acc||''].join(' ').trim(), name:String(i.name||i.tkr||''),
    dca:i.dca&&typeof cbDcaPerMonthKRW==='function'?cbDcaPerMonthKRW(i):null};
}


async function toggleCostUnknown() {
  const checked=!!document.getElementById('add-cost-unknown')?.checked;
  const avg=document.getElementById('add-avgp');
  if(!avg) return;
  avg.disabled=checked;
  avg.style.opacity=checked?'.45':'1';
  avg.placeholder=checked?'취득가 미상':'0';
  if(checked) avg.value='';
}

function toggleModalFields() {
  const grp = document.getElementById('add-grp').value;
  const isStock = grp === '주식';
  const isCrypto = grp === '가상화폐';
  const isGold = grp === '금';
  const isCash = grp === '현금';
  document.getElementById('row-market-search').style.display = (isCash || isGold) ? 'none' : 'block';
  document.getElementById('row-gold-name').style.display = isGold ? 'block' : 'none';
  document.getElementById('row-qty-price').style.display = isCash ? 'none' : 'flex';
  document.getElementById('row-cash-only').style.display = isCash ? 'block' : 'none';
  document.getElementById('wrap-dca-toggle').style.display = (isStock || isCrypto) ? 'block' : 'none';
  const unknownWrap=document.getElementById('wrap-cost-unknown');
  if(unknownWrap) unknownWrap.style.display=isGold?'block':'none';
  if(!isGold){
    const unknown=document.getElementById('add-cost-unknown');
    if(unknown) unknown.checked=false;
  }
  toggleCostUnknown();

  const unitFixed = document.getElementById('unit-fixed');
  const unitSel = document.getElementById('add-unit');

  const cRow=document.getElementById('wrap-currency-row');
  if (isGold) {
    if(unitFixed)unitFixed.style.display='none';
    if(unitSel)unitSel.style.display='flex';
    if(cRow)cRow.style.display='none';
    document.getElementById('label-qty').innerText='수량 / 단위';
    const qtyElG=document.getElementById('add-qty');
    if(qtyElG){delete qtyElG.dataset.decimal;qtyElG.setAttribute('inputmode','numeric');}
  } else if (isCrypto) {
    if(cRow)cRow.style.display='none';
    if(unitFixed){unitFixed.innerText='개';unitFixed.style.display='flex';}
    if(unitSel)unitSel.style.display='none';
    const mktEl=document.getElementById('add-market');if(mktEl)mktEl.value='CRYPTO';
    const curEl=document.getElementById('add-currency-stock');if(curEl)curEl.value='USD';
    document.getElementById('label-qty').innerText='수량 (개)';
    // 코인 수량은 소수점 허용 (0.001 BTC 등)
    const qtyEl=document.getElementById('add-qty');
    if(qtyEl){qtyEl.dataset.decimal='1';qtyEl.setAttribute('inputmode','decimal');}
  } else if (isStock) {
    if(unitFixed){unitFixed.innerText='주';unitFixed.style.display='flex';}
    if(unitSel)unitSel.style.display='none';
    document.getElementById('label-qty').innerText='수량 (주)';
    const qtyElS=document.getElementById('add-qty');
    if(qtyElS){qtyElS.dataset.decimal='1';qtyElS.setAttribute('inputmode','decimal');}
    // 화폐 선택 표시 (주식만)
    const cRow=document.getElementById('wrap-currency-row');
    if(cRow)cRow.style.display='flex';
    onMarketChange();
  }
}

function applyHoldingsOwnerFilter() {
  const sel = document.getElementById('holdings-owner-filter');
  if (!sel) return;
  renderPortfolio(sel.value);
}

function applyHoldingsBrokerFilter() {
  const sel = document.getElementById('holdings-broker-filter');
  if (!sel) return;
  _holdingsBrokerFilter = sel.value;
  renderPortfolio(currentOwner);
}
