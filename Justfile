# siderail — common commands. Needs node, firefox and geckodriver on PATH;
# set FIREFOX_BIN to use another Firefox.

# `just` lists recipes.
default:
    @just --list

# Install npm dev tools (web-ext, selenium).
setup:
    npm ci

# Run Firefox with the extension loaded; sites you add persist in .dev-profile/.
dev:
    npx web-ext run -s extension --firefox="${FIREFOX_BIN:-$(which firefox)}" \
        --profile-create-if-missing --keep-profile-changes -p .dev-profile \
        --start-url about:blank

# Check the extension the way addons.mozilla.org will.
lint:
    npx web-ext lint -s extension

# Unit tests for the pure logic in extension/lib.
test:
    node --test 'test/unit/*.test.js'

# Package the extension as dist/siderail.xpi (unsigned).
build:
    npx web-ext build -s extension -a dist --filename siderail.xpi --overwrite-dest

# End-to-end tests: the built extension in headless Firefox against local fixture sites.
e2e: build
    node --test --test-concurrency=1 'test/e2e/*.test.js'

# Everything CI would run.
check: lint test e2e

# Needs internet for the icons. `just screenshots editor` redoes only the
# shots whose file name contains "editor".
[doc("Regenerate the README and AMO screenshots from docs/screenshots.json")]
screenshots *shot: build
    node scripts/screenshots.js {{shot}}

# Sets the version in the manifest, runs every check, commits and makes an
# annotated tag whose message is the release notes. Nothing is pushed;
# pushing the tag makes CI submit it to addons.mozilla.org.
[doc("Prepare a release: just release 1.2.3 \"What changed\"")]
release version $notes:
    #!/usr/bin/env bash
    set -euo pipefail
    [[ "{{version}}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "The version must look like 1.2.3." >&2; exit 1; }
    [[ -z "$(git status --porcelain)" ]] || { echo "Commit or stash your changes first." >&2; exit 1; }
    ! git rev-parse -q --verify "refs/tags/v{{version}}" >/dev/null || { echo "v{{version}} is already tagged." >&2; exit 1; }
    sed -i -E 's/^(  "version": )"[^"]*"/\1"{{version}}"/' extension/manifest.json
    [[ "$(node -p 'require("./extension/manifest.json").version')" == "{{version}}" ]]
    just check
    git diff --quiet || git commit -qam "Release v{{version}}"
    git tag -a "v{{version}}" -m "$notes"
    echo "Tagged v{{version}}. To publish: git push origin main v{{version}}"

# The listing text comes from release/amo-metadata.json and is sent with
# every version. Needs WEB_EXT_API_KEY and WEB_EXT_API_SECRET.
[doc("Submit to addons.mozilla.org for review (CI does this for each v* tag)")]
amo-submit $notes="": amo-check
    mkdir -p dist
    node -e 'const m = require("./release/amo-metadata.json"); if (process.env.notes) m.version.release_notes = { "en-US": process.env.notes }; console.log(JSON.stringify(m, null, 2))' > dist/amo-metadata.json
    npx web-ext sign -s extension -a dist --channel listed --approval-timeout 0 --amo-metadata dist/amo-metadata.json

# Asks AMO whose they are; submits nothing and prints no secrets.
[doc("Check the AMO API keys in WEB_EXT_API_KEY and WEB_EXT_API_SECRET")]
amo-check:
    node scripts/amo-credentials.js

# Asks for the key and secret (from https://addons.mozilla.org/developers/addon/api/key/),
# removes stray whitespace, checks them with AMO, and only then sets them as
# the AMO_API_KEY and AMO_API_SECRET secrets that the release workflow uses.
[doc("Check AMO API keys, then save them as this repo's GitHub secrets")]
amo-secrets:
    #!/usr/bin/env bash
    set -euo pipefail
    read -rp "JWT issuer: " key
    read -rsp "JWT secret: " secret; echo
    export WEB_EXT_API_KEY="$(printf %s "$key" | tr -d '[:space:]')"
    export WEB_EXT_API_SECRET="$(printf %s "$secret" | tr -d '[:space:]')"
    node scripts/amo-credentials.js
    printf %s "$WEB_EXT_API_KEY" | gh secret set AMO_API_KEY
    printf %s "$WEB_EXT_API_SECRET" | gh secret set AMO_API_SECRET

# Uses WEB_EXT_API_KEY and WEB_EXT_API_SECRET; the amo-screenshots workflow
# runs this with the repository's secrets instead.
[doc("Replace the AMO listing's screenshots with release/screenshots/")]
amo-screenshots: amo-check
    node scripts/amo-screenshots.js
