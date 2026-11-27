"""Checks for what people type into the Connection section, and SQL identifier quoting.

A typed server and database end up in an ODBC connection string, so they are
checked before any use, then wrapped in {} with } doubled. Table and column
names from a profile end up in SQL, so they are verified against the
database's INFORMATION_SCHEMA (queries.verify_field_map) and quoted like
SQL Server's QUOTENAME: [name] with ] doubled.
"""
from __future__ import annotations

import re

# host name or IPv4, optional \INSTANCE, optional ,port
_HOST = r"[A-Za-z0-9](?:[A-Za-z0-9\-_.]{0,252}[A-Za-z0-9])?"
_SERVER_RE = re.compile(rf"^({_HOST})(\\[A-Za-z0-9_$#\-]{{1,64}})?(,\d{{1,5}})?$")
_BAD_CHARS = set(";{}=\"'`") | {" ", "\t", "\r", "\n"}
MAX_NAME = 128


class InputError(ValueError):
    """A server, database or name that can't be used; the message is for the screen."""


def check_server(server: str) -> str:
    """A server as typed: host name or IP, optional \\INSTANCE, optional ,port.
    Strict: whitespace anywhere is refused (the screen trims what's typed)."""
    s = server or ""
    if not s:
        raise InputError("Enter the SQL Server name (for example sqlserver.example.com or sqlserver\\INSTANCE).")
    bad = sorted({c for c in s if c in _BAD_CHARS or ord(c) < 32})
    if bad:
        shown = " ".join("space" if c == " " else repr(c) for c in bad)
        raise InputError(f"The SQL Server name can't contain {shown}.")
    m = _SERVER_RE.match(s)
    if not m:
        raise InputError("The SQL Server name should be a host name or IP address, optionally "
                         "followed by \\INSTANCE and ,port (for example sqlserver.example.com,1433).")
    if m.group(3) and not 0 < int(m.group(3)[1:]) < 65536:
        raise InputError("The SQL Server port must be between 1 and 65535.")
    return s


def check_database(database: str) -> str:
    """A database name as typed (whether it exists is checked once connected).
    Strict: whitespace anywhere is refused (the screen trims what's typed)."""
    d = database or ""
    if not d:
        raise InputError("Enter the database name.")
    bad = sorted({c for c in d if c in _BAD_CHARS or ord(c) < 32})
    if bad:
        shown = " ".join("space" if c == " " else repr(c) for c in bad)
        raise InputError(f"The database name can't contain {shown}.")
    if len(d) > MAX_NAME:
        raise InputError(f"The database name is longer than {MAX_NAME} characters.")
    return d


def braced(value: str) -> str:
    """An ODBC connection-string value, braced with } doubled so it can't add settings."""
    return "{" + str(value).replace("}", "}}") + "}"


def check_name(name: str, what: str = "name") -> str:
    """A table, view, schema or column name from a profile (before the schema check)."""
    if not isinstance(name, str) or not name or len(name) > MAX_NAME:
        raise InputError(f"Not a valid {what}: {name!r}")
    if any(ord(c) < 32 for c in name):
        raise InputError(f"Not a valid {what} (control characters): {name!r}")
    return name


def quote(name: str) -> str:
    """[name] with ] doubled, exactly like SQL Server's QUOTENAME."""
    return "[" + check_name(name).replace("]", "]]") + "]"
