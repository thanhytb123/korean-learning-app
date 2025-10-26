import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const KoreanLearningApp = () => {
  const [messages, setMessages] = useState([]);
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const [isRecording, setIsRecording] = useState(false);
  const [micPermission, setMicPermission] = useState(null);
  const [settings, setSettings] = useState({ voiceGender: 'female', ttsSpeed: 0.8 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentAudioPlaying, setCurrentAudioPlaying] = useState(null);
  const [expandedDetails, setExpandedDetails] = useState({});
  const [textInput, setTextInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [recognizedText, setRecognizedText] = useState('');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const recognitionRef = useRef(null);
  const isRecordingRef = useRef(false);

  const fetchWithTimeout = async (url, opts = {}, timeout = 12000) => {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(id);
      return res;
    } catch (e) {
      clearTimeout(id);
      throw e;
    }
  };

  const callOpenAI = async (endpoint, body, timeout = 12000) => {
    const res = await fetchWithTimeout('/api/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, method: 'POST', body })
    }, timeout);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`API failed ${res.status} ${text}`);
    }
    return res;
  };

  useEffect(() => {
    requestMicrophonePermission();

    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.lang = 'ko-KR';
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;

      recognitionRef.current.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalTranscript += transcript;
          else interimTranscript += transcript;
        }

        const full = (finalTranscript || interimTranscript).trim();
        if (full) setRecognizedText(full);
      };

      recognitionRef.current.onerror = (event) => {
        console.error('Recognition error:', event.error);
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          setIsRecording(false);
          isRecordingRef.current = false;
        }
      };

      recognitionRef.current.onend = () => {
        if (isRecordingRef.current) {
          try { recognitionRef.current.start(); } catch (e) { console.error('Restart failed', e); }
        }
      };
    }

    return () => {
      if (recognitionRef.current) {
        try { isRecordingRef.current = false; recognitionRef.current.abort(); } catch (e) {}
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
    if (!recognitionRef.current || micPermission !== 'granted' || isProcessing) return;
    setIsRecording(true);
    isRecordingRef.current = true;
    setRecognizedText('');
    try { recognitionRef.current.start(); } catch (error) { console.error('Start error:', error); setIsRecording(false); isRecordingRef.current = false; }
  };

  const handleVoiceStop = (e) => {
    e.preventDefault();
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    setIsRecording(false);
    try { recognitionRef.current.stop(); } catch (e) { console.error('Stop error', e); }
    setTimeout(() => {
      if (recognizedText && recognizedText.trim()) setShowConfirmDialog(true);
    }, 300);
  };

  const handleConfirmRecognition = (isQuestion) => {
    let finalText = recognizedText;
    if (isQuestion && !finalText.includes('?')) finalText = finalText + '?';
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
      const original = userText.trim();
      const recent = messagesRef.current.slice(-3).map(m => m.type === 'user' ? `User: ${m.correctedText}` : `AI: ${m.text}` ).join('\n') || 'First message';

      const correctionPayload = {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Bạn là trợ lý kiểm tra ngữ pháp tiếng Hàn. Trả lời bằng JSON.

**CHỈ 3 THỨ ĐƯỢC PHÉP BỎ (ĐÚNG):**

1. ✅ BỎ CHỦ NGỮ:
   - "먹었어요?" = ĐÚNG (không có chủ ngữ)
   - "밥 먹었어요?" = ĐÚNG (không có chủ ngữ)

2. ✅ BỎ TRỢ TỪ (을/를, 이/가, 에, 한테, v.v.):
   - "밥 먹었어요?" = ĐÚNG (bỏ trợ từ 을)
   - "학교 갔어요" = ĐÚNG (bỏ trợ từ 에)

3. ✅ BỎ 요:
   - "먹었어" = ĐÚNG (bỏ 요)
   - "밥 먹었어" = ĐÚNG (bỏ 요)

**TẤT CẢ KHÁC = SAI:**

❌ KHÔNG ĐƯỢC bỏ đuôi động từ (trừ 요):
   - "밥 먹" = SAI (thiếu 었어)
   - "먹" = SAI (động từ chưa hoàn chỉnh)
   - "가" = SAI (động từ chưa hoàn chỉnh)

❌ Phải có gốc động từ + thì:
   - CẦN: 먹다 → 먹어, 먹었어, 먹었어요 ✅
   - SAI: chỉ có 먹 ❌

❌ Lỗi phát âm:
   - "밤 먹었어요" = SAI (phải là 밥 chứ không phải 밤)

❌ Không có vị ngữ:
   - Chỉ có "밥" = SAI
   - Chỉ có "저는" = SAI

**VÍ DỤ ĐÚNG:**
✅ "밥 먹었어요?" (bỏ chủ ngữ + 을)
✅ "밥 먹었어" (bỏ chủ ngữ + 을 + 요)
✅ "먹었어요" (bỏ chủ ngữ)
✅ "먹었어" (bỏ chủ ngữ + 요)

**VÍ DỤ SAI:**
❌ "밥 먹" (thiếu 었어)
❌ "먹" (chưa hoàn chỉnh)
❌ "가" (chưa hoàn chỉnh)
❌ "밤 먹었어요" (lỗi phát âm)

**JSON:**
{
  "isCorrect": true/false,
  "corrected": "text",
  "errorType": "incomplete|pronunciation|grammar|none",
  "explanation": "Tiếng Việt (nếu sai)"
}

**ĐỊNH DẠNG GIẢI THÍCH (nếu sai):**
🔍 Phân tích lỗi:
- Câu của bạn: "[câu gốc]"
- Vấn đề: [mô tả vấn đề bằng tiếng Việt]

❌ Tại sao sai:
[Giải thích chi tiết bằng tiếng Việt]

✅ Cách sửa:
- Câu đúng: "[câu đã sửa]"
- Giải thích: [cách sửa bằng tiếng Việt]

📝 Ví dụ:
1) [ví dụ 1 với dịch tiếng Việt]
2) [ví dụ 2 với dịch tiếng Việt]
3) [ví dụ 3 với dịch tiếng Việt]

