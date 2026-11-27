import { readFile, readdir, readlink } from 'node:fs/promises'

import { processDescendants } from './process-descendants'

const MAX_LISTENING_PORTS = 16
const PID_BATCH_SIZE = 8

/** Discover TCP listeners owned by a PTY process or one of its descendants. */
export async function linuxListeningPorts(rootPid: number): Promise<number[]> {
  if (process.platform !== 'linux' || !Number.isSafeInteger(rootPid) || rootPid <= 0) return []
  const processes = await processTree(rootPid)
  if (!processes.length) return []

  const ports = new Set<number>()
  for (let start = 0; start < processes.length; start += PID_BATCH_SIZE) {
    const batch = await Promise.all(
      processes.slice(start, start + PID_BATCH_SIZE).map(async (pid) => {
        const [descriptors, tcp, tcp6] = await Promise.all([
          readdir(`/proc/${pid}/fd`).catch(() => []),
          readFile(`/proc/${pid}/net/tcp`, 'utf8').catch(() => ''),
          readFile(`/proc/${pid}/net/tcp6`, 'utf8').catch(() => '')
        ])
        return { pid, descriptors, tcp, tcp6 }
      })
    )
    for (const { pid, descriptors, tcp, tcp6 } of batch) {
      const listeners = new Map([...parseTcpListeners(tcp), ...parseTcpListeners(tcp6)])
      if (!listeners.size) continue
      for (let offset = 0; offset < descriptors.length; offset += 128) {
        const targets = await Promise.all(
          descriptors
            .slice(offset, offset + 128)
            .map((descriptor) => readlink(`/proc/${pid}/fd/${descriptor}`).catch(() => ''))
        )
        for (const target of targets) {
          const inode = /^socket:\[(\d+)\]$/.exec(target)?.[1]
          const port = inode ? listeners.get(inode) : undefined
          if (port) ports.add(port)
        }
      }
    }
  }
  return [...ports].sort((a, b) => a - b).slice(0, MAX_LISTENING_PORTS)
}

async function processTree(rootPid: number): Promise<number[]> {
  const entries = await readdir('/proc').catch(() => [])
  const relations = new Map<number, number>()
  for (let offset = 0; offset < entries.length; offset += 128) {
    await Promise.all(
      entries.slice(offset, offset + 128).map(async (name) => {
        if (!/^\d+$/.test(name)) return
        const pid = Number(name)
        const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '')
        const afterCommand = stat
          .slice(stat.lastIndexOf(')') + 1)
          .trim()
          .split(/\s+/)
        const parent = Number(afterCommand[1])
        if (Number.isSafeInteger(parent)) relations.set(pid, parent)
      })
    )
  }
  if (!relations.has(rootPid)) return []
  return processDescendants(rootPid, relations)
}

function parseTcpListeners(table: string): Array<[string, number]> {
  const result: Array<[string, number]> = []
  for (const line of table.split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 10 || fields[3] !== '0A') continue
    const port = Number.parseInt(fields[1]!.split(':').at(-1) ?? '', 16)
    if (Number.isInteger(port) && port > 0 && port <= 65535 && /^\d+$/.test(fields[9]!)) {
      result.push([fields[9]!, port])
    }
  }
  return result
}
