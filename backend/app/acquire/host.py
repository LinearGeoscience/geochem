"""What the Acquire import needs from the app it runs in: GeoChem's version.

The rest of the Acquire import (app/acquire/, api/acquire.py), drill
tracking's Acquire route (api/drilltracking.py) and their tests are written
to be the same in any app that carries them; only this file is GeoChem's own.
Keep anything app-specific here, and call these through the module
(`host.server_mode()`), so tests can patch them.

GeoChem runs for one person on their own computer: no server mode (one admin
profile for everyone, nothing edited from the screen), no sign-in, and one
dataset. The Acquire code keeps its server-mode branch for apps that have one.

Settings are environment variables (none are needed: profiles are made on the
Data Import > Acquire (SQL) tab):
- GEOCHEM_ACQUIRE_PROFILES_DIR: where connection profiles are kept (default:
  acquire_profiles in GeoChem's app data folder)
- GEOCHEM_ACQUIRE_SERVER / _DATABASE: fill in the example profiles copied on
  first use, when theirs are blank
- GEOCHEM_ACQUIRE_DRIVER (default "ODBC Driver 18 for SQL Server"), _AUTH
  (default "windows")
- GEOCHEM_ACQUIRE_PROFILE: the admin profile (server mode only)
"""
from __future__ import annotations

import os

import pandas as pd

from app.core.project_files import app_dir

SETTINGS_FILE = "the environment"
ACQUIRE_ENV_PREFIX = "GEOCHEM_ACQUIRE_"
ACQUIRE_ENV = {k: ACQUIRE_ENV_PREFIX + k.upper()
               for k in ("server", "database", "driver", "auth", "profiles_dir", "profile")}


def acquire_settings() -> dict[str, str]:
    """The Acquire settings, read when used."""
    s = {k: os.environ.get(name, "").strip() for k, name in ACQUIRE_ENV.items()}
    s["driver"] = s["driver"] or "ODBC Driver 18 for SQL Server"
    s["auth"] = s["auth"].lower() or "windows"
    s["profiles_dir"] = s["profiles_dir"] or str(app_dir() / "acquire_profiles")
    return s


def server_mode() -> bool:
    """A shared server: one admin profile, nothing edited from the screen. Never in GeoChem."""
    return False


def signed_in_user() -> str | None:
    """The user a server's sign-in gives: none in GeoChem (the Windows account is used)."""
    return None


def keep_preview(token: str, tables: dict[str, pd.DataFrame]) -> None:
    """Hand pulled collar / survey / assay frames to the drillhole import's preview
    cache, so /api/drillhole/process can load them by token (latest preview only)."""
    from app.api import drillhole
    drillhole._preview_cache.clear()
    drillhole._preview_cache[token] = tables


def has_preview(token: str) -> bool:
    from app.api import drillhole
    return token in drillhole._preview_cache


def enter_session(name: str):
    """Tests: work in a session of their own. GeoChem has one dataset: nothing to do."""
    return None


def leave_session(token) -> None:
    return None
