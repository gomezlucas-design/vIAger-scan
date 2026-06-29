import { NextRequest, NextResponse } from "next/server"

const REGIONS_CP = new Set([
  "75","77","78","91","92","93","94","95", // IDF
  "02","59","60","62","80",                // HDF
  "04","05","06","13","83","84",           // PACA
  "09","11","12","30","31","32","34","46","48","65","66","81","82", // Occitanie
  "14","27","50","61","76",               // Normandie
])

async function getReneeCostesURLs(): Promise<string[]> {
  const res = await fetch("https://www.costes-viager.com/sitemap.xml", {
    headers: { "User-Agent": "Mozilla/5.0" }
  })
  if (!res.ok) return []
  const xml = await res.text()
  
  const urls = xml.match(/https:\/\/www\.costes-viager\.com\/acheter\/[^\s<"]+/g) || []
  
  return urls.filter(url => {
    // Garder uniquement les annonces individuelles (pas les pages de listing)
    const parts = url.split("/")
    if (parts.length < 6) return false
    // Extraire le département depuis l'URL: /acheter/paris-75/...
    const deptMatch = url.match(/\/acheter\/[^/]+-(\d{2,3})\//)
    if (!deptMatch) return true // garder si pas de dept dans URL
    const cp = deptMatch[1].slice(0, 2)
    return REGIONS_CP.has(cp)
  })
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const limit = parseInt(searchParams.get("limit") || "50")
  const origin = req.headers.get("host") || ""
  const protocol = origin.includes("localhost") ? "http" : "https"

  try {
    // 1. Récupérer les URLs depuis le sitemap
    const allUrls = await getReneeCostesURLs()
    
    // 2. Récupérer les URLs déjà en base pour éviter doublons
    const existingRes = await fetch(`${protocol}://${origin}/api/listings?limit=500`)
    const existingJson = await existingRes.json()
    const existingUrls = new Set((existingJson.listings || []).map((l: any) => l.url))
    
    // 3. Nouvelles URLs seulement
    const newUrls = allUrls.filter(u => !existingUrls.has(u)).slice(0, limit)
    
    if (newUrls.length === 0) {
      return NextResponse.json({
        success: true,
        message: "Aucune nouvelle annonce",
        total: allUrls.length,
        new: 0,
      })
    }

    // 4. Importer chaque URL (avec Firecrawl pour extraire les données)
    let imported = 0
    const errors: string[] = []

    for (const url of newUrls) {
      try {
        const r = await fetch(`${protocol}://${origin}/api/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        })
        if (r.ok) imported++
      } catch (e: any) {
        errors.push(url)
      }
    }

    return NextResponse.json({
      success: true,
      total: allUrls.length,
      new: newUrls.length,
      imported,
      errors: errors.length,
    })

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
