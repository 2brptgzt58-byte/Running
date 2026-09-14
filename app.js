const STORAGE_KEY = "runningCoaching.runRecords.v2";
const OLD_WELLNESS_KEY = "runningCoaching.wellness.v1";
const WELLNESS_HISTORY_KEY = "runningCoaching.wellnessHistory.v2";
const SETTINGS_KEY = "runningCoaching.settings.v1";

const PAIN_AREAS = ["발","발목","아킬레스","정강이","종아리","무릎","허벅지 앞","허벅지 뒤","엉덩이·고관절","허리","기타"];
const DEFAULT_SETTINGS = {
  raceEnabled: true,
  raceName: "하프마라톤",
  raceDate: "2026-10-25",
  raceDistance: 21.0975,
  raceTargetMinutes: 110
};
const DEFAULT_WELLNESS = {fatigue:null,soreness:null,pain:null,sleepQuality:null};

let weather = null;
let weatherHourly = [];
let selectedAnalysisRunId = null;

const $ = id => document.getElementById(id);
function populatePainAreaSelect(id){
  const el=$(id);
  if(!el) return;
  el.innerHTML=PAIN_AREAS.map(area=>`<option value="${area}">${area}</option>`).join("");
}
const pad = n => String(n).padStart(2,"0");
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const startOfDay = d => new Date(d.getFullYear(),d.getMonth(),d.getDate());
const addDays = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const localDate = s => { const [y,m,d]=String(s).split("-").map(Number); return new Date(y,m-1,d); };
const diffDaysSigned = (a,b) => Math.round((startOfDay(b)-startOfDay(a))/86400000);

function loadRuns(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]").sort((a,b)=>localDate(b.date)-localDate(a.date)); }
  catch { return []; }
}
function saveRuns(runs){ localStorage.setItem(STORAGE_KEY,JSON.stringify(runs)); }
function loadSettings(){
  try { return {...DEFAULT_SETTINGS,...JSON.parse(localStorage.getItem(SETTINGS_KEY)||"{}")}; }
  catch { return {...DEFAULT_SETTINGS}; }
}
function saveSettings(s){ localStorage.setItem(SETTINGS_KEY,JSON.stringify(s)); }
function loadWellnessHistory(){
  try { return JSON.parse(localStorage.getItem(WELLNESS_HISTORY_KEY)||"{}"); }
  catch { return {}; }
}
function saveWellnessHistory(h){ localStorage.setItem(WELLNESS_HISTORY_KEY,JSON.stringify(h)); }
function migrateOldWellness(){
  const history=loadWellnessHistory(), today=dateKey(new Date());
  if(history[today]) return;
  try{
    const old=JSON.parse(localStorage.getItem(OLD_WELLNESS_KEY)||"null");
    if(old){
      history[today]={...DEFAULT_WELLNESS,fatigue:Number(old.fatigue??2),soreness:Number(old.soreness??2),pain:Number(old.pain??0),sleepQuality:old.sleptWell===false?2:4};
      saveWellnessHistory(history);
    }
  }catch{}
}
function getWellness(day=dateKey(new Date())){
  const h=loadWellnessHistory();
  return {...DEFAULT_WELLNESS,...(h[day]||{})};
}
function setWellness(day,data){
  const h=loadWellnessHistory(); h[day]={...DEFAULT_WELLNESS,...data,updatedAt:new Date().toISOString()}; saveWellnessHistory(h);
}

function isRunning(r){ return Number(r.distanceKm)>0 && !["등산","근력"].includes(r.type); }
function isQuality(r){ return ["템포","하프페이스","인터벌"].includes(r.type); }
function paceSeconds(r){
  const km=Number(r.distanceKm), min=Number(r.durationMinutes);
  return km>0 && min>0 ? min*60/km : null;
}
function paceText(r){
  const s=paceSeconds(r); if(!s) return "-";
  return `${Math.floor(s/60)}:${pad(Math.round(s%60)%60)}/km`;
}
function paceFromMinutes(distanceKm,totalMinutes){
  const sec=Number(totalMinutes)*60/Number(distanceKm);
  if(!Number.isFinite(sec)||sec<=0) return "-";
  return `${Math.floor(sec/60)}:${pad(Math.round(sec%60)%60)}/km`;
}
function strideMeters(r){
  const s=paceSeconds(r), c=Number(r.cadence); if(!s||c<=0) return null;
  return (1000/(s/60))/c;
}
function strideText(r){ const x=strideMeters(r); return x ? `${x.toFixed(2)} m` : "-"; }
function escapeHtml(s=""){ return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m])); }

