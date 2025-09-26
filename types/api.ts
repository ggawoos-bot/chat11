/**
 * API 관련 타입 정의
 * Gemini API 한도 초과 방지 시스템을 위한 핵심 타입들
 */

// ============================================================================
// RequestQueue 관련 타입
// ============================================================================

/**
 * 요청 상태 열거형
 */
export enum RequestStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRYING = 'retrying',
  CANCELLED = 'cancelled'
}

/**
 * 재시도 정책 인터페이스
 */
export interface RetryPolicy {
  /** 최대 재시도 횟수 */
  maxRetries: number;
  /** 재시도 간격 (밀리초) */
  retryDelay: number;
  /** 지수 백오프 사용 여부 */
  useExponentialBackoff: boolean;
  /** 최대 재시도 간격 (밀리초) */
  maxRetryDelay: number;
}

/**
 * 큐 아이템 인터페이스
 */
export interface QueueItem {
  /** 고유 ID */
  id: string;
  /** 요청 데이터 */
  request: any;
  /** 요청 상태 */
  status: RequestStatus;
  /** 생성 시간 */
  createdAt: number;
  /** 처리 시작 시간 */
  startedAt?: number;
  /** 완료 시간 */
  completedAt?: number;
  /** 재시도 횟수 */
  retryCount: number;
  /** 재시도 정책 */
  retryPolicy: RetryPolicy;
  /** 우선순위 (낮을수록 높은 우선순위) */
  priority: number;
  /** 에러 정보 */
  error?: Error;
  /** 결과 데이터 */
  result?: any;
}

/**
 * 요청 큐 상태 인터페이스
 */
export interface RequestQueueStatus {
  /** 전체 큐 길이 */
  totalLength: number;
  /** 대기 중인 요청 수 */
  pendingCount: number;
  /** 처리 중인 요청 수 */
  processingCount: number;
  /** 실패한 요청 수 */
  failedCount: number;
  /** 재시도 중인 요청 수 */
  retryingCount: number;
  /** 평균 처리 시간 (밀리초) */
  averageProcessingTime: number;
}

// ============================================================================
// Cache 관련 타입
// ============================================================================

/**
 * 캐시 아이템 인터페이스
 */
export interface CacheItem {
  /** 캐시 키 */
  key: string;
  /** 캐시 데이터 */
  data: any;
  /** 생성 시간 */
  createdAt: number;
  /** 만료 시간 */
  expiresAt: number;
  /** 접근 시간 */
  lastAccessedAt: number;
  /** 접근 횟수 */
  accessCount: number;
  /** 데이터 크기 (바이트) */
  size: number;
  /** 태그 (선택적) */
  tags?: string[];
}

/**
 * 캐시 통계 인터페이스
 */
export interface CacheStats {
  /** 총 캐시 항목 수 */
  totalItems: number;
  /** 캐시 히트 횟수 */
  hitCount: number;
  /** 캐시 미스 횟수 */
  missCount: number;
  /** 캐시 히트율 (0-1) */
  hitRate: number;
  /** 총 캐시 크기 (바이트) */
  totalSize: number;
  /** 평균 항목 크기 (바이트) */
  averageItemSize: number;
  /** 만료된 항목 수 */
  expiredItems: number;
  /** 가장 많이 접근된 항목 */
  mostAccessedItem?: string;
}

/**
 * 캐시 설정 인터페이스
 */
export interface CacheConfig {
  /** 캐시 활성화 여부 */
  enabled: boolean;
  /** 기본 만료 시간 (밀리초) */
  defaultTTL: number;
  /** 최대 캐시 크기 (바이트) */
  maxSize: number;
  /** 최대 항목 수 */
  maxItems: number;
  /** 자동 정리 간격 (밀리초) */
  cleanupInterval: number;
  /** 압축 사용 여부 */
  useCompression: boolean;
}

// ============================================================================
// Rate Limiter 관련 타입
// ============================================================================

