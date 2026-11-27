"""Read-only connections to an Acquire SQL Server database, and the connection test.

Windows sign-in only (Trusted_Connection): the app never handles passwords.
The server and database come from a connection profile (laptops) or the admin
profile and the server's settings (server mode). Both are checked by validation.py before
use and braced in the connection string, with ApplicationIntent=ReadOnly and
a 10 s connect timeout.

Read-only is enforced by the app, twice:
  1. only the fixed SELECTs in queries.py run (`fetch_frame` refuses anything
     else and re-checks the SQL with `queries.assert_select_only`);
  2. the connection asks for read-only (ApplicationIntent=ReadOnly, pyodbc
     readonly=True) and never commits.
The database itself may still allow the login to write; the connection test
says so, and a read-only login is recommended.
"""
from __future__ import annotations

import logging

import pandas as pd

from app.acquire import queries
from app.acquire import validation as v

logger = logging.getLogger(__name__)

CONNECT_TIMEOUT_S = 10
QUERY_TIMEOUT_S = 180
WRITE_PERMISSIONS = {"INSERT", "UPDATE", "DELETE", "ALTER", "CONTROL", "CREATE TABLE", "CREATE VIEW",
                     "CREATE PROCEDURE", "EXECUTE"}


class AcquireUnavailable(RuntimeError):
    """Acquire can't be reached or used; the message is shown to the user."""


def connection_settings(profile: dict, database: str | None = None) -> dict:
    """The connection part of a profile (server, database, driver options), checked."""
    try:
        server = v.check_server(profile.get("server", ""))
        db = v.check_database(database if database is not None else profile.get("database", ""))
    except v.InputError as exc:
        raise AcquireUnavailable(str(exc)) from exc
    driver = (profile.get("driver") or "ODBC Driver 18 for SQL Server").strip()
    return {"server": server, "database": db, "driver": driver,
            "encrypt": bool(profile.get("encrypt", True)),
            "trust_server_certificate": bool(profile.get("trust_server_certificate", True))}


def connection_string(cs: dict) -> str:
    return (f"DRIVER={v.braced(cs['driver'])};SERVER={v.braced(cs['server'])};"
            f"DATABASE={v.braced(cs['database'])};Trusted_Connection=yes;"
            f"Encrypt={'yes' if cs['encrypt'] else 'no'};"
            f"TrustServerCertificate={'yes' if cs['trust_server_certificate'] else 'no'};"
            "ApplicationIntent=ReadOnly;")


def friendly(exc: Exception, cs: dict | None = None) -> str:
    """A short explanation of a connection / driver error for the screen."""
    text = str(exc)
    server = (cs or {}).get("server", "the server")
    if "IM002" in text or "Data source name not found" in text:
        driver = (cs or {}).get("driver", "the SQL Server ODBC driver")
        return f"The ODBC driver '{driver}' isn't installed on this computer. Ask IT to install it."
    if ("08001" in text or "Login timeout" in text or "TCP Provider" in text or "Named Pipes" in text
            or "network" in text.lower() or "HYT00" in text):
        return (f"Can't reach the SQL Server '{server}'. Check the name, and that you're on the "
                "company network or VPN.")
    if "28000" in text or "Login failed" in text:
        return "SQL Server refused your Windows sign-in. Ask the database admin for read access."
    if "(4060)" in text or "Cannot open database" in text:
        return "SQL Server refused access to that database. Check the name, or ask the database admin for read access."
    if "(229)" in text or "permission was denied" in text:
        return "SQL Server refused to read one of the tables or views. Ask the database admin for read access."
    if "certificate" in text.lower() or "SSL" in text:
        return "The connection's encryption settings were refused (try the profile's certificate options)."
    return f"Acquire error: {text[:300]}"