function summarize(runs,wellnessHistory,ref=new Date()){
  const today=startOfDay(ref), tomorrow=addDays(today,1), running=runs.filter(isRunning);
  const total=(from,to)=>running.filter(r=>{const d=localDate(r.date);return d>=from&&d<to}).reduce((s,r)=>s+Number(r.distanceKm||0),0);
  const start7=addDays(today,-6), startPrev7=addDays(today,-13), endPrev7=addDays(today,-6), start28=addDays(today,-27), yesterday=addDays(today,-1);
  const yesterdayRuns=running.filter(r=>{const d=localDate(r.date);return d>=yesterday&&d<today});
  const cutoff48=addDays(today,-2), cutoff3d=addDays(today,-2), cutoff14d=addDays(today,-13);
  const latestLong=running.filter(r=>localDate(r.date)>=cutoff14d&&(r.type==="롱런"||Number(r.distanceKm)>=14)).sort((a,b)=>localDate(b.date)-localDate(a.date))[0];
  const latestQuality=running.filter(r=>localDate(r.date)>=cutoff14d&&isQuality(r)).sort((a,b)=>localDate(b.date)-localDate(a.date))[0];
  const wellnessRecent=Object.entries(wellnessHistory).filter(([d])=>localDate(d)>=cutoff3d&&localDate(d)<=today).map(([,w])=>Number(w.pain||0));
  const runPainRecent=running.filter(r=>localDate(r.date)>=cutoff3d).map(r=>Number(r.pain||0));
  const last7=total(start7,tomorrow), prev7=total(startPrev7,endPrev7);
  return {
    last7DaysKm:last7,previous7DaysKm:prev7,last28DaysKm:total(start28,tomorrow),
    yesterdayRunKm:yesterdayRuns.reduce((s,r)=>s+Number(r.distanceKm||0),0),
    yesterdayWasLongRun:yesterdayRuns.some(r=>r.type==="롱런"||Number(r.distanceKm)>=14),
    hardRunWithin48h:running.some(r=>localDate(r.date)>=cutoff48&&(isQuality(r)||Number(r.rpe)>=8||Number(r.avgHeartRate)>=160)),
    recentPain:Math.max(0,...wellnessRecent,...runPainRecent),
    latestLongRunKm:latestLong?Number(latestLong.distanceKm):null,
    latestLongRunRPE:latestLong?Number(latestLong.rpe||0):null,
    latestQualityRPE:latestQuality?Number(latestQuality.rpe||0):null,
    rampPercent:prev7>=10?Math.trunc(((last7/prev7)-1)*100):null
  };
}

function painTrend(history,ref=new Date()){
  const today=startOfDay(ref), vals=[];
  for(let i=6;i>=0;i--){ const w=history[dateKey(addDays(today,-i))]; if(w && w.pain!==null && w.pain!==undefined) vals.push(Number(w.pain)); }
  if(vals.length<2) return null;
  const recent=vals.slice(-3);
  if(recent.length>=2 && recent.every((v,i,a)=>i===0||v>a[i-1])) return {direction:"up",values:recent,label:"통증"};
  if(recent.length>=2 && recent.every((v,i,a)=>i===0||v<a[i-1])) return {direction:"down",values:recent,label:"통증"};
  return {direction:"flat",values:recent,label:"통증"};
}

function adjustmentText({hotHumid,rampHigh,loadHigh,hard48h}){
  const reasons=[];
  if(hotHumid) reasons.push("<strong>고온다습</strong>");
  if(rampHigh) reasons.push("<strong>전주 대비 마일리지 급증</strong>");
  if(loadHigh) reasons.push("<strong>최근 7일 마일리지 높음</strong>");
  if(hard48h) reasons.push("<strong>최근 48시간 강한 러닝</strong>");
  return reasons.length ? `${reasons.join(" · ")}을 반영해 오늘 훈련량을 낮췄어.` : "최근 기록상 <strong>추가로 훈련량을 낮출 요인은 크지 않아.</strong>";
}

