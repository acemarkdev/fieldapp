# Production time API (read-only)

For an external system that needs the time logged in the FitAWindow app: who worked on which task and job,
from when to when, how many hours, and (WEM) the time type and quantity done. **Pay rates and amounts are never returned.**

## Access

An admin creates a key in the office app: **Production time → API access → Create key** — one key per system,
optionally limited to one company (Acemark or WEM). The key (`tak_…`) is shown **once**; only its hash is stored.
**Revoke** stops it at once. "Last used" shows when the system last called.

Send the key in a header (never in the URL):

```
X-API-Key: tak_…
```
(`Authorization: Bearer tak_…` works too.)

## Request

```
GET https://office.acemark.com.pl/api/v1/time-entries?from=2026-11-01&to=2026-11-30
```

| Parameter | | |
|---|---|---|
| `from` | required | first day, `YYYY-MM-DD` (Polish time) |
| `to` | optional | last day, inclusive; default = `from`; at most 93 days after `from` |
| `company` | optional | `acemark` or `wem`; a key limited to one company always gets only that one |
| `limit` | optional | entries per page, 1–5000, default 1000 |
| `offset` | optional | for the next page: pass `next_offset` from the previous answer |

An entry belongs to the day it **starts**. Entries come oldest first.

Test copy: `https://office-test.acemark.com.pl/api/v1/time-entries` (test database, keys made on the test app).

## Answer

```json
{
  "from": "2026-11-01", "to": "2026-11-30", "company": "all", "timezone": "Europe/Warsaw",
  "total": 1834, "offset": 0, "limit": 1000, "next_offset": 1000,
  "entries": [
    {
      "id": "6f1c…", "company": "acemark", "running": false,
      "started_at": "2026-11-04T06:00:00.000Z", "ended_at": "2026-11-04T08:30:00.000Z",
      "date": "2026-11-04", "start_time": "07:00:00", "end_date": "2026-11-04", "end_time": "09:30:00",
      "duration_hours": 2.5,
      "worker": { "id": "…", "name": "Jan Kowalski", "email": "jan@…" },
      "job_ref": "Z.394", "job_key": "Z.394",
      "task": { "id": "…", "name": "Z_394_ciecie", "operation": "ciecie", "op_id": "A0002", "code": null, "station": null },
      "time_type": null, "qty_done": null,
      "note": null, "source": "app", "created_at": "2026-11-04T06:00:01.000Z"
    }
  ]
}
```

- `started_at` / `ended_at` are UTC; `date`, `start_time`, `end_date`, `end_time` are Polish local time.
- `running: true` — the worker is still on it (`ended_at` null, `duration_hours` 0). Ask again later for the final time.
- `source`: `app` (started / stopped on the phone) or `manual` (added or corrected by the manager). Entries can be
  corrected afterwards, so re-read recent days rather than only new ones.
- `time_type` (`work` / `setup` / `rework`) and `qty_done` are filled for WEM tasks.

## Errors

| Status | When |
|---|---|
| 400 | bad dates or parameters (the message says what) |
| 401 | no key, or an unknown / revoked key |
| 405 | anything but GET |
| 429 | more than 120 requests a minute (`Retry-After: 60`) |
| 500 | the server could not read the data |

Every answer is JSON with an `error` text when it fails.

## Example

```bash
curl -s -H "X-API-Key: $KEY" "https://office.acemark.com.pl/api/v1/time-entries?from=2026-11-01&to=2026-11-30&limit=5000"
```
