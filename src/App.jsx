import React, { useState, useEffect, useRef } from "react";
import "./App.css";

/**
 * KoreanLearningApp.jsx
 * - Full component ready to paste into your React app
 * - Keeps all original features (recording, speech recognition, TTS, messages)
 * - Ensures AI responses include BOTH vocabulary and grammar (with Vietnamese explanations + examples)
 * - Displays vocabulary + grammar in a single combined details panel under each AI message
 *
 * Backend expectations:
 * - POST /api/openai with body { endpoint, method, body } (your proxy)
 * - TTS endpoint: /v1/audio/speech proxied via /api/openai
 *
 * Notes:
 * - Robust JSON extraction from model responses
 * - Local heuristics to catch clearly incomplete inputs (single nouns, bare pronouns)
 * - Uses AbortController timeouts to avoid hanging requests
 */

const KoreanLearningApp = () => {
  // --- State ---
  const [messages, setMessages] = useState([]); // chat messages
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const [isRecording, setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);
  const recognitionRef = useRef(null);
  const [micPermission, setMicPermission] = useState(null);

  const [textInput, setTextInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [recognizedText, setRecognizedText] = useState("");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const [expandedDetails, setExpandedDetails] = useState({});
  const [currentAudioPlaying, setCurrentAudioPlaying] = useState(null);

  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({ voiceGender: "female", ttsSpeed: 0.9 });

  // --- Helpers: fetch with timeout and wrapper for OpenAI proxy ---
  const fetchWithTimeout = async (url, opts = {}, timeout = 15000) => {
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

  const callOpenAI = async (endpoint, body, timeout = 15000) => {
    // endpoint: e.g., '/v1/chat/completions' or '/v1/audio/speech'
    const res = await fetchWithTimeout("/api/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint, method: "POST", body }),
    }, timeout);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`API failed: ${res.status} ${txt}`);
    }
    return res;
  };

  // --- Speech recognition setup ---
  useEffect(() => {
    requestMicrophonePermission();

    if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.lang = "ko-KR";
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;

      recognitionRef.current.onresult = (event) => {
        let finalTranscript = "";
        let interimTranscript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalTranscript += t;
          else interimTranscript += t;
        }
        const full = (finalTranscript || interimTranscript).trim();
        if (full) setRecognizedText(full);
      };

      recognitionRef.current.onerror = (e) => {
        console.error("Recognition error:", e.error || e);
        if (e.error !== "no-speech" && e.error !== "aborted") {
          setIsRecording(false);
          isRecordingRef.current = false;
        }
      };

      recognitionRef.current.onend = () => {
        if (isRecordingRef.current) {
          try { recognitionRef.current.start(); } catch (e) { console.error("restart error", e); }
        }
      };
    }

    return () => {
      if (recognitionRef.current) {
        try { isRecordingRef.current = false; recognitionRef.current.abort(); } catch (e) {}
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestMicrophonePermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicPermission("granted");
    } catch (e) {
      setMicPermission("denied");
    }
  };

  // --- Voice handlers ---
  const handleVoiceStart = (e) => {
    e.preventDefault();
    if (!recognitionRef.current || micPermission !== "granted" || isProcessing) return;
    setIsRecording(true);
    isRecordingRef.current = true;
    setRecognizedText("");
    try { recognitionRef.current.start(); } catch (err) { console.error("start error", err); setIsRecording(false); isRecordingRef.current = false; }
  };

  const handleVoiceStop = (e) => {
    e.preventDefault();
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    setIsRecording(false);
    try { recognitionRef.current.stop(); } catch (err) { console.error("stop error", err); }
    setTimeout(() => {
      if (recognizedText && recognizedText.trim()) setShowConfirmDialog(true);
    }, 200);
  };

  const handleConfirmRecognition = (isQuestion) => {
    let finalText = recognizedText;
    if (isQuestion && !finalText.includes("?")) finalText = finalText + "?";
    setShowConfirmDialog(false);
    setRecognizedText("");
    processUserInput(finalText);
  };

  // --- Local heuristic: detect obvious incomplete sentences ---
  const isLikelyIncomplete = (text) => {
    if (!text) return true;
    const cleaned = text.replace(/[!?。！？]/g, "").trim();
    const tokens = cleaned.split(/\s+/);
    if (tokens.length === 1) {
      const onlyHangul = /^[가-힣]+$/.test(tokens[0]);
      if (onlyHangul) {
        // predicate markers that indicate complete predicate
        const predicateRE = /(요|요\?|다$|습니다|았|었|아요|어요|나요|죠|지요|겠다|자$|세요|습니까|니까|겠어요)/;
        if (!predicateRE.test(tokens[0])) return true;
      }
    }
    const hasPronoun = /(저|나는|저는|우리는|우린|제가)\b/.test(text);
    const hasPredicate = /(다\b|요\b|어요|아요|습니다|았|었|겠다|지요|죠|나요|세요|습니까|니까)/.test(text);
    if (hasPronoun && !hasPredicate) return true;
    if (!hasPredicate && tokens.length <= 4) return true;
    return false;
  };

  // --- Local fallback correction for obvious cases ---
  const fallbackLocalCorrection = (text) => {
    const cleaned = text.replace(/[!?。！？]/g, "").trim();
    const tokens = cleaned.split(/\s+/);
    if (tokens.length === 1 && /^[가-힣]+$/.test(tokens[0])) {
      const corrected = `${tokens[0]}을/를 먹었어요?`;
      const details =
`🔍 Phân tích lỗi:
- Câu của bạn: "${text}"
- Vấn đề: Câu chỉ có danh từ, thiếu vị ngữ (động từ/adj).

❌ Tại sao sai:
Cần có vị ngữ để câu hoàn chỉnh.

✅ Cách sửa:
- Câu đúng: "${corrected}"
- Giải thích: Thêm động từ/động từ tường minh để câu có nghĩa.

📝 Ví dụ:
1) 밥 → 밥을 먹었어요? (Bạn đã ăn cơm chưa?)
2) 한국어 → 한국어를 공부했어요. (Tôi đã học tiếng Hàn.)
`;
      return { corrected, details };
    }

    if (/(저|나는|저는|제가)\b/.test(text) && !/(다\b|요\b|어요|아요|습니다)/.test(text)) {
      const corrected = `${text} 먹었어요?`;
      const details =
`🔍 Phân tích lỗi:
- Câu của bạn: "${text}"
- Vấn đề: Có đại từ chủ ngữ nhưng thiếu vị ngữ.

❌ Tại sao sai:
Chủ ngữ tồn tại nhưng bạn không cung cấp hành động hay trạng thái.

✅ Cách sửa:
- Câu đúng: "${corrected}"
- Giải thích: Thêm động từ theo ngữ cảnh để câu hoàn chỉnh.
`;
      return { corrected, details };
    }

    return { corrected: text, details: "" };
  };

  // --- Filter returned vocab & grammar so only items actually present in AI response remain ---
  const filterVocabGrammar = (responseText = "", vocab = [], grammar = []) => {
    const text = (responseText || "").replace(/[,\.\?!]/g, " ");
    const presentWords = new Set(text.split(/\s+/).filter(Boolean));

    const filteredVocab = (vocab || []).filter((v) => {
      const word = typeof v === "string" ? v : v.word;
      if (!word) return false;
      // exact or substring match
      return Array.from(presentWords).some((w) => w === word || w.includes(word) || word.includes(w));
    }).map((v) => v);

    const filteredGrammar = (grammar || []).filter((g) => {
      const pattern = typeof g === "string" ? g : (g.pattern || g.structure || "");
      if (!pattern) return false;
      // check if pattern or its core token exists in the response
      const normalized = pattern.replace(/\s+/g, "");
      return responseText.includes(pattern) || responseText.includes(normalized);
    }).map((g) => g);

    return { filteredVocab, filteredGrammar };
  };

  // --- Core processing: correct -> request teacher response (vocab + grammar) ---
  const processUserInput = async (userText) => {
    setIsProcessing(true);
    try {
      const original = userText.trim();

      // Local quick heuristic
      if (isLikelyIncomplete(original)) {
        const suggested = fallbackLocalCorrection(original);
        const userMsg = {
          id: Date.now(),
          type: "user",
          originalText: original,
          correctedText: suggested.corrected,
          isCorrect: false,
          details: suggested.details,
        };
        setMessages((prev) => {
          const next = [...prev, userMsg];
          messagesRef.current = next;
          return next;
        });
        setIsProcessing(false);
        return;
      }

      // Build recent context (avoid stale state)
      const recentContext = messagesRef.current.slice(-6).map((m) => m.type === "user" ? `User: ${m.correctedText}` : `AI: ${m.text || m.content}`).join("\n") || "First message";

      // 1) Correction call (compact)
      const correctionPayload = {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
`You are a Korean grammar checker. Subject omission is allowed in Korean and should NOT be marked as error.
Return EXACT JSON only: {"isCorrect": true/false, "corrected": "...", "errorType": "incomplete|grammar|none", "explanation": "Vietnamese explanation ONLY if error" }.
If sentence is complete, errorType should be "none". Keep JSON minimal.`
          },
          { role: "user", content: `Context: ${recentContext}\nAnalyze: "${original}"` }
        ],
        temperature: 0.03
      };

      let correction = { isCorrect: true, corrected: original, errorType: "none", explanation: "" };
      try {
        const corrRes = await callOpenAI("/v1/chat/completions", correctionPayload, 9000);
        const corrJson = await corrRes.json();
        const corrText = corrJson.choices?.[0]?.message?.content || "";
        const match = corrText.match(/\{[\s\S]*\}/);
        if (match) correction = JSON.parse(match[0]);
      } catch (e) {
        console.warn("correction failed, assume correct", e);
        correction = { isCorrect: true, corrected: original, errorType: "none", explanation: "" };
      }

      const hasRealError = correction.errorType && correction.errorType !== "none";

      const userMsg = {
        id: Date.now(),
        type: "user",
        originalText: original,
        correctedText: correction.corrected || original,
        isCorrect: !hasRealError,
        details: hasRealError ? correction.explanation : "",
      };

      // append user message
      setMessages((prev) => {
        const next = [...prev, userMsg];
        messagesRef.current = next;
        return next;
      });

      if (hasRealError) {
        setIsProcessing(false);
        return;
      }

      // 2) Teacher generation: enforce JSON with vocabulary and grammar
      const teacherSystemPrompt =
