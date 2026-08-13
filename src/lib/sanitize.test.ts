import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sanitizeDocument, sanitizeForCommunity, type SanitizationResult } from './sanitize';

const mockScrubResult = (overrides: Partial<{
  title: string;
  content: string;
  replacements: { category: string; count?: number }[];
  foundSecrets: boolean;
}> = {}) => ({
  title: overrides.title ?? 'Scrubbed Title',
  content: overrides.content ?? 'Scrubbed content.',
  replacements: overrides.replacements ?? [{ category: 'credential', count: 2 }],
  foundSecrets: overrides.foundSecrets ?? false,
});

vi.mock('./secret-scrub', () => ({
  scrubSecrets: vi.fn(() => mockScrubResult()),
}));

vi.mock('./ai-providers', () => ({
  resolveForDiagnostics: vi.fn(),
}));

const { scrubSecrets } = await import('./secret-scrub');
const { resolveForDiagnostics } = await import('./ai-providers');

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeScrubSecrets(result: ReturnType<typeof mockScrubResult>) {
  vi.mocked(scrubSecrets).mockReturnValue(result);
}

function makeOllamaResponse(json: object, ok = true, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok,
    status,
    json: async () => json,
  });
}

function makeOpenAIResponse(json: object, ok = true, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok,
    status,
    json: async () => json,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(scrubSecrets).mockReturnValue(mockScrubResult());
});

describe('sanitizeDocument — internal level', () => {
  it('returns scrub-only result without LLM screening', async () => {
    const scrub = mockScrubResult({ title: 'My Doc', content: 'Some content', foundSecrets: true });
    makeScrubSecrets(scrub);

    const result = await sanitizeDocument({
      title: 'My Doc',
      content: 'Some content',
      level: 'internal',
    });

    expect(result.sanitizedTitle).toBe('My Doc');
    expect(result.sanitizedContent).toBe('Some content');
    expect(result.llmScreened).toBe(false);
    expect(result.flagged).toBe(false);
    expect(result.foundSecrets).toBe(true);
    expect(result.flagReason).toBeUndefined();
  });

  it('maps replacements to category and count only', async () => {
    makeScrubSecrets(mockScrubResult({
      replacements: [
        { category: 'credential', count: 3 },
        { category: 'ip', count: 1 },
      ],
    }));

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'internal' });

    expect(result.replacements).toEqual([
      { category: 'credential', count: 3 },
      { category: 'ip', count: 1 },
    ]);
  });

  it('does not call resolveForDiagnostics for internal level', async () => {
    await sanitizeDocument({ title: 't', content: 'c', level: 'internal', userId: 'user-1' });
    expect(resolveForDiagnostics).not.toHaveBeenCalled();
  });

  it('does not call fetch for internal level', async () => {
    await sanitizeDocument({ title: 't', content: 'c', level: 'internal' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('passes title and content to scrubSecrets', async () => {
    await sanitizeDocument({ title: 'Original Title', content: 'Original content', level: 'internal' });
    expect(scrubSecrets).toHaveBeenCalledWith({
      title: 'Original Title',
      content: 'Original content',
      level: 'internal',
    });
  });
});

describe('sanitizeDocument — community level, no credential available', () => {
  it('returns scrub-only result flagged for review when no userId', async () => {
    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'community' });

    expect(result.flagged).toBe(true);
    expect(result.llmScreened).toBe(false);
    expect(result.flagReason).toContain('No AI model available');
    expect(result.flagReason).toContain('human review');
  });

  it('uses scrubbed title and content when no credential', async () => {
    makeScrubSecrets(mockScrubResult({ title: 'Safe Title', content: 'Safe content' }));

    const result = await sanitizeDocument({ title: 'Raw', content: 'Raw content', level: 'community' });

    expect(result.sanitizedTitle).toBe('Safe Title');
    expect(result.sanitizedContent).toBe('Safe content');
  });

  it('returns flagged result when resolveForDiagnostics throws', async () => {
    vi.mocked(resolveForDiagnostics).mockImplementation(() => { throw new Error('provider error'); });

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'user-1' });

    expect(result.flagged).toBe(true);
    expect(result.llmScreened).toBe(false);
  });

  it('returns flagged result when resolveForDiagnostics returns null', async () => {
    vi.mocked(resolveForDiagnostics).mockReturnValue(null as never);

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'user-1' });

    expect(result.flagged).toBe(true);
    expect(result.llmScreened).toBe(false);
  });

  it('propagates foundSecrets from scrub layer even without LLM', async () => {
    makeScrubSecrets(mockScrubResult({ foundSecrets: true }));

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'community' });

    expect(result.foundSecrets).toBe(true);
  });
});

