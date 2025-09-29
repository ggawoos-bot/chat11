/**
 * LLM 선택 컴포넌트
 * GEMINI와 Ollama 서비스 간 전환 및 모델 선택 기능
 */

import React, { useState, useEffect } from 'react';

interface LlmService {
  type: 'gemini' | 'ollama';
  name: string;
  description: string;
  available: boolean;
}

interface OllamaModel {
  name: string;
  size: number;
  description: string;
  recommended: boolean;
}

interface LlmSelectorProps {
  currentService: 'gemini' | 'ollama';
  onServiceChange: (service: 'gemini' | 'ollama') => void;
  onModelChange?: (model: string) => void;
  className?: string;
}

const LlmSelector: React.FC<LlmSelectorProps> = ({
  currentService,
  onServiceChange,
  onModelChange,
  className = ""
}) => {
  const [availableServices, setAvailableServices] = useState<LlmService[]>([]);
  const [availableModels, setAvailableModels] = useState<OllamaModel[]>([]);
  const [currentModel, setCurrentModel] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 사용 가능한 서비스 목록 조회
  useEffect(() => {
    const fetchServices = async () => {
      try {
        // 실제 구현에서는 API 호출
        const services: LlmService[] = [
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
            available: true
          }
        ];
        setAvailableServices(services);
      } catch (err) {
        setError('서비스 목록을 불러올 수 없습니다.');
      }
    };

    fetchServices();
  }, []);

  // Ollama 모델 목록 조회
  useEffect(() => {
    if (currentService === 'ollama') {
      const fetchModels = async () => {
        try {
          setIsLoading(true);
          setError(null);
          
          // Ollama API에서 실제 설치된 모델 목록 가져오기
          const response = await fetch('http://localhost:11434/api/tags');
          if (!response.ok) {
            throw new Error(`Ollama 서버 연결 실패: ${response.status}`);
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
              description: getModelDescription(model.name),
              recommended: isRecommended
            };
          });
          
          // exaone 모델을 맨 앞으로 정렬
          models.sort((a, b) => {
            if (a.name.includes('exaone') && !b.name.includes('exaone')) return -1;
            if (!a.name.includes('exaone') && b.name.includes('exaone')) return 1;
            return a.name.localeCompare(b.name);
          });
          
          setAvailableModels(models);
          
          // exaone 모델이 있으면 기본값으로 설정, 없으면 첫 번째 모델 선택
          const exaoneModel = models.find(m => m.name.includes('exaone'));
          setCurrentModel(exaoneModel?.name || models[0]?.name || '');
          
        } catch (err) {
          console.error('Failed to fetch models:', err);
          setError('모델 목록을 불러올 수 없습니다. Ollama 서버가 실행 중인지 확인해주세요.');
        } finally {
          setIsLoading(false);
        }
      };

      fetchModels();
    }
  }, [currentService]);

  // 모델 설명 생성 함수
  const getModelDescription = (modelName: string): string => {
    if (modelName.includes('exaone')) {
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
  };

  const handleServiceChange = async (serviceType: 'gemini' | 'ollama') => {
    try {
      setIsLoading(true);
      setError(null);
      await onServiceChange(serviceType);
    } catch (err) {
      setError(`서비스 변경 실패: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleModelChange = async (modelName: string) => {
    try {
      setIsLoading(true);
      setError(null);
      setCurrentModel(modelName);
      if (onModelChange) {
        await onModelChange(modelName);
      }
    } catch (err) {
      setError(`모델 변경 실패: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const formatModelSize = (size: number): string => {
    return `${size}GB`;
  };

  const getMemoryStatus = (size: number): { color: string; text: string } => {
    if (size <= 4) return { color: 'text-green-400', text: '메모리 충분' };
    if (size <= 8) return { color: 'text-yellow-400', text: '메모리 주의' };
    return { color: 'text-red-400', text: '메모리 부족' };
  };

  return (
    <div className={`bg-brand-surface rounded-lg p-4 space-y-4 ${className}`}>
      <h3 className="text-lg font-semibold text-brand-primary">LLM 설정</h3>
      
      {/* 에러 표시 */}
      {error && (
        <div className="flex items-center gap-2 text-red-400 bg-red-900/20 p-2 rounded">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* 서비스 선택 */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-brand-text-primary">AI 서비스</label>
        <div className="grid grid-cols-1 gap-2">
          {availableServices.map((service) => (
            <button
              key={service.type}
              onClick={() => handleServiceChange(service.type)}
              disabled={!service.available || isLoading}
              className={`p-3 rounded-lg border-2 transition-all text-left ${
                currentService === service.type
                  ? 'border-brand-primary bg-brand-primary/10'
                  : 'border-brand-secondary hover:border-brand-primary/50'
              } ${
                !service.available
                  ? 'opacity-50 cursor-not-allowed'
                  : 'cursor-pointer'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-brand-text-primary">{service.name}</div>
                  <div className="text-sm text-brand-text-secondary">{service.description}</div>
                </div>
                <div className="flex items-center gap-2">
                  {!service.available && (
                    <span className="text-xs text-red-400">사용 불가</span>
                  )}
                  {currentService === service.type && (
                    <div className="w-2 h-2 bg-brand-primary rounded-full"></div>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Ollama 모델 선택 */}
      {currentService === 'ollama' && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-brand-text-primary">모델 선택</label>
          {isLoading ? (
            <div className="flex items-center justify-center p-4">
              <div className="w-6 h-6 border-2 border-brand-primary border-t-transparent rounded-full animate-spin"></div>
              <span className="ml-2 text-brand-text-secondary">모델 목록 로딩 중...</span>
            </div>
          ) : (
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {availableModels.map((model) => {
                const memoryStatus = getMemoryStatus(model.size);
                return (
                  <button
                    key={model.name}
                    onClick={() => handleModelChange(model.name)}
                    disabled={isLoading}
                    className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                      currentModel === model.name
                        ? 'border-brand-primary bg-brand-primary/10'
                        : 'border-brand-secondary hover:border-brand-primary/50'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-brand-text-primary">{model.name}</span>
                          {model.recommended && (
                            <span className="px-2 py-1 text-xs bg-green-600 text-white rounded">추천</span>
                          )}
                        </div>
                        <div className="text-sm text-brand-text-secondary mt-1">{model.description}</div>
                        <div className="flex items-center gap-4 mt-2 text-xs">
                          <span className="text-brand-text-secondary">크기: {formatModelSize(model.size)}</span>
                          <span className={memoryStatus.color}>{memoryStatus.text}</span>
                        </div>
                      </div>
                      {currentModel === model.name && (
                        <div className="w-2 h-2 bg-brand-primary rounded-full mt-2"></div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 현재 설정 요약 */}
      <div className="pt-2 border-t border-brand-secondary">
        <div className="text-sm text-brand-text-secondary">
          <div className="flex justify-between">
            <span>현재 서비스:</span>
            <span className="text-brand-text-primary">
              {availableServices.find(s => s.type === currentService)?.name || 'Unknown'}
            </span>
          </div>
          {currentService === 'ollama' && currentModel && (
            <div className="flex justify-between mt-1">
              <span>현재 모델:</span>
              <span className="text-brand-text-primary">{currentModel}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LlmSelector;

