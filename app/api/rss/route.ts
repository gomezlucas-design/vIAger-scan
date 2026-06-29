import { NextRequest, NextResponse } from "next/server"

interface Listing {
 url: string
 titre: string
 ville?: string
 bouquet?: number
 rente?: number
 superficie?: number
 source: string
 typeViager?: "occupe" | "libre" | "inconnu"
 pubDate?: string
}

function extractNumber(text: string, regex: RegExp): number | undefined {
 const m = text.match(regex)
 if (!m?.[1]) return undefined
 return parseInt(m[1].replace(/[\s\u00a0]/g, "")) || undefined
}

function detectTypeViager(text: string): "occupe" | "libre" | "inconnu" {
 if (/viager\s+libre|bien\s+libre|libre\s+de\s+toute/i.test(text)) return "libre"
 if (/viager\s+occup[eé]|droit\s+d.usage|DUH/i.test(text)) return "occupe"
 return "inconnu"
}

function extractListings(markdown: string, source: string): Listing[] {
 const listings: Listing[] = []
 const urlRegex = source === "SeLoger"
   ? /https?:\/\/www\.seloger\.com\/annonces\/[^\s"')]+/gi
   : /https?:\/\/www\.costes-viager\.com\/acheter\/[^\s"')]+/gi

 const urlMatches = markdown.match(urlRegex) || []
 const seen: Record<string, boolean> = {}
 const urls: string[] = []
 for (const u of urlMatches) {
   const clean = u.replace(/[,.)]+$/, "")
   if (!seen[clean] && clean.length > 30) { seen[clean] = true; urls.push(clean) }
 }

 for (const url of urls.slice(0, 50)) {
   const idx = markdown.indexOf(url)
   const context = markdown.slice(Math.max(0, idx - 500), Math.min(markdown.length, idx + 700))
   const bouquet = extractNumber(context, /bouquet[^\d]*(\d[\d\s]{2,7})\s*€?/i)
   const rente = extractNumber(context, /rente[^\d]*(\d[\d\s]{2,5})\s*€?\s*\/?\s*mois/i)
   const superficie = extractNumber(context, /(\d{2,3})\s*m²/i)
   const villeM = context.match(/([A-ZÀ-Ü][a-zà-ü\-]+(?:\s+[A-ZÀ-Ü0-9][a-zà-ü0-9\-]*)*)\s*\(\d{5}\)/i)
   const typeViager = detectTypeViager(context)
   listings.push({
     url, titre: villeM ? `Viager ${villeM[1]}` : `Annonce ${source}`,
     ville: villeM?.[1], bouquet, rente, superficie, source, typeViager,
     pubDate: new Date().toISOString()
   })
 }
 return listings
}

async function scrapeURL(url: string, apiKey: string): Promise<string> {
 const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
   method: "POST",
   headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
   body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, waitFor: 4000 }),
 })
 if (!res.ok) return ""
 const json = await res.json()
 return json.data?.markdown || json.markdown || ""
}

function passeFiltres(listing: Listing, bouquetMax: number): boolean {
 if (!listing.url || listing.url.length < 25) return false
 if (/\/maison-/i.test(listing.url) && !/\/appartement-/i.test(listing.url)) return false
 if (/\bmaison\b|\bvilla\b|\bpavillon\b/i.test(listing.titre) &&
   !/\bappart|\bstudio/i.test(listing.titre)) return false
 if (listing.bouquet && listing.bouquet > bouquetMax) return false
 if (listing.typeViager === "occupe" && listing.rente && listing.rente >= 600) return false
 return true
}

const SELOGER_PAGES = Array.from({ length: 7 }, (_, i) =>
 `https://www.seloger.com/recherche/achat/appartement/viager/france/?LISTING-LISTpg=${i + 1}`
)

const RC_PAGES = [
 "https://www.costes-viager.com/acheter/annonces",
 "https://www.costes-viager.com/acheter/annonces?page=2",
 "https://www.costes-viager.com/acheter/annonces?page=3",
]

export async function GET(req: NextRequest) {
 const { searchParams } = new URL(req.url)
 const bouquetMax = parseInt(searchParams.get("bouquetMax") || "80000")
 const apiKey = process.env.FIRECRAWL_API_KEY

 if (!apiKey) {
   return NextResponse.json({ error: "FIRECRAWL_API_KEY manquante" }, { status: 500 })
 }

 const allPages = [
   ...SELOGER_PAGES.map(url => ({ url, source: "SeLoger" })),
   ...RC_PAGES.map(url => ({ url, source: "Renée Costes" })),
 ]

 const origin = req.headers.get("host") || ""
 const protocol = origin.includes("localhost") ? "http" : "https"

 // Lancer le scraping en arrière-plan sans bloquer
 const runBackground = async () => {
   const allMarkdowns: { markdown: string; source: string }[] = []
   for (let i = 0; i < allPages.length; i += 3) {
     const batch = allPages.slice(i, i + 3)
     const results = await Promise.allSettled(
       batch.map(p => scrapeURL(p.url, apiKey))
     )
     results.forEach((r, j) => {
       if (r.status === "fulfilled" && r.value) {
         allMarkdowns.push({ markdown: r.value, source: batch[j].source })
       }
     })
   }

   let allListings: Listing[] = []
   for (const { markdown, source } of allMarkdowns) {
     allListings = allListings.concat(extractListings(markdown, source))
   }

   const seen: Record<string, boolean> = {}
   const unique = allListings.filter(l => {
     if (seen[l.url]) return false
     seen[l.url] = true
     return true
   })

   const filtered = unique.filter(l => passeFiltres(l, bouquetMax))

   for (const listing of filtered.slice(0, 100)) {
     try {
       await fetch(`${protocol}://${origin}/api/import`, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ url: listing.url }),
       })
     } catch { }
   }
 }

 // Réponse immédiate à Make — scraping en arrière-plan
 runBackground().catch(console.error)

 return NextResponse.json({
   success: true,
   message: "Scraping lancé en arrière-plan — annonces disponibles dans ~60s",
   filters: {
     bouquetMax,
     renteMaxOccupe: 600,
     renteLibre: "illimitée",
     type: "appartement",
     zone: "France",
   },
   startedAt: new Date().toISOString(),
 })
}
