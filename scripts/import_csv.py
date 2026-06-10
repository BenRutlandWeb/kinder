#!/usr/bin/env python3
"""Import gov.uk / ONS baby name CSV data into the SQLite names table."""

import argparse
import csv
import os
import sqlite3
import sys
from pathlib import Path

def data_dir() -> Path:
    if env := os.environ.get("DATA_DIR"):
        return Path(env)
    local = Path(__file__).resolve().parent.parent / "data"
    if local.is_dir():
        return local
    return Path("/data")


DATA_DIR = data_dir()
DB_PATH = DATA_DIR / "babynames.db"

DEFAULT_SEED_FILES = (
    ("babynames1996to2024-Table_1.csv", "F"),
    ("babynames1996to2024-Table_2.csv", "M"),
)


def sample_data_dir() -> Path:
    env = os.environ.get("SAMPLE_DATA_DIR")
    if env:
        return Path(env)
    for candidate in (
        Path("/sample-data"),
        Path(__file__).resolve().parent.parent / "sample-data",
    ):
        if candidate.is_dir():
            return candidate
    return Path(__file__).resolve().parent.parent / "sample-data"


def normalize_header(header: str) -> str:
    return header.strip().lower()


def find_column(fieldnames: list[str], candidates: set[str]) -> str | None:
    for field in fieldnames:
        if normalize_header(field) in candidates:
            return field
    return None


def rank_columns(fieldnames: list[str]) -> list[str]:
    ranked: list[tuple[int, str]] = []
    for field in fieldnames:
        norm = normalize_header(field)
        if norm == "rank":
            ranked.append((9999, field))
        elif norm.endswith(" rank"):
            year_text = norm[: -len(" rank")].strip()
            try:
                ranked.append((int(year_text), field))
            except ValueError:
                continue
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [field for _, field in ranked]


def title_case_name(name: str) -> str:
    return name.strip().title()


def parse_rank(raw: str | None) -> int | None:
    if raw is None:
        return None
    cleaned = raw.strip().replace(",", "").replace('"', "")
    if not cleaned or cleaned.lower() == "[x]":
        return None
    try:
        return int(cleaned)
    except ValueError:
        return None


def row_rank(row: dict[str, str], name_col: str, rank_cols: list[str]) -> int | None:
    for col in rank_cols:
        rank = parse_rank(row.get(col))
        if rank is not None:
            return rank
    return None


def load_rows(csv_path: Path, gender: str) -> list[tuple[str, str, int]]:
    best: dict[str, int] = {}
    with csv_path.open(newline="", encoding="utf-8-sig") as handle:
        line_reader = csv.reader(handle)
        for row in line_reader:
            if row and normalize_header(row[0]) == "name":
                header = row
                break
        else:
            raise ValueError("Could not find header row starting with 'Name'")

        name_col = find_column(header, {"name"})
        rank_cols = rank_columns(header)
        if name_col is None or not rank_cols:
            raise ValueError(f"Could not find Name/Rank columns in: {header}")

        for values in line_reader:
            row = dict(zip(header, values))
            name = title_case_name(row.get(name_col, ""))
            rank = row_rank(row, name_col, rank_cols)
            if not name or rank is None:
                continue
            if name not in best or rank < best[name]:
                best[name] = rank

    return [(name, gender, rank) for name, rank in best.items()]


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS names (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            gender TEXT NOT NULL CHECK (gender IN ('M', 'F')),
            rank INTEGER NOT NULL,
            UNIQUE (name, gender)
        );
        """
    )


def bulk_insert(conn: sqlite3.Connection, rows: list[tuple[str, str, int]]) -> int:
    conn.executemany(
        """
        INSERT INTO names (name, gender, rank)
        VALUES (?, ?, ?)
        ON CONFLICT(name, gender) DO UPDATE SET
            rank = MIN(names.rank, excluded.rank)
        """,
        rows,
    )
    return len(rows)


def import_csv_file(conn: sqlite3.Connection, csv_path: Path, gender: str) -> int:
    rows = load_rows(csv_path, gender)
    if not rows:
        raise ValueError(f"No valid rows found in CSV: {csv_path}")
    return bulk_insert(conn, rows)


def seed_names_if_empty(
    db_path: Path = DB_PATH,
    sample_dir: Path | None = None,
    seed_files: tuple[tuple[str, str], ...] = DEFAULT_SEED_FILES,
) -> int:
    """Import default CSVs when the names table is empty. Returns rows imported."""
    sample_dir = sample_dir or sample_data_dir()
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(db_path)
    try:
        ensure_schema(conn)
        count = conn.execute("SELECT COUNT(*) FROM names").fetchone()[0]
        if count > 0:
            return 0

        imported = 0
        for filename, gender in seed_files:
            csv_path = sample_dir / filename
            if not csv_path.is_file():
                raise FileNotFoundError(f"Seed CSV not found: {csv_path}")
            imported += import_csv_file(conn, csv_path, gender)

        conn.commit()
        return imported
    finally:
        conn.close()


def strip_user_data(db_path: Path = DB_PATH) -> None:
    """Remove users, swipes, invites, and app metadata; keep names."""
    conn = sqlite3.connect(db_path)
    try:
        tables = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        if "swipes" in tables:
            conn.execute("DELETE FROM swipes")
        if "invites" in tables:
            conn.execute("DELETE FROM invites")
        if "users" in tables:
            conn.execute("DELETE FROM users")
        if "app_meta" in tables:
            conn.execute("DELETE FROM app_meta")
        conn.commit()
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Import ONS/gov.uk baby name CSV into SQLite"
    )
    parser.add_argument("csv_path", type=Path, help="Path to the raw CSV file")
    parser.add_argument(
        "gender",
        choices=["M", "F"],
        help="Gender flag: M for boys, F for girls",
    )
    args = parser.parse_args()

    if not args.csv_path.is_file():
        print(f"Error: file not found: {args.csv_path}", file=sys.stderr)
        return 1

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    try:
        ensure_schema(conn)
        try:
            count = import_csv_file(conn, args.csv_path, args.gender)
        except ValueError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1
        conn.commit()
    finally:
        conn.close()

    print(f"Imported {count} unique names ({args.gender}) into {DB_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
