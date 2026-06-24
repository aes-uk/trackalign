import { useState, useEffect, useRef, useCallback } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";

const FONT_URL = "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Share+Tech+Mono&display=swap";

const T = {
  bg:"#050505", surface:"#f7f7f7", surfaceHigh:"#f7f7f7", surfaceTop:"#efefef",
  border:"rgba(255,255,255,0.08)", borderHi:"rgba(255,255,255,0.14)",
  accent:"#eb0000", accentFaint:"rgba(235,0,0,0.07)",
  green:"#16a34a", greenBright:"#16a34a",
  red:"#dc2626", redBright:"#ef4444", amber:"#d97706",
  text:"#050505", textDim:"rgba(5,5,5,0.55)", textMute:"rgba(5,5,5,0.25)", white:"#050505",
  overlay:"rgba(7,9,13,0.92)",
};
const FD="'Space Grotesk',sans-serif", FM="'Share Tech Mono',monospace", FB="'Space Grotesk',sans-serif";

/* ── Helpers ─────────────────────────────────────────────────── */
const uid    = () => Math.random().toString(36).slice(2,9);
const toNum  = v  => parseFloat(v)||0;
const AB     = Math.abs;
const clamp  = (v,lo,hi) => Math.min(Math.max(v,lo),hi);
const fmtV1  = v  => `${v>=0?"+":""}${v.toFixed(1)}`;
const fmtV2  = v  => `${v>=0?"+":""}${v.toFixed(2)}`;
const hasVal = v  => v!==null && v!=="" && !isNaN(parseFloat(v));

/* ── LocalStorage persistence ────────────────────────────────── */
const LS_KEY = "trackalign_jobs_v2";
const LS_MODE_KEY = "trackalign_mode_v1";
const LS_CONFIGS_KEY = "trackalign_configs_v1";
const LS_COMPANY_KEY = "trackalign_company_v1";

function loadCompany() {
  try { const r=localStorage.getItem(LS_COMPANY_KEY); return r?JSON.parse(r):{name:"",address:"",phone:"",email:"",website:""}; } catch(e){ return {name:"",address:"",phone:"",email:"",website:""}; }
}
function saveCompany(c) {
  try { localStorage.setItem(LS_COMPANY_KEY, JSON.stringify(c)); } catch(e){}
}

function loadConfigs() {
  try { const r=localStorage.getItem(LS_CONFIGS_KEY); return r?JSON.parse(r):[]; } catch(e){ return []; }
}
function saveConfigs(configs) {
  try { localStorage.setItem(LS_CONFIGS_KEY, JSON.stringify(configs)); } catch(e){}
}

/* ── Tolerance helpers ───────────────────────────────────────── */
// Returns "green"|"amber"|"red"|"none"
function trafficLight(value, tol) {
  if (!tol || !hasVal(tol.min) || !hasVal(tol.max)) return "none";
  if (!hasVal(value)) return "none";
  const v=parseFloat(value), lo=parseFloat(tol.min), hi=parseFloat(tol.max);
  if (v>=lo && v<=hi) return "green";
  return "red";
}
const TL_COLOR = { green:"#16a34a", amber:"#d97706", red:"#dc2626", none:"#050505" };
const TL_BG    = { green:"rgba(22,163,74,0.08)", amber:"rgba(217,119,6,0.08)", red:"rgba(220,38,38,0.08)", none:"#f7f7f7" };
const TL_BORDER= { green:"rgba(22,163,74,0.25)", amber:"rgba(217,119,6,0.25)", red:"rgba(220,38,38,0.25)", none:"rgba(5,5,5,0.10)" };

/* ── Degrees/minutes helpers (internal storage stays decimal degrees) ── */
// Returns {sign:1|-1, deg, min} with deg/min always non-negative, since iOS numeric
// keypads have no minus key — sign is toggled via a separate +/- button in the UI.
function decToDM(v) {
  if (v===""||v===null||v===undefined||isNaN(parseFloat(v))) return { sign:1, deg:"", min:"" };
  const num = parseFloat(v);
  const sign = num<0 ? -1 : 1;
  const abs = Math.abs(num);
  let deg = Math.floor(abs+1e-9);
  let min = Math.round((abs-deg)*60);
  if (min===60) { min=0; deg+=1; }
  return { sign, deg, min };
}
function dmToDec(sign, deg, min) {
  const dEmpty = deg===""||deg===undefined||deg===null;
  const mEmpty = min===""||min===undefined||min===null;
  if (dEmpty && mEmpty) return "";
  const d = dEmpty ? 0 : parseFloat(deg);
  const m = mEmpty ? 0 : parseFloat(min);
  if (isNaN(d) && isNaN(m)) return "";
  const dec = (sign<0?-1:1) * (Math.abs(isNaN(d)?0:d) + (isNaN(m)?0:m)/60);
  return dec;
}
function fDM(v) {
  if (v===null||v===undefined||v==="") return "—";
  const num = parseFloat(v);
  if (isNaN(num)) return "—";
  const sign = num<0 ? -1 : 1;
  const abs = Math.abs(num);
  let deg = Math.floor(abs+1e-9);
  let min = Math.round((abs-deg)*60);
  if (min===60) { min=0; deg+=1; }
  return `${sign<0?"-":""}${deg}°${String(min).padStart(2,"0")}'`;
}

/* ── Empty tolerance set ─────────────────────────────────────── */
function emptyTolerance() {
  return { min:"", max:"" };
}
function emptyAxleTolerance(type) {
  const base = {
    toeLeft:emptyTolerance(), toeRight:emptyTolerance(), totalToe:emptyTolerance(),
    camberLeft:emptyTolerance(), camberRight:emptyTolerance(),
    crossCamber:emptyTolerance(), outOfSquare:emptyTolerance(), parallelism:emptyTolerance(),
  };
  if (type==="steering"||type==="rear-steer") {
    Object.assign(base, {
      casterLeft:emptyTolerance(), casterRight:emptyTolerance(),
      kpiLeft:emptyTolerance(),    kpiRight:emptyTolerance(),
      crossCaster:emptyTolerance(), steeringMiddle:emptyTolerance(), twinsteer:emptyTolerance(),
      maxTurnLeft:emptyTolerance(), maxTurnRight:emptyTolerance(), turnDiff:emptyTolerance(),
    });
  }
  return base;
}

/* ── Config factories ────────────────────────────────────────── */
function makeConfigAxle(type, label) {
  return { id:uid(), label, type, dualWheel:false, tolerances:emptyAxleTolerance(type) };
}
function makeConfig(name="New Configuration") {
  return {
    id:uid(), name, createdAt:new Date().toISOString(),
    axles:[makeConfigAxle("steering","Front Steer"), makeConfigAxle("fixed","Non Steer")],
  };
}

function loadMode() {
  try { return localStorage.getItem(LS_MODE_KEY) || "direct"; } catch(e) { return "direct"; }
}
function saveMode(mode) {
  try { localStorage.setItem(LS_MODE_KEY, mode); } catch(e) {}
}

function loadJobs() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const jobs = JSON.parse(raw);
      // Normalise — guard against old data missing fields
      return jobs.map(j => ({
        ...j,
        axles: Array.isArray(j.axles) ? j.axles : [makeSteeringAxle("Front"), makeFixedAxle("Rear")],
        afterAxles: j.afterAxles ? (Array.isArray(j.afterAxles) ? j.afterAxles : null) : null,
        measureMethod: j.measureMethod || "direct",
      }));
    }
  } catch(e) {}
  return null;
}

function saveJobs(jobs) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(jobs)); } catch(e) {}
}

/* ── History helpers ─────────────────────────────────────────── */
function getCompanies(jobs) {
  const seen = new Set();
  return jobs
    .map(j => j.customer.company)
    .filter(c => c && c.trim() && !seen.has(c) && seen.add(c));
}

function getContactForCompany(jobs, company) {
  const match = [...jobs].reverse().find(j =>
    j.customer.company?.toLowerCase() === company?.toLowerCase()
  );
  if (!match) return null;
  return { name: match.customer.name, phone: match.customer.phone, email: match.customer.email };
}

