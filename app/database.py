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


async def _migrate_custom_recommendations_table(db: aiosqlite.Connection) -> None:
    cursor = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='custom_recommendations'"
    )
    if await cursor.fetchone() is None:
        return
    cursor = await db.execute("PRAGMA table_info(custom_recommendations)")
    cols = {row[1] for row in await cursor.fetchall()}
    if "gender" not in cols:
        await db.execute(
            "ALTER TABLE custom_recommendations ADD COLUMN gender TEXT DEFAULT 'M'"
        )
        await db.execute(
            "UPDATE custom_recommendations SET gender = 'M' WHERE gender IS NULL"
        )


async def _migrate_swipes_created_at(db: aiosqlite.Connection) -> None:
    cursor = await db.execute("PRAGMA table_info(swipes)")
    cols = {row[1] for row in await cursor.fetchall()}
    if "created_at" not in cols:
        await db.execute("ALTER TABLE swipes ADD COLUMN created_at TEXT")
        await db.execute(
            "UPDATE swipes SET created_at = datetime('now') WHERE created_at IS NULL"
        )


async def _migrate_users_table(db: aiosqlite.Connection) -> None:
    cursor = await db.execute("PRAGMA table_info(users)")
    cols = {row[1] for row in await cursor.fetchall()}
    if not cols:
        await db.execute("""
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                name TEXT,
                partner_id INTEGER REFERENCES users(id),
                surname TEXT
            )
            """)
        return
    if "username" in cols and "email" not in cols:
        await db.execute("ALTER TABLE users RENAME COLUMN username TO email")
    cursor = await db.execute("PRAGMA table_info(users)")
    cols = {row[1] for row in await cursor.fetchall()}
    if "partner_id" not in cols:
        await db.execute(
            "ALTER TABLE users ADD COLUMN partner_id INTEGER REFERENCES users(id)"
        )
    cursor = await db.execute("PRAGMA table_info(users)")
    cols = {row[1] for row in await cursor.fetchall()}
    if "name" not in cols:
        await db.execute("ALTER TABLE users ADD COLUMN name TEXT")
    cursor = await db.execute("PRAGMA table_info(users)")
    cols = {row[1] for row in await cursor.fetchall()}
    if "surname" not in cols:
        await db.execute("ALTER TABLE users ADD COLUMN surname TEXT")
    cursor = await db.execute("PRAGMA table_info(users)")
    cols = {row[1] for row in await cursor.fetchall()}
    if "filter_gender" not in cols:
        await db.execute(
            "ALTER TABLE users ADD COLUMN filter_gender TEXT NOT NULL DEFAULT 'both'"
        )
    cursor = await db.execute("PRAGMA table_info(users)")
    cols = {row[1] for row in await cursor.fetchall()}
    if "filter_letters" not in cols:
        await db.execute("ALTER TABLE users ADD COLUMN filter_letters TEXT")


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
        await db.executescript("""
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
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
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



            CREATE TABLE IF NOT EXISTS recommendations (
                recipient_id INTEGER NOT NULL,
                name_id INTEGER NOT NULL,
                recommender_id INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (recipient_id, name_id),
                FOREIGN KEY (recipient_id) REFERENCES users(id),
                FOREIGN KEY (name_id) REFERENCES names(id),
                FOREIGN KEY (recommender_id) REFERENCES users(id)
            );



            CREATE TABLE IF NOT EXISTS custom_recommendations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                recipient_id INTEGER NOT NULL,
                recommender_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                gender TEXT NOT NULL CHECK (gender IN ('M', 'F')),
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE (recipient_id, name COLLATE NOCASE),
                FOREIGN KEY (recipient_id) REFERENCES users(id),
                FOREIGN KEY (recommender_id) REFERENCES users(id)
            );



            CREATE TABLE IF NOT EXISTS user_custom_picks (
                user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                gender TEXT NOT NULL CHECK (gender IN ('M', 'F')),
                PRIMARY KEY (user_id, name COLLATE NOCASE),
                FOREIGN KEY (user_id) REFERENCES users(id)
            );



            CREATE TABLE IF NOT EXISTS custom_swipes (
                user_id INTEGER NOT NULL,
                custom_recommendation_id INTEGER NOT NULL,
                status INTEGER NOT NULL CHECK (status IN (1, 2)),
                PRIMARY KEY (user_id, custom_recommendation_id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (custom_recommendation_id) REFERENCES custom_recommendations(id)
            );
            """)
        await _migrate_users_table(db)
        await _migrate_custom_recommendations_table(db)
        await _migrate_swipes_created_at(db)
        await db.commit()
    imported = await _seed_names_if_empty()
    if imported:
        print(f"Seeded {imported} baby names from sample-data", flush=True)
