import fetch from 'node-fetch';

const API_URL = 'http://localhost:8787';
const NUM_REQUESTS = 100;

async function testDecideEndpoint() {
  const latencies = [];
  let errors = 0;
  
  console.log(`🧪 Testing ${NUM_REQUESTS} requests to /decide endpoint...\n`);
  
  for (let i = 0; i < NUM_REQUESTS; i++) {
    const testData = {
      player_id: `test_${i % 5}`, // Test with 5 different players
      run_id: crypto.randomUUID(),
      tick: i,
      last_move: ['left', 'right', 'up', 'down', 'none'][i % 5],
      recent_moves: ['left', 'up', 'right'].slice(0, i % 3 + 1),
      session_stats: {
        best_time: Math.random() * 20,
        current_time: Math.random() * 10
      },
      overlord_mode: ['aggressive', 'defensive', 'trickster'][i % 3]
    };
    
    const startTime = Date.now();
    
    try {
      const response = await fetch(`${API_URL}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testData)
      });
      
      const data = await response.json();
      const latency = Date.now() - startTime;
      latencies.push(latency);
      
      // Validate response structure
      if (!data.decision || !data.params || !data.explain) {
        console.error(`❌ Invalid response structure at request ${i}:`, data);
        errors++;
      }
      
      // Progress indicator
      if ((i + 1) % 20 === 0) {
        process.stdout.write(`✓ ${i + 1}/${NUM_REQUESTS}\n`);
      }
      
    } catch (error) {
      console.error(`❌ Request ${i} failed:`, error.message);
      errors++;
    }
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  
  // Calculate statistics
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const p99 = latencies[Math.floor(latencies.length * 0.99)];
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  
  console.log('\n📊 Test Results:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ Successful requests: ${NUM_REQUESTS - errors}/${NUM_REQUESTS}`);
  console.log(`❌ Errors: ${errors}`);
  console.log('\n⏱️  Latency Statistics:');
  console.log(`   Average: ${avg.toFixed(1)}ms`);
  console.log(`   P50: ${p50}ms`);
  console.log(`   P95: ${p95}ms`);
  console.log(`   P99: ${p99}ms`);
  console.log(`   Min: ${latencies[0]}ms`);
  console.log(`   Max: ${latencies[latencies.length - 1]}ms`);
  
  // Check if meeting requirements
  console.log('\n🎯 Performance Check:');
  if (p95 < 400) {
    console.log(`   ✅ P95 < 400ms requirement: PASS (${p95}ms)`);
  } else {
    console.log(`   ❌ P95 < 400ms requirement: FAIL (${p95}ms)`);
  }
}

async function testHealthEndpoint() {
  try {
    const response = await fetch(`${API_URL}/health`);
    const data = await response.json();
    console.log('\n🏥 Health Check:', data);
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
  }
}

async function testStatsEndpoint() {
  try {
    const response = await fetch(`${API_URL}/stats`);
    const data = await response.json();
    console.log('\n📈 Stats:', data);
  } catch (error) {
    console.error('❌ Stats check failed:', error.message);
  }
}

// Run tests
async function runAllTests() {
  console.log('🚀 Starting AI Server Load Test\n');
  
  await testHealthEndpoint();
  await testDecideEndpoint();
  await testStatsEndpoint();
  
  console.log('\n✨ Test complete!');
}

runAllTests().catch(console.error);
