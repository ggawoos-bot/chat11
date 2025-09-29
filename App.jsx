// Main App Component
import { useState, useCallback, useMemo, useEffect } from 'react';
import { createNotebookChatSession } from './services/geminiService.js';
import { sendOllamaMessage } from './services/ollamaService.js';
import { LlmSelector } from './components/LlmSelector.js';
import { ChatWindow } from './components/ChatWindow.js';
import { MessageInput } from './components/MessageInput.js';

// Role constants
const Role = {
  USER: 'user',
  MODEL: 'model',
};

const App = () => {
  const [sourceText, setSourceText] = useState('');
  const [messages, setMessages] = useState([]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [lastSentMessage, setLastSentMessage] = useState('');
  const [isParsing, setIsParsing] = useState(true);
  const [discoveredFiles, setDiscoveredFiles] = useState([]);
  const [error, setError] = useState(null);
  
  // LLM 관련 상태
  const [currentService, setCurrentService] = useState('gemini');
  const [currentModel, setCurrentModel] = useState('exaone3.5:latest');
  
  // 새로운 상태 추가
  const [lastMessageTime, setLastMessageTime] = useState(0);
  const [cacheStats, setCacheStats] = useState({
    totalItems: 0,
    hitRate: 0,
    totalSize: 0
  });
  const [queueStatus, setQueueStatus] = useState({
    totalLength: 0,
    pendingCount: 0,
    processingCount: 0,
    failedCount: 0
  });
  const [showStats, setShowStats] = useState(false);
  
  // 다음 시도 가능시간 관련 상태
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [nextRetryTime, setNextRetryTime] = useState(null);

  const PDF_BASE_URL = 'https://ggawoos-bot.github.io/chat2/pdf/';

  const chatSession = useMemo(() => {
    if (sourceText.trim()) {
      try {
        if (currentService === 'gemini') {
          return createNotebookChatSession(sourceText);
        }
        return null; // Ollama는 별도 처리
      } catch (e) {
        console.error("Error creating chat session:", e);
        setError(e instanceof Error ? e.message : "Failed to create chat session.");
        return null;
      }
    }
    return null;
  }, [sourceText, currentService]);
  
  const parsePdfFromUrl = async (url) => {
    try {
      const pdfData = await fetch(url).then(res => {
        if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status}`);
        return res.arrayBuffer();
      });
      
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(pdfData) }).promise;
      let fullText = '';
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += `\n--- PAGE ${i} ---\n${pageText}\n`;
      }
      
      return fullText;
    } catch (error) {
      console.error(`Error parsing PDF from ${url}:`, error);
      return `Error parsing PDF: ${error.message}`;
    }
  };

  const discoverAndParsePdfs = async () => {
    try {
      setIsParsing(true);
      setError(null);
      
      const manifestUrl = PDF_BASE_URL + 'manifest.json';
      const manifestResponse = await fetch(manifestUrl);
      
      if (!manifestResponse.ok) {
        throw new Error(`Failed to fetch manifest: ${manifestResponse.status}`);
      }
      
      const pdfFiles = await manifestResponse.json();
      setDiscoveredFiles(pdfFiles);
      
      const parsingPromises = pdfFiles.map(file => parsePdfFromUrl(PDF_BASE_URL + file));
      const texts = await Promise.all(parsingPromises);
      const combinedText = texts.join('\n--- END OF DOCUMENT ---\n\n--- START OF DOCUMENT ---\n');
      
      setSourceText(combinedText);
      setIsParsing(false);
    } catch (error) {
      console.error('Error discovering and parsing PDFs:', error);
      setError(`Failed to load documents: ${error.message}`);
      setIsParsing(false);
    }
  };

  const handleSendMessage = useCallback(async (e) => {
    e.preventDefault();
    
    if (isLoading || !currentMessage.trim()) return;
    
    const userMessage = { role: Role.USER, content: currentMessage.trim() };
    setMessages(prev => [...prev, userMessage]);
    setLastSentMessage(currentMessage.trim());
    setCurrentMessage('');
    setIsLoading(true);
    setLastMessageTime(Date.now());
    
    try {
      let response;
      
      if (currentService === 'gemini' && chatSession) {
        const stream = await chatSession.sendMessageStream({ message: userMessage.content });
        response = stream.response.text();
      } else if (currentService === 'ollama') {
        response = await sendOllamaMessage(userMessage.content, sourceText, currentModel);
      } else {
        throw new Error('No valid service available');
      }
      
      const modelMessage = { role: Role.MODEL, content: response, timestamp: Date.now() };
      setMessages(prev => [...prev, modelMessage]);
      setError(null);
    } catch (error) {
      console.error('Error sending message:', error);
      
      if (error.message.includes('quota') || error.message.includes('429')) {
        const retryDelay = 60000; // 1분
        setRetryCountdown(retryDelay);
        
        const nextRetry = new Date(Date.now() + retryDelay);
        setNextRetryTime(nextRetry);
        
        const retryTimeString = nextRetry.toLocaleTimeString('ko-KR', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        
        setError(`API 한도 초과. 다음 시도 가능 시간: ${retryTimeString}`);
        
        const countdownSeconds = Math.floor(retryDelay / 1000);
        setRetryCountdown(countdownSeconds);
        
        const countdownTimer = setInterval(() => {
          setRetryCountdown(prev => {
            if (prev <= 1) {
              clearInterval(countdownTimer);
              setError(null);
              setNextRetryTime(null);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        setError(`메시지 전송 실패: ${error.message}`);
      }
    } finally {
      setIsLoading(false);
    }
  }, [currentMessage, isLoading, chatSession, currentService, currentModel, sourceText]);

  const updateStats = useCallback(() => {
    // 실제 구현에서는 캐시와 큐 상태를 업데이트
    setCacheStats({
      totalItems: Math.floor(Math.random() * 100),
      hitRate: Math.random() * 0.5,
      totalSize: Math.floor(Math.random() * 1000000)
    });
    
    setQueueStatus({
      totalLength: Math.floor(Math.random() * 10),
      pendingCount: Math.floor(Math.random() * 5),
      processingCount: Math.floor(Math.random() * 3),
      failedCount: Math.floor(Math.random() * 2)
    });
  }, []);

  useEffect(() => {
    discoverAndParsePdfs();
    
    const interval = setInterval(updateStats, 5000);
    return () => clearInterval(interval);
  }, [updateStats]);

  const handleServiceChange = async (serviceType) => {
    setCurrentService(serviceType);
    if (serviceType === 'ollama') {
      setCurrentModel('exaone3.5:latest');
    }
  };

  const handleModelChange = async (modelName) => {
    setCurrentModel(modelName);
  };

  return (
    <div className="min-h-screen bg-brand-bg">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-brand-text-primary mb-2">
              금연사업 지침 문의 Chatbot
            </h1>
            <p className="text-brand-text-secondary">
              PDF 문서를 업로드하고 질문하세요
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* 좌측 사이드바 */}
            <div className="lg:col-span-1 space-y-4">
              <LlmSelector
                currentService={currentService}
                onServiceChange={handleServiceChange}
                onModelChange={handleModelChange}
              />
            </div>

            {/* 메인 채팅 영역 */}
            <div className="lg:col-span-3">
              <div className="bg-brand-surface rounded-lg shadow-lg overflow-hidden">
                {error && (
                  <div className="p-4 bg-red-900/50 text-red-300 border-b border-red-700">
                    <div className="whitespace-pre-line text-sm">{error}</div>
                    
                    {retryCountdown > 0 && (
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <div className="w-3 h-3 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin"></div>
                            <span>대기 중...</span>
                          </div>
                          <span className="font-mono text-yellow-300">
                            {Math.floor(retryCountdown / 60)}:{String(retryCountdown % 60).padStart(2, '0')}
                          </span>
                        </div>
                        
                        <div className="w-full bg-red-800 rounded-full h-2">
                          <div 
                            className="bg-gradient-to-r from-yellow-400 to-green-400 h-2 rounded-full transition-all duration-1000"
                            style={{ width: `${100 - (retryCountdown / (retryCountdown > 0 ? Math.max(retryCountdown, 60) : 60)) * 100}%` }}
                          ></div>
                        </div>
                        
                        <div className="text-xs text-red-200">
                          {retryCountdown > 90 ? '🔴 API 한도 초과 - 대기 중' :
                           retryCountdown > 30 ? '🟡 복구 중 - 잠시만 기다려주세요' :
                           '🟢 곧 사용 가능합니다'}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <ChatWindow 
                  messages={messages} 
                  isLoading={isLoading} 
                  sourceProvided={!!sourceText}
                  isParsingDocs={isParsing}
                />
                <MessageInput
                  currentMessage={currentMessage}
                  setCurrentMessage={setCurrentMessage}
                  onSendMessage={handleSendMessage}
                  isLoading={isLoading}
                  disabled={!sourceText || isParsing || retryCountdown > 0}
                  lastMessageTime={lastMessageTime}
                  maxLength={500}
                  minInterval={5000}
                  retryCountdown={retryCountdown}
                  lastSentMessage={lastSentMessage}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
