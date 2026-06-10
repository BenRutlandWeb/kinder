import os

import re

import secrets

from contextlib import asynccontextmanager

from pathlib import Path



from fastapi import FastAPI, HTTPException, Query

from fastapi.staticfiles import StaticFiles

from pydantic import BaseModel, Field, field_validator



from app.database import get_db, init_db



FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

BASE_URL = os.environ.get("BASE_URL", "http://localhost:9000")



EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")





@asynccontextmanager

async def lifespan(_: FastAPI):

    await init_db()

    yield





app = FastAPI(title="Baby Name Swiper", lifespan=lifespan)





class SwipeRequest(BaseModel):

    user_id: int = Field(..., ge=1)

    name_id: int = Field(..., ge=1)

    status: int = Field(..., ge=1, le=2)





class EmailRequest(BaseModel):

    email: str = Field(..., min_length=3, max_length=254)



    @field_validator("email")

    @classmethod

    def normalize_email(cls, value: str) -> str:

        email = value.strip().lower()

        if not EMAIL_RE.match(email):

            raise ValueError("Invalid email address")

        return email





class CreateInviteRequest(BaseModel):

    user_id: int = Field(..., ge=1)





class UnlinkRequest(BaseModel):

    user_id: int = Field(..., ge=1)





async def _get_user_row(db, user_id: int):

    cursor = await db.execute(

        "SELECT id, email, partner_id FROM users WHERE id = ?", (user_id,)

    )

    return await cursor.fetchone()





async def _pending_invite_url(db, inviter_id: int) -> str | None:
    cursor = await db.execute(
        """
        SELECT token FROM invites
        WHERE inviter_id = ? AND accepted_at IS NULL
        ORDER BY created_at DESC LIMIT 1
        """,
        (inviter_id,),
    )
    row = await cursor.fetchone()
    if row is None:
        return None
    return f"{BASE_URL.rstrip('/')}/?invite={row['token']}"


async def _user_status(db, user_row) -> dict:
    partner_email = None
    if user_row["partner_id"]:
        cursor = await db.execute(
            "SELECT email FROM users WHERE id = ?", (user_row["partner_id"],)
        )
        partner = await cursor.fetchone()
        if partner:
            partner_email = partner["email"]

    pending_invite_url = await _pending_invite_url(db, user_row["id"])

    return {
        "id": user_row["id"],
        "email": user_row["email"],
        "linked": user_row["partner_id"] is not None,
        "partner_email": partner_email,
        "pending_invite_url": pending_invite_url,
    }





@app.post("/api/auth")

async def auth(body: EmailRequest):

    db = await get_db()

    try:

        cursor = await db.execute(

            "SELECT id, email, partner_id FROM users WHERE email = ?", (body.email,)

        )

        row = await cursor.fetchone()

        if row is None:

            await db.execute("INSERT INTO users (email) VALUES (?)", (body.email,))

            await db.commit()

            cursor = await db.execute(

                "SELECT id, email, partner_id FROM users WHERE email = ?", (body.email,)

            )

            row = await cursor.fetchone()

        return await _user_status(db, row)

    finally:

        await db.close()





@app.get("/api/me")

async def me(user_id: int = Query(..., ge=1)):

    db = await get_db()

    try:

        row = await _get_user_row(db, user_id)

        if row is None:

            raise HTTPException(status_code=404, detail="User not found")

        return await _user_status(db, row)

    finally:

        await db.close()





@app.post("/api/invite")
async def invite(body: CreateInviteRequest):
    db = await get_db()
    try:
        inviter = await _get_user_row(db, body.user_id)
        if inviter is None:
            raise HTTPException(status_code=404, detail="User not found")

        if inviter["partner_id"] is not None:
            raise HTTPException(status_code=400, detail="Already linked with a partner")

        existing_url = await _pending_invite_url(db, body.user_id)
        if existing_url:
            return {"ok": True, "invite_url": existing_url}

        token = secrets.token_urlsafe(32)
        await db.execute(
            "INSERT INTO invites (token, inviter_id, invitee_email) VALUES (?, ?, '')",
            (token, body.user_id),
        )
        await db.commit()

        invite_url = f"{BASE_URL.rstrip('/')}/?invite={token}"
        return {"ok": True, "invite_url": invite_url}
    finally:
        await db.close()





