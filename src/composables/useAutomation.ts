import { onMounted, onUnmounted, ref, computed } from 'vue'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { createAutomationController } from '../services/automation'
import type { useWorkbench } from './useWorkbench'
export function useAutomation(workbench: ReturnType<typeof useWorkbench>) {
  const busy = ref(false)
  const execute = createAutomationController(workbench, undefined, (value) => { busy.value = value })
  let unlisten: UnlistenFn | undefined
  let disposed = false
  onMounted(async () => {
    if (!isTauri()) return
    try {
      const unsubscribe = await listen<{ id: string; action: string; args: unknown }>('automation-request', async ({ payload }) => {
        let result: unknown, error: string | undefined
        try { result = await execute(payload.action, payload.args) }
        catch (cause) { error = cause instanceof Error ? cause.message : '控制操作失败' }
        await invoke('automation_reply', { id: payload.id, result: result ?? null, error: error ?? null }).catch(() => {})
      })
      if (disposed) { unsubscribe(); return }
      unlisten = unsubscribe
      await invoke('automation_ready')
    } catch { workbench.notify('AI 控制通道未就绪，请重启软件后重试') }
  })
  onUnmounted(() => { disposed = true; unlisten?.() })
  return { busy: computed(() => busy.value || !!workbench.areaTarget.value) }
}
