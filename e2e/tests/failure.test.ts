import type { JobResult } from '../setup/fixtures.ts'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminHeaders, BASE_URL, E2E_DIR, getContainerCount, REGISTRY_HOST, startContainerWithLabels, stopContainer } from '../setup/fixtures.ts'

// Image tag that does not exist in the local registry → docker pull fails fast (no rollout)
const NONEXISTENT_IMAGE = `${REGISTRY_HOST}/rollhook-e2e-hello:does-not-exist`

let failedJob: JobResult

beforeAll(async () => {
  // Synchronous deploy: endpoint blocks until job completes and returns HTTP 500 on failure.
  // No need to poll afterward — the job is already in terminal state when we get the response.
  const res = await fetch(`${BASE_URL}/deploy`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ image_tag: NONEXISTENT_IMAGE }),
  })
  expect(res.status).toBe(500)
  const { job_id } = await res.json() as { job_id: string }

  // Fetch canonical JobResult from DB (has `id` field, full schema)
  const jobRes = await fetch(`${BASE_URL}/jobs/${job_id}`, { headers: adminHeaders() })
  failedJob = await jobRes.json() as JobResult
})

describe('failed deployment lifecycle', () => {
  it('job reaches failed status when image pull fails', () => {
    expect(failedJob.status).toBe('failed')
  })

  it('failed job has error field populated with docker pull message', () => {
    expect(failedJob.error).toBeTruthy()
    expect(failedJob.error).toContain('docker pull failed')
  })

  it('job logs contain pull step and executor error but not rollout', async () => {
    const res = await fetch(`${BASE_URL}/jobs/${failedJob.id}/logs`, { headers: adminHeaders() })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('[pull]')
    expect(text).toContain('[executor] ERROR:')
    expect(text).not.toContain('[rollout]')
  })

  it('failed job appears in ?status=failed list', async () => {
    const res = await fetch(`${BASE_URL}/jobs?status=failed`, { headers: adminHeaders() })
    expect(res.status).toBe(200)
    const jobs = await res.json() as Array<{ id: string, status: string }>
    const found = jobs.find(j => j.id === failedJob.id)
    expect(found).toBeDefined()
    expect(found!.status).toBe('failed')
  })

  it('failed deploy sets updated_at later than created_at', () => {
    const created = new Date(failedJob.created_at).getTime()
    const updated = new Date(failedJob.updated_at).getTime()
    expect(updated).toBeGreaterThanOrEqual(created)
  })

  it('job logs contain discover step before pull failure', async () => {
    const res = await fetch(`${BASE_URL}/jobs/${failedJob.id}/logs`, { headers: adminHeaders() })
    const text = await res.text()
    expect(text).toContain('[discover] ')
    expect(text).toContain('[pull]')
    expect(text).not.toContain('[rollout]')
  })

  it('container count is unchanged after pull failure — no scale-up artifacts', () => {
    // Pull failure happens before rollout: the scale-up step never runs,
    // so no extra containers should be left behind.
    expect(getContainerCount()).toBe(1)
  })
})

