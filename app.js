/* ============================================
   Saginaw Bay Fishing Hub v5
   Trip-planner map
   
   Value function: A fisherman opens this at 5am asking
   "Should I go? Where should I launch? What should I target?"
   The map answers all three at a glance.
   ============================================ */

const SUMMARY_EP="/api/daily-summary",SENSORS_EP="/api/sensors",REPORTS_EP="/api/reports";
const TZ="America/Detroit",SNAP_PREFIX="saginaw:daily-snapshot",API_VER="2026-03-31-rich-zones-v2";
const state={loading:false,error:null,data:null,dataSource:null,sensors:null,reports:null,
  favorites:loadStored("saginaw:favorites",{zones:[],launches:[],species:"walleye"})};
let map=null,chartLayer=null,structureGroup=null;
const layers={sensors:[],launches:[],reports:[]};
const $=id=>document.getElementById(id);
const ui={badge:$("bay-call-badge"),updated:$("updated-at"),best:$("hero-best"),avoid:$("hero-avoid"),
  conf:$("hero-confidence"),rationale:$("hero-rationale"),captainNote:$("captain-note"),
  condGrid:$("conditions-grid"),zonesGrid:$("zones-grid"),launches:$("launches-list"),reportsList:$("reports-list")};

document.addEventListener("click",e=>{
  const sp=e.target.closest("[data-species]");
  if(sp){state.favorites.species=sp.dataset.species;saveStored("saginaw:favorites",state.favorites);updateSpeciesUI();fetchSummary();return}
  if(e.target.closest("[data-action='generate-ai-note']")){fetchSummary(true);return}
  const f=e.target.closest("[data-fav-kind]");if(f){toggleFav(f.dataset.favKind,f.dataset.favId);return}
  if(e.target.closest("#toggle-chart")){toggleChart();return}
  if(e.target.closest("#dismiss-plan")){$("trip-plan")?.classList.add("collapsed");return}
});

/* ================================================================
   VERIFIED DATA (see RESEARCH.md)
   ================================================================ */
const LAUNCHES=[
  {id:"linwood",name:"Linwood Beach",lat:43.7354,lng:-83.9489,zone:"west-side"},
  {id:"coggins",name:"Coggins Rd DNR",lat:43.8030,lng:-83.9264,zone:"west-side"},
  {id:"gambills",name:"Gambill's Landing",lat:43.8094,lng:-83.9244,zone:"west-side"},
  {id:"pinconning",name:"Pinconning Park",lat:43.8499,lng:-83.9219,zone:"west-side"},
  {id:"au-gres-dnr",name:"Au Gres DNR",lat:44.0268,lng:-83.6792,zone:"west-side"},
  {id:"pointe-au-gres",name:"Pt Au Gres Marina",lat:44.0167,lng:-83.6879,zone:"west-side"},
  {id:"sebewaing",name:"Sebewaing Harbor",lat:43.7503,lng:-83.5175,zone:"east-side"},
  {id:"quanicassee",name:"Quanicassee DNR",lat:43.5847,lng:-83.6809,zone:"east-side"},
  {id:"bay-city-sp",name:"Bay City State Park",lat:43.6713,lng:-83.9106,zone:"river-mouth"},
  {id:"sag-river-mouth",name:"Sag River Mouth",lat:43.6405,lng:-83.8506,zone:"river-mouth"},
  {id:"smith-park",name:"Smith Park",lat:43.6160,lng:-83.8455,zone:"inner-bay"},
  {id:"finn-road",name:"Finn Road",lat:43.6293,lng:-83.7795,zone:"inner-bay"},
];

