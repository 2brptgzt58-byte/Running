
const RACE_DATE = new Date("2026-10-25T08:00:00+09:00");
const STORAGE_KEY = "runningCoaching.runRecords.v2";
const WELLNESS_KEY = "runningCoaching.wellness.v1";
let weather = null;

const $ = (id) => document.getElementById(id);
const pad = n => String(n).padStart(2,"0");
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const diffDays = (a,b) => Math.max(0, Math.round((startOfDay(b)-startOfDay(a))/86400000));

function loadRuns(){
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]").sort((a,b)=>new Date(b.date)-new Date(a.date)); }
  catch { return []; }
}
function saveRuns(runs){ localStorage.setItem(STORAGE_KEY, JSON.stringify(runs)); }
function loadWellness(){
  try { return JSON.parse(localStorage.getItem(WELLNESS_KEY) || '{"fatigue":2,"soreness":2,"pain":0,"sleptWell":true}'); }
  catch { return {fatigue:2,soreness:2,pain:0,sleptWell:true}; }
}
function saveWellness(w){ localStorage.setItem(WELLNESS_KEY, JSON.stringify(w)); }

function isRunning(r){ return Number(r.distanceKm)>0 && r.type!=="등산" && r.type!=="근력"; }
function isQuality(r){ return ["템포","하프페이스","인터벌"].includes(r.type); }
function paceSeconds(r){
  const km=Number(r.distanceKm), min=Number(r.durationMinutes);
  return km>0 && min>0 ? min*60/km : null;
}
function paceText(r){
  const s=paceSeconds(r); if(!s) return "-";
  return `${Math.floor(s/60)}:${pad(Math.floor(s%60))}/km`;
}
function strideMeters(r){
  const s=paceSeconds(r), c=Number(r.cadence);
  if(!s || c<=0) return null;
  const metersPerMinute=1000/(s/60);
  return metersPerMinute/c;
}
function strideText(r){ const x=strideMeters(r); return x ? `${x.toFixed(2)} m` : "-"; }

function summarize(runs, ref=new Date()){
  const today=startOfDay(ref), tomorrow=addDays(today,1);
  const running=runs.filter(isRunning);
  const total=(from,to)=>running.filter(r=>{const d=new Date(r.date); return d>=from && d<to}).reduce((s,r)=>s+Number(r.distanceKm||0),0);
  const start7=addDays(today,-6), startPrev7=addDays(today,-13), endPrev7=addDays(today,-6), start28=addDays(today,-27), yesterday=addDays(today,-1);
  const yesterdayRuns=running.filter(r=>{const d=new Date(r.date); return d>=yesterday && d<today});
  const cutoff48=new Date(ref.getTime()-48*3600*1000), cutoff3d=new Date(ref.getTime()-3*86400*1000), cutoff14d=new Date(ref.getTime()-14*86400*1000);
  const latestLong=running.filter(r=>new Date(r.date)>=cutoff14d && (r.type==="롱런" || Number(r.distanceKm)>=14)).sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
  const latestQuality=running.filter(r=>new Date(r.date)>=cutoff14d && isQuality(r)).sort((a,b)=>new Date(b.date)-new Date(a.date))[0];
  const last7=total(start7,tomorrow), prev7=total(startPrev7,endPrev7);
  return {
    last7DaysKm:last7, previous7DaysKm:prev7, last28DaysKm:total(start28,tomorrow),
    yesterdayRunKm:yesterdayRuns.reduce((s,r)=>s+Number(r.distanceKm||0),0),
    yesterdayWasLongRun:yesterdayRuns.some(r=>r.type==="롱런" || Number(r.distanceKm)>=14),
    hardRunWithin48h:running.some(r=>new Date(r.date)>=cutoff48 && (isQuality(r) || Number(r.rpe)>=8 || Number(r.avgHeartRate)>=160)),
    recentPain:Math.max(0,...running.filter(r=>new Date(r.date)>=cutoff3d).map(r=>Number(r.pain||0))),
    latestLongRunKm:latestLong ? Number(latestLong.distanceKm) : null,
    latestLongRunRPE:latestLong ? Number(latestLong.rpe||0) : null,
    latestQualityRPE:latestQuality ? Number(latestQuality.rpe||0) : null,
    rampPercent: prev7>=10 ? Math.trunc(((last7/prev7)-1)*100) : null
  };
}

