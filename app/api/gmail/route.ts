import { NextRequest, NextResponse } from "next/server"

// ─── Gmail API — parse les alertes SeLoger reçues par email ───────────────
//
// Setup côté utilisateur:
// 1. Créer une alerte SeLoger: seloger.com → Sauvegarder la recherche → Email
// 2. Créer un compte Google Cloud: console.cloud.google.com
// 3. Activer Gmail API
// 4. Créer OAuth2 credentials → copier CLIENT_ID, CLIENT_SECRET
// 5. Obtenir REFRESH_TOKEN via OAuth2 playground
// 6. Ajouter dans Vercel env: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
//
// Les variables d'environnement nécessaires:
// GMAIL_CLIENT_ID=xxx.apps.googleusercontent.com
// GMAIL_CLIENT_SECRET=GOCSPX-xxx
// GMAIL_REFRESH_TOKEN=1//xxx

interface GmailToken {
  access_token: string
  expires_in: number
}

interface ParsedEmail {
  messageId: string
  subject: string
  date: string
  listings: EmailListing[]
}

interface EmailListing {
  title: string
  url: string
  bouquet?: number
  rente?: number
  superficie?: number
  ville?: string
  source: string
}

// ─── Obtenir un access token Google ──────────────────────────────────────
async function getAccessToken(): Promise<string> {
  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Variables GMAIL_* manquantes dans Vercel env")
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  })

  const data: GmailToken = await res.json()
  if (!data.access_token) throw new Error("Impossible d'obtenir le token Gmail")
  return data.access_token
}

// ─── Lister les emails SeLoger non lus ───────────────────────────────────
async function listSeLogerEmails(token: string, maxResults = 20) {
  // Recherche les emails d'alerte SeLoger et Renée Costes
  const query = encodeURIComponent(
    'from:(alerte@seloger.com OR noreply@costes-viager.com OR alerte@leboncoin.fr) is:unread subject:(viager OR alerte)'
  )

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=${maxResults}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  const data = await res.json()
  return data.messages || []
}

// ─── Lire un email et extraire les annonces ───────────────────────────────
async function parseEmail(messageId: string, token: string): Promise<ParsedEmail | null> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  const msg = await res.json()

  // Extraire subject et date
  const headers = msg.payload?.headers || []
  const subject = headers.find((h: any) => h.name === "Subject")?.value || ""
  const date = headers.find((h: any) => h.name === "Date")?.value || ""

  // Extraire le body HTML
  let htmlBody = ""
  const parts = msg.payload?.parts || [msg.payload]
  for (const part of parts) {
    if (part?.mimeType === "text/html" && part?.body?.data) {
      htmlBody = Buffer.from(part.body.data, "base64").toString("utf8")
      break
    }
    // Chercher dans les nested parts
    for (const subpart of part?.parts || []) {
      if (subpart?.mimeType === "text/html" && subpart?.body?.data) {
        htmlBody = Buffer.from(subpart.body.data, "base64").toString("utf8")
        break
      }
    }
  }

  if (!htmlBody) return null

  // Parser les annonces dans l'HTML de l'email
  const listings = parseEmailListings(htmlBody)

  // Marquer comme lu
  await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
    }
  )

  return { messageId, subject, date, listings }
}

// ─── Parser les annonces dans le HTML d'un email SeLoger ─────────────────
function parseEmailListings(html: string): EmailListing[] {
  const listings: EmailListing[] = []

  // Nettoyer l'HTML
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")

  // SeLoger: cherche les blocs d'annonces avec prix
  // Pattern typique: "Bouquet : 66 900 € Rente : 827 €/mois"
  const bouquetMatches = text.matchAll(/bouquet\s*:?\s*(\d[\d\s]{2,8})\s*€/gi)
  const urls = html.matchAll(/href="(https?:\/\/www\.seloger\.com\/annonces\/[^"]+)"/gi)

  const urlList = [...urls].map(m => m[1])

  let i = 0
  for (const match of bouquetMatches) {
    const bouquet = parseInt(match[1].replace(/\s/g, ""))
    if (bouquet > 200000) continue // Filtre basique

    // Cherche rente après le bouquet
    const afterBouquet = text.slice(text.indexOf(match[0]))
    const renteM = afterBouquet.match(/rente\s*:?\s*(\d[\d\s]{2,5})\s*€\s*\/\s*mois/i)
    const surfM = afterBouquet.match(/(\d{2,3})\s*m²/i)
    const villeM = afterBouquet.match(/([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]*)*)\s*\(\d{5}\)/i)
    const ageM = afterBouquet.match(/(\d{2})\s*ans?\s*(?:dame|femme|homme|F|H)/i)

    listings.push({
      title: villeM ? `Viager ${villeM[1]}` : `Annonce viager #${i + 1}`,
      url: urlList[i] || "",
      bouquet,
      rente: renteM ? parseInt(renteM[1].replace(/\s/g, "")) : undefined,
      superficie: surfM ? parseInt(surfM[1]) : undefined,
      ville: villeM?.[1],
      source: "SeLoger (email)",
    })
    i++
  }

  // Fallback: extraire tous les liens SeLoger annonces
  if (listings.length === 0) {
    for (const url of urlList.slice(0, 10)) {
      listings.push({
        title: "Annonce SeLoger",
        url,
        source: "SeLoger (email)",
      })
    }
  }

  return listings
}

// ─── GET /api/gmail ───────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // Vérifier que les credentials existent
  if (!process.env.GMAIL_CLIENT_ID) {
    return NextResponse.json({
      success: false,
      configured: false,
      message: "Gmail API non configurée. Ajoute GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET et GMAIL_REFRESH_TOKEN dans Vercel.",
      setupGuide: "https://developers.google.com/gmail/api/quickstart/nodejs",
    })
  }

  try {
    const token = await getAccessToken()
    const messages = await listSeLogerEmails(token)

    if (messages.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        message: "Aucun nouvel email d'alerte. Crée une alerte sur seloger.com pour ton critère viager.",
        emails: [],
      })
    }

    // Parser les emails en parallèle (max 5 à la fois)
    const emailsData = await Promise.allSettled(
      messages.slice(0, 10).map((m: any) => parseEmail(m.id, token))
    )

    const emails = emailsData
      .filter(r => r.status === "fulfilled" && r.value)
      .map(r => (r as PromiseFulfilledResult<ParsedEmail>).value)

    const allListings = emails.flatMap(e => e.listings)

    return NextResponse.json({
      success: true,
      count: allListings.length,
      emailsProcessed: emails.length,
      lastCheck: new Date().toISOString(),
      listings: allListings,
      emails: emails.map(e => ({
        subject: e.subject,
        date: e.date,
        listingsCount: e.listings.length,
      })),
    })

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
