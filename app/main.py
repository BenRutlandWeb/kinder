import os

import re

import secrets

from contextlib import asynccontextmanager

from pathlib import Path



from fastapi import FastAPI, HTTPException, Query

from fastapi.staticfiles import StaticFiles

from pydantic import BaseModel, Field, field_validator, model_validator



from app.database import get_db, init_db



FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

BASE_URL = os.environ.get("BASE_URL", "http://localhost:9000")



EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")





@asynccontextmanager

async def lifespan(_: FastAPI):

    await init_db()

    yield





app = FastAPI(title="Kinder", lifespan=lifespan)





class SwipeRequest(BaseModel):

    user_id: int = Field(..., ge=1)

    name_id: int | None = Field(None, ge=1)

    custom_id: int | None = Field(None, ge=1)

    status: int = Field(..., ge=1, le=2)



    @model_validator(mode="after")

    def require_name_or_custom(self):

        if self.name_id is None and self.custom_id is None:

            raise ValueError("Either name_id or custom_id is required")

        if self.name_id is not None and self.custom_id is not None:

            raise ValueError("Provide only one of name_id or custom_id")

        return self





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





class RecommendRequest(BaseModel):

    user_id: int = Field(..., ge=1)

    name: str = Field(..., min_length=1, max_length=100)

    gender: str = Field(..., pattern=r"^[MF]$")



    @field_validator("name")

    @classmethod

    def normalize_name(cls, value: str) -> str:

        return value.strip().title()





async def _recommender_already_sent(db, recommender_id: int, name: str) -> bool:

    cursor = await db.execute(

        """

        SELECT 1 FROM custom_recommendations

        WHERE recommender_id = ? AND name = ? COLLATE NOCASE

        LIMIT 1

        """,

        (recommender_id, name),

    )

    if await cursor.fetchone() is not None:

        return True



    cursor = await db.execute(

        """

        SELECT 1

        FROM recommendations r

        INNER JOIN names n ON n.id = r.name_id

        WHERE r.recommender_id = ? AND n.name = ? COLLATE NOCASE

        LIMIT 1

        """,

        (recommender_id, name),

    )

    return await cursor.fetchone() is not None


async def _user_already_liked_name(db, user_id: int, name: str) -> bool:
    cursor = await db.execute(
        """
        SELECT 1 FROM user_custom_picks
        WHERE user_id = ? AND name = ? COLLATE NOCASE
        LIMIT 1
        """,
        (user_id, name),
    )
    if await cursor.fetchone() is not None:
        return True

    cursor = await db.execute(
        """
        SELECT 1
        FROM swipes s
        INNER JOIN names n ON n.id = s.name_id
        WHERE s.user_id = ? AND s.status = 1 AND n.name = ? COLLATE NOCASE
        LIMIT 1
        """,
        (user_id, name),
    )
    return await cursor.fetchone() is not None


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

        await db.execute(

            """

            DELETE FROM recommendations

            WHERE recipient_id IN (?, ?) OR recommender_id IN (?, ?)

            """,

            (body.user_id, partner_id, body.user_id, partner_id),

        )

        await db.execute(

            """

            DELETE FROM custom_recommendations

            WHERE recipient_id IN (?, ?) OR recommender_id IN (?, ?)

            """,

            (body.user_id, partner_id, body.user_id, partner_id),

        )

        await db.commit()



        return {"ok": True}

    finally:

        await db.close()





def _format_next_name(row) -> dict:

    return {

        "id": row["id"],

        "name": row["name"],

        "gender": row["gender"],

        "rank": row["rank"],

        "custom": row["source"] == "custom",

    }





@app.get("/api/next-name")

