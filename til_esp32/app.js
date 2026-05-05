'use strict';

// ── STATE ──────────────────────────────────────────────────────
var state = { v2h_active:false, battery_soc:95, min_soc:20, price_ore:100, savings_kr:0, savings_iphone:0, auto_stop:false };
var ob = { elregning:0, km_dag:0, personer:2, hjemoplad:'ja', aftensture:'nogle' };
var obStep = 1;
var obChoices = {};
var dlgShown = false;
var pollTimer = null;
var priceCache = null;
var priceCacheTime = 0;
var greenCache = null;
var greenCacheTime = 0;
var currentScreen = 'hjem';
var savPeriod = 'dag';
var v2hStartKr = 0;
var v2hStartTime = 0;

// ── INIT ───────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', function() {
  var saved = localStorage.getItem('v2h_onboarding');
  if (saved) {
    try { ob = JSON.parse(saved); } catch(e) {}
    showApp();
  } else {
    showOnboarding();
  }
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
  var t = document.getElementById('clk-time');
  var dt = document.getElementById('clk-date');
  if (t) t.textContent = pad(d.getHours())+':'+pad(d.getMinutes());
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
    var v = parseFloat(document.getElementById('inp-elregning').value);
    if (!v || v <= 0) { document.getElementById('inp-elregning').focus(); return; }
    ob.elregning = v;
  } else if (step === 2) {
    var v2 = parseFloat(document.getElementById('inp-km').value);
    if (v2 === undefined || v2 < 0) v2 = 0;
    ob.km_dag = v2;
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
  document.getElementById('ob-step-'+step).style.display = 'none';
  var next = step + 1;
  document.getElementById('ob-step-'+next).style.display = 'flex';
  setActiveDot(next);
  obStep = next;
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
  var mSav = Math.round(ob.elregning * 0.40);

  document.getElementById('sum-besparelse').textContent = mSav + ' kr./md.';
  document.getElementById('sum-min').textContent = minSoc + '%';

  ob.minSoc = minSoc;
  ob.mSav = mSav;
}

function obFinish() {
  ob.done = true;
  localStorage.setItem('v2h_onboarding', JSON.stringify(ob));
  var minSoc = ob.minSoc || 20;
  fetch('/set_min?v=' + minSoc);
  showApp();
}

// ── APP ────────────────────────────────────────────────────────
function showApp() {
  document.getElementById('onboarding').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  startPoll();
  if (currentScreen === 'strom') loadPriceData();
}

// ── NAVIGATION ─────────────────────────────────────────────────
function navTo(name, btn) {
  var screens = ['hjem','strom','batteri','besparelse'];
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
  xhr.open('GET', '/status', true);
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
  if (s.auto_stop && !dlgShown) {
    dlgShown = true;
    document.getElementById('dlg').showModal();
  }
}