function adjustmentText({hotHumid,rampHigh,loadHigh,hard48h}){
  const reasons=[];
  if(hotHumid) reasons.push("고온다습");
  if(rampHigh) reasons.push("전주 대비 주간거리 급증");
  if(loadHigh) reasons.push("최근 7일 누적거리 높음");
  if(hard48h) reasons.push("최근 48시간 강한 러닝");
  return reasons.length ? reasons.join(" · ")+"을 반영해 거리를 낮췄어." : "최근 기록상 이지런을 줄일 필요는 없어.";
}

function planFor(date, daysToRace, w, wellness, load){
  const jsDay=date.getDay(); // 0 Sun ... 6 Sat
  const isRain=(w?.precipitation??0)>0.1 || ["비","뇌우"].includes(w?.description);
  const hotHumid=(w?.temperature??20)>=27 && (w?.humidity??50)>=70;
  const poorRecovery=wellness.pain>=3 || wellness.fatigue>=7 || wellness.soreness>=7 || !wellness.sleptWell || load.recentPain>=3;
  const rampHigh=(load.rampPercent??0)>=30 && load.last7DaysKm>=30;
  const loadHigh=load.last7DaysKm>=42;

  if(isRain) return {title:"우천 대체",distance:"러닝 0 km",pace:"-",heartRate:"-",warmup:"걷기 10분",cooldown:"가벼운 가동성 10분",note:"비 오는 날은 러닝을 피하고 실내 회복 또는 가벼운 상체 운동으로 대체.",adjustment:"현재 강수 조건 때문에 원래 계획을 취소했어."};
  if(poorRecovery) return {title:"회복 우선",distance:"0–5 km 선택",pace:"아주 편하게",heartRate:"≤135 bpm",warmup:"걷기 10분",cooldown:"걷기 5–10분",note:"통증이 선명하거나 보행에도 느껴지면 완전 휴식.",adjustment:"최근 통증 또는 오늘의 피로/근육통/수면 상태를 반영해 훈련을 하향했어."};
  if(load.yesterdayWasLongRun) return {title:"롱런 후 회복",distance:"러닝 0 km",pace:"-",heartRate:"-",warmup:"걷기 10분 선택",cooldown:"가벼운 가동성 10분",note:"20–40분 가벼운 걷기 정도만. 하체 고강도 근력은 생략.",adjustment:`어제 ${load.yesterdayRunKm.toFixed(1)} km 장거리 기록을 감지해서 회복일로 바꿨어.`};

  if(jsDay===1){
    const reduced=load.yesterdayRunKm>=10 || load.hardRunWithin48h;
    return {title:"회복",distance:reduced?"0–4 km 선택":"0–5 km 선택",pace:"6:20–6:50/km",heartRate:"130–140 bpm",warmup:"걷기 5–10분",cooldown:"걷기 5분",note:"다리가 무거우면 러닝 없이 걷기만.",adjustment:reduced?"최근 48시간 훈련부하가 있어 회복 범위를 낮췄어.":"최근 기록상 추가 하향 요인은 없어."};
  }
  if(jsDay===2){
    const reduced=load.hardRunWithin48h || rampHigh || loadHigh;
    const distance=hotHumid ? (reduced?"6–7 km":"7–8 km") : (reduced?"6–8 km":"8–10 km");
    return {title:"이지런",distance,pace:hotHumid?"페이스 무시 · RPE 3–4":"5:55–6:20/km",heartRate:"135–145 bpm",warmup:"1 km 아주 천천히",cooldown:"1 km 천천히",note:"목요일 품질훈련을 위해 끝까지 여유 있게.",adjustment:adjustmentText({hotHumid,rampHigh,loadHigh,hard48h:load.hardRunWithin48h})};
  }
  if(jsDay===4){
    if(load.hardRunWithin48h || rampHigh || loadHigh) return {title:"품질훈련 하향",distance:"총 7–9 km",pace:"2 km WU + 3–4 km @ 5:15–5:20/km + CD",heartRate:"가능하면 ≤160 bpm",warmup:"2 km",cooldown:"1.5–2 km",note:"최근 부하가 높아 목표페이스 감각만 유지. 4:30/km 검증주는 하지 않음.",adjustment:"최근 48시간 강한 러닝 또는 주간 부하 증가를 감지해서 목요일 품질량을 줄였어."};
    const hard=(load.latestQualityRPE??0)>=8;
    if(daysToRace>28) return {title:"하프 페이스 적응",distance:hard?"총 8–10 km":"총 9–11 km",pace:hard?"2 km WU + 2×2 km @ 5:10–5:15/km + CD":"2 km WU + 3×2 km @ 5:10–5:15/km (세트 사이 3분 조깅) + CD",heartRate:"품질구간 150대 후반~160대 초반",warmup:"2 km + 4×20초 가속",cooldown:"1.5–2 km",note:"목표페이스 감각을 쌓되 끝까지 통제. 과도한 검증주 금지.",adjustment:hard?"최근 품질훈련 RPE가 높아서 반복 수를 하나 줄였어.":"최근 품질훈련이 과도하지 않아 기본 진행안을 유지했어."};
    if(daysToRace>14) return {title:"하프 특이훈련",distance:"총 10–12 km",pace:hard?"2 km WU + 5–6 km @ 5:10–5:15/km + CD":"2 km WU + 6–8 km @ 5:10–5:15/km + CD",heartRate:"150대 후반~160대 초반",warmup:"2 km",cooldown:"2 km",note:"연속 목표페이스 구간을 늘리되 15 km 검증주는 하지 않음.",adjustment:hard?"최근 품질훈련이 힘들었기 때문에 목표페이스 구간을 짧게 잡았어.":"최근 품질훈련 상태가 괜찮아 특이적 구간을 유지했어."};
    return {title:"테이퍼 품질",distance:"총 7–9 km",pace:"2 km WU + 3–4 km @ 5:10–5:15/km + CD",heartRate:"과도한 상승 금지",warmup:"2 km",cooldown:"1.5–2 km",note:"피로를 남기지 않고 감각만 유지.",adjustment:"대회 2주 이내라 최근 기록과 무관하게 총량을 줄이는 테이퍼 단계야."};
  }
  if(jsDay===6){
    let phaseMin,phaseMax;
    if(daysToRace>35){phaseMin=16;phaseMax=18}
    else if(daysToRace>21){phaseMin=18;phaseMax=20}
    else if(daysToRace>14){phaseMin=16;phaseMax=18}
    else if(daysToRace>7){phaseMin=12;phaseMax=14}
    else {phaseMin=8;phaseMax=10}
    let targetMin=phaseMin,targetMax=phaseMax,reason="대회까지 남은 기간에 맞춘 기본 롱런 범위야.";
    if(daysToRace>14 && load.latestLongRunKm!=null){
      const lastLong=load.latestLongRunKm;
      if((load.latestLongRunRPE??0)>=8){
        targetMin=Math.min(phaseMax,Math.max(phaseMin-1,lastLong-1));
        targetMax=Math.min(phaseMax,Math.max(targetMin,lastLong));
        reason=`최근 롱런 ${lastLong.toFixed(1)} km의 RPE가 높아 거리 증가를 멈췄어.`;
      } else {
        targetMin=Math.min(phaseMax,Math.max(phaseMin,Math.floor(lastLong+0.5)));
        targetMax=Math.min(phaseMax,Math.max(targetMin,Math.ceil(lastLong+1.5)));
        reason=`최근 롱런 ${lastLong.toFixed(1)} km에서 0.5–1.5 km만 점진적으로 늘렸어.`;
      }
    }
    if(rampHigh || loadHigh){targetMax=Math.max(targetMin,targetMax-1);reason+=" 최근 주간 부하가 높아 상단 거리를 1 km 줄였어."}
    return {title:"롱런",distance:`${targetMin.toFixed(0)}–${targetMax.toFixed(0)} km${hotHumid?" 중 하단":""}`,pace:hotHumid?"HR/RPE 우선":"6:00–6:30/km",heartRate:"135–148 bpm",warmup:"첫 2 km 천천히",cooldown:"마지막 1 km 아주 편하게",note:"20–25분마다 수분. 90분 이상이면 젤 1개 추가. 후반 억지 가속 금지.",adjustment:reason+(hotHumid?" 고온다습해서 페이스 대신 심박을 우선해.":"")};
  }
  if(jsDay===0){
    const reduced=load.yesterdayRunKm>=8 || load.hardRunWithin48h;
    return {title:"선택적 저강도",distance:reduced?"러닝 0 km · 걷기/요가":"러닝 0–5 km 또는 걷기/요가",pace:"매우 편하게",heartRate:"≤135 bpm",warmup:"자연스럽게",cooldown:"가벼운 스트레칭",note:"토요일 롱런 피로가 있으면 완전 휴식.",adjustment:reduced?"최근 러닝 부하가 남아 있어 일요일 러닝을 빼는 쪽으로 조정했어.":"최근 부하가 낮아 선택적 저강도 활동은 가능해."};
  }
  return {title:"휴식",distance:"0 km",pace:"-",heartRate:"-",warmup:"-",cooldown:"가벼운 걷기 20–30분 선택",note:"수·금은 회복 중심. 하체 근력은 통증/피로 없을 때만 가볍게.",adjustment:load.hardRunWithin48h?"최근 48시간 강한 러닝이 있어 휴식의 중요도가 더 높아.":"주간 구조에 따른 계획된 휴식일이야."};
}

