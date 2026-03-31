// ══ CONFIG ══════════════════════════════════════════════════
let espIP = '', geminiKey = '', pollTmr = null;
let lastData = null, lastFetch = 0;
let trendOpen = false, trendHistory = [];
const TREND_MAX = 5;
const DT = 2.32; // ms per sample per channel

document.getElementById('espIp').addEventListener('change', e => {
  espIP = e.target.value.trim();
  if (espIP) startPolling();
});
document.getElementById('geminiKey').addEventListener('change', e => {
  geminiKey = e.target.value.trim();
});

// ══ TABS ════════════════════════════════════════════════════
function showTab(id, el) {
  document.querySelectorAll('.cp').forEach(p => p.classList.remove('show'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  document.getElementById('tab-'+id).classList.add('show');
  el.classList.add('on');
  setTimeout(() => { vChart.resize(); iChart.resize(); fChart.resize(); }, 50);
}
function toggleTrend() {
  trendOpen = !trendOpen;
  document.getElementById('tb').classList.toggle('show', trendOpen);
  document.getElementById('ta').classList.toggle('open', trendOpen);
}

// ══ CHART FACTORY ═══════════════════════════════════════════
function makeWaveChart(canvasId, lineColor, yLabel) {
  const fillMap = {'#00ff88':'rgba(0,255,136,0.04)','#00ddff':'rgba(0,221,255,0.04)'};
  const fillColor = fillMap[lineColor] || 'rgba(0,255,136,0.04)';
  return new Chart(document.getElementById(canvasId), {
    type: 'line',
    data: { datasets: [{ data: [], borderColor: lineColor, backgroundColor: fillColor,
        fill: true, pointRadius: 0, borderWidth: 1.6, tension: 0.2 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 200 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0b1218', borderColor: '#162416', borderWidth: 1,
          titleColor: '#aaccaa', bodyColor: '#aaccaa',
          titleFont: { family: 'JetBrains Mono', size: 10 },
          bodyFont:  { family: 'JetBrains Mono', size: 10 },
          callbacks: {
            title: items => `t = ${items[0].parsed.x.toFixed(1)} ms`,
            label: items => `${yLabel.split(' ')[0]}: ${items[0].parsed.y.toFixed(3)}`
          }
        }
      },
      scales: {
        x: {
          type: 'linear', min: 0, max: 2320,
          grid: { color: '#0c1a0c' },
          ticks: { color: '#3a5a3a', font: { family: 'JetBrains Mono', size: 8 },
            maxTicksLimit: 9, autoSkip: true, autoSkipPadding: 12,
            callback: val => Math.round(val) + ' ms' },
          title: { display: true, text: 'TIME (ms)', color: '#3a5a3a',
            font: { family: 'JetBrains Mono', size: 8 } }
        },
        y: {
          min: -10, max: 10,
          grid: { color: ctx => ctx.tick.value === 0 ? '#00bb55' : '#0c1a0c',
            lineWidth: ctx => ctx.tick.value === 0 ? 2 : 1 },
          ticks: { color: '#3a5a3a', font: { family: 'JetBrains Mono', size: 8 },
            callback: val => val + '' },
          title: { display: true, text: yLabel, color: '#3a5a3a',
            font: { family: 'JetBrains Mono', size: 8 } }
        }
      }
    }
  });
}

const vChart = makeWaveChart('vChart', '#00ff88', 'VOLTAGE (V)');
const iChart = makeWaveChart('iChart', '#00ddff', 'CURRENT (A)');

// FFT bar chart
const fChart = new Chart(document.getElementById('fChart'), {
  type: 'bar',
  data: { labels: [], datasets: [{ data: [], backgroundColor: 'rgba(68,136,255,0.5)',
    borderColor: '#4488ff', borderWidth: 1, borderRadius: 2 }] },
  options: {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#0b1218', borderColor: '#162416', borderWidth: 1,
        titleColor: '#aaccaa', bodyColor: '#aaccaa',
        titleFont: { family: 'JetBrains Mono', size: 10 },
        bodyFont:  { family: 'JetBrains Mono', size: 10 },
        callbacks: {
          title: i => `${parseFloat(i[0].label).toFixed(1)} Hz`,
          label: i => `Amplitude: ${i.parsed.y.toFixed(4)} V`
        }
      }
    },
    scales: {
      x: { grid: { color: '#0c1a0c' },
        ticks: { color: '#3a5a3a', font: { family: 'JetBrains Mono', size: 8 }, maxTicksLimit: 15 },
        title: { display: true, text: 'FREQUENCY (Hz)', color: '#3a5a3a', font: { family: 'JetBrains Mono', size: 8 } } },
      y: { grid: { color: '#0c1a0c' },
        ticks: { color: '#3a5a3a', font: { family: 'JetBrains Mono', size: 8 } },
        title: { display: true, text: 'AMPLITUDE (V)', color: '#3a5a3a', font: { family: 'JetBrains Mono', size: 8 } } }
    }
  }
});

