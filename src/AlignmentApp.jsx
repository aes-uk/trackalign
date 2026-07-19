import { useState, useEffect, useLayoutEffect, useRef, useCallback, Fragment } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { supabase } from "./supabase";

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
const LS_ADJ_CALC_KEY = "trackalign_adjcalc_v1";
const LS_CONFIGS_KEY = "trackalign_configs_v1";
const LS_COMPANY_KEY = "trackalign_company_v1";

function lsKey(base, uid) { return uid ? `${base}_${uid}` : base; }

function loadCompany(uid) {
  try {
    const r=localStorage.getItem(lsKey(LS_COMPANY_KEY, uid));
    const def={name:"",address:"",address2:"",phone:"",email:"",website:"",logo:"",updatedAt:null,syncStatus:"local"};
    return r?{...def,...JSON.parse(r)}:def;
  } catch(e){ return {name:"",address:"",address2:"",phone:"",email:"",website:"",logo:"",updatedAt:null,syncStatus:"local"}; }
}
function saveCompany(c, uid) {
  try { localStorage.setItem(lsKey(LS_COMPANY_KEY, uid), JSON.stringify(c)); } catch(e){}
}

/* ── Supabase sync helpers ───────────────────────────────────── */
function sortNewestFirst(list) {
  return [...list].sort((a,b) => new Date(b.createdAt||0) - new Date(a.createdAt||0));
}

function mergeByUpdatedAt(localList, remoteList) {
  const map = new Map(localList.map(item => [item.id, item]));
  for (const remote of remoteList) {
    const local = map.get(remote.id);
    if (!local || !local.updatedAt || new Date(remote.updatedAt) > new Date(local.updatedAt)) {
      map.set(remote.id, { ...remote, syncStatus: "synced" });
    } else {
      // Local is newer on content, but always take createdAt from remote (canonical source)
      map.set(remote.id, { ...local, createdAt: remote.createdAt || local.createdAt });
    }
  }
  return sortNewestFirst(Array.from(map.values()));
}

function jobToRow(job, userId) {
  return {
    id: job.id, user_id: userId,
    customer: job.customer, vehicle: job.vehicle, axles: job.axles,
    after_axles: job.afterAxles, full_distance: job.fullDistance, notes: job.notes,
    config_id: job.configId, config_name: job.configName, measure_method: job.measureMethod,
    created_at: job.createdAt || new Date().toISOString(),
    updated_at: job.updatedAt || job.createdAt || new Date().toISOString(),
  };
}
function jobFromRow(row) {
  return {
    id: row.id, createdAt: row.created_at || row.updated_at, updatedAt: row.updated_at,
    syncStatus: "synced",
    customer: row.customer || {company:"",name:"",phone:"",email:""},
    vehicle: row.vehicle || {reg:"",make:"",model:"",year:"",mileage:""},
    axles: row.axles || [], afterAxles: row.after_axles || null,
    fullDistance: row.full_distance || "", notes: row.notes || "",
    configId: row.config_id || null, configName: row.config_name || null,
    measureMethod: row.measure_method || "direct",
  };
}
async function upsertJobRemote(job, userId) {
  if (!userId || !navigator.onLine) return false;
  const row = jobToRow(job, userId);
  try {
    const { error } = await supabase.from("jobs").upsert(row, { onConflict: "id" });
    if (error) throw error;
    return true;
  } catch(e) { console.error("Job sync failed:", e?.message, e); return false; }
}

function configToRow(config, userId) {
  return {
    id: config.id, user_id: userId, name: config.name, axles: config.axles,
    updated_at: config.updatedAt || config.createdAt || new Date().toISOString(),
  };
}
function configFromRow(row) {
  return {
    id: row.id, name: row.name, axles: row.axles || [],
    createdAt: row.created_at || row.updated_at, updatedAt: row.updated_at, syncStatus: "synced",
  };
}
async function upsertConfigRemote(config, userId) {
  if (!userId || !navigator.onLine) return false;
  const row = configToRow(config, userId);
  try {
    const { error } = await supabase.from("configs").upsert(row, { onConflict: "id" });
    if (error) throw error;
    return true;
  } catch(e) { console.error("Config sync failed:", e?.message, e); return false; }
}
async function deleteConfigRemote(id, userId) {
  if (!userId || !navigator.onLine) return;
  try { await supabase.from("configs").delete().eq("id", id).eq("user_id", userId); }
  catch(e) { console.error("Config delete sync failed", e); }
}

function companyToRow(company, userId) {
  return {
    user_id: userId, name: company.name, address: company.address, address2: company.address2,
    phone: company.phone, email: company.email, website: company.website, logo: company.logo,
    updated_at: company.updatedAt || new Date().toISOString(),
  };
}
function companyFromRow(row) {
  return {
    name: row.name||"", address: row.address||"", address2: row.address2||"",
    phone: row.phone||"", email: row.email||"", website: row.website||"", logo: row.logo||"",
    updatedAt: row.updated_at, syncStatus: "synced",
  };
}
async function uploadLogoToStorage(file, userId) {
  const ext = file.name.split(".").pop() || "png";
  const ts = Date.now();
  const path = `${userId}/logo-${ts}.${ext}`;
  const { error } = await supabase.storage.from("logos").upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from("logos").getPublicUrl(path);
  return data.publicUrl;
}

async function upsertCompanyRemote(company, userId) {
  if (!userId || !navigator.onLine) return false;
  const row = companyToRow(company, userId);
  try {
    const { data, error: updateError } = await supabase
      .from("company_settings").update(row).eq("user_id", userId).select("user_id");
    if (updateError) throw updateError;
    if (!data || data.length===0) {
      const { error: insertError } = await supabase.from("company_settings").insert(row);
      if (insertError) throw insertError;
    }
    return true;
  } catch(e) {
    console.error("Company sync failed:", {
      message: e?.message, code: e?.code, details: e?.details, hint: e?.hint, raw: e,
    });
    return false;
  }
}

async function upsertPrefsRemote(prefs, userId) {
  if (!userId || !navigator.onLine) return false;
  const row = { user_id: userId, measure_mode: prefs.measureMode, show_adj_calc: prefs.showAdjCalc };
  try {
    const { data, error: updateError } = await supabase
      .from("company_settings").update(row).eq("user_id", userId).select("user_id");
    if (updateError) throw updateError;
    if (!data || data.length===0) {
      const { error: insertError } = await supabase.from("company_settings").insert({ ...row, updated_at: new Date().toISOString() });
      if (insertError) throw insertError;
    }
    return true;
  } catch(e) {
    console.error("Prefs sync failed:", e?.message, e);
    return false;
  }
}

const DEFAULT_LOGO = "/default-logo.png";


function loadConfigs(uid) {
  try {
    const r=localStorage.getItem(lsKey(LS_CONFIGS_KEY, uid));
    const list = r?JSON.parse(r):[];
    return list.map(c=>({ ...c, updatedAt: c.updatedAt||c.createdAt, syncStatus: c.syncStatus||"local" }));
  } catch(e){ return []; }
}
function saveConfigs(configs, uid) {
  try { localStorage.setItem(lsKey(LS_CONFIGS_KEY, uid), JSON.stringify(configs)); } catch(e){}
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
  const sign = (num<0 || Object.is(num,-0)) ? -1 : 1;
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
    id:uid(), name, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), syncStatus:"local",
    axles:[makeConfigAxle("steering","Front Steer"), makeConfigAxle("fixed","Non Steer")],
  };
}

function loadMode(uid) {
  try { return localStorage.getItem(lsKey(LS_MODE_KEY, uid)) || "direct"; } catch(e) { return "direct"; }
}
function saveMode(mode, uid) {
  try { localStorage.setItem(lsKey(LS_MODE_KEY, uid), mode); } catch(e) {}
}
function loadAdjCalc(uid) {
  try { return localStorage.getItem(lsKey(LS_ADJ_CALC_KEY, uid)) === "yes"; } catch(e) { return false; }
}
function saveAdjCalc(val, uid) {
  try { localStorage.setItem(lsKey(LS_ADJ_CALC_KEY, uid), val ? "yes" : "no"); } catch(e) {}
}

function loadJobs(uid) {
  try {
    const raw = localStorage.getItem(lsKey(LS_KEY, uid));
    if (raw) {
      const jobs = JSON.parse(raw);
      // Normalise — guard against old data missing fields
      return sortNewestFirst(jobs.map(j => ({
        ...j,
        axles: Array.isArray(j.axles) ? j.axles : [makeSteeringAxle("Front"), makeFixedAxle("Rear")],
        afterAxles: j.afterAxles ? (Array.isArray(j.afterAxles) ? j.afterAxles : null) : null,
        measureMethod: j.measureMethod || "direct",
        updatedAt: j.updatedAt || j.createdAt,
        syncStatus: j.syncStatus || "local",
      })));
    }
  } catch(e) {}
  return null;
}

function saveJobs(jobs, uid) {
  try { localStorage.setItem(lsKey(LS_KEY, uid), JSON.stringify(jobs)); } catch(e) {}
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
      tootLeft:"",    tootRight:"",   tootLeft2:"", tootRight2:"",
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
    maxTurnLeft:"", maxTurnRight:"", tootLeft:"", tootRight:"", tootLeft2:"", tootRight2:"",
    axleDistance:"",
    frontScaleLeft:"", rearScaleLeft:"", frontScaleRight:"", rearScaleRight:"",
    targetToeLeft:"", targetToeRight:"",
    tolerances: emptyAxleTolerance("steering") };
}
function makeRearSteerAxle(label="Rear Steer") {
  return { id:uid(), label, type:"rear-steer",
    toeLeft:"", toeRight:"", camberLeft:"", camberRight:"",
    casterLeft:"", casterRight:"", kpiLeft:"", kpiRight:"",
    maxTurnLeft:"", maxTurnRight:"", tootLeft:"", tootRight:"", tootLeft2:"", tootRight2:"",
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
    targetToeLeft:"", targetToeRight:"", targetOOS:"",
    tolerances: emptyAxleTolerance("fixed") };
}
function makeJob(measureMethod="direct") {
  return { id:uid(), createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), syncStatus:"local",
    customer:{ company:"", name:"", phone:"", email:"" },
    vehicle:{ reg:"", make:"", model:"", year:"", mileage:"" },
    axles:[makeSteeringAxle("Front Steer"), makeFixedAxle("Non Steer")],
    afterAxles:null, fullDistance:"",
    configId:null, configName:null,
    measureMethod,
    notes:"" };
}


/* ── Demo data ───────────────────────────────────────────────── */

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
  const toeRot = v => {
    const ab = Math.min(Math.abs(v), 15); // cap at 15mm
    if (ab<=1) return 0;
    const deg = (ab-1)*2; // up to 28° at 15mm
    return v<0 ? -deg : deg;
  };
  const rotL =  toeRot(toeLeft);  // positive toe = lean in (right)
  const rotR = -toeRot(toeRight); // positive toe = lean in (left)

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
          onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); const v=e.target.value; onChange(v===""?"":parseFloat(v).toFixed(1)); } if(e.key==="Tab"){ const v=e.target.value; onChange(v===""?"":parseFloat(v).toFixed(1)); } }}
          placeholder="0.0"
          className="no-spin"
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
  const filled = hasVal(value);
  const borderCol = (tl!=="none" && filled) ? TL_BORDER[tl] : "rgba(5,5,5,0.15)";
  const textCol   = (tl!=="none" && filled) ? TL_COLOR[tl] : "#050505";
  const dm = decToDM(value);
  const [sign, setSign] = useState(dm.sign);
  const [dStr, setDStr] = useState(dm.deg===""?"":String(dm.deg));
  const [mStr, setMStr] = useState(dm.min===""?"":String(dm.min).padStart(2,"0"));
  // edited tracks whether the user has intentionally interacted with this field.
  // Starts true if a value is already stored, so existing data is never silently cleared.
  // Prevents iOS from committing a value when it auto-blurs an untouched field on section open/close.
  const edited = useRef(filled);
  const mRef = useRef(null);
  useEffect(()=>{
    const d = decToDM(value);
    setSign(d.sign);
    setDStr(d.deg===""?"":String(d.deg));
    setMStr(d.min===""?"":String(d.min).padStart(2,"0"));
    edited.current = hasVal(value);
  }, [value]);
  const commit = (newSign, newD, newM) => {
    if (!edited.current) return; // iOS spurious blur on untouched field — ignore
    const dec = dmToDec(newSign, newD, newM);
    if (dec==="") { onChange(""); return; }
    const s = Math.abs(dec).toFixed(4);
    onChange(newSign<0 ? `-${s}` : s);
  };
  const toggleSign = () => {
    edited.current = true;
    const ns = sign<0?1:-1; setSign(ns); commit(ns, dStr, mStr);
  };
  const dFilled = dStr !== "";
  const mFilled = mStr !== "";
  const degStyle = {
    width:40,boxSizing:"border-box",background:"#f7f7f7",
    border:`1.5px solid ${borderCol}`,borderRadius:"0.3rem",outline:"none",
    padding:"6px 4px",color:dFilled?textCol:"rgba(5,5,5,0.35)",
    fontFamily:FM,fontSize:13,fontWeight:"600",textAlign:"center",
  };
  const minStyle = {
    ...degStyle,
    color:mFilled?textCol:"rgba(5,5,5,0.35)",
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
        <input type="text" inputMode="numeric" enterKeyHint="done" pattern="[0-9]*"
          value={dStr} placeholder="0"
          onChange={e=>{ edited.current=true; const v=e.target.value; if(/^[0-9]*$/.test(v)) setDStr(v); }}
          onBlur={e=>{ const dVal=e.target.value; setTimeout(()=>{ if(document.activeElement!==mRef.current) commit(sign, dVal, mStr); }, 0); }}
          onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); commit(sign, e.target.value, mStr); } }}
          className="no-spin" style={degStyle}/>
        <span style={{fontSize:11,color:"rgba(5,5,5,0.45)",fontFamily:FM}}>°</span>
        <input ref={mRef} type="text" inputMode="numeric" enterKeyHint="done" pattern="[0-9]*"
          value={mStr} placeholder="00"
          onChange={e=>{ edited.current=true; const v=e.target.value; if(/^[0-9]*$/.test(v)) setMStr(v); }}
          onBlur={e=>{
            const m = e.target.value==="" && dStr!=="" ? "0" : e.target.value;
            if(e.target.value==="" && dStr!=="") setMStr("00");
            commit(sign, dStr, m);
          }}
          onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); commit(sign, dStr, e.target.value); } if(e.key==="Tab") commit(sign, dStr, e.target.value); }}
          className="no-spin" style={minStyle}/>
        <span style={{fontSize:11,color:"rgba(5,5,5,0.45)",fontFamily:FM}}>'</span>
      </div>
    </div>
  );
}

function DecDegInput({ label, value, onChange, tol=null, disabled=false }) {
  const tl = tol ? trafficLight(value, tol) : "none";
  const borderCol = (tl!=="none" && hasVal(value)) ? TL_BORDER[tl] : "rgba(5,5,5,0.15)";
  const textCol   = (tl!=="none" && hasVal(value)) ? TL_COLOR[tl] : "#050505";
  const [str, setStr] = useState(value===undefined||value===null||value===""?"":String(Math.round(parseFloat(value))));
  useEffect(()=>{
    setStr(value===undefined||value===null||value===""?"":String(Math.round(parseFloat(value))));
  }, [value]);
  const commit = v => onChange(v===""?"":String(Math.round(parseFloat(v))));
  return (
    <div style={{display:"flex",flexDirection:"column",gap:3,alignItems:"center"}}>
      <label style={{fontSize:9,letterSpacing:"0.06em",color:"#050505",fontFamily:FB,
        textTransform:"uppercase",textAlign:"center",whiteSpace:"nowrap"}}>{label}</label>
      <div style={{position:"relative",width:72}}>
        <input
          type="text" inputMode="numeric" pattern="[0-9]*" enterKeyHint="done"
          value={str} placeholder="0" disabled={disabled} readOnly={disabled}
          onChange={e=>{ const v=e.target.value; if(/^[0-9]*$/.test(v)){ setStr(v); onChange(v===""?"":v); } }}
          onBlur={e=>commit(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); commit(e.target.value); } if(e.key==="Tab") commit(e.target.value); }}
          className="no-spin"
          style={{width:"100%",boxSizing:"border-box",background:disabled?"#ececec":"#f7f7f7",
            border:`1.5px solid ${borderCol}`,borderRadius:"0.3rem",outline:"none",
            padding:"6px 8px",color:disabled?"rgba(5,5,5,0.55)":(hasVal(value)?textCol:"rgba(5,5,5,0.35)"),
            fontFamily:FM,fontSize:13,fontWeight:"600",textAlign:"center",
            cursor:disabled?"not-allowed":"text"}}/>
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
const INT_DEG_TOL_KEYS = ["maxTurnLeft","maxTurnRight","turnDiff"];

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
    if (dec==="") { upd(f, ""); return; }
    const s = Math.abs(dec).toFixed(4);
    upd(f, newSign<0 ? `-${s}` : s);
  };
  const toggleSign = () => { const ns = sign<0?1:-1; setSign(ns); commit(ns, dStr, mStr); };
  const fStyle = {width:56,flexShrink:0,boxSizing:"border-box",background:"#e5e5e5",
    border:"1px solid rgba(5,5,5,0.12)",borderRadius:"0.3rem",outline:"none",
    padding:"5px 6px",color:"#050505",fontFamily:FM,fontSize:12,textAlign:"center"};
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
        onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); commit(sign, e.target.value, mStr); } if(e.key==="Tab") commit(sign, e.target.value, mStr); }}
        className="no-spin" style={fStyle}/>
      <span style={{fontSize:10,color:"rgba(5,5,5,0.45)",flexShrink:0}}>°</span>
      <input type="text" inputMode="numeric" pattern="[0-9]*" placeholder="00"
        value={mStr}
        onChange={e=>{ const v=e.target.value; if(/^[0-9]*$/.test(v)) setMStr(v); }}
        onBlur={e=>commit(sign, dStr, e.target.value)}
        onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); commit(sign, dStr, e.target.value); } if(e.key==="Tab") commit(sign, dStr, e.target.value); }}
        className="no-spin" style={fStyle}/>
      <span style={{fontSize:10,color:"rgba(5,5,5,0.45)",flexShrink:0}}>'</span>
    </div>
  );
}

