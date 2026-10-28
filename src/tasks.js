'use strict';

// "말로 일 시키기": send a natural-language instruction from the office page
// to an agent. A new run starts headless (claude -p / codex exec / gemini -p)
// in a project folder that already appears in the office, or continues an
// existing session (--resume). The run writes its own session log, so the
// agent shows up in the office like any other session.
//
// Safety:
// - POST only, with a custom header a cross-site page can't send without a
//   CORS preflight (same guard as /api/shutdown), plus an Origin check.
// - Folders are limited to the cwd of sessions the watcher already knows.
// - Permissions are narrow by default: Claude may edit files but not run
//   Bash (acceptEdits; headless runs can't ask, so anything else is denied),
//   Codex runs in the workspace-write sandbox, Gemini auto-accepts edits only.
// - Set WMAD_NO_TASKS=1 to turn the feature off.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const LOG_DIR = path.join(os.homedir(), '.whatsmyagentdoing', 'tasks');
const MAX_PROMPT = 8000;
const MAX_RUNNING = 6;
const AGENTS = ['claude', 'codex', 'gemini'];

const tasks = []; // newest first, in memory only
let seq = 0;

function enabled(opts) {
  return !opts.demo && process.env.WMAD_NO_TASKS !== '1';
}

function childEnv() {
  const env = { ...process.env };
  // Claude Code refuses to start inside another Claude Code session; the
  // dashboard is often launched from one (/myoffice), so drop those markers.
  for (const k of Object.keys(env)) {
    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k];
  }
  const extra = [
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.claude', 'local'),
    path.join(os.homedir(), '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
  env.PATH = [env.PATH || '', ...extra].filter(Boolean).join(path.delimiter);
  return env;
}

// Never let the instruction be read as a command-line flag.
const safePrompt = (p) => (p.startsWith('-') ? ' ' + p : p);

// Shell commands a headless run may use without asking (read-only git plus
// fetch/pull). Everything else stays denied because nobody can approve it.
// Agents often write `git -C <folder> pull`, so allow that form too, but only
// for the run's own folder.
const GIT_SUBS = ['status', 'log', 'diff', 'show', 'fetch', 'pull', 'rev-parse', 'ls-files', 'blame'];
function claudeAllowed(cwd) {
  const rules = [];
  for (const sub of GIT_SUBS) {
    rules.push(`Bash(git ${sub}:*)`);
    if (cwd && !/[,"]/.test(cwd)) rules.push(`Bash(git -C ${cwd} ${sub}:*)`, `Bash(git -C "${cwd}" ${sub}:*)`);
  }
  rules.push('Bash(git remote -v:*)', 'Bash(ls:*)', 'Bash(pwd:*)', 'Bash(cd:*)');
  return rules.join(',');
}
// A print-mode run exits as soon as the main agent answers, which kills any
// subagent still running in the background. Tell the agent up front.
const CLAUDE_RULE = [
  '이 요청은 사무실 대화창에서 보낸 1회성 실행이다. 최종 답을 마치는 순간 프로세스가 종료되고, 그때 아직 돌고 있는 하위 에이전트는 모두 끊긴다.',
  '그러니 하위 에이전트(Task/Agent)를 쓸 때는 절대 백그라운드(run_in_background)로 돌리지 말고, 모든 하위 에이전트의 결과를 받은 뒤에 최종 답을 해라. "진행 중입니다, 나중에 정리하겠다" 같은 중간 보고로 끝내지 마라.',
  '자동 허용된 셸 명령은 git status/log/diff/show/fetch/pull/rev-parse/ls-files/blame, git remote -v, ls, pwd, cd 이다. 그 밖의 명령은 사용자에게 사무실 대화창으로 승인을 요청하게 되고, 사용자가 거부하거나 5분 안에 답하지 않으면 거부된다. 꼭 필요할 때만 써라.',
  'git은 `git -C` 없이 지금 작업 폴더에서 바로 `git pull`, `git log`처럼 실행해라. git은 지금 작업 폴더 안에서만 된다. 다른 폴더로 이동해서 git을 실행하는 것도 승인이 필요하다. 파일 수정은 허용된다.',
].join(' ');

function command(agent, prompt, resumeId, fork, cwd, settings) {
  const p = safePrompt(prompt);
  if (agent === 'claude') {
    const args = ['-p', p, '--permission-mode', 'acceptEdits', '--append-system-prompt', CLAUDE_RULE];
    if (resumeId) args.unshift('--resume', resumeId);
    if (resumeId && fork) args.push('--fork-session');
    if (settings) args.push('--settings', settings);
    args.push('--allowedTools', claudeAllowed(cwd)); // keep last: it takes a list
    return ['claude', args];
  }
  if (agent === 'codex') {
    // workspace-write runs commands inside the folder; allow network so git pull works.
    const base = ['exec', '--sandbox', 'workspace-write', '-c', 'sandbox_workspace_write.network_access=true', '--skip-git-repo-check'];
    return ['codex', resumeId ? [...base, 'resume', resumeId, p] : [...base, p]];
  }
  if (agent === 'gemini') {
    const args = ['-p', p, '--approval-mode', 'auto_edit'];
    if (resumeId) args.unshift('--resume', resumeId);
    return ['gemini', args];
  }
  return null;
}

function publicTask(t) {
  const { child, ...rest } = t;
  return rest;
}

function list() {
  return tasks.slice(0, 20).map(publicTask);
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function originOk(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try {
    const h = new URL(o).hostname;
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(h);
  } catch { return false; }
}

// ---- 대화창 승인 ----
// Each Claude run gets a PermissionRequest HTTP hook pointing back here. When the
// agent wants something outside the allow list, the hook request waits until
// you press 허용 / 항상 허용 / 거부 in the office chat (or 5 minutes pass).
const APPROVAL_TIMEOUT = 5 * 60_000;
const approvals = new Map();
let aseq = 0;

function hookSettings(base, taskId) {
  return JSON.stringify({
    hooks: {
      PermissionRequest: [{
        hooks: [{
          type: 'http',
          url: `${base}/api/permission?task=${encodeURIComponent(taskId)}`,
          timeout: 600,
          headers: { 'x-whatsmyagentdoing': 'permission' },
        }],
      }],
    },
  });
}

function decision(behavior, message, updatedPermissions) {
  const d = { behavior };
  if (behavior === 'deny' && message) d.message = message;
  if (behavior === 'allow' && updatedPermissions && updatedPermissions.length) d.updatedPermissions = updatedPermissions;
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: d } };
}

function summarize(tool, input) {
  const i = input || {};
  if (tool === 'Bash') return String(i.command || '');
  if (i.file_path) return String(i.file_path);
  if (i.url) return String(i.url);
  if (i.path) return String(i.path);
  if (i.pattern) return String(i.pattern);
  const s = JSON.stringify(i);
  return s.length > 300 ? s.slice(0, 300) + '…' : s;
}

function askUser(t, input, res) {
  const id = `p${Date.now().toString(36)}${++aseq}`;
  const tool = String(input.tool_name || '?');
  const a = {
    id, taskId: t.id, project: t.project, agent: t.agent, key: t.key, tool,
    detail: summarize(tool, input.tool_input), why: input.tool_input && input.tool_input.description ? String(input.tool_input.description) : '',
    at: Date.now(), suggestions: Array.isArray(input.permission_suggestions) ? input.permission_suggestions : [],
  };
  a.reply = (body) => {
    if (!approvals.has(id)) return;
    approvals.delete(id);
    clearTimeout(a.timer);
    t.waiting = Math.max(0, (t.waiting || 1) - 1);
    try { json(res, 200, body); } catch {}
  };
  a.timer = setTimeout(() => a.reply(decision('deny', '사용자가 5분 안에 답하지 않아 거부됐어요')), APPROVAL_TIMEOUT);
  res.on('close', () => { if (approvals.has(id) && !res.writableEnded) { approvals.delete(id); clearTimeout(a.timer); t.waiting = Math.max(0, (t.waiting || 1) - 1); } });
  approvals.set(id, a);
  t.waiting = (t.waiting || 0) + 1;
}

function decide(id, d) {
  const a = approvals.get(id);
  if (!a) return false;
  if (d === 'allow') a.reply(decision('allow'));
  else if (d === 'always') {
    // Remember for the rest of this run only (destination: session).
    const ups = a.suggestions.filter((x) => x && x.type === 'addRules').map((x) => ({ ...x, destination: 'session' }));
    a.reply(decision('allow', null, ups));
  } else a.reply(decision('deny', '사용자가 대화창에서 거부했어요'));
  return true;
}

function dropApprovals(taskId, why) {
  for (const a of [...approvals.values()]) if (a.taskId === taskId) a.reply(decision('deny', why));
}

function listApprovals() {
  return [...approvals.values()].map(({ id, taskId, project, agent, key, tool, detail, why, at }) => ({ id, taskId, project, agent, key, tool, detail, why, at }));
}

function start({ agent, cwd, prompt, resumeId, label, key, fork, base }) {
  const id = `${Date.now().toString(36)}-${++seq}`;
  const cmd = command(agent, prompt, resumeId, fork, cwd, base ? hookSettings(base, id) : null);
  if (!cmd) throw new Error('지원하지 않는 에이전트예요');
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, `${id}-${agent}.log`);
  const out = fs.openSync(logFile, 'a');
  fs.writeSync(out, `# ${new Date().toISOString()} ${agent} ${resumeId ? 'resume ' + resumeId : 'new'}\n# cwd: ${cwd}\n# prompt: ${prompt}\n\n`);
  const t = {
    id, agent, cwd, label, key: key || null, fork: !!fork, reply: '', resumeId: resumeId || null,
    project: path.basename(cwd),
    prompt: prompt.length > 200 ? prompt.slice(0, 200) + '…' : prompt,
    status: 'starting', startedAt: Date.now(), endedAt: null, exitCode: null,
    tail: '', logFile,
  };
  tasks.unshift(t);
  if (tasks.length > 50) tasks.length = 50;

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd[0], cmd[1], { cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      t.status = 'error'; t.tail = String(e.message || e); t.endedAt = Date.now();
      fs.closeSync(out);
      return reject(e);
    }
    t.child = child;
    const keep = (buf) => {
      fs.writeSync(out, buf);
      t.tail = (t.tail + buf.toString('utf8')).slice(-1500);
    };
    child.stdout.on('data', (buf) => { keep(buf); if (t.reply.length < 20000) t.reply += buf.toString('utf8'); });
    child.stderr.on('data', keep);
    child.once('spawn', () => { t.status = 'running'; t.pid = child.pid; resolve(t); });
    child.once('error', (e) => {
      t.status = 'error';
      t.tail = e.code === 'ENOENT' ? `${cmd[0]} 명령을 찾을 수 없어요 (설치나 PATH 확인 필요)` : String(e.message || e);
      t.endedAt = Date.now();
      try { fs.closeSync(out); } catch {}
      reject(new Error(t.tail));
    });
    child.once('close', (code) => {
      dropApprovals(t.id, '작업이 끝났어요');
      if (t.status === 'error') return;
      t.exitCode = code;
      t.status = code === 0 ? 'done' : 'failed';
      t.endedAt = Date.now();
      delete t.child;
      try { fs.closeSync(out); } catch {}
    });
  });
}

