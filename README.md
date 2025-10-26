# Save Game Installer
**Version:** 0.2 • **Scope:** Multi-game support, minimal change to framework

## What this does
Automatically finds save files inside installed mods and moves (or copies) them into the correct **Documents\My Games\<Game>\Saves** folder for the current game. It runs at startup, after installing a mod, and after deployment. Co-saves (SKSE/NVSE/etc.) are handled with the primary save.

- Data-first scan (recursively scans `Data/` if present; otherwise treats the mod root as Data).
- Root-level saves are picked up.
- Recurses into **immediate subfolders whose name contains “save”**.
- Moves by default (configurable).

## Supported games (gids) & save formats

| gid          | Label                               | Saves           | Co-saves             | Target directory (under Documents)                                  |
|--------------|--------------------------------------|-----------------|----------------------|-----------------------------------------------------------------------|
| `skyrim`     | Skyrim (LE)                          | `.ess`          | `.skse`              | `My Games\Skyrim\Saves`                                               |
| `skyrimse`   | Skyrim Special Edition / AE          | `.ess`          | `.skse`              | `My Games\Skyrim Special Edition\Saves`                               |
| `oblivion`   | Oblivion                             | `.ess`          | `.obse`              | `My Games\Oblivion\Saves`                                             |
| `morrowind`  | Morrowind                            | `.ess`          | —                    | `My Games\Morrowind\Saves`                                            |
| `fallout3`   | Fallout 3                            | `.fos`          | `.fose`              | `My Games\Fallout3\Saves`                                             |
| `falloutnv`  | Fallout: New Vegas                   | `.fos`          | `.nvse`              | `My Games\FalloutNV\Saves`                                            |
| `fallout4`   | Fallout 4                            | `.fos`          | `.f4se`              | `My Games\Fallout4\Saves`                                             |
| `starfield`  | Starfield                            | `.sfs`          | —                    | `My Games\Starfield\Saves`                                            |

> **Note:** New remasters/editions can be added by extending the `GAMES` map (see “Add a new game” below).

## Requirements
- Vortex (Windows).
- Node runtime bundled with Vortex (no external Node install needed).
- File system access to `%USERPROFILE%\Documents\My Games\...` and `%APPDATA%\Vortex\...`.

## Installation
1. Place `index.js` (this extension) into your Vortex extension folder or install via your usual Vortex extension method.
2. Start Vortex (or restart).
3. SGI starts automatically; no user action required.

## Configuration
Edit the constants near the top of `index.js`:

```js
const MOVE_INSTEAD_OF_COPY = true; // true = move (cut) source files; false = copy only
const DEBUG = false;               // true = verbose run-log + diagnostic toasts
```

### Diagnostics
When `DEBUG = true`, SGI writes logs to:
```
%USERPROFILE%\Documents\SGI_Diag\SGI_SaveMover_RunLog.txt
```

## How it works (behavior summary)
1. **Triggers**
   - On startup (delayed ~300ms)
   - On `did-install-mod` (for the mod’s gid)
   - On `did-deploy` (sweeps all supported gids)

2. **Staging locations scanned**
   - `%APPDATA%\Vortex\<gid>\mods`
   - Active install path from `util.getVortexPath('install')` (if present)

3. **Detection rules**
   - If `Data/` exists in a mod → recursively scan it.
   - Else, treat mod root as a virtual `Data/`.
     - Pick up **root-level** saves.
     - Recurse into **immediate** subfolders whose name contains **“save”**.
   - For each found save, attempt to attach co-saves by matching the stem and appending the co-save extension(s).

4. **Action**
   - Ensures the destination **Saves** directory exists.
   - **Move** or **copy** files depending on `MOVE_INSTEAD_OF_COPY`.

5. **User feedback**
   - Success toast per mod when files are moved.
   - Optional debug toasts + run-log when `DEBUG = true`.

## Add a new game (e.g., Oblivion Remastered)
When Vortex exposes the new game’s **gid**, directory, and extensions, add one entry to `GAMES`:

```js
GAMES.oblivionremastered = {
  label: 'Oblivion Remastered',
  exts: ['.ess'],          // adjust if different
  cosaves: ['.obse'],      // [] if no co-saves
  savesDir: (docs) => path.join(docs, 'My Games', 'Oblivion Remastered', 'Saves'),
};
```

**How to find the gid quickly**
- Switch game mode in Vortex and read `api.getState().settings.gameMode.current` (temporary probe):
  ```js
  try {
    const cur = context.api.getState().settings.gameMode.current;
    context.api.sendNotification({ type: 'info', message: `[SGI] current gid: ${cur}`, displayMS: 4000 });
  } catch {}
  ```
- Or install any small mod for the target game; SGI’s `did-install-mod` handler receives `(gid, ...)`—log it when `DEBUG = true`.

## Testing checklist
- **Startup sweep:** Launch Vortex with `DEBUG = true`; confirm run-log entries for each supported gid.
- **Install path:** Install a mod that includes saves. Expect a success toast:  
  “Moved N save file(s) from <mod> → <Game> Saves”.
- **Deploy sweep:** Press **Deploy**; run-log should show a sweep per gid.
- **Co-saves:** Include a matching `.skse`/`.nvse`/etc. next to a save and confirm it’s moved with the main file.

## Troubleshooting
- **No saves moved**
  - Mod may not contain a `Data/` tree or root-level save files.
  - Save files must have the correct extension for the current gid (see table above).
- **Wrong destination**
  - Verify your Windows “Documents” path and the `My Games\<Game>\Saves` folder exists/was created.
- **Nothing happens on install**
  - Ensure the game is one of the supported gids and that the Vortex install event included a valid `installationPath`.
- **Keep originals in the mod**
  - Set `MOVE_INSTEAD_OF_COPY = false`.

## Security & safety
- SGI only reads/writes under `%APPDATA%\Vortex\...` and `%USERPROFILE%\Documents\My Games\...`.
- It does not execute any files from mods, only moves/copies saves.

## Changelog
**2.10**
- Added support for: Oblivion, Morrowind, Fallout 3, Fallout: New Vegas, Fallout 4, Starfield.
- Co-save handling per game (.skse/.obse/.fose/.nvse/.f4se).
- Unified sweeps for startup/install/deploy.
- Optional diagnostics to `%USERPROFILE%\Documents\SGI_Diag`.

## Credits
SGI – Save Game Installer (Vortex extension).  
Extra game support by extending the single `GAMES` map and reusing the existing scan/move framework.
