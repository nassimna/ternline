type BrowserPlatform = {
  platform: string
  userAgent: string
  maxTouchPoints: number
  architecture?: string | undefined
  bitness?: string | undefined
}

const repository = 'https://github.com/nassimna/ternline'
export const releasesApi = 'https://api.github.com/repos/nassimna/ternline/releases?per_page=100'

export function releaseDownloads(version: string) {
  const files = `${repository}/releases/download/v${version}`
  return {
    'mac-arm64': `${files}/agent-workspace-${version}-macos-arm64.dmg`,
    'mac-x64': `${files}/agent-workspace-${version}-macos-x64.dmg`,
    'windows-x64': `${files}/agent-workspace-${version}-windows-x64-setup.exe`,
    'linux-x64': `${files}/agent-workspace-${version}-x86_64.AppImage`,
    'linux-deb': `${files}/agent-workspace-${version}-x86_64.deb`,
    'linux-rpm': `${files}/agent-workspace-${version}-x86_64.rpm`,
    checksums: `${files}/SHA256SUMS`
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validVersion(version: string) {
  return (
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
      version
    ) &&
    !version
      .split('-')
      .slice(1)
      .join('-')
      .split('.')
      .some((part) => /^0\d+$/.test(part))
  )
}

function compareVersions(left: string, right: string) {
  const [leftCore = '', ...leftSuffix] = left.split('-')
  const [rightCore = '', ...rightSuffix] = right.split('-')
  const leftParts = leftCore.split('.')
  const rightParts = rightCore.split('.')
  for (let index = 0; index < 3; index++) {
    const a = BigInt(leftParts[index]!)
    const b = BigInt(rightParts[index]!)
    if (a !== b) return a > b ? 1 : -1
  }
  if (leftSuffix.length === 0 || rightSuffix.length === 0)
    return leftSuffix.length === rightSuffix.length ? 0 : leftSuffix.length === 0 ? 1 : -1
  const leftPre = leftSuffix.join('-').split('.')
  const rightPre = rightSuffix.join('-').split('.')
  for (let index = 0; index < Math.max(leftPre.length, rightPre.length); index++) {
    const a = leftPre[index]
    const b = rightPre[index]
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1
    if (a === b) continue
    const numericA = /^\d+$/.test(a)
    const numericB = /^\d+$/.test(b)
    if (numericA && numericB) return BigInt(a) > BigInt(b) ? 1 : -1
    if (numericA !== numericB) return numericA ? -1 : 1
    return a > b ? 1 : -1
  }
  return 0
}

function publishedRelease(value: unknown) {
  if (!record(value) || value['draft'] !== false || typeof value['prerelease'] !== 'boolean')
    return undefined
  const tag = value['tag_name']
  if (typeof tag !== 'string' || !tag.startsWith('v') || !validVersion(tag.slice(1)))
    return undefined
  const publishedAt = value['published_at']
  if (typeof publishedAt !== 'string' || !Number.isFinite(Date.parse(publishedAt))) return undefined
  const url = `${repository}/releases/tag/${tag}`
  if (value['html_url'] !== url || !Array.isArray(value['assets'])) return undefined
  const version = tag.slice(1)
  const downloads = releaseDownloads(version)
  for (const download of Object.values(downloads)) {
    const name = download.slice(download.lastIndexOf('/') + 1)
    const matching = value['assets'].filter(
      (asset: unknown) => record(asset) && asset['name'] === name
    )
    if (matching.length !== 1) return undefined
    const asset: unknown = matching[0]
    if (
      !record(asset) ||
      asset['browser_download_url'] !== download ||
      asset['state'] !== 'uploaded' ||
      typeof asset['size'] !== 'number' ||
      !Number.isFinite(asset['size']) ||
      asset['size'] <= 0
    )
      return undefined
  }
  return {
    version,
    url,
    prerelease: value['prerelease'],
    downloads,
    publishedAt: Date.parse(publishedAt)
  }
}

export function latestPublishedRelease(releases: unknown, minimumVersion?: string) {
  if (!Array.isArray(releases) || (minimumVersion !== undefined && !validVersion(minimumVersion)))
    return undefined
  return releases.reduce<ReturnType<typeof publishedRelease>>((latest, release: unknown) => {
    const candidate = publishedRelease(release)
    if (!candidate || (minimumVersion && compareVersions(candidate.version, minimumVersion) < 0))
      return latest
    if (!latest) return candidate
    const order = compareVersions(candidate.version, latest.version)
    return order > 0 || (order === 0 && candidate.publishedAt > latest.publishedAt)
      ? candidate
      : latest
  }, undefined)
}

export function recommendedDownload(browser: BrowserPlatform) {
  const { platform, userAgent, maxTouchPoints, architecture, bitness } = browser
  if (/Android|iPhone|iPad|iPod|CrOS/i.test(`${platform} ${userAgent}`)) return undefined
  if (/Mac/i.test(platform) && maxTouchPoints > 1) return undefined

  const arm = /arm|aarch64/i.test(architecture ?? `${platform} ${userAgent}`)
  if (/Mac/i.test(platform)) {
    if (architecture === 'arm') return { os: 'mac', asset: 'mac-arm64' } as const
    if (architecture === 'x86' && bitness === '64') return { os: 'mac', asset: 'mac-x64' } as const
    return { os: 'mac', asset: undefined } as const
  }
  const x64 =
    architecture && bitness
      ? architecture === 'x86' && bitness === '64'
      : /x86_64|amd64|Win64|x64/i.test(`${platform} ${userAgent}`)
  if (/Win/i.test(platform)) {
    return { os: 'windows', asset: !arm && x64 ? 'windows-x64' : undefined } as const
  }
  if (/Linux/i.test(platform)) {
    return { os: 'linux', asset: !arm && x64 ? 'linux-x64' : undefined } as const
  }
  return undefined
}
