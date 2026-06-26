import { NextRequest, NextResponse } from "next/server"

// ─── URLs RSS SeLoger viager appartement ──────────────────────────────────
// SeLoger expose des flux RSS sur ses pages de recherche
// Format: /list.htm?...&tri=d_dt_crea (tri par date) avec .rss en fin
const RSS_FEEDS = [
  // Île-de-France
  "https://www.seloger.com/list.htm?types=2&projects=2&natures=1&places=%5B%7Bci%3A0%7D%5D&enterprise=0&qsVersion=1.0&m=search_refine.rss",
  // Paris
  "https://www.seloger.com/list.htm?types=2&projects=2&natures=1&places=%5B%7Bci%3A750056%7D%5D&enterprise=0&qsVersion=1.0&m=search_refine.rss",
  // PACA
  "https://www.seloger.com/list.htm?types=2&projects=2&natures=1&places=%5B%7Bci%3A130006%7D%5D&enterprise=0&qsVersion=1.0&m=search_refine.rss",
]

// ─── Renée Costes RSS ─────────────────────────────────────────────────────
const RC_RSS = "https://www.costes-viager.com/feed/annonces"

interface RSSListing {
  title: string
  url: string
  pubDate: string
  description: string
  source: string
  bouquet?: number
  rente?: number
  superficie?: number
  ville?: string
  occupant1Age?: number
  occupant1Sexe?: string
}

function extractNumber(text: string, regex: RegExp): number | undefined {
  const m = text.match(regex)
  if (!m?.[1]) return undefined
  return parseInt(m[1].replace(/[\s\u00a0]/g, "")) || undefined
}

function parseRSSItem(item: string, source: string): RSSListing | null {
  const title = item.match(/<title[^>]*><!\[CDATA\[([^\]]*)\]\]><\/title>|<title[^>]*>([^<]*)<\/title>/)?.[1] || ""
  const link = item.match(/<link[^>]*>([^<]*)<\/link>|<link[^>]*\/>/)?.[1] || ""
  const pubDate = item.match(/<pubDate>([^<]*)<\/pubDate>/)?.[1] || ""
  const desc = item.match(/<description[^>]*><!\[CDATA\[([^\]]*)\]\]><\/description>|<description[^>]*>([^<]*)<\/description>/)?.[1] || ""

  if (!title && !link) return null

  const fullText = `${title} ${desc}`

  const listing: RSSListing = {
    title: title.trim(),
    url: link.trim(),
    pubDate: pubDate.trim(),
    description: desc.replace(/<[^>]*>/g, " ").trim().slice(0, 300),
    source,
    bouquet: extractNumber(fullText, /bouquet[^\d]*(\d[\d\s]{2,8})\s*€?/i)
      || extractNumber(fullText, /(\d[\d\s]{4,8})\s*€?\s*(?:FAI|hai)/i),
    rente: extractNumber(fullText, /rente[^\d]*(\d[\d\s]{2,6})\s*€?\s*\/?\s*mois/i)
      || extractNumber(fullText, /(\d[\d\s]{2,5})\s*€\s*\/\s*mois/i),
    superficie: extractNumber(fullText, /(\d{2,3})\s*m²/i),
    occupant1Age: (() => {
      const m = fullText.match(/(?:dame|femme|homme)\s+de\s*(\d{2})\s*ans/i)
        || fullText.match(/(\d{2})\s*ans?\s*(?:dame|femme|homme)/i)
      return m ? parseInt(m[1]) : undefined
    })(),
    occupant1Sexe: (() => {
      if (/dame|femme/i.test(fullText)) return "F"
      if (/homme|monsieur/i.test(fullText)) return "H"
      return undefined
    })(),
    ville: (() => {
      const m = fullText.match(/([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü0-9][a-zà-ü0-9]*)*)\s*\(\d{5}\)/i)
        || fullText.match(/situ[eé][^\w]*(?:à|a|au)\s+([A-ZÀ-Ü][a-zà-ü]+)/i)
      return m?.[1]?.trim()
    })(),
  }

  return listing
}

async function fetchRSS(url: string, source: string): Promise<RSSListing[]> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ViagerScan/1.0)",
        "Accept": "application/rss+xml, application/xml, text/xml",
      },
      next: { revalidate: 3600 }, // cache 1h
    })

    if (!res.ok) {
      console.warn(`RSS ${source} returned ${res.status}`)
      return []
    }

    const xml = await res.text()

    // Extraire les items
    const items = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi) || []
    return items
      .map(item => parseRSSItem(item, source))
      .filter(Boolean) as RSSListing[]

  } catch (e: any) {
    console.error(`RSS fetch error ${source}:`, e.message)
    return []
  }
}

// ─── Filtrer uniquement les viagers appartement ───────────────────────────
function isValidViager(listing: RSSListing, bouquetMax = 100000): boolean {
  // Doit avoir un lien valide
  if (!listing.url) return false
  // Filtre bouquet si disponible
  if (listing.bouquet && listing.bouquet > bouquetMax) return false
  // Exclure les maisons si mentionné explicitement
  if (/\bmaison\b|\bvilla\b|\bpavillon\b/i.test(listing.title) &&
      !/\bappartement\b|\bstudio\b|\bappt?\b/i.test(listing.title)) return false
  return true
}

// ─── GET /api/rss ─────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const bouquetMax = parseInt(searchParams.get("bouquetMax") || "100000")
  const limit = parseInt(searchParams.get("limit") || "50")

  try {
    // Fetch tous les flux en parallèle
    const results = await Promise.allSettled([
      ...RSS_FEEDS.map(url => fetchRSS(url, "SeLoger")),
      fetchRSS(RC_RSS, "Renée Costes"),
    ])

    const allListings: RSSListing[] = results
      .filter(r => r.status === "fulfilled")
      .flatMap(r => (r as PromiseFulfilledResult<RSSListing[]>).value)

    // Filtrer + dédupliquer par URL
    const seen = new Set<string>()
    const filtered = allListings
      .filter(l => {
        if (seen.has(l.url)) return false
        seen.add(l.url)
        return isValidViager(l, bouquetMax)
      })
      .slice(0, limit)

    // Trier par date
    filtered.sort((a, b) => {
      const da = a.pubDate ? new Date(a.pubDate).getTime() : 0
      const db = b.pubDate ? new Date(b.pubDate).getTime() : 0
      return db - da
    })

    return NextResponse.json({
      success: true,
      count: filtered.length,
      lastFetch: new Date().toISOString(),
      listings: filtered,
    })

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