@app.get("/api/invite/{token}")

async def get_invite(token: str):

    db = await get_db()

    try:

        cursor = await db.execute(

            """

            SELECT i.token, i.invitee_email, i.accepted_at, u.email AS inviter_email

            FROM invites i

            JOIN users u ON u.id = i.inviter_id

            WHERE i.token = ?

            """,

            (token,),

        )

        row = await cursor.fetchone()

        if row is None:

            raise HTTPException(status_code=404, detail="Invite not found")



        if row["accepted_at"] is not None:

            raise HTTPException(status_code=410, detail="Invite already used")



        return {"inviter_email": row["inviter_email"]}

    finally:

        await db.close()





@app.post("/api/invite/{token}/accept")

async def accept_invite(token: str, body: EmailRequest):

    db = await get_db()

    try:

        cursor = await db.execute(

            """

            SELECT i.id, i.inviter_id, i.invitee_email, i.accepted_at,

                   u.email AS inviter_email, u.partner_id AS inviter_partner_id

            FROM invites i

            JOIN users u ON u.id = i.inviter_id

            WHERE i.token = ?

            """,

            (token,),

        )

        invite = await cursor.fetchone()

        if invite is None:

            raise HTTPException(status_code=404, detail="Invite not found")



        if invite["accepted_at"] is not None:

            raise HTTPException(status_code=410, detail="Invite already used")



        if invite["inviter_partner_id"] is not None:

            raise HTTPException(

                status_code=400, detail="Inviter is already linked with someone"

            )



        cursor = await db.execute(

            "SELECT id, email, partner_id FROM users WHERE email = ?", (body.email,)

        )

        invitee = await cursor.fetchone()

        if invitee is None:

            await db.execute("INSERT INTO users (email) VALUES (?)", (body.email,))

            await db.commit()

            cursor = await db.execute(

                "SELECT id, email, partner_id FROM users WHERE email = ?", (body.email,)

            )

            invitee = await cursor.fetchone()

        elif invitee["partner_id"] is not None:

            raise HTTPException(

                status_code=400, detail="You are already linked with someone"

            )



        if invitee["id"] == invite["inviter_id"]:

            raise HTTPException(status_code=400, detail="Cannot link with yourself")



        await db.execute(

            "UPDATE users SET partner_id = ? WHERE id = ?",

            (invitee["id"], invite["inviter_id"]),

        )

        await db.execute(

            "UPDATE users SET partner_id = ? WHERE id = ?",

            (invite["inviter_id"], invitee["id"]),

        )

        await db.execute(

            "UPDATE invites SET accepted_at = datetime('now') WHERE id = ?",

            (invite["id"],),

        )

        await db.execute(

            "DELETE FROM invites WHERE inviter_id = ? AND accepted_at IS NULL AND id != ?",

            (invite["inviter_id"], invite["id"]),

        )

        await db.commit()



        cursor = await db.execute(

            "SELECT id, email, partner_id FROM users WHERE id = ?", (invitee["id"],)

        )

        row = await cursor.fetchone()

        return await _user_status(db, row)

    finally:

        await db.close()





@app.post("/api/unlink")

async def unlink(body: UnlinkRequest):

    db = await get_db()

    try:

        user = await _get_user_row(db, body.user_id)

        if user is None:

            raise HTTPException(status_code=404, detail="User not found")



        if user["partner_id"] is None:

            raise HTTPException(status_code=400, detail="Not linked with anyone")



        partner_id = user["partner_id"]

        await db.execute(

            "UPDATE users SET partner_id = NULL WHERE id IN (?, ?)",

            (body.user_id, partner_id),

        )

        await db.commit()



        return {"ok": True}

    finally:

        await db.close()