// ══ FFT ═════════════════════════════════════════════════════
function nextPow2(n) { let p=1; while(p<n) p<<=1; return p; }

function computeFFT(signal) {
  const N  = nextPow2(signal.length);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < signal.length; i++) re[i] = signal[i];
  let j = 0;
  for (let i = 1; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i],re[j]]=[re[j],re[i]]; [im[i],im[j]]=[im[j],im[i]]; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2*Math.PI/len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len/2; k++) {
        const ur=re[i+k], ui=im[i+k];
        const vr=re[i+k+len/2]*cr-im[i+k+len/2]*ci;
        const vi=re[i+k+len/2]*ci+im[i+k+len/2]*cr;
        re[i+k]=ur+vr; im[i+k]=ui+vi;
        re[i+k+len/2]=ur-vr; im[i+k+len/2]=ui-vi;
        const nr=cr*wr-ci*wi; ci=cr*wi+ci*wr; cr=nr;
      }
    }
  }
  const half=N/2, mag=new Float64Array(half);
  for (let i=0;i<half;i++) mag[i]=Math.sqrt(re[i]*re[i]+im[i]*im[i])/(N/2);
  mag[0]/=2; return mag;
}

function computeTHD(mag, fundBin) {
  if (fundBin<=0||mag[fundBin]<0.001) return 0;
  let sumSq=0;
  for (let h=2;h<=10;h++) { const b=fundBin*h; if(b<mag.length) sumSq+=mag[b]*mag[b]; }
  return Math.sqrt(sumSq)/mag[fundBin]*100;
}

function processFFT(volt, curr, sampleRateHz) {
  const vm=computeFFT(volt), im2=computeFFT(curr);
  const fRes=sampleRateHz/nextPow2(volt.length);
  let maxBin=1;
  for (let i=2;i<vm.length;i++) if(vm[i]>vm[maxBin]) maxBin=i;
  const fundHz=maxBin*fRes, thdV=computeTHD(vm,maxBin), thdI=computeTHD(im2,maxBin);
  const labels=[],vdata=[],maxFreq=Math.min(250,sampleRateHz/2);
  for (let i=0;i*fRes<=maxFreq&&i<vm.length;i++) {
    labels.push((i*fRes).toFixed(1)); vdata.push(+vm[i].toFixed(4));
  }
  return {labels,vdata,thdV,thdI,fundHz};
}

// ══ HEALTH SCORE ════════════════════════════════════════════
function calcHealth(d, thdV, thdI) {
  let vs=100;
  if(d.v.ripple>0.2) vs-=20; else if(d.v.ripple>0.1) vs-=10;
  if(d.signal_type.includes('AC')){const cd=Math.abs(d.v.crest-1.414);if(cd>0.3)vs-=20;else if(cd>0.15)vs-=10;}
  if(thdV>15)vs-=25;else if(thdV>8)vs-=12;else if(thdV>5)vs-=5;
  vs=Math.max(0,vs);
  let is=100;
  if(d.i.rms>0.01){const ir=d.i.pp/(d.i.rms*2+0.001);if(ir>0.5)is-=20;else if(ir>0.2)is-=10;
    if(thdI>15)is-=20;else if(thdI>8)is-=10;}
  is=Math.max(0,is);
  let ps=100;
  if(d.p.apparent>0.1){const pf=Math.abs(d.p.pf);if(pf<0.7)ps-=30;else if(pf<0.85)ps-=15;else if(pf<0.95)ps-=5;}
  ps=Math.max(0,ps);
  let ws=100;
  if(d.signal_type.includes('AC')&&d.v.rms>0.5){const cd2=Math.abs(d.v.crest-1.414);
    if(cd2>0.4)ws-=30;else if(cd2>0.2)ws-=15;else if(cd2>0.1)ws-=5;}
  ws=Math.max(0,ws);
  return {overall:Math.round(vs*0.3+is*0.2+ps*0.25+ws*0.25),
    vs:Math.round(vs),is:Math.round(is),ps:Math.round(ps),ws:Math.round(ws)};
}

