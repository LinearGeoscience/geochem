"""Data Import > Acquire (SQL): read-only import of collar, survey and assay
tables from the Acquire database, handed to the Drillhole import pipeline.

connection.py  connect (read-only) and health check
queries.py     the fixed, parameterised SELECTs (the only SQL sent) + QUERY_VERSION
mapping.json   Acquire object and column names, filter columns, date format
frames.py      filters -> the three DataFrames (as a CSV upload would give them)
pull_record.py row counts and checksum for the processing log
"""
