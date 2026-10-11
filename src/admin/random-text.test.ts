import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateText, subjectPrompt, bodyPrompt } from './random-text.js';
import { DEFAULT_SUBJECT_PROMPT, DEFAULT_BODY_PROMPT, loadConfig, saveConfig } from './config-store.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'm365mutator-text-'));
  process.env.M365MUTATOR_DATA_DIR = dataDir;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
  delete process.env.SUBJECT_PROMPT;
  delete process.env.BODY_PROMPT;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.M365MUTATOR_DATA_DIR;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
  delete process.env.SUBJECT_PROMPT;
  delete process.env.BODY_PROMPT;
  rmSync(dataDir, { recursive: true, force: true });
});

describe('generateText', () => {
  it('returns a GUID when no OpenRouter key is configured', async () => {
    const text = await generateText('anything');
    expect(text).toMatch(UUID_RE);
  });

  it('calls OpenRouter and returns trimmed content when a key is set', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '  Hello world  ' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const text = await generateText('subject please');
    expect(text).toBe('Hello world');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('openrouter.ai');
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
  });

  it('falls back to a GUID when OpenRouter returns a non-OK status', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const text = await generateText('subject please');
    expect(text).toMatch(UUID_RE);
  });

  it('falls back to a GUID when fetch throws', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const text = await generateText('subject please');
    expect(text).toMatch(UUID_RE);
  });
});

describe('prompt resolution', () => {
  it('returns the built-in defaults when nothing is configured', () => {
    expect(subjectPrompt()).toBe(DEFAULT_SUBJECT_PROMPT);
    expect(bodyPrompt()).toBe(DEFAULT_BODY_PROMPT);
  });

  it('uses env-var overrides for the config defaults', () => {
    process.env.SUBJECT_PROMPT = 'env subject';
    process.env.BODY_PROMPT = 'env body';
    expect(subjectPrompt()).toBe('env subject');
    expect(bodyPrompt()).toBe('env body');
  });

  it('prefers saved custom prompts over the defaults', () => {
    saveConfig({ ...loadConfig(), subjectPrompt: 'custom subject', bodyPrompt: 'custom body' });
    expect(subjectPrompt()).toBe('custom subject');
    expect(bodyPrompt()).toBe('custom body');
  });

  it('falls back to the default when a saved prompt is blank', () => {
    saveConfig({ ...loadConfig(), subjectPrompt: '', bodyPrompt: '' });
    expect(subjectPrompt()).toBe(DEFAULT_SUBJECT_PROMPT);
    expect(bodyPrompt()).toBe(DEFAULT_BODY_PROMPT);
  });
});
