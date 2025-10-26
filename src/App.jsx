import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const KoreanLearningApp = () => {
  const [messages, setMessages] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [micPermission, setMicPermission] = useState(null);
  const [settings, setSettings] = useState({
    voiceGender: 'female',
    userLevel: [],
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentAudioPlaying, setCurrentAudioPlaying] = useState(null);
  const [debugLog, setDebugLog] = useState([]);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const addDebugLog = (message) => {
    console.log(message);
    setDebugLog(prev => [...prev, `${new Date().toLocaleTimeString()}: ${message}`].slice(-10));
  };

  const callOpenAI = async (endpoint, body, method = 'POST') => {
    const response = await fetch('/api/openai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        endpoint,
        method,
        body
      })
    });

    if (!response.ok) {
      throw new Error(`API call failed: ${response.statusText}`);
    }

    return response;
  };

  useEffect(() => {
    requestMicrophonePermission();
  }, []);

  const requestMicrophonePermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setMicPermission('granted');
      addDebugLog('✅ Microphone permission granted');
    } catch (error) {
      console.error('Microphone permission denied:', error);
      setMicPermission('denied');
      addDebugLog('❌ Microphone permission denied');
    }
  };

  const handleMouseDown = async () => {
    if (micPermission !== 'granted') {
      alert('Vui lòng cấp quyền microphone trước');
      return;
    }
    
    if (isProcessing) {
      return;
    }
    
    addDebugLog('▶️ Recording started with Whisper...');
    setIsRecording(true);
    audioChunksRef.current = [];
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000 // Tối ưu cho Whisper
        } 
      });
      
      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
      
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorderRef.current.onstop = async () => {
        addDebugLog('⏹️ Recording stopped, processing...');
        
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach(track => track.stop());
        
        addDebugLog(`📦 Audio size: ${audioBlob.size} bytes`);
        
        if (audioBlob.size < 1000) {
          alert('Audio quá ngắn! Hãy nói lâu hơn (2-5 giây).');
          setIsRecording(false);
          return;
        }
        
        // Gọi Whisper API
        await transcribeWithWhisper(audioBlob);
      };
      
      mediaRecorderRef.current.start();
      addDebugLog('🎙️ MediaRecorder started - HÃY NÓI!');
      
    } catch (error) {
      addDebugLog(`❌ Error: ${error.message}`);
      setIsRecording(false);
      alert(`Lỗi: ${error.message}`);
    }
  };

  const handleMouseUp = () => {
    if (!isRecording) return;
    
    addDebugLog('⏸️ Button released');
    setIsRecording(false);
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const transcribeWithWhisper = async (audioBlob) => {
    try {
      setIsProcessing(true);
      addDebugLog('🎯 Transcribing with Whisper API...');
      
      // Convert Blob to Base64
      const base64Audio = await blobToBase64(audioBlob);
      
      // Call Whisper API through our backend
      const response = await fetch('/api/openai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          endpoint: '/v1/audio/transcriptions',
          method: 'POST',
          body: {
            file: base64Audio,
            model: 'whisper-1',
            language: 'ko',
            response_format: 'json'
          },
          isFormData: true
        })
      });
      
      if (!response.ok) {
        throw new Error('Whisper API failed');
      }
      
      const data = await response.json();
      const transcript = data.text;
      
      addDebugLog(`✅ Whisper: "${transcript}"`);
      
      if (transcript && transcript.trim().length > 0) {
        await processUserInput(transcript);
      } else {
        alert('Không nhận diện được giọng nói. Hãy nói TO và RÕ hơn!');
        setIsProcessing(false);
      }
      
    } catch (error) {
      addDebugLog(`❌ Whisper error: ${error.message}`);
      alert(`Lỗi nhận diện: ${error.message}\n\nHãy thử lại hoặc dùng nút TEST.`);
      setIsProcessing(false);
    }
  };

  const blobToBase64 = (blob) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result.split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const processUserInput = async (userText) => {
    addDebugLog(`🔄 Processing: "${userText}"`);
    
    try {
      const correctionResponse = await callOpenAI('/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a Korean language teacher. Task:
1. Check if the Korean sentence is grammatically correct
2. If CORRECT: return JSON {"isCorrect": true, "corrected": "", "details": ""}
3. If INCORRECT: return JSON {"isCorrect": false, "corrected": "corrected sentence", "details": "explanation in Vietnamese"}
4. Return ONLY JSON, no other text`
          },
          {
            role: 'user',
            content: `Check this Korean sentence: "${userText}"`
          }
        ],
        temperature: 0.3
      });
      
      addDebugLog('✅ Got correction response');
      const correctionData = await correctionResponse.json();
      let correctionResult;
      
      try {
        const content = correctionData.choices[0].message.content;
        const cleaned = content.replace(/``````\n?/g, '').trim();
        correctionResult = JSON.parse(cleaned);
      } catch (e) {
        correctionResult = { isCorrect: true, corrected: userText, details: '' };
      }
      
      const userMessage = {
        id: Date.now(),
        type: 'user',
        originalText: userText,
        correctedText: correctionResult.isCorrect ? userText : correctionResult.corrected,
        isCorrect: correctionResult.isCorrect,
        details: correctionResult.details,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, userMessage]);
      addDebugLog(`📝 User message added`);
      
      if (!correctionResult.isCorrect) {
        setIsProcessing(false);
        return;
      }
      
      const aiResponse = await callOpenAI('/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a Korean language learning assistant. CRITICAL RULES:

1. You MUST respond ONLY in KOREAN (한국어). NO Vietnamese. NO English.
2. Use grammar level: ${settings.userLevel.join(', ') || 'beginner (초급)'}
3. Your response must be natural conversational Korean
4. Return ONLY this JSON format:

{"response": "한국어 응답", "vocabulary": ["단어: meaning"], "grammar": ["문법: explanation"]}

Example:
{"response": "안녕하세요! 만나서 반가워요. 오늘 기분이 어때요?", "vocabulary": ["만나다: gặp", "기분: tâm trạng"], "grammar": ["-아/어요: lịch sự"]}

Response MUST be 100% Korean!`
          },
          {
            role: 'user',
            content: correctionResult.corrected
          }
        ],
        temperature: 0.7
      });
      
      addDebugLog('✅ Got AI response');
      const aiData = await aiResponse.json();
      let aiResult;
      
      try {
        const responseText = aiData.choices[0].message.content;
        const cleanedText = responseText.replace(/``````\n?/g, '').trim();
        aiResult = JSON.parse(cleanedText);
      } catch (e) {
        aiResult = {
          response: aiData.choices[0].message.content,
          vocabulary: [],
          grammar: []
        };
      }
      
      const aiMessage = {
        id: Date.now() + 1,
        type: 'ai',
        text: aiResult.response,
        vocabulary: aiResult.vocabulary,
        grammar: aiResult.grammar,
        timestamp: new Date(),
        audioUrl: null
      };
      
      setMessages(prev => [...prev, aiMessage]);
      addDebugLog('🤖 AI message added');
      await playTTS(aiMessage.id, aiResult.response);
      
    } catch (error) {
      addDebugLog(`❌ Error: ${error.message}`);
      alert(`Lỗi: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const playTTS = async (messageId, text) => {
    try {
      addDebugLog('🔊 Playing TTS...');
      setCurrentAudioPlaying(messageId);
      
      const ttsResponse = await callOpenAI('/v1/audio/speech', {
        model: 'tts-1',
        input: text,
        voice: settings.voiceGender === 'female' ? 'nova' : 'onyx',
        speed: 1.0
      });
      
      const audioBlob = await ttsResponse.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      setMessages(prev => prev.map(msg => 
        msg.id === messageId ? { ...msg, audioUrl } : msg
      ));
      
      const audio = new Audio(audioUrl);
      
      audio.onloadedmetadata = () => {
        displayTextWithTyping(messageId, text, audio.duration * 1000);
      };
      
      audio.onended = () => {
        setCurrentAudioPlaying(null);
        addDebugLog('✅ TTS ended');
      };
      
      audio.onerror = (e) => {
        addDebugLog(`❌ Audio error`);
        setCurrentAudioPlaying(null);
      };
      
      await audio.play();
      
    } catch (error) {
      addDebugLog(`❌ TTS error: ${error.message}`);
      setCurrentAudioPlaying(null);
    }
  };

  const displayTextWithTyping = (messageId, fullText, duration) => {
    const characters = fullText.split('');
    const intervalTime = Math.max(duration / characters.length, 50);
    let currentIndex = 0;
    
    const interval = setInterval(() => {
      if (currentIndex <= characters.length) {
        setMessages(prev => prev.map(msg => 
          msg.id === messageId 
            ? { ...msg, displayedText: characters.slice(0, currentIndex).join('') }
            : msg
        ));
        currentIndex++;
      } else {
        clearInterval(interval);
      }
    }, intervalTime);
  };

  const replayAudio = async (message) => {
    if (message.audioUrl) {
      setCurrentAudioPlaying(message.id);
      const audio = new Audio(message.audioUrl);
      audio.onended = () => setCurrentAudioPlaying(null);
      await audio.play();
    } else {
      await playTTS(message.id, message.text);
    }
  };

  const testWithText = () => {
    const testText = prompt('Nhập câu tiếng Hàn:\n(VD: 안녕하세요)');
    if (testText) {
      processUserInput(testText);
    }
  };

  return (
    <div className="korean-app">
      <header className="app-header">
        <div className="logo">
          <span className="korean-flag">🇰🇷</span>
          <h1>한국어 학습 Korean Learning App</h1>
        </div>
        <div className="level-display">
          레벨: {settings.userLevel.length || 0} 문법
        </div>
      </header>
      
      {micPermission === 'denied' && (
        <div className="permission-alert">
          <div className="alert-content">
            <h2>⚠️ Cần quyền Microphone</h2>
            <p>Ứng dụng cần quyền truy cập microphone để ghi âm giọng nói của bạn.</p>
            <button onClick={requestMicrophonePermission} className="btn-primary">
              Cấp quyền Microphone
            </button>
          </div>
        </div>
      )}
      
      {micPermission === null && (
        <div className="permission-alert">
          <div className="alert-content">
            <h2>Đang kiểm tra quyền microphone...</h2>
          </div>
        </div>
      )}
      
      {micPermission === 'granted' && (
        <>
          <div style={{background: '#e8f5e9', padding: '10px', margin: '10px', borderRadius: '10px', border: '2px solid #4caf50'}}>
            <strong>✅ Dùng OpenAI Whisper - Nhận diện CHÍNH XÁC!</strong>
            <div style={{fontSize: '11px', marginTop: '5px'}}>
              {debugLog.map((log, idx) => <div key={idx}>{log}</div>)}
            </div>
          </div>

          <div className="chat-container">
            {messages.length === 0 && (
              <div className="welcome-message">
                <h2>환영합니다! Korean Learning App với Whisper AI</h2>
                <p><strong>🎤 Cách sử dụng:</strong></p>
                <ol style={{textAlign: 'left', maxWidth: '400px', margin: '10px auto', fontSize: '15px'}}>
                  <li>Nhấn giữ nút đỏ</li>
                  <li>Nói TO và RÕ bằng tiếng Hàn (2-5 giây)</li>
                  <li>Thả nút</li>
                  <li>Đợi Whisper xử lý (~3 giây)</li>
                </ol>
                <p style={{fontSize: '14px', color: '#4caf50', fontWeight: 'bold'}}>💡 Whisper chính xác 95%+ - Không cần môi trường yên tĩnh!</p>
              </div>
            )}
            
            {messages.map((message) => (
              <div key={message.id} className={`message ${message.type}`}>
                {message.type === 'user' ? (
                  <div className="user-message">
                    <div className="message-bubble">
                      <div className={`user-text ${!message.isCorrect ? 'incorrect' : ''}`}>
                        {!message.isCorrect && (
                          <span className="original-text" style={{textDecoration: 'line-through', color: '#ff6b6b'}}>
                            {message.originalText}
                          </span>
                        )}
                        <div className="corrected-text">
                          {message.correctedText}
                        </div>
                      </div>
                      
                      {!message.isCorrect && message.details && (
                        <div className="details-section user-details">
                          <h4>📝 Chi tiết lỗi:</h4>
                          <p>{message.details}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="ai-message">
                    <div className="message-bubble">
                      <div className="ai-text">
                        {message.displayedText || message.text}
                        {currentAudioPlaying === message.id && <span className="cursor">|</span>}
                      </div>
                      
                      <button 
                        onClick={() => replayAudio(message)} 
                        className="btn-replay"
                        disabled={currentAudioPlaying === message.id}
                      >
                        {currentAudioPlaying === message.id ? '▶️ Đang phát...' : '🔊 Nghe lại'}
                      </button>
                      
                      <div className="details-section ai-details">
                        <h4>📚 Chi tiết:</h4>
                        
                        {message.vocabulary && message.vocabulary.length > 0 && (
                          <div className="vocabulary">
                            <h5>Từ vựng:</h5>
                            <ul>
                              {message.vocabulary.map((item, idx) => (
                                <li key={idx}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        
                        {message.grammar && message.grammar.length > 0 && (
                          <div className="grammar">
                            <h5>Ngữ pháp:</h5>
                            <ul>
                              {message.grammar.map((item, idx) => (
                                <li key={idx}>{item}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            
            {isProcessing && (
              <div className="processing">
                <div className="spinner"></div>
                <p>Đang xử lý với Whisper AI...</p>
              </div>
            )}
          </div>
          
          <div className="control-panel">
            <button
              onClick={testWithText}
              style={{
                background: '#2196F3',
                color: 'white',
                padding: '12px',
                border: 'none',
                borderRadius: '50px',
                fontSize: '14px',
                fontWeight: 'bold',
                cursor: 'pointer',
                marginBottom: '10px',
                width: '100%'
              }}
            >
              📝 Nhập text thủ công
            </button>

            <button
              className={`btn-record ${isRecording ? 'recording' : ''}`}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onTouchStart={handleMouseDown}
              onTouchEnd={handleMouseUp}
              disabled={isProcessing}
            >
              {isRecording ? '🎤 ĐANG GHI - NÓI NGAY!' : isProcessing ? '⏳ Đang xử lý...' : '🎤 Nhấn giữ để nói'}
            </button>
            
            <div className="settings">
              <label>
                Giọng AI:
                <select 
                  value={settings.voiceGender} 
                  onChange={(e) => setSettings({...settings, voiceGender: e.target.value})}
                >
                  <option value="female">여성 (Nữ)</option>
                  <option value="male">남성 (Nam)</option>
                </select>
              </label>
              
              <button 
                className="btn-settings"
                onClick={() => {
                  const level = prompt('Nhập ngữ pháp bạn đã biết:\nVD: -이에요/예요, -아요/어요');
                  if (level) {
                    setSettings({...settings, userLevel: level.split(',').map(s => s.trim())});
                  }
                }}
              >
                ⚙️ Cài đặt trình độ
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default KoreanLearningApp;
