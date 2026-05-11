type RateLimitEntry = {
    count: number;
    resetTime: number;
  };
  
  const rateLimitMap = new Map<string, RateLimitEntry>();
  
  const WINDOW_MS = 60 * 1000;
  const MAX_REQUESTS = 5;
  
  export function checkRateLimit(identifier: string) {
    const now = Date.now();
  
    const current = rateLimitMap.get(identifier);
  
    if (!current || current.resetTime < now) {
      rateLimitMap.set(identifier, {
        count: 1,
        resetTime: now + WINDOW_MS,
      });
  
      return {
        allowed: true,
        remaining: MAX_REQUESTS - 1,
      };
    }
  
    if (current.count >= MAX_REQUESTS) {
      return {
        allowed: false,
        remaining: 0,
      };
    }
  
    current.count += 1;
  
    rateLimitMap.set(identifier, current);
  
    return {
      allowed: true,
      remaining: MAX_REQUESTS - current.count,
    };
  }