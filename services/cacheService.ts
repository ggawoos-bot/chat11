/**
 * 캐시 서비스
 * Gemini API 응답을 로컬에 캐싱하여 API 호출을 줄이는 시스템
 */

import { 
  CacheItem, 
  CacheStats, 
  CacheConfig, 
  DEFAULT_CACHE_CONFIG,
  EventCallback
} from '../types/api.js';

/**
 * 캐시 서비스 클래스
 * 메모리 캐시와 localStorage를 결합한 하이브리드 캐시 시스템
 */
export class CacheService {
  private memoryCache = new Map<string, CacheItem>();
  private stats: CacheStats = {
    totalItems: 0,
    hitCount: 0,
    missCount: 0,
    hitRate: 0,
    totalSize: 0,
    averageItemSize: 0,
    expiredItems: 0,
    mostAccessedItem: undefined
  };
  private eventCallbacks: Map<string, EventCallback[]> = new Map();
  private cleanupTimer?: NodeJS.Timeout;
  private readonly STORAGE_KEY = 'gemini_cache';
  private readonly MAX_STORAGE_SIZE = 5 * 1024 * 1024; // 5MB

  constructor(private config: CacheConfig = DEFAULT_CACHE_CONFIG) {
    this.loadFromStorage();
    this.startCleanupTimer();
  }

  /**
   * 캐시에서 데이터 조회
   */
  get<T = any>(key: string): T | null {
    const item = this.memoryCache.get(key);
    
    if (!item) {
      this.stats.missCount++;
      this.updateHitRate();
      this.emit('cacheMiss', { key });
      return null;
    }

    // 만료 확인
    if (this.isExpired(item)) {
      this.remove(key);
      this.stats.missCount++;
      this.stats.expiredItems++;
      this.updateHitRate();
      this.emit('cacheExpired', { key, item });
      return null;
    }

    // 접근 정보 업데이트
    item.lastAccessedAt = Date.now();
    item.accessCount++;
    this.updateMostAccessedItem(key, item.accessCount);
    
    this.stats.hitCount++;
    this.updateHitRate();
    this.emit('cacheHit', { key, item });
    
    return item.data as T;
  }

  /**
   * 캐시에 데이터 저장
   */
  set<T = any>(key: string, data: T, ttl?: number): boolean {
    try {
      const now = Date.now();
      const expiresAt = now + (ttl || this.config.defaultTTL);
      const size = this.calculateSize(data);
      
      // 저장소 용량 확인
      if (this.wouldExceedStorageLimit(size)) {
        this.cleanupOldItems();
        if (this.wouldExceedStorageLimit(size)) {
          this.emit('cacheFull', { key, size });
          return false;
        }
      }

      const item: CacheItem = {
        key,
        data,
        createdAt: now,
        expiresAt,
        lastAccessedAt: now,
        accessCount: 0,
        size,
        tags: []
      };

      // 기존 아이템이 있다면 크기 차이만큼 통계 업데이트
      const existingItem = this.memoryCache.get(key);
      if (existingItem) {
        this.stats.totalSize -= existingItem.size;
      } else {
        this.stats.totalItems++;
      }

      this.memoryCache.set(key, item);
      this.stats.totalSize += size;
      this.stats.averageItemSize = this.stats.totalSize / this.stats.totalItems;

      this.saveToStorage();
      this.emit('cacheSet', { key, item });
      
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      this.emit('cacheError', { key, error });
      return false;
    }
  }

  /**
   * 캐시에서 데이터 제거
   */
  remove(key: string): boolean {
    const item = this.memoryCache.get(key);
    if (!item) {
      return false;
    }

    this.memoryCache.delete(key);
    this.stats.totalItems--;
    this.stats.totalSize -= item.size;
    this.stats.averageItemSize = this.stats.totalItems > 0 
      ? this.stats.totalSize / this.stats.totalItems 
      : 0;

    this.saveToStorage();
    this.emit('cacheRemoved', { key, item });
    
    return true;
  }

