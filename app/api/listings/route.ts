import { NextRequest, NextResponse } from "next/server"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

// GET — récupérer toutes les annonces
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const limit = parseInt(searchParams.get("limit") || "100")
    const source = searchParams.get("source")

    const listings = await prisma.listing.findMany({
      where: source ? { source } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
    })

    return NextResponse.json({
      success: true,
      count: listings.length,
      listings,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}

// POST — sauvegarder une annonce
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { url, source, data, confidence } = body

    if (!url) {
      return NextResponse.json({ error: "URL manquante" }, { status: 400 })
    }

    // Vérifier doublon
    const existing = await prisma.listing.findUnique({ where: { url } })
    if (existing) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        message: "Annonce déjà en base",
        listing: existing,
      })
    }

    // Calculer ratio si valeur vénale disponible
    const bouquet = data?.bouquet || 0
    const rente = data?.rente || 0
    const valeurVenale = data?.valeurVenale || 0
    const taxeFonciere = data?.taxeFonciere || 400
    const chargesCopro = data?.chargesCopro || 800
    const age = data?.occupant1Age || 78
    const sexe = data?.occupant1Sexe || "F"

    // INSEE simplifié
    const inseeF: any = {78:11.9,79:11.2,80:10.5,81:9.9,82:9.3,83:8.7,84:8.1,85:7.6,86:7.1,87:6.6,88:6.1,89:5.7,90:5.3,74:14.9,75:14.1,76:13.3,77:12.6,70:18.2,71:17.4,72:16.5,73:15.7,65:22.7,66:21.8,67:20.9,68:20.0,69:19.1,60:27.4,61:26.4,62:25.5,63:24.6,64:23.6}
    const duree = inseeF[Math.min(Math.max(age, 60), 90)] || 12

    // Prix de revient simplifié
    const inf = 0.03
    let totalRentes = 0, totalTF = 0, totalCharges = 0
    for (let y = 1; y <= Math.ceil(duree); y++) {
      const frac = y <= duree ? 1 : duree - Math.floor(duree)
      totalRentes += rente * 12 * Math.pow(1 + inf, y - 1) * frac
      totalTF += taxeFonciere * Math.pow(1.04, y - 1) * frac
      totalCharges += chargesCopro * 0.33 * Math.pow(1 + inf, y - 1) * frac
    }
    const prixRevient = bouquet + totalRentes + totalTF + totalCharges
    const ratio = valeurVenale > 0 ? prixRevient / valeurVenale : null

    // Sauvegarder
    const listing = await prisma.listing.create({
      data: {
        source: source || "Inconnu",
        url,
        ville: data?.ville,
        superficie: data?.superficie,
        bouquet: data?.bouquet,
        rente: data?.rente,
        occupant1Age: data?.occupant1Age,
        occupant1Sexe: data?.occupant1Sexe,
        valeurVenale: data?.valeurVenale,
        taxeFonciere: data?.taxeFonciere,
        chargesCopro: data?.chargesCopro,
        agence: data?.agence,
        datePublication: data?.datePublication,
        confidence: confidence || 0,
        ratio,
      },
    })

    return NextResponse.json({
      success: true,
      duplicate: false,
      listing,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
