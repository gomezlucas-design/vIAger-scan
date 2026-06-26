import { NextRequest, NextResponse } from "next/server"

const requests = new Map<string, number[]>()
function rateLimit(ip: string): boolean {
  const now = Date.now()
  const prev = (requests.get(ip) || []).filter(t => now - t < 60000)
  if (prev.length >= 15) return false
  requests.set(ip, [...prev, now])
  return true
}

function extractViagerData(markdown: string) {
  const clean = markdown.replace(/\s+/g, " ")
  const data: any = {}

  // Bouquet
  const bouquet = clean.match(/bouquet[^\d€]*([0-9][0-9\s]{2,8})\s*€?/i)
    || clean.match(/([0-9][0-9\s]{4,8})\s*€?\s*(?:FAI|hai|hono)/i)
  if (bouquet) data.bouquet = parseInt(bouquet[1].replace(/\s/g, ""))

  // Rente
  const rente = clean.match(/rente[^\d€]*([0-9][0-9\s]{2,6})\s*€?\s*\/?\s*mois/i)
    || clean.match(/([0-9][0-9\s]{2,6})\s*€\s*\/\s*mois/i)
  if (rente) data.rente = parseInt(rente[1].replace(/\s/g, ""))

  // Valeur vénale (SeLoger + Renée Costes "valeur du bien")
  const vv = clean.match(/valeur\s*v[eé]nale[^\d€]*([0-9][0-9\s]{4,8})\s*€?/i)
    || clean.match(/valeur\s*du\s*bien[^\d€]*([0-9][0-9\s]{4,8})\s*€?/i)
    || clean.match(/prix\s*(?:du\s*bien|march[eé])[^\d€]*([0-9][0-9\s]{4,8})\s*€?/i)
    || clean.match(/estim[eé][^\d€]*([0-9][0-9\s]{4,8})\s*€?/i)
  if (vv) data.valeurVenale = parseInt(vv[1].replace(/\s/g, ""))

  // Superficie
  const surf = clean.match(/([0-9]{2,3})\s*m²?\s*(?:carrez|habitable|loi)/i)
    || clean.match(/superficie[^\d]*([0-9]{2,3})\s*m/i)
    || clean.match(/([0-9]{2,3})\s*m²/i)
  if (surf) data.superficie = parseInt(surf[1])

  // Âge occupant
  const age = clean.match(/(?:dame|femme|homme|monsieur|vendeur)[^\d]*(\d{2})\s*ans/i)
    || clean.match(/(\d{2})\s*ans?\s*(?:dame|femme|homme)/i)
    || clean.match(/age\s*:\s*(?:femme|homme)\s*de\s*(\d{2})/i)
    || clean.match(/occup[eé]\s*par[^\d]*(\d{2})\s*ans/i)
  if (age) {
    data.occupant1Age = parseInt(age[1])
    data.occupant1Sexe = /dame|femme/i.test(age[0]) ? "F" : "H"
  }

  // Taxe foncière
  const tf = clean.match(/taxe\s*fonci[eè]re[^\d€]*([0-9][0-9\s]{2,6})\s*€?/i)
    || clean.match(/TF[^\d€]*([0-9][0-9\s]{2,6})\s*€?/)
  if (tf) data.taxeFonciere = parseInt(tf[1].replace(/\s/g, ""))

  // Charges (annuelles, trimestrielles, mensuelles)
  const chg = clean.match(/charges\s*trimestrielles?[^\d€]*([0-9][0-9\s]{2,6})\s*€?/i)
    || clean.match(/charges\s*de\s*copro[^\d€]*([0-9][0-9\s]{2,6})\s*€?/i)
    || clean.match(/charges[^\d€]*([0-9][0-9\s]{2,6})\s*€?\s*\/?\s*(?:an|trim|mois)/i)
  if (chg) {
    let val = parseInt(chg[1].replace(/\s/g, ""))
    if (/trim/i.test(chg[0])) val = val * 4
    if (/mois/i.test(chg[0])) val = val * 12
    data.chargesCopro = val
  }

  // Ville
  const ville = clean.match(/situ[eé][^\w]*(?:à|a|au|en)\s+([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü0-9][a-zà-ü0-9]*)*)/i)
    || clean.match(/([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]*)*)\s*\(\d{5}\)/i)
  if (ville) data.ville = ville[1].trim()

  const filled = ["bouquet", "rente", "superficie", "occupant1Age", "valeurVenale"]
    .filter(k => data[k] != null).length
  const confidence = filled / 5

  return { data, confidence }
}

async function scrapeWithFirecrawl(url: string) {
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
      waitFor: 2000,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Firecrawl ${res.status}: ${(err as any).error || res.statusText}`)
  }

  const json = await res.json()
  return json.data?.markdown || json.markdown || ""
}

function detectSource(url: string): string {
  if (/seloger\.com/i.test(url)) return "SeLoger"
  if (/costes-viager\.com/i.test(url)) return "Renée Costes"
  if (/leboncoin\.fr/i.test(url)) return "LeBonCoin"
  if (/pap\.fr/i.test(url)) return "PAP"
  return "Autres"
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"
  if (!rateLimit(ip)) {
    return NextResponse.json({ error: "Trop de requêtes" }, { status: 429 })
  }

  let url: string
  try {
    const body = await req.json()
    url = body.url
    if (!url || typeof url !== "string") throw new Error()
    new URL(url)
  } catch {
    return NextResponse.json({ error: "URL invalide" }, { status: 400 })
  }

  try {
    const source = detectSource(url)
    const markdown = await scrapeWithFirecrawl(url)

    if (!markdown || markdown.length < 100) {
      return NextResponse.json({
        success: true,
        data: {
          source, url, confidence: 0, data: {},
          error: "Page vide ou bloquée — essaie la saisie manuelle",
        }
      })
    }

    const { data, confidence } = extractViagerData(markdown)

    return NextResponse.json({
      success: true,
      data: { source, url, confidence, data },
    })

  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Erreur interne" }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ message: "POST /api/import avec { url: '...' }" })
}