def connect(cs: dict):
    """Open a read-only connection (raises AcquireUnavailable with a friendly message)."""
    try:
        import pyodbc
    except ImportError as exc:  # pragma: no cover - depends on the install
        raise AcquireUnavailable("pyodbc isn't installed: reinstall the backend requirements.") from exc
    try:
        conn = pyodbc.connect(connection_string(cs), timeout=CONNECT_TIMEOUT_S, readonly=True, autocommit=False)
    except pyodbc.Error as exc:
        logger.warning("Acquire connection failed: %s", exc)
        raise AcquireUnavailable(friendly(exc, cs)) from exc
    conn.timeout = QUERY_TIMEOUT_S
    return conn


def fetch_frame(conn, query: queries.Query) -> pd.DataFrame:
    """Run one of the fixed SELECTs from queries.py and return its rows as a DataFrame.
    Nothing is ever committed; the transaction is rolled back afterwards."""
    if not isinstance(query, queries.Query) or query.name not in queries.NAMES:
        raise ValueError("Only the fixed Acquire queries in app/acquire/queries.py may run")
    queries.assert_select_only(query.sql)
    cursor = conn.cursor()
    try:
        cursor.execute(query.sql, *query.params)
        cols = [d[0] for d in cursor.description]
        rows = cursor.fetchall()
    finally:
        cursor.close()
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001 - nothing to undo; never commit
            pass
    return pd.DataFrame.from_records([tuple(r) for r in rows], columns=cols)


def lookup_object(conn):
    """A queries.verify_field_map lookup: (schema, name) -> CatalogObject or None."""
    cache: dict = {}

    def lookup(schema: str, name: str):
        key = (schema.lower(), name.lower())
        if key not in cache:
            df = fetch_frame(conn, queries.object_columns(schema, name))
            cache[key] = (queries.CatalogObject(str(df.iloc[0]["TABLE_SCHEMA"]), str(df.iloc[0]["TABLE_NAME"]),
                                                tuple(str(c) for c in df["COLUMN_NAME"]))
                          if len(df) else None)
        return cache[key]
    return lookup


def verified(conn, field_map: dict) -> queries.VerifiedMap:
    return queries.verify_field_map(field_map, lookup_object(conn))


def open_checked(profile: dict):
    """Connect for a profile: checks the server and database, then that the database
    exists (sys.databases). Returns (connection, connection settings)."""
    cs = connection_settings(profile)
    conn = connect(cs)
    try:
        if not len(fetch_frame(conn, queries.database_exists(cs["database"]))):
            raise AcquireUnavailable(f"There's no database '{cs['database']}' on {cs['server']}.")
    except AcquireUnavailable:
        conn.close()
        raise
    return conn, cs


def test(profile: dict, field_map: dict | None = None) -> dict:
    """Test a profile's connection: who you are, the SQL Server version, whether the
    login can write, and (given a field map) which of its names the database lacks.
    Never raises: the answer says what went wrong."""
    out = {"ok": False, "user": "", "version": "", "edition": "", "can_write": None,
           "write_permissions": [], "server": profile.get("server", ""),
           "database": profile.get("database", ""), "message": "", "map_problems": []}
    try:
        conn, cs = open_checked(profile)
    except AcquireUnavailable as exc:
        out["message"] = str(exc)
        return out
    try:
        who = fetch_frame(conn, queries.whoami()).iloc[0]
        perms = {str(p).upper() for p in fetch_frame(conn, queries.permissions())["permission_name"]}
        writes = sorted(perms & WRITE_PERMISSIONS)
        is_writer = bool(who["is_owner"] == 1 or who["is_writer"] == 1)
        out.update(user=str(who["login_name"]), version=str(who["product_version"]), edition=str(who["edition"]),
                   write_permissions=writes, can_write=bool(writes) or is_writer, ok=True,
                   message=f"Connected to {cs['database']} on {cs['server']} as {who['login_name']}.")
        if field_map is not None:
            try:
                verified(conn, field_map)
            except queries.MappingError as exc:
                out["map_problems"] = [str(exc)]
    except Exception as exc:  # noqa: BLE001 - report, don't fail the tab
        logger.warning("Acquire connection test failed: %s", exc)
        out["ok"] = False
        out["message"] = friendly(exc, cs)
    finally:
        conn.close()
    return out
