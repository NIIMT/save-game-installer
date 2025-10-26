// SGI Save Game Installer — v0.2 (multi-game, minimal change)
// Framework unchanged from working build:
// - Data-first (recurse inside Data only). If no Data/, treat mod root as Data:
//     * pick up root-level saves
//     * recurse into immediate subfolders whose name contains "save"
// - Move saves into the correct Documents\My Games\...\Saves
// - Triggers: startup, did-install-mod, deploy
// - Run-log to Documents\SGI_Diag\SGI_SaveMover_RunLog.txt when DEBUG = true
//
// Minimal additions:
// - Added support for oblivion, morrowind, fallout3, falloutnv, fallout4, starfield
// - Save extensions + co-saves per game (Skyrim: .ess + .skse; Fallout: .fos + extender co-saves; etc.)

const path = require('path');
const { util } = require('vortex-api');
const fs = require('fs');
const fsp = fs.promises;

const MOVE_INSTEAD_OF_COPY = true; // cut by default
const DEBUG = false;               // set true only when diagnosing

// ---- Supported games (Vortex gameIds) + save formats + target dirs ----------
const GAMES = {
  // The Elder Scrolls
  skyrim:    { label: 'Skyrim (LE)', exts: ['.ess'], cosaves: ['.skse'],
               savesDir: docs => path.join(docs, 'My Games', 'Skyrim', 'Saves') },
  skyrimse:  { label: 'Skyrim Special Edition/AE', exts: ['.ess'], cosaves: ['.skse'],
               savesDir: docs => path.join(docs, 'My Games', 'Skyrim Special Edition', 'Saves') },
  oblivion:  { label: 'Oblivion', exts: ['.ess'], cosaves: ['.obse'],
               savesDir: docs => path.join(docs, 'My Games', 'Oblivion', 'Saves') },
  morrowind: { label: 'Morrowind', exts: ['.ess'], cosaves: [],
               savesDir: docs => path.join(docs, 'My Games', 'Morrowind', 'Saves') },

  // Fallout
  fallout3:  { label: 'Fallout 3', exts: ['.fos'], cosaves: ['.fose'],
               savesDir: docs => path.join(docs, 'My Games', 'Fallout3', 'Saves') },
  falloutnv: { label: 'Fallout: New Vegas', exts: ['.fos'], cosaves: ['.nvse'],
               savesDir: docs => path.join(docs, 'My Games', 'FalloutNV', 'Saves') },
  fallout4:  { label: 'Fallout 4', exts: ['.fos'], cosaves: ['.f4se'],
               savesDir: docs => path.join(docs, 'My Games', 'Fallout4', 'Saves') },

  // Starfield (Steam/My Games layout)
  starfield: { label: 'Starfield', exts: ['.sfs'], cosaves: [],
               savesDir: docs => path.join(docs, 'My Games', 'Starfield', 'Saves') },
};
const GAME_IDS = Object.keys(GAMES);

// ---- toasts & run-log --------------------------------------------------------
function notify(api, type, msg, ms = 6000) { try { api.sendNotification({ type, message: `[SGI] ${msg}`, displayMS: ms }); } catch {} }
function logToast(api, msg) { if (DEBUG) notify(api, 'info', msg, 4500); }
async function logLines(lines) {
  if (!DEBUG) return null;
  try {
    const docs = (util.getVortexPath && util.getVortexPath('documents')) || process.env.USERPROFILE || 'C:\\';
    const outDir = path.join(docs, 'SGI_Diag');
    const outFile = path.join(outDir, 'SGI_SaveMover_RunLog.txt');
    await fsp.mkdir(outDir, { recursive: true });
    await fsp.appendFile(outFile, `[${new Date().toISOString()}] ${lines.join('\n')}\n\n`, 'utf8');
    return outFile;
  } catch { return null; }
}

// ---- fs helpers (Node-only) --------------------------------------------------
async function exists(p) { try { await fsp.stat(p); return true; } catch { return false; } }
async function ensureDir(p) { await fsp.mkdir(p, { recursive: true }); }
async function readdirDirents(p) { try { return await fsp.readdir(p, { withFileTypes: true }); } catch { return []; } }
async function readdirNames(p) { try { return await fsp.readdir(p); } catch { return []; } }
async function copyFile(src, dst) {
  await ensureDir(path.dirname(dst));
  try { await fsp.copyFile(src, dst); }
  catch { const buf = await fsp.readFile(src); await fsp.writeFile(dst, buf); }
}
async function removeFile(p) { try { await fsp.unlink(p); } catch {} }

