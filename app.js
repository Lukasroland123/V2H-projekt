'use strict';

// ── STATE ──────────────────────────────────────────────────────
var ESP = 'http://172.20.10.10';
var state = { v2h_active:false, battery_soc:95, min_soc:20, price_ore:100, savings_kr:0, savings_iphone:0, auto_stop:false };

// Gennemsnitlige timepriser (øre/kWh inkl. moms), indeks = time
var HOURLY_PRICES = [
  119, 119, 118, 119, 120, 128,  // 00-05
  151, 158, 143, 123,  88,  52,  // 06-11
   40,  38,  38,  40,  48, 123,  // 12-17
  154, 184, 193, 153, 144, 136   // 18-23  (22:00 = 1,438 kr/kWh)
];
var GAUGE_MIN = 30;   // øre/kWh
var GAUGE_MAX = 250;  // øre/kWh

function getCurrentPrice() {
  return HOURLY_PRICES[new Date().getHours()];
}
var ob = { elregning:0, kwh_forbrug:0, km_dag:0, personer:2, hjemoplad:'ja', aftensture:'nogle' };
var obStep = 1;
var obChoices = {};
var dlgShown = false;
var autoStopHandled = false;
var runToZero = false;
var savedMinSoc = 20;
var pollTimer = null;
var priceCache = null;
var priceCacheTime = 0;
var greenCache = null;
var greenCacheTime = 0;
var currentScreen = 'hjem';
var savPeriod = 'dag';
var v2hStartKr = 0;
var v2hStartTime = 0;
var autoMode = false;
var AUTO_THRESHOLD = 100; // øre/kWh — slår til under denne pris

// ── INIT ───────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', function() {
  localStorage.removeItem('v2h_onboarding');
  showOnboarding();
  initSwipe();
  initWheel();
  setInterval(updateClock, 1000);
  updateClock();
});

// ── CLOCK ──────────────────────────────────────────────────────
var DAYS = ['Søn','Man','Tir','Ons','Tor','Fre','Lør'];
var MONTHS = ['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'];
function pad(n){ return ('0'+n).slice(-2); }
function updateClock() {
  var d = new Date();
  var dt = document.getElementById('clk-date');
  var sb = document.getElementById('sb-time');
  var timeStr = pad(d.getHours())+':'+pad(d.getMinutes());
  if (sb) sb.textContent = timeStr;
  if (dt) dt.textContent = DAYS[d.getDay()]+' '+d.getDate()+'. '+MONTHS[d.getMonth()];
}

// ── ONBOARDING ─────────────────────────────────────────────────
function showOnboarding() {
  document.getElementById('onboarding').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  buildDots(5);
  setActiveDot(1);
}

function buildDots(n) {
  var c = document.getElementById('ob-dots');
  c.innerHTML = '';
  for (var i = 1; i <= n; i++) {
    var d = document.createElement('div');
    d.className = 'ob-dot';
    d.id = 'dot-'+i;
    c.appendChild(d);
  }
}

function setActiveDot(n) {
  for (var i = 1; i <= 5; i++) {
    var d = document.getElementById('dot-'+i);
    if (d) d.className = 'ob-dot' + (i <= n ? ' active' : '');
  }
}

function obNext(step) {
  if (step === 1) {
    var v2 = parseFloat(document.getElementById('inp-elregning').value);
    if (!v2 || v2 <= 0) { document.getElementById('inp-elregning').focus(); return; }
    ob.elregning = v2 / 3;
  } else if (step === 2) {
    var v3 = parseFloat(document.getElementById('inp-km').value);
    if (v3 === undefined || v3 < 0) v3 = 0;
    ob.km_dag = v3;
  } else if (step === 3) {
    ob.personer = parseInt(document.getElementById('stepper-val').textContent) || 2;
  } else if (step === 4) {
    if (!obChoices['hjemoplad']) { return; }
    ob.hjemoplad = obChoices['hjemoplad'];
  } else if (step === 5) {
    if (!obChoices['aftensture']) { return; }
    ob.aftensture = obChoices['aftensture'];
    showSummary();
    return;
  }
  var cur = document.getElementById('ob-step-'+step);
  var nxt = document.getElementById('ob-step-'+(step+1));
  if (cur) cur.style.display = 'none';
  if (nxt) nxt.style.display = 'flex';
  setActiveDot(step+1);
  obStep = step+1;
}