const STRUCTURE=[
  {name:"Spoils Island",lat:43.6679,lng:-83.8026,t:"island",d:"6-17 ft",info:"Post-spawn walleye staging. Perch E & W sides 14-17 ft."},
  {name:"Channel Island Reef",lat:43.668,lng:-83.803,t:"reef",d:"12-16 ft",info:"New 2025 spawning reef. Limestone cobble. Walleye, whitefish."},
  {name:"Callahan Reef",lat:43.66,lng:-83.72,t:"reef",d:"10-16 ft",info:"Sandbar E of channel. Walleye late spring. Crawler harnesses."},
  {name:"Black Hole",lat:43.76,lng:-83.88,t:"deep",d:"22-28 ft",info:"Summer walleye when temps hit 70+. Perch in ice season."},
  {name:"Spark Plug",lat:43.72,lng:-83.78,t:"buoy",d:"22-26 ft",info:"Buoys 11-12. THE reference point. 'East of the Spark Plug' = most common report."},
  {name:"The Slot",lat:43.74,lng:-83.49,t:"channel",d:"13-20 ft",info:"East side corridor. Caseville to Sebewaing. Major trolling lane."},
  {name:"Pinconning Bar",lat:43.82,lng:-83.90,t:"bar",d:"10-18 ft",info:"Weedline pockets. Walleye year-round. Inside turns."},
  {name:"Buoys 1 & 2",lat:43.78,lng:-83.72,t:"buoy",d:"25-35 ft",info:"Deep channel markers. Key walleye spot. Flicker Shads."},
  {name:"Saganing Bar",lat:43.78,lng:-83.86,t:"bar",d:"10-15 ft",info:"Perch along edges. Au Gres boats fish here heading south."},
  {name:"The Cigar",lat:43.73,lng:-83.90,t:"area",d:"18-23 ft",info:"Off Linwood. Ice fishing + open water. Near sailboat buoys."},
  {name:"Old Channel",lat:43.65,lng:-83.81,t:"channel",d:"14-16 ft",info:"Historic channel. Perch 14-16 ft. Walleye on edges."},
  {name:"Big Charity Island",lat:44.0255,lng:-83.4347,t:"island",d:"varies",info:"Lighthouse island. Fish reefs between Big & Little. 10mi offshore."},
  {name:"Gravelly Shoal",lat:43.985,lng:-83.575,t:"shoal",d:"5-18 ft",info:"3mi SE from Pt Lookout. Walleye May-June on edges."},
  {name:"Steeples",lat:44.02,lng:-83.40,t:"reef",d:"14-19 ft",info:"Rock outcroppings E of Charity. Can snag gear."},
  {name:"Sand Point",lat:43.745,lng:-83.475,t:"point",d:"varies",info:"Thumb promontory. Slot runs north. Walleye near water tower."},
  {name:"Oak Point",lat:43.84,lng:-83.40,t:"point",d:"25-35 ft",info:"Caseville to Port Austin. Deeper walleye."},
  {name:"Flat Rock Reefs",lat:43.98,lng:-83.38,t:"reef",d:"35-45 ft",info:"Off Port Austin. Crawler harnesses in deep water."},
];

/* ================================================================
   MAP
   ================================================================ */
function initMap(){
  map=L.map("bay-map",{center:[43.74,-83.72],zoom:10,scrollWheelZoom:true,zoomControl:false,
    minZoom:8,maxZoom:15,attributionControl:false});
  L.control.zoom({position:"bottomright"}).addTo(map);
  L.control.attribution({position:"bottomright",prefix:false}).addTo(map);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",{
    attribution:'&copy; <a href="https://osm.org/copyright">OSM</a> &copy; <a href="https://carto.com">CARTO</a>',
    maxZoom:15,subdomains:"abcd"}).addTo(map);

  chartLayer=L.tileLayer("https://tileservice.charts.noaa.gov/tiles/50000_1/{z}/{x}/{y}.png",{
    attribution:'NOAA',opacity:0.55,maxZoom:15});

  // Structure layer: visible at zoom 11+
  structureGroup=L.layerGroup();
  addStructure();
  map.on("zoomend",()=>{
    if(map.getZoom()>=11&&!map.hasLayer(structureGroup))map.addLayer(structureGroup);
    if(map.getZoom()<11&&map.hasLayer(structureGroup))map.removeLayer(structureGroup);
  });

  addLaunches();
}

function toggleChart(){
  const btn=$("toggle-chart");
  if(map.hasLayer(chartLayer)){map.removeLayer(chartLayer);btn?.classList.remove("active")}
  else{chartLayer.addTo(map);btn?.classList.add("active")}
}