// ---- paths -------------------------------------------------------------------
function appDataCandidates() {
  const out = [];
  try { const a = util.getVortexPath('appData'); if (a) out.push(a); } catch {}
  if (process.env.APPDATA) out.push(path.join(process.env.APPDATA, 'Vortex'));
  return Array.from(new Set(out.map(p => path.normalize(p))));
}
function stagingCandidates(gid) {
  const bases = appDataCandidates();
  const cand = [];
  for (const b of bases) cand.push(path.join(b, gid, 'mods'));
  try { const active = util.getVortexPath('install'); if (active) cand.push(path.normalize(active)); } catch {}
  return Array.from(new Set(cand));
}
function savesDirFor(gid) {
  const game = GAMES[gid];
  if (!game) return null;
  const docs = (function(){ try { return util.getVortexPath('documents'); } catch {} return process.env.USERPROFILE || 'C:\\'; })();
  return game.savesDir(docs);
}

// ---- save detection (per game) ----------------------------------------------
function isSaveForGame(gid, name) {
  const g = GAMES[gid]; if (!g) return false;
  const low = name.toLowerCase();
  return g.exts.some(ext => low.endsWith(ext));
}
async function addCoSavesForGame(gid, files) {
  const g = GAMES[gid]; if (!g || !g.cosaves || g.cosaves.length === 0) return files;
  const out = files.slice();
  for (const abs of files) {
    const stem = abs.replace(/\.[^.]+$/, '');
    for (const ext of g.cosaves) {
      const co = `${stem}${ext}`;
      if (await exists(co)) out.push(co);
    }
  }
  return out;
}

// ---- recursive scan under Data (same framework) ------------------------------
async function listSavesRecursive(gid, dir) {
  const found = [];
  const dirents = await readdirDirents(dir);
  for (const de of dirents) {
    const full = path.join(dir, de.name);
    if (de.isDirectory()) {
      found.push(...await listSavesRecursive(gid, full));
    } else if (de.isFile() && isSaveForGame(gid, de.name)) {
      found.push(full);
    }
  }
  return found;
}

// Main gatherer (unchanged logic, generalized by gid)
async function gatherSaveFiles(gid, modRoot, report) {
  const d1 = path.join(modRoot, 'Data');
  const d2 = path.join(modRoot, 'data');

  if (await exists(d1) || await exists(d2)) {
    const dataRoot = (await exists(d1)) ? d1 : d2;
    if (DEBUG) report.push(`  - Data root: ${dataRoot}`);
    const ess = await listSavesRecursive(gid, dataRoot);
    const all = await addCoSavesForGame(gid, ess);
    if (DEBUG) report.push(`    (Data scan) saves: ${all.length}`);
    return all;
  }

  // No Data/: treat mod root as virtual Data (same as your working build)
  if (DEBUG) report.push(`  - No Data folder in "${modRoot}" → treating mod root as Data`);
  const files = [];

  // root-level saves (non-recursive)
  const names = await readdirNames(modRoot);
  for (const n of names) {
    if (isSaveForGame(gid, n)) files.push(path.join(modRoot, n));
  }

  // immediate subfolders whose name contains "save" (recursive)
  const dirents = await readdirDirents(modRoot);
  for (const de of dirents) {
    if (!de.isDirectory()) continue;
    const lbl = de.name.toLowerCase();
    if (lbl.includes('save')) {
      const sub = path.join(modRoot, de.name);
      if (DEBUG) report.push(`    - Save-like subdir: ${sub}`);
      files.push(...await listSavesRecursive(gid, sub));
    }
  }

  const all = await addCoSavesForGame(gid, files);
  if (DEBUG) report.push(`    (Root/Save-subdir scan) saves: ${all.length}`);
  return all;
}

// ---- mover (unchanged) -------------------------------------------------------
async function moveOrCopy(src, dst, cut) { await copyFile(src, dst); if (cut) await removeFile(src); }

