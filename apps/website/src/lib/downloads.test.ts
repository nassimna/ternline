import assert from 'node:assert/strict'
import test from 'node:test'
import { latestPublishedRelease, recommendedDownload, releaseDownloads } from './downloads.ts'

function release(version: string, publishedAt = '2026-10-05T12:00:00Z') {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: version.includes('-'),
    html_url: `https://github.com/nassimna/ternline/releases/tag/v${version}`,
    published_at: publishedAt,
    assets: Object.values(releaseDownloads(version)).map((url) => ({
      name: url.slice(url.lastIndexOf('/') + 1),
      browser_download_url: url,
      size: 100,
      state: 'uploaded'
    }))
  }
}

void test('resolves every platform and checksums to the same trusted release', () => {
  const selected = latestPublishedRelease([release('0.2.1-alpha.2')])!
  assert.equal(selected.version, '0.2.1-alpha.2')
  assert.equal(selected.prerelease, true)
  assert.equal(selected.url, 'https://github.com/nassimna/ternline/releases/tag/v0.2.1-alpha.2')
  assert.deepEqual(selected.downloads, {
    'mac-arm64':
      'https://github.com/nassimna/ternline/releases/download/v0.2.1-alpha.2/agent-workspace-0.2.1-alpha.2-macos-arm64.dmg',
    'mac-x64':
      'https://github.com/nassimna/ternline/releases/download/v0.2.1-alpha.2/agent-workspace-0.2.1-alpha.2-macos-x64.dmg',
    'windows-x64':
      'https://github.com/nassimna/ternline/releases/download/v0.2.1-alpha.2/agent-workspace-0.2.1-alpha.2-windows-x64-setup.exe',
    'linux-x64':
      'https://github.com/nassimna/ternline/releases/download/v0.2.1-alpha.2/agent-workspace-0.2.1-alpha.2-x86_64.AppImage',
    'linux-deb':
      'https://github.com/nassimna/ternline/releases/download/v0.2.1-alpha.2/agent-workspace-0.2.1-alpha.2-x86_64.deb',
    'linux-rpm':
      'https://github.com/nassimna/ternline/releases/download/v0.2.1-alpha.2/agent-workspace-0.2.1-alpha.2-x86_64.rpm',
    checksums: 'https://github.com/nassimna/ternline/releases/download/v0.2.1-alpha.2/SHA256SUMS'
  })
})

void test('selects the latest semantic version including prereleases regardless of API or publication order', () => {
  const candidates = [
    release('0.2.1-alpha.2', '2026-10-05T14:00:00Z'),
    release('0.2.0', '2026-10-06T14:00:00Z'),
    release('0.2.1-alpha.10', '2026-10-05T12:00:00Z'),
    release('0.2.1-alpha.9', '2026-10-05T15:00:00Z')
  ]
  assert.equal(latestPublishedRelease(candidates)?.version, '0.2.1-alpha.10')
  assert.equal(latestPublishedRelease([...candidates].reverse())?.version, '0.2.1-alpha.10')
  assert.equal(latestPublishedRelease([...candidates, release('0.2.1')])?.version, '0.2.1')
  assert.equal(
    latestPublishedRelease([release('0.2.1-beta'), release('0.2.1-alpha')])?.version,
    '0.2.1-beta'
  )
})

void test('skips incomplete, draft, unpublished, and malformed releases', () => {
  const complete = release('0.2.1-alpha.1')
  const incomplete = release('0.2.1-alpha.2')
  incomplete.assets.pop()
  for (const invalid of [
    incomplete,
    { ...release('0.2.1-alpha.2'), draft: true },
    { ...release('0.2.1-alpha.2'), published_at: null },
    { ...release('0.2.1-alpha.2'), published_at: 'invalid' },
    { ...release('0.2.1-alpha.2'), prerelease: 'true' },
    release('0.2.1-alpha.01'),
    release('00.2.1'),
    release('../other'),
    { ...release('0.2.1-alpha.2'), tag_name: '0.2.1-alpha.2' },
    null
  ]) {
    assert.equal(latestPublishedRelease([invalid, complete])?.version, complete.tag_name.slice(1))
  }
  assert.equal(latestPublishedRelease({ message: 'API rate limit exceeded' }), undefined)
  assert.equal(latestPublishedRelease([]), undefined)
})