/**
 * Rate Limit 설정 인터페이스
 */
export interface RateLimitConfig {
  /** 분당 최대 요청 수 */
  requestsPerMinute: number;
  /** 최소 요청 간격 (밀리초) */
  minInterval: number;
  /** 시간 윈도우 (밀리초) */
  timeWindow: number;
  /** 버스트 허용 여부 */
  allowBurst: boolean;
  /** 최대 버스트 크기 */
  maxBurstSize: number;
}

/**
 * Rate Limit 상태 인터페이스
 */
export interface RateLimitStatus {
  /** 현재 요청 수 */
  currentRequests: number;
  /** 남은 요청 수 */
  remainingRequests: number;
  /** 다음 리셋 시간 */
  resetTime: number;
  /** 제한 여부 */
  isLimited: boolean;
  /** 남은 대기 시간 (밀리초) */
  waitTime: number;
}

// ============================================================================
// API 응답 관련 타입
// ============================================================================

/**
 * API 응답 상태
 */
export enum ApiResponseStatus {
  SUCCESS = 'success',
  ERROR = 'error',
  RATE_LIMITED = 'rate_limited',
  CACHED = 'cached',
  RETRYING = 'retrying'
}

/**
 * API 응답 인터페이스
 */
export interface ApiResponse<T = any> {
  /** 응답 상태 */
  status: ApiResponseStatus;
  /** 응답 데이터 */
  data?: T;
  /** 에러 메시지 */
  error?: string;
  /** 응답 시간 (밀리초) */
  responseTime: number;
  /** 캐시 히트 여부 */
  fromCache: boolean;
  /** 재시도 횟수 */
  retryCount: number;
  /** 요청 ID */
  requestId: string;
  /** 타임스탬프 */
  timestamp: number;
}

// ============================================================================
// 에러 관련 타입
// ============================================================================

/**
 * API 에러 타입
 */
export enum ApiErrorType {
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  NETWORK_ERROR = 'network_error',
  TIMEOUT = 'timeout',
  INVALID_REQUEST = 'invalid_request',
  SERVER_ERROR = 'server_error',
  UNKNOWN = 'unknown'
}

/**
 * API 에러 인터페이스
 */
export interface ApiError extends Error {
  /** 에러 타입 */
  type: ApiErrorType;
  /** HTTP 상태 코드 */
  statusCode?: number;
  /** 재시도 가능 여부 */
  retryable: boolean;
  /** 재시도 권장 시간 (밀리초) */
  retryAfter?: number;
  /** 요청 ID */
  requestId?: string;
}

// ============================================================================
// 유틸리티 타입
// ============================================================================

/**
 * 설정 옵션 타입
 */
export type ConfigOptions = Partial<{
  rateLimit: RateLimitConfig;
  cache: CacheConfig;
  retry: RetryPolicy;
}>;

/**
 * 이벤트 콜백 타입
 */
export type EventCallback<T = any> = (data: T) => void;

/**
 * 요청 핸들러 타입
 */
export type RequestHandler<T = any, R = any> = (request: T) => Promise<R>;

/**
 * 에러 핸들러 타입
 */
export type ErrorHandler = (error: ApiError) => void;

// ============================================================================
// 상수 정의
// ============================================================================

/**
 * 기본 재시도 정책
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  retryDelay: 1000,
  useExponentialBackoff: true,
  maxRetryDelay: 30000
};

/**
 * 기본 Rate Limit 설정
 */
export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  requestsPerMinute: 10,
  minInterval: 1000,
  timeWindow: 60000,
  allowBurst: false,
  maxBurstSize: 5
};

/**
 * 기본 캐시 설정
 */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enabled: true,
  defaultTTL: 24 * 60 * 60 * 1000, // 24시간
  maxSize: 10 * 1024 * 1024, // 10MB
  maxItems: 1000,
  cleanupInterval: 60 * 60 * 1000, // 1시간
  useCompression: false
};
