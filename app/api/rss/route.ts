import { NextRequest, NextResponse } from "next/server"

const FIRECRAWL_URLS = [
  "https://www.seloger.com/recherche/achat/appartement/viager/france/",
  "https://www.costes-viager.com/acheter/annonces",
  "https://www.leboncoin.fr/recherche?category=9&real_estate_type=2",
]

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
  const lines = markdown.split("\n")

  // Cherche les URLs d'annonces dans le markdown
  const urlRegex = /https?:\/\/(?:www\.)?(?:seloger\.com\/annonces|costes-viager\.com\/acheter\/[^)\s"]+|leboncoin\.fr\/ventes_immobilieres\/[^)\s"]+)/gi
  const urls = [...new Set(markdown.match(urlRegex) || [])]

  for (const url of urls.slice(0, 20)) {
    const context = markdown.slice(
      Math.max(0, markdown.indexOf(url) - 300),
      Math.min(markdown.length, markdown.indexOf(url) + 500)
    )

    const bouquet = extractNumber(context, /bouquet[^\d]*(\d[\d\s]{2,7})\s*€?/i)
    const rente = extractNumber(context, /rente[^\d]*(\d[\d\s]{2,5})\s*€?\s*\/?\s*mois/i)
    const superficie = extractNumber(context, /(\d{2,3})\s*m²/i)
    const villeM = context.match(/([A-ZÀ-Ü][a-zà-ü]+(?:[\s-][A-ZÀ-Ü]?[a-zà-ü]+)*)\s*\(\d{5}\)/i)

    listings.push({
      url,
      titre: villeM ? `Viager ${villeM[1]}` : `Annonce ${source}`,
      ville: villeM?.[1],
      bouquet,
      rente,
      superficie,
      source,
      pubDate: new Date().toISOString(),
    })
  }

  return listings
}

async function scrapeWithFirecrawl(url: string): Promise<string> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY manquante")

  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      waitFor: 3000,
    }),
  })

  if (!res.ok) return ""
  const json = await res.json()
  return json.data?.markdown || json.markdown || ""
}

// ─── Filtre annonces ──────────────────────────────────────────────────────
function passeFiltres(listing: Listing): boolean {
  // 1. Bouquet < 80 000 € (si connu)
  if (listing.bouquet && listing.bouquet > 80000) return false
  // 2. Appartement uniquement — exclure maisons
  if (/\bmaison\b|\bvilla\b|\bpavillon\b/i.test(listing.titre) &&
      !/\bappart|\bstudio|\bappt?\b/i.test(listing.titre)) return false
  // 3. URL valide
  if (!listing.url || listing.url.length < 20) return false
  return true
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const bouquetMax = parseInt(searchParams.get("bouquetMax") || "80000")

  try {
    // Scraper les pages de listing en parallèle
    const markdowns = await Promise.allSettled(
      FIRECRAWL_URLS.map(url => scrapeWithFirecrawl(url))
    )

    const sources = ["SeLoger", "Renée Costes", "LeBonCoin"]
    let allListings: Listing[] = []

    markdowns.forEach((result, i) => {
      if (result.status === "fulfilled" && result.value) {
        const listings = extractListings(result.value, sources[i])
        allListings = [...allListings, ...listings]
      }
    })

    // Dédupliquer par URL
    const seen = new Set<string>()
    const unique = allListings.filter(l => {
      if (seen.has(l.url)) return false
      seen.add(l.url)
      return true
    })

    // Appliquer les filtres
    const filtered = unique.filter(l => passeFiltres(l))

    return NextResponse.json({
      success: true,
      total: allListings.length,
      filtered: filtered.length,
      criteria: { bouquetMax, type: "appartement", zone: "France" },
      lastFetch: new Date().toISOString(),
      listings: filtered,
    })

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