function stepperChange(d) {
  var el = document.getElementById('stepper-val');
  var v = parseInt(el.textContent) + d;
  if (v < 1) v = 1;
  if (v > 10) v = 10;
  el.textContent = v;
}

function setChoice(key, val, btn) {
  obChoices[key] = val;
  var parent = btn.parentElement;
  var btns = parent.querySelectorAll('.ob-choice');
  for (var i = 0; i < btns.length; i++) btns[i].classList.remove('selected');
  btn.classList.add('selected');
}

function showSummary() {
  document.getElementById('ob-step-5').style.display = 'none';
  document.getElementById('ob-summary').style.display = 'flex';
  document.getElementById('ob-dots').style.display = 'none';

  var minSoc = ob.aftensture === 'sjældent' ? 15 : ob.aftensture === 'ofte' ? 30 : 20;
  var elpris = ob.kwh_forbrug > 0 ? ob.elregning / ob.kwh_forbrug : 2.06;
  var mSav = Math.max(35, Math.round(ob.kwh_forbrug * 0.90 * (elpris - 1.32)));

  document.getElementById('sum-elpris').textContent = elpris.toFixed(2).replace('.', ',') + ' kr/kWh';
  document.getElementById('sum-besparelse').textContent = mSav + ' kr./md.';
  document.getElementById('sum-min').textContent = minSoc + '%';

  ob.minSoc = minSoc;
  ob.mSav = mSav;
  ob.elpris = elpris;
}

function obFinish() {
  ob.done = true;
  ob.startTs = ob.startTs || Date.now();
  localStorage.setItem('v2h_onboarding', JSON.stringify(ob));
  var minSoc = ob.minSoc || 20;
  fetch(ESP+'/set_min?v=' + minSoc);
  showApp();
}

// ── APP ────────────────────────────────────────────────────────
function showApp() {
  document.getElementById('onboarding').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  state.price_ore = getCurrentPrice();
  updateAllScreens(state);
  setInterval(function() {
    state.price_ore = getCurrentPrice();
    updateHjem(state);
  }, 60000);
  startPoll();
  if (currentScreen === 'strom') loadPriceData();
}

// ── NAVIGATION ─────────────────────────────────────────────────
function navTo(name, btn) {
  var screens = ['hjem','strom','batteri','besparelse','skoven'];
  for (var i = 0; i < screens.length; i++) {
    var s = document.getElementById('screen-'+screens[i]);
    if (s) s.style.display = screens[i] === name ? 'block' : 'none';
  }
  var btns = document.querySelectorAll('.nav-btn');
  for (var j = 0; j < btns.length; j++) btns[j].classList.remove('active');
  if (btn) btn.classList.add('active');
  currentScreen = name;
  if (name === 'strom') loadPriceData();
}

// ── STATUS POLL ────────────────────────────────────────────────
function startPoll() {
  if (pollTimer) clearTimeout(pollTimer);
  doPoll();
}

function doPoll() {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', ESP+'/status', true);
  xhr.timeout = 3000;
  xhr.onload = function() {
    if (xhr.status === 200) {
      try {
        var s = JSON.parse(xhr.responseText);
        state = s;
        updateAllScreens(s);
      } catch(e) {}
    }
    pollTimer = setTimeout(doPoll, 2000);
  };
  xhr.onerror = xhr.ontimeout = function() {
    pollTimer = setTimeout(doPoll, 3000);
  };
  xhr.send();
}

function updateAllScreens(s) {
  updateHjem(s);
  updateBatteri(s);
  updateSavings2();
  updateSkoven(s);
  if (s.v2h_active && !window._prevV2hActive) {
    showToast('Bilen er hjemme — V2H startet!');
  }
  window._prevV2hActive = s.v2h_active;
  if (s.auto_stop && !autoStopHandled) {
    autoStopHandled = true;
    if (runToZero) {
      runToZero = false;
      fetch(ESP+'/set_min?v=' + savedMinSoc);
      showToast('Batteri på 0% — elbil frakoblet');
    } else {
      // Frakobl automatisk og vis dialog
      fetch(ESP+'/off');
      dlgShown = true;
      document.getElementById('dlg').classList.add('open');
    }
  }
}

