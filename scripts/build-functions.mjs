// Bundle the TypeScript serverless handler(s) that import shared .ts libs into
// self-contained .js under api/, because Vercel's Node runtime does not transpile
// imported .ts files (only the entry). node_modules stay external (Vercel traces them).
import { build } from 'esbuild'

await build({
  entryPoints: { plan: 'lib/handlers/plan.ts' },
  outdir: 'api',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external', // zod / @neondatabase/serverless / bcryptjs resolve from node_modules at runtime
  logLevel: 'info',
})
console.log('✅ bundled api/plan.js from lib/handlers/plan.ts')
