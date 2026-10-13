# Map Data Studio 地图数据工作台

通过桌面界面或 AI 查询高德 POI、采集子点位、补全 Excel 数据和保存景区图片。内置原生 MCP/CLI 与图片浏览器，普通用户无需安装 Node.js、Python 或 Rust。

[下载安装包](https://github.com/FeiXueOpen/map-data-studio/releases/latest) · [详细 AI/MCP 操作指南](docs/AI使用指南.md) · [开发与自动发布](docs/发布与开发.md)

## 功能

- 城市、类型、关键词查询，逐页加载接口可返回的数据；可自定义类型、颜色与手动补点。
- 主点位详情、关联子点位及照片链接采集；保留高德全部原始字段和响应快照。
- 优先获取 AOI 边界，自动查询范围内部点位；无边界或权限不足时手动画多边形兜底。
- 默认杭州标准 34 列景区表，或填写用户的空白 `.xlsx` 模板。
- AI 按来源补全票价、预约、攻略等字段；支持用户制定每列补填规则、类型和字数限制。
- 导出时下载实际导出主点的高德图片；明确提出“联网补图”才触发额外图片搜索。

**AI 研究由连接的 AI 客户端执行，MCP 本身不运行大模型。** 直接点击软件导出按钮只使用已有数据，不自动研究缺项。接口分页、配额和权限可能限制结果，不能承诺穷尽全城全部点位。

## 安装

| 系统 | 下载资源 | 要求 |
| --- | --- | --- |
| Windows | x64 `-setup.exe`，或 `windows-x64.zip` | Windows 10/11 x64，WebView2 |
| Mac Apple Silicon | `aarch64.dmg`，或 `macos-arm64.zip` | M 系列芯片，macOS 13.5+ |
| Mac Intel | `x64.dmg`，或 `macos-x64.zip` | Intel 芯片，macOS 13.5+ |

Windows 运行安装程序；Mac 打开 DMG，将应用拖到 Applications。ZIP 是供 AI/安装脚本使用的完整应用。包较大是因为包含图片浏览器及运行时。Windows 安装程序处理 WebView2，便携 ZIP 需本机已有 WebView2。

当前尚未配置开发者签名和 Apple 公证证书，系统可能要求用户完成首次运行确认。安装脚本不会关闭系统安全功能、移除隔离属性或自动绕过警告。

### 让 AI 帮忙安装

可以向能够联网、执行本机命令及操作桌面的 AI 发送：

> 请帮我安装 GitHub 上 FeiXueOpen/map-data-studio。先读取 README 和 automation/mcp-manifest.json，识别我的系统和 CPU，下载对应最新 Release 并校验 SHA256，配置到我当前使用的豆包客户端，安装中文 Skill。保留其他 MCP 配置，完成后调用 get_status 验证。需要我填写高德密钥或确认系统权限时提示我。

仅能聊天、不能访问本机的 AI 无法安装本机应用。豆包未核实到公开自动注册接口：具备界面操作能力的 AI 可继续新建连接器；只运行脚本会生成配置和技能文件，**不等于豆包已注册、已连接**。首次密钥、系统确认和本次会话 AI 控制开关仍需用户配合。

安装脚本自动识别架构、读取最新 Release、校验 SHA256，安装到当前用户目录。请先下载查看脚本再运行。重复安装保留应用备份，不删除用户数据；已有同名 MCP 配置不强制覆盖。

Mac：

```sh
curl -fL https://raw.githubusercontent.com/FeiXueOpen/map-data-studio/main/scripts/install/install.sh -o /tmp/map-data-install.sh
bash /tmp/map-data-install.sh --client doubao
# 也支持 --client codex / claude / none
# --version v0.1.0；--dry-run 查看计划；--no-open 不启动应用
```

Windows PowerShell：

```powershell
Invoke-WebRequest 'https://raw.githubusercontent.com/FeiXueOpen/map-data-studio/main/scripts/install/install.ps1' -OutFile "$env:TEMP\map-data-install.ps1"
& "$env:TEMP\map-data-install.ps1" -Client doubao
# 也支持 -Client codex / claude / none；-Version v0.1.0；-DryRun；-NoOpen
```

PowerShell 若受组织执行策略限制，按组织规则处理，不必修改机器级安全策略。

## 首次设置：自己的三项高德密钥

打开软件 → 左侧“设置”，填写并保存：

| 设置项 | 高德控制台类型 | 用途 |
| --- | --- | --- |
| 高德 Web API Key | **Web 服务** Key | 城市定位、搜索、详情、范围与 AOI |
| 高德 Web JS Key | **Web 端（JS API）** Key | 界面地图显示和交互 |
| JS API 安全密钥 | JS Key 对应的 `securityJsCode` | JS 安全校验，必须与上面的 JS Key 匹配 |

在[高德开放平台控制台](https://console.amap.com/)创建自己的应用和 Key，按平台要求设置域名和接口权限。Web 服务 Key 和 JS Key 不可混用。AOI 可能需要账户单独授权，无权限或无边界时软件退回手动圈选。

发布包不含开发者密钥，密钥保存在本机用户配置目录。不要把密钥放进共享聊天示例、仓库或 Excel。MCP 不提供修改密钥的接口。

设置中还可指定 Excel、图片和其他资源目录，默认系统文档目录 `Map Data Studio/Excel`、`Images`、`Resources`。图片以点位名称建文件夹。图片浏览器代理留空使用系统/环境代理，需要时填写本机实际代理地址。

## MCP 与 Skill 接入

MCP 提供控制接口；Skill 提供中文流程说明，指导 AI 分页、等待、查证、映射和导出，推荐同时安装。Skill 不等于连接器；MCP 不会自己联网搜索或自动给空闲 AI 发起新一轮对话。

1. 打开 Map Data Studio，“设置 → AI 控制 / MCP”点“开启 AI 控制”，每次重开软件都需开启。
2. 在 AI 客户端添加连接器，优先 **stdio**。
3. 安装 Release 的 `map-data-studio-skill.zip`，或使用仓库 `automation/map-data-studio` 技能目录。
4. 重载 AI 会话/启用连接器，让 AI 调用 `get_status` 验证。

### 豆包

进入“技能 / 连接器 / 伙伴”（版本间名称可能不同）→ 新建自定义连接器：

- 支持 STDIO 时，命令填软件设置中提供的原生程序绝对路径，参数单独添加 `--mcp-stdio`。
- 只支持 HTTP 时，复制应用设置中的 HTTP 配置。URL 为实际 `http://127.0.0.1:端口/mcp`；Header 名 `Authorization`，值 `Bearer 本机实际控制令牌`。不要粘入 Markdown 链接语法。
- 保存、在当前会话启用连接器，并在技能页导入中文技能 ZIP，再验证 `get_status`。

HTTP 端口和令牌重新开启后会变化，需要更新 HTTP 连接器。客户端与软件应在同一电脑，不能把 127.0.0.1 当作云端服务地址。脚本生成的 stdio 配置在文档目录 `Map Data Studio/Resources/map-data-studio-mcp.json`；仅 HTTP 的版本仍以应用设置中的真实配置为准。不要把本机令牌提交到仓库或发送给远程服务。

### Codex

脚本的 `codex` 选项会备份并添加 `~/.codex/config.toml` 的独立 MCP 项，其他服务器保留；配置了 `CODEX_HOME` 时使用该目录。共享技能复制到 `~/.agents/skills/map-data-studio`，重载后使用。

```sh
codex mcp add map-data-studio -- '/实际原生程序绝对路径' --mcp-stdio
```

也可手动配置：

```toml
[mcp_servers.map-data-studio]
command = "/实际原生程序绝对路径"
args = ["--mcp-stdio"]
```

Mac 程序为 `Map Data Studio.app/Contents/MacOS/map-data-studio`；Windows 为安装目录的 `map-data-studio.exe`。[Codex 官方 MCP 说明](https://developers.openai.com/codex/mcp/)

### Claude Desktop / 其他客户端

脚本的 `claude` 选项备份并添加 `claude_desktop_config.json`，仅添加缺失的同名服务器。Mac 位于 `~/Library/Application Support/Claude`，Windows 位于 `%APPDATA%/Claude`。重启后使用。其他支持 stdio/HTTP 的客户端使用设置中复制的配置；Skill 导入能力以客户端版本为准。

```json
{
  "mcpServers": {
    "map-data-studio": {
      "command": "/实际原生程序绝对路径",
      "args": ["--mcp-stdio"]
    }
  }
}
```

Windows JSON 路径的反斜杠需转义，建议直接复制软件提供的配置。stdio 每次读取本机连接文件，可跟随端口/令牌轮换，不需要用户安装 Node.js 或 Python。

## 与 AI 沟通的完整例子

**查询、补全和默认导出：**

> 用 Map Data Studio MCP 查询北京市景区，逐页加载可返回数据并采集详情。有依据地选 10 个独立景区，不包含停车场/门区，不冒充客流排名。按默认杭州 34 列格式研究全部缺项，优先官方资料，补全票价、费用、预约、时间与攻略。成人/学生票仅价格；儿童/老人可带简短年龄/身高条件，其他说明写费用明细。未知留空并列明，另存 Excel 到默认目录，不覆盖文件。测试只下载前 5 个景区高德图片，不联网补图。

**发送空白模板、指定每列规则：**

> 这是空白城市数据模板，请采集南昌市景区并填写。简介根据官方资料概括，最多 80 字；成人票、学生票只填价格数字；儿童票用“价格 (身高条件)”；老人票用“价格 (年龄条件)”；开放时间 HH:mm-HH:mm，保留季节及闭馆规则；最佳游览写建议时段和季节，标为 AI 建议。将逐列要求传入 MCP 补全任务，查证后附来源回填，检查所有缺项，再另存结果，不能只补简介。

聊天附件须由 AI 保存到运行软件的电脑，才能用本机路径传给 MCP。已填杭州样例仅作格式参考，不能复制其事实或覆盖原文件。

**筛选数量：**

> 导出人流量较多的前 50 个景区。先找相同时段、单位和范围可比较的客流；不足时不要用评分冒充，可以明确改为 AI 综合推荐，告诉我依据和实际数量，不为凑数编造。

**内部点位与子景区：**

> 给已采集的“橘子洲风景名胜区”查询内部点位，优先 AOI 边界，无边界时才弹出软件等待我手动圈范围。完成后查看全部子点及图片，按附件模板仅导出子景区 Excel，缺项查证补齐，不混入主景区。

手动补点也能使用此流程；手动父点没有高德 ID 时会等待用户画范围。范围内点位与高德官方父子关系有所区别。

**额外联网补图（须明确提出）：**

> 顺带为导出景区每个补 3 张互联网图片，百度竖图分类，目标 3:4。共用一个浏览器，搜索间隔 8 秒。原图存入景区名称文件夹，不裁剪或缩放；遇验证提示我处理并等待，数量不足说明原因。

百度竖图分类不是精确 3:4 保证。精确宽高可作搜索参数，但图片是否足够仍需检查。普通查询/采集/导出不会自动联网补图。

## 开发和自动发布

开发者执行 `npm ci`、`npm run tauri -- dev`，并安装对应系统 Rust/Tauri 构建工具。普通用户下载 Release 即可。

三个版本号同步后推送 `v版本号` 标签，Actions 自动测试并构建 Windows x64、Mac arm64、Mac x64。全部成功才公开 Release，失败时保留草稿供检查，不发布半成品。安装包、便携 ZIP、SHA256、安装脚本、中文技能 ZIP 与 MCP 清单一起发布。详见[发布与开发](docs/发布与开发.md)。
