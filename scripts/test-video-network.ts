import assert from 'node:assert/strict'
import dns from 'node:dns/promises'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { mock } from 'node:test'
import { VIDEO_ENDPOINT_PRESETS } from '../src/shared/video-endpoints'

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'linai-video-network-'))
  process.env.DATA_DIR = root
  process.env.VIDEO_ALLOWED_HOSTS =
    'api.example.com,media.example.com,redirect.example.com'
  try {
    const {
      validateVideoUrl,
      isPublicVideoAddress,
      isVideoFakeAddress,
      openRemoteVideo,
    } = await import('../src/server/module/video/remote')
    const { parseVideoDnsAnswer, resolveVideoPublicDns } =
      await import('../src/server/module/video/public-dns')
    const { videoApiResponse, videoApiMedia } =
      await import('../src/server/module/video/api-transport')
    assert.equal(isVideoFakeAddress('198.18.5.125'), true)
    assert.equal(isVideoFakeAddress('198.19.255.255'), true)
    assert.equal(isVideoFakeAddress('198.20.0.1'), false)
    assert.equal(isPublicVideoAddress('198.18.5.125'), false)
    let fallbackCalls = 0
    const fallback = async () => {
      fallbackCalls++
      return [{ address: '93.184.216.34', family: 4 }]
    }
    // Ordinary public DNS must not touch the fallback at all, even when it is unavailable.
    const normal = await validateVideoUrl(
      'https://api.example.com/v1/models',
      async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:4700:4700::1111', family: 6 },
      ],
      [],
      async () => {
        throw new Error('Fallback must not run')
      },
    )
    assert.equal(normal.address.address, '93.184.216.34')
    assert.equal(fallbackCalls, 0)
    const fake = await validateVideoUrl(
      'https://api.example.com/v1/models',
      async () => [{ address: '198.18.5.125', family: 4 }],
      [],
      fallback,
    )
    assert.equal(fake.address.address, '93.184.216.34')
    assert.equal(fallbackCalls, 1)
    for (const address of [
      '127.0.0.1',
      '10.0.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '::1',
      'fc00::1',
    ]) {
      await assert.rejects(
        validateVideoUrl(
          'https://api.example.com/private',
          async () => [
            { address: '198.18.1.1', family: 4 },
            { address, family: address.includes(':') ? 6 : 4 },
          ],
          [],
          fallback,
        ),
        /禁止访问/,
      )
      assert.equal(
        fallbackCalls,
        1,
        'Mixed private answers must not trigger fallback',
      )
    }
    for (const addresses of [
      [],
      [{ address: '198.18.1.1', family: 4 }],
      [{ address: '127.0.0.1', family: 4 }],
      [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ],
    ])
      await assert.rejects(
        validateVideoUrl(
          'https://api.example.com/private',
          async () => [{ address: '198.18.1.1', family: 4 }],
          [],
          async () => addresses,
        ),
        /禁止访问/,
      )
    for (const raw of [
      'http://api.example.com/x',
      'https://127.0.0.1/x',
      'https://unlisted.example.com/x',
      'https://api.example.com:8443/x',
    ])
      await assert.rejects(
        validateVideoUrl(
          raw,
          async () => [{ address: '198.18.1.1', family: 4 }],
          [],
          fallback,
        ),
      )
    assert.equal(fallbackCalls, 1)
    await assert.rejects(
      validateVideoUrl(
        'https://api.example.com/x',
        async () => [{ address: '198.18.1.1', family: 4 }],
        [],
        async () => {
          throw new Error('Fake-IP fallback failed')
        },
      ),
      /fallback failed/,
    )

    const answer = {
      Status: 0,
      Question: [{ name: 'API.EXAMPLE.COM.', type: 1 }],
      Answer: [
        {
          name: 'api.example.com.',
          type: 5,
          data: 'edge.example.com.',
          TTL: 25,
        },
        { name: 'edge.example.com.', type: 1, data: '93.184.216.34', TTL: 120 },
        {
          name: 'unrelated.example.com.',
          type: 1,
          data: '127.0.0.1',
          TTL: 300,
        },
      ],
    }
    assert.deepEqual(parseVideoDnsAnswer('api.example.com', 1, answer), {
      addresses: [{ address: '93.184.216.34', family: 4 }],
      ttl: 25,
    })
    assert.throws(() => parseVideoDnsAnswer('different.example.com', 1, answer))
    assert.throws(() =>
      parseVideoDnsAnswer('api.example.com', 1, { ...answer, Status: 3 }),
    )
    assert.throws(() =>
      parseVideoDnsAnswer('api.example.com', 1, { ...answer, TC: true }),
    )
    assert.throws(() =>
      parseVideoDnsAnswer('api.example.com', 1, {
        ...answer,
        Answer: [
          { name: 'api.example.com', type: 1, data: 'invalid', TTL: 30 },
        ],
      }),
    )

    // Emulate Node's all:true lookup contract. A singular response to this request
    // fails in Node 22+ with ERR_INVALID_IP_ADDRESS.
    const calls: Array<{ url: URL; options: any; address?: string }> = []
    let redirect = false
    let dohFailure = false
    let ordinaryDns = false
    mock.method(dns, 'lookup', async (hostname: string) => [
      {
        address:
          hostname === 'redirect.example.com'
            ? '127.0.0.1'
            : ordinaryDns
              ? '93.184.216.34'
              : '198.18.5.125',
        family: 4,
      },
    ])
    mock.method(
      https,
      'request',
      (
        raw: URL,
        options: any,
        callback: (response: IncomingMessage) => void,
      ) => {
        const url = new URL(raw)
        const call = { url, options, address: undefined as string | undefined }
        calls.push(call)
        const req = new EventEmitter() as any
        req.setTimeout = () => req
        req.end = () =>
          queueMicrotask(() => {
            options.lookup(
              url.hostname,
              { all: options.autoSelectFamily !== false },
              (error: Error | null, address: string | unknown[]) => {
                if (
                  error ||
                  (options.autoSelectFamily !== false &&
                    !Array.isArray(address))
                ) {
                  req.emit(
                    'error',
                    error || new Error('ERR_INVALID_IP_ADDRESS'),
                  )
                  return
                }
                call.address = Array.isArray(address)
                  ? (address[0] as { address: string }).address
                  : String(address)
                const isDoh = ['cloudflare-dns.com', 'dns.google'].includes(
                  url.hostname,
                )
                const type = Number(url.searchParams.get('type'))
                const body = isDoh
                  ? {
                      Status: 0,
                      Question: [{ name: url.searchParams.get('name'), type }],
                      Answer:
                        type === 1
                          ? [
                              {
                                name: url.searchParams.get('name'),
                                type: 1,
                                data: '93.184.216.34',
                                TTL: 45,
                              },
                            ]
                          : [],
                    }
                  : { data: [{ id: 'grok-imagine-video' }] }
                const response = Readable.from([
                  Buffer.from(JSON.stringify(body)),
                ]) as IncomingMessage
                response.statusCode =
                  isDoh && dohFailure ? 503 : !isDoh && redirect ? 302 : 200
                response.headers =
                  !isDoh && redirect
                    ? { location: 'https://redirect.example.com/private' }
                    : {
                        'content-type':
                          url.pathname === '/movie.mp4'
                            ? 'video/mp4'
                            : 'application/json',
                      }
                callback(response)
              },
            )
          })
        return req
      },
    )
    syncBuiltinESMExports()
    const endpoint = {
      ...VIDEO_ENDPOINT_PRESETS.find((preset) => preset.protocol === 'xai')!,
      id: 'network-test',
      baseURL: 'https://api.example.com/v1',
      apiKey: 'fake-test-key',
    }
    const response = await videoApiResponse(
      endpoint,
      '/models',
      AbortSignal.timeout(1000),
    )
    assert.equal(response.statusCode, 200)
    response.resume()
    const dohCalls = calls.filter(
      (call) => call.url.hostname !== 'api.example.com',
    )
    assert.equal(dohCalls.length, 4)
    for (const call of dohCalls) {
      assert.ok(['1.1.1.1', '8.8.8.8'].includes(call.address!))
      assert.equal(call.options.headers.Authorization, undefined)
      assert.equal(
        call.options.rejectUnauthorized,
        undefined,
        'TLS verification stays enabled',
      )
      assert.equal(call.url.searchParams.get('name'), 'api.example.com')
      assert.equal(call.url.searchParams.get('edns_client_subnet'), '0.0.0.0/0')
    }
    const apiCall = calls.find(
      (call) => call.url.hostname === 'api.example.com',
    )!
    assert.equal(apiCall.address, '93.184.216.34')
    assert.equal(apiCall.options.headers.Authorization, 'Bearer fake-test-key')
    const cached = await resolveVideoPublicDns('api.example.com')
    cached[0].address = '127.0.0.1'
    assert.equal(
      (await resolveVideoPublicDns('api.example.com'))[0].address,
      '93.184.216.34',
    )
    assert.equal(calls.length, 5, 'Cache avoids extra DoH requests')
    redirect = true
    await assert.rejects(
      videoApiMedia(
        endpoint,
        '/videos/test/content',
        AbortSignal.timeout(1000),
      ),
      /禁止访问/,
    )
    assert.equal(
      calls.filter((call) => call.url.hostname === 'redirect.example.com')
        .length,
      0,
    )
    dohFailure = true
    await assert.rejects(
      resolveVideoPublicDns('failure.example.com'),
      /Fake-IP.*无法取得真实公网地址/,
    )
    ordinaryDns = true
    redirect = false
    const beforeNormalCalls = calls.length
    const normalResponse = await videoApiResponse(
      endpoint,
      '/models',
      AbortSignal.timeout(1000),
    )
    normalResponse.resume()
    const movie = await openRemoteVideo(
      'https://media.example.com/movie.mp4',
      AbortSignal.timeout(1000),
    )
    movie.resume()
    assert.equal(
      calls.length - beforeNormalCalls,
      2,
      'Normal API and video requests work even while DoH is down',
    )
    assert.equal(calls[calls.length - 1].address, '93.184.216.34')
    assert.equal(
      calls[calls.length - 1].options.headers.Authorization,
      undefined,
    )
    console.log(
      'Video network checks passed: normal DNS unchanged, Fake-IP public fallback, private/mixed/redirect targets rejected, TLS and credentials retained, pinned lookup contract, DoH parsing/cache/outages',
    )
  } finally {
    mock.restoreAll()
    syncBuiltinESMExports()
    assert.ok(
      path
        .resolve(root)
        .startsWith(
          path.join(path.resolve(os.tmpdir()), 'linai-video-network-'),
        ),
    )
    await fs.rm(root, { recursive: true, force: true })
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