function getVehiclesForCompany(jobs, company) {
  const seen = new Set();
  return jobs
    .filter(j => j.customer.company?.toLowerCase() === company?.toLowerCase())
    .map(j => j.vehicle)
    .filter(v => {
      const key = `${v.reg}|${v.make}|${v.model}|${v.year}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return v.reg || v.make || v.model;
    })
    .reverse();
}

function getMakes(jobs) {
  const seen = new Set();
  return jobs
    .map(j => j.vehicle.make)
    .filter(m => m && m.trim() && !seen.has(m.toLowerCase()) && seen.add(m.toLowerCase()));
}

function getModelsForMake(jobs, make) {
  if (!make || !make.trim()) return [];
  const seen = new Set();
  return jobs
    .filter(j => j.vehicle.make?.toLowerCase() === make.toLowerCase())
    .map(j => j.vehicle.model)
    .filter(m => m && m.trim() && !seen.has(m.toLowerCase()) && seen.add(m.toLowerCase()));
}

// Returns axle config (structure only, values cleared) from most recent job with same reg
function getAxlesForReg(jobs, reg, excludeId) {
  if (!reg || !reg.trim()) return null;
  const match = [...jobs]
    .filter(j => j.id !== excludeId && j.vehicle.reg?.toLowerCase() === reg.toLowerCase())
    .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  if (!match || !Array.isArray(match.axles)) return null;
  return match.axles.map(a => {
    // Only copy structure — label, type, config toggles. Clear ALL readings.
    const base = {
      id: uid(),
      label:     a.label,
      type:      a.type,
      dualWheel: a.dualWheel || false,
      // Steering config
      driveSide: a.driveSide || "RHD",
      suspType:  a.suspType  || "solid",
      // All readings blank
      toeLeft:"", toeRight:"",
      camberLeft:"", camberRight:"",
      casterLeft:"", casterRight:"",
      kpiLeft:"",    kpiRight:"",
      maxTurnLeft:"", maxTurnRight:"",
      tootLeft:"",    tootRight:"",
      // Josam fields blank
      axleDistance:"",
      frontScaleLeft:"", rearScaleLeft:"",
      frontScaleRight:"", rearScaleRight:"",
      targetToeLeft:"", targetToeRight:"",
    };
    return base;
  });
}

/* ── Calc engine ─────────────────────────────────────────────── */
function calcToe(tL, tR) {
  const l=toNum(tL), r=toNum(tR);
  const total=l+r, oos=(r-l)/2;
  return { l, r, total, outOfSquare:oos, oosLeft:oos>=0 };
}

function calcSteeringMiddle(axle) {
  const { suspType, driveSide, toeLeft, toeRight } = axle;
  if (!hasVal(toeLeft) && !hasVal(toeRight)) return null;
  if (suspType==="independent") {
    const { outOfSquare, oosLeft } = calcToe(toeLeft, toeRight);
    return { value:outOfSquare, label:"Steering Middle (Double)", leftSide:oosLeft };
  }
  const useLeft = driveSide==="LHD";
  return { value:toNum(useLeft?toeLeft:toeRight), label:"Steering Middle (Single)", leftSide:useLeft };
}

// Normalise SM to a common right-wheel reference for twinsteer comparison
// Independent: OOS value is already symmetric, no change needed
// Solid RHD: uses right toe — already right-referenced, no change
// Solid LHD: uses left toe — flip sign so it's right-referenced
function normaliseSMForTwinsteer(axle, smValue) {
  if (!axle || axle.suspType==="independent") return smValue;
  // Solid LHD: steering box is on left, so SM = toeLeft. Negate to right-reference.
  if (axle.driveSide==="LHD") return -smValue;
  return smValue; // Solid RHD: already right-referenced
}

// Calculate vehicle-level parallelism: max spread of OOS across all fixed+rear-steer axles
// Returns null if fewer than 2 eligible axles have data
function calcVehicleParallelism(axles, fullDistance) {
  const D = parseFloat(fullDistance)||0;
  const eligible = axles.filter(a=>a.type==="fixed"||a.type==="rear-steer");
  if (eligible.length < 2) return null;

  const oosValues = eligible.map(a=>{
    // Josam mode: derive toe from scales
    let tL = a.toeLeft, tR = a.toeRight;
    if (D>0 && !hasVal(tL) && hasVal(a.frontScaleLeft) && hasVal(a.rearScaleLeft)) {
      tL = String((parseFloat(a.frontScaleLeft)-parseFloat(a.rearScaleLeft))/D);
    }
    if (D>0 && !hasVal(tR) && hasVal(a.frontScaleRight) && hasVal(a.rearScaleRight)) {
      tR = String((parseFloat(a.frontScaleRight)-parseFloat(a.rearScaleRight))/D);
    }
    if (!hasVal(tL) || !hasVal(tR)) return null;
    return calcToe(tL, tR).outOfSquare;
  });

  if (oosValues.some(v=>v===null)) return null;
  const maxOOS = Math.max(...oosValues);
  const minOOS = Math.min(...oosValues);
  return { value: maxOOS - minOOS, axleCount: eligible.length };
}

/* ── Data factories ──────────────────────────────────────────── */
function makeSteeringAxle(label="Front Steer") {
  return { id:uid(), label, type:"steering", driveSide:"RHD", suspType:"solid",
    toeLeft:"", toeRight:"", camberLeft:"", camberRight:"",
    casterLeft:"", casterRight:"", kpiLeft:"", kpiRight:"",
    maxTurnLeft:"", maxTurnRight:"", tootLeft:"", tootRight:"",
    axleDistance:"",
    frontScaleLeft:"", rearScaleLeft:"", frontScaleRight:"", rearScaleRight:"",
    targetToeLeft:"", targetToeRight:"",
    tolerances: emptyAxleTolerance("steering") };
}
function makeRearSteerAxle(label="Rear Steer") {
  return { id:uid(), label, type:"rear-steer",
    toeLeft:"", toeRight:"", camberLeft:"", camberRight:"",
    casterLeft:"", casterRight:"", kpiLeft:"", kpiRight:"",
    maxTurnLeft:"", maxTurnRight:"", tootLeft:"", tootRight:"",
    axleDistance:"",
    frontScaleLeft:"", rearScaleLeft:"", frontScaleRight:"", rearScaleRight:"",
    targetToeLeft:"", targetToeRight:"",
    tolerances: emptyAxleTolerance("rear-steer") };
}
function makeFixedAxle(label="Non Steer") {
  return { id:uid(), label, type:"fixed",
    toeLeft:"", toeRight:"", camberLeft:"", camberRight:"", dualWheel:false,
    axleDistance:"",
    frontScaleLeft:"", rearScaleLeft:"", frontScaleRight:"", rearScaleRight:"",
    targetToeLeft:"", targetToeRight:"",
    tolerances: emptyAxleTolerance("fixed") };
}
function makeJob() {
  return { id:uid(), createdAt:new Date().toISOString(), syncStatus:"local",
    customer:{ company:"", name:"", phone:"", email:"" },
    vehicle:{ reg:"", make:"", model:"", year:"", mileage:"" },
    axles:[makeSteeringAxle("Front Steer"), makeFixedAxle("Non Steer")],
    afterAxles:null, fullDistance:"",
    configId:null, configName:null,
    notes:"" };
}


/* ── Demo data ───────────────────────────────────────────────── */
const DEMO=[
  { id:"d1", createdAt:"2026-04-22T08:30:00Z", syncStatus:"synced",
    customer:{ company:"Whitfield Transport", name:"James Whitfield", phone:"0412 345 678", email:"james@whitfield.com" },
    vehicle:{ reg:"1ABC 234", make:"Toyota", model:"LandCruiser 300", year:"2022", mileage:"" },
    axles:[
      { id:"a1", label:"Front", type:"steering", driveSide:"RHD", suspType:"solid",
        toeLeft:"+1.0", toeRight:"-2.0", camberLeft:"+0.5", camberRight:"-0.8",
        casterLeft:"+3.8", casterRight:"+3.5", kpiLeft:"12.0", kpiRight:"11.8",
        maxTurnLeft:"38", maxTurnRight:"32", tootLeft:"2.5", tootRight:"2.2" },
      { id:"a2", label:"Rear", type:"fixed", toeLeft:"+3.0", toeRight:"-2.0", camberLeft:"-0.5", camberRight:"-0.3", dualWheel:false },
    ], notes:"" },
  { id:"d2", createdAt:"2026-04-28T14:10:00Z", syncStatus:"synced",
    customer:{ company:"Whitfield Transport", name:"James Whitfield", phone:"0412 345 678", email:"james@whitfield.com" },
    vehicle:{ reg:"1ABC 235", make:"Toyota", model:"HiLux SR5", year:"2023", mileage:"" },
    axles:[makeSteeringAxle("Front Steer"), makeFixedAxle("Non Steer")],
    notes:"" },
  { id:"d3", createdAt:"2026-04-30T14:10:00Z", syncStatus:"local",
    customer:{ company:"Sara Chen", name:"Sara Chen", phone:"0498 765 432", email:"sara@example.com" },
    vehicle:{ reg:"XYZ 789", make:"Ford", model:"Transit Van", year:"2023", mileage:"" },
    axles:[
      { id:"a3", label:"Front", type:"steering", driveSide:"RHD", suspType:"independent",
        toeLeft:"+1.0", toeRight:"+2.0", camberLeft:"-0.3", camberRight:"-0.5",
        casterLeft:"+4.0", casterRight:"+3.8", kpiLeft:"13.0", kpiRight:"13.2",
        maxTurnLeft:"40", maxTurnRight:"40", tootLeft:"", tootRight:"" },
      { id:"a4", label:"Rear", type:"fixed", toeLeft:"+1.5", toeRight:"+1.5", camberLeft:"", camberRight:"", dualWheel:false },
    ], notes:"" },
  { id:"d4", createdAt:"2026-05-01T09:00:00Z", syncStatus:"local",
    customer:{ company:"Raj Haulage Pty Ltd", name:"Raj Patel", phone:"0411 222 333", email:"raj@rajhaulage.com" },
    vehicle:{ reg:"TRK 001", make:"Volvo", model:"FH16", year:"2021", mileage:"" },
    axles:[
      { id:"a5", label:"Front Steer", type:"steering", driveSide:"LHD", suspType:"solid",
        toeLeft:"+2.0", toeRight:"+1.0", camberLeft:"-0.5", camberRight:"-0.5",
        casterLeft:"+5.0", casterRight:"+5.0", kpiLeft:"8.0", kpiRight:"8.0",
        maxTurnLeft:"42", maxTurnRight:"42", tootLeft:"3.0", tootRight:"3.0" },
      { id:"a6", label:"Rear Drive", type:"fixed", toeLeft:"+1.0", toeRight:"+1.0", camberLeft:"", camberRight:"", dualWheel:false },
      { id:"a7", label:"Rear Tag",   type:"fixed", toeLeft:"+0.5", toeRight:"-0.5", camberLeft:"", camberRight:"", dualWheel:false },
    ], notes:"3-axle truck" },
];

/* ══════════════════════════════════════════════════════════════
   SVG ATOMS
══════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════
   AXLE DIAGRAM COMPONENTS
   7 types: solidSteering, solidFixed, solidRearSteer, solidSecondSteer
            dualFixed, independent, tagAxle
══════════════════════════════════════════════════════════════ */

/* Tyre SVG — bird's eye, W×H, with tread blocks */
/* ═══════════════════════════════════════════════════════════
   AXLE DIAGRAM COMPONENTS
   Three axle types matching reference images:
   1. NonSteerSingle  — beam + hubs, no steering gear
   2. SteerAxle       — beam + hubs + steering arms + track rod
   3. NonSteerDual    — beam + close dual tyres + thin connector plates
   All share same outer tyre x positions so they align in report columns.
═══════════════════════════════════════════════════════════ */

/*
  AxleSVGDefs — gradients used by all axle drawings.
  Must be rendered once inside any SVG that uses the axle components.
*/
function AxleSVGDefs() {
  return (
    <defs>
      <linearGradient id="axBeam" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%"   stopColor="#b0b0b0"/>
        <stop offset="30%"  stopColor="#f0f0f0"/>
        <stop offset="50%"  stopColor="#ffffff"/>
        <stop offset="70%"  stopColor="#e0e0e0"/>
        <stop offset="100%" stopColor="#909090"/>
      </linearGradient>
      <linearGradient id="axHub" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%"   stopColor="#888"/>
        <stop offset="35%"  stopColor="#ddd"/>
        <stop offset="50%"  stopColor="#eee"/>
        <stop offset="65%"  stopColor="#ccc"/>
        <stop offset="100%" stopColor="#777"/>
      </linearGradient>
      <linearGradient id="axTyre" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%"   stopColor="#1a1a1a"/>
        <stop offset="25%"  stopColor="#3a3a3a"/>
        <stop offset="50%"  stopColor="#444"/>
        <stop offset="75%"  stopColor="#2a2a2a"/>
        <stop offset="100%" stopColor="#111"/>
      </linearGradient>
      <linearGradient id="axTrod" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%"   stopColor="#999"/>
        <stop offset="50%"  stopColor="#ddd"/>
        <stop offset="100%" stopColor="#888"/>
      </linearGradient>
      <linearGradient id="axPlate" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%"   stopColor="#999"/>
        <stop offset="40%"  stopColor="#eee"/>
        <stop offset="60%"  stopColor="#fff"/>
        <stop offset="100%" stopColor="#999"/>
      </linearGradient>
    </defs>
  );
}

/*
  SingleTyre — one tyre rect with tread lines and rolling direction line (rotated with toe)
  cx, cy = centre position
  tw = tyre width, th = tyre height
  toeRot = SVG rotation degrees
  rollDir = true to show rolling direction line
  opacity = for inner dual tyres
*/
function SingleTyre({ cx, cy, tw, th, toeRot=0, rollDir=true, opacity=1 }) {
  const treadSpacing = th / 11;
  const treads = [];
  for (let i = 1; i <= 10; i++) {
    treads.push(
      <line key={i}
        x1={-tw/2+3} y1={-th/2 + i*treadSpacing}
        x2={tw/2-3}  y2={-th/2 + i*treadSpacing}
        stroke="#222" strokeWidth="1.2" opacity="0.6"/>
    );
  }
  return (
    <g transform={`translate(${cx},${cy}) rotate(${toeRot})`} opacity={opacity}>
      <rect x={-tw/2} y={-th/2} width={tw} height={th} rx={Math.round(tw*0.28)} fill="url(#axTyre)"/>
      <rect x={-tw/2+2} y={-th/2+2} width={tw-4} height={th-4} rx={Math.round(tw*0.2)} fill="none" stroke="#555" strokeWidth="0.4"/>
      {treads}
      {rollDir && <line x1="0" y1={th/2} x2="0" y2={-th/2-14} stroke="#eb0000" strokeWidth="1.3" strokeDasharray="5 3"/>}
    </g>
  );
}

/*
  HubAndTaper — the hub stub + tapered end connecting tyre to beam
  side: "left" or "right"
  hubX = x of hub inner edge (beam side)
  cy = axle centre y
*/
function HubAndTaper({ side, hubX, cy, hubW=14, hubH=16, taperW=12 }) {
  const isLeft = side === "left";
  // hub rect
  const hx = isLeft ? hubX - hubW - taperW : hubX + taperW;
  // taper polygon: narrows from hub to beam
  const tx = isLeft ? hubX - taperW : hubX;
  const pts = isLeft
    ? `${tx},${cy-hubH/2} ${tx+taperW},${cy-hubH/2+2} ${tx+taperW},${cy+hubH/2-2} ${tx},${cy+hubH/2}`
    : `${tx},${cy-hubH/2+2} ${tx+taperW},${cy-hubH/2} ${tx+taperW},${cy+hubH/2} ${tx},${cy+hubH/2-2}`;
  return (
    <g>
      <rect x={hx} y={cy-hubH/2} width={hubW} height={hubH} rx="3" fill="url(#axHub)" stroke="#999" strokeWidth="0.5"/>
      <circle cx={hx + (isLeft ? hubW/2 : hubW/2)} cy={cy} r={hubH*0.28} fill="none" stroke="#bbb" strokeWidth="1.2"/>
      <circle cx={hx + (isLeft ? hubW/2 : hubW/2)} cy={cy} r={hubH*0.12} fill="#aaa"/>
      <polygon points={pts} fill="#d0d0d0" stroke="#bbb" strokeWidth="0.4"/>
    </g>
  );
}

/*
  AxleDiagramNew — renders correct axle type from reference images
  Props:
    axleType: "fixed" | "steering" | "rear-steer"
    dual: bool
    toeLeft, toeRight: numbers (mm)
    width: SVG width
    scale: overall scale factor (default 1, use 0.5 for measurement screen)
*/
function AxleDiagramNew({ axleType="fixed", dual=false, toeLeft=0, toeRight=0,
  width=280, driveSide="RHD", steerIndex=0, oosTilt=0, noRoll=false }) {

  // ── Base design dimensions (at BASE_W=520) ──
  const TW = 38;    // tyre width
  const TH = 119;   // tyre height
  const GAP = 4;    // gap between dual tyres
  const HUB_W = 14; // hub width (perpendicular to axle)
  const HUB_H = 16; // hub height (along axle direction)
  const TAPER_W = 10;
  const BEAM_H = 12;
  const BASE_W = 520;

  const scale = width / BASE_W;
  const s = v => v * scale;

  // Tyre dimensions scaled
  const tw = s(TW), th = s(TH), gap = s(GAP);

  // SVG height: tyre height + room for track rod below (steer) or just tyre
  const isSteer = axleType === "steering" || axleType === "rear-steer";
  const isRearSteer = axleType === "rear-steer";
  const extraBelow = isSteer ? s(28) : s(4);
  const extraAbove = s(4);
  const SVG_H = th + extraAbove + extraBelow;
  const cy = extraAbove + th/2;  // axle centre y

  // ── X positions (all in scaled coords) ──
  // Outer tyre left edge
  const ol_x = s(68);
  const or_x = s(414);

  // Tyre centres
  const lOCX = ol_x + tw/2;
  const rOCX = or_x + tw/2;

  // Dual: inner tyre sits GAP away from outer inner face
  const lInnerX = ol_x + tw + gap;
  const rInnerX = or_x - tw - gap;
  const lICX = lInnerX + tw/2;
  const rICX = rInnerX + tw/2;

  // Axle/hub inner edges (where hub meets beam)
  // Single: just inside outer tyre inner face
  // Dual: just inside inner tyre inner face
  const lHubEdge = dual ? lInnerX + tw : ol_x + tw;
  const rHubEdge = dual ? rInnerX      : or_x;

  // Hub outer edges (away from beam, towards tyre)
  const lHubOuter = lHubEdge - s(HUB_H);
  const rHubOuter = rHubEdge + s(HUB_H);

  // Beam spans between taper ends
  const beamL = lHubEdge + s(TAPER_W);
  const beamR = rHubEdge - s(TAPER_W);

  // ── Toe rotation ──
  // Convention (bird's eye, vehicle going up):
  //   Positive toe = toe-IN
  //   Left wheel toe-in: top leans RIGHT = positive SVG rotate
  //   Right wheel toe-in: top leans LEFT = negative SVG rotate
  const toeScale = 2.0;
  const rotL =  toeLeft  * toeScale;  // positive toe = lean in (right)
  const rotR = -toeRight * toeScale;  // positive toe = lean in (left)

  // ── Padding so OOS tilt doesn't clip — define BEFORE anything uses CY ──
  const PAD = Math.round(th * 0.18);
  const CANVAS_H = SVG_H + PAD * 2;
  const CY = cy + PAD; // axle centre y in padded canvas

  // ── Track rod ──
  const ARM_LEN = s(20);
  const trDir = 1; // track rod always below axle in diagram
  const trY = CY + trDir * ARM_LEN;
  // Ball joints: inside inner tyre face, outside beam end
  const bjL = lHubEdge + s(2);
  const bjR = rHubEdge - s(2);

  // ── Connector plates (dual) ──
  const platH = th * 0.7;
  const platY = CY - platH/2;
  const lPlatX = ol_x + tw + 0.5;
  const rPlatX = or_x - gap - s(2.5);

  return (
    <svg width={width} height={CANVAS_H}
      style={{display:"block", overflow:"hidden"}}
      viewBox={`0 0 ${width} ${CANVAS_H}`}>
      <AxleSVGDefs/>

      {/* ── OOS tilt wraps entire axle group ── */}
      <g transform={`rotate(${oosTilt}, ${width/2}, ${CY})`}>

        {/* Render order: beam/hubs first so tyres appear on top */}

        {/* Hub left */}
        <rect x={lHubOuter} y={CY - s(HUB_W/2)}
          width={s(HUB_H)} height={s(HUB_W)} rx={s(3)}
          fill="url(#axHub)" stroke="#999" strokeWidth="0.5"/>
        <circle cx={lHubOuter + s(HUB_H/2)} cy={CY}
          r={s(HUB_W*0.28)} fill="none" stroke="#bbb" strokeWidth="1"/>
        <circle cx={lHubOuter + s(HUB_H/2)} cy={CY}
          r={s(HUB_W*0.12)} fill="#aaa"/>

        {/* Taper left */}
        <polygon
          points={`${lHubEdge},${CY-s(HUB_W/2)+s(2)} ${lHubEdge+s(TAPER_W)},${CY-s(BEAM_H/2)} ${lHubEdge+s(TAPER_W)},${CY+s(BEAM_H/2)} ${lHubEdge},${CY+s(HUB_W/2)-s(2)}`}
          fill="#ccc" stroke="#bbb" strokeWidth="0.3"/>

        {/* Beam */}
        <rect x={beamL} y={CY - s(BEAM_H/2)}
          width={beamR - beamL} height={s(BEAM_H)} rx={s(2)}
          fill="url(#axBeam)" stroke="#bbb" strokeWidth="0.4"/>

        {/* Taper right */}
        <polygon
          points={`${beamR},${CY-s(BEAM_H/2)} ${rHubEdge},${CY-s(HUB_W/2)+s(2)} ${rHubEdge},${CY+s(HUB_W/2)-s(2)} ${beamR},${CY+s(BEAM_H/2)}`}
          fill="#ccc" stroke="#bbb" strokeWidth="0.3"/>

        {/* Hub right */}
        <rect x={rHubEdge} y={CY - s(HUB_W/2)}
          width={s(HUB_H)} height={s(HUB_W)} rx={s(3)}
          fill="url(#axHub)" stroke="#999" strokeWidth="0.5"/>
        <circle cx={rHubEdge + s(HUB_H/2)} cy={CY}
          r={s(HUB_W*0.28)} fill="none" stroke="#bbb" strokeWidth="1"/>
        <circle cx={rHubEdge + s(HUB_H/2)} cy={CY}
          r={s(HUB_W*0.12)} fill="#aaa"/>

        {/* Steer: arms + track rod (drawn before tyres so tyres overlap) */}
        {isSteer && <>
          <line x1={bjL} y1={CY} x2={bjL} y2={trY}
            stroke="#888" strokeWidth={s(3)} strokeLinecap="round"/>
          <line x1={bjR} y1={CY} x2={bjR} y2={trY}
            stroke="#888" strokeWidth={s(3)} strokeLinecap="round"/>
          <rect x={bjL + s(4)} y={trY - s(3)}
            width={bjR - bjL - s(8)} height={s(6)} rx={s(3)}
            fill="url(#axTrod)" stroke="#aaa" strokeWidth="0.4"/>
          <circle cx={bjL + s(4)} cy={trY} r={s(4)} fill="#bbb" stroke="#888" strokeWidth="0.7"/>
          <circle cx={bjR - s(4)} cy={trY} r={s(4)} fill="#bbb" stroke="#888" strokeWidth="0.7"/>
        </>}

        {/* Rear steer / tag axle: same track rod as steering — no ram on measurement/report diagram */}

        {/* Connector plates for dual (behind inner tyre) */}
        {dual && <>
          <rect x={lPlatX}          y={platY} width={s(2)} height={platH} rx="0.5" fill="url(#axPlate)"/>
          <rect x={lPlatX + s(3.5)} y={platY} width={s(2)} height={platH} rx="0.5" fill="url(#axPlate)"/>
          <rect x={rPlatX}          y={platY} width={s(2)} height={platH} rx="0.5" fill="url(#axPlate)"/>
          <rect x={rPlatX + s(3.5)} y={platY} width={s(2)} height={platH} rx="0.5" fill="url(#axPlate)"/>
        </>}

        {/* Tyres rendered LAST so they sit on top of hub/beam */}
        {/* Left outer */}
        <SingleTyre cx={lOCX} cy={CY} tw={tw} th={th} toeRot={rotL} rollDir={!noRoll}/>
        {/* Left inner (dual) */}
        {dual && <SingleTyre cx={lICX} cy={CY} tw={tw} th={th} toeRot={rotL} opacity={0.93} rollDir={!noRoll}/>}
        {/* Right inner (dual) */}
        {dual && <SingleTyre cx={rICX} cy={CY} tw={tw} th={th} toeRot={rotR} opacity={0.93} rollDir={!noRoll}/>}
        {/* Right outer */}
        <SingleTyre cx={rOCX} cy={CY} tw={tw} th={th} toeRot={rotR} rollDir={!noRoll}/>

      </g>{/* end OOS tilt group */}
    </svg>
  );
}

/* ─── Legacy AxleDefs / TyreSVG / AxleDiagram kept for compatibility ─── */
function TyreSVG({ w=11, h=34, fill="#2a2a2a", stroke="#444" }) {
  const inner = { x:2, y:2, w:w-4, h:h-4 };
  const blocks = [];
  for (let y=3; y<h-6; y+=6) {
    blocks.push(<rect key={`l${y}`} x={2} y={y} width={3} height={4} rx="0.5" fill="#1a1a1a"/>);
    blocks.push(<rect key={`r${y}`} x={w-5} y={y+2} width={3} height={4} rx="0.5" fill="#1a1a1a"/>);
  }
  return (
    <g>
      <rect x={0} y={0} width={w} height={h} rx={3} fill={fill}/>
      <rect x={inner.x} y={inner.y} width={inner.w} height={inner.h} rx={2} fill="#333"/>
      <rect x={w/2-2} y={2} width={4} height={h-4} rx={1} fill="#2a2a2a"/>
      {blocks}
    </g>
  );
}
function AxleDefs() {
  return (
    <defs>
      <linearGradient id="adBeam" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#d0d0d0"/><stop offset="40%" stopColor="#f0f0f0"/>
        <stop offset="60%" stopColor="#e0e0e0"/><stop offset="100%" stopColor="#b0b0b0"/>
      </linearGradient>
      <linearGradient id="adTrod" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#b0b0b0"/><stop offset="50%" stopColor="#d8d8d8"/>
        <stop offset="100%" stopColor="#a0a0a0"/>
      </linearGradient>
      <linearGradient id="adArm" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#c0c0c0"/><stop offset="50%" stopColor="#e4e4e4"/>
        <stop offset="100%" stopColor="#b0b0b0"/>
      </linearGradient>
    </defs>
  );
}
function AxleDiagram({ axleType="fixed", suspType="solid", driveSide="RHD",
  dual=false, steerIndex=0, toeLeft=0, toeRight=0, width=320 }) {
  return <AxleDiagramNew axleType={axleType} dual={dual} toeLeft={toeLeft}
    toeRight={toeRight} width={width} driveSide={driveSide} steerIndex={steerIndex}/>;
}

/* WheelPair — measurement screen axle diagram using AxleDiagramNew */
function WheelPair({ toeLeft="", toeRight="", size=198, dual=false,
  axleType="fixed", driveSide="RHD", steerIndex=0 }) {
  const tL = hasVal(toeLeft)  ? parseFloat(toeLeft)  : 0;
  const tR = hasVal(toeRight) ? parseFloat(toeRight) : 0;
  // OOS for non-steer axles: cap at 5mm so diagram doesn't overlap boxes
  const isFixed = axleType === "fixed" || axleType === "rear-steer";
  let oosTilt = 0;
  if (isFixed && hasVal(toeLeft) && hasVal(toeRight)) {
    const oos = (tR - tL) / 2;
    const oosAbs = Math.min(Math.abs(oos), 5); // cap at 5mm
    const oosSign = oos < 0 ? 1 : -1;
    oosTilt = oosAbs <= 2 ? 0 : oosSign * Math.min((oosAbs - 2) * 2.5, 12);
  }
  return (
    <div style={{width:size, overflow:"visible", display:"flex", alignItems:"center", justifyContent:"center"}}>
      <AxleDiagramNew
        axleType={axleType} dual={dual}
        toeLeft={tL} toeRight={tR}
        driveSide={driveSide} steerIndex={steerIndex}
        oosTilt={oosTilt}
        noRoll={!hasVal(toeLeft)&&!hasVal(toeRight)}
        width={size}/>
    </div>
  );
}

function ToeBar({ value="", max=15, mirror=false }) {
  const v=toNum(value), pct=clamp(AB(v)/max,0,1), half=50;
  const bw=pct*(half-4);
  const col=v>0?"#050505":v<0?"#050505":"#aaaaaa";
  const barX = mirror
    ? (v>=0 ? half-bw : half)
    : (v>=0 ? half    : half-bw);
  return (
    <div style={{width:"100%",overflow:"hidden"}}>
      <svg width="100%" height="18" viewBox="0 0 100 18" preserveAspectRatio="none">
        <rect x={2} y={7} width={96} height={4} rx={2} fill='#d0d0d0'/>
        {bw>0&&<rect x={barX} y={5.5} width={bw} height={7} rx={2} fill={col} opacity={0.9}/>}
        <rect x={half-0.8} y={2} width={1.6} height={14} rx={1} fill='#050505'/>
        {[-33,-17,17,33].map((f,i)=>(
          <line key={i} x1={half+f*0.96} y1={6} x2={half+f*0.96} y2={12}
            stroke='rgba(5,5,5,0.3)' strokeWidth={0.8}/>
        ))}
      </svg>
    </div>
  );
}

function TurningDiagram({ left="", right="" }) {
  const la=clamp(toNum(left),0,55), ra=clamp(toNum(right),0,55);
  const W=232,H=108,cx=W/2,cy=H-8,R=88;
  const rad=d=>d*Math.PI/180;
  const pt=(d,r)=>[cx-Math.sin(rad(d))*r, cy-Math.cos(rad(d))*r];
  const [lx,ly]=pt(la,R),[rx,ry]=pt(ra,R);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <path d={`M${cx-R} ${cy} A${R} ${R} 0 0 1 ${cx+R} ${cy}`} fill="none" stroke='#ddd' strokeWidth={1}/>
      <path d={`M${cx-(R-16)} ${cy} A${R-16} ${R-16} 0 0 1 ${cx+(R-16)} ${cy}`}
        fill="none" stroke='#ccc' strokeWidth={0.8} strokeDasharray='3 4'/>
      <line x1={cx} y1={cy} x2={cx} y2={cy-R} stroke='#ccc' strokeWidth={1} strokeDasharray='3 3'/>
      {[10,20,30,40,50].map(d=>{
        const [ox,oy]=pt(d,R),[ix,iy]=pt(d,R-10);
        return (
          <g key={d}>
            <line x1={ox} y1={oy} x2={ix} y2={iy} stroke='rgba(5,5,5,0.3)' strokeWidth={0.8}/>
            <line x1={cx+(cx-ox)} y1={oy} x2={cx+(cx-ix)} y2={iy} stroke='rgba(5,5,5,0.3)' strokeWidth={0.8}/>
            <text x={ix-9} y={iy+3} fill='rgba(5,5,5,0.4)' fontSize={6} fontFamily={FM}>{d}</text>
            <text x={cx+(cx-ix)+2} y={iy+3} fill='rgba(5,5,5,0.4)' fontSize={6} fontFamily={FM}>{d}</text>
          </g>
        );
      })}
      {left!==""&&<><line x1={cx} y1={cy} x2={lx} y2={ly} stroke={T.accent} strokeWidth={2.5}/><circle cx={lx} cy={ly} r={3.5} fill={T.accent}/><text x={lx-10} y={ly-6} fill={T.accent} fontSize={10} fontFamily={FM} fontWeight="bold">{left}°</text></>}
      {right!==""&&<><line x1={cx} y1={cy} x2={cx+(cx-rx)} y2={ry} stroke={T.accent} strokeWidth={2.5}/><circle cx={cx+(cx-rx)} cy={ry} r={3.5} fill={T.accent}/><text x={cx+(cx-rx)+4} y={ry-6} fill={T.accent} fontSize={10} fontFamily={FM} fontWeight="bold">{right}°</text></>}
    </svg>
  );
}

/* ══════════════════════════════════════════════════════════════
   UI ATOMS
══════════════════════════════════════════════════════════════ */
function Field({ label, value, onChange, onBlur, placeholder="", unit="" }) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:4,minWidth:0}}>
      <label style={{fontSize:10,letterSpacing:"0.08em",color:"#050505",fontFamily:FB,textTransform:"uppercase"}}>{label}</label>
      <div style={{display:"flex",alignItems:"center",background:"#e5e5e5",border:"1px solid rgba(5,5,5,0.10)",borderRadius:"0.3rem",overflow:"hidden",minWidth:0}}>
        <input value={value} onChange={e=>onChange(e.target.value)}
          onBlur={onBlur ? e=>onBlur(e.target.value) : undefined}
          placeholder={placeholder}
          style={{flex:1,minWidth:0,background:"transparent",border:"none",outline:"none",padding:"8px 10px",color:"#050505",fontFamily:FM,fontSize:13}}/>
        {unit&&<span style={{padding:"0 8px",color:T.textDim,fontFamily:FM,fontSize:10,borderLeft:`1px solid ${T.border}`,flexShrink:0}}>{unit}</span>}
      </div>
    </div>
  );
}

/* Autocomplete field */
function AutoField({ label, value, onChange, suggestions=[], placeholder="", onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const filtered = suggestions.filter(s =>
    s.toLowerCase().includes(value.toLowerCase()) && s.toLowerCase() !== value.toLowerCase()
  );

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} style={{display:"flex",flexDirection:"column",gap:4,position:"relative"}}>
      <label style={{fontSize:10,letterSpacing:"0.08em",color:"#050505",fontFamily:FB,textTransform:"uppercase"}}>{label}</label>
      <div style={{display:"flex",alignItems:"center",background:"#e5e5e5",border:`1px solid ${open?T.accent:T.border}`,borderRadius:"0.3rem",overflow:"hidden",transition:"border-color 0.15s",background:"#e5e5e5",border:`1px solid ${open?"#eb0000":"rgba(5,5,5,0.10)"}`,borderRadius:"0.3rem",overflow:"hidden",transition:"border-color 0.15s"}}>
        <input
          value={value}
          onChange={e=>{ onChange(e.target.value); setOpen(true); }}
          onFocus={()=>setOpen(true)}
          placeholder={placeholder}
          style={{flex:1,background:"transparent",border:"none",outline:"none",padding:"8px 10px",color:"#050505",fontFamily:FM,fontSize:13}}
        />
        {value&&<button onClick={()=>{onChange("");setOpen(false);}} style={{background:"none",border:"none",color:T.textMute,cursor:"pointer",padding:"0 8px",fontSize:14,lineHeight:1}}>✕</button>}
      </div>
      {open && filtered.length>0 && (
        <div style={{
          position:"absolute",top:"100%",left:0,right:0,zIndex:100,
          background:"#ffffff",border:"1px solid rgba(5,5,5,0.15)",
          borderRadius:"0.3rem",marginTop:2,overflow:"hidden",
          boxShadow:"0 8px 24px rgba(0,0,0,0.4)",
        }}>
          {filtered.slice(0,8).map((s,i)=>(
            <button key={i} onMouseDown={()=>{ onSelect?onSelect(s):onChange(s); setOpen(false); }}
              style={{
                width:"100%",textAlign:"left",background:"transparent",border:"none",
                padding:"9px 12px",color:"#050505",fontFamily:FM,fontSize:13,cursor:"pointer",
                borderBottom: i<filtered.length-1?`1px solid ${T.border}`:"none",
              }}
              onMouseEnter={e=>e.currentTarget.style.background='#f0f0f0'}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}
            >{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/* Vehicle picker dropdown */
function VehiclePicker({ vehicles, onSelect }) {
  if (!vehicles.length) return null;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      <label style={{fontSize:10,letterSpacing:"0.08em",color:"#050505",fontFamily:FB,textTransform:"uppercase"}}>Previous Vehicles</label>
      <div style={{display:"flex",flexDirection:"column",gap:4}}>
        {vehicles.map((v,i)=>(
          <button key={i} onClick={()=>onSelect(v)}
            style={{
              background:"#e5e5e5",border:`1px solid ${T.border}`,borderRadius:"0.3rem",
              padding:"8px 12px",textAlign:"left",cursor:"pointer",
              display:"flex",alignItems:"center",gap:10,transition:"border-color 0.15s",
            }}
            onMouseEnter={e=>e.currentTarget.style.background="#f0f0f0"}
            onMouseLeave={e=>e.currentTarget.style.background="#ffffff"}
          >
            <span style={{fontFamily:FM,fontSize:12,color:T.accent,letterSpacing:"0.08em",minWidth:70}}>{v.reg ? v.reg.toUpperCase() : "—"}</span>
            <div style={{flex:1}}>
              <div style={{fontFamily:FB,fontSize:13,color:T.text}}>{v.year} {v.make} {v.model}</div>
              {v.mileage&&<div style={{fontFamily:FM,fontSize:10,color:T.textDim}}>{parseInt(v.mileage).toLocaleString()} km</div>}
            </div>
            <span style={{fontSize:10,color:T.textDim,fontFamily:FB}}>Use →</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RInput({ label, value, onChange, unit="mm", width=72, tol=null }) {
  const tl = tol ? trafficLight(value, tol) : "none";
  const borderCol = (tl!=="none" && hasVal(value)) ? TL_BORDER[tl] : "rgba(5,5,5,0.15)";
  const textCol   = (tl!=="none" && hasVal(value)) ? TL_COLOR[tl] : "#050505";
  return (
    <div style={{display:"flex",flexDirection:"column",gap:3,alignItems:"center"}}>
      <label style={{fontSize:9,letterSpacing:"0.06em",color:"#050505",fontFamily:FB,
        textTransform:"uppercase",textAlign:"center",whiteSpace:"nowrap"}}>{label}</label>
      <div style={{position:"relative",width}}>
        <input
          type="number"
          step="0.1"
          key={value}
          defaultValue={value===undefined||value===null||value===""?"":value}
          onBlur={e=>{ const v=e.target.value; onChange(v===""?"":parseFloat(v).toFixed(1)); }}
          onKeyDown={e=>{ if(e.key==="Enter"||e.key==="Tab"){ const v=e.target.value; onChange(v===""?"":parseFloat(v).toFixed(1)); } }}
          placeholder="0.0"
          style={{width:"100%",boxSizing:"border-box",
            background: unit==="mm"?"#f7f7f7":"#e5e5e5",
            border:`1.5px solid ${borderCol}`,borderRadius:"0.3rem",outline:"none",
            padding:"6px 8px",color:hasVal(value)?textCol:"rgba(5,5,5,0.35)",
            fontFamily:FM,fontSize:13,fontWeight:"600",textAlign:"center"}}/>
        {unit&&<span style={{position:"absolute",right:5,top:"50%",transform:"translateY(-50%)",
          fontSize:9,color:"rgba(5,5,5,0.45)",fontFamily:FM,pointerEvents:"none"}}>{unit}</span>}
      </div>
    </div>
  );
}

function DegMinInput({ label, value, onChange, tol=null }) {
  const tl = tol ? trafficLight(value, tol) : "none";
  const borderCol = (tl!=="none" && hasVal(value)) ? TL_BORDER[tl] : "rgba(5,5,5,0.15)";
  const textCol   = (tl!=="none" && hasVal(value)) ? TL_COLOR[tl] : "#050505";
  const dm = decToDM(value);
  const [sign, setSign] = useState(dm.sign);
  const [dStr, setDStr] = useState(dm.deg===""?"":String(dm.deg));
  const [mStr, setMStr] = useState(dm.min===""?"":String(dm.min).padStart(2,"0"));
  useEffect(()=>{
    const d = decToDM(value);
    setSign(d.sign);
    setDStr(d.deg===""?"":String(d.deg));
    setMStr(d.min===""?"":String(d.min).padStart(2,"0"));
  }, [value]);
  const commit = (newSign, newD, newM) => {
    const dec = dmToDec(newSign, newD, newM);
    onChange(dec===""?"":dec.toFixed(4));
  };
  const toggleSign = () => { const ns = sign<0?1:-1; setSign(ns); commit(ns, dStr, mStr); };
  const fieldStyle = {
    width:40,boxSizing:"border-box",background:"#f7f7f7",
    border:`1.5px solid ${borderCol}`,borderRadius:"0.3rem",outline:"none",
    padding:"6px 4px",color:hasVal(value)?textCol:"rgba(5,5,5,0.35)",
    fontFamily:FM,fontSize:13,fontWeight:"600",textAlign:"center",
  };
  return (
    <div style={{display:"flex",flexDirection:"column",gap:3,alignItems:"center"}}>
      <label style={{fontSize:9,letterSpacing:"0.06em",color:"#050505",fontFamily:FB,
        textTransform:"uppercase",textAlign:"center",whiteSpace:"nowrap"}}>{label}</label>
      <div style={{display:"flex",alignItems:"center",gap:4}}>
        <button type="button" onClick={toggleSign} onMouseDown={e=>e.preventDefault()} style={{width:28,height:32,flexShrink:0,
          background: sign<0 ? "rgba(235,0,0,0.12)" : "#e5e5e5",
          border:`1.5px solid ${sign<0?"rgba(235,0,0,0.4)":"rgba(5,5,5,0.18)"}`,borderRadius:"0.3rem",
          color: sign<0 ? "#eb0000" : "#050505",fontFamily:FM,fontSize:15,fontWeight:"700",
          cursor:"pointer",padding:0}}>{sign<0?"−":"+"}</button>
        <input type="text" inputMode="numeric" enterKeyHint="next" pattern="[0-9]*"
          value={dStr} placeholder="0"
          onChange={e=>{ const v=e.target.value; if(/^[0-9]*$/.test(v)) setDStr(v); }}
          onBlur={e=>commit(sign, e.target.value, mStr)}
          onKeyDown={e=>{ if(e.key==="Enter"||e.key==="Tab") commit(sign, e.target.value, mStr); }}
          className="no-spin" style={fieldStyle}/>
        <span style={{fontSize:11,color:"rgba(5,5,5,0.45)",fontFamily:FM}}>°</span>
        <input type="text" inputMode="numeric" enterKeyHint="next" pattern="[0-9]*"
          value={mStr} placeholder="00"
          onChange={e=>{ const v=e.target.value; if(/^[0-9]*$/.test(v)) setMStr(v); }}
          onBlur={e=>commit(sign, dStr, e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter"||e.key==="Tab") commit(sign, dStr, e.target.value); }}
          className="no-spin" style={fieldStyle}/>
        <span style={{fontSize:11,color:"rgba(5,5,5,0.45)",fontFamily:FM}}>'</span>
      </div>
    </div>
  );
}

function DecDegInput({ label, value, onChange, tol=null }) {
  const tl = tol ? trafficLight(value, tol) : "none";
  const borderCol = (tl!=="none" && hasVal(value)) ? TL_BORDER[tl] : "rgba(5,5,5,0.15)";
  const textCol   = (tl!=="none" && hasVal(value)) ? TL_COLOR[tl] : "#050505";
  const [str, setStr] = useState(value===undefined||value===null||value===""?"":String(value));
  useEffect(()=>{
    setStr(value===undefined||value===null||value===""?"":String(value));
  }, [value]);
  const commit = v => onChange(v===""?"":parseFloat(v).toFixed(1));
  return (
    <div style={{display:"flex",flexDirection:"column",gap:3,alignItems:"center"}}>
      <label style={{fontSize:9,letterSpacing:"0.06em",color:"#050505",fontFamily:FB,
        textTransform:"uppercase",textAlign:"center",whiteSpace:"nowrap"}}>{label}</label>
      <div style={{position:"relative",width:72}}>
        <input
          type="text" inputMode="decimal" enterKeyHint="next"
          value={str} placeholder="0.0"
          onChange={e=>{ const v=e.target.value; if(/^-?[0-9]*\.?[0-9]*$/.test(v)) setStr(v); }}
          onBlur={e=>commit(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter"||e.key==="Tab") commit(e.target.value); }}
          className="no-spin"
          style={{width:"100%",boxSizing:"border-box",background:"#f7f7f7",
            border:`1.5px solid ${borderCol}`,borderRadius:"0.3rem",outline:"none",
            padding:"6px 8px",color:hasVal(value)?textCol:"rgba(5,5,5,0.35)",
            fontFamily:FM,fontSize:13,fontWeight:"600",textAlign:"center"}}/>
        <span style={{position:"absolute",right:5,top:"50%",transform:"translateY(-50%)",
          fontSize:9,color:"rgba(5,5,5,0.45)",fontFamily:FM,pointerEvents:"none"}}>°</span>
      </div>
    </div>
  );
}

function StatBox({ label, value, unit="", color="", highlight=false, tl="none" }) {
  const col = tl!=="none" ? TL_COLOR[tl] : color||"#050505";
  const bg  = highlight ? "rgba(235,0,0,0.07)" : "#f7f7f7";
  const bdr = highlight ? "rgba(235,0,0,0.25)" : "rgba(5,5,5,0.10)";
  return (
    <div style={{background:bg,border:`1px solid ${bdr}`,
      borderRadius:"0.3rem",padding:"9px 12px",display:"flex",flexDirection:"column",gap:2,
      textAlign:"center",alignItems:"center"}}>
      <span style={{fontSize:9,color:"rgba(5,5,5,0.5)",fontFamily:FB,textTransform:"uppercase",letterSpacing:"0.08em"}}>{label}</span>
      <span style={{fontSize:15,fontFamily:FM,fontWeight:"600",color:col,lineHeight:1.1}}>
        {value}{unit&&<span style={{fontSize:10,marginLeft:3,color:"rgba(5,5,5,0.4)"}}>{unit}</span>}
      </span>
    </div>
  );
}


/* ══════════════════════════════════════════════════════════════
   CONFIGURATION LIBRARY COMPONENTS
══════════════════════════════════════════════════════════════ */

/* Tolerance row for a single measurement */
const TOE_TOL_OPTS = Array.from({length:101},(_,i)=>((i-50)/10).toFixed(1));
const TOE_OPTS = Array.from({length:601},(_,i)=>((i-300)/10).toFixed(1)); // -30.0 to +30.0

const ANGLE_TOL_KEYS = ["camberLeft","camberRight","crossCamber","casterLeft","casterRight","crossCaster","kpiLeft","kpiRight"];

function AngleTolField({ tol, f, upd }) {
  const dm = decToDM(tol[f]);
  const [sign, setSign] = useState(dm.sign);
  const [dStr, setDStr] = useState(dm.deg===""?"":String(dm.deg));
  const [mStr, setMStr] = useState(dm.min===""?"":String(dm.min).padStart(2,"0"));
  useEffect(()=>{
    const d = decToDM(tol[f]);
    setSign(d.sign);
    setDStr(d.deg===""?"":String(d.deg));
    setMStr(d.min===""?"":String(d.min).padStart(2,"0"));
  }, [tol[f]]);
  const commit = (newSign, newD, newM) => {
    const dec = dmToDec(newSign, newD, newM);
    upd(f, dec===""?"":dec.toFixed(4));
  };
  const toggleSign = () => { const ns = sign<0?1:-1; setSign(ns); commit(ns, dStr, mStr); };
  const fStyle = {flex:1,minWidth:0,boxSizing:"border-box",background:"#e5e5e5",
    border:"1px solid rgba(5,5,5,0.12)",borderRadius:"0.3rem",outline:"none",
    padding:"5px 2px",color:"#050505",fontFamily:FM,fontSize:12,textAlign:"center"};
  return (
    <div style={{display:"flex",alignItems:"center",gap:2}}>
      <button type="button" onClick={toggleSign} onMouseDown={e=>e.preventDefault()}
        style={{width:24,height:26,flexShrink:0,
        background: sign<0 ? "rgba(235,0,0,0.12)" : "#e5e5e5",
        border:`1.5px solid ${sign<0?"rgba(235,0,0,0.4)":"rgba(5,5,5,0.15)"}`,borderRadius:"0.3rem",
        color: sign<0 ? "#eb0000" : "#050505",fontFamily:FM,fontSize:13,fontWeight:"700",
        cursor:"pointer",padding:0}}>{sign<0?"−":"+"}</button>
      <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="0"
        value={dStr}
        onChange={e=>{ const v=e.target.value; if(/^[0-9]*$/.test(v)) setDStr(v); }}
        onBlur={e=>commit(sign, e.target.value, mStr)}
        onKeyDown={e=>{ if(e.key==="Enter"||e.key==="Tab") commit(sign, e.target.value, mStr); }}
        className="no-spin" style={fStyle}/>
      <span style={{fontSize:10,color:"rgba(5,5,5,0.45)",flexShrink:0}}>°</span>
      <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="00"
        value={mStr}
        onChange={e=>{ const v=e.target.value; if(/^[0-9]*$/.test(v)) setMStr(v); }}
        onBlur={e=>commit(sign, dStr, e.target.value)}
        onKeyDown={e=>{ if(e.key==="Enter"||e.key==="Tab") commit(sign, dStr, e.target.value); }}
        className="no-spin" style={fStyle}/>
      <span style={{fontSize:10,color:"rgba(5,5,5,0.45)",flexShrink:0}}>'</span>
    </div>
  );
}

function NumTolInput({ tol, f, upd }) {
  const init = tol[f]===undefined||tol[f]===null||tol[f]===""?"":String(tol[f]);
  const [str, setStr] = useState(init);
  useEffect(()=>{
    setStr(tol[f]===undefined||tol[f]===null||tol[f]===""?"":String(tol[f]));
  }, [tol[f]]);
  const commit = v => upd(f, v===""?"":parseFloat(v).toFixed(1));
  return (
    <input
      type="text"
      inputMode="decimal"
      enterKeyHint="next"
      value={str}
      onChange={e=>{ const v=e.target.value; if(/^-?[0-9]*\.?[0-9]*$/.test(v)) setStr(v); }}
      onBlur={e=>commit(e.target.value)}
      onKeyDown={e=>{ if(e.key==="Enter"||e.key==="Tab") commit(e.target.value); }}
      placeholder="—"
      className="no-spin"
      style={{width:"100%",boxSizing:"border-box",background:"#e5e5e5",
        border:"1px solid rgba(5,5,5,0.12)",borderRadius:"0.3rem",outline:"none",
        padding:"5px 6px",color:"#050505",fontFamily:FM,fontSize:12,textAlign:"center"}}/>
  );
}

function TolRow({ label, tolKey, tol, onChange }) {
  const upd = (field, v) => onChange({ ...tol, [field]: v });
  const isAngle = ANGLE_TOL_KEYS.includes(tolKey);
  if (isAngle) {
    return (
      <div style={{display:"flex",flexDirection:"column",gap:4,
        padding:"6px 0",borderBottom:"1px solid rgba(5,5,5,0.06)"}}>
        <span style={{fontFamily:FB,fontSize:11,color:"#050505"}}>{label}</span>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {["min","max"].map(f=>(
            <div key={f} style={{display:"flex",flexDirection:"column",gap:2}}>
              <label style={{fontSize:8,color:"rgba(5,5,5,0.4)",fontFamily:FB,textTransform:"uppercase"}}>{f}</label>
              <AngleTolField tol={tol} f={f} upd={upd}/>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 80px 80px",gap:8,alignItems:"center",
      padding:"6px 0",borderBottom:"1px solid rgba(5,5,5,0.06)"}}>
      <span style={{fontFamily:FB,fontSize:11,color:"#050505"}}>{label}</span>
      {["min","max"].map(f=>(
        <div key={f} style={{display:"flex",flexDirection:"column",gap:2}}>
          <label style={{fontSize:8,color:"rgba(5,5,5,0.4)",fontFamily:FB,textTransform:"uppercase"}}>{f}</label>
          <NumTolInput tol={tol} f={f} upd={upd}/>
        </div>
      ))}
    </div>
  );
}

/* Tolerance editor for one config axle */
function ConfigAxleEditor({ axle, onChange, onRemove, canRemove, isFirstSteer=false }) {
  const [open, setOpen] = useState(false);
  const [geoOpen, setGeoOpen] = useState(false);
  const upd = (field, v) => onChange({...axle, [field]:v});
  const updTol = (key, tol) => onChange({...axle, tolerances:{...axle.tolerances,[key]:tol}});
  const t = axle.tolerances || emptyAxleTolerance(axle.type);

  const STEER_FIELDS = [
    ["Toe Left (mm)",      "toeLeft"],  ["Toe Right (mm)",     "toeRight"],
    ["Total Toe (mm)",     "totalToe"], ["Camber Left (°)",    "camberLeft"],
    ["Camber Right (°)",   "camberRight"],["Cross Camber (°)", "crossCamber"],
    ["Caster Left (°)",    "casterLeft"], ["Caster Right (°)", "casterRight"],
    ["Cross Caster (°)",   "crossCaster"],["KPI Left (°)",     "kpiLeft"],
    ["KPI Right (°)",      "kpiRight"],  ["Steering Middle (mm)","steeringMiddle"],["Twinsteer (mm)","twinsteer"],
    ["Max Turn Left (°)",  "maxTurnLeft"],["Max Turn Right (°)","maxTurnRight"],
    ["Turn Diff (°)",      "turnDiff"],
    ["Parallelism (mm)",   "parallelism"],
  ];
  const FIXED_FIELDS = [
    ["Toe Left (mm)",      "toeLeft"],  ["Toe Right (mm)",     "toeRight"],
    ["Total Toe (mm)",     "totalToe"], ["Camber Left (°)",    "camberLeft"],
    ["Camber Right (°)",   "camberRight"],["Cross Camber (°)", "crossCamber"],
    ["Out of Square (mm)", "outOfSquare"],
    ["Parallelism (mm)",   "parallelism"],
  ];
  const baseFields = (axle.type==="fixed") ? FIXED_FIELDS : STEER_FIELDS;
  const fields = (axle.type==="steering"&&isFirstSteer) ? baseFields.filter(([,k])=>k!=="twinsteer") : baseFields;
  const nonGeoFields = fields.filter(([,k])=>!ANGLE_TOL_KEYS.includes(k));
  const geoFields = fields.filter(([,k])=>ANGLE_TOL_KEYS.includes(k));
  const filledCount = fields.filter(([,k])=>hasVal(t[k]?.min)||hasVal(t[k]?.max)).length;
  const geoFilledCount = geoFields.filter(([,k])=>hasVal(t[k]?.min)||hasVal(t[k]?.max)).length;

  return (
    <div style={{background:"#f7f7f7",border:"1px solid rgba(5,5,5,0.10)",borderRadius:"0.3rem",overflow:"hidden"}}>
      <div style={{background:"#efefef",padding:"10px 12px",display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:24,height:24,borderRadius:"0.3rem",background:"#eb0000",
          display:"flex",alignItems:"center",justifyContent:"center",
          fontSize:10,fontWeight:"700",fontFamily:FM,color:"#fff",flexShrink:0}}>
          {axle.type==="steering"?"S":axle.type==="rear-steer"?"RS":"N"}
        </div>
        <input value={axle.label} onChange={e=>upd("label",e.target.value)}
          style={{flex:1,minWidth:0,background:"transparent",border:"none",outline:"none",
            fontFamily:FD,fontSize:14,color:"#050505",fontWeight:"600"}}/>
        {/* Dual/Single toggle — only for non-steer axles */}
        {axle.type==="fixed" && (
          <div style={{display:"flex",borderRadius:"0.3rem",overflow:"hidden",
            border:"1px solid rgba(5,5,5,0.15)",flexShrink:0}}>
            {[["Single",false],["Dual",true]].map(([lbl,val])=>(
              <button key={lbl} onClick={()=>upd("dualWheel",val)}
                style={{padding:"4px 10px",border:"none",cursor:"pointer",
                  fontFamily:FB,fontSize:10,fontWeight:"600",
                  background:axle.dualWheel===val?"#eb0000":"transparent",
                  color:axle.dualWheel===val?"#fff":"rgba(5,5,5,0.5)",
                  transition:"all 0.15s"}}>
                {lbl}
              </button>
            ))}
          </div>
        )}
        <span style={{fontSize:9,fontFamily:FM,padding:"2px 7px",borderRadius:20,flexShrink:0,
          background:"#eb0000",color:"#fff"}}>{axle.type}</span>
        {canRemove&&<button onClick={onRemove}
          style={{background:"none",border:"none",color:"rgba(5,5,5,0.3)",cursor:"pointer",fontSize:15,lineHeight:1,flexShrink:0}}
          onMouseEnter={e=>e.currentTarget.style.color="#eb0000"}
          onMouseLeave={e=>e.currentTarget.style.color="rgba(5,5,5,0.3)"}>✕</button>}
      </div>
      <button onClick={()=>setOpen(o=>!o)} style={{
        width:"100%",background:"transparent",border:"none",borderTop:"1px solid rgba(5,5,5,0.08)",
        padding:"8px 12px",display:"flex",justifyContent:"space-between",alignItems:"center",
        cursor:"pointer",fontFamily:FB,fontSize:11,color:open?"#eb0000":"rgba(5,5,5,0.5)",
        textTransform:"uppercase",letterSpacing:"0.06em"}}>
        <span>Tolerances {filledCount>0&&`(${filledCount} set)`}</span>
        <span style={{transform:open?"rotate(180deg)":"rotate(0deg)",transition:"transform 0.2s"}}>▾</span>
      </button>
      {open&&(
        <div style={{padding:"8px 12px 12px"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 80px 80px",gap:8,marginBottom:4}}>
            <span style={{fontSize:9,color:"rgba(5,5,5,0.4)",fontFamily:FB,textTransform:"uppercase"}}>Measurement</span>
            <span style={{fontSize:9,color:"rgba(5,5,5,0.4)",fontFamily:FB,textTransform:"uppercase",textAlign:"center"}}>Min</span>
            <span style={{fontSize:9,color:"rgba(5,5,5,0.4)",fontFamily:FB,textTransform:"uppercase",textAlign:"center"}}>Max</span>
          </div>
          {nonGeoFields.map(([label,key])=>(
            <TolRow key={key} label={label} tolKey={key} tol={t[key]||emptyTolerance()}
              onChange={tol=>updTol(key,tol)}/>
          ))}
          {geoFields.length>0 && (
            <div style={{marginTop:8,border:"1px solid rgba(5,5,5,0.10)",borderRadius:"0.3rem",overflow:"hidden"}}>
              <button onClick={()=>setGeoOpen(o=>!o)} style={{
                width:"100%",background:"#efefef",border:"none",
                padding:"7px 10px",display:"flex",justifyContent:"space-between",alignItems:"center",
                cursor:"pointer",fontFamily:FB,fontSize:10,color:geoOpen?"#eb0000":"rgba(5,5,5,0.5)",
                textTransform:"uppercase",letterSpacing:"0.06em"}}>
                <span>Geo Tolerances {geoFilledCount>0&&`(${geoFilledCount} set)`}</span>
                <span style={{transform:geoOpen?"rotate(180deg)":"rotate(0deg)",transition:"transform 0.2s"}}>▾</span>
              </button>
              {geoOpen && (
                <div style={{padding:"8px 10px 4px"}}>
                  {geoFields.map(([label,key])=>(
                    <TolRow key={key} label={label} tolKey={key} tol={t[key]||emptyTolerance()}
                      onChange={tol=>updTol(key,tol)}/>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* Full config editor screen */
function ConfigEditorScreen({ config, onSave, onBack, onDelete }) {
  const [c, setC] = useState(config);
  const updAxle = ax => setC(p=>({...p,axles:p.axles.map(a=>a.id===ax.id?ax:a)}));
  const removeAxle = id => setC(p=>({...p,axles:p.axles.filter(a=>a.id!==id)}));
  const addConfigAxle = type => {
    const existing = c.axles.filter(a=>a.type===type).length;
    const label = type==="steering"?(existing===0?"Front Steer":"Second Steer")
      :type==="rear-steer"?"Rear Steer":"Non Steer";
    setC(p=>({...p,axles:[...p.axles,makeConfigAxle(type,label)]}));
  };

  return (
    <div style={{display:"flex",flexDirection:"column",minHeight:"100vh"}}>
      <div style={{position:"sticky",top:0,zIndex:20,background:"#050505",
        borderBottom:"1px solid rgba(255,255,255,0.08)",padding:"10px 16px",
        display:"flex",alignItems:"center",gap:12}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:"#eb0000",
          cursor:"pointer",fontSize:22,padding:"0 4px",lineHeight:1}}>←</button>
        <span style={{flex:1,fontFamily:FD,fontSize:15,color:"#fff",fontWeight:"600",letterSpacing:"0.04em"}}>
          {c.id?"Edit Configuration":"New Configuration"}
        </span>
        {c.id&&onDelete&&<button onClick={()=>onDelete(c.id)}
          style={{background:"none",border:"none",color:"rgba(255,255,255,0.4)",
            cursor:"pointer",fontFamily:FB,fontSize:12}}>Delete</button>}
        <Btn small onClick={()=>onSave(c)}>Save</Btn>
      </div>
      <div style={{padding:"18px 16px",display:"flex",flexDirection:"column",gap:16,background:"#f7f7f7",minHeight:"100vh"}}>
        {/* Config name */}
        <div style={{display:"flex",flexDirection:"column",gap:4}}>
          <label style={{fontSize:10,letterSpacing:"0.08em",color:"#050505",fontFamily:FB,textTransform:"uppercase"}}>Configuration Name</label>
          <input value={c.name} onChange={e=>setC(p=>({...p,name:e.target.value}))}
            placeholder="e.g. 8x4 Twin Steer"
            style={{background:"#e5e5e5",border:"1px solid rgba(5,5,5,0.10)",borderRadius:"0.3rem",
              outline:"none",padding:"10px 12px",color:"#050505",fontFamily:FD,fontSize:15,fontWeight:"600"}}/>
        </div>
        {/* Axles */}
        <SectionHead>Axles & Tolerances</SectionHead>
        {c.axles.map((axle,cidx)=>{
          const steersBefore = c.axles.slice(0,cidx).filter(a=>a.type==="steering").length;
          const isFirstSteer = axle.type==="steering" && steersBefore===0;
          return (<ConfigAxleEditor key={axle.id} axle={axle} onChange={updAxle}
            canRemove={c.axles.length>1} onRemove={()=>removeAxle(axle.id)}
            isFirstSteer={isFirstSteer}/>);
        })}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
          <Btn variant="ghost" small onClick={()=>addConfigAxle("steering")}>+ Steer</Btn>
          <Btn variant="ghost" small onClick={()=>addConfigAxle("rear-steer")}>+ Rear Steer</Btn>
          <Btn variant="ghost" small onClick={()=>addConfigAxle("fixed")}>+ Non Steer</Btn>
        </div>
      </div>
    </div>
  );
}

/* Config library screen */
function ConfigLibraryScreen({ configs, onSelect, onNew, onEdit, onBack }) {
  const [q,setQ]=useState("");
  const filtered=configs.filter(c=>c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{display:"flex",flexDirection:"column",minHeight:"100vh"}}>
      <div style={{position:"sticky",top:0,zIndex:20,background:"#050505",
        borderBottom:"1px solid rgba(255,255,255,0.08)",padding:"10px 16px",
        display:"flex",alignItems:"center",gap:12}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:"#eb0000",
          cursor:"pointer",fontSize:22,padding:"0 4px",lineHeight:1}}>←</button>
        <span style={{flex:1,fontFamily:FD,fontSize:15,color:"#fff",fontWeight:"600",letterSpacing:"0.04em"}}>
          Configurations
        </span>
        <Btn small onClick={onNew}>+ New</Btn>
      </div>
      <div style={{padding:"16px",display:"flex",flexDirection:"column",gap:12,background:"#f7f7f7",minHeight:"100vh"}}>
        <div style={{position:"relative"}}>
          <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",color:"rgba(5,5,5,0.4)",fontSize:14}}>⌕</span>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search configurations…"
            style={{width:"100%",boxSizing:"border-box",background:"#e5e5e5",
              border:"1px solid rgba(5,5,5,0.10)",borderRadius:"0.3rem",padding:"9px 12px 9px 32px",
              color:"#050505",fontFamily:FB,fontSize:13,outline:"none"}}/>
        </div>
        {filtered.length===0&&(
          <div style={{textAlign:"center",padding:"40px 0",color:"rgba(5,5,5,0.4)",fontFamily:FB}}>
            {q?"No configurations match.":"No configurations yet. Create one to get started."}
          </div>
        )}
        {filtered.map(c=>(
          <div key={c.id} style={{background:"#fff",border:"1px solid rgba(5,5,5,0.10)",
            borderRadius:"0.3rem",overflow:"hidden"}}>
            <div style={{padding:"12px 14px",display:"flex",alignItems:"center",gap:10}}>
              <div style={{flex:1}}>
                <div style={{fontFamily:FD,fontSize:15,color:"#050505",fontWeight:"600"}}>{c.name}</div>
                <div style={{fontFamily:FB,fontSize:11,color:"rgba(5,5,5,0.5)",marginTop:3}}>
                  {c.axles.map(a=>a.label).join(" · ")}
                </div>
              </div>
              <button onClick={()=>onEdit(c)} style={{background:"none",border:"none",
                color:"rgba(5,5,5,0.4)",cursor:"pointer",fontFamily:FB,fontSize:12,padding:"4px 8px"}}
                onMouseEnter={e=>e.currentTarget.style.color="#050505"}
                onMouseLeave={e=>e.currentTarget.style.color="rgba(5,5,5,0.4)"}>Edit</button>
              {onSelect&&<button onClick={()=>onSelect(c)} style={{
                background:"#eb0000",border:"none",borderRadius:"0.3rem",
                padding:"6px 14px",color:"#fff",fontFamily:FB,fontWeight:"600",
                fontSize:12,cursor:"pointer"}}>Use</button>}            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Config picker shown at top of Before tab */
function ConfigPicker({ job, configs, onSelectConfig, onOpenLibrary }) {
  return (
    <div style={{background:"#f7f7f7",border:"1px solid rgba(5,5,5,0.10)",
      borderRadius:"0.3rem",padding:"12px 14px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
        <div>
          <div style={{fontFamily:FB,fontSize:10,textTransform:"uppercase",
            letterSpacing:"0.08em",color:"rgba(5,5,5,0.5)",marginBottom:3}}>
            Axle Configuration
          </div>
          <div style={{fontFamily:FD,fontSize:14,color:"#050505",fontWeight:"600"}}>
            {job.configName||<span style={{color:"rgba(5,5,5,0.35)",fontWeight:"400"}}>No configuration selected</span>}
          </div>
        </div>
        <button onClick={onOpenLibrary} style={{
          background:"#eb0000",border:"none",borderRadius:"0.3rem",
          padding:"8px 14px",color:"#fff",fontFamily:FB,fontWeight:"600",
          fontSize:12,cursor:"pointer",flexShrink:0,whiteSpace:"nowrap"}}>
          {job.configName?"Change":"Select / Create"}
        </button>
      </div>
    </div>
  );
}

function Toggle({ label, options, value, onChange }) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      {label&&<label style={{fontSize:9,letterSpacing:"0.06em",color:T.textDim,fontFamily:FB,textTransform:"uppercase"}}>{label}</label>}
      <div style={{display:"flex",borderRadius:"0.3rem",overflow:"hidden",border:"1px solid rgba(5,5,5,0.15)"}}>
        {options.map(o=>(
          <button key={o.value} onClick={()=>onChange(o.value)} style={{
            flex:1,padding:"6px 8px",border:"none",cursor:"pointer",
            fontFamily:FB,fontSize:11,fontWeight:"600",
            background:value===o.value?"#eb0000":"#efefef",
            color:value===o.value?"#ffffff":"rgba(5,5,5,0.55)",
            transition:"all 0.15s"}}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

function SectionHead({ children }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,marginTop:2}}>
      <div style={{width:3,height:13,background:"#050505",borderRadius:"0.3rem",flexShrink:0}}/>
      <span style={{fontFamily:FD,fontSize:11,letterSpacing:"0.08em",color:"#050505",textTransform:"uppercase",fontWeight:"600"}}>{children}</span>
      <div style={{flex:1,height:1,background:"rgba(5,5,5,0.10)"}}/>
    </div>
  );
}

function Btn({ children, onClick, variant="primary", small=false }) {
  const s={
    primary:{background:"#eb0000",color:"#ffffff",border:"none"},
    ghost:{background:"#e5e5e5",color:"#050505",border:"1px solid rgba(5,5,5,0.15)"},
    danger:{background:"transparent",color:T.redBright,border:`1px solid ${T.red}40`},
  }[variant];
  return (
    <button onClick={onClick} style={{...s,padding:small?"5px 12px":"9px 20px",borderRadius:"0.3rem",
      cursor:"pointer",fontFamily:FB,fontWeight:"600",fontSize:small?11:13,
      letterSpacing:"0.04em",transition:"opacity 0.15s"}}
      onMouseEnter={e=>e.currentTarget.style.opacity="0.8"}
      onMouseLeave={e=>e.currentTarget.style.opacity="1"}>{children}</button>
  );
}

function CollapseSection({ label, open, onToggle, children, badge="" }) {
  return (
    <div style={{border:`1px solid ${T.border}`,borderRadius:"0.3rem",overflow:"hidden"}}>
      <button onClick={onToggle} style={{width:"100%",background:"#efefef",border:"none",
        cursor:"pointer",padding:"9px 12px",display:"flex",alignItems:"center",gap:8,transition:"background 0.15s"}}
        onMouseEnter={e=>e.currentTarget.style.background="#e5e5e5"}
        onMouseLeave={e=>e.currentTarget.style.background="#efefef"}>
        <div style={{width:3,height:12,background:open?"#eb0000":"rgba(5,5,5,0.15)",borderRadius:"0.3rem",flexShrink:0,transition:"background 0.2s"}}/>
        <span style={{fontFamily:FD,fontSize:11,letterSpacing:"0.14em",color:open?"#eb0000":"#050505",
          textTransform:"uppercase",flex:1,textAlign:"left",transition:"color 0.2s"}}>{label}</span>
        {badge&&<span style={{fontSize:9,fontFamily:FM,color:T.textDim,background:"#e5e5e5",
          padding:"1px 6px",borderRadius:"0.3rem",border:"1px solid rgba(5,5,5,0.15)"}}>{badge}</span>}
        <span style={{fontSize:12,color:"#050505",display:"inline-block",
          transform:open?"rotate(180deg)":"rotate(0deg)",transition:"transform 0.2s"}}>▾</span>
      </button>
      {open&&<div style={{padding:"14px 12px"}}>{children}</div>}
    </div>
  );
}

/* ── Shared toe row ──────────────────────────────────────────── */
/* ── Josam scale entry row ───────────────────────────────────── */
/* ── Distance picker select (0–20m in 0.1 increments) ──────────── */
const DIST_OPTS = Array.from({length:201},(_,i)=>(i/10).toFixed(1));
function DistancePicker({ value, onChange }) {
  return (
    <input
      type="number"
      step="0.1"
      min="0"
      key={value}
      defaultValue={value===undefined||value===null||value===""?"":value}
      onBlur={e=>{ const v=e.target.value; onChange(v===""?"":parseFloat(v).toFixed(1)); }}
      onKeyDown={e=>{ if(e.key==="Enter"||e.key==="Tab"){ const v=e.target.value; onChange(v===""?"":parseFloat(v).toFixed(1)); } }}
      placeholder="0.0"
      style={{width:90,boxSizing:"border-box",background:"#e5e5e5",
        border:"1.5px solid rgba(5,5,5,0.15)",borderRadius:"0.3rem",outline:"none",
        padding:"7px 6px",color:value?"#050505":"rgba(5,5,5,0.35)",
        fontFamily:FM,fontSize:16,fontWeight:"600",textAlign:"center"}}/>
  );
}

function ScaleInput({label, value, onCh}) {
  const [local, setLocal] = useState(value===undefined||value===null?"":String(value));
  useEffect(()=>{ setLocal(value===undefined||value===null?"":String(value)); }, [value]);
  const commit = v => onCh(v===""?"":String(Math.round(parseFloat(v))));
  return (
    <div style={{display:"flex",flexDirection:"column",gap:3,alignItems:"center"}}>
      <label style={{fontSize:9,color:"#050505",fontFamily:FB,textTransform:"uppercase",
        letterSpacing:"0.06em",textAlign:"center"}}>{label}</label>
      <input
        type="text"
        inputMode="numeric"
        enterKeyHint="next"
        pattern="-?[0-9]*"
        className="no-spin"
        value={local}
        onInput={e=>setLocal(e.target.value.replace(/[^0-9-]/g,""))}
        onBlur={e=>commit(e.target.value)}
        onKeyDown={e=>{
          if(e.key==="Enter"||e.key==="Tab"){
            commit(e.target.value);
            if(e.key==="Enter"){
              e.preventDefault();
              const inputs = Array.from(document.querySelectorAll("input.no-spin"));
              const idx = inputs.indexOf(e.target);
              if(idx>-1 && idx<inputs.length-1) inputs[idx+1].focus();
              else e.target.blur();
            }
          }
        }}
        placeholder="0"
        style={{width:60,boxSizing:"border-box",background:"#e5e5e5",
          border:"1.5px solid rgba(5,5,5,0.15)",borderRadius:"0.3rem",outline:"none",
          padding:"6px 4px",color:"#050505",
          fontFamily:FM,fontSize:16,fontWeight:"600",textAlign:"center"}}/>
    </div>
  );
}

function JosamToeRow({ axle, fullDistance, onChange, dual=false, isAfter=false }) {
  const D = parseFloat(fullDistance) || 0;
  const Da = parseFloat(axle.axleDistance) || 0;
  const up = (f,v) => onChange({...axle,[f]:v});

  // Calculate toe from scale readings
  function calcJosamToe(front, rear) {
    if (!hasVal(front) || !hasVal(rear) || D===0) return null;
    return (parseFloat(front) - parseFloat(rear)) / D;
  }

  const toeL = calcJosamToe(axle.frontScaleLeft,  axle.rearScaleLeft);
  const toeR = calcJosamToe(axle.frontScaleRight, axle.rearScaleRight);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {/* Scale readings */}
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) auto minmax(0,1fr)",gap:4,alignItems:"start",overflow:"hidden"}}>
        {/* Left */}
        <div style={{display:"flex",flexDirection:"column",gap:8,alignItems:"center",minWidth:0}}>
          <div style={{fontFamily:FB,fontSize:10,fontWeight:"600",color:"#050505",
            textTransform:"uppercase",letterSpacing:"0.08em"}}>LEFT</div>
          <ScaleInput label="Front Scale" value={axle.frontScaleLeft}
            onCh={v=>up("frontScaleLeft",v)}/>
          <ScaleInput label="Rear Scale"  value={axle.rearScaleLeft}
            onCh={v=>up("rearScaleLeft",v)}/>
          {toeL!==null && (
            <div style={{background:"#f7f7f7",border:"1px solid rgba(5,5,5,0.10)",
              borderRadius:"0.3rem",padding:"6px 8px",textAlign:"center",minWidth:0,width:"100%",boxSizing:"border-box"}}>
              <div style={{fontSize:8,color:"rgba(5,5,5,0.5)",fontFamily:FB,
                textTransform:"uppercase"}}>Toe Left</div>
              <div style={{fontFamily:FM,fontSize:15,color:"#050505",fontWeight:"600"}}>
                {toeL>=0?"+":""}{toeL.toFixed(1)}<span style={{fontSize:10,color:"rgba(5,5,5,0.4)",marginLeft:2}}>mm</span>
              </div>
            </div>
          )}
          <ToeBar value={toeL!==null?toeL.toFixed(1):""}/>
        </div>

        {/* Centre wheel visual — same diagram as direct method */}
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,paddingTop:14}}>
          <WheelPair
            toeLeft={toeL!==null?toeL.toFixed(1):""}
            toeRight={toeR!==null?toeR.toFixed(1):""}
            size={150} dual={dual}
            axleType={axle.type}
            driveSide={axle.driveSide||"RHD"}
            steerIndex={0}/>
          {(()=>{
            const bothOk = toeL!==null && toeR!==null;
            const total = bothOk ? toeL+toeR : null;
            const tols = axle.tolerances;
            const tlTotal = (bothOk && tols?.totalToe) ? trafficLight(String(total), tols.totalToe) : "none";
            const col = tlTotal!=="none" ? TL_COLOR[tlTotal] : "#050505";
            return (
              <div style={{background:"#f7f7f7",border:"1px solid rgba(5,5,5,0.10)",
                borderRadius:"0.3rem",padding:"4px 8px",textAlign:"center",minWidth:76}}>
                <div style={{fontSize:8,color:"rgba(5,5,5,0.5)",fontFamily:FB,
                  textTransform:"uppercase",letterSpacing:"0.06em"}}>Total Toe</div>
                <div style={{fontFamily:FM,fontSize:15,color:col,fontWeight:"600"}}>
                  {bothOk ? `${(total>=0?"+":"") + total.toFixed(1)}` : "—"}
                  <span style={{fontSize:10,color:"rgba(5,5,5,0.4)",marginLeft:3}}>mm</span>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Right */}
        <div style={{display:"flex",flexDirection:"column",gap:8,alignItems:"center",minWidth:0}}>
          <div style={{fontFamily:FB,fontSize:10,fontWeight:"600",color:"#050505",
            textTransform:"uppercase",letterSpacing:"0.08em"}}>RIGHT</div>
          <ScaleInput label="Front Scale" value={axle.frontScaleRight}
            onCh={v=>up("frontScaleRight",v)}/>
          <ScaleInput label="Rear Scale"  value={axle.rearScaleRight}
            onCh={v=>up("rearScaleRight",v)}/>
          {toeR!==null && (
            <div style={{background:"#f7f7f7",border:"1px solid rgba(5,5,5,0.10)",
              borderRadius:"0.3rem",padding:"6px 8px",textAlign:"center",minWidth:0,width:"100%",boxSizing:"border-box"}}>
              <div style={{fontSize:8,color:"rgba(5,5,5,0.5)",fontFamily:FB,
                textTransform:"uppercase"}}>Toe Right</div>
              <div style={{fontFamily:FM,fontSize:15,color:"#050505",fontWeight:"600"}}>
                {toeR>=0?"+":""}{toeR.toFixed(1)}<span style={{fontSize:10,color:"rgba(5,5,5,0.4)",marginLeft:2}}>mm</span>
              </div>
            </div>
          )}
          <ToeBar value={toeR!==null?toeR.toFixed(1):""} mirror={true}/>
        </div>
      </div>
    </div>
  );
}

function ToeRow({ toeLeft, toeRight, onLeft, onRight, dual=false, tols=null, axleType="fixed", driveSide="RHD", steerIndex=0 }) {
  const hasData=hasVal(toeLeft)&&hasVal(toeRight);
  const total=toNum(toeLeft)+toNum(toeRight);
  return (
    <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) auto minmax(0,1fr)",gap:4,alignItems:"center",overflow:"hidden"}}>
      <div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"center",minWidth:0,width:"100%"}}>
        <RInput label="Left Toe" value={toeLeft} onChange={onLeft} unit="mm" width={64} tol={tols?.toeLeft}/>
        <ToeBar value={toeLeft}/>
      </div>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,paddingTop:0}}>
        <WheelPair toeLeft={toeLeft} toeRight={toeRight} size={150} dual={dual} axleType={axleType} driveSide={driveSide} steerIndex={steerIndex}/>
        {(()=>{
          const bothEntered = hasVal(toeLeft) && hasVal(toeRight);
          const tlTotal = (bothEntered && tols?.totalToe) ? trafficLight(String(total), tols.totalToe) : "none";
          const col = tlTotal!=="none" ? TL_COLOR[tlTotal] : "#050505";
          return (
            <div style={{background:"#f7f7f7",border:"1px solid rgba(5,5,5,0.10)",borderRadius:"0.3rem",
              padding:"4px 8px",textAlign:"center",minWidth:76}}>
              <div style={{fontSize:8,color:"rgba(5,5,5,0.5)",fontFamily:FB,textTransform:"uppercase",letterSpacing:"0.06em"}}>Total Toe</div>
              <div style={{fontFamily:FM,fontSize:15,color:col,fontWeight:"600"}}>
                {hasData?fmtV1(total):"—"}<span style={{fontSize:10,color:"rgba(5,5,5,0.4)",marginLeft:3}}>mm</span>
              </div>
            </div>
          );
        })()}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6,alignItems:"center",minWidth:0,width:"100%"}}>
        <RInput label="Right Toe" value={toeRight} onChange={onRight} unit="mm" width={64} tol={tols?.toeRight}/>
        <ToeBar value={toeRight} mirror={true}/>
      </div>
    </div>
  );
}

/* ── Shared OOS + parallelism boxes ──────────────────────────── */
function ToeCalcBoxes({ axle, fullDistance="", tols=null, allAxles=null }) {
  const D = parseFloat(fullDistance)||0;

  // Derive effective toe — use direct values if present, else calculate from scales
  function effectiveToe(side) {
    const direct = side==="left" ? axle.toeLeft : axle.toeRight;
    if (hasVal(direct)) return String(direct);
    const front = parseFloat(side==="left" ? axle.frontScaleLeft  : axle.frontScaleRight);
    const rear  = parseFloat(side==="left" ? axle.rearScaleLeft   : axle.rearScaleRight);
    if (!isNaN(front) && !isNaN(rear) && D>0) return String((front-rear)/D);
    return "";
  }

  const tL = effectiveToe("left");
  const tR = effectiveToe("right");
  // Only show when BOTH sides have data
  const hasData = hasVal(tL) && hasVal(tR);
  if (!hasData) return null;

  const calc=calcToe(tL, tR);
  const para = (allAxles && (axle.type==="fixed"||axle.type==="rear-steer"))
    ? calcVehicleParallelism(allAxles, fullDistance) : null;

  // Use the widest parallelism tolerance across all non-steer axles (most permissive)
  const bestParaTol = (()=>{
    if (!allAxles) return tols?.parallelism||null;
    const eligible = allAxles.filter(a=>(a.type==="fixed"||a.type==="rear-steer") && a.tolerances?.parallelism);
    const withValues = eligible.filter(a=>hasVal(a.tolerances.parallelism.min)&&hasVal(a.tolerances.parallelism.max));
    if (!withValues.length) return tols?.parallelism||null;
    // Pick the one with the widest range (highest max - lowest min)
    return withValues.reduce((best,a)=>{
      const range = parseFloat(a.tolerances.parallelism.max)-parseFloat(a.tolerances.parallelism.min);
      const bestRange = parseFloat(best.max)-parseFloat(best.min);
      return range>bestRange ? a.tolerances.parallelism : best;
    }, withValues[0].tolerances.parallelism);
  })();

  return (
    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <StatBox label="Out of Square" value={fmtV1(calc.outOfSquare)} unit="mm"
          tl={trafficLight(String(calc.outOfSquare), tols?.outOfSquare)}/>
        <StatBox label="Rolling Direction" value={calc.oosLeft?"◀ LEFT":"RIGHT ▶"} color="#050505"/>
        {para&&(
          <div style={{gridColumn:"1 / -1"}}>
            <StatBox label="Parallelism" value={para.value.toFixed(1)} unit="mm"
              tl={trafficLight(String(para.value), bestParaTol)}/>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Full geo section (steering axles) ───────────────────────── */
/* ── Josam Adjustment sub-section (inside Geometry on After tab) ─ */
function JosamAdjustSection({ afterAxle, beforeAxle, fullDistance }) {
  const D  = parseFloat(fullDistance) || 0;
  const [daVal, setDaVal] = useState(afterAxle?.axleDistance||beforeAxle?.axleDistance||"");
  const Da = parseFloat(daVal) || 0;
  const [tgtL, setTgtL] = useState("");
  const [tgtR, setTgtR] = useState("");

  function getBeforeToe(side) {
    if (!beforeAxle) return null;
    const fl = side==="left" ? beforeAxle.frontScaleLeft  : beforeAxle.frontScaleRight;
    const rl = side==="left" ? beforeAxle.rearScaleLeft   : beforeAxle.rearScaleRight;
    if (hasVal(fl) && hasVal(rl) && D>0) return (parseFloat(fl)-parseFloat(rl))/D;
    const direct = parseFloat(side==="left" ? beforeAxle.toeLeft : beforeAxle.toeRight);
    return isNaN(direct) ? null : direct;
  }

  function getFarScale(side) {
    if (!beforeAxle) return null;
    const v = parseFloat(side==="left" ? beforeAxle.rearScaleLeft : beforeAxle.rearScaleRight);
    return isNaN(v) ? null : v;
  }

  function calcTarget(side, tgtVal) {
    const current = getBeforeToe(side);
    const farScale = getFarScale(side);
    if (current===null || !hasVal(tgtVal) || Da===0 || D===0 || Da>=D) return null;
    const delta = parseFloat(tgtVal) - current;
    const adj   = delta * Da;
    const newFar = farScale !== null ? farScale - adj : null;
    return { delta, adj, newFar };
  }

  const resL = calcTarget("left",  tgtL);
  const resR = calcTarget("right", tgtR);
  const currentL = getBeforeToe("left");
  const currentR = getBeforeToe("right");

  if (!beforeAxle) return null;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {/* Axle distance input lives here */}
      <div style={{background:"rgba(235,0,0,0.06)",border:"1px solid rgba(235,0,0,0.15)",
        borderRadius:"0.3rem",padding:"10px 12px"}}>
        <div style={{fontSize:10,color:"#050505",fontFamily:FB,textTransform:"uppercase",
          letterSpacing:"0.08em",marginBottom:6,fontWeight:"600"}}>
          Axle Distance to Far Scale
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <DistancePicker value={daVal} onChange={v=>setDaVal(v)}/>
          <span style={{fontFamily:FB,fontSize:12,color:"rgba(5,5,5,0.5)"}}>
            metres (axle centre → far scale)
          </span>
        </div>
        {Da>0&&D>0&&Da>=D&&(
          <div style={{fontFamily:FB,fontSize:11,color:"#eb0000",marginTop:8,fontWeight:"600"}}>
            ⚠ Axle distance ({daVal}m) cannot exceed full length ({fullDistance}m)
          </div>
        )}
      </div>
      <SectionHead>Target</SectionHead>
      {(D===0)&&(
        <div style={{fontFamily:FB,fontSize:11,color:"#eb0000",marginBottom:4}}>
          ⚠ Set full distance (D) in Before tab.
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:10,overflow:"hidden"}}>
        {[
          {side:"Left",  current:currentL, tgt:tgtL, setTgt:setTgtL, res:resL},
          {side:"Right", current:currentR, tgt:tgtR, setTgt:setTgtR, res:resR},
        ].map(({side,current,tgt,setTgt,res})=>(
          <div key={side} style={{display:"flex",flexDirection:"column",gap:6,minWidth:0}}>
            <div style={{fontFamily:FB,fontSize:10,fontWeight:"600",color:"#050505",
              textTransform:"uppercase",letterSpacing:"0.06em"}}>{side}</div>
            {current!==null&&(
              <div style={{background:"#efefef",borderRadius:"0.3rem",padding:"5px 8px"}}>
                <div style={{fontSize:8,color:"rgba(5,5,5,0.4)",fontFamily:FB,textTransform:"uppercase"}}>Before</div>
                <div style={{fontFamily:FM,fontSize:13,color:"#050505",fontWeight:"600"}}>
                  {current>=0?"+":""}{current.toFixed(1)} mm
                </div>
              </div>
            )}
            <div style={{display:"flex",flexDirection:"column",gap:3}}>
              <label style={{fontSize:9,color:"#050505",fontFamily:FB,
                textTransform:"uppercase",letterSpacing:"0.06em"}}>Target Toe</label>
              <div style={{display:"flex",alignItems:"center",
                background:"#e5e5e5",border:"1.5px solid rgba(5,5,5,0.15)",
                borderRadius:"0.3rem",overflow:"hidden"}}>
                <select
                  value={tgt||""}
                  onChange={e=>setTgt(e.target.value)}
                  style={{flex:1,minWidth:0,background:"transparent",border:"none",outline:"none",
                    padding:"6px 8px",color:"#050505",fontFamily:FM,fontSize:13,fontWeight:"600",
                    textAlign:"center",textAlignLast:"center",
                    appearance:"none",WebkitAppearance:"none",cursor:"pointer"}}>
                  <option value="" disabled>—</option>
                  {Array.from({length:101},(_,i)=>{
                    const v=((i-50)/10).toFixed(1);
                    const label=parseFloat(v)>=0?"+"+v:v;
                    return <option key={v} value={v}>{label}</option>;
                  })}
                </select>
                <span style={{padding:"0 8px",fontFamily:FM,fontSize:11,color:"rgba(5,5,5,0.45)",
                  borderLeft:"1px solid rgba(5,5,5,0.12)",flexShrink:0,background:"#e5e5e5"}}>mm</span>
              </div>
            </div>
            {res?.newFar!==null&&res?.newFar!==undefined&&(
              <div style={{background:"rgba(22,163,74,0.08)",border:"1px solid rgba(22,163,74,0.25)",
                borderRadius:"0.3rem",padding:"10px 12px",display:"flex",flexDirection:"column",gap:4}}>
                <div style={{fontFamily:FB,fontSize:11,color:"#16a34a",textTransform:"uppercase",
                  letterSpacing:"0.06em"}}>Far Target Figure</div>
                <div style={{fontFamily:FM,fontSize:22,color:"#16a34a",fontWeight:"700",lineHeight:1}}>
                  {Math.round(res.newFar)}
                </div>
                <div style={{fontFamily:FB,fontSize:11,color:"#16a34a",lineHeight:1.4}}>
                  Adjust wheel until laser hits <strong>{Math.round(res.newFar)}</strong> on the far scale
                </div>
              </div>
            )}
            {res!==null&&res?.newFar===null&&Da>0&&(
              <div style={{fontFamily:FB,fontSize:11,color:"rgba(5,5,5,0.4)"}}>
                Enter scale readings in Before
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Fixed axle OOS-based adjustment (Josam After tab) ──────────── */
function FixedJosamAdjustSection({ afterAxle, beforeAxle, fullDistance }) {
  const D  = parseFloat(fullDistance) || 0;
  const [daVal, setDaVal] = useState(afterAxle?.axleDistance||beforeAxle?.axleDistance||"");
  const Da = parseFloat(daVal) || 0;
  const [tgtOOS, setTgtOOS] = useState("");

  function getBeforeToe(side) {
    if (!beforeAxle) return null;
    const fl = side==="left" ? beforeAxle.frontScaleLeft  : beforeAxle.frontScaleRight;
    const rl = side==="left" ? beforeAxle.rearScaleLeft   : beforeAxle.rearScaleRight;
    if (hasVal(fl) && hasVal(rl) && D>0) return (parseFloat(fl)-parseFloat(rl))/D;
    const direct = parseFloat(side==="left" ? beforeAxle.toeLeft : beforeAxle.toeRight);
    return isNaN(direct) ? null : direct;
  }

  function getFarScale(side) {
    if (!beforeAxle) return null;
    const key = side==="left" ? beforeAxle.rearScaleLeft : beforeAxle.rearScaleRight;
    const v = parseFloat(key);
    return isNaN(v) ? null : v;
  }

  const toeL = getBeforeToe("left");
  const toeR = getBeforeToe("right");
  const currentOOS = (toeL!==null && toeR!==null) ? (toNum(toeR)-toNum(toeL))/2 : null;

  // delta = targetOOS - currentOOS
  // farLeft  = farScaleLeft  + (delta × Da)
  // farRight = farScaleRight - (delta × Da)
  const canCalc = hasVal(tgtOOS) && currentOOS!==null && Da>0 && D>0 && Da<D;
  const delta   = canCalc ? parseFloat(tgtOOS) - currentOOS : null;
  const farScaleL = getFarScale("left");
  const farScaleR = getFarScale("right");
  const newFarL = delta!==null && farScaleL!==null ? farScaleL + (delta * Da) : null;
  const newFarR = delta!==null && farScaleR!==null ? farScaleR - (delta * Da) : null;

  if (!beforeAxle) return null;

  const TargetBox = ({label, value}) => value===null ? null : (
    <div style={{background:"rgba(22,163,74,0.08)",border:"1px solid rgba(22,163,74,0.25)",
      borderRadius:"0.3rem",padding:"10px 12px",display:"flex",flexDirection:"column",gap:4,
      flex:1,minWidth:0}}>
      <div style={{fontFamily:FB,fontSize:11,color:"#16a34a",textTransform:"uppercase",
        letterSpacing:"0.06em"}}>Far Target {label}</div>
      <div style={{fontFamily:FM,fontSize:22,color:"#16a34a",fontWeight:"700",lineHeight:1}}>
        {Math.round(value)}
      </div>
      <div style={{fontFamily:FB,fontSize:11,color:"#16a34a",lineHeight:1.4}}>
        Adjust {label.toLowerCase()} wheel until laser hits <strong>{Math.round(value)}</strong> on the far scale
      </div>
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      {/* Axle distance */}
      <div style={{background:"rgba(235,0,0,0.06)",border:"1px solid rgba(235,0,0,0.15)",
        borderRadius:"0.3rem",padding:"10px 12px"}}>
        <div style={{fontSize:10,color:"#050505",fontFamily:FB,textTransform:"uppercase",
          letterSpacing:"0.08em",marginBottom:6,fontWeight:"600"}}>
          Axle Distance to Far Scale
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <DistancePicker value={daVal} onChange={v=>setDaVal(v)}/>
          <span style={{fontFamily:FB,fontSize:12,color:"rgba(5,5,5,0.5)"}}>
            metres (axle centre → far scale)
          </span>
        </div>
        {Da>0&&D>0&&Da>=D&&(
          <div style={{fontFamily:FB,fontSize:11,color:"#eb0000",marginTop:8,fontWeight:"600"}}>
            ⚠ Axle distance ({daVal}m) cannot exceed full length ({fullDistance}m)
          </div>
        )}
      </div>

      {/* Current OOS */}
      {currentOOS!==null&&(
        <div style={{background:"#efefef",borderRadius:"0.3rem",padding:"8px 12px",textAlign:"center"}}>
          <div style={{fontSize:9,color:"rgba(5,5,5,0.5)",fontFamily:FB,textTransform:"uppercase",
            letterSpacing:"0.06em",marginBottom:3}}>Current Out of Square</div>
          <div style={{fontFamily:FM,fontSize:15,color:"#050505",fontWeight:"600"}}>
            {fmtV1(currentOOS)} mm
          </div>
        </div>
      )}

      {/* Target OOS input */}
      <div style={{display:"flex",flexDirection:"column",gap:3}}>
        <label style={{fontSize:9,color:"#050505",fontFamily:FB,
          textTransform:"uppercase",letterSpacing:"0.06em"}}>Target Out of Square</label>
        <div style={{display:"flex",alignItems:"center",
          background:"#e5e5e5",border:"1.5px solid rgba(5,5,5,0.15)",
          borderRadius:"0.3rem",overflow:"hidden"}}>
          <select
            value={tgtOOS||""}
            onChange={e=>setTgtOOS(e.target.value)}
            style={{flex:1,minWidth:0,background:"transparent",border:"none",outline:"none",
              padding:"6px 8px",color:"#050505",fontFamily:FM,fontSize:13,fontWeight:"600",
              textAlign:"center",textAlignLast:"center",
              appearance:"none",WebkitAppearance:"none",cursor:"pointer"}}>
            <option value="" disabled>—</option>
            {Array.from({length:101},(_,i)=>{
              const v=((i-50)/10).toFixed(1);
              const label=parseFloat(v)>=0?"+"+v:v;
              return <option key={v} value={v}>{label}</option>;
            })}
          </select>
          <span style={{padding:"0 8px",fontFamily:FM,fontSize:11,color:"rgba(5,5,5,0.45)",
            borderLeft:"1px solid rgba(5,5,5,0.12)",flexShrink:0,background:"#e5e5e5"}}>mm</span>
        </div>
      </div>

      {D===0&&<div style={{fontFamily:FB,fontSize:11,color:"#eb0000"}}>⚠ Set full distance in Before tab.</div>}

      {/* Results */}
      {(newFarL!==null||newFarR!==null)&&(
        <div style={{display:"flex",gap:10}}>
          <TargetBox label="Left"  value={newFarL}/>
          <TargetBox label="Right" value={newFarR}/>
        </div>
      )}
    </div>
  );
}

function SteeringGeoSection({ axle, up, showTurning=true, tols=null }) {
  const crossCamber=hasVal(axle.camberLeft)&&hasVal(axle.camberRight)
    ?toNum(axle.camberLeft)-toNum(axle.camberRight):null;
  const crossCaster=hasVal(axle.casterLeft)&&hasVal(axle.casterRight)
    ?toNum(axle.casterLeft)-toNum(axle.casterRight):null;
  const turnDiff=hasVal(axle.maxTurnLeft)&&hasVal(axle.maxTurnRight)
    ?toNum(axle.maxTurnLeft)-toNum(axle.maxTurnRight):null;
  const qCol=(_v,_lo,_hi)=>"#050505";
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div>
        <SectionHead>Camber · Caster · KPI</SectionHead>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <DegMinInput label="Camber L" value={axle.camberLeft}  onChange={v=>up("camberLeft",v)}  tol={(tols||{}).camberLeft}/>
            <DegMinInput label="Camber R" value={axle.camberRight} onChange={v=>up("camberRight",v)} tol={(tols||{}).camberRight}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <DegMinInput label="Caster L" value={axle.casterLeft}  onChange={v=>up("casterLeft",v)}  tol={(tols||{}).casterLeft}/>
            <DegMinInput label="Caster R" value={axle.casterRight} onChange={v=>up("casterRight",v)} tol={(tols||{}).casterRight}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <DegMinInput label="KPI L" value={axle.kpiLeft}  onChange={v=>up("kpiLeft",v)}  tol={(tols||{}).kpiLeft}/>
            <DegMinInput label="KPI R" value={axle.kpiRight} onChange={v=>up("kpiRight",v)} tol={(tols||{}).kpiRight}/>
          </div>
        </div>
      </div>
      {showTurning&&(
        <div>
          <SectionHead>Max Turn · TOOT</SectionHead>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <DecDegInput label="Max Turn L" value={axle.maxTurnLeft}  onChange={v=>up("maxTurnLeft",v)}  tol={(tols||{}).maxTurnLeft}/>
              <DecDegInput label="Max Turn R" value={axle.maxTurnRight} onChange={v=>up("maxTurnRight",v)} tol={(tols||{}).maxTurnRight}/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <DecDegInput label="TOOT L" value={axle.tootLeft}  onChange={v=>up("tootLeft",v)}/>
              <DecDegInput label="TOOT R" value={axle.tootRight} onChange={v=>up("tootRight",v)}/>
            </div>
            <div style={{display:"flex",justifyContent:"center"}}>
              <TurningDiagram left={axle.maxTurnLeft} right={axle.maxTurnRight}/>
            </div>
          </div>
        </div>
      )}
      {(crossCamber!==null||crossCaster!==null||turnDiff!==null)&&(
        <div>
          <SectionHead>Calculated</SectionHead>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {crossCamber!==null&&<StatBox label="Cross Camber" value={`${crossCamber>=0?"+":""}${fDM(crossCamber)}`} tl={trafficLight(crossCamber,(tols||{}).crossCamber)}/>}
            {crossCaster!==null&&<StatBox label="Cross Caster" value={`${crossCaster>=0?"+":""}${fDM(crossCaster)}`} tl={trafficLight(crossCaster,(tols||{}).crossCaster)}/>}
            {turnDiff!==null&&<StatBox label="Turn Diff" value={`${turnDiff>=0?"+":""}${turnDiff.toFixed(1)}`} unit="°" tl={trafficLight(turnDiff,(tols||{}).turnDiff)}/>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Fixed axle geo section (camber only) ────────────────────── */
function FixedGeoSection({ axle, up, tols=null }) {
  const crossCamber=hasVal(axle.camberLeft)&&hasVal(axle.camberRight)
    ?toNum(axle.camberLeft)-toNum(axle.camberRight):null;
  const qCol=(_v,_lo,_hi)=>"#050505";
  return (
    <div style={{display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,justifyItems:"center"}}>
        <DegMinInput label="Camber L" value={axle.camberLeft}  onChange={v=>up("camberLeft",v)}  tol={(tols||{}).camberLeft}/>
        <DegMinInput label="Camber R" value={axle.camberRight} onChange={v=>up("camberRight",v)} tol={(tols||{}).camberRight}/>
      </div>
      {crossCamber!==null&&(
        <StatBox label="Cross Camber" value={`${crossCamber>=0?"+":""}${fDM(crossCamber)}`}
          tl={trafficLight(crossCamber,(tols||{}).crossCamber)}/>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   AXLE PANELS
══════════════════════════════════════════════════════════════ */
function SteeringAxlePanel({ axle, onChange, showGeo=false, onToggleGeo, showAdj=false, onToggleAdj, isJosam=false, fullDistance="", beforeAxle=null, isAfter=false, steerIndex=0, frontSteerSM=null }) {
  const up=(f,v)=>onChange({...axle,[f]:v});
  const hasToeDdata=hasVal(axle.toeLeft)||hasVal(axle.toeRight)||
    (isJosam&&(hasVal(axle.frontScaleLeft)||hasVal(axle.frontScaleRight)));
  const D_sm = parseFloat(fullDistance)||0;
  const axleForSM = isJosam && D_sm>0 ? {
    ...axle,
    toeLeft:  (hasVal(axle.frontScaleLeft)&&hasVal(axle.rearScaleLeft))
      ? String((parseFloat(axle.frontScaleLeft)-parseFloat(axle.rearScaleLeft))/D_sm) : axle.toeLeft,
    toeRight: (hasVal(axle.frontScaleRight)&&hasVal(axle.rearScaleRight))
      ? String((parseFloat(axle.frontScaleRight)-parseFloat(axle.rearScaleRight))/D_sm) : axle.toeRight,
  } : axle;
  // Only show steering middle when both sides have data
  const bothSides = isJosam
    ? (hasVal(axleForSM.toeLeft) && hasVal(axleForSM.toeRight))
    : (hasVal(axle.toeLeft) && hasVal(axle.toeRight));
  const sm = bothSides ? calcSteeringMiddle(axleForSM) : null;
  const geoFilled=[axle.camberLeft,axle.camberRight,axle.casterLeft,axle.casterRight,
    axle.kpiLeft,axle.kpiRight,axle.maxTurnLeft,axle.maxTurnRight,
    axle.tootLeft,axle.tootRight].filter(hasVal).length;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Toggle label="Drive Side" options={[{label:"RHD",value:"RHD"},{label:"LHD",value:"LHD"}]}
          value={axle.driveSide} onChange={v=>up("driveSide",v)}/>
        <Toggle label="Suspension" options={[{label:"Solid",value:"solid"},{label:"Indep.",value:"independent"}]}
          value={axle.suspType} onChange={v=>up("suspType",v)}/>
      </div>
      {isJosam
        ? <JosamToeRow axle={axle} fullDistance={fullDistance} onChange={onChange} isAfter={isAfter}/>
        : <ToeRow toeLeft={axle.toeLeft} toeRight={axle.toeRight}
            onLeft={v=>up("toeLeft",v)} onRight={v=>up("toeRight",v)} tols={axle.tolerances}
            axleType={axle.type} driveSide={axle.driveSide||"RHD"} steerIndex={steerIndex||0}/>
      }
      {hasToeDdata&&sm&&(
        steerIndex>=1 && frontSteerSM!==null ? (
          // Twin steer: show Steering Middle + Twinsteer side by side
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <StatBox label={sm.label} value={fmtV1(sm.value)} unit="mm"
              tl={trafficLight(sm.value,axle.tolerances?.steeringMiddle)}/>
            {(()=>{
              const normSM = normaliseSMForTwinsteer(axleForSM, sm.value);
              const twinsteerVal = normSM - frontSteerSM;
              return <StatBox label="Twinsteer" value={fmtV1(twinsteerVal)} unit="mm"
                tl={trafficLight(twinsteerVal, axle.tolerances?.twinsteer)}/>;
            })()}
          </div>
        ) : (
          // First steer axle: centred steering middle only
          <div style={{display:"flex",justifyContent:"center"}}>
            <div style={{width:"60%"}}>
              <StatBox label={sm.label} value={fmtV1(sm.value)} unit="mm"
                tl={trafficLight(sm.value,axle.tolerances?.steeringMiddle)}/>
            </div>
          </div>
        )
      )}
      <CollapseSection label="Geometry" open={showGeo} onToggle={onToggleGeo}
        badge={geoFilled>0?`${geoFilled} values`:""}>
        <SteeringGeoSection axle={axle} up={up} showTurning={true} tols={axle.tolerances}/>
      </CollapseSection>
      {isJosam&&isAfter&&(
        <CollapseSection label="Adjustment" open={showAdj} onToggle={onToggleAdj}>
          <JosamAdjustSection afterAxle={axle} beforeAxle={beforeAxle} fullDistance={fullDistance}/>
        </CollapseSection>
      )}
    </div>
  );
}

function RearSteerAxlePanel({ axle, onChange, showGeo=false, onToggleGeo, showAdj=false, onToggleAdj, isJosam=false, fullDistance="", beforeAxle=null, isAfter=false, allAxles=null }) {
  const up=(f,v)=>onChange({...axle,[f]:v});
  const geoFilled=[axle.camberLeft,axle.camberRight,axle.casterLeft,axle.casterRight,
    axle.kpiLeft,axle.kpiRight,axle.maxTurnLeft,axle.maxTurnRight,
    axle.tootLeft,axle.tootRight].filter(hasVal).length;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      {isJosam
        ? <JosamToeRow axle={axle} fullDistance={fullDistance} onChange={onChange} isAfter={isAfter}/>
        : <ToeRow toeLeft={axle.toeLeft} toeRight={axle.toeRight}
            onLeft={v=>up("toeLeft",v)} onRight={v=>up("toeRight",v)} axleType={axle.type} driveSide={axle.driveSide||"RHD"}/>
      }
      <ToeCalcBoxes axle={axle} fullDistance={fullDistance} tols={axle.tolerances} allAxles={allAxles}/>
      <CollapseSection label="Geometry" open={showGeo} onToggle={onToggleGeo}
        badge={geoFilled>0?`${geoFilled} values`:""}>
        <SteeringGeoSection axle={axle} up={up} showTurning={true} tols={axle.tolerances}/>
      </CollapseSection>
      {isJosam&&isAfter&&(
        <CollapseSection label="Adjustment" open={showAdj} onToggle={onToggleAdj}>
          <JosamAdjustSection afterAxle={axle} beforeAxle={beforeAxle} fullDistance={fullDistance}/>
        </CollapseSection>
      )}
    </div>
  );
}

function FixedAxlePanel({ axle, onChange, showGeo=false, onToggleGeo, showAdj=false, onToggleAdj, isJosam=false, fullDistance="", beforeAxle=null, isAfter=false, allAxles=null }) {
  const up=(f,v)=>onChange({...axle,[f]:v});
  const dual = axle.dualWheel||false;
  const geoFilled=[axle.camberLeft,axle.camberRight].filter(hasVal).length;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <div/>
        <Toggle label="Wheel Type"
          options={[{label:"Single",value:false},{label:"Dual",value:true}]}
          value={dual} onChange={v=>up("dualWheel",v)}/>
      </div>
      {isJosam
        ? <JosamToeRow axle={axle} fullDistance={fullDistance} onChange={onChange} dual={dual} isAfter={isAfter}/>
        : <ToeRow toeLeft={axle.toeLeft} toeRight={axle.toeRight}
            onLeft={v=>up("toeLeft",v)} onRight={v=>up("toeRight",v)} dual={dual} tols={axle.tolerances} axleType={axle.type} driveSide={axle.driveSide||"RHD"}/>
      }
      <ToeCalcBoxes axle={axle} fullDistance={fullDistance} tols={axle.tolerances} allAxles={allAxles}/>
      <CollapseSection label="Geometry" open={showGeo} onToggle={onToggleGeo}
        badge={geoFilled>0?`${geoFilled} values`:""}>
        <FixedGeoSection axle={axle} up={up} tols={axle.tolerances}/>
      </CollapseSection>
      {isJosam&&isAfter&&(
        <CollapseSection label="Adjustment" open={showAdj} onToggle={onToggleAdj}>
          <FixedJosamAdjustSection afterAxle={axle} beforeAxle={beforeAxle} fullDistance={fullDistance}/>
        </CollapseSection>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   JOB DETAILS FORM
══════════════════════════════════════════════════════════════ */
function JobDetailsTab({ j, setJ, allJobs }) {
  const companies = getCompanies(allJobs);
  const prevVehicles = j.customer.company
    ? getVehiclesForCompany(allJobs.filter(x=>x.id!==j.id), j.customer.company)
    : [];

  const updC=(f,v)=>setJ(p=>({...p,customer:{...p.customer,[f]:v}}));
  const updV=(f,v)=>setJ(p=>({...p,vehicle:{...p.vehicle,[f]:v}}));

  function applyAxlesForReg(reg) {
    const axles = getAxlesForReg(allJobs, reg, j.id);
    if (axles) setJ(p=>({...p, axles, afterAxles:null}));
  }

  function selectCompany(company) {
    const contact = getContactForCompany(allJobs, company);
    setJ(p=>({...p,
      customer:{...p.customer, company,
        name:  contact?.name  || p.customer.name,
        phone: contact?.phone || p.customer.phone,
        email: contact?.email || p.customer.email,
      }
    }));
  }

  function selectVehicle(v) {
    const axles = getAxlesForReg(allJobs, v.reg, j.id);
    setJ(p=>({
      ...p,
      vehicle:{...v, mileage: p.vehicle.mileage||""},
      ...(axles ? { axles, afterAxles:null } : {}),
    }));
  }

  const makes  = getMakes(allJobs);
  const models = getModelsForMake(allJobs, j.vehicle.make);

  function selectMake(make) {
    setJ(p=>({...p, vehicle:{...p.vehicle, make, model:""}}));
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {/* Customer */}
      <div>
        <SectionHead>Customer</SectionHead>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <AutoField label="Company Name" value={j.customer.company}
            onChange={v=>updC("company",v)}
            onSelect={selectCompany}
            suggestions={companies}
            placeholder="Company or individual name"/>
          <Field label="Contact Name" value={j.customer.name}
            onChange={v=>updC("name",v)} placeholder="Person's name"/>
          <Field label="Phone" value={j.customer.phone}
            onChange={v=>updC("phone",v)} placeholder="04xx xxx xxx"/>
          <Field label="Email" value={j.customer.email}
            onChange={v=>updC("email",v)} placeholder="name@email.com"/>
        </div>
      </div>

      {/* Previous vehicles for this company */}
      {prevVehicles.length>0&&(
        <VehiclePicker vehicles={prevVehicles} onSelect={selectVehicle}/>
      )}

      {/* Vehicle */}
      <div>
        <SectionHead>Vehicle</SectionHead>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:10,overflow:"hidden"}}>
            <Field label="REG"  value={j.vehicle.reg.toUpperCase()}
              onChange={v=>updV("reg",v.toUpperCase())}
              onBlur={v=>applyAxlesForReg(v)}
              placeholder="ABC 123"/>
            <Field label="Year" value={j.vehicle.year} onChange={v=>updV("year",v)} placeholder="2024"/>
          </div>
          <AutoField label="Make" value={j.vehicle.make}
            onChange={v=>{ updV("make",v); updV("model",""); }}
            onSelect={selectMake}
            suggestions={makes}
            placeholder="e.g. Toyota"/>
          <AutoField label="Model" value={j.vehicle.model}
            onChange={v=>updV("model",v)}
            suggestions={models}
            placeholder={j.vehicle.make ? `e.g. ${models[0]||"HiLux"}` : "Select make first"}/>
          <Field label="Mileage" value={j.vehicle.mileage||""} onChange={v=>updV("mileage",v)} placeholder="e.g. 124500"/>
        </div>
      </div>

      {/* Notes */}
      <div>
        <SectionHead>Notes</SectionHead>
        <textarea value={j.notes} onChange={e=>setJ(p=>({...p,notes:e.target.value}))}
          placeholder="Job notes…" rows={3}
          style={{width:"100%",boxSizing:"border-box",background:"#e5e5e5",
            border:"1px solid rgba(5,5,5,0.10)",borderRadius:"0.3rem",padding:"9px 10px",
            color:"#050505",fontFamily:FB,fontSize:13,outline:"none",resize:"vertical"}}/>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SCREENS
══════════════════════════════════════════════════════════════ */
function SwipeableJobCard({ j, onOpen, onDelete }) {
  const [swipeX, setSwipeX] = useState(0);
  const [startX, setStartX] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const DELETE_THRESHOLD = 80;

  function onTouchStart(e) { setStartX(e.touches[0].clientX); }
  function onTouchMove(e) {
    if (startX===null) return;
    const dx = e.touches[0].clientX - startX;
    if (dx < 0) setSwipeX(Math.max(dx, -DELETE_THRESHOLD-20));
  }
  function onTouchEnd() {
    if (swipeX < -DELETE_THRESHOLD) {
      setDeleting(true);
    } else {
      setSwipeX(0);
    }
    setStartX(null);
  }
  function confirmDelete(e) { e.stopPropagation(); onDelete(j.id); }
  function cancelDelete(e)  { e.stopPropagation(); setSwipeX(0); setDeleting(false); }
  function requestDelete(e) { e.stopPropagation(); setDeleting(true); }

  const fmtDate=iso=>new Date(iso).toLocaleDateString("en-AU",{day:"2-digit",month:"short",year:"numeric"});
  const syncCol=s=>s==="synced"?T.greenBright:s==="local"?"#eb0000":T.redBright;
  const typeStyle=t=>t==="steering"
    ?{bg:T.accentFaint,col:T.accent,border:T.accent+"40"}
    :t==="rear-steer"
    ?{bg:"rgba(248,113,113,0.08)",col:"#f87171",border:"rgba(248,113,113,0.3)"}
    :{bg:T.surfaceTop,col:T.textDim,border:T.border};

  if (deleting) {
    return (
      <div style={{background:"#f7f7f7",borderRadius:"0.3rem",padding:"14px 16px",
        border:"1px solid rgba(235,0,0,0.3)"}}>
        <div style={{fontFamily:FB,fontSize:13,color:"#050505",marginBottom:10,fontWeight:"600"}}>
          Delete this job?
        </div>
        <div style={{fontFamily:FB,fontSize:12,color:"rgba(5,5,5,0.5)",marginBottom:14}}>
          {j.customer.company||j.customer.name} · {j.vehicle.reg||j.vehicle.make}
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={confirmDelete} style={{flex:1,background:"#eb0000",border:"none",
            borderRadius:"0.3rem",padding:"10px",color:"#fff",fontFamily:FB,fontWeight:"600",
            fontSize:13,cursor:"pointer"}}>Delete</button>
          <button onClick={cancelDelete} style={{flex:1,background:"#efefef",border:"none",
            borderRadius:"0.3rem",padding:"10px",color:"#050505",fontFamily:FB,fontWeight:"600",
            fontSize:13,cursor:"pointer"}}>Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{position:"relative",overflow:"hidden",borderRadius:"0.3rem"}}>
      {/* Delete reveal */}
      <div style={{position:"absolute",right:0,top:0,bottom:0,width:DELETE_THRESHOLD,
        background:"#eb0000",display:"flex",alignItems:"center",justifyContent:"center",
        borderRadius:"0 0.3rem 0.3rem 0"}}>
        <span style={{color:"#fff",fontFamily:FB,fontSize:12,fontWeight:"600"}}>Delete</span>
      </div>
      {/* Card */}
      <button
        onClick={()=>swipeX===0&&onOpen(j.id)}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          background:"#f7f7f7",border:"1px solid rgba(5,5,5,0.10)",
          borderRadius:"0.3rem",padding:"14px 16px",textAlign:"left",
          cursor:"pointer",width:"100%",display:"block",
          transform:`translateX(${swipeX}px)`,
          transition:startX!==null?"none":"transform 0.25s ease",
          position:"relative",zIndex:1,
        }}
        onMouseEnter={e=>{ if(swipeX===0) e.currentTarget.style.background="#e5e5e5"; }}
        onMouseLeave={e=>e.currentTarget.style.background="#f7f7f7"}
      >
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontFamily:FD,fontSize:16,color:"#050505",letterSpacing:"0.04em",fontWeight:"600",
              whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
              {j.vehicle.reg
                ? <span style={{color:"#eb0000",fontFamily:FM,letterSpacing:"0.08em",textTransform:"uppercase",fontWeight:"700"}}>{j.vehicle.reg}</span>
                : <span style={{color:"rgba(5,5,5,0.3)"}}>No reg</span>}
              {j.vehicle.mileage&&<span style={{fontFamily:FM,fontSize:12,color:"#050505",marginLeft:10,fontWeight:"500"}}>Mileage: {parseInt(j.vehicle.mileage).toLocaleString()}</span>}
            </div>
            <div style={{fontFamily:FB,fontSize:12,color:"#050505",marginTop:4,fontWeight:"500"}}>
              {j.customer.company||j.customer.name||"No customer"}
              &nbsp;·&nbsp;{j.vehicle.make} {j.vehicle.model}
              &nbsp;·&nbsp;{fmtDate(j.createdAt)}
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:5,flexShrink:0}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:syncCol(j.syncStatus)}}/>
            <span style={{fontSize:10,color:"#050505",fontFamily:FM,fontWeight:"500"}}>{j.syncStatus}</span>
          </div>
          <span onClick={requestDelete} title="Delete job" style={{flexShrink:0,cursor:"pointer",
            color:"rgba(5,5,5,0.35)",fontSize:16,lineHeight:1,padding:"0 2px"}}
            onMouseEnter={e=>e.currentTarget.style.color="#eb0000"}
            onMouseLeave={e=>e.currentTarget.style.color="rgba(5,5,5,0.35)"}>×</span>
        </div>
        <div style={{marginTop:8,display:"flex",gap:5,flexWrap:"wrap"}}>
          {j.axles.map(a=>{
            const {bg,col,border}=typeStyle(a.type);
            return <span key={a.id} style={{padding:"2px 8px",borderRadius:20,fontSize:10,
              fontFamily:FM,background:"#eb0000",color:"#ffffff",border:"1px solid #eb0000"}}>
              {a.label} · {a.type}</span>;
          })}
        </div>
      </button>
    </div>
  );
}

function Dashboard({ jobs, onNew, onOpen, onDelete }) {
  const [q,setQ]=useState("");
  const filtered=jobs.filter(j=>
    [j.customer.company,j.customer.name,j.vehicle.reg,j.vehicle.make,j.vehicle.model]
      .join(" ").toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"flex",alignItems:"flex-end",justifyContent:"space-between",gap:12,flexWrap:"wrap",paddingTop:4}}>
        <div>
          <div style={{width:160,flexShrink:0}} dangerouslySetInnerHTML={{__html:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 354 70"><defs><style>.wc1{fill:#eb0000}.wc2{fill:#ffffff}</style></defs><g><g><rect class="wc1" x="2" y="33" width="64" height="4"/><path class="wc2" d="M0,1v68h68V1H0ZM61.17,5L4,62.17V5h57.17ZM6.83,65L64,7.83v57.17H6.83Z"/></g><g><polygon class="wc2" points="134.26 .99 111.74 69.01 120.53 69.01 142.87 1.38 165.2 69.01 174 69.01 151.47 .99 134.26 .99"/><path class="wc2" d="M334.95,30.66l-8.99-2.17c-11.02-2.66-14.12-5.52-14.12-10.65,0-6.9,5.99-10.75,14.7-10.75,10.25,0,16.24,6.01,17.02,14.1h8.61c-1.16-11.73-9.47-21.2-26.01-21.2-12.57,0-23.3,7.1-23.3,18.24,0,9.46,6.57,15.48,20.5,18.83l8.99,2.17c8.6,2.07,12.57,5.72,12.57,12.03,0,7.2-6.86,11.63-16.73,11.63s-17.79-8.08-18.37-17.84h-8.6c.87,12.92,9.86,24.94,27.36,24.94,15.86,0,25.43-8.38,25.43-18.63,0-11.83-6.67-17.75-19.05-20.7Z"/><polygon class="wc2" points="218.1 69 257 68.99 257 61.9 226.41 61.9 226.41 37.65 257 37.65 257 30.55 226.41 30.55 226.41 8.07 257 8.07 257 .97 218.1 .97 218.1 69"/></g></g></svg>`}}/>
          <div style={{fontFamily:FB,fontSize:12,color:"#ffffff",marginTop:6}}>
            {jobs.length} job{jobs.length!==1?"s":""}&nbsp;·&nbsp;
            <span style={{color:"#eb0000",fontWeight:"600"}}>{jobs.filter(j=>j.syncStatus==="local").length} unsynced</span>
          </div>
        </div>
        <Btn onClick={onNew}>+ New Job</Btn>
      </div>

      <div style={{position:"relative"}}>
        <span style={{position:"absolute",left:11,top:"50%",transform:"translateY(-50%)",color:T.textDim,fontSize:16,pointerEvents:"none"}}>⌕</span>
        <input value={q} onChange={e=>setQ(e.target.value)}
          placeholder="Search company, name, REG, make…"
          style={{width:"100%",boxSizing:"border-box",background:"#e5e5e5",
            border:"1px solid rgba(5,5,5,0.10)",borderRadius:"0.3rem",padding:"9px 12px 9px 34px",
            color:T.text,fontFamily:FB,fontSize:13,outline:"none"}}/>
      </div>

      <div style={{display:"flex",flexDirection:"column",gap:"1rem"}}>
        {filtered.length===0&&(
          <div style={{textAlign:"center",padding:"48px 0",color:T.textDim,fontFamily:FB}}>
            {q?"No jobs match that search.":"No jobs yet — create your first job."}
          </div>
        )}
        {filtered.map(j=>(
          <SwipeableJobCard key={j.id} j={j} onOpen={onOpen} onDelete={onDelete}/>
        ))}
      </div>
    </div>
  );
}

