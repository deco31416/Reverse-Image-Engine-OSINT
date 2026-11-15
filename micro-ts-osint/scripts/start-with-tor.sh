#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  🧅 Start Tor + Node.js for Dark Web Intelligence Pipeline
#  Used by Railway (nixpacks.toml) and can be used locally on Linux/Mac
# ═══════════════════════════════════════════════════════════

echo "🧅 ═══════════════════════════════════════════════"
echo "🧅  STARTING TOR PROXY FOR DARK WEB PIPELINE"
echo "🧅 ═══════════════════════════════════════════════"

# Check if tor binary exists
if command -v tor &> /dev/null; then
    echo "✅ Tor found at: $(which tor)"
    echo "   Version: $(tor --version | head -1)"

    # Start Tor in background
    echo "🔄 Starting Tor daemon..."
    tor --RunAsDaemon 0 \
        --SocksPort 9050 \
        --SocksPolicy "accept 127.0.0.1" \
        --SocksPolicy "reject *" \
        --Log "notice stdout" \
        --DataDirectory /tmp/tor-data &

    TOR_PID=$!
    echo "   Tor PID: $TOR_PID"

    # Wait for Tor to bootstrap (max 60 seconds)
    echo "⏳ Waiting for Tor to connect to network..."
    MAX_WAIT=60
    WAITED=0
    while [ $WAITED -lt $MAX_WAIT ]; do
        # Check if Tor SOCKS port is open
        if nc -z 127.0.0.1 9050 2>/dev/null || (echo > /dev/tcp/127.0.0.1/9050) 2>/dev/null; then
            echo "✅ Tor SOCKS5 proxy ready on 127.0.0.1:9050 (${WAITED}s)"
            break
        fi
        sleep 2
        WAITED=$((WAITED + 2))
        echo "   ... waiting (${WAITED}s / ${MAX_WAIT}s)"
    done

    if [ $WAITED -ge $MAX_WAIT ]; then
        echo "⚠️  Tor did not start within ${MAX_WAIT}s — Dark Web module will be degraded"
        echo "   Pipeline steps 1,3,5 (AI) will still work, steps 2,4 (Tor) will fail gracefully"
    fi
else
    echo "⚠️  Tor binary not found — Dark Web search/scrape will be disabled"
    echo "   Pipeline steps 1,3,5 (AI) will still work"
    echo "   To fix: add 'tor' to nixPkgs in nixpacks.toml"
fi

echo ""
echo "🚀 ═══════════════════════════════════════════════"
echo "🚀  STARTING OSINT MICROSERVICE"
echo "🚀 ═══════════════════════════════════════════════"
echo ""

# Start Node.js application
exec node dist/main
