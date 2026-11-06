# What's new in GeoChem

Newest version first. GeoChem shows the entries newer than your copy when an
update is available (Settings > Updates).

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
