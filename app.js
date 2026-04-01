/* ============================================
   Saginaw Bay Fishing Hub v6
   Weekend Briefing + Fishing Map
   ============================================ */
const SUMMARY_EP="/api/daily-summary",SENSORS_EP="/api/sensors",REPORTS_EP="/api/reports";
const TZ="America/Detroit",SNAP_PREFIX="saginaw:snap",API_VER="2026-03-31-rich-zones-v2";
const state={data:null,sensors:null,reports:null,species:loadStored("sb-species","walleye")};
let map=null,nauticalLayer=null,roadLayer=null,structGroup=null;
const layers={sensors:[],launches:[],reports:[]};
const $=id=>document.getElementById(id);

/* ---- Events ---- */
document.addEventListener("click",e=>{
  const sp=e.target.closest("[data-species]");
  if(sp){state.species=sp.dataset.species;saveStored("sb-species",state.species);
    document.querySelectorAll(".sp-btn").forEach(b=>b.classList.toggle("active",b.dataset.species===state.species));
    fetchSummary();return}
  if(e.target.closest("#toggle-road")){setBase("road");return}
  if(e.target.closest("#toggle-base")){setBase("nautical");return}
});

/* ---- Launches (verified GPS) ---- */
const LAUNCHES=[
  {id:"linwood",n:"Linwood Beach",lat:43.7354,lng:-83.9489,z:"west-side"},
  {id:"coggins",n:"Coggins Rd",lat:43.8030,lng:-83.9264,z:"west-side"},
  {id:"gambills",n:"Gambill's",lat:43.8094,lng:-83.9244,z:"west-side"},
  {id:"pinconning",n:"Pinconning",lat:43.8499,lng:-83.9219,z:"west-side"},
  {id:"au-gres-dnr",n:"Au Gres DNR",lat:44.0268,lng:-83.6792,z:"west-side"},
  {id:"pt-au-gres",n:"Pt Au Gres",lat:44.0167,lng:-83.6879,z:"west-side"},
  {id:"sebewaing",n:"Sebewaing",lat:43.7503,lng:-83.5175,z:"east-side"},
  {id:"quanicassee",n:"Quanicassee",lat:43.5847,lng:-83.6809,z:"east-side"},
  {id:"bcsp",n:"Bay City SP",lat:43.6713,lng:-83.9106,z:"river-mouth"},
  {id:"sag-mouth",n:"Sag River Mouth",lat:43.6405,lng:-83.8506,z:"river-mouth"},
  {id:"smith",n:"Smith Park",lat:43.6160,lng:-83.8455,z:"inner-bay"},
  {id:"finn",n:"Finn Road",lat:43.6293,lng:-83.7795,z:"inner-bay"},
];