function scls(s){return s>=80?'g':s>=60?'w':'b';}

function renderHealth(d, thdV, thdI) {
  const sc=calcHealth(d,thdV,thdI),c=scls(sc.overall);
  const hEl=document.getElementById('hScore');
  hEl.textContent=sc.overall+'/100'; hEl.className='hbig '+c;
  const hb=document.getElementById('hBar');
  hb.style.width=sc.overall+'%'; hb.className='hbb '+c;
  function ss(id,v){const e=document.getElementById(id);e.textContent=v+'/100';e.className='hsv '+scls(v);}
  ss('hvs',sc.vs);ss('his',sc.is);ss('hps',sc.ps);ss('hws',sc.ws);
}

// ══ TREND MONITOR ═══════════════════════════════════════════
function updateTrend(d, thdV) {
  trendHistory.push({vrms:d.v.rms,irms:d.i.rms,freq:d.frequency,thd:thdV});
  if(trendHistory.length>TREND_MAX) trendHistory.shift();
  const cnt=trendHistory.length,tw=document.getElementById('tw');
  if(cnt<3){tw.style.display='block';tw.textContent=`Collecting — ${cnt}/${TREND_MAX} captures...`;return;}
  tw.style.display='none';
  document.getElementById('td').style.display='block';
  function analyze(arr){
    const vals=arr.map((v,i)=>v.toFixed(i===2?1:2)).join('→');
    const chg=Math.abs((arr[arr.length-1]-arr[0])/(arr[0]+0.0001))*100;
    if(chg<5) return{vals,status:'✅ STABLE',cls:'s',chg};
    if(arr[arr.length-1]>arr[0]) return{vals,status:'↑ RISING',cls:'r',chg};
    return{vals,status:'↓ FALLING',cls:'f',chg};
  }
  const vt=analyze(trendHistory.map(h=>h.vrms));
  const it=analyze(trendHistory.map(h=>h.irms));
  const ft=analyze(trendHistory.map(h=>h.freq));
  const tt=analyze(trendHistory.map(h=>h.thd));
  function setRow(vi,si,t){
    document.getElementById(vi).textContent=t.vals;
    const e=document.getElementById(si);e.textContent=t.status;e.className='ts '+t.cls;
  }
  setRow('tvv','tvs',vt);setRow('tiv','tis',it);setRow('tfv','tfs',ft);setRow('ttv','tts',tt);
  const msgs=[];
  if(vt.cls==='f'&&vt.chg>5) msgs.push(`Voltage dropped ${vt.chg.toFixed(1)}% — check supply`);
  if(vt.cls==='r'&&vt.chg>5) msgs.push(`Voltage rising ${vt.chg.toFixed(1)}% — check load`);
  if(tt.cls==='r'&&tt.chg>10) msgs.push('THD increasing — distortion worsening');
  if(ft.cls!=='s') msgs.push('Frequency drifting — unusual for mains supply');
  document.getElementById('tmsg').innerHTML=msgs.length>0
    ?msgs.map(m=>`<div class="twarn">⚠ ${m}</div>`).join('')
    :`<div class="tok">✅ All stable over ${cnt} captures</div>`;
}

// ══ POLLING ═════════════════════════════════════════════════
function startPolling(){
  if(pollTmr) clearInterval(pollTmr);
  pollStatus();
  pollTmr=setInterval(pollStatus,500);
}

