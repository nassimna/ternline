export function processDescendants(
  rootPid: number,
  relations: ReadonlyMap<number, number> | ReadonlyArray<readonly [pid: number, parent: number]>
): number[] {
  const descendants = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const [pid, parent] of relations) {
      if (descendants.has(parent) && !descendants.has(pid)) {
        descendants.add(pid)
        changed = true
      }
    }
  }
  return [...descendants]
}
