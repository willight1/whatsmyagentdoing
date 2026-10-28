# 👀 whatsmyagentdoing + 💬 사무실 대화

> [Charonyuu/whatsmyagentdoing](https://github.com/Charonyuu/whatsmyagentdoing) (MIT)을 포크해서, 사무실 화면에서 **에이전트 이름을 불러 말로 일을 시키고 답을 받는 기능**을 더한 버전입니다.

원본은 내 컴퓨터의 Claude Code · Codex · Gemini CLI 에이전트가 뭘 하는지 **보여주기만** 합니다. 이 버전은 거기에 대화창을 붙였습니다.

## 설치 (1분)

Node.js 18 이상이 필요합니다. 터미널에 붙여넣으세요.

```bash
# Claude Code
git clone --depth 1 https://github.com/willight1/whatsmyagentdoing ~/.claude/skills/myoffice
# Codex
git clone --depth 1 https://github.com/willight1/whatsmyagentdoing ~/.codex/skills/myoffice
# 실행 (또는 Claude Code / Codex에서 /myoffice)
node ~/.claude/skills/myoffice/bin/cli.js
```

브라우저에 http://localhost:4545 사무실이 열립니다.

## 💬 사무실 대화 사용법

- **Enter**: 사무실 화면에서 누르면 대화창이 열립니다. **Esc**: 닫기
- **한 명에게**: `김아현한테 오늘 한 일 요약해줘`, `coin아 봇 상태 어때?`, `@박희주 이거 확인해줘`
- **여러 명에게**: `김아현, 박희주한테 ~`, `김아현이랑 coin한테 ~`
- **전체 / 폴더 단위**: `모두한테 ~`, `inter 모두한테 ~` (inter 폴더 안의 사람 전원)
- 이름을 안 부르면 **마지막으로 말한 상대**에게 갑니다.
- 대화창 아래 이름 버튼, 「👥 모두」, Shift+클릭으로도 고를 수 있습니다.

보내면 각 에이전트가 **하던 대화를 이어서** 일하고(사무실 캐릭터가 책상에서 일함), 답이 오면 대화창과 **캐릭터 머리 위 말풍선**에 뜹니다. 같은 사람에게 연달아 말하면 줄을 세워 순서대로 처리하고, 동시에 6명까지 실행합니다.

> 사무실에 보이는 이름은 **프로젝트 폴더 이름**입니다. 같은 이름이 여러 개면 가장 최근 대화로 갑니다.

## 🔐 대화창에서 승인하기

에이전트가 자동 허용 목록 밖의 일(테스트·스크립트 실행, 설치 등)을 하려고 하면, 대화창에 승인 카드가 뜹니다.

> 🔐 coin이(가) 허락을 구해요 · 명령 실행 — `python3 -c "print(6*7)"` — **[허용] [이번 작업 동안 허용] [거부]**

- 대화창이 닫혀 있으면 자동으로 열리고, 탭 제목과 버튼에 🔐 표시가 붙습니다.
- **5분** 안에 답하지 않으면 거부됩니다.
- 「이번 작업 동안 허용」은 그 실행이 끝날 때까지만 같은 요청을 다시 묻지 않습니다 (설정 파일에 저장하지 않음).
- Claude Code 공식 기능인 [PermissionRequest HTTP 훅](https://code.claude.com/docs/en/hooks)을 실행마다 `--settings`로 붙여서, 승인 요청을 이 사무실 서버로 보내게 합니다. Claude만 지원합니다.

## 권한과 안전장치

- **자동 허용**: 파일 수정, `git status/log/diff/show/fetch/pull/rev-parse/ls-files/blame`, `git remote -v`, `ls`, `pwd`, `cd` (자기 폴더에 대한 `git -C <폴더>` 형태 포함)
- **그 밖의 명령**: 대화창 승인 카드로 물어봄 (위 참고)
- 다른 폴더로 이동해서 git을 실행하는 것도 Claude Code 보안 규칙상 승인이 필요합니다. 여러 프로젝트를 다룰 때는 `모두한테 ~`처럼 **각자 자기 폴더에서 하게** 보내는 게 편합니다.
- 하위 에이전트는 백그라운드로 돌리지 말고 결과를 다 받은 뒤 답하도록 규칙을 붙여 실행합니다 (답하는 순간 프로세스가 끝나 하위 에이전트가 끊기는 문제 방지).
- 터미널에서 지금 일하는 중인 에이전트에게 말하면: Claude는 대화를 복사해 따로 이어서 일하고(`--fork-session`), Codex·Gemini는 끝날 때까지 기다립니다.
- 다른 웹사이트가 몰래 보내지 못하게 전용 헤더와 Origin을 확인하고, 서버는 원본처럼 `127.0.0.1`에만 열립니다.
- 실행 기록: `~/.whatsmyagentdoing/tasks/`
- 기능 끄기: `WMAD_NO_TASKS=1 node bin/cli.js`

실제로 실행되는 명령:

| 에이전트 | 명령 |
| --- | --- |
| Claude | `claude --resume <세션ID> -p "할 말" --permission-mode acceptEdits --allowedTools <git 목록>` |
| Codex | `codex exec --sandbox workspace-write resume <세션ID> "할 말"` |
| Gemini | `gemini --resume <세션ID> -p "할 말" --approval-mode auto_edit` |

Claude Code로만 실제 테스트했습니다. Codex·Gemini는 공식 문서 기준으로 작성했고 실제 실행은 확인하지 않았습니다.

## 원본과 달라진 파일

- 새 파일: `src/tasks.js` (서버: 실행 · 권한 · 답 받기), `public/chat.js` (화면: 대화창 · 이름 인식 · 머리 위 말풍선)
- 수정: `src/server.js` 3줄, `public/index.html` 1줄, `src/update.js` 업데이트 확인 주소(이 저장소)
- 데모 모드(`--demo`)에서는 대화 기능이 꺼집니다.

---

아래는 원본 README입니다.

# 👀 whatsmyagentdoing

**A Claude Code / Codex skill: type `/myoffice` and see what every Claude Code, Codex, Gemini CLI and OMP (oh-my-pi) agent on your machine is doing — live, in a little office.**

OMP support: [paths, profiles, Resume and limitations](docs/omp.md).

![The 3D office: agents at their desks, off-duty ones wandering around](docs/office-3d.gif)

| Medium (2D) | List |
|---|---|
| ![2D office](docs/office-2d.gif) | ![List view](docs/list.gif) |

<sub>Recorded with `--demo` (a made-up team), so no real sessions are shown.</sub>

## Install

**Easiest: ask your agent.** Paste this into Claude Code or Codex:

> Install the myoffice skill from https://github.com/willight1/whatsmyagentdoing: clone it with `git clone --depth 1` into `~/.claude/skills/myoffice` (for Codex: `~/.codex/skills/myoffice`), check that `node --version` is 18 or newer, then tell me to start a new session and type /myoffice.

Or do it yourself:

```bash
# Claude Code
git clone --depth 1 https://github.com/willight1/whatsmyagentdoing ~/.claude/skills/myoffice

# Codex
git clone --depth 1 https://github.com/willight1/whatsmyagentdoing ~/.codex/skills/myoffice
```

Then type **`/myoffice`** (or just ask *"what are my agents doing?"*). The office opens in your browser. Update later with `git -C ~/.claude/skills/myoffice pull`.

Needs Node.js 18+. Nothing to `npm install` — the repo runs as cloned. Prefer no skill? `node bin/cli.js` from a clone works too.

It opens an isometric **office**. Agents that are working sit at cubicle desks: a thought bubble while thinking, typing with code scrolling on the monitor while a tool runs, standing up and waving when they need you. A handful of recently finished agents stay around off duty and wander: coffee and water in the pantry, the couch and beanbags, the bookshelf, the meeting-room whiteboard, the arcade cabinet, ping-pong and foosball (when two of them are free), the phone booth, or a nap at an empty desk. Everyone else has gone home. The windows follow your local time of day (and in Medium there's an office cat). Hover anyone to see what they're on.

Two looks: **Medium** is a hand-drawn 2D canvas (zero dependencies). **High (3D)** renders the same office with real-time lighting and shadows using [Kenney](https://kenney.nl)'s CC0 *Mini Characters* (with their walk / sit / interact animations) and *Furniture Kit*; drag to rotate, scroll to zoom. The 3D bundle (three.js, ~180 KB gzipped) and models (~1.3 MB, meshopt-compressed) only load when you pick High.

**Scenes (3D):** the office is built in; other scenes are small downloadable packs (Pirate Cove, Café, Space Station and Castle are 100–160 KB each), fetched only when you pick one from the scene buttons, run `--scene pirate`, or ask your agent for it. Packs are data only (a manifest plus Kenney CC0 models) and are checked against a pinned SHA-256 before they're installed into `~/.whatsmyagentdoing/scenes`.

Prefer plain cards? Switch to **List**. Either way, each session updates in real time:

| Status | Meaning |
|---|---|
| 💭 Thinking | reasoning, or reading a tool result |
| ⏳ Running | a tool call is in flight — shows which (`Bash: npm test`, `Edit app.ts`, `github · create_pr`) |
| ✍️ Writing reply | started its answer, turn not finished yet |
| 🟠 Waiting for you | asked you a question / needs approval |
| ✅ Done | turn finished, with the last reply |
| ■ Interrupted / ❗ Error / – Idle | |

The UI speaks English, 繁體中文, 简体中文, 日本語, 한국어, Español, Français, Deutsch and Português. By default it uses the language you write your prompts in (falling back to your browser's); pick one from the 🌐 menu to override.

In list view, sessions are grouped into **Needs you → Working → Finished**, with a live timer for the current turn, a copy button for the resume command (`claude --resume …` / `codex resume …`), optional browser notifications when an agent finishes, and filters for Claude / Codex / subagents. The tab title shows how many agents are working.

**Agent badges:** in both 2D and 3D, transparent official Claude, Codex and Gemini logos identify each agent beside its name, including subagents. The same icons appear in the legend, list cards and filters. Open **Settings → Agent badges** to hide the office markers and legend; your choice is saved. Icons are bundled locally, with initials as a fallback if an image cannot load. See [icon sources and attribution](assets/agents/README.md).

The toolbar keeps the view, 2D/3D and pop-out controls visible. Scene selection, agent filters, display options, notifications and language are grouped under **Settings**.

**Pop out:** browsers with the [Document Picture-in-Picture API](https://developer.chrome.com/docs/web-platform/document-picture-in-picture) can open the office or list in an interactive, always-on-top window. The compact list shows **Needs you** and **Working**. View, quality, scene, filters, language and badge settings stay in sync with the main tab when browser storage is available. Closing the pop-out restores the main view, and only the main tab sends notifications.

When Document PiP isn't available, **Pop out** in office view starts a local, view-only video preview of the 2D or 3D office. Use its video PiP button, or the browser's own video controls/context menu (such as Firefox's), to float it. Stop the preview when finished. No screen-sharing permission is needed and no video is uploaded. Background animation may run at a lower frame rate, depending on browser throttling; this fallback doesn't support list cards or clicking agents.

Works with Claude Code (CLI, desktop, IDE), Codex (CLI, desktop, IDE) and Gemini CLI — anything that writes session logs to disk. (Google Antigravity keeps its conversations in an undocumented binary store and isn't supported yet.)

## Options

```
-p, --port <n>    Port (default 4545; next free one if taken)
--hours <n>       Sessions active in the last n hours (default 24)
--omp-dir <path>  OMP sessions root, or a directory passed to omp --session-dir
--no-open         Don't open the browser
--private         Hide prompts, replies and titles — status only (screen-share safe)
--json            Print one snapshot as JSON and exit
--demo            Show a made-up team instead of your sessions (screenshots, trying it out)
--stop            Stop a running dashboard (or say /myoffice stop)
--update          git pull the latest version and restart (or say /myoffice update)
--scenes          List 3D scenes, installed and downloadable
--scene <id>      Download a scene if needed and open the office in it
```

Running it again while it's up just reopens the tab.

**Updates:** the page shows its version in the corner and an **Update** button when a newer one is out (it checks the `package.json` on this repo's main branch about every half hour; set `WMAD_NO_UPDATE_CHECK=1` to turn that off). The button — or `--update`, or `/myoffice update` — runs `git pull` in the install folder and restarts the dashboard.

## How it works

No hooks, no config, no API keys. Both tools already append every message and tool call to JSONL files as they work:

- Claude Code: `~/.claude/projects/<project>/<session>.jsonl` (+ `subagents/`)
- Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. Date folders record when a chat started; discovery checks all dates and uses log modification times to find recently active chats, including months-old conversations. Inactive log contents are not read.
- Gemini CLI: `~/.gemini/tmp/<project>/chats/session-*.jsonl` (project paths from `~/.gemini/projects.json`)
- OMP: `~/.omp/agent/sessions/<project>/*.jsonl`, plus named profiles. Override with `WMAD_OMP_SESSIONS_DIR` or `--omp-dir`. Details: [OMP](docs/omp.md).

`whatsmyagentdoing` tails those files (read-only), turns the latest event into a status, and pushes it to the page over Server-Sent Events. Set `CLAUDE_CONFIG_DIR` / `CODEX_HOME` / `GEMINI_CLI_HOME` if yours live elsewhere.

**Privacy:** nothing leaves your machine. The server binds to `127.0.0.1` only and rejects requests that aren't addressed to localhost. No runtime dependencies — read `src/` in five minutes. (`web/office3d.js` is the 3D source; `npm run build` bundles it with three.js into `public/office3d.js`.)

## Limits

- Logs are written per finished block, not per token, so "Writing reply" means a reply block has landed and the turn isn't over — not a live keystroke stream.
- Claude Code doesn't log permission prompts, so a tool waiting on your approval shows as "Running" until you answer (Codex and Gemini CLI do log it, so those show "Waiting for you").
- Gemini CLI writes its thoughts together with the reply, so between your prompt and its first tool call or reply it simply shows "Thinking".
- The log formats aren't public APIs. If an update changes them, statuses may degrade — please open an issue.

## Development checks

`npm run test:watcher` runs isolated filesystem regression checks for session discovery, resumed old chats, the hours window, unreadable paths and large logs. It requires Node.js 18+ and never reads your real agent history.

Browser development checks require Node.js 20+ (the dashboard itself still runs on Node.js 18+). Run `npm install`, then `npm run build` to rebuild the committed 3D bundle. With Google Chrome installed, `npm run test:ui` runs the browser regression checks against a temporary local server and made-up sessions. Use `WMAD_HEADED=1 npm run test:ui` to see the test windows, or set `WMAD_SCREENSHOTS` to an output folder to save screenshots. The checks cover logo rendering, compact views, settings synchronization, notifications, PiP recovery, video-stream cleanup and responsive settings in light and dark themes. They use Chrome; Firefox and Safari's native video controls still need manual testing.

## License

MIT. 3D models in `assets/kenney/` are by [Kenney](https://kenney.nl), released under CC0 (see the license files there).
