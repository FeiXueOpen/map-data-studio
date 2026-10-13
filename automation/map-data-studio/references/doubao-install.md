# 豆包专用安装与验收

用户要求在豆包安装 GitHub 上 FeiXueOpen/map-data-studio 时使用此流程。客户端二进制与其他AI客户端相同，区别是安装入口、连接器配置和验收。需能操作本机和豆包界面；不能操作时明确剩余步骤。

1. 阅读仓库README，按系统和架构下载最新Release应用及SHA256，使用scripts/install/install-doubao.sh或install-doubao.ps1。无需系统Node/Python，不让普通用户编译源码。保留已有应用备份及其他插件/连接器。
2. 安装程序复制中文Skill到共享技能目录，生成文档目录Map Data Studio/Resources/doubao-install-plan.json。复制目录不等于豆包已经导入；在豆包技能管理中确认可发现，必要时通过添加/导入选择Release的map-data-studio-skill.zip。不要把Skill当MCP连接器。
3. 打开应用。v0.1.2及以后在工作台请求监听器就绪后自动启动本地控制服务，不再要求用户手动开启。首次系统确认及高德密钥由用户处理；缺高德Key不阻止连接器握手，只影响地图/查询。安装脚本的CLI预检仅证明本地服务可用。
4. 在豆包“插件·技能·伙伴 → 管理 → 连接器”通过公开界面添加或编辑同名map-data-studio。照计划文件逐项填写传输类型、command与args：每个args元素单独一行，不把命令和参数拼在一个输入框，不给路径额外加shell引号。Mac计划使用/usr/bin/env，把原生程序路径作为第一个参数，其后--mcp-stdio、--connection-file、实际连接文件路径。Windows用原生exe路径。不要猜测/修改豆包内部数据库。
5. 保存，确认详情页“包含的操作”有get_status等真实工具且开关开启。若失败，先确认应用运行，再编辑后重新保存连接器；需要时正常重启豆包刷新注册。只显示名称或仅CLI可用不能算这一步成功。
6. 新建会话并通过当前版本的连接器/插件入口启用该连接器。发送只读测试：“仅通过map-data-studio MCP调用get_status，返回city、mapReady、error、total，不使用终端或CLI代替，不查询、不导出。”检查实际工具调用与返回值。如果工具支持动态发现，先发现该连接器的工具。若会话无此工具，不编造成功，也不悄悄改用CLI再说MCP通过。
7. 分别报告：应用及Skill安装、本地服务预检、连接器操作清单、会话真实MCP调用。最后一项失败时写“连接器已连接，但当前会话未注入工具”。用户另行允许CLI控制时可通过Skill继续业务，但必须注明使用CLI，不能改称MCP。

HTTP只作为客户端仅支持HTTP时的替代，复制设置中的实际URL和Authorization。应用重启后端口及令牌变化，需更新HTTP；stdio读取连接文件可以跟随变化。令牌不输出、不发送给远程服务器。

结束条件：在豆包真实会话中通过MCP得到get_status，且已核对返回状态；仅终端执行--cli status或自己模拟stdio请求不满足验收。未授权查询时只验证状态，不额外采集或导出。
