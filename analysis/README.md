# Analysis pipeline

This folder is for *derived* (aggregated) datasets and analysis artifacts.  
Raw GitHub data stays in the local SQLite DB via Prisma.

## Export the panel

Generate a user‑month panel suitable for event‑study / diff‑in‑diff:

```bash
node scripts/export-panel.mjs --db file:./prisma/dev_v1.db --out analysis/user_month_panel.csv
```

Optional flags:

- `--start YYYY-MM-DD` and `--end YYYY-MM-DD`
- `--out path/to/file.csv`

The output includes:

- per‑user monthly contributions (from contribution calendars)
- active days per month
- repo‑level monthly PR merge time and issue resolution time (as context controls)

## Next steps

We’ll add:

- AI adoption labels (PR5) to join to this panel.
- causal models (event‑study / diff‑in‑diff) plus robustness checks.