async function pollStatus(){
  if(!espIP) return;
  try{
    const r=await fetch(`http://${espIP}/status`,{signal:AbortSignal.timeout(2500)});
    const d=await r.json();
    updateStatusUI(d);
    if(d.state==='ready') fetchData();
  }catch(e){
    document.getElementById('dot').className='dot e';
    document.getElementById('stxt').textContent='Cannot reach ESP8266 — check IP and WiFi';
  }
}

function updateStatusUI(d){
  const dot=document.getElementById('dot');
  dot.className='dot';
  if(d.state==='collecting'){
    dot.classList.add('c');
    document.getElementById('stxt').textContent=`COLLECTING  ${d.samples} SAMPLES`;
    document.getElementById('pb').style.width=d.percent+'%';
    document.getElementById('el').textContent=`${d.elapsed.toFixed(1)}s / ${d.total.toFixed(1)}s`;
  }else if(d.state==='calculating'){
    dot.classList.add('c');
    document.getElementById('stxt').textContent='CALCULATING...';
    document.getElementById('pb').style.width='100%';
    document.getElementById('el').textContent='Processing';
  }else{
    dot.classList.add('r');
    document.getElementById('stxt').textContent='CAPTURE COMPLETE';
    document.getElementById('pb').style.width='100%';
    document.getElementById('el').textContent=`${d.total.toFixed(1)}s window`;
  }
}

// ══ FETCH + RENDER DATA ══════════════════════════════════════
async function fetchData(){
  const now=Date.now();
  if(now-lastFetch<1000) return;
  lastFetch=now;
  if(!espIP) return;
  try{
    const r=await fetch(`http://${espIP}/data`,{signal:AbortSignal.timeout(8000)});
    const d=await r.json();
    if(d.status!=='ready') return;
    lastData=d;
    renderData(d);
    document.getElementById('aiBtn').disabled=false;
    document.getElementById('aiImgBtn').disabled=false;
  }catch(e){
    document.getElementById('stxt').textContent='Failed to fetch data — check connection';
  }
}

