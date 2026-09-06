#!/usr/bin/env bash
# Deploy: brakujące migracje D1 → build → wrangler deploy.
#
# `wrangler d1 migrations apply` idzie przez API /query, które na tym koncie
# odpowiada 7403. `d1 execute --file` idzie przez /import i działa. Skrypt
# wgrywa więc każdą migrację plikiem i dopisuje ją do d1_migrations, żeby
# wrangler wiedział, co już jest. Listę wgranych trzyma migrations/APPLIED.
#
# Użycie: scripts/deploy.sh   (produkcja; ENV=preview dla podglądu)
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${DB:-DB}"
ENV_FLAG=(--env "${ENV:-production}")
APPLIED=migrations/APPLIED
touch "$APPLIED"
for f in migrations/*.sql; do
  name=$(basename "$f")
  grep -qx "$name" "$APPLIED" && continue
  echo "→ migracja $name"
  tmp=$(mktemp)
  {
    echo "CREATE TABLE IF NOT EXISTS d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);"
    cat "$f"
    echo
    echo "INSERT INTO d1_migrations(name, applied_at) VALUES('$name', CURRENT_TIMESTAMP);"
  } > "$tmp"
  npx wrangler d1 execute "$DB" "${ENV_FLAG[@]}" --remote --file "$tmp" > /dev/null
  rm "$tmp"
  echo "$name" >> "$APPLIED"
done
echo "→ build"
npm run build --silent
echo "→ deploy"
npx wrangler deploy "${ENV_FLAG[@]}" | tail -4