// Validate-failure tests: each test uses a unique image tag (re-tagged from hello-world:v1)
// so discover finds the right container. Validate fails before pull, so no registry push needed.
describe('validate failures', () => {
  const FIXTURES_DIR = join(E2E_DIR, 'fixtures', 'validate')
  const containers: string[] = []

  function tagAndStart(tag: string, composePath: string, service: string, project: string): void {
    execFileSync('docker', ['tag', 'rollhook-e2e-hello:v1', tag])
    const id = startContainerWithLabels(tag, {
      'com.docker.compose.project.config_files': composePath,
      'com.docker.compose.service': service,
      'com.docker.compose.project': project,
    })
    containers.push(id)
  }

  beforeAll(() => {
    tagAndStart('rollhook-validate-notfound:v1', '/nonexistent/rollhook-test/compose.yml', 'web', 'validate-notfound')
    tagAndStart('rollhook-validate-noservice:v1', join(FIXTURES_DIR, 'no-service.yml'), 'nonexistent-service', 'validate-noservice')
    tagAndStart('rollhook-validate-badyaml:v1', join(FIXTURES_DIR, 'invalid.yml'), 'web', 'validate-badyaml')
    tagAndStart('rollhook-validate-ports:v1', join(FIXTURES_DIR, 'ports.yml'), 'web', 'validate-ports')
    tagAndStart('rollhook-validate-cname:v1', join(FIXTURES_DIR, 'container-name.yml'), 'web', 'validate-cname')
    tagAndStart('rollhook-validate-nohc:v1', join(FIXTURES_DIR, 'no-healthcheck.yml'), 'web', 'validate-nohc')
    tagAndStart('rollhook-validate-noimgtag:v1', join(FIXTURES_DIR, 'hardcoded-image.yml'), 'web', 'validate-noimgtag')
  })

  afterAll(() => {
    for (const id of containers)
      stopContainer(id)
  })

  async function deployAndFail(imageTag: string): Promise<{ job: JobResult, logs: string }> {
    const res = await fetch(`${BASE_URL}/deploy`, {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ image_tag: imageTag }),
    })
    expect(res.status).toBe(500)
    const { job_id } = await res.json() as { job_id: string }
    const jobRes = await fetch(`${BASE_URL}/jobs/${job_id}`, { headers: adminHeaders() })
    const job = await jobRes.json() as JobResult
    const logsRes = await fetch(`${BASE_URL}/jobs/${job_id}/logs`, { headers: adminHeaders() })
    const logs = await logsRes.text()
    return { job, logs }
  }

  it('fails when compose file is not found', async () => {
    const { job, logs } = await deployAndFail('rollhook-validate-notfound:v1')
    expect(job.status).toBe('failed')
    expect(job.error).toContain('compose file not found')
    expect(logs).toContain('[validate]')
    expect(logs).not.toContain('[rollout]')
  })

  it('fails when service is not in compose file', async () => {
    const { job, logs } = await deployAndFail('rollhook-validate-noservice:v1')
    expect(job.status).toBe('failed')
    expect(job.error).toContain('not found')
    expect(logs).toContain('[validate]')
    expect(logs).not.toContain('[rollout]')
  })

  it('fails when compose file has invalid YAML', async () => {
    const { job, logs } = await deployAndFail('rollhook-validate-badyaml:v1')
    expect(job.status).toBe('failed')
    expect(job.error).toContain('compose file invalid')
    expect(logs).toContain('[validate]')
    expect(logs).not.toContain('[rollout]')
  })

  it('fails when service has port bindings', async () => {
    const { job, logs } = await deployAndFail('rollhook-validate-ports:v1')
    expect(job.status).toBe('failed')
    expect(job.error).toContain('must not expose ports')
    expect(logs).toContain('[validate]')
    expect(logs).not.toContain('[rollout]')
  })

  it('fails when service sets container_name', async () => {
    const { job, logs } = await deployAndFail('rollhook-validate-cname:v1')
    expect(job.status).toBe('failed')
    expect(job.error).toContain('must not set container_name')
    expect(logs).toContain('[validate]')
    expect(logs).not.toContain('[rollout]')
  })

  it('fails when service has no healthcheck', async () => {
    const { job, logs } = await deployAndFail('rollhook-validate-nohc:v1')
    expect(job.status).toBe('failed')
    expect(job.error).toContain('healthcheck')
    expect(logs).toContain('[validate]')
    expect(logs).not.toContain('[rollout]')
  })

  it('fails when service image does not reference IMAGE_TAG', async () => {
    const { job, logs } = await deployAndFail('rollhook-validate-noimgtag:v1')
    expect(job.status).toBe('failed')
    expect(job.error).toContain('IMAGE_TAG')
    expect(logs).toContain('[validate]')
    expect(logs).not.toContain('[rollout]')
  })
})
