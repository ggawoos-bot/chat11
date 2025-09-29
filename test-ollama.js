/**
 * Ollama 연결 테스트 스크립트
 * Ollama 서버가 정상적으로 실행 중인지 확인
 */

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

async function testOllamaConnection() {
  console.log('🔍 Ollama 서버 연결 테스트 중...');
  console.log(`📍 서버 주소: ${OLLAMA_BASE_URL}`);
  
  try {
    // 1. 서버 연결 확인
    console.log('\n1️⃣ 서버 연결 확인...');
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    
    if (!response.ok) {
      throw new Error(`서버 응답 오류: ${response.status} ${response.statusText}`);
    }
    
    console.log('✅ 서버 연결 성공!');
    
    // 2. 설치된 모델 목록 확인
    console.log('\n2️⃣ 설치된 모델 목록 확인...');
    const data = await response.json();
    const models = data.models || [];
    
    if (models.length === 0) {
      console.log('⚠️  설치된 모델이 없습니다.');
      console.log('💡 다음 명령어로 모델을 설치하세요:');
      console.log('   ollama pull llama3.2:7b');
      return;
    }
    
    console.log('📋 설치된 모델:');
    models.forEach((model, index) => {
      const size = model.size ? `(${(model.size / 1024 / 1024 / 1024).toFixed(1)}GB)` : '';
      console.log(`   ${index + 1}. ${model.name} ${size}`);
    });
    
    // 3. 기본 모델 테스트
    console.log('\n3️⃣ 기본 모델 테스트...');
    const testModel = process.env.OLLAMA_MODEL || 'solar:10.7b';
    const modelExists = models.some(m => m.name === testModel);
    
    if (!modelExists) {
      console.log(`⚠️  기본 모델 '${testModel}'이 설치되지 않았습니다.`);
      console.log(`💡 다음 명령어로 설치하세요:`);
      console.log(`   ollama pull ${testModel}`);
      return;
    }
    
    console.log(`✅ 기본 모델 '${testModel}' 확인됨`);
    
    // 4. 간단한 API 호출 테스트
    console.log('\n4️⃣ API 호출 테스트...');
    const testPayload = {
      model: testModel,
      messages: [
        {
          role: 'user',
          content: '안녕하세요! 간단한 테스트입니다.'
        }
      ],
      stream: false,
      options: {
        temperature: 0.7,
        max_tokens: 50
      }
    };
    
    const testResponse = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPayload)
    });
    
    if (!testResponse.ok) {
      throw new Error(`API 호출 실패: ${testResponse.status} ${testResponse.statusText}`);
    }
    
    const testData = await testResponse.json();
    if (testData.message && testData.message.content) {
      console.log('✅ API 호출 성공!');
      console.log(`🤖 응답: ${testData.message.content.substring(0, 100)}...`);
    } else {
      throw new Error('API 응답 형식이 올바르지 않습니다.');
    }
    
    console.log('\n🎉 모든 테스트 통과! Ollama가 정상적으로 작동합니다.');
    console.log('\n💡 이제 애플리케이션을 실행할 수 있습니다:');
    console.log('   npm run dev');
    
  } catch (error) {
    console.error('\n❌ 테스트 실패:', error.message);
    console.log('\n🔧 문제 해결 방법:');
    console.log('1. Ollama가 설치되어 있는지 확인: ollama --version');
    console.log('2. Ollama 서버가 실행 중인지 확인: ollama serve');
    console.log('3. 포트 11434가 사용 가능한지 확인');
    console.log('4. 방화벽 설정 확인');
    console.log('\n📖 자세한 설치 방법은 README.md를 참조하세요.');
  }
}

// 스크립트 실행
if (require.main === module) {
  testOllamaConnection();
}

module.exports = { testOllamaConnection };
