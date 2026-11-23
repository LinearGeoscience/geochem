# What's new in GeoChem

Newest version first. GeoChem shows the entries newer than your copy when an
update is available (Settings > Updates).

## 1.4.0 - 2026-11-24

Geological modelling. A Modelling page built round the geological model:
drillhole logging as the source of surfaces, models made from surfaces in a
chronology, with faults, veins, dykes, intrusions and folds, grade shells
kept inside them, and a check of every form against holes left out.

### New

#### The Modelling page
- A project tree holds everything a model is made of: drillholes and
  logging, structural data, points, polylines, surfaces, geological models,
  numeric models, sections and meshes. A geological model is a container in
  the tree, with its Boundary, Lithologies, Fault system, Surface chronology
  and Output volumes inside it. Pick an object to see and change its
  properties, in tabs.
- "New" on the toolbar, on every group and on a right-click lists what can
  be made there. A new geological model is started in one dialog, and the
  steps of setting it up are listed over the tree, each ticked when done.
- Several 3D and section views side by side; each shows and hides objects
  for itself, and a pick in one is a pick in all. Named views, a ruler, a
  legend of the lithologies, and a handle that turns a dip disc. A model's
  solids, contacts and faults can be clicked in a view.
- The modelling uses standard terms (lithology, chronology, contact surface,
  intrusion, vein, global trend, structural trend, surface resolution), one
  name for one thing, each with a plain line of explanation when pointed at.
- A list of what is being worked out, which can be stopped. A project's
  fits are kept in its folder, so it opens without fitting them again.

#### Drillholes and logging
- Holes are placed by minimum curvature from collars and surveys kept with
  the project. Logging tables (lithology, alteration, structure readings
  with alpha / beta) are read at their own depths and drawn down the holes.
- The drillholes and their logging are checked when they are brought in,
  and what is the matter is said on the first step of setting a model up.
- Lithologies: logged codes are grouped into the units a model is built of;
  stretches of hole can be given to a unit by hand. Short stretches are
  cleaned unit by unit, and the logging itself is kept.
- Structural data from columns can be limited to the rows that hold given
  values in up to two columns (a structure type and a quality, say).
- Topography from the collars, a grid of heights, a file of points or a
  GeoTIFF; a wide file is cut to the ground round the drilling.

#### Surfaces
- Points and polylines are objects of their own, shared between surfaces.
  Polylines can run in space with nodes on drillholes, carry dips and
  directions, snap, and be copied to the next section.
- A dip or a direction put on a surface is held as a slope of the surface
  there, not as made-up points beside it. A dip can be given a reach, and
  holds as far round as there is room. Bodies, veins and shells take dips,
  directions and drawn lines as contact surfaces do.
- Each surface can have its own structural data and its own global trend,
  with a plunge: distance counts separately across the plane and across the
  plunge in it. A surface can follow the layers of its geological model.
- A surface from logging can be steered by hand: contacts left out or
  moved, places put on one side, holes it must not cross. It lists where it
  misses its inputs, the worst first, and takes you there.
- A place put on one side can be held clear by a distance, and Shift+click
  runs a row of places from the last one. On an intrusion a place held
  inside is a lens made part of it, as thick each way as the distance and
  longer along its sheets, so a row is a sheet: "the dyke runs through
  here, a metre thick". Held outside, a short lens is cut out of it:
  "nothing here". How far a lens runs along the sheets can be typed, and
  each place says what logging of its own holes it takes. Nothing else of
  the body changes, and it is not fitted again: a place put in or taken
  away is drawn in about a second. On a contact the surface is bent to
  pass that far from the place. Places held by hand are drawn on a
  model's sections, a lens as its outline there.
- An intrusion of thin sheets looks for links between its holes when
  asked: pairs of its logged stretches in one plane of its sheets, a few
  metres apart, with no hole between that logs other ground, that it does
  not join now. Each is taken or left; a link taken is the body held along
  the line between the two, as thick as the thinner of them. Nothing is
  placed by the program.
- Offset surfaces, surfaces conformable to another, and the thickness
  between two.

#### Geological models
- A model's boundary: given no box, a model takes the box of the holes its
  lithologies are logged in, not of every row of data. Each face of the box
  can be dragged in a 3D view. A model can be kept only near its drilling:
  ground further than a distance from every hole it reads is left out, and
  gaps between holes narrower than that are filled.
- "Build chronology from lithologies" reads the logging and proposes what
  each lithology is, with the counts that say so: a deposit, an erosion
  surface (a base that lies on three or more older layers), an intrusion
  (with its age, from what it cuts and what it stops under), an intrusion
  of thin sheets, a vein, or a vein system for a set of dykes whose sheets
  can be told apart. Where they cannot (more than a third of its stretches
  would be in no vein), and for an intrusion that is thin against the gaps
  between its holes and lies in a plane, it proposes thin sheets, and says
  why. A unit that
  comes back down the holes is offered as its occurrences ("Basalt 1",
  "Basalt 2"). Two units whose order the holes do not say are pointed out
  before anything is made. Everything is made in one step.
- Each hole is read as one pile of the layers, so a contact is met once in
  a hole, and the plan says, before anything is fitted, how much of the
  logging it can match.
