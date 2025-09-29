/**
 * LLM 서비스 팩토리
 * GEMINI와 Ollama 서비스를 통합 관리하는 팩토리 클래스
 */

import { geminiService, geminiHelpers } from './geminiService.js';
import { ollamaService, ollamaHelpers, OllamaModel } from './ollamaService.js';
import { getConfig } from '../config/apiConfig.js';
import { 
  ApiResponse, 
  ApiResponseStatus, 
  ApiError, 
  ApiErrorType,
  EventCallback 
} from '../types/api.js';

/**
 * LLM 서비스 타입
 */
export type LlmServiceType = 'gemini' | 'ollama';

/**
 * 통합 LLM 서비스 인터페이스
 */
export interface LlmService {
  setSourceText(sourceText: string): Promise<void>;
  sendMessage(message: string): Promise<ApiResponse<string>>;
  sendMessageStream(message: string, onChunk: (chunk: string) => void): Promise<ApiResponse<void>>;
  getServiceStatus(): any;
  getCacheStats(): any;
  getQueueStatus(): any;
  clearCache(): void;
  clearQueue(): void;
  on(event: string, callback: EventCallback): void;
  off(event: string, callback: EventCallback): void;
}

/**
 * LLM 서비스 팩토리 클래스
 */
export class LlmServiceFactory {
  private currentService: LlmServiceType;
  private config: any;

  constructor() {
    this.config = getConfig();
    this.currentService = this.config.LLM.SERVICE_TYPE;
  }

  /**
   * 현재 서비스 타입 조회
   */
  getCurrentServiceType(): LlmServiceType {
    return this.currentService;
  }

  /**
   * 서비스 타입 변경
   */
  async setServiceType(serviceType: LlmServiceType): Promise<void> {
    try {
      // Ollama 서비스로 변경 시 연결 확인
      if (serviceType === 'ollama') {
        await this.validateOllamaConnection();
      }
      
      this.currentService = serviceType;
      this.config.LLM.SERVICE_TYPE = serviceType;
      
      console.log(`LLM service changed to: ${serviceType}`);
    } catch (error) {
      throw new Error(`Failed to change service type to ${serviceType}: ${error}`);
    }
  }

