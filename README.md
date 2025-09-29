<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# 금연사업 지침 문의 Chatbot

PDF 문서 기반의 AI 챗봇으로, GEMINI API와 오픈소스 LLM(Ollama)을 모두 지원합니다.

## 주요 기능

- 📄 PDF 문서 자동 파싱 및 로딩
- 🤖 GEMINI API와 Ollama 로컬 LLM 지원
- 💾 응답 캐싱 시스템
- ⚡ 실시간 스트리밍 응답
- 🎛️ LLM 모델 선택 및 전환
- 📊 시스템 상태 모니터링

## 지원하는 LLM 서비스

### 1. Google Gemini API
- 인터넷 연결 필요
- 고성능 클라우드 기반 AI
- API 키 설정 필요

### 2. Ollama (로컬)
- 오프라인 사용 가능
- 16GB 메모리에 최적화된 모델들
- 로컬 서버 실행 필요

## 설치 및 실행

### Prerequisites
- Node.js 18+
- (Ollama 사용 시) Ollama 설치

### 1. 의존성 설치
```bash
npm install
```

### 2. 환경 변수 설정
`.env.local` 파일을 생성하고 다음을 설정:

```env
# GEMINI API (선택사항)
GEMINI_API_KEY=your_gemini_api_key_here

# Ollama 설정 (기본값)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=solar:10.7b
```

### 3. Ollama 설치 및 설정 (로컬 LLM 사용 시)

#### Windows
1. [Ollama 공식 사이트](https://ollama.ai/download)에서 다운로드
2. 설치 후 터미널에서 실행:
```bash
ollama serve
```

3. 추천 모델 다운로드 (16GB 메모리 기준):
```bash
# Solar 10.7B 모델 (한국어 특화, 고성능) - 추천
ollama pull solar:10.7b

# 기타 모델들
ollama pull llama3.2:3b
ollama pull llama3.2:7b
ollama pull mistral:7b
ollama pull codellama:7b
```

#### Linux/macOS
```bash
# Ollama 설치
curl -fsSL https://ollama.ai/install.sh | sh

# 서버 실행
ollama serve

# 모델 다운로드
ollama pull solar:10.7b
```

### 4. 애플리케이션 실행
```bash
npm run dev
```

## 사용 방법

1. **LLM 서비스 선택**: 좌측 패널에서 GEMINI 또는 Ollama 선택
2. **모델 선택**: Ollama 선택 시 사용할 모델 선택 (메모리 사용량 고려)
3. **문서 로딩**: PDF 문서가 자동으로 로딩됩니다
4. **질문하기**: 채팅창에서 금연사업 지침에 대해 질문

## 추천 모델 (16GB 메모리 기준)

| 모델 | 크기 | 메모리 사용량 | 특징 |
|------|------|---------------|------|
| solar:10.7b | 6GB | ~12GB | 한국어 특화 고성능 ⭐ |
| llama3.2:3b | 2GB | ~4GB | 빠르고 효율적 |
| llama3.2:7b | 4GB | ~8GB | 균형잡힌 성능 |
| mistral:7b | 4GB | ~8GB | 고성능 소형 모델 |
| qwen2.5:7b | 4GB | ~8GB | 다국어 지원 |

## 문제 해결

### Ollama 연결 오류
- Ollama 서버가 실행 중인지 확인: `ollama serve`
- 포트 11434이 사용 가능한지 확인
- 방화벽 설정 확인

### 메모리 부족 오류
- 더 작은 모델 사용 (3B 모델)
- 다른 애플리케이션 종료
- 시스템 메모리 확인

### GEMINI API 오류
- API 키가 올바른지 확인
- API 할당량 확인
- 인터넷 연결 확인

## 개발

### 프로젝트 구조
```
├── components/          # React 컴포넌트
├── services/           # LLM 서비스 (GEMINI, Ollama)
├── config/            # 설정 파일
├── types/             # TypeScript 타입 정의
└── index.html         # 메인 애플리케이션
```

### 새로운 LLM 서비스 추가
1. `services/` 디렉토리에 새 서비스 파일 생성
2. `services/llmServiceFactory.ts`에 서비스 등록
3. UI 컴포넌트에 선택 옵션 추가

## 라이선스

MIT License