- A row of the chronology opens its unit inside the model: what it is built
  as, its surface's own editor, and its check. What a unit is built as can
  be changed after the fact, keeping its dips, its lines and its place in
  the chronology; a line says what was not carried.
- A unit thinner than the model's cells (a vein, a thin intrusion) is kept
  as its own mesh, cut by the model's rule, with its volume taken out of
  its hosts. The solids are measured against the rule they were built from.
- A model can be put inside one unit of another (alteration or weathering
  inside a rock type). Sections are drawn from the surfaces, not the cells.
- Faults: surfaces or meshes can be a model's faults. A fault can end on
  another, can stop (a bed runs unbroken round its end), and can be offset
  by a younger fault. Contacts are fitted in each fault block by the
  program; a contact younger than a fault is run through it.

#### Veins, dykes and intrusions
- A vein is built from its two walls about a reference surface, pinches
  out where holes miss it, and is drawn as it was fitted: each wall where
  the fit has it, finely round the holes. It takes its plane from the
  structural data it follows, from how its stretches carry between holes,
  or typed. Stretches under a join length apart are read as one zone; the
  dialog says what share of each zone is the unit; it can be built to its
  zone or to its net thickness. Thickness is a column and a colour.
- Lodes told apart: stacked sheets are offered as a vein of each, with the
  holes and metres in each. A stretch can be given to another vein by a
  click in the view or in a list.
- A vein system holds several veins in an order; one stops at another. It
  goes into a geological model as one unit.
- An intrusion of thin sheets (dykes, sills): strict about its logging,
  carried further along its sheets than across, drawn only within a reach
  of its holes, and that reach is as much shorter across its sheets as it
  is carried less far across them, so it does not swell into the ground
  beside its holes. A join length and a least piece size are settings.
- Proportion: a numeric model of the share of chosen units in the ground,
  with shells at shares, for sheets too thin and too many to draw.
- The forms of one unit are set side by side with their checks.

#### Numeric models and grade
- A numeric model is a column at several cut-offs with a grade shell for
  each. It can be kept inside lithologies or a fault block of a geological
  model, or inside solids: a surface, a vein system, a closed mesh from a
  file. Only the samples inside are used and the shells stop at the faces.
- A numeric model can lie along the sheets of a body or a vein: the plane
  a vein, a vein system or an intrusion of thin sheets says its sheets lie
  in is set for every shell of it in one step, when it is made or from its
  properties, so highs in dykes or veins are drawn as lenses along them
  and not as bubbles. Offered, not set by itself.
- "Plunge of its highs" looks for a plunge in a numeric model's own
  samples and, where it is sure, sets it in one step. It gives one answer
  for the same samples in any order.
- Grade tables: metres, mean grade and share of the metal by lithology (as
  logged and as modelled), inside each shell, and inside a closed mesh,
  with a top cut; each can be sent to the report.
- A mesh from a file says whether it is closed and what it holds, and
  where it is open: how many edges, and where the largest gap is.

#### Checks
- "Check against drilling" says, unit by unit and in metres of hole, where
  a model and its logging part.
- Cross-validation for a geological model and for an intrusion, thin
  sheets, a vein, a vein system and a proportion: built again without
  groups of holes (holes that lie together, a line of faces on one level or
  a fan from one collar, are left out together) and asked what it has down
  them. It says how much it found, how much of what it took was the unit,
  and its largest group.

#### Sharing
- Sections and plans of a model for the report, as pictures (.svg) or
  linework (.dxf). The holes on a section carry their logging, each
  interval in its lithology's colour, with a wider bright edge where the
  model has another unit; the section says how much of its logging the
  model has as logged, in its properties before it is drawn and under the
  picture.
- A Leapfrog export: a surface or a whole model as one zip with what it was
  built from, its chronology, faults and lithologies as tables, its meshes
  (.msh, GOCAD, OBJ, DXF) and a note of how to build it again. Versions of
  the scene kept under a name. Leapfrog polylines, Surpac strings and GOCAD
  lines can be imported.
- "How it works": a guide of seventeen pages with pictures you can change,
  from how a surface is fitted to what it cannot know, with a contents
  page; and a guide to how a geological model is built.

### Changed
- Surfaces made in 1.3.0 are fitted again when a project is opened, once.
  A surface with dips or directions on it holds them more closely than it
  did, so it may move a little; a locked surface says if it has.
- A closed body in a model with structural data follows it from place to
  place, as shells do; untick "Use structural trend" on the body to have it
  as it was.
- Each plot has its own list of what it shows: hiding a surface in a 3D
  view no longer hides it in the section and map plots.
- The 3D plots on the Plots page are for looking at data; surfaces are
  made and edited on the Modelling page ("Open in Modelling").

### What to know
- Look at a model on sections against its logging before trusting a score.
  A model can agree with most of its holes and still be drawn as no
  geologist would draw it.
- A dyke or a vein in ground that no hole has seen cannot be placed by any
  of these tools; the checks against holes left out say how far each form
  can be trusted on your own drilling, and the guide's last pages say what
  the numbers mean.

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
