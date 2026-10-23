// Pure A+ domain assertions for the approved provided-information-to-triage path.
// Run: node tools/check-aplus-provided-info-domain.mjs
import {
  INTAKE_STATUSES,
  getAllowedIntakeActions,
  getIntakeActionTarget,
  isOpenIntakeStatus,
} from '../src/domain/intake.ts'

const checks = [
  {
    id: 'D1-existing-screening-path',
    expected: true,
    actual: getAllowedIntakeActions('初筛中').includes('ACCEPT_FOR_TRIAGE'),
  },
  {
    id: 'D2-provided-information-path',
    expected: true,
    actual: getAllowedIntakeActions('已提供信息').includes('ACCEPT_FOR_TRIAGE'),
  },
  {
    id: 'D3-triage-target',
    expected: '已受理待分诊',
    actual: getIntakeActionTarget('ACCEPT_FOR_TRIAGE', '已提供信息'),
  },
  {
    id: 'D4-provided-information-remains-closed',
    expected: false,
    actual: isOpenIntakeStatus('已提供信息'),
  },
  {
    id: 'D5-no-direct-triage-from-pending-information',
    expected: false,
    actual: getAllowedIntakeActions('待补充').includes('ACCEPT_FOR_TRIAGE'),
  },
  {
    id: 'D6-triage-is-open',
    expected: true,
    actual: isOpenIntakeStatus('已受理待分诊'),
  },
  {
    id: 'D7-status-set-unchanged',
    expected: 11,
    actual: INTAKE_STATUSES.length,
  },
]

let failures = 0
for (const check of checks) {
  const ok = Object.is(check.actual, check.expected)
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${check.id} — expected ${JSON.stringify(check.expected)}, got ${JSON.stringify(check.actual)}`)
}
console.log(`\n${checks.length - failures}/${checks.length} passed`)
if (failures) process.exitCode = 1
