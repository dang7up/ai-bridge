# How To Add A New Backend

## 1) ai-bridge 架构概览

`ai-bridge` 的核心目标是把不同 AI 工具的会话格式统一到一个中间表示（IR），然后再写入目标工具格式，实现跨工具会话迁移。

核心流程：

1. CLI 入口解析参数（`--from`、`--to`、`--list-backend`、`--list-session`）。
2. 根据 `--from <tool:session_id>` 找到 source adapter。
3. source adapter 读取原始会话并转换成 IR（`read()`）。
4. 将 IR 保存到 `~/.ai-bridge/sessions/*.jsonl`（可审计、可回放）。
5. target adapter 把 IR 写成目标工具会话格式（`write()`）。
6. 生成并执行目标工具 resume 命令（`getResumeCommand()`）。

关键代码位置：

- CLI 入口：[src/index.ts](../src/index.ts)
- 主桥接逻辑：[src/commands/bridge.ts](../src/commands/bridge.ts)
- 会话列表命令：[src/commands/list.ts](../src/commands/list.ts)
- 通用类型与 IR 定义：[src/types.ts](../src/types.ts)

## 2) 模块化组织与动态注册

目录结构（核心）：

- `src/adapters/<backend>/reader.ts`：backend 入口实现（必须有）
- `src/adapters/<backend>/writer.ts`：写入逻辑（可选，通常会拆分）
- `src/adapters/<backend>/utils.ts`：路径与格式辅助函数（可选）
- `src/adapters/registry.ts`：动态扫描并注册 adapters
- `src/utils/*`：文件、ID、spawn 等通用工具

动态加载机制（当前实现）：

1. `registry.ts` 扫描 `adapters` 目录下所有子文件夹。
2. 每个子文件夹尝试加载 `reader.js`（运行时）或 `reader.ts`（开发态）。
3. 自动遍历该模块导出的 class，实例化后检查是否满足 `ToolAdapter` 形状。
4. 用实例的 `name` 字段作为 backend 名称注册。
5. CLI 的 backend 校验和 `--list-backend` 都来自运行时注册结果。

因此：

- 不需要在 `registry.ts` 写死某个 backend 名称。
- 不需要在 `types.ts` 维护固定 backend 枚举。
- 原则上是“有一个 adapter 文件夹，就可发现一个 backend（前提是 `reader.ts` 正确导出 adapter 类）”。

当前支持的 backend（以 `node ./dist/index.js --list-backend` 为准）：

- `aiden`
- `claude`
- `codex`
- `copilot`
- `kimi`
- `trae`
- `traecli`

## 3) 新增一个 Backend 的步骤

下面以新增 `mybackend` 为例。

### Step 1. 创建目录

在 `src/adapters` 下新增目录：

```bash
mkdir -p src/adapters/mybackend
```

### Step 2. 实现 `reader.ts` 并导出 Adapter

最少需要实现并导出一个类，满足 `ToolAdapter` 接口：

```ts
// src/adapters/mybackend/reader.ts
import type { ToolAdapter, SessionInfo, IREntry } from "../../types.js";

export class MyBackendAdapter implements ToolAdapter {
  readonly name = "mybackend";

  async listSessions(): Promise<SessionInfo[]> {
    return [];
  }

  async findSession(sessionId: string): Promise<SessionInfo | null> {
    const sessions = await this.listSessions();
    return sessions.find((s) => s.sessionId.startsWith(sessionId)) ?? null;
  }

  async read(session: SessionInfo): Promise<IREntry[]> {
    return [];
  }

  async write(entries: IREntry[], targetCwd: string): Promise<string> {
    return "new-session-id";
  }

  getResumeCommand(sessionId: string): { command: string; args: string[] } {
    return { command: "mybackend", args: ["--resume", sessionId] };
  }
}
```

注意：

- `name` 必须唯一；与其他 backend 重名会在注册阶段报错。
- `reader.ts` 必须真的导出 class（只写默认函数不行）。
- 构造函数不要做会失败的重操作，否则会导致扫描时跳过或报错。

### Step 3.（推荐）拆分 writer/utils

可把复杂逻辑拆出去，保持 `reader.ts` 只做 adapter 组装：

- `writer.ts`：实现目标格式序列化和写盘
- `utils.ts`：目录路径、ID 匹配、字段转换

### Step 4. 构建

```bash
npm run build
```

当前 `build` 使用 `tsc`，会把 `src/adapters/<backend>/reader.ts` 编译成 `dist/adapters/<backend>/reader.js`，供动态加载使用。

### Step 5. 验证注册与读写链路

```bash
node ./dist/index.js --list-backend
node ./dist/index.js --list-session mybackend
node ./dist/index.js --from mybackend:<session-id-prefix> --to codex --dry-run
```

如果要验证写入：

```bash
node ./dist/index.js --from mybackend:<session-id-prefix> --to codex
```

## 4) FAQ

### Q1: 新 backend 没出现在 `--list-backend` 里

常见原因：

- `src/adapters/mybackend/reader.ts` 不存在。
- `reader.ts` 没有导出 adapter class。
- adapter class 实例不满足 `ToolAdapter` 形状（缺方法或 `name` 不是 string）。
- 构造函数抛异常导致扫描失败。
- 没有重新 `npm run build`，`dist` 里不存在对应 `reader.js`。

### Q2: 报 `Duplicate adapter name`

两个不同 adapter 导出了相同的 `name`。把新 backend 的 `name` 改成唯一值即可。

### Q3: `Unknown tool: xxx`，但我已经加了目录

先确认：

1. `npm run build` 已执行且成功。
2. `dist/adapters/<backend>/reader.js` 存在。
3. `reader.ts` 导出的 class 的 `name` 与命令行参数完全一致。

### Q4: `--list-session mybackend` 没数据

优先检查 `listSessions()`：

- 路径是否写对（用户目录、缓存目录、配置目录）。
- 会话文件格式解析是否正确。
- 时间字段是否可解析（影响排序，但不影响显示）。

### Q5: 桥接成功但 resume 后看不到内容

优先检查 `write()` 与 `getResumeCommand()`：

- 目标 backend 会话文件是否写在正确目录。
- 生成的 session id 是否与 resume 命令使用的 id 一致。
- 必需元数据（如 cwd/title/model）是否写全。

### Q6: 我想让一个 backend 文件夹注册多个名字（别名）

当前也支持同一 `reader.ts` 导出多个 adapter class（每个 class 一个 `name`）。  
但为了可维护性，建议“一个 backend 名称对应一个目录”，避免后续排查困难。