function render(){
  const now=new Date(), runs=loadRuns(), load=summarize(runs), wellness=loadWellness();
  const d=diffDays(now,RACE_DATE);
  $("dDay").textContent=`D-${d}`;
  $("last7").textContent=`${load.last7DaysKm.toFixed(1)} km`;
  $("last28").textContent=`${load.last28DaysKm.toFixed(1)} km`;
  $("ramp").textContent=load.rampPercent==null?"-":`${load.rampPercent>=0?"+":""}${load.rampPercent}%`;
  $("latestLong").textContent=load.latestLongRunKm==null?"-":`${load.latestLongRunKm.toFixed(1)} km`;
  $("logSummary").textContent=`최근 7일 ${load.last7DaysKm.toFixed(1)} km · 28일 ${load.last28DaysKm.toFixed(1)} km`;

  const p=planFor(now,d,weather,wellness,load);
  $("planTitle").textContent=p.title; $("planDistance").textContent=p.distance; $("planPace").textContent=p.pace;
  $("planHr").textContent=p.heartRate; $("planWu").textContent=p.warmup; $("planCd").textContent=p.cooldown;
  $("planAdjustment").textContent=p.adjustment; $("planNote").textContent=p.note;

  $("fatigue").value=wellness.fatigue; $("soreness").value=wellness.soreness; $("pain").value=wellness.pain; $("sleptWell").checked=wellness.sleptWell;
  $("fatigueVal").textContent=wellness.fatigue; $("sorenessVal").textContent=wellness.soreness; $("painVal").textContent=wellness.pain;
  renderRuns(runs);
}

