# AI 客户端安装与验收

用户要求安装或配置 Map Data Studio 时，CLI + Skill 是默认通用方式，MCP 是客户端支持时的增强方式。安装应保留其他 MCP、Skill 和客户端配置。不要把 CLI 验证报告为 MCP 注入成功，也不要因 MCP 不可用而否定已经可用的 CLI 通道。

## 共同流程

1. 从 GitHub Release 下载与操作系统和 CPU 匹配的完整应用 ZIP，校验 SHA256，使用发布的安装脚本。普通用户不编译源码，不另外安装 Node.js 或 Python。
2. 启动工作台。v0.1.2 及以后会自动开启本地 AI 控制。系统首次打开确认由用户处理。
3. 读取文档目录 `Map Data Studio/Resources/ai-install-plan.json`，使用 `cli.command` 执行 `skill install --client auto --json`、`doctor --json` 和 `status --json`。安装脚本通常已完成首次 Skill 复制，命令会安全更新并备份旧版本。
4. 确认当前客户端已经加载 Skill；必要时重载或新建会话。CLI 状态返回即表示默认控制通道可用。
5. 客户端原生支持 MCP 时，再根据计划注册 stdio 或 HTTP。发现旧的同名配置时先备份再更新，保留其他 MCP、Skill 与设置；在真实会话调用 MCP `get_status` 验证工具注入。
6. 分开报告应用、Skill、CLI和可选 MCP 结果。MCP 失败时说明具体停点，继续使用已验证的 CLI 通道。

## Codex

通用安装已支持 CLI。安装脚本的 `codex` 模式还会备份原有 `~/.codex/config.toml`，添加或更新 `[mcp_servers.map-data-studio]`，并把 Skill 安装到 Codex 专用目录与共享目录。配置后用 `codex mcp list` 检查可选 MCP 注册。

## Claude Desktop

Claude 能执行本机命令时可直接使用默认 CLI。需要 MCP 时优先安装匹配架构的 `.mcpb`；不支持 MCPB 时由安装脚本合并配置。Skill 可由 CLI 安装到本机目录，Claude Desktop 需要界面导入时使用 Release 的 `map-data-studio-skill.zip`。

## 豆包

读取 [豆包专用安装与验收](doubao-install.md)。优先安装并加载 Skill，通过 CLI 完成状态验证和业务操作。当前豆包版本能稳定注册连接器时，再增加 MCP；连接器失败不影响 CLI 通道。
