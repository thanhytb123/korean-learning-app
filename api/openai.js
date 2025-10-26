export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { endpoint, body, isFormData } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    // Whisper API
    if (endpoint === '/v1/audio/transcriptions' && isFormData) {
      const { file, model, language } = body;
      
      // Convert base64 to binary
      const audioBuffer = Buffer.from(file, 'base64');
      
      // Create proper multipart form data
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      const formParts = [];
      
      // Add file part
      formParts.push(`--${boundary}\r\n`);
      formParts.push(`Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n`);
      formParts.push(`Content-Type: audio/webm\r\n\r\n`);
      formParts.push(audioBuffer);
      formParts.push(`\r\n`);
      
      // Add model part
      formParts.push(`--${boundary}\r\n`);
      formParts.push(`Content-Disposition: form-data; name="model"\r\n\r\n`);
      formParts.push(model || 'whisper-1');
      formParts.push(`\r\n`);
      
      // Add language part
      if (language) {
        formParts.push(`--${boundary}\r\n`);
        formParts.push(`Content-Disposition: form-data; name="language"\r\n\r\n`);
        formParts.push(language);
        formParts.push(`\r\n`);
      }
      
      formParts.push(`--${boundary}--\r\n`);
      
      const formBody = Buffer.concat(
        formParts.map(part => 
          typeof part === 'string' ? Buffer.from(part, 'utf8') : part
        )
      );

      const fetch = (await import('node-fetch')).default;
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: formBody
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Whisper error:', errorText);
        return res.status(response.status).json({ 
          error: 'Whisper failed',
          details: errorText 
        });
      }

      const result = await response.json();
      return res.status(200).json(result);
    }

    // TTS API
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
        return res.status(response.status).json({ error: await response.text() });
      }

      const audioBuffer = await response.buffer();
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.status(200).send(audioBuffer);
    }

    // Chat API
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
        return res.status(response.status).json({ error: await response.text() });
      }

      return res.status(200).json(await response.json());
    }

    return res.status(400).json({ error: 'Invalid endpoint' });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
