// Public Daniels–Gilbert performance equations. Training zones are approximations,
// not licensed V.O2 tables. Volume thresholds below are conservative app policies,
// not validated injury prediction thresholds.
function formatPace(seconds){const s=Math.round(seconds);return Number.isFinite(s)&&s>0?`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}/km`:'—'}
function vdotFromResult(km,t){if(!(km>=1.5&&km<=42.195&&t>0))return null;const v=km*1000/t;const n=(-4.6+.182258*v+.000104*v*v)/(.8+.1894393*Math.exp(-.012778*t)+.2989558*Math.exp(-.1932605*t));return n>=20&&n<=85?n:null}
function paceAt(vdot,fraction){const v=(-.182258+Math.sqrt(.182258**2+4*.000104*(4.6+vdot*fraction)))/(2*.000104);return 60000/v}
function fitnessState(runs,s,ref){
 const eligible=runs.filter(r=>r.fitnessEligible&&['대회','타임트라이얼'].includes(r.type)&&!r.pain&&!r.walkingPain&&!r.focalPain&&!r.worseningPain&&r.completion!=='stopped'&&r.nextDay!=='poor').map(r=>({date:r.date,value:vdotFromResult(+r.distanceKm,+r.durationMinutes),source:`${r.date} · ${r.distanceKm} km · ${r.durationMinutes}분`}));
 if(+s.manualVdot>=20&&+s.manualVdot<=85&&s.manualVdotDate)eligible.push({date:s.manualVdotDate,value:+s.manualVdot,source:`${s.manualVdotDate} · 수동 기준`});
 const candidates=eligible.filter(x=>x.value&&diffDaysSigned(localDate(x.date),ref)>=0).sort((a,b)=>b.date.localeCompare(a.date));
 const latest=candidates[0];if(!latest)return {value:null,source:'검증 기록 없음 · RPE 기반 임시 훈련',stale:false};
 const age=diffDaysSigned(localDate(latest.date),ref);if(age>90)return {value:null,source:`기준 기록 ${age}일 경과 · 새 기록 필요`,stale:true};
 return {...latest,stale:false,age};
}
function paceSet(f){if(!f.value)return null;return {easyFast:paceAt(f.value,.74),easySlow:paceAt(f.value,.59),threshold:paceAt(f.value,.86),interval:paceAt(f.value,.98)}}
function recentRuns(runs,ref,days){return runs.filter(isRunning).filter(r=>{const age=diffDaysSigned(localDate(r.date),ref);return age>=0&&age<days})}
function volumeState(runs,ref,history){
 const start=mondayOf(ref), past=recentRuns(runs,addDays(start,-1),28), weeks=[0,1,2,3].map(i=>past.filter(r=>{const age=diffDaysSigned(localDate(r.date),start);return age>i*7&&age<=(i+1)*7}));
 const observed=weeks.filter(w=>w.length>=2).length, average=weeks.reduce((s,w)=>s+w.reduce((t,r)=>t+runMinutes(r),0),0)/4;
 const recent=recentRuns(runs,ref,30), longest=recent.reduce((a,r)=>+r.distanceKm>+(a?.distanceKm||0)?r:a,null);
 const last=recent.slice().sort((a,b)=>b.date.localeCompare(a.date))[0], gap=last?diffDaysSigned(localDate(last.date),ref):99;
 const bad=recentRuns(runs,ref,7).some(r=>r.rpe>=8||r.pain>=3||r.nextDay==='poor'||r.completion==='stopped')||Object.entries(history).some(([d,w])=>diffDaysSigned(localDate(d),ref)>=0&&diffDaysSigned(localDate(d),ref)<7&&(w.pain>=3||w.fatigue>=7||w.painResponse==='red'||w.painResponse==='worse'));
 const progression=observed>=3&&!bad&&gap<7&&weeks[0].length>=3&&weeks[1].length>=3;
 let budget=observed>=2?average*(progression?1.05:1):Math.min(120,Math.max(60,recent.reduce((s,r)=>s+runMinutes(r),0)/4));
 if(bad)budget*=.8;if(gap>=14)budget*=.6;
 return {budget,observed,bad,gap,longest,progression};
}
function adaptWeek(ref,runs,status,tid,race,s,history){
 const entries=buildAdaptiveWeek(ref,runs,status,tid), v=volumeState(runs,ref,history), days=race.enabled?diffDaysSigned(ref,localDate(race.date)):null;
 entries.forEach(e=>{
  if(e.resolvedStatus)return;
  const dr=race.enabled?diffDaysSigned(e.date,localDate(race.date)):null;
  if(dr===0)e.plannedType='race';
  else if(dr<0&&dr>=-7)e.plannedType='rest';
  else if(dr===1||dr===2)e.plannedType='rest';
  else if(dr>0&&dr<=6)e.plannedType=dr===3?'quality':dr===5?'easy':'rest';
  else if((v.observed<2||!fitnessState(runs,s,ref).value)&&e.plannedType==='quality')e.plannedType='easy';
  // Respect hard sessions across week boundaries and manually completed sessions.
  const recentHard=runs.some(r=>isRunning(r)&&isQuality(r)&&diffDaysSigned(localDate(r.date),e.date)>0&&diffDaysSigned(localDate(r.date),e.date)<=2);
  const prior=entries[e.index-1];
  if((recentHard||prior?.resolvedType==='quality'&&prior?.resolvedStatus==='done')&&e.plannedType==='quality')e.plannedType='easy';
  if(recentHard&&e.plannedType==='long')e.plannedType='easy';
 });
 const taper=days!=null&&days>=0&&days<=7?.5:days>7&&days<=14?.75:1;
 entries.budget=Math.round(v.budget*taper);entries.volume=v;
 const historic=recentRuns(runs,addDays(mondayOf(ref),-1),28);
 const validLoads=historic.filter(r=>r.durationMinutes>0&&r.rpe>0);
 const srpeBudget=v.observed>=3&&validLoads.length>=historic.length*.8?validLoads.reduce((x,r)=>x+sessionRpeLoad(r),0)/4*1.1*taper:null;
 // All remaining sessions share one fixed weekly time budget; completing one does
 // not allocate that session's full original budget a second time.
 const spent=entries.reduce((sum,e)=>sum+e.dayRuns.reduce((x,r)=>x+runMinutes(r),0)+(e.resolvedStatus==='done'&&!e.dayRuns.length?({quality:50,long:80,easy:40,recovery:25,optional:20}[e.resolvedType]||0):0),0);
 const weights={recovery:.5,easy:1,quality:1.1,long:1.8,optional:.4};
 const remaining=entries.filter(e=>e.index>=entries.todayIndex&&!e.resolvedStatus&&weights[e.plannedType]);
 const total=remaining.reduce((x,e)=>x+weights[e.plannedType],0);
 remaining.forEach(e=>{e.minutes=Math.floor(Math.max(0,entries.budget-spent)*weights[e.plannedType]/(total||1));e.minutes=Math.min(e.minutes,{recovery:30,easy:65,quality:65,long:125,optional:25}[e.plannedType]);});
 const spentLoad=entries.reduce((x,e)=>x+e.dayRuns.reduce((y,r)=>y+sessionRpeLoad(r),0),0);
 const estimateRpe={recovery:2,easy:3,quality:5,long:4,optional:2};
 const planned=remaining.reduce((x,e)=>x+e.minutes*estimateRpe[e.plannedType],0);
 if(srpeBudget!=null&&planned>0){const scale=Math.min(1,Math.max(0,srpeBudget-spentLoad)/planned);remaining.forEach(e=>e.minutes=Math.floor(e.minutes*scale));}
 entries.projectedLoad=Math.round(spentLoad+remaining.reduce((x,e)=>x+e.minutes*estimateRpe[e.plannedType],0));
 return entries;
}
function selectedWeather(ref,s){const target=`${dateKey(ref)}T${pad(+s.trainingHour)}:00`;const h=weatherHourly.find(x=>x.time===target);return h?{...h,temperature:h.temperature,description:weatherDesc(h.code),scheduled:true}:null}
function coachPlan(date,race,w,wellness,load,trend,type,runs,s,history,week){
 const p={trainingType:'rest',title:'휴식',distance:'러닝 0 km',pace:'—',heartRate:'—',rpe:'1–2/10',warmup:'—',cooldown:'—',note:'편하게 회복하세요.',adjustment:'주간 수행량과 회복을 반영했어요.'};
 const days=race.enabled?diffDaysSigned(date,localDate(race.date)):null, f=fitnessState(runs,s,date), zones=paceSet(f), v=week.volume;
 const today=week[week.todayIndex];
 const recent=recentRuns(runs,date,3), red=wellness.pain>=4||wellness.painResponse==='red'||recent.some(r=>r.walkingPain||r.focalPain);
 if(red)return {...p,title:'러닝 중단 · 통증 확인',note:'보행 통증·절뚝거림·뼈의 점 압통 또는 심한 통증이 있으면 달리지 말고 의료진 평가를 받으세요.',adjustment:'통증 안전 신호를 가장 먼저 반영했어요.'};
 if(w&&(w.code>=95||w.precipitation>=10||w.wind>=50||w.apparent>=35||w.temperature>=35))return {...p,title:'야외 러닝 보류',note:'예정 시간의 뇌우·폭우·강풍·심한 더위를 확인하고 실내 운동 또는 휴식을 선택하세요.',adjustment:`${s.trainingHour}시 예보를 반영한 보수적 야외 제한이에요.`};
 if(wellness.pain>=3||wellness.painResponse==='worse'||recent.some(r=>r.worseningPain||r.nextDay==='poor'))return {...p,title:'통증 회복',note:'오늘 러닝은 쉬고 보행과 다음 날 통증 변화를 확인하세요. 지속·악화되면 평가가 필요해요.'};
 if(today.resolvedStatus)return {...p,title:today.resolvedStatus==='done'?'오늘 훈련 완료':'오늘 훈련 미실시',note:'오늘 추가 훈련은 처방하지 않아요. 남은 주간 일정에 반영했어요.'};
 if(days<0&&days>=-7)return {...p,title:'대회 후 회복',note:'대회 후 첫 주는 회복을 우선하고 통증과 일상 보행을 확인하세요.'};
 if(type==='rest')return {...p,title:days===1?'대회 전날 휴식':'휴식'};
 const missing=['fatigue','soreness','pain','sleepQuality'].some(k=>wellness[k]==null);
 const crossLoad=runs.some(r=>['등산','근력'].includes(r.type)&&diffDaysSigned(localDate(r.date),date)>=0&&diffDaysSigned(localDate(r.date),date)<=1&&r.rpe>=7);
 const poor=crossLoad||wellness.fatigue>=7||wellness.soreness>=7||wellness.sleepQuality!=null&&wellness.sleepQuality<=2;
 if(days===0){if(missing||poor)return {...p,title:'대회 출발 전 상태 확인',note:'오늘 컨디션을 모두 입력하고 출발 여부를 판단하세요. 피로·수면 상태가 나쁘면 기록 목표를 낮추세요.'};return {...p,title:'대회 당일',trainingType:'race',distance:`${race.distance} km`,pace:race.targetMinutes>0?`목표 ${paceFromMinutes(race.distance,race.targetMinutes)} · 초반 여유`:'체감강도 기준',rpe:'초반 통제',warmup:'가벼운 조깅·관절 움직임',cooldown:'걷기·수분·식사',note:'목표 기록은 보장값이 아니에요. 준비한 보급을 사용하고 후반 상태로 조절하세요.',adjustment:'대회일을 별도 일정으로 반영했어요.'}}
 let minutes=today.minutes||0;
 if(type==='optional'&&load.yesterdayRunKm>=8)return p;
 if(load.yesterdayWasLongRun)return {...p,title:'롱런 후 회복'};
 const warm=w&&(w.temperature>=27||w.apparent>=28||(w.temperature>=24&&w.humidity>=85));
 if(missing||poor||wellness.pain>0){type='recovery';minutes=Math.min(minutes,25)}
 if(warm){minutes*=.8;if(type==='quality')type='easy'}
 if(load.hardRunWithin48h&&type==='quality')type='easy';
 if(minutes<15)return {...p,title:'이번 주 회복',adjustment:'남은 주간 운동시간이 적어 추가 훈련을 줄였어요.'};
 const easySec=zones?(zones.easyFast+zones.easySlow)/2:370;
 p.trainingType=type==='quality'&&(!zones||minutes<35)?'easy':type;
 p.heartRate=`${Math.round(s.thresholdHr*.82)}–${Math.round(s.thresholdHr*.90)} bpm · 호흡 우선`;
 p.pace=zones?`${formatPace(zones.easyFast)} ~ ${formatPace(zones.easySlow)}`:'편한 대화 가능 · 페이스 강제 없음';
 p.rpe='2–4/10';p.warmup='처음 5–10분 천천히 (총 시간 포함)';p.cooldown='마지막 5분 천천히 (총 시간 포함)';
 p.adjustment=`${f.value?`현재 VDOT ${f.value.toFixed(1)} · `:''}최근 수행량으로 이번 주 ${week.budget}분 안에서 배분했어요.`;
 if(type==='long'){
  const previous=v.longest, cap=previous?+previous.distanceKm*(v.bad||v.gap>=14? .85:previous.nextDay==='good'&&previous.rpe<=6?1.08:1):6;
  minutes=Math.min(minutes,cap*easySec/60,v.gap>=14?50:125);
  p.title='이지 롱런';p.note='최근 30일 최장거리와 회복을 기준으로 상한을 정했어요. 20분 전후마다 수분을 확인하고 90분 이상 예정이면 초반부터 탄수화물 보급을 분산하세요. 90분 이상 러닝은 시간당 30–60g 범위에서 익숙한 양을 사용하고 수분은 갈증과 발한량에 맞추세요.';
  p.distance=`총 ${Math.floor(minutes)}분 · 최대 ${Math.floor(Math.min(cap,minutes*60/easySec)*10)/10} km`;
 }else if(type==='quality'&&zones&&minutes>=35){
  const recentQuality=recentRuns(runs,date,28).filter(isQuality).sort((a,b)=>b.date.localeCompare(a.date));
  const progressed=recentQuality.length>=2&&recentQuality.slice(0,2).every(r=>r.completion==='comfortable'&&r.nextDay==='good'&&r.rpe<=7&&r.workMinutes>0);
  const work=Math.min(days!=null&&days<=7?10:days>7&&days<=14?15:progressed?25:18,minutes-20);
  const target=race.targetMinutes>0?race.targetMinutes*60/race.distance:null;
  const specific=days>7&&days<=35&&race.distance>=15&&race.distance<=25;
  const sec=specific?Math.max(target||0,zones.threshold+10):zones.threshold;
  p.title=specific?'하프 페이스 적응':'역치 반복';p.pace=`본운동 ${formatPace(sec)} 전후 · RPE 6–7`;
  p.distance=`총 ${Math.floor(minutes)}분`;p.warmup='10분 이지 (총 시간 포함)';p.cooldown='남은 시간 이지 · 최소 8분';p.heartRate=`${Math.round(s.thresholdHr*.92)}–${s.thresholdHr} bpm 참고 · 억지로 올리지 않기`;p.rpe='본운동 6–7/10';
  p.note=`${Math.floor(work/2)}분 × 2회 · 사이 2분 조깅. ${progressed?'최근 2회 수행·회복을 확인했어요.':'반복 수행과 다음 날 회복을 확인한 뒤 본운동 시간을 늘려요.'}`;
 }else{p.title=type==='recovery'?'가벼운 회복':'이지런';p.distance=`총 ${Math.floor(minutes)}분 · 약 ${(minutes*60/easySec).toFixed(1)} km`;p.note='시간을 우선하고 대화 가능한 강도로 달리세요. 힘들면 늦추거나 걷기를 섞어도 좋아요.';}
 if(warm){p.pace='더위 반영 · 페이스보다 대화·RPE 우선';p.adjustment+=' 더위로 시간과 강도를 낮췄어요.'}
 if(!w)p.adjustment+=' 예정 시간 날씨 미확인 · 출발 전 확인하세요.';
 if(w&&w.precipitation>0&&w.precipitation<10)p.note+=' 비가 오면 미끄러운 노면을 피하세요.';
 if(missing)p.adjustment+=' 오늘 상태 미입력 항목이 있어 임시 회복안이에요.';
 if(poor)p.adjustment+=' 피로·근육통·수면을 반영했어요.';
 return p;
}
function renderFitness(f,week,s){
 $('fitnessSummary').textContent=f.value?`현재 VDOT ${f.value.toFixed(1)} · ${f.source}`:f.source;
 const z=paceSet(f);$('fitnessPaces').textContent=z?`이지 ${formatPace(z.easyFast)} ~ ${formatPace(z.easySlow)} · 역치 약 ${formatPace(z.threshold)} · 인터벌 약 ${formatPace(z.interval)} (페이스 참고값)`:'대회 목표 기록은 현재 능력으로 사용하지 않아요. 검증 기록을 추가하면 페이스가 갱신돼요.';
 ['manualVdot','manualVdotDate','thresholdHr','trainingHour'].forEach(id=>$(id).value=s[id]??'');
 $('weekBudget').textContent=`이번 주 훈련 상한 ${week.budget}분 (대회 제외) · 예상 내부부하 ${week.projectedLoad} AU. 기록 ${week.volume.observed}/4주 · ${week.volume.progression?'안정적 수행에 따라 소폭 증가':'수행량·회복 확인 중'}. 10 km·풀 대회는 전용 특이훈련을 지원하지 않아 일반 훈련과 테이퍼만 적용해요.`;
 $('todayPainResponse').value=getWellness().painResponse||'unknown';
}
function initCoachUI(){
 Object.assign(TYPE_LABELS,{race:'대회'});
 $('saveCoachSettings').onclick=()=>{const s=loadSettings();const n=Number($('manualVdot').value),hr=Number($('thresholdHr').value),hour=Number($('trainingHour').value),d=$('manualVdotDate').value;
 if(($('manualVdot').value&&(n<20||n>85||!d||localDate(d)>startOfDay(new Date())))||hr<100||hr>220||!Number.isInteger(hour)||hour<0||hour>23){alert('VDOT 20~85와 기준 날짜, 역치 심박 100~220, 운동 시각 0~23시를 확인해줘.');return}
 saveSettings({...s,manualVdot:n||null,manualVdotDate:d,thresholdHr:hr,trainingHour:hour});render();};
 $('todayPainResponse').onchange=()=>{setWellness(dateKey(new Date()),{...getWellness(),painResponse:$('todayPainResponse').value});render()};
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){render();fetchWeather()}});
}