function planFor(date,race,w,wellness,load,trend){
  const jsDay=date.getDay();
  const daysToRace=race?.enabled ? diffDaysSigned(date,localDate(race.date)) : null;
  const raceActive=race?.enabled && daysToRace>=0;
  const isRain=(w?.precipitation??0)>0.1 || ["비","뇌우"].includes(w?.description);
  const hotHumid=(w?.temperature??20)>=27&&(w?.humidity??50)>=70;
  const poorSleep=wellness.sleepQuality!=null && Number(wellness.sleepQuality)<=2;
  const poorRecovery=Number(wellness.pain||0)>=3||Number(wellness.fatigue||0)>=7||Number(wellness.soreness||0)>=7||poorSleep||load.recentPain>=3;
  const rampHigh=(load.rampPercent??0)>=30&&load.last7DaysKm>=30;
  const loadHigh=load.last7DaysKm>=42;
  const trendWarning=trend?.direction==="up";

  if(isRain) return {title:"우천 대체",distance:"러닝 0 km",pace:"-",heartRate:"-",warmup:"걷기 10분",cooldown:"가벼운 가동성 10분",note:"비 오는 날은 러닝 대신 <strong>실내 회복 또는 가벼운 상체 운동</strong>으로 대체.",adjustment:"현재 <strong>강수 조건</strong> 때문에 원래 러닝 계획을 취소했어."};
  if(poorRecovery||trendWarning){
    let reason="최근 통증 또는 오늘의 <strong>피로·근육통·수면 상태</strong>를 반영해 훈련 강도를 낮췄어.";
    if(trendWarning) reason+=` <strong>${escapeHtml(trend.label)} 통증이 ${trend.values.join(" → ")}/10으로 상승 추세</strong>야.`;
    return {title:"회복 우선",distance:"0–5 km 선택",pace:"아주 편하게",heartRate:"≤135 bpm",warmup:"걷기 10분",cooldown:"걷기 5–10분",note:"통증이 선명하거나 보행에도 느껴지면 <strong>완전 휴식</strong>.",adjustment:reason};
  }
  if(load.yesterdayWasLongRun) return {title:"롱런 후 회복",distance:"러닝 0 km",pace:"-",heartRate:"-",warmup:"걷기 10분 선택",cooldown:"가벼운 가동성 10분",note:"20–40분 가벼운 걷기 정도만. <strong>하체 고강도 근력은 생략</strong>.",adjustment:`어제 <strong>${load.yesterdayRunKm.toFixed(1)} km 장거리</strong> 기록을 감지해서 회복일로 바꿨어.`};

  if(jsDay===1){
    const reduced=load.yesterdayRunKm>=10||load.hardRunWithin48h;
    return {title:"회복",distance:reduced?"0–4 km 선택":"0–5 km 선택",pace:"6:20–6:50/km",heartRate:"130–140 bpm",warmup:"걷기 5–10분",cooldown:"걷기 5분",note:"다리가 무거우면 <strong>러닝 없이 걷기만</strong>.",adjustment:reduced?"최근 48시간의 <strong>훈련 부하가 남아 있어</strong> 회복 범위를 낮췄어.":"최근 기록상 <strong>추가 하향 요인은 없어.</strong>"};
  }
  if(jsDay===2){
    const reduced=load.hardRunWithin48h||rampHigh||loadHigh;
    const distance=hotHumid?(reduced?"6–7 km":"7–8 km"):(reduced?"6–8 km":"8–10 km");
    return {title:"이지런",distance,pace:hotHumid?"페이스 무시 · RPE 3–4":"5:55–6:20/km",heartRate:"135–145 bpm",warmup:"1 km 아주 천천히",cooldown:"1 km 천천히",note:"다음 품질훈련을 위해 <strong>끝까지 여유 있게</strong>.",adjustment:adjustmentText({hotHumid,rampHigh,loadHigh,hard48h:load.hardRunWithin48h})};
  }
  if(jsDay===4){
    if(load.hardRunWithin48h||rampHigh||loadHigh) return {title:"품질훈련 하향",distance:"총 7–9 km",pace:"2 km WU + 3–4 km 빠르게 + CD",heartRate:"가능하면 ≤160 bpm",warmup:"2 km",cooldown:"1.5–2 km",note:"오늘은 <strong>검증주가 아니라 감각 유지</strong>가 목적이야.",adjustment:"최근 <strong>강한 러닝 또는 마일리지 증가</strong>를 감지해서 품질량을 줄였어."};
    const hard=(load.latestQualityRPE??0)>=8;
    if(!raceActive) return {title:"품질훈련",distance:hard?"총 8–9 km":"총 9–11 km",pace:hard?"2 km WU + 15–20분 템포 + CD":"2 km WU + 20–25분 템포 + CD",heartRate:"통제 가능한 강도",warmup:"2 km + 4×20초 가속",cooldown:"1.5–2 km",note:"마지막까지 <strong>폼과 호흡이 무너지지 않는 강도</strong>로.",adjustment:hard?"최근 품질훈련의 <strong>RPE가 높아</strong> 템포 시간을 줄였어.":"대회가 등록되지 않아 <strong>일반 체력 향상용 품질훈련</strong>으로 구성했어."};
    if(daysToRace>28) return {title:"목표 페이스 적응",distance:hard?"총 8–10 km":"총 9–11 km",pace:hard?"2 km WU + 2×2 km @ 목표페이스 + CD":"2 km WU + 3×2 km @ 목표페이스 + CD",heartRate:"150대 후반~160대 초반",warmup:"2 km + 4×20초 가속",cooldown:"1.5–2 km",note:"목표페이스 감각을 쌓되 <strong>끝까지 통제</strong>.",adjustment:hard?"최근 품질훈련 <strong>RPE가 높아서 반복 수를 줄였어.</strong>":"최근 품질훈련이 과도하지 않아 <strong>기본 진행안</strong>을 유지했어."};
    if(daysToRace>14) return {title:"대회 특이훈련",distance:"총 10–12 km",pace:hard?"2 km WU + 5–6 km @ 목표페이스 + CD":"2 km WU + 6–8 km @ 목표페이스 + CD",heartRate:"150대 후반~160대 초반",warmup:"2 km",cooldown:"2 km",note:"연속 목표페이스 구간을 늘리되 <strong>과도한 검증주는 하지 않음</strong>.",adjustment:hard?"최근 품질훈련이 힘들었기 때문에 <strong>목표페이스 구간을 짧게</strong> 잡았어.":"대회가 가까워져 <strong>목표페이스 특이성</strong>을 높였어."};
    return {title:"테이퍼 품질",distance:"총 7–9 km",pace:"2 km WU + 3–4 km @ 목표페이스 + CD",heartRate:"과도한 상승 금지",warmup:"2 km",cooldown:"1.5–2 km",note:"피로를 남기지 않고 <strong>감각만 유지</strong>.",adjustment:"대회 2주 이내라 <strong>총량을 줄이는 테이퍼 단계</strong>야."};
  }
  if(jsDay===6){
    let phaseMin=15,phaseMax=18,reason="일반 주간 구조에 맞춘 롱런 범위야.";
    if(raceActive){
      if(daysToRace>35){phaseMin=16;phaseMax=18}
      else if(daysToRace>21){phaseMin=18;phaseMax=20}
      else if(daysToRace>14){phaseMin=16;phaseMax=18}
      else if(daysToRace>7){phaseMin=12;phaseMax=14}
      else {phaseMin=8;phaseMax=10}
      reason="<strong>대회까지 남은 기간</strong>에 맞춘 롱런 범위야.";
    }
    let targetMin=phaseMin,targetMax=phaseMax;
    if((!raceActive||daysToRace>14)&&load.latestLongRunKm!=null){
      const lastLong=load.latestLongRunKm;
      if((load.latestLongRunRPE??0)>=8){
        targetMin=Math.min(phaseMax,Math.max(phaseMin-1,lastLong-1)); targetMax=Math.min(phaseMax,Math.max(targetMin,lastLong));
        reason=`최근 롱런 <strong>${lastLong.toFixed(1)} km의 RPE가 높아</strong> 거리 증가를 멈췄어.`;
      }else{
        targetMin=Math.min(phaseMax,Math.max(phaseMin,Math.floor(lastLong+0.5))); targetMax=Math.min(phaseMax,Math.max(targetMin,Math.ceil(lastLong+1.5)));
        reason=`최근 롱런 <strong>${lastLong.toFixed(1)} km에서 0.5–1.5 km만 점진적으로 증가</strong>시켰어.`;
      }
    }
    if(rampHigh||loadHigh){targetMax=Math.max(targetMin,targetMax-1);reason+=" 최근 <strong>마일리지가 높아</strong> 상단 거리를 1 km 줄였어."}
    return {title:"롱런",distance:`${targetMin.toFixed(0)}–${targetMax.toFixed(0)} km${hotHumid?" 중 하단":""}`,pace:hotHumid?"HR/RPE 우선":"6:00–6:30/km",heartRate:"135–148 bpm",warmup:"첫 2 km 천천히",cooldown:"마지막 1 km 아주 편하게",note:"20–25분마다 수분. 90분 이상이면 보급. <strong>후반 억지 가속 금지</strong>.",adjustment:reason+(hotHumid?" <strong>고온다습</strong>해서 페이스보다 심박을 우선해.":"")};
  }
  if(jsDay===0){
    const reduced=load.yesterdayRunKm>=8||load.hardRunWithin48h;
    return {title:"선택적 저강도",distance:reduced?"러닝 0 km · 걷기/요가":"러닝 0–5 km 또는 걷기/요가",pace:"매우 편하게",heartRate:"≤135 bpm",warmup:"자연스럽게",cooldown:"가벼운 스트레칭",note:"토요일 피로가 있으면 <strong>완전 휴식</strong>.",adjustment:reduced?"최근 러닝 부하가 남아 있어 <strong>일요일 러닝을 빼는 쪽</strong>으로 조정했어.":"최근 부하가 낮아 <strong>선택적 저강도 활동</strong>은 가능해."};
  }
  return {title:"휴식",distance:"0 km",pace:"-",heartRate:"-",warmup:"-",cooldown:"가벼운 걷기 20–30분 선택",note:"수·금은 회복 중심. 하체 근력은 <strong>통증·피로가 없을 때만</strong> 가볍게.",adjustment:load.hardRunWithin48h?"최근 48시간 강한 러닝이 있어 <strong>회복 중요도가 더 높아.</strong>":"주간 구조에 따른 <strong>계획된 휴식일</strong>이야."};
}

