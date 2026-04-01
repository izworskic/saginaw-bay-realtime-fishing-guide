/* ============================================
   Saginaw Bay Fishing Hub v4
   Map-first fishing intelligence
   All coordinates verified from NOAA, DNR, MI Water Trails, USGS
   See RESEARCH.md for source documentation
   ============================================ */

const SUMMARY_EP = "/api/daily-summary";
const SENSORS_EP = "/api/sensors";
const REPORTS_EP = "/api/reports";
const TZ = "America/Detroit";
const SNAP_PREFIX = "saginaw:daily-snapshot";
const API_VER = "2026-03-31-rich-zones-v2";

const state = { loading:false, error:null, data:null, dataSource:null, sensors:null, reports:null,
  favorites: loadStored("saginaw:favorites",{zones:[],launches:[],species:"walleye"}) };

let map = null;
const layers = { sensors:[], launches:[], structure:[], reports:[] };

const $=id=>document.getElementById(id);
const ui = { badge:$("bay-call-badge"),updated:$("updated-at"),best:$("hero-best"),avoid:$("hero-avoid"),
  conf:$("hero-confidence"),rationale:$("hero-rationale"),captainNote:$("captain-note"),
  condGrid:$("conditions-grid"),zonesGrid:$("zones-grid"),launches:$("launches-list"),reportsList:$("reports-list") };

document.addEventListener("click",e=>{
  const sp=e.target.closest("[data-species]");
  if(sp){state.favorites.species=sp.dataset.species;saveStored("saginaw:favorites",state.favorites);updateSpeciesUI();fetchSummary();return}
  if(e.target.closest("[data-action='generate-ai-note']")){fetchSummary(true);return}
  const f=e.target.closest("[data-fav-kind]");
  if(f){toggleFav(f.dataset.favKind,f.dataset.favId);return}
  if(e.target.closest("#toggle-chart")){toggleChartLayer();return}
});

/* ================================================================
   VERIFIED LAUNCHES (GPS confirmed - see RESEARCH.md)
   ================================================================ */
const LAUNCHES = [
  { id:"linwood", name:"Linwood Beach Marina", lat:43.7354, lng:-83.9489, zone:"west-side", ramps:2, notes:"Full service marina, west shore. Year-round access." },
  { id:"coggins", name:"Coggins Road DNR", lat:43.8030, lng:-83.9264, zone:"west-side", ramps:3, notes:"Perch, bass, walleye spring/fall." },
  { id:"gambills", name:"Gambill's Landing", lat:43.8094, lng:-83.9244, zone:"west-side", ramps:1, notes:"Pinconning area. No bank fishing." },
  { id:"pinconning", name:"Pinconning County Park", lat:43.8499, lng:-83.9219, zone:"west-side", ramps:2, notes:"Floating fishing dock. Handicap accessible." },
  { id:"au-gres-dnr", name:"Au Gres DNR Launch", lat:44.0268, lng:-83.6792, zone:"west-side", ramps:4, notes:"Largest on bay. 4 ramps, 8 boats at once. Pier fishing." },
  { id:"au-gres-dock", name:"Au Gres State Dock", lat:44.0469, lng:-83.6874, zone:"west-side", ramps:1, notes:"Downtown harbor. Transient slips." },
  { id:"pointe-au-gres", name:"Pointe Au Gres Marina", lat:44.0167, lng:-83.6879, zone:"west-side", ramps:1, notes:"Directly on Saginaw Bay. Closest to Charity Islands." },
  { id:"sebewaing", name:"Sebewaing Harbor", lat:43.7503, lng:-83.5175, zone:"east-side", ramps:4, notes:"105 slips. East side access." },
  { id:"quanicassee", name:"Quanicassee DNR", lat:43.5847, lng:-83.6809, zone:"east-side", ramps:1, notes:"Paved launch, 150ft seawall. Shallow approach." },
  { id:"bay-city-sp", name:"Bay City State Park", lat:43.6713, lng:-83.9106, zone:"river-mouth", ramps:4, notes:"Tobico Lagoon. Families, kayaks." },
  { id:"sag-river-mouth", name:"Saginaw River Mouth DNR", lat:43.6405, lng:-83.8506, zone:"river-mouth", ramps:1, notes:"Shady Shore Rd. 3 docks. Direct bay access." },
  { id:"smith-park", name:"Smith Park (Essexville)", lat:43.6160, lng:-83.8455, zone:"inner-bay", ramps:1, notes:"Shore fishing. Perch, SMB, catfish. Fee for non-residents." },
  { id:"finn-road", name:"Finn Road Launch", lat:43.6293, lng:-83.7795, zone:"inner-bay", ramps:1, notes:"Good ice fishing access. Early spring walleye." },
  { id:"independence", name:"Independence Bridge", lat:43.6145, lng:-83.8716, zone:"inner-bay", ramps:1, notes:"Bay access, ice fishing access." },
];

