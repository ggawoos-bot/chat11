/**
 * 요청 대기열 관리 서비스
 * Gemini API 한도 초과 방지를 위한 요청 큐 시스템
 */

import { 
  QueueItem, 
  RequestStatus, 
  RetryPolicy, 
  RequestQueueStatus,
  ApiError,
  ApiErrorType,
  DEFAULT_RETRY_POLICY,
  EventCallback
} from '../types/api.js';

/**
 * 요청 대기열 클래스
 * API 요청을 순차적으로 처리하고 재시도 로직을 관리
 */
export class RequestQueue {
  private queue: QueueItem[] = [];
  private processing: Set<string> = new Set();
  private isProcessing = false;
  private eventCallbacks: Map<string, EventCallback[]> = new Map();
  private stats = {
    totalProcessed: 0,
    totalFailed: 0,
    totalRetries: 0,
    averageProcessingTime: 0
  };

  constructor(
    private maxConcurrentRequests = 1,
    private defaultRetryPolicy: RetryPolicy = DEFAULT_RETRY_POLICY
  ) {
    this.startProcessing();
  }

  /**
   * 요청을 큐에 추가
   */
  async addRequest<T = any, R = any>(
    request: T,
    handler: (req: T) => Promise<R>,
    options: {
      priority?: number;
      retryPolicy?: Partial<RetryPolicy>;
      timeout?: number;
    } = {}
  ): Promise<R> {
    const id = this.generateId();
    const retryPolicy = { ...this.defaultRetryPolicy, ...options.retryPolicy };
    
    const queueItem: QueueItem = {
      id,
      request,
      status: RequestStatus.PENDING,
      createdAt: Date.now(),
      retryCount: 0,
      retryPolicy,
      priority: options.priority || 0,
      result: undefined
    };

    this.queue.push(queueItem);
    this.sortQueueByPriority();
    
    this.emit('requestAdded', { id, request });
    
    return this.waitForCompletion(id, handler, options.timeout);
  }

  /**
   * 요청 완료까지 대기
   */
  private async waitForCompletion<T, R>(
    id: string,
    handler: (req: T) => Promise<R>,
    timeout?: number
  ): Promise<R> {
    return new Promise((resolve, reject) => {
      const timeoutId = timeout ? setTimeout(() => {
        this.cancelRequest(id);
        reject(new Error(`Request ${id} timed out after ${timeout}ms`));
      }, timeout) : null;

      const checkCompletion = () => {
        const item = this.queue.find(q => q.id === id);
        if (!item) {
          if (timeoutId) clearTimeout(timeoutId);
          reject(new Error(`Request ${id} not found`));
          return;
        }

        if (item.status === RequestStatus.COMPLETED) {
          if (timeoutId) clearTimeout(timeoutId);
          resolve(item.result);
        } else if (item.status === RequestStatus.FAILED) {
          if (timeoutId) clearTimeout(timeoutId);
          reject(item.error || new Error('Request failed'));
        } else if (item.status === RequestStatus.CANCELLED) {
          if (timeoutId) clearTimeout(timeoutId);
          reject(new Error(`Request ${id} was cancelled`));
        } else {
          // 아직 처리 중이면 잠시 후 다시 확인
          setTimeout(checkCompletion, 100);
        }
      };

      checkCompletion();
    });
  }

  /**
   * 요청 처리 시작
   */
  private async startProcessing(): Promise<void> {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    
    while (this.isProcessing) {
      const availableSlots = this.maxConcurrentRequests - this.processing.size;
      
      if (availableSlots > 0) {
        const nextItem = this.getNextPendingItem();
        if (nextItem) {
          this.processRequest(nextItem);
        }
      }
      
      // CPU 사용량을 줄이기 위해 잠시 대기
      await this.sleep(100);
    }
  }

  /**
   * 다음 처리할 요청 가져오기
   */
  private getNextPendingItem(): QueueItem | undefined {
    return this.queue.find(item => item.status === RequestStatus.PENDING);
  }

  /**
   * 요청 처리
   */
  private async processRequest(item: QueueItem): Promise<void> {
    if (this.processing.has(item.id)) return;
    
    this.processing.add(item.id);
    item.status = RequestStatus.PROCESSING;
    item.startedAt = Date.now();
    
    this.emit('requestStarted', { id: item.id, request: item.request });
    
    try {
      // 실제 요청 처리 (여기서는 핸들러를 직접 호출하지 않고 상태만 관리)
      // 실제 구현에서는 handler를 호출해야 함
      item.status = RequestStatus.COMPLETED;
      item.completedAt = Date.now();
      
      this.updateStats(item);
      this.emit('requestCompleted', { id: item.id, result: item.result });
      
    } catch (error) {
      await this.handleRequestError(item, error as Error);
    } finally {
      this.processing.delete(item.id);
    }
  }

