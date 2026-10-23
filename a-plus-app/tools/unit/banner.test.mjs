// 首页公告轮播的纯逻辑回归：索引、滑动阈值、暂停条件与文案。
// 运行：npm run test:unit
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BANNER_INTERVAL_MS,
  BANNER_SWIPE_THRESHOLD,
  bannerSlideLabel,
  bannerSlides,
  clampIndex,
  resolveInitialAutoPlay,
  rotationAllowed,
  rotationControlLabel,
  stepIndex,
  swipeDirection,
} from '../../src/community/banner-slides.ts'

test('公告数据完整且标识唯一', () => {
  assert.equal(bannerSlides.length, 5)
  assert.equal(new Set(bannerSlides.map((slide) => slide.id)).size, bannerSlides.length)
  for (const slide of bannerSlides) {
    assert.ok(slide.kicker.trim().length > 0, `${slide.id} 缺少分类`)
    assert.ok(slide.title.trim().length > 0, `${slide.id} 缺少标题`)
    assert.ok(slide.summary.trim().length > 0, `${slide.id} 缺少摘要`)
    assert.ok(slide.meta.trim().length > 0, `${slide.id} 缺少来源说明`)
    assert.ok(['green', 'sand', 'clay', 'blue'].includes(slide.tone), `${slide.id} 色调不在白名单`)
    assert.ok(slide.action.label.trim().length > 0, `${slide.id} 缺少动作文案`)
  }
})

test('公告文案保持合成边界：无电话、链接与真实机构', () => {
  const copy = bannerSlides.map((slide) => `${slide.kicker}${slide.title}${slide.summary}${slide.meta}`).join(' ')
  assert.doesNotMatch(copy, /1[3-9]\d{9}/)
  assert.doesNotMatch(copy, /https?:\/\//)
  assert.doesNotMatch(copy, /微信|支付宝|银行卡|身份证/)
  for (const slide of bannerSlides) {
    assert.match(slide.meta, /演练|虚构|科普|提示|公告|规则|招募|非/, `${slide.id} 的说明未标注边界`)
  }
})

test('摘要长度控制在两行以内，避免轮播高度抖动', () => {
  for (const slide of bannerSlides) {
    assert.ok(slide.summary.length <= 60, `${slide.id} 摘要 ${slide.summary.length} 字，超出两行预算`)
  }
})

test('clampIndex 收纳负数、越界、小数与非数字', () => {
  assert.equal(clampIndex(0, 5), 0)
  assert.equal(clampIndex(4, 5), 4)
  assert.equal(clampIndex(5, 5), 0)
  assert.equal(clampIndex(-1, 5), 4)
  assert.equal(clampIndex(-7, 5), 3)
  assert.equal(clampIndex(2.9, 5), 2)
  assert.equal(clampIndex(Number.NaN, 5), 0)
  assert.equal(clampIndex(3, 0), 0)
})

test('stepIndex 首尾相接，且不因空列表抛错', () => {
  assert.equal(stepIndex(4, 1, 5), 0)
  assert.equal(stepIndex(0, -1, 5), 4)
  assert.equal(stepIndex(1, 2, 5), 3)
  assert.equal(stepIndex(0, 1, 0), 0)
  assert.equal(stepIndex(0, Number.NaN, 5), 0)
})

test('swipeDirection 只接受明确的水平位移', () => {
  assert.equal(swipeDirection(-60, 4), 1, '左滑应进入下一张')
  assert.equal(swipeDirection(60, 4), -1, '右滑应回到上一张')
  assert.equal(swipeDirection(-20, 2), 0, '未达阈值视为点击')
  assert.equal(swipeDirection(-60, -70), 0, '竖向意图优先，交给页面滚动')
  assert.equal(swipeDirection(-BANNER_SWIPE_THRESHOLD, 0), 1, '恰好达到阈值即切换')
  assert.equal(swipeDirection(-(BANNER_SWIPE_THRESHOLD - 1), 0), 0)
  assert.equal(swipeDirection(Number.NaN, 0), 0)
})

test('开启“减少动态效果”时默认不自动播放', () => {
  assert.equal(resolveInitialAutoPlay(true), false)
  assert.equal(resolveInitialAutoPlay(false), true)
})

test('自动轮播只受临时条件影响，永久停止由组件状态决定', () => {
  assert.equal(rotationAllowed({ autoRotate: true, hovering: false, pageHidden: false }), true)
  assert.equal(rotationAllowed({ autoRotate: false, hovering: false, pageHidden: false }), false)
  assert.equal(rotationAllowed({ autoRotate: true, hovering: true, pageHidden: false }), false)
  assert.equal(rotationAllowed({ autoRotate: true, hovering: false, pageHidden: true }), false)
  assert.equal(rotationAllowed({ autoRotate: false, hovering: true, pageHidden: true }), false)
})

test('幻灯片位置文案从 1 开始并在越界时夹紧', () => {
  assert.equal(bannerSlideLabel(0, 5), '第 1 张，共 5 张')
  assert.equal(bannerSlideLabel(4, 5), '第 5 张，共 5 张')
  assert.equal(bannerSlideLabel(9, 5), '第 5 张，共 5 张')
  assert.equal(bannerSlideLabel(-1, 5), '第 5 张，共 5 张')
  assert.equal(bannerSlideLabel(0, 0), '无公告')
})

test('轮播控制按钮文案随状态切换', () => {
  assert.equal(rotationControlLabel(true), '暂停自动播放')
  assert.equal(rotationControlLabel(false), '播放自动播放')
})

test('轮播间隔落在可读且可测的区间', () => {
  assert.ok(BANNER_INTERVAL_MS >= 5000, '间隔过短会打断阅读')
  assert.ok(BANNER_INTERVAL_MS <= 10000, '间隔过长会让用户以为没有轮播')
  assert.ok(BANNER_SWIPE_THRESHOLD >= 24, '阈值过小会误触')
})
