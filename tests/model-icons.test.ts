import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { MODEL_ICONS } from '../src/client/features/model-controls/model-icon-data.ts';
import { modelIconInitial, resolveModelIcon } from '../src/client/features/model-controls/model-icon-match.ts';

const source = fileURLToPath(new URL(
  '../src/client/features/model-controls/lobe-icons/svg',
  import.meta.url,
));

const magpie = { id: 'magpie', name: 'Magpie' };

function slugFor(name: string, provider = magpie): string | null {
  return resolveModelIcon(provider, { id: name.toLowerCase().replace(/[^a-z0-9]+/gu, '-'), name })?.slug ?? null;
}

test('the full upstream SVG set is vendored, with one monochrome base per family', () => {
  const files = readdirSync(source).filter(file => file.endsWith('.svg'));
  const bases = files.filter(file => !file.includes('-')).map(file => file.slice(0, -4));
  const colors = files.filter(file => file.endsWith('-color.svg')).map(file => file.slice(0, -10));
  const matchingColors = bases.filter(base => colors.includes(base));
  assert.equal(files.length, 950);
  assert.equal(bases.length, 340);
  assert.equal(colors.length, 245);
  assert.equal(matchingColors.length, 226);
  assert.deepEqual(Object.keys(MODEL_ICONS).sort(), bases.sort());
  assert.ok(MODEL_ICONS.deepseek?.shapes.length);
});

test('color marks remain indexed, while monochrome marks remain available', () => {
  assert.equal(Object.values(MODEL_ICONS).filter(mark => mark.color !== undefined).length, 226);
  assert.match(MODEL_ICONS.deepseek?.color?.markup ?? '', /#4D6BFE/u);
  assert.match(MODEL_ICONS.minimax?.color?.markup ?? '', /<linearGradient/u);
  /* The generated color exists, but rows force Kimi to its readable mono mark. */
  assert.match(MODEL_ICONS.kimi?.color?.markup ?? '', /var\(--ccd-card\)/u);
  assert.ok(MODEL_ICONS.kimi?.shapes.length);
  assert.match(MODEL_ICONS.kimi?.color?.markup ?? '', /var\(--ccd-card\)/u);
  /* White inside a mask is mask strength, not a card-colored knockout. */
  assert.match(MODEL_ICONS.nova?.color?.markup ?? '', /<mask[\s\S]*fill="#fff"/u);
  assert.equal(MODEL_ICONS.openai?.color, undefined);
  assert.ok(MODEL_ICONS.openai?.shapes.length);
});

test('generated color markup is self-contained and safe to inline', () => {
  const unsafe = /<\/?(?:script|style|image|use|foreignObject|iframe|object|embed)\b|\son[\w:-]+\s*=/iu;
  for (const [slug, mark] of Object.entries(MODEL_ICONS)) {
    if (mark.color === undefined) continue;
    assert.doesNotMatch(mark.color.markup, unsafe, slug);
    for (const id of mark.color.markup.matchAll(/\bid="([^"]+)"/gu)) {
      assert.ok(id[1]?.startsWith(`ccd-model-icon-${slug}-`), `${slug} has an unscoped id`);
    }
  }
});

test('routing-group models resolve by the model name before the provider', () => {
  /* Magpie is the group in the report: its name has no brand, so matching the
     group alone left every row with the same M. */
  assert.equal(slugFor('Step 5 Preview · routing group'), 'stepfun');
  assert.equal(slugFor('GPT-6.1 Sol · routing group'), 'openai');
  assert.equal(slugFor('DeepSeek V4 Pro · routing group'), 'deepseek');
  assert.equal(slugFor('GPT-6-Astra · routing group'), 'openai');
  assert.equal(slugFor('GPT-5.6-Terra · routing group'), 'openai');
});

test('model families outrank routing services in the model label', () => {
  const provider = { id: 'openrouter', name: 'OpenRouter' };
  assert.equal(resolveModelIcon(provider, {
    id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol · OpenRouter',
  })?.slug, 'openai');
  assert.equal(resolveModelIcon(provider, {
    id: 'mistral-large', name: 'Mistral Large 4 · OpenRouter',
  })?.slug, 'mistral');
  assert.equal(resolveModelIcon(provider, {
    id: 'openrouter/unknown-model', name: 'OpenRouter',
  })?.slug, 'openrouter');
});

test('common model families map to their upstream marks', () => {
  const expected: Readonly<Record<string, string>> = {
    'Kimi K2': 'kimi',
    'Moonshot AI': 'moonshot',
    'GLM-5.2 · routing group': 'zhipu',
    'ChatGLM-4': 'zhipu',
    'MiniMax M2': 'minimax',
    'Qwen3 Max': 'qwen',
    'Claude Sonnet 4.5': 'claude',
    'Gemini 2.5 Pro': 'gemini',
    'Gemma 3': 'gemma',
    'Grok 4': 'grok',
    'Llama 4': 'meta',
    'MiMo-V2': 'xiaomimimo',
    'LongCat-Flash': 'longcat',
    'Doubao Seed': 'doubao',
    'Hunyuan Turbo': 'hunyuan',
    'Hy3': 'hunyuan',
    'Hy3 (X)': 'hunyuan',
    '混元': 'hunyuan',
    'Wenxin 4.5': 'wenxin',
    'ERNIE 5': 'wenxin',
    'Spark X1': 'spark',
    'Yi-Large': 'yi',
  };
  for (const [name, slug] of Object.entries(expected)) assert.equal(slugFor(name), slug, name);
});

test('a known provider still supplies a mark when the model does not', () => {
  assert.equal(resolveModelIcon({ id: 'deepseek', name: 'DeepSeek' }, { id: 'flash', name: 'Flash' })?.slug, 'deepseek');
});

test('unknown models fall back to their own initial, not the routing group', () => {
  const model = { id: 'mystery-1', name: 'Mystery One' };
  assert.equal(resolveModelIcon(magpie, model), null);
  assert.equal(modelIconInitial(magpie, model), 'M');
  assert.equal(modelIconInitial(magpie, { id: 'zeta', name: 'zeta' }), 'Z');
});

test('short aliases respect token boundaries', () => {
  assert.equal(slugFor('Stepper'), null);
  assert.equal(slugFor('Yield Curve'), null);
  assert.equal(slugFor('Hy3drogen'), null);
  assert.equal(slugFor('GPT-6.1 Sol'), 'openai');
});

test('indexed matching retains ranking across phrase, compact and routing candidates', () => {
  assert.equal(slugFor('CLÁUDE Sonnet'), 'claude');
  assert.equal(slugFor('DeepSeekV3'), 'deepseek');
  assert.equal(slugFor('GPT-6.1 Sol OpenRouter'), 'openai');
  const model = { id: 'mystery', name: 'Unknown model' };
  assert.equal(resolveModelIcon(magpie, model), null);
  model.name = 'Claude Sonnet';
  assert.equal(resolveModelIcon(magpie, model)?.slug, 'claude', 'renaming a reused catalog row invalidates text-based lookup');
});

test('catalog churn keeps matching correct after bounded cache eviction', () => {
  assert.equal(slugFor('DeepSeek V4 Pro'), 'deepseek');
  for (let index = 0; index < 2200; index++) {
    assert.equal(resolveModelIcon(magpie, { id: String(index), name: 'Unknown Model ' + index }), null);
  }
  assert.equal(slugFor('DeepSeek V4 Pro'), 'deepseek');
  assert.equal(resolveModelIcon({ id: 'deepseek', name: 'DeepSeek' }, { id: 'flash', name: 'Unknown Model' })?.slug, 'deepseek');
});