async def next_name(user_id: int = Query(..., ge=1)):

    db = await get_db()

    try:

        cursor = await db.execute(

            """

            SELECT 'custom' AS source, cr.id AS id, cr.name AS name,

                   cr.gender AS gender, NULL AS rank, cr.created_at

            FROM custom_recommendations cr

            WHERE cr.recipient_id = ?

              AND cr.id NOT IN (

                  SELECT cs.custom_recommendation_id

                  FROM custom_swipes cs WHERE cs.user_id = ?

              )

            UNION ALL

            SELECT 'db' AS source, n.id AS id, n.name AS name,

                   n.gender AS gender, n.rank AS rank, r.created_at

            FROM recommendations r

            INNER JOIN names n ON n.id = r.name_id

            WHERE r.recipient_id = ?

              AND n.id NOT IN (

                  SELECT s.name_id FROM swipes s WHERE s.user_id = ?

              )

            ORDER BY created_at DESC

            LIMIT 1

            """,

            (user_id, user_id, user_id, user_id),

        )

        row = await cursor.fetchone()

        if row is None:

            cursor = await db.execute(

                """

                SELECT 'db' AS source, n.id AS id, n.name AS name,

                       n.gender AS gender, n.rank AS rank, NULL AS created_at

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

        return _format_next_name(row)

    finally:

        await db.close()





@app.post("/api/swipe")

async def swipe(body: SwipeRequest):

    db = await get_db()

    try:

        cursor = await db.execute("SELECT id FROM users WHERE id = ?", (body.user_id,))

        if await cursor.fetchone() is None:

            raise HTTPException(status_code=404, detail="User not found")



        if body.custom_id is not None:

            cursor = await db.execute(

                """

                SELECT id, name, gender FROM custom_recommendations

                WHERE id = ? AND recipient_id = ?

                """,

                (body.custom_id, body.user_id),

            )

            custom_row = await cursor.fetchone()

            if custom_row is None:

                raise HTTPException(status_code=404, detail="Recommendation not found")



            await db.execute(

                """

                INSERT INTO custom_swipes (user_id, custom_recommendation_id, status)

                VALUES (?, ?, ?)

                ON CONFLICT(user_id, custom_recommendation_id)

                DO UPDATE SET status = excluded.status

                """,

                (body.user_id, body.custom_id, body.status),

            )



            if body.status == 1:

                await db.execute(

                    """

                    INSERT INTO user_custom_picks (user_id, name, gender)

                    VALUES (?, ?, ?)

                    ON CONFLICT(user_id, name) DO UPDATE SET gender = excluded.gender

                    """,

                    (body.user_id, custom_row["name"], custom_row["gender"]),

                )

        else:

            cursor = await db.execute(

                "SELECT id FROM names WHERE id = ?", (body.name_id,)

            )

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

        deleted = cursor.rowcount

        await db.execute(

            "DELETE FROM user_custom_picks WHERE user_id = ?",

            (body.user_id,),

        )

        await db.commit()

        return {"ok": True, "deleted": deleted}

    finally:

        await db.close()





@app.get("/api/names/search")

async def search_names(

    q: str = Query(..., min_length=1, max_length=100),

    limit: int = Query(10, ge=1, le=20),

):

    db = await get_db()

    try:

        cursor = await db.execute(

            """

            SELECT id, name, gender, rank

            FROM names

            WHERE name LIKE ? COLLATE NOCASE

            ORDER BY rank ASC

            LIMIT ?

            """,

            (f"%{q.strip()}%", limit),

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





@app.post("/api/recommend")

async def recommend(body: RecommendRequest):

    db = await get_db()

    try:

        user = await _get_user_row(db, body.user_id)

        if user is None:

            raise HTTPException(status_code=404, detail="User not found")



        cursor = await db.execute(

            """

            SELECT id FROM names

            WHERE name = ? COLLATE NOCASE AND gender = ?

            ORDER BY rank ASC

            LIMIT 1

            """,

            (body.name, body.gender),

        )

        name_row = await cursor.fetchone()



        if user["partner_id"] is None:

            if await _user_already_liked_name(db, body.user_id, body.name):

                raise HTTPException(

                    status_code=409, detail="You already have this name in your picks"

                )



            if name_row is not None:

                await db.execute(

                    """

                    INSERT INTO swipes (user_id, name_id, status)

                    VALUES (?, ?, 1)

                    ON CONFLICT(user_id, name_id) DO UPDATE SET status = 1

                    """,

                    (body.user_id, name_row["id"]),

                )

            else:

                await db.execute(

                    """

                    INSERT INTO user_custom_picks (user_id, name, gender)

                    VALUES (?, ?, ?)

                    ON CONFLICT(user_id, name) DO UPDATE SET gender = excluded.gender

                    """,

                    (body.user_id, body.name, body.gender),

                )



            await db.commit()

            return {"ok": True}



        partner_id = user["partner_id"]



        if await _recommender_already_sent(db, body.user_id, body.name):

            raise HTTPException(

                status_code=409, detail="You already recommended this name"

            )



        if name_row is not None:

            name_id = name_row["id"]

            await db.execute(

                """

                INSERT INTO recommendations (recipient_id, name_id, recommender_id)

                VALUES (?, ?, ?)

                """,

                (partner_id, name_id, body.user_id),

            )

            await db.execute(

                """

                INSERT INTO swipes (user_id, name_id, status)

                VALUES (?, ?, 1)

                ON CONFLICT(user_id, name_id) DO UPDATE SET status = 1

                """,

                (body.user_id, name_id),

            )

            await db.execute(

                """

                DELETE FROM custom_recommendations

                WHERE recipient_id = ? AND name = ? COLLATE NOCASE

                """,

                (partner_id, body.name),

            )

        else:

            await db.execute(

                """

                INSERT INTO custom_recommendations

                    (recipient_id, recommender_id, name, gender)

                VALUES (?, ?, ?, ?)

                """,

                (partner_id, body.user_id, body.name, body.gender),

            )

            await db.execute(

                """

                INSERT INTO user_custom_picks (user_id, name, gender)

                VALUES (?, ?, ?)

                ON CONFLICT(user_id, name) DO UPDATE SET gender = excluded.gender

                """,

                (body.user_id, body.name, body.gender),

            )

        await db.commit()

        return {"ok": True}

    finally:

        await db.close()





@app.get("/api/recommendations")

async def recommendations(user_id: int = Query(..., ge=1)):

    db = await get_db()

    try:

        cursor = await db.execute(

            """

            SELECT n.id, n.name, n.gender, n.rank, r.created_at, 0 AS custom

            FROM recommendations r

            INNER JOIN names n ON n.id = r.name_id

            WHERE r.recommender_id = ?

            UNION ALL

            SELECT cr.id, cr.name, cr.gender AS gender, NULL AS rank, cr.created_at, 1 AS custom

            FROM custom_recommendations cr

            WHERE cr.recommender_id = ?

            ORDER BY created_at DESC

            """,

            (user_id, user_id),

        )

        rows = await cursor.fetchall()

        return [

            {

                "id": row["id"],

                "name": row["name"],

                "gender": row["gender"],

                "rank": row["rank"],

                "custom": bool(row["custom"]),

            }

            for row in rows

        ]

    finally:

        await db.close()





@app.get("/api/likes")

async def likes(user_id: int = Query(..., ge=1)):

    db = await get_db()

    try:

        cursor = await db.execute(

            """

            SELECT id, name, gender, rank

            FROM (

                SELECT n.id, n.name, n.gender, n.rank

                FROM names n

                INNER JOIN swipes s ON s.name_id = n.id AND s.user_id = ? AND s.status = 1



                UNION ALL



                SELECT NULL AS id, name, gender, NULL AS rank

                FROM user_custom_picks

                WHERE user_id = ?

            )

            ORDER BY rank IS NULL, rank ASC, name ASC

            """,

            (user_id, user_id),

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



        partner_id = user["partner_id"]

        cursor = await db.execute(

            """

            SELECT n.id, n.name, n.gender, n.rank

            FROM names n

            INNER JOIN swipes s1 ON s1.name_id = n.id AND s1.user_id = ? AND s1.status = 1

            INNER JOIN swipes s2 ON s2.name_id = n.id AND s2.user_id = ? AND s2.status = 1



            UNION



            SELECT n.id, n.name, n.gender, n.rank

            FROM recommendations r

            INNER JOIN names n ON n.id = r.name_id

            INNER JOIN swipes s ON s.name_id = n.id AND s.user_id = r.recipient_id AND s.status = 1

            WHERE (r.recommender_id = ? AND r.recipient_id = ?)

               OR (r.recommender_id = ? AND r.recipient_id = ?)



            UNION



            SELECT cr.id AS id, cr.name AS name, cr.gender AS gender, NULL AS rank

            FROM custom_recommendations cr

            INNER JOIN custom_swipes cs

                ON cs.custom_recommendation_id = cr.id

               AND cs.user_id = cr.recipient_id

               AND cs.status = 1

            WHERE (cr.recommender_id = ? AND cr.recipient_id = ?)

               OR (cr.recommender_id = ? AND cr.recipient_id = ?)



            ORDER BY rank ASC, name ASC

            """,

            (

                user_id,

                partner_id,

                user_id,

                partner_id,

                partner_id,

                user_id,

                user_id,

                partner_id,

                partner_id,

                user_id,

            ),

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


