const DEFAULT_VISION_MODEL = 'qwen/qwen3.8-27b';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function parseImageDataUrl(value, label) {
  if (!value) return null;
  const match = String(value).match(/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    const error = new Error(`La imagen de firma de ${label} no tiene un formato PNG o JPG válido.`);
    error.status = 400;
    throw error;
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    const error = new Error(`La imagen de firma de ${label} está vacía o supera el límite de 2 MB.`);
    error.status = 413;
    throw error;
  }
  const isPng = match[1] === 'image/png' && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isJpeg = match[1] === 'image/jpeg' && buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (!isPng && !isJpeg) {
    const error = new Error(`La imagen de firma de ${label} no coincide con su formato declarado.`);
    error.status = 400;
    throw error;
  }
  return { dataUrl: value, mimeType: match[1], bytes: buffer.length };
}

function normalizeSignatureResult(value, label) {
  const allowed = ['parece_firma', 'sin_trazo_claro', 'poco_legible', 'no_parece_firma', 'no_determinado'];
  const resultado = allowed.includes(value?.resultado) ? value.resultado : 'no_determinado';
  return {
    resultado,
    observacion: String(value?.observacion || `No fue posible describir con claridad la imagen de ${label}.`).slice(0, 600),
  };
}

async function analyzeSignatureImages({ titularDataUrl, enlaceDataUrl }) {
  const titular = parseImageDataUrl(titularDataUrl, 'titular');
  const enlace = parseImageDataUrl(enlaceDataUrl, 'enlace');
  if (!titular && !enlace) {
    return {
      model: null,
      revisadas: false,
      titular: { resultado: 'no_adjunta', observacion: 'No se adjuntó una imagen de firma del titular.' },
      enlace: { resultado: 'no_adjunta', observacion: 'No se adjuntó una imagen de firma del enlace.' },
      nota: 'No se recibieron imágenes para revisar. No se hizo una revisión visual de las firmas.',
    };
  }

  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    const error = new Error('GROQ_API_KEY no está configurada. No se puede realizar la revisión visual de las firmas.');
    error.status = 503;
    throw error;
  }
  const model = process.env.GROQ_VISION_MODEL?.trim() || DEFAULT_VISION_MODEL;
  const content = [{
    type: 'text',
    text: [
      'Revisa visualmente las imágenes adjuntas de firmas para una preauditoría administrativa.',
      'Cada imagen está precedida por una indicación que identifica el espacio del formulario al que corresponde.',
      'Describe solamente lo visible: si hay un trazo que parece una firma manuscrita, si la imagen está vacía, demasiado borrosa, recortada o no parece una firma.',
      'No intentes identificar a la persona, comparar identidades, confirmar quién firmó, determinar autenticidad, validez legal ni detectar falsificación. Una imagen no prueba que la persona nombrada haya firmado.',
      'Si no puedes determinarlo, usa no_determinado. No supongas que una firma existe si no se ve claramente.',
      'Responde únicamente JSON con las propiedades titular y enlace. Cada una debe tener resultado (parece_firma, sin_trazo_claro, poco_legible, no_parece_firma, no_determinado) y observacion. Para una imagen que no fue enviada, usa no_determinado y explícalo.',
    ].join(' '),
  }];
  if (titular) {
    content.push({ type: 'text', text: 'La siguiente imagen corresponde al espacio de firma del TITULAR.' });
    content.push({ type: 'image_url', image_url: { url: titular.dataUrl } });
  }
  if (enlace) {
    content.push({ type: 'text', text: 'La siguiente imagen corresponde al espacio de firma del ENLACE.' });
    content.push({ type: 'image_url', image_url: { url: enlace.dataUrl } });
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(65000),
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_completion_tokens: 900,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Eres un asistente de inspección visual. No autenticas firmas ni identificas personas. Responde solo JSON válido.' },
        { role: 'user', content },
      ],
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error?.message || `Groq respondió con HTTP ${response.status}.`;
    const error = new Error(`No fue posible revisar visualmente las imágenes de firma: ${message}`);
    error.status = response.status >= 500 ? 502 : 400;
    throw error;
  }
  const responseContent = body?.choices?.[0]?.message?.content;
  let parsed;
  try {
    parsed = JSON.parse(responseContent);
  } catch {
    const error = new Error('Groq no devolvió un resultado válido para la revisión visual de las firmas. No se guardó la preauditoría.');
    error.status = 502;
    throw error;
  }

  return {
    model,
    revisadas: true,
    titular: titular ? normalizeSignatureResult(parsed.titular, 'titular') : { resultado: 'no_adjunta', observacion: 'No se adjuntó una imagen de firma del titular.' },
    enlace: enlace ? normalizeSignatureResult(parsed.enlace, 'enlace') : { resultado: 'no_adjunta', observacion: 'No se adjuntó una imagen de firma del enlace.' },
    nota: 'La revisión describe la apariencia de las imágenes. No confirma la identidad de quien firmó ni la autenticidad o validez de las firmas.',
  };
}

module.exports = { analyzeSignatureImages };