/* ================================================================
   VERIFIED FISHING STRUCTURE (see RESEARCH.md for sources)
   ================================================================ */
const STRUCTURE = [
  // Confirmed with GPS or precise descriptions
  { id:"spoils-island", name:"Spoils Island", lat:43.6679, lng:-83.8026, type:"island",
    depth:"6-17 ft", species:["walleye","perch"], desc:"Man-made dredge island at river mouth. Post-spawn walleye staging. Perch east & west sides in 14-17 ft. New Channel Island Reef (2025) 0.5mi east." },
  { id:"channel-reef", name:"Channel Island Reef", lat:43.6679, lng:-83.8025, type:"reef",
    depth:"12-16 ft", species:["walleye","whitefish"], desc:"2.5-acre spawning reef built Sep 2025. Limestone cobble. Walleye, lake whitefish, cisco. Caution: submerged structure." },
  { id:"coreyon-reef", name:"Coreyon Reef (restored)", lat:43.66, lng:-83.81, type:"reef",
    depth:"12-15 ft", species:["walleye","bass","perch"], desc:"First restored reef in inner bay. $1M+ project. Walleye, SMB, perch, pike on the edges." },
  { id:"charity-island", name:"Big Charity Island", lat:44.0255, lng:-83.4347, type:"island",
    depth:"varies", species:["walleye","lake-trout"], desc:"222 acres. Historic lighthouse. Fish the gravel reefs between Big & Little Charity. 10mi offshore from Au Gres." },
  { id:"little-charity", name:"Little Charity Island", lat:44.015, lng:-83.455, type:"island",
    depth:"varies", species:["walleye"], desc:"5.4 acres. Navigation reference. Cormorant colony. Fish between the islands." },
  { id:"gravelly-shoal", name:"Gravelly Shoal", lat:43.985, lng:-83.575, type:"shoal",
    depth:"5-18 ft", species:["walleye"], desc:"Extends ~3mi SE from Point Lookout. Walleye May-June on edges. Crankbaits and spoons resembling smelt. Light station nearby." },
  { id:"callahan-reef", name:"Callahan Reef", lat:43.66, lng:-83.72, type:"reef",
    depth:"10-16 ft", species:["walleye"], desc:"Shallow sandbar east of shipping channel. Walleye late spring/summer. Crawler harnesses." },

  // Named by anglers (approximate positions from fishing reports pattern analysis)
  { id:"black-hole", name:"The Black Hole", lat:43.76, lng:-83.88, type:"deep",
    depth:"22-28 ft", species:["walleye","perch"], desc:"Deep water NE of Linwood. Summer walleye when surface temps hit 70+. Perch at 24-25 ft in ice season." },
  { id:"spark-plug", name:"Spark Plug (Buoys 11-12)", lat:43.72, lng:-83.78, type:"buoy",
    depth:"22-26 ft", species:["walleye","perch"], desc:"Red & Green Spark Plug navigation buoys. Major reference point. 'Two miles east of the Spark Plug' is the most common report phrase. Walleye + perch in 25 ft." },
  { id:"the-slot", name:"The Slot", lat:43.74, lng:-83.49, type:"channel",
    depth:"13-20 ft", species:["walleye"], desc:"Deep water corridor off Caseville / Sand Point (east side). Major walleye trolling lane. Sunset Marina to Sebewaing to North Island." },
  { id:"pinconning-bar", name:"Pinconning Bar", lat:43.82, lng:-83.90, type:"bar",
    depth:"10-18 ft", species:["walleye","perch"], desc:"Sand/weed bar along west shore. Walleye all year. Work north side pockets and inside turns on weedline." },
  { id:"saganing-bar", name:"Saganing Bar", lat:43.78, lng:-83.86, type:"bar",
    depth:"10-15 ft", species:["walleye","perch"], desc:"Bar structure between Pinconning and Linwood. Perch along edges. Good reports from Au Gres boats heading south." },
  { id:"buoys-1-2", name:"Buoys 1 & 2", lat:43.78, lng:-83.72, type:"buoy",
    depth:"25-35 ft", species:["walleye","perch"], desc:"Major shipping channel buoys in mid-bay deeper water. Key walleye reference at 25-30 ft. Often mentioned with Flicker Shads." },
  { id:"sailboat-buoys", name:"Sailboat Buoys", lat:43.74, lng:-83.92, type:"buoy",
    depth:"18-23 ft", species:["walleye","perch"], desc:"Race course buoys off Linwood (A through H). Good depth to 23 ft. Walleye and perch reference points." },
  { id:"cigar", name:"The Cigar", lat:43.73, lng:-83.90, type:"area",
    depth:"18-23 ft", species:["walleye"], desc:"In front of Linwood. Ice fishing spot (18-23 ft). Also productive open water. Near Sailboat Buoys." },
  { id:"old-channel", name:"Old Shipping Channel", lat:43.65, lng:-83.81, type:"channel",
    depth:"14-16 ft", species:["perch","walleye"], desc:"Historic channel, shallower than active channel. Perch in 14-16 ft. Also walleye along edges." },
  { id:"steeples", name:"The Steeples", lat:44.02, lng:-83.40, type:"reef",
    depth:"14-19 ft", species:["walleye"], desc:"Rock outcroppings east of Charity Island. Walleye trolling. Known to snag gear on bottom." },
  { id:"middle-grounds", name:"Middle Grounds", lat:43.74, lng:-83.50, type:"bar",
    depth:"shallow", species:["walleye"], desc:"Shallow rocky bar west of Sand Point (east side). Fish inside turns on SE side. Watch for rocks." },
  { id:"flat-rock-reefs", name:"Flat Rock Reefs", lat:43.98, lng:-83.38, type:"reef",
    depth:"35-45 ft", species:["walleye"], desc:"Off Hat Point near Port Austin. Deeper water walleye. Crawler harnesses." },
  { id:"point-lookout", name:"Point Lookout", lat:44.025, lng:-83.676, type:"point",
    depth:"varies", species:["walleye"], desc:"Western shore promontory. Gravelly Shoal extends SE. Walleye spring trolling between here and Pt Au Gres." },
  { id:"sand-point", name:"Sand Point", lat:43.745, lng:-83.475, type:"point",
    depth:"varies", species:["walleye"], desc:"East side (Thumb) promontory near Caseville. The Slot runs north from tip. Walleye around water tower." },
  { id:"oak-point", name:"Oak Point", lat:43.84, lng:-83.40, type:"point",
    depth:"25-35 ft", species:["walleye"], desc:"Between Caseville and Port Austin. Walleye in deeper water. Crawler harnesses and spoons." },
];

