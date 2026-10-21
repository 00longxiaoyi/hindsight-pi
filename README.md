# Hindsight-pi

[English](#hindsight-pi) · [中文说明](#中文说明)

Transparent long-term memory for [pi](https://github.com/mariozechner/pi) powered by [Hindsight](https://github.com/vectorize-io/hindsight).

`Hindsight-pi` gives pi durable, inspectable memory without hiding what is happening. It recalls relevant memories for the current turn, queues new memories safely, and lets you inspect or prune recall state when needed.

## Highlights

- Fresh recall per user turn; no stale cached memory context.
- Hidden `hindsight-recall` context is filtered so old recalls do not leak back to the model.
- Durable `message_end` retention queue (JSONL on disk, uploaded by `/hindsight:flush`, session switch, or shutdown) using Hindsight `retainBatch`.
- Session-document append with stable document ids.
- Tags and observation scopes for project/user/session separation.
- One-bank + tags/scopes recommended; multiple banks supported for hard privacy boundaries.
- Friendly setup, status, doctor, config-source inspection, and explicit tools.

## Requirements

- `pi` (verified on 1.2.0).
- A reachable Hindsight server. Verified against Hindsight 0.5.5+ (`api_version` 1.0.0); older deployments still work — see [compatibility](#hindsight-server-compatibility).
- Node.js 20+ for local development and `npm pack` only. Pi loads the extension itself.

## Install

From npm:

```bash
pi install npm:@walodayeet/hindsight-pi
```

From GitHub:

```bash
pi install git:github.com/00longxiaoyi/hindsight-pi
```

From a local build (tarball produced by `npm pack`):

```bash
cd ~/.pi/agent/npm
npm i /path/to/walodayeet-hindsight-pi-0.4.1.tgz
```

Local dev (loads the working tree directly, no copy):

```bash
npm install
pi -e ./extensions/index.ts
```

Remove the previously installed copy before switching sources, otherwise the npm and local builds both load and register their tools twice:

```bash
pi remove npm:@walodayeet/hindsight-pi
```

## Quick start

1. Start or connect to a Hindsight server.
2. Load/reload pi.
3. Run:

```text
/hindsight:setup
/hindsight:doctor
/hindsight:status
```

Useful server example:

```text
http://<your-hindsight-host>:8888
```

`/hindsight:doctor` is the fastest way to confirm a healthy setup. It reports the active bank, `server_api`, whether `bank_config_api` is available, and the bank's memory/directive/document counts:

```text
active_bank: lazycat-clash-party
server_api: 1.0.0
bank_config_api: yes
connectivity: ok
memories: 3037
```

`/hindsight:status` is the deeper view: it adds queue depth, last flush, last flush error, and the most recent `session_start` / `recall` / `retain` hook results.

## Hindsight server compatibility

Works with the current Hindsight API (0.5.5+ / `api_version` 1.0.0, bank config API) and with older deployments:

- Current servers: bank existence is read from `GET .../banks/{bank_id}/config` and banks are created with `PUT .../banks/{bank_id}`.
  The old profile endpoint answers `410 Gone` there, so it is never used as an existence probe.
- Older servers: falls back to `GET .../banks/{bank_id}/profile` and, as a last resort, `GET /v1/default/banks`.
- Bank creation only runs when a probe positively reports the bank missing, so a misbehaving server cannot overwrite an existing bank's `reflect_mission`.

`/hindsight:doctor` prints the detected `server_api` version and whether the bank config API is available.
`HINDSIGHT_API_URL` is accepted as an alias for `HINDSIGHT_BASE_URL`.

Endpoint-level details, error signatures, and the `observation_scopes` payload rules live in [`docs/hindsight-api-notes.md`](docs/hindsight-api-notes.md#server-compatibility-hindsight-055-api-10).

## Recommended memory setup

For most users:

- Use one Hindsight bank.
- Separate project/global memories with tags and observation scopes.
- Use separate banks only when memories must never mix, e.g. work vs personal or different clients.

Profile presets:

```text
/hindsight:profile broad     # broad recall from configured bank
/hindsight:profile project   # project-scoped recall via {project}
/hindsight:profile cwd       # exact-directory scoped recall
/hindsight:profile global    # global-bank style workflow
/hindsight:profile isolated  # per-repo bank plus project tags
```

## Commands

Setup and inspection:

| Command | Description |
|---|---|
| `/hindsight:setup` | Interactive first-time setup |
| `/hindsight:settings` | Interactive settings |
| `/hindsight:status` | Connection, queue, recall, and bank status |
| `/hindsight:doctor` | Connectivity and bank preflight |
| `/hindsight:config` | Effective config with secrets redacted |
| `/hindsight:where` | Which config files exist and what they contribute |
| `/hindsight:connect` | Connect or reconnect now |
| `/hindsight:stats` | Bank stats, when the server exposes them |
| `/hindsight:mode` | Switch recall mode |

Recall and retention:

| Command | Description |
|---|---|
| `/hindsight:popup` | Show the exact last recalled memories |
| `/hindsight:inspect-last-recall` | Alias of `popup` |
| `/hindsight:sync` | Clear last-recall state so the next turn refetches |
| `/hindsight:flush` | Flush queued retention records for this session |
| `/hindsight:toggle-retain` | Enable/disable retention for this session |
| `/hindsight:tag <tag>` | Add a session tag |
| `/hindsight:remove-tag <tag>` | Remove a session tag |
| `/hindsight:prune-recall-messages confirm` | Remove persisted recall messages from the session file |

Banks and sessions:

| Command | Description |
|---|---|
| `/hindsight:profile <name>` | Apply `broad \| project \| cwd \| global \| isolated` |
| `/hindsight:map <bank-id>` | Map the current directory to an explicit bank |
| `/hindsight:parse-session` | Inspect the current session as Hindsight JSON records |
| `/hindsight:parse-and-upsert-session` | Parse and upsert the current session |
| `/hindsight:upsert-historical-sessions confirm` | Backfill persisted sessions from this session directory |

## Agent tools

- `hindsight_search` — raw memory search
- `hindsight_context` — synthesized memory context
- `hindsight_retain` — explicit durable memory write
- `hindsight_bank_profile` — inspect the active bank (name, mission, disposition, memories, server API)

## Config files

Global:

```text
~/.hindsight/config.json
~/.hindsight/config.toml
```

Project-local override:

```text
<repo>/.hindsight/config.json
<repo>/.hindsight/config.toml
```

Use `/hindsight:where` to see which files are active.

Minimal config:

```json
{
  "baseUrl": "http://<your-hindsight-host>:8888",
  "bankId": "my-memory-bank",
  "bankStrategy": "manual",
  "host": {
    "pi": {
      "enabled": true,
      "recallMode": "hybrid",
      "autoRecallTags": ["{project}"],
      "autoRecallTagsMatch": "any_strict",
      "observationScopes": [["{project}"]]
    }
  }
}
```

`observationScopes` is either a strategy keyword (`per_tag`, `combined`, `all_combinations`, `shared`) or a list of tag groups (`[["{project}"], ["user:me"]]`). A flat string list is coerced into a single group rather than rejected.

## Environment variables

Most-used subset; the full table is in [`docs/config.md`](docs/config.md#environment-variables).

| Variable | Purpose |
|---|---|
| `HINDSIGHT_ENABLED` | Force enable/disable |
| `HINDSIGHT_BASE_URL` / `HINDSIGHT_API_URL` | Server URL (the latter is Hindsight's own name) |
| `HINDSIGHT_API_KEY` | Server API key |
| `HINDSIGHT_BANK_ID` | Pin the bank, implies `bankStrategy=manual` |
| `HINDSIGHT_GLOBAL_BANK_ID` | Secondary global bank |
| `HINDSIGHT_BANK_STRATEGY` | `per-repo` \| `manual` |
| `HINDSIGHT_RECALL_MODE` | `hybrid` \| `tools` \| `off` |
| `HINDSIGHT_AUTO_CREATE_BANK` | Create missing banks on connect |
| `HINDSIGHT_OBSERVATION_SCOPES` | JSON scopes: keyword or list of tag groups (e.g. `[["{project}"]]`) |
| `HINDSIGHT_QUEUE_ROOT` | Override the queue directory (default `~/.hindsight/pi-queues`) |

Precedence: `HINDSIGHT_*` env vars > project `.hindsight/config.*` > global `~/.hindsight/config.*` > defaults.

## Defaults that matter

- Recall query uses raw user input, not expanded skill/slash-command bodies.
- Slash commands with no user request skip recall; slash commands with args recall from the args.
- Oversized recall queries warn and skip by default.
- Auto recall is ephemeral by default (`autoRecallPersist=false`).
- Recall indicators are UI-only by default.
- Retention excludes Hindsight tool feedback and meta-memory inspection prompts.
- `#nomem` and `#skip` opt a turn out of auto-retain.

## Troubleshooting

**`405 Method Not Allowed` or `410 Gone` mentioning the bank profile.**
Your extension build predates the Hindsight 0.5.5 API change and is calling the removed profile endpoint. Upgrade to 0.4.1+; `/hindsight:doctor` should then report `bank_config_api: yes`.

**`422` on retain, mentioning `observation_scopes`.**
The config uses a flat tag list. Use a keyword (`per_tag`, `combined`, `all_combinations`, `shared`) or a list of groups (`[["{project}"]]`). 0.4.1+ normalizes and drops invalid values automatically.

**`fetch failed` / `ECONNREFUSED`.**
Server not running, wrong port, or wrong base URL. Check `/hindsight:status` (`Base URL`), then `/hindsight:doctor`.

**`Bank 'x' not found`.**
Either `autoCreateBank` is off, or the derived bank id differs from what you expect. Check `Active bank` in `/hindsight:status`, or pin it with `/hindsight:map <bank-id>` / `HINDSIGHT_BANK_ID`.

**Recall returns nothing.**
Check `Recall mode` and `Recall tags` in `/hindsight:status`; tags narrow results a lot. `/hindsight:popup` shows the exact last result set, and `/hindsight:sync` forces a refetch on the next turn.

**Retention seems to lag or drop writes.**
Retention is queue-only until a flush point. `message_end` appends to a per-session JSONL queue (`~/.hindsight/pi-queues`), and the batch is uploaded on `/hindsight:flush`, when you switch sessions, and on shutdown. If you want memories visible in Hindsight immediately, run `/hindsight:flush`. `/hindsight:status` shows `Queue: N auto record(s)`, `Last flush`, and `Last flush error`.

## Known limitations

- Nothing drains the retention queue during a session: `writeFrequency`, `retainMode`, and `stepRetainThreshold` are still surfaced in `/hindsight:settings` and `/hindsight:status`, but no code consumes them. Writes only leave the queue on `/hindsight:flush`, session switch, or shutdown.
- Flushing only covers the session being flushed. Records left behind by a killed process stay in `~/.hindsight/pi-queues` until you open that session and run `/hindsight:flush`.
- `contextRefreshTtlSeconds` is deprecated (recall is fresh per turn) and only remains for old config files.

## Persisted recall caveat

Persisted recall display is for debugging. If you enable it and later uninstall the extension, old recall messages may remain in session files. Before uninstalling, run:

```text
/hindsight:prune-recall-messages confirm
```

Or keep the extension installed but disabled so it can continue filtering old `hindsight-recall` messages.

## More docs

- Architecture: [`docs/architecture-v3.md`](docs/architecture-v3.md)
- Config details: [`docs/config.md`](docs/config.md)
- Commands/tools: [`docs/commands-and-tools.md`](docs/commands-and-tools.md)
- Hindsight API notes and compatibility: [`docs/hindsight-api-notes.md`](docs/hindsight-api-notes.md)
- Hindsight project: [github.com/vectorize-io/hindsight](https://github.com/vectorize-io/hindsight)

## Development

```bash
npm run typecheck
npm test
HINDSIGHT_BASE_URL=http://<your-hindsight-host>:8888 npm run smoke
npm pack          # local tarball, also runs typecheck + tests via prepublishOnly
```

---

## 中文说明

[English](#hindsight-pi) · [中文说明](#中文说明)

给 [pi](https://github.com/mariozechner/pi) 用的透明长期记忆扩展，底层是 [Hindsight](https://github.com/vectorize-io/hindsight)。

它的原则是"记忆要能看见、能检查"：每轮对话按当前问题重新检索相关记忆，新记忆进入持久队列，需要时可以查看、导出或清除。对模型上下文做的修改都是显式的，历史记忆不会以隐藏消息的形式反复回流。

### 特性

- 每轮用户提问都重新 recall，不使用会过期的缓存记忆。
- 历史 `hindsight-recall` 消息会被过滤掉，避免旧记忆反复影响模型。
- 基于 `message_end` 的持久化写入队列（落盘 JSONL，在 `/hindsight:flush`、切换会话或退出时上传），调用 Hindsight `retainBatch`。
- 按会话文档追加写入，document id 稳定，重复回放不会产生重复文档。
- 用 tags + observation scopes 区分项目、用户、会话。
- 推荐"一个 bank + 标签/作用域"；确实需要隔离（工作/个人、不同客户）时才用多 bank。
- 提供 setup / status / doctor / 配置来源查看等诊断命令，以及显式记忆工具。

### 环境要求

- `pi`（在 1.2.0 上验证）。
- 可访问的 Hindsight 服务端。已在 Hindsight 0.5.5+（`api_version` 1.0.0）上验证，旧版本服务端仍可用，见下方"兼容性"。
- Node.js 20+，仅本地开发和 `npm pack` 需要；扩展由 pi 自己加载。

### 安装

从 npm：

```bash
pi install npm:@walodayeet/hindsight-pi
```

从 GitHub：

```bash
pi install git:github.com/00longxiaoyi/hindsight-pi
```

从本地打好的包（`npm pack` 产物）：

```bash
cd ~/.pi/agent/npm
npm i /path/to/walodayeet-hindsight-pi-0.4.1.tgz
```

本地开发（直接加载工作区，不复制）：

```bash
npm install
pi -e ./extensions/index.ts
```

切换来源前先移除已安装的副本，否则 npm 版和本地版会同时加载，工具会重复注册：

```bash
pi remove npm:@walodayeet/hindsight-pi
```

### 快速开始

1. 启动或连接一个 Hindsight 服务端。
2. 重新加载 pi。
3. 依次执行：

```text
/hindsight:setup      # 首次配置
/hindsight:doctor     # 连通性与建库体检
/hindsight:status     # 运行时、队列、记忆库状态
```

服务地址示例：`http://<你的-hindsight-地址>:8888`

`/hindsight:doctor` 是最快的自检方式，会输出当前 bank、`server_api` 版本、是否支持 `bank_config_api`，以及 bank 的记忆/指令/文档数量。

`/hindsight:status` 是更细的视图：额外显示队列深度、上次冲刷时间与错误，以及最近一次 `session_start` / `recall` / `retain` 钩子的执行结果。

### 兼容性（重要）

Hindsight 0.5.5（`api_version` 1.0.0）删除了 bank profile 接口，0.4.0 及更早的扩展版本因此会持续报 405/410。0.4.1+ 的处理方式：

- 读 `/version` 的 `features.bank_config_api` 判断服务端代际。
- 新服务端用 `GET .../banks/{bank_id}/config` 探测 bank 是否存在，用 `PUT .../banks/{bank_id}` 创建。
- 老服务端回退到 `GET .../banks/{bank_id}/profile`，再回退到 `GET /v1/default/banks`。
- **只有明确判定"bank 不存在"时才创建**，避免在不认识的服务器上盲目 upsert 覆盖已有的 `reflect_mission`。
- `observation_scopes` 统一规范成 `string[][]`（扁平数组、空组、未知关键字都会被修正或丢弃）。

环境变量：`HINDSIGHT_API_URL` 与 `HINDSIGHT_BASE_URL` 等价，用哪个都行。

接口级细节（端点对照表、错误特征、scope 规则）见 [`docs/hindsight-api-notes.md`](docs/hindsight-api-notes.md#server-compatibility-hindsight-055-api-10)。

### 推荐的记忆组织方式

- 大多数人用一个 bank 就够。
- 项目/全局的区分用 tags 和 observation scopes，不要一开始就拆多 bank。
- 只有"记忆绝对不能混"的场景（工作 vs 个人、不同客户）才用多个 bank。

预设：

```text
/hindsight:profile broad      # 整个 bank 广域检索
/hindsight:profile project    # 用 {project} 限定到当前项目
/hindsight:profile cwd        # 精确到当前目录
/hindsight:profile global     # 全局 bank 流程
/hindsight:profile isolated   # 每仓库独立 bank + 项目标签
```

### 常用命令

配置与诊断：

| 命令 | 说明 |
|---|---|
| `/hindsight:setup` | 交互式首次配置 |
| `/hindsight:settings` | 交互式修改设置 |
| `/hindsight:status` | 连接、队列、recall、记忆库状态 |
| `/hindsight:doctor` | 连通性与建库体检 |
| `/hindsight:config` | 打印生效配置（密钥已脱敏） |
| `/hindsight:where` | 哪些配置文件存在、各自贡献了什么值 |
| `/hindsight:connect` | 立即连接/重连 |
| `/hindsight:stats` | 服务端支持时查看 bank 统计 |
| `/hindsight:mode` | 切换 recall 模式 |

检索与写入：

| 命令 | 说明 |
|---|---|
| `/hindsight:popup` | 查看最近一次 recall 的原始结果 |
| `/hindsight:inspect-last-recall` | `popup` 的别名 |
| `/hindsight:sync` | 清空最近一次 recall 状态，下一轮重新检索 |
| `/hindsight:flush` | 立即冲刷当前会话的写入队列 |
| `/hindsight:toggle-retain` | 开关当前会话的自动写入 |
| `/hindsight:tag <tag>` | 给当前会话加标签 |
| `/hindsight:remove-tag <tag>` | 移除会话标签 |
| `/hindsight:prune-recall-messages confirm` | 从会话文件清理已持久化的 recall 消息 |

记忆库与会话：

| 命令 | 说明 |
|---|---|
| `/hindsight:profile <name>` | 应用 `broad \| project \| cwd \| global \| isolated` |
| `/hindsight:map <bank-id>` | 把当前目录绑定到指定 bank |
| `/hindsight:parse-session` | 把当前会话解析成 Hindsight JSON 记录（不上传） |
| `/hindsight:parse-and-upsert-session` | 解析并写入当前会话 |
| `/hindsight:upsert-historical-sessions confirm` | 回填当前会话目录下的历史会话 |

### 给模型用的工具

- `hindsight_search` —— 原始记忆检索
- `hindsight_context` —— 合成后的记忆上下文
- `hindsight_retain` —— 显式写入一条长期记忆
- `hindsight_bank_profile` —— 查看当前 bank（名称、使命、disposition、记忆条数、服务端 API 版本）

### 配置文件

全局：

```text
~/.hindsight/config.json
~/.hindsight/config.toml
```

项目级覆盖：

```text
<repo>/.hindsight/config.json
<repo>/.hindsight/config.toml
```

用 `/hindsight:where` 查看哪些文件生效。

最小配置：

```json
{
  "baseUrl": "http://<你的-hindsight-地址>:8888",
  "bankId": "my-memory-bank",
  "bankStrategy": "manual",
  "host": {
    "pi": {
      "enabled": true,
      "recallMode": "hybrid",
      "autoRecallTags": ["{project}"],
      "autoRecallTagsMatch": "any_strict",
      "observationScopes": [["{project}"]]
    }
  }
}
```

`observationScopes` 只能是策略关键字（`per_tag`、`combined`、`all_combinations`、`shared`）或标签组数组（`[["{project}"], ["user:me"]]`）。写成扁平字符串数组会被自动包成一组，而不再报 422。

### 环境变量

常用几项，完整列表见 [`docs/config.md`](docs/config.md#environment-variables)：

| 变量 | 作用 |
|---|---|
| `HINDSIGHT_ENABLED` | 强制启用/禁用 |
| `HINDSIGHT_BASE_URL` / `HINDSIGHT_API_URL` | 服务地址（后者是 Hindsight 官方变量名） |
| `HINDSIGHT_API_KEY` | 服务端 API Key |
| `HINDSIGHT_BANK_ID` | 固定 bank（隐含 `bankStrategy=manual`） |
| `HINDSIGHT_GLOBAL_BANK_ID` | 次级全局 bank |
| `HINDSIGHT_BANK_STRATEGY` | `per-repo` \| `manual` |
| `HINDSIGHT_RECALL_MODE` | `hybrid` \| `tools` \| `off` |
| `HINDSIGHT_AUTO_CREATE_BANK` | 连接时自动创建缺失的 bank |
| `HINDSIGHT_OBSERVATION_SCOPES` | JSON 格式作用域（关键字或标签组） |
| `HINDSIGHT_QUEUE_ROOT` | 覆盖队列目录（默认 `~/.hindsight/pi-queues`） |

优先级：`HINDSIGHT_*` 环境变量 > 项目 `.hindsight/config.*` > 全局 `~/.hindsight/config.*` > 默认值。

### 需要知道的行为默认值

- recall 用原始用户输入，不用展开后的 skill/斜杠命令全文。
- 不带参数的斜杠命令不触发 recall；带参数的从参数里取查询。
- 查询过长默认告警并跳过。
- 自动 recall 默认不持久化（`autoRecallPersist=false`）。
- 指标提示默认只在 UI 显示，不进入模型上下文。
- 写入时会排除 Hindsight 工具自身的反馈，以及检查记忆的提示词。
- `#nomem`、`#skip` 可以让某一轮不自动写入。

### 排错

**报 `405 Method Not Allowed` 或 `410 Gone`，提到 bank profile。**
说明扩展版本还停留在 Hindsight 0.5.5 之前，仍在调已删除的 profile 接口。升级到 0.4.1+，`/hindsight:doctor` 应显示 `bank_config_api: yes`。

**写入报 `422`，提到 `observation_scopes`。**
配置里写成了扁平标签数组。改成关键字或标签组数组；0.4.1+ 也会自动规范化并丢弃非法值。

**`fetch failed` / `ECONNREFUSED`。**
服务没起、端口不对或地址写错。先看 `/hindsight:status` 的 `Base URL`，再跑 `/hindsight:doctor`。

**报 `Bank 'x' not found`。**
要么 `autoCreateBank` 关着，要么推导出的 bank id 与预期不符。看 `/hindsight:status` 的 `Active bank`，或用 `/hindsight:map <bank-id>` / `HINDSIGHT_BANK_ID` 固定。

**recall 一直是空的。**
检查 `/hindsight:status` 里的 `Recall mode` 和 `Recall tags`，标签会大幅收窄结果。`/hindsight:popup` 看最近一次原始结果，`/hindsight:sync` 强制下一轮重新检索。

**写入像是有延迟或丢失。**
写入是"先入队、到冲刷点才上传"：`message_end` 只把记录追加到每个会话的 JSONL 队列（`~/.hindsight/pi-queues`），真正上传发生在 `/hindsight:flush`、切换会话和退出 pi 时。想让记忆立刻出现在 Hindsight 里，就执行 `/hindsight:flush`。`/hindsight:status` 会显示 `Queue: N auto record(s)`、`Last flush`、`Last flush error`。

### 已知限制

- 会话进行中没有东西会自动冲刷写入队列：`writeFrequency`、`retainMode`、`stepRetainThreshold` 仍会出现在 `/hindsight:settings` 和 `/hindsight:status` 里，但没有代码消费它们。记录只在 `/hindsight:flush`、切换会话、退出 pi 时才真正上传。
- 冲刷只覆盖被冲刷的那个会话。进程被强杀时留在 `~/.hindsight/pi-queues` 的记录，要等你重新打开那个会话并执行 `/hindsight:flush` 才会写入。
- `contextRefreshTtlSeconds` 已废弃（recall 每轮重新检索），仅为兼容旧配置保留。

### 卸装注意

持久化 recall 显示是调试用途。开启过它之后如果直接卸载扩展，会话文件里可能残留旧的 recall 消息。卸载前先执行：

```text
/hindsight:prune-recall-messages confirm
```

或者保留扩展但设为禁用，让它继续过滤旧的 `hindsight-recall` 消息。

### 开发

```bash
npm run typecheck
npm test
HINDSIGHT_BASE_URL=http://<你的-hindsight-地址>:8888 npm run smoke
npm pack          # 打本地包，prepublishOnly 会先跑 typecheck + tests
```