**VÍ DỤ CỤ THỂ CHO "밥 먹":**

Input: "밥 먹"
Output: {"isCorrect": false, "corrected": "밥 먹었어", "errorType": "incomplete", "explanation": "🔍 Phân tích lỗi:\\n- Câu của bạn: '밥 먹'\\n- Vấn đề: Câu thiếu đuôi động từ, không có dấu hiệu thì (quá khứ/hiện tại)\\n\\n❌ Tại sao sai:\\nĐộng từ '먹다' (ăn) cần có đuôi để biểu thị thì. Chỉ có '먹' là chưa đủ, phải có thêm '어', '었어', hoặc '었어요' để chỉ thì.\\n\\n✅ Cách sửa:\\n- Câu đúng: '밥 먹었어'\\n- Giải thích: Thêm '었어' để chỉ thì quá khứ (đã ăn cơm)\\n\\n📝 Ví dụ:\\n1) 밥 먹었어요? (Bạn đã ăn cơm chưa? - lịch sự)\\n2) 밥 먹었어 (Ăn cơm rồi - thân mật)\\n3) 학교 갔어요 (Đã đi học rồi)"}

QUAN TRỌNG: TRẢ LỜI TOÀN BỘ BẰNG TIẾNG VIỆT. KHÔNG DÙNG TIẾNG ANH.`
          },
          {
            role: 'user',
            content: `Ngữ cảnh: ${recent}\n\nCâu cần kiểm tra: "${original}"\n\nLƯU Ý: Chỉ được bỏ: 1) chủ ngữ, 2) trợ từ, 3) 요. Động từ PHẢI hoàn chỉnh có thì.`
          }
        ],
        temperature: 0.1,
        max_tokens: 400
      };

      let correction = null;
      try {
        const corrRes = await callOpenAI('/v1/chat/completions', correctionPayload, 9000);
        const corrJson = await corrRes.json();
        const corrText = corrJson.choices?.[0]?.message?.content || '';
        const match = corrText.match(/\{[\s\S]*\}/);
        correction = match ? JSON.parse(match[0]) : { isCorrect: true, corrected: original, errorType: 'none', explanation: '' };
      } catch (e) {
        console.warn('Correction failed, assuming correct', e);
        correction = { isCorrect: true, corrected: original, errorType: 'none', explanation: '' };
      }

      const hasRealError = correction.errorType && correction.errorType !== 'none';

      const userMsg = {
        id: Date.now(),
        type: 'user',
        originalText: original,
        correctedText: correction.corrected || original,
        isCorrect: !hasRealError,
        details: hasRealError ? correction.explanation : ''
      };

      setMessages(prev => {
        const next = [...prev, userMsg];
        messagesRef.current = next;
        return next;
      });

      if (hasRealError) {
        setIsProcessing(false);
        return;
      }

      const teacherPayload = {
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Korean teacher. MUST return JSON with grammar patterns.

RESPONSE: 2-3 Korean sentences with ,,
VOCABULARY: 3-5 words from YOUR response
GRAMMAR: **MINIMUM 2 patterns REQUIRED**

Identify ALL patterns YOU use:
- Verb endings: -고 있어요, -았/었어요, -네요, -는데, -지만, -겠어요
- Particles: 을/를, 이/가, 에서, 에게, 한테
- Example: "잘 지냈어요, 만나서 반가워요" → Grammar: ["-았/었어요", "-아/어서"]

JSON:
{
  "response": "Korean with ,,",
  "vocabulary": [{"word":"word", "meaning":"Việt", "pronunciation":"roman", "example":"Korean (Việt)"}],
  "grammar": [{"pattern":"EXACT pattern", "explanation":"Chức năng: Việt", "usage":"Khi dùng: Việt", "examples":["Ex1 (Việt)","Ex2 (Việt)","Ex3 (Việt)"]}]
}

CRITICAL: Grammar MUST have 2+ items. Extract ONLY from YOUR response.`
          },
          ...messagesRef.current.slice(-6).map(m => ({ role: m.type === 'user' ? 'user' : 'assistant', content: m.type === 'user' ? m.correctedText : m.text })),
          { role: 'user', content: userMsg.correctedText }
        ],
        temperature: 0.7,
        max_tokens: 1200,
        response_format: { type: 'json_object' }
      };

      let aiResult = null;
      try {
        const aiRes = await callOpenAI('/v1/chat/completions', teacherPayload, 14000);
        const aiJson = await aiRes.json();
        let aiText = aiJson.choices?.[0]?.message?.content || '';
        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          aiResult = JSON.parse(jsonMatch[0]);
        } else {
          const koreanTextMatch = aiText.match(/[가-힣\s\.,!\?]+/g);
          const cleaned = koreanTextMatch ? koreanTextMatch.join(' ').trim() : '죄송합니다.';
          aiResult = { response: cleaned, vocabulary: [], grammar: [] };
        }
      } catch (e) {
        console.error('Teacher failed', e);
        aiResult = { response: '죄송합니다. 다시 말씀해 주세요.', vocabulary: [], grammar: [] };
      }

      const aiMsg = {
        id: Date.now() + 1,
        type: 'ai',
        text: aiResult.response || '죄송합니다.',
        displayText: (aiResult.response || '').replace(/,,/g, ',').replace(/\.\./g, '.'),
        vocabulary: aiResult.vocabulary || [],
        grammar: aiResult.grammar || [],
        audioUrl: null
      };

      setMessages(prev => {
        const next = [...prev, aiMsg];
        messagesRef.current = next;
        return next;
      });

      playTTS(aiMsg.id, aiMsg.text).catch(() => {});

    } catch (error) {
      console.error('Error', error);
      alert(`Lỗi: ${error.message || error}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const playTTS = async (messageId, text) => {
    try {
      setCurrentAudioPlaying(messageId);
      const ttsResponse = await callOpenAI('/v1/audio/speech', {
        model: 'tts-1', input: text, voice: settings.voiceGender === 'female' ? 'nova' : 'onyx', speed: settings.ttsSpeed
      }, 12000);
      const audioBlob = await ttsResponse.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      setMessages(prev => prev.map(msg => msg.id === messageId ? { ...msg, audioUrl } : msg));
      const audio = new Audio(audioUrl);
      audio.onended = () => setCurrentAudioPlaying(null);
      await audio.play();
    } catch (error) {
      console.warn('TTS failed', error);
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

  const toggleDetails = (id) => setExpandedDetails(prev => ({ ...prev, [id]: !prev[id] }));
  const adjustSpeed = (delta) => setSettings(prev => ({ ...prev, ttsSpeed: Math.max(0.5, Math.min(1.5, prev.ttsSpeed + delta)) }));

  return (
    <div className="korean-app">
      <header className="app-header">
        <div className="logo"><span className="korean-flag">🇰🇷</span><h1 style={{fontSize: '20px', margin: 0}}>한국어 학습</h1></div>
        <button onClick={() => setShowSettings(!showSettings)} style={{background: 'none', border: 'none', color: 'white', fontSize: '24px', cursor: 'pointer'}}>⚙️</button>
      </header>

      {showSettings && (
        <div style={{background: 'white', padding: '20px', margin: '10px', borderRadius: '10px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)'}}>
          <h3 style={{margin: '0 0 20px 0'}}>Cài đặt</h3>
          <div style={{marginBottom: '20px'}}>
            <label style={{display: 'block', marginBottom: '8px', fontWeight: 'bold'}}>Giọng AI:</label>
            <select value={settings.voiceGender} onChange={(e) => setSettings({...settings, voiceGender: e.target.value})} style={{padding: '10px', borderRadius: '8px', width: '100%', fontSize: '15px', border: '1px solid #ddd'}}>
              <option value="female">여성 (Nữ)</option>
              <option value="male">남성 (Nam)</option>
            </select>
          </div>
          <div>
            <label style={{display: 'block', marginBottom: '8px', fontWeight: 'bold'}}>Tốc độ đọc: {settings.ttsSpeed.toFixed(1)}x</label>
            <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
              <button onClick={() => adjustSpeed(-0.1)} disabled={settings.ttsSpeed <= 0.5} style={{padding: '10px 20px', background: settings.ttsSpeed <= 0.5 ? '#ccc' : '#f44336', color: 'white', border: 'none', borderRadius: '8px', cursor: settings.ttsSpeed <= 0.5 ? 'not-allowed' : 'pointer', fontSize: '18px', fontWeight: 'bold'}}>−</button>
              <div style={{flex: 1, background: '#f5f5f5', padding: '15px', borderRadius: '8px', textAlign: 'center'}}>
                <div style={{fontSize: '24px', fontWeight: 'bold', color: '#2196f3'}}>{settings.ttsSpeed.toFixed(1)}x</div>
                <div style={{fontSize: '12px', color: '#666', marginTop: '4px'}}>{settings.ttsSpeed < 0.7 ? 'Rất chậm' : settings.ttsSpeed < 0.9 ? 'Chậm' : settings.ttsSpeed < 1.1 ? 'Bình thường' : settings.ttsSpeed < 1.3 ? 'Nhanh' : 'Rất nhanh'}</div>
              </div>
              <button onClick={() => adjustSpeed(0.1)} disabled={settings.ttsSpeed >= 1.5} style={{padding: '10px 20px', background: settings.ttsSpeed >= 1.5 ? '#ccc' : '#4caf50', color: 'white', border: 'none', borderRadius: '8px', cursor: settings.ttsSpeed >= 1.5 ? 'not-allowed' : 'pointer', fontSize: '18px', fontWeight: 'bold'}}>+</button>
            </div>
            <div style={{marginTop: '8px', fontSize: '13px', color: '#666', textAlign: 'center'}}>0.5x (chậm nhất) → 1.5x (nhanh nhất)</div>
          </div>
          <button onClick={() => setShowSettings(false)} style={{marginTop: '20px', padding: '12px 20px', background: '#2196f3', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', width: '100%', fontSize: '16px', fontWeight: 'bold'}}>✓ Đóng</button>
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
              <button onClick={() => handleConfirmRecognition(true)} style={{flex: 1, padding: '12px', background: '#2196f3', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer'}}>❓ Câu hỏi</button>
              <button onClick={() => handleConfirmRecognition(false)} style={{flex: 1, padding: '12px', background: '#4caf50', color: 'white', border: 'none', borderRadius: '8px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer'}}>💬 Câu nói</button>
            </div>
            <button onClick={() => {setShowConfirmDialog(false); setRecognizedText('');}} style={{width: '100%', marginTop: '10px', padding: '10px', background: '#f44336', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer'}}>❌ Hủy</button>
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
                  <div style={{textDecoration: 'line-through', color: '#f44336', marginBottom: '8px', fontSize: '15px'}}>{msg.originalText}</div>
                )}
                <div style={{color: msg.isCorrect ? '#1976d2' : '#e91e63', fontWeight: 'bold', fontSize: '16px', marginBottom: msg.isCorrect ? 0 : '10px'}}>
                  {msg.correctedText}{msg.isCorrect && <span style={{marginLeft: '6px', fontSize: '14px'}}>✓</span>}
                </div>
                {!msg.isCorrect && msg.details && (
                  <button onClick={() => toggleDetails(msg.id)} style={{marginTop: '8px', padding: '8px 16px', background: expandedDetails[msg.id] ? '#ff9800' : '#2196f3', color: 'white', border: 'none', borderRadius: '20px', cursor: 'pointer', fontSize: '13px', width: '100%'}}>{expandedDetails[msg.id] ? '🔼 Ẩn giải thích' : '📝 Xem giải thích chi tiết'}</button>
                )}
                {!msg.isCorrect && expandedDetails[msg.id] && msg.details && (
                  <div style={{marginTop: '12px', fontSize: '14px', color: '#333', background: 'white', padding: '12px', borderRadius: '8px', lineHeight: '1.6', whiteSpace: 'pre-wrap'}}>{msg.details}</div>
                )}
              </div>
            ) : (
              <div style={{background: '#f5f5f5', padding: '15px', borderRadius: '15px', display: 'inline-block', maxWidth: '85%'}}>
                <div style={{fontSize: '16px', fontWeight: '500', marginBottom: '10px'}}>{msg.displayText || msg.text}</div>
                <div style={{display: 'flex', gap: '8px', marginTop: '12px'}}>
                  <button onClick={() => replayAudio(msg)} disabled={currentAudioPlaying === msg.id} style={{flex: 1, background: currentAudioPlaying === msg.id ? '#999' : '#2196f3', color: 'white', border: 'none', borderRadius: '20px', padding: '10px', cursor: 'pointer', fontSize: '14px'}}>{currentAudioPlaying === msg.id ? '▶️' : '🔊'} Nghe lại</button>
                  <button onClick={() => toggleDetails(msg.id)} style={{flex: 1, background: expandedDetails[msg.id] ? '#ff9800' : '#4caf50', color: 'white', border: 'none', borderRadius: '20px', padding: '10px', cursor: 'pointer', fontSize: '14px'}}>{expandedDetails[msg.id] ? '🔼' : '📚'} Chi tiết</button>
                </div>

                {expandedDetails[msg.id] && (msg.vocabulary?.length > 0 || msg.grammar?.length > 0) && (
                  <div style={{marginTop: '15px', background: 'white', padding: '15px', borderRadius: '10px'}}>
                    {msg.vocabulary && msg.vocabulary.length > 0 && (
                      <div style={{marginBottom: msg.grammar?.length > 0 ? '15px' : 0}}>
                        <h5 style={{color: '#2196f3', margin: '0 0 10px 0', fontSize: '16px'}}>📖 Từ vựng</h5>
                        <div style={{background: '#f0f8ff', padding: '12px', borderRadius: '8px', borderLeft: '3px solid #2196f3'}}>
                          {msg.vocabulary.map((v, i) => (
                            <div key={i} style={{marginBottom: i < msg.vocabulary.length - 1 ? '12px' : 0, paddingBottom: i < msg.vocabulary.length - 1 ? '12px' : 0, borderBottom: i < msg.vocabulary.length - 1 ? '1px solid #e0e0e0' : 'none'}}>
                              <p style={{margin: 0, fontSize: '15px'}}><strong style={{color: '#1976d2'}}>{v.word}</strong>{v.pronunciation && <span style={{color: '#666', fontStyle: 'italic', marginLeft: '8px', fontSize: '13px'}}>[{v.pronunciation}]</span>}</p>
                              <p style={{margin: '4px 0 0 0', fontSize: '14px', color: '#555'}}>💡 Nghĩa: {v.meaning}</p>
                              {v.example && <p style={{margin: '6px 0 0 0', fontSize: '13px', color: '#777', fontStyle: 'italic', paddingLeft: '10px', borderLeft: '2px solid #2196f3'}}>📝 {v.example}</p>}
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
                <div className="typing-indicator"><span></span><span></span><span></span></div>
                <span style={{fontSize: '14px', color: '#666'}}>AI đang suy nghĩ...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{position: 'fixed', bottom: 0, left: 0, right: 0, background: 'white', padding: '12px', boxShadow: '0 -2px 10px rgba(0,0,0,0.1)', zIndex: 1000}}>
        <form onSubmit={handleTextSubmit} style={{marginBottom: '10px'}}>
          <div style={{display: 'flex', gap: '10px'}}>
            <input type="text" value={textInput} onChange={(e) => setTextInput(e.target.value)} placeholder="Nhập câu tiếng Hàn..." disabled={isProcessing || isRecording} style={{flex: 1, padding: '14px', fontSize: '16px', border: '2px solid #2196f3', borderRadius: '25px', outline: 'none'}} />
            <button type="submit" disabled={isProcessing || !textInput.trim() || isRecording} style={{width: '56px', height: '56px', background: isProcessing || !textInput.trim() ? '#ccc' : '#2196f3', color: 'white', border: 'none', borderRadius: '50%', cursor: isProcessing || !textInput.trim() ? 'not-allowed' : 'pointer', fontSize: '24px'}}>{isProcessing ? '⏳' : '➤'}</button>
          </div>
        </form>

        {micPermission === 'granted' && (
          <button onMouseDown={handleVoiceStart} onMouseUp={handleVoiceStop} onMouseLeave={handleVoiceStop} onTouchStart={handleVoiceStart} onTouchEnd={handleVoiceStop} onContextMenu={(e) => e.preventDefault()} disabled={isProcessing} style={{width: '100%', padding: '15px', background: isRecording ? '#f44336' : '#4caf50', color: 'white', border: 'none', borderRadius: '25px', cursor: isProcessing ? 'not-allowed' : 'pointer', fontSize: '16px', fontWeight: 'bold', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none', transition: 'all 0.2s'}}>{isRecording ? '🔴 Thả ra để gửi...' : '🎤 Nhấn giữ để nói'}</button>
        )}
      </div>
    </div>
  );
};

export default KoreanLearningApp;
