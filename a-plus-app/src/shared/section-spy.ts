import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * 分区吸顶导航的当前分区判定。
 * - 以「分区标题顶边越过吸顶导航」为准，取最后一个越过的分区；
 * - 滚动到底部时强制最后一项，避免末节太短永远无法到达；
 * - 用 requestAnimationFrame 合并滚动事件，不引入第三方依赖。
 */
export function useSectionSpy(ids: string[], headerOffset = 150) {
  const active = ref(ids[0] ?? '')
  let frame = 0

  function update() {
    frame = 0
    let current = ids[0] ?? ''
    for (const id of ids) {
      const element = document.getElementById(id)
      if (!element) continue
      if (element.getBoundingClientRect().top <= headerOffset) current = id
    }
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
    if (atBottom) current = ids[ids.length - 1] ?? current
    active.value = current
  }

  function onScroll() {
    if (frame) return
    frame = requestAnimationFrame(update)
  }

  onMounted(() => {
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    update()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', onScroll)
    if (frame) cancelAnimationFrame(frame)
  })

  return active
}
