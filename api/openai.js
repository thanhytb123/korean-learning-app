// api/openai.js
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { endpoint, method = 'POST', body } = req.body;

  try {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ error: 'API key not configured' });
    }

    const response = await fetch(`https://api.openai.com${endpoint}`, {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    // TTS trả về audio binary
    if (endpoint.includes('/audio/speech')) {
      const buffer = await response.arrayBuffer();
      res.setHeader('Content-Type', 'audio/mpeg');
      res.send(Buffer.from(buffer));
      return;
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    console.error('OpenAI API Error:', error);
    res.status(500).json({ error: error.message });
  }
}