/* ================================================================
   MAP INITIALIZATION
   ================================================================ */
let chartLayer = null;
let baseLayer = null;

function initMap() {
  map = L.map("bay-map", {
    center: [43.76, -83.72],
    zoom: 10,
    scrollWheelZoom: true,
    zoomControl: true,
    minZoom: 8,
    maxZoom: 15,
  });

  // Base layer: CARTO Voyager
  baseLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 15, subdomains: "abcd",
  }).addTo(map);

  // NOAA Nautical Chart overlay (togglable)
  chartLayer = L.tileLayer("https://tileservice.charts.noaa.gov/tiles/50000_1/{z}/{x}/{y}.png", {
    attribution: 'NOAA Nautical Charts',
    opacity: 0.6,
    maxZoom: 15,
  });

  addStructureMarkers();
  addLaunchMarkers();
}

function toggleChartLayer() {
  const btn = $("toggle-chart");
  if (map.hasLayer(chartLayer)) {
    map.removeLayer(chartLayer);
    if(btn) btn.classList.remove("active");
  } else {
    chartLayer.addTo(map);
    if(btn) btn.classList.add("active");
  }
}

/* ================================================================
   STRUCTURE MARKERS
   ================================================================ */
function addStructureMarkers() {
  const typeColors = {
    island:"#2a6b4f", reef:"#c68b2c", shoal:"#9a7b3c", deep:"#2c4a6e",
    buoy:"#b84040", bar:"#6b5b3c", channel:"#3d7a9c", area:"#5a6b78", point:"#4a6858"
  };
  const typeIcons = {
    island:"\u25C6", reef:"\u25B2", shoal:"\u25B2", deep:"\u25CF",
    buoy:"\u25C9", bar:"\u2550", channel:"\u2503", area:"\u25CB", point:"\u25B8"
  };

  for (const s of STRUCTURE) {
    const c = typeColors[s.type] || "#5a6b78";
    const icon = L.divIcon({
      className: "map-marker",
      html: `<div class="mk-struct" style="--c:${c}"><span class="mk-icon">${typeIcons[s.type]||"\u25CF"}</span><span class="mk-name">${esc(s.name)}</span></div>`,
      iconSize: [140, 20], iconAnchor: [12, 10],
    });
    const m = L.marker([s.lat, s.lng], { icon }).addTo(map);
    const speciesStr = (s.species||[]).map(cap).join(", ");
    m.bindPopup(`<div class="pop"><h4>${esc(s.name)}</h4><table class="pop-t"><tr><td>Depth</td><td>${esc(s.depth||"varies")}</td></tr><tr><td>Species</td><td>${speciesStr}</td></tr></table><p>${esc(s.desc)}</p></div>`, { maxWidth: 300 });
    layers.structure.push(m);
  }
}

