export interface ContainerSummary {
  Id: string
  Image: string
  Names: string[]
  Labels: Record<string, string>
  State: string
}

export interface HealthLog {
  Start: string
  End: string
  ExitCode: number
  Output: string
}

export interface HealthState {
  Status: 'healthy' | 'unhealthy' | 'starting'
  FailingStreak: number
  Log: HealthLog[]
}

export interface ContainerDetail {
  Id: string
  State: {
    Status: string
    Health: HealthState | null
  }
  Config: {
    Labels: Record<string, string>
  }
}