// ── HJEM ───────────────────────────────────────────────────────
function updateHjem(s) {
  var o = s.price_ore;
  // gauge marker: top of gauge=expensive(red), bottom=cheap(green)
  var bar = document.getElementById('gauge-bar');
  if (bar) {
    var h = bar.offsetHeight || 200;
    var pct = Math.max(0, Math.min(1, o / 300));
    var mt = (1 - pct) * (h - 4);
    document.getElementById('gauge-marker').style.top = mt + 'px';
  }
  document.getElementById('gauge-label').textContent = o.toFixed(0) + ' øre/kWh';
  var status = o < 50 ? 'Billig strøm' : o < 150 ? 'Normal pris' : 'Dyr strøm';
  document.getElementById('gauge-status').textContent = status;

  var soc = s.battery_soc;
  var km = Math.max(0, Math.round((soc - s.min_soc) * 4));
  document.getElementById('hjem-soc').textContent = soc.toFixed(0) + '%';
  document.getElementById('hjem-km').textContent = km + ' km';
  document.getElementById('hjem-price').textContent = o.toFixed(0) + ' øre';
  document.getElementById('hjem-price-lbl').textContent = status;

  var track = document.getElementById('swipe-track');
  var thumb = document.getElementById('swipe-thumb');
  var lbl = document.getElementById('swipe-lbl');
  if (s.v2h_active) {
    track.classList.add('on');
    if (track) {
      var tw = track.offsetWidth || 280;
      thumb.style.left = (tw - 58) + 'px';
    }
    lbl.textContent = '← Frakobl elbil';
    document.getElementById('hjem-status-txt').textContent = 'Huset kører på bilbatteri';
  } else {
    track.classList.remove('on');
    thumb.style.left = '6px';
    lbl.textContent = 'Tilslut elbil →';
    document.getElementById('hjem-status-txt').textContent = 'Huset bruger almindelig netstrøm';
  }

  if (s.car_connected) {
    track.classList.remove('locked');
  } else {
    track.classList.add('locked');
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

function toggleV2H() {
  setV2H(!state.v2h_active);
}

function setV2H(on) {
  fetch(on ? '/on' : '/off').then(function() { doPoll(); });
}

// ── BATTERI ────────────────────────────────────────────────────
function updateBatteri(s) {
  var soc = s.battery_soc;
  var km = Math.max(0, Math.round((soc - s.min_soc) * 4));

  document.getElementById('batt-pct').textContent = soc.toFixed(0) + '%';
  document.getElementById('batt-km').textContent = km + ' km';

  // SVG arc: semicircle from left (20,110) to right (180,110), radius 90
  // circumference of half circle = π*90 ≈ 283
  var circ = Math.PI * 90;
  var fill = document.getElementById('batt-fill');
  var offset = circ * (1 - soc / 100);
  fill.style.strokeDasharray = circ;
  fill.style.strokeDashoffset = offset;

  var trackEl = document.getElementById('batt-track');
  trackEl.style.strokeDasharray = circ;
  trackEl.style.strokeDashoffset = 0;

  var col = soc > 50 ? '#3b82f6' : soc > 25 ? '#eab308' : '#ef4444';
  fill.style.stroke = col;
  document.getElementById('batt-pct').style.color = col;

  document.getElementById('min-val-lbl').textContent = s.min_soc + '%';
  document.getElementById('min-slider').value = s.min_soc;

  var health = Math.max(0, Math.min(100, 100 - Math.max(0, 95 - soc)));
  document.getElementById('health-bar').style.width = health + '%';
  document.getElementById('health-pct').textContent = health.toFixed(0) + '%';

  var hc = health > 70 ? '#22c55e' : health > 40 ? '#eab308' : '#ef4444';
  document.getElementById('health-bar').style.background = hc;
  document.getElementById('health-pct').style.color = hc;
}

document.addEventListener('DOMContentLoaded', function() {
  var sl = document.getElementById('min-slider');
  if (!sl) return;
  sl.addEventListener('input', function() {
    document.getElementById('min-val-lbl').textContent = this.value + '%';
  });
  sl.addEventListener('change', function() {
    fetch('/set_min?v=' + this.value);
  });
});

// ── STRØM ──────────────────────────────────────────────────────
function loadPriceData() {
  var now = Date.now();
  if (priceCache && now - priceCacheTime < 3600000) {
    drawChart(priceCache);
    updatePriceUI(state.price_ore);
  } else {
    var url = 'https://api.energidataservice.dk/dataset/Elspotprices' +
      '?offset=0&limit=24&filter=%7B%22PriceArea%22%3A%22DK2%22%7D&sort=HourDK%20asc';
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 8000;
    xhr.onload = function() {
      if (xhr.status === 200) {
        try {
          var data = JSON.parse(xhr.responseText);
          var records = data.records || [];
          priceCache = records.map(function(r) {
            return { hour: new Date(r.HourDK).getHours(), price: Math.round(r.SpotPriceDKK * 0.1) };
          });
          priceCacheTime = now;
          drawChart(priceCache);
        } catch(e) {}
      }
    };
    xhr.send();
  }
  loadGreenData();
  updatePriceUI(state.price_ore);
}

function updatePriceUI(o) {
  var el = document.getElementById('strom-price');
  if (el) el.textContent = o.toFixed(0);
  var tag = document.getElementById('strom-tag');
  if (!tag) return;
  if (o < 50) { tag.textContent = 'Billig strøm'; tag.className = 'strom-tag cheap'; }
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
        var pct = Math.round((r.OffshoreWindPct || 0) + (r.OnshoreWindPct || 0) + (r.SolarPct || 0));
        greenCache = pct;
        greenCacheTime = now;
        renderGreen(pct);
      } catch(e) {}
    }
  };
  xhr.send();
}

