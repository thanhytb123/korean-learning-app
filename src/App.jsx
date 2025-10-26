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
  const [textInput, setTextInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recognitionRef = useRef(null);

  const callOpenAI = async (endpoint, body) => {
    const response = await fetch('/api/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, method: 'POST', body })
    });
    if (!response.ok) throw new Error(`API failed`);
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
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) return;
    
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

  const handleVoiceStart = async () => {
    if (micPermission !== 'granted' || isProcessing) return;
    
    setIsRecording(true);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
      });
      
      mediaRecorderRef.current = new MediaRecorder(stream);
      mediaRecorderRef.current.start();
      
      if (recognitionRef.current) {
        recognitionRef.current.onresult = async (event) => {
          const transcript = event.results[0][0].transcript;
          
          if (transcript && transcript.trim().length > 0) {
            setIsRecording(false);
            
            if (mediaRecorderRef.current) {
              try {
                mediaRecorderRef.current.stop();
                mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
              } catch(e) {}
            }
            
            await processUserInput(transcript);
          }
        };
        
        recognitionRef.current.onerror = () => {
          setIsRecording(false);
        };
        
        recognitionRef.current.start();
      }
    } catch (error) {
      setIsRecording(false);
    }
  };

  const handleVoiceStop = () => {
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

  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (textInput.trim() && !isProcessing) {
      processUserInput(textInput.trim());
      setTextInput('');
    }
  };

  const processUserInput = async (userText) => {
    setIsProcessing(true);
    
    try {
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
        details: correction.details
      };
      
      setMessages(prev => [...prev, userMsg]);
      
      if (!correction.isCorrect) {
        setIsProcessing(false);
        return;
      }
      
      const aiResponse = await callOpenAI('/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Korean teacher. RULES:
1. Response MUST be 100% Korean
2. Level: ${settings.userLevel.join(', ') || 'beginner'}
3. Return JSON:
{
  "response": "Korean response",
  "vocabulary": [{"word": "단어", "meaning": "nghĩa", "pronunciation": "phát âm", "example": "VD"}],
  "grammar": [{"pattern": "문법", "explanation": "Giải thích", "usage": "Cách dùng", "examples": ["VD1", "VD2"]}]
}`
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

  return (
    <div className="korean-app">
      <header className="app-header">
        <div className="logo">
          <span className="korean-flag">🇰🇷</span>
          <h1 style={{fontSize: '20px', margin: 0}}>한국어 학습</h1>
        </div>
        <button 
          onClick={() => setShowSettings(!showSettings)}
          style={{
            background: 'none',
            border: 'none',
            color: 'white',
            fontSize: '24px',
            cursor: 'pointer'
          }}
        >
          ⚙️
        </button>
      </header>

      {showSettings && (
        <div style={{
          background: 'white',
          padding: '20px',
          margin: '10px',
          borderRadius: '10px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
        }}>
          <h3>Cài đặt</h3>
          <div style={{marginBottom: '15px'}}>
            <label style={{display: 'block', marginBottom: '5px'}}>Giọng AI:</label>
            <select 
              value={settings.voiceGender} 
              onChange={(e) => setSettings({...settings, voiceGender: e.target.value})}
              style={{padding: '8px', borderRadius: '5px', width: '100%'}}
            >
              <option value="female">여성 (Nữ)</option>
              <option value="male">남성 (Nam)</option>
            </select>
          </div>
          <div>
            <label style={{display: 'block', marginBottom: '5px'}}>Trình độ ngữ pháp đã biết:</label>
            <input
              type="text"
              placeholder="VD: -이에요, -아요/어요"
              value={settings.userLevel.join(', ')}
              onChange={(e) => setSettings({...settings, userLevel: e.target.value.split(',').map(s => s.trim())})}
              style={{padding: '8px', borderRadius: '5px', width: '100%', border: '1px solid #ddd'}}
            />
          </div>
          <button
            onClick={() => setShowSettings(false)}
            style={{
              marginTop: '15px',
              padding: '10px 20px',
              background: '#4caf50',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              width: '100%'
            }}
          >
            Đóng
          </button>
        </div>
      )}
      
      {micPermission === 'denied' && (
        <div className="permission-alert">
          <div className="alert-content">
            <h2>⚠️ Microphone bị từ chối</h2>
            <p>Bạn có thể dùng chế độ nhập text bên dưới</p>
          </div>
        </div>
      )}
      
      <div className="chat-container" style={{paddingBottom: '180px'}}>
        {messages.length === 0 && (
          <div className="welcome-message" style={{textAlign: 'center', padding: '20px'}}>
            <h2 style={{fontSize: '24px', marginBottom: '15px'}}>환영합니다!</h2>
            <p style={{fontSize: '16px', color: '#666'}}>Nhập câu tiếng Hàn bên dưới để bắt đầu học!</p>
            <p style={{fontSize: '14px', color: '#999', marginTop: '10px'}}>💡 Ví dụ: 안녕하세요, 감사합니다</p>
          </div>
        )}
        
        {messages.map((msg) => (
          <div key={msg.id} className={`message ${msg.type}`} style={{marginBottom: '15px'}}>
            {msg.type === 'user' ? (
              <div className="user-message">
                <div className="message-bubble" style={{
                  background: msg.isCorrect ? '#e3f2fd' : '#ffebee',
                  padding: '15px',
                  borderRadius: '15px',
                  marginLeft: '20px'
                }}>
                  {!msg.isCorrect && (
                    <div style={{textDecoration: 'line-through', color: '#f44336', marginBottom: '8px'}}>
                      {msg.originalText}
                    </div>
                  )}
                  <div style={{color: msg.isCorrect ? '#1976d2' : '#e91e63', fontWeight: 'bold', fontSize: '16px'}}>
                    {msg.correctedText}
                  </div>
                  {!msg.isCorrect && msg.details && (
                    <div style={{marginTop: '10px', fontSize: '14px', color: '#666', background: 'white', padding: '10px', borderRadius: '8px'}}>
                      📝 {msg.details}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="ai-message">
                <div className="message-bubble" style={{
                  background: '#f5f5f5',
                  padding: '15px',
                  borderRadius: '15px',
                  marginRight: '20px'
                }}>
                  <div style={{fontSize: '16px', fontWeight: '500', marginBottom: '10px'}}>{msg.text}</div>
                  
                  <div style={{display: 'flex', gap: '8px', marginTop: '12px'}}>
                    <button 
                      onClick={() => replayAudio(msg)} 
                      disabled={currentAudioPlaying === msg.id}
                      style={{
                        flex: 1,
                        background: currentAudioPlaying === msg.id ? '#999' : '#2196f3',
                        color: 'white',
                        border: 'none',
                        borderRadius: '20px',
                        padding: '10px',
                        cursor: 'pointer',
                        fontSize: '14px'
                      }}
                    >
                      {currentAudioPlaying === msg.id ? '▶️' : '🔊'} Nghe
                    </button>
                    
                    <button 
                      onClick={() => toggleDetails(msg.id)}
                      style={{
                        flex: 1,
                        background: expandedDetails[msg.id] ? '#ff9800' : '#4caf50',
                        color: 'white',
                        border: 'none',
                        borderRadius: '20px',
                        padding: '10px',
                        cursor: 'pointer',
                        fontSize: '14px'
                      }}
                    >
                      {expandedDetails[msg.id] ? '🔼' : '📚'} Chi tiết
                    </button>
                  </div>
                  
                  {expandedDetails[msg.id] && (
                    <div style={{marginTop: '15px', background: 'white', padding: '15px', borderRadius: '10px'}}>
                      {msg.vocabulary && msg.vocabulary.length > 0 && (
                        <div style={{marginBottom: '15px'}}>
                          <h5 style={{color: '#2196f3', margin: '0 0 10px 0'}}>📖 Từ vựng</h5>
                          {msg.vocabulary.map((v, i) => (
                            <div key={i} style={{background: '#f9f9f9', padding: '10px', margin: '8px 0', borderRadius: '8px', borderLeft: '3px solid #2196f3'}}>
                              {typeof v === 'string' ? (
                                <p style={{margin: 0}}>{v}</p>
                              ) : (
                                <>
                                  <p style={{fontSize: '16px', fontWeight: 'bold', color: '#1976d2', margin: '0 0 5px 0'}}>{v.word}</p>
                                  {v.pronunciation && <p style={{color: '#666', fontStyle: 'italic', margin: '0 0 5px 0', fontSize: '14px'}}>[{v.pronunciation}]</p>}
                                  <p style={{margin: '5px 0'}}>💡 {v.meaning}</p>
                                  {v.example && <p style={{marginTop: '8px', color: '#555', fontSize: '14px', fontStyle: 'italic'}}>📝 {v.example}</p>}
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {msg.grammar && msg.grammar.length > 0 && (
                        <div>
                          <h5 style={{color: '#ff9800', margin: '0 0 10px 0'}}>📐 Ngữ pháp</h5>
                          {msg.grammar.map((g, i) => (
                            <div key={i} style={{background: '#fff8e1', padding: '10px', margin: '8px 0', borderRadius: '8px', borderLeft: '3px solid #ff9800'}}>
                              {typeof g === 'string' ? (
                                <p style={{margin: 0}}>{g}</p>
                              ) : (
                                <>
                                  <p style={{fontSize: '16px', fontWeight: 'bold', color: '#f57c00', margin: '0 0 8px 0'}}>{g.pattern}</p>
                                  <p style={{margin: '5px 0'}}>📚 {g.explanation}</p>
                                  {g.usage && <p style={{marginTop: '8px', color: '#666', fontSize: '14px'}}>💡 {g.usage}</p>}
                                  {g.examples && g.examples.length > 0 && (
                                    <div style={{marginTop: '10px', paddingLeft: '10px', borderLeft: '2px solid #ff9800'}}>
                                      <p style={{fontWeight: 'bold', margin: '0 0 5px 0', fontSize: '14px'}}>📝 Ví dụ:</p>
                                      {g.examples.map((ex, j) => (
                                        <p key={j} style={{margin: '5px 0', fontStyle: 'italic', fontSize: '14px'}}>• {ex}</p>
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
          <div style={{textAlign: 'center', padding: '20px'}}>
            <div className="spinner"></div>
            <p style={{marginTop: '10px', color: '#666'}}>Đang xử lý...</p>
          </div>
        )}
      </div>
      
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'white',
        padding: '15px',
        boxShadow: '0 -2px 10px rgba(0,0,0,0.1)',
        zIndex: 1000
      }}>
        <form onSubmit={handleTextSubmit} style={{marginBottom: '10px'}}>
          <div style={{display: 'flex', gap: '10px'}}>
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Nhập câu tiếng Hàn... (VD: 안녕하세요)"
              disabled={isProcessing}
              style={{
                flex: 1,
                padding: '12px',
                fontSize: '16px',
                border: '2px solid #2196f3',
                borderRadius: '25px',
                outline: 'none'
              }}
            />
            <button
              type="submit"
              disabled={isProcessing || !textInput.trim()}
              style={{
                padding: '12px 24px',
                background: isProcessing || !textInput.trim() ? '#ccc' : '#2196f3',
                color: 'white',
                border: 'none',
                borderRadius: '25px',
                cursor: isProcessing || !textInput.trim() ? 'not-allowed' : 'pointer',
                fontSize: '16px',
                fontWeight: 'bold'
              }}
            >
              {isProcessing ? '⏳' : '📨'}
            </button>
          </div>
        </form>

        {micPermission === 'granted' && (
          <div style={{textAlign: 'center'}}>
            <button
              onMouseDown={handleVoiceStart}
              onMouseUp={handleVoiceStop}
              onTouchStart={handleVoiceStart}
              onTouchEnd={handleVoiceStop}
              disabled={isProcessing}
              style={{
                width: '100%',
                padding: '15px',
                background: isRecording ? '#f44336' : '#4caf50',
                color: 'white',
                border: 'none',
                borderRadius: '25px',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                fontSize: '16px',
                fontWeight: 'bold'
              }}
            >
              {isRecording ? '🎤 Đang ghi...' : '🎤 Nhấn giữ để nói (không ổn định)'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default KoreanLearningApp;
