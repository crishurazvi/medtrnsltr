#!/usr/bin/env bash
set -euo pipefail

rm -rf dist
mkdir -p dist/js

cp index.html styles.css dist/
cp js/*.js dist/js/

# Marker util dacă repo-ul este deschis și prin GitHub Pages.
touch dist/.nojekyll

echo "Build finalizat: fișierele statice sunt în ./dist"