// ── HJEM ───────────────────────────────────────────────────────
function updateHjem(s) {
  var o = getCurrentPrice();
  // gauge marker: top=dyr(rød), bund=billig(grøn)
  var bar = document.getElementById('gauge-bar');
  if (bar) {
    var h = bar.offsetHeight || 200;
    var pct = Math.max(0, Math.min(1, (o - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)));
    var mt = (1 - pct) * (h - 4);
    document.getElementById('gauge-marker').style.top = mt + 'px';
  }
  document.getElementById('gauge-label').textContent = (o / 100).toFixed(2).replace('.', ',') + ' kr/kWh';
  var status = o < 80 ? 'Billig strøm' : o < 150 ? 'Normal pris' : 'Dyr strøm';

  var soc = s.battery_soc;
  var km = Math.max(0, Math.round((soc - s.min_soc) * 4));
  document.getElementById('hjem-soc').textContent = soc.toFixed(0) + '%';
  document.getElementById('hjem-km').textContent = km + ' km';
  document.getElementById('hjem-price').textContent = o.toFixed(0) + ' øre';
  document.getElementById('hjem-price-lbl').textContent = status;

  var savEl = document.getElementById('hjem-savings');
  if (savEl) savEl.textContent = s.savings_kr.toFixed(2).replace('.', ',') + ' kr.';
  var iphEl = document.getElementById('hjem-iphone');
  if (iphEl) iphEl.textContent = Math.round(s.savings_iphone) + ' opl.';

  // Auto mode logik
  if (autoMode) {
    var shouldBeOn = o < AUTO_THRESHOLD && soc > s.min_soc;
    if (shouldBeOn && !s.v2h_active) setV2H(true);
    else if (!shouldBeOn && s.v2h_active) setV2H(false);
  }

  var track = document.getElementById('swipe-track');
  var thumb = document.getElementById('swipe-thumb');
  var lbl = document.getElementById('swipe-lbl');
  if (!s.car_connected) {
    track.classList.remove('on');
    track.classList.add('locked');
    thumb.style.left = '6px';
    lbl.textContent = 'Kør bilen ind for at starte';
  } else if (s.v2h_active) {
    track.classList.remove('locked');
    track.classList.add('on');
    if (track) {
      var tw = track.offsetWidth || 280;
      thumb.style.left = (tw - 58) + 'px';
    }
    lbl.textContent = '← Frakobl elbil';
  } else {
    track.classList.remove('locked');
    track.classList.remove('on');
    thumb.style.left = '6px';
    lbl.textContent = 'Tilslut elbil →';
  }
}

// ── SWIPE TOGGLE ───────────────────────────────────────────────
function initSwipe() {
  var track = document.getElementById('swipe-track');
  if (!track) return;
  var startX = null;
  var dragging = false;

  function onStart(e) {
    startX = (e.touches ? e.touches[0].clientX : e.clientX);
    dragging = false;
  }
  function onMove(e) {
    if (startX === null) return;
    var x = (e.touches ? e.touches[0].clientX : e.clientX);
    if (Math.abs(x - startX) > 10) dragging = true;
  }
  function onEnd(e) {
    if (startX === null) return;
    var x = (e.changedTouches ? e.changedTouches[0].clientX : e.clientX);
    var diff = x - startX;
    if (!state.car_connected) { startX = null; dragging = false; return; }
    if (!dragging) {
      toggleV2H();
    } else if (!state.v2h_active && diff > 40) {
      setV2H(true);
    } else if (state.v2h_active && diff < -40) {
      setV2H(false);
    }
    startX = null;
    dragging = false;
  }

  track.addEventListener('touchstart', onStart, {passive:true});
  track.addEventListener('touchmove', onMove, {passive:true});
  track.addEventListener('touchend', onEnd);
  track.addEventListener('mousedown', onStart);
  track.addEventListener('mousemove', onMove);
  track.addEventListener('mouseup', onEnd);
}

function toggleAuto() {
  autoMode = !autoMode;
  var btn = document.getElementById('auto-btn');
  var lbl = document.getElementById('auto-lbl');
  if (autoMode) {
    btn.classList.add('on');
    lbl.textContent = 'Automatisk tilstand: TIL';
  } else {
    btn.classList.remove('on');
    lbl.textContent = 'Automatisk tilstand';
  }
}

function toggleV2H() {
  setV2H(!state.v2h_active);
}

function setV2H(on) {
  if (on) { autoStopHandled = false; runToZero = false; }
  fetch(on ? ESP+'/on' : ESP+'/off').then(function() { doPoll(); });
}

