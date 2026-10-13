// Service preflight only; never report this as an AI-client MCP verification.
import {execFileSync} from 'node:child_process'
const command=process.argv[2];if(!command)throw new Error('需要原生程序路径')
const deadline=Date.now()+30000
let ready=false
while(Date.now()<deadline){
 try{const result=JSON.parse(execFileSync(command,['--cli','status'],{encoding:'utf8',timeout:1500,stdio:['ignore','pipe','pipe']}));if(result&&typeof result==='object'){ready=true;break}}catch{}
 await new Promise(resolve=>setTimeout(resolve,500))
}
if(ready)console.log('本地控制服务已自动就绪。此项仅为服务预检；AI客户端还需加载连接器并在会话中真实调用get_status。')
else{console.error('本地控制服务尚未就绪，请检查应用是否已打开或系统首次启动提示；连接器注册尚未验证。');process.exitCode=1}
