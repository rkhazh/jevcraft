#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077
command -v uv >/dev/null
command -v node >/dev/null
npm ci --ignore-scripts
uv venv --python 3.11 .tolik/venv
uv pip install --python .tolik/venv/bin/python -r tolik/requirements.txt
if [ ! -d .tolik/hermes-source/.git ]; then
  git clone https://github.com/NousResearch/hermes-agent.git .tolik/hermes-source
fi
git -C .tolik/hermes-source checkout --detach 6b21d0564de0492e2ebd0d8f63fca86c03b5c892
(cd .tolik/hermes-source && uv sync --python 3.14 --no-dev --no-default-groups --frozen)
printf '%s\n' 'Installed. Follow tolik/README.md for subscription login and configuration.'
