import process from 'node:process'
import type { JobResult } from 'rollhook'
import { loadConfig } from '@/config/loader'

export async function notify(job: JobResult): Promise<void> {
  const config = loadConfig()
  const notifications = config.notifications

  const title = job.status === 'success'
    ? `✅ Deployed ${job.app}`
    : `❌ Deployment failed: ${job.app}`
  const message = `Image: ${job.image_tag}\nStatus: ${job.status}${job.error ? `\nError: ${job.error}` : ''}`

  const promises: Promise<void>[] = []

  const pushoverUserKey = process.env.PUSHOVER_USER_KEY
  const pushoverAppToken = process.env.PUSHOVER_APP_TOKEN
  if (pushoverUserKey && pushoverAppToken) {
    promises.push(sendPushover(pushoverUserKey, pushoverAppToken, title, message))
  }

  if (notifications?.webhook) {
    promises.push(sendWebhook(notifications.webhook, job))
  }

  await Promise.allSettled(promises)
}

async function sendPushover(userKey: string, appToken: string, title: string, message: string): Promise<void> {
  const res = await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: appToken, user: userKey, title, message }),
  })
  if (!res.ok)
    console.error(`[notifier] Pushover failed: ${res.status} ${await res.text()}`)
}

async function sendWebhook(url: string, job: JobResult): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(job),
  })
  if (!res.ok)
    console.error(`[notifier] Webhook failed: ${res.status} ${await res.text()}`)
}