/* ================================================================
   LAUNCH MARKERS
   ================================================================ */
function addLaunchMarkers() {
  for (const l of LAUNCHES) {
    const icon = L.divIcon({
      className: "map-marker",
      html: `<div class="mk-launch"><span class="mk-lanchor">\u2693</span><span class="mk-name">${esc(l.name)}</span></div>`,
      iconSize: [160, 20], iconAnchor: [10, 10],
    });
    const m = L.marker([l.lat, l.lng], { icon }).addTo(map);
    m.bindPopup(`<div class="pop"><h4>${esc(l.name)}</h4><table class="pop-t"><tr><td>Ramps</td><td>${l.ramps}</td></tr><tr><td>Zone</td><td>${esc(zoneLabel(l.zone))}</td></tr></table><p>${esc(l.notes)}</p></div>`, { maxWidth: 280 });
    layers.launches.push(m);
  }
}

/* ================================================================
   SENSOR RENDERING ON MAP
   ================================================================ */
function renderSensorsOnMap(data) {
  layers.sensors.forEach(l => map.removeLayer(l));
  layers.sensors = [];
  if (!data?.stations || !data?.readings) return;

  for (const station of data.stations) {
    const r = data.readings[station.id] || {};
    if (r.error && !r.windMph && !r.flowCfs && !r.waterLevelFtIGLD) continue;

    // Skip inland gauges on map (show in overlay only)
    if (station.type === "stream-gauge") continue;

    let html;
    if (station.type === "buoy" || station.type === "weather-station") {
      const wc = r.windMph != null ? (r.windMph <= 10 ? "#2d8659" : r.windMph <= 18 ? "#c68b2c" : "#b84040") : "#5a6b78";
      html = `<div class="mk-sensor" style="--wc:${wc}">`;
      html += `<span class="mk-sname">${esc(station.name)}</span>`;
      if (r.windMph != null) html += `<span class="mk-wind" style="color:${wc}">${Math.round(r.windMph)} mph ${r.windDir||""}</span>`;
      if (r.airTempF != null) html += `<span class="mk-temp">Air ${Math.round(r.airTempF)}\u00B0</span>`;
      if (r.waterTempF != null) html += `<span class="mk-temp mk-wtemp">Water ${Math.round(r.waterTempF)}\u00B0</span>`;
      if (r.waveFt != null) html += `<span class="mk-temp">Waves ${r.waveFt} ft</span>`;
      html += `</div>`;
    } else if (station.type === "water-level") {
      const arrow = r.trendLabel === "Rising" ? "\u2191" : r.trendLabel === "Falling" ? "\u2193" : "\u2192";
      html = `<div class="mk-sensor mk-level"><span class="mk-sname">${esc(station.name)}</span>`;
      if (r.waterLevelFtIGLD != null) html += `<span class="mk-wind">${r.waterLevelFtIGLD} ft ${arrow}</span>`;
      html += `</div>`;
    } else continue;

    const icon = L.divIcon({ className:"map-marker", html, iconSize:[180,50], iconAnchor:[90,25] });
    const m = L.marker([station.lat, station.lng], { icon }).addTo(map);
    m.bindPopup(buildSensorPopup(station, r), { maxWidth:300 });
    layers.sensors.push(m);
  }

  renderOverlay(data);
}

