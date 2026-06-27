  // ─── Vérification doublon via Neon ───────────────────────────────
  // (optionnel si pas encore connecté à la DB)
  // On utilise un cache en mémoire simple pour la session
  const { PrismaClient } = await import("@prisma/client")
  const prisma = new PrismaClient()

  try {
    const existing = await prisma.listing.findUnique({ where: { url } })
    if (existing) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        message: "Annonce déjà dans la base",
        data: existing,
      })
    }
  } catch {
    // Si DB pas connectée, on continue sans vérification doublon
  } finally {
    await prisma.$disconnect()
  }