/* ---- Structure (subtle, zoom 11+) ---- */
function addStructure(){
  const colors={island:"#2a6b4f",reef:"#9a7b3c",shoal:"#9a7b3c",deep:"#2c4a6e",
    buoy:"#8b4040",bar:"#6b5b3c",channel:"#3d7a9c",area:"#5a6b78",point:"#4a6858"};
  for(const s of STRUCTURE){
    const c=colors[s.t]||"#5a6b78";
    const icon=L.divIcon({className:"mk",
      html:`<div class="mk-spot" style="--c:${c}"><span class="mk-dot"></span><span class="mk-label">${esc(s.name)}</span></div>`,
      iconSize:[120,16],iconAnchor:[8,8]});
    const m=L.marker([s.lat,s.lng],{icon});
    m.bindPopup(`<div class="pop"><h4>${esc(s.name)}</h4><p class="pop-depth">${esc(s.d)}</p><p>${esc(s.info)}</p></div>`,{maxWidth:280});
    structureGroup.addLayer(m);
  }
}

/* ---- Launches (always visible, colored by score) ---- */
function addLaunches(){
  for(const l of LAUNCHES){
    const icon=L.divIcon({className:"mk",
      html:`<div class="mk-launch" id="launch-${l.id}"><span class="mk-anchor">\u2693</span><span class="mk-lname">${esc(l.name)}</span></div>`,
      iconSize:[140,22],iconAnchor:[11,11]});
    const m=L.marker([l.lat,l.lng],{icon});
    m.bindPopup(()=>buildLaunchPopup(l),{maxWidth:300});
    m.addTo(map);
    layers.launches.push({marker:m,data:l});
  }
}

function colorLaunches(){
  if(!state.data?.launches)return;
  const scores={};
  for(const l of state.data.launches)scores[l.id]=l;
  for(const{marker,data}of layers.launches){
    const scored=scores[data.id];
    const el=document.getElementById(`launch-${data.id}`);
    if(!el)continue;
    if(scored){
      const c=scored.score>=60?"go":scored.score>=40?"caut":"nogo";
      el.className=`mk-launch mk-${c}`;
      el.title=`Score ${scored.score}: ${scored.advice}`;
    }
  }
}

function buildLaunchPopup(l){
  const scored=(state.data?.launches||[]).find(x=>x.id===l.id)||{};
  const sc=scored.score;
  const cls=sc>=60?"pop-go":sc>=40?"pop-caut":"pop-nogo";
  let h=`<div class="pop"><h4>${esc(l.name)}</h4>`;
  if(sc!=null)h+=`<div class="pop-score ${cls}">Score ${sc} &mdash; ${esc(scored.advice||"")}</div>`;
  if(scored.zoneName)h+=`<p><strong>Zone:</strong> ${esc(scored.zoneName)}</p>`;
  if(scored.exposureSummary)h+=`<p>${esc(scored.exposureSummary)}</p>`;
  if(scored.notes)h+=`<p class="pop-notes">${esc(scored.notes)}</p>`;
  return h+"</div>";
}

/* ---- Sensors on map ---- */
function renderSensors(data){
  layers.sensors.forEach(l=>map.removeLayer(l));layers.sensors=[];
  if(!data?.stations||!data?.readings)return;
  for(const station of data.stations){
    const r=data.readings[station.id]||{};
    if(r.error||station.type==="stream-gauge")continue;
    let lines=[];
    if(r.windMph!=null){
      const wc=r.windMph<=10?"#2d8659":r.windMph<=18?"#c68b2c":"#b84040";
      lines.push(`<span class="sd-wind" style="color:${wc}">${Math.round(r.windMph)} mph ${r.windDir||""}</span>`);
    }
    if(r.waterTempF!=null)lines.push(`<span class="sd-val">${Math.round(r.waterTempF)}\u00B0 water</span>`);
    if(r.airTempF!=null)lines.push(`<span class="sd-val">${Math.round(r.airTempF)}\u00B0 air</span>`);
    if(r.waterLevelFtIGLD!=null){
      const arr=r.trendLabel==="Rising"?"\u2191":r.trendLabel==="Falling"?"\u2193":"\u2192";
      lines.push(`<span class="sd-val">${r.waterLevelFtIGLD}ft ${arr}</span>`);
    }
    if(!lines.length)continue;
    const html=`<div class="mk-sensor"><div class="sd-name">${esc(station.name)}</div>${lines.join("")}</div>`;
    const icon=L.divIcon({className:"mk",html,iconSize:[160,46],iconAnchor:[80,23]});
    const m=L.marker([station.lat,station.lng],{icon}).addTo(map);
    m.bindPopup(buildSensorPopup(station,r),{maxWidth:280});
    layers.sensors.push(m);
  }
  renderTripPlan(data);
}