/* ---- Structure (verified, see RESEARCH.md) ---- */
const STRUCT=[
  {n:"Spoils Island",lat:43.6679,lng:-83.8026,d:"6-17ft",i:"Post-spawn walleye. Perch E/W sides 14-17ft."},
  {n:"Channel Reef (2025)",lat:43.668,lng:-83.803,d:"12-16ft",i:"New spawning reef. Walleye, whitefish."},
  {n:"Callahan Reef",lat:43.66,lng:-83.72,d:"10-16ft",i:"Sandbar E of channel. Walleye late spring."},
  {n:"Black Hole",lat:43.76,lng:-83.88,d:"22-28ft",i:"Summer walleye when temps 70+. Ice perch."},
  {n:"Spark Plug",lat:43.72,lng:-83.78,d:"22-26ft",i:"Buoys 11-12. THE reference point for mid-bay."},
  {n:"The Slot",lat:43.74,lng:-83.49,d:"13-20ft",i:"East side trolling lane. Caseville to Sebewaing."},
  {n:"Pinconning Bar",lat:43.82,lng:-83.90,d:"10-18ft",i:"Weedline pockets. Walleye year-round."},
  {n:"Buoys 1&2",lat:43.78,lng:-83.72,d:"25-35ft",i:"Deep channel. Key walleye spot."},
  {n:"Saganing Bar",lat:43.78,lng:-83.86,d:"10-15ft",i:"Perch along edges."},
  {n:"The Cigar",lat:43.73,lng:-83.90,d:"18-23ft",i:"Off Linwood. Ice + open water."},
  {n:"Old Channel",lat:43.65,lng:-83.81,d:"14-16ft",i:"Historic channel. Perch 14-16ft."},
  {n:"Big Charity Is.",lat:44.0255,lng:-83.4347,d:"varies",i:"Lighthouse island. Fish between islands. 10mi out."},
  {n:"Gravelly Shoal",lat:43.985,lng:-83.575,d:"5-18ft",i:"3mi SE from Pt Lookout. Walleye May-June."},
  {n:"Steeples",lat:44.02,lng:-83.40,d:"14-19ft",i:"Rock outcrops E of Charity. Snags gear."},
  {n:"Sand Point",lat:43.745,lng:-83.475,d:"varies",i:"Thumb promontory. Slot runs north."},
  {n:"Flat Rock Reefs",lat:43.98,lng:-83.38,d:"35-45ft",i:"Off Port Austin. Deep walleye."},
];

/* ================================================================
   MAP: nautical chart default
   ================================================================ */
function initMap(){
  map=L.map("bay-map",{center:[43.75,-83.70],zoom:10,scrollWheelZoom:true,
    zoomControl:false,minZoom:8,maxZoom:15,attributionControl:false});
  L.control.zoom({position:"bottomright"}).addTo(map);
  L.control.attribution({position:"bottomright",prefix:false}).addTo(map);

  nauticalLayer=L.tileLayer("https://tileservice.charts.noaa.gov/tiles/50000_1/{z}/{x}/{y}.png",{
    attribution:'NOAA Charts | &copy; <a href="https://osm.org">OSM</a>',maxZoom:15});
  roadLayer=L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",{
    attribution:'&copy; <a href="https://osm.org">OSM</a> &copy; <a href="https://carto.com">CARTO</a>',
    maxZoom:15,subdomains:"abcd"});

  // Default: nautical
  nauticalLayer.addTo(map);
  $("toggle-base")?.classList.add("active");

  // Structure: visible zoom 11+
  structGroup=L.layerGroup();
  for(const s of STRUCT){
    const m=L.marker([s.lat,s.lng],{icon:L.divIcon({className:"mk",
      html:`<div class="mk-s"><span class="mk-sd"></span><span class="mk-sn">${esc(s.n)}</span></div>`,
      iconSize:[120,14],iconAnchor:[6,7]})});
    m.bindPopup(`<div class="pop"><h4>${esc(s.n)}</h4><p class="pop-d">${esc(s.d)}</p><p>${esc(s.i)}</p></div>`,{maxWidth:260});
    structGroup.addLayer(m);
  }
  map.on("zoomend",()=>{
    const z=map.getZoom();
    if(z>=11&&!map.hasLayer(structGroup))structGroup.addTo(map);
    if(z<11&&map.hasLayer(structGroup))structGroup.removeLayer(structGroup);
  });

  // Launches
  for(const l of LAUNCHES){
    const m=L.marker([l.lat,l.lng],{icon:L.divIcon({className:"mk",
      html:`<div class="mk-l" id="lm-${l.id}"><span class="mk-la">\u2693</span><span class="mk-ln">${esc(l.n)}</span></div>`,
      iconSize:[130,18],iconAnchor:[9,9]})}).addTo(map);
    m.bindPopup(()=>launchPop(l),{maxWidth:280});
    layers.launches.push({m,d:l});
  }
}

