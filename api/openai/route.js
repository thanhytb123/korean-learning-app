export const config = {
  runtime: 'edge',
};

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { endpoint, method, body } = await req.json();

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      return new Response(JSON.stringify({ error: 'Missing API key' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const openaiUrl = `https://api.openai.com${endpoint}`;
    
    const response = await fetch(openaiUrl, {
      method: method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', errorText);
      return new Response(JSON.stringify({ error: 'OpenAI API failed', details: errorText }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // For audio responses
    if (endpoint.includes('/audio/speech')) {
      const audioBlob = await response.blob();
      return new Response(audioBlob, {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    }

    // For JSON responses
    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('API route error:', error);
    return new Response(JSON.stringify({ error: 'Internal server error', message: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