function buildSensorPopup(st,r){
  let h=`<div class="pop"><h4>${esc(st.name)}</h4><small>${esc(st.source)}</small><table class="pop-t">`;
  if(r.windMph!=null)h+=`<tr><td>Wind</td><td><strong>${r.windMph} mph ${r.windDir||""}</strong>${r.gustMph?` (G${r.gustMph})`:""}</td></tr>`;
  if(r.waveFt!=null)h+=`<tr><td>Waves</td><td>${r.waveFt} ft</td></tr>`;
  if(r.airTempF!=null)h+=`<tr><td>Air</td><td>${Math.round(r.airTempF)}\u00B0F</td></tr>`;
  if(r.waterTempF!=null)h+=`<tr><td>Water</td><td><strong>${Math.round(r.waterTempF)}\u00B0F</strong></td></tr>`;
  if(r.waterLevelFtIGLD!=null)h+=`<tr><td>Level</td><td>${r.waterLevelFtIGLD} ft IGLD (${r.trendLabel||""})</td></tr>`;
  if(r.pressureMb!=null)h+=`<tr><td>Pressure</td><td>${r.pressureMb} mb</td></tr>`;
  h+="</table>";if(r.observedAt)h+=`<small>Obs ${relTime(r.observedAt)}</small>`;
  return h+"</div>";
}

/* ---- Trip Plan card (the value) ---- */
function renderTripPlan(sensorData){
  const el=$("trip-plan");if(!el)return;
  const d=state.data;
  const rd=sensorData?.readings||{};
  const sblm4=rd["ndbc-sblm4"]||{};
  const river=rd["usgs-04157005"]||{};
  const level=rd["noaa-9075035"]||{};
  const mf=sensorData?.marineForecast?.innerBay||{};
  const bc=d?.bayCall||{};
  const callCls=bc.goNoGo==="GO"?"tp-go":bc.goNoGo==="CAUTION"?"tp-caut":"tp-nogo";
  const bestLaunch=(d?.launches||[])[0];
  const topZone=(d?.zones||[])[0];

  let h=`<span class="tp-call ${callCls}">${esc(bc.label||"Loading...")}</span>`;
  if(mf.advisory)h+=`<span class="tp-alert">${esc(mf.advisory.slice(0,60))}</span>`;

  h+=`<span class="tp-grid">`;
  if(sblm4.windMph!=null)h+=`<span class="tp-stat"><span class="tp-k">Wind</span><span class="tp-v">${Math.round(sblm4.windMph)} mph ${sblm4.windDir||""}</span></span>`;
  if(river.waterTempF!=null)h+=`<span class="tp-stat"><span class="tp-k">River</span><span class="tp-v">${Math.round(river.waterTempF)}\u00B0 ${river.flowCfs?river.flowCfs.toLocaleString()+"cfs":""}</span></span>`;
  if(level.waterLevelFtIGLD!=null)h+=`<span class="tp-stat"><span class="tp-k">Level</span><span class="tp-v">${level.waterLevelFtIGLD}ft ${level.trendLabel||""}</span></span>`;
  const c=d?.conditions||{};
  if(c.smallBoatWindowHours!=null)h+=`<span class="tp-stat"><span class="tp-k">Window</span><span class="tp-v">${c.smallBoatWindowHours}hrs</span></span>`;
  h+=`</span>`;

  if(bestLaunch&&bestLaunch.score>0)h+=`<span class="tp-rec"><strong>Launch:</strong> ${esc(bestLaunch.name)} (${bestLaunch.score})</span>`;
  if(topZone&&topZone.tripScore>0)h+=`<span class="tp-rec"><strong>Zone:</strong> ${esc(topZone.name)} (${topZone.tripScore})</span>`;
  if(topZone?.action?.technique)h+=`<span class="tp-tactic">${esc(topZone.action.technique)}</span>`;
  if(sensorData?.satellite?.imageUrl)h+=`<a href="${esc(sensorData.satellite.imageUrl)}" target="_blank" class="tp-link">SST Map</a>`;

  el.innerHTML=h;
  el.classList.remove("collapsed");
}

