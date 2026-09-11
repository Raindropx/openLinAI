import assert from 'node:assert/strict'
import {
  estimateImageCost,
  formatImageCost,
  formatImageUsd,
  formatImageUsdLabel,
} from '../src/client/utils/imageCost'
import {
  fetchImageBill,
  getBillingRequestId,
  matchImageBill,
  summarizeProviderImageUsage,
} from '../src/server/module/gpt-image/billing'

async function main() {
  const log = {
    type: 2,
    quota: 6152,
    group: 'Openai-Gpt-1',
    other: JSON.stringify({ request_id: 'req-1', group_ratio: 0.58824 }),
  }
  const payload = { success: true, data: [log] }
  const bill = matchImageBill(payload, ['req-1'])!
  assert.equal(bill.cost, 0.012304)
  assert.equal(bill.entries?.[0].groupRatio, 0.58824)
  assert.equal(formatImageUsd(bill.cost!), '$0.012304')
  assert.equal(formatImageUsd(0), '$0.00')
  assert.equal(formatImageUsd(0.000002), '$0.000002')
  assert.equal(formatImageUsdLabel(bill.cost!), '$0.012')
  assert.equal(formatImageCost(0.012304, 'USD', true), '$0.012')
  assert.equal(formatImageCost(0.0231, 'CNY'), '￥0.0231')
  assert.equal(formatImageCost(0.004, 'POLLEN'), '0.004 Pollen')
  assert.equal(formatImageUsdLabel(0.01727), '$0.017')
  assert.equal(formatImageUsdLabel(0.02288), '$0.023')
  assert.equal(formatImageUsdLabel(1.2), '$1.200')
  assert.equal(formatImageUsdLabel(0), '$0.000')
  assert.equal(formatImageUsdLabel(0.000002), '$0.000')
  assert.equal(matchImageBill(payload, ['other-request']), null)
  assert.equal(matchImageBill(payload, ['req-1', 'missing']), null)
  assert.equal(matchImageBill(payload, ['req-1', 'req-1']), null)
  assert.equal(
    matchImageBill({ success: true, data: [log, log] }, ['req-1']),
    null,
  )
  assert.equal(
    matchImageBill({ success: true, data: [{ ...log, quota: -1 }] }, ['req-1']),
    null,
  )
  assert.equal(
    matchImageBill({ success: true, data: [{ ...log, type: 1 }] }, ['req-1']),
    null,
  )
  assert.equal(
    matchImageBill({ success: true, data: [{ ...log, other: '{' }] }, [
      'req-1',
    ]),
    null,
  )
  assert.equal(
    matchImageBill({ success: true, data: [{ ...log, request_id: 'req-2' }] }, [
      'req-1',
      'req-2',
    ]),
    null,
  )
  assert.equal(
    matchImageBill({ success: true, data: { items: [{ ...log, quota: 0 }] } }, [
      'req-1',
    ])?.cost,
    0,
  )
  assert.equal(
    matchImageBill(
      {
        success: true,
        data: [log, { type: 2, request_id: 'req-2', quota: 500 }],
      },
      ['req-1', 'req-2'],
    )?.quota,
    6652,
  )
  assert.equal(
    getBillingRequestId(
      new Headers({
        'x-api-request-id': 'gateway',
        'x-request-id': 'upstream',
      }),
    ),
    'gateway',
  )
  assert.equal(estimateImageCost('gpt-image-2-c', 1701, 460), null)

  const openRouterUsage = summarizeProviderImageUsage([
    {
      prompt_tokens: 12,
      completion_tokens: 40,
      total_tokens: 52,
      cost: 0.004,
    },
    {
      input_tokens: 8,
      output_tokens: 20,
      cost: '0.006',
    },
  ])
  assert.deepEqual(openRouterUsage.usage, {
    input_tokens: 20,
    output_tokens: 60,
    total_tokens: 80,
    cost: 0.01,
  })
  assert.deepEqual(openRouterUsage.billing, {
    status: 'actual',
    currency: 'USD',
    requestIds: [],
    source: 'provider-response',
    cost: 0.01,
  })
  assert.equal(
    summarizeProviderImageUsage([{ total_tokens: 1 }]).billing,
    undefined,
  )
  assert.deepEqual(summarizeProviderImageUsage([{ cost: 0 }]).billing, {
    status: 'actual',
    currency: 'USD',
    requestIds: [],
    source: 'provider-response',
    cost: 0,
  })
  assert.deepEqual(summarizeProviderImageUsage([{ cost: 1 }, undefined]), {
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  })
  const estimate = estimateImageCost('gpt-image-2', 1701, 460)!
  assert.ok(Math.abs(estimate.input + estimate.output - 0.022305) < 1e-12)
  const multipliedEstimate = estimateImageCost(
    'gpt-image-2',
    1701,
    460,
    0.58824,
  )!
  assert.ok(
    Math.abs(
      multipliedEstimate.input +
        multipliedEstimate.output -
        0.022305 * 0.58824,
    ) < 1e-12,
  )

  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input))
      assert.equal(url.href, 'https://api.openlux.ai/api/log/token?key=test')
      assert.equal(
        new Headers(init?.headers).get('Authorization'),
        'Bearer sk-test',
      )
      assert.equal(init?.redirect, 'error')
      return Response.json(payload)
    }
    assert.equal(
      (
        await fetchImageBill({
          baseURL: 'https://api.openlux.ai/v1',
          apiKey: 'sk-test',
          requestIds: ['req-1'],
        })
      ).cost,
      0.012304,
    )
    globalThis.fetch = async (input) => {
      assert.equal(String(input), 'https://example.test/sub/api/log/token')
      return Response.json(payload)
    }
    assert.equal(
      (
        await fetchImageBill({
          baseURL: 'https://example.test/sub/v1/',
          apiKey: 'sk-test',
          requestIds: ['req-1'],
        })
      ).status,
      'actual',
    )
    const unavailableBill = await fetchImageBill({
      baseURL: 'https://example.test/v1',
      apiKey: 'sk-test',
      requestIds: [],
      estimatedGroupRatio: 0.58824,
    })
    assert.equal(unavailableBill.status, 'unavailable')
    assert.equal(unavailableBill.estimatedGroupRatio, 0.58824)
  } finally {
    globalThis.fetch = originalFetch
  }
  console.log(
    'Image billing: exact matching, duplicate/invalid bills, multi-request totals, USD precision and provider requests passed.',
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