// ── BATTERI ────────────────────────────────────────────────────
function updateBatteri(s) {
  var soc = s.battery_soc;
  var km = Math.max(0, Math.round((soc - s.min_soc) * 4));

  document.getElementById('batt-pct').textContent = soc.toFixed(0) + '%';
  document.getElementById('batt-km').textContent = km + ' km';

  // SVG arc: radius 95, circumference of half circle = π*95 ≈ 298
  var circ = Math.PI * 95;
  var fill = document.getElementById('batt-fill');
  var trackEl = document.getElementById('batt-track');
  var offset = circ * (1 - soc / 100);
  fill.style.strokeDasharray = circ;
  fill.style.strokeDashoffset = offset;
  trackEl.style.strokeDasharray = circ;
  trackEl.style.strokeDashoffset = 0;

  var col = soc > 50 ? '#3b82f6' : soc > 25 ? '#eab308' : '#ef4444';
  fill.style.stroke = col;
  document.getElementById('batt-pct').style.color = col;

  document.getElementById('min-val-lbl').textContent = s.min_soc + '%';
  document.getElementById('min-slider').value = s.min_soc;

  // Batteritilstand fast 90%
  var health = 90;
  document.getElementById('health-bar').style.width = health + '%';
  document.getElementById('health-bar').style.background = '#22c55e';
  document.getElementById('health-pct').textContent = '90%';
  document.getElementById('health-pct').style.color = '#22c55e';
}

document.addEventListener('DOMContentLoaded', function() {
  var sl = document.getElementById('min-slider');
  if (!sl) return;
  sl.addEventListener('input', function() {
    document.getElementById('min-val-lbl').textContent = this.value + '%';
  });
  sl.addEventListener('change', function() {
    fetch(ESP+'/set_min?v=' + this.value);
  });
});

// ── STRØM ──────────────────────────────────────────────────────
function loadPriceData() {
  var chartData = HOURLY_PRICES.map(function(p, i) { return { hour: i, price: p }; });
  drawChart(chartData);
  loadGreenData();
  updatePriceUI(getCurrentPrice());
}

function updatePriceUI(o) {
  var el = document.getElementById('strom-price');
  if (el) el.textContent = (o / 100).toFixed(2).replace('.', ',');
  var tag = document.getElementById('strom-tag');
  if (!tag) return;
  if (o < 80) { tag.textContent = 'Billig strøm'; tag.className = 'strom-tag cheap'; }
  else if (o < 150) { tag.textContent = 'Normal pris'; tag.className = 'strom-tag mid'; }
  else { tag.textContent = 'Dyr strøm'; tag.className = 'strom-tag exp'; }
}

function loadGreenData() {
  var now = Date.now();
  if (greenCache && now - greenCacheTime < 300000) {
    renderGreen(greenCache);
    return;
  }
  var url = 'https://api.energidataservice.dk/dataset/PowerSystemRightNow?limit=1&sort=Minutes5DK%20desc';
  var xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.timeout = 8000;
  xhr.onload = function() {
    if (xhr.status === 200) {
      try {
        var d = JSON.parse(xhr.responseText);
        var r = d.records[0];
        var vind = Math.round(((r.OffshoreWindPct||0) + (r.OnshoreWindPct||0) + (r.SolarPct||0)) * 10) / 10;
        var fossil = Math.max(0, 100 - vind);
        // Fordel fossil på typisk dansk mix-ratio: bio 40%, gas 24%, kul 20%, atom 10%, olie 6%
        var mix = { vind: vind, bio: +(fossil*0.40).toFixed(1), gas: +(fossil*0.24).toFixed(1), kul: +(fossil*0.20).toFixed(1), atom: +(fossil*0.10).toFixed(1), olie: +(fossil*0.06).toFixed(1) };
        greenCache = mix;
        greenCacheTime = now;
        renderGreen(mix);
      } catch(e) {}
    }
  };
  xhr.send();
}

function renderGreen(data) {
  // data = { vind, bio, gas, kul, atom, olie } i procent
  var sources = ['vind','bio','gas','kul','atom','olie'];
  for (var i = 0; i < sources.length; i++) {
    var k = sources[i];
    var bar = document.getElementById('emix-'+k);
    var pctEl = document.getElementById('emix-'+k+'-pct');
    var val = data[k] || 0;
    if (bar) bar.style.width = val + '%';
    if (pctEl) {
      pctEl.textContent = val.toFixed(1) + '%';
      pctEl.style.color = bar ? bar.style.background : '#fff';
    }
  }
}