function renderData(d){
  const n=d.voltage.length, totalMs=(n-1)*DT;
  const vPts=d.voltage.map((v,i)=>({x:+(i*DT).toFixed(2),y:+v.toFixed(3)}));
  const iPts=d.current.map((c,i)=>({x:+(i*DT).toFixed(2),y:+c.toFixed(3)}));
  const xMax=Math.round(totalMs);
  const vAbsPeak=Math.max(Math.abs(d.v.peak),Math.abs(d.v.npeak||0));
  const iAbsPeak=Math.max(Math.abs(d.i.peak),Math.abs(d.i.npeak||0));
  function niceAxisMax(peak){
    const floor=10,raw=Math.max(floor,peak*1.15);
    const steps=[2,5,10,15,20,25,30,40,50,60];
    for(const s of steps) if(s>=raw) return s;
    return Math.ceil(raw/10)*10;
  }
  function niceStep(axMax){
    if(axMax<=10)return 2;if(axMax<=20)return 5;if(axMax<=30)return 5;if(axMax<=50)return 10;return 10;
  }
  const vYmax=niceAxisMax(vAbsPeak),iYmax=niceAxisMax(iAbsPeak);
  vChart.data.datasets[0].data=vPts;
  vChart.options.scales.x.min=0;vChart.options.scales.x.max=xMax;
  vChart.options.scales.y.min=-vYmax;vChart.options.scales.y.max=vYmax;
  vChart.options.scales.y.ticks.stepSize=niceStep(vYmax);
  vChart.update('none');
  iChart.data.datasets[0].data=iPts;
  iChart.options.scales.x.min=0;iChart.options.scales.x.max=xMax;
  iChart.options.scales.y.min=-iYmax;iChart.options.scales.y.max=iYmax;
  iChart.options.scales.y.ticks.stepSize=niceStep(iYmax);
  iChart.update('none');
  const sampleRate=1000/DT;
  const fft=processFFT(d.voltage,d.current,sampleRate);
  fChart.data.labels=fft.labels;fChart.data.datasets[0].data=fft.vdata;fChart.update();
  function tc(v){return v<5?'g':v<15?'w':'b';}
  const tvEl=document.getElementById('thdV');
  tvEl.textContent=fft.thdV.toFixed(1)+'%';tvEl.className='thd-v '+tc(fft.thdV);
  document.getElementById('thdVs').textContent=fft.thdV<5?'Excellent — clean':fft.thdV<15?'Acceptable':'High distortion!';
  const tiEl=document.getElementById('thdI');
  tiEl.textContent=fft.thdI.toFixed(1)+'%';tiEl.className='thd-v '+tc(fft.thdI);
  document.getElementById('thdIs').textContent=fft.thdI<5?'Excellent — clean':fft.thdI<15?'Acceptable':'High distortion!';
  document.getElementById('fftF').textContent=fft.fundHz.toFixed(1)+' Hz';
  document.getElementById('fftFs').textContent=fft.fundHz<1?'DC signal':'Dominant freq';
  document.getElementById('thdVsb').textContent=fft.thdV.toFixed(1);
  document.getElementById('thdIsb').textContent=fft.thdI.toFixed(1);
  document.getElementById('vND').style.display='none';
  document.getElementById('iND').style.display='none';
  document.getElementById('fND').style.display='none';
  document.getElementById('vTag').textContent='LIVE';
  document.getElementById('iTag').textContent='LIVE';
  document.getElementById('fTag').textContent='LIVE';
  document.getElementById('vInfo').textContent=`0–${totalMs.toFixed(0)}ms · ±${vYmax}V`;
  document.getElementById('iInfo').textContent=`0–${totalMs.toFixed(0)}ms · ±${iYmax}A`;
  document.getElementById('fInfo').textContent=`Fund: ${fft.fundHz.toFixed(1)}Hz`;
  let cls='dc';
  if(d.signal_type.includes('Pure AC')) cls='ac';
  else if(d.signal_type.includes('Offset')||d.signal_type.includes('Ripple')) cls='acdc';
  document.getElementById('sigWrap').innerHTML=`<div class="sbadge ${cls}">${d.signal_type.toUpperCase()}</div>`;
  renderHealth(d,fft.thdV,fft.thdI);
  function sv(id,val,dec){const e=document.getElementById(id);if(e)e.textContent=(val!=null)?val.toFixed(dec):'─';}
  sv('vdc',d.v.dc,2);sv('vpeak',d.v.peak,2);sv('vnpeak',d.v.npeak,2);
  sv('vpp',d.v.pp,2);sv('vrms',d.v.rms,2);sv('vcrest',d.v.crest,3);sv('vripple',d.v.ripple,3);
  sv('idc',d.i.dc,3);sv('ipeak',d.i.peak,3);sv('inpeak',d.i.npeak,3);
  sv('ipp',d.i.pp,3);sv('irms',d.i.rms,3);sv('icrest',d.i.crest,3);
  sv('preal',d.p.real,2);sv('papparent',d.p.apparent,2);sv('preactive',d.p.reactive,2);sv('ppf',d.p.pf,3);
  sv('freq',d.frequency,1);
  document.getElementById('scount').textContent=d.sample_count;
  sv('swin',d.window_seconds,2);
  updateTrend(d,fft.thdV);
}

// ══ SAMPLE SELECTOR ═════════════════════════════════════════
async function setSamples(n,btn){
  document.querySelectorAll('.sbt').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
  const xMax=Math.round((n/2-1)*DT);
  vChart.options.scales.x.min=0;vChart.options.scales.x.max=xMax;vChart.update('none');
  iChart.options.scales.x.min=0;iChart.options.scales.x.max=xMax;iChart.update('none');
  if(!espIP) return;
  try{await fetch(`http://${espIP}/setsamples?n=${n}`,{signal:AbortSignal.timeout(3000)});}catch(e){}
}

