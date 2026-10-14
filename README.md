# Map Data Studio 地图数据工作台

通过桌面界面或 AI 查询高德 POI、采集子点位、补全 Excel 数据和保存景区图片。内置原生 CLI、MCP 与图片浏览器，普通用户无需安装 Node.js、Python 或 Rust。

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

向能够联网并执行本机命令的 AI 发送这一句话即可：

> 帮我安装 GitHub 上的 FeiXueOpen/map-data-studio。

仓库提供机器可读清单、自动识别系统架构的脚本和随包中文 Skill。默认完成应用安装、Skill 安装、启动及 CLI 状态验证；当前 AI 客户端稳定支持 MCP 时再增加 MCP。仅能聊天、不能访问本机的 AI 无法安装本机应用。首次密钥和系统启动确认仍需用户配合；软件会自动开启 AI 控制。

安装脚本自动识别架构、读取最新 Release、校验 SHA256，安装到当前用户目录。请先下载查看脚本再运行。重复安装保留应用备份，不删除用户数据；已有同名 MCP 配置不强制覆盖。

Mac：

```sh
curl -fL https://raw.githubusercontent.com/FeiXueOpen/map-data-studio/main/scripts/install/install.sh -o /tmp/map-data-install.sh
bash /tmp/map-data-install.sh
# 自动模式默认安装 CLI + Skill；也支持 --client doubao / codex / claude / none
# --version v0.1.5；--dry-run 查看计划；--no-open 不启动应用
```

Windows PowerShell：

```powershell
Invoke-WebRequest 'https://raw.githubusercontent.com/FeiXueOpen/map-data-studio/main/scripts/install/install.ps1' -OutFile "$env:TEMP\map-data-install.ps1"
& "$env:TEMP\map-data-install.ps1"
# 自动模式默认安装 CLI + Skill；也支持 -Client doubao / codex / claude / none
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

## AI 接入：CLI + Skill 与可选 MCP

**CLI + Skill 是默认兼容方式。** CLI 提供结构化控制命令，Skill 指导 AI 分页、等待、查证、映射和导出；二者随应用发布，不需要系统 Node.js/Python。MCP 调用同一套工具，是支持客户端的可选增强。

安装计划中的 `cli.command` 是当前电脑的程序绝对路径。AI 可执行：

```sh
"<程序>" skill install --client auto --json
"<程序>" describe --json
"<程序>" doctor --json
"<程序>" status --json
"<程序>" call list_cities --args '{"provinceId":3761}'
"<程序>" call supplement_pois --args-file /绝对路径/request.json
```

`status/tools/call` 在连接文件尚不存在时会尝试启动桌面应用。小参数使用 `--args`；大量补全数据使用 `--args-file` 或 `--stdin`，单次上限 16 MiB，避免系统命令行长度和转义限制。Excel、图片只传文件路径。已有 Skill 会先备份。安装后需要让当前 AI 客户端重载 Skill；客户端支持 MCP 时，可继续按下面方式添加连接器。

### 豆包

进入“技能 / 连接器 / 伙伴”（版本间名称可能不同）→ 新建自定义连接器：

- 支持 STDIO 时，命令填软件设置中提供的原生程序绝对路径，参数单独添加 `--mcp-stdio`。
- 只支持 HTTP 时，复制应用设置中的 HTTP 配置。URL 为实际 `http://127.0.0.1:端口/mcp`；Header 名 `Authorization`，值 `Bearer 本机实际控制令牌`。不要粘入 Markdown 链接语法。
- 保存、在当前会话启用连接器，并在技能页导入中文技能 ZIP，再验证 `get_status`。

HTTP 端口和令牌重新开启后会变化，需要更新 HTTP 连接器。客户端与软件应在同一电脑，不能把 127.0.0.1 当作云端服务地址。脚本生成的 stdio 配置在文档目录 `Map Data Studio/Resources/map-data-studio-mcp.json`；仅 HTTP 的版本仍以应用设置中的真实配置为准。不要把本机令牌提交到仓库或发送给远程服务。

### 豆包安装

豆包同样只需发送：“帮我安装 GitHub 上的 FeiXueOpen/map-data-studio”。默认通过 CLI + Skill 使用，不再把连接器配置作为安装成功的前置条件。豆包当前版本能稳定加载 MCP 时，可再按 `doubao-install-plan.json` 增加连接器。

