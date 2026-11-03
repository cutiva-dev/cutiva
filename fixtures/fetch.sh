#!/bin/sh
# Download the real test videos listed in fixtures/manifest.json into fixtures/videos/ and check
# each against its pinned SHA-256. Files already present with the right hash are skipped.
# Needs node and curl. The videos are never committed (fixtures/.gitignore).
set -eu
cd "$(dirname "$0")"
mkdir -p videos

sha256() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

node -e '
  const m = require("./manifest.json");
  for (const v of m.videos) {
    if (!/^[a-z0-9-]+$/.test(v.name) || !/^https:\/\//.test(v.url) || !/^[0-9a-f]{64}$/.test(v.sha256)) {
      console.error("Bad manifest entry: " + JSON.stringify(v)); process.exit(1);
    }
    console.log([v.name, v.url, v.sha256].join("\t"));
  }
' > videos/.list

count=0
while IFS="$(printf '\t')" read -r name url hash; do
  file="videos/$name.mp4"
  if [ -f "$file" ] && [ "$(sha256 "$file")" = "$hash" ]; then
    echo "ok       $name"
  else
    echo "fetching $name"
    curl -fsSL --retry 3 -o "$file.part" "$url"
    got="$(sha256 "$file.part")"
    if [ "$got" != "$hash" ]; then
      rm -f "$file.part"
      echo "SHA-256 mismatch for $name: expected $hash, got $got" >&2
      exit 1
    fi
    mv "$file.part" "$file"
  fi
  count=$((count + 1))
done < videos/.list
rm -f videos/.list
echo "$count video(s) ready in fixtures/videos/"