// ══ CAPTURE WAVEFORM AS IMAGE (for Gemini Vision) ═══════════
function captureWaveformImage(){
  return new Promise(resolve=>{
    const canvas=document.getElementById('vChart');
    const offscreen=document.createElement('canvas');
    offscreen.width=canvas.width;
    offscreen.height=canvas.height;
    const ctx=offscreen.getContext('2d');
    ctx.fillStyle='#0b1218';
    ctx.fillRect(0,0,offscreen.width,offscreen.height);
    ctx.drawImage(canvas,0,0);
    const base64=offscreen.toDataURL('image/png').split(',')[1];
    resolve(base64);
  });
}

// ══ ROBUST JSON EXTRACTOR ═══════════════════════════════════
// FIX: Handles truncated responses, prose wrapping, and markdown fences
function extractJSON(raw) {
  // 1. Strip markdown code fences (```json ... ``` or ``` ... ```)
  let text = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // 2. Try direct parse first (best case — clean response)
  try { return JSON.parse(text); } catch (_) {}

  // 3. Extract the first complete {...} block using a bracket-counter
  //    This handles prose before/after the JSON object
  const start = text.indexOf('{');
  if (start !== -1) {
    let depth = 0, inStr = false, escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inStr) { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (!inStr) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            const candidate = text.slice(start, i + 1);
            try { return JSON.parse(candidate); } catch (_) {}
            break; // Found the closing brace but still invalid — fall through
          }
        }
      }
    }
  }

  // 4. Last resort: try to salvage a truncated JSON by closing open structures.
  //    Count unclosed braces/brackets and append them.
  const startIdx = text.indexOf('{');
  if (startIdx !== -1) {
    let snippet = text.slice(startIdx);
    // Remove any trailing incomplete key-value (e.g. ,"key":"incomplet)
    snippet = snippet.replace(/,\s*"[^"]*"\s*:\s*"[^"]*$/, '');
    snippet = snippet.replace(/,\s*"[^"]*"\s*:\s*$/, '');
    snippet = snippet.replace(/,\s*"[^"]*"\s*$/, '');
    // Close any open string
    const quoteCount = (snippet.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) snippet += '"';
    // Close open arrays then objects
    const opens = { '{': '}', '[': ']' };
    const stack = [];
    let inS = false, esc = false;
    for (const ch of snippet) {
      if (esc) { esc = false; continue; }
      if (ch === '\\' && inS) { esc = true; continue; }
      if (ch === '"') { inS = !inS; continue; }
      if (!inS) {
        if (ch === '{' || ch === '[') stack.push(opens[ch]);
        else if (ch === '}' || ch === ']') stack.pop();
      }
    }
    snippet += stack.reverse().join('');
    try { return JSON.parse(snippet); } catch (_) {}
  }

  // 5. Nothing worked — throw a descriptive error
  throw new Error(`Could not parse Gemini response as JSON.\n\nRaw (first 300 chars):\n${raw.slice(0, 300)}`);
}

// ══ BUILD NUMBERS PROMPT ════════════════════════════════════
function buildNumbersPrompt(d, fft){
  const m={
    signal_type:d.signal_type,frequency_hz:+d.frequency.toFixed(2),
    voltage:{dc_v:+d.v.dc.toFixed(3),peak_pos_v:+d.v.peak.toFixed(3),
      peak_neg_v:+(d.v.npeak||0).toFixed(3),pp_v:+d.v.pp.toFixed(3),
      rms_v:+d.v.rms.toFixed(3),crest_factor:+d.v.crest.toFixed(3),
      ripple:+d.v.ripple.toFixed(3),thd_pct:+fft.thdV.toFixed(2)},
    current:{dc_a:+d.i.dc.toFixed(3),peak_pos_a:+d.i.peak.toFixed(3),
      peak_neg_a:+(d.i.npeak||0).toFixed(3),rms_a:+d.i.rms.toFixed(3),
      crest_factor:+d.i.crest.toFixed(3),thd_pct:+fft.thdI.toFixed(2)},
    power:{real_w:+d.p.real.toFixed(3),apparent_va:+d.p.apparent.toFixed(3),
      power_factor:+d.p.pf.toFixed(3)},
    fft_fundamental_hz:+fft.fundHz.toFixed(2)
  };
  return `You are an expert electronics diagnostic AI inside a portable WiFi oscilloscope (ADS1115 16-bit ADC + ACS712 current sensor, differential mode — fully signed signals).

IDENTIFY the circuit from ONLY these options:
Battery (no load) | Battery under load | Phone charger / USB adapter | Laptop charger / 12V adapter | AC transformer output | Unfiltered rectifier | Filtered DC power supply | Square wave oscillator / 555 timer | Unknown circuit

DIAGNOSE health:
- Perfect sine: crest≈1.414, Vdc≈0, THD<3%
- Square wave: crest≈1.0
- Battery: Vpp<0.3V, freq=0
- Phone charger: Vdc≈5V, 100Hz ripple
- Ripple>10%: aging capacitor warning
- THD>10%: distortion warning
- PF<0.85: reactive load warning

IMPORTANT: Reply with ONLY a raw JSON object. No markdown, no code fences, no explanation outside the JSON. Start your response with { and end with }.

Required format:
{"circuit_type":"...","confidence":90,"health":"Good","summary":"one sentence","details":"2-3 sentences with specific values","warnings":[]}
health must be exactly one of: "Good", "Warning", or "Fault"

Data: ${JSON.stringify(m)}`;
}

