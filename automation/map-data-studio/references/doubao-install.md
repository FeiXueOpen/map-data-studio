# 豆包专用安装与验收

用户要求在豆包安装 GitHub 上 FeiXueOpen/map-data-studio 时使用此流程。客户端二进制与其他AI客户端相同，区别是安装入口、连接器配置和验收。需能操作本机和豆包界面；不能操作时明确剩余步骤。

1. 阅读仓库README，按系统和架构下载最新Release应用及SHA256，使用scripts/install/install-doubao.sh或install-doubao.ps1。无需系统Node/Python，不让普通用户编译源码。保留已有应用备份及其他插件/连接器。
2. 安装程序复制中文 Skill 到共享技能目录，生成文档目录 `Map Data Studio/Resources/doubao-install-plan.json`。复制目录只是准备文件。当前豆包对话具备技能安装能力时，立即用计划中的 `skill.sourceDirectory` / `skill.sharedDirectory` 安装 Skill，并绑定到当前对话。不能只检查文件存在就报告技能安装完成。仅在会话内安装能力不可用时，才在技能管理中导入 Release 的 `map-data-studio-skill.zip`。不要把 Skill 当 MCP 连接器。
3. 打开应用。v0.1.2及以后在工作台请求监听器就绪后自动启动本地控制服务，不再要求用户手动开启。首次系统确认及高德密钥由用户处理；缺高德Key不阻止连接器握手，只影响地图/查询。安装脚本的CLI预检仅证明本地服务可用。
4. 当前豆包对话具备连接器创建/配置能力时，使用该能力直接注册同名 `map-data-studio`。支持 STDIO 时，参数严格使用计划的 `connector.command` 和 `connector.args`；每个 args 元素单独传递，不拼成一行，不加 shell 引号。Mac 计划使用 `/usr/bin/env`，第一个参数是原生程序路径，其后为 `--mcp-stdio`、`--connection-file`、实际连接文件路径。只支持 HTTP 时，读取计划 `httpFallback.source` 指向的本机连接文件，使用当前 endpoint；Header 名为 `Authorization`，值为 `Bearer 当前token`，URL 不使用 Markdown 链接格式，回复中不显示 token。先备份再更新同名旧连接器，其他连接器保持不变。完成后绑定当前对话。只有会话内注册能力不可用时，才在“插件·技能·伙伴 → 管理 → 连接器”公开界面添加或编辑。不猜测或修改豆包未公开的内部数据库。
5. 保存，确认详情页“包含的操作”有get_status等真实工具且开关开启。若失败，先确认应用运行，再编辑后重新保存连接器；需要时正常重启豆包刷新注册。只显示名称或仅CLI可用不能算这一步成功。
6. 安装过程在当前对话内完成时，先在当前对话验证已绑定的 Skill 和连接器；客户端要求新会话才能刷新时再新建会话。发送只读测试：“仅通过 map-data-studio MCP 调用 get_status，返回 city、mapReady、error、total，不使用终端或 CLI 代替，不查询、不导出。”检查实际工具调用与返回值。返回结构化状态即表示 MCP 通道已连通；`mapReady:false` 或高德密钥错误作为应用状态另行报告。若会话无此工具，不编造成功，也不改用 CLI 后声称 MCP 通过。
7. 分别报告：应用及Skill安装、本地服务预检、连接器操作清单、会话真实MCP调用。最后一项失败时写“连接器已连接，但当前会话未注入工具”。用户另行允许CLI控制时可通过Skill继续业务，但必须注明使用CLI，不能改称MCP。

HTTP只作为客户端仅支持HTTP时的替代，复制设置中的实际URL和Authorization。应用重启后端口及令牌变化，需更新HTTP；stdio读取连接文件可以跟随变化。令牌不输出、不发送给远程服务器。

结束条件：在豆包真实会话中通过MCP得到get_status，且已核对返回状态；仅终端执行--cli status或自己模拟stdio请求不满足验收。未授权查询时只验证状态，不额外采集或导出。