// Returns true if it handled the request.
function handle(req, res, url, watcher, opts) {
  if (url.pathname === '/api/tasks' && req.method === 'GET') {
    json(res, 200, { enabled: enabled(opts), tasks: list(), approvals: listApprovals() });
    return true;
  }
  if (url.pathname === '/api/permission' && req.method === 'POST') {
    // Called by Claude Code's PermissionRequest HTTP hook of a run we started.
    if (req.headers['x-whatsmyagentdoing'] !== 'permission') { res.writeHead(403).end(); return true; }
    const t = tasks.find((x) => x.id === url.searchParams.get('task'));
    readBody(req, 512 * 1024).then((raw) => {
      let input = {};
      try { input = JSON.parse(raw); } catch {}
      if (!t || !t.child) return json(res, 200, decision('deny', '작업이 이미 끝났어요'));
      askUser(t, input, res);
    }, () => json(res, 200, decision('deny', '요청이 너무 커요')));
    return true;
  }
  if (url.pathname === '/api/permission/decide' && req.method === 'POST') {
    if (req.headers['x-whatsmyagentdoing'] !== 'task' || !originOk(req)) { res.writeHead(403).end(); return true; }
    const ok = decide(url.searchParams.get('id'), url.searchParams.get('d'));
    json(res, ok ? 200 : 404, { ok, error: ok ? undefined : '이미 처리됐거나 없는 요청이에요' });
    return true;
  }
  if (url.pathname === '/api/tasks/stop' && req.method === 'POST') {
    if (req.headers['x-whatsmyagentdoing'] !== 'task' || !originOk(req)) { res.writeHead(403).end(); return true; }
    const t = tasks.find((x) => x.id === url.searchParams.get('id'));
    if (!t || !t.child) { json(res, 404, { ok: false, error: '실행 중인 작업이 없어요' }); return true; }
    dropApprovals(t.id, '사용자가 작업을 중지했어요');
    t.child.kill('SIGTERM');
    t.status = 'stopped';
    json(res, 200, { ok: true });
    return true;
  }
  if (url.pathname !== '/api/task' || req.method !== 'POST') return false;

  if (req.headers['x-whatsmyagentdoing'] !== 'task' || !originOk(req)) { res.writeHead(403).end(); return true; }
  if (!enabled(opts)) { json(res, 403, { ok: false, error: opts.demo ? '데모 모드에서는 일을 보낼 수 없어요' : '이 기능이 꺼져 있어요 (WMAD_NO_TASKS)' }); return true; }

  readBody(req).then(async (raw) => {
    let body;
    try { body = JSON.parse(raw); } catch { return json(res, 400, { ok: false, error: '잘못된 요청이에요' }); }
    const prompt = String(body.prompt || '').trim();
    if (!prompt) return json(res, 400, { ok: false, error: '시킬 일을 적어주세요' });
    if (prompt.length > MAX_PROMPT) return json(res, 400, { ok: false, error: '지시가 너무 길어요' });
    if (tasks.filter((t) => t.status === 'running' || t.status === 'starting').length >= MAX_RUNNING) {
      return json(res, 429, { ok: false, error: `동시에 ${MAX_RUNNING}개까지만 보낼 수 있어요. 끝날 때까지 기다려 주세요` });
    }
    const sessions = watcher.sessions();

    let agent, cwd, resumeId = null, label, key = null, fork = false;
    if (body.key) {
      // Continue an existing session.
      const s = sessions.find((x) => `${x.agent}:${x.id}` === body.key);
      if (!s) return json(res, 404, { ok: false, error: '그 에이전트를 찾을 수 없어요' });
      if (s.subagent) return json(res, 400, { ok: false, error: '서브에이전트에게는 직접 보낼 수 없어요' });
      if (!AGENTS.includes(s.agent)) return json(res, 400, { ok: false, error: '이 에이전트는 아직 지원하지 않아요' });
      if (!s.cwd) return json(res, 400, { ok: false, error: '작업 폴더를 알 수 없는 세션이에요' });
      agent = s.agent; cwd = s.cwd;
      resumeId = s.agent === 'gemini' ? (s.sessionId || s.id) : s.id;
      label = path.basename(s.cwd);
      key = body.key;
      // Busy in the user's own terminal right now? Don't write into the same
      // log at the same time: Claude gets a forked copy, the others wait.
      const busy = ['thinking', 'tool', 'typing'].includes(s.status) && Date.now() - (s.lastEventAt || s.mtime || 0) < 120000;
      if (busy && agent === 'claude') fork = true;
      else if (busy) return json(res, 409, { ok: false, error: `${label}은(는) 지금 터미널에서 일하는 중이에요. 끝나면 다시 보내주세요` });
      if (tasks.some((t) => t.resumeId === resumeId && (t.status === 'running' || t.status === 'starting'))) {
        return json(res, 409, { ok: false, error: '이 에이전트에게 보낸 일이 아직 진행 중이에요' });
      }
    } else {
      // New run in a known project folder.
      agent = String(body.agent || 'claude');
      if (!AGENTS.includes(agent)) return json(res, 400, { ok: false, error: '지원하지 않는 에이전트예요' });
      cwd = String(body.cwd || '');
      const known = new Set(sessions.map((x) => x.cwd).filter(Boolean));
      if (!known.has(cwd)) return json(res, 400, { ok: false, error: '사무실에 있는 프로젝트 폴더만 고를 수 있어요' });
      label = path.basename(cwd);
    }
    if (!fs.existsSync(cwd)) return json(res, 400, { ok: false, error: `폴더가 없어요: ${cwd}` });

    try {
      const t = await start({ agent, cwd, prompt, resumeId, label, key, fork, base: `http://${req.headers.host}` });
      json(res, 200, { ok: true, task: publicTask(t) });
    } catch (e) {
      json(res, 500, { ok: false, error: String(e.message || e) });
    }
  }, () => json(res, 413, { ok: false, error: '요청이 너무 커요' }));
  return true;
}

module.exports = { handle, list, command, childEnv, listApprovals };