function setBase(which){
  if(which==="road"){
    if(map.hasLayer(nauticalLayer))map.removeLayer(nauticalLayer);
    if(!map.hasLayer(roadLayer))roadLayer.addTo(map);
  }else{
    if(map.hasLayer(roadLayer))map.removeLayer(roadLayer);
    if(!map.hasLayer(nauticalLayer))nauticalLayer.addTo(map);
  }
  $("toggle-base")?.classList.toggle("active",which==="nautical");
  $("toggle-road")?.classList.toggle("active",which==="road");
}

function launchPop(l){
  const s=(state.data?.launches||[]).find(x=>x.id===l.id)||{};
  const sc=s.score;const cls=sc>=60?"pop-go":sc>=40?"pop-caut":"pop-nogo";
  let h=`<div class="pop"><h4>${esc(l.n)}</h4>`;
  if(sc!=null)h+=`<div class="pop-sc ${cls}">Score ${sc}: ${esc(s.advice||"")}</div>`;
  if(s.exposureSummary)h+=`<p>${esc(s.exposureSummary)}</p>`;
  if(s.notes)h+=`<p class="pop-n">${esc(s.notes)}</p>`;
  return h+"</div>";
}

/* ---- Wind arrows on sensor markers ---- */
function renderSensors(data){
  layers.sensors.forEach(l=>map.removeLayer(l));layers.sensors=[];
  if(!data?.stations||!data?.readings)return;
  for(const st of data.stations){
    const r=data.readings[st.id]||{};
    if(r.error||st.type==="stream-gauge")continue;
    let html;
    if(st.type==="buoy"||st.type==="weather-station"){
      const w=r.windMph,d=r.windDeg;
      const wc=w!=null?(w<=10?"#2d8659":w<=18?"#c68b2c":"#b84040"):"#888";
      // Wind arrow rotated by direction
      const rot=d!=null?d:0;
      html=`<div class="mk-wx"><div class="wx-arrow" style="transform:rotate(${rot}deg);color:${wc}">\u2193</div><div class="wx-data"><span class="wx-spd" style="color:${wc}">${w!=null?Math.round(w):"-"}</span><span class="wx-unit">mph</span>`;
      if(r.waterTempF!=null)html+=`<span class="wx-wt">${Math.round(r.waterTempF)}\u00B0</span>`;
      else if(r.airTempF!=null)html+=`<span class="wx-at">${Math.round(r.airTempF)}\u00B0</span>`;
      html+=`</div></div>`;
    }else if(st.type==="water-level"){
      const arr=r.trendLabel==="Rising"?"\u2191":r.trendLabel==="Falling"?"\u2193":"\u2192";
      html=`<div class="mk-wl"><span class="wl-v">${r.waterLevelFtIGLD||"-"}ft</span><span class="wl-t">${arr}</span></div>`;
    }else continue;

    const icon=L.divIcon({className:"mk",html,iconSize:[60,40],iconAnchor:[30,20]});
    const m=L.marker([st.lat,st.lng],{icon}).addTo(map);
    m.bindPopup(sensorPop(st,r),{maxWidth:260});
    layers.sensors.push(m);
  }
}

function sensorPop(st,r){
  let h=`<div class="pop"><h4>${esc(st.name)}</h4><small>${esc(st.source)}</small><table class="pop-t">`;
  if(r.windMph!=null)h+=`<tr><td>Wind</td><td><strong>${r.windMph}mph ${r.windDir||""}</strong>${r.gustMph?` G${r.gustMph}`:""}</td></tr>`;
  if(r.waveFt!=null)h+=`<tr><td>Waves</td><td>${r.waveFt}ft</td></tr>`;
  if(r.airTempF!=null)h+=`<tr><td>Air</td><td>${Math.round(r.airTempF)}\u00B0F</td></tr>`;
  if(r.waterTempF!=null)h+=`<tr><td>Water</td><td><strong>${Math.round(r.waterTempF)}\u00B0F</strong></td></tr>`;
  if(r.waterLevelFtIGLD!=null)h+=`<tr><td>Level</td><td>${r.waterLevelFtIGLD}ft IGLD (${r.trendLabel||""})</td></tr>`;
  if(r.pressureMb!=null)h+=`<tr><td>Baro</td><td>${r.pressureMb}mb</td></tr>`;
  h+="</table>";if(r.observedAt)h+=`<small>${relTime(r.observedAt)}</small>`;
  return h+"</div>";
}