  /**
   * 캐시 초기화
   */
  clear(): void {
    this.memoryCache.clear();
    this.stats = {
      totalItems: 0,
      hitCount: 0,
      missCount: 0,
      hitRate: 0,
      totalSize: 0,
      averageItemSize: 0,
      expiredItems: 0,
      mostAccessedItem: undefined
    };
    
    localStorage.removeItem(this.STORAGE_KEY);
    this.emit('cacheCleared', {});
  }

  /**
   * 캐시 통계 조회
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * 캐시 상태 확인
   */
  has(key: string): boolean {
    const item = this.memoryCache.get(key);
    return item ? !this.isExpired(item) : false;
  }

  /**
   * 캐시 크기 조회
   */
  size(): number {
    return this.memoryCache.size;
  }

  /**
   * 만료된 아이템 정리
   */
  cleanup(): number {
    let cleanedCount = 0;
    const now = Date.now();
    
    this.memoryCache.forEach((item, key) => {
      if (this.isExpired(item)) {
        this.remove(key);
        cleanedCount++;
      }
    });
    
    this.stats.expiredItems += cleanedCount;
    this.emit('cacheCleanup', { cleanedCount });
    
    return cleanedCount;
  }

  /**
   * 오래된 아이템 정리 (LRU 기반)
   */
  private cleanupOldItems(): void {
    const items: Array<{ key: string; item: CacheItem; lastAccessed: number }> = [];
    
    this.memoryCache.forEach((item, key) => {
      items.push({ key, item, lastAccessed: item.lastAccessedAt });
    });
    
    items.sort((a, b) => a.lastAccessed - b.lastAccessed);

    // 가장 오래된 20% 제거
    const removeCount = Math.ceil(items.length * 0.2);
    for (let i = 0; i < removeCount; i++) {
      this.remove(items[i].key);
    }
  }

  /**
   * 아이템 만료 확인
   */
  private isExpired(item: CacheItem): boolean {
    return Date.now() > item.expiresAt;
  }

  /**
   * 데이터 크기 계산
   */
  private calculateSize(data: any): number {
    try {
      return new Blob([JSON.stringify(data)]).size;
    } catch {
      return 0;
    }
  }

  /**
   * 저장소 용량 초과 확인
   */
  private wouldExceedStorageLimit(additionalSize: number): boolean {
    return this.stats.totalSize + additionalSize > this.config.maxSize;
  }

  /**
   * 히트율 업데이트
   */
  private updateHitRate(): void {
    const total = this.stats.hitCount + this.stats.missCount;
    this.stats.hitRate = total > 0 ? this.stats.hitCount / total : 0;
  }

  /**
   * 가장 많이 접근된 아이템 업데이트
   */
  private updateMostAccessedItem(key: string, accessCount: number): void {
    if (!this.stats.mostAccessedItem) {
      this.stats.mostAccessedItem = key;
    } else {
      const currentItem = this.memoryCache.get(this.stats.mostAccessedItem);
      if (!currentItem || accessCount > currentItem.accessCount) {
        this.stats.mostAccessedItem = key;
      }
    }
  }

