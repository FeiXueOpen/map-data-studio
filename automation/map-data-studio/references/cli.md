# 内置 CLI 接入

CLI 是跨 AI 客户端的默认控制通道，随桌面程序发布，不依赖系统 Node.js、Python 或 Rust。MCP 是可选增强；未加载 MCP 时不要中断任务，改用 CLI 调用同一套工具。

安装完成后从 `ai-install-plan.json` 的 `cli.command` 取得程序绝对路径。支持以下命令：

```sh
"<程序>" describe --json
"<程序>" doctor --json
"<程序>" open --json
"<程序>" status --json
"<程序>" tools --json
"<程序>" call <tool> --args '<JSON对象>'
"<程序>" call <tool> --args-file /绝对路径/request.json
"<程序>" call <tool> --stdin
"<程序>" skill install --client auto --json
```

旧版 `--cli status|tools|call` 写法继续兼容。Windows PowerShell 执行带空格的绝对路径时在路径前使用调用运算符 `&`，参数仍应逐项传递。

`describe` 离线读取随包工具 Schema；`doctor` 检查 Skill、连接文件和本机服务；`open` 启动桌面应用。`status`、`tools` 和 `call` 在应用未启动且连接文件不存在时会尝试启动应用并等待服务就绪。所有结果为 JSON，非零退出码表示命令未完成。

安装 Skill 时，`auto` 总是安装共享目录，并为已存在的 Codex/Claude 目录增加副本；也可显式指定 `doubao`、`codex`、`claude` 或 `all`。已有同名 Skill 会先备份。安装文件存在不代表当前会话已经加载，必要时重载客户端或新建会话。

调用业务工具时把自然语言转换为工具参数。小参数可使用 `--args`；批量补全、多边形坐标或复杂 Excel 列规则优先写入临时 JSON 文件并使用 `--args-file`，或者把 JSON 对象传给标准输入。三种方式互斥，单次输入上限 16 MiB。不要依赖超长 Shell 命令，也不要把 Excel 或图片二进制内容放进 JSON，只传本机文件路径。

例如：

```sh
"<程序>" call list_cities --args '{"provinceId":3761}'
"<程序>" call select_city --args '{"cityId":430100}'
"<程序>" call get_status --args '{}'
"<程序>" call supplement_pois --args-file /tmp/supplements.json
```

不要在命令、日志或答复中输出 `automation-connection.json` 的令牌。长任务返回 `operationId` 后，用 `status` 或 `call get_status` 轮询，直到完成、失败或取消。列表使用工具自身的 `page`、`pageSize` 分页，不让一次 CLI 输出承载全部城市数据。