function getRaceState(settings){
  return {enabled:Boolean(settings.raceEnabled),name:settings.raceName||"목표 대회",date:settings.raceDate,distance:Number(settings.raceDistance||0),targetMinutes:Number(settings.raceTargetMinutes||0)};
}

function render(){
  const now=new Date(), runs=loadRuns(), history=loadWellnessHistory(), wellness=getWellness(), settings=loadSettings();
  const load=summarize(runs,history,now), trend=painTrend(history,now), race=getRaceState(settings);
  $("last7").textContent=`${load.last7DaysKm.toFixed(1)} km`;
  $("last28").textContent=`${load.last28DaysKm.toFixed(1)} km`;
  $("ramp").textContent=load.rampPercent==null?"-":`${load.rampPercent>=0?"+":""}${load.rampPercent}%`;
  $("latestLong").textContent=load.latestLongRunKm==null?"-":`${load.latestLongRunKm.toFixed(1)} km`;
  $("logSummary").textContent=`최근 7일 ${load.last7DaysKm.toFixed(1)} km · 28일 ${load.last28DaysKm.toFixed(1)} km`;

  renderTargetCard(race,now);
  const p=planFor(now,race,weather,wellness,load,trend);
  $("planTitle").textContent=p.title; $("planDistance").textContent=p.distance; $("planPace").textContent=p.pace;
  $("planHr").textContent=p.heartRate; $("planWu").textContent=p.warmup; $("planCd").textContent=p.cooldown;
  $("planAdjustment").innerHTML=p.adjustment; $("planNote").innerHTML=p.note;
  renderWellness(wellness);
  renderRuns(runs);
  renderSettings(settings);
}

function renderTargetCard(race,now){
  const card=$("targetCard");
  if(!race.enabled||!race.date){card.hidden=true;return}
  const d=diffDaysSigned(now,localDate(race.date));
  if(d<0){card.hidden=true;return}
  card.hidden=false; $("targetName").textContent=race.name;
  const pace=race.distance>0&&race.targetMinutes>0?paceFromMinutes(race.distance,race.targetMinutes):"-";
  $("targetDetail").textContent=`${race.date} · 목표 ${formatMinutes(race.targetMinutes)} · ${pace}`;
  $("targetDday").textContent=d===0?"D-DAY":`D-${d}`;
}
function formatMinutes(min){
  const n=Number(min); if(!n) return "-"; const h=Math.floor(n/60),m=Math.round(n%60); return h?`${h}:${pad(m)}`:`${m}분`;
}

