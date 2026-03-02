import type { JobStatus, LogLine } from '@rollhook/ui'
import { LogDrawer } from '@rollhook/ui'
import { useEffect, useRef, useState } from 'react'
import { streamLogs } from '../lib/api'

const TIMESTAMP_RE = /^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]\s+(.*)/

interface LogContainerProps {
  jobId: string
  status: JobStatus
}

export function LogContainer({ jobId, status }: LogContainerProps) {
  const [logLines, setLogLines] = useState<LogLine[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const startTimeRef = useRef<number | null>(null)
  // Tracks how many lines have already been rendered — used to skip duplicates on re-stream
  const seenCountRef = useRef(0)

  useEffect(() => {
    // Reset state for new job
    setLogLines([])
    setIsLoading(true)
    startTimeRef.current = null
    seenCountRef.current = 0

    let cancelled = false
    const ctrl = new AbortController()

    async function streamOnce(): Promise<void> {
      let lineIndex = 0

      await streamLogs(
        jobId,
        (raw) => {
          // Skip lines already rendered from a previous stream cycle
          if (lineIndex < seenCountRef.current) {
            lineIndex++
            return
          }
          lineIndex++

          const match = raw.match(TIMESTAMP_RE)
          let text: string
          let elapsed: number | undefined

          if (match) {
            const lineMs = new Date(match[1]).getTime()
            if (startTimeRef.current === null)
              startTimeRef.current = lineMs
            elapsed = Math.round((lineMs - startTimeRef.current) / 1000)
            text = match[2]
          }
          else {
            text = raw
          }

          seenCountRef.current++
          setLogLines(prev => [...prev, { text, elapsed }])
          setIsLoading(false)
        },
        ctrl.signal,
      ).catch(() => {})

      setIsLoading(false)

      // For running jobs: re-stream after 2s to pick up new log lines.
      // Each cycle skips already-seen lines via seenCountRef.
      if (!cancelled && status === 'running') {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 2000)
          function onAbort() {
            clearTimeout(t)
            resolve()
          }
          // eslint-disable-next-line react-web-api/no-leaked-event-listener -- ctrl.abort() fires this in cleanup; { once: true } auto-removes it
          ctrl.signal.addEventListener('abort', onAbort, { once: true })
        })
        if (!cancelled)
          return streamOnce()
      }
    }

    void streamOnce()
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [jobId, status])

  return <LogDrawer logLines={logLines} isLoading={isLoading} />
}