/* ---- Report hotspots ---- */
function renderReportsOnMap(){
  layers.reports.forEach(l=>map.removeLayer(l));layers.reports=[];
  if(!state.reports?.reports?.length)return;
  const ZC={"west-side":[43.80,-83.91],"east-side":[43.71,-83.51],"inner-bay":[43.65,-83.82],
    "outer-bay":[43.96,-83.55],"river-mouth":[43.61,-83.86],"shipping-channel":[43.66,-83.80],
    "reefs":[43.82,-83.58],"bay-wide":[43.73,-83.75]};
  const byZ={};
  for(const r of state.reports.reports){const z=r.primaryZone||"bay-wide";if(!byZ[z])byZ[z]=[];byZ[z].push(r);}
  for(const[zone,rpts]of Object.entries(byZ)){
    const ctr=ZC[zone];if(!ctr)continue;
    const avg=rpts.reduce((s,r)=>s+(r.signal||0),0)/rpts.length;
    const c=avg>=0.3?"#2d8659":avg<=-0.15?"#b84040":"#c68b2c";
    const icon=L.divIcon({className:"mk",
      html:`<div class="mk-rpt" style="--c:${c}"><span class="mk-rc">${rpts.length}</span><span class="mk-rl">${sigWord(avg)}</span></div>`,
      iconSize:[65,20],iconAnchor:[32,10]});
    const m=L.marker(ctr,{icon}).addTo(map);
    const pop=rpts.slice(0,3).map(r=>`<div class="pop-rpt"><p>${esc((r.summary||"").slice(0,100))}</p></div>`).join("");
    m.bindPopup(`<div class="pop"><h4>${esc(zoneLabel(zone))}</h4>${pop}</div>`,{maxWidth:300});
    layers.reports.push(m);
  }
}

/* ================================================================
   DATA
   ================================================================ */
function init(){initMap();updateSpeciesUI();fetchSummary();fetchSensors();fetchReports();}

async function fetchSummary(ai=false){
  const sp=state.favorites.species||"walleye",day=getDateKey(),key=`${SNAP_PREFIX}:${sp}:${day}`;
  const c=loadStored(key,null);
  if(c?.snapshotDate===day&&c?.apiVersion===API_VER&&(!ai||c.captainNote?.text)){
    state.data=c;state.dataSource="local";state.error=null;state.loading=false;renderDash();colorLaunches();return}
  state.loading=true;renderLoading();
  try{const p=new URLSearchParams({species:sp,day});if(ai)p.set("includeAi","1");
    const r=await fetch(`${SUMMARY_EP}?${p}`,{headers:{Accept:"application/json"}});
    if(!r.ok)throw new Error(`API ${r.status}`);const d=await r.json();d.snapshotDate=d.snapshotDate||day;
    state.data=d;state.dataSource="network";state.loading=false;state.error=null;saveStored(key,d);
    renderDash();colorLaunches();
  }catch(e){state.error=e.message;state.loading=false;renderError();}
}
async function fetchSensors(){try{const r=await fetch(SENSORS_EP);if(!r.ok)throw new Error(`${r.status}`);
  state.sensors=await r.json();renderSensors(state.sensors);if(state.data)renderConditions();}catch(e){console.warn("S:",e.message);}}
async function fetchReports(){try{const r=await fetch(REPORTS_EP);if(!r.ok)throw new Error(`${r.status}`);
  state.reports=await r.json();renderReportsFeed();renderReportsOnMap();}catch(e){console.warn("R:",e.message);}}

/* ================================================================
   DASHBOARD (below map)
   ================================================================ */
function renderDash(){renderBayCall();renderConditions();renderZones();renderLaunchCards();renderCaptainNote();}
function renderLoading(){ui.badge.className="bay-call-badge loading";ui.badge.querySelector(".call-label").textContent="Loading...";ui.updated.textContent="Fetching...";}
function renderError(){ui.badge.className="bay-call-badge nogo";ui.badge.querySelector(".call-label").textContent="Error";ui.updated.textContent=state.error||"Failed";}

