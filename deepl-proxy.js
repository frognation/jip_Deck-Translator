const http = require('node:http');

const HOST = '127.0.0.1';
const PORT = 8787;

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  });
  res.end(JSON.stringify(data));
}

function buildDeepLBody(texts, sourceLang, targetLang) {
  const deeplTargetMap = {
    en: 'EN-US',
    'zh-CN': 'ZH-HANS',
    'zh-TW': 'ZH-HANT',
    pt: 'PT-PT',
    'pt-BR': 'PT-BR',
  };

  const deeplSourceMap = {
    'zh-CN': 'ZH',
    'zh-TW': 'ZH',
    'pt-BR': 'PT',
  };

  const parts = [];
  for (const text of texts) {
    parts.push(`text=${encodeURIComponent(text)}`);
  }

  const target = deeplTargetMap[targetLang] || String(targetLang || '').toUpperCase();
  parts.push(`target_lang=${encodeURIComponent(target)}`);

  if (sourceLang && sourceLang !== 'auto') {
    const source = deeplSourceMap[sourceLang] || String(sourceLang).toUpperCase();
    parts.push(`source_lang=${encodeURIComponent(source)}`);
  }

  return parts.join('&');
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
    res.end();
    return;
  }

  if (req.method !== 'POST' || req.url !== '/translate/deepl') {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  let rawBody = '';
  req.on('data', (chunk) => {
    rawBody += chunk;
  });

  req.on('end', async () => {
    try {
      const payload = JSON.parse(rawBody || '{}');
      const texts = Array.isArray(payload.texts) ? payload.texts : [];
      const sourceLang = payload.sourceLang || 'auto';
      const targetLang = payload.targetLang || '';
      const apiKey = String(payload.apiKey || '');
      const isFree = !!payload.isFree;

      if (!apiKey) {
        sendJson(res, 400, { error: 'Missing DeepL API key' });
        return;
      }

      if (!targetLang) {
        sendJson(res, 400, { error: 'Missing target language' });
        return;
      }

      const baseUrl = isFree
        ? 'https://api-free.deepl.com/v2/translate'
        : 'https://api.deepl.com/v2/translate';

      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `DeepL-Auth-Key ${apiKey}`,
        },
        body: buildDeepLBody(texts, sourceLang, targetLang),
      });

      const responseText = await response.text();
      if (!response.ok) {
        sendJson(res, response.status, {
          error: `DeepL API error (${response.status})`,
          details: responseText || response.statusText,
        });
        return;
      }

      const data = JSON.parse(responseText);
      sendJson(res, 200, {
        translations: (data.translations || []).map((item) => ({ text: item.text })),
      });
    } catch (error) {
      sendJson(res, 500, {
        error: error && error.message ? error.message : 'Proxy error',
      });
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`DeepL proxy listening at http://${HOST}:${PORT}/translate/deepl`);
});
