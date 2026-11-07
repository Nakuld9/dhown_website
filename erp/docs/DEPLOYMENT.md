# Deployment, Operations & Recovery

Covers installation, configuration, backups/recovery, and upgrades for the
Textile ERP. The web UI is served by the backend at `/app/`; the interactive
API documentation (Swagger) is at `/docs`.

## 1. Requirements

- **Docker** + Docker Compose (recommended), or
- **Python 3.11+** and **PostgreSQL 16** for a manual install.

## 2. Deploy with Docker (recommended)

```bash
cd erp
cp backend/.env.example backend/.env      # then edit (see §4)
docker compose up --build -d
```

This starts PostgreSQL and the API. The API container waits for the database,
runs `alembic upgrade head`, seeds baseline data idempotently, then serves
uvicorn on port 8000.

- API + UI: `http://<host>:8000/app/`
- API docs: `http://<host>:8000/docs`
- Health: `http://<host>:8000/health`

Put a TLS-terminating reverse proxy (nginx/Caddy/ALB) in front for production,
and restrict the Postgres port to the internal network.

## 3. Manual install

```bash
cd erp/backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL="postgresql+psycopg2://erp:erp@localhost:5432/erp"
export SECRET_KEY="$(python -c 'import secrets;print(secrets.token_urlsafe(48))')"
alembic upgrade head        # create schema
python -m app.seed.seed     # seed COA, roles, admin, periods, posting rules
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Run behind a process manager (systemd, supervisor) and a reverse proxy. For
throughput, run multiple workers: `uvicorn ... --workers 4` or
`gunicorn -k uvicorn.workers.UvicornWorker app.main:app`.

## 4. Configuration (environment variables)

Set in `backend/.env` (Docker reads it; export them for a manual install). See
`backend/.env.example`.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL DSN. **Required in production.** |
| `SECRET_KEY` | JWT signing key — a long random value. **Rotate for production.** |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | JWT lifetime (default 480 = one shift). |
| `DEFAULT_TIMEZONE` / `DEFAULT_CURRENCY` | `Asia/Kolkata` / `INR`. |
| `FISCAL_YEAR_START_MONTH` | `4` (April). |
| `ERP_ADMIN_USERNAME/PASSWORD/EMAIL` | Superuser created by the seeder. **Change the password.** |

Never commit real secrets. The seeded demo admin (`admin`/`admin123`) is for
development only — change it before any real use.

## 5. Database migrations

The ORM models are the source of truth; migrations live in `backend/alembic`.

```bash
alembic upgrade head                         # apply
alembic revision --autogenerate -m "change"  # after editing models
alembic downgrade -1                          # roll back one
```

The baseline migration builds the full schema from metadata; subsequent changes
emit explicit operations.

## 6. Backups & recovery

**What to back up:** the PostgreSQL database holds *all* authoritative data
(ledger, inventory, documents, audit log). The container filesystem is
disposable.

**Scheduled logical backup** (nightly, keep ≥30 days off-host):
```bash
pg_dump --format=custom --no-owner "$DATABASE_URL" > erp-$(date +%F).dump
# Docker: docker compose exec -T db pg_dump -U erp -Fc erp > erp-$(date +%F).dump
```

**Restore** into a fresh database:
```bash
createdb erp_restore
pg_restore --no-owner --dbname erp_restore erp-2026-11-07.dump
# point DATABASE_URL at erp_restore and start the API
```

**Point-in-time recovery:** for stricter RPO, enable Postgres WAL archiving
(`archive_mode=on`) or use your managed database's PITR. Test a restore
regularly — a backup you have never restored is not a backup.

**Integrity after restore:** sign in and open **Reports → Trial Balance** (must
balance), **Stock vs GL Reconciliation** (must reconcile), and the GST
reconciliation — these confirm the ledger and sub-ledgers are consistent.

## 7. Upgrades

1. Back up the database (§6).
2. Pull the new code.
3. `docker compose up --build -d` (or reinstall deps) — the entrypoint runs
   `alembic upgrade head` automatically; for a manual install run it yourself.
4. Verify `/health`, then the three reconciliation reports.

Rebuild the UI bundle only if `frontend/app.src.jsx` changed:
`cd erp/frontend && ./build-ui.sh` (needs npm). The committed `app.js` and
`vendor/` mean the UI runs with no build step otherwise.

## 8. Monitoring & logs

- `GET /health` for liveness.
- Container/uvicorn stdout for request logs; ship to your log stack.
- The append-only `audit_logs` table records every posting, reversal and login.
- Integration events (`integration_events`) record each Color Service exchange
  with status for reconciliation.

## 9. Security checklist

- [ ] Strong, rotated `SECRET_KEY`; TLS in front of the API.
- [ ] Changed the seeded admin password; least-privilege roles per user (§
      Administrator guide in `USER_GUIDE.md`).
- [ ] Database not publicly reachable; backups encrypted and off-host.
- [ ] Posted ledger immutability and period locks are enforced in-app; do not
      grant raw database write access to end users.