/* ---- Report hotspots on map ---- */
function plotReports(){
  layers.reports.forEach(l=>map.removeLayer(l));layers.reports=[];
  if(!state.reports?.reports?.length)return;
  const ZC={"west-side":[43.79,-83.90],"east-side":[43.71,-83.51],"inner-bay":[43.66,-83.82],
    "outer-bay":[43.96,-83.55],"river-mouth":[43.62,-83.86],"shipping-channel":[43.67,-83.80],
    "reefs":[43.82,-83.58],"bay-wide":[43.73,-83.76]};
  const byZ={};
  for(const r of state.reports.reports){const z=r.primaryZone||"bay-wide";(byZ[z]=byZ[z]||[]).push(r);}
  for(const[zone,rpts]of Object.entries(byZ)){
    const c=ZC[zone];if(!c)continue;
    const avg=rpts.reduce((s,r)=>s+(r.signal||0),0)/rpts.length;
    const col=avg>=0.3?"#2d8659":avg<=-0.15?"#b84040":"#c68b2c";
    const species=[...new Set(rpts.flatMap(r=>r.species||[]))].slice(0,2).map(cap).join("/");
    const icon=L.divIcon({className:"mk",
      html:`<div class="mk-rpt" style="--c:${col}"><span class="rpt-n">${rpts.length}</span><span class="rpt-sp">${species||"Mixed"}</span></div>`,
      iconSize:[80,20],iconAnchor:[40,10]});
    const m=L.marker(c,{icon}).addTo(map);
    const pop=rpts.slice(0,3).map(r=>`<p class="pop-ri">${esc((r.summary||"").slice(0,100))}</p>`).join("");
    m.bindPopup(`<div class="pop"><h4>${esc(zoneLabel(zone))}</h4><p style="color:${col};font-weight:700">${sigWord(avg)} signal (${rpts.length} reports)</p>${pop}</div>`,{maxWidth:300});
    layers.reports.push(m);
  }
}

/* ================================================================
   WEEKEND BRIEFING
   ================================================================ */