function sleepLabel(v){ return ({1:"매우 나쁨",2:"나쁨",3:"보통",4:"좋음",5:"매우 좋음"})[v] || "–"; }
function renderWellness(w){
  $("fatigueDisplay").textContent=w.fatigue==null?"–":w.fatigue;
  $("sorenessDisplay").textContent=w.soreness==null?"–":w.soreness;
  $("painDisplay").textContent=w.pain==null?"–":w.pain;
  $("sleepDisplay").textContent=sleepLabel(w.sleepQuality);
  document.querySelector('[data-condition="fatigue"]').classList.toggle("alert",Number(w.fatigue||0)>=7);
  document.querySelector('[data-condition="soreness"]').classList.toggle("alert",Number(w.soreness||0)>=7);
  document.querySelector('[data-condition="pain"]').classList.toggle("alert",Number(w.pain||0)>=4);
}
function setConditionValue(key,value){
  const day=dateKey(new Date()), current=getWellness(day); current[key]=value; setWellness(day,current); render();
}
let activeConditionKey=null;
function openConditionPicker(key){
  activeConditionKey=key; const current=getWellness()[key], box=$("conditionChoices");
  const labels={fatigue:"피로",soreness:"근육통",pain:"통증",sleepQuality:"수면상태"}; $("conditionTitle").textContent=labels[key];
  if(key==="sleepQuality"){
    box.className="number-choices sleep-choices";
    box.innerHTML=[1,2,3,4,5].map(v=>`<button class="choice-btn ${Number(current)===v?"selected":""}" data-value="${v}">${sleepLabel(v)}</button>`).join("");
  }else{
    box.className="number-choices";
    box.innerHTML=Array.from({length:11},(_,v)=>`<button class="choice-btn ${Number(current)===v?"selected":""}" data-value="${v}">${v}</button>`).join("");
  }
  box.querySelectorAll(".choice-btn").forEach(btn=>btn.onclick=()=>{setConditionValue(key,Number(btn.dataset.value));$("conditionDialog").close();});
  $("conditionDialog").showModal();
}

function renderRuns(runs){
  const box=$("runList");
  if(!runs.length){box.innerHTML=`<div class="card muted">아직 기록이 없어. 첫 번째 훈련을 입력해봐.</div>`;return}
  box.innerHTML=runs.map(r=>{
    const painLabel=Number(r.pain||0)>0 ? `${r.painSide?escapeHtml(r.painSide)+" ":""}${escapeHtml(r.painArea||"통증")} ${Number(r.pain)}/10` : "";
    return `<article class="run-item" data-run-id="${escapeHtml(r.id)}" role="button" tabindex="0">
      <div class="top"><span class="type">${escapeHtml(r.type)}</span><span class="date">${escapeHtml(r.date)}</span></div>
      <div class="main">${Number(r.distanceKm||0).toFixed(2)} km · ${paceText(r)} · HR ${Number(r.avgHeartRate||0)||"-"}</div>
      <div class="minor">케이던스 ${Number(r.cadence||0)||"-"} · 접지 ${Number(r.groundContactMs||0)||"-"}ms · 자동보폭 ${strideText(r)} · RPE ${Number(r.rpe||0)||"-"}</div>
      ${(r.shoe||painLabel||r.notes)?`<div class="minor">${[r.shoe&&`신발 ${escapeHtml(r.shoe)}`,painLabel&&`통증 ${painLabel}`,r.notes&&escapeHtml(r.notes)].filter(Boolean).join(" · ")}</div>`:""}
      <div class="run-actions"><button class="edit-btn" data-edit="${escapeHtml(r.id)}">편집</button><button class="delete-btn" data-delete="${escapeHtml(r.id)}">삭제</button></div>
    </article>`;
  }).join("");
  document.querySelectorAll(".run-item").forEach(card=>{
    card.onclick=e=>{if(e.target.closest("button"))return;openAnalysis(card.dataset.runId)};
    card.onkeydown=e=>{if(e.key==="Enter")openAnalysis(card.dataset.runId)};
  });
  document.querySelectorAll("[data-edit]").forEach(btn=>btn.onclick=e=>{e.stopPropagation();openEditRun(btn.dataset.edit)});
  document.querySelectorAll("[data-delete]").forEach(btn=>btn.onclick=e=>{e.stopPropagation();deleteRun(btn.dataset.delete)});
}
function deleteRun(id){ if(confirm("이 기록을 삭제할까?")){saveRuns(loadRuns().filter(r=>r.id!==id));render()} }

