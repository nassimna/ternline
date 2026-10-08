import { sshWorkspaceSchema, type SshWorkspace } from '@agent-workspace/protocol-client'
export { sshCommand } from '@agent-workspace/protocol-client'

export type SavedSshWorkspace = SshWorkspace

const STORAGE_KEY = 'agent-workspace.ssh-workspaces.v1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export function parseSshWorkspace(
  host: string,
  user: string,
  port: number,
  identityFile = ''
): SavedSshWorkspace {
  const keyPath = identityFile.trim()
  const parsed = sshWorkspaceSchema.safeParse({
    host: host.trim(),
    user: user.trim(),
    port,
    ...(keyPath ? { identityFile: keyPath } : {})
  })
  if (parsed.success) return parsed.data
  switch (parsed.error.issues[0]?.path[0]) {
    case 'host':
      throw new Error('Enter a valid SSH host or alias without spaces or options.')
    case 'user':
      throw new Error('Enter a valid SSH username, or leave it blank for your SSH config.')
    case 'port':
      throw new Error('SSH port must be between 1 and 65535.')
    default:
      throw new Error('Enter a valid SSH key file path.')
  }
}

export function readSshWorkspaces(): Record<string, SavedSshWorkspace> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
    const result: Record<string, SavedSshWorkspace> = {}
    for (const [id, candidate] of Object.entries(value)) {
      if (!UUID.test(id) || typeof candidate !== 'object' || candidate === null) continue
      const fields = candidate as Record<string, unknown>
      if (typeof fields.host !== 'string' || typeof fields.user !== 'string') continue
      try {
        if (fields.identityFile !== undefined && typeof fields.identityFile !== 'string') continue
        result[id] = parseSshWorkspace(
          fields.host,
          fields.user,
          Number(fields.port),
          fields.identityFile
        )
      } catch {
        // Ignore a damaged entry while retaining valid saved workspaces.
      }
    }
    return result
  } catch {
    return {}
  }
}

export function saveSshWorkspaces(workspaces: Record<string, SavedSshWorkspace>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspaces))
}
