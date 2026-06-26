import { NextRequest, NextResponse } from "next/server"
import { parseURL } from "@/app/lib/importService"

// Rate limiting simple en mémoire
const requests = new Map<string, number[]>()

function rateLimit(ip: string): boolean {
  const now = Date.now()
  const prev = (requests.get(ip) || []).filter(t => now - t < 60000)
  if (prev.length >= 15) return false
  requests.set(ip, [...prev, now])
  return true
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") || "unknown"

  if (!rateLimit(ip)) {
    return NextResponse.json({ error: "Trop de requêtes, réessaie dans 1 minute" }, { status: 429 })
  }

  let url: string
  try {
    const body = await req.json()
    url = body.url
    if (!url || typeof url !== "string") throw new Error("URL manquante")
    new URL(url) // valide que c'est une URL
  } catch {
    return NextResponse.json({ error: "URL invalide" }, { status: 400 })
  }

  try {
    const result = await parseURL(url)
    return NextResponse.json({ success: true, data: result })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Erreur interne" }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ message: "Utilise POST /api/import avec { url: '...' }" })
}
