export function createMcpbManifest({version,platform,arch}){
  if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('MCPB版本号无效')
  if(!['macos','windows'].includes(platform)||!['arm64','x64'].includes(arch)||platform==='windows'&&arch!=='x64')throw new Error('MCPB平台或架构无效')
  const win=platform==='windows'
  const executable=win?'map-data-studio.exe':'map-data-studio'
  const connectionFile=win
    ? '${HOME}\\AppData\\Roaming\\com.mapdatastudio.desktop\\automation-connection.json'
    : '${HOME}/Library/Application Support/com.mapdatastudio.desktop/automation-connection.json'
  return {
    manifest_version:'0.3',
    name:'map-data-studio',
    display_name:'Map Data Studio',
    version,
    description:'连接本机 Map Data Studio，查询高德 POI、采集子点位并导出 Excel。',
    long_description:'这是 Map Data Studio 的本地 MCP 桥接器。请先安装并打开同版本桌面应用；桌面应用会自动开启本地 AI 控制。',
    author:{name:'FeiXueOpen',url:'https://github.com/FeiXueOpen/map-data-studio'},
    repository:{type:'git',url:'https://github.com/FeiXueOpen/map-data-studio.git'},
    homepage:'https://github.com/FeiXueOpen/map-data-studio',
    documentation:'https://github.com/FeiXueOpen/map-data-studio#readme',
    support:'https://github.com/FeiXueOpen/map-data-studio/issues',
    tools_generated:true,
    keywords:['map','poi','amap','excel','tourism'],
    server:{
      type:'binary',
      entry_point:`server/${executable}`,
      mcp_config:{
        command:win?'${__dirname}\\server\\'+executable:'${__dirname}/server/'+executable,
        args:['--mcp-stdio','--connection-file',connectionFile],
        env:{},
      },
    },
    compatibility:{platforms:[win?'win32':'darwin']},
  }
}
