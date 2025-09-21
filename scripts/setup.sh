#!/bin/bash

echo "AI Overlord Project Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

echo "Node.js $(node --version) detected"

# Install dependencies
echo ""
echo "Installing dependencies..."
npm install

# Setup AI server environment
echo ""
echo "Setting up AI server..."
if [ ! -f "packages/ai-server/.env" ]; then
    cp packages/ai-server/.env.example packages/ai-server/.env
    echo "   Created .env file - please add your Cerebras API key"
else
    echo "   .env file already exists"
fi

# Create game .env
echo ""
echo "Setting up game client..."
if [ ! -f "packages/game/.env" ]; then
    echo "VITE_AI_SERVER_URL=http://localhost:8787" > packages/game/.env
    echo "VITE_MOCK_MODE=false" >> packages/game/.env
    echo "   Created game .env file"
else
    echo "   .env file already exists"
fi

echo ""
echo "Setup complete!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Next Steps:"
echo ""
echo "For TEAMMATE A (AI/Backend):"
echo "  1. Add Cerebras API key to packages/ai-server/.env"
echo "  2. cd packages/ai-server"
echo "  3. npm run dev"
echo ""
echo "For TEAMMATE B (Game/Frontend):"
echo "  1. cd packages/game"
echo "  2. npm run dev"
echo "  3. Open http://localhost:3000"
echo ""
echo "To run both together:"
echo "  npm run dev (from root)"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Quick Test Commands:"
echo ""
echo "Test AI server:"
echo "  curl -X POST http://localhost:8787/decide \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"player_id\":\"test\",\"last_move\":\"left\",\"recent_moves\":[\"left\"],\"session_stats\":{\"best_time\":5,\"current_time\":3},\"overlord_mode\":\"aggressive\"}'"
echo ""
echo "Run load test:"
echo "  cd packages/ai-server && node test.js"
echo ""
echo "Good luck with your hackathon!"
