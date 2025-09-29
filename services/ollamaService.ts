/**
 * Ollama API 통합 서비스
 * 캐시 시스템과 요청 큐를 통합한 Ollama API 서비스
 */

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
 * Ollama 모델 정보 인터페이스
 */
export interface OllamaModel {
  name: string;
  size: number; // GB
  description: string;
  recommended: boolean;
}

/**
 * Ollama API 통합 서비스 클래스
 */
export class OllamaService {
  private baseUrl: string;
  private currentModel: string;
  private sourceText: string = '';
  private isInitialized = false;
  private eventCallbacks: Map<string, EventCallback[]> = new Map();

  // 16GB 메모리에 적합한 모델들
  private availableModels: OllamaModel[] = [
    { name: 'exaone3.5:2.4b', size: 2, description: 'Exaone 3.5 2.4B - 빠른 한국어 특화 모델', recommended: true },
    { name: 'exaone3.5:7.8b', size: 5, description: 'Exaone 3.5 7.8B - 균형잡힌 한국어 모델', recommended: true },
    { name: 'exaone3.5:32b', size: 20, description: 'Exaone 3.5 32B - 고성능 한국어 모델', recommended: false },
    { name: 'solar:10.7b', size: 6, description: 'Solar 10.7B - 고성능 한국어 특화 모델', recommended: false },
    { name: 'llama3.2:3b', size: 2, description: 'Meta LLaMA 3.2 3B - 빠르고 효율적', recommended: false },
    { name: 'llama3.2:7b', size: 4, description: 'Meta LLaMA 3.2 7B - 균형잡힌 성능', recommended: false },
    { name: 'mistral:7b', size: 4, description: 'Mistral 7B - 고성능 소형 모델', recommended: false },
    { name: 'codellama:7b', size: 4, description: 'Code Llama 7B - 코드 특화', recommended: false },
    { name: 'llama3.1:8b', size: 5, description: 'Meta LLaMA 3.1 8B - 안정적 성능', recommended: false },
    { name: 'qwen2.5:7b', size: 4, description: 'Qwen 2.5 7B - 다국어 지원', recommended: false },
    { name: 'gemma2:9b', size: 5, description: 'Google Gemma 2 9B - Google 모델', recommended: false }
  ];

  constructor() {
    this.baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    this.currentModel = process.env.OLLAMA_MODEL || 'exaone3.5:2.4b';
    this.initializeService();
  }

  /**
   * 서비스 초기화
   */
  private async initializeService(): Promise<void> {
    try {
      // Ollama 서버 연결 확인
      await this.checkOllamaConnection();
      
      // 모델 다운로드 확인
      await this.ensureModelAvailable();
      
      this.isInitialized = true;
      this.emit('serviceInitialized', { model: this.currentModel });
    } catch (error) {
      console.error('Ollama service initialization failed:', error);
      this.emit('serviceError', { error });
      throw error;
    }
  }