void test('requires each expected asset to be uploaded, unique, nonempty, and from this repository and tag', () => {
  for (const assetIndex of [0, 1, 2, 3, 4, 5, 6]) {
    for (const changes of [
      { browser_download_url: 'https://example.com/installer.dmg' },
      { browser_download_url: release('0.2.1-alpha.1').assets[assetIndex]!.browser_download_url },
      {
        browser_download_url: release('0.2.1-alpha.2').assets[
          assetIndex
        ]!.browser_download_url.replace('/nassimna/', '/attacker/')
      },
      { size: 0 },
      { state: 'new' }
    ]) {
      const candidate = release('0.2.1-alpha.2')
      Object.assign(candidate.assets[assetIndex]!, changes)
      assert.equal(latestPublishedRelease([candidate]), undefined)
    }
  }
  const duplicate = release('0.2.1-alpha.2')
  duplicate.assets.push({ ...duplicate.assets[0]! })
  assert.equal(latestPublishedRelease([duplicate]), undefined)
  assert.equal(
    latestPublishedRelease([
      { ...release('0.2.1-alpha.2'), html_url: 'https://example.com/release' }
    ]),
    undefined
  )
})

void test('keeps the deployed fallback when the API only has older releases', () => {
  assert.equal(latestPublishedRelease([release('0.2.1-alpha.1')], '0.2.1-alpha.2'), undefined)
  assert.equal(
    latestPublishedRelease([release('0.2.1-alpha.2')], '0.2.1-alpha.2')?.version,
    '0.2.1-alpha.2'
  )
  assert.equal(
    latestPublishedRelease([release('0.2.1-alpha.3')], '0.2.1-alpha.2')?.version,
    '0.2.1-alpha.3'
  )
})

void test('recommends the matching desktop OS and available architecture', () => {
  assert.deepEqual(
    recommendedDownload({
      platform: 'Win32',
      userAgent: 'Windows NT 10.0; Win64; x64',
      maxTouchPoints: 0
    }),
    { os: 'windows', asset: 'windows-x64' }
  )
  assert.deepEqual(
    recommendedDownload({ platform: 'Linux x86_64', userAgent: 'Linux x86_64', maxTouchPoints: 0 }),
    { os: 'linux', asset: 'linux-x64' }
  )
  assert.deepEqual(
    recommendedDownload({
      platform: 'macOS',
      userAgent: 'Macintosh',
      maxTouchPoints: 0,
      architecture: 'arm',
      bitness: '64'
    }),
    { os: 'mac', asset: 'mac-arm64' }
  )
  assert.deepEqual(
    recommendedDownload({
      platform: 'macOS',
      userAgent: 'Macintosh',
      maxTouchPoints: 0,
      architecture: 'x86',
      bitness: '64'
    }),
    { os: 'mac', asset: 'mac-x64' }
  )
})

void test('does not guess an Intel Mac or offer x64 as a native ARM download', () => {
  assert.deepEqual(
    recommendedDownload({ platform: 'MacIntel', userAgent: 'Macintosh', maxTouchPoints: 0 }),
    { os: 'mac', asset: undefined }
  )
  assert.deepEqual(
    recommendedDownload({
      platform: 'Linux aarch64',
      userAgent: 'Linux aarch64',
      maxTouchPoints: 0
    }),
    { os: 'linux', asset: undefined }
  )
})

void test('uses explicit CPU hints over a frozen x64 user agent', () => {
  assert.deepEqual(
    recommendedDownload({
      platform: 'Windows',
      userAgent: 'Windows NT 10.0; Win64; x64',
      maxTouchPoints: 0,
      architecture: 'x86',
      bitness: '32'
    }),
    { os: 'windows', asset: undefined }
  )
})

void test('leaves mobile devices and unknown platforms with manual downloads', () => {
  for (const browser of [
    { platform: 'MacIntel', userAgent: 'Macintosh', maxTouchPoints: 5 },
    { platform: 'Linux armv8', userAgent: 'Android 15', maxTouchPoints: 5 },
    { platform: 'iPhone', userAgent: 'iPhone', maxTouchPoints: 5 },
    { platform: 'CrOS', userAgent: 'CrOS x86_64', maxTouchPoints: 0 },
    { platform: 'unknown', userAgent: 'unknown', maxTouchPoints: 0 }
  ])
    assert.equal(recommendedDownload(browser), undefined)
})
