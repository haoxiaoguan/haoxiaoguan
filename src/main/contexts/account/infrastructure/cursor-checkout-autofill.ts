import type { BrowserWindow } from 'electron'

// Cursor 结账内嵌窗口的「随机地址自动填充」。
//
// 约束：地址生成接口(meiguodizhi)响应无 CORS 头，页面内 fetch 会被拦，故由主进程预拉一批
// 日本地址，再用 webContents.executeJavaScript 注入一个浮动按钮 + 填表脚本（注入脚本运行在
// isolated world，可读写 DOM、不受页面 CSP 限制；主进程 fetch 无 CORS）。
//
// 结账走 Stripe Checkout：cursor.com/checkoutDeepControl 跳到 checkout.stripe.com（表单在此），
// 且需先选中支付宝，姓名/账单地址表单才展开——故填充是「选支付宝 → 轮询重试填表」。
//
// ⚠️ 表单字段选择器无法在此环境核验，用防御式多策略匹配，并在按钮下显示「填了哪些字段」。

const ADDRESS_API = 'https://www.meiguodizhi.com/api/v1/dz'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

// 日本 47 都道府县：[罗马字, 日文汉字, 简体中文, JIS 两位码]。API 返回罗马字州名，但 Stripe 辖区
// 下拉可能用其中任意一种格式，故把州名解析成全部候选逐个试选（覆盖罗马字/日文汉字/简体/JP-XX 码）。
const JP_PREFECTURES: ReadonlyArray<readonly [string, string, string, string]> = [
  ['Hokkaido', '北海道', '北海道', '01'],
  ['Aomori', '青森県', '青森县', '02'],
  ['Iwate', '岩手県', '岩手县', '03'],
  ['Miyagi', '宮城県', '宫城县', '04'],
  ['Akita', '秋田県', '秋田县', '05'],
  ['Yamagata', '山形県', '山形县', '06'],
  ['Fukushima', '福島県', '福岛县', '07'],
  ['Ibaraki', '茨城県', '茨城县', '08'],
  ['Tochigi', '栃木県', '枥木县', '09'],
  ['Gunma', '群馬県', '群马县', '10'],
  ['Saitama', '埼玉県', '埼玉县', '11'],
  ['Chiba', '千葉県', '千叶县', '12'],
  ['Tokyo', '東京都', '东京都', '13'],
  ['Kanagawa', '神奈川県', '神奈川县', '14'],
  ['Niigata', '新潟県', '新潟县', '15'],
  ['Toyama', '富山県', '富山县', '16'],
  ['Ishikawa', '石川県', '石川县', '17'],
  ['Fukui', '福井県', '福井县', '18'],
  ['Yamanashi', '山梨県', '山梨县', '19'],
  ['Nagano', '長野県', '长野县', '20'],
  ['Gifu', '岐阜県', '岐阜县', '21'],
  ['Shizuoka', '静岡県', '静冈县', '22'],
  ['Aichi', '愛知県', '爱知县', '23'],
  ['Mie', '三重県', '三重县', '24'],
  ['Shiga', '滋賀県', '滋贺县', '25'],
  ['Kyoto', '京都府', '京都府', '26'],
  ['Osaka', '大阪府', '大阪府', '27'],
  ['Hyogo', '兵庫県', '兵库县', '28'],
  ['Nara', '奈良県', '奈良县', '29'],
  ['Wakayama', '和歌山県', '和歌山县', '30'],
  ['Tottori', '鳥取県', '鸟取县', '31'],
  ['Shimane', '島根県', '岛根县', '32'],
  ['Okayama', '岡山県', '冈山县', '33'],
  ['Hiroshima', '広島県', '广岛县', '34'],
  ['Yamaguchi', '山口県', '山口县', '35'],
  ['Tokushima', '徳島県', '德岛县', '36'],
  ['Kagawa', '香川県', '香川县', '37'],
  ['Ehime', '愛媛県', '爱媛县', '38'],
  ['Kochi', '高知県', '高知县', '39'],
  ['Fukuoka', '福岡県', '福冈县', '40'],
  ['Saga', '佐賀県', '佐贺县', '41'],
  ['Nagasaki', '長崎県', '长崎县', '42'],
  ['Kumamoto', '熊本県', '熊本县', '43'],
  ['Oita', '大分県', '大分县', '44'],
  ['Miyazaki', '宮崎県', '宫崎县', '45'],
  ['Kagoshima', '鹿児島県', '鹿儿岛县', '46'],
  ['Okinawa', '沖縄県', '冲绳县', '47'],
]

