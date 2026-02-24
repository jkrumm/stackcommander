import process from 'node:process'
import { app } from '@/app'

const port = Number(process.env.PORT ?? 7700)
app.listen(port, () => {
  process.stdout.write(`RollHook running on http://localhost:${port}\n`)
})
