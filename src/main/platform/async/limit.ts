// Minimal concurrency limiter — replaces the pure-ESM `p-limit`, which does not
// interop cleanly when the main process is bundled as CJS for the bytecode
// plugin (`import pLimit from 'p-limit'` resolves to an undefined `.default` at
// runtime). This has the same contract as p-limit's returned `limit(fn)`:
// at most `concurrency` thunks run at once; returns each thunk's promise.
export function createLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const max = Math.max(1, Math.floor(concurrency))
  let active = 0
  const queue: Array<() => void> = []

  const next = (): void => {
    if (active >= max) return
    const run = queue.shift()
    if (run) {
      active++
      run()
    }
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = (): void => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--
            next()
          })
      }
      queue.push(run)
      next()
    })
  }
}
