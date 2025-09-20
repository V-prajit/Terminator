// rate-limit.js
// Token bucket rate limiter for Cerebras API

export function createRateLimiter(tokensPerMinute) {
  let tokens = tokensPerMinute;
  let lastRefill = Date.now();
  
  const refill = () => {
    const now = Date.now();
    const elapsed = (now - lastRefill) / 1000 / 60; // minutes
    tokens = Math.min(tokensPerMinute, tokens + elapsed * tokensPerMinute);
    lastRefill = now;
  };
  
  return {
    async waitForCapacity(needed) {
      refill();
      
      if (tokens < needed) {
        const waitTime = ((needed - tokens) / tokensPerMinute) * 60 * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        refill();
      }
      
      tokens -= needed;
      return true;
    },
    
    handleRateLimit() {
      tokens = 0;
      return new Promise(resolve => setTimeout(resolve, 1000));
    },
    
    getRemaining() {
      refill();
      return Math.floor(tokens);
    },
    
    getResetTime() {
      const tokensNeeded = tokensPerMinute - tokens;
      return Math.ceil((tokensNeeded / tokensPerMinute) * 60);
    }
  };
}