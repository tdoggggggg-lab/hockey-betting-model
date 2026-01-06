// Simple in-memory cache with TTL
// This persists across requests within the same serverless function instance

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

class SimpleCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    
    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data as T;
  }
  
  set<T>(key: string, data: T, ttlSeconds: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + (ttlSeconds * 1000),
    });
  }
  
  getAge(key: string): number | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    return Math.floor((Date.now() - entry.timestamp) / 1000);
  }
  
  clear(): void {
    this.cache.clear();
  }
}

// Singleton instance - persists across requests in same function instance
export const apiCache = new SimpleCache();

// Cache TTL constants (in seconds)
export const CACHE_TTL = {
  ODDS: 600,        // 10 minutes for odds (saves API calls!)
  SCHEDULE: 300,    // 5 minutes for schedule
  STANDINGS: 300,   // 5 minutes for standings  
  PLAYER_STATS: 600, // 10 minutes for player stats
  PROPS: 300,       // 5 minutes for props predictions
};