function buildSensorPopup(station, r) {
  let h = `<div class="pop"><h4>${esc(station.name)}</h4><small>${esc(station.source)}</small><table class="pop-t">`;
  if (r.windMph != null) h += `<tr><td>Wind</td><td><strong>${r.windMph} mph ${r.windDir||""}</strong>${r.gustMph?` (G${r.gustMph})`:""}</td></tr>`;
  if (r.waveFt != null) h += `<tr><td>Waves</td><td>${r.waveFt} ft</td></tr>`;
  if (r.airTempF != null) h += `<tr><td>Air</td><td>${Math.round(r.airTempF)}\u00B0F</td></tr>`;
  if (r.waterTempF != null) h += `<tr><td>Water</td><td><strong>${Math.round(r.waterTempF)}\u00B0F</strong></td></tr>`;
  if (r.waterLevelFtIGLD != null) h += `<tr><td>Level</td><td><strong>${r.waterLevelFtIGLD} ft IGLD</strong> (${r.trendLabel||""})</td></tr>`;
  if (r.trend6hFt != null) h += `<tr><td>6h Change</td><td>${r.trend6hFt>0?"+":""}${r.trend6hFt} ft</td></tr>`;
  if (r.pressureMb != null) h += `<tr><td>Pressure</td><td>${r.pressureMb} mb</td></tr>`;
  h += `</table>`;
  if (r.observedAt) h += `<small>Observed ${relTime(r.observedAt)}</small>`;
  return h + "</div>";
}

/* ================================================================
   CONDITIONS OVERLAY (floating panel on map)
   ================================================================ */
