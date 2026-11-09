# What's new in GeoChem

Newest version first. GeoChem shows the entries newer than your copy when an
update is available (Settings > Updates).

## 1.2.0 - 2026-11-10

Drillhole sections, axis limits, re-assays, and a version menu.

### New
- Version menu in the top bar: shows the installed version (also in the
  window title). Click it to check for updates, read what's new or open the
  releases page. "Check for Updates" and "What's New" are in the File menu
  and the command finder (Ctrl+K) too.
- Section plot (New plot > Section): drillhole cross-section at any bearing.
  Samples within a slab either side of the line, distance along the section
  against elevation, true scale or with vertical exaggeration. "Fit to data"
  places the line along the holes, "+90°" turns it. Hole traces and a small
  plan view show where the section is. Colours, shapes and filters come
  from the Attribute Manager; selection is linked with other plots.
- Axis limits for scatter plots (ruler button): fixed minimum / maximum for
  X and each Y chart, saved with the plot and the project. Leave a box empty
  to autoscale that end, or fill them from the current zoom. Each chart
  title counts the points beyond the limits.
- Re-assays (Data view button): finds over-limit (ore-grade) re-assay rows.
  Warns about samples that exist only as a re-assay row - their other
  elements are missing from the export - and lists them by hole. Merges the
  re-assay grades into the base rows where the base value is capped at the
  upper limit or missing (can be undone).
- Classify only some rows: when assigning a class to a selection, or a
  classification diagram's fields into an existing column, you can limit it
  to rows currently in chosen classes (e.g. only overwrite "Unclassified").
- Status bar shows "Showing N of M rows" whenever rows are hidden, with what
  is hiding them and a "Show all rows" button.
- Add PC scores: a second PCA can add its scores with a prefix instead of
  overwriting the first PCA's columns, or replace them cleanly.

### Fixed
- Scatter grids with many charts no longer lose their first charts.
- Spider plots: an element missing from the chosen standard is left as a
  gap (listed under the plot) instead of being plotted un-normalised.
- Class colours stay the same when a new class appears.
- PCA explains why Run is disabled, warns when there are fewer samples than
  variables, and refuses to run on an empty set of rows. Results say
  whether visible rows or all rows were used.
- Checking for updates now says so when it cannot reach the GeoChem server
  or GitHub, instead of showing nothing.

## 1.1.0 - 2026-11-06

Tools for datasets built from many surveys, labs and sample media.

### New
- Combine surveys (Data view button): three tools for putting surveys,
  lab methods and sample media together.
  - Overlap check: where two surveys or batches sampled the same ground,
    compares their values and says whether they agree, are offset (and by
    how much) or share too little ground to tell. Groups that agree can be
    pooled.
  - Levelling: scores every value within its own group (0-100), so the top
    results of every survey map on one scale. Groups too small or mostly
    below detection are left blank, with the reason. "Map it" and "Add to
    report" included.
  - Common detection limit: puts chosen groups on one detection limit, so
    a fixed threshold means the same thing everywhere. Shows each group's
    limit, including limits that are only visible as a repeated lowest
    value.
- Assay protocols can be split within each sample medium (soil, stream,
  rock chip...), so different media never share a group.
- New workflow: "Combining surveys, labs and sample media", step by step.

## 1.0.0 - 2026-11-06

First numbered release. From now on GeoChem tells you when a newer version is
ready, shows what changed, and can update itself.

### New
- Update notices: GeoChem checks once at start-up for a newer version and
  shows an "Update available" button with the release notes. Turn the check
  off in Settings > Updates.
- One-click update: "Update now" closes GeoChem, downloads the new version,
  installs any new dependencies and reopens it. You can also double-click
  `update-geochem.bat`.
- Assay protocols: groups samples by element suite and detection limits, and
  shows how the data was split.
- Half-detection-limit detector: finds below-detection values that were
  supplied as half the detection limit, per lab batch.
- PCA to multi-element indices: build additive indices from ranked eigenvector
  picks.
- Data view filters for numbers, categories, text and dates, with selection
  actions.

### Fixed
- 2D maps keep a stable pan and zoom without a basemap.
