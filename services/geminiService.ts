/**
 * Gemini API 통합 서비스
 * 캐시 시스템과 요청 큐를 통합한 Gemini API 서비스
 */

import { GoogleGenAI } from '@google/genai';
import { cacheService, qaCache } from './cacheService.js';
import { requestQueue, queueHelpers } from './requestQueue.js';
import { getConfig } from '../config/apiConfig.js';
import { 
  ApiResponse, 
  ApiResponseStatus, 
  ApiError, 
  ApiErrorType,
  EventCallback 
} from '../types/api.js';

/**
 * Gemini API 통합 서비스 클래스
 */
export class GeminiService {
  private ai: GoogleGenAI;
  private chatSession: any = null;
  private sourceText: string = '';
  private isInitialized = false;
  private eventCallbacks: Map<string, EventCallback[]> = new Map();

  constructor() {
    this.initializeAI();
  }

  /**
   * AI 초기화
   */
  private initializeAI(): void {
    try {
      if (!process.env.API_KEY) {
        throw new Error("API_KEY environment variable not set");
      }
      
      this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      this.isInitialized = true;
      this.emit('aiInitialized', {});
    } catch (error) {
      console.error('AI initialization failed:', error);
      this.emit('aiError', { error });
      throw error;
    }
  }

  /**
   * 소스 텍스트 설정 및 채팅 세션 생성
   */
  async setSourceText(sourceText: string): Promise<void> {
    try {
      this.sourceText = sourceText;
      this.chatSession = this.createChatSession(sourceText);
      this.emit('sourceTextSet', { sourceTextLength: sourceText.length });
    } catch (error) {
      console.error('Failed to set source text:', error);
      this.emit('sourceTextError', { error });
      throw error;
    }
  }

  /**
   * 채팅 세션 생성
   */
  private createChatSession(sourceText: string): any {
    const systemInstruction = this.createSystemInstruction(sourceText);
    
    return this.ai.chats.create({
      model: 'gemini-2.5-flash',
      config: {
        systemInstruction: systemInstruction,
      },
      history: [],
    });
  }

  /**
   * 시스템 지시사항 생성
   */
  private createSystemInstruction(sourceText: string): string {
    return `You are an expert assistant. Your name is NotebookLM Assistant. 
    You must answer questions based ONLY on the following source material provided. 
    Do not use any external knowledge or your pre-trained knowledge. 
    If the answer cannot be found in the source material, you must state that the information is not available in the provided context. 
    Be concise, helpful, and cite which part of the source you are referring to if possible.

    Here is the source material:
    ---START OF SOURCE---
    ${sourceText}
    ---END OF SOURCE---`;
  }

