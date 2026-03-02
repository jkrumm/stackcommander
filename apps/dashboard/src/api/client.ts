// Custom fetch instance for orval-generated API clients.
// Call setApiToken(token) once after the user authenticates (see TokenGate.tsx).
let _token = ''

export function setApiToken(token: string) {
  _token = token
}

// Signature matches what orval's fetch client generator expects:
// customInstance<T>(url, options?: RequestInit) — URL includes query params.
// Returns { data, status, headers } to match orval's generated response union types.
export async function customInstance<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...options?.headers,
      Authorization: `Bearer ${_token}`,
    },
  })

  if (!res.ok)
    throw new Error(`${res.status}`)

  const data = await res.json()
  return { data, status: res.status, headers: res.headers } as unknown as T
}

export default customInstance
