import asyncio
import os
import sys
from pathlib import Path

import aiosqlite



DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))

DB_PATH = DATA_DIR / "babynames.db"





async def get_db() -> aiosqlite.Connection:

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    db = await aiosqlite.connect(DB_PATH)

    db.row_factory = aiosqlite.Row

    await db.execute("PRAGMA foreign_keys = ON")

    return db





async def _migrate_users_table(db: aiosqlite.Connection) -> None:

    cursor = await db.execute("PRAGMA table_info(users)")

    cols = {row[1] for row in await cursor.fetchall()}



    if not cols:

        await db.execute(

            """

            CREATE TABLE users (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                email TEXT NOT NULL UNIQUE,

                partner_id INTEGER REFERENCES users(id)

            )

            """

        )

        return



    if "username" in cols and "email" not in cols:

        await db.execute("ALTER TABLE users RENAME COLUMN username TO email")



    cursor = await db.execute("PRAGMA table_info(users)")

    cols = {row[1] for row in await cursor.fetchall()}



    if "partner_id" not in cols:

        await db.execute(

            "ALTER TABLE users ADD COLUMN partner_id INTEGER REFERENCES users(id)"

        )





async def _seed_names_if_empty() -> int:
    root = Path(__file__).resolve().parent.parent
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from scripts.import_csv import seed_names_if_empty

    return await asyncio.to_thread(seed_names_if_empty, DB_PATH)


async def init_db() -> None:

    DATA_DIR.mkdir(parents=True, exist_ok=True)

    async with aiosqlite.connect(DB_PATH) as db:

        await db.execute("PRAGMA foreign_keys = ON")

        await db.executescript(

            """

            CREATE TABLE IF NOT EXISTS names (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                name TEXT NOT NULL,

                gender TEXT NOT NULL CHECK (gender IN ('M', 'F')),

                rank INTEGER NOT NULL,

                UNIQUE (name, gender)

            );



            CREATE TABLE IF NOT EXISTS swipes (

                user_id INTEGER NOT NULL,

                name_id INTEGER NOT NULL,

                status INTEGER NOT NULL CHECK (status IN (1, 2)),

                PRIMARY KEY (user_id, name_id),

                FOREIGN KEY (user_id) REFERENCES users(id),

                FOREIGN KEY (name_id) REFERENCES names(id)

            );



            CREATE TABLE IF NOT EXISTS invites (

                id INTEGER PRIMARY KEY AUTOINCREMENT,

                token TEXT NOT NULL UNIQUE,

                inviter_id INTEGER NOT NULL,

                invitee_email TEXT NOT NULL,

                created_at TEXT NOT NULL DEFAULT (datetime('now')),

                accepted_at TEXT,

                FOREIGN KEY (inviter_id) REFERENCES users(id)

            );

            """

        )



        await _migrate_users_table(db)



        await db.commit()

    imported = await _seed_names_if_empty()
    if imported:
        print(f"Seeded {imported} baby names from sample-data", flush=True)


