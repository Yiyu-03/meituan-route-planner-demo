// Same-origin proxy for Amap POI photos so the browser can rasterize them onto a canvas
// (html-to-image) without cross-origin taint. Only Amap/AutoNavi image hosts are allowed.
const ALLOWED = /(^|\.)(autonavi\.com|amap\.com|gtimg\.com|amap\.cn)$/i

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' })

  const raw = req.query?.u
  if (!raw) return res.status(400).json({ error: 'missing u' })

  let url
  try { url = new URL(String(raw)) } catch { return res.status(400).json({ error: 'bad url' }) }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return res.status(400).json({ error: 'bad protocol' })
  if (!ALLOWED.test(url.hostname)) return res.status(403).json({ error: 'host not allowed' })

  try {
    const upstream = await fetch(url.toString(), { headers: { 'User-Agent': 'roam-journal/1.0' } })
    if (!upstream.ok) return res.status(502).json({ error: `upstream ${upstream.status}` })
    const ct = upstream.headers.get('content-type') || 'image/jpeg'
    if (!ct.startsWith('image/')) return res.status(415).json({ error: 'not an image' })
    const buf = Buffer.from(await upstream.arrayBuffer())
    res.setHeader('Content-Type', ct)
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable')
    return res.status(200).send(buf)
  } catch {
    return res.status(502).json({ error: 'fetch failed' })
  }
}
