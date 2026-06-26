import axios from "axios"
import * as cheerio from "cheerio"

export interface ParsedListing {
  source: string
  url: string
  confidence: number
  data: {
    ville?: string
    superficie?: number
    bouquet?: number
    rente?: number
    occupant1Age?: number
    occupant1Sexe?: string
    valeurVenale?: number
    taxeFonciere?: number
    chargesCopro?: number
    agence?: string
    datePublication?: string
  }
  error?: string
}

const http = axios.create({
  timeout: 12000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
  }
})

function extractNumber(text: string, regex: RegExp): number | undefined {
  const m = text.match(regex)
  if (!m?.[1]) return undefined
  return parseInt(m[1].replace(/\s/g, "")) || undefined
}

function confidence(data: ParsedListing["data"]): number {
  const keys = ["ville", "superficie", "bouquet", "rente", "valeurVenale", "occupant1Age"]
  return keys.filter(k => data[k as keyof typeof data] != null).length / keys.length
}

async function parseSeLoger(url: string): Promise<ParsedListing> {
  const res: ParsedListing = { source: "SeLoger", url, confidence: 0, data: {} }
  try {
    const r = await http.get(url)
    const $ = cheerio.load(r.data)
    const text = $("body").text()

    res.data.bouquet = extractNumber(text, /bouquet[^\d]*(\d[\d\s]*)/i)
    res.data.rente = extractNumber(text, /rente[^\d]*(\d[\d\s]*)\s*€?\s*\/?\s*mois/i)
    res.data.valeurVenale = extractNumber(text, /valeur[^\d]*v[eé]nale[^\d]*(\d[\d\s]*)/i)
    res.data.superficie = extractNumber(text, /(\d+)\s*m²/i)

    const ageMatch = text.match(/(?:dame|femme|homme|monsieur)\s+d[ée]\s*(\d+)\s*ans/i)
    if (ageMatch) {
      res.data.occupant1Age = parseInt(ageMatch[1])
      res.data.occupant1Sexe = /dame|femme/i.test(ageMatch[0]) ? "F" : "H"
    }

    const locMatch = url.match(/\/(paris|marseille|lyon|nice|toulouse|bordeaux|toulon)[-\d]*/i)
    if (locMatch) {
      res.data.ville = locMatch[1].charAt(0).toUpperCase() + locMatch[1].slice(1)
    }
    const arrMatch = url.match(/paris-(\d+)eme/i)
    if (arrMatch) res.data.ville = `Paris ${parseInt(arrMatch[1])}`

    res.data.agence = $("[class*=agency] span, [class*=agence]").first().text().trim() || undefined
    res.confidence = confidence(res.data)
  } catch (e: any) {
    res.error = e.message
  }
  return res
}

async function parseReneeCostes(url: string): Promise<ParsedListing> {
  const res: ParsedListing = { source: "Renée Costes", url, confidence: 0, data: {} }
  try {
    const r = await http.get(url)
    const $ = cheerio.load(r.data)
    const text = $("body").text()

    res.data.bouquet = extractNumber(text, /bouquet[^\d]*(\d[\d\s]*)/i)
    res.data.rente = extractNumber(text, /rente[^\d]*(\d[\d\s]*)/i)
    res.data.valeurVenale = extractNumber(text, /valeur[^\d]*(\d[\d\s]*)/i)
    res.data.superficie = extractNumber(text, /(\d+)\s*m²/i)
    res.data.agence = "Renée Costes"

    const locMatch = $("h1, title").text().match(/(\w+(?:\s\w+)?)\s*\(\d{5}\)/)
    if (locMatch) res.data.ville = locMatch[1]

    res.confidence = confidence(res.data)
  } catch (e: any) {
    res.error = e.message
  }
  return res
}

async function parseLeBonCoin(url: string): Promise<ParsedListing> {
  const res: ParsedListing = { source: "LeBonCoin", url, confidence: 0, data: {} }
  try {
    const r = await http.get(url)
    const $ = cheerio.load(r.data)
    const text = $("body").text()

    res.data.bouquet = extractNumber(text, /(\d[\d\s]*)\s*€/)
    res.data.superficie = extractNumber(text, /(\d+)\s*m²/i)

    const locMatch = $("h1").text().match(/à\s+(.+?)(?:\s*\(|$)/)
    if (locMatch) res.data.ville = locMatch[1].trim()

    res.confidence = confidence(res.data)
  } catch (e: any) {
    res.error = e.message
  }
  return res
}

export async function parseURL(url: string): Promise<ParsedListing> {
  const hostname = new URL(url).hostname.toLowerCase()

  if (hostname.includes("seloger.com")) return parseSeLoger(url)
  if (hostname.includes("costes-viager.com")) return parseReneeCostes(url)
  if (hostname.includes("leboncoin.fr")) return parseLeBonCoin(url)

  return {
    source: "inconnu",
    url,
    confidence: 0,
    data: {},
    error: "Site non supporté. Sites acceptés: SeLoger, Renée Costes, LeBonCoin"
  }
}
