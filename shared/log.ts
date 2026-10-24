// The only place allowed to print. Everything else calls log(module, message, data?).
export function log(module: string, message: string, data?: unknown): void {
  if (data === undefined) console.log(`[${module}] ${message}`);
  else console.log(`[${module}] ${message}`, data);
}
