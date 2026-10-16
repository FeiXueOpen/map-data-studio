## Map Data Studio 桌面版

下载适合本机系统的 Windows x64、Mac Apple Silicon 或 Mac Intel 版本。ZIP 包附 SHA256，内置图片浏览器及原生 MCP/CLI，不需要另外安装 Node.js/Python。

中文安装、密钥设置、豆包/Codex/Claude 接入、技能及完整示例：[README](https://github.com/FeiXueOpen/map-data-studio#readme)。

首次请配置自己的高德 Web API Key、Web JS Key 与安全密钥；软件启动后自动开启 AI 控制，无需人工开关。尚未配置开发者签名/Apple 公证，首次打开可能需要用户按系统提示确认。

主要能力：POI 分页、详情与子点、AOI 和手动范围兜底、原始字段保留、AI 逐列规则补全、标准/模板 Excel、按需保存高德图片及明确请求时联网补图。成人/学生票为数值，儿童/老人可带简短条件，未知事实留空，附来源与规则审计。

CLI + Skill 支持快速原始数据路径：`start_query` 可合并按名称选城和查询设置，Top N 使用 `autoCollect:false`；`start_collection` 默认只补指定主点详情，明确 `includeChildren:true` 才递归关联子点。高德详情仍缺少任务必需字段时，AI 可在用户未限制来源的前提下仅对入选项联网查证，保留来源且不冒充高德字段。CLI 的 `--wait`/`wait` 在本机等待长任务，避免 AI 反复轮询；MCP 可用 `get_operation` 获取精简状态。Excel 导出默认不隐式下载图片，模板检查同步返回，联网图片下载使用有限并发。