function renderRuns(runs){
  const box=$("runList");
  if(!runs.length){box.innerHTML=`<div class="card muted">아직 기록이 없어. Garmin Connect 기록을 첫 번째로 입력해봐.</div>`;return}
  box.innerHTML=runs.map(r=>`
    <article class="run-item">
      <div class="top"><span class="type">${escapeHtml(r.type)}</span><span class="date">${escapeHtml(r.date)}</span></div>
      <div class="main">${Number(r.distanceKm||0).toFixed(2)} km · ${paceText(r)} · HR ${Number(r.avgHeartRate||0)}</div>
      <div class="minor">케이던스 ${Number(r.cadence||0)} · 접지 ${Number(r.groundContactMs||0)}ms · 자동보폭 ${strideText(r)} · RPE ${Number(r.rpe||0)}</div>
      ${(r.shoe||r.painArea||r.notes)?`<div class="minor">${[r.shoe&&`신발 ${escapeHtml(r.shoe)}`,r.painArea&&`통증 ${escapeHtml(r.painArea)} ${Number(r.pain||0)}/10`,r.notes&&escapeHtml(r.notes)].filter(Boolean).join(" · ")}</div>`:""}
      <button class="delete-btn" data-delete="${r.id}">삭제</button>
    </article>`).join("");
  document.querySelectorAll("[data-delete]").forEach(btn=>btn.onclick=()=>{
    if(confirm("이 기록을 삭제할까?")){ saveRuns(loadRuns().filter(r=>r.id!==btn.dataset.delete)); render(); }
  });
}
function escapeHtml(s=""){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}