function normLatin(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[āáàǎ]/g, 'a')
    .replace(/[ēéèě]/g, 'e')
    .replace(/[īíìǐ]/g, 'i')
    .replace(/[ōóòǒ]/g, 'o')
    .replace(/[ūúùǔ]/g, 'u')
    .replace(/\s+/g, '')
}

/** 把 API 的罗马字州名解析成辖区下拉可能用到的全部候选（罗马字/日文汉字/简体/ISO 码/中文首段）。 */
function jpStateVariants(romajiState: string, cnState: string): string[] {
  const out = new Set<string>()
  if (romajiState) out.add(romajiState)
  if (cnState) out.add(cnState)
  const key = normLatin(romajiState)
  let row = JP_PREFECTURES.find((r) => normLatin(r[0]) === key)
  // API 的罗马字 State 有时是城市名（如 Kuki=久喜，实为埼玉县）而非都道府县，用中文都道府县兜底
  // 反查（去「县/県/都/府/道」核心比较），拿到正确的都道府县全套候选。
  if (row === undefined && cnState.length > 0) {
    const core = cnState.replace(/[县県都府道]/g, '')
    if (core.length > 0) {
      row = JP_PREFECTURES.find(
        (r) => r[2].replace(/[县県都府道]/g, '') === core || r[1].replace(/[県都府道]/g, '') === core,
      )
    }
  }
  if (row) {
    out.add(row[0])
    out.add(row[1])
    out.add(row[2])
    out.add('JP-' + row[3])
    out.add(row[3])
  }
  return [...out].filter((x) => x.length > 0)
}

export interface JpAddress {
  fullName: string
  addressLine: string
  city: string
  state: string
  /** 州(都道府县)候选：罗马字/日文汉字/简体中文/ISO 码等，逐个试选辖区下拉。 */
  stateVariants: string[]
  zip: string
  phone: string
}

async function fetchOneAddress(): Promise<JpAddress | null> {
  try {
    const resp = await fetch(ADDRESS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ city: '', path: '/jp-address', method: 'refresh' }),
      signal: AbortSignal.timeout(15000),
    })
    if (!resp.ok) return null
    const json = (await resp.json()) as { address?: Record<string, string>; status?: string }
    const a = json.address
    if (!a) return null
    // 从中文地址(如「东京都目黑区…」)抽出首段都道府县，作为额外候选。
    const cnMatch = (a.Trans_Cn_Address ?? '').match(/^([一-鿿]{1,6}?[都道府県县])/)
    const state = a.State ?? ''
    return {
      fullName: a.Full_Name ?? '',
      addressLine: a.Trans_Address ?? a.Address ?? '',
      city: a.City ?? '',
      state,
      stateVariants: jpStateVariants(state, cnMatch ? cnMatch[1] : ''),
      zip: a.Zip_Code ?? '',
      phone: a.Telephone ?? '',
    }
  } catch {
    return null
  }
}

/** 主进程并行预拉 count 个随机日本地址（供按钮循环切换）。失败的丢弃。 */
export async function fetchRandomJpAddresses(count: number): Promise<JpAddress[]> {
  const results = await Promise.all(Array.from({ length: count }, () => fetchOneAddress()))
  return results.filter((x): x is JpAddress => x !== null)
}

