# 豆包安装与验收

用户要求在豆包安装 GitHub 上的 FeiXueOpen/map-data-studio 时，使用 CLI + Skill 作为默认通道；当前豆包版本能稳定注册连接器时，再增加 MCP。需能访问本机文件并执行命令，不能操作时明确剩余步骤。

1. 按系统和 CPU 架构下载最新 Release 应用及 SHA256，运行 `scripts/install/install-doubao.sh` 或 `install-doubao.ps1`。无需系统 Node.js/Python，不让普通用户编译源码；保留已有应用备份和其他客户端配置。
2. 读取文档目录 `Map Data Studio/Resources/doubao-install-plan.json`。使用其中的 `cli.command` 执行 `skill install --client doubao --json`，然后让当前豆包对话加载 `skill.sharedDirectory`。复制文件成功后仍可能需要重载或新建会话。
3. 执行 `doctor --json` 和 `status --json`。命令会在需要时启动桌面应用；首次系统确认和高德密钥由用户处理。状态返回即表示默认 CLI 控制通道可用，可以按 Skill 执行业务工具。
4. 当前豆包具备稳定的连接器创建能力时，可选注册同名 MCP。支持 STDIO 时严格使用计划中的 `connector.command` 和每个独立参数；只支持 HTTP 时读取 `httpFallback.source` 指向的本机连接文件，URL 使用纯文本，Authorization 为 `Bearer 当前token`，且不在回复中显示令牌。备份后只更新同名连接器，保留其他连接器；不要修改豆包未公开的内部数据库。
5. 如果配置 MCP，确认连接器详情包含 `get_status` 等工具，并在真实会话调用。MCP 失败时记录具体停点，继续使用 CLI；不能把 CLI 结果称为 MCP 验证通过。
6. 分别报告应用、Skill、CLI 和可选 MCP 的结果。前三项成功即可开始业务任务。未授权查询时只验证状态，不额外采集或导出。

HTTP 端口和令牌可能随应用重启变化；stdio 会重新读取连接文件。令牌不得输出、上传或提交到仓库。
