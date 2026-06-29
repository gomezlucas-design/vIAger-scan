import { NextRequest, NextResponse } from "next/server"

interface EmailListing {
  ville: string
  codePostal?: string
  bouquet?: number
  rente?: number
  superficie?: number
  typeViager: string
  pieces?: number
}

function parseSeLogerEmail(html: string, text: string): EmailListing[] {
  const listings: EmailListing[] = []
  const content = (html + " " + text)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&euro;/g, "€")
    .replace(/\s+/g, " ")

  const bouquetPattern = /bouquet\s+([\d\s]+)\s*€\s*(?:et\s+([\d\s]+)\s*€\s*\/\s*mois)?/gi
  const matches = [...content.matchAll(bouquetPattern)]

  for (const match of matches) {
    const bouquet = parseInt(match[1].replace(/\s/g, ""))
    const rente = match[2] ? parseInt(match[2].replace(/\s/g, "")) : undefined
    const idx = match.index || 0
    const ctx = content.slice(idx, idx + 600)

    let typeViager = "occupe"
    if (/viager\s+libre|nue\s*propri|NUE/i.test(ctx)) typeViager = "libre"
    if (/vente\s+[aà]\s+terme|terme\s+libre/i.test(ctx)) typeViager = "terme"

    const surfM = ctx.match(/(\d{2,3}(?:[,.]\d+)?)\s*m²/i)
    const superficie = surfM ? parseFloat(surfM[1].replace(",", ".")) : undefined
    const piecesM = ctx.match(/(\d+)\s*pi[eè]ces?/i)
    const pieces = piecesM ? parseInt(piecesM[1]) : undefined
    const villeM = ctx.match(/([A-ZÀ-Ü][a-zA-Zà-ü\-\s]+)\s*\((\d{5})\)/i)

    if (!villeM) continue
    if (!bouquet || bouquet < 1000 || bouquet > 500000) continue

    listings.push({
      ville: villeM[1].trim(),
      codePostal: villeM[2],
      bouquet,
      rente: rente && rente > 50 && rente < 5000 ? rente : undefined,
      superficie: superficie && superficie > 5 && superficie < 1000 ? superficie : undefined,
      typeViager,
      pieces,
    })
  }

  return listings
}

function buildSeLogerUrl(ville: string, cp: string): string {
  const slug = ville.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")
  return `https://www.seloger.com/recherche/achat/appartement/viager/${slug}-${cp}/`
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const html = body.html || body.body || ""
    const text = body.text || body.plain || ""
    const from = body.from || ""

    if (!from.includes("seloger") && !html.includes("seloger") && !text.includes("seloger")) {
      return NextResponse.json({ success: false, message: "Email non SeLoger" })
    }

    const listings = parseSeLogerEmail(html, text)

    if (listings.length === 0) {
      return NextResponse.json({ success: true, message: "Aucune annonce trouvée", parsed: 0 })
    }

    const origin = req.headers.get("host") || ""
    const protocol = origin.includes("localhost") ? "http" : "https"

    const runBackground = async () => {
      for (const listing of listings) {
        try {
          const url = buildSeLogerUrl(listing.ville, listing.codePostal || "")
          await fetch(`${protocol}://${origin}/api/listings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url,
              source: "SeLoger",
              data: {
                ville: listing.ville,
                codePostal: listing.codePostal,
                bouquet: listing.bouquet,
                rente: listing.rente,
                superficie: listing.superficie,
                typeVente: listing.typeViager,
              },
              confidence: 0.6,
            }),
          })
          // Enrichissement Firecrawl en arrière-plan
          fetch(`${protocol}://${origin}/api/import`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
          }).catch(() => {})
        } catch { }
      }
    }

    runBackground().catch(console.error)

    return NextResponse.json({
      success: true,
      message: `${listings.length} annonces détectées`,
      parsed: listings.length,
      preview: listings,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ message: "POST /api/email-webhook — webhook SeLoger actif" })
}
