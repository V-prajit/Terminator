#!/bin/bash
# demo-live.sh - Simple AI Overlord demo startup

set -e

echo "🎮 Starting AI Overlord Demo..."
echo "================================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Cleanup any existing processes
echo "🧹 Cleaning up..."
pkill -f "node.*server.js" 2>/dev/null || true
pkill -f "serve-demo.js" 2>/dev/null || true
pkill -f "ngrok" 2>/dev/null || true
sleep 2

# 1. Start AI server on port 8787
echo -e "${BLUE}🤖 Starting AI server on port 8787...${NC}"
cd packages/ai-server
node server.js > ai-server.log 2>&1 &
AI_PID=$!
cd ../..
echo "AI Server PID: $AI_PID"

# Wait for AI server
echo "⏳ Waiting for AI server..."
for i in {1..20}; do
    if curl -s http://localhost:8787/health | grep -q '"ok":true'; then
        echo -e "${GREEN}✅ AI server running${NC}"
        break
    fi
    sleep 1
    if [ $i -eq 20 ]; then
        echo -e "${RED}❌ AI server failed to start${NC}"
        cat packages/ai-server/ai-server.log
        exit 1
    fi
done

# 2. Start demo server on port 3000
echo -e "${BLUE}🌐 Starting demo server on port 3000...${NC}"
cd packages/ai-server
STATIC_ROOT="../game" node serve-demo.js > demo-server.log 2>&1 &
DEMO_PID=$!
cd ../..
echo "Demo Server PID: $DEMO_PID"

# Wait for demo server
echo "⏳ Waiting for demo server..."
for i in {1..15}; do
    if curl -s http://localhost:3000/_demohealth > /dev/null; then
        echo -e "${GREEN}✅ Demo server running${NC}"
        break
    fi
    sleep 1
    if [ $i -eq 15 ]; then
        echo -e "${RED}❌ Demo server failed to start${NC}"
        cat packages/ai-server/demo-server.log
        exit 1
    fi
done

# 3. Start ngrok tunnel
echo -e "${BLUE}🌍 Starting ngrok tunnel...${NC}"
ngrok http 3000 --log=stdout > ngrok.log 2>&1 &
NGROK_PID=$!

# Wait for ngrok URL
echo "⏳ Getting ngrok URL..."
sleep 5
NGROK_URL=""
for i in {1..10}; do
    if [ -f ngrok.log ]; then
        NGROK_URL=$(grep -o 'https://[a-zA-Z0-9.-]*\.ngrok-free\.app' ngrok.log | head -1)
        if [ ! -z "$NGROK_URL" ]; then
            break
        fi
    fi
    sleep 1
done

if [ -z "$NGROK_URL" ]; then
    echo -e "${RED}❌ Failed to get ngrok URL${NC}"
    cat ngrok.log
    exit 1
fi

echo -e "${GREEN}✅ Ngrok tunnel: $NGROK_URL${NC}"

# Output URLs
echo ""
echo -e "${GREEN}🎉 DEMO IS READY!${NC}"
echo "==================="
echo -e "${YELLOW}Dashboard URL:${NC} $NGROK_URL/dashboard.html"
echo -e "${YELLOW}Mobile URL:${NC} $NGROK_URL/mobile.html"
echo -e "${YELLOW}Local AI Server:${NC} http://localhost:8787"
echo -e "${YELLOW}Local Demo Server:${NC} http://localhost:3000"
echo ""
echo -e "${BLUE}📝 Next Steps:${NC}"
echo "1. Add ?room=YOUR_ROOM_ID to dashboard URL"
echo "2. Add ?room=YOUR_ROOM_ID to mobile URL"
echo "3. Create QR code from mobile URL"
echo ""
echo -e "${YELLOW}To stop: pkill -f 'node|ngrok'${NC}"

# Save PIDs for cleanup
echo "$AI_PID" > .demo-pids
echo "$DEMO_PID" >> .demo-pids
echo "$NGROK_PID" >> .demo-pids

# Keep running
echo "Press Ctrl+C to stop..."
trap 'echo "Stopping..."; kill $(cat .demo-pids) 2>/dev/null; rm .demo-pids; exit' INT

while true; do
    sleep 5
    echo "$(date +%H:%M:%S) - Services running..."
done