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
  const recognitionRef = useRef(null);

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

  useEffect(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Trình duyệt không hỗ trợ nhận diện giọng nói. Vui lòng dùng Chrome hoặc Edge.');
      addDebugLog('❌ Speech Recognition not supported');
      return;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.lang = 'ko-KR';
    recognitionRef.current.continuous = false;
    recognitionRef.current.interimResults = false;
    addDebugLog('✅ Speech Recognition initialized');
    
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const handleMouseDown = async () => {
    if (micPermission !== 'granted') {
      alert('Vui lòng cấp quyền microphone trước');
      return;
    }
    
    addDebugLog('▶️ Recording started');
    setIsRecording(true);
    audioChunksRef.current = [];
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      
      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };
      
      mediaRecorderRef.current.start();
      addDebugLog('🎙️ MediaRecorder started');
      
      if (recognitionRef.current) {
        recognitionRef.current.onresult = async (event) => {
          const transcript = event.results[0][0].transcript;
          const confidence = event.results[0][0].confidence;
          addDebugLog(`🎯 Recognized: "${transcript}" (confidence: ${confidence.toFixed(2)})`);
          
          if (transcript && transcript.trim().length > 0) {
            await processUserInput(transcript);
          }
        };
        
        recognitionRef.current.onerror = (event) => {
          addDebugLog(`❌ Speech error: ${event.error}`);
          if (event.error !== 'no-speech') {
            alert(`Lỗi nhận diện: ${event.error}`);
          }
        };
        
        recognitionRef.current.onend = () => {
          addDebugLog('⏹️ Speech recognition ended');
        };
        
        recognitionRef.current.onstart = () => {
          addDebugLog('🎤 Speech recognition started');
        };
        
        recognitionRef.current.onspeechstart = () => {
          addDebugLog('🗣️ Speech detected');
        };
        
        recognitionRef.current.onspeechend = () => {
          addDebugLog('🔇 Speech ended');
        };
        
        recognitionRef.current.start();
      }
    } catch (error) {
      addDebugLog(`❌ Error: ${error.message}`);
      setIsRecording(false);
      alert(`Lỗi khởi động: ${error.message}`);
    }
  };

  const handleMouseUp = () => {
    if (!isRecording) return;
    
    addDebugLog('⏸️ Recording stopped');
    setIsRecording(false);
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      
      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        addDebugLog(`📦 Audio blob size: ${audioBlob.size} bytes`);
        
        if (audioBlob.size < 1000) {
          addDebugLog('⚠️ Audio too short, no speech detected');
        }
      };
    }
  };

  const processUserInput = async (userText) => {
    addDebugLog(`🔄 Processing: "${userText}"`);
    setIsProcessing(true);
    
    try {
      const correctionResponse = await callOpenAI('/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Bạn là giáo viên tiếng Hàn chuyên nghiệp. Nhiệm vụ:
1. Kiểm tra câu tiếng Hàn của học viên về phát âm, ngữ pháp, từ vựng
2. Nếu ĐÚNG HOÀN TOÀN: trả về JSON {"isCorrect": true, "corrected": "", "details": ""}
3. Nếu SAI: trả về JSON {"isCorrect": false, "corrected": "câu đã sửa", "details": "giải thích lỗi và cách sửa bằng tiếng Việt"}
4. Chỉ trả về JSON, không thêm text khác`
          },
          {
            role: 'user',
            content: `Kiểm tra câu này: "${userText}"`
          }
        ],
        temperature: 0.3
      });
      
      addDebugLog('✅ Got correction response');
      const correctionData = await correctionResponse.json();
      let correctionResult;
      
      try {
        correctionResult = JSON.parse(correctionData.choices[0].message.content);
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
      addDebugLog(`📝 User message added (correct: ${correctionResult.isCorrect})`);
      
      if (!correctionResult.isCorrect) {
        setIsProcessing(false);
        return;
      }
      
      const aiResponse = await callOpenAI('/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Bạn là trợ lý học tiếng Hàn thân thiện.
- Chỉ sử dụng ngữ pháp cấp độ: ${settings.userLevel.join(', ') || 'sơ cấp cơ bản'}
- LUÔN trả lời bằng CÂU ĐẦY ĐỦ tiếng Hàn
- Trả về JSON: {"response": "câu trả lời", "vocabulary": [], "grammar": []}`
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
        aiResult = JSON.parse(aiData.choices[0].message.content);
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
      addDebugLog(`❌ Processing error: ${error.message}`);
      alert(`Lỗi xử lý: ${error.message}`);
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
        addDebugLog('✅ TTS playback ended');
      };
      
      audio.onerror = (e) => {
        addDebugLog(`❌ Audio error: ${e}`);
        setCurrentAudioPlaying(null);
      };
      
      await audio.play();
      addDebugLog('▶️ TTS started');
      
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

  // NÚT TEST - Bypass Speech Recognition
  const testWithText = () => {
    const testText = prompt('Nhập câu tiếng Hàn để test:\n(VD: 안녕하세요)');
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
          {/* DEBUG LOG */}
          <div style={{background: '#f0f0f0', padding: '10px', fontSize: '10px', maxHeight: '100px', overflow: 'auto', margin: '10px'}}>
            <strong>Debug Log:</strong>
            {debugLog.map((log, idx) => <div key={idx}>{log}</div>)}
          </div>

          <div className="chat-container">
            {messages.length === 0 && (
              <div className="welcome-message">
                <h2>환영합니다! Chào mừng bạn đến với ứng dụng học tiếng Hàn</h2>
                <p>Nhấn giữ nút microphone để bắt đầu nói tiếng Hàn</p>
                <p>Hoặc click nút "🧪 TEST" để test bằng text</p>
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
                <p>Đang xử lý...</p>
              </div>
            )}
          </div>
          
          <div className="control-panel">
            {/* NÚT TEST */}
            <button
              onClick={testWithText}
              style={{
                background: '#2196F3',
                color: 'white',
                padding: '15px 30px',
                border: 'none',
                borderRadius: '50px',
                fontSize: '16px',
                fontWeight: 'bold',
                cursor: 'pointer',
                marginBottom: '10px',
                width: '100%'
              }}
            >
              🧪 TEST: Nhập text thay vì nói
            </button>

            <button
              className={`btn-record ${isRecording ? 'recording' : ''}`}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onTouchStart={handleMouseDown}
              onTouchEnd={handleMouseUp}
              disabled={isProcessing}
            >
              {isRecording ? '🎤 Đang ghi...' : '🎤 Nhấn giữ để nói'}
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
                  const level = prompt('Nhập ngữ pháp bạn đã biết (cách nhau bằng dấu phẩy):\nVí dụ: -이에요/예요, -아요/어요, -ㄹ 거예요');
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
