// Synthetic fixtures for the community-demo MVP.
// Every author, location, thread, complaint, and time-ledger entry is fictional.
// The fixtures intentionally contain no real names, addresses, phone numbers,
// health details, images, or external-channel identifiers.

import type {
  CommunityState,
  Complaint,
  DemoMessage,
  DemoThread,
  FictionalAuthor,
  LedgerEntry,
  Post,
} from './types'
import { COMPLAINT_LOCAL_ONLY_NOTICE } from './types'

export const SYNTHETIC_NOW = '2026-10-20T08:00:00.000Z'

export const SYNTHETIC_DEMO_AUTHOR: FictionalAuthor = {
  id: 'SYNTH-DEMO-USER',
  name: '演练用户·我（虚构）',
  synthetic: true,
}

function author(id: string, name: string): FictionalAuthor {
  return { id, name, synthetic: true }
}

const residentXiaohe = author('SYNTH-AUTHOR-001', '演练居民·小禾（虚构）')
const volunteerAran = author('SYNTH-AUTHOR-002', '演练志愿者·阿岚（虚构）')
const volunteerTeam = author('SYNTH-AUTHOR-003', '演练志愿队·青禾小队（虚构）')
const neighborNanzhi = author('SYNTH-AUTHOR-004', '演练邻居·南枝（虚构）')

export const syntheticPosts: Post[] = [
  {
    id: 'SYNTH-POST-001',
    mode: 'help',
    title: '求助：帮忙把两箱演练物资搬到活动室（虚构）',
    content: '本周四 15:00 需要在演练社区活动室门口把两箱纸质材料搬到二楼，每箱约 8 公斤。这里只展示本地合成数据，不需要真实联系方式，也不代表真实任务。',
    category: '待分类',
    timeWindow: '本周四 15:00–17:00',
    duration: '约 1 小时',
    specialNote: '仅用于通用登记流程演示。',
    author: residentXiaohe,
    location: '演练社区·梧桐里活动室（虚构）',
    createdAt: '2026-10-20T01:10:00.000Z',
    likeCount: 7,
    likedByMe: false,
    favorited: true,
    orderStatus: 'open',
    comments: [
      {
        id: 'SYNTH-COMMENT-001',
        postId: 'SYNTH-POST-001',
        author: volunteerAran,
        content: '我可以先在本机演练里标记接单，真实安排不在这个原型范围内。',
        createdAt: '2026-10-20T01:35:00.000Z',
        synthetic: true,
      },
    ],
    synthetic: true,
  },
  {
    id: 'SYNTH-POST-002',
    mode: 'volunteer',
    title: '志愿日记：整理共享书架的两小时（演练）',
    content: '今天在演练社区共享书架完成了分类和贴标，共整理 38 本旧书。所有内容均为虚构演练，不涉及真实居民、真实活动或真实服务时长。',
    volunteerKind: 'update',
    anonymous: false,
    publishedToFeed: true,
    author: volunteerAran,
    location: '演练社区·共享书架（虚构）',
    createdAt: '2026-10-19T07:20:00.000Z',
    likeCount: 12,
    likedByMe: true,
    favorited: false,
    comments: [
      {
        id: 'SYNTH-COMMENT-002',
        postId: 'SYNTH-POST-002',
        author: neighborNanzhi,
        content: '这条日记很适合演示社区互动，但不会产生真实服务记录。',
        createdAt: '2026-10-19T08:05:00.000Z',
        synthetic: true,
      },
    ],
    synthetic: true,
  },
  {
    id: 'SYNTH-POST-003',
    mode: 'volunteer',
    title: '志愿招募：周六步道清洁 12 个名额（演练）',
    content: '演练活动招募：10 月 24 日 09:00 在青禾河步道集合，内容包括捡拾步道垃圾和整理提示牌。名额 12 人，报名只记录在当前浏览器中，不会发出真实通知。',
    volunteerKind: 'activity',
    anonymous: false,
    publishedToFeed: true,
    author: volunteerTeam,
    location: '演练社区·青禾河步道（虚构）',
    createdAt: '2026-10-18T02:00:00.000Z',
    likeCount: 9,
    likedByMe: false,
    favorited: true,
    eventCapacity: 12,
    eventSignupCount: 8,
    eventStartsAt: '2026-10-24T01:00:00.000Z',
    signedUpByMe: false,
    comments: [
      {
        id: 'SYNTH-COMMENT-003',
        postId: 'SYNTH-POST-003',
        author: residentXiaohe,
        content: '名额和报名人数都是演示数字，真实活动请在获批的运营渠道确认。',
        createdAt: '2026-10-18T03:15:00.000Z',
        synthetic: true,
      },
    ],
    synthetic: true,
  },
  {
    id: 'SYNTH-POST-004',
    mode: 'neighbor',
    title: '邻里分享：几盆演练绿植小苗，可自取（虚构）',
    content: '家里分盆多出 3 盆薄荷小苗，放在演练社区邻里角。这里是普通邻里动态，不是求助订单，也不累计服务时长或进入时间账本。',
    author: neighborNanzhi,
    location: '演练社区·邻里角（虚构）',
    createdAt: '2026-10-17T06:40:00.000Z',
    likeCount: 5,
    likedByMe: false,
    favorited: false,
    comments: [
      {
        id: 'SYNTH-COMMENT-004',
        postId: 'SYNTH-POST-004',
        author: volunteerAran,
        content: '这个邻里角是虚构地点，小苗数量也仅用于界面演示。',
        createdAt: '2026-10-17T07:10:00.000Z',
        synthetic: true,
      },
      {
        id: 'SYNTH-COMMENT-005',
        postId: 'SYNTH-POST-004',
        author: residentXiaohe,
        content: '已在本机收藏，方便之后回来查看这条演练动态。',
        createdAt: '2026-10-17T07:25:00.000Z',
        synthetic: true,
      },
    ],
    synthetic: true,
  },
]