Mac专用入口：下载查看 `scripts/install/install-doubao.sh` 后运行 `bash install-doubao.sh`。Windows专用入口为 `scripts/install/install-doubao.ps1`。支持版本指定、dry-run和不启动应用选项，详见脚本参数。

计划文件位于文档目录 `Map Data Studio/Resources/doubao-install-plan.json`，包含当前电脑的实际程序路径、连接文件路径、命令及独立参数。Mac兼容入口用 `/usr/bin/env`；第一个参数是原生程序路径，其后 `--mcp-stdio`、`--connection-file`、实际文件路径，各填一行，无需额外shell引号。详见[豆包安装与验收](automation/map-data-studio/references/doubao-install.md)。

“连接器运行失败”和“会话没有工具”需分别排查。豆包对话内安装是首选，GUI 是兜底。确认详情页操作清单；必要时重启豆包并新建会话验证。某版本若仍不注入工具，MCP 服务端无法强行把工具塞入模型。

### Codex

脚本的 `codex` 选项会备份并添加 `~/.codex/config.toml` 的独立 MCP 项，其他服务器保留；配置了 `CODEX_HOME` 时使用该目录。Skill 同时安装到 Codex 专用 `skills/map-data-studio` 和共享 `~/.agents/skills/map-data-studio`。执行 `codex mcp list` 后重载会话，再用 `get_status` 验收。

```sh
codex mcp add map-data-studio -- '/实际原生程序绝对路径' --mcp-stdio
```

也可手动配置：

```toml
[mcp_servers.map-data-studio]
command = "/实际原生程序绝对路径"
args = ["--mcp-stdio"]
```

Mac 程序为 `Map Data Studio.app/Contents/MacOS/map-data-studio`；Windows 为安装目录的 `map-data-studio.exe`。[Codex 官方 MCP 说明](https://developers.openai.com/learn/docs-mcp)

Codex 安装口令：

> 帮我安装 GitHub 上的 FeiXueOpen/map-data-studio。默认完成 CLI + Skill 验证；如果当前 Codex 支持 MCP，再保留其他配置并增加 map-data-studio MCP。

### Claude Desktop / 其他客户端

Claude Desktop 优先安装 Release 中与系统架构匹配的 `.mcpb` 一键本地扩展，并在 `Customize > Skills` 导入 `map-data-studio-skill.zip`。不支持 MCPB 时，脚本的 `claude` 选项会备份并合并 `claude_desktop_config.json`，仅添加缺失的同名服务器。Mac 位于 `~/Library/Application Support/Claude`，Windows 位于 `%APPDATA%/Claude`。重启 Claude Desktop，在 Connectors 中确认工具，再用 `get_status` 验收。

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

Claude 安装口令：

> 帮我安装 GitHub 上的 FeiXueOpen/map-data-studio。默认完成 CLI + Skill 验证；如果当前 Claude 支持本地 MCP，再安装匹配架构的 MCPB 并单独验证连接器。

Claude Desktop 官方建议本机 MCP 使用桌面扩展，自定义 Skill 以 ZIP 导入：[Local MCP servers](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop) · [Use skills in Claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude)

## 与 AI 沟通的完整例子

**查询、补全和默认导出：**

> 用 Map Data Studio 查询北京市景区，逐页加载可返回数据并采集详情。有依据地选 10 个独立景区，不包含停车场/门区，不冒充客流排名。按默认杭州 34 列格式研究全部缺项，优先官方资料，补全票价、费用、预约、时间与攻略。成人/学生票仅价格；儿童/老人可带简短年龄/身高条件，其他说明写费用明细。未知留空并列明，另存 Excel 到默认目录，不覆盖文件。测试只下载前 5 个景区高德图片，不联网补图。

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

三个版本号同步后推送 `v版本号` 标签，Actions 自动测试并构建 Windows x64、Mac arm64、Mac x64。全部成功才公开 Release，失败时保留草稿供检查，不发布半成品。安装包、便携 ZIP、SHA256、安装脚本、中文技能 ZIP、各平台 Claude Desktop MCPB 与 MCP 清单一起发布。详见[发布与开发](docs/发布与开发.md)。
