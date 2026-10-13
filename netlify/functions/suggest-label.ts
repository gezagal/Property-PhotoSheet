const MAX_IMAGE_LENGTH = 5_000_000;

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function isValidImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length <= MAX_IMAGE_LENGTH &&
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value);
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Csak POST kérés engedélyezett.' }, 405);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: 'Az AI-felirat szolgáltatás nincs konfigurálva.' }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Érvénytelen JSON kérés.' }, 400);
  }
  if (!body || typeof body !== 'object' || !('image' in body) || !('labels' in body)) {
    return jsonResponse({ error: 'A kép vagy a feliratlista hiányzik.' }, 400);
  }

  const { image, labels } = body;
  if (!isValidImageDataUrl(image)) {
    return jsonResponse({ error: 'A kép formátuma érvénytelen vagy túl nagy.' }, 400);
  }
  if (
    !Array.isArray(labels) ||
    labels.length === 0 ||
    labels.length > 500 ||
    !labels.every((label: unknown) => typeof label === 'string' && label.length > 0 && label.length <= 100)
  ) {
    return jsonResponse({ error: 'A feliratlista érvénytelen.' }, 400);
  }

  const responseFormat = {
    type: 'json_schema',
    json_schema: {
      name: 'photo_caption',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          label: {
            anyOf: [
              { type: 'string', enum: labels },
              { type: 'null' },
            ],
          },
        },
        required: ['label'],
        additionalProperties: false,
      },
    },
  };

  let openAiResponse: Response;
  try {
    openAiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        temperature: 0,
        max_completion_tokens: 100,
        response_format: responseFormat,
        messages: [
          {
            role: 'system',
            content: 'Ingatlan-értékbecsléshez készült fotó egyetlen feliratát válaszd ki a megadott listából. Csak a képen egyértelműen látható tartalom alapján dönts. Ha nem választható ki kellő biztonsággal megfelelő felirat, add vissza a null értéket.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Válassz pontosan egy feliratot ebből a listából, vagy null értéket:\n${JSON.stringify(labels)}` },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    return jsonResponse({ error: 'Az OpenAI szolgáltatása nem érhető el.' }, 502);
  }

  if (!openAiResponse.ok) {
    return jsonResponse(
      { error: `Az OpenAI feliratjavaslata sikertelen (HTTP ${openAiResponse.status}).` },
      502,
    );
  }

  let result: unknown;
  try {
    result = await openAiResponse.json();
  } catch {
    return jsonResponse({ error: 'Az OpenAI érvénytelen választ adott.' }, 502);
  }
  if (
    !result ||
    typeof result !== 'object' ||
    !('choices' in result) ||
    !Array.isArray(result.choices) ||
    !result.choices[0] ||
    typeof result.choices[0] !== 'object' ||
    !('message' in result.choices[0]) ||
    !result.choices[0].message ||
    typeof result.choices[0].message !== 'object' ||
    !('content' in result.choices[0].message) ||
    typeof result.choices[0].message.content !== 'string'
  ) {
    return jsonResponse({ error: 'Az OpenAI válasza nem tartalmazott feliratot.' }, 502);
  }

  let output: unknown;
  try {
    output = JSON.parse(result.choices[0].message.content);
  } catch {
    return jsonResponse({ error: 'Az OpenAI feliratválasza nem értelmezhető.' }, 502);
  }
  if (
    !output ||
    typeof output !== 'object' ||
    !('label' in output) ||
    (output.label !== null && (typeof output.label !== 'string' || !labels.includes(output.label)))
  ) {
    return jsonResponse({ error: 'Az OpenAI nem a választható feliratok közül válaszolt.' }, 502);
  }

  return jsonResponse({ label: output.label });
}