// ── PRICE CHART ────────────────────────────────────────────────
function drawChart(data) {
  var svg = document.getElementById('price-chart');
  if (!svg || !data || data.length === 0) return;
  var W = svg.parentElement.offsetWidth - 36 || 280;
  var H = 110;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

  var prices = data.map(function(d){ return d.price; });
  var maxP = Math.max.apply(null, prices) * 1.1 || 300;
  var minP = 0;
  var curH = new Date().getHours();
  var cheapIdx = prices.indexOf(Math.min.apply(null, prices));

  var xs = data.map(function(d, i){ return Math.round(i * (W - 1) / (data.length - 1)); });
  var ys = data.map(function(d){ return Math.round(H - 8 - (d.price - minP) / (maxP - minP) * (H - 16)); });

  // build path
  var path = 'M ' + xs[0] + ' ' + ys[0];
  for (var i = 1; i < xs.length; i++) path += ' L ' + xs[i] + ' ' + ys[i];

  // fill area
  var fill = path + ' L ' + xs[xs.length-1] + ' ' + H + ' L ' + xs[0] + ' ' + H + ' Z';

  svg.innerHTML = '';

  // gradient def
  var ns = 'http://www.w3.org/2000/svg';
  var defs = document.createElementNS(ns, 'defs');
  var grad = document.createElementNS(ns, 'linearGradient');
  grad.setAttribute('id', 'cg');
  grad.setAttribute('x1','0');grad.setAttribute('y1','0');
  grad.setAttribute('x2','0');grad.setAttribute('y2','1');
  var s1 = document.createElementNS(ns, 'stop');
  s1.setAttribute('offset','0%');s1.setAttribute('stop-color','#3b82f6');s1.setAttribute('stop-opacity','0.3');
  var s2 = document.createElementNS(ns, 'stop');
  s2.setAttribute('offset','100%');s2.setAttribute('stop-color','#3b82f6');s2.setAttribute('stop-opacity','0');
  grad.appendChild(s1);grad.appendChild(s2);defs.appendChild(grad);svg.appendChild(defs);

  // fill
  var fillEl = document.createElementNS(ns, 'path');
  fillEl.setAttribute('d', fill);
  fillEl.setAttribute('fill', 'url(#cg)');
  svg.appendChild(fillEl);

  // line
  var lineEl = document.createElementNS(ns, 'path');
  lineEl.setAttribute('d', path);
  lineEl.setAttribute('fill', 'none');
  lineEl.setAttribute('stroke', '#3b82f6');
  lineEl.setAttribute('stroke-width', '2');
  lineEl.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(lineEl);

  // current hour dot
  var curIdx = data.findIndex ? data.findIndex(function(d){ return d.hour === curH; }) : -1;
  if (curIdx >= 0) {
    var dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', xs[curIdx]);
    dot.setAttribute('cy', ys[curIdx]);
    dot.setAttribute('r', '5');
    dot.setAttribute('fill', '#3b82f6');
    svg.appendChild(dot);
  }

  // cheapest dot
  var cdot = document.createElementNS(ns, 'circle');
  cdot.setAttribute('cx', xs[cheapIdx]);
  cdot.setAttribute('cy', ys[cheapIdx]);
  cdot.setAttribute('r', '5');
  cdot.setAttribute('fill', '#22c55e');
  svg.appendChild(cdot);

  // x-axis labels (every 4 hours)
  for (var j = 0; j < data.length; j += 4) {
    var txt = document.createElementNS(ns, 'text');
    txt.setAttribute('x', xs[j]);
    txt.setAttribute('y', H);
    txt.setAttribute('text-anchor', 'middle');
    txt.setAttribute('fill', '#6b7a99');
    txt.setAttribute('font-size', '9');
    txt.textContent = data[j].hour + ':00';
    svg.appendChild(txt);
  }
}