/** 生成注入到结账页的 IIFE 脚本（浮动按钮 + 支付宝 + 填表）。addresses 以 JSON 内联。 */
export function buildAutofillScript(addresses: JpAddress[]): string {
  const data = JSON.stringify(addresses)
  return `(function(){
  if (window.__hxgAutofillInstalled) return;
  window.__hxgAutofillInstalled = true;
  var ADDRS = ${data};
  var idx = 0;

  function log(){ try { console.log.apply(console, ['[hxg-autofill]'].concat([].slice.call(arguments))); } catch(e){} }

  // React 感知赋值：走原生 setter 再派发 input/change/blur，令受控组件识别。
  function setValue(el, value){
    if (!el) return false;
    try {
      var proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype
        : el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    } catch(e){ return false; }
  }
  // 归一化：去长音(ō→o 等)、去「県/县/府/都/prefecture/ken」、去空格、小写——令罗马字州名
  // 能匹配到本地化/带长音的下拉选项。
  function norm(s){
    return (s||'').toLowerCase()
      .replace(/[āáàǎ]/g,'a').replace(/[ēéèě]/g,'e').replace(/[īíìǐ]/g,'i').replace(/[ōóòǒ]/g,'o').replace(/[ūúùǔ]/g,'u')
      .replace(/県|县|府|都|prefecture|ken|\\s+/g,'').trim();
  }
  function setSelect(sel, text){
    if (!sel || sel.tagName !== 'SELECT' || !text) return false;
    var opts = [].slice.call(sel.options), i, o, t = norm(text);
    for (i=0;i<opts.length;i++){ if (opts[i].value === text) return setValue(sel, opts[i].value); }
    for (i=0;i<opts.length;i++){ o=opts[i]; if (norm(o.value)===t || norm(o.textContent)===t) return setValue(sel, o.value); }
    for (i=0;i<opts.length;i++){ o=opts[i]; if (t && (norm(o.value).indexOf(t)!==-1 || norm(o.textContent).indexOf(t)!==-1)) return setValue(sel, o.value); }
    return false;
  }
  function setField(el, value){
    if (!el) return false;
    return el.tagName === 'SELECT' ? setSelect(el, value) : setValue(el, value);
  }

  function pick(){
    for (var i=0;i<arguments.length;i++){
      try { var el = document.querySelector(arguments[i]); if (el) return el; } catch(e){}
    }
    return null;
  }
  function byLabelText(text){
    var labels = [].slice.call(document.querySelectorAll('label'));
    for (var i=0;i<labels.length;i++){
      var l = labels[i];
      if (l.textContent && l.textContent.indexOf(text) !== -1){
        var forId = l.getAttribute('for');
        if (forId){ var el = document.getElementById(forId); if (el) return el; }
        var inner = l.querySelector('input,select,textarea'); if (inner) return inner;
        var p = l.parentElement; if (p){ var sib = p.querySelector('input,select,textarea'); if (sib) return sib; }
      }
    }
    return null;
  }
  function clickByText(text){
    var els = [].slice.call(document.querySelectorAll('button,a,span,div,label'));
    for (var i=0;i<els.length;i++){
      if ((els[i].textContent||'').trim() === text){ try { els[i].click(); return true; } catch(e){} }
    }
    return false;
  }

  // 点 el，并向上找可点祖先(label/button/a/[role]/[tabindex]/含 alipay 标识)各点一次，
  // 以适配「隐藏 radio + 自定义可点行/手风琴」这类 Stripe 支付方式控件。
  function clickChain(el){
    try { el.click(); } catch(e){}
    var p = el, hops = 0;
    while (p && p.getAttribute && hops < 6){
      var tag = p.tagName, dt = (p.getAttribute('data-testid')||'').toLowerCase();
      if (tag==='LABEL'||tag==='BUTTON'||tag==='A'||p.getAttribute('role')||p.hasAttribute('tabindex')||dt.indexOf('alipay')!==-1){
        try { p.click(); } catch(e){}
      }
      p = p.parentElement; hops++;
    }
  }
  function isAlipaySelected(){
    var r = document.querySelector('#payment-method-accordion-item-title-alipay');
    return !!(r && r.checked);
  }
  function selectAlipay(){
    // Stripe Checkout 手风琴：点 Alipay 的 accordion 按钮（选中并展开地址表单）+ 点其 radio。
    var btn = pick('button[data-testid="alipay-accordion-item-button"]','[data-testid="alipay-accordion-item"] button','[data-testid="alipay-accordion-item"]');
    if (btn){ clickChain(btn); }
    var radio = pick('#payment-method-accordion-item-title-alipay','input[type=radio][id*="alipay" i]');
    if (radio){ try { radio.click(); } catch(e){} }
    if (!btn && !radio){
      // 兜底：文本含"支付宝"、不含"银行卡"的最小可点行。
      var all = [].slice.call(document.querySelectorAll('button,[role="radio"],label,li,div'));
      var best=null, bl=1e9;
      for (var i=0;i<all.length;i++){ var t=(all[i].textContent||''); if (t.indexOf('支付宝')!==-1 && t.indexOf('银行卡')===-1 && t.length<bl){ best=all[i]; bl=t.length; } }
      if (best){ var r2=best.querySelector&&best.querySelector('input[type=radio]'); if(r2){try{r2.click();}catch(e){}} clickChain(best); }
    }
    return isAlipaySelected();
  }

  function setCountryJapan(){
    var sel = pick('select#billingCountry','select[name="billingCountry"]','select[name="country"]','select[autocomplete="country"]');
    if (!sel){ var lab = byLabelText('账单地址'); if (lab && lab.tagName==='SELECT') sel = lab; }
    if (sel && sel.tagName==='SELECT'){
      if (setSelect(sel,'JP')) return true;
      if (setSelect(sel,'Japan')) return true;
      if (setSelect(sel,'日本')) return true;
    }
    return false;
  }

  function fillStructured(a){
    var d = {};
    d.line = setField(pick('#billingAddressLine1','input[name="billingAddressLine1"]','input[name="addressLine1"]','input[name="line1"]','input[autocomplete="address-line1"]','input[name="address"]') || byLabelText('地址'), a.addressLine);
    d.city = setField(pick('#billingLocality','input[name="billingLocality"]','input[name="addressLevel2"]','input[autocomplete="address-level2"]','input[name="city"]'), a.city);
    var stEl = pick('#billingAdministrativeArea','select[name="billingAdministrativeArea"]','input[name="billingAdministrativeArea"]','input[name="addressLevel1"]','select[name="addressLevel1"]','input[autocomplete="address-level1"]','input[name="state"]');
    var sv = (a.stateVariants && a.stateVariants.length) ? a.stateVariants : [a.state];
    d.state = false;
    for (var si=0; si<sv.length; si++){ if (setField(stEl, sv[si])){ d.state = true; break; } }
    d.zip = setField(pick('#billingPostalCode','input[name="billingPostalCode"]','input[name="postalCode"]','input[autocomplete="postal-code"]','input[name="zip"]','input[name="postal_code"]'), a.zip);
    return d;
  }

  function status(msg){
    var s = document.getElementById('__hxg-autofill-status');
    if (!s){
      s = document.createElement('div'); s.id='__hxg-autofill-status';
      s.style.cssText='position:fixed;top:52px;right:16px;z-index:2147483647;max-width:380px;max-height:72vh;overflow:auto;padding:8px 12px;background:rgba(17,24,39,.96);color:#e5e7eb;border-radius:8px;font-size:12px;line-height:1.5;box-shadow:0 2px 8px rgba(0,0,0,.3);white-space:pre-wrap;word-break:break-all;';
      document.body.appendChild(s);
    }
    s.textContent = msg;
  }

  // 选支付宝后地址表单才异步展开，故：前几轮尝试选中支付宝（选中后不再点，避免手风琴被收起），
  // 之后轮询把陆续出现的字段逐个填上（|| 累积，不重复覆盖）。
  function fill(a){
    if (!a){ status('地址获取失败，请关闭本窗口重开重试'); return; }
    var r = { name:false, country:false, manual:false, line:false, city:false, state:false, zip:false };
    var tries = 0;
    var timer = setInterval(function(){
      tries++;
      if (!isAlipaySelected() && tries <= 5) selectAlipay();
      if (!r.name) r.name = setValue(pick('#billingName','input[name="billingName"]','input[name="name"]','input[autocomplete="name"]','input[autocomplete="cc-name"]') || byLabelText('姓名'), a.fullName);
      if (!r.country) r.country = setCountryJapan();
      if (!r.manual) r.manual = clickByText('手动输入地址') || clickByText('Enter address manually');
      var d = fillStructured(a);
      if (!r.line) r.line = d.line;
      if (!r.city) r.city = d.city;
      if (!r.state) r.state = d.state;
      if (!r.zip) r.zip = d.zip;
      if ((r.line && r.zip) || tries >= 18){
        clearInterval(timer);
        status('已填充「'+a.fullName+'」\\n支付宝:'+(isAlipaySelected()?'✓':'✗')+' 姓名:'+(r.name?'✓':'✗')+' 国家:'+(r.country?'✓':'✗')+'\\n地址:'+(r.line?'✓':'✗')+' 城市:'+(r.city?'✓':'✗')+' 州:'+(r.state?'✓':'✗')+' 邮编:'+(r.zip?'✓':'✗')+'\\n若仍缺字段，点“诊断字段”把列表发我');
        log('filled', a, r, 'alipay', isAlipaySelected());
      }
    }, 350);
  }

  var btn = document.createElement('button');
  btn.id = '__hxg-autofill-btn';
  btn.textContent = '使用随机地址';
  btn.style.cssText='position:fixed;top:12px;right:16px;z-index:2147483647;padding:8px 14px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25);';
  btn.addEventListener('click', function(){
    if (!ADDRS.length){ status('地址获取失败，请关闭本窗口重开重试'); return; }
    var a = ADDRS[idx % ADDRS.length]; idx++;
    status('正在填充…');
    fill(a);
  });
  document.body.appendChild(btn);

  // 诊断：把页面所有可见输入框的 name/id/placeholder + 支付宝候选列进状态条，便于适配选择器。
  function dumpFields(){
    var out = [];
    [].slice.call(document.querySelectorAll('input,select,textarea')).forEach(function(el,i){
      if (el.type==='hidden') return;
      out.push(i+': <'+el.tagName.toLowerCase()+'> name='+(el.name||'-')+' id='+(el.id||'-')+' ph='+(el.placeholder||'-')+' ac='+(el.getAttribute('autocomplete')||'-')+' type='+(el.type||'-'));
    });
    var pays = [].slice.call(document.querySelectorAll('[data-testid],[role="radio"],button,label')).filter(function(e){
      return (e.textContent||'').indexOf('支付宝')!==-1 || (e.getAttribute('data-testid')||'').toLowerCase().indexOf('alipay')!==-1;
    }).map(function(e){ return e.tagName.toLowerCase()+' testid='+(e.getAttribute('data-testid')||'-')+' role='+(e.getAttribute('role')||'-'); });
    var st = document.querySelector('#billingAdministrativeArea,select[name="billingAdministrativeArea"]');
    var stTxt = st ? ('州下拉('+st.options.length+'项): '+[].slice.call(st.options).map(function(o){return (o.value||'')+'='+((o.textContent||'').trim());}).join(' | ')) : '州: 未找到下拉(可能未展开或是文本框)';
    var text='字段('+out.length+'):\\n'+out.join('\\n')+'\\n--支付宝候选--\\n'+(pays.join('\\n')||'无')+'\\n--州选项--\\n'+stTxt;
    status(text); log('FIELDS DUMP:\\n'+text);
  }
  var diag = document.createElement('button');
  diag.textContent = '诊断字段';
  diag.style.cssText='position:fixed;top:12px;right:140px;z-index:2147483647;padding:8px 12px;background:#374151;color:#fff;border:none;border-radius:8px;font-size:12px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25);';
  diag.addEventListener('click', dumpFields);
  document.body.appendChild(diag);

  log('installed, addresses:', ADDRS.length);
})();`
}

/**
 * 给结账内嵌窗口挂上「随机地址」自动填充：每次加载完成（cursor.com 或 stripe.com）就注入按钮；
 * 地址在首次注入时懒拉一批并缓存在闭包里（按钮循环切换）。
 */
export function wireCheckoutAutofill(win: BrowserWindow): void {
  let addresses: JpAddress[] = []
  let fetched = false

  const inject = async (): Promise<void> => {
    let url = ''
    try {
      url = win.webContents.getURL()
    } catch {
      return
    }
    // 结账走 Stripe Checkout：cursor.com/checkoutDeepControl 跳到 checkout.stripe.com（表单在此）。
    if (!/(cursor\.com|stripe\.com)/i.test(url)) return
    if (!fetched) {
      fetched = true
      addresses = await fetchRandomJpAddresses(5)
    }
    try {
      await win.webContents.executeJavaScript(buildAutofillScript(addresses))
    } catch {
      // 页面正在导航/销毁：忽略，下次 did-finish-load 再注入。
    }
  }

  win.webContents.on('did-finish-load', () => {
    void inject()
  })
}