  /**
   * localStorage에서 로드
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (!stored) return;

      const data = JSON.parse(stored);
      if (!Array.isArray(data)) return;

      for (const item of data) {
        if (this.isValidCacheItem(item) && !this.isExpired(item)) {
          this.memoryCache.set(item.key, item);
        }
      }

      this.updateStatsFromMemory();
      this.emit('cacheLoaded', { count: this.memoryCache.size });
    } catch (error) {
      console.error('Cache load error:', error);
      this.emit('cacheError', { error });
    }
  }

  /**
   * localStorage에 저장
   */
  private saveToStorage(): void {
    try {
      const data: CacheItem[] = [];
      this.memoryCache.forEach(item => {
        data.push(item);
      });
      
      const json = JSON.stringify(data);
      
      if (json.length > this.MAX_STORAGE_SIZE) {
        this.cleanupOldItems();
        const newData: CacheItem[] = [];
        this.memoryCache.forEach(item => {
          newData.push(item);
        });
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(newData));
      } else {
        localStorage.setItem(this.STORAGE_KEY, json);
      }
    } catch (error) {
      console.error('Cache save error:', error);
      this.emit('cacheError', { error });
    }
  }

  /**
   * 캐시 아이템 유효성 검사
   */
  private isValidCacheItem(item: any): item is CacheItem {
    return item && 
           typeof item.key === 'string' &&
           typeof item.createdAt === 'number' &&
           typeof item.expiresAt === 'number' &&
           typeof item.lastAccessedAt === 'number' &&
           typeof item.accessCount === 'number' &&
           typeof item.size === 'number';
  }

  /**
   * 메모리에서 통계 업데이트
   */
  private updateStatsFromMemory(): void {
    this.stats.totalItems = this.memoryCache.size;
    let totalSize = 0;
    this.memoryCache.forEach(item => {
      totalSize += item.size;
    });
    this.stats.totalSize = totalSize;
    this.stats.averageItemSize = this.stats.totalItems > 0 
      ? this.stats.totalSize / this.stats.totalItems 
      : 0;
  }

  /**
   * 정리 타이머 시작
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);
  }

  /**
   * 정리 타이머 중지
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * 이벤트 리스너 등록
   */
  on(event: string, callback: EventCallback): void {
    if (!this.eventCallbacks.has(event)) {
      this.eventCallbacks.set(event, []);
    }
    this.eventCallbacks.get(event)!.push(callback);
  }

  /**
   * 이벤트 리스너 제거
   */
  off(event: string, callback: EventCallback): void {
    const callbacks = this.eventCallbacks.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * 이벤트 발생
   */
  private emit(event: string, data: any): void {
    const callbacks = this.eventCallbacks.get(event);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in cache event callback for ${event}:`, error);
        }
      });
    }
  }

  /**
   * 서비스 종료
   */
  destroy(): void {
    this.stopCleanupTimer();
    this.saveToStorage();
  }
}

/**
 * 전역 캐시 서비스 인스턴스
 */
export const cacheService = new CacheService();

/**
 * 캐시 서비스 헬퍼 함수들
 */
export const cacheHelpers = {
  /**
   * 캐시에서 데이터 조회
   */
  get<T = any>(key: string): T | null {
    return cacheService.get<T>(key);
  },

  /**
   * 캐시에 데이터 저장
   */
  set<T = any>(key: string, data: T, ttl?: number): boolean {
    return cacheService.set(key, data, ttl);
  },

  /**
   * 캐시에서 데이터 제거
   */
  remove(key: string): boolean {
    return cacheService.remove(key);
  },

  /**
   * 캐시 초기화
   */
  clear(): void {
    cacheService.clear();
  },

  /**
   * 캐시 통계 조회
   */
  getStats(): CacheStats {
    return cacheService.getStats();
  },

  /**
   * 캐시 상태 확인
   */
  has(key: string): boolean {
    return cacheService.has(key);
  },

  /**
   * 캐시 크기 조회
   */
  size(): number {
    return cacheService.size();
  },

  /**
   * 이벤트 리스너 등록
   */
  on(event: string, callback: EventCallback): void {
    cacheService.on(event, callback);
  },

  /**
   * 이벤트 리스너 제거
   */
  off(event: string, callback: EventCallback): void {
    cacheService.off(event, callback);
  }
};

/**
 * 질문-답변 쌍을 위한 특화된 캐시 함수들
 */
export const qaCache = {
  /**
   * 질문-답변 쌍 저장
   */
  setAnswer(question: string, answer: string, ttl?: number): boolean {
    const key = this.generateQuestionKey(question);
    return cacheService.set(key, { question, answer }, ttl);
  },

  /**
   * 질문에 대한 답변 조회
   */
  getAnswer(question: string): string | null {
    const key = this.generateQuestionKey(question);
    const result = cacheService.get<{ question: string; answer: string }>(key);
    return result ? result.answer : null;
  },

  /**
   * 질문 키 생성
   */
  generateQuestionKey(question: string): string {
    // 질문을 정규화하여 키 생성
    const normalized = question.trim().toLowerCase().replace(/\s+/g, ' ');
    return `qa_${this.hashString(normalized)}`;
  },

  /**
   * 문자열 해시 생성
   */
  hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32bit 정수로 변환
    }
    return Math.abs(hash).toString(36);
  }
};