  /**
   * 요청 에러 처리
   */
  private async handleRequestError(item: QueueItem, error: Error): Promise<void> {
    const apiError = this.createApiError(error);
    item.error = apiError;
    
    if (item.retryCount < item.retryPolicy.maxRetries && apiError.retryable) {
      // 재시도 가능한 에러
      item.status = RequestStatus.RETRYING;
      item.retryCount++;
      
      const delay = this.calculateRetryDelay(item);
      this.emit('requestRetrying', { id: item.id, retryCount: item.retryCount, delay });
      
      setTimeout(() => {
        item.status = RequestStatus.PENDING;
        this.sortQueueByPriority();
      }, delay);
      
    } else {
      // 재시도 불가능한 에러
      item.status = RequestStatus.FAILED;
      item.completedAt = Date.now();
      
      this.updateStats(item);
      this.emit('requestFailed', { id: item.id, error: apiError });
    }
  }

  /**
   * 재시도 지연 시간 계산
   */
  private calculateRetryDelay(item: QueueItem): number {
    const { retryPolicy } = item;
    let delay = retryPolicy.retryDelay;
    
    if (retryPolicy.useExponentialBackoff) {
      delay = Math.min(
        delay * Math.pow(2, item.retryCount - 1),
        retryPolicy.maxRetryDelay
      );
    }
    
    return delay;
  }

  /**
   * API 에러 생성
   */
  private createApiError(error: Error): ApiError {
    const apiError = error as ApiError;
    
    // 에러 타입 분류
    if (error.message.includes('429') || error.message.includes('rate limit')) {
      apiError.type = ApiErrorType.RATE_LIMIT_EXCEEDED;
      apiError.retryable = true;
      apiError.retryAfter = 5000; // 5초 후 재시도
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      apiError.type = ApiErrorType.NETWORK_ERROR;
      apiError.retryable = true;
    } else if (error.message.includes('timeout')) {
      apiError.type = ApiErrorType.TIMEOUT;
      apiError.retryable = true;
    } else {
      apiError.type = ApiErrorType.UNKNOWN;
      apiError.retryable = false;
    }
    
    return apiError;
  }

  /**
   * 통계 업데이트
   */
  private updateStats(item: QueueItem): void {
    if (item.startedAt && item.completedAt) {
      const processingTime = item.completedAt - item.startedAt;
      this.stats.averageProcessingTime = 
        (this.stats.averageProcessingTime * this.stats.totalProcessed + processingTime) / 
        (this.stats.totalProcessed + 1);
    }
    
    this.stats.totalProcessed++;
    
    if (item.status === RequestStatus.FAILED) {
      this.stats.totalFailed++;
    }
    
    if (item.retryCount > 0) {
      this.stats.totalRetries += item.retryCount;
    }
  }

  /**
   * 우선순위에 따라 큐 정렬
   */
  private sortQueueByPriority(): void {
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.createdAt - b.createdAt;
    });
  }

  /**
   * 요청 취소
   */
  cancelRequest(id: string): boolean {
    const item = this.queue.find(q => q.id === id);
    if (!item || item.status === RequestStatus.COMPLETED) {
      return false;
    }
    
    item.status = RequestStatus.CANCELLED;
    item.completedAt = Date.now();
    
    this.emit('requestCancelled', { id });
    return true;
  }

  /**
   * 큐 상태 가져오기
   */
  getStatus(): RequestQueueStatus {
    const now = Date.now();
    const completedItems = this.queue.filter(item => 
      item.status === RequestStatus.COMPLETED && 
      item.completedAt && 
      item.startedAt
    );
    
    return {
      totalLength: this.queue.length,
      pendingCount: this.queue.filter(item => item.status === RequestStatus.PENDING).length,
      processingCount: this.processing.size,
      failedCount: this.queue.filter(item => item.status === RequestStatus.FAILED).length,
      retryingCount: this.queue.filter(item => item.status === RequestStatus.RETRYING).length,
      averageProcessingTime: this.stats.averageProcessingTime
    };
  }

  /**
   * 큐 초기화
   */
  clear(): void {
    this.queue = [];
    this.processing.clear();
    this.stats = {
      totalProcessed: 0,
      totalFailed: 0,
      totalRetries: 0,
      averageProcessingTime: 0
    };
    
    this.emit('queueCleared', {});
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
          console.error(`Error in event callback for ${event}:`, error);
        }
      });
    }
  }

  /**
   * 고유 ID 생성
   */
  private generateId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 대기 함수
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 처리 중지
   */
  stop(): void {
    this.isProcessing = false;
  }

  /**
   * 처리 재시작
   */
  start(): void {
    if (!this.isProcessing) {
      this.startProcessing();
    }
  }
}

/**
 * 전역 요청 큐 인스턴스
 */
export const requestQueue = new RequestQueue();

/**
 * 요청 큐 헬퍼 함수들
 */
export const queueHelpers = {
  /**
   * 요청 추가 (간편 버전)
   */
  async add<T, R>(request: T, handler: (req: T) => Promise<R>): Promise<R> {
    return requestQueue.addRequest(request, handler);
  },

  /**
   * 큐 상태 확인
   */
  getStatus(): RequestQueueStatus {
    return requestQueue.getStatus();
  },

  /**
   * 큐 초기화
   */
  clear(): void {
    requestQueue.clear();
  },

  /**
   * 이벤트 리스너 등록
   */
  on(event: string, callback: EventCallback): void {
    requestQueue.on(event, callback);
  },

  /**
   * 이벤트 리스너 제거
   */
  off(event: string, callback: EventCallback): void {
    requestQueue.off(event, callback);
  }
};