function renderOverlay(sensorData) {
  const el = $("map-overlay");
  if (!el) return;
  const r = sensorData?.readings || {};
  const sblm4 = r["ndbc-sblm4"]||{};
  const tawas = r["ndbc-tawm4"]||{};
  const buoy = r["ndbc-45163"]||{};
  const river = r["usgs-04157005"]||{};
  const titt = r["usgs-04156000"]||{};
  const level = r["noaa-9075035"]||{};
  const mf = sensorData?.marineForecast?.innerBay || {};

  const items = [];
  if (sblm4.windMph!=null) items.push(ovItem("Bay Light",`${Math.round(sblm4.windMph)} mph ${sblm4.windDir||""}`));
  if (tawas.windMph!=null) items.push(ovItem("Tawas",`${Math.round(tawas.windMph)} mph`));
  if (buoy.waterTempF!=null) items.push(ovItem("Bay Water",`${Math.round(buoy.waterTempF)}\u00B0F`));
  if (river.waterTempF!=null) items.push(ovItem("River Temp",`${Math.round(river.waterTempF)}\u00B0F`));
  if (river.flowCfs!=null) items.push(ovItem("Sag River",`${river.flowCfs.toLocaleString()} cfs`));
  if (titt.flowCfs!=null) items.push(ovItem("Tittabawassee",`${titt.flowCfs.toLocaleString()} cfs`));
  if (level.waterLevelFtIGLD!=null) items.push(ovItem("Water Level",`${level.waterLevelFtIGLD} ft ${level.trendLabel||""}`));
  if (mf.advisory) items.push(`<div class="ov-item ov-alert"><span class="ov-v">${esc(mf.advisory.slice(0,80))}</span></div>`);
  else if (mf.today) items.push(`<div class="ov-item"><span class="ov-k">Forecast</span><span class="ov-v">${esc(mf.today.slice(0,60))}...</span></div>`);

  // Satellite SST link
  if (sensorData?.satellite?.imageUrl) {
    items.push(`<div class="ov-item"><a href="${esc(sensorData.satellite.imageUrl)}" target="_blank" class="ov-link">Satellite SST Map</a></div>`);
  }

  el.innerHTML = items.join("") || ovItem("Sensors","Loading...");
  el.style.display = items.length ? "flex" : "none";
}

function ovItem(k,v) { return `<div class="ov-item"><span class="ov-k">${esc(k)}</span><span class="ov-v">${esc(v)}</span></div>`; }

/* ================================================================
   REPORT HOTSPOTS ON MAP
   ================================================================ */
function renderReportsOnMap() {
  layers.reports.forEach(l=>map.removeLayer(l));
  layers.reports = [];
  if (!state.reports?.reports?.length) return;

  const ZC = {
    "west-side":[43.80,-83.91],"east-side":[43.71,-83.51],"inner-bay":[43.65,-83.82],
    "outer-bay":[43.96,-83.55],"river-mouth":[43.61,-83.86],"shipping-channel":[43.66,-83.80],
    "reefs":[43.82,-83.58],"bay-wide":[43.73,-83.75]
  };
  const byZone = {};
  for (const rpt of state.reports.reports) {
    const z = rpt.primaryZone||"bay-wide";
    if(!byZone[z]) byZone[z]=[];
    byZone[z].push(rpt);
  }
  for (const [zone,reports] of Object.entries(byZone)) {
    const center = ZC[zone]; if(!center) continue;
    const avg = reports.reduce((s,r)=>s+(r.signal||0),0)/reports.length;
    const c = avg>=0.3?"#2d8659":avg<=-0.15?"#b84040":"#c68b2c";
    const icon = L.divIcon({
      className:"map-marker",
      html:`<div class="mk-report" style="--c:${c}"><span class="mk-rcount">${reports.length}</span><span class="mk-rlabel">${sigWord(avg)}</span></div>`,
      iconSize:[70,22], iconAnchor:[35,11],
    });
    const m = L.marker(center,{icon}).addTo(map);
    const pop = reports.slice(0,3).map(r=>{
      const tags = [...(r.species||[]).map(cap),r.depth?`${r.depth.min}-${r.depth.max}ft`:null,...(r.lure||[])].filter(Boolean);
      return `<div class="pop-rpt"><p>${esc((r.summary||"").slice(0,120))}</p>${tags.length?`<small>${tags.join(" / ")}</small>`:""}</div>`;
    }).join("");
    m.bindPopup(`<div class="pop"><h4>${esc(zoneLabel(zone))} Reports (${reports.length})</h4><p>Signal: <strong style="color:${c}">${sigWord(avg)}</strong></p>${pop}</div>`,{maxWidth:320});
    layers.reports.push(m);
  }
}

/* ================================================================
   DATA FETCHING
   ================================================================ */
function init() { initMap(); updateSpeciesUI(); fetchSummary(); fetchSensors(); fetchReports(); }

