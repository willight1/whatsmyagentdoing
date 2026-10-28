// 사무실 대화: Enter로 대화창을 열고 Esc로 닫는다. "김아현한테 ~해줘"처럼
// 이름을 부르면 그 에이전트가 이어서 일하고, 답이 오면 대화창과 캐릭터 머리 위
// 말풍선에 보여준다. 이름을 안 부르면 마지막으로 말한 상대에게 간다.
// 서버 쪽은 src/tasks.js. index.html의 인라인 스크립트 뒤에 로드된다.
(() => {
  'use strict';
  const HEADER = { 'content-type': 'application/json', 'x-whatsmyagentdoing': 'task' };
  const SUPPORTED = new Set(['claude', 'codex', 'gemini']);
  const NAMES = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' };
  const STORE = 'wmad.chat.v1';
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const g = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
  const sessions = () => g(() => state.data.sessions, []) || [];
  const labelOf = (s) => g(() => officeOpts.label(s), null) || s.project || NAMES[s.agent] || s.agent;
  const isPip = g(() => PIP, false);
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ---------- 스타일 ----------
  const css = document.createElement('style');
  css.textContent = `
  .wc { position: fixed; right: 20px; bottom: 20px; z-index: 70; width: 380px; height: min(520px, calc(100vh - 40px)); display: none; flex-direction: column;
    background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 12px 40px rgba(0,0,0,.25); font-size: 13px; overflow: hidden; }
  .wc.on { display: flex; }
  .wc-head { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--line); font-weight: 600; }
  .wc-head .hint { color: var(--faint); font-weight: 400; font-size: 11.5px; margin-left: auto; }
  .wc-head button { border: 0; background: none; color: var(--faint); cursor: pointer; font-size: 16px; line-height: 1; }
  .wc-log { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
  .wc-m { max-width: 85%; white-space: pre-wrap; word-break: break-word; line-height: 1.45; }
  .wc-m.me { align-self: flex-end; background: var(--tool); color: #fff; padding: 8px 11px; border-radius: 14px 14px 4px 14px; }
  .wc-m.me .to { display: block; font-size: 11px; opacity: .8; margin-bottom: 2px; }
  .wc-m.ag { align-self: flex-start; }
  .wc-m.ag .who { font-size: 11.5px; color: var(--muted); margin-bottom: 3px; display: flex; gap: 6px; align-items: center; }
  .wc-m.ag .who b { color: var(--ink); }
  .wc-m.ag .txt { background: var(--bg); border: 1px solid var(--line); padding: 8px 11px; border-radius: 14px 14px 14px 4px; max-height: 320px; overflow-y: auto; }
  .wc-m.ag.wait .txt { color: var(--muted); font-style: italic; }
  .wc-m.ag.bad .txt { color: var(--error); }
  .wc-m.sys { align-self: center; color: var(--faint); font-size: 11.5px; text-align: center; }
  .wc-m .stop { border: 0; background: none; color: var(--faint); cursor: pointer; font: inherit; font-size: 11px; padding: 0; }
  .wc-chips { display: flex; gap: 6px; flex-wrap: wrap; padding: 8px 14px 0; }
  .wc-chip { border: 1px solid var(--line); background: var(--bg); color: var(--ink); border-radius: 999px; padding: 3px 10px; font: inherit; font-size: 12px; cursor: pointer; }
  .wc-chip.on { border-color: var(--tool); color: var(--tool); font-weight: 600; }
  .wc-chip .dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 5px; vertical-align: middle; background: var(--idle); }
  .wc-chip .dot.thinking { background: var(--thinking); } .wc-chip .dot.tool { background: var(--tool); } .wc-chip .dot.typing { background: var(--typing); }
  .wc-chip .dot.waiting { background: var(--waiting); } .wc-chip .dot.done { background: var(--done); }
  .wc-in { display: flex; gap: 8px; align-items: flex-end; padding: 10px 14px 12px; }
  .wc-in textarea { flex: 1; box-sizing: border-box; resize: none; height: 40px; max-height: 120px; border: 1px solid var(--line); border-radius: 12px;
    background: var(--bg); color: var(--ink); font: inherit; padding: 9px 11px; outline: none; }
  .wc-in textarea:focus { border-color: var(--tool); }
  .wc-in button { border: 0; border-radius: 12px; background: var(--tool); color: #fff; font: inherit; font-weight: 600; padding: 0 14px; height: 40px; cursor: pointer; }
  .wc-foot { color: var(--faint); font-size: 11px; padding: 0 14px 10px; }
  .wc-fab { position: fixed; right: 20px; bottom: 20px; z-index: 55; border: 0; border-radius: 999px; background: var(--tool); color: #fff;
    font: inherit; font-weight: 600; padding: 10px 16px; box-shadow: 0 6px 20px rgba(0,0,0,.2); cursor: pointer; }
  .wc-fab kbd { font: inherit; font-size: 11px; opacity: .8; border: 1px solid rgba(255,255,255,.5); border-radius: 4px; padding: 0 4px; margin-left: 4px; }
  .wc-say { position: fixed; z-index: 58; max-width: 240px; background: var(--panel); color: var(--ink); border: 1px solid var(--line); border-radius: 14px;
    padding: 7px 10px; font-size: 12px; line-height: 1.4; box-shadow: 0 6px 18px rgba(0,0,0,.2); transform: translate(-50%, -100%); pointer-events: auto; cursor: pointer;
    white-space: pre-wrap; word-break: break-word; }
  .wc-say::after { content: ''; position: absolute; left: 50%; bottom: -6px; width: 10px; height: 10px; background: var(--panel);
    border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); transform: translateX(-50%) rotate(45deg); }`;
  document.head.appendChild(css);

  // ---------- 화면 ----------
  const box = document.createElement('div');
  box.className = 'wc';
  box.innerHTML = `
    <div class="wc-head"><span>💬 사무실 대화</span><span class="hint">Enter 열기 · Esc 닫기</span><button class="x" title="닫기 (Esc)">×</button></div>
    <div class="wc-log"></div>
    <div class="wc-chips"></div>
    <div class="wc-in"><textarea rows="1" placeholder="예: 김아현한테 오늘 한 일 요약해줘"></textarea><button class="send">보내기</button></div>
    <div class="wc-foot">여러 명: "김아현, 박희주한테 ~" · "모두한테 ~" · Shift+클릭. 이름을 안 부르면 마지막 상대에게 가요. 권한: 파일 수정 + git 명령</div>`;
  document.body.appendChild(box);
  const log = box.querySelector('.wc-log'), chips = box.querySelector('.wc-chips'), input = box.querySelector('textarea'), sendBtn = box.querySelector('.send');
  const fab = document.createElement('button');
  fab.className = 'wc-fab';
  fab.innerHTML = '💬 대화<kbd>Enter</kbd>';
  if (!isPip) document.body.appendChild(fab);

  // ---------- 상태 ----------
  let saved = g(() => JSON.parse(localStorage.getItem(STORE)), null) || {};
  const msgs = Array.isArray(saved.msgs) ? saved.msgs.slice(-80) : [];
  // 받는 사람: 이름 배열 (여러 명 가능)
  let targets = Array.isArray(saved.targets) ? saved.targets : saved.target ? [saved.target] : [];
  const save = () => g(() => localStorage.setItem(STORE, JSON.stringify({ msgs: msgs.slice(-80), targets })));
  const ALL = '(?:모두들|모두|다들|전원|전부)';
  const groupOf = (s) => (s.cwd || '').split('/').slice(-2, -1)[0] || '';
  const who = (list) => (list.length > 3 ? `${list.slice(0, 3).join(', ')} 외 ${list.length - 3}명` : list.join(', '));

  // 이름 → 세션 (같은 이름이 여러 개면 가장 최근 것)
  function roster() {
    const map = new Map();
    for (const s of sessions()) {
      if (s.subagent || !SUPPORTED.has(s.agent) || !s.cwd) continue;
      const name = labelOf(s);
      if (!map.has(name)) map.set(name, s);
    }
    return map;
  }

  // "김아현한테 ~", "김아현, 박희주한테 ~", "모두한테 ~", "inter 모두한테 ~", "@김아현 ~"
  function parse(text) {
    const map = roster();
    const order = [...map.keys()];
    const names = order.slice().sort((a, b) => b.length - a.length);
    const groups = [...new Set([...map.values()].map(groupOf).filter(Boolean))].sort((a, b) => b.length - a.length);
    const tail = '\\s*(?:씨|님|들)?\\s*(?:한테|에게|께|아|야|은|는|,|:)?\\s*';
    let m = text.match(new RegExp(`^\\s*@?${ALL}${tail}`));
    if (m) return { names: order, rest: text.slice(m[0].length).trim(), group: '모두' };
    for (const gname of groups) {
      m = text.match(new RegExp(`^\\s*@?${reEsc(gname)}\\s*(?:폴더|팀)?\\s*(?:에\\s*있는\\s*)?(?:사람\\s*)?${ALL}${tail}`, 'i'));
      if (m) return { names: order.filter((n) => groupOf(map.get(n)) === gname), rest: text.slice(m[0].length).trim(), group: `${gname} 모두` };
    }
    // 맨 앞에서 이름을 하나 이상 부른 경우: "김아현, 박희주랑 coin한테 ~"
    const startsWithName = (str) => names.find((x) => new RegExp(`^\\s*@?${reEsc(x)}`, 'i').test(str));
    const found = [];
    let rest = text;
    for (let n = startsWithName(rest); n; n = startsWithName(rest)) {
      found.push(n);
      rest = rest.replace(new RegExp(`^\\s*@?${reEsc(n)}\\s*(?:씨|님)?`, 'i'), '');
      const sep = rest.match(/^\s*(?:,|、|\/|이랑|랑|하고|와|과|및|그리고)\s*/);
      if (sep && startsWithName(rest.slice(sep[0].length))) rest = rest.slice(sep[0].length);
      else break;
    }
    if (found.length) return { names: [...new Set(found)], rest: rest.replace(new RegExp(`^${tail}`), '').trim() };
    // 문장 중간에서 부른 경우: "이거 김아현한테 물어봐줘", "@김아현"
    for (const n of names) {
      const mid = new RegExp(`@${reEsc(n)}\\s*|${reEsc(n)}\\s*(?:씨|님)?\\s*(?:한테|에게|께)\\s*`, 'i');
      if (mid.test(text)) return { names: [n], rest: text.replace(mid, '').trim() };
    }
    return { names: [], rest: text.trim() };
  }

  // ---------- 그리기 ----------
  function renderChips() {
    const map = roster();
    targets = targets.filter((n) => map.has(n));
    const all = map.size > 1 && targets.length === map.size;
    chips.innerHTML = (map.size > 1 ? `<button class="wc-chip ${all ? 'on' : ''}" data-all="1">👥 모두</button>` : '') + [...map.entries()].map(([n, s]) =>
      `<button class="wc-chip ${targets.includes(n) ? 'on' : ''}" data-name="${esc(n)}" title="${esc(NAMES[s.agent])} · ${esc(s.cwd)}"><span class="dot ${esc(s.status)}"></span>${esc(n)}</button>`).join('')
      || '<span class="wc-m sys">사무실에 대화할 수 있는 에이전트가 아직 없어요</span>';
    input.placeholder = targets.length ? `${who(targets)}에게 할 말` : '예: 김아현한테 오늘 한 일 요약해줘';
  }
  function renderLog() {
    log.innerHTML = msgs.map((m, i) => {
      if (m.role === 'me') return `<div class="wc-m me"><span class="to">→ ${esc(m.to)}</span>${esc(m.text)}</div>`;
      if (m.role === 'sys') return `<div class="wc-m sys">${esc(m.text)}</div>`;
      const cls = m.state === 'wait' || m.state === 'queue' ? 'wait' : m.state === 'bad' ? 'bad' : '';
      const stop = m.state === 'wait' && m.taskId ? ` · <button class="stop" data-stop="${esc(m.taskId)}">중지</button>` : '';
      return `<div class="wc-m ag ${cls}"><div class="who"><b>${esc(m.from)}</b><span>${esc(NAMES[m.agent] || '')}</span>${stop}</div><div class="txt">${esc(m.text)}</div></div>`;
    }).join('') || '<div class="wc-m sys">이름을 부르고 할 말을 적어보세요.<br>예: 김아현한테 지금 뭐 하고 있는지 알려줘</div>';
    log.scrollTop = log.scrollHeight;
  }
  const sys = (text) => { msgs.push({ role: 'sys', text }); save(); renderLog(); };

  // ---------- 열기 / 닫기 ----------
  function open(name) {
    if (name) targets = [name];
    box.classList.add('on'); fab.style.display = 'none';
    renderChips(); renderLog(); save();
    setTimeout(() => input.focus(), 0);
  }
  function close() { box.classList.remove('on'); fab.style.display = ''; input.blur(); }
  fab.onclick = () => open();
  box.querySelector('.x').onclick = close;
  chips.addEventListener('click', (e) => {
    const c = e.target.closest('[data-name],[data-all]'); if (!c) return;
    const n = c.dataset.name, size = roster().size;
    if (c.dataset.all) targets = targets.length === size ? [] : [...roster().keys()];
    else if (e.shiftKey || e.metaKey || targets.length > 1) targets = targets.includes(n) ? targets.filter((x) => x !== n) : [...targets, n];
    else targets = targets[0] === n ? [] : [n];
    save(); renderChips(); input.focus();
  });

  const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  document.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape' && box.classList.contains('on')) { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !box.classList.contains('on') && !typing(document.activeElement)) {
      const a = document.activeElement;
      if (a && ['BUTTON', 'SUMMARY', 'A'].includes(a.tagName) && a !== fab) return; // 버튼 누르기용 Enter는 그대로
      e.preventDefault(); open();
    }
  }, true);

  // 대화창이 열려 있을 때 캐릭터를 클릭하면 그 사람이 받는 사람이 된다.
  document.addEventListener('click', (e) => {
    if (e.target.tagName !== 'CANVAS' || !box.classList.contains('on')) return;
    requestAnimationFrame(() => {
      const key = g(() => tipPinned && tipKey, null);
      const s = key && sessions().find((x) => x.key === key);
      if (s && !s.subagent && SUPPORTED.has(s.agent)) { targets = [labelOf(s)]; save(); renderChips(); input.focus(); }
    });
  });

  // ---------- 보내기 ----------
  async function send() {
    const text = input.value.trim();
    if (!text) return;
    const p = parse(text);
    const to = p.names.length ? p.names : targets;
    if (!to.length) { sys('누구에게 말할까요? 이름을 부르거나 아래에서 골라주세요 (예: 김아현한테 …, 모두한테 …)'); return; }
    if (p.names.length) targets = p.names;
    if (!p.rest) { input.value = ''; save(); renderChips(); sys(`${who(to)}에게 뭐라고 할까요?`); return; }
    const map = roster();
    const list = to.map((n) => [n, map.get(n)]).filter(([, s]) => s);
    if (!list.length) { sys(`${who(to)}을(를) 사무실에서 찾을 수 없어요`); return; }
    input.value = '';
    const label = list.length > 1 ? `${p.group || who(list.map(([n]) => n))} (${list.length}명)` : list[0][0];
    msgs.push({ role: 'me', to: label, text: p.rest });
    const fresh = [];
    for (const [n, s] of list) {
      const reply = { role: 'ag', from: n, agent: s.agent, key: s.key, state: 'wait', text: '일하는 중…', prompt: p.rest };
      // 같은 사람이 아직 일하는 중이면 줄 세워 두었다가 끝나면 보낸다.
      const busy = msgs.some((m) => m.role === 'ag' && m.key === s.key && (m.state === 'wait' || m.state === 'queue'));
      msgs.push(reply);
      if (busy) { reply.state = 'queue'; reply.text = '앞의 일 끝나면 이어서 할게요…'; } else fresh.push(reply);
    }
    save(); renderChips(); renderLog();
    await Promise.all(fresh.map(dispatch));
    pollSoon();
  }
  async function dispatch(reply) {
    reply.state = 'wait'; reply.text = '일하는 중…';
    try {
      const r = await fetch('/api/task', { method: 'POST', headers: HEADER, body: JSON.stringify({ key: reply.key, prompt: reply.prompt }) });
      const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
      // 동시에 너무 많거나 아직 앞의 일이 남았으면 줄 서서 기다린다.
      if (r.status === 429 || r.status === 409) { reply.state = 'queue'; reply.text = '순서 기다리는 중…'; save(); renderLog(); pollSoon(); return; }
      if (!j.ok) throw new Error(j.error || '실패');
      reply.taskId = j.task.id;
      if (j.task.fork) reply.text = '터미널에서 하던 일과 겹치지 않게 갈래를 나눠서 일하는 중…';
      pollSoon();
    } catch (e) {
      reply.state = 'bad'; reply.text = e.message;
    }
    save(); renderLog();
  }
  sendBtn.onclick = send;
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener('input', () => { input.style.height = '40px'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; });
  log.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-stop]'); if (!b) return;
    await fetch('/api/tasks/stop?id=' + encodeURIComponent(b.dataset.stop), { method: 'POST', headers: HEADER });
    pollSoon();
  });

  // ---------- 답 받기 ----------
  let timer = null;
  async function poll() {
    clearTimeout(timer);
    const waiting = msgs.filter((m) => m.role === 'ag' && m.state === 'wait' && m.taskId);
    if (!waiting.length && !msgs.some((m) => m.state === 'queue')) return;
    try {
      const j = await fetch('/api/tasks', { cache: 'no-store' }).then((r) => r.json());
      const byId = new Map((j.tasks || []).map((t) => [t.id, t]));
      let changed = false;
      for (const m of waiting) {
        const t = byId.get(m.taskId);
        if (!t) { m.state = 'bad'; m.text = '서버가 다시 켜져서 답을 놓쳤어요. 사무실에서 캐릭터를 눌러 확인해 주세요'; changed = true; continue; }
        if (t.status === 'running' || t.status === 'starting') continue;
        changed = true;
        if (t.status === 'done') {
          m.state = 'ok'; m.text = (t.reply || '').trim() || '(끝났는데 따로 남긴 말은 없어요)';
          say(m.key, m.text);
        } else if (t.status === 'stopped') {
          m.state = 'bad'; m.text = '중지했어요';
        } else {
          m.state = 'bad'; m.text = '실패했어요: ' + ((t.tail || '').trim().split('\n').slice(-3).join('\n') || `종료 코드 ${t.exitCode}`);
        }
      }
      if (changed) { save(); renderLog(); }
      // 줄 서 있던 말: 그 사람이 한가해지면 순서대로 보낸다.
      for (const m of msgs.filter((x) => x.state === 'queue')) {
        if (!msgs.some((x) => x.key === m.key && x.state === 'wait')) await dispatch(m);
      }
    } catch {}
    if (msgs.some((m) => m.role === 'ag' && ((m.state === 'wait' && m.taskId) || m.state === 'queue'))) timer = setTimeout(poll, 2000);
  }
  function pollSoon() { clearTimeout(timer); timer = setTimeout(poll, 500); }

  // ---------- 캐릭터 머리 위 말풍선 ----------
  const bubbles = new Map(); // key -> { el, until }
  function say(key, text) {
    if (!key) return;
    const short = text.length > 140 ? text.slice(0, 140) + '…' : text;
    let b = bubbles.get(key);
    if (!b) {
      const el = document.createElement('div');
      el.className = 'wc-say';
      el.title = '눌러서 대화창 열기';
      el.onclick = () => { const s = sessions().find((x) => x.key === key); open(s ? labelOf(s) : null); el.remove(); bubbles.delete(key); };
      document.body.appendChild(el);
      b = { el }; bubbles.set(key, b);
    }
    b.el.textContent = short;
    b.until = Date.now() + 20000;
    tick();
  }
  let raf = 0;
  function tick() {
    cancelAnimationFrame(raf);
    if (!bubbles.size) return;
    const off = g(() => office, null);
    const canvas = document.querySelector('#office canvas');
    const r = canvas && canvas.getBoundingClientRect();
    for (const [key, b] of bubbles) {
      if (Date.now() > b.until) { b.el.remove(); bubbles.delete(key); continue; }
      const h = off && Array.isArray(off.hit) && off.hit.find((x) => x.key === key);
      if (!h || !r) { b.el.style.display = 'none'; continue; }
      b.el.style.display = '';
      b.el.style.left = (r.left + (h.x0 + h.x1) / 2) + 'px';
      b.el.style.top = (r.top + h.y0 - 6) + 'px';
    }
    raf = requestAnimationFrame(tick);
  }

  // 사무실 데이터가 바뀌면 이름 목록도 새로
  setInterval(() => { if (box.classList.contains('on')) renderChips(); }, 3000);
  renderLog();
  poll();
})();