  /**
   * Ollama 서버 연결 확인
   */
  private async checkOllamaConnection(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`Ollama server not responding: ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Failed to connect to Ollama server at ${this.baseUrl}. Please ensure Ollama is running.`);
    }
  }

  /**
   * 모델 사용 가능 여부 확인 및 다운로드
   */
  private async ensureModelAvailable(): Promise<void> {
    try {
      // 현재 모델이 설치되어 있는지 확인
      const response = await fetch(`${this.baseUrl}/api/tags`);
      const data = await response.json();
      const installedModels = data.models?.map((m: any) => m.name) || [];
      
      if (!installedModels.includes(this.currentModel)) {
        console.log(`Model ${this.currentModel} not found. Installing...`);
        await this.pullModel(this.currentModel);
      }
    } catch (error) {
      throw new Error(`Failed to ensure model availability: ${error}`);
    }
  }

  /**
   * 모델 다운로드
   */
  private async pullModel(modelName: string): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: modelName })
      });

      if (!response.ok) {
        throw new Error(`Failed to pull model ${modelName}: ${response.status}`);
      }

      // 다운로드 진행률 모니터링
      const reader = response.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n').filter(line => line.trim());
          
          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              if (data.status) {
                this.emit('modelDownloadProgress', { 
                  model: modelName, 
                  status: data.status,
                  completed: data.completed,
                  total: data.total
                });
              }
            } catch (e) {
              // JSON 파싱 실패는 무시
            }
          }
        }
      }
    } catch (error) {
      throw new Error(`Failed to pull model ${modelName}: ${error}`);
    }
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
   * 소스 텍스트 설정
   */
  async setSourceText(sourceText: string): Promise<void> {
    try {
      this.sourceText = sourceText;
      this.emit('sourceTextSet', { sourceText });
    } catch (error) {
      const apiError = this.createApiError(error as Error);
      this.emit('sourceTextError', { error: apiError });
      throw apiError;
    }
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
    if (!this.isInitialized) {
      throw new Error('Ollama service not initialized');
    }

    return new Promise((resolve, reject) => {
      const request = {
        message,
        sourceText: this.sourceText,
        model: this.currentModel
      };

      requestQueue.addRequest(request, async (requestData) => {
        try {
          const answer = await this.callOllamaAPI(requestData);
          resolve(answer);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  /**
   * Ollama API 호출
   */
  private async callOllamaAPI(requestData: any): Promise<string> {
    const systemInstruction = this.createSystemInstruction(requestData.sourceText);
    
    const payload = {
      model: requestData.model,
      messages: [
        {
          role: 'system',
          content: systemInstruction
        },
        {
          role: 'user',
          content: requestData.message
        }
      ],
      stream: false,
      options: {
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 2048
      }
    };

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.message && data.message.content) {
        return data.message.content.trim();
      } else {
        throw new Error('Invalid response format from Ollama API');
      }
    } catch (error) {
      throw new Error(`Ollama API call failed: ${error}`);
    }
  }

  /**
   * 스트림 메시지 전송
   */
  async sendMessageStream(
    message: string, 
    onChunk: (chunk: string) => void
  ): Promise<ApiResponse<void>> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();
    
    try {
      if (!this.isInitialized) {
        throw new Error('Ollama service not initialized');
      }

      const systemInstruction = this.createSystemInstruction(this.sourceText);
      
      const payload = {
        model: this.currentModel,
        messages: [
          {
            role: 'system',
            content: systemInstruction
          },
          {
            role: 'user',
            content: message
          }
        ],
        stream: true,
        options: {
          temperature: 0.7,
          top_p: 0.9,
          max_tokens: 2048
        }
      };

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body reader available');
      }

      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.message && data.message.content) {
              const content = data.message.content;
              fullResponse += content;
              onChunk(content);
            }
          } catch (e) {
            // JSON 파싱 실패는 무시
          }
        }
      }

      // 스트림 완료 후 캐시에 저장
      qaCache.setAnswer(message, fullResponse);

      const responseTime = Date.now() - startTime;
      this.emit('messageStreamCompleted', { message, answer: fullResponse, responseTime });

      return {
        status: ApiResponseStatus.SUCCESS,
        data: undefined,
        responseTime,
        fromCache: false,
        retryCount: 0,
        requestId,
        timestamp: Date.now()
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;
      const apiError = this.createApiError(error as Error);
      
      this.emit('messageStreamError', { message, error: apiError, responseTime });
      
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
   * 사용 가능한 모델 목록 조회
   */
  async getAvailableModels(): Promise<OllamaModel[]> {
    try {
      // Ollama API에서 실제 설치된 모델 목록 가져오기
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }
      
      const data = await response.json();
      const installedModels = data.models || [];
      
      // 설치된 모델들을 OllamaModel 형식으로 변환
      const models: OllamaModel[] = installedModels.map((model: any) => {
        const sizeInGB = Math.round((model.size || 0) / (1024 * 1024 * 1024) * 100) / 100;
        const isRecommended = model.name.includes('exaone') || model.name.includes('solar');
        
        return {
          name: model.name,
          size: sizeInGB,
          description: this.getModelDescription(model.name),
          recommended: isRecommended
        };
      });
      
      // exaone 모델을 맨 앞으로 정렬
      models.sort((a, b) => {
        if (a.name.includes('exaone') && !b.name.includes('exaone')) return -1;
        if (!a.name.includes('exaone') && b.name.includes('exaone')) return 1;
        return a.name.localeCompare(b.name);
      });
      
      return models;
    } catch (error) {
      console.error('Failed to fetch available models:', error);
      // 에러 시 기본 모델 목록 반환
      return [...this.availableModels];
    }
  }

  /**
   * 모델 이름에 따른 설명 생성
   */
  private getModelDescription(modelName: string): string {
    if (modelName.includes('exaone3.5:2.4b')) {
      return 'Exaone 3.5 2.4B - 빠른 한국어 특화 모델';
    } else if (modelName.includes('exaone3.5:7.8b')) {
      return 'Exaone 3.5 7.8B - 균형잡힌 한국어 모델';
    } else if (modelName.includes('exaone3.5:32b')) {
      return 'Exaone 3.5 32B - 고성능 한국어 모델';
    } else if (modelName.includes('exaone')) {
      return 'Exaone 3.5 - 한국어 특화 고성능 모델';
    } else if (modelName.includes('solar')) {
      return 'Solar - 고성능 한국어 특화 모델';
    } else if (modelName.includes('llama3.2')) {
      return 'Meta LLaMA 3.2 - 최신 Meta 모델';
    } else if (modelName.includes('llama3.1')) {
      return 'Meta LLaMA 3.1 - 안정적 성능의 Meta 모델';
    } else if (modelName.includes('deepseek')) {
      return 'DeepSeek R1 - 고성능 추론 모델';
    } else if (modelName.includes('timHan')) {
      return 'TimHan LLaMA Korean - 한국어 특화 모델';
    } else if (modelName.includes('mistral')) {
      return 'Mistral - 고성능 소형 모델';
    } else if (modelName.includes('codellama')) {
      return 'Code Llama - 코드 특화 모델';
    } else if (modelName.includes('qwen')) {
      return 'Qwen - 다국어 지원 모델';
    } else if (modelName.includes('gemma')) {
      return 'Google Gemma - Google 모델';
    } else {
      return `${modelName} - 사용자 정의 모델`;
    }
  }

  /**
   * 현재 모델 설정
   */
  async setModel(modelName: string): Promise<void> {
    try {
      // 실제 설치된 모델 목록에서 확인
      const models = await this.getAvailableModels();
      const model = models.find(m => m.name === modelName);
      
      if (!model) {
        throw new Error(`Model ${modelName} not available. Please check if the model is installed.`);
      }

      // 메모리 체크 (16GB 제한)
      if (model.size > 12) { // 12GB 이하로 제한 (시스템 메모리 고려)
        throw new Error(`Model ${modelName} requires ${model.size}GB, which exceeds available memory`);
      }

      this.currentModel = modelName;
      await this.ensureModelAvailable();
      
      this.emit('modelChanged', { model: modelName });
    } catch (error) {
      const apiError = this.createApiError(error as Error);
      this.emit('modelChangeError', { error: apiError });
      throw apiError;
    }
  }

  /**
   * 현재 모델 조회
   */
  getCurrentModel(): string {
    return this.currentModel;
  }

  /**
   * 서비스 상태 조회
   */
  getServiceStatus() {
    return {
      initialized: this.isInitialized,
      model: this.currentModel,
      baseUrl: this.baseUrl,
      sourceTextSet: !!this.sourceText
    };
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
   * 요청 ID 생성
   */
  private generateRequestId(): string {
    return `ollama_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * API 에러 생성
   */
  private createApiError(error: Error): ApiError {
    const apiError = error as ApiError;
    apiError.type = this.getErrorType(error);
    apiError.retryable = this.isRetryableError(error);
    return apiError;
  }

  /**
   * 에러 타입 결정
   */
  private getErrorType(error: Error): ApiErrorType {
    const message = error.message.toLowerCase();
    
    if (message.includes('rate limit') || message.includes('429')) {
      return ApiErrorType.RATE_LIMIT_EXCEEDED;
    } else if (message.includes('network') || message.includes('fetch')) {
      return ApiErrorType.NETWORK_ERROR;
    } else if (message.includes('timeout')) {
      return ApiErrorType.TIMEOUT;
    } else if (message.includes('400') || message.includes('invalid')) {
      return ApiErrorType.INVALID_REQUEST;
    } else if (message.includes('500') || message.includes('server')) {
      return ApiErrorType.SERVER_ERROR;
    } else {
      return ApiErrorType.UNKNOWN;
    }
  }

  /**
   * 재시도 가능한 에러인지 확인
   */
  private isRetryableError(error: Error): boolean {
    const message = error.message.toLowerCase();
    return message.includes('network') || 
           message.includes('timeout') || 
           message.includes('500') ||
           message.includes('server');
  }

  /**
   * 에러에서 응답 상태 결정
   */
  private getResponseStatusFromError(error: ApiError): ApiResponseStatus {
    switch (error.type) {
      case ApiErrorType.RATE_LIMIT_EXCEEDED:
        return ApiResponseStatus.RATE_LIMITED;
      case ApiErrorType.NETWORK_ERROR:
      case ApiErrorType.TIMEOUT:
      case ApiErrorType.SERVER_ERROR:
        return ApiResponseStatus.RETRYING;
      default:
        return ApiResponseStatus.ERROR;
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
          console.error(`Error in event callback for ${event}:`, error);
        }
      });
    }
  }
}

/**
 * 전역 Ollama 서비스 인스턴스
 */
export const ollamaService = new OllamaService();

/**
 * Ollama 서비스 헬퍼 함수들
 */
export const ollamaHelpers = {
  /**
   * 소스 텍스트 설정
   */
  async setSourceText(sourceText: string): Promise<void> {
    return ollamaService.setSourceText(sourceText);
  },

  /**
   * 메시지 전송
   */
  async sendMessage(message: string): Promise<ApiResponse<string>> {
    return ollamaService.sendMessage(message);
  },

  /**
   * 스트림 메시지 전송
   */
  async sendMessageStream(
    message: string, 
    onChunk: (chunk: string) => void
  ): Promise<ApiResponse<void>> {
    return ollamaService.sendMessageStream(message, onChunk);
  },

  /**
   * 사용 가능한 모델 목록 조회
   */
  async getAvailableModels() {
    return ollamaService.getAvailableModels();
  },

  /**
   * 모델 설정
   */
  async setModel(modelName: string): Promise<void> {
    return ollamaService.setModel(modelName);
  },

  /**
   * 현재 모델 조회
   */
  getCurrentModel() {
    return ollamaService.getCurrentModel();
  },

  /**
   * 서비스 상태 조회
   */
  getServiceStatus() {
    return ollamaService.getServiceStatus();
  },

  /**
   * 캐시 통계 조회
   */
  getCacheStats() {
    return ollamaService.getCacheStats();
  },

  /**
   * 요청 큐 상태 조회
   */
  getQueueStatus() {
    return ollamaService.getQueueStatus();
  },

  /**
   * 캐시 초기화
   */
  clearCache(): void {
    ollamaService.clearCache();
  },

  /**
   * 요청 큐 초기화
   */
  clearQueue(): void {
    ollamaService.clearQueue();
  },

  /**
   * 이벤트 리스너 등록
   */
  on(event: string, callback: EventCallback): void {
    ollamaService.on(event, callback);
  },

  /**
   * 이벤트 리스너 제거
   */
  off(event: string, callback: EventCallback): void {
    ollamaService.off(event, callback);
  }
};
