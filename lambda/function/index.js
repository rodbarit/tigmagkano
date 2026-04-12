const https = require('https');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'ap-southeast-1' });
const dynamo = DynamoDBDocumentClient.from(client);
const TABLE = 'tigmagkano-orders';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function resp(statusCode, body) {
  return { statusCode, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function generateId() {
  return Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
}

exports.handler = async (event) => {
  const method = (event.requestContext?.http?.method || '').toUpperCase();
  const rawPath = event.requestContext?.http?.path || '';
  const path = rawPath.replace(/^\/prod/, '');

  if (method === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  console.log('METHOD:', method, 'PATH:', path);

  // ── PARSE RECEIPT  POST /parse ───────────────────────────────────────────
  if (method === 'POST' && path === '/parse') {
    // Rate limit: 5 parses per IP per day
    const ip = event.requestContext?.http?.sourceIp || 'unknown';
    const today = new Date().toISOString().slice(0, 10);
    const rateKey = `ratelimit#${ip}#${today}`;
    const rateTtl = Math.floor(Date.now() / 1000) + (2 * 24 * 60 * 60);
    const rateResult = await dynamo.send(new UpdateCommand({
      TableName: TABLE,
      Key: { orderId: rateKey },
      UpdateExpression: 'ADD #cnt :one SET expiresAt = if_not_exists(expiresAt, :ttl)',
      ExpressionAttributeNames: { '#cnt': 'count' },
      ExpressionAttributeValues: { ':one': 1, ':ttl': rateTtl },
      ReturnValues: 'ALL_NEW',
    }));
    if (rateResult.Attributes.count > 5) {
      return resp(429, { error: 'Daily limit reached. You can parse up to 5 receipts per day.' });
    }

    let body;
    try { body = JSON.parse(event.body); } catch { return resp(400, { error: 'Invalid JSON' }); }

    const { image, mediaType, hint } = body;
    if (!image || !mediaType) return resp(400, { error: 'Missing image or mediaType' });

    let prompt = `Parse this food receipt and return ONLY a raw JSON object, no markdown, no backticks.

Format:
{
  "items": [{"qty": number, "name": "string", "unit_cost": number}, ...],
  "service_charge": number or null,
  "vat_adjustment": number or null,
  "sc_discount": number or null,
  "pwd_discount": number or null,
  "total_due": number or null
}

Rules:
- "items": all food/drink line items AND Service Charge as a regular item (qty 1, unit_cost = service charge amount). unit_cost is price per single unit.
- "service_charge": the service charge amount as a positive number, or null if not found
- "vat_adjustment": look carefully for VAT, Value Added Tax, or any tax adjustment — return as a negative number (e.g. -84.64), or null ONLY if absolutely not on the receipt
- "sc_discount": look carefully for SC, Senior Citizen discount — return as a negative number (e.g. -141.07), or null ONLY if absolutely not on the receipt
- "pwd_discount": look carefully for PWD, Persons with Disability discount — return as a negative number, or null ONLY if absolutely not on the receipt
- "total_due": the final total amount due / grand total on the receipt, or null if not found
- These discounts are often small amounts near the bottom of the receipt — scan carefully before returning null
- Do NOT include subtotals or grand totals in items`;

    if (hint) prompt += `\n\nIMPORTANT: ${hint}`;

    const requestBody = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
        { type: 'text', text: prompt }
      ]}]
    });

    try {
      const apiResp = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(requestBody),
          }
        }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.write(requestBody);
        req.end();
      });

      const data = JSON.parse(apiResp.body);
      if (data.error) return resp(500, { error: data.error.message });
      const text = data.content.map(b => b.text || '').join('').trim().replace(/```json|```/g, '').trim();
      return resp(200, JSON.parse(text));
    } catch (err) {
      return resp(500, { error: err.message });
    }
  }

  // ── CREATE ORDER  POST /order ─────────────────────────────────────────────
  if (method === 'POST' && path === '/order') {
    let body;
    try { body = JSON.parse(event.body); } catch(e) { return resp(400, { error: 'Invalid JSON: ' + e.message }); }

    const { items, vat_adjustment, sc_discount, pwd_discount } = body;
    if (!items || !items.length) return resp(400, { error: 'Missing items' });
    console.log('Creating order with', items.length, 'items');

    const orderId = generateId();
    const createdAt = new Date().toISOString();
    const expiresAt = Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60);

    // names will be filled in by participants; start empty
    const order = {
      orderId,
      createdAt,
      expiresAt,
      items: items.map(it => ({ ...it, assignments: {} })),
      vat_adjustment: vat_adjustment != null ? vat_adjustment : null,
      sc_discount: sc_discount != null ? sc_discount : null,
      pwd_discount: pwd_discount != null ? pwd_discount : null,
      names: [],
    };

    try {
      await dynamo.send(new PutCommand({ TableName: TABLE, Item: order }));
      console.log('Order created:', orderId);
      return resp(200, { orderId });
    } catch(dbErr) {
      console.error('DynamoDB error:', dbErr);
      return resp(500, { error: 'DB error: ' + dbErr.message });
    }
  }

  // ── GET ORDER  GET /order/{id} ────────────────────────────────────────────
  if (method === 'GET' && path.startsWith('/order/')) {
    const orderId = path.split('/order/')[1];
    if (!orderId) return resp(400, { error: 'Missing orderId' });

    const result = await dynamo.send(new GetCommand({ TableName: TABLE, Key: { orderId } }));
    if (!result.Item) return resp(404, { error: 'Order not found' });
    return resp(200, result.Item);
  }

  // ── UPDATE ORDER  PUT /order/{id} ─────────────────────────────────────────
  if (method === 'PUT' && path.startsWith('/order/')) {
    const orderId = path.split('/order/')[1];
    if (!orderId) return resp(400, { error: 'Missing orderId' });

    let body;
    try { body = JSON.parse(event.body); } catch { return resp(400, { error: 'Invalid JSON' }); }

    const { name, assignments } = body;
    if (!name) return resp(400, { error: 'Missing name' });

    // Get existing order
    const result = await dynamo.send(new GetCommand({ TableName: TABLE, Key: { orderId } }));
    if (!result.Item) return resp(404, { error: 'Order not found' });

    const order = result.Item;

    // Add name to names list if not already there
    if (!order.names.includes(name)) order.names.push(name);

    // Update assignments for each item
    order.items = order.items.map((item, i) => ({
      ...item,
      assignments: {
        ...item.assignments,
        [name]: assignments[i] || 0,
      }
    }));

    await dynamo.send(new PutCommand({ TableName: TABLE, Item: order }));
    return resp(200, order);
  }

  return resp(404, { error: 'Route not found' });
};