// ---- per-mod / per-game (unchanged shape) -----------------------------------
async function processModFolder(api, gid, modRoot, report) {
  report.push(`Scanning mod: ${modRoot}`);
  const files = await gatherSaveFiles(gid, modRoot, report);
  report.push(`  -> Found ${files.length} candidate file(s)`);
  if (files.length === 0) return 0;

  const dstRoot = savesDirFor(gid);
  if (!dstRoot) { report.push(`  !! No savesDir for gid=${gid}`); return 0; }
  try { await ensureDir(dstRoot); } catch { notify(api, 'error', `Cannot access Saves for ${GAMES[gid]?.label || gid}`); return 0; }

  let moved = 0;
  for (const src of files) {
    const dst = path.join(dstRoot, path.basename(src));
    try { await moveOrCopy(src, dst, MOVE_INSTEAD_OF_COPY); moved++; report.push(`  MOVE "${src}" -> "${dst}"`); }
    catch (e) { report.push(`  !! Failed ${path.basename(src)}: ${String(e && e.message ? e.message : e)}`); }
  }
  if (moved > 0) notify(api, 'success', `Moved ${moved} save file(s) from ${path.basename(modRoot)} → ${GAMES[gid]?.label || gid} Saves`);
  return moved;
}

async function sweepGame(api, gid, reason) {
  const report = DEBUG ? [`==== Sweep gid=${gid} [${reason}] ====`, `Candidates base(s):`] : [];
  const stages = stagingCandidates(gid);
  if (DEBUG) for (const s of stages) report.push(`  * ${s}`);

  let total = 0;
  for (const stage of stages) {
    if (!(await exists(stage))) { if (DEBUG) report.push(`  - Missing stage: ${stage}`); continue; }
    const dirents = await readdirDirents(stage);
    if (DEBUG) report.push(` Stage ${stage} → ${dirents.length} entries`);
    for (const de of dirents) {
      if (!de.isDirectory()) continue;
      const modRoot = path.join(stage, de.name);
      total += await processModFolder(api, gid, modRoot, report);
    }
  }
  if (DEBUG) { report.push(`Total moved (gid=${gid}): ${total}`); await logLines(report); }
  if (total === 0 && DEBUG) logToast(api, `Scan[${gid}]: no saves detected (Data or root)`);
  return total;
}

// Try to use explicit path from install event (unchanged)
async function handleInstallEvent(api, gid, _archiveId, _modId, fullInfo) {
  if (!GAMES[gid]) return; // ignore other games
  const report = DEBUG ? [`==== did-install-mod gid=${gid} ====`,] : [];
  let modRoot = null;
  try {
    const p = fullInfo && (fullInfo.installationPath || fullInfo.installPath);
    if (p && typeof p === 'string') modRoot = p;
  } catch {}
  if (modRoot && !(await exists(modRoot))) modRoot = null;

  if (modRoot) {
    if (DEBUG) report.push(`Using fullInfo path: ${modRoot}`);
    const moved = await processModFolder(api, gid, modRoot, report);
    if (DEBUG) { report.push(`Moved via fullInfo path: ${moved}`); await logLines(report); }
    if (moved === 0) {
      await new Promise(r => setTimeout(r, 1200));
      const moved2 = await processModFolder(api, gid, modRoot, report);
      if (DEBUG) { report.push(`Retry moved: ${moved2}`); await logLines(report); }
    }
    return;
  }

  if (DEBUG) { report.push(`No fullInfo path; fallback sweep ${gid}`); await logLines(report); }
  await sweepGame(api, gid, 'install-fallback');
}

// ---- entry (unchanged shape) -------------------------------------------------
function init(context) {
  try {
    context.once(() => {
      const api = context.api;

      // Startup sweep: all supported games
      setTimeout(() => {
        (async () => { for (const gid of GAME_IDS) await sweepGame(api, gid, 'startup'); })()
          .catch(err => logLines([`!! Startup error: ${String(err && err.message ? err.message : err)}`]));
      }, 300);

      // Install-time (only if gid is one of ours)
      api.events.on('did-install-mod', (gid, a, m, info) => {
        if (!GAMES[gid]) return;
        handleInstallEvent(api, gid, a, m, info)
          .catch(err => logLines([`!! Install handler error: ${String(err && err.message ? err.message : err)}`]));
      });

      // Deploy: sweep all supported games
      api.onAsync('did-deploy', async () => {
        for (const gid of GAME_IDS) {
          try { await sweepGame(api, gid, 'deploy'); }
          catch (err) { await logLines([`!! Deploy sweep error: ${String(err && err.message ? err.message : err)}`]); }
        }
      });

      if (DEBUG) notify(api, 'info', `SGI v2.10 loaded (${GAME_IDS.length} games)`);
    });
  } catch (err) {
    try { logLines([`!! Extension init error: ${String(err && err.message ? err.message : err)}`]); } catch {}
    throw err;
  }
  return true;
}

exports.default = init;
