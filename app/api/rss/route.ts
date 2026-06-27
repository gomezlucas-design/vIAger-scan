import { NextRequest, NextResponse } from "next/server"

interface Listing {
  url: string
  titre: string
  ville?: string
  bouquet?: number
  rente?: number
  superficie?: number
  source: string
  pubDate?: string
}

function extractNumber(text: string, regex: RegExp): number | undefined {
  const m = text.match(regex)
  if (!m?.[1]) return undefined
  return parseInt(m[1].replace(/[\s\u00a0]/g, "")) || undefined
}

function extractListings(markdown: string, source: string): Listing[] {
  const listings: Listing[] = []
  const urlRegex = source === "SeLoger"
    ? /https?:\/\/www\.seloger\.com\/annonces\/[^\s"')]+/gi
    : source === "Renée Costes"
    ? /https?:\/\/www\.costes-viager\.com\/acheter\/[^\s"')]+/gi
    : /https?:\/\/www\.leboncoin\.fr\/ventes_immobilieres\/[^\s"')]+/gi

  const urlMatches = markdown.match(urlRegex) || []
  const seen: Record<string, boolean> = {}
  const urls: string[] = []
  for (const u of urlMatches) {
    const clean = u.replace(/[,.)]+$/, "")
    if (!seen[clean] && clean.length > 30) { seen[clean] = true; urls.push(clean) }
  }

  for (const url of urls.slice(0, 15)) {
    const idx = markdown.indexOf(url)
    const context = markdown.slice(Math.max(0, idx - 400), Math.min(markdown.length, idx + 600))
    const bouquet = extractNumber(context, /bouquet[^\d]*(\d[\d\s]{2,7})\s*€?/i)
    const rente = extractNumber(context, /rente[^\d]*(\d[\d\s]{2,5})\s*€?\s*\/?\s*mois/i)
    const superficie = extractNumber(context, /(\d{2,3})\s*m²/i)
    const villeM = context.match(/([A-ZÀ-Ü][a-zà-ü\-]+(?:\s+[A-ZÀ-Ü0-9][a-zà-ü0-9\-]*)*)\s*\(\d{5}\)/i)
    listings.push({ url, titre: villeM ? `Viager ${villeM[1]}` : `Annonce ${source}`, ville: villeM?.[1], bouquet, rente, superficie, source, pubDate: new Date().toISOString() })
  }
  return listings
}

async function crawlWithFirecrawl(url: string, source: string): Promise<string> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY manquante")

  // Lance un crawl sur la page de listing
  const startRes = await fetch("https://api.firecrawl.dev/v1/crawl", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      url,
      limit: 20,
      scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
      includePaths: source === "SeLoger"
        ? ["/annonces/achat/*"]
        : source === "Renée Costes"
        ? ["/acheter/*"]
        : ["/ventes_immobilieres/*"],
      excludePaths: ["/login", "/inscription", "/compte", "/aide"],
      maxDepth: 2,
    }),
  })

  if (!startRes.ok) {
    // Fallback: scrape simple si crawl échoue
    return await scrapeSimple(url, apiKey)
  }

  const { id } = await startRes.json()
  if (!id) return await scrapeSimple(url, apiKey)

  // Polling résultat (max 30s)
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 3000))
    const pollRes = await fetch(`https://api.firecrawl.dev/v1/crawl/${id}`, {
      headers: { "Authorization": `Bearer ${apiKey}` }
    })
    if (!pollRes.ok) continue
    const data = await pollRes.json()
    if (data.status === "completed" || data.data?.length > 0) {
      return (data.data || []).map((d: any) => d.markdown || "").join("\n\n")
    }
  }

  return await scrapeSimple(url, apiKey)
}

async function scrapeSimple(url: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, waitFor: 4000 }),
  })
  if (!res.ok) return ""
  const json = await res.json()
  return json.data?.markdown || json.markdown || ""
}

function passeFiltres(listing: Listing): boolean {
  if (listing.bouquet && listing.bouquet > 80000) return false
  if (/\bmaison\b|\bvilla\b|\bpavillon\b/i.test(listing.titre) &&
    !/\bappart|\bstudio|\bappt?\b/i.test(listing.titre)) return false
  if (!listing.url || listing.url.length < 25) return false
  return true
}

const SOURCES = [
  { url: "https://www.seloger.com/recherche/achat/appartement/viager/france/", name: "SeLoger" },
  { url: "https://www.costes-viager.com/acheter/annonces", name: "Renée Costes" },
]

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const bouquetMax = parseInt(searchParams.get("bouquetMax") || "80000")

  try {
    const results = await Promise.allSettled(
      SOURCES.map(s => crawlWithFirecrawl(s.url, s.name))
    )

    let allListings: Listing[] = []
    results.forEach((result, i) => {
      if (result.status === "fulfilled" && result.value) {
        allListings = allListings.concat(extractListings(result.value, SOURCES[i].name))
      }
    })

    const seen: Record<string, boolean> = {}
    const unique = allListings.filter(l => {
      if (seen[l.url]) return false
      seen[l.url] = true
      return true
    })

    const filtered = unique.filter(l => passeFiltres(l))

    // Sauvegarder automatiquement en base via /api/import
    if (filtered.length > 0) {
      const origin = req.headers.get("host") || ""
      const protocol = origin.includes("localhost") ? "http" : "https"
      for (const listing of filtered.slice(0, 10)) {
        try {
          await fetch(`${protocol}://${origin}/api/import`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: listing.url }),
          })
        } catch { /* silencieux */ }
      }
    }

    return NextResponse.json({
      success: true,
      total: allListings.length,
      filtered: filtered.length,
      saved: Math.min(filtered.length, 10),
      criteria: { bouquetMax, type: "appartement", zone: "France" },
      lastFetch: new Date().toISOString(),
      listings: filtered,
    })

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