async function fetchSummary(ai=false) {
  const sp=state.favorites.species||"walleye"; const day=getDateKey();
  const key=`${SNAP_PREFIX}:${sp}:${day}`;
  const c=loadStored(key,null);
  if(c?.snapshotDate===day&&c?.apiVersion===API_VER&&(!ai||c.captainNote?.text)){
    state.data=c;state.dataSource="local";state.error=null;state.loading=false;renderDash();return}
  state.loading=true;renderLoading();
  try{
    const p=new URLSearchParams({species:sp,day});if(ai)p.set("includeAi","1");
    const r=await fetch(`${SUMMARY_EP}?${p}`,{headers:{Accept:"application/json"}});
    if(!r.ok)throw new Error(`API ${r.status}`);
    const d=await r.json();d.snapshotDate=d.snapshotDate||day;
    state.data=d;state.dataSource="network";state.loading=false;state.error=null;saveStored(key,d);renderDash();
  }catch(e){state.error=e.message;state.loading=false;renderError();}
}
async function fetchSensors(){try{const r=await fetch(SENSORS_EP);if(!r.ok)throw new Error(`${r.status}`);state.sensors=await r.json();renderSensorsOnMap(state.sensors);if(state.data)renderConditions();}catch(e){console.warn("Sensors:",e.message);}}
async function fetchReports(){try{const r=await fetch(REPORTS_EP);if(!r.ok)throw new Error(`${r.status}`);state.reports=await r.json();renderReportsFeed();renderReportsOnMap();}catch(e){console.warn("Reports:",e.message);}}

/* ================================================================
   DASHBOARD RENDERING
   ================================================================ */
function renderDash(){renderBayCall();renderConditions();renderZones();renderLaunches();renderCaptainNote();}
function renderLoading(){ui.badge.className="bay-call-badge loading";ui.badge.querySelector(".call-label").textContent="Loading...";ui.updated.textContent="Fetching...";}
function renderError(){ui.badge.className="bay-call-badge nogo";ui.badge.querySelector(".call-label").textContent="Error";ui.updated.textContent=state.error||"Failed";}

function renderBayCall(){
  const d=state.data;if(!d)return;const bc=d.bayCall||{};
  ui.badge.className=`bay-call-badge ${bc.goNoGo==="GO"?"go":bc.goNoGo==="CAUTION"?"caution":"nogo"}`;
  ui.badge.querySelector(".call-label").textContent=bc.label||"Pending";
  ui.updated.textContent=`${d.snapshotDate||getDateKey()} | ${state.dataSource} | ${relTime(d.generatedAt)}`;
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
    {l:"Air Temp",v:c.airTempF!=null?`${Math.round(c.airTempF)}\u00B0F`:"--"},
    {l:"Water Temp",v:c.waterTempF!=null?`${Math.round(c.waterTempF)}\u00B0F`:"--"},
    {l:"Boat Window",v:c.smallBoatWindowHours!=null?`${c.smallBoatWindowHours} hrs (${c.smallBoatWindowLabel||""})`:"--"},
    {l:"Water Level",v:c.waterLevelFtIGLD!=null?`${fix(c.waterLevelFtIGLD,2)} ft IGLD`:"--"},
    {l:"Saginaw River",v:riv?.flowCfs?`${riv.flowCfs.toLocaleString()} cfs / ${Math.round(riv.waterTempF||0)}\u00B0F`:"--"},
    {l:"Tittabawassee",v:titt?.flowCfs?`${titt.flowCfs.toLocaleString()} cfs`:"--"},
    {l:"Advisories",v:c.alertHeadline||"None active"},
  ];
  ui.condGrid.innerHTML=fields.map(f=>`<div class="cond-box"><span class="cond-label">${esc(f.l)}</span><p class="cond-value">${esc(f.v)}</p></div>`).join("");
}

