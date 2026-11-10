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

# Regenerate the README screenshots from docs/screenshots.json (needs internet
# for the icons). `just screenshots editor` redoes only matching shots.
screenshots *shot: build
    node scripts/screenshots.js {{shot}}
