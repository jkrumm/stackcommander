let shutdownFlag = false

export function isShuttingDown(): boolean {
  return shutdownFlag
}

export function startShutdown(): void {
  shutdownFlag = true
}
