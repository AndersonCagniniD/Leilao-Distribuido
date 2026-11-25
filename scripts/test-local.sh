#!/usr/bin/env sh
set -eu
curl -fsS http://localhost:8080/api/cluster
printf '\n'
curl -fsS http://localhost:8080/api/auctions
printf '\n'
