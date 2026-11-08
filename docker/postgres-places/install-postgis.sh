#!/bin/sh
set -eu

# The upstream postgres Debian image configures the PostgreSQL apt repository,
# which provides these packages for both amd64 and arm64.
apt-get update
apt-get install -y --no-install-recommends \
  "postgresql-${PG_MAJOR}-postgis-3" \
  "postgresql-${PG_MAJOR}-postgis-3-scripts"
rm -rf /var/lib/apt/lists/*