`You are a helpful, precise Korean teacher. For the user's (correct) sentence, return EXACT JSON with three keys:
{
  "response": "Korean reply (2-3 short sentences). Must include \",,\" as separator between sentences.",
  "vocabulary": [
    {"word":"...","meaning":"Vietnamese meaning","pronunciation":"romanization (optional)","example":"Korean example - Vietnamese translation"}
  ],
  "grammar": [
    {"structure":"...","meaning":"Vietnamese meaning","usage":"short note when to use","example":"Korean example - Vietnamese translation"}
  ]
}

CRITICAL RULES:
- Include ONLY words and grammar structures that actually APPEAR in the "response" field.
- For grammar, include tail endings, particles, connectors, or multi-word patterns present in the response (e.g., \"-고 있어요\", \"-는데\", \"-려고 하다\", particle \"-는/은/이/가\", etc.).
- Provide meaningful Vietnamese explanations and one Korean example with Vietnamese translation for each grammar item.
- Return valid JSON only (no extra commentary).`;

      const teacherPayload = {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: teacherSystemPrompt },
          ...messagesRef.current.slice(-6).map((m) => ({ role: m.type === "user" ? "user" : "assistant", content: m.type === "user" ? m.correctedText : (m.text || m.content) })),
          { role: "user", content: userMsg.correctedText }
        ],
        temperature: 0.6,
        response_format: { type: "json_object" }
      };

      let aiResult = { response: "죄송합니다.", vocabulary: [], grammar: [] };
      try {
        const aiRes = await callOpenAI("/v1/chat/completions", teacherPayload, 14000);
        const aiJson = await aiRes.json();
        let aiText = aiJson.choices?.[0]?.message?.content || "";
        // extract JSON object
        const jsonMatch = aiText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          aiResult = JSON.parse(jsonMatch[0]);
        } else {
          // fallback: extract korean text and set empty lists
          const koreanTextMatch = aiText.match(/[가-힣\s\.,!?.]+/g);
          const cleaned = koreanTextMatch ? koreanTextMatch.join(" ").trim() : "죄송합니다.";
          aiResult = { response: cleaned, vocabulary: [], grammar: [] };
        }
      } catch (e) {
        console.error("teacher call failed", e);
        aiResult = { response: "죄송합니다. 다시 말씀해 주세요.", vocabulary: [], grammar: [] };
      }

      // Filter vocab/grammar to only keep items actually present in response
      const { filteredVocab, filteredGrammar } = filterVocabGrammar(aiResult.response || "", aiResult.vocabulary || [], aiResult.grammar || []);

      const aiMsg = {
        id: Date.now() + 1,
        type: "ai",
        text: aiResult.response || "죄송합니다.",
        displayText: (aiResult.response || "").replace(/,,/g, ",").replace(/\.\./g, "."),
        vocabulary: filteredVocab,
        grammar: filteredGrammar,
        audioUrl: null
      };

      // append AI message
      setMessages((prev) => {
        const next = [...prev, aiMsg];
        messagesRef.current = next;
        return next;
      });

      // play TTS asynchronously (do not block)
      playTTS(aiMsg.id, aiMsg.text).catch(() => {});

    } catch (err) {
      console.error("processUserInput error", err);
      alert(`Lỗi: ${err.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // --- TTS ---
  const playTTS = async (messageId, text) => {
    try {
      setCurrentAudioPlaying(messageId);
      const ttsRes = await callOpenAI("/v1/audio/speech", {
        model: "tts-1",
        input: text,
        voice: settings.voiceGender === "female" ? "nova" : "onyx",
        speed: settings.ttsSpeed
      }, 20000);
      const audioBlob = await ttsRes.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, audioUrl } : m));
      const audio = new Audio(audioUrl);
      audio.onended = () => setCurrentAudioPlaying(null);
      await audio.play();
    } catch (e) {
      console.warn("TTS failed", e);
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

  // --- UI helpers ---
  const toggleDetails = (id) => setExpandedDetails((p) => ({ ...p, [id]: !p[id] }));
  const adjustSpeed = (delta) => setSettings((p) => ({ ...p, ttsSpeed: Math.max(0.5, Math.min(1.5, +(p.ttsSpeed + delta).toFixed(1))) }));

  // --- Submit text form ---
  const handleTextSubmit = (e) => {
    e.preventDefault();
    if (!textInput.trim() || isProcessing) return;
    processUserInput(textInput.trim());
    setTextInput("");
  };

  // --- Rendering ---
  return (
    <div className="korean-app">
      <header className="app-header">
        <div className="logo">
          <span className="korean-flag">🇰🇷</span>
          <h1 style={{ fontSize: 20, margin: 0 }}>한국어 학습</h1>
        </div>
        <button onClick={() => setShowSettings((s) => !s)} style={{ background: "none", border: "none", color: "white", fontSize: 22, cursor: "pointer" }}>⚙️</button>
      </header>

      {showSettings && (
        <div style={{ background: "white", padding: 18, margin: 10, borderRadius: 10, boxShadow: "0 2px 10px rgba(0,0,0,0.1)" }}>
          <h3 style={{ margin: "0 0 12px 0" }}>Cài đặt</h3>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", marginBottom: 8, fontWeight: "bold" }}>Giọng AI:</label>
            <select value={settings.voiceGender} onChange={(e) => setSettings({ ...settings, voiceGender: e.target.value })} style={{ padding: 10, borderRadius: 8, width: "100%", fontSize: 15, border: "1px solid #ddd" }}>
              <option value="female">여성 (Nữ)</option>
              <option value="male">남성 (Nam)</option>
            </select>
          </div>
          <div>
            <label style={{ display: "block", marginBottom: 8, fontWeight: "bold" }}>Tốc độ đọc: {settings.ttsSpeed.toFixed(1)}x</label>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button onClick={() => adjustSpeed(-0.1)} disabled={settings.ttsSpeed <= 0.5} style={{ padding: "10px 16px", background: settings.ttsSpeed <= 0.5 ? "#ccc" : "#f44336", color: "white", border: "none", borderRadius: 8, cursor: settings.ttsSpeed <= 0.5 ? "not-allowed" : "pointer" }}>−</button>
              <div style={{ flex: 1, background: "#f5f5f5", padding: 12, borderRadius: 8, textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: "bold", color: "#2196f3" }}>{settings.ttsSpeed.toFixed(1)}x</div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>{settings.ttsSpeed < 0.7 ? "Rất chậm" : settings.ttsSpeed < 0.9 ? "Chậm" : settings.ttsSpeed < 1.1 ? "Bình thường" : settings.ttsSpeed < 1.3 ? "Nhanh" : "Rất nhanh"}</div>
              </div>
              <button onClick={() => adjustSpeed(0.1)} disabled={settings.ttsSpeed >= 1.5} style={{ padding: "10px 16px", background: settings.ttsSpeed >= 1.5 ? "#ccc" : "#4caf50", color: "white", border: "none", borderRadius: 8 }}>+</button>
            </div>
          </div>
          <button onClick={() => setShowSettings(false)} style={{ marginTop: 14, padding: "10px 16px", background: "#2196f3", color: "#fff", border: "none", borderRadius: 8, width: "100%" }}>✓ Đóng</button>
        </div>
      )}

      {showConfirmDialog && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }}>
          <div style={{ width: "95%", maxWidth: 420, background: "white", padding: 18, borderRadius: 12 }}>
            <h3 style={{ margin: "0 0 10px 0" }}>Xác nhận giọng nói</h3>
            <div style={{ background: "#f5f5f5", padding: 12, borderRadius: 8, marginBottom: 10 }}>
              <p style={{ margin: 0, fontSize: 18, fontWeight: "bold", color: "#1976d2" }}>{recognizedText}</p>
            </div>
            <p style={{ marginTop: 0, marginBottom: 12, color: "#666" }}>Đây là câu hỏi hay câu trần thuật?</p>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => handleConfirmRecognition(true)} style={{ flex: 1, padding: 12, background: "#2196f3", color: "#fff", border: "none", borderRadius: 8 }}>❓ Câu hỏi</button>
              <button onClick={() => handleConfirmRecognition(false)} style={{ flex: 1, padding: 12, background: "#4caf50", color: "#fff", border: "none", borderRadius: 8 }}>💬 Câu nói</button>
            </div>
            <button onClick={() => { setShowConfirmDialog(false); setRecognizedText(""); }} style={{ marginTop: 10, width: "100%", padding: 10, background: "#f44336", color: "#fff", border: "none", borderRadius: 8 }}>❌ Hủy</button>
          </div>
        </div>
      )}

      <div className="chat-container" style={{ paddingBottom: 160 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: 22 }}>
            <h2 style={{ fontSize: 24, marginBottom: 8 }}>환영합니다!</h2>
            <p style={{ color: "#666", margin: 0 }}>Nhập câu tiếng Hàn bên dưới</p>
            <p style={{ color: "#999", marginTop: 8 }}>💡 VD: 안녕하세요, 우리는 잘 지내고 있어요?</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id || Math.random()} style={{ marginBottom: 14, width: "100%", display: "flex", justifyContent: msg.type === "user" ? "flex-end" : "flex-start" }}>
            {msg.type === "user" ? (
              <div style={{ background: msg.isCorrect ? "#e3f2fd" : "#ffebee", padding: 14, borderRadius: 14, maxWidth: "85%" }}>
                {!msg.isCorrect && <div style={{ textDecoration: "line-through", color: "#f44336", marginBottom: 8 }}>{msg.originalText}</div>}
                <div style={{ fontWeight: "bold", color: msg.isCorrect ? "#1976d2" : "#e91e63", fontSize: 16 }}>{msg.correctedText}{msg.isCorrect && <span style={{ marginLeft: 8, fontSize: 14 }}>✓</span>}</div>
                {!msg.isCorrect && msg.details && (
                  <>
                    <button onClick={() => toggleDetails(msg.id)} style={{ marginTop: 8, width: "100%", padding: "8px 12px", borderRadius: 20, background: expandedDetails[msg.id] ? "#ff9800" : "#2196f3", color: "#fff", border: "none" }}>
                      {expandedDetails[msg.id] ? "🔼 Ẩn giải thích" : "📝 Xem giải thích chi tiết"}
                    </button>
                    {expandedDetails[msg.id] && <div style={{ marginTop: 12, background: "#fff", padding: 12, borderRadius: 8, whiteSpace: "pre-wrap", color: "#333" }}>{msg.details}</div>}
                  </>
                )}
              </div>
            ) : (
              <div style={{ background: "#f5f5f5", padding: 14, borderRadius: 14, maxWidth: "85%" }}>
                <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 10 }}>{msg.displayText || msg.text || msg.content}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => replayAudio(msg)} disabled={currentAudioPlaying === msg.id} style={{ flex: 1, padding: 10, borderRadius: 20, border: "none", background: currentAudioPlaying === msg.id ? "#999" : "#2196f3", color: "#fff", cursor: "pointer" }}>
                    {currentAudioPlaying === msg.id ? "▶️" : "🔊"} Nghe lại
                  </button>
                  <button onClick={() => toggleDetails(msg.id)} style={{ flex: 1, padding: 10, borderRadius: 20, border: "none", background: expandedDetails[msg.id] ? "#ff9800" : "#4caf50", color: "#fff", cursor: "pointer" }}>
                    {expandedDetails[msg.id] ? "🔼" : "📚"} Chi tiết
                  </button>
                </div>

                {/* Combined details panel: Vocabulary + Grammar */}
                {expandedDetails[msg.id] && ((msg.vocabulary && msg.vocabulary.length > 0) || (msg.grammar && msg.grammar.length > 0)) && (
                  <div style={{ marginTop: 12, background: "#fff", padding: 12, borderRadius: 10 }}>
                    {/* Vocabulary */}
                    {msg.vocabulary && msg.vocabulary.length > 0 && (
                      <div style={{ marginBottom: (msg.grammar && msg.grammar.length > 0) ? 12 : 0 }}>
                        <h5 style={{ margin: "0 0 8px 0", color: "#1976d2" }}>📘 Từ vựng</h5>
                        <div style={{ background: "#f0f8ff", padding: 12, borderRadius: 8 }}>
                          {msg.vocabulary.map((v, i) => (
                            <div key={i} style={{ padding: i < msg.vocabulary.length - 1 ? "0 0 12px 0" : "0", borderBottom: i < msg.vocabulary.length - 1 ? "1px solid #e6eefc" : "none" }}>
                              {typeof v === "string" ? (
                                <p style={{ margin: 0 }}>{v}</p>
                              ) : (
                                <>
                                  <p style={{ margin: 0, fontSize: 15 }}><strong style={{ color: "#1976d2" }}>{v.word}</strong>{v.pronunciation ? <span style={{ marginLeft: 8, color: "#666", fontStyle: "italic" }}>[{v.pronunciation}]</span> : null}</p>
                                  <p style={{ margin: "6px 0 0 0", color: "#444" }}>💡 Nghĩa: {v.meaning}</p>
                                  {v.example && <p style={{ margin: "8px 0 0 0", fontStyle: "italic", color: "#666", paddingLeft: 8, borderLeft: "3px solid #dfefff" }}>📝 {v.example}</p>}
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Grammar */}
                    {msg.grammar && msg.grammar.length > 0 && (
                      <div>
                        <h5 style={{ margin: "0 0 8px 0", color: "#ff9800" }}>⚙️ Ngữ pháp</h5>
                        <div style={{ background: "#fff7ea", padding: 12, borderRadius: 8 }}>
                          {msg.grammar.map((g, idx) => (
                            <div key={idx} style={{ padding: idx < msg.grammar.length - 1 ? "0 0 12px 0" : "0", borderBottom: idx < msg.grammar.length - 1 ? "1px solid #fff0db" : "none" }}>
                              {typeof g === "string" ? (
                                <p style={{ margin: 0 }}>{g}</p>
                              ) : (
                                <>
                                  <p style={{ margin: 0, fontWeight: "bold", color: "#e65100" }}>{g.structure || g.pattern}</p>
                                  <p style={{ margin: "6px 0 0 0" }}><strong>📚 Nghĩa:</strong> {g.meaning}</p>
                                  {g.usage && <p style={{ margin: "6px 0 0 0", color: "#666" }}><strong>💡 Cách dùng:</strong> {g.usage}</p>}
                                  {g.example && <p style={{ margin: "8px 0 0 0", fontStyle: "italic", color: "#555", paddingLeft: 8, borderLeft: "3px solid #ffe9c9" }}>📝 {g.example}</p>}
                                </>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {isProcessing && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ background: "#f5f5f5", padding: 12, borderRadius: 12, display: "inline-block" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div className="typing-indicator"><span></span><span></span><span></span></div>
                <span style={{ color: "#666" }}>AI đang suy nghĩ...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom input area */}
      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", padding: 12, boxShadow: "0 -2px 10px rgba(0,0,0,0.08)", zIndex: 1000 }}>
        <form onSubmit={handleTextSubmit} style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <input
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Nhập câu tiếng Hàn..."
              disabled={isProcessing || isRecording}
              style={{ flex: 1, padding: 12, fontSize: 16, border: "2px solid #2196f3", borderRadius: 25, outline: "none" }}
            />
            <button type="submit" disabled={isProcessing || !textInput.trim() || isRecording} style={{ width: 56, height: 56, borderRadius: "50%", border: "none", background: isProcessing || !textInput.trim() ? "#ccc" : "#2196f3", color: "#fff", fontSize: 22 }}>
              {isProcessing ? "⏳" : "➤"}
            </button>
          </div>
        </form>

        {micPermission === "granted" && (
          <button
            onMouseDown={handleVoiceStart}
            onMouseUp={handleVoiceStop}
            onMouseLeave={handleVoiceStop}
            onTouchStart={handleVoiceStart}
            onTouchEnd={handleVoiceStop}
            disabled={isProcessing}
            style={{ width: "100%", padding: 14, borderRadius: 25, border: "none", background: isRecording ? "#f44336" : "#4caf50", color: "#fff", fontWeight: "bold" }}
          >
            {isRecording ? "🔴 Thả ra để gửi..." : "🎤 Nhấn giữ để nói"}
          </button>
        )}
      </div>
    </div>
  );
};

export default KoreanLearningApp;