@app.get("/api/next-name")

async def next_name(user_id: int = Query(..., ge=1)):

    db = await get_db()

    try:

        cursor = await db.execute(

            """

            SELECT n.id, n.name, n.gender, n.rank

            FROM names n

            WHERE n.id NOT IN (

                SELECT s.name_id FROM swipes s WHERE s.user_id = ?

            )

            ORDER BY RANDOM()

            LIMIT 1

            """,

            (user_id,),

        )

        row = await cursor.fetchone()

        if row is None:

            raise HTTPException(status_code=404, detail="No more names to swipe")

        return {

            "id": row["id"],

            "name": row["name"],

            "gender": row["gender"],

            "rank": row["rank"],

        }

    finally:

        await db.close()





@app.post("/api/swipe")

async def swipe(body: SwipeRequest):

    db = await get_db()

    try:

        cursor = await db.execute("SELECT id FROM users WHERE id = ?", (body.user_id,))

        if await cursor.fetchone() is None:

            raise HTTPException(status_code=404, detail="User not found")



        cursor = await db.execute("SELECT id FROM names WHERE id = ?", (body.name_id,))

        if await cursor.fetchone() is None:

            raise HTTPException(status_code=404, detail="Name not found")



        await db.execute(

            """

            INSERT INTO swipes (user_id, name_id, status)

            VALUES (?, ?, ?)

            ON CONFLICT(user_id, name_id) DO UPDATE SET status = excluded.status

            """,

            (body.user_id, body.name_id, body.status),

        )

        await db.commit()

        return {"ok": True}

    finally:

        await db.close()





@app.post("/api/clear-picks")

async def clear_picks(body: UnlinkRequest):

    db = await get_db()

    try:

        cursor = await db.execute("SELECT id FROM users WHERE id = ?", (body.user_id,))

        if await cursor.fetchone() is None:

            raise HTTPException(status_code=404, detail="User not found")



        cursor = await db.execute(

            "DELETE FROM swipes WHERE user_id = ? AND status = 1",

            (body.user_id,),

        )

        await db.commit()

        return {"ok": True, "deleted": cursor.rowcount}

    finally:

        await db.close()





@app.get("/api/likes")

async def likes(user_id: int = Query(..., ge=1)):

    db = await get_db()

    try:

        cursor = await db.execute(

            """

            SELECT n.id, n.name, n.gender, n.rank

            FROM names n

            INNER JOIN swipes s ON s.name_id = n.id AND s.user_id = ? AND s.status = 1

            ORDER BY n.rank ASC

            """,

            (user_id,),

        )

        rows = await cursor.fetchall()

        return [

            {

                "id": row["id"],

                "name": row["name"],

                "gender": row["gender"],

                "rank": row["rank"],

            }

            for row in rows

        ]

    finally:

        await db.close()





@app.get("/api/matches")

async def matches(user_id: int = Query(..., ge=1)):

    db = await get_db()

    try:

        user = await _get_user_row(db, user_id)

        if user is None:

            raise HTTPException(status_code=404, detail="User not found")



        if user["partner_id"] is None:

            return {"linked": False, "matches": []}



        cursor = await db.execute(

            """

            SELECT n.id, n.name, n.gender, n.rank

            FROM names n

            INNER JOIN swipes s1 ON s1.name_id = n.id AND s1.user_id = ? AND s1.status = 1

            INNER JOIN swipes s2 ON s2.name_id = n.id AND s2.user_id = ? AND s2.status = 1

            ORDER BY n.rank ASC

            """,

            (user_id, user["partner_id"]),

        )

        rows = await cursor.fetchall()

        return {

            "linked": True,

            "matches": [

                {

                    "id": row["id"],

                    "name": row["name"],

                    "gender": row["gender"],

                    "rank": row["rank"],

                }

                for row in rows

            ],

        }

    finally:

        await db.close()





app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


