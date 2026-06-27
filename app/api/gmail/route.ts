import { NextRequest, NextResponse } from "next/server"

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

async function getAccessToken(): Promise<string> {
  const clientId = process.env.GMAIL_CLIENT_ID
  const clientSecret = process.env.GMAIL_CLIENT_SECRET
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Variables GMAIL_* manquantes")
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

  const data = await res.json()
  if (!data.access_token) throw new Error("Token Gmail invalide")
  return data.access_token
}

async function listEmails(token: string) {
  const query = encodeURIComponent(
    "from:(alerte@seloger.com OR noreply@costes-viager.com) is:unread"
  )
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${query}&maxResults=20`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const data = await res.json()
  return data.messages || []
}

function parseEmailListings(html: string): EmailListing[] {
  const listings: EmailListing[] = []
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")

  const urlMatches = Array.from(
    html.matchAll(/href="(https?:\/\/www\.seloger\.com\/annonces\/[^"]+)"/gi)
  )
  const urlList = urlMatches.map((m) => m[1])

  const bouquetMatches = Array.from(
    text.matchAll(/bouquet\s*:?\s*(\d[\d\s]{2,8})\s*€/gi)
  )

  bouquetMatches.forEach((match, i) => {
    const bouquet = parseInt(match[1].replace(/\s/g, ""))
    if (bouquet > 80000) return

    const afterBouquet = text.slice(text.indexOf(match[0]))
    const renteM = afterBouquet.match(
      /rente\s*:?\s*(\d[\d\s]{2,5})\s*€\s*\/\s*mois/i
    )
    const surfM = afterBouquet.match(/(\d{2,3})\s*m²/i)
    const villeM = afterBouquet.match(
      /([A-ZÀ-Ü][a-zà-ü]+(?:\s+[A-ZÀ-Ü][a-zà-ü]*)*)\s*\(\d{5}\)/i
    )

    listings.push({
      title: villeM ? `Viager ${villeM[1]}` : `Annonce viager #${i + 1}`,
      url: urlList[i] || "",
      bouquet,
      rente: renteM ? parseInt(renteM[1].replace(/\s/g, "")) : undefined,
      superficie: surfM ? parseInt(surfM[1]) : undefined,
      ville: villeM?.[1],
      source: "SeLoger (email)",
    })
  })

  if (listings.length === 0) {
    urlList.slice(0, 5).forEach((url) => {
      listings.push({ title: "Annonce SeLoger", url, source: "SeLoger (email)" })
    })
  }

  return listings
}

async function parseEmail(
  messageId: string,
  token: string
): Promise<ParsedEmail | null> {
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const msg = await res.json()

  const headers = msg.payload?.headers || []
  const subject =
    headers.find((h: any) => h.name === "Subject")?.value || ""
  const date =
    headers.find((h: any) => h.name === "Date")?.value || ""

  let htmlBody = ""
  const parts = msg.payload?.parts || [msg.payload]
  for (const part of parts) {
    if (part?.mimeType === "text/html" && part?.body?.data) {
      htmlBody = Buffer.from(part.body.data, "base64").toString("utf8")
      break
    }
    for (const subpart of part?.parts || []) {
      if (subpart?.mimeType === "text/html" && subpart?.body?.data) {
        htmlBody = Buffer.from(subpart.body.data, "base64").toString("utf8")
        break
      }
    }
  }

  if (!htmlBody) return null

  const listings = parseEmailListings(htmlBody)

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

export async function GET(req: NextRequest) {
  if (!process.env.GMAIL_CLIENT_ID) {
    return NextResponse.json({
      success: false,
      configured: false,
      message:
        "Gmail API non configurée. Ajoute GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET et GMAIL_REFRESH_TOKEN dans Vercel.",
    })
  }

  try {
    const token = await getAccessToken()
    const messages = await listEmails(token)

    if (messages.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        message: "Aucun nouvel email d'alerte.",
        emails: [],
      })
    }

    const emailsData = await Promise.allSettled(
      messages.slice(0, 10).map((m: any) => parseEmail(m.id, token))
    )

    const emails = emailsData
      .filter((r) => r.status === "fulfilled" && r.value)
      .map((r) => (r as PromiseFulfilledResult<ParsedEmail>).value)

    const allListings = emails.flatMap((e) => e!.listings)

    return NextResponse.json({
      success: true,
      count: allListings.length,
      emailsProcessed: emails.length,
      lastCheck: new Date().toISOString(),
      listings: allListings,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
