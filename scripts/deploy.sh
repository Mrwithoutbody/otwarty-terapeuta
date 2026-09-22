#!/bin/sh
# Produkcja: tylko czyste, wypchnięte origin/main; jeden deploy naraz na tej maszynie.
set -eu
exec 9>/tmp/ot-02-deploy.lock; flock 9
[ -z "$(git status --porcelain)" ] || { echo 'Brudne drzewo: commit + push przed deployem.' >&2; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo 'HEAD != origin/main: git rebase origin/main (albo push) i ponów.' >&2; exit 1; }
npm ci
d=$(ls migrations | cut -d_ -f1 | uniq -d); [ -z "$d" ] || { echo "Zdublowany numer migracji: $d" >&2; exit 1; }
npm run typecheck
npm test
npm run db:migrate:prod
npm run build:widget
npx wrangler deploy --env production --message "$(git rev-parse --short HEAD)"