function renderZones(){
  const zones=state.data?.zones;if(!zones?.length)return;
  ui.zonesGrid.innerHTML=zones.map(z=>{
    const tone=z.tripScore>=72?"strong":z.tripScore>=56?"moderate":"weak";const a=z.action||{};
    return `<article class="zone-card"><div class="zone-head"><div><h3>${esc(z.name)}</h3><span class="zone-rec">${esc(z.recommendation||"")}</span></div><span class="score-badge ${tone}">${z.tripScore}</span></div><div class="zone-stats"><div class="zone-stat"><span class="stat-label">Safety</span><span class="stat-val">${z.safety}</span></div><div class="zone-stat"><span class="stat-label">Fishability</span><span class="stat-val">${z.fishability}</span></div><div class="zone-stat"><span class="stat-label">Signal</span><span class="stat-val">${z.recentSignal}</span></div><div class="zone-stat"><span class="stat-label">Confidence</span><span class="stat-val">${z.confidence}</span></div></div><div class="zone-action"><p><strong>Launch:</strong> ${esc(a.bestLaunchName||"N/A")}. ${esc(a.launchReason||"")}</p><p><strong>Window:</strong> ${esc(a.windowPlan||"")}</p><p><strong>Tactic:</strong> ${esc(a.technique||"")}</p></div></article>`;
  }).join("");
}

function renderLaunches(){
  const ls=state.data?.launches;if(!ls?.length)return;
  ui.launches.innerHTML=ls.slice(0,7).map(l=>`<article class="launch-card"><div class="launch-head"><div><h3>${esc(l.name)}</h3><span class="launch-meta">${esc(l.zoneName)} | Score ${l.score} | ${esc(l.advice)}</span></div></div><p class="launch-notes">${esc(l.exposureSummary)} ${esc(l.notes||"")}</p></article>`).join("");
}

function renderReportsFeed(){
  const rp=state.reports;if(!rp)return;
  const reports=rp.reports||[];const sources=rp.sources||[];const ok=sources.filter(s=>s.status==="ok").length;
  let h=`<p class="muted">${rp.totalReports} reports from ${ok}/${sources.length} sources</p><div class="source-badges">`;
  for(const src of sources){const c=src.status==="ok"?"src-ok":src.status==="error"?"src-err":"src-warn";h+=`<span class="src-badge ${c}">${esc(src.sourceName||src.source)} (${src.reportCount})</span>`;}
  h+='</div>';
  if(reports.length){h+=reports.slice(0,8).map(r=>{const sc=r.signal>=0.3?"sig-pos":r.signal<=-0.15?"sig-neg":"sig-mix";return `<article class="report-card"><div class="report-head"><h3>${esc(r.primaryZone?zoneLabel(r.primaryZone):"Bay-wide")}</h3><span class="report-meta ${sc}">${sigWord(r.signal)}</span></div><p class="report-summary">${esc(r.summary||"")}</p><div class="report-tags">${(r.species||[]).map(s=>`<span class="tag">${cap(s)}</span>`).join("")}${r.depth?`<span class="tag">${r.depth.min}-${r.depth.max}ft</span>`:""}${(r.lure||[]).map(l=>`<span class="tag">${esc(l)}</span>`).join("")}</div><span class="report-meta">${esc(r.sourceName||r.source)}</span></article>`;}).join("");}
  else{h+='<p class="muted">No reports. Sources may be offline or out of season.</p>';}
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
function relTime(i){if(!i)return"unknown";const ms=Date.now()-new Date(i).getTime();if(isNaN(ms))return"unknown";const min=Math.max(0,Math.round(ms/60000));if(min<1)return"just now";if(min<60)return`${min}m ago`;const hr=Math.round(min/60);return hr<24?`${hr}h ago`:`${Math.round(hr/24)}d ago`;}
function cap(v){return v?v[0].toUpperCase()+v.slice(1):"";}
function fix(v,d){return v!=null&&!isNaN(v)?Number(v).toFixed(d):"--";}
function esc(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function loadStored(k,fb){try{const r=localStorage.getItem(k);if(!r)return fb;const p=JSON.parse(r);return fb&&typeof fb==="object"&&!Array.isArray(fb)&&p&&typeof p==="object"&&!Array.isArray(p)?{...fb,...p}:p;}catch{return fb;}}
function saveStored(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch{}}

init();
