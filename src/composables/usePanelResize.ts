import { computed, onMounted, onUnmounted, ref } from 'vue'

const MAP_MIN = 340
const POI_MIN = 475
const HANDLE_WIDTH = 8

export function usePanelResize() {
  const workspace = ref<HTMLElement>()
  const sidebar = ref<HTMLElement>()
  const dataPanel = ref<HTMLElement>()
  const poiWidth = ref<number | null>(null)
  const availableWidth = ref(0)
  const resizing = ref(false)
  let ratio: number | null = null
  let observer: ResizeObserver | undefined
  let drag: { id: number; x: number; width: number; target: HTMLElement } | null = null

  function measure() {
    if (!workspace.value || !sidebar.value) return
    availableWidth.value = workspace.value.clientWidth - sidebar.value.offsetWidth - HANDLE_WIDTH
    if (ratio !== null) poiWidth.value = clamp(availableWidth.value * ratio)
  }

  function clamp(width: number) {
    return Math.max(POI_MIN, Math.min(availableWidth.value - MAP_MIN, width))
  }

  function setWidth(width: number) {
    poiWidth.value = clamp(width)
    ratio = poiWidth.value / availableWidth.value
  }

  function startResize(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || !dataPanel.value) return
    measure()
    const target = event.currentTarget as HTMLElement
    drag = { id: event.pointerId, x: event.clientX, width: dataPanel.value.offsetWidth, target }
    target.setPointerCapture(event.pointerId)
    resizing.value = true
    event.preventDefault()
  }

  function moveResize(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return
    setWidth(drag.width - (event.clientX - drag.x))
  }

  function stopResize(event?: PointerEvent) {
    if (!drag || (event && event.pointerId !== drag.id)) return
    const previous = drag
    drag = null
    resizing.value = false
    if (previous.target.hasPointerCapture(previous.id)) previous.target.releasePointerCapture(previous.id)
  }

  function resizeWithKeyboard(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    measure()
    const width = poiWidth.value ?? dataPanel.value?.offsetWidth ?? POI_MIN
    const step = event.shiftKey ? 50 : 20
    if (event.key === 'ArrowLeft') setWidth(width + step)
    if (event.key === 'ArrowRight') setWidth(width - step)
    if (event.key === 'Home') setWidth(availableWidth.value - MAP_MIN)
    if (event.key === 'End') setWidth(POI_MIN)
  }

  onMounted(() => {
    observer = new ResizeObserver(measure)
    if (workspace.value) observer.observe(workspace.value)
    if (sidebar.value) observer.observe(sidebar.value)
    measure()
    window.addEventListener('blur', stopOnBlur)
  })
  const stopOnBlur = () => stopResize()
  onUnmounted(() => {
    stopResize()
    observer?.disconnect()
    window.removeEventListener('blur', stopOnBlur)
  })

  return {
    workspace, sidebar, dataPanel, resizing,
    panelStyle: computed(() => poiWidth.value === null ? {} : { '--poi-width': `${poiWidth.value}px` }),
    currentWidth: computed(() => Math.round(poiWidth.value ?? dataPanel.value?.offsetWidth ?? POI_MIN)),
    maxWidth: computed(() => Math.max(POI_MIN, availableWidth.value - MAP_MIN)),
    startResize, moveResize, stopResize, resizeWithKeyboard,
  }
}