function renderBayCall(){
  const d=state.data;if(!d)return;const bc=d.bayCall||{};
  ui.badge.className=`bay-call-badge ${bc.goNoGo==="GO"?"go":bc.goNoGo==="CAUTION"?"caution":"nogo"}`;
  ui.badge.querySelector(".call-label").textContent=bc.label||"Pending";
  ui.updated.textContent=`${d.snapshotDate||getDateKey()} | ${relTime(d.generatedAt)}`;
  ui.best.textContent=d.bestSetup?.name||"--";ui.avoid.textContent=d.avoidOrCaution||"--";
  ui.conf.textContent=`${cap(bc.confidenceLabel||"unknown")} (${bc.confidenceScore??"--"})`;
  const reasons=(bc.rationale||[]).slice(0,5);
  ui.rationale.innerHTML=reasons.length?`<ul>${reasons.map(r=>`<li>${esc(r)}</li>`).join("")}</ul>`:'<p class="muted">No rationale.</p>';
}

function renderConditions(){
  const c=state.data?.conditions;if(!c)return;
  const s=state.sensors?.readings||{};const riv=s["usgs-04157005"];const titt=s["usgs-04156000"];
  const fields=[
    {l:"Wind",v:c.windMph!=null?`${Math.round(c.windMph)} mph ${c.windDirectionCardinal||""}`:"--"},
    {l:"Waves",v:c.waveFt!=null?`${fix(c.waveFt,1)} ft`:"--"},
    {l:"Air",v:c.airTempF!=null?`${Math.round(c.airTempF)}\u00B0F`:"--"},
    {l:"Water",v:c.waterTempF!=null?`${Math.round(c.waterTempF)}\u00B0F`:"--"},
    {l:"Boat Window",v:c.smallBoatWindowHours!=null?`${c.smallBoatWindowHours} hrs (${c.smallBoatWindowLabel||""})`:"--"},
    {l:"Level",v:c.waterLevelFtIGLD!=null?`${fix(c.waterLevelFtIGLD,2)} ft IGLD`:"--"},
    {l:"Sag River",v:riv?.flowCfs?`${riv.flowCfs.toLocaleString()} cfs / ${Math.round(riv.waterTempF||0)}\u00B0F`:"--"},
    {l:"Tittabawassee",v:titt?.flowCfs?`${titt.flowCfs.toLocaleString()} cfs`:"--"},
    {l:"Advisories",v:c.alertHeadline||"None"},
  ];
  ui.condGrid.innerHTML=fields.map(f=>`<div class="cond-box"><span class="cond-label">${esc(f.l)}</span><p class="cond-value">${esc(f.v)}</p></div>`).join("");
}

function renderZones(){
  const zones=state.data?.zones;if(!zones?.length)return;
  ui.zonesGrid.innerHTML=zones.map(z=>{
    const tone=z.tripScore>=72?"strong":z.tripScore>=56?"moderate":"weak";const a=z.action||{};
    return `<article class="zone-card"><div class="zone-head"><div><h3>${esc(z.name)}</h3><span class="zone-rec">${esc(z.recommendation||"")}</span></div><span class="score-badge ${tone}">${z.tripScore}</span></div><div class="zone-stats"><div class="zone-stat"><span class="stat-label">Safety</span><span class="stat-val">${z.safety}</span></div><div class="zone-stat"><span class="stat-label">Fish</span><span class="stat-val">${z.fishability}</span></div><div class="zone-stat"><span class="stat-label">Signal</span><span class="stat-val">${z.recentSignal}</span></div><div class="zone-stat"><span class="stat-label">Conf</span><span class="stat-val">${z.confidence}</span></div></div><div class="zone-action"><p><strong>Launch:</strong> ${esc(a.bestLaunchName||"N/A")}</p><p><strong>Window:</strong> ${esc(a.windowPlan||"")}</p><p><strong>Tactic:</strong> ${esc(a.technique||"")}</p></div></article>`;
  }).join("");
}

