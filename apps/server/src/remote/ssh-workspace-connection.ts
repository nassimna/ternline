import { execFile } from 'node:child_process'

import { sshCommand, type SshWorkspace } from '@agent-workspace/protocol-client'
import { WorkspaceMutationError } from '../domain/workspace-mutations'

export function testSshConnection(profile: SshWorkspace): Promise<void> {
  const [, ...args] = sshCommand(profile)
  return new Promise((resolve, reject) => {
    execFile(
      'ssh',
      [
        '-o',
        'BatchMode=yes',
        '-o',
        'ControlPath=none',
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        'ConnectTimeout=10',
        '-o',
        'ConnectionAttempts=1',
        '-o',
        'ClearAllForwardings=yes',
        '-T',
        ...args,
        'true'
      ],
      { timeout: 15_000, maxBuffer: 64 * 1024 },
      (error, _stdout, stderr) => {
        if (!error) {
          resolve()
          return
        }
        reject(
          new WorkspaceMutationError(
            'ssh_connection_failed',
            `SSH connection failed. ${stderr.trim() || error.message} Use a trusted host and an SSH agent or key that can authenticate without a password prompt.`
          )
        )
      }
    )
  })
}
