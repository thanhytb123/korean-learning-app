import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const KoreanLearningApp = () => {
  const [messages, setMessages] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [micPermission, setMicPermission] = useState(null);
  const [settings, setSettings] = useState({
    voiceGender: 'female',
    ttsSpeed: 0.8,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentAudioPlaying, setCurrentAudioPlaying] = useState(null);
  const [expandedDetails, setExpandedDetails] = useState({});
  const [textInput, setTextInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [recognizedText, setRecognizedText] = useState('');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  
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
    setRecognizedText('');
    
    recognitionRef.current.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      if (transcript && transcript.trim()) {
        setIsRecording(false);
        setRecognizedText(transcript);
        setShowConfirmDialog(true);
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

  const handleConfirmRecognition = (isQuestion) => {
    let finalText = recognizedText;
    if (isQuestion && !finalText.includes('?')) {
      finalText = finalText + '?';
    }
    setShowConfirmDialog(false);
    setRecognizedText('');
    processUserInput(finalText);
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
      const recentContext = messages.slice(-3).map(m => 
        m.type === 'user' ? `User: ${m.correctedText}` : `AI: ${m.text}`
      ).join('\n');
      
      const correctionResponse = await callOpenAI('/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a PRECISE Korean grammar expert. Analyze with EXTREME ACCURACY.

ABSOLUTE RULES FOR CORRECTNESS:
1. **ALWAYS CORRECT (Don't mark as error):**
   ✅ "밥 먹었어?" - Casual question (verb: 먹었다, subject: implied 너)
   ✅ "먹었어요" - Polite answer (verb: 먹었다, subject: implied)
   ✅ "네, 좋아" - Short agreement (adjective: 좋다)
   ✅ "가자" - Casual suggestion (verb: 가다)
   ✅ "아니야" - Negation (complete thought)
   ✅ "그래" - Agreement (complete response)
   ✅ "뭐?" - Question word (valid in conversation)
   → Rule: If it has a verb/adjective/완전한 의미, it's CORRECT
   
2. **ACTUAL ERRORS (Mark these):**
   ❌ "밥" alone - Just a noun, no verb/adjective (needs context)
   ❌ "저는 밥" - Subject + noun with no predicate
   ❌ "먹어 밥" - Wrong word order (verb before object)
   ❌ "밥이 먹었어요" - Wrong particle (밥을 not 밥이)
   ❌ "학생 저는" - Wrong order (noun before subject marker)
   → Rule: Missing verb/adjective OR wrong grammar structure

3. **ANALYSIS PROCESS:**
   Step 1: Check if there's a verb/adjective → YES = likely correct
   Step 2: Check conversation context → Is it a natural response?
   Step 3: Check grammar rules → Particles, order, formality match?
   Step 4: ONLY mark error if grammar is ACTUALLY wrong

4. **CONTEXT AWARENESS:**
   - In conversation, short answers are VALID
   - "네" after question = CORRECT (means yes)
   - "아니요" after question = CORRECT (means no)
   - Single verb/adjective = CORRECT if context is clear

Return JSON:
{
  "isCorrect": true/false,
  "corrected": "text with punctuation",
  "errorType": "grammar|vocabulary|word-order|none",
  "explanation": "ONLY if real error - detailed Vietnamese explanation with examples"
}

**Explanation format (ONLY for real errors):**
🔍 **Phân tích lỗi:**
- Câu của bạn: "{original}"
- Ngữ cảnh: {conversation context}
- Vấn đề cụ thể: {exact grammar issue}
- Loại lỗi: {Vietnamese error type}

❌ **Tại sao sai:**
{Detailed explanation of SPECIFIC grammar rule violated}
{Why this structure doesn't work in Korean}
{Compare to Vietnamese structure if helpful}

✅ **Cách sửa đúng:**
- Câu đúng: "{corrected}"
- Giải thích: {What was added/fixed and precise reason}
- Cấu trúc đúng: {Show correct structure}

📝 **Ví dụ tương tự (same error type):**
1. Sai: {example with SAME error}
   Đúng: {correction}
   Lý do: {explanation}

2. Sai: {example with SAME error}
   Đúng: {correction}
   Lý do: {explanation}

3. Sai: {example with SAME error}
   Đúng: {correction}
   Lý do: {explanation}

💡 **Quy tắc ngữ pháp:**
{Specific Korean grammar rule}
{When to use/not use}
{Common mistakes}

**TEST EXAMPLES:**

Input: "밥 먹었어"
Context: Response to "뭐 해?"
Analysis: 
- Has verb: 먹었다 (ate)
- Subject implied: 나/저
- Natural conversational Korean
→ CORRECT
{"isCorrect": true, "corrected": "밥 먹었어.", "errorType": "none"}

Input: "밥"
Context: Standalone
Analysis:
- No verb/adjective
- Just noun
- No context to make it complete
→ ERROR
{"isCorrect": false, "corrected": "밥을 먹어요.", "errorType": "grammar", "explanation": "...detailed..."}

Input: "저는 학생"
Analysis:
- Has subject: 저는
- Has noun: 학생
- Missing copula: 이다
→ ERROR
{"isCorrect": false, "corrected": "저는 학생이에요.", "errorType": "grammar", "explanation": "..."}

Input: "좋아요"
Context: Response to question
Analysis:
- Has adjective: 좋다
- Complete predicate
- Natural response
→ CORRECT
{"isCorrect": true, "corrected": "좋아요.", "errorType": "none"}

BE EXTREMELY PRECISE. Think like a native speaker. Only mark REAL errors.`
          },
          { 
            role: 'user', 
            content: `Conversation context:\n${recentContext || 'First message'}\n\nAnalyze this sentence: "${userText}"\n\nIs this correct Korean grammar? Consider the conversation context.` 
          }
        ],
        temperature: 0.05
      });
      
      const correctionData = await correctionResponse.json();
      let correction;
      
      try {
        let content = correctionData.choices[0].message.content;
        content = content.replace(/``````/g, '').trim();
        correction = JSON.parse(content);
      } catch (e) {
        correction = { 
          isCorrect: true, 
          corrected: userText, 
          errorType: 'none',
          explanation: '' 
        };
      }

      const hasRealError = correction.errorType && correction.errorType !== 'none';
      
      const userMsg = {
        id: Date.now(),
        type: 'user',
        originalText: userText,
        correctedText: correction.corrected || userText,
        isCorrect: !hasRealError,
        details: hasRealError ? correction.explanation : ''
      };
      
      setMessages(prev => [...prev, userMsg]);
      
      if (hasRealError) {
        setIsProcessing(false);
        return;
      }
      
      const questionPatterns = ['?', 'ㅂ니까', '습니까', 'ㄹ까요', '을까요', '나요', '세요?', '어요?', '아요?', '지요?', '죠?', '니?', '지?', '요?'];
      const isQuestion = questionPatterns.some(pattern => userMsg.correctedText.includes(pattern));
      
      const recentMessages = messages.slice(-3).map(m => ({
        role: m.type === 'user' ? 'user' : 'assistant',
        content: m.type === 'user' ? m.correctedText : m.text
      }));
      
      const aiResponse = await callOpenAI('/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a Korean conversation teacher. Reply in COMPLETE, NATURAL Korean sentences.

CRITICAL RULES:
1. **COMPLETE RESPONSES (2-3 sentences minimum):**
   ❌ Don't reply: "네, 먹었어요."
   ✅ Do reply: "네,, 밥 먹었어요! 점심에 김치찌개를 먹었어요. 당신은요?"
   
   ❌ Don't reply: "좋아요."
   ✅ Do reply: "네,, 정말 좋아요! 오늘 날씨가 참 좋네요."

2. **NATURAL CONVERSATION FLOW:**
   - Answer the question FULLY
   - Add related information (what, when, where, how)
   - Ask a follow-up question to continue conversation
   - Use ,, for natural pauses between sentences

3. **VOCABULARY & GRAMMAR:**
   - Include ONLY words from your response (3-5 words max)
   - Include ONLY grammar patterns from your response (1-2 patterns max)
   - Every word/pattern MUST appear in your Korean response
   - Provide detailed Vietnamese explanations with examples

4. **RESPONSE STRUCTURE:**
   {
     "response": "Complete Korean answer (2-3 sentences with ,,)",
     "vocabulary": [
       {
         "word": "word from response",
         "meaning": "Vietnamese meaning",
         "pronunciation": "pronunciation",
         "example": "Example sentence in Korean with Vietnamese translation"
       }
     ],
     "grammar": [
       {
         "pattern": "grammar pattern from response",
         "explanation": "Detailed Vietnamese explanation of usage",
         "usage": "When and how to use this pattern",
         "examples": [
           "Example 1 in Korean (Vietnamese translation)",
           "Example 2 in Korean (Vietnamese translation)",
           "Example 3 in Korean (Vietnamese translation)"
         ]
       }
     ]
   }

**EXAMPLES OF COMPLETE RESPONSES:**

User: "밥 먹었어요?"
Bad: "네, 먹었어요."
Good: "네,, 조금 전에 먹었어요! 불고기랑 밥을 먹었는데 정말 맛있었어요. 당신은 벌써 드셨어요?"

User: "날씨 어때요?"
Bad: "좋아요."
Good: "오늘 날씨가 정말 좋아요! 하늘이 맑고,, 바람도 시원해요. 산책하기 딱 좋은 날씨예요."

User: "뭐 해요?"
Bad: "공부해요."
Good: "지금 한국어를 공부하고 있어요. 새로운 단어들을 배우는 중이에요. 너무 재미있어요!"

ALWAYS respond with FULL, DETAILED, NATURAL Korean conversation. Be engaging and informative.`
          },
          ...recentMessages,
          { 
            role: 'user', 
            content: userMsg.correctedText
          }
        ],
        temperature: 0.8,
        response_format: { type: "json_object" }
      });
      
      const aiData = await aiResponse.json();
      let aiResult;
      
      try {
        let text = aiData.choices[0].message.content;
        text = text.replace(/``````/g, '').trim();
        
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          text = jsonMatch[0];
        }
        
        aiResult = JSON.parse(text);
        
        if (!aiResult.response || typeof aiResult.response !== 'string') {
          throw new Error('Invalid response structure');
        }
      } catch (e) {
        console.error('JSON parse error:', e);
        const rawText = aiData.choices[0].message.content;
        const koreanTextMatch = rawText.match(/[가-힣\s\.,!?]+/g);
        const cleanedText = koreanTextMatch ? koreanTextMatch.join(' ').trim() : '죄송합니다. 다시 말씀해 주세요.';
        
        aiResult = {
          response: cleanedText,
          vocabulary: [],
          grammar: []
        };
      }
      
      const responseText = aiResult.response || '죄송합니다.';
      const aiMsg = {
        id: Date.now() + 1,
        type: 'ai',
        text: responseText,
        displayText: responseText.replace(/,,/g, ',').replace(/\.\./g, '.'),
        vocabulary: aiResult.vocabulary || [],
        grammar: aiResult.grammar || [],
        audioUrl: null
      };
      
      setMessages(prev => [...prev, aiMsg]);
      playTTS(aiMsg.id, aiMsg.text);
      
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
        speed: settings.ttsSpeed
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

  const adjustSpeed = (delta) => {
    setSettings(prev => ({
      ...prev,
      ttsSpeed: Math.max(0.5, Math.min(1.5, prev.ttsSpeed + delta))
    }));
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
          <h3 style={{margin: '0 0 20px 0'}}>Cài đặt</h3>
          
          <div style={{marginBottom: '20px'}}>
            <label style={{display: 'block', marginBottom: '8px', fontWeight: 'bold'}}>Giọng AI:</label>
            <select 
              value={settings.voiceGender} 
              onChange={(e) => setSettings({...settings, voiceGender: e.target.value})}
              style={{padding: '10px', borderRadius: '8px', width: '100%', fontSize: '15px', border: '1px solid #ddd'}}
            >
              <option value="female">여성 (Nữ)</option>
              <option value="male">남성 (Nam)</option>
            </select>
          </div>

          <div>
            <label style={{display: 'block', marginBottom: '8px', fontWeight: 'bold'}}>
              Tốc độ đọc: {settings.ttsSpeed.toFixed(1)}x
            </label>
            <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
              <button
                onClick={() => adjustSpeed(-0.1)}
                disabled={settings.ttsSpeed <= 0.5}
                style={{padding: '10px 20px', background: settings.ttsSpeed <= 0.5 ? '#ccc' : '#f44336', color: 'white', border: 'none', borderRadius: '8px', cursor: settings.ttsSpeed <= 0.5 ? 'not-allowed' : 'pointer', fontSize: '18px', fontWeight: 'bold'}}
              >
                −
              </button>
              
              <div style={{flex: 1, background: '#f5f5f5', padding: '15px', borderRadius: '8px', textAlign: 'center'}}>
                <div style={{fontSize: '24px', fontWeight: 'bold', color: '#2196f3'}}>{settings.ttsSpeed.toFixed(1)}x</div>
                <div style={{fontSize: '12px', color: '#666', marginTop: '4px'}}>
                  {settings.ttsSpeed < 0.7 ? 'Rất chậm' : settings.ttsSpeed < 0.9 ? 'Chậm' : settings.ttsSpeed < 1.1 ? 'Bình thường' : settings.ttsSpeed < 1.3 ? 'Nhanh' : 'Rất nhanh'}
                </div>
              </div>
              
              <button
                onClick={() => adjustSpeed(0.1)}
                disabled={settings.ttsSpeed >= 1.5}
                style={{padding: '10px 20px', background: settings.ttsSpeed >= 1.5 ? '#ccc' : '#4caf50', color: 'white', border: 'none', borderRadius: '8px', cursor: settings.ttsSpeed >= 1.5 ? 'not-allowed' : 'pointer', fontSize: '18px', fontWeight: 'bold'}}
              >
                +
              </button>
            </div>
            <div style={{marginTop: '8px', fontSize: '13px', color: '#666', textAlign: 'center'}}>
              0.5x (chậm nhất) → 1.5x (nhanh nhất)
            </div>
          </div>

          <button
            onClick={() => setShowSettings(false)}
            style={{marginTop: '20px', padding: '12px 20px', background: '#2196f3', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', width: '100%', fontSize: '16px', fontWeight: 'bold'}}
          >
            ✓ Đóng
          </button>
        </div>
      )}

      {showConfirmDialog && (
        <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, padding: '20px'}}>
          <div style={{background: 'white', padding: '20px', borderRadius: '15px', maxWidth: '90%', width: '400px'}}>
            <h3 style={{margin: '0 0 15px 0'}}>Xác nhận giọng nói</h3>
            <div style={{background: '#f5f5f5', padding: '15px', borderRadius: '10px', marginBottom: '15px'}}>
              <p style={{margin: 0, fontSize: '18px', fontWeight: 'bold', color: '#1976d2'}}>{recognizedText}</p>
            </div>
            <p style={{marginBottom: '15px', fontSize: '14px', color: '#666'}}>Đây là câu hỏi hay câu trần thuật?</p>
            <div style={{display: 'flex', gap: '10px'}}>
              <button
                onClick={() => handleConfirmRecognition(true)}
                style={{flex: 1, padding: '12px', background: '#2196f3', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer'}}
              >
                ❓ Câu hỏi
              </button>
              <button
                onClick={() => handleConfirmRecognition(false)}
                style={{flex: 1, padding: '12px', background: '#4caf50', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer'}}
              >
                💬 Câu nói
              </button>
            </div>
            <button
              onClick={() => {setShowConfirmDialog(false); setRecognizedText('');}}
              style={{width: '100%', marginTop: '10px', padding: '10px', background: '#f44336', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer'}}
            >
              ❌ Hủy
            </button>
          </div>
        </div>
      )}
      
      <div className="chat-container" style={{paddingBottom: '160px'}}>
        {messages.length === 0 && (
          <div style={{textAlign: 'center', padding: '20px'}}>
            <h2 style={{fontSize: '24px', marginBottom: '15px'}}>환영합니다!</h2>
            <p style={{fontSize: '16px', color: '#666'}}>Nhập câu tiếng Hàn bên dưới</p>
            <p style={{fontSize: '14px', color: '#999', marginTop: '10px'}}>💡 VD: 안녕하세요, 밥 먹었어요?</p>
          </div>
        )}
        
        {messages.map((msg) => (
          <div key={msg.id} style={{marginBottom: '15px', width: '100%', display: 'flex', justifyContent: msg.type === 'user' ? 'flex-end' : 'flex-start'}}>
            {msg.type === 'user' ? (
              <div style={{background: msg.isCorrect ? '#e3f2fd' : '#ffebee', padding: '15px', borderRadius: '15px', display: 'inline-block', maxWidth: '85%'}}>
                {!msg.isCorrect && (
                  <div style={{textDecoration: 'line-through', color: '#f44336', marginBottom: '8px', fontSize: '15px'}}>
                    {msg.originalText}
                  </div>
                )}
                <div style={{color: msg.isCorrect ? '#1976d2' : '#e91e63', fontWeight: 'bold', fontSize: '16px', marginBottom: msg.isCorrect ? 0 : '10px'}}>
                  {msg.correctedText}
                  {msg.isCorrect && <span style={{marginLeft: '6px', fontSize: '14px'}}>✓</span>}
                </div>
                
                {!msg.isCorrect && msg.details && (
                  <button 
                    onClick={() => toggleDetails(msg.id)}
                    style={{marginTop: '8px', padding: '8px 16px', background: expandedDetails[msg.id] ? '#ff9800' : '#2196f3', color: 'white', border: 'none', borderRadius: '20px', cursor: 'pointer', fontSize: '13px', width: '100%'}}
                  >
                    {expandedDetails[msg.id] ? '🔼 Ẩn giải thích' : '📝 Xem giải thích chi tiết'}
                  </button>
                )}
                
                {!msg.isCorrect && expandedDetails[msg.id] && msg.details && (
                  <div style={{marginTop: '12px', fontSize: '14px', color: '#333', background: 'white', padding: '12px', borderRadius: '8px', lineHeight: '1.6', whiteSpace: 'pre-wrap'}}>
                    {msg.details}
                  </div>
                )}
              </div>
            ) : (
              <div style={{background: '#f5f5f5', padding: '15px', borderRadius: '15px', display: 'inline-block', maxWidth: '85%'}}>
                <div style={{fontSize: '16px', fontWeight: '500', marginBottom: '10px'}}>{msg.displayText || msg.text}</div>
                
                <div style={{display: 'flex', gap: '8px', marginTop: '12px'}}>
                  <button onClick={() => replayAudio(msg)} disabled={currentAudioPlaying === msg.id} style={{flex: 1, background: currentAudioPlaying === msg.id ? '#999' : '#2196f3', color: 'white', border: 'none', borderRadius: '20px', padding: '10px', cursor: 'pointer', fontSize: '14px'}}>
                    {currentAudioPlaying === msg.id ? '▶️' : '🔊'} Nghe lại
                  </button>
                  
                  <button onClick={() => toggleDetails(msg.id)} style={{flex: 1, background: expandedDetails[msg.id] ? '#ff9800' : '#4caf50', color: 'white', border: 'none', borderRadius: '20px', padding: '10px', cursor: 'pointer', fontSize: '14px'}}>
                    {expandedDetails[msg.id] ? '🔼' : '📚'} Chi tiết
                  </button>
                </div>
                
                {expandedDetails[msg.id] && (msg.vocabulary?.length > 0 || msg.grammar?.length > 0) && (
                  <div style={{marginTop: '15px', background: 'white', padding: '15px', borderRadius: '10px'}}>
                    {msg.vocabulary && msg.vocabulary.length > 0 && (
                      <div style={{marginBottom: msg.grammar?.length > 0 ? '15px' : 0}}>
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
                                  {v.example && <p style={{margin: '6px 0 0 0', fontSize: '13px', color: '#777', fontStyle: 'italic', paddingLeft: '10px', borderLeft: '2px solid #2196f3'}}>📝 {v.example}</p>}
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {msg.grammar && msg.grammar.length > 0 && (
                      <div>
                        <h5 style={{color: '#ff9800', margin: '0 0 10px 0', fontSize: '16px'}}>📐 Ngữ pháp</h5>
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
                                    <p style={{fontWeight: 'bold', margin: '0 0 6px 0', fontSize: '14px'}}>📝 Ví dụ:</p>
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
        
        {isProcessing && (
          <div style={{marginBottom: '15px', width: '100%'}}>
            <div style={{background: '#f5f5f5', padding: '15px', borderRadius: '15px', display: 'inline-block'}}>
              <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                <div className="typing-indicator">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
                <span style={{fontSize: '14px', color: '#666'}}>AI đang suy nghĩ...</span>
              </div>
            </div>
          </div>
        )}
      </div>
      
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
            style={{width: '100%', padding: '15px', background: isRecording ? '#f44336' : '#4caf50', color: 'white', border: 'none', borderRadius: '25px', cursor: isProcessing ? 'not-allowed' : 'pointer', fontSize: '16px', fontWeight: 'bold', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none'}}
          >
            {isRecording ? '🎤 Đang ghi...' : '🎤 Nhấn giữ để nói'}
          </button>
        )}
      </div>
    </div>
  );
};

export default KoreanLearningApp;
