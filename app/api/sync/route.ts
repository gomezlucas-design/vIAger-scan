import { NextRequest, NextResponse } from "next/server"

const REGIONS_CP = new Set([
 "75","77","78","91","92","93","94","95",
 "02","59","60","62","80",
 "04","05","06","13","83","84",
 "09","11","12","30","31","32","34","46","48","65","66","81","82",
 "14","27","50","61","76",
])

const SITEMAPS = [
 {
   url: "https://www.costes-viager.com/sitemap.xml",
   name: "Renée Costes",
   pattern: /https:\/\/www\.costes-viager\.com\/acheter\/[^\s<"]+/g,
 },
 {
   url: "https://www.univers-viager.fr/sitemap.xml",
   name: "Univers Viager",
   pattern: /https:\/\/www\.univers-viager\.fr\/bien\/[^\s<"]+/g,
 },
]

const LEBONCOIN_PAGES = [
 "https://www.leboncoin.fr/boutique/107418/serenite_viager_specialiste_nue_propriete_viager.htm",
 "https://www.leboncoin.fr/recherche?category=9&real_estate_type=2&owner_type=pro&project_types=life_annuity&locations=r_11",
 "https://www.leboncoin.fr/recherche?category=9&real_estate_type=2&owner_type=pro&project_types=life_annuity&locations=r_93",
]

function isZoneAutorisee(url: string): boolean {
 const deptMatch = url.match(/[-/](\d{2,3})[/-_]/)
 if (!deptMatch) return true
 return REGIONS_CP.has(deptMatch[1].slice(0, 2))
}

async function fetchSitemap(sitemapUrl: string, pattern: RegExp): Promise<string[]> {
 try {
   const res = await fetch(sitemapUrl, {
     headers: { "User-Agent": "Mozilla/5.0" },
   })
   if (!res.ok) return []
   const xml = await res.text()
   const matches: string[] = xml.match(pattern) || []
   return Array.from(new Set(matches)).filter(u => {
     if (u.includes("?")) return false
     if (u.split("/").length < 5) return false
     return true
   })
 } catch {
   return []
 }
}

async function scrapePageForURLs(pageUrl: string, apiKey: string): Promise<string[]> {
 try {
   const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
     method: "POST",
     headers: {
       "Content-Type": "application/json",
       "Authorization": `Bearer ${apiKey}`,
     },
     body: JSON.stringify({
       url: pageUrl,
       formats: ["markdown"],
       onlyMainContent: true,
       waitFor: 3000,
     }),
   })
   if (!res.ok) return []
   const json = await res.json()
   const markdown: string = json.data?.markdown || json.markdown || ""
   const urlMatches: string[] = markdown.match(
     /https?:\/\/(?:www\.)?(?:leboncoin\.fr\/ventes_immobilieres|costes-viager\.com\/acheter|univers-viager\.fr\/bien)\/[^\s"'<>)]+/g
   ) || []
   return Array.from(
     new Set(urlMatches.map(u => u.replace(/[,.)>]+$/, "").trim()))
   ).filter(u => u.length > 30)
 } catch {
   return []
 }
}

export async function GET(req: NextRequest) {
 const { searchParams } = new URL(req.url)
 const limit = parseInt(searchParams.get("limit") || "50")
 const origin = req.headers.get("host") || ""
 const protocol = origin.includes("localhost") ? "http" : "https"
 const apiKey = process.env.FIRECRAWL_API_KEY || ""

 try {
   const existingRes = await fetch(`${protocol}://${origin}/api/listings?limit=500`)
   const existingJson = await existingRes.json()
   const existingUrls = new Set((existingJson.listings || []).map((l: any) => l.url as string))

   let allUrls: string[] = []

   for (const sitemap of SITEMAPS) {
     const urls = await fetchSitemap(sitemap.url, sitemap.pattern)
     allUrls = allUrls.concat(urls.filter(u => isZoneAutorisee(u)))
   }

   if (apiKey) {
     for (const page of LEBONCOIN_PAGES.slice(0, 2)) {
       const urls = await scrapePageForURLs(page, apiKey)
       allUrls = allUrls.concat(urls)
     }
   }

   const uniqueNew = Array.from(new Set(allUrls)).filter(u => !existingUrls.has(u))

   if (uniqueNew.length === 0) {
     return NextResponse.json({
       success: true,
       message: "Aucune nouvelle annonce trouvée",
       checked: allUrls.length,
       new: 0,
     })
   }

   let imported = 0
   let rejected = 0
   const reasons: Record<string, number> = {}

   for (const url of uniqueNew.slice(0, limit)) {
     try {
       const r = await fetch(`${protocol}://${origin}/api/import`, {
         method: "POST",
         headers: { "Content-Type": "application/json" },
         body: JSON.stringify({ url }),
       })
       const json = await r.json()
       if (json.data?.rejected) {
         rejected++
         const reason: string = json.data.rejected
         reasons[reason] = (reasons[reason] || 0) + 1
       } else if (r.ok) {
         imported++
       }
     } catch { }
   }

   return NextResponse.json({
     success: true,
     sources: SITEMAPS.map(s => s.name).concat(["LeBonCoin"]),
     checked: allUrls.length,
     new: uniqueNew.length,
     imported,
     rejected,
     rejectedReasons: reasons,
   })

 } catch (e: any) {
   return NextResponse.json({ error: e.message }, { status: 500 })
 }
}