  /**
   * Ollama 연결 확인
   */
  private async validateOllamaConnection(): Promise<void> {
    try {
      const response = await fetch(`${this.config.LLM.OLLAMA_BASE_URL}/api/tags`);
      if (!response.ok) {
        throw new Error(`Ollama server not responding: ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Cannot connect to Ollama server at ${this.config.LLM.OLLAMA_BASE_URL}. Please ensure Ollama is running.`);
    }
  }

  /**
   * 현재 활성 서비스 인스턴스 조회
   */
  getCurrentService(): LlmService {
    switch (this.currentService) {
      case 'gemini':
        return geminiService;
      case 'ollama':
        return ollamaService;
      default:
        throw new Error(`Unknown service type: ${this.currentService}`);
    }
  }

  /**
   * 현재 활성 헬퍼 함수들 조회
   */
  getCurrentHelpers(): any {
    switch (this.currentService) {
      case 'gemini':
        return geminiHelpers;
      case 'ollama':
        return ollamaHelpers;
      default:
        throw new Error(`Unknown service type: ${this.currentService}`);
    }
  }

  /**
   * 사용 가능한 서비스 목록 조회
   */
  getAvailableServices(): Array<{type: LlmServiceType, name: string, description: string, available: boolean}> {
    return [
      {
        type: 'gemini',
        name: 'Google Gemini',
        description: 'Google의 Gemini API 서비스 (인터넷 연결 필요)',
        available: !!process.env.API_KEY
      },
      {
        type: 'ollama',
        name: 'Ollama (로컬)',
        description: '로컬 Ollama 서버 (오프라인 가능)',
        available: true // 연결 확인은 실제 사용 시에 수행
      }
    ];
  }

  /**
   * Ollama 모델 목록 조회 (Ollama 서비스일 때만)
   */
  async getAvailableModels(): Promise<OllamaModel[] | null> {
    if (this.currentService === 'ollama') {
      return ollamaService.getAvailableModels();
    }
    return null;
  }

  /**
   * Ollama 모델 설정 (Ollama 서비스일 때만)
   */
  async setModel(modelName: string): Promise<void> {
    if (this.currentService === 'ollama') {
      return ollamaService.setModel(modelName);
    }
    throw new Error('Model setting is only available for Ollama service');
  }

  /**
   * 현재 모델 조회 (Ollama 서비스일 때만)
   */
  getCurrentModel(): string | null {
    if (this.currentService === 'ollama') {
      return ollamaService.getCurrentModel();
    }
    return null;
  }

  /**
   * 서비스 상태 조회
   */
  getServiceStatus() {
    const service = this.getCurrentService();
    const status = service.getServiceStatus();
    
    return {
      ...status,
      serviceType: this.currentService,
      availableServices: this.getAvailableServices()
    };
  }

  /**
   * 설정 조회
   */
  getConfig() {
    return this.config;
  }

  /**
   * 설정 업데이트
   */
  updateConfig(newConfig: any) {
    this.config = { ...this.config, ...newConfig };
  }
}

/**
 * 전역 LLM 서비스 팩토리 인스턴스
 */
export const llmServiceFactory = new LlmServiceFactory();

/**
 * 통합 LLM 헬퍼 함수들
 * 현재 활성 서비스에 따라 적절한 서비스로 라우팅
 */
export const llmHelpers = {
  /**
   * 소스 텍스트 설정
   */
  async setSourceText(sourceText: string): Promise<void> {
    const service = llmServiceFactory.getCurrentService();
    return service.setSourceText(sourceText);
  },

  /**
   * 메시지 전송
   */
  async sendMessage(message: string): Promise<ApiResponse<string>> {
    const service = llmServiceFactory.getCurrentService();
    return service.sendMessage(message);
  },

  /**
   * 스트림 메시지 전송
   */
  async sendMessageStream(
    message: string, 
    onChunk: (chunk: string) => void
  ): Promise<ApiResponse<void>> {
    const service = llmServiceFactory.getCurrentService();
    return service.sendMessageStream(message, onChunk);
  },

  /**
   * 서비스 타입 변경
   */
  async setServiceType(serviceType: LlmServiceType): Promise<void> {
    return llmServiceFactory.setServiceType(serviceType);
  },

  /**
   * 현재 서비스 타입 조회
   */
  getCurrentServiceType(): LlmServiceType {
    return llmServiceFactory.getCurrentServiceType();
  },

  /**
   * 사용 가능한 서비스 목록 조회
   */
  getAvailableServices() {
    return llmServiceFactory.getAvailableServices();
  },

  /**
   * 사용 가능한 모델 목록 조회 (Ollama일 때만)
   */
  async getAvailableModels() {
    return llmServiceFactory.getAvailableModels();
  },

  /**
   * 모델 설정 (Ollama일 때만)
   */
  async setModel(modelName: string): Promise<void> {
    return llmServiceFactory.setModel(modelName);
  },

  /**
   * 현재 모델 조회 (Ollama일 때만)
   */
  getCurrentModel(): string | null {
    return llmServiceFactory.getCurrentModel();
  },

  /**
   * 서비스 상태 조회
   */
  getServiceStatus() {
    return llmServiceFactory.getServiceStatus();
  },

  /**
   * 캐시 통계 조회
   */
  getCacheStats() {
    const service = llmServiceFactory.getCurrentService();
    return service.getCacheStats();
  },

  /**
   * 요청 큐 상태 조회
   */
  getQueueStatus() {
    const service = llmServiceFactory.getCurrentService();
    return service.getQueueStatus();
  },

  /**
   * 캐시 초기화
   */
  clearCache(): void {
    const service = llmServiceFactory.getCurrentService();
    service.clearCache();
  },

  /**
   * 요청 큐 초기화
   */
  clearQueue(): void {
    const service = llmServiceFactory.getCurrentService();
    service.clearQueue();
  },

  /**
   * 이벤트 리스너 등록
   */
  on(event: string, callback: EventCallback): void {
    const service = llmServiceFactory.getCurrentService();
    service.on(event, callback);
  },

  /**
   * 이벤트 리스너 제거
   */
  off(event: string, callback: EventCallback): void {
    const service = llmServiceFactory.getCurrentService();
    service.off(event, callback);
  },

  /**
   * 설정 조회
   */
  getConfig() {
    return llmServiceFactory.getConfig();
  }
};