function renderGreen(pct) {
  var bar = document.getElementById('green-bar');
  var pctEl = document.getElementById('green-pct');
  var sub = document.getElementById('green-sub');
  if (!bar) return;
  bar.style.width = pct + '%';
  pctEl.textContent = pct + '%';
  var msg = pct > 70 ? 'Mest grøn strøm på nettet' : pct > 40 ? 'Blandet energimix' : 'Lav andel vedvarende energi';
  sub.textContent = msg;
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
  var kr = state.savings_kr || 0;
  var iphone = state.savings_iphone || 0;
  var note = 'Faktisk besparelse i dag';

  if (savPeriod === 'uge') {
    kr *= 7; iphone *= 7; note = 'Estimeret besparelse denne uge';
  } else if (savPeriod === 'måned') {
    kr *= 30; iphone *= 30; note = 'Estimeret besparelse denne måned';
  } else if (savPeriod === 'år') {
    kr *= 365; iphone *= 365; note = 'Estimeret besparelse på et år';
  }

  var krEl = document.getElementById('sav-kr');
  var iphEl = document.getElementById('sav-iphone');
  var noteEl = document.getElementById('sav-note');
  if (krEl) krEl.textContent = kr.toFixed(2).replace('.', ',');
  if (iphEl) iphEl.textContent = iphone.toFixed(0);
  if (noteEl) noteEl.textContent = note;
}

// ── TIME WHEEL ─────────────────────────────────────────────────
function initWheel() {
  var wheel = document.getElementById('wheel');
  if (!wheel) return;
  var periods = ['dag','uge','måned','år'];
  var angles = [0, 90, 180, 270];
  var currentAngle = 0;
  var startAngle = null;
  var startClientAngle = null;

  function getClientAngle(e) {
    var rect = wheel.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var x = (e.touches ? e.touches[0].clientX : e.clientX) - cx;
    var y = (e.touches ? e.touches[0].clientY : e.clientY) - cy;
    return Math.atan2(y, x) * 180 / Math.PI;
  }

  function snapTo(angle) {
    var best = 0;
    var bestDist = 999;
    for (var i = 0; i < angles.length; i++) {
      var dist = Math.abs(((angle - angles[i] + 540) % 360) - 180);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    currentAngle = angles[best];
    wheel.style.transform = 'rotate(' + currentAngle + 'deg)';
    var period = periods[best];
    savPeriod = period;
    var tabs = document.querySelectorAll('.sav-tab');
    for (var j = 0; j < tabs.length; j++) {
      tabs[j].classList.toggle('active', tabs[j].textContent.toLowerCase().replace('å','å') === period);
    }
    // match tab by index
    tabs[best] && tabs[best].classList.add('active');
    for (var k = 0; k < tabs.length; k++) { if (k !== best) tabs[k].classList.remove('active'); }
    updateSavings2();
  }

  wheel.addEventListener('touchstart', function(e) {
    startClientAngle = getClientAngle(e);
    startAngle = currentAngle;
  }, {passive:true});

  wheel.addEventListener('touchmove', function(e) {
    if (startClientAngle === null) return;
    var diff = getClientAngle(e) - startClientAngle;
    wheel.style.transform = 'rotate(' + (startAngle + diff) + 'deg)';
  }, {passive:true});

  wheel.addEventListener('touchend', function(e) {
    if (startClientAngle === null) return;
    var diff = (e.changedTouches ? e.changedTouches[0] : e);
    var finalAngle = startAngle + (getClientAngle({touches:[e.changedTouches[0]]}) - startClientAngle);
    snapTo(finalAngle);
    startClientAngle = null;
  });

  wheel.addEventListener('mousedown', function(e) {
    startClientAngle = getClientAngle(e);
    startAngle = currentAngle;
  });
  wheel.addEventListener('mousemove', function(e) {
    if (startClientAngle === null) return;
    var diff = getClientAngle(e) - startClientAngle;
    wheel.style.transform = 'rotate(' + (startAngle + diff) + 'deg)';
  });
  wheel.addEventListener('mouseup', function(e) {
    if (startClientAngle === null) return;
    var diff = getClientAngle(e) - startClientAngle;
    snapTo(startAngle + diff);
    startClientAngle = null;
  });
  wheel.addEventListener('mouseleave', function(e) {
    if (startClientAngle === null) return;
    var diff = getClientAngle(e) - startClientAngle;
    snapTo(startAngle + diff);
    startClientAngle = null;
  });
}

// ── DIALOG ─────────────────────────────────────────────────────
function doFortsaet() {
  dlgShown = false;
  document.getElementById('dlg').close();
  fetch('/on').then(function(){ doPoll(); });
}
function doStop() {
  dlgShown = false;
  document.getElementById('dlg').close();
}
