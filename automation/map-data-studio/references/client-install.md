# AI 客户端安装与验收

用户要求安装或配置 Map Data Studio 时，先识别当前 AI 客户端，再使用对应方式。安装应保留其他 MCP、Skill 和客户端配置。不要把下载完成、CLI 预检或配置文件生成报告为会话 MCP 验收成功。

## 共同流程

1. 从 GitHub Release 下载与操作系统和 CPU 匹配的完整应用 ZIP，校验 SHA256，使用发布的安装脚本。普通用户不编译源码，不另外安装 Node.js 或 Python。
2. 启动工作台。v0.1.2 及以后会自动开启本地 AI 控制。系统首次打开确认由用户处理。
3. 读取文档目录 `Map Data Studio/Resources/ai-install-plan.json`，核对当前客户端、原生程序、连接文件和技能路径。
4. 发现旧的同名 `map-data-studio` 配置时，先备份再更新到计划中的新路径和参数；其他 MCP、Skill 与客户端设置必须保留。
5. 完成 MCP 注册与 Skill 安装后，重载或新建会话。仅通过 `map-data-studio` MCP 调用 `get_status`，核对 `city`、`mapReady`、`error`、`total`。不查询、不导出、不用终端、CLI 或自行模拟协议替代。能得到真实结构化返回说明 MCP 通道已连通；`mapReady:false` 或密钥错误应作为应用状态另行报告。
6. 分开报告应用安装、Skill 加载、MCP 工具目录和会话真实调用结果。任一层失败都说明具体停点，不提前宣布全部成功。

## Codex

安装脚本的 `codex` 模式备份原有 `~/.codex/config.toml`，添加或更新 `[mcp_servers.map-data-studio]`，其他配置保持不变。Skill 同时安装到 Codex 专用目录与共享 `.agents` 目录。配置后用 `codex mcp list` 检查注册，重新加载或新建 Codex 会话再完成 `get_status` 验收。

## Claude Desktop

优先安装 Release 中与当前系统和架构对应的 `.mcpb` 桌面扩展；它是本地 MCP 的一键包，仍需 Map Data Studio 应用运行。如客户端不支持 MCPB，安装脚本会备份 `claude_desktop_config.json`，更新同名服务并保留其他配置。导入 Release 的 `map-data-studio-skill.zip` 到 `Customize > Skills`，确认开关已开启。重启 Claude Desktop，在 Connectors 中确认工具后做 `get_status` 验收。

## 豆包

读取 [豆包专用安装与验收](doubao-install.md)。当前豆包对话若具备技能安装或连接器管理能力，必须优先在当前对话内完成注册和绑定。只有该能力不可用时才使用公开管理界面兜底。