function renderBriefing(){
  const d=state.data,s=state.sensors,rp=state.reports;
  if(!d)return;
  const bc=d.bayCall||{};
  const c=d.conditions||{};
  const rd=s?.readings||{};
  const sblm4=rd["ndbc-sblm4"]||{};
  const riv=rd["usgs-04157005"]||{};
  const titt=rd["usgs-04156000"]||{};
  const lvl=rd["noaa-9075035"]||{};
  const mf=s?.marineForecast?.innerBay||{};
  const topZone=(d.zones||[])[0];
  const bestLaunch=(d.launches||[])[0];

  // Bay Call badge
  const callEl=$("br-call");
  const cls=bc.goNoGo==="GO"?"br-go":bc.goNoGo==="CAUTION"?"br-caut":"br-nogo";
  callEl.className=`br-call ${cls}`;
  callEl.textContent=bc.label||"Loading...";

  // Build briefing body
  let h="";

  // Advisory
  if(mf.advisory)h+=`<div class="br-alert">${esc(mf.advisory)}</div>`;

  // WHY in plain language
  if(bc.goNoGo==="NO_GO"){
    h+=`<p class="br-why">${esc(bc.summary||"Conditions are beyond small-boat comfort range.")}</p>`;
  }else if(topZone){
    h+=`<p class="br-why">Best setup: <strong>${esc(topZone.name)}</strong> from <strong>${esc(bestLaunch?.name||"")}</strong>.${topZone.action?.technique?` ${esc(topZone.action.technique)}`:""}</p>`;
  }

  // Conditions grid
  h+=`<div class="br-grid">`;
  h+=cond("Wind",sblm4.windMph!=null?`${Math.round(sblm4.windMph)} mph ${sblm4.windDir||""}`:(c.windMph!=null?`${Math.round(c.windMph)} mph ${c.windDirectionCardinal||""}`:"--"));
  h+=cond("Waves",c.waveFt!=null?`${fix(c.waveFt,1)} ft`:"--");
  h+=cond("Water",c.waterTempF!=null?`${Math.round(c.waterTempF)}\u00B0F`:(riv.waterTempF!=null?`${Math.round(riv.waterTempF)}\u00B0 (river)`:"--"));
  h+=cond("Air",c.airTempF!=null?`${Math.round(c.airTempF)}\u00B0F`:"--");
  h+=cond("Window",c.smallBoatWindowHours!=null?`${c.smallBoatWindowHours} hrs`:"--");
  h+=cond("Level",lvl.waterLevelFtIGLD!=null?`${lvl.waterLevelFtIGLD}ft ${lvl.trendLabel||""}`:"--");
  h+=cond("River",riv.flowCfs?`${riv.flowCfs.toLocaleString()} cfs`:"--");
  h+=cond("Tittab.",titt.flowCfs?`${titt.flowCfs.toLocaleString()} cfs`:"--");
  h+=`</div>`;

  // This week's bite (from reports)
  const reports=rp?.reports||[];
  if(reports.length){
    const species=[...new Set(reports.flatMap(r=>r.species||[]))].slice(0,3).map(cap);
    const depths=[...new Set(reports.filter(r=>r.depth).map(r=>`${r.depth.min}-${r.depth.max}ft`))].slice(0,2);
    const lures=[...new Set(reports.flatMap(r=>r.lure||[]))].slice(0,3);
    const zones=[...new Set(reports.map(r=>r.primaryZone).filter(Boolean))].slice(0,2).map(zoneLabel);
    let bite=`<div class="br-bite"><strong>This week:</strong> `;
    if(species.length)bite+=species.join(", ");
    if(zones.length)bite+=` reported ${zones.join(" and ")}`;
    if(depths.length)bite+=` in ${depths.join(", ")}`;
    if(lures.length)bite+=` on ${lures.join(", ")}`;
    bite+=`. ${reports.length} reports from ${rp.sources?.filter(s=>s.status==="ok").length||0} sources.</div>`;
    h+=bite;
  }

  // Marine forecast snippet
  if(mf.today)h+=`<div class="br-fc"><strong>Forecast:</strong> ${esc(mf.today.slice(0,150))}...</div>`;

  // Satellite link
  if(s?.satellite?.imageUrl)h+=`<a href="${esc(s.satellite.imageUrl)}" target="_blank" class="br-sst">View Satellite SST Map</a>`;

  $("br-body").innerHTML=h;

  // Color launches on map
  const scores={};for(const l of(d.launches||[]))scores[l.id]=l;
  for(const{d:ld}of layers.launches){
    const el=document.getElementById(`lm-${ld.id}`);if(!el)continue;
    const sc=scores[ld.id];
    el.className=sc?`mk-l ${sc.score>=60?"mk-go":sc.score>=40?"mk-caut":"mk-nogo"}`:"mk-l";
  }
}

function cond(k,v){return `<div class="br-c"><span class="br-ck">${k}</span><span class="br-cv">${v}</span></div>`;}

/* ================================================================
   BELOW-FOLD DETAIL SECTIONS
   ================================================================ */
