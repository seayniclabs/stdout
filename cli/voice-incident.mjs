#!/usr/bin/env node
/**
 * StdOut Voice Incident CLI (BB15)
 *
 * Pipeline: voice query → Sonique STT → StdOut AI analysis → spoken summary (TTS)
 *
 * Usage:
 *   stdout-voice "High memory on prod — what's running?"
 *   stdout-voice --text "disk full on api host"
 *   stdout-voice --audio clip.wav
 *   stdout-voice --record 5
 *   stdout-voice --no-speak --json --text "nginx 502"
 *
 * Env:
 *   STDOUT_URL          Base URL (default http://localhost:8112)
 *   STDOUT_TOKEN        Bearer token (stdout_scan_…)
 *   STDOUT_USER_ID      User id when not using a token
 *   SONIQUE_STT_URL     Speaches / Whisper base (default http://127.0.0.1:8000)
 *   SONIQUE_TTS_URL     Kokoro / Piper / caal-tts base (default http://127.0.0.1:8880)
 *   SONIQUE_TTS_VOICE   Voice id (default af_bella / bm_george depending on backend)
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const DEFAULT_STDOUT_URL = process.env.STDOUT_URL || 'http://localhost:8112';
const DEFAULT_STT_URL = process.env.SONIQUE_STT_URL || 'http://127.0.0.1:8000';
const DEFAULT_TTS_URL = process.env.SONIQUE_TTS_URL || 'http://127.0.0.1:8880';

function usage(exitCode = 0) {
  const text = `StdOut Voice Incident CLI — voice query → AI analysis → spoken summary

Usage:
  stdout-voice [options] [query words...]

Options:
  --text <query>       Use text (skip STT)
  --audio <file>       Transcribe audio file via Sonique STT
  --record [secs]      Record from mic (default 5s; requires sox or ffmpeg)
  --no-speak           Print summary only (skip TTS)
  --json               Print full JSON result
  --url <url>          StdOut base URL (env STDOUT_URL)
  --token <token>      API token (env STDOUT_TOKEN)
  --user-id <id>       User id (env STDOUT_USER_ID)
  --stt-url <url>      Sonique STT base (env SONIQUE_STT_URL)
  --tts-url <url>      Sonique TTS base (env SONIQUE_TTS_URL)
  --help               Show this help

Examples:
  stdout-voice --text "High memory on prod — what's running?"
  stdout-voice --record 4
  STDOUT_TOKEN=stdout_scan_… stdout-voice --audio incident.wav
`;
  process.stdout.write(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const opts = {
    text: null,
    audio: null,
    record: null,
    speak: true,
    json: false,
    url: DEFAULT_STDOUT_URL,
    token: process.env.STDOUT_TOKEN || null,
    userId: process.env.STDOUT_USER_ID || null,
    sttUrl: DEFAULT_STT_URL,
    ttsUrl: DEFAULT_TTS_URL,
    positional: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') usage(0);
    else if (a === '--text') opts.text = argv[++i];
    else if (a === '--audio') opts.audio = argv[++i];
    else if (a === '--record') {
      const next = argv[i + 1];
      if (next && !next.startsWith('-') && /^\d+(\.\d+)?$/.test(next)) {
        opts.record = Number(next);
        i++;
      } else {
        opts.record = 5;
      }
    } else if (a === '--no-speak') opts.speak = false;
    else if (a === '--json') opts.json = true;
    else if (a === '--url') opts.url = argv[++i];
    else if (a === '--token') opts.token = argv[++i];
    else if (a === '--user-id') opts.userId = argv[++i];
    else if (a === '--stt-url') opts.sttUrl = argv[++i];
    else if (a === '--tts-url') opts.ttsUrl = argv[++i];
    else if (a.startsWith('-')) {
      process.stderr.write(`Unknown option: ${a}\n`);
      usage(1);
    } else {
      opts.positional.push(a);
    }
  }

  if (!opts.text && opts.positional.length) {
    opts.text = opts.positional.join(' ');
  }
  return opts;
}

function which(cmd) {
  const r = spawnSync('which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

async function recordMic(seconds) {
  const dir = mkdtempSync(join(tmpdir(), 'stdout-voice-'));
  const out = join(dir, 'capture.wav');
  const sox = which('sox');
  const ffmpeg = which('ffmpeg');

  process.stderr.write(`Recording ${seconds}s… speak now.\n`);

  if (sox) {
    const r = spawnSync(
      sox,
      ['-d', '-r', '16000', '-c', '1', '-b', '16', out, 'trim', '0', String(seconds)],
      { stdio: 'inherit' },
    );
    if (r.status !== 0) throw new Error('sox recording failed');
  } else if (ffmpeg) {
    const r = spawnSync(
      ffmpeg,
      [
        '-y', '-f', 'avfoundation', '-i', ':0',
        '-t', String(seconds), '-ac', '1', '-ar', '16000', out,
      ],
      { stdio: ['ignore', 'ignore', 'inherit'] },
    );
    if (r.status !== 0) {
      // Linux fallback
      const r2 = spawnSync(
        ffmpeg,
        ['-y', '-f', 'alsa', '-i', 'default', '-t', String(seconds), '-ac', '1', '-ar', '16000', out],
        { stdio: ['ignore', 'ignore', 'inherit'] },
      );
      if (r2.status !== 0) throw new Error('ffmpeg recording failed (install sox for simpler capture)');
    }
  } else {
    throw new Error('Mic recording requires sox or ffmpeg on PATH');
  }

  return { path: out, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

async function transcribe(sttUrl, audioPath) {
  const base = sttUrl.replace(/\/$/, '');
  const form = new FormData();
  const buf = readFileSync(audioPath);
  form.append('file', new Blob([buf], { type: 'audio/wav' }), 'audio.wav');
  form.append('model', 'whisper-1');
  form.append('language', 'en');

  // OpenAI-compatible Speaches endpoint first, then /transcribe
  const endpoints = [
    `${base}/v1/audio/transcriptions`,
    `${base}/transcribe`,
  ];

  let lastErr = null;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        lastErr = new Error(`STT ${url} → ${res.status}`);
        continue;
      }
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = await res.json();
        const text = data.text || data.transcription || data.result || '';
        if (text.trim()) return text.trim();
      } else {
        const text = (await res.text()).trim();
        if (text) return text;
      }
      lastErr = new Error('STT returned empty transcript');
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('STT failed');
}

async function analyze(opts, query) {
  const url = `${opts.url.replace(/\/$/, '')}/app/api/comms/inbound/voice-incident`;
  const headers = { 'Content-Type': 'application/json' };
  const body = { text: query, channel: 'voice-cli' };

  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }
  if (opts.userId) {
    body.user_id = opts.userId;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.message || `StdOut analyze failed (${res.status})`);
  }
  return data;
}

async function speakSonique(ttsUrl, text) {
  const base = ttsUrl.replace(/\/$/, '');
  const voice = process.env.SONIQUE_TTS_VOICE || 'af_bella';

  // OpenAI-compatible speech (Piper / caal-tts / Kokoro Docker)
  try {
    const res = await fetch(`${base}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'tts-1',
        input: text,
        voice,
        response_format: 'wav',
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 44) return playWav(buf);
    }
  } catch {
    /* try next backend */
  }

  // SoniqueBar Kokoro service (/synthesize)
  try {
    const res = await fetch(`${base}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice }),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 44) return playWav(buf);
    }
  } catch {
    /* fall through to macOS say */
  }

  return speakLocal(text);
}

function playWav(buf) {
  const dir = mkdtempSync(join(tmpdir(), 'stdout-voice-tts-'));
  const path = join(dir, 'summary.wav');
  writeFileSync(path, buf);

  const players = [
    ['afplay', [path]],
    ['aplay', [path]],
    ['ffplay', ['-nodisp', '-autoexit', path]],
  ];

  for (const [cmd, args] of players) {
    if (!which(cmd)) continue;
    const r = spawnSync(cmd, args, { stdio: 'ignore' });
    rmSync(dir, { recursive: true, force: true });
    if (r.status === 0) return;
  }

  rmSync(dir, { recursive: true, force: true });
  throw new Error('No audio player found (afplay/aplay/ffplay)');
}

function speakLocal(text) {
  if (process.platform === 'darwin' && which('say')) {
    const r = spawnSync('say', [text], { stdio: 'ignore' });
    if (r.status === 0) return;
  }
  if (which('espeak')) {
    const r = spawnSync('espeak', [text], { stdio: 'ignore' });
    if (r.status === 0) return;
  }
  process.stderr.write('(TTS unavailable — printed summary only)\n');
}

async function promptText() {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise((resolve) => {
    rl.question('Incident query: ', resolve);
  });
  rl.close();
  return answer.trim();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let cleanup = null;
  let query = opts.text;

  try {
    if (!query && opts.audio) {
      if (!existsSync(opts.audio)) throw new Error(`Audio file not found: ${opts.audio}`);
      process.stderr.write('Transcribing…\n');
      query = await transcribe(opts.sttUrl, opts.audio);
      process.stderr.write(`Heard: ${query}\n`);
    } else if (!query && opts.record != null) {
      const rec = await recordMic(opts.record);
      cleanup = rec.cleanup;
      process.stderr.write('Transcribing…\n');
      query = await transcribe(opts.sttUrl, rec.path);
      process.stderr.write(`Heard: ${query}\n`);
    } else if (!query && !process.stdin.isTTY) {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      query = Buffer.concat(chunks).toString('utf8').trim();
    } else if (!query) {
      query = await promptText();
    }

    if (!query) {
      process.stderr.write('No query provided.\n');
      usage(1);
    }

    if (!opts.token && !opts.userId) {
      process.stderr.write(
        'Warning: no STDOUT_TOKEN or STDOUT_USER_ID — request may fail auth.\n',
      );
    }

    process.stderr.write('Analyzing…\n');
    const result = await analyze(opts, query);
    const summary = result.spoken_summary || result.response || '';

    if (opts.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`${summary}\n`);
    }

    if (opts.speak && summary) {
      process.stderr.write('Speaking…\n');
      try {
        await speakSonique(opts.ttsUrl, summary);
      } catch (err) {
        process.stderr.write(`TTS error: ${err.message}\n`);
        speakLocal(summary);
      }
    }
  } finally {
    if (cleanup) cleanup();
  }
}

main().catch((err) => {
  process.stderr.write(`Error: ${err.message || err}\n`);
  process.exit(1);
});
