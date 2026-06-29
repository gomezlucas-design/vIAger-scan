import { NextRequest, NextResponse } from "next/server"

interface Listing {
 url: string
 titre: string
 ville?: string
 codePostal?: string
 bouquet?: number
 rente?: number
 superficie?: number
 source: string
 typeViager?: string
 pubDate?: string
}

const REGIONS: Record<string, string[]> = {
 "Île-de-France":   ["75","77","78","91","92","93","94","95"],
 "Hauts-de-France": ["02","59","60","62","80"],
 "PACA":            ["04","05","06","13","83","84"],
 "Occitanie":       ["09","11","12","30","31","32","34","46","48","65","66","81","82"],
 "Normandie":       ["14","27","50","61","76"],
}
const CODES_AUTORISES = new Set(Object.values(REGIONS).flat())

function isZoneAutorisee(cp?: string): boolean {
 if (!cp) return true
 return CODES_AUTORISES.has(cp.slice(0, 2))
}

function extractNumber(text: string, regex: RegExp, min: number, max: number): number | undefined {
 const m = text.match(regex)
 if (!m?.[1]) return undefined
 const val = parseInt(m[1].replace(/[\s\u00a0]/g, ""))
 return !isNaN(val) && val >= min && val <= max ? val : undefined
}

function extractListingsFromMarkdown(markdown: string, source: string, baseUrl: string): Listing[] {
 const listings: Listing[] = []
 const domain = new URL(baseUrl).hostname.replace("www.", "")
 const escaped = domain.replace(/\./g, "\\.")
 const urlRegex = new RegExp(`https?://(?:www\\.)?${escaped}/[^\\s"'<>)]+`, "gi")
 const urlMatches = markdown.match(urlRegex) || []

 const seen: Record<string, boolean> = {}
 const urls = urlMatches
   .map(u => u.replace(/[,.)>]+$/, "").trim())
   .filter(u => {
     if (seen[u] || u.length < 25) return false
     if (/\/(contact|about|mentions|blog|faq|actualite|news|accueil|home|login|inscription)/i.test(u)) return false
     const path = u.replace(/https?:\/\/[^/]+/, "")
     if (path.split("/").length < 2) return false
     seen[u] = true
     return true
   })

 for (const url of urls.slice(0, 25)) {
   const idx = markdown.indexOf(url)
   const ctx = markdown.slice(Math.max(0, idx - 300), Math.min(markdown.length, idx + 500))

   const bouquet = extractNumber(ctx, /bouquet[^\d]{0,10}(\d[\d\s]{2,7})\s*€?/i, 1000, 400000)
   const rente = extractNumber(ctx, /rente[^\d]{0,10}(\d[\d\s]{2,5})\s*€?\s*\/?\s*mois/i, 50, 5000)
     ?? extractNumber(ctx, /(\d[\d\s]{2,5})\s*€\s*\/\s*mois/i, 50, 5000)
   const superficie = extractNumber(ctx, /(\d{2,3})\s*m²/i, 10, 500)

   let typeViager = "occupe"
   if (/viager\s+libre|libre\s+de\s+toute|nue[\s-]propri/i.test(ctx)) typeViager = "libre"
   if (/vente\s+[aà]\s+terme|terme\s+libre|terme\s+occup/i.test(ctx)) typeViager = "terme"

   const villeM = ctx.match(/([A-ZÀ-Ü][a-zà-ü\-]+(?:\s+[A-ZÀ-Ü][a-zà-ü\-]+)*)\s*\((\d{5})\)/i)

   listings.push({
     url,
     titre: villeM ? `Viager ${villeM[1]}` : `Annonce ${source}`,
     ville: villeM?.[1]?.trim(),
     codePostal: villeM?.[2],
     bouquet,
     rente,
     superficie,
     source,
     typeViager,
     pubDate: new Date().toISOString(),
   })
 }

 return listings
}

async function scrapeURL(url: string, apiKey: string): Promise<string> {
 try {
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
 } catch {
   return ""
 }
}

const SOURCES = [
 { url: "https://www.costes-viager.com/acheter/ile-de-france-75", name: "Renée Costes" },
 { url: "https://www.costes-viager.com/acheter/hauts-de-france-62", name: "Renée Costes" },
 { url: "https://www.costes-viager.com/acheter/provence-alpes-cote-d-azur-13", name: "Renée Costes" },
 { url: "https://www.costes-viager.com/acheter/occitanie-31", name: "Renée Costes" },
 { url: "https://www.costes-viager.com/acheter/normandie-76", name: "Renée Costes" },
 { url: "https://www.univers-viager.fr/nos-annonces/", name: "Univers Viager" },
 { url: "https://www.viager.com/annonces/", name: "Viager.com" },
 { url: "https://www.vivaviager.com/annonces-viager/", name: "Vivaviager" },
 { url: "https://www.viager-europe.com/viagers-en-france/", name: "Viager Europe" },
 { url: "https://www.viager-annonces.com/", name: "Viager Annonces" },
 { url: "http://www.viagimmo.com/vente-en-viager.html", name: "Viagimmo" },
 { url: "https://www.viager.fr/annonces-viager/", name: "Legasse Viager" },
 { url: "https://www.century21.fr/annonces/achat/viager/", name: "Century 21" },
 { url: "https://www.orpi.com/recherche/?type=buy&subtype=viager", name: "Orpi" },
 { url: "https://www.laforet.com/acheter/?type_bien=VENTE_VIAGER", name: "Laforêt" },
 { url: "https://www.iad-immobilier.com/annonces?transactionType=SALE&saleType=LIFE_ANNUITY", name: "iad" },
]

function passeFiltres(listing: Listing, bouquetMax: number): boolean {
 if (!listing.url || listing.url.length < 25) return false
 if (/\/maison[s\-]/i.test(listing.url) && !/\/appartement/i.test(listing.url)) return false
 if (listing.bouquet && listing.bouquet > bouquetMax) return false
 if (listing.typeViager === "occupe" && listing.rente && listing.rente >= 600) return false
 if (listing.codePostal && !isZoneAutorisee(listing.codePostal)) return false
 return true
}

export async function GET(req: NextRequest) {
 const { searchParams } = new URL(req.url)
 const bouquetMax = parseInt(searchParams.get("bouquetMax") || "80000")
 const apiKey = process.env.FIRECRAWL_API_KEY

 if (!apiKey) {
   return NextResponse.json({ error: "FIRECRAWL_API_KEY manquante" }, { status: 500 })
 }

 const origin = req.headers.get("host") || ""
 const protocol = origin.includes("localhost") ? "http" : "https"

 const runBackground = async () => {
   let allListings: Listing[] = []

   for (let i = 0; i < SOURCES.length; i += 3) {
     const batch = SOURCES.slice(i, i + 3)
     const results = await Promise.allSettled(
       batch.map(s => scrapeURL(s.url, apiKey).then(md => ({ md, source: s })))
     )
     for (const result of results) {
       if (result.status === "fulfilled" && result.value.md) {
         const { md, source } = result.value
         const listings = extractListingsFromMarkdown(md, source.name, source.url)
         allListings = allListings.concat(listings)
       }
     }
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

 runBackground().catch(console.error)

 return NextResponse.json({
   success: true,
   message: `Scraping ${SOURCES.length} sites viager lancé en arrière-plan`,
   sources: Array.from(new Set(SOURCES.map(s => s.name))),
   filters: {
     bouquetMax,
     renteMaxOccupe: 600,
     type: "appartement",
     regions: Object.keys(REGIONS),
   },
   startedAt: new Date().toISOString(),
 })
}
