## Map Data Studio 桌面版

下载适合本机系统的 Windows x64、Mac Apple Silicon 或 Mac Intel 版本。ZIP 包附 SHA256，内置图片浏览器及原生 MCP/CLI，不需要另外安装 Node.js/Python。

中文安装、密钥设置、豆包/Codex/Claude 接入、技能及完整示例：[README](https://github.com/FeiXueOpen/map-data-studio#readme)。

首次请配置自己的高德 Web API Key、Web JS Key 与安全密钥；软件启动后自动开启 AI 控制，无需人工开关。尚未配置开发者签名/Apple 公证，首次打开可能需要用户按系统提示确认。

主要能力：POI 分页、详情与子点、AOI 和手动范围兜底、原始字段保留、AI 逐列规则补全、标准/模板 Excel、导出高德图片及明确请求时联网补图。成人/学生票为数值，儿童/老人可带简短条件，未知事实留空，附来源与规则审计。

优化多 AI 客户端安装口令和升级流程：备份后自动更新旧的同名 `map-data-studio` 配置，同时保留其他 MCP 与客户端设置；豆包会根据客户端能力选择 STDIO 或本机 HTTP，避免把 Markdown URL、过期端口或令牌填入连接器。安装结果按应用、Skill、工具清单和真实会话调用四层验收，CLI 成功不视为会话 MCP 成功。
