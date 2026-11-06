# What's new in GeoChem

Newest version first. GeoChem shows the entries newer than your copy when an
update is available (Settings > Updates).

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
