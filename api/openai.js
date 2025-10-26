export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { endpoint, body, isFormData } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    // Xử lý Whisper API (audio transcription)
    if (endpoint === '/v1/audio/transcriptions' && isFormData) {
      const { file, model, language, response_format } = body;
      
      if (!file) {
        return res.status(400).json({ error: 'No audio file provided' });
      }

      // Convert base64 to Buffer
      const audioBuffer = Buffer.from(file, 'base64');
      
      // Create form data
      const FormData = require('form-data');
      const formData = new FormData();
      
      formData.append('file', audioBuffer, {
        filename: 'audio.webm',
        contentType: 'audio/webm'
      });
      formData.append('model', model || 'whisper-1');
      if (language) formData.append('language', language);
      if (response_format) formData.append('response_format', response_format);

      // Call OpenAI Whisper API
      const fetch = (await import('node-fetch')).default;
      const whisperResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          ...formData.getHeaders()
        },
        body: formData
      });

      if (!whisperResponse.ok) {
        const errorText = await whisperResponse.text();
        console.error('Whisper API error:', errorText);
        return res.status(whisperResponse.status).json({ 
          error: 'Whisper API failed',
          details: errorText 
        });
      }

      const result = await whisperResponse.json();
      return res.status(200).json(result);
    }

    // Xử lý TTS API (audio/speech)
    if (endpoint === '/v1/audio/speech') {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(`https://api.openai.com${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({ error: errorText });
      }

      // Return audio as blob
      const audioBuffer = await response.buffer();
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.status(200).send(audioBuffer);
    }

    // Xử lý Chat Completions API
    if (endpoint === '/v1/chat/completions') {
      const fetch = (await import('node-fetch')).default;
      const response = await fetch(`https://api.openai.com${endpoint}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({ error: errorText });
      }

      const result = await response.json();
      return res.status(200).json(result);
    }

    return res.status(400).json({ error: 'Invalid endpoint' });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}
