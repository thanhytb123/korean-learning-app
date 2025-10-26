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

  const callOpenAI = async (endpoint, body) => {
    const response = await fetch('/api/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, method: 'POST', body })
    });

    if (!response.ok) {
      throw new Error(`API failed: ${response.statusText}`);
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
      setMicPermission('denied');
    }
  };

  useEffect(() => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      return;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognitionRef.current = new SpeechRecognition();
    recognitionRef.current.lang = 'ko-KR';
    recognitionRef.current.continuous = false;
    recognitionRef.current.interimResults = false;
    
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch (e) {}
      }
    };
  }, []);

  const handleMouseDown = async () => {
    if (micPermission !== 'granted' || isProcessing) return;
    
    setIsRecording(true);
    audioChunksRef.current = [];
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
      });
      
      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      mediaRecorderRef.current.start();
      
      if (recognitionRef.current) {
        recognitionRef.current.onresult = async (event) => {
          const transcript = event.results[0][0].transcript;
          
          if (transcript && transcript.trim().length > 0) {
            setIsRecording(false);
            
            if (mediaRecorderRef.current) {
              mediaRecorderRef.current.stop();
              mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
            }
            
            await processUserInput(transcript);
          }
        };
        
        recognitionRef.current.onerror = (e) => {
          if (e.error === 'no-speech') {
            alert('Không nghe thấy! Hãy nói TO và RÕ hơn.');
          }
          setIsRecording(false);
        };
        
        recognitionRef.current.start();
      }
    } catch (error) {
      alert('Lỗi microphone!');
      setIsRecording(false);
    }
  };

  const handleMouseUp = () => {
    setTimeout(() => {
      if (isRecording) {
        setIsRecording(false);
        if (mediaRecorderRef.current) {
          try {
            mediaRecorderRef.current.stop();
            mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
          } catch (e) {}
        }
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch (e) {}
        }
      }
    }, 1500);
  };

  const processUserInput = async (userText) => {
    setIsProcessing(true);
    
    try {
      // Kiểm tra lỗi
      const correctionResponse = await callOpenAI('/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Korean teacher. Check grammar. Return JSON only:
{"isCorrect": true/false, "corrected": "fixed sentence", "details": "Vietnamese explanation"}`
          },
          { role: 'user', content: `Check: "${userText}"` }
        ],
        temperature: 0.2
      });
      
      const correctionData = await correctionResponse.json();
      let correction;
      
      try {
        const content = correctionData.choices[0].message.content;
        correction = JSON.parse(content.replace(/``````/g, '').trim());
      } catch (e) {
        correction = { isCorrect: true, corrected: userText, details: '' };
      }
      
      const userMsg = {
        id: Date.now(),
        type: 'user',
        originalText: userText,
        correctedText: correction.isCorrect ? userText : correction.corrected,
        isCorrect: correction.isCorrect,
        details: correction.details,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, userMsg]);
      
      if (!correction.isCorrect) {
        setIsProcessing(false);
        return;
      }
      
      // AI trả lời
      const aiResponse = await callOpenAI('/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Korean learning assistant. RULES:

1. Response MUST be 100% Korean (한국어)
2. Level: ${settings.userLevel.join(', ') || 'beginner'}
3. Return ONLY JSON:

{
  "response": "Korean response",
  "vocabulary": [
    {"word": "단어", "meaning": "nghĩa", "pronunciation": "phát âm", "example": "Ví dụ"}
  ],
  "grammar": [
    {"pattern": "문법", "explanation": "Giải thích VN", "usage": "Cách dùng", "examples": ["VD1", "VD2"]}
  ]
}

Be detailed and educational!`
          },
          { role: 'user', content: correction.corrected }
        ],
        temperature: 0.7
      });
      
      const aiData = await aiResponse.json();
      let aiResult;
      
      try {
        const text = aiData.choices[0].message.content;
        aiResult = JSON.parse(text.replace(/``````/g, '').trim());
      } catch (e) {
        aiResult = {
          response: aiData.choices[0].message.content,
          vocabulary: [],
          grammar: []
        };
      }
      
      const aiMsg = {
        id: Date.now() + 1,
        type: 'ai',
        text: aiResult.response,
        vocabulary: aiResult.vocabulary,
        grammar: aiResult.grammar,
        timestamp: new Date(),
        audioUrl: null
      };
      
      setMessages(prev => [...prev, aiMsg]);
      await playTTS(aiMsg.id, aiResult.response);
      
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
        speed: 0.85
      });
      
      const audioBlob = await ttsResponse.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      setMessages(prev => prev.map(msg => 
        msg.id === messageId ? { ...msg, audioUrl } : msg
      ));
      
      const audio = new Audio(audioUrl);
      audio.onended = () => setCurrentAudioPlaying(null);
      await audio.play();
      
    } catch (error) {
      setCurrentAudioPlaying(null);
    }
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

  const toggleDetails = (id) => {
    setExpandedDetails(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const testWithText = () => {
    const text = prompt('Nhập câu tiếng Hàn (VD: 안녕하세요):');
    if (text) processUserInput(text);
  };

  return (
    <div className="korean-app">
      <header className="app-header">
        <div className="logo">
          <span className="korean-flag">🇰🇷</span>
          <h1>한국어 학습</h1>
        </div>
        <div className="level-display">
          {settings.userLevel.length || 0} 문법
        </div>
      </header>
      
      {micPermission === 'denied' && (
        <div className="permission-alert">
          <div className="alert-content">
            <h2>⚠️ Cần quyền Microphone</h2>
            <button onClick={requestMicrophonePermission} className="btn-primary">
              Cấp quyền
            </button>
          </div>
        </div>
      )}
      
      {micPermission === 'granted' && (
        <>
          <div className="chat-container">
            {messages.length === 0 && (
              <div className="welcome-message">
                <h2>환영합니다!</h2>
                <p><strong>🎤 Cách dùng:</strong></p>
                <ol style={{textAlign: 'left', maxWidth: '350px', margin: '10px auto'}}>
                  <li>Nhấn giữ nút đỏ</li>
                  <li>Nói TO và RÕ (2-4 giây)</li>
                  <li>Thả nút</li>
                </ol>
              </div>
            )}
            
            {messages.map((msg) => (
              <div key={msg.id} className={`message ${msg.type}`}>
                {msg.type === 'user' ? (
                  <div className="user-message">
                    <div className="message-bubble">
                      {!msg.isCorrect && (
                        <div style={{textDecoration: 'line-through', color: '#f44336'}}>
                          {msg.originalText}
                        </div>
                      )}
                      <div style={{color: msg.isCorrect ? '#4caf50' : '#2196f3', fontWeight: 'bold'}}>
                        {msg.correctedText}
                      </div>
                      {!msg.isCorrect && msg.details && (
                        <div style={{marginTop: '10px', fontSize: '14px', color: '#666'}}>
                          📝 {msg.details}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="ai-message">
                    <div className="message-bubble">
                      <div className="ai-text">{msg.text}</div>
                      
                      <div style={{display: 'flex', gap: '10px', marginTop: '10px'}}>
                        <button 
                          onClick={() => replayAudio(msg)} 
                          className="btn-replay"
                          disabled={currentAudioPlaying === msg.id}
                          style={{flex: 1}}
                        >
                          {currentAudioPlaying === msg.id ? '▶️' : '🔊'} Nghe lại
                        </button>
                        
                        <button 
                          onClick={() => toggleDetails(msg.id)}
                          style={{
                            flex: 1,
                            background: expandedDetails[msg.id] ? '#ff9800' : '#4caf50',
                            color: 'white',
                            border: 'none',
                            borderRadius: '25px',
                            padding: '10px',
                            cursor: 'pointer',
                            fontSize: '14px'
                          }}
                        >
                          {expandedDetails[msg.id] ? '🔼 Ẩn' : '🔽 Chi tiết'}
                        </button>
                      </div>
                      
                      {expandedDetails[msg.id] && (
                        <div style={{marginTop: '15px', background: '#f5f5f5', padding: '15px', borderRadius: '10px'}}>
                          {msg.vocabulary && msg.vocabulary.length > 0 && (
                            <div style={{marginBottom: '15px'}}>
                              <h5 style={{color: '#2196f3'}}>📖 Từ vựng:</h5>
                              {msg.vocabulary.map((v, i) => (
                                <div key={i} style={{background: 'white', padding: '10px', margin: '8px 0', borderRadius: '8px'}}>
                                  {typeof v === 'string' ? (
                                    <p>{v}</p>
                                  ) : (
                                    <>
                                      <p style={{fontSize: '16px', fontWeight: 'bold', color: '#1976d2'}}>{v.word}</p>
                                      {v.pronunciation && <p style={{color: '#666', fontStyle: 'italic'}}>{v.pronunciation}</p>}
                                      <p>💡 {v.meaning}</p>
                                      {v.example && <p style={{marginTop: '5px', color: '#555'}}>📝 {v.example}</p>}
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          
                          {msg.grammar && msg.grammar.length > 0 && (
                            <div>
                              <h5 style={{color: '#ff9800'}}>📐 Ngữ pháp:</h5>
                              {msg.grammar.map((g, i) => (
                                <div key={i} style={{background: 'white', padding: '10px', margin: '8px 0', borderRadius: '8px'}}>
                                  {typeof g === 'string' ? (
                                    <p>{g}</p>
                                  ) : (
                                    <>
                                      <p style={{fontSize: '16px', fontWeight: 'bold', color: '#f57c00'}}>{g.pattern}</p>
                                      <p style={{marginTop: '5px'}}>📚 {g.explanation}</p>
                                      {g.usage && <p style={{marginTop: '5px', color: '#666'}}>💡 {g.usage}</p>}
                                      {g.examples && g.examples.length > 0 && (
                                        <div style={{marginTop: '8px'}}>
                                          <p style={{fontWeight: 'bold'}}>📝 Ví dụ:</p>
                                          {g.examples.map((ex, j) => (
                                            <p key={j} style={{marginLeft: '10px', fontStyle: 'italic'}}>• {ex}</p>
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
              📝 Nhập text
            </button>

            <button
              className={`btn-record ${isRecording ? 'recording' : ''}`}
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onTouchStart={handleMouseDown}
              onTouchEnd={handleMouseUp}
              disabled={isProcessing}
            >
              {isRecording ? '🎤 ĐANG GHI!' : isProcessing ? '⏳ Đang xử lý...' : '🎤 Nhấn giữ để nói'}
            </button>
            
            <div className="settings">
              <label>
                Giọng:
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
                  const level = prompt('Ngữ pháp đã biết:\n(VD: -이에요, -아요/어요)');
                  if (level) {
                    setSettings({...settings, userLevel: level.split(',').map(s => s.trim())});
                  }
                }}
              >
                ⚙️ Trình độ
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default KoreanLearningApp;