function renderConditions(){
  const c=state.data?.conditions;if(!c)return;
  const s=state.sensors?.readings||{};const riv=s["usgs-04157005"];const titt=s["usgs-04156000"];
  const fields=[
    {l:"Wind",v:c.windMph!=null?`${Math.round(c.windMph)} mph ${c.windDirectionCardinal||""}`:"--"},
    {l:"Waves",v:c.waveFt!=null?`${fix(c.waveFt,1)} ft`:"--"},
    {l:"NOAA Waves",v:c.waveFtNoaaGrid!=null?`${fix(c.waveFtNoaaGrid,1)} ft`:"--"},
    {l:"Air",v:c.airTempF!=null?`${Math.round(c.airTempF)}\u00B0F`:"--"},
    {l:"Water",v:c.waterTempF!=null?`${Math.round(c.waterTempF)}\u00B0F`:"--"},
    {l:"Window",v:c.smallBoatWindowHours!=null?`${c.smallBoatWindowHours} hrs (${c.smallBoatWindowLabel||""})`:"--"},
    {l:"Level",v:c.waterLevelFtIGLD!=null?`${fix(c.waterLevelFtIGLD,2)} ft IGLD`:"--"},
    {l:"Sag River",v:riv?.flowCfs?`${riv.flowCfs.toLocaleString()} cfs / ${Math.round(riv.waterTempF||0)}\u00B0F`:"--"},
    {l:"Tittab.",v:titt?.flowCfs?`${titt.flowCfs.toLocaleString()} cfs`:"--"},
    {l:"Shoreline",v:c.shorelineForecastShort||"--"},
    {l:"Advisories",v:c.alertHeadline||"None"},
  ];
  $("conditions-grid").innerHTML=fields.map(f=>`<div class="cond-box"><span class="cond-label">${esc(f.l)}</span><p class="cond-value">${esc(f.v)}</p></div>`).join("");
}

function renderZones(){
  const zones=state.data?.zones;if(!zones?.length)return;
  $("zones-grid").innerHTML=zones.map(z=>{
    const tone=z.tripScore>=72?"strong":z.tripScore>=56?"moderate":"weak";const a=z.action||{};
    return `<article class="zone-card"><div class="zone-head"><div><h3>${esc(z.name)}</h3><span class="zone-rec">${esc(z.recommendation||"")}</span></div><span class="score-badge ${tone}">${z.tripScore}</span></div><div class="zone-stats"><div class="zone-stat"><span class="stat-label">Safety</span><span class="stat-val">${z.safety}</span></div><div class="zone-stat"><span class="stat-label">Fish</span><span class="stat-val">${z.fishability}</span></div><div class="zone-stat"><span class="stat-label">Signal</span><span class="stat-val">${z.recentSignal}</span></div><div class="zone-stat"><span class="stat-label">Conf</span><span class="stat-val">${z.confidence}</span></div></div><div class="zone-action"><p><strong>Launch:</strong> ${esc(a.bestLaunchName||"N/A")}</p><p><strong>Window:</strong> ${esc(a.windowPlan||"")}</p><p><strong>Tactic:</strong> ${esc(a.technique||"")}</p></div></article>`;
  }).join("");
}

function renderLaunches(){
  const ls=state.data?.launches;if(!ls?.length)return;
  $("launches-list").innerHTML=ls.slice(0,7).map(l=>{
    const t=l.score>=60?"strong":l.score>=40?"moderate":"weak";
    return `<article class="launch-card"><div class="launch-head"><div><h3>${esc(l.name)}</h3><span class="launch-meta">${esc(l.zoneName)} | ${esc(l.advice)}</span></div><span class="score-badge ${t}">${l.score}</span></div><p class="launch-notes">${esc(l.exposureSummary)}</p></article>`;
  }).join("");
}