// ── BESPARELSE ─────────────────────────────────────────────────
function setSavPeriod(period, btn) {
  savPeriod = period;
  var tabs = document.querySelectorAll('.sav-tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove('active');
  if (btn) btn.classList.add('active');
  updateSavings2();
}

function updateSavings2() {
  var krEl = document.getElementById('sav-kr');
  var iphEl = document.getElementById('sav-iphone');
  if (krEl) krEl.textContent = (state.savings_kr || 0).toFixed(2).replace('.', ',');
  if (iphEl) iphEl.textContent = Math.round(state.savings_iphone || 0);
  updateWheelDisplay();
  updateSimulator();
}

function updateSimulator() {
  var card = document.getElementById('sim-est-card');
  if (!card) return;
  if (!ob.done || !ob.kwh_forbrug) { card.style.display = 'none'; return; }
  card.style.display = '';
  var elpris = ob.elpris || (ob.kwh_forbrug > 0 ? ob.elregning / ob.kwh_forbrug : 2.06);
  var mSav = Math.max(35, Math.round(ob.kwh_forbrug * 0.90 * (elpris - 1.32)));
  var aSav = mSav * 12;
  var mdEl = document.getElementById('sim-md-kr');
  var aarEl = document.getElementById('sim-aar-kr');
  var prisEl = document.getElementById('sim-elpris');
  if (mdEl) mdEl.textContent = mSav + ' kr.';
  if (aarEl) aarEl.textContent = aSav.toLocaleString('da-DK') + ' kr.';
  if (prisEl) prisEl.textContent = elpris.toFixed(2).replace('.', ',');
}

// ── WEEK SPINNER ───────────────────────────────────────────────
var wheelWeeks = 1;

function initWheel() {
  var drum = document.getElementById('week-drum');
  if (!drum) return;
  var startY = null;
  var startWeeks = 1;

  function onStart(e) {
    startY = e.touches ? e.touches[0].clientY : e.clientY;
    startWeeks = wheelWeeks;
    e.preventDefault();
  }
  function onMove(e) {
    if (startY === null) return;
    var y = e.touches ? e.touches[0].clientY : e.clientY;
    var delta = Math.round((startY - y) / 8);
    var n = Math.max(1, Math.min(520, startWeeks + delta));
    if (n !== wheelWeeks) { wheelWeeks = n; updateWheelDisplay(); }
  }
  function onEnd() { startY = null; }

  drum.addEventListener('touchstart', onStart, {passive:false});
  drum.addEventListener('touchmove', onMove, {passive:false});
  drum.addEventListener('touchend', onEnd);
  drum.addEventListener('mousedown', onStart);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onEnd);
}

var KWH_PER_PHONE_CHARGE = 0.015; // kWh pr. fuld telefonopladning inkl. tab

function updateWheelDisplay() {
  var weeks = wheelWeeks;
  var krPrUge = ob.mSav ? ob.mSav * 12 / 52 : state.savings_kr * 7;
  var co2PerCharge = KWH_PER_PHONE_CHARGE * (BASELINE_G_PER_KWH / 1000);
  var annualCO2 = ob.kwh_forbrug > 0
    ? ob.kwh_forbrug * 12 * 0.90 * (BASELINE_G_PER_KWH * (1 - NIGHT_FACTOR)) / 1000
    : 0;
  var oplPrUge = co2PerCharge > 0 ? (annualCO2 / co2PerCharge) / 52 : 0;
  var inp = document.getElementById('wheel-weeks-input');
  var lblEl = document.getElementById('wheel-uger-lbl');
  var krEl = document.getElementById('wheel-kr');
  var oplEl = document.getElementById('wheel-opl');
  if (inp && document.activeElement !== inp) inp.value = weeks;
  if (lblEl) lblEl.textContent = weeks === 1 ? '1 uge' : weeks + ' uger';
  if (krEl) krEl.textContent = (krPrUge * weeks).toFixed(2).replace('.', ',') + ' kr.';
  if (oplEl) oplEl.textContent = Math.round(oplPrUge * weeks).toLocaleString('da-DK');
}

function wheelCenterClick() {
  var inp = document.getElementById('wheel-weeks-input');
  if (inp) {
    inp.focus();
    inp.select();
  }
}

function wheelInputChange(val) {
  var n = parseInt(val);
  if (n > 0) { wheelWeeks = n; updateWheelDisplay(); }
}

function wheelInputBlur() {
  var inp = document.getElementById('wheel-weeks-input');
  if (inp && (!inp.value || parseInt(inp.value) < 1)) {
    inp.value = 1; wheelWeeks = 1; updateWheelDisplay();
  }
}