async function fetchWeather(){
  $("weatherLine").textContent="날씨 불러오는 중…";
  try{
    const url="https://api.open-meteo.com/v1/forecast?latitude=35.66&longitude=128.67&current=temperature_2m,relative_humidity_2m,precipitation,weather_code&timezone=Asia%2FSeoul";
    const res=await fetch(url); if(!res.ok) throw new Error("weather");
    const x=await res.json(), c=x.current;
    const desc=weatherDesc(c.weather_code);
    weather={temperature:c.temperature_2m,humidity:c.relative_humidity_2m,precipitation:c.precipitation,description:desc};
    $("weatherLine").textContent=`${Math.round(weather.temperature)}℃ · 습도 ${weather.humidity}% · ${desc}${weather.precipitation>0?` · 강수 ${weather.precipitation}mm`:""}`;
  }catch(e){
    weather=null;$("weatherLine").textContent="날씨를 불러오지 못했어. 인터넷 연결을 확인해줘.";
  }
  render();
}
function weatherDesc(code){
  if(code===0)return"맑음"; if(code>=1&&code<=3)return"구름"; if([45,48].includes(code))return"안개";
  if((code>=51&&code<=67)||(code>=80&&code<=82))return"비";
  if((code>=71&&code<=77)||(code>=85&&code<=86))return"눈";
  if(code>=95&&code<=99)return"뇌우"; return"변동";
}

function preview(){
  const r={distanceKm:Number($("distanceKm").value||0),durationMinutes:Number($("durationMinutes").value||0),cadence:Number($("cadence").value||0)};
  $("pacePreview").textContent=paceText(r); $("stridePreview").textContent=strideText(r);
}

document.querySelectorAll(".tab").forEach(btn=>btn.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===btn));
  document.querySelectorAll(".panel").forEach(x=>x.classList.toggle("active",x.id===btn.dataset.tab));
});
["fatigue","soreness","pain"].forEach(id=>$(id).oninput=()=>$(id+"Val").textContent=$(id).value);
$("recalc").onclick=()=>{
  saveWellness({fatigue:Number($("fatigue").value),soreness:Number($("soreness").value),pain:Number($("pain").value),sleptWell:$("sleptWell").checked});
  render();
};
$("refreshWeather").onclick=fetchWeather;
$("openAdd").onclick=()=>{ $("runForm").reset(); $("runDate").value=dateKey(new Date()); $("rpe").value=3;$("runPain").value=0;$("rpeVal").textContent=3;$("runPainVal").textContent=0;preview();$("addDialog").showModal(); };
["distanceKm","durationMinutes","cadence"].forEach(id=>$(id).oninput=preview);
$("rpe").oninput=()=>{$("rpeVal").textContent=$("rpe").value};
$("runPain").oninput=()=>{$("runPainVal").textContent=$("runPain").value};
$("saveRun").onclick=(e)=>{
  e.preventDefault();
  const type=$("runType").value, distance=Number($("distanceKm").value||0);
  if(distance<=0 && type!=="근력"){alert("러닝/등산 기록은 거리를 입력해줘.");return}
  const r={
    id:crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    date:$("runDate").value,type,distanceKm:distance,durationMinutes:Number($("durationMinutes").value||0),
    avgHeartRate:Number($("avgHeartRate").value||0),maxHeartRate:Number($("maxHeartRate").value||0),
    cadence:Number($("cadence").value||0),groundContactMs:Number($("groundContactMs").value||0),
    verticalOscillationCm:Number($("verticalOscillationCm").value||0),rpe:Number($("rpe").value||3),
    pain:Number($("runPain").value||0),painArea:$("painArea").value.trim(),shoe:$("shoe").value.trim(),notes:$("notes").value.trim()
  };
  const runs=loadRuns();runs.push(r);saveRuns(runs);$("addDialog").close();render();
};
$("exportBtn").onclick=()=>{
  const blob=new Blob([JSON.stringify({version:2,exportedAt:new Date().toISOString(),runs:loadRuns()},null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`running-coaching-backup-${dateKey(new Date())}.json`;a.click();URL.revokeObjectURL(a.href);
};
$("importInput").onchange=async(e)=>{
  const file=e.target.files?.[0]; if(!file)return;
  try{
    const obj=JSON.parse(await file.text()), runs=Array.isArray(obj)?obj:obj.runs;
    if(!Array.isArray(runs))throw new Error();
    if(confirm(`기록 ${runs.length}개로 현재 기록을 교체할까?`)){saveRuns(runs);render();}
  }catch{alert("올바른 러닝 코칭 백업 JSON 파일이 아니야.");}
  e.target.value="";
};

if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}))}
render();
fetchWeather();