function renderReports(){
  const rp=state.reports;if(!rp)return;
  const reports=rp.reports||[];const sources=rp.sources||[];
  let h=`<p class="muted">${rp.totalReports} reports / ${sources.filter(s=>s.status==="ok").length} sources</p>`;
  h+='<div class="source-badges">';
  for(const src of sources){const c=src.status==="ok"?"src-ok":"src-warn";h+=`<span class="src-badge ${c}">${esc(src.sourceName||"")} (${src.reportCount})</span>`;}
  h+='</div>';
  if(reports.length){h+=reports.slice(0,6).map(r=>{const sc=r.signal>=0.3?"sig-pos":r.signal<=-0.15?"sig-neg":"sig-mix";
    return `<article class="report-card"><div class="report-head"><h3>${esc(r.primaryZone?zoneLabel(r.primaryZone):"Bay-wide")}</h3><span class="report-meta ${sc}">${sigWord(r.signal)}</span></div><p class="report-summary">${esc(r.summary||"")}</p><div class="report-tags">${(r.species||[]).map(s=>`<span class="tag">${cap(s)}</span>`).join("")}${r.depth?`<span class="tag">${r.depth.min}-${r.depth.max}ft</span>`:""}${(r.lure||[]).map(l=>`<span class="tag">${esc(l)}</span>`).join("")}</div></article>`;
  }).join("");}
  $("reports-list").innerHTML=h;
}

/* ================================================================
   DATA FETCHING
   ================================================================ */
function init(){
  initMap();
  document.querySelectorAll(".sp-btn").forEach(b=>b.classList.toggle("active",b.dataset.species===state.species));
  fetchSummary();fetchSensors();fetchReports();
}

async function fetchSummary(){
  const day=getDateKey(),key=`${SNAP_PREFIX}:${state.species}:${day}`;
  const cached=loadStored(key,null);
  if(cached?.snapshotDate===day&&cached?.apiVersion===API_VER){state.data=cached;renderAll();return}
  try{const r=await fetch(`${SUMMARY_EP}?species=${state.species}&day=${day}`);if(!r.ok)throw new Error(r.status);
    const d=await r.json();d.snapshotDate=d.snapshotDate||day;state.data=d;saveStored(key,d);renderAll();
  }catch(e){$("br-call").textContent="Error";$("br-call").className="br-call br-nogo";}
}
async function fetchSensors(){try{const r=await fetch(SENSORS_EP);if(!r.ok)throw 0;
  state.sensors=await r.json();renderSensors(state.sensors);renderBriefing();renderConditions();}catch{}}
async function fetchReports(){try{const r=await fetch(REPORTS_EP);if(!r.ok)throw 0;
  state.reports=await r.json();renderReports();plotReports();renderBriefing();}catch{}}

function renderAll(){renderBriefing();renderConditions();renderZones();renderLaunches();}

/* ---- Helpers ---- */
function zoneLabel(id){return{"west-side":"West Side","east-side":"East Side","inner-bay":"Inner Bay","outer-bay":"Outer Bay","river-mouth":"River Mouth","shipping-channel":"Ship Channel","reefs":"Reefs","bay-wide":"Bay-wide"}[id]||id;}
function sigWord(s){return s>=0.3?"positive":s<=-0.15?"negative":"mixed";}
function getDateKey(){const p=new Intl.DateTimeFormat("en-CA",{timeZone:TZ,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const m=Object.fromEntries(p.map(x=>[x.type,x.value]));return`${m.year}-${m.month}-${m.day}`;}
function relTime(i){if(!i)return"?";const ms=Date.now()-new Date(i).getTime();if(isNaN(ms))return"?";const min=Math.max(0,Math.round(ms/60000));if(min<1)return"now";if(min<60)return`${min}m ago`;const hr=Math.round(min/60);return hr<24?`${hr}h ago`:`${Math.round(hr/24)}d ago`;}
function cap(v){return v?v[0].toUpperCase()+v.slice(1):"";}
function fix(v,d){return v!=null&&!isNaN(v)?Number(v).toFixed(d):"--";}
function esc(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function loadStored(k,fb){try{const r=localStorage.getItem(k);return r?JSON.parse(r):fb;}catch{return fb;}}
function saveStored(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}

init();
