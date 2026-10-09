import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const websiteRequire = createRequire(new URL('../../apps/website/package.json', import.meta.url))
const astroRequire = createRequire(websiteRequire.resolve('astro'))
const CachePolicy = astroRequire('http-cache-semantics')
const request = { url: 'https://example.com/account', headers: { host: 'example.com' } }

test('required validation blocks stale reuse, including serialized cache policies', () => {
  for (const directive of ['no-cache', 'proxy-revalidate', 's-maxage=1']) {
    const original = new CachePolicy(request, {
      status: 200,
      headers: {
        age: '10',
        'cache-control': `max-age=1, ${directive}, stale-while-revalidate=100, stale-if-error=100`
      }
    })
    const policy = CachePolicy.fromObject(original.toObject())
    policy.now = () => policy._responseTime
    const result = policy.evaluateRequest({
      ...request,
      headers: { ...request.headers, 'cache-control': 'max-stale=1000' }
    })
    assert.equal(result.response, undefined)
    assert.equal(result.revalidation.synchronous, true)
    assert.equal(policy.useStaleWhileRevalidate(), false)
    assert.equal(policy.revalidatedPolicy(request, { status: 503, headers: {} }).modified, true)
  }
})

test('error fallback requires matching request identity', () => {
  const policy = new CachePolicy(request, {
    status: 200,
    headers: { age: '10', 'cache-control': 'max-age=1, stale-if-error=100' }
  })
  policy.now = () => policy._responseTime
  assert.equal(policy.revalidatedPolicy(request, { status: 503, headers: {} }).modified, false)
  assert.equal(
    policy.revalidatedPolicy(
      { ...request, url: 'https://example.com/another-account' },
      { status: 503, headers: {} }
    ).modified,
    true
  )
})

test('fresh revalidation directives and permitted private stale reuse remain usable', () => {
  const fresh = new CachePolicy(request, {
    status: 200,
    headers: { age: '10', 'cache-control': 'max-age=60, must-revalidate, proxy-revalidate' }
  })
  fresh.now = () => fresh._responseTime
  assert.equal(fresh.satisfiesWithoutRevalidation(request), true)
  const privatePolicy = new CachePolicy(
    request,
    { status: 200, headers: { age: '10', 'cache-control': 'private, max-age=1, proxy-revalidate' } },
    { shared: false }
  )
  privatePolicy.now = () => privatePolicy._responseTime
  assert.equal(
    privatePolicy.satisfiesWithoutRevalidation({
      ...request,
      headers: { ...request.headers, 'cache-control': 'max-stale=100' }
    }),
    true
  )
})
