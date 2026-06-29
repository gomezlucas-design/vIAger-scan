import { NextRequest, NextResponse } from "next/server"

const requests = new Map<string, number[]>()
function rateLimit(ip: string): boolean {
  const now = Date.now()
  const prev = (requests.get(ip) || []).filter(t => now - t < 60000)
  if (prev.length >= 15) return false
  requests.set(ip, [...prev, now])
  return true
}

function detectTypeVente(text: string): "occupe" | "libre" | "terme" {
  const t = text.toLowerCase()
  if (/vente\s+[aà]\s+terme|terme\s+libre|terme\s+occup|mensualit[eé]s?\s+\d|180\s*mois|120\s*mois|240\s*mois/.test(t)) return "terme"
  if (/viager\s+libre|bien\s+libre|libre\s+de\s+toute\s+occupation|vente\s+libre/.test(t)) return "libre"
  return "occupe"
}

function extractNumber(text: string, regex: RegExp): number | undefined {
  const m = text.match(regex)
  if (!m?.[1]) return undefined
  const val = parseInt(m[1].replace(/[\s\u00a0]/g, ""))
  return isNaN(val) ? undefined : val
}

function extractMontant(text: string, regex: RegExp, min: number, max: number): number | undefined {
  const val = extractNumber(text, regex)
  if (val === undefined) return undefined
  return val >= min && val <= max ? val : undefined
}