describe('sanitizeDocument — community level, ollama credential', () => {
  const ollamaCredential = { provider: 'ollama', model: 'llama3', apiKey: '' };

  beforeEach(() => {
    vi.mocked(resolveForDiagnostics).mockReturnValue(ollamaCredential as never);
  });

  it('calls ollama endpoint and returns LLM-screened result', async () => {
    makeScrubSecrets(mockScrubResult({ title: 'Scrubbed T', content: 'Scrubbed C' }));
    makeOllamaResponse({
      response: JSON.stringify({
        sanitizedTitle: 'LLM Title',
        sanitizedContent: 'LLM Content',
        flagged: false,
        flagReason: null,
      }),
    });

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'u1' });

    expect(result.sanitizedTitle).toBe('LLM Title');
    expect(result.sanitizedContent).toBe('LLM Content');
    expect(result.flagged).toBe(false);
    expect(result.llmScreened).toBe(true);
    expect(result.flagReason).toBeUndefined();
  });

  it('uses OLLAMA_URL env var when set', async () => {
    process.env.OLLAMA_URL = 'http://custom-ollama:11434';
    makeOllamaResponse({
      response: JSON.stringify({ sanitizedTitle: 'T', sanitizedContent: 'C', flagged: false, flagReason: null }),
    });

    await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'u1' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('http://custom-ollama:11434'),
      expect.any(Object),
    );
    delete process.env.OLLAMA_URL;
  });

  it('falls back to localhost:11434 when OLLAMA_URL is not set', async () => {
    delete process.env.OLLAMA_URL;
    makeOllamaResponse({
      response: JSON.stringify({ sanitizedTitle: 'T', sanitizedContent: 'C', flagged: false, flagReason: null }),
    });

    await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'u1' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('http://localhost:11434'),
      expect.any(Object),
    );
  });

  it('flags result when LLM returns flagged=true with reason', async () => {
    makeOllamaResponse({
      response: JSON.stringify({
        sanitizedTitle: 'T',
        sanitizedContent: 'C',
        flagged: true,
        flagReason: 'Contains harmful content',
      }),
    });

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'u1' });

    expect(result.flagged).toBe(true);
    expect(result.flagReason).toBe('Contains harmful content');
    expect(result.llmScreened).toBe(true);
  });

  it('falls back to scrubbed title when LLM returns empty sanitizedTitle', async () => {
    makeScrubSecrets(mockScrubResult({ title: 'Fallback Title' }));
    makeOllamaResponse({
      response: JSON.stringify({ sanitizedTitle: '', sanitizedContent: 'LLM C', flagged: false, flagReason: null }),
    });

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'u1' });

    expect(result.sanitizedTitle).toBe('Fallback Title');
  });

  it('falls back to scrubbed content when LLM returns empty sanitizedContent', async () => {
    makeScrubSecrets(mockScrubResult({ content: 'Fallback Content' }));
    makeOllamaResponse({
      response: JSON.stringify({ sanitizedTitle: 'LLM T', sanitizedContent: '', flagged: false, flagReason: null }),
    });

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'u1' });

    expect(result.sanitizedContent).toBe('Fallback Content');
  });

  it('returns flagged scrub-only result when ollama returns non-ok status', async () => {
    makeOllamaResponse({}, false, 503);

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'u1' });

    expect(result.flagged).toBe(true);
    expect(result.llmScreened).toBe(false);
    expect(result.flagReason).toContain('Ollama error: 503');
  });

  it('returns flagged scrub-only result when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network timeout'));

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'u1' });

    expect(result.flagged).toBe(true);
    expect(result.llmScreened).toBe(false);
    expect(result.flagReason).toContain('network timeout');
    expect(result.flagReason).toContain('human review');
  });

  it('includes "unknown" in flagReason when error has no message', async () => {
    mockFetch.mockRejectedValueOnce({ weird: true });

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'u1' });

    expect(result.flagReason).toContain('unknown');
  });

  it('strips markdown fences from LLM response before JSON.parse', async () => {
    makeOllamaResponse({
      response: '```json\n{"sanitizedTitle":"T","sanitizedContent":"C","flagged":false,"flagReason":null}\n```',
    });

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'u1' });

    expect(result.sanitizedTitle).toBe('T');
    expect(result.llmScreened).toBe(true);
  });

  it('preserves replacements from scrub layer regardless of LLM result', async () => {
    makeScrubSecrets(mockScrubResult({
      replacements: [{ category: 'secret', count: 5 }],
    }));
    makeOllamaResponse({
      response: JSON.stringify({ sanitizedTitle: 'T', sanitizedContent: 'C', flagged: false, flagReason: null }),
    });

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'u1' });

    expect(result.replacements).toEqual([{ category: 'secret', count: 5 }]);
  });
});