function analyzeRun(r,runs){
  const prior=runs.filter(x=>x.id!==r.id&&localDate(x.date)<localDate(r.date)).sort((a,b)=>localDate(b.date)-localDate(a.date));
  const sections=[];
  const km=Number(r.distanceKm||0), hr=Number(r.avgHeartRate||0), rpe=Number(r.rpe||0), pain=Number(r.pain||0), psec=paceSeconds(r);
  if(r.type==="롱런"||km>=14){
    const prevLong=prior.find(x=>x.type==="롱런"||Number(x.distanceKm)>=14);
    let text=`${km.toFixed(1)} km를 ${paceText(r)}로 완료한 장거리 훈련이야.`;
    if(hr) text+=` 평균 심박 ${hr} bpm`;
    if(rpe) text+=`, RPE ${rpe}/10`;
    text+=".";
    if(prevLong){const diff=km-Number(prevLong.distanceKm||0); if(diff>1.5) text+=` 이전 롱런보다 ${diff.toFixed(1)} km 늘어 증가 폭은 조금 큰 편이야.`; else if(diff>0) text+=` 이전 롱런보다 ${diff.toFixed(1)} km 증가해 점진적 진행 범위야.`}
    sections.push({kind:rpe>=8?"watch":"good",title:"장거리 적응",text});
  }else if(isQuality(r)){
    let text=`${r.type} 세션을 ${km.toFixed(1)} km 수행했어.`;
    if(psec) text+=` 전체 평균은 ${paceText(r)}`;
    if(hr) text+=`, 평균 심박은 ${hr} bpm`;
    if(rpe) text+=`, RPE는 ${rpe}/10`;
    text+="."; if(rpe>=8) text+=" 체감강도가 높아 다음 품질훈련 전 회복 간격을 충분히 두는 편이 좋아.";
    sections.push({kind:rpe>=8?"watch":"good",title:"품질훈련",text});
  }else{
    let text=`${km.toFixed(1)} km를 ${paceText(r)}로 수행했어.`;
    if(hr) text+=` 평균 심박 ${hr} bpm`;
    if(rpe) text+=`, RPE ${rpe}/10`;
    text+="."; if(rpe>=7&&["이지","회복런"].includes(r.type)) text+=" 이지 성격의 훈련치고 체감강도가 높은 편이라 날씨·피로·수분 상태를 같이 확인할 가치가 있어.";
    sections.push({kind:rpe>=7&&["이지","회복런"].includes(r.type)?"watch":"good",title:"강도 평가",text});
  }
  if(Number(r.cadence)>0||Number(r.groundContactMs)>0||Number(r.verticalOscillationCm)>0){
    const bits=[]; if(Number(r.cadence)>0)bits.push(`케이던스 ${r.cadence} spm`); if(Number(r.groundContactMs)>0)bits.push(`접지 ${r.groundContactMs} ms`); if(Number(r.verticalOscillationCm)>0)bits.push(`수직진폭 ${Number(r.verticalOscillationCm).toFixed(1)} cm`); if(strideMeters(r))bits.push(`보폭 ${strideText(r)}`);
    sections.push({kind:"good",title:"러닝 다이내믹스",text:`${bits.join(" · ")}. 단일 수치 자체보다 같은 페이스에서의 장기 추세를 보는 게 더 유용해.`});
  }
  if(pain>0){
    const loc=[r.painSide,r.painArea].filter(Boolean).join(" ");
    sections.push({kind:pain>=4?"alert":"watch",title:"통증 체크",text:`${loc||"통증"} ${pain}/10이 기록됐어. 같은 부위가 다음 날에도 유지되거나 증가하면 강도훈련보다 회복을 우선하고, 보행에도 느껴지거나 악화되면 러닝을 중단하는 쪽이 좋아.`});
  }else sections.push({kind:"good",title:"통증 체크",text:"훈련 기록상 통증 0/10이야. 다음 날 지연성 통증이 생기는지도 컨디션 기록으로 이어서 확인해."});
  const day=localDate(r.date), from=addDays(day,-6), weekKm=runs.filter(isRunning).filter(x=>{const d=localDate(x.date);return d>=from&&d<=day}).reduce((s,x)=>s+Number(x.distanceKm||0),0);
  sections.push({kind:"good",title:"다음 판단",text:`이 훈련까지 포함한 최근 7일 러닝 거리는 약 ${weekKm.toFixed(1)} km야. 다음 세션은 오늘의 컨디션과 통증 추세를 함께 반영해 앱이 자동 조정해.`});
  return sections;
}
function openAnalysis(id){
  const runs=loadRuns(), r=runs.find(x=>x.id===id); if(!r)return;
  selectedAnalysisRunId=id;
  $("analysisMeta").textContent=`${r.date} · ${r.type} · ${Number(r.distanceKm||0).toFixed(2)} km · ${paceText(r)} · HR ${Number(r.avgHeartRate||0)||"-"} · RPE ${Number(r.rpe||0)||"-"}`;
  $("analysisBody").innerHTML=analyzeRun(r,runs).map(s=>`<section class="analysis-section analysis-${s.kind}"><h3>${escapeHtml(s.title)}</h3><p>${escapeHtml(s.text)}</p></section>`).join("");
  $("analysisDialog").showModal();
}

function resetRunForm(){
  $("runForm").reset(); $("editingRunId").value=""; $("runDialogTitle").textContent="훈련 입력"; $("runDate").value=dateKey(new Date()); $("rpe").value=3; $("runPain").value=0; $("rpeVal").textContent=3; $("runPainVal").textContent=0; $("runPainDetails").hidden=true; preview();
}
function openEditRun(id){
  const r=loadRuns().find(x=>x.id===id); if(!r)return;
  resetRunForm(); $("editingRunId").value=r.id; $("runDialogTitle").textContent="훈련 편집";
  $("runDate").value=r.date||dateKey(new Date()); $("runType").value=r.type||"이지"; $("distanceKm").value=r.distanceKm??""; $("durationMinutes").value=r.durationMinutes??""; $("avgHeartRate").value=r.avgHeartRate??""; $("maxHeartRate").value=r.maxHeartRate??""; $("cadence").value=r.cadence??""; $("groundContactMs").value=r.groundContactMs??""; $("verticalOscillationCm").value=r.verticalOscillationCm??""; $("rpe").value=r.rpe||3; $("runPain").value=r.pain||0; $("rpeVal").textContent=r.rpe||3; $("runPainVal").textContent=r.pain||0; $("shoe").value=r.shoe||""; $("notes").value=r.notes||"";
  if(Number(r.pain)>0){
    $("runPainDetails").hidden=false;
    if(r.painArea&&!PAIN_AREAS.includes(r.painArea)){const o=document.createElement("option");o.value=r.painArea;o.textContent=r.painArea;$("painArea").prepend(o)}
    $("painArea").value=r.painArea||"기타"; $("painSide").value=r.painSide||"오른쪽";
  }
  preview(); $("addDialog").showModal();
}
function preview(){
  const r={distanceKm:Number($("distanceKm").value||0),durationMinutes:Number($("durationMinutes").value||0),cadence:Number($("cadence").value||0)};
  $("pacePreview").textContent=paceText(r); $("stridePreview").textContent=strideText(r);
}

