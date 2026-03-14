const https = require('https');

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { image, mediaType } = body;
  if (!image || !mediaType) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing image or mediaType' }) };
  }

  const prompt = `Parse this food receipt and return ONLY a raw JSON object, no markdown, no backticks.

Format:
{
  "items": [{"qty": number, "name": "string", "unit_cost": number}, ...],
  "service_charge": number or null,
  "vat_adjustment": number or null,
  "sc_discount": number or null
}

Rules:
- "items": all food/drink line items AND Service Charge as a regular item (qty 1, unit_cost = service charge amount). unit_cost is price per single unit.
- "service_charge": the service charge amount as a positive number, or null if not found
- "vat_adjustment": the VAT adjustment as a negative number (e.g. -84.64), or null if not found
- "sc_discount": the senior citizen / SC discount as a negative number (e.g. -141.07), or null if not found
- Do NOT include subtotals or grand totals in items`;

  const requestBody = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
        { type: 'text', text: prompt }
      ]
    }]
  });

  try {
    const apiResponse = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(requestBody),
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.write(requestBody);
      req.end();
    });

    const data = JSON.parse(apiResponse.body);
    if (data.error) {
      return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: data.error.message }) };
    }

    const text = data.content.map(b => b.text || '').join('').trim().replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(text);
    return { statusCode: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) };

  } catch (err) {
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message }) };
  }
};
