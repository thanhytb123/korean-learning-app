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
    
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.lang = 'ko-KR';
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
    }
    
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (e) {}
      }
    };
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

  const handleVoiceStart = (e) => {
    e.preventDefault();
    if (!recognitionRef.current || micPermission !== 'granted' || isProcessing || isRecording) return;
    
    setIsRecording(true);
    
    recognitionRef.current.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      if (transcript && transcript.trim()) {
        setIsRecording(false);
        processUserInput(transcript);
      }
    };
    
    recognitionRef.current.onerror = () => setIsRecording(false);
    recognitionRef.current.onend = () => setIsRecording(false);
    
    try {
      recognitionRef.current.start();
    } catch (error) {
      setIsRecording(false);
    }
  };

  const handleVoiceStop = (e) => {
    e.preventDefault();
    if (recognitionRef.current && isRecording) {
      try { recognitionRef.current.stop(); } catch (e) {}
      setIsRecording(false);
    }
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
            content: `Korean teacher. Check grammar. Return JSON:
{"isCorrect": true/false, "corrected": "fixed", "details": "Vietnamese explanation"}`
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
            content: `Korean teacher. CRITICAL RULES:

1. Response MUST be 100% Korean (한국어)
2. Student level: ${settings.userLevel.join(', ') || 'beginner'}
3. Return ONLY this JSON format:

{
  "response": "Natural Korean response",
  "vocabulary": [
    {
      "word": "Korean word",
      "meaning": "Vietnamese meaning",
      "pronunciation": "romanization",
      "example": "Example sentence with this word in Korean with Vietnamese translation"
    }
  ],
  "grammar": [
    {
      "pattern": "Grammar pattern (e.g., -아/어요)",
      "explanation": "Detailed Vietnamese explanation of what this grammar does",
      "usage": "When and how to use this pattern",
      "examples": [
        "Korean example 1 (Vietnamese translation)",
        "Korean example 2 (Vietnamese translation)",
        "Korean example 3 (Vietnamese translation)"
      ]
    }
  ]
}

IMPORTANT: List ALL grammar patterns used in your response. Include 4-6 vocabulary words and 3-5 grammar patterns with detailed examples.`
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
          style={{background: 'none', border: 'none', color: 'white', fontSize: '24px', cursor: 'pointer'}}
        >
          ⚙️
        </button>
      </header>

      {showSettings && (
        <div style={{background: 'white', padding: '20px', margin: '10px', borderRadius: '10px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)'}}>
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
            <label style={{display: 'block', marginBottom: '5px'}}>Trình độ:</label>
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
            style={{marginTop: '15px', padding: '10px 20px', background: '#4caf50', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', width: '100%'}}
          >
            Đóng
          </button>
        </div>
      )}
      
      <div className="chat-container" style={{paddingBottom: '160px'}}>
        {messages.length === 0 && (
          <div style={{textAlign: 'center', padding: '20px'}}>
            <h2 style={{fontSize: '24px', marginBottom: '15px'}}>환영합니다!</h2>
            <p style={{fontSize: '16px', color: '#666'}}>Nhập câu tiếng Hàn bên dưới</p>
            <p style={{fontSize: '14px', color: '#999', marginTop: '10px'}}>💡 VD: 안녕하세요, 감사합니다</p>
          </div>
        )}
        
        {messages.map((msg) => (
          <div key={msg.id} style={{marginBottom: '15px', width: '100%'}}>
            {msg.type === 'user' ? (
              <div style={{background: msg.isCorrect ? '#e3f2fd' : '#ffebee', padding: '15px', borderRadius: '15px', maxWidth: '85%', marginLeft: 'auto'}}>
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
            ) : (
              <div style={{background: '#f5f5f5', padding: '15px', borderRadius: '15px', maxWidth: '85%'}}>
                <div style={{fontSize: '16px', fontWeight: '500', marginBottom: '10px'}}>{msg.text}</div>
                
                <div style={{display: 'flex', gap: '8px', marginTop: '12px'}}>
                  <button onClick={() => replayAudio(msg)} disabled={currentAudioPlaying === msg.id} style={{flex: 1, background: currentAudioPlaying === msg.id ? '#999' : '#2196f3', color: 'white', border: 'none', borderRadius: '20px', padding: '10px', cursor: 'pointer', fontSize: '14px'}}>
                    {currentAudioPlaying === msg.id ? '▶️' : '🔊'} Nghe
                  </button>
                  
                  <button onClick={() => toggleDetails(msg.id)} style={{flex: 1, background: expandedDetails[msg.id] ? '#ff9800' : '#4caf50', color: 'white', border: 'none', borderRadius: '20px', padding: '10px', cursor: 'pointer', fontSize: '14px'}}>
                    {expandedDetails[msg.id] ? '🔼' : '📚'} Chi tiết
                  </button>
                </div>
                
                {expandedDetails[msg.id] && (
                  <div style={{marginTop: '15px', background: 'white', padding: '15px', borderRadius: '10px'}}>
                    {msg.vocabulary && msg.vocabulary.length > 0 && (
                      <div style={{marginBottom: '15px'}}>
                        <h5 style={{color: '#2196f3', margin: '0 0 10px 0', fontSize: '16px'}}>📖 Từ vựng</h5>
                        <div style={{background: '#f0f8ff', padding: '12px', borderRadius: '8px', borderLeft: '3px solid #2196f3'}}>
                          {msg.vocabulary.map((v, i) => (
                            <div key={i} style={{marginBottom: i < msg.vocabulary.length - 1 ? '12px' : 0, paddingBottom: i < msg.vocabulary.length - 1 ? '12px' : 0, borderBottom: i < msg.vocabulary.length - 1 ? '1px solid #e0e0e0' : 'none'}}>
                              {typeof v === 'string' ? (
                                <p style={{margin: 0, fontSize: '14px'}}>{v}</p>
                              ) : (
                                <>
                                  <p style={{margin: 0, fontSize: '15px'}}>
                                    <strong style={{color: '#1976d2'}}>{v.word}</strong>
                                    {v.pronunciation && <span style={{color: '#666', fontStyle: 'italic', marginLeft: '8px', fontSize: '13px'}}>[{v.pronunciation}]</span>}
                                  </p>
                                  <p style={{margin: '4px 0 0 0', fontSize: '14px', color: '#555'}}>💡 Nghĩa: {v.meaning}</p>
                                  {v.example && <p style={{margin: '6px 0 0 0', fontSize: '13px', color: '#777', fontStyle: 'italic', paddingLeft: '10px', borderLeft: '2px solid #2196f3'}}>📝 Ví dụ: {v.example}</p>}
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {msg.grammar && msg.grammar.length > 0 && (
                      <div>
                        <h5 style={{color: '#ff9800', margin: '0 0 10px 0', fontSize: '16px'}}>📐 Ngữ pháp ({msg.grammar.length} mẫu)</h5>
                        {msg.grammar.map((g, i) => (
                          <div key={i} style={{background: '#fff8e1', padding: '12px', margin: i > 0 ? '12px 0 0 0' : '0', borderRadius: '8px', borderLeft: '3px solid #ff9800'}}>
                            {typeof g === 'string' ? (
                              <p style={{margin: 0}}>{g}</p>
                            ) : (
                              <>
                                <p style={{fontSize: '15px', fontWeight: 'bold', color: '#f57c00', margin: '0 0 8px 0'}}>{g.pattern}</p>
                                <p style={{margin: '0 0 6px 0', fontSize: '14px'}}><strong>📚 Giải thích:</strong> {g.explanation}</p>
                                {g.usage && <p style={{margin: '0 0 8px 0', color: '#666', fontSize: '14px'}}><strong>💡 Cách dùng:</strong> {g.usage}</p>}
                                {g.examples && g.examples.length > 0 && (
                                  <div style={{marginTop: '8px', paddingLeft: '10px', borderLeft: '2px solid #ff9800'}}>
                                    <p style={{fontWeight: 'bold', margin: '0 0 6px 0', fontSize: '14px'}}>📝 Ví dụ chi tiết:</p>
                                    {g.examples.map((ex, j) => (
                                      <p key={j} style={{margin: '6px 0', fontSize: '13px', lineHeight: '1.5'}}>• {ex}</p>
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
            )}
          </div>
        ))}
      </div>
      
      {isProcessing && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(255,255,255,0.95)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div className="spinner" style={{width: '60px', height: '60px', borderWidth: '6px'}}></div>
          <p style={{marginTop: '20px', color: '#333', fontSize: '18px', fontWeight: 'bold'}}>Đang xử lý...</p>
        </div>
      )}
      
      <div style={{position: 'fixed', bottom: 0, left: 0, right: 0, background: 'white', padding: '12px', boxShadow: '0 -2px 10px rgba(0,0,0,0.1)', zIndex: 1000}}>
        <form onSubmit={handleTextSubmit} style={{marginBottom: '10px'}}>
          <div style={{display: 'flex', gap: '10px'}}>
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Nhập câu tiếng Hàn..."
              disabled={isProcessing || isRecording}
              style={{flex: 1, padding: '14px', fontSize: '16px', border: '2px solid #2196f3', borderRadius: '25px', outline: 'none'}}
            />
            <button
              type="submit"
              disabled={isProcessing || !textInput.trim() || isRecording}
              style={{width: '56px', height: '56px', background: isProcessing || !textInput.trim() ? '#ccc' : '#2196f3', color: 'white', border: 'none', borderRadius: '50%', cursor: isProcessing || !textInput.trim() ? 'not-allowed' : 'pointer', fontSize: '24px'}}
            >
              {isProcessing ? '⏳' : '➤'}
            </button>
          </div>
        </form>

        {micPermission === 'granted' && (
          <button
            onTouchStart={handleVoiceStart}
            onTouchEnd={handleVoiceStop}
            onMouseDown={handleVoiceStart}
            onMouseUp={handleVoiceStop}
            onContextMenu={(e) => e.preventDefault()}
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
              fontWeight: 'bold',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none'
            }}
          >
            {isRecording ? '🎤 Đang ghi...' : '🎤 Nhấn giữ để nói'}
          </button>
        )}
      </div>
    </div>
  );
};

export default KoreanLearningApp;
