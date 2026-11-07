# siderail — common commands. Run inside `flox activate` (provides node,
# firefox, geckodriver).

# `just` lists recipes.
default:
    @just --list

# Install npm dev tools (web-ext, selenium).
setup:
    npm ci

# Run Firefox with the extension loaded; sites you add persist in .dev-profile/.
dev:
    npx web-ext run -s extension --firefox="$(which firefox)" \
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
