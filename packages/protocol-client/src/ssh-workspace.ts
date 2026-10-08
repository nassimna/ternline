import { z } from 'zod'

export const sshWorkspaceSchema = z.strictObject({
  host: z
    .string()
    .min(1)
    .max(253)
    .regex(/^(?!-)[a-z0-9][a-z0-9._:-]*$/iu),
  user: z
    .string()
    .max(64)
    .refine((value) => value === '' || /^[a-z_][a-z0-9_.-]*$/iu.test(value)),
  port: z.number().int().min(1).max(65535),
  identityFile: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => value === value.trim() && !/[\p{Cc}\p{Cf}]/u.test(value))
    .optional()
})

export type SshWorkspace = z.infer<typeof sshWorkspaceSchema>

export function sshCommand(profile: SshWorkspace): string[] {
  const command = ['ssh']
  if (profile.identityFile) command.push('-i', profile.identityFile)
  if (profile.port !== 22) command.push('-p', String(profile.port))
  command.push(profile.user ? `${profile.user}@${profile.host}` : profile.host)
  return command
}