const systemMessage = (
  id: string,
  content: string,
  createdAt: string,
): DemoMessage => ({
  id,
  threadId: 'SYNTH-THREAD-SYSTEM',
  sender: 'system',
  content,
  createdAt,
  automaticReply: false,
  synthetic: true,
})

export const syntheticThreads: DemoThread[] = [
  {
    id: 'SYNTH-THREAD-SYSTEM',
    kind: 'system',
    title: '系统通知（演练）',
    updatedAt: '2026-10-20T02:00:00.000Z',
    messages: [
      systemMessage(
        'SYNTH-MESSAGE-001',
        '欢迎来到社区演练空间。这里的帖子、消息、投诉和时间流水全部是虚构合成数据。',
        '2026-10-18T00:00:00.000Z',
      ),
      systemMessage(
        'SYNTH-MESSAGE-002',
        '本原型不提供登录、实名、定位、通知、电话、上传或任何外部发送能力。',
        '2026-10-19T00:00:00.000Z',
      ),
      systemMessage(
        'SYNTH-MESSAGE-003',
        '本地存档写入失败时，界面会显示保存错误，并保持上一次成功保存的状态。',
        '2026-10-20T02:00:00.000Z',
      ),
    ],
  },
  {
    id: 'SYNTH-THREAD-ORDER',
    kind: 'order',
    title: '订单消息（演练）',
    updatedAt: '2026-10-20T02:20:00.000Z',
    messages: [
      {
        id: 'SYNTH-MESSAGE-004',
        threadId: 'SYNTH-THREAD-ORDER',
        sender: 'system',
        content: '演练订单提醒：求助帖 SYNTH-POST-001 当前为“待接单（本地演示）”。',
        createdAt: '2026-10-20T02:15:00.000Z',
        automaticReply: false,
        synthetic: true,
      },
      {
        id: 'SYNTH-MESSAGE-005',
        threadId: 'SYNTH-THREAD-ORDER',
        sender: 'system',
        content: '这条订单消息只在本机生成，不代表真实派单、真实接单或真实履约。',
        createdAt: '2026-10-20T02:20:00.000Z',
        automaticReply: false,
        synthetic: true,
      },
    ],
  },
  {
    id: 'SYNTH-THREAD-CHAT',
    kind: 'chat',
    title: '与演练邻居南枝的聊天（虚构）',
    updatedAt: '2026-10-19T09:10:00.000Z',
    messages: [
      {
        id: 'SYNTH-MESSAGE-006',
        threadId: 'SYNTH-THREAD-CHAT',
        sender: 'synthetic-contact',
        content: '你好，我是虚构的演练邻居南枝。周六的步道清洁活动，你会先在本地演练里报名吗？',
        createdAt: '2026-10-19T09:00:00.000Z',
        automaticReply: false,
        synthetic: true,
      },
      {
        id: 'SYNTH-MESSAGE-007',
        threadId: 'SYNTH-THREAD-CHAT',
        sender: 'demo-user',
        content: '我会先在当前浏览器里试试报名流程，但知道这不会通知任何人。',
        createdAt: '2026-10-19T09:10:00.000Z',
        automaticReply: false,
        synthetic: true,
      },
    ],
  },
]

export const syntheticComplaints: Complaint[] = [
  {
    id: 'SYNTH-COMPLAINT-001',
    subject: '演练反馈：活动时间说明可以更清楚（虚构）',
    content: '这是一条预置的虚构投诉演练记录，用于展示“仅本机保存”的状态，没有提交给任何真实处理方。',
    status: 'local-only',
    statusNote: COMPLAINT_LOCAL_ONLY_NOTICE,
    createdAt: '2026-10-19T10:00:00.000Z',
    synthetic: true,
  },
]

export const syntheticLedgerEntries: LedgerEntry[] = [
  {
    id: 'SYNTH-LEDGER-001',
    title: '演练服务：协助整理活动室（虚构）',
    minutes: 45,
    status: 'unsettled',
    note: '仅演示待确认的演练时长；不可结算、不可兑换，也不会自动入账。',
    createdAt: '2026-10-18T05:30:00.000Z',
    synthetic: true,
  },
  {
    id: 'SYNTH-LEDGER-002',
    title: '演练服务：共享书架分类（虚构）',
    minutes: 120,
    status: 'unsettled',
    note: '只读演示记录，等待虚构双方确认；原型不提供确认或结算操作。',
    createdAt: '2026-10-19T07:40:00.000Z',
    synthetic: true,
  },
]

export const syntheticCommunityState: CommunityState = {
  posts: syntheticPosts,
  threads: syntheticThreads,
  complaints: syntheticComplaints,
  ledgerEntries: syntheticLedgerEntries,
}

/** Return fresh copies so callers can never mutate the shared seed objects. */
export function createCommunityFixtures(): CommunityState {
  return JSON.parse(JSON.stringify(syntheticCommunityState)) as CommunityState
}