function extractViagerData(markdown: string) {
  const clean = markdown.replace(/\s+/g, " ")
  const data: any = {}

  data.typeVente = detectTypeVente(clean)

  data.bouquet = extractMontant(clean, /bouquet\s*(?:FAI)?[^\d€]{0,10}([0-9][0-9\s]{2,8})\s*€?/i, 1000, 500000)
    ?? extractMontant(clean, /([0-9][0-9\s]{4,8})\s*€?\s*(?:FAI|hono)/i, 1000, 500000)

  if (data.typeVente === "terme") {
    data.mensualite = extractMontant(clean, /mensualit[eé]s?\s*:?\s*([0-9][0-9\s]{2,6})\s*€?\s*\/?\s*mois/i, 100, 10000)
      ?? extractMontant(clean, /([0-9][0-9\s]{2,6})\s*€?\s*\/\s*mois/i, 100, 10000)
    if (data.mensualite) data.rente = data.mensualite

    data.termeMois = extractMontant(clean, /terme\s*:?\s*([0-9]{2,4})\s*mois/i, 12, 360)
      ?? extractMontant(clean, /([0-9]{2,4})\s*mois/i, 12, 360)

    data.valeurVenale = extractMontant(clean, /prix\s*(?:d.achat|total|FAI)[^\d€]{0,10}([0-9][0-9\s]{4,8})\s*€?/i, 10000, 2000000)

    data.loyerMensuelManuel = extractMontant(clean, /loyer\s*garanti\s*:?\s*([0-9][0-9\s]{2,6})\s*€?/i, 100, 10000)
      ?? extractMontant(clean, /loyer\s*:?\s*([0-9][0-9\s]{2,6})\s*€?\s*\/?\s*mois/i, 100, 10000)

  } else {
    data.rente = extractMontant(clean, /rente[^\d€]{0,10}([0-9][0-9\s]{2,6})\s*€?\s*\/?\s*mois/i, 100, 3000)
      ?? extractMontant(clean, /([0-9][0-9\s]{2,5})\s*€\s*\/\s*mois/i, 100, 3000)

    data.valeurVenale = extractMontant(clean, /valeur\s*v[eé]nale[^\d€]{0,10}([0-9][0-9\s]{4,8})\s*€?/i, 30000, 5000000)
      ?? extractMontant(clean, /valeur\s*du\s*bien[^\d€]{0,10}([0-9][0-9\s]{4,8})\s*€?/i, 30000, 5000000)
      ?? extractMontant(clean, /prix\s*(?:du\s*bien|march[eé])[^\d€]{0,10}([0-9][0-9\s]{4,8})\s*€?/i, 30000, 5000000)
      ?? extractMontant(clean, /estim[eé][^\d€]{0,10}([0-9][0-9\s]{4,8})\s*€?/i, 30000, 5000000)

    const ageMatch = clean.match(/(?:dame|femme|homme|monsieur|vendeur|occup[eé])[^\d]{0,15}(\d{2})\s*ans/i)
      ?? clean.match(/(\d{2})\s*ans?\s*(?:dame|femme|homme)/i)
      ?? clean.match(/[aâ]g[eé][^\d]{0,5}(\d{2})/i)
    if (ageMatch) {
      const age = parseInt(ageMatch[1])
      if (age >= 55 && age <= 99) {
        data.occupant1Age = age
        data.occupant1Sexe = /dame|femme/i.test(ageMatch[0]) ? "F" : "H"
      }
    }

    if (data.typeVente === "libre") {
      data.loyerMensuelManuel = extractMontant(clean, /loyer[^\d€]{0,10}([0-9][0-9\s]{2,6})\s*€?\s*\/?\s*mois/i, 100, 10000)
    }
  }

  data.superficie = extractMontant(clean, /([0-9]{2,3})\s*m²?\s*(?:carrez|habitable|loi)/i, 10, 500)
    ?? extractMontant(clean, /superficie[^\d]{0,5}([0-9]{2,3})\s*m/i, 10, 500)
    ?? extractMontant(clean, /([0-9]{2,3})\s*m²/i, 10, 500)

  data.taxeFonciere = extractMontant(clean, /taxe\s*fonci[eè]re\s*(?:hors\s*TEOM)?[^\d€]{0,10}([0-9][0-9\s]{2,6})\s*€?/i, 100, 10000)
    ?? extractMontant(clean, /TF\s*(?:hors\s*TEOM)?[^\d€]{0,5}([0-9][0-9\s]{2,5})\s*€?/, 100, 10000)

  const chgMatch = clean.match(/charges\s*trimestrielles?[^\d€]{0,10}([0-9][0-9\s]{2,6})\s*€?/i)
    ?? clean.match(/charges\s*de\s*(?:copro|copropri[eé]t[eé])[^\d€]{0,10}([0-9][0-9\s]{2,6})\s*€?/i)
    ?? clean.match(/charges\s*(?:annuelles?|\/an)[^\d€]{0,10}([0-9][0-9\s]{2,6})\s*€?/i)
    ?? clean.match(/charges[^\d€]{0,10}([0-9][0-9\s]{2,6})\s*€?\s*\/\s*(?:an|trim|mois)/i)
  if (chgMatch) {
    let val = parseInt(chgMatch[1].replace(/\s/g, ""))
    if (/trim/i.test(chgMatch[0])) val = val * 4
    if (/mois/i.test(chgMatch[0])) val = val * 12
    if (val >= 100 && val <= 15000) data.chargesCopro = val
  }

  const villeCP = clean.match(/([A-ZÀ-Ü][a-zà-ü]+(?:[\s\-][A-ZÀ-Ü][a-zà-ü]+)*)\s*\((\d{5})\)/i)
  if (villeCP) {
    data.ville = villeCP[1].trim()
    data.codePostal = villeCP[2]
  } else {
    const villeSitue = clean.match(/situ[eé][^\w]{0,5}(?:à|a|au|en)\s+([A-ZÀ-Ü][a-zà-ü]+(?:[\s\-][A-ZÀ-Ü][a-zà-ü]+)*)/i)
    if (villeSitue) data.ville = villeSitue[1].trim()
  }

  const keysTerme = ["bouquet", "mensualite", "termeMois"]
  const keysViager = ["bouquet", "rente", "superficie", "occupant1Age", "valeurVenale"]
  const keys = data.typeVente === "terme" ? keysTerme : keysViager
  const filled = keys.filter(k => data[k] != null).length
  data.confidence = filled / keys.length

  return { data, confidence: data.confidence }
}

async function scrapeWithFirecrawl(url: string) {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY manquante")
  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, waitFor: 3000 }),
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
  if (!rateLimit(ip)) return NextResponse.json({ error: "Trop de requêtes" }, { status: 429 })

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
        data: { source, url, confidence: 0, data: {}, error: "Page vide — saisie manuelle" }
      })
    }

    const { data, confidence } = extractViagerData(markdown)

    if (confidence > 0.2) {
      try {
        const origin = req.headers.get("host") || ""
        const protocol = origin.includes("localhost") ? "http" : "https"
        await fetch(`${protocol}://${origin}/api/listings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, source, data, confidence }),
        })
      } catch { }
    }

    return NextResponse.json({ success: true, data: { source, url, confidence, data } })

  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Erreur interne" }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ message: "POST /api/import avec { url: '...' }" })
}
