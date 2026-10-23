// Web Vitals 的纯计算部分，供工具脚本与单测共用。
// 之所以单独成文件：CLS 的会话窗口算法既要注入浏览器，也要能在 Node 里被验证，
// 只保留一份实现，避免“门禁测的是另一套算法”。

/**
 * CLS 会话窗口合并。
 * 规则（web.dev / web-vitals）：窗口最长 5s；相邻偏移间隔 > 1s 或窗口已超 5s 则另开窗口；
 * CLS 取所有窗口中最大的那个和。输入是已过滤 `hadRecentInput === false` 的偏移条目。
 */
export function clsFromShifts(shifts) {
  let max = 0
  let current = 0
  let windowStart = 0
  let last = 0
  for (const shift of shifts) {
    if (current === 0) {
      windowStart = shift.start
      current = shift.value
    } else if (shift.start - last > 1000 || shift.start - windowStart > 5000) {
      max = Math.max(max, current)
      windowStart = shift.start
      current = shift.value
    } else {
      current += shift.value
    }
    last = shift.start
  }
  return Math.max(max, current)
}

/** Total Blocking Time 口径：每个超过 50ms 的任务，只计超出部分。 */
export function blockingTime(longTasks) {
  return longTasks.reduce((total, task) => total + Math.max(0, task.duration - 50), 0)
}
