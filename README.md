# GeoChem

Exploration geochemistry analysis on your own machine: load assay and drillhole
data, clean it, classify it, and explore it with linked plots, maps and
multivariate statistics.

## Features

**Data**
- Import CSV, Excel (with sheet choice) and `.gas` workspaces; drillhole
  collar / survey / assay files with desurveying.
- Automatic recognition of element and oxide columns and units (ppm, ppb, %,
  wt% oxide), with conversion to ppm where needed.
- Below-detection values (`<0.01`) stored as negative detection limits and
  substituted by a chosen factor for analysis.
- Data Doctor for text codes, zeros and units; column manager; calculated
  columns with a formula editor; logging-interval merge.

**Plots** (all linked: selections and colour/shape/size attributes are shared)
- Scatter, scatter matrix, ternary, Piper, spider/normalised, histogram, box,
  probability, CLR and downhole plots.
- Attribute, contour, pathfinder maps and a 3D viewer.
- Library of about 260 classification diagrams (TAS, discrimination, alteration
  and mineral chemistry), plus a diagram editor for your own.

**Analysis**
- Summary and group statistics, correlation matrix, outlier detection and
  robust regression.
- Log-ratio transforms (CLR / ALR / ILR), PCA with a full report, factor
  analysis and clustering.
- Population separation, anomaly ranking, rule-based classification and
  deposit vectoring.
- QA/QC: standards (control charts, Westgard rules), blanks and duplicates.

**Workflows and output**
- Step-by-step recipes for common deposit styles (porphyry, epithermal,
  orogenic Au, komatiite Ni, Ni-Cu-PGE intrusions, LCT pegmatites, intrusion
  fertility, lithology from assays).
- Projects saved as `.chem` files, plot and layout templates, undo/redo, and
  report / figure export.

## Requirements

- Windows 10/11
- Python 3.10+
- Node.js 18+
- Chrome or Edge (the app opens in its own window)

## Quick start

**Double-click `start-geochem.bat`.**

On first run it creates the Python environment and installs dependencies. On
every run it clears stuck ports, starts the backend and frontend, and opens
GeoChem once both are ready. Closing the app window stops it.

`start-geochem.bat -Browser` opens a normal browser tab instead (close the
minimised "GeoChem servers" window to stop).

### Desktop shortcut

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-desktop-shortcut.ps1
```

Adds Desktop and Start-menu shortcuts (`-NoStartMenu` for Desktop only,
`-Uninstall` to remove).

## Updates

Your version is shown in **Settings > Updates**. When GeoChem starts, it checks
GitHub for a newer version. If one is out, an **Update available** button
appears at the top right. Click it to see what changed since your version.

- **Update now** (in that window) closes GeoChem, installs the new version and
  any new dependencies, then reopens it. Save your project first.
- Or close GeoChem and double-click **`update-geochem.bat`**.

Both work for a `git clone` and for a downloaded zip. If you cloned with git,
don't use `git pull`. Each release replaces the repository history, so a pull
fails; the updater handles this for you. Any GeoChem files you edited yourself
are kept in `git stash` before the update. Your data files and projects are
never touched.

The full list of changes is in [CHANGELOG.md](CHANGELOG.md) and on the
[Releases](https://github.com/LinearGeoscience/geochem/releases) page. On
GitHub, choose **Watch > Custom > Releases** to get an email for each new
version. To turn off the start-up check, use Settings > Updates. The check
downloads only the published version number and release notes.

## Manual setup

```bash
npm install
npm run setup   # first time only: Python venv + pip + frontend packages
npm run dev     # backend on :8000, frontend on :5173
```

Then open http://localhost:5173.

## Layout

| Folder | Contents |
|---|---|
| `frontend/` | React + TypeScript + MUI + Plotly user interface |
| `backend/` | FastAPI + pandas API (file parsing, drillholes, projects) |
| `scripts/` | Launcher, updater and shortcut installer |

## Notes

- Single local user: the backend holds one dataset in memory and accepts
  requests from this machine only. Nothing is uploaded anywhere. The only
  outside request is the update check (which can be turned off).
- Your data files are never part of this repository.