function NumTolInput({ tol, f, upd }) {
  const value = tol[f]===undefined||tol[f]===null||tol[f]===""?"":tol[f];
  const commit = v => upd(f, v===""?"":parseFloat(v).toFixed(1));
  return (
    <input
      type="number"
      step="0.1"
      enterKeyHint="done"
      key={value}
      defaultValue={value}
      onBlur={e=>commit(e.target.value)}
      onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); commit(e.target.value); } if(e.key==="Tab") commit(e.target.value); }}
      placeholder="—"
      className="no-spin"
      style={{width:"100%",boxSizing:"border-box",background:"#e5e5e5",
        border:"1px solid rgba(5,5,5,0.12)",borderRadius:"0.3rem",outline:"none",
        padding:"5px 6px",color:"#050505",fontFamily:FM,fontSize:12,textAlign:"center"}}/>
  );
}

function IntDegTolInput({ tol, f, upd }) {
  const init = tol[f]===undefined||tol[f]===null||tol[f]===""?"":String(Math.round(parseFloat(tol[f])));
  const [str, setStr] = useState(init);
  useEffect(()=>{
    setStr(tol[f]===undefined||tol[f]===null||tol[f]===""?"":String(Math.round(parseFloat(tol[f]))));
  }, [tol[f]]);
  const commit = v => upd(f, v===""?"":String(Math.round(parseFloat(v))));
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      enterKeyHint="done"
      value={str}
      onChange={e=>{ const v=e.target.value; if(/^[0-9]*$/.test(v)) setStr(v); }}
      onBlur={e=>commit(e.target.value)}
      onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); commit(e.target.value); } if(e.key==="Tab") commit(e.target.value); }}
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
  const isIntDeg = INT_DEG_TOL_KEYS.includes(tolKey);
  if (isAngle) {
    return (
      <div style={{display:"flex",flexDirection:"column",gap:8,
        padding:"10px 0 8px",borderBottom:"1px solid rgba(5,5,5,0.06)"}}>
        <span style={{fontFamily:FB,fontSize:11,color:"#050505"}}>{label}</span>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {["min","max"].map(f=>(
            <div key={f} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,minWidth:0}}>
              <label style={{fontSize:8,color:"rgba(5,5,5,0.4)",fontFamily:FB,
                textTransform:"uppercase",flexShrink:0}}>{f}</label>
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
          {isIntDeg ? <IntDegTolInput tol={tol} f={f} upd={upd}/> : <NumTolInput tol={tol} f={f} upd={upd}/>}
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
  const isGeoKey = k => ANGLE_TOL_KEYS.includes(k) || INT_DEG_TOL_KEYS.includes(k);
  const nonGeoFields = fields.filter(([,k])=>!isGeoKey(k));
  const geoFields = fields.filter(([,k])=>isGeoKey(k));
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
            <div style={{marginTop:8,border:"1px solid rgba(5,5,5,0.10)",borderRadius:"0.3rem"}}>
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
    <div style={{display:"flex",flexDirection:"column",minHeight:"100dvh"}}>
      <div style={{position:"fixed",top:0,left:0,right:0,zIndex:100,background:"#050505",
        borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
        <div style={{maxWidth:520,margin:"0 auto",
          paddingTop:"calc(env(safe-area-inset-top) + 10px)",paddingBottom:"10px",paddingLeft:"16px",paddingRight:"16px",
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
      </div>
      <div style={{padding:"18px 16px",paddingTop:"calc(60px + env(safe-area-inset-top))",display:"flex",flexDirection:"column",gap:16,background:"#f7f7f7",minHeight:"100dvh",borderRadius:"0.3rem"}}>
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
            canRemove={true} onRemove={()=>removeAxle(axle.id)}
            isFirstSteer={isFirstSteer}/>);
        })}
        {c.axles.length===0&&(
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,
            padding:"24px 16px",border:"1.5px dashed rgba(5,5,5,0.18)",borderRadius:"0.3rem",
            background:"rgba(5,5,5,0.02)",textAlign:"center"}}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(5,5,5,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div style={{fontFamily:FB,fontSize:12,color:"rgba(5,5,5,0.45)",lineHeight:1.5}}>
              No axles added yet.<br/>Use the buttons below to build the vehicle configuration.
            </div>
          </div>
        )}
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
  useEffect(()=>{ window.scrollTo(0,0); }, []);
  const filtered=configs.filter(c=>c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{display:"flex",flexDirection:"column",minHeight:"100dvh"}}>
      <div style={{position:"fixed",top:0,left:0,right:0,zIndex:100,background:"#050505",
        borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
        <div style={{maxWidth:520,margin:"0 auto",
          paddingTop:"calc(env(safe-area-inset-top) + 10px)",paddingBottom:"10px",paddingLeft:"16px",paddingRight:"16px",
          display:"flex",alignItems:"center",gap:12}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:"#eb0000",
          cursor:"pointer",fontSize:22,padding:"0 4px",lineHeight:1}}>←</button>
        <span style={{flex:1,fontFamily:FD,fontSize:15,color:"#fff",fontWeight:"600",letterSpacing:"0.04em"}}>
          Configurations
        </span>
        <Btn small onClick={onNew}>+ New</Btn>
        </div>
      </div>
      <div style={{padding:"16px",paddingTop:"calc(60px + env(safe-area-inset-top))",display:"flex",flexDirection:"column",gap:12,background:"#f7f7f7",minHeight:"100dvh",borderRadius:"0.3rem"}}>
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

function Toggle({ label, options, value, onChange, disabled=false }) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:4}}>
      {label&&<label style={{fontSize:9,letterSpacing:"0.06em",color:T.textDim,fontFamily:FB,textTransform:"uppercase"}}>{label}</label>}
      <div style={{display:"flex",borderRadius:"0.3rem",overflow:"hidden",border:"1px solid rgba(5,5,5,0.15)",
        opacity:disabled?0.6:1,cursor:disabled?"not-allowed":"auto"}}
        title={disabled?"Cannot be changed on After tab":undefined}>
        {options.map(o=>(
          <button key={o.value} onClick={()=>!disabled&&onChange(o.value)} style={{
            flex:1,padding:"6px 8px",border:"none",cursor:disabled?"not-allowed":"pointer",
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

function CollapseSection({ label, open, onToggle, children, badge="", variant="default" }) {
  const styles = {
    default:     { bg:"#efefef",                     bgHover:"#e5e5e5",                    border:`1px solid ${T.border}`,              icon:null },
    geometry:    { bg:"#efefef",                       bgHover:"#e5e5e5",                     border:"1px solid rgba(5,5,5,0.15)",         icon:"📐" },
    calculator:  { bg:"rgba(22,163,74,0.07)",         bgHover:"rgba(22,163,74,0.13)",        border:"1px solid rgba(22,163,74,0.28)",      icon:"🔧" },
  };
  const s = styles[variant] || styles.default;
  return (
    <div style={{border:s.border, borderRadius:"0.3rem", overflow:"hidden"}}>
      <button onClick={onToggle} style={{width:"100%",background:s.bg,border:"none",
        cursor:"pointer",padding:"9px 12px",display:"flex",alignItems:"center",gap:8,transition:"background 0.15s"}}
        onMouseEnter={e=>e.currentTarget.style.background=s.bgHover}
        onMouseLeave={e=>e.currentTarget.style.background=s.bg}>
        {s.icon
          ? <span style={{fontSize:13,lineHeight:1,flexShrink:0}}>{s.icon}</span>
          : <div style={{width:3,height:12,background:open?"#050505":"rgba(5,5,5,0.15)",borderRadius:"0.3rem",flexShrink:0,transition:"background 0.2s"}}/>
        }
        <span style={{fontFamily:FD,fontSize:11,letterSpacing:"0.14em",
          color:"#050505",fontWeight:"700",
          textTransform:"uppercase",flex:1,textAlign:"left"}}>{label}</span>
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
function DistancePicker({ value, onChange, bare=false }) {
  const [local, setLocal] = useState(value===undefined||value===null||value===""?"":String(value));
  useEffect(()=>{ setLocal(value===undefined||value===null||value===""?"":String(value)); }, [value]);
  const commit = v => { onChange(v===""?"":parseFloat(v).toFixed(1)); };
  return (
    <input
      type="number"
      step="0.1"
      min="0"
      value={local}
      onChange={e=>setLocal(e.target.value)}
      onBlur={e=>commit(e.target.value)}
      onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); commit(e.target.value); } if(e.key==="Tab") commit(e.target.value); }}
      placeholder="0.0"
      style={bare
        ? {width:90,background:"transparent",border:"none",outline:"none",
            padding:"7px 6px",color:local?"#050505":"rgba(5,5,5,0.35)",
            fontFamily:FM,fontSize:16,fontWeight:"600",textAlign:"center",boxSizing:"border-box"}
        : {width:90,boxSizing:"border-box",background:"#e5e5e5",
            border:"1.5px solid rgba(5,5,5,0.15)",borderRadius:"0.3rem",outline:"none",
            padding:"7px 6px",color:local?"#050505":"rgba(5,5,5,0.35)",
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
        enterKeyHint="done"
        pattern="-?[0-9]*"
        className="no-spin"
        value={local}
        onInput={e=>setLocal(e.target.value.replace(/[^0-9-]/g,""))}
        onBlur={e=>commit(e.target.value)}
        onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); commit(e.target.value); } if(e.key==="Tab") commit(e.target.value); }}
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
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) auto minmax(0,1fr)",gap:4,alignItems:"center",overflow:"hidden"}}>
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
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
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
        <StatBox label="Rolling Direction" value={calc.outOfSquare===0?"STRAIGHT":calc.oosLeft?"◀ LEFT":"RIGHT ▶"} color="#050505"/>
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
/* shared helpers for both adjust sections */
function _adjInputStyle() {
  return {display:"flex",alignItems:"center",background:"#e5e5e5",
    border:"1.5px solid rgba(5,5,5,0.15)",borderRadius:"0.3rem",overflow:"hidden"};
}
function _adjInputInner(disabled=false) {
  return {flex:1,minWidth:0,background:"transparent",border:"none",outline:"none",
    padding:"8px 10px",color:disabled?"rgba(5,5,5,0.3)":"#050505",
    fontFamily:"'DM Mono',monospace,sans-serif",fontSize:14,fontWeight:"600",textAlign:"center"};
}
function _adjUnit(label) {
  return (
    <span style={{padding:"0 8px",fontFamily:"'DM Mono',monospace,sans-serif",fontSize:11,
      color:"rgba(5,5,5,0.45)",borderLeft:"1px solid rgba(5,5,5,0.12)",
      flexShrink:0,background:"#e5e5e5"}}>{label}</span>
  );
}
function WheelBox({ header, subHeader, current, target }) {
  const hasResult = target !== null && target !== undefined;
  const hasCurrent = current !== null && current !== undefined;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:6,minWidth:0}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
        <span style={{fontFamily:FD,fontSize:11,letterSpacing:"0.08em",color:"#050505",
          textTransform:"uppercase",fontWeight:"600",flex:1,textAlign:"center"}}>{header}</span>
        <div style={{height:1,background:"rgba(5,5,5,0.10)",display:"none"}}/>
      </div>
      {subHeader&&(
        <div style={{fontFamily:FB,fontSize:9,color:"rgba(5,5,5,0.4)",
          textTransform:"uppercase",letterSpacing:"0.06em",marginTop:-6,marginBottom:2,
          textAlign:"center"}}>
          {subHeader}
        </div>
      )}
      <div style={{display:"flex",alignItems:"center",gap:5}}>
        {/* CURRENT */}
        <div style={{flex:1,background:"rgba(235,0,0,0.09)",border:"1px solid rgba(235,0,0,0.22)",
          borderRadius:"0.3rem",padding:"5px 4px",textAlign:"center",minWidth:0}}>
          <div style={{fontFamily:FB,fontSize:7,color:"#eb0000",
            textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:1}}>Current</div>
          <div style={{fontFamily:FM,fontSize:17,color:"#eb0000",fontWeight:"700",lineHeight:1}}>
            {hasCurrent ? Math.round(current) : "—"}
          </div>
        </div>
        <span style={{color:"rgba(5,5,5,0.35)",fontSize:13,flexShrink:0}}>→</span>
        {/* TARGET */}
        <div style={{flex:1,background:hasResult?"rgba(22,163,74,0.09)":"rgba(5,5,5,0.03)",
          border:`1px solid ${hasResult?"rgba(22,163,74,0.28)":"rgba(5,5,5,0.09)"}`,
          borderRadius:"0.3rem",padding:"5px 4px",textAlign:"center",minWidth:0}}>
          <div style={{fontFamily:FB,fontSize:7,color:hasResult?"#16a34a":"rgba(5,5,5,0.3)",
            textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:1}}>Target</div>
          <div style={{fontFamily:FM,fontSize:17,color:hasResult?"#16a34a":"rgba(5,5,5,0.2)",
            fontWeight:"700",lineHeight:1}}>
            {hasResult ? Math.round(target) : "—"}
          </div>
        </div>
      </div>
    </div>
  );
}

function JosamAdjustSection({ afterAxle, beforeAxle, fullDistance, onChange, steerIndex=0, axle=null }) {
  const D = parseFloat(fullDistance) || 0;

  const distFront = afterAxle?.distanceFrontScale ?? "";
  const setDistFront = v => onChange({...afterAxle, distanceFrontScale:v});
  const targetTotalToe = afterAxle?.targetTotalToe ?? "";
  const setTargetTotalToe = v => onChange({...afterAxle, targetTotalToe:v});

  const df = parseFloat(distFront) || 0;
  const dr = D > 0 ? D - df : 0;
  const distFrontValid = df > 0 && D > 0 && df < D;
  const farScaleSide = df > dr ? "front" : "rear";
  const adjDist = Math.max(df, dr);
  const farScaleLabel = farScaleSide === "front" ? "FRONT SCALE" : "REAR SCALE";

  const isIndependent = (afterAxle?.suspType || "solid") === "independent";
  const isRearSteer = afterAxle?.type === "rear-steer";
  const isSecondSteer = steerIndex >= 1;
  const driveSide = afterAxle?.driveSide || "RHD";
  const isDriveRight = driveSide === "RHD";

  function getFarScale(side) {
    if (!beforeAxle) return null;
    const key = farScaleSide === "front"
      ? (side==="left" ? beforeAxle.frontScaleLeft : beforeAxle.frontScaleRight)
      : (side==="left" ? beforeAxle.rearScaleLeft  : beforeAxle.rearScaleRight);
    const v = parseFloat(key);
    return isNaN(v) ? null : v;
  }

  function getBeforeToe(side) {
    if (!beforeAxle) return null;
    const fl = parseFloat(side==="left" ? beforeAxle.frontScaleLeft : beforeAxle.frontScaleRight);
    const rl = parseFloat(side==="left" ? beforeAxle.rearScaleLeft  : beforeAxle.rearScaleRight);
    if (!isNaN(fl) && !isNaN(rl) && D>0) return (fl - rl) / D;
    const direct = parseFloat(side==="left" ? beforeAxle.toeLeft : beforeAxle.toeRight);
    return isNaN(direct) ? null : direct;
  }

  const toeL = getBeforeToe("left");
  const toeR = getBeforeToe("right");
  const farL = getFarScale("left");
  const farR = getFarScale("right");
  const totalBeforeToe = toeL!==null && toeR!==null ? toeL+toeR : null;

  const tgt = parseFloat(targetTotalToe);
  const hasTarget = hasVal(targetTotalToe) && !isNaN(tgt);
  const canCalc = distFrontValid && hasTarget && totalBeforeToe!==null;

  // Drive/opposite assignment
  const driveToe = isDriveRight ? toeR : toeL;
  const oppToe   = isDriveRight ? toeL : toeR;
  const driveFar = isDriveRight ? farR  : farL;
  const oppFar   = isDriveRight ? farL  : farR;
  const driveSideStr = isDriveRight ? "RIGHT" : "LEFT";
  const oppSideStr   = isDriveRight ? "LEFT"  : "RIGHT";

  // Headers
  let driveHeader, oppHeader;
  if (isRearSteer) {
    driveHeader = `Adjust Ram — ${driveSideStr} WHEEL`;
    oppHeader   = `Adjust to Target — ${oppSideStr} WHEEL`;
  } else if (isSecondSteer) {
    driveHeader = `Adjust Drag Link — ${driveSideStr} WHEEL`;
    oppHeader   = `Adjust to Target — ${oppSideStr} WHEEL`;
  } else {
    driveHeader = `Set Straight Ahead — ${driveSideStr} WHEEL`;
    oppHeader   = `Adjust to Target — ${oppSideStr} WHEEL`;
  }

  // Solid calculations
  let driveNow=driveFar, driveTarget=null, oppNow=null, oppTarget=null;
  if (canCalc && !isIndependent && driveFar!==null && oppFar!==null && driveToe!==null && oppToe!==null) {
    driveTarget = driveFar + (driveToe * adjDist);
    // When drive side is zeroed the solid axle rotates, moving opp far scale by same drive adjustment
    oppNow = oppFar - (driveToe * adjDist);
    const toeToMove = totalBeforeToe - tgt;
    oppTarget = oppNow + (toeToMove * adjDist);
  }

  // Independent calculations
  let leftTarget=null, rightTarget=null;
  if (canCalc && isIndependent && farL!==null && farR!==null && toeL!==null && toeR!==null) {
    const tpw = tgt / 2;
    leftTarget  = farL + ((toeL - tpw) * adjDist);
    rightTarget = farR + ((toeR - tpw) * adjDist);
  }

  // Build LEFT/RIGHT display boxes (always Left col = left wheel, Right col = right wheel)
  let boxes;
  if (isIndependent) {
    boxes = [
      { header:"Left Wheel",  now:farL, target:leftTarget  },
      { header:"Right Wheel", now:farR, target:rightTarget },
    ];
  } else if (isDriveRight) {
    boxes = [
      { header:"Left Wheel",  now:oppNow,  target:oppTarget   },
      { header:"Right Wheel", now:driveNow, target:driveTarget },
    ];
  } else {
    boxes = [
      { header:"Left Wheel",  now:driveNow, target:driveTarget },
      { header:"Right Wheel", now:oppNow,   target:oppTarget   },
    ];
  }

  const hasResults = isIndependent
    ? (leftTarget!==null || rightTarget!==null)
    : (driveTarget!==null || oppTarget!==null);

  const fmtToe = v => v!==null ? `${v>=0?"+":""}${v.toFixed(1)} mm` : "—";

  const driveSideLabel = isRearSteer ? "Ram side" : isSecondSteer ? "Drag link" : "Drive side";
  const summaryItems = isIndependent
    ? [
        {label:"Before total", value:fmtToe(totalBeforeToe)},
        {label:"Target total", value:hasTarget?fmtToe(tgt):"—"},
        {label:"Per wheel",    value:hasTarget?fmtToe(tgt/2):"—"},
        {label:"Far scale",    value:distFrontValid?`${farScaleSide.toUpperCase()} (${adjDist.toFixed(1)}m)`:"—"},
      ]
    : [
        {label:"Before total", value:fmtToe(totalBeforeToe)},
        {label:"Target total", value:hasTarget?fmtToe(tgt):"—"},
        {label:driveSideLabel, value:`${driveSideStr} (${driveSide})`},
        {label:"Far scale",    value:distFrontValid?`${farScaleSide.toUpperCase()} (${adjDist.toFixed(1)}m)`:"—"},
      ];

  if (!beforeAxle) return null;

  const diagAxle = axle || afterAxle;
  const farScaleAimLabel = `Aim laser to ${farScaleSide.toUpperCase()} scale`;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:24}}>

      {/* Distance + Target toe — 2 columns */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        {/* Distance input */}
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
          <span style={{fontFamily:FD,fontSize:11,letterSpacing:"0.08em",color:"#050505",
            textTransform:"uppercase",fontWeight:"600",textAlign:"center"}}>Front scale to laser</span>
          <div style={{display:"flex",alignItems:"center",background:"#e5e5e5",
            border:"1.5px solid rgba(5,5,5,0.15)",borderRadius:"0.3rem",overflow:"hidden"}}>
            <DistancePicker bare value={distFront} onChange={setDistFront}/>
            <span style={{padding:"0 8px",fontFamily:FB,fontSize:11,color:"rgba(5,5,5,0.5)",
              borderLeft:"1px solid rgba(5,5,5,0.12)",flexShrink:0}}>m</span>
          </div>
          {D===0&&<div style={{fontFamily:FB,fontSize:10,color:"#eb0000",textAlign:"center"}}>⚠ Set full distance above.</div>}
          {df>0&&D>0&&df>=D&&(
            <div style={{fontFamily:FB,fontSize:10,color:"#eb0000",fontWeight:"600",textAlign:"center"}}>
              ⚠ Cannot exceed {fullDistance}m
            </div>
          )}
        </div>
        {/* Target toe input */}
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
          <span style={{fontFamily:FD,fontSize:11,letterSpacing:"0.08em",color:"#050505",
            textTransform:"uppercase",fontWeight:"600",textAlign:"center"}}>Target Total Toe</span>
          <div style={{display:"flex",alignItems:"center",background:"#e5e5e5",
            border:"1.5px solid rgba(5,5,5,0.15)",borderRadius:"0.3rem",overflow:"hidden"}}>
            <input type="number" step="0.1" className="no-spin"
              key={targetTotalToe}
              defaultValue={targetTotalToe===""?"":targetTotalToe}
              placeholder="0.0"
              onBlur={e=>{const v=e.target.value;setTargetTotalToe(v===""?"":parseFloat(v).toFixed(1));}}
              onKeyDown={e=>{if(e.key==="Enter"||e.key==="Tab"){const v=e.target.value;setTargetTotalToe(v===""?"":parseFloat(v).toFixed(1));}}}
              style={{width:90,background:"transparent",border:"none",outline:"none",
                padding:"7px 6px",color:"#050505",fontFamily:FM,fontSize:16,
                fontWeight:"600",textAlign:"center",boxSizing:"border-box"}}/>
            <span style={{padding:"0 8px",fontFamily:FB,fontSize:11,color:"rgba(5,5,5,0.5)",
              borderLeft:"1px solid rgba(5,5,5,0.12)",flexShrink:0}}>mm</span>
          </div>
        </div>
      </div>

      {/* Wheel boxes */}
      {distFrontValid&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          {boxes.map((b,i)=>(
            <WheelBox key={i} header={b.header} subHeader={farScaleAimLabel}
              current={b.now} target={b.target}/>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Fixed axle OOS-based adjustment (Josam After tab) ──────────── */
function FixedJosamAdjustSection({ afterAxle, beforeAxle, fullDistance, onChange, axle=null }) {
  const D = parseFloat(fullDistance) || 0;

  const distFront = afterAxle?.distanceFrontScale ?? "";
  const setDistFront = v => onChange({...afterAxle, distanceFrontScale:v});
  const targetOOS = afterAxle?.targetOOS ?? "";
  const setTargetOOS = v => onChange({...afterAxle, targetOOS:v});

  const df = parseFloat(distFront) || 0;
  const dr = D > 0 ? D - df : 0;
  const distFrontValid = df > 0 && D > 0 && df < D;
  const farScaleSide = df > dr ? "front" : "rear";
  const adjDist = Math.max(df, dr);
  const farScaleLabel = farScaleSide === "front" ? "FRONT SCALE" : "REAR SCALE";

  function getFarScale(side) {
    if (!beforeAxle) return null;
    const key = farScaleSide === "front"
      ? (side==="left" ? beforeAxle.frontScaleLeft : beforeAxle.frontScaleRight)
      : (side==="left" ? beforeAxle.rearScaleLeft  : beforeAxle.rearScaleRight);
    const v = parseFloat(key);
    return isNaN(v) ? null : v;
  }

  function getBeforeToe(side) {
    if (!beforeAxle) return null;
    const fl = parseFloat(side==="left" ? beforeAxle.frontScaleLeft : beforeAxle.frontScaleRight);
    const rl = parseFloat(side==="left" ? beforeAxle.rearScaleLeft  : beforeAxle.rearScaleRight);
    if (!isNaN(fl) && !isNaN(rl) && D>0) return (fl - rl) / D;
    const direct = parseFloat(side==="left" ? beforeAxle.toeLeft : beforeAxle.toeRight);
    return isNaN(direct) ? null : direct;
  }

  const toeL = getBeforeToe("left");
  const toeR = getBeforeToe("right");
  const farL = getFarScale("left");
  const farR = getFarScale("right");
  const totalBeforeToe = toeL!==null && toeR!==null ? toeL+toeR : null;
  const currentOOS = toeL!==null && toeR!==null ? (toeR - toeL) / 2 : null;

  const tgtOOS = parseFloat(targetOOS);
  const hasTarget = hasVal(targetOOS) && !isNaN(tgtOOS);
  const canCalc = distFrontValid && hasTarget && totalBeforeToe!==null && farL!==null && farR!==null;

  let leftTarget=null, rightTarget=null;
  if (canCalc) {
    const half = totalBeforeToe / 2;
    const newLeftToe  = half - tgtOOS;
    const newRightToe = half + tgtOOS;
    leftTarget  = farL + ((newLeftToe  - toeL) * adjDist);
    rightTarget = farR + ((newRightToe - toeR) * adjDist);
  }

  if (!beforeAxle) return null;

  const farScaleAimLabel = `Aim laser to ${farScaleSide.toUpperCase()} scale`;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:24}}>

      {/* Distance + Target OOS — 2 columns */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        {/* Distance input */}
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
          <span style={{fontFamily:FD,fontSize:11,letterSpacing:"0.08em",color:"#050505",
            textTransform:"uppercase",fontWeight:"600",textAlign:"center"}}>Front scale to laser</span>
          <div style={{display:"flex",alignItems:"center",background:"#e5e5e5",
            border:"1.5px solid rgba(5,5,5,0.15)",borderRadius:"0.3rem",overflow:"hidden"}}>
            <DistancePicker bare value={distFront} onChange={setDistFront}/>
            <span style={{padding:"0 8px",fontFamily:FB,fontSize:11,color:"rgba(5,5,5,0.5)",
              borderLeft:"1px solid rgba(5,5,5,0.12)",flexShrink:0}}>m</span>
          </div>
          {D===0&&<div style={{fontFamily:FB,fontSize:10,color:"#eb0000",textAlign:"center"}}>⚠ Set full distance above.</div>}
          {df>0&&D>0&&df>=D&&(
            <div style={{fontFamily:FB,fontSize:10,color:"#eb0000",fontWeight:"600",textAlign:"center"}}>
              ⚠ Cannot exceed {fullDistance}m
            </div>
          )}
        </div>
        {/* Target OOS input */}
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
          <span style={{fontFamily:FD,fontSize:11,letterSpacing:"0.08em",color:"#050505",
            textTransform:"uppercase",fontWeight:"600",textAlign:"center"}}>Target OOS</span>
          <div style={{display:"flex",alignItems:"center",background:"#e5e5e5",
            border:"1.5px solid rgba(5,5,5,0.15)",borderRadius:"0.3rem",overflow:"hidden"}}>
            <input type="number" step="0.1" className="no-spin"
              key={targetOOS}
              defaultValue={targetOOS===""?"":targetOOS}
              placeholder="0.0"
              onBlur={e=>{const v=e.target.value;setTargetOOS(v===""?"":parseFloat(v).toFixed(1));}}
              onKeyDown={e=>{if(e.key==="Enter"||e.key==="Tab"){const v=e.target.value;setTargetOOS(v===""?"":parseFloat(v).toFixed(1));}}}
              style={{width:90,background:"transparent",border:"none",outline:"none",
                padding:"7px 6px",color:"#050505",fontFamily:FM,fontSize:16,
                fontWeight:"600",textAlign:"center",boxSizing:"border-box"}}/>
            <span style={{padding:"0 8px",fontFamily:FB,fontSize:11,color:"rgba(5,5,5,0.5)",
              borderLeft:"1px solid rgba(5,5,5,0.12)",flexShrink:0}}>mm</span>
          </div>
        </div>
      </div>

      {/* Wheel boxes */}
      {distFrontValid&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <WheelBox header="Left Wheel" subHeader={farScaleAimLabel} current={farL} target={leftTarget}/>
          <WheelBox header="Right Wheel" subHeader={farScaleAimLabel} current={farR} target={rightTarget}/>
        </div>
      )}
    </div>
  );
}

function TootBox({ primaryLabel, primaryValue, onPrimary, secondaryLabel, secondaryValue, onSecondary, primaryFixed=false }) {
  useEffect(()=>{
    if (primaryFixed && primaryValue!=="20") onPrimary("20");
  }, [primaryFixed, primaryValue]);
  const diff = hasVal(primaryValue)&&hasVal(secondaryValue)
    ? toNum(primaryValue)-toNum(secondaryValue) : null;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10,
      border:"1px solid rgba(5,5,5,0.10)",borderRadius:"0.3rem",padding:10}}>
      <DecDegInput label={primaryLabel} value={primaryFixed?"20":primaryValue} onChange={onPrimary} disabled={primaryFixed}/>
      <DecDegInput label={secondaryLabel} value={secondaryValue} onChange={onSecondary}/>
      {diff!==null&&<StatBox label="Diff" value={`${diff>=0?"+":""}${diff.toFixed(1)}`} unit="°"/>}
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
  const tootDiffA=hasVal(axle.tootLeft)&&hasVal(axle.tootRight)
    ?toNum(axle.tootLeft)-toNum(axle.tootRight):null;
  const tootDiffB=hasVal(axle.tootRight2)&&hasVal(axle.tootLeft2)
    ?toNum(axle.tootRight2)-toNum(axle.tootLeft2):null;
  const tootDiff=(tootDiffA!==null&&tootDiffB!==null)?tootDiffA-tootDiffB:null;
  const qCol=(_v,_lo,_hi)=>"#050505";
  return (
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div>
        <SectionHead>Camber</SectionHead>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            <DegMinInput label="Camber L" value={axle.camberLeft}  onChange={v=>up("camberLeft",v)}  tol={(tols||{}).camberLeft}/>
            <DegMinInput label="Camber R" value={axle.camberRight} onChange={v=>up("camberRight",v)} tol={(tols||{}).camberRight}/>
          </div>
          {crossCamber!==null&&(
            <StatBox label="Cross Camber" value={`${crossCamber>=0?"+":""}${fDM(crossCamber)}`} tl={trafficLight(crossCamber,(tols||{}).crossCamber)}/>
          )}
        </div>
      </div>
      <div>
        <SectionHead>Caster</SectionHead>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
            <DegMinInput label="Caster L" value={axle.casterLeft}  onChange={v=>up("casterLeft",v)}  tol={(tols||{}).casterLeft}/>
            <DegMinInput label="Caster R" value={axle.casterRight} onChange={v=>up("casterRight",v)} tol={(tols||{}).casterRight}/>
          </div>
          {crossCaster!==null&&(
            <StatBox label="Cross Caster" value={`${crossCaster>=0?"+":""}${fDM(crossCaster)}`} tl={trafficLight(crossCaster,(tols||{}).crossCaster)}/>
          )}
        </div>
      </div>
      <div>
        <SectionHead>KPI</SectionHead>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          <DegMinInput label="KPI L" value={axle.kpiLeft}  onChange={v=>up("kpiLeft",v)}  tol={(tols||{}).kpiLeft}/>
          <DegMinInput label="KPI R" value={axle.kpiRight} onChange={v=>up("kpiRight",v)} tol={(tols||{}).kpiRight}/>
        </div>
      </div>
      {showTurning&&(
        <div>
          <SectionHead>Max Turn</SectionHead>
          <div style={{display:"flex",flexDirection:"column",gap:16}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              <DecDegInput label="Max Turn L" value={axle.maxTurnLeft}  onChange={v=>up("maxTurnLeft",v)}  tol={(tols||{}).maxTurnLeft}/>
              <DecDegInput label="Max Turn R" value={axle.maxTurnRight} onChange={v=>up("maxTurnRight",v)} tol={(tols||{}).maxTurnRight}/>
            </div>
            <div style={{display:"flex",justifyContent:"center"}}>
              <TurningDiagram left={axle.maxTurnLeft} right={axle.maxTurnRight}/>
            </div>
            {turnDiff!==null&&(
              <StatBox label="Turn Diff" value={`${turnDiff>=0?"+":""}${Math.round(turnDiff)}`} unit="°" tl={trafficLight(turnDiff,(tols||{}).turnDiff)}/>
            )}
          </div>
        </div>
      )}
      {showTurning&&(
        <div>
          <SectionHead>TOOT</SectionHead>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
              <TootBox primaryFixed primaryLabel="Left Wheel" primaryValue={axle.tootLeft} onPrimary={v=>up("tootLeft",v)}
                secondaryLabel="Right Wheel" secondaryValue={axle.tootRight} onSecondary={v=>up("tootRight",v)}/>
              <TootBox primaryFixed primaryLabel="Right Wheel" primaryValue={axle.tootRight2} onPrimary={v=>up("tootRight2",v)}
                secondaryLabel="Left Wheel" secondaryValue={axle.tootLeft2} onSecondary={v=>up("tootLeft2",v)}/>
            </div>
            {tootDiff!==null&&(
              <StatBox label="TOOT Diff" value={`${tootDiff>=0?"+":""}${tootDiff.toFixed(1)}`} unit="°"/>
            )}
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
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,justifyItems:"center"}}>
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
function SteeringAxlePanel({ axle, onChange, showGeo=false, onToggleGeo, showAdj=false, onToggleAdj, isJosam=false, fullDistance="", beforeAxle=null, isAfter=false, steerIndex=0, frontSteerSM=null, showAdjCalc=false }) {
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
    axle.tootRight,axle.tootLeft2].filter(hasVal).length;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Toggle label={steerIndex>=1?"Draglink Side":"Drive Side"} options={[{label:"RHD",value:"RHD"},{label:"LHD",value:"LHD"}]}
          value={axle.driveSide} onChange={v=>up("driveSide",v)} disabled={isAfter}/>
        <Toggle label="Suspension" options={[{label:"Solid",value:"solid"},{label:"Indep.",value:"independent"}]}
          value={axle.suspType} onChange={v=>up("suspType",v)} disabled={isAfter}/>
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
      <CollapseSection label="Geometry" open={showGeo} onToggle={onToggleGeo} variant="geometry"
        badge={geoFilled>0?`${geoFilled} values`:""}>
        <SteeringGeoSection axle={axle} up={up} showTurning={true} tols={axle.tolerances}/>
      </CollapseSection>
      {isJosam&&!isAfter&&showAdjCalc&&(
        <CollapseSection label="Adjustment Calculator" open={showAdj} onToggle={onToggleAdj} variant="calculator">
          <JosamAdjustSection afterAxle={axle} beforeAxle={beforeAxle} fullDistance={fullDistance} onChange={onChange} steerIndex={steerIndex} axle={axle}/>
        </CollapseSection>
      )}
    </div>
  );
}

function RearSteerAxlePanel({ axle, onChange, showGeo=false, onToggleGeo, showAdj=false, onToggleAdj, isJosam=false, fullDistance="", beforeAxle=null, isAfter=false, allAxles=null, showAdjCalc=false }) {
  const up=(f,v)=>onChange({...axle,[f]:v});
  const geoFilled=[axle.camberLeft,axle.camberRight,axle.casterLeft,axle.casterRight,
    axle.kpiLeft,axle.kpiRight,axle.maxTurnLeft,axle.maxTurnRight,
    axle.tootRight,axle.tootLeft2].filter(hasVal).length;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Toggle label="Hyd. Ram Side" options={[{label:"RHD",value:"RHD"},{label:"LHD",value:"LHD"}]}
          value={axle.driveSide||"RHD"} onChange={v=>up("driveSide",v)} disabled={isAfter}/>
        <Toggle label="Suspension" options={[{label:"Solid",value:"solid"},{label:"Indep.",value:"independent"}]}
          value={axle.suspType||"solid"} onChange={v=>up("suspType",v)} disabled={isAfter}/>
      </div>
      {isJosam
        ? <JosamToeRow axle={axle} fullDistance={fullDistance} onChange={onChange} isAfter={isAfter}/>
        : <ToeRow toeLeft={axle.toeLeft} toeRight={axle.toeRight}
            onLeft={v=>up("toeLeft",v)} onRight={v=>up("toeRight",v)} axleType={axle.type} driveSide={axle.driveSide||"RHD"}/>
      }
      <ToeCalcBoxes axle={axle} fullDistance={fullDistance} tols={axle.tolerances} allAxles={allAxles}/>
      <CollapseSection label="Geometry" open={showGeo} onToggle={onToggleGeo} variant="geometry"
        badge={geoFilled>0?`${geoFilled} values`:""}>
        <SteeringGeoSection axle={axle} up={up} showTurning={true} tols={axle.tolerances}/>
      </CollapseSection>
      {isJosam&&!isAfter&&showAdjCalc&&(
        <CollapseSection label="Adjustment Calculator" open={showAdj} onToggle={onToggleAdj} variant="calculator">
          <JosamAdjustSection afterAxle={axle} beforeAxle={beforeAxle} fullDistance={fullDistance} onChange={onChange} axle={axle}/>
        </CollapseSection>
      )}
    </div>
  );
}