// ══ GEMINI API CALLS ═════════════════════════════════════════
// FIX: Raised maxOutputTokens from 500→1024 and 700→1024 to prevent truncation
async function callGeminiText(key, prompt){
  const res=await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({contents:[{parts:[{text:prompt}]}],
       generationConfig:{temperature:0.1,maxOutputTokens:1024}})}
  );
  if(!res.ok){const e=await res.json();throw new Error(e.error?.message||`HTTP ${res.status}`);}
  const data=await res.json();
  return data.candidates[0].content.parts[0].text.trim();
}

async function callGeminiVision(key, prompt, imageBase64){
  const res=await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({contents:[{parts:[
       {text:prompt},
       {inline_data:{mime_type:'image/png',data:imageBase64}}
     ]}],generationConfig:{temperature:0.1,maxOutputTokens:1024}})}
  );
  if(!res.ok){const e=await res.json();throw new Error(e.error?.message||`HTTP ${res.status}`);}
  const data=await res.json();
  return data.candidates[0].content.parts[0].text.trim();
}

// ══ MAIN AI ENTRY POINT ══════════════════════════════════════
async function runAI(useImage){
  if(!lastData) return;
  const key=geminiKey||document.getElementById('geminiKey').value.trim();
  if(!key){showAIErr('Enter your Gemini API key above — get it free at aistudio.google.com');return;}

  document.getElementById('aiBtn').disabled=true;
  document.getElementById('aiImgBtn').disabled=true;
  const ail=document.getElementById('aiL');
  ail.style.display='block';
  ail.textContent=useImage?'Gemini Vision analysing waveform image...':'Gemini analysing measurements...';
  ail.style.color=useImage?'var(--blue)':'var(--purple)';
  document.getElementById('aiR').style.display='none';
  document.getElementById('aiE').style.display='none';

  const d=lastData;
  const fft=processFFT(d.voltage,d.current,1000/DT);

  // FIX: rawJson is now declared outside try so catch block can reference it for debug info
  let rawJson = '';

  try{
    let mode;
    if(useImage){
      // Switch to voltage tab so canvas is fully rendered
      document.querySelectorAll('.cp').forEach(p=>p.classList.remove('show'));
      document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
      document.getElementById('tab-v').classList.add('show');
      document.querySelector('.tab.v').classList.add('on');
      vChart.update();
      await new Promise(r=>setTimeout(r,300));
      const imageBase64=await captureWaveformImage();
      const visionPrompt=`You are an expert electronics diagnostic AI with vision, analysing a WiFi oscilloscope output.

You see the voltage waveform screenshot AND numerical data below.

Using BOTH together:

A) DESCRIBE what you see in the waveform image (shape, symmetry, distortion, cycles visible)

B) IDENTIFY from ONLY these options:
Battery (no load) | Battery under load | Phone charger / USB adapter | Laptop charger / 12V adapter | AC transformer output | Unfiltered rectifier | Filtered DC power supply | Square wave oscillator / 555 timer | Unknown circuit

C) DIAGNOSE health:
- Perfect sine: crest≈1.414, THD<3%
- Square wave: crest≈1.0
- Ripple>10%: aging capacitor
- THD>10%: distortion warning
- PF<0.85: reactive load

IMPORTANT: Reply with ONLY a raw JSON object. No markdown, no code fences, no explanation outside the JSON. Start your response with { and end with }.

Required format:
{"circuit_type":"...","confidence":90,"health":"Good","summary":"one sentence","details":"2-3 sentences with specific values","visual_observation":"2-3 sentences about the waveform image","warnings":[]}
health must be exactly one of: "Good", "Warning", or "Fault"

Data: ${JSON.stringify({signal_type:d.signal_type,frequency_hz:+d.frequency.toFixed(2),
  vrms:+d.v.rms.toFixed(3),vpeak:+d.v.peak.toFixed(3),crest:+d.v.crest.toFixed(3),
  thd_v_pct:+fft.thdV.toFixed(2),thd_i_pct:+fft.thdI.toFixed(2),power_factor:+d.p.pf.toFixed(3)})}`;
      rawJson=await callGeminiVision(key,visionPrompt,imageBase64);
      mode='image';
    }else{
      rawJson=await callGeminiText(key,buildNumbersPrompt(d,fft));
      mode='numbers';
    }

    // FIX: Use robust extractJSON instead of bare JSON.parse
    const parsed = extractJSON(rawJson);
    showAIResult(parsed, mode);

  }catch(e){
    // FIX: Show raw snippet in error panel for easy debugging
    showAIErr(e.message);
  }finally{
    document.getElementById('aiBtn').disabled=false;
    document.getElementById('aiImgBtn').disabled=false;
    document.getElementById('aiL').style.display='none';
  }
}