  /**
   * 메시지 전송 (캐시 우선 조회)
   */
  async sendMessage(message: string): Promise<ApiResponse<string>> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    
    try {
      // 1. 캐시에서 답변 조회
      const cachedAnswer = qaCache.getAnswer(message);
      if (cachedAnswer) {
        const responseTime = Date.now() - startTime;
        this.emit('cacheHit', { message, answer: cachedAnswer, responseTime });
        
        return {
          status: ApiResponseStatus.CACHED,
          data: cachedAnswer,
          responseTime,
          fromCache: true,
          retryCount: 0,
          requestId,
          timestamp: Date.now()
        };
      }

      // 2. 캐시 미스 - 요청 큐를 통해 API 호출
      this.emit('cacheMiss', { message });
      
      const answer = await this.sendMessageWithQueue(message);
      const responseTime = Date.now() - startTime;
      
      // 3. 성공한 답변을 캐시에 저장
      qaCache.setAnswer(message, answer);
      
      this.emit('messageSent', { message, answer, responseTime });
      
      return {
        status: ApiResponseStatus.SUCCESS,
        data: answer,
        responseTime,
        fromCache: false,
        retryCount: 0,
        requestId,
        timestamp: Date.now()
      };
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const apiError = this.createApiError(error as Error);
      
      this.emit('messageError', { message, error: apiError, responseTime });
      
      return {
        status: this.getResponseStatusFromError(apiError),
        error: apiError.message,
        responseTime,
        fromCache: false,
        retryCount: 0,
        requestId,
        timestamp: Date.now()
      };
    }
  }

  /**
   * 요청 큐를 통한 메시지 전송
   */
  private async sendMessageWithQueue(message: string): Promise<string> {
    if (!this.chatSession) {
      throw new Error('Chat session not initialized');
    }

    return queueHelpers.add(message, async (msg: string) => {
      return this.processMessageWithRetry(msg);
    });
  }

  /**
   * 재시도 로직이 포함된 메시지 처리
   */
  private async processMessageWithRetry(message: string): Promise<string> {
    const config = getConfig();
    const maxRetries = config.RATE_LIMIT.MAX_RETRIES;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const stream = await this.chatSession.sendMessageStream({ message });
        
        let response = '';
        for await (const chunk of stream) {
          response += chunk.text;
        }
        
        return response;
        
      } catch (error) {
        lastError = error as Error;
        const apiError = this.createApiError(lastError);
        
        // 재시도 불가능한 에러면 즉시 중단
        if (!apiError.retryable) {
          throw apiError;
        }
        
        // 마지막 시도면 에러 발생
        if (attempt === maxRetries) {
          throw apiError;
        }
        
        // 재시도 지연
        const delay = this.calculateRetryDelay(attempt, apiError.retryAfter);
        this.emit('retryAttempt', { 
          message, 
          attempt: attempt + 1, 
          maxRetries, 
          delay,
          error: apiError 
        });
        
        await this.sleep(delay);
      }
    }
    
    throw lastError || new Error('Unknown error occurred');
  }

  /**
   * 재시도 지연 시간 계산
   */
  private calculateRetryDelay(attempt: number, retryAfter?: number): number {
    if (retryAfter) {
      return retryAfter;
    }
    
    const config = getConfig();
    const baseDelay = config.RATE_LIMIT.RETRY_DELAY_MS;
    return Math.min(baseDelay * Math.pow(2, attempt), 30000); // 최대 30초
  }

  /**
   * API 에러 생성
   */
  private createApiError(error: Error): ApiError {
    const apiError = error as ApiError;
    
    if (error.message.includes('429') || error.message.includes('RESOURCE_EXHAUSTED')) {
      apiError.type = ApiErrorType.RATE_LIMIT_EXCEEDED;
      apiError.retryable = true;
      apiError.retryAfter = 5000;
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
   * 에러 타입에 따른 응답 상태 결정
   */
  private getResponseStatusFromError(error: ApiError): ApiResponseStatus {
    switch (error.type) {
      case ApiErrorType.RATE_LIMIT_EXCEEDED:
        return ApiResponseStatus.RATE_LIMITED;
      case ApiErrorType.NETWORK_ERROR:
      case ApiErrorType.TIMEOUT:
        return ApiResponseStatus.RETRYING;
      default:
        return ApiResponseStatus.ERROR;
    }
  }

  /**
   * 스트림 메시지 전송 (실시간 응답)
   */
  async sendMessageStream(
    message: string, 
    onChunk: (chunk: string) => void
  ): Promise<ApiResponse<void>> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    
    try {
      // 캐시에서 전체 답변 조회
      const cachedAnswer = qaCache.getAnswer(message);
      if (cachedAnswer) {
        // 캐시된 답변을 청크 단위로 시뮬레이션
        this.simulateStreamResponse(cachedAnswer, onChunk);
        
        const responseTime = Date.now() - startTime;
        this.emit('streamCacheHit', { message, answer: cachedAnswer, responseTime });
        
        return {
          status: ApiResponseStatus.CACHED,
          responseTime,
          fromCache: true,
          retryCount: 0,
          requestId,
          timestamp: Date.now()
        };
      }

      // API 호출
      if (!this.chatSession) {
        throw new Error('Chat session not initialized');
      }

      const stream = await this.chatSession.sendMessageStream({ message });
      let fullResponse = '';
      
      for await (const chunk of stream) {
        fullResponse += chunk.text;
        onChunk(chunk.text);
      }
      
      // 완전한 응답을 캐시에 저장
      qaCache.setAnswer(message, fullResponse);
      
      const responseTime = Date.now() - startTime;
      this.emit('streamMessageSent', { message, answer: fullResponse, responseTime });
      
      return {
        status: ApiResponseStatus.SUCCESS,
        responseTime,
        fromCache: false,
        retryCount: 0,
        requestId,
        timestamp: Date.now()
      };
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const apiError = this.createApiError(error as Error);
      
      this.emit('streamError', { message, error: apiError, responseTime });
      
      return {
        status: this.getResponseStatusFromError(apiError),
        error: apiError.message,
        responseTime,
        fromCache: false,
        retryCount: 0,
        requestId,
        timestamp: Date.now()
      };
    }
  }

  /**
   * 캐시된 응답을 스트림으로 시뮬레이션
   */
  private simulateStreamResponse(answer: string, onChunk: (chunk: string) => void): void {
    const words = answer.split(' ');
    let index = 0;
    
    const sendNextChunk = () => {
      if (index < words.length) {
        const chunk = words[index] + (index < words.length - 1 ? ' ' : '');
        onChunk(chunk);
        index++;
        setTimeout(sendNextChunk, 50); // 50ms 간격으로 전송
      }
    };
    
    sendNextChunk();
  }

  /**
   * 캐시 통계 조회
   */
  getCacheStats() {
    return cacheService.getStats();
  }

  /**
   * 요청 큐 상태 조회
   */
  getQueueStatus() {
    return queueHelpers.getStatus();
  }

  /**
   * 서비스 상태 조회
   */
  getServiceStatus() {
    return {
      isInitialized: this.isInitialized,
      hasSourceText: !!this.sourceText,
      hasChatSession: !!this.chatSession,
      cacheStats: this.getCacheStats(),
      queueStatus: this.getQueueStatus()
    };
  }

  /**
   * 캐시 초기화
   */
  clearCache(): void {
    cacheService.clear();
    this.emit('cacheCleared', {});
  }

  /**
   * 요청 큐 초기화
   */
  clearQueue(): void {
    queueHelpers.clear();
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
          console.error(`Error in GeminiService event callback for ${event}:`, error);
        }
      });
    }
  }

  /**
   * 고유 요청 ID 생성
   */
  private generateRequestId(): string {
    return `gemini_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 대기 함수
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 전역 Gemini 서비스 인스턴스
 */
export const geminiService = new GeminiService();

/**
 * Gemini 서비스 헬퍼 함수들
 */
export const geminiHelpers = {
  /**
   * 소스 텍스트 설정
   */
  async setSourceText(sourceText: string): Promise<void> {
    return geminiService.setSourceText(sourceText);
  },

  /**
   * 메시지 전송
   */
  async sendMessage(message: string): Promise<ApiResponse<string>> {
    return geminiService.sendMessage(message);
  },

  /**
   * 스트림 메시지 전송
   */
  async sendMessageStream(
    message: string, 
    onChunk: (chunk: string) => void
  ): Promise<ApiResponse<void>> {
    return geminiService.sendMessageStream(message, onChunk);
  },

  /**
   * 서비스 상태 조회
   */
  getServiceStatus() {
    return geminiService.getServiceStatus();
  },

  /**
   * 캐시 통계 조회
   */
  getCacheStats() {
    return geminiService.getCacheStats();
  },

  /**
   * 요청 큐 상태 조회
   */
  getQueueStatus() {
    return geminiService.getQueueStatus();
  },

  /**
   * 캐시 초기화
   */
  clearCache(): void {
    geminiService.clearCache();
  },

  /**
   * 요청 큐 초기화
   */
  clearQueue(): void {
    geminiService.clearQueue();
  },

  /**
   * 이벤트 리스너 등록
   */
  on(event: string, callback: EventCallback): void {
    geminiService.on(event, callback);
  },

  /**
   * 이벤트 리스너 제거
   */
  off(event: string, callback: EventCallback): void {
    geminiService.off(event, callback);
  }
};