describe('sanitizeDocument — community level, openai credential', () => {
  const openaiCredential = { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-test' };

  beforeEach(() => {
    vi.mocked(resolveForDiagnostics).mockReturnValue(openaiCredential as never);
  });

  it('calls openai endpoint and returns LLM-screened result', async () => {
    makeOpenAIResponse({
      choices: [{ message: { content: JSON.stringify({ sanitizedTitle: 'OAI T', sanitizedContent: 'OAI C', flagged: false, flagReason: null }) } }],
    });

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'u1' });

    expect(result.sanitizedTitle).toBe('OAI T');
    expect(result.sanitizedContent).toBe('OAI C');
    expect(result.llmScreened).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns flagged result when openai returns non-ok status', async () => {
    makeOpenAIResponse({}, false, 401);

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'u1' });

    expect(result.flagged).toBe(true);
    expect(result.llmScreened).toBe(false);
    expect(result.flagReason).toContain('OpenAI error: 401');
  });

  it('uses Bearer auth header with apiKey', async () => {
    makeOpenAIResponse({
      choices: [{ message: { content: JSON.stringify({ sanitizedTitle: 'T', sanitizedContent: 'C', flagged: false, flagReason: null }) } }],
    });

    await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'u1' });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');
  });

  it('handles missing choices gracefully by falling back to scrubbed values', async () => {
    makeScrubSecrets(mockScrubResult({ title: 'Safe T', content: 'Safe C' }));
    makeOpenAIResponse({
      choices: [{ message: { content: JSON.stringify({ sanitizedTitle: '', sanitizedContent: '', flagged: false, flagReason: null }) } }],
    });

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'u1' });

    expect(result.sanitizedTitle).toBe('Safe T');
    expect(result.sanitizedContent).toBe('Safe C');
  });
});

describe('sanitizeForCommunity — back-compat shim', () => {
  it('delegates to sanitizeDocument with community level', async () => {
    const result = await sanitizeForCommunity({ title: 't', content: 'c' });

    expect(scrubSecrets).toHaveBeenCalledWith({ title: 't', content: 'c', level: 'community' });
    expect(result).toHaveProperty('sanitizedContent');
    expect(result).toHaveProperty('sanitizedTitle');
  });

  it('passes userId to sanitizeDocument', async () => {
    vi.mocked(resolveForDiagnostics).mockReturnValue(null as never);

    const result = await sanitizeForCommunity({ title: 't', content: 'c', userId: 'user-42' });

    expect(resolveForDiagnostics).toHaveBeenCalledWith('user-42', 'paid');
  });

  it('ignores model param (not forwarded)', async () => {
    const result = await sanitizeForCommunity({ title: 't', content: 'c', model: 'gpt-4', userId: undefined });

    expect(result.llmScreened).toBe(false);
  });

  it('returns result with both sanitizedContent and sanitizedTitle keys', async () => {
    makeScrubSecrets(mockScrubResult({ title: 'T', content: 'C' }));

    const result = await sanitizeForCommunity({ title: 'T', content: 'C' });

    expect(result.sanitizedTitle).toBe('T');
    expect(result.sanitizedContent).toBe('C');
  });
});

describe('sanitizeDocument — flagReason undefined vs string', () => {
  it('flagReason is undefined (not null) when LLM returns flagReason: null', async () => {
    vi.mocked(resolveForDiagnostics).mockReturnValue({ provider: 'ollama', model: 'm', apiKey: '' } as never);
    makeOllamaResponse({
      response: JSON.stringify({ sanitizedTitle: 'T', sanitizedContent: 'C', flagged: false, flagReason: null }),
    });

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'u1' });

    expect(result.flagReason).toBeUndefined();
  });

  it('flagReason is the string when LLM returns a non-empty flagReason', async () => {
    vi.mocked(resolveForDiagnostics).mockReturnValue({ provider: 'ollama', model: 'm', apiKey: '' } as never);
    makeOllamaResponse({
      response: JSON.stringify({ sanitizedTitle: 'T', sanitizedContent: 'C', flagged: true, flagReason: 'Harmful' }),
    });

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'u1' });

    expect(result.flagReason).toBe('Harmful');
  });
});

describe('sanitizeDocument — foundSecrets propagation', () => {
  it('reflects foundSecrets=false from scrub layer on internal path', async () => {
    makeScrubSecrets(mockScrubResult({ foundSecrets: false }));

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'internal' });

    expect(result.foundSecrets).toBe(false);
  });

  it('reflects foundSecrets=true from scrub layer on community LLM path', async () => {
    makeScrubSecrets(mockScrubResult({ foundSecrets: true }));
    vi.mocked(resolveForDiagnostics).mockReturnValue({ provider: 'ollama', model: 'm', apiKey: '' } as never);
    makeOllamaResponse({
      response: JSON.stringify({ sanitizedTitle: 'T', sanitizedContent: 'C', flagged: false, flagReason: null }),
    });

    const result = await sanitizeDocument({ title: 't', content: 'c', level: 'community', userId: 'u1' });

    expect(result.foundSecrets).toBe(true);
  });
});