// ── SKOVEN ─────────────────────────────────────────────────────
function updateSkoven(s) {
  updateCO2();
  if (!ob.done || !ob.kwh_forbrug) return;

  var yearly    = ob.kwh_forbrug * 12;
  var shifted   = yearly * 0.90;
  var nightG    = BASELINE_G_PER_KWH * NIGHT_FACTOR;
  var annualCO2 = shifted * (BASELINE_G_PER_KWH - nightG) / 1000;
  var dailyCO2  = annualCO2 / 365;

  var elapsed   = ob.startTs ? (Date.now() - ob.startTs) / 86400000 : 0;
  var totalCO2  = dailyCO2 * elapsed;
  var trees     = Math.floor(totalCO2 / TREE_CO2_KG_YEAR);
  var progress  = (totalCO2 % TREE_CO2_KG_YEAR) / TREE_CO2_KG_YEAR * 100;
  var daysToNext = (TREE_CO2_KG_YEAR - (totalCO2 % TREE_CO2_KG_YEAR)) / dailyCO2;

  var numEl   = document.getElementById('forest-trees');
  var barEl   = document.getElementById('forest-bar');
  var nextEl  = document.getElementById('forest-next');
  var sceneEl = document.getElementById('forest-scene');

  if (numEl) numEl.textContent = trees;
  if (barEl) barEl.style.width = Math.min(100, progress) + '%';
  if (nextEl) nextEl.textContent = trees === 0
    ? 'Næste træ om ca. ' + Math.ceil(daysToNext) + ' dage'
    : 'Næste træ om ca. ' + Math.ceil(daysToNext) + ' dage · Bøgetræ, 15 kg CO₂/år';
  if (sceneEl) {
    var icons = ['🌲','🌳','🌴','🌿'];
    var html  = '';
    var display = Math.min(trees, 20);
    for (var i = 0; i < display; i++) {
      html += '<span class="forest-tree" style="animation-delay:' + (i * 0.08) + 's">' + icons[i % icons.length] + '</span>';
    }
    if (trees === 0) html = '<span style="color:rgba(255,255,255,.3);font-size:13px">Træerne vokser — kom tilbage om et par måneder 🌱</span>';
    sceneEl.innerHTML = html;
  }
}

// ── CO2 ESTIMAT ────────────────────────────────────────────────
var BASELINE_G_PER_KWH = 69.3;  // Energistyrelsen DK1 2026
var NIGHT_FACTOR = 0.80;
var BATTERY_KWH = 60;
var CO2_PER_CHARGE_KG = BATTERY_KWH * BASELINE_G_PER_KWH / 1000; // 4.158 kg CO2e
var TREE_CO2_KG_YEAR = 15; // bøgetræ, kg CO2-optag pr. år

function updateCO2() {
  var card = document.getElementById('co2-card');
  if (!card) return;
  if (!ob.done || !ob.kwh_forbrug) { card.style.display = 'none'; return; }
  card.style.display = '';
  var yearly = ob.kwh_forbrug * 12;
  var shifted = yearly * 0.90;
  var affected = shifted * BASELINE_G_PER_KWH / 1000;
  var nightG = BASELINE_G_PER_KWH * NIGHT_FACTOR;
  var saving = shifted * (BASELINE_G_PER_KWH - nightG) / 1000;
  var treesYear = (saving / TREE_CO2_KG_YEAR).toFixed(1).replace('.', ',');
  var kwhEl  = document.getElementById('co2-kwh');
  var affEl  = document.getElementById('co2-affected');
  var savEl  = document.getElementById('co2-saving');
  var tlEl   = document.getElementById('trees-low');
  var thEl   = document.getElementById('trees-high');
  if (kwhEl) kwhEl.textContent = Math.round(shifted).toLocaleString('da-DK') + ' kWh';
  if (affEl) affEl.textContent = affected.toFixed(1).replace('.', ',') + ' kg CO₂e';
  if (savEl) savEl.textContent = saving.toFixed(1).replace('.', ',') + ' kg CO₂e';
  if (tlEl)  tlEl.textContent  = treesYear;
  if (thEl)  thEl.textContent  = '';
}

// ── DIALOG ─────────────────────────────────────────────────────
function doFortsaet() {
  dlgShown = false;
  autoStopHandled = false;
  runToZero = true;
  savedMinSoc = state.min_soc;
  document.getElementById('dlg').classList.remove('open');
  fetch(ESP+'/set_min?v=0').then(function() {
    fetch(ESP+'/on').then(function(){ doPoll(); });
  });
}

function doFrakobl() {
  dlgShown = false;
  document.getElementById('dlg').classList.remove('open');
  doPoll();
}

// ── TOAST ──────────────────────────────────────────────────────
function showToast(msg) {
  var t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); }, 3500);
}