async function fetchWeather(){
  $("weatherSummary").textContent="날씨 불러오는 중…"; $("hourlyWeather").innerHTML="";
  try{
    const url="https://api.open-meteo.com/v1/forecast?latitude=35.66&longitude=128.67&current=temperature_2m,relative_humidity_2m,precipitation,weather_code&hourly=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m&forecast_days=2&timezone=Asia%2FSeoul";
    const res=await fetch(url); if(!res.ok)throw new Error("weather");
    const x=await res.json(), c=x.current, h=x.hourly, today=dateKey(new Date());
    weather={temperature:c.temperature_2m,humidity:c.relative_humidity_2m,precipitation:c.precipitation,description:weatherDesc(c.weather_code)};
    weatherHourly=h.time.map((t,i)=>({time:t,temperature:h.temperature_2m[i],humidity:h.relative_humidity_2m[i],apparent:h.apparent_temperature[i],rain:h.precipitation_probability[i],code:h.weather_code[i],wind:h.wind_speed_10m[i]})).filter(v=>v.time.startsWith(today));
    $("weatherSummary").textContent=`현재 ${Math.round(weather.temperature)}℃ · 습도 ${weather.humidity}% · ${weather.description}`;
    renderHourlyWeather();
  }catch{
    weather=null;weatherHourly=[];$("weatherSummary").textContent="날씨를 불러오지 못했어. 인터넷 연결을 확인해줘.";
  }
  render();
}
function weatherDesc(code){
  if(code===0)return"맑음"; if(code>=1&&code<=3)return"구름"; if([45,48].includes(code))return"안개";
  if((code>=51&&code<=67)||(code>=80&&code<=82))return"비"; if((code>=71&&code<=77)||(code>=85&&code<=86))return"눈"; if(code>=95&&code<=99)return"뇌우"; return"변동";
}
function weatherIcon(code){
  if(code===0)return"☀️"; if(code===1)return"🌤️"; if(code>=2&&code<=3)return"☁️"; if([45,48].includes(code))return"🌫️"; if((code>=51&&code<=67)||(code>=80&&code<=82))return"🌧️"; if((code>=71&&code<=77)||(code>=85&&code<=86))return"🌨️"; if(code>=95)return"⛈️"; return"☁️";
}
function renderHourlyWeather(){
  const box=$("hourlyWeather"), nowHour=new Date().getHours();
  box.innerHTML=weatherHourly.map(v=>{
    const hour=Number(v.time.slice(11,13));
    return `<div class="weather-hour ${hour===nowHour?"now":""}" title="체감 ${Math.round(v.apparent)}℃ · 습도 ${v.humidity}% · 바람 ${Number(v.wind).toFixed(1)} km/h"><div class="time">${pad(hour)}시</div><div class="icon">${weatherIcon(v.code)}</div><div class="temp">${Math.round(v.temperature)}°</div><div class="rain">비 ${v.rain??0}%</div></div>`;
  }).join("");
  requestAnimationFrame(()=>{const idx=weatherHourly.findIndex(v=>Number(v.time.slice(11,13))===nowHour); if(idx>0) box.scrollLeft=Math.max(0,idx*87-10)});
}

function renderSettings(s){
  $("raceEnabled").checked=Boolean(s.raceEnabled); $("raceName").value=s.raceName||""; $("raceDate").value=s.raceDate||""; $("raceDistance").value=s.raceDistance||""; $("raceTargetMinutes").value=s.raceTargetMinutes||""; $("raceFields").hidden=!s.raceEnabled;
  $("raceTargetPace").textContent=paceFromMinutes(Number(s.raceDistance),Number(s.raceTargetMinutes));
}
function saveSettingsFromUI(){
  const s={raceEnabled:$("raceEnabled").checked,raceName:$("raceName").value.trim()||"목표 대회",raceDate:$("raceDate").value,raceDistance:Number($("raceDistance").value||0),raceTargetMinutes:Number($("raceTargetMinutes").value||0)};
  saveSettings(s); $("raceFields").hidden=!s.raceEnabled; $("raceTargetPace").textContent=paceFromMinutes(s.raceDistance,s.raceTargetMinutes); render();
}

