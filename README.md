# Baby Name Swiper

A Tinder-style web app for couples to swipe on baby names and discover matches. Each partner signs in with an email, swipes left or right on names from UK ONS data, and sees names you both liked.

## Features

- Swipe through ranked baby names (boys and girls)
- Sign in with email (no password)
- Invite a partner via shareable link
- View your picks and mutual matches
- Mobile-friendly UI

## Requirements

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose (recommended), **or**
- Python 3.12+ for local development

## Quick start (Docker)

```bash
git clone https://github.com/BenRutlandWeb/kinder
cd kinder
docker compose up --build
```

Open [http://localhost:8487](http://localhost:8487).

On first start, the app creates `data/babynames.db` and seeds it from the bundled sample CSVs in `sample-data/` if the names table is empty.

## Configuration

Configuration is via environment variables. In Docker Compose, set these under `environment` or in a `.env` file next to `docker-compose.yml`.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATA_DIR` | `/data` (Docker), `./data` (local) | Directory for the SQLite database (`babynames.db`) |
| `BASE_URL` | `http://localhost:8487` | Public URL of the app, used when generating partner invite links |
| `SAMPLE_DATA_DIR` | `/sample-data` or `./sample-data` | Directory containing seed CSV files (import script only) |

### `BASE_URL` for production

Invite links are built from `BASE_URL`. If you deploy behind a domain or reverse proxy, set this to the URL users actually visit:

```bash
# .env
BASE_URL=https://names.example.com
```

Then restart the container:

```bash
docker compose up -d
```

### Port mapping

The app listens on port **8000** inside the container. `docker-compose.yml` maps it to **8487** on the host:

```yaml
ports:
  - "8487:8000"
```

Change the left side to use a different host port.

## Local development (without Docker)

```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

export DATA_DIR=./data
export BASE_URL=http://localhost:8000

uvicorn app.main:app --reload --port 8000
```

Open [http://localhost:8000](http://localhost:8000).

The `data/` directory is created automatically. Database files are gitignored; names are seeded from `sample-data/` on first run.

## Importing name data

### Automatic seeding

If `babynames.db` has no names when the app starts, it imports:

- `sample-data/babynames1996to2024-Table_1.csv` (girls)
- `sample-data/babynames1996to2024-Table_2.csv` (boys)

### Manual import

Import a gov.uk / ONS-style CSV (header row starting with `Name`, year rank columns):

```bash
# Docker
docker compose run --rm babynames python scripts/import_csv.py /sample-data/babynames1996to2024-Table_1.csv F
docker compose run --rm babynames python scripts/import_csv.py /sample-data/babynames1996to2024-Table_2.csv M

# Local
python scripts/import_csv.py sample-data/babynames1996to2024-Table_1.csv F
python scripts/import_csv.py sample-data/babynames1996to2024-Table_2.csv M
```

Gender must be `F` (girls) or `M` (boys). Re-importing the same name updates its rank to the best (lowest) value seen.

### Bulk import via Compose profile

```bash
docker compose --profile import up import-girls import-boys
```

## Maintenance

### Clear user data (keep names)

Removes users, swipes, invites, and app metadata but keeps the names table:

```bash
# Docker
docker compose run --rm babynames python scripts/strip_user_data.py

# Local
python scripts/strip_user_data.py
```

### Reset everything

Stop the app, delete the database, and start again:

```bash
docker compose down
rm data/babynames.db data/babynames.db-wal data/babynames.db-shm 2>/dev/null
docker compose up --build
```

## Project structure

```
kinder/
├── app/
│   ├── main.py          # FastAPI routes and static file serving
│   └── database.py      # SQLite schema, migrations, auto-seed
├── frontend/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── scripts/
│   ├── import_csv.py    # CSV → SQLite import and seeding
│   └── strip_user_data.py
├── sample-data/         # ONS baby name CSVs (bundled)
├── data/                # Runtime database (gitignored)
├── docker-compose.yml
├── Dockerfile
└── requirements.txt
```

## API overview

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth` | Sign in or register with email |
| `GET` | `/api/me?user_id=` | Current user and partner status |
| `POST` | `/api/invite` | Create partner invite link |
| `GET` | `/api/invite/{token}` | Invite details |
| `POST` | `/api/invite/{token}/accept` | Accept invite and link accounts |
| `POST` | `/api/unlink` | Unlink from partner |
| `GET` | `/api/next-name?user_id=` | Random unswiped name |
| `POST` | `/api/swipe` | Record like (`1`) or pass (`2`) |
| `GET` | `/api/likes?user_id=` | User's liked names |
| `GET` | `/api/matches?user_id=` | Mutual likes with partner |
| `POST` | `/api/clear-picks` | Remove all of a user's likes |

The frontend is served as static files from `/`.

## Data source

Baby names come from [ONS / gov.uk baby name statistics](https://www.gov.uk/government/statistics/baby-names-in-england-and-wales) (England and Wales, 1996–2024 in the bundled files). Rank is taken from the most recent year column present in each CSV row.

## License

Add your license here if applicable.