/* Deep clone axles clearing all reading values but keeping structure */
function cloneAxlesEmpty(axles) {
  return axles.map(a => ({
    ...a,
    id: uid(),
    toeLeft:"", toeRight:"",
    camberLeft:"", camberRight:"",
    casterLeft:"", casterRight:"",
    kpiLeft:"",    kpiRight:"",
    maxTurnLeft:"", maxTurnRight:"",
    tootLeft:"",    tootRight:"",
    frontScaleLeft:"", rearScaleLeft:"",
    frontScaleRight:"", rearScaleRight:"",
    targetToeLeft:"", targetToeRight:"",
    // axleDistance kept — same vehicle same geometry
  }));
}

function ReadingsPanel({ axles, setAxles, isJosam=false, fullDistance="", setFullDistance, beforeAxles=null, jobRef=null, onConfigClick=null }) {
  // showGeo lives HERE so it survives axle data re-renders without remounting
  const [geoOpen, setGeoOpen] = useState({});
  const toggleGeo = id => setGeoOpen(prev => ({...prev, [id]: !prev[id]}));
  const [adjOpen, setAdjOpen] = useState({});
  const toggleAdj = id => setAdjOpen(prev => ({...prev, [id]: !prev[id]}));

  const updAxle = useCallback(ax =>
    setAxles(prev => (Array.isArray(prev) ? prev : []).map(a => a.id===ax.id ? ax : a)),
  [setAxles]);
  const addAxle = useCallback(type =>
    setAxles(prev => {
      const arr = Array.isArray(prev) ? prev : [];
      let label;
      if (type==="steering") {
        const existingSteer = arr.filter(a=>a.type==="steering").length;
        label = existingSteer===0 ? "Front Steer" : "Second Steer";
      } else if (type==="rear-steer") {
        label = "Rear Steer";
      } else {
        label = "Non Steer";
      }
      return [...arr,
        type==="steering"   ? makeSteeringAxle(label)
        : type==="rear-steer" ? makeRearSteerAxle(label)
        : makeFixedAxle(label)];
    }),
  [setAxles]);
  const removeAxle = useCallback(id =>
    setAxles(prev => (Array.isArray(prev) ? prev : []).filter(a => a.id!==id)),
  [setAxles]);
  const relabel = useCallback((id,v) =>
    setAxles(prev => (Array.isArray(prev) ? prev : []).map(a => a.id===id ? {...a,label:v} : a)),
  [setAxles]);



  return (
    <>
      {/* Config picker */}
      {onConfigClick&&(
        <ConfigPicker job={jobRef} configs={[]} onSelectConfig={onConfigClick} onOpenLibrary={onConfigClick}/>
      )}
      {/* Full distance input — Josam mode only, on Before tab */}
      {isJosam && setFullDistance && (
        <div style={{background:"rgba(235,0,0,0.06)",border:"1px solid rgba(235,0,0,0.15)",
          borderRadius:"0.3rem",padding:"12px 14px"}}>
          <div style={{fontFamily:FB,fontSize:12,fontWeight:"600",color:"#050505",marginBottom:6}}>
            Josam AM — Full Scale Distance
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
<DistancePicker value={fullDistance} onChange={v=>setFullDistance(v)}/>
            <span style={{fontFamily:FB,fontSize:12,color:"rgba(5,5,5,0.5)"}}>
              metres (front scale to rear scale)
            </span>
          </div>
          {(!fullDistance||parseFloat(fullDistance)===0)&&(
            <div style={{fontFamily:FB,fontSize:11,color:"#eb0000",marginTop:6}}>
              Enter full distance to enable toe calculation
            </div>
          )}
        </div>
      )}
      {isJosam && !setFullDistance && fullDistance && (
        <div style={{background:"#f7f7f7",border:"1px solid rgba(5,5,5,0.10)",
          borderRadius:"0.3rem",padding:"8px 14px",display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontFamily:FB,fontSize:11,color:"rgba(5,5,5,0.5)"}}>Full distance (D):</span>
          <span style={{fontFamily:FM,fontSize:13,color:"#050505",fontWeight:"600"}}>{fullDistance}m</span>
        </div>
      )}
      {axles.map((axle,idx)=>(
        <div key={axle.id} style={{background:"#e5e5e5",border:"1px solid rgba(5,5,5,0.10)",borderRadius:"0.3rem"}}>
          <div style={{background:"#efefef",borderBottom:"1px solid rgba(5,5,5,0.10)",
            padding:"10px 14px",display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:28,height:28,borderRadius:"0.3rem",flexShrink:0,
              background:"#eb0000",display:"flex",alignItems:"center",justifyContent:"center",
              fontSize:11,fontWeight:"700",fontFamily:FM,color:"#ffffff"}}>{idx+1}</div>
            <input value={axle.label} onChange={e=>relabel(axle.id,e.target.value)}
              style={{flex:1,background:"transparent",border:"none",outline:"none",
                fontFamily:FD,fontSize:15,color:"#050505",letterSpacing:"0.04em",fontWeight:"600"}}/>
            <span style={{fontSize:9,fontFamily:FM,padding:"2px 8px",borderRadius:"0.3rem",
              background:"#eb0000",color:"#ffffff",border:"1px solid #eb0000"}}>{axle.type}</span>
            {axles.length>1&&(
              <button onClick={()=>removeAxle(axle.id)}
                style={{background:"none",border:"none",color:"rgba(5,5,5,0.25)",cursor:"pointer",fontSize:16,padding:"0 4px",lineHeight:1}}
                onMouseEnter={e=>e.currentTarget.style.color="#eb0000"}
                onMouseLeave={e=>e.currentTarget.style.color="rgba(5,5,5,0.25)"}>✕</button>
            )}
          </div>
          <div style={{padding:"16px 14px"}}>
            {axle.type==="steering"&&(()=>{
              const D = parseFloat(fullDistance)||0;
              const si = axles.slice(0,idx).filter(a=>a.type==="steering").length;
              // Get front steer axle SM value for twinsteer calc
              let frontSM = null;
              if (si>=1) {
                const frontAxle = axles.find(a=>a.type==="steering");
                if (frontAxle) {
                  let ftL = frontAxle.toeLeft, ftR = frontAxle.toeRight;
                  if (isJosam && D>0) {
                    if (hasVal(frontAxle.frontScaleLeft)&&hasVal(frontAxle.rearScaleLeft))
                      ftL = String((parseFloat(frontAxle.frontScaleLeft)-parseFloat(frontAxle.rearScaleLeft))/D);
                    if (hasVal(frontAxle.frontScaleRight)&&hasVal(frontAxle.rearScaleRight))
                      ftR = String((parseFloat(frontAxle.frontScaleRight)-parseFloat(frontAxle.rearScaleRight))/D);
                  }
                  if (hasVal(ftL)&&hasVal(ftR)) {
                    const fsm = calcSteeringMiddle({...frontAxle,toeLeft:ftL,toeRight:ftR});
                    if (fsm) frontSM = normaliseSMForTwinsteer({...frontAxle,toeLeft:ftL,toeRight:ftR}, fsm.value);
                  }
                }
              }
              return <SteeringAxlePanel axle={axle} onChange={updAxle}
                showGeo={!!geoOpen[axle.id]} onToggleGeo={()=>toggleGeo(axle.id)}
                showAdj={!!adjOpen[axle.id]} onToggleAdj={()=>toggleAdj(axle.id)}
                isJosam={isJosam} fullDistance={fullDistance} isAfter={!setFullDistance}
                beforeAxle={beforeAxles?.find(b=>b.label===axle.label)||null}
                steerIndex={si} frontSteerSM={frontSM}/>;
            })()}
            {axle.type==="rear-steer"&&<RearSteerAxlePanel axle={axle} onChange={updAxle}
              showGeo={!!geoOpen[axle.id]} onToggleGeo={()=>toggleGeo(axle.id)}
              showAdj={!!adjOpen[axle.id]} onToggleAdj={()=>toggleAdj(axle.id)}
              isJosam={isJosam} fullDistance={fullDistance} isAfter={!setFullDistance}
              beforeAxle={beforeAxles?.find(b=>b.label===axle.label)||null}
              allAxles={axles}/>}
            {axle.type==="fixed"&&<FixedAxlePanel axle={axle} onChange={updAxle}
              showGeo={!!geoOpen[axle.id]} onToggleGeo={()=>toggleGeo(axle.id)}
              showAdj={!!adjOpen[axle.id]} onToggleAdj={()=>toggleAdj(axle.id)}
              isJosam={isJosam} fullDistance={fullDistance} isAfter={!setFullDistance}
              beforeAxle={beforeAxles?.find(b=>b.label===axle.label)||null}
              allAxles={axles}/>}
          </div>
        </div>
      ))}
<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
        <Btn variant="ghost" small onClick={()=>addAxle("steering")}>+ Steer Axle</Btn>
        <Btn variant="ghost" small onClick={()=>addAxle("rear-steer")}>+ Rear Steer</Btn>
        <Btn variant="ghost" small onClick={()=>addAxle("fixed")}>+ Non Steer</Btn>
      </div>
    </>
  );
}

