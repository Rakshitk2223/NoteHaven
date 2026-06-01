/**
 * Development-only logger.
 * Logs are emitted in dev (`import.meta.env.DEV`) and stripped in production
 * builds, keeping the production console clean. Use instead of bare
 * `console.log` for diagnostic/trace output.
 *
 * For real errors keep using `console.error` directly.
 */
export const devLog: (...args: unknown[]) => void = import.meta.env.DEV
  ? (...args) => console.log(...args)
  : () => {};
