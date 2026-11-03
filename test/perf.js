/**
 * Performance probe, evaluated inside the page by `test/shoot.mjs --eval-file`.
 * Returns a JSON string so the CDP result stays simple.
 */
(async () => {
  const nav = performance.getEntriesByType('navigation')[0]
  const memory = performance.memory
  const usedJSHeapMB = memory ? Math.round(memory.usedJSHeapSize / 1048576) : null

  // Count animation frames for 3 seconds: a static minimal UI should be near 0.
  const framesIn3s = await new Promise((resolve) => {
    let count = 0
    const startedAt = performance.now()
    const step = () => {
      count += 1
      if (performance.now() - startedAt < 3000) requestAnimationFrame(step)
      else resolve(count)
    }
    requestAnimationFrame(step)
  })

  const animated = [...document.querySelectorAll('canvas')].length
  const decorated = [...document.querySelectorAll('[data-fa-rain], .fa-wall, .fa-particles, [data-rescue-decoration]')].length

  return JSON.stringify({
    domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    loadEventEndMs: nav ? Math.round(nav.loadEventEnd) : null,
    usedJSHeapMB,
    framesIn3s,
    canvasCount: animated,
    decorationNodes: decorated,
  })
})()
