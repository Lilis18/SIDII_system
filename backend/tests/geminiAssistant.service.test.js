const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_MODEL,
  generateAssistantAnswer,
  getOfficialSources,
  mapHistory,
} = require('../services/geminiAssistant.service');

test('generates a response with bounded history using the configured Gemini key', async () => {
  let requestUrl;
  let requestOptions;
  const history = Array.from({ length: 10 }, (_, index) => ({
    rol: index % 2 === 0 ? 'usuario' : 'bot',
    mensaje: `mensaje ${index}`,
  }));
  const answer = await generateAssistantAnswer({
    question: '¿Dónde capturo los indicadores?',
    history,
    apiKey: 'test-secret',
    fetchImpl: async (url, options) => {
      requestUrl = url;
      requestOptions = options;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'En Cargar datos.' }] } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  assert.equal(answer, 'En Cargar datos.');
  assert.equal(requestUrl, `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_MODEL}:generateContent`);
  assert.equal(requestOptions.headers['x-goog-api-key'], 'test-secret');
  const body = JSON.parse(requestOptions.body);
  assert.equal(body.contents.length, 9);
  assert.equal(body.contents[0].parts[0].text, 'mensaje 2');
  assert.equal(body.contents.at(-1).parts[0].text, '¿Dónde capturo los indicadores?');
  assert.equal(body.generationConfig.maxOutputTokens, 600);
});

test('converts an upstream Gemini quota response to a retryable 429 error', async () => {
  await assert.rejects(
    generateAssistantAnswer({
      question: 'Ayuda',
      apiKey: 'test-secret',
      fetchImpl: async () => new Response('{}', { status: 429 }),
    }),
    (error) => error.status === 429 && /límite gratuito/.test(error.message),
  );
});

test('reports model configuration details when Gemini cannot find the model', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      generateAssistantAnswer({
        question: 'Ayuda',
        apiKey: 'test-secret',
        fetchImpl: async () => new Response(JSON.stringify({
          error: { code: 404, status: 'NOT_FOUND' },
        }), { status: 404, headers: { 'Content-Type': 'application/json' } }),
      }),
      (error) => error.status === 502 && /GEMINI_MODEL/.test(error.message),
    );
  } finally {
    console.error = originalError;
  }
});

test('does not make a provider request when the key is missing', async () => {
  let wasCalled = false;
  await assert.rejects(
    generateAssistantAnswer({
      question: 'Ayuda',
      apiKey: '',
      fetchImpl: async () => { wasCalled = true; },
    }),
    (error) => error.status === 503,
  );
  assert.equal(wasCalled, false);
});

test('filters and bounds stored conversation history', () => {
  const history = mapHistory([
    { rol: 'invalid', mensaje: 'ignorar' },
    ...Array.from({ length: 10 }, (_, index) => ({
      rol: index % 2 === 0 ? 'usuario' : 'bot',
      mensaje: ` ${'x'.repeat(1100)}${index} `,
    })),
  ]);
  assert.equal(history.length, 8);
  assert.equal(history[0].role, 'user');
  assert.equal(history[0].parts[0].text.length, 1000);
});

test('returns only curated official links relevant to the question', () => {
  const sources = getOfficialSources('¿Qué ley y reglamento debo consultar?');
  assert.deepEqual(sources, [{
    name: 'Diario Oficial de la Federación',
    url: 'https://www.dof.gob.mx/',
  }]);
  assert.ok(getOfficialSources('pregunta general').every((source) => source.url.startsWith('https://')));
});

test('suggests Puebla PbR sources for budget and logical-framework questions', () => {
  const sources = getOfficialSources('¿Dónde consulto los lineamientos de Presupuesto basado en Resultados y marco lógico?');
  assert.deepEqual(sources.map((source) => source.url), [
    'https://spfa.puebla.gob.mx',
    'https://pbr.puebla.gob.mx/index.php/mm-diagnosticopbr-2026',
  ]);
});

test('suggests official anti-corruption references for transparency questions', () => {
  const sources = getOfficialSources('¿Qué marco de integridad, ética pública y transparencia aplica?');
  assert.deepEqual(sources.map((source) => source.url), [
    'https://www.gob.mx/buengobierno',
    'https://sabg.puebla.gob.mx/',
  ]);
});

test('identifies UTPuebla as the university portal', () => {
  const [source] = getOfficialSources('¿Cuál es el portal oficial de la Universidad Tecnológica de Puebla?');
  assert.equal(source.name, 'Universidad Tecnológica de Puebla - portal oficial UTPuebla');
  assert.equal(source.url, 'https://www.utpuebla.edu.mx/');
});
