#!/bin/bash
#
# Agora: puts Agora on Heroku in the EU region. See "Going online" in README-AGORA.md.
#
#   ./agora/heroku-setup.sh             shows every step and what it costs, changes nothing
#   ./agora/heroku-setup.sh create      makes the apps, the database and the rest (costs money)
#   ./agora/heroku-setup.sh deploy      sends the branch "agora" to Heroku (Agora is then online)
#   ./agora/heroku-setup.sh domain      switches to agora.7billionpresidents.org
#   ./agora/heroku-setup.sh secret NAME [NAME ...]   copies keys from apps/backend/.env, unseen
#
# The work is done by agora/heroku-setup.mjs. This file only finds Agora's Node.
set -euo pipefail
cd "$(dirname "$0")/.."
source agora/tools.sh

if ! command -v heroku >/dev/null; then
  echo "The Heroku command line tool is missing. Install it from https://devcenter.heroku.com/articles/heroku-cli"
  exit 1
fi
exec node agora/heroku-setup.mjs "$@"
