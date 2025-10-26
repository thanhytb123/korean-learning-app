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
  const [expandedDetails, setExpandedDetails] = useState({});
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recognitionRef = useRef(null);
  const hasReceivedResultRef = useRef(false);

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
    } catch (error) {
      console.error('Microphone permission denied:', error);
      setMicPermission('denied');
    }
  };

  useEffect(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert('Trình duyệt không hỗ trợ nhận diện giọng nói. Vui lòng dùng Chrome hoặc Edge.');
      return;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.lang = 'ko-KR';
    recognitionRef.current.continuous = true;
    recognitionRef.current.interimResults = true;
    recognitionRef.current.maxAlternatives = 3; // Tăng lên để có nhiều lựa chọn
    
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
    };
  }, []);

  const handleMouseDown = async () => {
    if (micPermission !== 'granted') {
      alert('Vui lòng cấp quyền microphone trước');
      return;
    }
    
    if (isProcessing) return;
    
    setIsRecording(true);
    hasReceivedResultRef.current = false;
    audioChunksRef.current = [];
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100 // Cao nhất để độ chính xác tốt hơn
        } 
      });
      
      mediaRecorderRef.current = new MediaRecorder(stream);
      
      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };
      
      mediaRecorderRef.current.start();
      
      if (recognitionRef.current) {
        recognitionRef.current.onresult = async (event) => {
          const lastResultIndex = event.results.length - 1;
          const result = event.results[lastResultIndex];
          const transcript = result[0].transcript;
          const isFinal = result.isFinal;
          const confidence = result[0].confidence;
          
          if (isFinal && !hasReceivedResultRef.current && confidence > 0.5) {
            hasReceivedResultRef.current = true;
            
            setIsRecording(false);
            
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
              mediaRecorderRef.current.stop();
              mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
            }
            
            try {
              if (recognitionRef.current) {
                recognitionRef.current.stop();
              }
            } catch (e) {}
            
            if (transcript && transcript.trim().length > 0) {
              await processUserInput(transcript, confidence);
            }
          }
        };
        
        recognitionRef.current.onerror = (event) => {
          if (event.error === 'no-speech') {
            setIsRecording(false);
            alert('Không nghe thấy giọng nói!\n\n💡 Hãy:\n- Nói TO và RÕ hơn\n- Giữ nút lâu hơn (3-5 giây)\n- Thử lại');
          }
        };
        
        recognitionRef.current.onend = () => {
          console.log('Speech recognition ended');
        };
        
        try {
          recognitionRef.current.start();
        } catch (e) {
          console.error('Start error:', e);
        }
      }
    } catch (error) {
      setIsRecording(false);
      alert(`Lỗi: ${error.message}`);
    }
  };

  const handleMouseUp = () => {
    if (!isRecording) return;
    
    setTimeout(() => {
      if (isRecording && !hasReceivedResultRef.current) {
        setIsRecording(false);
        
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        }
        
        try {
          if (recognitionRef.current) {
            recognitionRef.current.stop();
          }
        } catch (e) {}
        
        alert('Không nhận diện được!\n\n💡 Thử:\n- Giữ nút LÂU hơn\n- Nói ngay sau 1 giây\n- Hoặc dùng nút "Nhập text"');
      }
    }, 2000);
  };

  const processUserInput = async (userText, confidence = 1.0) => {
    setIsProcessing(true);
    
    try {
      const correctionResponse = await callOpenAI('/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a Korean language teacher. Check the Korean sentence and return ONLY valid JSON:

{
  "isCorrect": true/false,
  "corrected": "corrected sentence if wrong",
  "details": "Vietnamese explanation if wrong"
}

Be strict on grammar, particles, and pronunciation patterns.`
          },
          {
            role: 'user',
            content: `Check: "${userText}"`
          }
        ],
        temperature: 0.2
      });
      
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
        confidence: confidence,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, userMessage]);
      
      if (!correctionResult.isCorrect) {
        setIsProcessing(false);
        return;
      }
      
      const aiResponse = await callOpenAI('/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a Korean teacher. RULES:

1. Response MUST be 100% Korean (한국어)
2. Level: ${settings.userLevel.join(', ') || 'beginner'}
3. Return ONLY this JSON:

{
  "response": "Natural Korean response",
  "vocabulary": [
    {
      "word": "한국어 단어",
      "meaning": "nghĩa tiếng Việt",
      "pronunciation": "phiên âm",
      "example": "Ví dụ câu tiếng Hàn"
    }
  ],
  "grammar": [
    {
      "pattern": "-문법 패턴",
      "explanation": "Giải thích bằng tiếng Việt",
      "usage": "Cách dùng chi tiết",
      "examples": ["Ví dụ 1", "Ví dụ 2"]
    }
  ]
}

Be detailed and educational!`
          },
          {
            role: 'user',
            content: correctionResult.corrected
          }
        ],
        temperature: 0.7
      });
      
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
      await playTTS(aiMessage.id, aiResult.response);
      
    } catch (error) {
      alert(`Lỗi: ${error.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const playTTS = async (messageId, text) => {
    try {
      setCurrentAudioPlaying(messageId);
      
      const ttsResponse = await callOpenAI('/v1/audio/speech', {
        model: 'tts-1',
        input: text,
        voice: settings.voiceGender === 'female' ? 'nova' : 'onyx',
        speed: 0.9 // Chậm hơn để nghe rõ hơn
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
      };
      
      await audio.play();
      
    } catch (error) {
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

  const toggleDetails = (messageId) => {
    setExpandedDetails(prev => ({
      ...prev,
      [messageId]: !prev[messageId]
    }));
  };

  const testWithText = () => {
    const testText = prompt('Nhập câu tiếng Hàn:\n(VD: 안녕하세요)');
    if (testText) {
      processUserInput(testText, 1.0);
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
          <div className="chat-container">
            {messages.length === 0 && (
              <div className="welcome-message">
                <h2>환영합니다! Chào mừng học tiếng Hàn</h2>
                <p><strong>🎤 Cách sử dụng:</strong></p>
                <ol style={{textAlign: 'left', maxWidth: '400px', margin: '10px auto', fontSize: '15px'}}>
                  <li>Nhấn giữ nút đỏ</li>
                  <li>Nói TO và RÕ (2-5 giây)</li>
                  <li>Thả nút</li>
                  <li>Xem kết quả + chi tiết</li>
                </ol>
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
                          {message.confidence && (
                            <span style={{fontSize: '12px', color: '#999', marginLeft: '10px'}}>
                              ({(message.confidence * 100).toFixed(0)}% confident)
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {!message.isCorrect && message.details && (
                        <div className="details-section user-details" style={{marginTop: '10px'}}>
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
                      
                      <div style={{display: 'flex', gap: '10px', marginTop: '10px'}}>
                        <button 
                          onClick={() => replayAudio(message)} 
                          className="btn-replay"
                          disabled={currentAudioPlaying === message.id}
                          style={{flex: 1}}
                        >
                          {currentAudioPlaying === message.id ? '▶️ Đang phát...' : '🔊 Nghe lại'}
                        </button>
                        
                        <button 
                          onClick={() => toggleDetails(message.id)}
                          style={{
                            flex: 1,
                            background: expandedDetails[message.id] ? '#ff9800' : '#4caf50',
                            color: 'white',
                            border: 'none',
                            borderRadius: '25px',
                            padding: '10px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: 'bold'
                          }}
                        >
                          {expandedDetails[message.id] ? '🔼 Ẩn chi tiết' : '🔽 Xem chi tiết'}
                        </button>
                      </div>
                      
                      {expandedDetails[message.id] && (
                        <div className="details-section ai-details" style={{marginTop: '15px', background: '#f5f5f5', padding: '15px', borderRadius: '10px'}}>
                          <h4>📚 Chi tiết học tập:</h4>
                          
                          {message.vocabulary && message.vocabulary.length > 0 && (
                            <div className="vocabulary" style={{marginTop: '15px'}}>
                              <h5 style={{color: '#2196f3', marginBottom: '10px'}}>📖 Từ vựng:</h5>
                              {message.vocabulary.map((item, idx) => (
                                <div key={idx} style={{
                                  background: 'white',
                                  padding: '12px',
                                  marginBottom: '10px',
                                  borderRadius: '8px',
                                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                }}>
                                  {typeof item === 'string' ? (
                                    <p><strong>{item}</strong></p>
                                  ) : (
                                    <>
                                      <p><strong style={{fontSize: '18px', color: '#1976d2'}}>{item.word}</strong></p>
                                      <p><em style={{color: '#666'}}>{item.pronunciation || ''}</em></p>
                                      <p style={{marginTop: '5px'}}>💡 {item.meaning}</p>
                                      {item.example && <p style={{marginTop: '8px', color: '#555', fontStyle: 'italic'}}>📝 {item.example}</p>}
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          
                          {message.grammar && message.grammar.length > 0 && (
                            <div className="grammar" style={{marginTop: '15px'}}>
                              <h5 style={{color: '#ff9800', marginBottom: '10px'}}>📐 Ngữ pháp:</h5>
                              {message.grammar.map((item, idx) => (
                                <div key={idx} style={{
                                  background: 'white',
                                  padding: '12px',
                                  marginBottom: '10px',
                                  borderRadius: '8px',
                                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                }}>
                                  {typeof item === 'string' ? (
                                    <p><strong>{item}</strong></p>
                                  ) : (
                                    <>
                                      <p><strong style={{fontSize: '16px', color: '#f57c00'}}>{item.pattern}</strong></p>
                                      <p style={{marginTop: '8px'}}>📚 {item.explanation}</p>
                                      {item.usage && <p style={{marginTop: '8px', color: '#666'}}>💡 Cách dùng: {item.usage}</p>}
                                      {item.examples && item.examples.length > 0 && (
                                        <div style={{marginTop: '10px'}}>
                                          <p style={{fontWeight: 'bold', color: '#555'}}>📝 Ví dụ:</p>
                                          {item.examples.map((ex, i) => (
                                            <p key={i} style={{marginLeft: '15px', marginTop: '5px', fontStyle: 'italic', color: '#333'}}>
                                              • {ex}
                                            </p>
                                          ))}
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
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