function switchTab(tabId,direction=0){
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===tabId));
  document.querySelectorAll(".panel").forEach(x=>x.classList.toggle("active",x.id===tabId));
}
function installSwipeTabs(){
  const order=["today","log","settings"]; let sx=0,sy=0,tracking=false;
  document.querySelector("main").addEventListener("touchstart",e=>{ if(e.target.closest(".hourly-weather, dialog, input, select, textarea"))return; const t=e.touches[0];sx=t.clientX;sy=t.clientY;tracking=true; },{passive:true});
  document.querySelector("main").addEventListener("touchend",e=>{ if(!tracking)return;tracking=false;const t=e.changedTouches[0],dx=t.clientX-sx,dy=t.clientY-sy;if(Math.abs(dx)<55||Math.abs(dx)<Math.abs(dy)*1.25)return;const active=document.querySelector(".tab.active")?.dataset.tab||"today",i=order.indexOf(active);const ni=dx<0?i+1:i-1;if(ni>=0&&ni<order.length)switchTab(order[ni],dx<0?1:-1); },{passive:true});
}
function runFormHasContent(){
  return Boolean($("distanceKm").value||$("durationMinutes").value||$("avgHeartRate").value||$("maxHeartRate").value||$("cadence").value||$("groundContactMs").value||$("verticalOscillationCm").value||$("shoe").value.trim()||$("notes").value.trim()||$("editingRunId").value);
}
function buildRunFromForm(){
  const type=$("runType").value,distance=Number($("distanceKm").value||0); if(distance<=0&&type!=="근력"){alert("러닝/등산 기록은 거리를 입력해줘.");return null}
  const editingId=$("editingRunId").value;
  return {id:editingId||(crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random()}`),date:$("runDate").value,type,distanceKm:distance,durationMinutes:Number($("durationMinutes").value||0),avgHeartRate:Number($("avgHeartRate").value||0),maxHeartRate:Number($("maxHeartRate").value||0),cadence:Number($("cadence").value||0),groundContactMs:Number($("groundContactMs").value||0),verticalOscillationCm:Number($("verticalOscillationCm").value||0),rpe:Number($("rpe").value||3),pain:Number($("runPain").value||0),painArea:Number($("runPain").value)>0?$("painArea").value:"",painSide:Number($("runPain").value)>0?$("painSide").value:"",shoe:$("shoe").value.trim(),notes:$("notes").value.trim()};
}
function saveRunFromForm(){ const r=buildRunFromForm();if(!r)return false;let runs=loadRuns(),id=$("editingRunId").value;if(id)runs=runs.map(x=>x.id===id?r:x);else runs.push(r);saveRuns(runs);render();return true; }
function requestCloseRun(){ if(!runFormHasContent()){$("addDialog").close();return} $("discardDialog").showModal(); }
function init(){
  migrateOldWellness(); populatePainAreaSelect("painArea");
  document.querySelectorAll(".tab").forEach(btn=>btn.onclick=()=>switchTab(btn.dataset.tab)); installSwipeTabs();
  document.querySelectorAll(".status-item").forEach(btn=>btn.onclick=()=>openConditionPicker(btn.dataset.condition)); $("closeCondition").onclick=()=>$("conditionDialog").close();
  $("refreshWeather").onclick=fetchWeather;
  $("openAdd").onclick=()=>{resetRunForm();$("addDialog").showModal()};
  ["distanceKm","durationMinutes","cadence"].forEach(id=>$(id).oninput=preview);
  $("rpePicker").onclick=()=>openRunRpePicker();
  $("runPain").oninput=()=>{$("runPainVal").textContent=$("runPain").value;$("runPainDetails").hidden=Number($("runPain").value)===0};
  $("saveRun").onclick=e=>{e.preventDefault();if(saveRunFromForm())$("addDialog").close()};
  $("closeRunSheet").onclick=requestCloseRun; $("cancelRun").onclick=requestCloseRun; $("addDialog").addEventListener("cancel",e=>{e.preventDefault();requestCloseRun()});
  $("addDialog").addEventListener("click",e=>{if(e.target===$("addDialog"))requestCloseRun()});
  $("saveAndClose").onclick=()=>{if(saveRunFromForm()){$("discardDialog").close();$("addDialog").close()}};
  $("discardAndClose").onclick=()=>{$("discardDialog").close();$("addDialog").close()}; $("keepEditing").onclick=()=>$("discardDialog").close();
  $("closeAnalysis").onclick=()=>$("analysisDialog").close(); $("analysisCloseBtn").onclick=()=>$("analysisDialog").close(); $("analysisEdit").onclick=()=>{const id=selectedAnalysisRunId;$("analysisDialog").close();openEditRun(id)};
  ["raceEnabled","raceName","raceDate","raceDistance","raceTargetMinutes"].forEach(id=>$(id).onchange=saveSettingsFromUI);
  $("exportBtn").onclick=()=>{const blob=new Blob([JSON.stringify({version:4,exportedAt:new Date().toISOString(),runs:loadRuns(),wellnessHistory:loadWellnessHistory(),settings:loadSettings()},null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`running-coaching-backup-${dateKey(new Date())}.json`;a.click();URL.revokeObjectURL(a.href)};
  $("importInput").onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{const obj=JSON.parse(await file.text()),runs=Array.isArray(obj)?obj:obj.runs;if(!Array.isArray(runs))throw new Error();if(confirm(`훈련 기록 ${runs.length}개와 포함된 설정/상태 데이터로 현재 데이터를 교체할까?`)){saveRuns(runs);if(obj.wellnessHistory&&typeof obj.wellnessHistory==="object")saveWellnessHistory(obj.wellnessHistory);if(obj.settings&&typeof obj.settings==="object")saveSettings({...DEFAULT_SETTINGS,...obj.settings});render()}}catch{alert("올바른 러닝 코칭 백업 JSON 파일이 아니야.")}e.target.value=""};
  if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}))} render();fetchWeather();
}
function openRunRpePicker(){
  activeConditionKey="__rpe"; const box=$("conditionChoices"),cur=Number($("rpe").value||3); $("conditionTitle").textContent="RPE";box.className="number-choices";box.innerHTML=Array.from({length:10},(_,i)=>i+1).map(v=>`<button class="choice-btn ${cur===v?"selected":""}" data-value="${v}">${v}</button>`).join("");box.querySelectorAll(".choice-btn").forEach(btn=>btn.onclick=()=>{$("rpe").value=btn.dataset.value;$("rpeVal").textContent=btn.dataset.value;$("conditionDialog").close()});$("conditionDialog").showModal();
}
init();
