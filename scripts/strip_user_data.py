#!/usr/bin/env python3
"""Remove user accounts, swipes, and invites from the runtime database."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from scripts.import_csv import DB_PATH, strip_user_data


def main() -> int:
    if not DB_PATH.is_file():
        print(f"No database at {DB_PATH}", file=sys.stderr)
        return 1
    strip_user_data(DB_PATH)
    print(f"Cleared user data from {DB_PATH} (names preserved)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
