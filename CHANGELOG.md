# What's new in GeoChem

Newest version first. GeoChem shows the entries newer than your copy when an
update is available (Settings > Updates).

## 1.3.0 - 2026-11-18

Surfaces, bodies and grade shells in the 3D view, steered by orientation
readings.

### New
- Surfaces in the 3D view (Surfaces panel). Build a surface through the
  selected samples or by clicking on drillholes; drag or remove its points.
  Lines drawn on slices make it bend and fold, dip readings tell it which
  way it lies, and an outline drawn in the view keeps it inside an area.
  Points, lines and readings can also come from CSV or DXF files.
- Surfaces from logging: a surface where one group of logged units gives
  way to another, and closed bodies round logged units, with their volume.
  A ground surface can be made from the hole collars; holes collared far
  below their neighbours (drilled from underground) are left out and named.
- Shells round the high values of a column, with their volume. Pick the
  cut-off by value or as a share of the samples ("Top 1%"). Three ways to
  find the shell:
  - from the values themselves;
  - by counting the samples at or above the cut-off round each place (the
    usual choice where single assays are erratic, as with gold);
  - round the intercepts down each hole (runs that average the cut-off over
    a least length, with a set length of lower values allowed inside).
  Samples can be averaged down the hole and top cut first. Each shell says
  how many of the high samples are inside it and how much of what it holds
  is below the cut-off. "Check it against holes left out" refits without
  some of the holes and reports how many of their high samples it found.
- Structure (in the Surfaces panel): the way the ground runs.
  - One direction for the whole model, typed in or drawn on a slice.
  - Orientation readings, planes (dip / dip direction or strike) and lines
    (plunge / trend), shared by every surface: from columns in the data,
    set by hand in the 3D view, or suggested from a surface, a wireframe or
    the high samples of a shell. Suggested readings are drawn in grey and
    change nothing until you keep them.
  - Between readings the direction changes smoothly from place to place.
    Surfaces and shells follow it, round folds. Change a reading and every
    surface that follows it is fitted again.
- "How it works" (Surfaces panel): an eleven-page guide to how surfaces
  are fitted and what they cannot know, with pictures you can change.
- Surfaces are saved with the project, can be undone, and are drawn where
  the Section plot and the map cut them. A surface can write columns saying
  which side of it each sample is on and how far away, and can be exported
  as OBJ, STL or DXF.
- Wireframes in the 3D view: load Leapfrog .msh, DXF, OBJ, STL and GOCAD
  .ts files. They are kept with the project and shown in every 3D view.
- 3D view: samples as From-To cylinders; a slice bar with sections, level
  plans and two crossing slices stepped through the data, with slicer keys
  and mouse; a hole list to search, zoom to and mark a hole; a satellite
  image under or over the data.
- PCA element selection can be ordered by how many samples each element
  costs, so you can see which ones to drop to keep more rows.
- Compositional transforms use the grouped element picker. Each element
  shows how many rows have it, patchy ones are flagged, and the same assay
  in two units or forms (SiO2 % and Si %, Au ppm and Au ppb) is flagged and
  counted once.

### Changed
- Compositional transforms and the analyses built on them now use only rows
  that have every selected element. Before, a missing value was filled with
  a made-up small number. Rows left out are counted and left empty.

### Fixed
- Spider plots convert oxide columns to element ppm before normalising.
- Drillhole import matches survey and assay columns by name, never by their
  position in the file.
- Drillhole import finds the collar RL column by name (NAT_RL, MGA_RL and
  the like), passes over text columns that only mention the RL, and says
  so when there is no RL column or an RL is missing.
  Before, such holes were placed at 0 m RL without a word.
- PCA Build Index fills only the rows the PCA was run on. Before, a PCA on
  a subset gave an index on every row that had the elements. A tick box
  fills the other rows too and says how many that adds.
- Calculated results (anomaly scores, factor scores, transforms) no longer
  overwrite a column that already has the same name.
- QAQC: standards whose names end in short numbers are kept apart, sample
  IDs that differ only by a letter are no longer paired as duplicates, and
  control limits use the chosen number of standard deviations.
- Drillhole coordinates keep full precision at large northings.
- Loading a new dataset clears settings left over from the last one.

### Known limits
- Closed bodies from logging follow the one overall direction, not the
  readings from place to place.
- A shell that follows plane readings does not yet use line readings.

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
