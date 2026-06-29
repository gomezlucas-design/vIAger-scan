import { NextResponse } from "next/server"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()

export async function GET() {
  try {
    // Supprimer les annonces hors critères
    const deleted = await prisma.listing.deleteMany({
      where: {
        OR: [
          // Bouquet > 80 000€
          { bouquet: { gt: 80000 } },
          // Rente > 600€/mois
          { rente: { gt: 600 } },
          // TF > 1500€/an
          { taxeFonciere: { gt: 1500 } },
          // Charges > 1600€/an
          { chargesCopro: { gt: 1600 } },
          // Ratio aberrant > 3
          { ratio: { gt: 3 } },
          // Âge aberrant
          { occupant1Age: { lt: 50 } },
        ]
      }
    })

    const remaining = await prisma.listing.count()

    return NextResponse.json({
      success: true,
      deleted: deleted.count,
      remaining,
      message: `${deleted.count} annonces hors critères supprimées, ${remaining} restantes`
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
}
