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
  idAnnonce?: string
}

// ─── API XML SeLoger (officielle app mobile) ──────────────────────────────
// Base: http://ws.seloger.com/search.xml
// idtt=2 (achat), idtypebien=1 (appartement)
// natures=1 = viager
async function fetchSeLogerAPI(page = 1, bouquetMax = 80000): Promise<Listing[]> {
  const params = new URLSearchParams({
    idtt: "2",           // achat
    idtypebien: "1",     // appartement
    natures: "1",        // viager
    pxmax: String(bouquetMax),
    tri: "d_dt_crea",    // plus récents en premier
    SEARCHpg: String(page),
  })

  const url = `http://ws.seloger.com/search.xml?${params}`

  const res = await fetch(url, {
    headers: {
      "User-Agent": "SeLoger/4.0 (iPhone; iOS 17.0)",
      "Accept": "application/xml, text/xml",
    },
  })

  if (!res.ok) return []
  const xml = await res.text()
  return parseSeLogerXML(xml)
}

function parseSeLogerXML(xml: string): Listing[] {
  const listings: Listing[] = []
  const items = xml.match(/<annonce>[\s\S]*?<\/annonce>/gi) || []

  for (const item of items) {
    const get = (tag: string) => {
      const m = item.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, "i"))
      return m?.[1]?.trim() || ""
    }
    const getNum = (tag: string) => {
      const v = parseFloat(get(tag).replace(/\s/g, ""))
      return isNaN(v) ? undefined : v
    }

    const id = get("idAnnonce")
    const cp = get("cp") || get("codePostal")
    const ville = get("ville") || get("libelleLieu")
    const prix = getNum("prix") || getNum("prixFAI")
    const surface = getNum("surface")
    const nbPieces = get("nbPieces")
    const titre = get("titre") || get("libelle") || `Viager ${ville}`
    const urlAnnonce = get("permaLien") || get("url") || (id ? `https://www.seloger.com/annonces/achat/appartement/${cp}/${id}.htm` : "")
    const dateM = get("dtCreation") || get("dateModif")

    // Extraire bouquet et rente depuis le titre ou la description
    const desc = get("descriptif") + " " + titre
    const bouquetM = desc.match(/bouquet[^\d]*(\d[\d\s]{2,7})\s*€?/i)
    const renteM = desc.match(/rente[^\d]*(\d[\d\s]{2,5})\s*€?\s*\/?\s*mois/i)

    const bouquet = bouquetM ? parseInt(bouquetM[1].replace(/\s/g, "")) : prix
    const rente = renteM ? parseInt(renteM[1].replace(/\s/g, "")) : undefined

    if (!urlAnnonce || urlAnnonce.length < 20) continue

    listings.push({
      idAnnonce: id,
      url: urlAnnonce,
      titre,
      ville: ville || undefined,
      codePostal: cp || undefined,
      bouquet: bouquet && bouquet > 0 && bouquet < 500000 ? bouquet : undefined,
      rente: rente && rente > 50 && rente < 5000 ? rente : undefined,
      superficie: surface && surface > 5 && surface < 1000 ? surface : undefined,
      source: "SeLoger",
      pubDate: dateM || new Date().toISOString(),
    })
  }

  return listings
}

// ─── Renée Costes sitemap XML ─────────────────────────────────────────────
async function fetchReneeCostes(): Promise<Listing[]> {
  const res = await fetch("https://www.costes-viager.com/sitemap.xml", {
    headers: { "User-Agent": "Mozilla/5.0" },
  })
  if (!res.ok) return []
  const xml = await res.text()

  const urls = xml.match(/https:\/\/www\.costes-viager\.com\/acheter\/[^\s<"]+/g) || []
  const recent = urls
    .filter(u => !u.includes("?") && u.split("/").length > 5)
    .slice(0, 60)

  return recent.map(url => ({
    url,
    titre: `Viager Renée Costes`,
    source: "Renée Costes",
    pubDate: new Date().toISOString(),
  }))
}

// ─── Filtres ──────────────────────────────────────────────────────────────
function passeFiltres(listing: Listing, bouquetMax: number): boolean {
  if (!listing.url || listing.url.length < 25) return false
  if (/\/maison-/i.test(listing.url) && !/\/appartement-/i.test(listing.url)) return false
  if (listing.bouquet && listing.bouquet > bouquetMax) return false
  if (listing.rente && listing.rente >= 600) return false
  return true
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const bouquetMax = parseInt(searchParams.get("bouquetMax") || "80000")
  const origin = req.headers.get("host") || ""
  const protocol = origin.includes("localhost") ? "http" : "https"

  const runBackground = async () => {
    try {
      // SeLoger API — 5 pages × ~20 annonces = ~100 résultats
      const slPages = await Promise.allSettled([
        fetchSeLogerAPI(1, bouquetMax),
        fetchSeLogerAPI(2, bouquetMax),
        fetchSeLogerAPI(3, bouquetMax),
        fetchSeLogerAPI(4, bouquetMax),
        fetchSeLogerAPI(5, bouquetMax),
      ])
      const slListings = slPages
        .filter(r => r.status === "fulfilled")
        .flatMap(r => (r as PromiseFulfilledResult<Listing[]>).value)

      // Renée Costes sitemap
      const rcListings = await fetchReneeCostes()

      const all = [...slListings, ...rcListings]

      // Dédupliquer
      const seen: Record<string, boolean> = {}
      const unique = all.filter(l => {
        if (seen[l.url]) return false
        seen[l.url] = true
        return true
      })

      const filtered = unique.filter(l => passeFiltres(l, bouquetMax))

      // Sauvegarder en base via /api/import
      for (const listing of filtered.slice(0, 100)) {
        try {
          await fetch(`${protocol}://${origin}/api/import`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: listing.url }),
          })
        } catch { }
      }
    } catch (e) {
      console.error("Background scraping error:", e)
    }
  }

  runBackground().catch(console.error)

  return NextResponse.json({
    success: true,
    message: "Scraping SeLoger API + Renée Costes lancé en arrière-plan",
    filters: { bouquetMax, renteMax: 600, type: "appartement", zone: "France" },
    startedAt: new Date().toISOString(),
  })
}