function showAIResult(r, mode){
  document.getElementById('aiTy').textContent='📡 '+r.circuit_type;
  document.getElementById('aiModeTag').textContent=mode==='image'?'👁 VISION':'📊 DATA';
  document.getElementById('aiCf').textContent=`Confidence: ${r.confidence}%  ·  Gemini ${mode==='image'?'Pro Vision':'Pro'}`;
  const h=r.health||'Good';
  const hEl=document.getElementById('aiH');
  hEl.textContent=h==='Good'?'✅ '+h:h==='Warning'?'⚠ '+h:'❌ '+h;
  hEl.className='aih '+(h.toLowerCase()==='warning'?'warning':h.toLowerCase());
  document.getElementById('aiSu').textContent=r.summary;
  document.getElementById('aiDe').textContent=r.details;
  const visSection=document.getElementById('aiVisualSection');
  const visText=document.getElementById('aiVi');
  if(mode==='image'&&r.visual_observation){
    visSection.style.display='block';
    visText.textContent=r.visual_observation;
  }else{
    visSection.style.display='none';
  }
  const wEl=document.getElementById('aiW');
  wEl.innerHTML='';
  (r.warnings||[]).forEach(w=>{
    const div=document.createElement('div');
    div.className='aiwi';div.textContent='⚠ '+w;wEl.appendChild(div);
  });
  document.getElementById('aiR').style.display='block';
  document.getElementById('aiE').style.display='none';
}

function showAIErr(msg){
  const e=document.getElementById('aiE');
  e.textContent=msg;e.style.display='block';
  document.getElementById('aiR').style.display='none';
  document.getElementById('aiL').style.display='none';
}

// ══ CSV EXPORT ═══════════════════════════════════════════════
function exportCSV(){
  if(!lastData) return alert('No data yet — wait for first capture.');
  const d=lastData;
  let csv='time_ms,voltage_V,current_A\n';
  for(let i=0;i<d.voltage.length;i++)
    csv+=`${(i*DT).toFixed(2)},${d.voltage[i].toFixed(3)},${d.current[i].toFixed(3)}\n`;
  const a=Object.assign(document.createElement('a'),{
    href:URL.createObjectURL(new Blob([csv],{type:'text/csv'})),
    download:`wificro_${Date.now()}.csv`
  });
  a.click();
}
