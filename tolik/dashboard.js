'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const home = path.join(__dirname, '..', '.tolik');
const runPattern = /^\d{8}T\d{6}\.\d+Z$/;
const page = fs.readFileSync(path.join(__dirname, 'dashboard.html'));
const port = Number(process.argv[2] ?? 3051);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Usage: node tolik/dashboard.js [port]');
}

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

function tail(file, bytes) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    const count = fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString('utf8', 0, count).split('\n').slice(start ? 1 : 0).filter(Boolean);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function latestSnapshot(run) {
  const final = readJSON(path.join(run, 'final.json'));
  if (final) return final;
  const lines = tail(path.join(run, 'observations.jsonl'), 1024 * 1024);
  for (const line of lines.reverse()) {
    try {
      return JSON.parse(line);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return readJSON(path.join(run, 'initial.json')) ?? {};
}

// Display selected execution events rather than raw process output or model inputs.
function executionLog(run) {
  const entries = [];
  for (const line of tail(path.join(run, 'body.log'), 192 * 1024)) {
    if (line.startsWith('{')) {
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      const mutation = record.structureMutation;
      if (mutation) {
        const { x, y, z } = mutation.position ?? {};
        const block = mutation.operation === 'dig' ? mutation.before?.name : mutation.after?.name;
        entries.push([mutation.operation, block, [x, y, z].join(', '), mutation.status].join('  '));
      } else if (record.step?.action) {
        const step = record.step;
        const target = typeof step.target === 'string' ? step.target : step.block ?? step.material;
        entries.push([step.action, target, step.count ? '× ' + step.count : null].filter(Boolean).join('  '));
      } else if (record.sessionReady) {
        entries.push('Connected to Minecraft');
      } else if (record.communityStop) {
        entries.push('Session ended: ' + record.communityStop);
      }
    } else if (/^(?:\[mine\]|\[build\]|\[craft\]|\[one way\]|Blocked:)/.test(line)) {
      entries.push(line.slice(0, 360));
    }
  }
  return entries.filter((line, i) => line !== entries[i - 1])
    .filter(line => !/password|secret|token|api.key|authorization|\/(?:login|reg)\b/i.test(line))
    .slice(-90);
}

function plannerLog(run) {
  const dir = path.join(run, 'planner');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => /^\d+$/.test(name))
    .sort((a, b) => Number(a) - Number(b))
    .map(name => {
      const output = path.join(dir, name, 'output.json');
      const result = readJSON(output);
      const plan = result?.plan;
      if (!plan) return null;
      return {
        turn: Number(name),
        at: fs.statSync(output).mtimeMs,
        intent: plan.intent,
        action: plan.cancel ? 'cancel' : plan.goal?.kind ?? plan.inspect?.kind,
        say: safeText(plan.say),
        proposal: { ...plan, say: safeText(plan.say) },
        usage: result.usage,
        calls: result.api_calls,
      };
    })
    .filter(Boolean);
}

function safeText(value) {
  return typeof value === 'string' ? value
    .replace(/\/(?:l|login|reg|register|changepassword)\b[^\r\n]*/gi, '[authentication command hidden]')
    .slice(0, 1200) : null;
}

let evidence;
function sessionEvents(id) {
  const result = { chat: [], results: [], memoryAvailable: false };
  if (!id) return result;
  try {
    if (!evidence) {
      const { DatabaseSync } = require('node:sqlite');
      const file = readJSON(path.join(home, 'config.json'))?.memory;
      if (!file) return result;
      evidence = new DatabaseSync(file, { readOnly: true });
    }
    const read = evidence.prepare(`SELECT data FROM evidence
      WHERE json_extract(data, '$.session_id') = ?
      AND json_extract(data, '$.type') IN (?, ?, ?, ?)
      ORDER BY rowid DESC LIMIT 60`);
    const rows = (...kinds) => read.all(id, ...kinds).reverse().map(row => JSON.parse(row.data));
    result.chat = rows('chat', 'voice', 'speech', 'voice_report')
      .filter(event => event.type !== 'voice_report').map(event => ({
        at: event.observed_at, user: event.user ?? 'TolikScheben',
        text: safeText(event.msg ?? event.text), status: event.receipt?.status, type: event.type,
      }));
    result.results = rows('goal', 'goal_ack', 'planner_error', 'plan_withheld').map(event => ({
      at: event.observed_at, type: event.type, goal: event.goal_id,
      status: event.status ?? event.receipt?.status, verified: event.verified === true,
      detail: safeText(event.summary ?? event.reason ?? event.receipt?.reason ?? event.error),
    }));
    result.memoryAvailable = true;
  } catch (error) {
    // The current run remains visible if SQLite is unavailable or briefly busy.
    if (evidence && error.code !== 'ERR_SQLITE_ERROR') {
      evidence.close();
      evidence = null;
    }
  }
  return result;
}

function readLedger(file) {
  return tail(file, 128 * 1024).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function captures(run) {
  const dir = path.join(run, 'vision');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => /^capture-[0-9a-f]{32}\.json$/.test(name))
    .flatMap(name => {
      const frame = readJSON(path.join(dir, name));
      if (!frame) return [];
      return [{ ...frame, file: name.replace(/\.json$/, '.png') }];
    }).sort((a, b) => b.captured_at - a.captured_at).slice(0, 4);
}

function state(selected) {
  const current = readJSON(path.join(home, 'status.json')) ?? {};
  const activeRun = path.basename(current.run_dir ?? '');
  const runName = selected ?? activeRun;
  const run = runPattern.test(runName) ? path.join(home, 'runs', runName) : null;
  const session = selected && selected !== activeRun ? readJSON(path.join(run, 'summary.json')) : current;
  if (!session) return null;
  const snapshot = run ? latestSnapshot(run) : {};
  const execution = snapshot.execution ?? {};
  const progress = execution.build_progress ?? snapshot.build_progress;
  const recent = snapshot.observed_at && Date.now() / 1000 - snapshot.observed_at < 15;
  const status = session.status === 'running' && !recent ? 'stale' : session.status ?? 'idle';

  const planner = run ? plannerLog(run) : [];
  const attempts = run ? readLedger(path.join(run, 'body', 'http-attempts.jsonl')) : [];
  const usage = run ? readLedger(path.join(run, 'body', 'http-usage.jsonl')) : [];
  const frames = run ? captures(run) : [];
  const { chat, results, memoryAvailable } = sessionEvents(session.session_id);
  const capabilities = Object.fromEntries(Object.entries(snapshot).filter(([key]) => key.endsWith('_capabilities')));
  return {
    status, run: runName, model: session.model, deadline: session.deadline,
    activeRun, startedAt: session.started_at, stoppedAt: session.stopped_at, reason: safeText(session.reason),
    runs: fs.existsSync(path.join(home, 'runs')) ? fs.readdirSync(path.join(home, 'runs'))
      .filter(name => runPattern.test(name) && (name === activeRun || fs.existsSync(path.join(home, 'runs', name, 'summary.json'))))
      .sort().reverse() : [],
    connected: status === 'running' && snapshot.connected === true,
    observedAt: snapshot.observed_at ?? null,
    health: snapshot.health, food: snapshot.food, position: snapshot.position,
    dimension: snapshot.dimension, biome: snapshot.biome, world: snapshot.world_id,
    terrain: { ground: snapshot.ground_block, feet: snapshot.feet_block, head: snapshot.head_block },
    players: (snapshot.player_identities ?? []).map(({ name }) => ({ name, position: snapshot.player_positions?.[name] })),
    entities: snapshot.nearby_entities ?? [], inventory: snapshot.inventory ?? {},
    builds: snapshot.builds ?? [], edits: snapshot.pending_edits ?? [],
    capabilities, authority: snapshot.mutation_authority,
    execution, reports: snapshot.body_reports ?? [], lastResult: snapshot.last_result,
    chat, results, memoryAvailable, frames,
    usage: { plannerCalls: session.planner_calls ?? planner.length, plannerLimit: session.max_calls,
      jevAttempts: attempts.length, jevLimit: session.max_jev, ledger: usage },
    action: execution.step?.action, request: execution.request,
    detail: execution.native_feedback?.current_attempts?.find(entry => entry.outcome === 'blocked')?.reason?.slice(0, 220),
    progress: progress?.planned_blocks ? {
      matched: progress.matched_blocks ?? 0,
      total: progress.planned_blocks,
      placed: progress.placements_recorded ?? 0,
    } : null,
    body: run ? executionLog(run) : [],
    planner,
  };
}

http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; connect-src 'self'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
  if (!['localhost:' + port, '127.0.0.1:' + port].includes(req.headers.host)) {
    res.writeHead(403).end();
    return;
  }
  if (req.method !== 'GET') {
    res.writeHead(405, { Allow: 'GET' }).end();
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
  } else if (url.pathname === '/state') {
    try {
      const selected = url.searchParams.get('run');
      if ([...url.searchParams.keys()].some(key => key !== 'run') || (selected !== null && !runPattern.test(selected))) {
        res.writeHead(404).end();
        return;
      }
      const data = state(selected);
      if (!data) { res.writeHead(404).end(); return; }
      const payload = JSON.stringify(data);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(payload);
    } catch {
      res.writeHead(503).end();
    }
  } else if (/^\/vision\/\d{8}T\d{6}\.\d+Z\/capture-[0-9a-f]{32}\.png$/.test(url.pathname)) {
    const [, , run, name] = url.pathname.split('/');
    const directory = path.join(home, 'runs', run, 'vision');
    try {
      const file = path.join(directory, name);
      const runsRoot = fs.realpathSync(path.join(home, 'runs'));
      const resolved = fs.realpathSync(file);
      if (resolved !== path.join(runsRoot, run, 'vision', name) || fs.statSync(resolved).size > 2 * 1024 * 1024) {
        res.writeHead(404).end();
        return;
      }
      const image = fs.readFileSync(resolved);
      if (!image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': 'image/png' }).end(image);
    } catch {
      res.writeHead(404).end();
    }
  } else {
    res.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => {
  console.log('Tolik dashboard: http://localhost:' + port);
});