/* ── Adjustment Panel (Josam only) ───────────────────────────── */
function AdjustmentPanel({ beforeAxles, fullDistance }) {
  const D = parseFloat(fullDistance) || 0;

  function getBeforeToe(axle, side) {
    // Try Josam calculated toe first, fall back to direct entry
    const front = parseFloat(side==="left" ? axle.frontScaleLeft : axle.frontScaleRight);
    const rear  = parseFloat(side==="left" ? axle.rearScaleLeft  : axle.rearScaleRight);
    if (!isNaN(front) && !isNaN(rear) && D>0) return (front-rear)/D;
    const direct = parseFloat(side==="left" ? axle.toeLeft : axle.toeRight);
    return isNaN(direct) ? null : direct;
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{background:"rgba(235,0,0,0.06)",border:"1px solid rgba(235,0,0,0.15)",
        borderRadius:"0.3rem",padding:"10px 14px"}}>
        <div style={{fontFamily:FB,fontSize:12,fontWeight:"600",color:"#050505",marginBottom:2}}>
          Josam AM — Adjustment Mode
        </div>
        <div style={{fontFamily:FB,fontSize:11,color:"rgba(5,5,5,0.5)"}}>
          Enter target toe per wheel. The app calculates how much to move each scale reading.
        </div>
      </div>

      {(Array.isArray(beforeAxles)?beforeAxles:[]).map(axle=>{
        const Da   = parseFloat(axle.axleDistance) || 0;
        const toeL = getBeforeToe(axle, "left");
        const toeR = getBeforeToe(axle, "right");
        const [targets, setTargets] = useState({l:"", r:""});

        const deltaL = hasVal(targets.l) && toeL!==null ? parseFloat(targets.l)-toeL : null;
        const deltaR = hasVal(targets.r) && toeR!==null ? parseFloat(targets.r)-toeR : null;
        const adjL   = deltaL!==null && Da>0 ? deltaL * Da : null;
        const adjR   = deltaR!==null && Da>0 ? deltaR * Da : null;

        // Far scale current reading
        const farScaleL = parseFloat(axle.rearScaleLeft)  || null;
        const farScaleR = parseFloat(axle.rearScaleRight) || null;
        const newFarL = adjL!==null && farScaleL!==null ? farScaleL - adjL : null;
        const newFarR = adjR!==null && farScaleR!==null ? farScaleR - adjR : null;

        return (
          <div key={axle.id} style={{background:"#f7f7f7",border:"1px solid rgba(5,5,5,0.10)",
            borderRadius:"0.3rem",overflow:"hidden"}}>
            <div style={{background:"#efefef",borderBottom:"1px solid rgba(5,5,5,0.10)",
              padding:"8px 14px",display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:22,height:22,borderRadius:"0.3rem",background:"#eb0000",
                display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:10,fontWeight:"700",fontFamily:FM,color:"#fff",flexShrink:0}}>
                {axle.label?.[0]||"A"}
              </div>
              <span style={{fontFamily:FD,fontSize:14,color:"#050505",fontWeight:"600"}}>{axle.label}</span>
              {Da>0&&<span style={{fontFamily:FM,fontSize:10,color:"rgba(5,5,5,0.4)",marginLeft:"auto"}}>Da = {Da}m</span>}
            </div>
            <div style={{padding:"14px"}}>
              {D===0&&<div style={{fontFamily:FB,fontSize:12,color:"#eb0000",marginBottom:8}}>
                ⚠ Set full distance (D) in job details first
              </div>}
              {Da===0&&<div style={{fontFamily:FB,fontSize:12,color:"#eb0000",marginBottom:8}}>
                ⚠ Set axle distance (Da) in Before readings first
              </div>}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                {[
                  {side:"Left",  toe:toeL, target:targets.l, setTgt:v=>setTargets(p=>({...p,l:v})), adj:adjL, newFar:newFarL, farScale:farScaleL},
                  {side:"Right", toe:toeR, target:targets.r, setTgt:v=>setTargets(p=>({...p,r:v})), adj:adjR, newFar:newFarR, farScale:farScaleR},
                ].map(({side,toe,target,setTgt,adj,newFar,farScale})=>(
                  <div key={side} style={{display:"flex",flexDirection:"column",gap:8}}>
                    <div style={{fontFamily:FB,fontSize:10,fontWeight:"600",color:"#050505",
                      textTransform:"uppercase",letterSpacing:"0.08em"}}>{side}</div>
                    <div style={{background:"#efefef",borderRadius:"0.3rem",padding:"6px 10px"}}>
                      <div style={{fontSize:8,color:"rgba(5,5,5,0.5)",fontFamily:FB,textTransform:"uppercase"}}>Current</div>
                      <div style={{fontFamily:FM,fontSize:14,color:"#050505",fontWeight:"600"}}>
                        {toe!==null ? `${toe>=0?"+":""}${toe.toFixed(1)} mm` : "—"}
                      </div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:3}}>
                      <label style={{fontSize:9,color:"#050505",fontFamily:FB,
                        textTransform:"uppercase",letterSpacing:"0.06em"}}>Target Toe</label>
                      <input defaultValue={target}
                        onBlur={e=>setTgt(e.target.value)}
                        onKeyDown={e=>{if(e.key==="Enter"||e.key==="Tab")setTgt(e.target.value);}}
                        placeholder="e.g. 0.0"
                        style={{background:"#e5e5e5",border:"1.5px solid rgba(5,5,5,0.15)",
                          borderRadius:"0.3rem",outline:"none",padding:"6px 10px",
                          color:"#050505",fontFamily:FM,fontSize:13,fontWeight:"600",
                          width:"100%",boxSizing:"border-box"}}/>
                    </div>
                    {adj!==null&&(
                      <div style={{background:"rgba(235,0,0,0.06)",border:"1px solid rgba(235,0,0,0.2)",
                        borderRadius:"0.3rem",padding:"8px 10px"}}>
                        <div style={{fontSize:8,color:"#eb0000",fontFamily:FB,
                          textTransform:"uppercase",fontWeight:"600",marginBottom:4}}>
                          Scale Adjustment
                        </div>
                        <div style={{fontFamily:FM,fontSize:14,color:"#eb0000",fontWeight:"700"}}>
                          {adj>=0?"+":""}{adj.toFixed(1)} mm
                        </div>
                        {newFar!==null&&<div style={{fontFamily:FB,fontSize:11,color:"rgba(5,5,5,0.6)",marginTop:4}}>
                          Move far scale to <strong style={{color:"#050505",fontFamily:FM}}>{newFar.toFixed(1)}</strong>
                        </div>}
                        {newFar===null&&Da>0&&<div style={{fontFamily:FB,fontSize:11,color:"rgba(5,5,5,0.5)",marginTop:2}}>
                          Enter scale readings in Before to see target
                        </div>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   REPORT / PDF
══════════════════════════════════════════════════════════════ */

function ReportScreen({ job, company, onClose }) {
  const [exporting, setExporting] = useState(false);
  const D = parseFloat(job.fullDistance)||0;
  const fmtDate = iso => new Date(iso).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});
  const f1 = v => v===null||v===undefined ? "—" : `${v>=0?"+":""}${v.toFixed(1)}`;
  const f2 = v => v===null||v===undefined ? "—" : `${v>=0?"+":""}${v.toFixed(2)}`;
  const fDeg = v => v===null||v===undefined ? "—" : `${v>=0?"+":""}${fDM(v)}`;

  function effToe(axle, side) {
    const direct = side==="left" ? axle.toeLeft : axle.toeRight;
    if (hasVal(direct)) return parseFloat(direct);
    if (D>0) {
      const f = parseFloat(side==="left" ? axle.frontScaleLeft : axle.frontScaleRight);
      const r = parseFloat(side==="left" ? axle.rearScaleLeft  : axle.rearScaleRight);
      if (!isNaN(f)&&!isNaN(r)) return (f-r)/D;
    }
    return null;
  }

  function axleVals(axle, allAxles) {
    const tL = effToe(axle,"left"), tR = effToe(axle,"right");
    const hasToe = tL!==null && tR!==null;
    const total = hasToe ? tL+tR : null;
    const smObj = hasToe ? calcSteeringMiddle({...axle,
      toeLeft:String(tL), toeRight:String(tR)}) : null;
    const oosObj = hasToe ? calcToe(String(tL),String(tR)) : null;
    const para = allAxles ? calcVehicleParallelism(allAxles, job.fullDistance||"") : null;
    const g = k => hasVal(axle[k]) ? parseFloat(axle[k]) : null;
    return {
      tL, tR, total, smObj, oosObj, para,
      camberL:g("camberLeft"), camberR:g("camberRight"),
      casterL:g("casterLeft"), casterR:g("casterRight"),
      kpiL:g("kpiLeft"), kpiR:g("kpiRight"),
      maxTL:g("maxTurnLeft"), maxTR:g("maxTurnRight"),
      tootL:g("tootLeft"), tootR:g("tootRight"),
    };
  }

  function tlC(v, tol) {
    if (v===null||!tol) return "#111";
    const r = trafficLight(String(v), tol);
    return r==="green"?"#16a34a":r==="red"?"#dc2626":"#111";
  }

  // OOS axle tilt: 0° if |oos|<=2, else (|oos|-2)*2.5°, cap 12°
  function oosDeg(oos) {
    if (oos===null) return 0;
    const ab = Math.min(Math.abs(oos), 5); // cap at 5mm so diagram never clips
    if (ab<=2) return 0;
    const deg = Math.min((ab-2)*2.5, 7.5); // max 7.5° at 5mm
    return oos<0 ? deg : -deg;
  }

  const beforeAxles = Array.isArray(job.axles) ? job.axles : [];
  const afterAxles  = Array.isArray(job.afterAxles) ? job.afterAxles : [];
  const hasAfter    = afterAxles.length > 0;

  // SVG panel constants — simple wheel rects
  const WH = 42;    // wheel height
  const WW = 12;    // wheel width
  const DUAL_GAP = 4; // gap between dual tyres

  // Box helper — centred at cx, fixed width
  function Box({cx, y, w, label, value, col="#111", bkg="#f5f5f5"}) {
    const x = cx - w/2;
    return (
      <g>
        <rect x={x} y={y} width={w} height={22} rx="2" fill={bkg} stroke="#ccc" strokeWidth="0.6"/>
        <text x={cx} y={y+8} fontSize="5.5" fill="#888" textAnchor="middle" fontFamily="Arial">{label}</text>
        <text x={cx} y={y+18} fontSize="7" fontWeight="bold" fill={col} textAnchor="middle" fontFamily="Arial">{value}</text>
      </g>
    );
  }

  // Single wheel SVG (bird's eye) with rolling direction line
  function Wheel({cx, cy, toe, outer=true, dual=false}) {
    const rot = -toe * 2.5; // left wheel: pos toe = neg rotation; right handled by caller negating
    const sw = outer ? 1.5 : 1;
    const sc = outer ? "#333" : "#555";
    return (
      <g transform={`translate(${cx},${cy}) rotate(${rot})`}>
        <rect x={-WW/2} y={-WH/2} width={WW} height={WH} rx="2" fill="white" stroke={sc} strokeWidth={sw}/>
        {outer && <line x1="0" y1={-WH/2-6} x2="0" y2={WH/2+6} stroke="#eb0000" strokeWidth="1" strokeDasharray="3 2"/>}
      </g>
    );
  }

  // ── AxlePanel: renders one axle column (before or after) matching PDF layout ──
  // Layout per your PDF:
  //   Row 1: [Axle label left] [TOTAL TOE box centre]
  //   Row 2: [LEFT TOE left] [Axle diagram centre] [RIGHT TOE right]
  //   Row 3 steer:  [STEERING MIDDLE centre] [TWINSTEER beside if twin]
  //   Row 3 fixed:  [LEFT CAMBER left] [OUT OF SQUARE centre] [RIGHT CAMBER right]  (only if camber entered)
  //   Row 4: Geo table (steer: full 5-col; fixed: hidden — camber shown above)
  //          Hidden entirely if no geo entered
  function AxlePanel({axle, allAxles, steerIdx, frontSM, label, isAfter=false}) {
    const v = axleVals(axle, allAxles);
    const isSteer = axle.type==="steering"||axle.type==="rear-steer";
    const isFixed = axle.type==="fixed";
    const t = axle.tolerances||{};
    const isDual = axle.dualWheel||false;

    const tsVal = (steerIdx>=1 && frontSM!==null && v.smObj) ?
      normaliseSMForTwinsteer(axle, v.smObj.value) - frontSM : null;

    const oosTilt = isFixed && v.oosObj ? oosDeg(v.oosObj.outOfSquare) : 0;

    const geoL = [v.camberL, v.casterL, v.kpiL, v.maxTL, v.tootL];
    const geoR = [v.camberR, v.casterR, v.kpiR, v.maxTR, v.tootR];
    const hasGeoSteer = isSteer && geoL.concat(geoR).some(x=>x!==null);

    const BW = 72; // all boxes same fixed width
    const BOX = {
      border:"0.4pt solid #ddd", borderRadius:"2pt", padding:"3pt 4pt",
      background:"#f8f8f8", textAlign:"center",
      width:BW, boxSizing:"border-box", flexShrink:0,
    };
    const SML = {fontSize:"4.5pt",color:"#888",textTransform:"uppercase",
      letterSpacing:"0.04em",marginBottom:1,whiteSpace:"nowrap"};
    const VAL = (col="#111") => ({fontSize:"7.5pt",fontWeight:"bold",color:col,whiteSpace:"nowrap"});

    const DIAG_W = 173;
    const TOE_W = BW + 8; // toe column width px

    return (
      <div style={{fontFamily:"Arial,sans-serif",fontSize:"7pt",color:"#111"}}>

        {/* Row 1: Axle label left, Total Toe box centred */}
        <div style={{display:"flex",alignItems:"center",marginBottom:3}}>
          <div style={{fontWeight:"bold",fontSize:"7.5pt",whiteSpace:"nowrap",
            width:TOE_W,flexShrink:0}}>{label}</div>
          <div style={{flex:1,display:"flex",justifyContent:"center"}}>
            {v.total!==null&&(
              <div style={BOX}>
                <div style={SML}>TOTAL TOE</div>
                <div style={VAL(tlC(v.total,t.totalToe))}>{f1(v.total)}mm</div>
              </div>
            )}
          </div>
          <div style={{width:TOE_W,flexShrink:0}}/>
        </div>

        {/* Row 2: Left toe | diagram | Right toe — all fixed px widths, centred */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",
          gap:0,marginBottom:3}}>
          <div style={{width:TOE_W,flexShrink:0,display:"flex",
            justifyContent:"flex-end",paddingRight:8}}>
            {v.tL!==null&&(
              <div style={BOX}>
                <div style={SML}>LEFT TOE</div>
                <div style={VAL(tlC(v.tL,t.toeLeft))}>{f1(v.tL)}mm</div>
              </div>
            )}
          </div>
          <div style={{width:DIAG_W,flexShrink:0,display:"flex",justifyContent:"center"}}>
            <AxleDiagramNew
              axleType={axle.type} dual={isDual}
              toeLeft={v.tL||0} toeRight={v.tR||0}
              driveSide={axle.driveSide||"RHD"} steerIndex={steerIdx||0}
              oosTilt={oosTilt} width={DIAG_W}
              noRoll={v.tL===null&&v.tR===null}/>
          </div>
          <div style={{width:TOE_W,flexShrink:0,display:"flex",
            justifyContent:"flex-start",paddingLeft:8}}>
            {v.tR!==null&&(
              <div style={BOX}>
                <div style={SML}>RIGHT TOE</div>
                <div style={VAL(tlC(v.tR,t.toeRight))}>{f1(v.tR)}mm</div>
              </div>
            )}
          </div>
        </div>

        {/* Row 3 steer: Steering Middle [+ Twinsteer] centred */}
        {isSteer && v.smObj && (
          <div style={{display:"flex",gap:6,justifyContent:"center",marginBottom:3}}>
            <div style={BOX}>
              <div style={SML}>STEERING MIDDLE</div>
              <div style={VAL(tlC(v.smObj.value,t.steeringMiddle))}>{f1(v.smObj.value)}mm</div>
            </div>
            {steerIdx>=1&&tsVal!==null&&(
              <div style={BOX}>
                <div style={SML}>TWINSTEER</div>
                <div style={VAL(tlC(tsVal,t.twinsteer))}>{f1(tsVal)}mm</div>
              </div>
            )}
          </div>
        )}

        {/* Row 3 fixed: Left Camber | [OOS  Parallelism side by side] | Right Camber */}
        {isFixed && (
          <div style={{display:"flex",alignItems:"flex-start",gap:6,
            justifyContent:"center",marginBottom:3}}>
            {/* Left camber — only if entered */}
            <div style={{width:58,textAlign:"center"}}>
              {v.camberL!==null&&(
                <div style={BOX}>
                  <div style={SML}>LEFT CAMBER</div>
                  <div style={VAL()}>{fDeg(v.camberL)}</div>
                </div>
              )}
            </div>
            {/* OOS + Parallelism — same fixed width, side by side */}
            <div style={{display:"flex",gap:4}}>
              {v.oosObj&&(
                <div style={BOX}>
                  <div style={SML}>OUT OF SQUARE</div>
                  <div style={VAL(tlC(v.oosObj.outOfSquare,t.outOfSquare))}>
                    {f1(v.oosObj.outOfSquare)}mm
                  </div>
                </div>
              )}
              {v.para&&(
                <div style={BOX}>
                  <div style={SML}>PARALLELISM</div>
                  <div style={VAL(tlC(v.para.value,t.parallelism))}>
                    {f1(v.para.value)}mm
                  </div>
                </div>
              )}
            </div>
            {/* Right camber — only if entered */}
            <div style={{width:58,textAlign:"center"}}>
              {v.camberR!==null&&(
                <div style={BOX}>
                  <div style={SML}>RIGHT CAMBER</div>
                  <div style={VAL()}>{fDeg(v.camberR)}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Geo table — steer only, hidden if no values entered */}
        {hasGeoSteer && (()=>{
          const GEO_COLS = ["Camber","Caster","KPI","Max Turn","TOOT"];
          const rows = [
            {lbl:"Left Wheel",  vals:[v.camberL,v.casterL,v.kpiL,v.maxTL,v.tootL]},
            {lbl:"Right Wheel", vals:[v.camberR,v.casterR,v.kpiR,v.maxTR,v.tootR]},
          ];
          const tdS = {textAlign:"center",fontWeight:"bold",color:"#111",
            padding:"2pt 2pt",border:"0.4pt solid #ddd",fontSize:"6pt"};
          const thS = {textAlign:"center",color:"#888",fontWeight:"normal",
            padding:"1.5pt 0",border:"0.4pt solid #ddd",fontSize:"5.5pt"};
          return (
            <table style={{width:"100%",borderCollapse:"collapse",marginTop:2,
              tableLayout:"fixed",fontSize:"6pt",fontFamily:"Arial,sans-serif"}}>
              <thead>
                <tr style={{background:"#f0f0f0"}}>
                  <th style={{width:32,background:"#e8e8e8",border:"0.4pt solid #ddd"}}></th>
                  {GEO_COLS.map(c=><th key={c} style={thS}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row,ri)=>(
                  <tr key={ri} style={{background:ri===0?"white":"#fafafa"}}>
                    <td style={{background:ri===0?"#f5f5f5":"#efefef",padding:"2pt 2pt",
                      fontWeight:"bold",color:"#666",textAlign:"center",
                      border:"0.4pt solid #ddd",fontSize:"5pt"}}>{row.lbl}</td>
                    {row.vals.map((val,ci)=>(
                      <td key={ci} style={tdS}>{ci<3 ? fDeg(val) : (val===null?"—":`${f1(val)}°`)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })()}
      </div>
    );
  }

  const PANEL_W = 380;

  const printReport = () => {
    const el = document.getElementById("aes-report");
    if (!el) return;
    let iframe = document.getElementById("aes-print-frame");
    if (iframe) iframe.remove();
    iframe = document.createElement("iframe");
    iframe.id = "aes-print-frame";
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><title>Alignment Report</title>
      <style>
        @page{size:A4 landscape;margin:8mm}
        body{margin:0;padding:0;font-family:Arial,sans-serif;
          -webkit-print-color-adjust:exact;print-color-adjust:exact}
        table{border-collapse:collapse}
        svg{overflow:visible}
        .axle-row{page-break-inside:avoid}
      </style></head><body>${el.innerHTML}</body></html>`);
    doc.close();
    const cleanup = () => { if (iframe && iframe.parentNode) iframe.remove(); };
    iframe.contentWindow.onafterprint = cleanup;
    setTimeout(()=>{
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(cleanup, 60000);
    }, 500);
  };

  const exportPdf = async () => {
    const el = document.getElementById("aes-report");
    if (!el || exporting) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      const img = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(pageW / canvas.width, pageH / canvas.height);
      const drawW = canvas.width * ratio;
      const drawH = canvas.height * ratio;
      const x = (pageW - drawW) / 2;
      pdf.addImage(img, "PNG", x, 0, drawW, drawH);
      const reg = (job.vehicle?.reg||"").toUpperCase().replace(/\s+/g,"") || "report";
      pdf.save(`${reg}-alignment-report.pdf`);
    } catch (e) {
      alert("Could not export PDF. Please try Print / Save PDF instead.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{display:"flex",flexDirection:"column",minHeight:"100vh",background:"#e8e8e8"}}>
      {/* Top bar */}
      <div style={{position:"sticky",top:0,zIndex:20,background:"#050505",
        borderBottom:"1px solid rgba(255,255,255,0.08)",padding:"10px 16px",
        display:"flex",alignItems:"center",gap:12}}>
        <button onClick={onClose} style={{background:"none",border:"none",color:"#eb0000",
          cursor:"pointer",fontSize:22,lineHeight:1}}>←</button>
        <span style={{flex:1,fontFamily:FD,fontSize:15,color:"#fff",fontWeight:"600"}}>Report Preview</span>
        <button onClick={exportPdf} disabled={exporting} style={{background:"transparent",
          border:"1px solid #eb0000",borderRadius:"0.3rem",padding:"8px 16px",color:"#eb0000",
          fontFamily:FB,fontWeight:"600",fontSize:13,cursor:exporting?"default":"pointer",
          opacity:exporting?0.6:1}}>
          {exporting ? "Exporting…" : "Export PDF"}
        </button>
        <button onClick={printReport} style={{background:"#eb0000",border:"none",borderRadius:"0.3rem",
          padding:"8px 16px",color:"#fff",fontFamily:FB,fontWeight:"600",fontSize:13,cursor:"pointer"}}>
          Print / Save PDF
        </button>
      </div>

      {/* A4 preview */}
      <div style={{padding:16,overflowX:"auto"}}>
        <div id="aes-report" style={{
          background:"#fff",width:"277mm",minWidth:"277mm",margin:"0 auto",
          padding:"8mm 8mm",boxSizing:"border-box",
          boxShadow:"0 2px 16px rgba(0,0,0,0.18)",
          fontFamily:"Arial,sans-serif",fontSize:"8pt",color:"#000",
        }}>

          {/* ── HEADER ── */}
          <div style={{background:"#111",padding:"6pt 10pt",marginBottom:"6pt",
            display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              {company.logo && <img src={company.logo} alt="logo" style={{height:36,marginBottom:4,display:"block"}}/>}
              {company.name&&<div style={{fontWeight:"bold",fontSize:"11pt",color:"#fff"}}>{company.name}</div>}
              {company.address&&<div style={{fontSize:"6pt",color:"rgba(255,255,255,0.65)"}}>{company.address}</div>}
              {company.phone&&<div style={{fontSize:"6pt",color:"rgba(255,255,255,0.65)"}}>T: {company.phone}</div>}
              {company.email&&<div style={{fontSize:"6pt",color:"rgba(255,255,255,0.65)"}}>E: {company.email}</div>}
              {company.website&&<div style={{fontSize:"6pt",color:"rgba(255,255,255,0.65)"}}>W: {company.website}</div>}
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:"12pt",fontWeight:"bold",color:"#eb0000",letterSpacing:"0.05em"}}>
                WHEEL ALIGNMENT REPORT
              </div>
              <div style={{fontSize:"6pt",color:"rgba(255,255,255,0.6)",marginTop:4}}>
                {fmtDate(job.createdAt)}
                {job.configName&&` · ${job.configName}`}
              </div>
            </div>
          </div>

          {/* ── JOB DETAILS ── */}
          <div style={{display:"flex",gap:0,marginBottom:"6pt",border:"0.5pt solid #e0e0e0",
            background:"#f8f8f8"}}>
            {[
              ["Customer", job.customer.company||job.customer.name||"—"],
              ["Contact",  job.customer.name&&job.customer.company?job.customer.name:"—"],
              ["Phone",    job.customer.phone||"—"],
              ["Vehicle",  [job.vehicle.make,job.vehicle.model,job.vehicle.year].filter(Boolean).join(" ")||"—"],
              ["Reg",      (job.vehicle.reg||"").toUpperCase()||"—"],
              ["Mileage",  job.vehicle.mileage?`${parseInt(job.vehicle.mileage).toLocaleString()} miles`:"—"],
            ].map(([lbl,val])=>(
              <div key={lbl} style={{flex:1,padding:"3pt 5pt",borderRight:"0.5pt solid #e0e0e0"}}>
                <div style={{fontSize:"5pt",color:"#aaa",textTransform:"uppercase",letterSpacing:"0.06em"}}>{lbl}</div>
                <div style={{fontSize:"7pt",fontWeight:"bold"}}>{val}</div>
              </div>
            ))}
          </div>

          {/* ── BEFORE / AFTER SECTION HEADERS ── */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:0,marginBottom:"4pt"}}>
            <div style={{background:"#eb0000",color:"#fff",textAlign:"center",fontSize:"7pt",
              fontWeight:"bold",padding:"3pt",letterSpacing:"0.08em"}}>BEFORE</div>
            <div style={{background:"#222",color:"#fff",textAlign:"center",fontSize:"7pt",
              fontWeight:"bold",padding:"3pt",letterSpacing:"0.08em"}}>AFTER</div>
          </div>

          {/* ── AXLES ── */}
          {beforeAxles.map((bAxle, i) => {
            const aAxle = hasAfter ? (afterAxles.find(a=>a.label===bAxle.label)||null) : null;
            const isSteer = bAxle.type==="steering"||bAxle.type==="rear-steer";
            const steersBefore = beforeAxles.slice(0,i).filter(a=>a.type==="steering").length;
            const steerIdx = bAxle.type==="steering" ? steersBefore : -1;

            // Front steer SM for twinsteer
            let frontSM = null;
            if (steerIdx>=1) {
              const fAxle = beforeAxles.find(a=>a.type==="steering");
              if (fAxle) {
                const ftL = effToe(fAxle,"left"), ftR = effToe(fAxle,"right");
                if (ftL!==null&&ftR!==null) {
                  const fsm = calcSteeringMiddle({...fAxle,toeLeft:String(ftL),toeRight:String(ftR)});
                  if (fsm) frontSM = normaliseSMForTwinsteer(fAxle, fsm.value);
                }
              }
            }
            let frontSMAfter = null;
            if (steerIdx>=1 && aAxle) {
              const fAxleA = afterAxles.find(a=>a.type==="steering");
              if (fAxleA) {
                const ftL = effToe(fAxleA,"left"), ftR = effToe(fAxleA,"right");
                if (ftL!==null&&ftR!==null) {
                  const fsm = calcSteeringMiddle({...fAxleA,toeLeft:String(ftL),toeRight:String(ftR)});
                  if (fsm) frontSMAfter = normaliseSMForTwinsteer(fAxleA, fsm.value);
                }
              }
            }

            return (
              <div key={bAxle.id} className="axle-row" style={{
                display:"grid",gridTemplateColumns:"1fr 1fr",
                gap:0,marginBottom:"6pt",pageBreakInside:"avoid",
                borderBottom:"0.5pt solid #e8e8e8",paddingBottom:"4pt",
              }}>
                {/* BEFORE panel */}
                <div style={{borderRight:"0.5pt solid #ddd",paddingRight:"6pt"}}>
                  <AxlePanel axle={bAxle} allAxles={beforeAxles} steerIdx={steerIdx}
                    frontSM={frontSM} label={`Axle ${i+1}`}/>
                </div>
                {/* AFTER panel */}
                <div style={{paddingLeft:"6pt"}}>
                  {aAxle ? (
                    <AxlePanel axle={aAxle} allAxles={afterAxles} steerIdx={steerIdx}
                      frontSM={frontSMAfter} label={`Axle ${i+1}`} isAfter={true}/>
                  ) : (
                    <div style={{display:"flex",alignItems:"center",justifyContent:"center",
                      height:"100%",minHeight:60,color:"#ccc",fontSize:"7pt"}}>No after readings</div>
                  )}
                </div>
              </div>
            );
          })}

          {/* ── NOTES ── */}
          {job.notes&&(
            <div style={{marginTop:"4pt",padding:"4pt 6pt",border:"0.5pt solid #e0e0e0",
              background:"#fafafa",fontSize:"7pt"}}>
              <span style={{fontSize:"5.5pt",color:"#aaa",textTransform:"uppercase",marginRight:6}}>Notes</span>
              {job.notes}
            </div>
          )}

          {/* ── FOOTER ── */}
          <div style={{marginTop:"6pt",borderTop:"0.5pt solid #e0e0e0",paddingTop:"3pt",
            display:"flex",justifyContent:"space-between",fontSize:"5.5pt",color:"#bbb"}}>
            <span>Generated by AES TrackAlign</span>
            <span>{fmtDate(new Date().toISOString())}</span>
          </div>

        </div>
      </div>
    </div>
  );
}


function JobEditor({ job, allJobs, onSave, onBack, initialTab="job", onOpenConfigs, onApplyConfig, forceTab=null, company={} }) {
  const [j,setJ]=useState(()=>({
    ...job,
    axles: Array.isArray(job.axles) ? job.axles : [makeSteeringAxle("Front"), makeFixedAxle("Rear")],
    afterAxles: job.afterAxles && Array.isArray(job.afterAxles) ? job.afterAxles : null,
    measureMethod: job.measureMethod || "direct",
  }));
  const [tab,setTab]=useState(initialTab);
  useEffect(()=>{ if(forceTab) { setTab(forceTab); window.scrollTo({top:0,behavior:"smooth"}); } },[forceTab]);
  const isJosam = j.measureMethod==="josam";

  const setBeforeAxles = useCallback(updater =>
    setJ(p => ({ ...p, axles: typeof updater === "function" ? updater(p.axles) : updater })),
  []);
  const setAfterAxles = useCallback(updater =>
    setJ(p => ({ ...p, afterAxles: typeof updater === "function" ? updater(p.afterAxles) : updater })),
  []);

  const beforeHasData = Array.isArray(j.axles) && j.axles.some(a =>
    hasVal(a.toeLeft) || hasVal(a.toeRight) ||
    hasVal(a.frontScaleLeft) || hasVal(a.frontScaleRight) ||
    hasVal(a.rearScaleLeft)  || hasVal(a.rearScaleRight)
  );

  function handleTabChange(id) {
    if (id==="after" && !j.afterAxles) {
      setJ(p=>({...p, afterAxles: cloneAxlesEmpty(p.axles)}));
    }
    setTab(id);
    window.scrollTo({top:0, behavior:"smooth"});
  }

  const TABS = [
    {id:"job",     label:"Job Details"},
    {id:"before",  label:"Before"},
    {id:"after",   label:"After",   locked: !beforeHasData},
    {id:"report",  label:"Report",  locked: !beforeHasData},
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",minHeight:"100vh"}}>
      {/* Top bar */}
      <div style={{position:"sticky",top:0,zIndex:20,background:"#050505",
        borderBottom:"1px solid rgba(255,255,255,0.08)",padding:"10px 16px",
        display:"flex",alignItems:"center",gap:12}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:"#eb0000",
          cursor:"pointer",fontSize:22,padding:"0 4px",lineHeight:1}}>←</button>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:FD,fontSize:15,color:"#ffffff",letterSpacing:"0.04em",fontWeight:"600",
            whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
            {j.customer.company||j.vehicle.make||"New Job"} {j.vehicle.model}
            {j.vehicle.reg&&<span style={{color:"#eb0000",fontFamily:FM,fontSize:12,marginLeft:8}}>· {j.vehicle.reg.toUpperCase()}</span>}
          </div>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.5)",fontFamily:FM}}>{j.customer.name||"No contact"}</div>
        </div>
        <Btn small onClick={()=>onSave(j)}>Save</Btn>
      </div>

      <div style={{display:"flex",borderBottom:"1px solid rgba(255,255,255,0.08)",background:"#050505",overflowX:"auto"}}>
        {TABS.filter(t=>!t.josam||isJosam).map(t=>(
          <button key={t.id}
            onClick={()=>!t.locked&&handleTabChange(t.id)}
            style={{
              padding:"10px 16px",border:"none",cursor:t.locked?"not-allowed":"pointer",
              fontFamily:FB,fontWeight:"600",fontSize:12,letterSpacing:"0.06em",
              textTransform:"uppercase",background:"transparent",whiteSpace:"nowrap",
              color:t.locked?"rgba(255,255,255,0.2)":tab===t.id?"#eb0000":"rgba(255,255,255,0.5)",
              borderBottom:tab===t.id?"2px solid #eb0000":"2px solid transparent",
              transition:"color 0.15s",
            }}>
            {t.label}
            {t.locked&&<span style={{fontSize:8,marginLeft:4,opacity:0.5}}>🔒</span>}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{padding:"18px 16px",display:"flex",flexDirection:"column",gap:20,background:"#f7f7f7",minHeight:"100vh",borderRadius:"0.3rem"}}>
        {tab==="job"&&(
          <>
            <JobDetailsTab j={j} setJ={setJ} allJobs={allJobs} isJosam={isJosam}/>
            <button onClick={()=>handleTabChange("before")} style={{
              width:"100%",background:"#eb0000",border:"none",borderRadius:"0.3rem",
              padding:"14px 20px",cursor:"pointer",
              display:"flex",alignItems:"center",justifyContent:"space-between",
              fontFamily:FB,fontWeight:"600",fontSize:15,color:"#ffffff",
              letterSpacing:"0.04em",marginTop:4,
              transition:"opacity 0.15s",
            }}
            onMouseEnter={e=>e.currentTarget.style.opacity="0.88"}
            onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
              <span>Measure Vehicle</span>
              <span style={{fontSize:20,lineHeight:1}}>→</span>
            </button>
          </>
        )}

        {tab==="before"&&(
          <ReadingsPanel axles={j.axles} setAxles={setBeforeAxles}
            isJosam={isJosam} fullDistance={j.fullDistance||""}
            setFullDistance={v=>setJ(p=>({...p,fullDistance:v}))}
            jobRef={j} onConfigClick={()=>onOpenConfigs&&onOpenConfigs(setJ)}
/>
        )}

        {tab==="after"&&j.afterAxles&&(
          <ReadingsPanel axles={j.afterAxles} setAxles={setAfterAxles}
            isJosam={isJosam} fullDistance={j.fullDistance||""}
            setFullDistance={null}
            beforeAxles={j.axles}
/>
        )}

        {tab==="report"&&beforeHasData&&(
          <div style={{padding:0}}>
            <ReportScreen job={j} company={company} onClose={()=>setTab("after")}/>
          </div>
        )}

      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ROOT
══════════════════════════════════════════════════════════════ */
function makeAxleForType(type, label) {
  if (type==="steering")   return makeSteeringAxle(label);
  if (type==="rear-steer") return makeRearSteerAxle(label);
  return makeFixedAxle(label);
}

const LS_ONBOARD_KEY = "trackalign_onboarded_v1";
function hasOnboarded() { try { return !!localStorage.getItem(LS_ONBOARD_KEY); } catch(e){ return false; } }
function setOnboarded() { try { localStorage.setItem(LS_ONBOARD_KEY,"1"); } catch(e){} }

function OnboardingScreen({ onSelect }) {
  return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",padding:"24px 20px"}}>
      <div style={{width:200,marginBottom:32}} dangerouslySetInnerHTML={{__html:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 354 70"><defs><style>.wc1{fill:#eb0000}.wc2{fill:#ffffff}</style></defs><g><g><rect class="wc1" x="2" y="33" width="64" height="4"/><path class="wc2" d="M0,1v68h68V1H0ZM61.17,5L4,62.17V5h57.17ZM6.83,65L64,7.83v57.17H6.83Z"/></g><g><polygon class="wc2" points="134.26 .99 111.74 69.01 120.53 69.01 142.87 1.38 165.2 69.01 174 69.01 151.47 .99 134.26 .99"/><path class="wc2" d="M334.95,30.66l-8.99-2.17c-11.02-2.66-14.12-5.52-14.12-10.65,0-6.9,5.99-10.75,14.7-10.75,10.25,0,16.24,6.01,17.02,14.1h8.61c-1.16-11.73-9.47-21.2-26.01-21.2-12.57,0-23.3,7.1-23.3,18.24,0,9.46,6.57,15.48,20.5,18.83l8.99,2.17c8.6,2.07,12.57,5.72,12.57,12.03,0,7.2-6.86,11.63-16.73,11.63s-17.79-8.08-18.37-17.84h-8.6c.87,12.92,9.86,24.94,27.36,24.94,15.86,0,25.43-8.38,25.43-18.63,0-11.83-6.67-17.75-19.05-20.7Z"/><polygon class="wc2" points="218.1 69 257 68.99 257 61.9 226.41 61.9 226.41 37.65 257 37.65 257 30.55 226.41 30.55 226.41 8.07 257 8.07 257 .97 218.1 .97 218.1 69"/></g></g></svg>`}}/>
      <div style={{fontFamily:FD,fontSize:22,color:"#ffffff",letterSpacing:"0.06em",
        textAlign:"center",marginBottom:8}}>MEASUREMENT METHOD</div>
      <div style={{fontFamily:FB,fontSize:13,color:"rgba(255,255,255,0.5)",
        textAlign:"center",marginBottom:36,maxWidth:280,lineHeight:1.6}}>
        How will you be entering alignment readings? This can be changed later in Settings.
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:12,width:"100%",maxWidth:320}}>
        <button onClick={()=>onSelect("direct")} style={{
          background:"#f7f7f7",border:"none",borderRadius:"0.3rem",padding:"18px 20px",
          cursor:"pointer",textAlign:"left",transition:"background 0.15s"}}
          onMouseEnter={e=>e.currentTarget.style.background="#e5e5e5"}
          onMouseLeave={e=>e.currentTarget.style.background="#f7f7f7"}>
          <div style={{fontFamily:FD,fontSize:16,color:"#050505",fontWeight:"600",marginBottom:4}}>
            Direct Entry
          </div>
          <div style={{fontFamily:FB,fontSize:12,color:"rgba(5,5,5,0.55)"}}>
            Enter toe values directly in mm. Works with any alignment system.
          </div>
        </button>
        <button onClick={()=>onSelect("josam")} style={{
          background:"#eb0000",border:"none",borderRadius:"0.3rem",padding:"18px 20px",
          cursor:"pointer",textAlign:"left",transition:"opacity 0.15s"}}
          onMouseEnter={e=>e.currentTarget.style.opacity="0.88"}
          onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
          <div style={{fontFamily:FD,fontSize:16,color:"#ffffff",fontWeight:"600",marginBottom:4}}>
            Josam Laser AM
          </div>
          <div style={{fontFamily:FB,fontSize:12,color:"rgba(255,255,255,0.75)"}}>
            Enter front and rear scale readings. Toe is calculated automatically.
          </div>
        </button>
      </div>
    </div>
  );
}

function SettingsScreen({ measureMode, setMeasureMode, onBack, company, setCompany }) {
  const upC = (f,v) => setCompany(p=>({...p,[f]:v}));
  return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",flexDirection:"column"}}>
      <div style={{background:"#050505",borderBottom:"1px solid rgba(255,255,255,0.08)",
        padding:"10px 16px",display:"flex",alignItems:"center",gap:12}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:"#eb0000",
          cursor:"pointer",fontSize:22,padding:"0 4px",lineHeight:1}}>←</button>
        <span style={{fontFamily:FD,fontSize:16,color:"#ffffff",fontWeight:"600",
          letterSpacing:"0.04em"}}>Settings</span>
      </div>
      <div style={{padding:"20px 16px",display:"flex",flexDirection:"column",gap:20}}>

        <div style={{background:"#f7f7f7",borderRadius:"0.3rem",padding:"16px"}}>
          <div style={{fontFamily:FB,fontSize:12,fontWeight:"600",color:"#050505",marginBottom:4}}>Report Header</div>
          <div style={{fontFamily:FB,fontSize:11,color:"rgba(5,5,5,0.5)",marginBottom:12}}>Shown at the top of every PDF report.</div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {[["Company Name","name","AES Workshop"],["Address","address","123 High Street"],
              ["Phone","phone","+44 1234 567890"],["Email","email","info@workshop.com"],
              ["Website","website","www.workshop.com"]].map(([label,field,ph])=>(
              <div key={field} style={{display:"flex",flexDirection:"column",gap:3}}>
                <label style={{fontSize:10,fontFamily:FB,textTransform:"uppercase",letterSpacing:"0.06em",color:"rgba(5,5,5,0.5)"}}>{label}</label>
                <input value={company[field]||""} onChange={e=>upC(field,e.target.value)} placeholder={ph}
                  style={{background:"#e5e5e5",border:"1px solid rgba(5,5,5,0.10)",borderRadius:"0.3rem",
                    outline:"none",padding:"8px 10px",color:"#050505",fontFamily:FM,fontSize:13}}/>
              </div>
            ))}
          </div>
        </div>

        <div style={{background:"#f7f7f7",borderRadius:"0.3rem",padding:"16px"}}>
          <div style={{fontFamily:FB,fontSize:12,fontWeight:"600",color:"#050505",marginBottom:4}}>Measurement Method</div>
          <div style={{fontFamily:FB,fontSize:11,color:"rgba(5,5,5,0.5)",marginBottom:12}}>
            Applied to all new jobs. Existing jobs always display in the method they were created with.
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {[{value:"direct",label:"Direct Entry",desc:"Enter toe values directly in mm"},
              {value:"josam",label:"Josam Laser AM",desc:"Front/rear scale readings with auto toe calculation"}
            ].map(o=>(
              <button key={o.value} onClick={()=>setMeasureMode(o.value)} style={{
                background:measureMode===o.value?"#eb0000":"#efefef",border:"none",
                borderRadius:"0.3rem",padding:"12px 14px",cursor:"pointer",textAlign:"left"}}>
                <div style={{fontFamily:FB,fontSize:13,fontWeight:"600",color:measureMode===o.value?"#ffffff":"#050505"}}>{o.label}</div>
                <div style={{fontFamily:FB,fontSize:11,color:measureMode===o.value?"rgba(255,255,255,0.75)":"rgba(5,5,5,0.5)",marginTop:2}}>{o.desc}</div>
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

export default function App() {
  const [jobs,setJobs]=useState(()=>loadJobs()||DEMO);
  const [configs,setConfigs]=useState(()=>loadConfigs());
  const [company,setCompany]=useState(()=>loadCompany());
  const [configScreen,setConfigScreen]=useState(null); // null|"library"|"editor"
  const [editingConfig,setEditingConfig]=useState(null);
  const [screen,setScreen]=useState(()=>hasOnboarded()?"dashboard":"onboarding");
  const [activeId,setActiveId]=useState(null);
  const [measureMode,setMeasureMode]=useState(()=>loadMode());

  useEffect(()=>{ saveJobs(jobs); },[jobs]);
  useEffect(()=>{ saveMode(measureMode); },[measureMode]);
  useEffect(()=>{ saveConfigs(configs); },[configs]);
  useEffect(()=>{ saveCompany(company); },[company]);

  const openJob =id =>{ setActiveId(id); setScreen("job"); setOpenTab("before"); };
  const deleteJob = id => setJobs(p => p.filter(j => j.id !== id));

  const [pendingSetJ, setPendingSetJ] = useState(null);
  function openConfigLibrary(setJFn) { setPendingSetJ(()=>setJFn); setConfigScreen("library"); }
  function newConfig() { setEditingConfig(makeConfig()); setConfigScreen("editor"); }
  function editConfig(c) { setEditingConfig(c); setConfigScreen("editor"); }
  function saveConfig(c) {
    setConfigs(p => p.find(x=>x.id===c.id) ? p.map(x=>x.id===c.id?c:x) : [c,...p]);
    setConfigScreen("library");
  }
  function deleteConfig(id) {
    setConfigs(p=>p.filter(c=>c.id!==id));
    setConfigScreen("library");
  }
  function applyConfig(c, jobId, localApply) {
    const newAxles = c.axles.map(ca=>({
      ...makeAxleForType(ca.type, ca.label),
      tolerances: JSON.parse(JSON.stringify(ca.tolerances||{})),
      dualWheel: ca.dualWheel||false,
      driveSide: ca.driveSide||"RHD",
      suspType:  ca.suspType||"solid",
    }));
    if (localApply) {
      localApply(p=>({...p, axles:newAxles, configId:c.id, configName:c.name, afterAxles:null}));
      // Also persist to jobs store
      setJobs(prev=>prev.map(j=>j.id===jobId
        ? {...j, axles:newAxles, configId:c.id, configName:c.name, afterAxles:null}
        : j));
    } else {
      setJobs(prev=>prev.map(j=>j.id===jobId
        ? {...j, axles:newAxles, configId:c.id, configName:c.name, afterAxles:null}
        : j));
    }
    setConfigScreen(null);
    setScreen("job");
    setOpenTab("before");
    setForceTab("before");
    setTimeout(()=>setForceTab(null), 100);
  }
  const [openTab, setOpenTab]=useState("job");
  const [forceTab, setForceTab]=useState(null);
  const newJob  =()  =>{
    const j={...makeJob(), fullDistance:"", measureMethod:measureMode};
    setJobs(p=>[j,...p]); setActiveId(j.id); setScreen("job"); setOpenTab("job");
  };
  const saveJob =j   =>{ setJobs(p=>p.map(x=>x.id===j.id?{...j,syncStatus:"local"}:x)); setScreen("dashboard"); };

  function handleOnboardSelect(mode) {
    setMeasureMode(mode);
    setOnboarded();
    setScreen("dashboard");
  }

  const activeJob=jobs.find(j=>j.id===activeId);

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com"/>
      <link rel="stylesheet" href={FONT_URL}/>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0}
        body{background:${T.bg};color:${T.text};font-family:${FB};-webkit-font-smoothing:antialiased;font-weight:500}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:${T.surface}}
        ::-webkit-scrollbar-thumb{background:${T.borderHi};border-radius:0.3rem}
        input,textarea,button{font-family:inherit}
        input,textarea,select{font-size:16px!important}
        textarea{color:${T.text}}
      `}</style>
      <div style={{maxWidth:520,margin:"0 auto",minHeight:"100vh",background:T.bg,
        display:"flex",flexDirection:"column"}}>
        {screen==="onboarding"&&<OnboardingScreen onSelect={handleOnboardSelect}/>}
        {screen==="settings"&&<SettingsScreen measureMode={measureMode}
          setMeasureMode={setMeasureMode} onBack={()=>setScreen("dashboard")}
          company={company} setCompany={setCompany}/>}
        {configScreen==="library"&&<ConfigLibraryScreen
          configs={configs}
          onSelect={c=>{
            const newAxles = c.axles.map(ca=>({
              ...makeAxleForType(ca.type, ca.label),
              tolerances: JSON.parse(JSON.stringify(ca.tolerances||{})),
              dualWheel: ca.dualWheel||false,
              driveSide: ca.driveSide||"RHD",
              suspType:  ca.suspType||"solid",
            }));
            const j = {...makeJob(), axles:newAxles, configId:c.id, configName:c.name};
            setJobs(p=>[j,...p]);
            setActiveId(j.id);
            setScreen("job");
            setOpenTab("before");
            setForceTab("before");
            setConfigScreen(null);
          }}
          onNew={newConfig}
          onEdit={editConfig}
          onBack={()=>{ setConfigScreen(null); setScreen(activeId?"job":"dashboard"); }}/>}
        {configScreen==="editor"&&editingConfig&&<ConfigEditorScreen
          config={editingConfig}
          onSave={saveConfig}
          onDelete={deleteConfig}
          onBack={()=>setConfigScreen("library")}/>}
        {(screen==="dashboard"||screen==="job")&&!configScreen&&(
          <>
            <div style={{flex:1,padding:screen==="dashboard"?"18px 16px":"0"}}>
              {screen==="dashboard"&&<Dashboard jobs={jobs} onNew={newJob} onOpen={openJob} onDelete={deleteJob}/>}
              {screen==="job"&&activeJob&&
                <JobEditor job={activeJob} allJobs={jobs} onSave={saveJob}
                  onBack={()=>setScreen("dashboard")} initialTab={openTab}
                  onOpenConfigs={openConfigLibrary} forceTab={forceTab}
                  company={company}/>}
            </div>
            {/* Footer */}
            <div style={{
              background:"#050505",borderTop:"1px solid rgba(255,255,255,0.08)",
              padding:"16px 20px calc(16px + env(safe-area-inset-bottom))",display:"flex",justifyContent:"space-between",alignItems:"center",
              position:"sticky",bottom:0,zIndex:10,
            }}>
              <button onClick={()=>{ setConfigScreen("library"); }} style={{
                background:"none",border:"none",cursor:"pointer",
                display:"flex",alignItems:"center",gap:6,
                color:"rgba(255,255,255,0.5)",fontFamily:FB,fontSize:12,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                  <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                </svg>
                Configurations
              </button>
              <button onClick={()=>setScreen("settings")} style={{
                background:"none",border:"none",cursor:"pointer",
                display:"flex",alignItems:"center",gap:6,
                color:"rgba(255,255,255,0.5)",fontFamily:FB,fontSize:12,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                </svg>
                Settings
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
