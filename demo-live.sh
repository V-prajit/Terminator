#!/bin/bash
# demo-live.sh - One-click AI Overlord demo for PennHacks judges
# Run this script to start everything and get QR codes for judges

set -e

echo "🚀 Starting AI Overlord Demo for PennHacks..."
echo "================================================"

# Colors for terminal output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Kill any existing processes
echo -e "${YELLOW}🧹 Cleaning up existing processes...${NC}"
pkill -f "node server.js" || true
pkill -f "serve-demo.js" || true
pkill -f "ngrok" || true
sleep 2

# Start AI server in background
echo -e "${BLUE}🤖 Starting AI server on port 8787...${NC}"
cd packages/ai-server
nohup node server.js > ai-server.log 2>&1 &
AI_PID=$!
echo "AI Server PID: $AI_PID"

# Wait for AI server to start
sleep 3
if curl -s http://localhost:8787/health > /dev/null; then
    echo -e "${GREEN}✅ AI server is running${NC}"
else
    echo -e "${RED}❌ AI server failed to start${NC}"
    exit 1
fi

# Start demo proxy server in background
echo -e "${PURPLE}🌐 Starting demo proxy server on port 3000...${NC}"
STATIC_ROOT="../game" nohup node serve-demo.js > demo-server.log 2>&1 &
DEMO_PID=$!
echo "Demo Server PID: $DEMO_PID"

# Wait for demo server to start
sleep 3
if curl -s http://localhost:3000/_demohealth > /dev/null; then
    echo -e "${GREEN}✅ Demo server is running${NC}"
else
    echo -e "${RED}❌ Demo server failed to start${NC}"
    exit 1
fi

# Start ngrok tunnel
echo -e "${CYAN}🌍 Creating ngrok tunnel...${NC}"
nohup ngrok http 3000 --log=stdout > ngrok.log 2>&1 &
NGROK_PID=$!
echo "Ngrok PID: $NGROK_PID"

# Wait for ngrok to start and extract URL
echo "⏳ Waiting for ngrok tunnel..."
sleep 5

# Extract ngrok URL from log
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
    echo "Ngrok log contents:"
    cat ngrok.log || echo "No ngrok log found"
    exit 1
fi

GAME_URL="${NGROK_URL}/mobile.html"

echo -e "${GREEN}✅ Ngrok tunnel created: $NGROK_URL${NC}"

# Install qrencode if not available
if ! command -v qrencode &> /dev/null; then
    echo -e "${YELLOW}📦 Installing qrencode for terminal QR codes...${NC}"
    if command -v brew &> /dev/null; then
        brew install qrencode
    else
        echo -e "${YELLOW}⚠️  brew not found, skipping terminal QR code${NC}"
    fi
fi

# Generate QR code image
echo -e "${CYAN}📱 Generating QR code...${NC}"
curl -s "https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=$GAME_URL" -o demo-qr.png
echo -e "${GREEN}✅ QR code saved as demo-qr.png${NC}"

# Open QR code image
open demo-qr.png &

# Display terminal QR code if available
if command -v qrencode &> /dev/null; then
    echo -e "\n${PURPLE}📱 SCAN THIS QR CODE:${NC}"
    echo "===================="
    qrencode -t ANSI256 "$GAME_URL"
    echo "===================="
fi

# Display all the info
echo -e "\n${GREEN}🎉 AI OVERLORD DEMO IS LIVE!${NC}"
echo "=============================================="
echo -e "${YELLOW}📱 MOBILE GAME URL:${NC} $GAME_URL"
echo -e "${YELLOW}🌐 NGROK DASHBOARD:${NC} http://localhost:4040"
echo -e "${YELLOW}🤖 AI SERVER:${NC} http://localhost:8787"
echo -e "${YELLOW}🎮 DEMO SERVER:${NC} http://localhost:3000"
echo ""
echo -e "${CYAN}📋 FOR JUDGES:${NC}"
echo "1. Scan the QR code that just opened"
echo "2. Or visit: $GAME_URL"
echo "3. Tap to start, swipe to dodge!"
echo ""
echo -e "${PURPLE}🎯 DEMO PITCH:${NC}"
echo '"Scan this QR code to try our AI Overlord game!"'
echo '"The AI analyzes your movement patterns and predicts"'
echo '"where you'\''ll dodge next using Cerebras for ultra-fast inference!"'
echo ""
echo -e "${YELLOW}💡 LOGS:${NC}"
echo "AI Server: tail -f packages/ai-server/ai-server.log"
echo "Demo Server: tail -f packages/ai-server/demo-server.log"
echo "Ngrok: tail -f packages/ai-server/ngrok.log"
echo ""
echo -e "${RED}🛑 TO STOP:${NC} Press Ctrl+C or run: pkill -f 'node|ngrok'"

# Save PIDs for cleanup
echo "$AI_PID" > .demo-pids
echo "$DEMO_PID" >> .demo-pids
echo "$NGROK_PID" >> .demo-pids

# Trap to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}🧹 Cleaning up...${NC}"
    if [ -f .demo-pids ]; then
        while read pid; do
            kill $pid 2>/dev/null || true
        done < .demo-pids
        rm .demo-pids
    fi
    pkill -f "node server.js" 2>/dev/null || true
    pkill -f "serve-demo.js" 2>/dev/null || true
    pkill -f "ngrok" 2>/dev/null || true
}

trap cleanup EXIT

# Keep script running and show live stats
echo -e "\n${GREEN}📊 LIVE DEMO STATS:${NC}"
echo "Press Ctrl+C to stop all services"
echo "======================================="

while true; do
    sleep 10

    # Check if services are still running
    if ! curl -s http://localhost:8787/health > /dev/null; then
        echo -e "${RED}⚠️  AI server is down!${NC}"
    fi

    if ! curl -s http://localhost:3000/_demohealth > /dev/null; then
        echo -e "${RED}⚠️  Demo server is down!${NC}"
    fi

    # Show timestamp
    echo "$(date '+%H:%M:%S') - Services running... (URL: $GAME_URL)"
done