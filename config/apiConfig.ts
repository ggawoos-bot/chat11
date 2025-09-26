/**
 * API 설정 관리
 * Gemini API 한도 초과 방지를 위한 설정값들을 중앙 관리
 */

export interface RateLimitConfig {
  /** 분당 최대 요청 수 */
  REQUESTS_PER_MINUTE: number;
  /** 최소 요청 간격 (밀리초) */
  MIN_INTERVAL_MS: number;
  /** 재시도 지연 시간 (밀리초) */
  RETRY_DELAY_MS: number;
  /** 최대 재시도 횟수 */
  MAX_RETRIES: number;
}

export interface CacheConfig {
  /** 캐시 활성화 여부 */
  ENABLED: boolean;
  /** 캐시 만료 시간 (시간) */
  DURATION_HOURS: number;
  /** 최대 캐시 항목 수 */
  MAX_ITEMS: number;
}

export interface InputLimitConfig {
  /** 최소 입력 간격 (밀리초) */
  MIN_INTERVAL_MS: number;
  /** 최대 메시지 길이 */
  MAX_LENGTH: number;
  /** 중복 메시지 방지 여부 */
  PREVENT_DUPLICATES: boolean;
}

export interface ApiConfig {
  RATE_LIMIT: RateLimitConfig;
  CACHE: CacheConfig;
  INPUT_LIMIT: InputLimitConfig;
}

/**
 * API 설정값
 * 환경에 따라 조정 가능한 설정값들을 정의
 */
export const API_CONFIG: ApiConfig = {
  RATE_LIMIT: {
    REQUESTS_PER_MINUTE: 10,
    MIN_INTERVAL_MS: 1000,
    RETRY_DELAY_MS: 5000,
    MAX_RETRIES: 3
  },
  CACHE: {
    ENABLED: true,
    DURATION_HOURS: 24,
    MAX_ITEMS: 1000
  },
  INPUT_LIMIT: {
    MIN_INTERVAL_MS: 3000,
    MAX_LENGTH: 500,
    PREVENT_DUPLICATES: true
  }
};

/**
 * 환경별 설정 오버라이드
 * 개발/프로덕션 환경에 따른 설정값 조정
 */
export const getConfig = (): ApiConfig => {
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  if (isDevelopment) {
    // 개발 환경에서는 더 관대한 설정
    return {
      ...API_CONFIG,
      RATE_LIMIT: {
        ...API_CONFIG.RATE_LIMIT,
        REQUESTS_PER_MINUTE: 20, // 개발 시 더 많은 요청 허용
        MIN_INTERVAL_MS: 500,    // 더 빠른 간격
      },
      CACHE: {
        ...API_CONFIG.CACHE,
        DURATION_HOURS: 1,       // 개발 시 짧은 캐시 시간
      }
    };
  }
  
  return API_CONFIG;
};

/**
 * 설정값 검증
 * 설정값이 유효한 범위 내에 있는지 확인
 */
export const validateConfig = (config: ApiConfig): boolean => {
  const { RATE_LIMIT, CACHE, INPUT_LIMIT } = config;
  
  // Rate Limit 검증
  if (RATE_LIMIT.REQUESTS_PER_MINUTE <= 0 || RATE_LIMIT.REQUESTS_PER_MINUTE > 100) {
    console.warn('REQUESTS_PER_MINUTE should be between 1 and 100');
    return false;
  }
  
  if (RATE_LIMIT.MIN_INTERVAL_MS < 100 || RATE_LIMIT.MIN_INTERVAL_MS > 10000) {
    console.warn('MIN_INTERVAL_MS should be between 100 and 10000ms');
    return false;
  }
  
  if (RATE_LIMIT.MAX_RETRIES < 0 || RATE_LIMIT.MAX_RETRIES > 10) {
    console.warn('MAX_RETRIES should be between 0 and 10');
    return false;
  }
  
  // Cache 검증
  if (CACHE.DURATION_HOURS <= 0 || CACHE.DURATION_HOURS > 168) { // 1주일
    console.warn('DURATION_HOURS should be between 1 and 168 hours');
    return false;
  }
  
  if (CACHE.MAX_ITEMS <= 0 || CACHE.MAX_ITEMS > 10000) {
    console.warn('MAX_ITEMS should be between 1 and 10000');
    return false;
  }
  
  // Input Limit 검증
  if (INPUT_LIMIT.MIN_INTERVAL_MS < 0 || INPUT_LIMIT.MIN_INTERVAL_MS > 30000) {
    console.warn('MIN_INTERVAL_MS should be between 0 and 30000ms');
    return false;
  }
  
  if (INPUT_LIMIT.MAX_LENGTH <= 0 || INPUT_LIMIT.MAX_LENGTH > 5000) {
    console.warn('MAX_LENGTH should be between 1 and 5000 characters');
    return false;
  }
  
  return true;
};

// 설정값 검증 실행
if (!validateConfig(API_CONFIG)) {
  console.error('API_CONFIG validation failed. Please check the configuration values.');
}
