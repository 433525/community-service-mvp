/**
 * A+ 工作台的依赖注入上下文。
 *
 * 页面结构层级较深（布局 → 面板 → 对话框），若逐层透传会产生几十个 props。
 * 这里用 provide/inject 只下发一个工作台对象：状态是 ref/computed，动作是函数，
 * 子组件解构后仍与唯一状态源保持响应性连接。
 */
import { inject, type InjectionKey } from 'vue'
import type { AplusWorkbench } from './workbench'

export const APLUS_WORKBENCH_KEY: InjectionKey<AplusWorkbench> = Symbol('aplus-workbench')

/** 在 A+ 子组件中读取工作台；脱离提供者时抛出可定位的错误。 */
export function useAplusContext(): AplusWorkbench {
  const workbench = inject(APLUS_WORKBENCH_KEY, null)
  if (!workbench) {
    throw new Error('A+ 子组件必须渲染在 useAplusWorkbench() 提供的上下文内')
  }
  return workbench
}