function renderLaunchCards(){
  const ls=state.data?.launches;if(!ls?.length)return;
  ui.launches.innerHTML=ls.slice(0,7).map(l=>{
    const tone=l.score>=60?"strong":l.score>=40?"moderate":"weak";
    return `<article class="launch-card"><div class="launch-head"><div><h3>${esc(l.name)}</h3><span class="launch-meta">${esc(l.zoneName)} | ${esc(l.advice)}</span></div><span class="score-badge ${tone}">${l.score}</span></div><p class="launch-notes">${esc(l.exposureSummary)} ${esc(l.notes||"")}</p></article>`;
  }).join("");
}

function renderReportsFeed(){
  const rp=state.reports;if(!rp)return;const reports=rp.reports||[];const sources=rp.sources||[];
  const ok=sources.filter(s=>s.status==="ok").length;
  let h=`<p class="muted">${rp.totalReports} reports from ${ok}/${sources.length} sources</p><div class="source-badges">`;
  for(const src of sources){const c=src.status==="ok"?"src-ok":src.status==="error"?"src-err":"src-warn";
    h+=`<span class="src-badge ${c}">${esc(src.sourceName||src.source)} (${src.reportCount})</span>`;}
  h+='</div>';
  if(reports.length){h+=reports.slice(0,8).map(r=>{const sc=r.signal>=0.3?"sig-pos":r.signal<=-0.15?"sig-neg":"sig-mix";
    return `<article class="report-card"><div class="report-head"><h3>${esc(r.primaryZone?zoneLabel(r.primaryZone):"Bay-wide")}</h3><span class="report-meta ${sc}">${sigWord(r.signal)}</span></div><p class="report-summary">${esc(r.summary||"")}</p><div class="report-tags">${(r.species||[]).map(s=>`<span class="tag">${cap(s)}</span>`).join("")}${r.depth?`<span class="tag">${r.depth.min}-${r.depth.max}ft</span>`:""}${(r.lure||[]).map(l=>`<span class="tag">${esc(l)}</span>`).join("")}</div><span class="report-meta">${esc(r.sourceName||r.source)}</span></article>`;
  }).join("");}else{h+='<p class="muted">No reports. Sources may be offline or out of season.</p>';}
  ui.reportsList.innerHTML=h;
}

function renderCaptainNote(){if(state.data?.captainNote?.text&&ui.captainNote){ui.captainNote.textContent=state.data.captainNote.text;ui.captainNote.className="";}}

/* ================================================================
   HELPERS
   ================================================================ */
function updateSpeciesUI(){document.querySelectorAll("[data-species]").forEach(b=>b.classList.toggle("active",b.dataset.species===state.favorites.species));}
function toggleFav(k,id){if(!["zones","launches"].includes(k)||!id)return;const l=state.favorites[k];state.favorites[k]=l.includes(id)?l.filter(x=>x!==id):[...l,id];saveStored("saginaw:favorites",state.favorites);renderDash();}
function zoneLabel(id){return{"west-side":"West Side","east-side":"East Side","inner-bay":"Inner Bay","outer-bay":"Outer Bay","river-mouth":"River Mouth","shipping-channel":"Shipping Channel","reefs":"Named Reefs","bay-wide":"Bay-wide"}[id]||id;}
function sigWord(s){return s>=0.3?"positive":s<=-0.15?"negative":"mixed";}
function getDateKey(d=new Date()){const p=new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);const m=Object.fromEntries(p.map(x=>[x.type,x.value]));return`${m.year}-${m.month}-${m.day}`;}
function relTime(i){if(!i)return"?";const ms=Date.now()-new Date(i).getTime();if(isNaN(ms))return"?";const min=Math.max(0,Math.round(ms/60000));if(min<1)return"now";if(min<60)return`${min}m`;const hr=Math.round(min/60);return hr<24?`${hr}h`:`${Math.round(hr/24)}d`;}
function cap(v){return v?v[0].toUpperCase()+v.slice(1):"";}
function fix(v,d){return v!=null&&!isNaN(v)?Number(v).toFixed(d):"--";}
function esc(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function loadStored(k,fb){try{const r=localStorage.getItem(k);if(!r)return fb;const p=JSON.parse(r);return fb&&typeof fb==="object"&&!Array.isArray(fb)&&p&&typeof p==="object"&&!Array.isArray(p)?{...fb,...p}:p;}catch{return fb;}}
function saveStored(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}

init();
