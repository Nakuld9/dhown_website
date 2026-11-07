#!/usr/bin/env bash
# Regenerate the self-contained SPA assets:
#   1. install the pinned libraries from npm
#   2. copy their UMD builds into vendor/ (no runtime CDN dependency)
#   3. precompile app.src.jsx -> app.js (no in-browser Babel)
#
# Only needed when app.src.jsx or the library versions change. The generated
# vendor/*.js and app.js are committed so the UI runs with no build step.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
cd "$TMP"

npm init -y >/dev/null 2>&1
npm install --no-audit --no-fund \
  react@18.3.1 react-dom@18.3.1 prop-types@15.8.1 recharts@2.12.7 \
  @babel/core@7.26.0 @babel/preset-react@7.25.9

cp node_modules/react/umd/react.production.min.js         "$HERE/vendor/react.js"
cp node_modules/react-dom/umd/react-dom.production.min.js  "$HERE/vendor/react-dom.js"
cp node_modules/prop-types/prop-types.min.js              "$HERE/vendor/prop-types.js"
cp node_modules/recharts/umd/Recharts.js                  "$HERE/vendor/recharts.js"

node -e "
const babel=require('@babel/core'), fs=require('fs');
const src=fs.readFileSync('$HERE/app.src.jsx','utf8');
const out=babel.transformSync(src,{presets:[['@babel/preset-react']],compact:false}).code;
fs.writeFileSync('$HERE/app.js','// AUTO-GENERATED from app.src.jsx by build-ui.sh — do not edit directly.\n'+out);
"
echo "UI assets rebuilt in $HERE"
rm -rf "$TMP"