function FixedAxlePanel({ axle, onChange, showGeo=false, onToggleGeo, showAdj=false, onToggleAdj, isJosam=false, fullDistance="", beforeAxle=null, isAfter=false, allAxles=null, showAdjCalc=false }) {
  const up=(f,v)=>onChange({...axle,[f]:v});
  const dual = axle.dualWheel||false;
  const geoFilled=[axle.camberLeft,axle.camberRight].filter(hasVal).length;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <div/>
        <Toggle label="Wheel Type"
          options={[{label:"Single",value:false},{label:"Dual",value:true}]}
          value={dual} onChange={v=>up("dualWheel",v)} disabled={isAfter}/>
      </div>
      {isJosam
        ? <JosamToeRow axle={axle} fullDistance={fullDistance} onChange={onChange} dual={dual} isAfter={isAfter}/>
        : <ToeRow toeLeft={axle.toeLeft} toeRight={axle.toeRight}
            onLeft={v=>up("toeLeft",v)} onRight={v=>up("toeRight",v)} dual={dual} tols={axle.tolerances} axleType={axle.type} driveSide={axle.driveSide||"RHD"}/>
      }
      <ToeCalcBoxes axle={axle} fullDistance={fullDistance} tols={axle.tolerances} allAxles={allAxles}/>
      <CollapseSection label="Geometry" open={showGeo} onToggle={onToggleGeo} variant="geometry"
        badge={geoFilled>0?`${geoFilled} values`:""}>
        <FixedGeoSection axle={axle} up={up} tols={axle.tolerances}/>
      </CollapseSection>
      {isJosam&&!isAfter&&showAdjCalc&&(
        <CollapseSection label="Adjustment Calculator" open={showAdj} onToggle={onToggleAdj} variant="calculator">
          <FixedJosamAdjustSection afterAxle={axle} beforeAxle={beforeAxle} fullDistance={fullDistance} onChange={onChange} axle={axle}/>
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
            color:"#050505",fontFamily:FM,fontSize:13,fontWeight:"normal",outline:"none",resize:"vertical"}}/>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SCREENS
══════════════════════════════════════════════════════════════ */
function SwipeableJobCard({ j, onOpen, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOut(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClickOut);
    document.addEventListener("touchstart", onClickOut);
    return () => { document.removeEventListener("mousedown", onClickOut); document.removeEventListener("touchstart", onClickOut); };
  }, [menuOpen]);

  function confirmDelete(e) { e.stopPropagation(); onDelete(j.id); }
  function cancelDelete(e)  { e.stopPropagation(); setDeleting(false); }
  function requestDelete(e) { e.stopPropagation(); setMenuOpen(false); setDeleting(true); }

  const fmtDate = iso => { const d=new Date(iso); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; };
  const synced = j.syncStatus==="synced";

  const cols = [
    { label:"Make & Model", value:[j.vehicle.make,j.vehicle.model].filter(Boolean).join(" ") },
    { label:"Mileage",      value:j.vehicle.mileage ? parseInt(j.vehicle.mileage).toLocaleString() : "" },
    { label:"Date",         value:fmtDate(j.createdAt) },
    { label:"Customer",     value:j.customer.company||j.customer.name||"" },
  ].filter(c=>c.value);

  if (deleting) {
    return (
      <div style={{background:"#ffffff",borderRadius:"0.4rem",borderLeft:"4px solid #eb0000",
        boxShadow:"0 1px 4px rgba(0,0,0,0.10)",padding:"14px 16px"}}>
        <div style={{fontFamily:FB,fontSize:13,color:"#050505",marginBottom:6,fontWeight:"600"}}>Delete this job?</div>
        <div style={{fontFamily:FB,fontSize:12,color:"#888",marginBottom:14}}>
          {j.customer.company||j.customer.name||j.vehicle.reg||"—"}
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
    <div onClick={()=>onOpen(j.id)} style={{
      background:"#ffffff",borderRadius:"0.4rem",borderLeft:"4px solid #eb0000",
      boxShadow:"0 1px 4px rgba(0,0,0,0.10)",cursor:"pointer",overflow:"visible",
      transition:"box-shadow 0.15s",
    }}
    onMouseEnter={e=>e.currentTarget.style.boxShadow="0 3px 10px rgba(0,0,0,0.15)"}
    onMouseLeave={e=>e.currentTarget.style.boxShadow="0 1px 4px rgba(0,0,0,0.10)"}>

      {/* Top row: REG + sync + menu */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"9px 12px 11px 14px",gap:8}}>
        <div style={{fontFamily:FM,fontSize:24,fontWeight:"800",color:"#eb0000",
          letterSpacing:0,textTransform:"uppercase",
          whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",flex:1,minWidth:0}}>
          {j.vehicle.reg||<span style={{color:"#ccc",fontSize:14,fontFamily:FB,fontWeight:"500",letterSpacing:0}}>No reg</span>}
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}} onClick={e=>e.stopPropagation()}>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <div style={{width:7,height:7,borderRadius:"50%",background:synced?"#16a34a":"#eb0000",flexShrink:0}}/>
            <span style={{fontSize:10,fontFamily:FB,fontWeight:"600",color:"#888"}}>{synced?"Synced":"Unsynced"}</span>
          </div>
          <div ref={menuRef} style={{position:"relative"}}>
            <button onClick={e=>{e.stopPropagation();setMenuOpen(o=>!o);}}
              style={{background:"none",border:"none",cursor:"pointer",padding:"2px 6px",
                fontSize:20,color:"#bbb",lineHeight:1,borderRadius:"0.25rem",
                display:"flex",alignItems:"center"}}
              onMouseEnter={e=>e.currentTarget.style.color="#555"}
              onMouseLeave={e=>e.currentTarget.style.color="#bbb"}>⋮</button>
            {menuOpen&&(
              <div style={{position:"absolute",right:0,top:"110%",zIndex:300,
                background:"#fff",border:"1px solid rgba(5,5,5,0.12)",borderRadius:"0.35rem",
                boxShadow:"0 4px 16px rgba(0,0,0,0.14)",minWidth:130,overflow:"hidden"}}>
                <button onClick={requestDelete}
                  style={{display:"block",width:"100%",padding:"10px 14px",textAlign:"left",
                    background:"none",border:"none",cursor:"pointer",fontFamily:FB,fontSize:13,
                    fontWeight:"600",color:"#eb0000"}}
                  onMouseEnter={e=>e.currentTarget.style.background="#fef2f2"}
                  onMouseLeave={e=>e.currentTarget.style.background="none"}>Delete job</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Divider */}
      <div style={{height:"1px",background:"rgba(5,5,5,0.07)",margin:"0 14px"}}/>

      {/* Data grid */}
      {cols.length>0&&(
        <div style={{display:"flex",padding:"9px 0 11px 0"}}>
          {cols.map((c,i)=>(
            <div key={c.label} style={{flex:1,minWidth:0,padding:"0 12px",
              borderRight:i<cols.length-1?"1px solid rgba(5,5,5,0.07)":"none"}}>
              <div style={{fontFamily:FB,fontSize:10,color:"#aaa",fontWeight:"500",
                textTransform:"uppercase",letterSpacing:"0.05em",marginBottom:3,
                whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.label}</div>
              <div style={{fontFamily:FM,fontSize:12,fontWeight:"600",color:"#050505",
                whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CloudSyncIndicator({ pendingCount }) {
  const synced = pendingCount===0;
  return (
    <div style={{position:"relative",display:"inline-flex",alignItems:"center",marginLeft:8}} title={synced?"All synced":`${pendingCount} pending sync`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke={synced?"rgba(255,255,255,0.35)":"#eb0000"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17.5 19H9a5.5 5.5 0 0 1-1-10.9 6 6 0 0 1 11.4 2.4A4 4 0 0 1 17.5 19Z"/>
      </svg>
      {pendingCount>0&&(
        <span style={{position:"absolute",top:-6,right:-8,background:"#eb0000",color:"#fff",
          fontSize:9,fontFamily:FM,fontWeight:"bold",borderRadius:"50%",
          minWidth:14,height:14,display:"flex",alignItems:"center",justifyContent:"center",
          padding:"0 2px",lineHeight:1}}>
          {pendingCount}
        </span>
      )}
    </div>
  );
}

function RefreshButton({ onRefresh }) {
  const [spinning,setSpinning]=useState(false);
  const handleClick = async () => {
    if (spinning) return;
    setSpinning(true);
    const start = Date.now();
    await onRefresh();
    const elapsed = Date.now()-start;
    setTimeout(()=>setSpinning(false), Math.max(0, 500-elapsed));
  };
  return (
    <button onClick={handleClick} disabled={spinning} title="Sync now"
      style={{display:"inline-flex",alignItems:"center",justifyContent:"center",
        width:18,height:18,marginLeft:6,padding:0,background:"none",border:"none",
        cursor:spinning?"default":"pointer",color:"rgba(255,255,255,0.4)"}}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={{animation: spinning ? "trkSpin 0.6s linear infinite" : "none"}}>
        <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
        <path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
      </svg>
    </button>
  );
}

function Dashboard({ jobs, onNew, onOpen, onDelete, pendingCount=0, onRefresh }) {
  const [q,setQ]=useState("");
  const [syncBannerDismissed,setSyncBannerDismissed]=useState(false);
  const unsyncedJobCount=jobs.filter(j=>j.syncStatus!=="synced").length;
  const showSyncBanner=!syncBannerDismissed&&unsyncedJobCount>=5;
  const sorted=[...jobs].sort((a,b)=>
    new Date(b.createdAt||0) - new Date(a.createdAt||0));
  const filtered=sorted.filter(j=>
    [j.customer.company,j.customer.name,j.vehicle.reg,j.vehicle.make,j.vehicle.model]
      .join(" ").toLowerCase().includes(q.toLowerCase()));

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {showSyncBanner&&(
        <div style={{
          background:"#eb0000",borderRadius:"0.3rem",
          padding:"12px 12px 12px 14px",
          display:"flex",alignItems:"center",gap:12,
          marginBottom:-4,
        }}>
          {/* Warning icon */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          {/* Text */}
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontFamily:FB,fontSize:13,fontWeight:"700",color:"#ffffff",lineHeight:1.2}}>
              {unsyncedJobCount} job{unsyncedJobCount!==1?"s":""} unsynced
            </div>
            <div style={{fontFamily:FB,fontSize:11,color:"rgba(255,255,255,0.8)",marginTop:2,lineHeight:1.3}}>
              Connect to the internet to back up your data
            </div>
          </div>
          {/* Dismiss */}
          <button onClick={()=>setSyncBannerDismissed(true)} style={{
            flexShrink:0,width:28,height:28,borderRadius:"50%",
            background:"rgba(0,0,0,0.25)",border:"none",cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",padding:0,
          }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      )}
      {/* Header: logo left, New Job right — matched height */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,paddingTop:4}}>
        <div style={{width:140,flexShrink:0,display:"flex",alignItems:"center"}} dangerouslySetInnerHTML={{__html:`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 354 70" style="display:block;width:100%;height:auto"><defs><style>.wc1{fill:#eb0000}.wc2{fill:#ffffff}</style></defs><g><g><rect class="wc1" x="2" y="33" width="64" height="4"/><path class="wc2" d="M0,1v68h68V1H0ZM61.17,5L4,62.17V5h57.17ZM6.83,65L64,7.83v57.17H6.83Z"/></g><g><polygon class="wc2" points="134.26 .99 111.74 69.01 120.53 69.01 142.87 1.38 165.2 69.01 174 69.01 151.47 .99 134.26 .99"/><path class="wc2" d="M334.95,30.66l-8.99-2.17c-11.02-2.66-14.12-5.52-14.12-10.65,0-6.9,5.99-10.75,14.7-10.75,10.25,0,16.24,6.01,17.02,14.1h8.61c-1.16-11.73-9.47-21.2-26.01-21.2-12.57,0-23.3,7.1-23.3,18.24,0,9.46,6.57,15.48,20.5,18.83l8.99,2.17c8.6,2.07,12.57,5.72,12.57,12.03,0,7.2-6.86,11.63-16.73,11.63s-17.79-8.08-18.37-17.84h-8.6c.87,12.92,9.86,24.94,27.36,24.94,15.86,0,25.43-8.38,25.43-18.63,0-11.83-6.67-17.75-19.05-20.7Z"/><polygon class="wc2" points="218.1 69 257 68.99 257 61.9 226.41 61.9 226.41 37.65 257 37.65 257 30.55 226.41 30.55 226.41 8.07 257 8.07 257 .97 218.1 .97 218.1 69"/></g></g></svg>`}}/>
        <Btn onClick={onNew}>+ New Job</Btn>
      </div>

      {/* Info row: job count left, sync info right */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
        <span style={{fontFamily:FB,fontSize:12,color:"rgba(255,255,255,0.5)",fontWeight:"600",letterSpacing:"0.06em",textTransform:"uppercase"}}>
          {filtered.length} JOB{filtered.length!==1?"S":""}
        </span>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          {pendingCount>0&&(
            <span style={{fontFamily:FB,fontSize:12,color:"#eb0000",fontWeight:"600",letterSpacing:"0.06em",textTransform:"uppercase"}}>
              {pendingCount} UNSYNCED
            </span>
          )}
          {pendingCount===0&&(
            <span style={{fontFamily:FB,fontSize:12,color:"rgba(255,255,255,0.5)",fontWeight:"600",letterSpacing:"0.06em",textTransform:"uppercase"}}>
              0 UNSYNCED
            </span>
          )}
          <CloudSyncIndicator pendingCount={pendingCount}/>
          {onRefresh&&<RefreshButton onRefresh={onRefresh}/>}
        </div>
      </div>

      {/* Search box */}
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
    tootLeft:"",    tootRight:"",   tootLeft2:"", tootRight2:"",
    frontScaleLeft:"", rearScaleLeft:"",
    frontScaleRight:"", rearScaleRight:"",
    targetToeLeft:"", targetToeRight:"",
    // axleDistance kept — same vehicle same geometry
  }));
}

function ReadingsPanel({ axles, setAxles, isJosam=false, fullDistance="", setFullDistance, beforeAxles=null, jobRef=null, onConfigClick=null, showAdjCalc=false }) {
  const isAfterPanel = !setFullDistance && beforeAxles!==null;
  // showGeo lives HERE so it survives axle data re-renders without remounting
  const [geoOpen, setGeoOpen] = useState({});
  const toggleGeo = id => setGeoOpen(prev => ({...prev, [id]: !prev[id]}));
  const [adjOpen, setAdjOpen] = useState({});
  const toggleAdj = id => setAdjOpen(prev => ({...prev, [id]: !prev[id]}));
  const [steerTypePrompt, setSteerTypePrompt] = useState(false);

  const updAxle = useCallback(ax =>
    setAxles(prev => (Array.isArray(prev) ? prev : []).map(a => a.id===ax.id ? ax : a)),
  [setAxles]);
  const addAxle = useCallback((type, forceType) => {
    // forceType bypasses the prompt (used after user makes a choice)
    const resolvedType = forceType || type;
    setAxles(prev => {
      const arr = Array.isArray(prev) ? prev : [];
      let label;
      if (resolvedType==="steering") {
        const existingSteer = arr.filter(a=>a.type==="steering").length;
        label = existingSteer===0 ? "Front Steer" : "Second Steer";
      } else if (resolvedType==="rear-steer") {
        label = "Rear Steer";
      } else {
        label = "Non Steer";
      }
      return [...arr,
        resolvedType==="steering"   ? makeSteeringAxle(label)
        : resolvedType==="rear-steer" ? makeRearSteerAxle(label)
        : makeFixedAxle(label)];
    });
  }, [setAxles]);
  const handleAddSteer = useCallback(() => {
    const arr = Array.isArray(axles) ? axles : [];
    const hasFixed = arr.some(a => a.type==="fixed");
    const hasSteer = arr.some(a => a.type==="steering");
    // Prompt only when there are non-steer axles already and no steer axle yet
    if (hasFixed && !hasSteer) {
      setSteerTypePrompt(true);
    } else {
      addAxle("steering");
    }
  }, [axles, addAxle]);
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
            <input value={axle.label} onChange={e=>!isAfterPanel&&relabel(axle.id,e.target.value)}
              readOnly={isAfterPanel}
              style={{flex:1,background:"transparent",border:"none",outline:"none",
                fontFamily:FD,fontSize:15,color:"#050505",letterSpacing:"0.04em",fontWeight:"600",
                cursor:isAfterPanel?"default":"text"}}/>
            <span style={{fontSize:9,fontFamily:FM,padding:"2px 8px",borderRadius:"0.3rem",
              background:"#eb0000",color:"#ffffff",border:"1px solid #eb0000"}}>{axle.type}</span>
            {!isAfterPanel&&(
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
                beforeAxle={isAfterPanel
                  ? (beforeAxles?.find(b=>b.label===axle.label)||null)
                  : (showAdjCalc ? axle : null)}
                steerIndex={si} frontSteerSM={frontSM} showAdjCalc={showAdjCalc}/>;
            })()}
            {axle.type==="rear-steer"&&<RearSteerAxlePanel axle={axle} onChange={updAxle}
              showGeo={!!geoOpen[axle.id]} onToggleGeo={()=>toggleGeo(axle.id)}
              showAdj={!!adjOpen[axle.id]} onToggleAdj={()=>toggleAdj(axle.id)}
              isJosam={isJosam} fullDistance={fullDistance} isAfter={!setFullDistance}
              beforeAxle={isAfterPanel
                ? (beforeAxles?.find(b=>b.label===axle.label)||null)
                : (showAdjCalc ? axle : null)}
              allAxles={axles} showAdjCalc={showAdjCalc}/>}
            {axle.type==="fixed"&&<FixedAxlePanel axle={axle} onChange={updAxle}
              showGeo={!!geoOpen[axle.id]} onToggleGeo={()=>toggleGeo(axle.id)}
              showAdj={!!adjOpen[axle.id]} onToggleAdj={()=>toggleAdj(axle.id)}
              isJosam={isJosam} fullDistance={fullDistance} isAfter={!setFullDistance}
              beforeAxle={isAfterPanel
                ? (beforeAxles?.find(b=>b.label===axle.label)||null)
                : (showAdjCalc ? axle : null)}
              allAxles={axles} showAdjCalc={showAdjCalc}/>}
          </div>
        </div>
      ))}
{!isAfterPanel&&(
      <>
        {axles.length===0&&(
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,
            padding:"24px 16px",border:"1.5px dashed rgba(5,5,5,0.18)",borderRadius:"0.3rem",
            background:"rgba(5,5,5,0.02)",textAlign:"center"}}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(5,5,5,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div style={{fontFamily:FB,fontSize:12,color:"rgba(5,5,5,0.45)",lineHeight:1.5}}>
              No axles added yet.<br/>Use the buttons below to build the vehicle configuration.
            </div>
          </div>
        )}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
          <Btn variant="ghost" small onClick={handleAddSteer}>+ Steer Axle</Btn>
          <Btn variant="ghost" small onClick={()=>addAxle("rear-steer")}>+ Rear Steer</Btn>
          <Btn variant="ghost" small onClick={()=>addAxle("fixed")}>+ Non Steer</Btn>
        </div>
      </>
      )}

      {/* Steer type prompt modal */}
      {steerTypePrompt&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:9999,
          display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
          <div style={{background:"#fff",borderRadius:"0.75rem",padding:28,maxWidth:320,width:"100%",
            boxShadow:"0 8px 32px rgba(0,0,0,0.22)"}}>
            <div style={{fontFamily:FM,fontSize:13,fontWeight:"700",color:"#050505",marginBottom:8,
              letterSpacing:"0.04em"}}>AXLE TYPE</div>
            <div style={{fontFamily:FB,fontSize:14,color:"#050505",marginBottom:6,lineHeight:1.5}}>
              Non-steer axles are already present.
            </div>
            <div style={{fontFamily:FB,fontSize:13,color:"rgba(5,5,5,0.55)",marginBottom:20,lineHeight:1.5}}>
              Is this a rear steer axle (e.g. a trailer or tag axle with steering), or a front steer axle?
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <Btn variant="primary" onClick={()=>{setSteerTypePrompt(false);addAxle("steering","steering");}}>
                Front Steer
              </Btn>
              <Btn variant="ghost" onClick={()=>{setSteerTypePrompt(false);addAxle("rear-steer","rear-steer");}}>
                Rear Steer
              </Btn>
            </div>
            <button onClick={()=>setSteerTypePrompt(false)}
              style={{marginTop:14,width:"100%",background:"none",border:"none",
                fontFamily:FB,fontSize:12,color:"rgba(5,5,5,0.4)",cursor:"pointer",padding:4}}>
              Cancel
            </button>
          </div>
        </div>
      )}
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
                        onKeyDown={e=>{ if(e.key==="Enter"){ e.preventDefault(); setTgt(e.target.value); } if(e.key==="Tab") setTgt(e.target.value); }}
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

function PanContainer({ children }) {
  const ref = useRef(null);
  const dragging = useRef(false);
  const start = useRef({ x: 0, y: 0, sl: 0, st: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const isMobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function onMouseDown(e) {
    if (isMobile || e.button !== 0) return;
    dragging.current = true;
    setIsDragging(true);
    start.current = { x: e.clientX, y: e.clientY, sl: ref.current.scrollLeft, st: ref.current.scrollTop };
    e.preventDefault();
  }
  function onMouseMove(e) {
    if (!dragging.current) return;
    ref.current.scrollLeft = start.current.sl - (e.clientX - start.current.x);
    ref.current.scrollTop  = start.current.st - (e.clientY - start.current.y);
  }
  function onMouseUp() { dragging.current = false; setIsDragging(false); }

  return (
    <div ref={ref}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      style={{padding:16, overflow:"auto",
        cursor: isMobile ? "default" : isDragging ? "grabbing" : "grab",
        userSelect:"none", WebkitUserSelect:"none"}}>
      {children}
    </div>
  );
}

function ReportScreen({ job, company, onClose, actionsRef }) {
  const [exporting, setExporting] = useState(false);
  const [pendingShare, setPendingShare] = useState(null); // { file, blob, fname } waiting for fresh tap
  const axlesOuterRef = useRef(null);
  const axlesInnerRef = useRef(null);
  const [axleScale, setAxleScale] = useState(1);
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
      tootL2:g("tootLeft2"), tootR2:g("tootRight2"),
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

  // Header / job details / BEFORE-AFTER band / footer stay full size; only the
  // axle rows block is shrunk (via transform scale, never enlarged) to fit
  // whatever vertical space is left on the single A4 landscape page.
  useLayoutEffect(() => {
    const outer = axlesOuterRef.current, inner = axlesInnerRef.current;
    if (!outer || !inner) return;
    const availableH = outer.offsetHeight;
    const naturalH = inner.offsetHeight; // offsetHeight is layout-only, unaffected by transform:scale
    if (availableH<=0 || naturalH<=0) return;
    const next = Math.min(1, availableH / naturalH);
    if (Math.abs(next - axleScale) > 0.002) setAxleScale(next);
  }, [beforeAxles.length, afterAxles.length, JSON.stringify(job.axles), JSON.stringify(job.afterAxles), job.notes, axleScale]);

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
  function AxlePanel({axle, allAxles, steerIdx, frontSM, label, isAfter=false, unchanged=false, geoUnchanged=false}) {
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
    // tootL (tootLeft) is auto-set to 20 by TootBox; exclude it from the "has user geo?" check
    const hasGeoSteer = isSteer && [v.camberL, v.casterL, v.kpiL, v.maxTL].concat(geoR).some(x=>x!==null && x!==0);

    // tootDiffA: left wheel fixed at 20°, right wheel measured → left TootBox diff
    const tootDiffA = (v.tootL!==null && v.tootR!==null) ? v.tootL - v.tootR : null;
    // tootDiffB: right wheel fixed at 20°, left wheel measured → right TootBox diff
    const tootDiffB = (v.tootR2!==null && v.tootL2!==null) ? v.tootR2 - v.tootL2 : null;
    const tootDiff = (tootDiffA!==null && tootDiffB!==null) ? tootDiffA - tootDiffB : null;
    const crossCamber = (v.camberL!==null && v.camberR!==null) ? v.camberL - v.camberR : null;
    const crossCaster = (v.casterL!==null && v.casterR!==null) ? v.casterL - v.casterR : null;
    const turnDiff = (v.maxTL!==null && v.maxTR!==null) ? v.maxTL - v.maxTR : null;

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
            width:TOE_W,flexShrink:0}}>
            {label}
            {unchanged&&<span style={{fontWeight:"normal",fontStyle:"italic",fontSize:"5.5pt",color:"#aaa",marginLeft:4}}>Unchanged</span>}
          </div>
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

        {/* Row 2: Left toe+camber | diagram | Right toe+camber — centred vertically */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",
          gap:0,marginBottom:3}}>
          <div style={{width:TOE_W,flexShrink:0,display:"flex",flexDirection:"column",
            alignItems:"flex-end",gap:6,paddingRight:8}}>
            {v.tL!==null&&(
              <div style={BOX}>
                <div style={SML}>LEFT TOE</div>
                <div style={VAL(tlC(v.tL,t.toeLeft))}>{f1(v.tL)}mm</div>
              </div>
            )}
            {v.camberL!==null&&(
              <div style={BOX}>
                <div style={SML}>LEFT CAMBER</div>
                <div style={VAL(tlC(v.camberL,t.camberLeft))}>{fDeg(v.camberL)}</div>
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
          <div style={{width:TOE_W,flexShrink:0,display:"flex",flexDirection:"column",
            alignItems:"flex-start",gap:6,paddingLeft:8}}>
            {v.tR!==null&&(
              <div style={BOX}>
                <div style={SML}>RIGHT TOE</div>
                <div style={VAL(tlC(v.tR,t.toeRight))}>{f1(v.tR)}mm</div>
              </div>
            )}
            {v.camberR!==null&&(
              <div style={BOX}>
                <div style={SML}>RIGHT CAMBER</div>
                <div style={VAL(tlC(v.camberR,t.camberRight))}>{fDeg(v.camberR)}</div>
              </div>
            )}
          </div>
        </div>

        {/* Row 3 steer: Steering Middle [+ Twinsteer] centred */}
        {isSteer && v.smObj && (
          <div style={{display:"flex",gap:6,justifyContent:"center",marginTop:-4,marginBottom:8}}>
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

        {/* Row 3 fixed: OOS + Parallelism, centred */}
        {isFixed && (v.oosObj||v.para) && (
          <div style={{display:"flex",alignItems:"flex-start",gap:4,
            justifyContent:"center",marginBottom:3}}>
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
        )}

        {/* Geo table — steer only, grouped by measurement, centred */}
        {hasGeoSteer && (()=>{
          const ALL_GROUPS = [
            { label:"Caster",   valL:v.casterL, valR:v.casterR, intFmt:false, tolL:t.casterLeft,  tolR:t.casterRight,
              calc: crossCaster!==null ? {label:"Cross", value:crossCaster, tol:t.crossCaster, intFmt:false} : null },
            { label:"KPI",      valL:v.kpiL,    valR:v.kpiR,    intFmt:false, tolL:t.kpiLeft,     tolR:t.kpiRight,    calc:null },
            { label:"Max Turn", valL:v.maxTL,   valR:v.maxTR,   intFmt:true,
              calc: turnDiff!==null ? {label:"Diff", value:turnDiff, tol:t.turnDiff, intFmt:true} : null },
            { label:"TOOT",     valL:tootDiffA, valR:tootDiffB, intFmt:true,
              calc: tootDiff!==null ? {label:"Diff", value:tootDiff, intFmt:true} : null },
          ].filter(g => g.valL!==null || g.valR!==null);
          if (ALL_GROUPS.length === 0) return null;

          const COL_W = "32pt";
          const fmtVal = (val, intFmt) => intFmt
            ? (val===null ? "—" : `${val>=0?"+":""}${Math.round(val)}°`)
            : fDeg(val);
          const geoColor = (val, tol) => {
            if (val===null || !tol) return "#111";
            const r = trafficLight(String(val), tol);
            return r==="green" ? "#16a34a" : r==="red" ? "#dc2626" : "#111";
          };
          const borderS = "0.4pt solid #ddd";
          const labelRowS = {textAlign:"center",color:"#888",fontWeight:"normal",
            textTransform:"uppercase",letterSpacing:"0.04em",
            padding:"2pt 2pt",border:borderS,fontSize:"4.5pt",
            background:"#f8f8f8",
            display:"flex",alignItems:"center",justifyContent:"center"};
          const subLblS = {textAlign:"center",color:"#888",fontWeight:"normal",
            padding:"1.5pt 2pt",border:borderS,fontSize:"5pt",
            display:"flex",alignItems:"center",justifyContent:"center",whiteSpace:"nowrap"};
          const valS = {textAlign:"center",fontWeight:"bold",color:"#111",
            padding:"2pt 2pt",border:borderS,fontSize:"6pt",
            display:"flex",alignItems:"center",justifyContent:"center"};

          return (
            <div style={{display:"flex",justifyContent:"center",flexWrap:"nowrap",gap:"4pt",overflowX:"hidden"}}>
              {ALL_GROUPS.map(g => {
                const cols = g.calc ? 3 : 2;
                return (
                  <div key={g.label} style={{display:"grid",
                    gridTemplateColumns:`repeat(${cols}, ${COL_W})`,
                    gridTemplateRows:"repeat(3, auto)",
                    fontSize:"6pt",fontFamily:"Arial,sans-serif"}}>
                    {/* Row 1: measurement label spanning all cols */}
                    <div style={{...labelRowS, gridColumn:`1 / span ${cols}`}}>{g.label}</div>
                    {/* Row 2: sub-column labels */}
                    <div style={subLblS}>Left</div>
                    <div style={subLblS}>Right</div>
                    {g.calc && <div style={subLblS}>{g.calc.label}</div>}
                    {/* Row 3: values */}
                    <div style={{...valS, color:geoColor(g.valL, g.tolL)}}>{fmtVal(g.valL, g.intFmt)}</div>
                    <div style={{...valS, color:geoColor(g.valR, g.tolR)}}>{fmtVal(g.valR, g.intFmt)}</div>
                    {g.calc && <div style={{...valS, color:geoColor(g.calc.value, g.calc.tol)}}>{fmtVal(g.calc.value, g.calc.intFmt)}</div>}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    );
  }

  const PANEL_W = 380;

  // iOS Safari/Chrome: iframe.print() and Web Share (after await) don't work reliably.
  // On iOS we generate the PDF and open it in a new tab — the native PDF viewer
  // provides working Share/Print buttons. On desktop we keep the direct approaches.
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  async function buildPdfBlob() {
    const el = document.getElementById("aes-report");
    if (!el) throw new Error("no element");
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
    const img = canvas.toDataURL("image/jpeg", 0.92);
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const ratio = Math.min(pageW / canvas.width, pageH / canvas.height);
    const drawW = canvas.width * ratio;
    const drawH = canvas.height * ratio;
    const x = (pageW - drawW) / 2;
    pdf.addImage(img, "JPEG", x, 0, drawW, drawH);
    const reg = (job.vehicle?.reg||"").toUpperCase().replace(/\s+/g,"");
    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
    const fname = (reg ? `${reg}_${dateStr}` : `alignment-report_${dateStr}`) + ".pdf";
    return { blob: pdf.output("blob"), fname };
  }

  function openBlobInNewTab(blob) {
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  const printReport = async () => {
    if (isIOS) {
      // iOS: generate PDF and open in new tab — user gets native Share/Print from PDF viewer
      if (exporting) return;
      setExporting(true);
      try {
        const { blob } = await buildPdfBlob();
        openBlobInNewTab(blob);
      } catch(e) {
        alert("Could not generate PDF. Please try again.");
      } finally {
        setExporting(false);
      }
      return;
    }
    // Desktop: print via hidden iframe
    const el = document.getElementById("aes-report");
    if (!el) return;
    let iframe = document.getElementById("aes-print-frame");
    if (iframe) iframe.remove();
    iframe = document.createElement("iframe");
    iframe.id = "aes-print-frame";
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:none";
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
    setTimeout(()=>{ iframe.contentWindow.focus(); iframe.contentWindow.print(); setTimeout(cleanup, 60000); }, 500);
  };

  const isAndroid = /android/i.test(navigator.userAgent);

  const exportPdf = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { blob, fname } = await buildPdfBlob();
      const file = new File([blob], fname, { type: "application/pdf" });
      if (isIOS && navigator.share) {
        // iOS: gesture is lost after the await — show a prompt so user taps again (fresh gesture)
        setPendingShare({ file, blob, fname });
        setExporting(false);
        return;
      }
      if (isAndroid && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        // Android: gesture survives the await, share directly
        const reg = (job.vehicle?.reg||"").toUpperCase().replace(/\s+/g,"");
        const dateStr = new Date(job.createdAt).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});
        const subject = `Wheel Alignment Report${reg?" - "+reg:""}`;
        const body = `Wheel Alignment Report${reg?" - "+reg:""}${dateStr?" - "+dateStr:""}${company?.name?" by "+company.name:""}`;
        try {
          await navigator.share({ files: [file] });
        } catch(e) {
          if (e?.name !== "AbortError") openBlobInNewTab(blob);
        }
        return;
      }
      // Desktop fallback — direct download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fname; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch(e) {
      alert("Could not export PDF. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  // Called from the "Tap to Share" overlay — fresh user gesture, share sheet will open
  async function triggerShare() {
    if (!pendingShare) return;
    const { file, blob } = pendingShare;
    setPendingShare(null);
    const reg = (job.vehicle?.reg||"").toUpperCase().replace(/\s+/g,"");
    const dateStr = new Date(job.createdAt).toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});
    const coName = company?.name||"";
    const subject = `Wheel Alignment Report${reg?" - "+reg:""}`;
    const body = `Wheel Alignment Report${reg?" - "+reg:""}${dateStr?" - "+dateStr:""}${coName?" by "+coName:""}`;
    try {
      await navigator.share({ files: [file] });
    } catch(e) {
      if (e?.name !== "AbortError") openBlobInNewTab(blob); // last-resort fallback
    }
  }

  // Expose actions to parent via ref
  if (actionsRef) actionsRef.current = { exportPdf, printReport, exporting };

  return (
    <div style={{display:"flex",flexDirection:"column",background:"#e8e8e8"}}>
      {/* iOS share prompt — appears after PDF is generated, fresh tap triggers share sheet */}
      {pendingShare&&(
        <div style={{position:"fixed",inset:0,zIndex:999,background:"rgba(0,0,0,0.6)",
          display:"flex",alignItems:"flex-end",justifyContent:"center",
          padding:"0 0 calc(32px + env(safe-area-inset-bottom))"}}>
          <div style={{background:"#fff",borderRadius:"1rem",padding:"24px 24px 20px",
            width:"100%",maxWidth:420,margin:"0 16px",textAlign:"center",boxShadow:"0 8px 32px rgba(0,0,0,0.3)",
            position:"relative"}}>
            <button onClick={()=>setPendingShare(null)} style={{
              position:"absolute",top:12,right:12,
              background:"rgba(5,5,5,0.07)",border:"none",borderRadius:"50%",
              width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center",
              cursor:"pointer",padding:0,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
            <div style={{width:48,height:48,background:"#eb0000",borderRadius:"50%",
              display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px"}}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
            </div>
            <div style={{fontFamily:FB,fontWeight:"700",fontSize:16,color:"#050505",marginBottom:6}}>PDF Ready</div>
            <div style={{fontFamily:FB,fontSize:13,color:"rgba(5,5,5,0.5)",marginBottom:20}}>{pendingShare.fname}</div>
            <button onClick={triggerShare} style={{
              width:"100%",background:"#eb0000",border:"none",borderRadius:"0.5rem",
              padding:"14px",color:"#fff",fontFamily:FB,fontWeight:"700",fontSize:15,
              cursor:"pointer",marginBottom:10}}>
              Tap to Share
            </button>
            <button onClick={()=>{ openBlobInNewTab(pendingShare.blob); setPendingShare(null); }} style={{
              width:"100%",background:"none",border:"none",color:"rgba(5,5,5,0.4)",
              fontFamily:FB,fontSize:13,cursor:"pointer",padding:"6px"}}>
              Open in browser instead
            </button>
          </div>
        </div>
      )}
      {/* A4 preview — no fixed header here; header lives in JobEditor */}
      <PanContainer>
        <div id="aes-report" style={{
          background:"#fff",width:"281mm",minWidth:"281mm",height:"210mm",margin:"0 auto",
          padding:"8mm 8mm",boxSizing:"border-box",
          boxShadow:"0 2px 16px rgba(0,0,0,0.18)",
          fontFamily:"Arial,sans-serif",fontSize:"8pt",color:"#000",
          display:"flex",flexDirection:"column",overflow:"hidden",
        }}>

          {/* ── HEADER — fixed size, never shrinks ── */}
          <div style={{background:"#111",padding:"10pt",marginBottom:"6pt",flexShrink:0,
            display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:"14pt"}}>
              <img src={company.logo||DEFAULT_LOGO} alt="logo" style={{height:"32pt",display:"block",flexShrink:0}}/>
              <div style={{display:"flex",gap:"16pt"}}>
                <div style={{display:"flex",flexDirection:"column",gap:"2pt"}}>
                  {company.name&&<div style={{fontSize:"7pt",fontFamily:FD,color:"rgba(255,255,255,0.85)"}}>{company.name}</div>}
                  {company.phone&&<div style={{fontSize:"7pt",fontFamily:FD,color:"rgba(255,255,255,0.85)"}}>{company.phone}</div>}
                  {company.email&&<div style={{fontSize:"7pt",fontFamily:FD,color:"rgba(255,255,255,0.85)"}}>{company.email}</div>}
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:"2pt"}}>
                  {company.address&&<div style={{fontSize:"7pt",fontFamily:FD,color:"rgba(255,255,255,0.85)",maxWidth:"110pt"}}>{company.address}</div>}
                  {company.address2&&<div style={{fontSize:"7pt",fontFamily:FD,color:"rgba(255,255,255,0.85)",maxWidth:"110pt"}}>{company.address2}</div>}
                  {company.website&&<div style={{fontSize:"7pt",fontFamily:FD,color:"rgba(255,255,255,0.85)"}}>{company.website}</div>}
                </div>
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:"12pt",fontWeight:"bold",fontFamily:FD,color:"#ffffff",letterSpacing:"0.05em"}}>
                WHEEL ALIGNMENT REPORT
              </div>
              <div style={{fontSize:"8pt",fontFamily:FD,color:"#ffffff",marginTop:4}}>
                {fmtDate(job.createdAt)}
              </div>
            </div>
          </div>

          {/* ── JOB DETAILS — fixed size, never shrinks ── */}
          <div style={{display:"flex",gap:0,marginBottom:"6pt",border:"0.5pt solid #e0e0e0",
            background:"#f8f8f8",flexShrink:0}}>
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

          {/* ── BEFORE / AFTER SECTION HEADERS — fixed size, never shrinks ── */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:0,marginBottom:"4pt",flexShrink:0}}>
            <div style={{background:"#eb0000",color:"#fff",textAlign:"center",fontSize:"7pt",
              fontWeight:"bold",padding:"3pt",letterSpacing:"0.08em"}}>BEFORE</div>
            <div style={{background:"#16a34a",color:"#fff",textAlign:"center",fontSize:"7pt",
              fontWeight:"bold",padding:"3pt",letterSpacing:"0.08em"}}>AFTER</div>
          </div>

          {/* ── AXLES — fill remaining space; scaled down (never enlarged) to fit ── */}
          <div ref={axlesOuterRef} style={{flex:"1 1 auto",minHeight:0,overflow:"hidden"}}>
          <div ref={axlesInnerRef} style={{
            transform:`scale(${axleScale})`,transformOrigin:"top left",
            width:`${100/axleScale}%`,
          }}>
          {beforeAxles.map((bAxle, i) => {
            const rawAAxle = hasAfter ? (afterAxles[i] || afterAxles.find(a=>a.label===bAxle.label) || null) : null;
            // Check if this axle has any toe/scale after readings (geo is handled separately)
            const hasAfterToe = rawAAxle && [
              rawAAxle.toeLeft, rawAAxle.toeRight,
              rawAAxle.frontScale, rawAAxle.rearScale, rawAAxle.frontScaleRight, rawAAxle.rearScaleRight,
            ].some(v => v !== undefined && v !== null && v !== "");
            // Geo fields: per-field fallback — use After value if entered, else fall back to Before value
            const GEO_KEYS = ["camberLeft","camberRight","casterLeft","casterRight","kpiLeft","kpiRight","maxTurnLeft","maxTurnRight","tootRight","tootLeft2"];
            const geoPerField = Object.fromEntries(GEO_KEYS.map(k => {
              const av = rawAAxle ? rawAAxle[k] : undefined;
              return [k, hasVal(av) ? av : bAxle[k]];
            }));
            // True when After has toe data but geo falls back to Before for at least one field
            const afterGeoUnchanged = hasAfterToe && GEO_KEYS.some(k => !hasVal(rawAAxle?.[k]) && hasVal(bAxle[k]));
            // Build the axle used for the after column: use raw after for toe, per-field geo merge
            const aAxle = hasAfterToe
              ? { ...rawAAxle,
                  ...geoPerField,
                  dualWheel:bAxle.dualWheel, type:bAxle.type, driveSide:bAxle.driveSide, suspType:bAxle.suspType,
                  tolerances: bAxle.tolerances,
                }
              : null;
            const afterUnchanged = !hasAfterToe;
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
                {/* AFTER panel — falls back to before readings with 'Unchanged' label if no after data */}
                <div style={{paddingLeft:"6pt"}}>
                  {aAxle ? (
                    <AxlePanel axle={aAxle}
                      allAxles={afterAxles} steerIdx={steerIdx}
                      frontSM={frontSMAfter} label={`Axle ${i+1}`} isAfter={true} geoUnchanged={afterGeoUnchanged}/>
                  ) : (
                    <AxlePanel axle={bAxle} allAxles={beforeAxles} steerIdx={steerIdx}
                      frontSM={frontSM} label={`Axle ${i+1}`} isAfter={true} unchanged={true}/>
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
          </div>
          </div>

          {/* ── FOOTER — fixed size, never shrinks ── */}
          <div style={{marginTop:"6pt",borderTop:"0.5pt solid #e0e0e0",paddingTop:"3pt",flexShrink:0,
            display:"flex",justifyContent:"space-between",fontSize:"5.5pt",color:"#bbb"}}>
            <span>Generated by AES TrackAlign</span>
            <span>{fmtDate(new Date().toISOString())}</span>
          </div>

        </div>
      </PanContainer>
    </div>
  );
}


function JobEditor({ job, allJobs, onSave, onBack, initialTab="job", onOpenConfigs, onApplyConfig, forceTab=null, company={}, showAdjCalc=false }) {
  const [j,setJ]=useState(()=>({
    ...job,
    axles: Array.isArray(job.axles) ? job.axles : [makeSteeringAxle("Front"), makeFixedAxle("Rear")],
    afterAxles: job.afterAxles && Array.isArray(job.afterAxles) ? job.afterAxles : null,
    measureMethod: job.measureMethod || "direct",
  }));
  const reportActionsRef = useRef({});
  const autoSaveTimer = useRef(null);
  const isFirstRender = useRef(true);
  const [savedTick, setSavedTick] = useState(false);
  const savedTickTimer = useRef(null);

  // Autosave to localStorage + queue Supabase sync on every change (500ms debounce)
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => { onSave(j); }, 500);
    return () => clearTimeout(autoSaveTimer.current);
  }, [j]);

  // Manual force-save — also shows "Saved" tick for 2s
  function handleSave() {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    onSave(j);
    setSavedTick(true);
    if (savedTickTimer.current) clearTimeout(savedTickTimer.current);
    savedTickTimer.current = setTimeout(() => setSavedTick(false), 2000);
  }
  const [tab,setTab]=useState(initialTab);
  useEffect(()=>{ if(forceTab) { setTab(forceTab); window.scrollTo({top:0,behavior:"smooth"}); } },[forceTab]);
  const isJosam = j.measureMethod==="josam";

  const setBeforeAxles = useCallback(updater =>
    setJ(p => ({ ...p, axles: typeof updater === "function" ? updater(p.axles) : updater })),
  []);
  const setAfterAxles = useCallback(updater =>
    setJ(p => ({ ...p, afterAxles: typeof updater === "function" ? updater(p.afterAxles) : updater })),
  []);

  // Sync axle config fields from before to after when before changes
  useEffect(() => {
    if (!j.afterAxles) return;
    const configKeys = ["dualWheel","type","driveSide","suspType","label"];
    let anyChanged = false;
    const synced = j.afterAxles.map((aAxle, i) => {
      const bAxle = j.axles[i];
      if (!bAxle) return aAxle;
      const patch = {};
      let rowChanged = false;
      for (const k of configKeys) { if (bAxle[k] !== aAxle[k]) { patch[k] = bAxle[k]; rowChanged = true; } }
      if (rowChanged) { anyChanged = true; return { ...aAxle, ...patch }; }
      return aAxle;
    });
    if (anyChanged) setJ(p => ({ ...p, afterAxles: synced }));
  }, [j.axles]);

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
    <div style={{display:"flex",flexDirection:"column",minHeight:"100dvh",overflowX:"hidden"}}>
      {/* Fixed chrome: header + tab bar in one block so they're always flush — no gap calculation */}
      <div style={{position:"fixed",top:0,left:0,right:0,zIndex:100,background:"#050505"}}>
        {/* Top bar */}
        <div style={{borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
          <div style={{maxWidth:520,margin:"0 auto",
            paddingTop:"calc(env(safe-area-inset-top) + 10px)",paddingBottom:"10px",paddingLeft:"16px",paddingRight:"16px",
            display:"flex",alignItems:"center",gap:12}}>
          <button onClick={onBack} style={{background:"none",border:"none",color:"#eb0000",
            cursor:"pointer",fontSize:22,padding:"0 4px",lineHeight:1}}>←</button>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontFamily:FM,fontSize:16,color:"#ffffff",letterSpacing:"0.08em",fontWeight:"700",
              textTransform:"uppercase",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
              {j.vehicle.reg||"No reg"}
            </div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.5)",fontFamily:FB}}>{j.customer.company||"No customer"}</div>
          </div>
          {tab==="report" ? (
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>reportActionsRef.current?.exportPdf&&reportActionsRef.current.exportPdf()}
                disabled={reportActionsRef.current?.exporting}
                style={{background:"#eb0000",color:"#ffffff",border:"none",padding:"5px 14px",
                  borderRadius:"0.3rem",cursor:"pointer",fontFamily:FB,fontWeight:"600",
                  fontSize:11,letterSpacing:"0.04em"}}>
                Export PDF
              </button>
              <button onClick={()=>reportActionsRef.current?.printReport&&reportActionsRef.current.printReport()}
                disabled={reportActionsRef.current?.exporting}
                style={{background:"rgba(255,255,255,0.12)",color:"#ffffff",border:"none",padding:"5px 14px",
                  borderRadius:"0.3rem",cursor:"pointer",fontFamily:FB,fontWeight:"600",
                  fontSize:11,letterSpacing:"0.04em"}}>
                Print PDF
              </button>
            </div>
          ) : (
          <button onClick={handleSave} style={{
            background: savedTick ? "#16a34a" : "#eb0000",
            color:"#ffffff",border:"none",padding:"5px 14px",borderRadius:"0.3rem",
            cursor:"pointer",fontFamily:FB,fontWeight:"600",
            fontSize:11,letterSpacing:"0.04em",display:"flex",alignItems:"center",gap:6,
            minWidth:64,justifyContent:"center",transition:"background 0.2s",
          }}>
            {savedTick && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            )}
            {savedTick ? "Saved" : "Save"}
          </button>
          )}
          <style>{`@keyframes trkSpin{to{transform:rotate(360deg)}}`}</style>
          </div>
        </div>
        {/* Tab bar — immediately below header in the same fixed block, guaranteed flush */}
        <div style={{display:"flex",justifyContent:"center",borderBottom:"1px solid rgba(255,255,255,0.08)",overflowX:"auto"}}>
          {TABS.filter(t=>!t.josam||isJosam).map(t=>(
            <button key={t.id}
              onClick={()=>!t.locked&&handleTabChange(t.id)}
              style={{
                padding:"10px 16px",border:"none",cursor:t.locked?"not-allowed":"pointer",
                fontFamily:FB,fontWeight:"600",fontSize:12,letterSpacing:"0.06em",
                textTransform:"uppercase",background:"transparent",whiteSpace:"nowrap",
                color:t.locked?"rgba(255,255,255,0.2)":tab===t.id?"#eb0000":"#ffffff",
                borderBottom:tab===t.id?"2px solid #eb0000":"2px solid transparent",
                transition:"color 0.15s",
              }}>
              {t.label}
              {t.locked&&<span style={{fontSize:8,marginLeft:4,opacity:0.5}}>🔒</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Content — paddingTop clears the unified fixed chrome (header + tab bar) */}
      <div style={{padding:"18px 16px",paddingTop:"calc(18px + 60px + env(safe-area-inset-top) + 42px)",display:"flex",flexDirection:"column",gap:20,background:"#f7f7f7",flex:"1 1 auto",overflowX:"hidden",borderRadius:"0.3rem"}}>
        {tab==="job"&&(
          <>
            <JobDetailsTab j={j} setJ={setJ} allJobs={allJobs} isJosam={isJosam}/>
            <button onClick={()=>{ handleSave(); handleTabChange("before"); }} style={{
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
            jobRef={j} onConfigClick={()=>onOpenConfigs&&onOpenConfigs(setJ,j)}
            showAdjCalc={showAdjCalc}
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
            <ReportScreen job={j} company={company} onClose={()=>setTab("after")} actionsRef={reportActionsRef}/>
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
    <div style={{minHeight:"100dvh",background:T.bg,display:"flex",flexDirection:"column",
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

const LS_LAST_BACKUP_KEY = "trackalign_last_backup";

function SettingsScreen({ measureMode, setMeasureMode, onBack, company, setCompany, userId, showAdjCalc, setShowAdjCalc }) {
  const upC = (f,v) => setCompany(p=>({...p,[f]:v,updatedAt:new Date().toISOString(),syncStatus:"local"}));
  const [saveState, setSaveState] = useState("idle");
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState("");
  const [lastBackup, setLastBackup] = useState(()=>{ try{ return localStorage.getItem(LS_LAST_BACKUP_KEY)||""; }catch(e){ return ""; } });
  const [restoreConfirm, setRestoreConfirm] = useState(null); // holds parsed backup while awaiting confirm
  const [restoreError, setRestoreError] = useState("");
  const restoreInputRef = useRef(null);

  function handleDownloadBackup() {
    const backup = {
      _type: "trackalign-backup",
      _version: 1,
      _exported: new Date().toISOString(),
      jobs: JSON.parse(localStorage.getItem(lsKey(LS_KEY, userId)) || "[]"),
      configs: JSON.parse(localStorage.getItem(lsKey(LS_CONFIGS_KEY, userId)) || "[]"),
      company: JSON.parse(localStorage.getItem(lsKey(LS_COMPANY_KEY, userId)) || "{}"),
      measureMode: localStorage.getItem(lsKey(LS_MODE_KEY, userId)) || "direct",
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0,10);
    a.href = url; a.download = `trackalign-backup-${date}.json`;
    a.click(); URL.revokeObjectURL(url);
    const now = new Date().toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" });
    localStorage.setItem(LS_LAST_BACKUP_KEY, now);
    setLastBackup(now);
  }

  function handleRestorePick(e) {
    setRestoreError("");
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data._type !== "trackalign-backup" || !Array.isArray(data.jobs)) {
          setRestoreError("Invalid backup file — please select a TrackAlign backup.");
          return;
        }
        setRestoreConfirm(data);
      } catch {
        setRestoreError("Could not read file — please select a valid JSON backup.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function handleConfirmRestore() {
    const data = restoreConfirm;
    setRestoreConfirm(null);
    try { localStorage.setItem(lsKey(LS_KEY, userId), JSON.stringify(data.jobs || [])); } catch(e){}
    try { localStorage.setItem(lsKey(LS_CONFIGS_KEY, userId), JSON.stringify(data.configs || [])); } catch(e){}
    try { localStorage.setItem(lsKey(LS_COMPANY_KEY, userId), JSON.stringify(data.company || {})); } catch(e){}
    try { if (data.measureMode) localStorage.setItem(lsKey(LS_MODE_KEY, userId), data.measureMode); } catch(e){}
    // Push to Supabase in background if online
    if (userId && navigator.onLine) {
      (data.jobs || []).forEach(j => upsertJobRemote(j, userId));
      (data.configs || []).forEach(c => upsertConfigRemote(c, userId));
      if (data.company && Object.keys(data.company).length) upsertCompanyRemote(data.company, userId);
    }
    window.location.reload();
  }
  const isBase64Logo = company.logo && company.logo.startsWith("data:");

  async function handleLogoUpload(file) {
    if (!file) return;
    if (!userId) { setLogoError("Sign in required to upload logo."); return; }
    setLogoUploading(true);
    setLogoError("");
    try {
      const url = await uploadLogoToStorage(file, userId);
      upC("logo", url);
    } catch(e) {
      setLogoError("Upload failed — " + (e?.message || "unknown error"));
    } finally {
      setLogoUploading(false);
    }
  }
  function handleSave() {
    setSaveState("saving");
    setTimeout(()=>{ setSaveState("saved"); setTimeout(()=>{ onBack(); }, 600); }, 300);
  }
  return (
    <div style={{minHeight:"100dvh",background:T.bg,display:"flex",flexDirection:"column"}}>
      <div style={{position:"fixed",top:0,left:0,right:0,zIndex:100,background:"#050505",
        borderBottom:"1px solid rgba(255,255,255,0.08)"}}>
        <div style={{maxWidth:520,margin:"0 auto",
          paddingTop:"calc(env(safe-area-inset-top) + 10px)",paddingBottom:"10px",paddingLeft:"16px",paddingRight:"16px",
          display:"flex",alignItems:"center",gap:12}}>
        <button onClick={onBack} style={{background:"none",border:"none",color:"#eb0000",
          cursor:"pointer",fontSize:22,padding:"0 4px",lineHeight:1}}>←</button>
        <span style={{fontFamily:FD,fontSize:16,color:"#ffffff",fontWeight:"600",
          letterSpacing:"0.04em",flex:1}}>Settings</span>
        <button onClick={handleSave} disabled={saveState!=="idle"} style={{
          background:saveState==="saved"?"#16a34a":"#eb0000",
          color:"#ffffff",border:"none",padding:"5px 14px",borderRadius:"0.3rem",
          cursor:saveState!=="idle"?"default":"pointer",fontFamily:FB,fontWeight:"600",
          fontSize:11,letterSpacing:"0.04em",display:"flex",alignItems:"center",gap:6,
          minWidth:64,justifyContent:"center",transition:"background 0.2s",
        }}>
          {saveState==="saving"&&(
            <svg width="12" height="12" viewBox="0 0 24 24" style={{animation:"trkSpin 0.7s linear infinite"}}>
              <circle cx="12" cy="12" r="9" fill="none" stroke="#ffffff" strokeWidth="3" strokeOpacity="0.3"/>
              <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round"/>
            </svg>
          )}
          {saveState==="saved"&&(
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          )}
          {saveState==="idle"?"Save":saveState==="saving"?"Saving":"Saved"}
        </button>
        </div>
      </div>
      <div style={{padding:"18px 16px",paddingTop:"calc(60px + env(safe-area-inset-top))",display:"flex",flexDirection:"column",gap:16,background:"#f7f7f7",minHeight:"100dvh",borderRadius:"0.3rem"}}>

        <div style={{background:"#fff",border:"1px solid rgba(5,5,5,0.10)",borderRadius:"0.3rem",padding:"16px"}}>
          <div style={{fontFamily:FB,fontSize:12,fontWeight:"600",color:"#050505",marginBottom:4}}>Report Header</div>
          <div style={{fontFamily:FB,fontSize:11,color:"rgba(5,5,5,0.5)",marginBottom:12}}>Shown at the top of every PDF report.</div>
          <div style={{display:"flex",flexDirection:"column",gap:3,marginBottom:14}}>
            <label style={{fontSize:10,fontFamily:FB,textTransform:"uppercase",letterSpacing:"0.06em",color:"rgba(5,5,5,0.5)"}}>Logo</label>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{background:"#111",borderRadius:"0.3rem",padding:"6px 10px",
                  display:"flex",alignItems:"center",height:40}}>
                  <img src={company.logo||DEFAULT_LOGO} alt="logo preview" style={{height:28,display:"block"}}/>
                </div>
                <label style={{background:logoUploading?"#ccc":"#e5e5e5",border:"1px solid rgba(5,5,5,0.10)",borderRadius:"0.3rem",
                  padding:"8px 12px",cursor:logoUploading?"default":"pointer",fontFamily:FB,fontSize:12,fontWeight:"600",color:"#050505"}}>
                  {logoUploading?"Uploading…":"Upload"}
                  <input type="file" accept="image/*" style={{display:"none"}} disabled={logoUploading} onChange={e=>{
                    handleLogoUpload(e.target.files?.[0]);
                    e.target.value="";
                  }}/>
                </label>
                {company.logo && (
                  <button onClick={()=>upC("logo","")} style={{background:"none",border:"none",
                    color:"#eb0000",fontFamily:FB,fontSize:12,fontWeight:"600",cursor:"pointer"}}>Remove</button>
                )}
              </div>
              {!company.logo&&(
                <div style={{fontFamily:FB,fontSize:11,color:"rgba(5,5,5,0.4)"}}>
                  Default logo — upload your own above.
                </div>
              )}
              {isBase64Logo&&(
                <div style={{fontFamily:FB,fontSize:11,color:"#d97706",background:"rgba(217,119,6,0.08)",
                  border:"1px solid rgba(217,119,6,0.3)",borderRadius:"0.3rem",padding:"6px 10px"}}>
                  Logo stored locally — re-upload to sync across devices.
                </div>
              )}
              {logoError&&(
                <div style={{fontFamily:FB,fontSize:11,color:"#eb0000"}}>{logoError}</div>
              )}
            </div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {[["Company Name","name","AES Workshop"],["Address Line 1","address","123 High Street"],
              ["Address Line 2","address2","Unit 2 Cropton Court"],
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

        <div style={{background:"#fff",border:"1px solid rgba(5,5,5,0.10)",borderRadius:"0.3rem",padding:"16px"}}>
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
          {measureMode==="josam"&&(
            <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid rgba(5,5,5,0.08)"}}>
              <div style={{fontFamily:FB,fontSize:11,fontWeight:"600",color:"#050505",marginBottom:4}}>
                Show Adjustment Calculator
              </div>
              <div style={{fontFamily:FB,fontSize:11,color:"rgba(5,5,5,0.5)",marginBottom:10}}>
                Shows the Adjustment Calculator on the Before readings screen.
              </div>
              <Toggle
                label=""
                options={[{label:"Yes",value:"yes"},{label:"No",value:"no"}]}
                value={showAdjCalc?"yes":"no"}
                onChange={v=>setShowAdjCalc(v==="yes")}/>
            </div>
          )}
        </div>

        {/* Backup & Restore */}
        <div style={{background:"#fff",border:"1px solid rgba(5,5,5,0.10)",borderRadius:"0.3rem",padding:"16px"}}>
          <div style={{fontFamily:FB,fontSize:12,fontWeight:"600",color:"#050505",marginBottom:4}}>Backup &amp; Restore</div>
          <div style={{fontFamily:FB,fontSize:11,color:"rgba(5,5,5,0.5)",marginBottom:12,lineHeight:1.5}}>
            Your data syncs automatically when online. Use this backup for extra protection or when switching devices without internet access.
          </div>
          {lastBackup&&(
            <div style={{fontFamily:FB,fontSize:11,color:"rgba(5,5,5,0.45)",marginBottom:12}}>
              Last backup: {lastBackup}
            </div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <button onClick={handleDownloadBackup} style={{
              background:"transparent",border:"2px solid #050505",borderRadius:"0.3rem",
              padding:"10px 14px",cursor:"pointer",fontFamily:FB,fontSize:12,fontWeight:"600",
              color:"#050505",textAlign:"center",
            }}>
              Download Backup
            </button>
            <button onClick={()=>{ setRestoreError(""); restoreInputRef.current?.click(); }} style={{
              background:"#eb0000",border:"none",borderRadius:"0.3rem",
              padding:"10px 14px",cursor:"pointer",fontFamily:FB,fontSize:12,fontWeight:"600",
              color:"#ffffff",textAlign:"center",
            }}>
              Restore from Backup
            </button>
            <input ref={restoreInputRef} type="file" accept=".json,application/json" style={{display:"none"}} onChange={handleRestorePick}/>
            {restoreError&&(
              <div style={{fontFamily:FB,fontSize:11,color:"#eb0000"}}>{restoreError}</div>
            )}
          </div>
        </div>

        {/* Restore confirmation modal */}
        {restoreConfirm&&(
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:200,
            display:"flex",alignItems:"center",justifyContent:"center",padding:"0 16px"}}>
            <div style={{background:"#fff",borderRadius:"1rem",padding:"24px",width:"100%",maxWidth:380,boxShadow:"0 8px 32px rgba(0,0,0,0.3)"}}>
              <div style={{fontFamily:FB,fontSize:15,fontWeight:"700",color:"#050505",marginBottom:10}}>Restore Backup?</div>
              <div style={{fontFamily:FB,fontSize:12,color:"rgba(5,5,5,0.6)",lineHeight:1.5,marginBottom:6}}>
                This will replace all current jobs, configurations and company settings with the contents of the backup file.
              </div>
              <div style={{fontFamily:FB,fontSize:11,color:"rgba(5,5,5,0.45)",lineHeight:1.5,marginBottom:20}}>
                Backup contains {restoreConfirm.jobs?.length||0} job{restoreConfirm.jobs?.length!==1?"s":""} and {restoreConfirm.configs?.length||0} configuration{restoreConfirm.configs?.length!==1?"s":""}, exported {restoreConfirm._exported ? new Date(restoreConfirm._exported).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}) : "unknown date"}.
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={()=>setRestoreConfirm(null)} style={{
                  flex:1,background:"#e5e5e5",border:"none",borderRadius:"0.3rem",
                  padding:"10px",cursor:"pointer",fontFamily:FB,fontSize:12,fontWeight:"600",color:"#050505",
                }}>Cancel</button>
                <button onClick={handleConfirmRestore} style={{
                  flex:1,background:"#eb0000",border:"none",borderRadius:"0.3rem",
                  padding:"10px",cursor:"pointer",fontFamily:FB,fontSize:12,fontWeight:"600",color:"#ffffff",
                }}>Restore</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function LoginScreen() {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setErr(""); setMsg(""); setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: "https://trackalign.vercel.app" } });
        if (error) throw error;
        setMsg("Account created. Check your email to confirm, then log in.");
      }
    } catch (e2) {
      setErr(e2.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword() {
    setErr(""); setMsg("");
    if (!email) { setErr("Enter your email above first"); return; }
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: "https://trackalign.vercel.app" });
      if (error) throw error;
      setMsg("Password reset email sent.");
    } catch (e2) {
      setErr(e2.message || "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = {
    background: "#111", border: "1px solid rgba(255,255,255,0.14)", borderRadius: "0.3rem",
    outline: "none", padding: "12px 14px", color: "#fff", fontFamily: FM, fontSize: 15,
    width: "100%",
  };

  return (
    <div style={{minHeight:"100dvh",background:T.bg,display:"flex",flexDirection:"column",
      alignItems:"center",justifyContent:"center",padding:"24px 20px"}}>
      <div style={{width:"100%",maxWidth:360}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{fontSize:22,fontWeight:700,fontFamily:FD,color:"#fff",letterSpacing:"0.02em"}}>
            Track<span style={{color:T.accent}}>Align</span>
          </div>
          <div style={{fontSize:12,fontFamily:FB,color:"rgba(255,255,255,0.4)",marginTop:6}}>
            {mode === "login" ? "Sign in to continue" : "Create your account"}
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            <label style={{fontSize:10,fontFamily:FB,textTransform:"uppercase",letterSpacing:"0.06em",color:"rgba(255,255,255,0.4)"}}>Email</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
              placeholder="you@workshop.com" required style={inputStyle}/>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            <label style={{fontSize:10,fontFamily:FB,textTransform:"uppercase",letterSpacing:"0.06em",color:"rgba(255,255,255,0.4)"}}>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
              placeholder="••••••••" required minLength={6} style={inputStyle}/>
          </div>

          {err && <div style={{fontSize:12,fontFamily:FB,color:T.accent}}>{err}</div>}
          {msg && <div style={{fontSize:12,fontFamily:FB,color:"#16a34a"}}>{msg}</div>}

          <button type="submit" disabled={busy} style={{
            marginTop:8,background:T.accent,border:"none",borderRadius:"0.3rem",
            padding:"12px",color:"#fff",fontFamily:FD,fontWeight:700,fontSize:14,
            cursor:busy?"default":"pointer",opacity:busy?0.6:1,
          }}>
            {busy ? "Please wait…" : mode === "login" ? "Login" : "Register"}
          </button>

          <button type="button" onClick={()=>{ setMode(mode==="login"?"register":"login"); setErr(""); setMsg(""); }}
            disabled={busy} style={{
            background:"none",border:"1px solid rgba(255,255,255,0.14)",borderRadius:"0.3rem",
            padding:"12px",color:"#fff",fontFamily:FD,fontWeight:600,fontSize:14,
            cursor:busy?"default":"pointer",
          }}>
            {mode === "login" ? "Register" : "Back to Login"}
          </button>

          {mode === "login" && (
            <button type="button" onClick={handleForgotPassword} disabled={busy} style={{
              background:"none",border:"none",color:"rgba(255,255,255,0.5)",
              fontFamily:FB,fontSize:12,cursor:"pointer",textAlign:"center",
              textDecoration:"underline",marginTop:4,
            }}>
              Forgot password?
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined=loading, null=signed out, object=signed in

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return <div style={{minHeight:"100dvh",background:T.bg}}/>;
  }
  if (!session) {
    return <LoginScreen/>;
  }

  return <AuthenticatedApp session={session}/>;
}

function AuthenticatedApp({ session }) {
  const userId = session?.user?.id;

  const [jobs,setJobs]=useState(()=>loadJobs(userId)||[]);
  const [configs,setConfigs]=useState(()=>loadConfigs(userId));
  const [company,setCompany]=useState(()=>loadCompany(userId));
  const [configScreen,setConfigScreen]=useState(null); // null|"library"|"editor"
  const [editingConfig,setEditingConfig]=useState(null);
  const [screen,setScreen]=useState(()=>hasOnboarded()?"dashboard":"onboarding");
  const [activeId,setActiveId]=useState(null);
  const [measureMode,setMeasureMode]=useState(()=>loadMode(userId));
  const [showAdjCalc,setShowAdjCalc]=useState(()=>loadAdjCalc(userId));
  const prefsPulled = useRef(false);

  useEffect(()=>{ saveJobs(jobs, userId); },[jobs, userId]);
  useEffect(()=>{ saveMode(measureMode, userId); },[measureMode, userId]);
  useEffect(()=>{ saveAdjCalc(showAdjCalc, userId); },[showAdjCalc, userId]);
  useEffect(()=>{
    if (!userId || !prefsPulled.current) return;
    upsertPrefsRemote({ measureMode, showAdjCalc }, userId);
  },[measureMode, showAdjCalc, userId]);
  useEffect(()=>{ saveConfigs(configs, userId); },[configs, userId]);
  useEffect(()=>{ saveCompany(company, userId); },[company, userId]);

  // Pull latest jobs/configs/company from Supabase and merge into localStorage
  // (remote wins if newer; locally-synced items removed elsewhere are dropped).
  // Used both on login and from the manual refresh button.
  const pullFromSupabase = useCallback(async () => {
    if (!userId || !navigator.onLine) return;
    const [jobsRes, configsRes, companyRes] = await Promise.all([
      supabase.from("jobs").select("*").eq("user_id", userId),
      supabase.from("configs").select("*").eq("user_id", userId),
      supabase.from("company_settings").select("*").eq("user_id", userId).maybeSingle(),
    ]);

    if (jobsRes.error) {
      console.error("Job sync pull failed:", jobsRes.error);
    } else if (jobsRes.data) {
      const remoteIds = new Set(jobsRes.data.map(r=>r.id));
      setJobs(prev => mergeByUpdatedAt(prev, jobsRes.data.map(jobFromRow))
        .filter(j => j.syncStatus!=="synced" || remoteIds.has(j.id)));
    }

    if (configsRes.error) {
      console.error("Config sync pull failed:", configsRes.error);
    } else if (configsRes.data) {
      const remoteIds = new Set(configsRes.data.map(r=>r.id));
      setConfigs(prev => mergeByUpdatedAt(prev, configsRes.data.map(configFromRow))
        .filter(c => c.syncStatus!=="synced" || remoteIds.has(c.id)));
    }

    if (companyRes.error) {
      console.error("Company sync pull failed:", companyRes.error);
    } else if (!companyRes.data) {
      await supabase.from("company_settings").insert({ user_id: userId, updated_at: new Date().toISOString() });
    } else {
      const remote = companyFromRow(companyRes.data);
      setCompany(prev => {
        const useRemote = !prev.updatedAt || new Date(remote.updatedAt) > new Date(prev.updatedAt);
        const merged = useRemote ? remote : prev;
        // Logo from Supabase always wins — never let stale localStorage overwrite it
        return { ...merged, logo: remote.logo || merged.logo };
      });
      // Sync user preferences stored alongside company settings
      if (companyRes.data.measure_mode != null) {
        setMeasureMode(companyRes.data.measure_mode);
        saveMode(companyRes.data.measure_mode, userId);
        // If onboarding is showing because localStorage was empty, skip it now
        setOnboarded();
        setScreen(prev => prev === "onboarding" ? "dashboard" : prev);
      }
      if (companyRes.data.show_adj_calc != null) {
        setShowAdjCalc(companyRes.data.show_adj_calc);
        saveAdjCalc(companyRes.data.show_adj_calc, userId);
      }
    }
    // Allow pref writes to Supabase only after the initial pull is done
    prefsPulled.current = true;
  }, [userId]);

  // On login: pull latest data from Supabase and merge into localStorage
  useEffect(()=>{
    let cancelled = false;
    (async () => { if (!cancelled) await pullFromSupabase(); })();
    return () => { cancelled = true; };
  }, [pullFromSupabase]);


  // Background write-through: push any locally-changed jobs to Supabase without blocking the UI
  useEffect(()=>{
    if (!userId || !navigator.onLine) return;
    const pending = jobs.filter(j=>j.syncStatus!=="synced");
    if (pending.length===0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(pending.map(job =>
        upsertJobRemote(job, userId).then(ok => ({ id: job.id, ok }))
      ));
      if (!cancelled) {
        const syncedIds = new Set(results.filter(r=>r.ok).map(r=>r.id));
        if (syncedIds.size > 0)
          setJobs(prev=>prev.map(j=>syncedIds.has(j.id)?{...j,syncStatus:"synced"}:j));
      }
    })();
    return () => { cancelled = true; };
  }, [jobs, userId]);

  useEffect(()=>{
    if (!userId || !navigator.onLine) return;
    const pending = configs.filter(c=>c.syncStatus!=="synced");
    if (pending.length===0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(pending.map(cfg =>
        upsertConfigRemote(cfg, userId).then(ok => ({ id: cfg.id, ok }))
      ));
      if (!cancelled) {
        const syncedIds = new Set(results.filter(r=>r.ok).map(r=>r.id));
        if (syncedIds.size > 0)
          setConfigs(prev=>prev.map(c=>syncedIds.has(c.id)?{...c,syncStatus:"synced"}:c));
      }
    })();
    return () => { cancelled = true; };
  }, [configs, userId]);

  useEffect(()=>{
    if (!userId || !navigator.onLine || company.syncStatus==="synced") return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const ok = await upsertCompanyRemote(company, userId);
      if (ok && !cancelled) setCompany(prev=>({...prev,syncStatus:"synced"}));
    }, 600);
    return () => { cancelled = true; clearTimeout(t); };
  }, [company, userId]);

  // Browser back/forward support: every navigation pushes a history entry
  // carrying a snapshot of {screen, configScreen, activeId}. On popstate
  // (fired for both back and forward) we restore the snapshot the browser
  // hands us instead of blindly replaying a single "go back" step, so
  // forward navigation actually re-applies the state we left.
  const isPoppingRef = useRef(false);
  const navInitRef = useRef(false);
  useEffect(()=>{
    const onPopState = (e) => {
      isPoppingRef.current = true;
      const s = e.state;
      if (s) {
        setScreen(s.screen);
        setConfigScreen(s.configScreen);
        setActiveId(s.activeId);
      } else {
        setScreen("dashboard"); setConfigScreen(null); setActiveId(null);
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(()=>{
    const snapshot = { screen, configScreen, activeId };
    if (!navInitRef.current) { navInitRef.current = true; window.history.replaceState(snapshot, ""); return; }
    if (isPoppingRef.current) { isPoppingRef.current = false; return; }
    window.history.pushState(snapshot, "");
  }, [screen, configScreen, activeId]);

  const goHome = useCallback(() => { setScreen("dashboard"); setConfigScreen(null); setActiveId(null); }, []);

  const openJob =id =>{ setActiveId(id); setScreen("job"); setOpenTab("before"); };
  const deleteJob = id => {
    setJobs(p => p.filter(j => j.id !== id));
    if (userId && navigator.onLine) supabase.from("jobs").delete().eq("id", id).eq("user_id", userId).then(()=>{}, ()=>{});
  };

  const [pendingSetJ, setPendingSetJ] = useState(null);
  const [pendingJ, setPendingJ] = useState(null); // unsaved job snapshot when opening library from within a job
  const [configSource, setConfigSource] = useState("footer"); // "footer" | "job"
  function openConfigLibrary(setJFn, currentJ) { setPendingSetJ(()=>setJFn); setPendingJ(currentJ||null); setConfigSource("job"); setConfigScreen("library"); }
  function newConfig() { setEditingConfig(makeConfig()); setConfigScreen("editor"); }
  function editConfig(c) { setEditingConfig(c); setConfigScreen("editor"); }
  function saveConfig(c) {
    const stamped = {...c, updatedAt:new Date().toISOString(), syncStatus:"local"};
    setConfigs(p => p.find(x=>x.id===stamped.id) ? p.map(x=>x.id===stamped.id?stamped:x) : [stamped,...p]);
    setConfigScreen("library");
  }
  function deleteConfig(id) {
    setConfigs(p=>p.filter(c=>c.id!==id));
    deleteConfigRemote(id, userId);
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
    const stamp = { updatedAt:new Date().toISOString(), syncStatus:"local" };
    if (localApply) {
      localApply(p=>({...p, axles:newAxles, configId:c.id, configName:c.name, afterAxles:null, ...stamp}));
      // Also persist to jobs store
      setJobs(prev=>prev.map(j=>j.id===jobId
        ? {...j, axles:newAxles, configId:c.id, configName:c.name, afterAxles:null, ...stamp}
        : j));
    } else {
      setJobs(prev=>prev.map(j=>j.id===jobId
        ? {...j, axles:newAxles, configId:c.id, configName:c.name, afterAxles:null, ...stamp}
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
    const j={...makeJob(measureMode), fullDistance:""};
    setJobs(p=>[j,...p]); setActiveId(j.id); setScreen("job"); setOpenTab("job"); setForceTab(null);
  };
  const saveJob =j   =>{ setJobs(p=>p.map(x=>x.id===j.id?{...j,createdAt:x.createdAt||j.createdAt,syncStatus:"local",updatedAt:new Date().toISOString()}:x)); };

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
        body{background:${T.bg};color:${T.text};font-family:${FB};-webkit-font-smoothing:antialiased;font-weight:500;min-height:100dvh}
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:${T.surface}}
        ::-webkit-scrollbar-thumb{background:${T.borderHi};border-radius:0.3rem}
        input,textarea,button{font-family:inherit}
        input,textarea,select{font-size:16px!important}
        textarea{color:${T.text}}
        @keyframes trkSpin{to{transform:rotate(360deg)}}
        .trk-dash-scroll{padding-bottom:70px}
        @media(display-mode:standalone){.trk-dash-scroll{padding-bottom:calc(70px + env(safe-area-inset-bottom))}}
      `}</style>
      <div style={{maxWidth:520,margin:"0 auto",minHeight:"100dvh",background:T.bg,
        display:"flex",flexDirection:"column"}}>
        {screen==="onboarding"&&<OnboardingScreen onSelect={handleOnboardSelect}/>}
        {screen!=="onboarding"&&(
          <>
            <div className={screen==="dashboard"&&!configScreen?"trk-dash-scroll":""} style={{flex:1,...(screen==="dashboard"&&!configScreen?{paddingTop:"calc(env(safe-area-inset-top) + 18px)",paddingLeft:"16px",paddingRight:"16px"}:{padding:"0"})}}>
              {screen==="settings"&&!configScreen&&<SettingsScreen measureMode={measureMode}
                setMeasureMode={setMeasureMode} onBack={goHome}
                company={company} setCompany={setCompany} userId={userId}
                showAdjCalc={showAdjCalc} setShowAdjCalc={setShowAdjCalc}/>}
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
                  const stamp = {updatedAt:new Date().toISOString(), syncStatus:"local"};
                  if (configSource==="job" && activeId) {
                    // Apply config to current job — preserve all unsaved job details
                    setJobs(prev=>prev.map(j=>j.id===activeId
                      ? {...(pendingJ||j), axles:newAxles, configId:c.id, configName:c.name, afterAxles:null, ...stamp}
                      : j));
                    setPendingJ(null);
                    setConfigScreen(null);
                    setScreen("job");
                    setOpenTab("before");
                    setForceTab("before");
                    setTimeout(()=>setForceTab(null), 100);
                  } else {
                    // Create new job from config — open at Job Details tab
                    const j = {...makeJob(measureMode), axles:newAxles, configId:c.id, configName:c.name};
                    setJobs(p=>[j,...p]);
                    setActiveId(j.id);
                    setScreen("job");
                    setOpenTab("job");
                    setForceTab(null);
                    setConfigScreen(null);
                  }
                }}
                onNew={newConfig}
                onEdit={editConfig}
                onBack={goHome}/>}
              {configScreen==="editor"&&editingConfig&&<ConfigEditorScreen
                config={editingConfig}
                onSave={saveConfig}
                onDelete={deleteConfig}
                onBack={goHome}/>}
              {(screen==="dashboard"||screen==="job")&&!configScreen&&(
                <>
                  {screen==="dashboard"&&<Dashboard jobs={sortNewestFirst(jobs)} onNew={newJob} onOpen={openJob} onDelete={deleteJob}
                    pendingCount={jobs.filter(j=>j.syncStatus!=="synced").length+configs.filter(c=>c.syncStatus!=="synced").length+(company.syncStatus!=="synced"?1:0)}
                    onRefresh={pullFromSupabase}/>}
                  {screen==="job"&&activeJob&&
                    <JobEditor job={activeJob} allJobs={jobs} onSave={saveJob}
                      onBack={goHome} initialTab={openTab}
                      onOpenConfigs={openConfigLibrary} forceTab={forceTab}
                      company={company} showAdjCalc={showAdjCalc}/>}
                </>
              )}
            </div>
            {/* Footer */}
            <div style={{
              background:"#050505",borderTop:"1px solid rgba(255,255,255,0.08)",
              padding:"16px 20px calc(16px + env(safe-area-inset-bottom))",display:"flex",justifyContent:"space-between",alignItems:"center",
              position:"sticky",bottom:0,zIndex:10,
            }}>
              <button onClick={()=>{ setConfigSource("footer"); setConfigScreen("library"); }} style={{
                background:"none",border:"none",cursor:"pointer",
                display:"flex",alignItems:"center",gap:6,
                color:"#ffffff",fontFamily:FB,fontSize:12,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                  <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                </svg>
                Configurations
              </button>
              <button onClick={()=>{ setConfigScreen(null); setScreen("settings"); }} style={{
                background:"none",border:"none",cursor:"pointer",
                display:"flex",alignItems:"center",gap:6,
                color:"#ffffff",fontFamily:FB,fontSize:12,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                </svg>
                Settings
              </button>
              <button onClick={()=>supabase.auth.signOut({scope:"local"}).catch(e=>console.error("Sign out failed:",e))} style={{
                background:"none",border:"none",cursor:"pointer",
                display:"flex",alignItems:"center",gap:6,
                color:"#eb0000",fontFamily:FB,fontSize:12,
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16 17 21 12 16 7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                Sign Out
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
