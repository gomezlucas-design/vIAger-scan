"use client";
import { useState, useMemo, useEffect } from "react";

// ─── DESIGN SYSTEM V4 — Clair & Premium ──────────────────────────────────
const C = {
  bg:       "#F7F6F3",   // Blanc cassé chaud
  surface:  "#FFFFFF",   // Blanc pur
  card:     "#FFFFFF",   // Cards blanches
  border:   "#E8E5E0",   // Bordure très légère
  border2:  "#D4D0C8",   // Bordure secondaire
  orange:   "#E85D26",   // Orange signature — chaleureux et lisible
  orange2:  "#F07840",   // Orange clair
  orangeD:  "#C44A1A",   // Orange foncé hover
  gold:     "#D4820A",   // Or sobre
  blue:     "#1A6EBD",   // Bleu professionnel
  green:    "#1A7A4A",   // Vert finance
  red:      "#C0392B",   // Rouge alerte
  yellow:   "#B8860B",   // Jaune doré sobre
  text:     "#1A1A1A",   // Noir doux
  text2:    "#5A5A5A",   // Gris moyen
  text3:    "#9A9A9A",   // Gris clair
  white:    "#FFFFFF",
  shadow:   "0 1px 3px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.06)",
  shadowHover: "0 4px 16px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08)",
};

const isMobile = () => typeof window !== "undefined" && window.innerWidth < 768;

// ─── INSEE ────────────────────────────────────────────────────────────────
const INSEE: any = {
  H:{60:23.5,61:22.6,62:21.7,63:20.8,64:19.9,65:19.1,66:18.3,67:17.5,68:16.7,69:15.9,70:15.2,71:14.5,72:13.8,73:13.1,74:12.4,75:11.8,76:11.2,77:10.6,78:10.0,79:9.4,80:8.9,81:8.4,82:7.9,83:7.4,84:6.9,85:6.5,86:6.1,87:5.7,88:5.3,89:4.9,90:4.6},
  F:{60:27.4,61:26.4,62:25.5,63:24.6,64:23.6,65:22.7,66:21.8,67:20.9,68:20.0,69:19.1,70:18.2,71:17.4,72:16.5,73:15.7,74:14.9,75:14.1,76:13.3,77:12.6,78:11.9,79:11.2,80:10.5,81:9.9,82:9.3,83:8.7,84:8.1,85:7.6,86:7.1,87:6.6,88:6.1,89:5.7,90:5.3},
};
const getEsp = (age: number, sex: string): number =>
  (INSEE[sex] || INSEE.F)[Math.min(Math.max(age, 60), 90)] ?? 10;

// ─── Loyer estimé ─────────────────────────────────────────────────────────
const ZONES: any[] = [
  [/paris\s*[12]/i,28],[/paris\s*[34]/i,27],[/paris\s*[56]/i,30],
  [/paris\s*[78]/i,29],[/paris\s*9(?!\d)/i,26],[/paris\s*1[0-9]/i,24],
  [/paris/i,25],[/neuilly|levallois/i,23],[/boulogne|issy|vanves/i,20],
  [/courbevoie|puteaux|montrouge|malakoff/i,18],[/marseille/i,13],
  [/lyon/i,16],[/nice|cannes|antibes/i,18],[/bordeaux/i,15],
  [/toulouse/i,13],[/aix/i,14],[/toulon/i,12],[/frejus/i,11],
  [/ciotat/i,12],[/cagnes/i,13],[/montpellier/i,13],
];
const loyerEst = (ville: string, surf: number) => {
  if (!ville || !surf) return 0;
  for (const [p, v] of ZONES) if (p.test(ville)) return Math.round(v * surf);
  return Math.round(10 * surf);
};

// ─── Finance ──────────────────────────────────────────────────────────────
function computeIRR(flows: number[], guess = 0.08): number {
  let rate = guess;
  for (let i = 0; i < 80; i++) {
    let npv = 0, deriv = 0;
    for (let t = 0; t < flows.length; t++) {
      npv += flows[t] / Math.pow(1 + rate, t);
      deriv += -t * flows[t] / Math.pow(1 + rate, t + 1);
    }
    if (Math.abs(deriv) < 1e-10) break;
    const next = rate - npv / deriv;
    if (Math.abs(next - rate) < 1e-7) return next;
    rate = next;
  }
  return rate;
}
const computeNPV = (flows: number[], r: number) =>
  flows.reduce((s, f, t) => s + f / Math.pow(1 + r, t), 0);

function computeViager(o: any, libAns: number | null = null) {
  const inf = o.tauxInflation || 0.03, tfTx = o.tauxCroissanceTF || 0.04;
  const ventil = o.ventilationCharges ?? 0.33;
  const chargesAnn = (o.chargesCopro || 0) + (o.autresCharges || 0);
  const tf = o.taxeFonciere || 0;

  // Type de vente : "occupe" | "libre" | "terme"
  const typeVente: string = o.typeVente || "occupe";
  const isTerme = typeVente === "terme";
  const isLibre = typeVente === "libre";

  // Durée
  let duree: number;
  if (isTerme) {
    duree = o.termeMois ? o.termeMois / 12 : (o.termeAns || 15);
  } else {
    const e1 = o.occupant1Age ? getEsp(o.occupant1Age, o.occupant1Sexe || "F") : 0;
    const e2 = o.occupant2Age ? getEsp(o.occupant2Age, o.occupant2Sexe || "F") : 0;
    duree = Math.max(e1, e2);
  }

  const libActive = !isTerme && libAns !== null && libAns > 0 && libAns < duree;
  const majRente = o.majorationRenteLiberation ?? 0.30;
  const loyer = (o.loyerMensuelManuel && o.loyerMensuelManuel > 0)
    ? o.loyerMensuelManuel : loyerEst(o.ville, o.superficie);
  const mensualite = o.rente || o.mensualite || 0;

  let rentes = 0, tfTot = 0, chg = 0, loyers = 0;
  const flows: number[] = [-(o.bouquet || 0)];

  for (let y = 1; y <= Math.ceil(duree); y++) {
    const frac = y <= duree ? 1 : duree - Math.floor(duree);
    if (frac <= 0) break;
    let fOcc = frac, fLib = 0;
    if (libActive) {
      if (y <= Math.floor(libAns!)) { fOcc = frac; fLib = 0; }
      else if (y === Math.ceil(libAns!) && !Number.isInteger(libAns)) {
        fOcc = libAns! - Math.floor(libAns!); fLib = frac - fOcc;
      } else { fOcc = 0; fLib = frac; }
    }

    if (isTerme) {
      // Vente à terme : mensualités fixes sans indexation
      const menY = mensualite * 12 * frac;
      rentes += menY;
      flows.push(-menY);
    } else if (isLibre) {
      // Viager libre : rente + TF + charges - loyer (cash flow positif possible)
      const renteY = mensualite * 12 * Math.pow(1 + inf, y - 1) * frac;
      const tfY = tf * 0.85 * Math.pow(1 + tfTx, y - 1) * frac;
      const chgY = chargesAnn * Math.pow(1 + inf, y - 1) * frac;
      const loyY = loyer * 12 * Math.pow(1 + inf, y - 1) * frac;
      rentes += renteY; tfTot += tfY; chg += chgY; loyers += loyY;
      flows.push(-renteY - tfY - chgY + loyY);
    } else {
      // Viager occupé
      const r0 = mensualite * 12 * Math.pow(1 + inf, y - 1);
      const renteY = r0 * fOcc + r0 * (1 + majRente) * fLib;
      const tfY = tf * Math.pow(1 + tfTx, y - 1) * frac
                + tf * 0.15 * Math.pow(1 + tfTx, y - 1) * fLib;
      const cY = chargesAnn * Math.pow(1 + inf, y - 1);
      const chgY = cY * ventil * fOcc + cY * fLib;
      const loyY = loyer * 12 * Math.pow(1 + inf, y - 1) * fLib;
      rentes += renteY; tfTot += tfY; chg += chgY; loyers += loyY;
      flows.push(-renteY - tfY - chgY + loyY);
    }
  }

  const prixBrut = (o.bouquet || 0) + rentes + tfTot + chg;
  const prixNet = prixBrut - loyers;
  const vv = o.valeurVenale || 0;
  if (vv > 0 && flows.length > 1) flows[flows.length - 1] += vv;

  // Coût mensuel net (hors bouquet)
  const tfNette = tf * 0.85;
  let coutMensuelOcc: number;
  if (isTerme) {
    coutMensuelOcc = mensualite; // mensualité tout compris
  } else if (isLibre) {
    coutMensuelOcc = mensualite + (tfNette + chargesAnn) / 12 - loyer;
  } else {
    coutMensuelOcc = mensualite + (tfNette + chargesAnn * ventil) / 12;
  }

  const dureeLibMois = libActive ? (duree - libAns!) * 12 : 0;
  const coutMensuelLib = dureeLibMois > 0
    ? (mensualite * (1 + majRente)) + (tf + chargesAnn) / 12 - loyer
    : null;
  const chargesMensuellesLib = (mensualite * (1 + majRente)) + (tf + chargesAnn) / 12;
  const equilibreAtteint = loyer >= chargesMensuellesLib;

  // Score négociabilité
  const pubDate = o.datePublication ? new Date(o.datePublication) : null;
  const ageJours = pubDate ? Math.floor((Date.now() - pubDate.getTime()) / 86400000) : 0;
  const hasPriceDrop = (o.priceHistory || []).length > 1 &&
    o.bouquet < (o.priceHistory || [])[0]?.bouquet;
  const ratioVal = vv > 0 ? prixNet / vv : null;
  let negoScore = 0;
  if (ageJours > 60) negoScore += 2;
  else if (ageJours > 30) negoScore += 1;
  if (hasPriceDrop) negoScore += 2;
  if (ratioVal && ratioVal > 0.85) negoScore += 1;
  const negoLabel = negoScore >= 4 ? "Très négociable" : negoScore >= 2 ? "Négociable" : "Standard";
  const negoColor = negoScore >= 4 ? C.green : negoScore >= 2 ? C.gold : C.text3;

  return {
    duree, typeVente, isTerme, isLibre, libActive,
    totalRentes: rentes, tfTotal: tfTot, chgTotal: chg, loyers,
    loyerMensuelEffectif: loyer, prixBrut, prixNet,
    ratio: vv > 0 ? prixNet / vv : null,
    decote: vv > 0 ? (vv - prixNet) / vv : null,
    anneesOcc: libActive ? libAns : duree,
    anneesLib: libActive ? duree - libAns! : 0,
    tri: computeIRR(flows) * 100,
    van: computeNPV(flows, 0.04),
    flows, coutMensuelOcc, coutMensuelLib, equilibreAtteint,
    chargesMensuellesLib, ageJours, hasPriceDrop, negoScore, negoLabel, negoColor,
  };
}

// ─── Import API ───────────────────────────────────────────────────────────
async function importFromAPI(url: string) {
  const res = await fetch("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const json = await res.json();
  if (!res.ok || !json.success) throw new Error(json.error || `Erreur ${res.status}`);
  return json.data;
}

// ─── Seed ─────────────────────────────────────────────────────────────────
const SEED: any[] = [
  { id: 1, source: "SeLoger", ville: "Paris 15 – Lourmel", typeVente: "occupe", superficie: 56, valeurVenale: 480000, bouquet: 249000, rente: 1377, occupant1Age: 81, occupant1Sexe: "H", taxeFonciere: 450, chargesCopro: 960, tauxInflation: 0.03, tauxCroissanceTF: 0.04, datePublication: "2026-04-01", url: "https://www.seloger.com/annonces/achat/appartement/paris-15eme-75/", note: "T2 56m² viager occupé", priceHistory: [{ date: "2026-04-01", bouquet: 265000, rente: 1400 }, { date: "2026-06-20", bouquet: 249000, rente: 1377 }] },
  { id: 2, source: "Renée Costes", ville: "Toulon", typeVente: "occupe", superficie: 51, valeurVenale: 145000, bouquet: 18500, rente: 435, occupant1Age: 74, occupant1Sexe: "F", taxeFonciere: 804, chargesCopro: 828, tauxInflation: 0.03, tauxCroissanceTF: 0.04, datePublication: "2025-12-01", url: "https://www.costes-viager.com/acheter/annonces", note: "Quartier des Lices", priceHistory: [{ date: "2025-12-01", bouquet: 20000, rente: 450 }, { date: "2026-02-15", bouquet: 18500, rente: 435 }] },
  { id: 3, source: "Renée Costes", ville: "Eu (Seine-Maritime)", typeVente: "terme", superficie: 95, valeurVenale: 303800, bouquet: 73800, mensualite: 1278, rente: 1278, termeMois: 180, loyerMensuelManuel: 1750, taxeFonciere: 0, chargesCopro: 0, tauxInflation: 0.03, tauxCroissanceTF: 0.04, datePublication: "2026-06-27", url: "https://www.costes-viager.com/acheter/seine-maritime-76", note: "Vente à terme libre — loyer garanti 1750€/m", priceHistory: [{ date: "2026-06-27", bouquet: 73800, rente: 1278 }] },
  { id: 4, source: "SeLoger", ville: "Compiègne", typeVente: "occupe", superficie: 75, valeurVenale: 245000, bouquet: 70825, rente: 402, occupant1Age: 76, occupant1Sexe: "H", taxeFonciere: 648, chargesCopro: 1680, tauxInflation: 0.03, tauxCroissanceTF: 0.04, datePublication: "2026-05-15", url: "https://www.seloger.com", note: "Ratio 60% — Excellent", priceHistory: [{ date: "2026-05-15", bouquet: 70825, rente: 402 }] },
];

// ─── Formatters ───────────────────────────────────────────────────────────
const fmt = (n: any) => n != null ? Math.round(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }) : "—";
const fmtPct = (n: any) => n != null ? (n * 100).toFixed(1) + "%" : "—";
const fmtYrs = (n: any) => n != null ? n.toFixed(1) + " ans" : "—";
const fmtTRI = (n: any) => (n != null && isFinite(n)) ? n.toFixed(2) + "%" : "—";
const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtAge = (days: number) => days === 0 ? "Auj." : days < 30 ? `${days}j` : days < 365 ? `${Math.floor(days / 30)}m` : `${Math.floor(days / 365)}a`;

const scoreColor = (r: any) => r === null ? C.text3 : r < 0.70 ? C.green : r < 0.85 ? C.gold : r < 1.0 ? C.red : "#7f1d1d";
const scoreLabel = (r: any) => r === null ? "N/A" : r < 0.70 ? "Excellent" : r < 0.85 ? "Intéressant" : r < 1.0 ? "Limite" : "Défavorable";

// ─── Components ───────────────────────────────────────────────────────────
function Badge({ children, color = C.text3, bg }: any) {
  return (
    <span style={{ background: bg || `${color}18`, color, border: `1px solid ${color}30`, borderRadius: 6, padding: "2px 8px", fontSize: 10, fontWeight: 700, letterSpacing: ".03em" }}>
      {children}
    </span>
  );
}

function KPI({ label, value, sub, color = C.text, size = 20 }: any) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 9, color: C.text3, textTransform: "uppercase", letterSpacing: ".08em" }}>{label}</div>
      <div style={{ fontSize: size, fontWeight: 800, color, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: C.text3 }}>{sub}</div>}
    </div>
  );
}

function ProgressBar({ value, max, color = C.orange }: any) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div style={{ background: C.border, borderRadius: 3, height: 3, overflow: "hidden" }}>
      <div style={{ background: color, width: `${pct}%`, height: "100%", borderRadius: 3, transition: "width .4s ease" }} />
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────
function DetailPanel({ offre, onClose }: { offre: any; onClose: () => void }) {
  const [tab, setTab] = useState("analyse");
  const [libEnabled, setLibEnabled] = useState(false);
  const e1 = offre.occupant1Age ? getEsp(offre.occupant1Age, offre.occupant1Sexe || "F") : 0;
  const e2 = offre.occupant2Age ? getEsp(offre.occupant2Age, offre.occupant2Sexe || "F") : 0;
  const dureeMax = Math.max(e1, e2);
  const [libAns, setLibAns] = useState(Math.round(dureeMax * 0.5));
  const [majorationPct, setMajorationPct] = useState(Math.round((offre.majorationRenteLiberation ?? 0.30) * 100));
  const [loyerScenario, setLoyerScenario] = useState<number | null>(null); // loyer personnalisé
  const [vvDecote, setVvDecote] = useState(0); // décote valeur vénale en %

  // Valeur vénale avec décote appliquée
  const vvAjustee = offre.valeurVenale ? Math.round(offre.valeurVenale * (1 - vvDecote / 100)) : offre.valeurVenale;
  const offreAjustee = { ...offre, valeurVenale: vvAjustee, loyerMensuelManuel: loyerScenario ?? offre.loyerMensuelManuel, majorationRenteLiberation: majorationPct / 100 };

  const resBase = useMemo(() => computeViager(offreAjustee), [offreAjustee]);
  const resLib = useMemo(() => libEnabled ? computeViager(offreAjustee, libAns) : null, [offreAjustee, libEnabled, libAns]);
  const res = resLib || resBase;
  const col = scoreColor(res.ratio);

  const TABS = [
    { id: "analyse", label: "Analyse" },
    { id: "cashflow", label: "Cash Flow" },
    { id: "liberation", label: "Libération" },
    { id: "historique", label: "Historique" },
    { id: "bien", label: "Bien" },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.92)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 300, padding: 0 }}
      onClick={onClose}>
      <div style={{ background: C.surface, borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 680, maxHeight: "92vh", overflowY: "auto", border: `1px solid ${C.border}`, borderBottom: "none" }}
        onClick={e => e.stopPropagation()}>

        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 0" }}>
          <div style={{ width: 36, height: 4, background: C.border2, borderRadius: 2 }} />
        </div>

        {/* Header */}
        <div style={{ padding: "16px 20px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>{offre.ville}</div>
                <Badge color={resBase.negoColor}>{resBase.negoLabel}</Badge>
                {resBase.hasPriceDrop && <Badge color={C.green}>↓ Prix baissé</Badge>}
              </div>
              <div style={{ fontSize: 11, color: C.text3 }}>
                {offre.superficie ? `${offre.superficie} m² · ` : ""}
                <span style={{ color: offre.source === "Renée Costes" ? C.gold : C.orange }}>{offre.source}</span>
                {" · Publié le "}{fmtDate(offre.datePublication)}
                {resBase.ageJours > 0 && <span style={{ color: C.text3 }}> ({fmtAge(resBase.ageJours)})</span>}
              </div>
            </div>
            <button onClick={onClose} style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text3, cursor: "pointer", fontSize: 16, borderRadius: 10, width: 32, height: 32, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>

          {/* Hero metric */}
          <div style={{ background: `${col}10`, border: `1px solid ${col}25`, borderRadius: 14, padding: "14px 18px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 10, color: C.text3, marginBottom: 4, textTransform: "uppercase", letterSpacing: ".08em" }}>Ratio Prix Revient / Valeur Vénale</div>
              <div style={{ fontSize: 38, fontWeight: 900, color: col, lineHeight: 1 }}>{fmtPct(res.ratio)}</div>
              <div style={{ fontSize: 11, color: col, fontWeight: 600, marginTop: 4 }}>{scoreLabel(res.ratio)} · {fmt(res.prixNet)} sur {fmtYrs(res.duree)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: C.text3, marginBottom: 4 }}>Décote</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: res.decote > 0 ? C.green : C.red }}>{fmtPct(res.decote)}</div>
              <div style={{ fontSize: 10, color: C.text3, marginTop: 4 }}>vs marché</div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, overflowX: "auto", borderBottom: `1px solid ${C.border}`, scrollbarWidth: "none" }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                style={{ background: "none", color: tab === t.id ? C.orange : C.text3, border: "none", borderBottom: tab === t.id ? `2px solid ${C.orange}` : "2px solid transparent", padding: "10px 16px", cursor: "pointer", fontSize: 12, fontWeight: tab === t.id ? 700 : 400, whiteSpace: "nowrap", marginBottom: -1 }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: 20 }}>

          {/* ── ANALYSE ── */}
          {tab === "analyse" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {[
                  { label: "Bouquet", value: fmt(offre.bouquet), sub: "Capital initial", color: C.text },
                  { label: "Rente", value: fmt(offre.rente) + "/m", sub: "Mensuelle indexée", color: C.text },
                  { label: "Durée", value: fmtYrs(res.duree), sub: "Espérance INSEE", color: C.yellow },
                  { label: "Valeur vénale", value: fmt(offre.valeurVenale), sub: "Prix marché", color: C.text },
                  { label: "Prix revient", value: fmt(res.prixNet), sub: "Total acquéreur", color: col },
                  { label: "Décote", value: fmtPct(res.decote), sub: "Économie vs marché", color: res.decote > 0 ? C.green : C.red },
                ].map(k => (
                  <div key={k.label} style={{ background: C.card, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 9, color: C.text3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 }}>{k.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: k.color }}>{k.value}</div>
                    <div style={{ fontSize: 9, color: C.text3, marginTop: 3 }}>{k.sub}</div>
                  </div>
                ))}
              </div>

              {/* Décomposition avec barres */}
              <div style={{ background: C.card, borderRadius: 12, padding: 16, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 14 }}>Décomposition du prix de revient</div>
                {[
                  ["Bouquet", offre.bouquet || 0, C.orange],
                  ["Rentes cumulées", res.totalRentes, C.blue],
                  ["Taxe foncière", res.tfTotal, C.yellow],
                  ["Charges", res.chgTotal, C.text3],
                ].map(([label, val, color]) => {
                  const pct = ((val as number) / (res.prixBrut || 1) * 100).toFixed(0);
                  return (
                    <div key={label as string} style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                        <span style={{ color: C.text2 }}>{label}</span>
                        <span style={{ color: C.text, fontWeight: 600 }}>{fmt(val as number)} <span style={{ color: C.text3, fontWeight: 400 }}>· {pct}%</span></span>
                      </div>
                      <ProgressBar value={val as number} max={res.prixBrut} color={color as string} />
                    </div>
                  );
                })}
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12, display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 800 }}>
                  <span style={{ color: C.text2 }}>Total</span>
                  <span style={{ color: col }}>{fmt(res.prixNet)}</span>
                </div>
              </div>

              {/* TRI/VAN en secondaire */}
              <div style={{ background: C.card, borderRadius: 10, padding: "12px 16px", border: `1px solid ${C.border}`, display: "flex", gap: 20 }}>
                <div>
                  <div style={{ fontSize: 9, color: C.text3, textTransform: "uppercase" }}>TRI</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.blue }}>{fmtTRI(res.tri)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: C.text3, textTransform: "uppercase" }}>VAN (4%)</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: res.van >= 0 ? C.green : C.red }}>{fmt(res.van)}</div>
                </div>
                <div style={{ fontSize: 10, color: C.text3, alignSelf: "center", flex: 1 }}>
                  Métriques secondaires · basées sur récupération du bien au terme
                </div>
              </div>
            </div>
          )}

          {/* ── CASH FLOW ── */}
          {tab === "cashflow" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {/* Coût mensuel occupé */}
              <div style={{ background: C.card, borderRadius: 12, padding: 18, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 14 }}>Charges courantes mensuelles</div>
                <div style={{ fontSize: 36, fontWeight: 900, color: C.red, marginBottom: 4 }}>
                  -{fmt(Math.round(resBase.coutMensuelOcc))}<span style={{ fontSize: 14, fontWeight: 400, color: C.text3 }}>/mois</span>
                </div>
                <div style={{ fontSize: 11, color: C.text3, marginBottom: 12 }}>Coût mensuel courant (rente + TF nette + charges)</div>
                <div style={{ background: `${C.orange}12`, border: `1px solid ${C.orange}25`, borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 10, color: C.text2, fontWeight: 600 }}>Bouquet — capital initial versé en une fois</div>
                    <div style={{ fontSize: 10, color: C.text3, marginTop: 2 }}>Non inclus dans le cash flow mensuel</div>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: C.orange }}>{fmt(offre.bouquet)}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    ["Rente mensuelle", offre.rente || 0],
                    ["TF nette/an (hors TEOM 15%)", Math.round((offre.taxeFonciere || 0) * 0.85)],
                    ["Charges copro/an (1/3)", Math.round((offre.chargesCopro || 0) * (offre.ventilationCharges || 0.33))],
                  ].map(([k, v]) => (
                    <div key={k as string} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "8px 12px", background: C.surface, borderRadius: 8 }}>
                      <span style={{ color: C.text2 }}>{k}</span>
                      <span style={{ color: C.red, fontWeight: 600 }}>{k === 'Rente mensuelle' ? '-' : ''}{fmt(v as number)}{k !== 'Rente mensuelle' ? '/an' : '/m'}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Libération */}
              <div style={{ background: C.card, borderRadius: 12, padding: 18, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}>Après libération anticipée</div>
                <div style={{ fontSize: 11, color: C.text3, marginBottom: 14 }}>Active l'onglet Libération pour paramétrer le scénario</div>
                {libEnabled && resLib ? (
                  <div>
                    <div style={{ fontSize: 32, fontWeight: 900, color: resLib.coutMensuelLib! < 0 ? C.green : C.red, marginBottom: 4 }}>
                      {resLib.coutMensuelLib! < 0 ? "+" : "-"}{fmt(Math.abs(Math.round(resLib.coutMensuelLib!)))}
                      <span style={{ fontSize: 14, fontWeight: 400, color: C.text3 }}>/mois</span>
                    </div>
                    <div style={{ fontSize: 11, color: C.text3, marginBottom: 14 }}>
                      {resLib.coutMensuelLib! < 0 ? "🟢 Cash flow positif — le loyer couvre les charges" : "🔴 Cash flow encore négatif"}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {[
                        ["Rente majorée (+30%)", -Math.round((offre.rente || 0) * 1.3), C.red],
                        ["TF + charges (100%)", -Math.round(((offre.taxeFonciere || 0) + (offre.chargesCopro || 0)) / 12), C.red],
                        ["Loyer perçu", Math.round(resLib.loyerMensuelEffectif), C.green],
                      ].map(([k, v, c]) => (
                        <div key={k as string} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "8px 12px", background: C.surface, borderRadius: 8 }}>
                          <span style={{ color: C.text2 }}>{k}</span>
                          <span style={{ color: c as string, fontWeight: 600 }}>{(v as number) > 0 ? "+" : ""}{fmt(v as number)}</span>
                        </div>
                      ))}
                    </div>
                    {resLib.equilibreAtteint && (
                      <div style={{ marginTop: 12, background: `${C.green}15`, border: `1px solid ${C.green}30`, borderRadius: 10, padding: "10px 14px", fontSize: 11, color: C.green }}>
                        ✅ Le loyer ({fmt(resLib.loyerMensuelEffectif)}/m) couvre les charges ({fmt(Math.round(resLib.chargesMensuellesLib))}/m) — cash flow positif dès la libération
                      </div>
                    )}
                  </div>
                ) : (
                  <button onClick={() => setTab("liberation")} style={{ background: `${C.orange}15`, border: `1px solid ${C.orange}30`, color: C.orange, borderRadius: 10, padding: "10px 16px", cursor: "pointer", fontSize: 12, fontWeight: 600, width: "100%" }}>
                    Simuler une libération anticipée →
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── LIBÉRATION ── */}
          {tab === "liberation" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

              {/* Scénarios valeur vénale */}
              <div style={{ background: C.card, borderRadius: 12, padding: 16, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4 }}>Décote valeur vénale</div>
                <div style={{ fontSize: 10, color: C.text3, marginBottom: 10 }}>Les agents surestiment souvent le bien — teste différents scénarios</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                  {[0, 2, 5, 7, 10, 12, 15].map(pct => (
                    <button key={pct} onClick={() => setVvDecote(pct)}
                      style={{ background: vvDecote === pct ? `${C.orange}15` : C.bg, color: vvDecote === pct ? C.orange : C.text3, border: `1px solid ${vvDecote === pct ? C.orange + "40" : C.border}`, borderRadius: 20, padding: "5px 12px", cursor: "pointer", fontSize: 11, fontWeight: vvDecote === pct ? 700 : 400 }}>
                      -{pct}%
                    </button>
                  ))}
                </div>
                {vvDecote > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    <div style={{ background: C.bg, borderRadius: 8, padding: "8px 10px", border: `1px solid ${C.border}` }}>
                      <div style={{ fontSize: 9, color: C.text3 }}>VV estimée</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.text3, textDecoration: "line-through" }}>{fmt(offre.valeurVenale)}</div>
                    </div>
                    <div style={{ background: C.bg, borderRadius: 8, padding: "8px 10px", border: `1px solid ${C.orange}40` }}>
                      <div style={{ fontSize: 9, color: C.text3 }}>VV ajustée -{vvDecote}%</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: C.orange }}>{fmt(vvAjustee)}</div>
                    </div>
                    <div style={{ background: C.bg, borderRadius: 8, padding: "8px 10px", border: `1px solid ${scoreColor(resBase.ratio)}40` }}>
                      <div style={{ fontSize: 9, color: C.text3 }}>Nouveau ratio</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: scoreColor(resBase.ratio) }}>{fmtPct(resBase.ratio)}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Loyer scenario */}
              <div style={{ background: C.card, borderRadius: 12, padding: 16, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 4 }}>Loyer mensuel — scénario</div>
                <div style={{ fontSize: 10, color: C.text3, marginBottom: 10 }}>Ajuste le loyer estimé pour sensibiliser le cash flow post-libération</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <input type="range" min={300} max={3000} step={50}
                    value={loyerScenario ?? (resBase.loyerMensuelEffectif || 800)}
                    onChange={e => setLoyerScenario(+e.target.value)}
                    style={{ flex: 1, accentColor: C.green }} />
                  <div style={{ background: C.bg, borderRadius: 10, padding: "8px 14px", border: `1px solid ${C.green}40`, minWidth: 80, textAlign: "center" }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: C.green }}>{fmt(loyerScenario ?? resBase.loyerMensuelEffectif)}</div>
                    <div style={{ fontSize: 9, color: C.text3 }}>/mois</div>
                  </div>
                </div>
                {loyerScenario && (
                  <button onClick={() => setLoyerScenario(null)} style={{ marginTop: 8, background: "none", border: "none", color: C.text3, fontSize: 11, cursor: "pointer" }}>
                    ↺ Revenir au loyer estimé ({fmt(resBase.loyerMensuelEffectif)}/m)
                  </button>
                )}
              </div>

              {/* Prix au m² vs marché */}
              {offre.superficie && offre.valeurVenale && (
                <div style={{ background: C.card, borderRadius: 12, padding: 16, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 10 }}>Prix au m² — analyse</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div style={{ background: C.bg, borderRadius: 8, padding: "10px 12px" }}>
                      <div style={{ fontSize: 9, color: C.text3 }}>VV estimée / m²</div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{Math.round(offre.valeurVenale / offre.superficie).toLocaleString("fr-FR")} €</div>
                    </div>
                    {vvDecote > 0 && (
                      <div style={{ background: C.bg, borderRadius: 8, padding: "10px 12px", border: `1px solid ${C.orange}40` }}>
                        <div style={{ fontSize: 9, color: C.text3 }}>VV ajustée -{vvDecote}% / m²</div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: C.orange }}>{Math.round(vvAjustee! / offre.superficie).toLocaleString("fr-FR")} €</div>
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: C.text3, marginTop: 10, padding: "8px 10px", background: C.bg, borderRadius: 8 }}>
                    💡 Compare sur <a href={`https://www.meilleursagents.com/prix-immobilier/${(offre.ville || "").toLowerCase().replace(/\s+/g, "-")}-${offre.codePostal || ""}/`} target="_blank" rel="noreferrer" style={{ color: C.blue }}>MeilleursAgents</a> ou <a href={`https://www.seloger.com/prix-de-l-immo/${(offre.ville || "").toLowerCase().replace(/\s+/g, "-")}.htm`} target="_blank" rel="noreferrer" style={{ color: C.blue }}>SeLoger prix</a>
                  </div>
                </div>
              )}

              <div style={{ background: C.card, borderRadius: 12, padding: 18, border: `1px solid ${C.border}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: libEnabled ? 18 : 0 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Libération anticipée</div>
                    <div style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>L'occupant libère le bien avant son décès</div>
                  </div>
                  <button onClick={() => setLibEnabled(p => !p)}
                    style={{ background: libEnabled ? C.orange : C.card, color: libEnabled ? C.white : C.text3, border: `1px solid ${libEnabled ? C.orange : C.border2}`, borderRadius: 20, padding: "7px 18px", cursor: "pointer", fontSize: 12, fontWeight: 700, transition: "all .2s" }}>
                    {libEnabled ? "✓ Activée" : "Activer"}
                  </button>
                </div>

                {libEnabled && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                      <div style={{ flex: 1 }}>
                        <input type="range" min={1} max={Math.max(1, Math.floor(dureeMax - 0.5))} step={0.5}
                          value={libAns} onChange={e => setLibAns(+e.target.value)}
                          style={{ width: "100%", accentColor: C.orange, height: 4 }} />
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: C.text3, marginTop: 4 }}>
                          <span>An 1</span><span>Esp. vie {fmtYrs(dureeMax)}</span>
                        </div>
                      </div>
                      <div style={{ background: C.surface, borderRadius: 12, padding: "10px 16px", textAlign: "center", minWidth: 72, border: `1px solid ${C.orange}40` }}>
                        <div style={{ fontSize: 24, fontWeight: 900, color: C.orange }}>{libAns}</div>
                        <div style={{ fontSize: 9, color: C.text3 }}>ans</div>
                      </div>
                    </div>

                    {/* Curseur majoration rente */}
                    <div style={{ background: C.surface, borderRadius: 10, padding: 14, border: `1px solid ${C.border}`, marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <div style={{ fontSize: 11, color: C.text2, fontWeight: 600 }}>Majoration rente au départ</div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: C.yellow }}>+{majorationPct}%</div>
                      </div>
                      <input type="range" min={25} max={50} step={1}
                        value={majorationPct} onChange={e => setMajorationPct(+e.target.value)}
                        style={{ width: "100%", accentColor: C.yellow }} />
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: C.text3, marginTop: 2 }}>
                        <span>25%</span><span>défaut 30%</span><span>50%</span>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8 }}>
                      {[
                        ["Charges", "100% acquéreur", C.yellow],
                        ["Loyer scénario", `${fmt(loyerScenario ?? (resLib?.loyerMensuelEffectif || 0))}/m`, C.green],
                      ].map(([k, v, c]) => (
                        <div key={k as string} style={{ background: C.surface, borderRadius: 8, padding: "10px 12px", border: `1px solid ${C.border}` }}>
                          <div style={{ fontSize: 9, color: C.text3, marginBottom: 3 }}>{k}</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: c as string }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Comparaison côte à côte */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {/* Occupé à vie */}
                <div style={{ background: C.card, borderRadius: 12, padding: 16, border: `1px solid ${scoreColor(resBase.ratio)}40` }}>
                  <div style={{ fontSize: 10, color: C.text3, marginBottom: 6, textTransform: "uppercase" }}>Occupé à vie</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: scoreColor(resBase.ratio) }}>{fmtPct(resBase.ratio)}</div>
                  <div style={{ fontSize: 10, color: C.text3, marginTop: 8 }}>Coût mensuel</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.red }}>-{fmt(Math.round(resBase.coutMensuelOcc))}/m</div>
                  <div style={{ fontSize: 10, color: C.blue, marginTop: 4 }}>TRI {fmtTRI(resBase.tri)}</div>
                </div>
                {/* Libéré */}
                <div style={{ background: C.card, borderRadius: 12, padding: 16, border: `1px solid ${resLib ? scoreColor(resLib.ratio) + "40" : C.border}`, opacity: resLib ? 1 : 0.4 }}>
                  <div style={{ fontSize: 10, color: C.orange, marginBottom: 6, textTransform: "uppercase" }}>
                    {libEnabled ? `Libéré an ${libAns}` : "Scénario libération"}
                  </div>
                  {resLib ? (
                    <>
                      <div style={{ fontSize: 22, fontWeight: 900, color: scoreColor(resLib.ratio) }}>{fmtPct(resLib.ratio)}</div>
                      <div style={{ fontSize: 10, color: C.text3, marginTop: 8 }}>Cash flow post-lib.</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: resLib.coutMensuelLib !== null && resLib.coutMensuelLib < 0 ? C.green : C.red }}>
                        {resLib.coutMensuelLib !== null
                          ? (resLib.coutMensuelLib < 0 ? "+" : "-") + fmt(Math.abs(Math.round(resLib.coutMensuelLib!)))
                          : "—"}/m
                      </div>
                      <div style={{ fontSize: 9, color: C.text3, marginTop: 2 }}>rente+TF+chg-loyer</div>
                      <div style={{ fontSize: 10, fontWeight: 700, marginTop: 4, color: resLib.ratio < resBase.ratio ? C.green : C.red }}>
                        {resLib.ratio < resBase.ratio ? "▲ Meilleur" : "▼ Moins bon"}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 11, color: C.text3, marginTop: 12 }}>Active le curseur</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── HISTORIQUE ── */}
          {tab === "historique" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ background: C.card, borderRadius: 12, padding: 16, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 16 }}>Historique des prix</div>
                {(offre.priceHistory || [{ date: offre.datePublication, bouquet: offre.bouquet, rente: offre.rente }]).map((h: any, i: number, arr: any[]) => {
                  const prev = arr[i - 1];
                  const baisseB = prev && h.bouquet < prev.bouquet;
                  const baisseR = prev && h.rente < prev.rente;
                  const isLast = i === arr.length - 1;
                  return (
                    <div key={i} style={{ display: "flex", gap: 14, marginBottom: 14, paddingBottom: 14, borderBottom: !isLast ? `1px solid ${C.border}` : "none" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: isLast ? C.orange : C.border2, flexShrink: 0, marginTop: 4 }} />
                        {!isLast && <div style={{ width: 1, flex: 1, background: C.border, marginTop: 4 }} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: C.text3, marginBottom: 8, display: "flex", gap: 6, alignItems: "center" }}>
                          {fmtDate(h.date)}
                          {i === 0 && <Badge color={C.blue}>Publication</Badge>}
                          {isLast && i > 0 && <Badge color={C.green}>Actuel</Badge>}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          {[
                            { label: "Bouquet", value: fmt(h.bouquet), diff: baisseB ? `↓ ${fmt(prev.bouquet - h.bouquet)}` : null },
                            { label: "Rente", value: `${fmt(h.rente)}/m`, diff: baisseR ? `↓ ${fmt(prev.rente - h.rente)}/m` : null },
                          ].map(f => (
                            <div key={f.label} style={{ background: C.surface, borderRadius: 8, padding: "10px 12px" }}>
                              <div style={{ fontSize: 9, color: C.text3 }}>{f.label}</div>
                              <div style={{ fontSize: 14, fontWeight: 700, color: f.diff ? C.green : C.text }}>{f.value}</div>
                              {f.diff && <div style={{ fontSize: 10, color: C.green, marginTop: 2 }}>{f.diff}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ background: `${C.orange}0D`, border: `1px solid ${C.orange}20`, borderRadius: 12, padding: 14, display: "flex", gap: 12 }}>
                <div style={{ fontSize: 18 }}>💡</div>
                <div style={{ fontSize: 11, color: C.text2, lineHeight: 1.6 }}>
                  <strong style={{ color: C.orange }}>Signal de négociation :</strong> une annonce de plus de 60 jours avec une baisse de prix est un vendeur motivé. Score actuel : <strong style={{ color: resBase.negoColor }}>{resBase.negoLabel}</strong> ({resBase.ageJours}j, {resBase.hasPriceDrop ? "prix baissé" : "prix stable"})
                </div>
              </div>
            </div>
          )}

          {/* ── BIEN ── */}
          {tab === "bien" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {[
                  ["Superficie", offre.superficie ? `${offre.superficie} m²` : "—"],
                  ["Valeur vénale", fmt(offre.valeurVenale)],
                  ["Taxe foncière", `${fmt(offre.taxeFonciere)}/an`],
                  ["Charges copro", `${fmt(offre.chargesCopro)}/an`],
                  ["Occupant 1", offre.occupant1Age ? `${offre.occupant1Age} ans ${offre.occupant1Sexe === "F" ? "♀" : "♂"}` : "—"],
                  ["Occupant 2", offre.occupant2Age ? `${offre.occupant2Age} ans ${offre.occupant2Sexe === "F" ? "♀" : "♂"}` : "—"],
                  ["Inflation", `${((offre.tauxInflation || 0.03) * 100).toFixed(1)}%`],
                  ["Croissance TF", `${((offre.tauxCroissanceTF || 0.04) * 100).toFixed(1)}%`],
                ].map(([k, v]) => (
                  <div key={k as string} style={{ background: C.card, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 9, color: C.text3, textTransform: "uppercase", marginBottom: 4 }}>{k}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{v}</div>
                  </div>
                ))}
              </div>
              {offre.note && (
                <div style={{ background: C.card, borderRadius: 10, padding: 14, border: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 9, color: C.text3, textTransform: "uppercase", marginBottom: 6 }}>Notes</div>
                  <div style={{ fontSize: 12, color: C.text2, fontStyle: "italic", lineHeight: 1.6 }}>{offre.note}</div>
                </div>
              )}
              {offre.url && (
                <a href={offre.url} target="_blank" rel="noreferrer"
                  style={{ display: "block", background: C.orange, color: C.white, borderRadius: 12, padding: "14px 20px", textAlign: "center", textDecoration: "none", fontSize: 14, fontWeight: 700, letterSpacing: ".02em" }}>
                  Voir l'annonce & contacter l'agence →
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Import Modal ──────────────────────────────────────────────────────────
// Extrait dept/région depuis l'URL ou code postal
function getVilleLabel(offre: any): string {
  const ville = offre.ville || "Ville inconnue";
  const cp = offre.codePostal;
  if (cp) return `${ville} (${cp.slice(0,2)})`;
  if (offre.url) {
    const m = offre.url.match(/\/acheter\/[^/]+-(\d{2,3})\//);
    if (m) return `${ville} (${m[1]})`;
  }
  return ville;
}

function Card({ offre, result, onDetail, onFavori, onRejeter, onSignal, isFavori }: any) {
  const { prixNet, ratio, duree, coutMensuelOcc, negoLabel, negoColor, negoScore, hasPriceDrop, ageJours } = result;
  const col = scoreColor(ratio);
  const villeLabel = getVilleLabel(offre);
  const pubDate = offre.datePublication || offre.createdAt;

  return (
    <div style={{ background: C.surface, borderRadius: 12, overflow: "hidden", border: `1px solid ${isFavori ? C.gold + "80" : C.border}`, cursor: "pointer", transition: "all .2s", boxShadow: C.shadow }}
      onMouseEnter={e => { const el = e.currentTarget as any; el.style.boxShadow = C.shadowHover; el.style.borderColor = isFavori ? C.gold : C.orange + "60"; el.style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { const el = e.currentTarget as any; el.style.boxShadow = C.shadow; el.style.borderColor = isFavori ? C.gold + "80" : C.border; el.style.transform = "translateY(0)"; }}
      onClick={() => onDetail(offre)}>

      <div style={{ height: 3, background: `linear-gradient(90deg, ${col}, ${col}44)` }} />

      <div style={{ padding: 16 }}>
        {/* Top row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {isFavori && <span style={{ color: C.gold, marginRight: 4 }}>⭐</span>}
              {villeLabel}
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 10, color: offre.source === "Renée Costes" ? C.gold : C.orange }}>{offre.source}</span>
              {offre.typeVente === "terme" && <Badge color={C.blue}>À terme</Badge>}
              {offre.typeVente === "libre" && <Badge color={C.yellow}>Libre</Badge>}
              {hasPriceDrop && <Badge color={C.green}>↓ Prix</Badge>}
              {negoScore >= 2 && <Badge color={negoColor}>{negoLabel}</Badge>}
            </div>
            {pubDate && (
              <div style={{ fontSize: 10, color: C.text3, marginTop: 3 }}>
                📅 {fmtDate(pubDate)}{ageJours > 0 ? ` · ${fmtAge(ageJours)}` : ""}
              </div>
            )}
          </div>
          <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 10 }}>
            <div style={{ fontSize: 24, fontWeight: 900, color: col, lineHeight: 1 }}>{fmtPct(ratio)}</div>
            <div style={{ fontSize: 9, color: col, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>{scoreLabel(ratio)}</div>
          </div>
        </div>

        {/* Métriques */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <div style={{ background: C.bg, borderRadius: 8, padding: "10px 12px", border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 9, color: C.text3, textTransform: "uppercase", marginBottom: 4 }}>Coût / mois</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.red }}>-{fmt(Math.round(coutMensuelOcc))}</div>
            <div style={{ fontSize: 9, color: C.text3 }}>rente + TF + charges</div>
          </div>
          <div style={{ background: C.bg, borderRadius: 8, padding: "10px 12px", border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 9, color: C.text3, textTransform: "uppercase", marginBottom: 4 }}>Prix revient</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: col }}>{fmt(prixNet)}</div>
            <div style={{ fontSize: 9, color: C.text3 }}>sur {fmtYrs(duree)}</div>
          </div>
        </div>

        {/* Secondaires */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: 10 }}>
          <div style={{ background: C.bg, borderRadius: 6, padding: "7px 8px" }}>
            <div style={{ fontSize: 8, color: C.text3, textTransform: "uppercase" }}>Bouquet</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.text2, marginTop: 1 }}>{fmt(offre.bouquet)}</div>
          </div>
          <div style={{ background: C.bg, borderRadius: 6, padding: "7px 8px" }}>
            <div style={{ fontSize: 8, color: C.text3, textTransform: "uppercase" }}>{offre.typeVente === "terme" ? "Mensualité" : "Rente"}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.text2, marginTop: 1 }}>{(offre.rente || offre.mensualite) ? fmt(offre.rente || offre.mensualite) + "/m" : "—"}</div>
          </div>
          <div style={{ background: C.bg, borderRadius: 6, padding: "7px 8px" }}>
            <div style={{ fontSize: 8, color: C.text3, textTransform: "uppercase" }}>Durée</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.text2, marginTop: 1 }}>
              {fmtYrs(duree)}
              {offre.occupant1Age && (
                <span style={{ fontSize: 9, marginLeft: 3, color: offre.occupant1Sexe === "H" && !offre.occupant2Age ? "#60a5fa" : offre.occupant1Sexe === "F" && !offre.occupant2Age ? "#f9a8d4" : C.text3 }}>
                  ({offre.occupant1Age}a{offre.occupant2Age ? `/${offre.occupant2Age}a` : ""})
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={e => { e.stopPropagation(); onDetail(offre); }}
            style={{ flex: 1, background: `${C.orange}15`, color: C.orange, border: `1px solid ${C.orange}25`, borderRadius: 10, padding: "9px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
            Détail
          </button>
          <button onClick={e => { e.stopPropagation(); onFavori(offre.id); }}
            style={{ background: isFavori ? `${C.gold}20` : C.bg, color: isFavori ? C.gold : C.text3, border: `1px solid ${isFavori ? C.gold + "40" : C.border}`, borderRadius: 10, padding: "9px 10px", fontSize: 13, cursor: "pointer" }}>
            ⭐
          </button>
          {offre.url && (
            <a href={offre.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              style={{ background: C.bg, color: C.text3, border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 10px", fontSize: 12, textDecoration: "none" }}>
              🔗
            </a>
          )}
          <button onClick={e => { e.stopPropagation(); onSignal(offre); }}
            style={{ background: C.bg, color: C.text3, border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 10px", fontSize: 12, cursor: "pointer", fontWeight: 700 }}>
            ?
          </button>
          <button onClick={e => { e.stopPropagation(); onRejeter(offre.id); }}
            style={{ background: C.bg, color: C.red, border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 10px", fontSize: 12, cursor: "pointer" }}>
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Parser texte collé — extraction côté client ──────────────────────────
// ─── Vocabulaire personnalisable — synonymes par champ ────────────────────
const DEFAULT_VOCAB = {
  bouquet: ["bouquet", "capital initial", "comptant"],
  rente: ["rente", "rente mensuelle", "rente viagère"],
  mensualite: ["mensualité", "mensualités", "échéance"],
  valeurVenale: ["valeur vénale", "valeur du bien", "prix du bien", "prix marché", "estimé", "estimation"],
  taxeFonciere: ["taxe foncière", "tf"],
  chargesCopro: ["charges de copropriété", "charges copro", "charges trimestrielles", "charges annuelles"],
  superficie: ["m²", "superficie", "surface"],
  loyer: ["loyer", "loyer garanti", "loyer estimé"],
  viagerLibre: ["viager libre", "bien libre", "libre de toute occupation", "nue-propriété"],
  venteATerme: ["vente à terme", "terme libre", "terme occupé"],
};

function getVocab(): typeof DEFAULT_VOCAB {
  try {
    const stored = localStorage.getItem("viager_vocab");
    if (!stored) return DEFAULT_VOCAB;
    const parsed = JSON.parse(stored);
    // Fusionner avec les défauts pour ne jamais perdre les patterns de base
    const merged: any = {};
    Object.keys(DEFAULT_VOCAB).forEach(k => {
      merged[k] = Array.from(new Set([...(DEFAULT_VOCAB as any)[k], ...(parsed[k] || [])]));
    });
    return merged;
  } catch { return DEFAULT_VOCAB; }
}

function saveVocabTerm(field: keyof typeof DEFAULT_VOCAB, term: string) {
  try {
    const stored = JSON.parse(localStorage.getItem("viager_vocab") || "{}");
    const list = new Set(stored[field] || []);
    list.add(term.toLowerCase().trim());
    stored[field] = Array.from(list);
    localStorage.setItem("viager_vocab", JSON.stringify(stored));
  } catch {}
}

function buildVocabRegex(terms: string[]): string {
  return terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
}

function parsePastedText(text: string): { data: any; confidence: number } {
  const clean = text.replace(/\s+/g, " ").trim();
  const data: any = {};
  const vocab = getVocab();

  const extractNum = (regex: RegExp, min: number, max: number): number | undefined => {
    const m = clean.match(regex);
    if (!m?.[1]) return undefined;
    const val = parseInt(m[1].replace(/[\s\u00a0]/g, ""));
    return !isNaN(val) && val >= min && val <= max ? val : undefined;
  };

  // Type de vente — vocabulaire dynamique
  const t = clean.toLowerCase();
  const venteATermeRe = new RegExp(`(?:${buildVocabRegex(vocab.venteATerme)})|mensualit[eé]s?\\s*:?\\s*\\d|\\b(?:120|150|180|240)\\s*mois\\b`, "i");
  const libreRe = new RegExp(`(?:${buildVocabRegex(vocab.viagerLibre)})`, "i");
  if (venteATermeRe.test(t)) {
    data.typeVente = "terme";
  } else if (libreRe.test(t)) {
    data.typeVente = "libre";
  } else {
    data.typeVente = "occupe";
  }

  // Bouquet — vocabulaire dynamique
  const bouquetRe = new RegExp(`(?:${buildVocabRegex(vocab.bouquet)})\\s*(?:FAI)?[^\\d€]{0,10}([0-9][0-9\\s]{2,8})\\s*€?`, "i");
  data.bouquet = extractNum(bouquetRe, 1000, 500000)
    ?? extractNum(/([0-9][0-9\s]{4,8})\s*€?\s*(?:FAI|hono)/i, 1000, 500000);

  if (data.typeVente === "terme") {
    const mensRe = new RegExp(`(?:${buildVocabRegex(vocab.mensualite)})\\s*:?\\s*([0-9][0-9\\s]{2,6})\\s*€?\\s*\\/?\\s*mois`, "i");
    data.mensualite = extractNum(mensRe, 100, 10000)
      ?? extractNum(/([0-9][0-9\s]{2,6})\s*€?\s*\/\s*mois/i, 100, 10000);
    if (data.mensualite) data.rente = data.mensualite;
    data.termeMois = extractNum(/terme\s*:?\s*([0-9]{2,4})\s*mois/i, 12, 360)
      ?? extractNum(/([0-9]{2,4})\s*mois/i, 12, 360);
    data.valeurVenale = extractNum(/prix\s*(?:d.achat|total|FAI)[^\d€]{0,10}([0-9][0-9\s]{4,8})\s*€?/i, 10000, 3000000);
    const loyerRe = new RegExp(`(?:${buildVocabRegex(vocab.loyer)})\\s*:?\\s*([0-9][0-9\\s]{2,6})\\s*€?`, "i");
    data.loyerMensuelManuel = extractNum(loyerRe, 100, 15000);
  } else {
    const renteRe = new RegExp(`(?:${buildVocabRegex(vocab.rente)})[^\\d€]{0,10}([0-9][0-9\\s]{2,6})\\s*€?\\s*\\/?\\s*mois`, "i");
    data.rente = extractNum(renteRe, 50, 5000)
      ?? extractNum(/([0-9][0-9\s]{2,5})\s*€\s*\/\s*mois/i, 50, 5000);
    const vvRe = new RegExp(`(?:${buildVocabRegex(vocab.valeurVenale)})[^\\d€]{0,10}([0-9][0-9\\s]{4,8})\\s*€?`, "i");
    data.valeurVenale = extractNum(vvRe, 10000, 5000000);

    const ageMatch = clean.match(/(?:dame|femme|homme|monsieur|vendeur|occup[eé])[^\d]{0,15}(\d{2})\s*ans/i)
      ?? clean.match(/(\d{2})\s*ans?\s*(?:dame|femme|homme)/i)
      ?? clean.match(/[aâ]g[eé]\s*(?:de\s*)?(\d{2})\s*ans/i);
    if (ageMatch) {
      const age = parseInt(ageMatch[1]);
      if (age >= 55 && age <= 99) {
        data.occupant1Age = age;
        data.occupant1Sexe = /dame|femme/i.test(ageMatch[0]) ? "F" : "H";
      }
    }

    if (data.typeVente === "libre") {
      data.loyerMensuelManuel = extractNum(/loyer[^\d€]{0,10}([0-9][0-9\s]{2,6})\s*€?\s*\/?\s*mois/i, 100, 15000);
    }
  }

  data.superficie = extractNum(/([0-9]{2,3})\s*m²?\s*(?:carrez|habitable|loi)/i, 10, 500)
    ?? extractNum(/superficie[^\d]{0,5}([0-9]{2,3})\s*m/i, 10, 500)
    ?? extractNum(/([0-9]{2,3})\s*m²/i, 10, 500);

  data.taxeFonciere = extractNum(/taxe\s*fonci[eè]re\s*(?:hors\s*TEOM)?[^\d€]{0,10}([0-9][0-9\s]{2,6})\s*€?/i, 100, 10000)
    ?? extractNum(/TF\s*(?:hors\s*TEOM)?[^\d€]{0,5}([0-9][0-9\s]{2,5})\s*€?/, 100, 10000);

  const chargesVocabRe = new RegExp(`(?:${buildVocabRegex(vocab.chargesCopro)})[^\\d€]{0,10}([0-9][0-9\\s]{2,6})\\s*€?\\s*(\\/\\s*(?:an|trim|mois))?`, "i");
  const chgMatch = clean.match(chargesVocabRe)
    ?? clean.match(/charges[^\d€]{0,10}([0-9][0-9\s]{2,6})\s*€?\s*\/\s*(?:an|trim|mois)/i);
  if (chgMatch) {
    let val = parseInt(chgMatch[1].replace(/\s/g, ""));
    if (/trim/i.test(chgMatch[0])) val *= 4;
    if (/mois/i.test(chgMatch[0])) val *= 12;
    if (val >= 100 && val <= 15000) data.chargesCopro = val;
  }

  const villeCP = clean.match(/([A-ZÀ-Ü][a-zà-ü]+(?:[\s\-][A-ZÀ-Ü][a-zà-ü]+)*)\s*\((\d{5})\)/i);
  if (villeCP) {
    data.ville = villeCP[1].trim();
    data.codePostal = villeCP[2];
  }

  const keysTerme = ["bouquet", "mensualite", "termeMois"];
  const keysViager = ["bouquet", "rente", "superficie", "occupant1Age", "valeurVenale"];
  const keys = data.typeVente === "terme" ? keysTerme : keysViager;
  const filled = keys.filter(k => data[k] != null).length;
  const confidence = filled / keys.length;

  return { data, confidence };
}

function VocabModal({ onClose }: { onClose: () => void }) {
  const [vocab, setVocab] = useState(getVocab());
  const [newTerms, setNewTerms] = useState<Record<string, string>>({});

  const FIELD_LABELS: Record<string, string> = {
    bouquet: "Bouquet",
    rente: "Rente (viager occupé/libre)",
    mensualite: "Mensualité (vente à terme)",
    valeurVenale: "Valeur vénale",
    taxeFonciere: "Taxe foncière",
    chargesCopro: "Charges copropriété",
    superficie: "Superficie",
    loyer: "Loyer (libre/terme)",
    viagerLibre: "Détection viager libre",
    venteATerme: "Détection vente à terme",
  };

  const addTerm = (field: string) => {
    const term = (newTerms[field] || "").trim();
    if (!term) return;
    saveVocabTerm(field as any, term);
    setVocab(getVocab());
    setNewTerms(p => ({ ...p, [field]: "" }));
  };

  const removeTerm = (field: string, term: string) => {
    try {
      const stored = JSON.parse(localStorage.getItem("viager_vocab") || "{}");
      stored[field] = (stored[field] || []).filter((t: string) => t !== term);
      localStorage.setItem("viager_vocab", JSON.stringify(stored));
      setVocab(getVocab());
    } catch {}
  };

  const isDefault = (field: string, term: string) => (DEFAULT_VOCAB as any)[field]?.includes(term);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 250 }} onClick={onClose}>
      <div style={{ background: C.surface, borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 620, maxHeight: "88vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 0" }}>
          <div style={{ width: 36, height: 4, background: C.border, borderRadius: 2 }} />
        </div>
        <div style={{ padding: "16px 20px 32px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>📚 Vocabulaire du parser</div>
            <button onClick={onClose} style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text3, cursor: "pointer", fontSize: 14, borderRadius: 8, width: 30, height: 30 }}>✕</button>
          </div>
          <div style={{ fontSize: 12, color: C.text3, marginBottom: 20 }}>
            Ajoute les mots que les sites utilisent pour chaque donnée. Plus le vocabulaire est riche, mieux l'extraction fonctionne.
          </div>

          {Object.entries(FIELD_LABELS).map(([field, label]) => (
            <div key={field} style={{ marginBottom: 18, paddingBottom: 18, borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>{label}</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
                {((vocab as any)[field] || []).map((term: string) => (
                  <span key={term} style={{ display: "flex", alignItems: "center", gap: 5, background: isDefault(field, term) ? C.bg : `${C.green}12`, color: isDefault(field, term) ? C.text2 : C.green, border: `1px solid ${isDefault(field, term) ? C.border : C.green + "30"}`, borderRadius: 20, padding: "4px 10px", fontSize: 11 }}>
                    {term}
                    {!isDefault(field, term) && (
                      <button onClick={() => removeTerm(field, term)} style={{ background: "none", border: "none", color: C.green, cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}>✕</button>
                    )}
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <input value={newTerms[field] || ""} onChange={e => setNewTerms(p => ({ ...p, [field]: e.target.value }))}
                  onKeyDown={e => e.key === "Enter" && addTerm(field)}
                  placeholder="Ajouter un synonyme…"
                  style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: "8px 12px", fontSize: 12 }} />
                <button onClick={() => addTerm(field)}
                  style={{ background: C.orange, color: C.white, border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                  +
                </button>
              </div>
            </div>
          ))}

          <div style={{ fontSize: 10, color: C.text3, textAlign: "center", marginTop: 8 }}>
            Le vocabulaire est sauvegardé sur cet appareil uniquement
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: (o: any) => void }) {
  const [url, setUrl] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [step, setStep] = useState("input");
  const [errMsg, setErrMsg] = useState("");
  const [parsed, setParsed] = useState<any>(null);
  const [showVocabHint, setShowVocabHint] = useState(false);
  const [edited, setEdited] = useState<any>({
    typeVente: "occupe", occupant1Sexe: "F", source: "Manuel",
  });

  const analyze = async () => {
    if (!url.trim()) return;
    setStep("loading");
    try {
      const result = await importFromAPI(url.trim());
      if (result.error && !result.data) { setErrMsg(result.error); setStep("error"); return; }
      setParsed(result);
      setEdited((p: any) => ({ ...p, ...result.data, url: url.trim(), source: result.source }));
      setStep("form");
    } catch (e: any) { setErrMsg(e.message || "Erreur inconnue"); setStep("error"); }
  };

  const analyzeText = () => {
    if (!pastedText.trim() || pastedText.trim().length < 50) return;
    const { data, confidence } = parsePastedText(pastedText);
    setParsed({ source: "Texte collé", confidence });
    setEdited((p: any) => ({ ...p, ...data, source: "Manuel" }));
    setStep("form");
  };

  const add = () => {
    onImport({
      ...edited,
      url: url.trim() || edited.url || "",
      occupant1Age: edited.occupant1Age || 78,
      occupant1Sexe: edited.occupant1Sexe || "F",
      taxeFonciere: edited.taxeFonciere || 0,
      chargesCopro: edited.chargesCopro || 0,
      autresCharges: 0, ventilationCharges: 0.33, majorationRenteLiberation: 0.30,
      tauxInflation: 0.03, tauxCroissanceTF: 0.04,
      loyerMensuelManuel: edited.typeVente === "libre" ? (edited.loyerMensuelManuel || null) : null,
      termeMois: edited.typeVente === "terme" ? (edited.termeMois || null) : null,
      mensualite: edited.typeVente === "terme" ? (edited.mensualite || edited.rente || null) : null,
      rente: edited.typeVente === "terme" ? (edited.mensualite || edited.rente || null) : (edited.rente || null),
      datePublication: new Date().toISOString().slice(0, 10),
      priceHistory: [{ date: new Date().toISOString().slice(0, 10), bouquet: edited.bouquet, rente: edited.rente }],
    });
    onClose();
  };

  const upd = (k: string, v: any) => setEdited((p: any) => ({ ...p, [k]: v }));

  const numField = (label: string, key: string, placeholder = "") => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>{label}</label>
      <input type="number" value={edited?.[key] ?? ""} placeholder={placeholder}
        onChange={e => upd(key, e.target.value === "" ? "" : +e.target.value)}
        style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: "10px 12px", fontSize: 13, width: "100%" }} />
    </div>
  );

  const txtField = (label: string, key: string, placeholder = "") => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>{label}</label>
      <input type="text" value={edited?.[key] ?? ""} placeholder={placeholder}
        onChange={e => upd(key, e.target.value)}
        style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: "10px 12px", fontSize: 13, width: "100%" }} />
    </div>
  );

  const btnToggle = (label: string, options: [string, string][], key: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <label style={{ fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>{label}</label>
      <div style={{ display: "flex", gap: 4 }}>
        {options.map(([val, lbl]) => (
          <button key={val} onClick={() => upd(key, val)}
            style={{ flex: 1, background: edited?.[key] === val ? C.orange : C.bg, color: edited?.[key] === val ? C.white : C.text2, border: `1px solid ${edited?.[key] === val ? C.orange : C.border}`, borderRadius: 8, padding: "9px 4px", cursor: "pointer", fontSize: 11, fontWeight: edited?.[key] === val ? 700 : 400 }}>
            {lbl}
          </button>
        ))}
      </div>
    </div>
  );

  const reset = () => {
    setStep("input"); setUrl(""); setErrMsg(""); setParsed(null);
    setEdited({ typeVente: "occupe", occupant1Sexe: "F", source: "Manuel" });
  };

  const sectionTitle = (t: string) => (
    <div style={{ fontSize: 10, color: C.text3, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>{t}</div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 200 }} onClick={onClose}>
      <div style={{ background: C.surface, borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 620, maxHeight: "92vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 0" }}>
          <div style={{ width: 36, height: 4, background: C.border, borderRadius: 2 }} />
        </div>
        <div style={{ padding: "16px 20px 32px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>Ajouter une annonce</div>
            <button onClick={onClose} style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text3, cursor: "pointer", fontSize: 14, borderRadius: 8, width: 30, height: 30 }}>✕</button>
          </div>

          {step === "input" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {/* Option 1 — URL */}
              <div>
                <div style={{ fontSize: 12, color: C.text3, marginBottom: 8 }}>Colle une URL pour auto-remplir</div>
                <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && analyze()}
                  placeholder="https://www.costes-viager.com/acheter/..."
                  style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, padding: "13px 16px", fontSize: 14, width: "100%", marginBottom: 8 }} />
                <button onClick={analyze} disabled={!url.trim()}
                  style={{ width: "100%", background: C.orange, color: C.white, border: "none", borderRadius: 10, padding: "13px", cursor: "pointer", fontSize: 14, fontWeight: 700, opacity: url.trim() ? 1 : 0.5 }}>
                  🔗 Analyser l'URL →
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, height: 1, background: C.border }} />
                <span style={{ fontSize: 10, color: C.text3, fontWeight: 600 }}>OU</span>
                <div style={{ flex: 1, height: 1, background: C.border }} />
              </div>

              {/* Option 2 — Coller texte */}
              <div>
                <div style={{ fontSize: 12, color: C.text3, marginBottom: 8 }}>Colle le texte complet de l'annonce (Ctrl+A puis Ctrl+C sur la page)</div>
                <textarea value={pastedText} onChange={e => setPastedText(e.target.value)}
                  placeholder="Bouquet 74 000€ et 1 218€/mois&#10;Réf. 9935.B - VIAGER OCCUPÉ - CAGNES-SUR-MER (06)&#10;3 pièces · 74,35 m²&#10;..."
                  style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, padding: "12px 14px", fontSize: 12, width: "100%", minHeight: 110, resize: "vertical", fontFamily: "inherit" }} />
                <button onClick={analyzeText} disabled={pastedText.trim().length < 50}
                  style={{ width: "100%", background: C.blue, color: C.white, border: "none", borderRadius: 10, padding: "13px", cursor: "pointer", fontSize: 14, fontWeight: 700, marginTop: 8, opacity: pastedText.trim().length >= 50 ? 1 : 0.5 }}>
                  📋 Extraire les données du texte →
                </button>
              </div>

              <button onClick={() => setStep("form")}
                style={{ background: C.bg, color: C.text2, border: `1px solid ${C.border}`, borderRadius: 10, padding: "11px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                Saisie manuelle complète
              </button>
            </div>
          )}

          {step === "loading" && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: 40, marginBottom: 14 }}>⏳</div>
              <div style={{ fontSize: 15, color: C.text2, fontWeight: 600 }}>Analyse en cours…</div>
              <div style={{ fontSize: 11, color: C.text3, marginTop: 8 }}>Extraction des données depuis l'annonce</div>
            </div>
          )}

          {step === "error" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ background: `${C.red}12`, border: `1px solid ${C.red}30`, borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 4 }}>Scraping impossible</div>
                <div style={{ fontSize: 11, color: C.text3 }}>{errMsg}</div>
              </div>
              <button onClick={() => setStep("form")}
                style={{ background: C.orange, color: C.white, border: "none", borderRadius: 10, padding: "13px", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
                Saisir manuellement →
              </button>
              <button onClick={reset} style={{ background: C.bg, color: C.text3, border: `1px solid ${C.border}`, borderRadius: 10, padding: "11px", cursor: "pointer", fontSize: 13 }}>← Réessayer</button>
            </div>
          )}

          {step === "form" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {parsed && (
                <div style={{ background: `${C.green}15`, border: `1px solid ${C.green}30`, borderRadius: 10, padding: 12, marginBottom: 4 }}>
                  <div style={{ fontSize: 12, color: C.green, fontWeight: 700 }}>✅ {parsed.source} — {Math.round((parsed.confidence || 0) * 100)}% extrait</div>
                  <div style={{ fontSize: 10, color: C.text3, marginTop: 2 }}>Vérifie et complète les champs ci-dessous</div>
                </div>
              )}

              {parsed && parsed.source === "Texte collé" && (parsed.confidence || 0) < 0.6 && (
                <div style={{ background: `${C.yellow}12`, border: `1px solid ${C.yellow}30`, borderRadius: 10, padding: 12, marginBottom: 4 }}>
                  <div style={{ fontSize: 11, color: C.yellow, fontWeight: 700 }}>💡 Extraction partielle</div>
                  <div style={{ fontSize: 10, color: C.text3, marginTop: 3 }}>
                    Complète les champs manquants ci-dessous, puis enrichis le <button onClick={() => setShowVocabHint(true)} style={{ background: "none", border: "none", color: C.orange, cursor: "pointer", fontSize: 10, fontWeight: 700, padding: 0, textDecoration: "underline" }}>vocabulaire du parser</button> avec les mots utilisés sur ce site
                  </div>
                </div>
              )}

              {/* Type de vente */}
              {btnToggle("Type de vente", [["occupe", "Viager occupé"], ["libre", "Viager libre"], ["terme", "Vente à terme"]], "typeVente")}

              {/* Localisation */}
              {sectionTitle("Localisation")}
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
                {txtField("Ville", "ville", "Nice")}
                {txtField("Code postal", "codePostal", "06000")}
              </div>

              {/* Financier */}
              {sectionTitle("Données financières")}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {numField("Bouquet (€)", "bouquet", "50 000")}
                {edited?.typeVente === "terme"
                  ? numField("Mensualité (€/mois)", "mensualite", "1 200")
                  : numField("Rente mensuelle (€)", "rente", "400")}
                {numField("Valeur vénale (€)", "valeurVenale", "200 000")}
                {numField("Superficie (m²)", "superficie", "50")}
                {edited?.typeVente === "terme" && numField("Terme (mois)", "termeMois", "180")}
                {edited?.typeVente === "libre" && numField("Loyer mensuel perçu (€)", "loyerMensuelManuel", "800")}
              </div>

              {/* Occupant */}
              {edited?.typeVente !== "terme" && (<>
                {sectionTitle("Occupant(s)")}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {numField("Âge occupant 1", "occupant1Age", "78")}
                  <div>{btnToggle("Sexe", [["F", "Femme"], ["H", "Homme"]], "occupant1Sexe")}</div>
                  {numField("Âge occupant 2 (couple)", "occupant2Age", "")}
                  {edited?.occupant2Age && <div>{btnToggle("Sexe 2", [["F", "Femme"], ["H", "Homme"]], "occupant2Sexe")}</div>}
                </div>
              </>)}

              {/* Revalorisation rente */}

              {/* Charges */}
              {sectionTitle("Charges annuelles")}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {numField("Taxe foncière (€/an)", "taxeFonciere", "800")}
                {numField("Charges copro (€/an)", "chargesCopro", "1 200")}
              </div>

              {/* Source */}
              {sectionTitle("Source")}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["Renée Costes", "SeLoger", "LeBonCoin", "Univers Viager", "PAP", "Manuel"].map(s => (
                  <button key={s} onClick={() => upd("source", s)}
                    style={{ background: edited?.source === s ? `${C.orange}15` : C.bg, color: edited?.source === s ? C.orange : C.text3, border: `1px solid ${edited?.source === s ? C.orange + "40" : C.border}`, borderRadius: 20, padding: "5px 12px", cursor: "pointer", fontSize: 11, fontWeight: edited?.source === s ? 700 : 400 }}>
                    {s}
                  </button>
                ))}
              </div>

              {/* URL optionnel */}
              {!url.trim() && txtField("URL de l'annonce (optionnel)", "url", "https://...")}

              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={add}
                  style={{ flex: 1, background: C.orange, color: C.white, border: "none", borderRadius: 10, padding: "14px", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
                  ✓ Ajouter au portefeuille
                </button>
                <button onClick={reset} style={{ background: C.bg, color: C.text3, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 14px", cursor: "pointer", fontSize: 13 }}>←</button>
              </div>
            </div>
          )}
        </div>
      </div>
      {showVocabHint && <VocabModal onClose={() => setShowVocabHint(false)} />}
    </div>
  );
}

function SignalModal({ offre, onClose, onCorrect }: { offre: any; onClose: () => void; onCorrect: (id: any, corrections: any) => void }) {
  const [step, setStep] = useState<"main"|"correct"|"done">("main");
  const [corrections, setCorrections] = useState<any>({
    bouquet: offre.bouquet || "",
    rente: offre.rente || "",
    valeurVenale: offre.valeurVenale || "",
    taxeFonciere: offre.taxeFonciere || "",
    chargesCopro: offre.chargesCopro || "",
    occupant1Age: offre.occupant1Age || "",
    superficie: offre.superficie || "",
  });

  const upd = (k: string, v: string) => setCorrections((p: any) => ({ ...p, [k]: v === "" ? "" : +v }));

  const save = () => {
    // Nettoyer — garder uniquement les champs remplis
    const clean: any = {};
    Object.entries(corrections).forEach(([k, v]) => {
      if (v !== "" && v !== null && v !== undefined) clean[k] = +v;
    });
    onCorrect(offre.id, clean);
    setStep("done");
    setTimeout(onClose, 1200);
  };

  const fields = [
    ["bouquet", "Bouquet (€)"],
    ["rente", "Rente mensuelle (€/mois)"],
    ["valeurVenale", "Valeur vénale (€)"],
    ["taxeFonciere", "Taxe foncière (€/an)"],
    ["chargesCopro", "Charges copro (€/an)"],
    ["occupant1Age", "Âge occupant (ans)"],
    ["superficie", "Superficie (m²)"],
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 400 }} onClick={onClose}>
      <div style={{ background: C.surface, borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 520, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 -8px 40px rgba(0,0,0,.15)" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 0" }}>
          <div style={{ width: 36, height: 4, background: C.border, borderRadius: 2 }} />
        </div>
        <div style={{ padding: "16px 20px 28px" }}>

          {step === "done" && (
            <div style={{ textAlign: "center", padding: "30px 0" }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Corrections sauvegardées</div>
              <div style={{ fontSize: 12, color: C.text3, marginTop: 4 }}>La card est mise à jour</div>
            </div>
          )}

          {step === "main" && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: C.text }}>Vérifier cette annonce</div>
                  <div style={{ fontSize: 12, color: C.text3, marginTop: 3 }}>{offre.ville} · {offre.source}</div>
                </div>
                <button onClick={onClose} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: 14, color: C.text3 }}>✕</button>
              </div>

              {/* Données actuelles */}
              <div style={{ background: C.bg, borderRadius: 10, padding: 14, marginBottom: 16, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 10, fontWeight: 600 }}>Données actuelles dans l'app</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {[
                    ["Bouquet", offre.bouquet ? fmt(offre.bouquet) : "—"],
                    ["Rente", offre.rente ? fmt(offre.rente) + "/m" : "—"],
                    ["Valeur vénale", offre.valeurVenale ? fmt(offre.valeurVenale) : "—"],
                    ["TF", offre.taxeFonciere ? fmt(offre.taxeFonciere) + "/an" : "—"],
                    ["Charges", offre.chargesCopro ? fmt(offre.chargesCopro) + "/an" : "—"],
                    ["Âge", offre.occupant1Age ? `${offre.occupant1Age} ans` : "—"],
                  ].map(([k, v]) => (
                    <div key={k} style={{ fontSize: 12 }}>
                      <span style={{ color: C.text3 }}>{k} : </span>
                      <span style={{ color: C.text, fontWeight: 600 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Bouton voir annonce */}
              {offre.url && (
                <a href={offre.url} target="_blank" rel="noreferrer"
                  style={{ display: "block", background: C.blue, color: C.white, borderRadius: 10, padding: "13px 20px", textAlign: "center", textDecoration: "none", fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
                  🔗 Voir l'annonce source →
                </a>
              )}
              <div style={{ fontSize: 11, color: C.text3, textAlign: "center", marginBottom: 16 }}>
                Vérifie les chiffres sur le site, puis reviens corriger ci-dessous
              </div>

              <button onClick={() => setStep("correct")}
                style={{ width: "100%", background: C.orange, color: C.white, border: "none", borderRadius: 10, padding: "13px", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
                ✏️ Corriger les données
              </button>
            </>
          )}

          {step === "correct" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                <button onClick={() => setStep("main")} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer", fontSize: 12, color: C.text3 }}>←</button>
                <div style={{ fontSize: 16, fontWeight: 800, color: C.text }}>Corriger les données</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
                {fields.map(([k, l]) => (
                  <div key={k} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 600 }}>{l}</label>
                    <input
                      type="number"
                      value={corrections[k]}
                      onChange={e => upd(k, e.target.value)}
                      style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 12px", fontSize: 13, color: C.text, width: "100%" }}
                    />
                  </div>
                ))}
              </div>

              <button onClick={save}
                style={{ width: "100%", background: C.green, color: C.white, border: "none", borderRadius: 10, padding: "13px", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
                ✓ Sauvegarder les corrections
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ViagerScan() {
  const [offres, setOffres] = useState<any[]>(SEED);
  const [sortBy, setSortBy] = useState("ratio");
  const [filterSource, setFilterSource] = useState("Tous");
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showVocab, setShowVocab] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [mobile, setMobile] = useState(false);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [signal, setSignal] = useState<{offre: any, field?: string} | null>(null);
  const [showHypo, setShowHypo] = useState(false);
  const [hypo, setHypo] = useState({ inflation: 3, croissanceTF: 4, appreciationBien: 0 });
  const [favoris, setFavoris] = useState<Set<any>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("viager_favoris") || "[]")); } catch { return new Set(); }
  });
  const [rejetes, setRejetes] = useState<Set<any>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem("viager_rejetes") || "[]")); } catch { return new Set(); }
  });
  const [anomalies, setAnomalies] = useState<Set<any>>(new Set());
  const [activeTab, setActiveTab] = useState<"all"|"favoris"|"anomalies">("all");

  const toggleFavori = (id: any) => setFavoris(p => {
    const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id);
    try { localStorage.setItem("viager_favoris", JSON.stringify(Array.from(n))); } catch {}
    return n;
  });
  const toggleRejete = (id: any) => {
    setRejetes(p => {
      const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id);
      try { localStorage.setItem("viager_rejetes", JSON.stringify(Array.from(n))); } catch {}
      return n;
    });
    setFavoris(p => {
      const n = new Set(p); n.delete(id);
      try { localStorage.setItem("viager_favoris", JSON.stringify(Array.from(n))); } catch {}
      return n;
    });
  };

  // IDs/URLs rejetés persistés pour filtrer les nouveaux syncs
  const getRejectedUrls = (): Set<string> => {
    try {
      const ids = JSON.parse(localStorage.getItem("viager_rejetes") || "[]");
      const urls = new Set<string>();
      offres.forEach((o: any) => { if (ids.includes(o.id)) urls.add(o.url); });
      return urls;
    } catch { return new Set(); }
  };

  // Détection automatique anomalies
  const isAnomalie = (result: any, offre: any): boolean => {
    if (result.ratio !== null && (result.ratio > 3 || result.ratio < 0.1)) return true;
    if (offre.chargesCopro && offre.chargesCopro > 50000) return true;
    if (offre.occupant1Age && (offre.occupant1Age < 50 || offre.occupant1Age > 100)) return true;
    if (offre.taxeFonciere && offre.taxeFonciere > 20000) return true;
    return false;
  };

  useEffect(() => {
    const check = () => setMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Charger les annonces depuis Neon au démarrage
  useEffect(() => {
    if (dbLoaded) return;
    fetch("/api/listings?limit=100")
      .then(r => r.json())
      .then(json => {
        if (json.success && json.listings.length > 0) {
          const rejectedUrls = getRejectedUrls();
        const mapped = json.listings.map((l: any) => ({
            id: `db-${l.id}`,
            source: l.source,
            ville: l.ville || "Ville inconnue",
            superficie: l.superficie,
            valeurVenale: l.valeurVenale,
            bouquet: l.bouquet,
            rente: l.rente,
            occupant1Age: l.occupant1Age || 78,
            occupant1Sexe: l.occupant1Sexe || "F",
            taxeFonciere: l.taxeFonciere || 400,
            chargesCopro: l.chargesCopro || 800,
            autresCharges: 0,
            ventilationCharges: 0.33,
            majorationRenteLiberation: 0.30,
            tauxInflation: 0.03,
            tauxCroissanceTF: 0.04,
            datePublication: l.datePublication || l.createdAt?.slice(0, 10),
            url: l.url,
            note: l.notes || "",
            priceHistory: [{ date: l.createdAt?.slice(0, 10), bouquet: l.bouquet, rente: l.rente }],
          }));
          setOffres(prev => {
            const existingUrls = new Set(prev.map((o: any) => o.url));
            const newOnes = mapped.filter((o: any) => !existingUrls.has(o.url) && !rejectedUrls.has(o.url));
            return [...prev, ...newOnes];
          });
          setDbLoaded(true);
        }
      })
      .catch(() => {});
  }, [dbLoaded]);

  // Synchroniser les nouvelles annonces depuis SeLoger/Renée Costes
  const syncNow = async () => {
    setSyncing(true);
    try {
      await fetch("/api/rss");
      // Recharger depuis Neon après sync
      const r = await fetch("/api/listings?limit=100");
      const json = await r.json();
      if (json.success && json.listings.length > 0) {
        const mapped = json.listings.map((l: any) => ({
          id: `db-${l.id}`,
          source: l.source,
          ville: l.ville || "Ville inconnue",
          superficie: l.superficie,
          valeurVenale: l.valeurVenale,
          bouquet: l.bouquet,
          rente: l.rente,
          occupant1Age: l.occupant1Age || 78,
          occupant1Sexe: l.occupant1Sexe || "F",
          taxeFonciere: l.taxeFonciere || 400,
          chargesCopro: l.chargesCopro || 800,
          autresCharges: 0,
          ventilationCharges: 0.33,
          majorationRenteLiberation: 0.30,
          tauxInflation: 0.03,
          tauxCroissanceTF: 0.04,
          datePublication: l.datePublication || l.createdAt?.slice(0, 10),
          url: l.url,
          note: l.notes || "",
          priceHistory: [{ date: l.createdAt?.slice(0, 10), bouquet: l.bouquet, rente: l.rente }],
        }));
        const rejectedUrls = getRejectedUrls();
        setOffres(prev => {
          const existingUrls = new Set(prev.map((o: any) => o.url));
          const newOnes = mapped.filter((o: any) => !existingUrls.has(o.url) && !rejectedUrls.has(o.url));
          return [...prev, ...newOnes];
        });
      }
    } catch {}
    setSyncing(false);
  };

  const computed = useMemo(() => offres
    .filter(o => !rejetes.has(o.id))
    .map(o => {
      const result = computeViager({
        ...o,
        tauxInflation: hypo.inflation / 100,
        tauxCroissanceTF: hypo.croissanceTF / 100,
        valeurVenale: o.valeurVenale ? Math.round(o.valeurVenale * Math.pow(1 + hypo.appreciationBien / 100, o.occupant1Age ? (computeViager(o).duree || 10) : 10)) : o.valeurVenale,
      });
      const anomalie = isAnomalie(result, o);
      if (anomalie) setAnomalies(p => new Set([...Array.from(p), o.id]));
      return { offre: o, result, anomalie };
    }), [offres, hypo, rejetes]);

  const sorted = useMemo(() => {
    let list = [...computed];
    if (activeTab === "favoris") list = list.filter(x => favoris.has(x.offre.id));
    else if (activeTab === "anomalies") list = list.filter(x => anomalies.has(x.offre.id));
    else list = list.filter(x => !anomalies.has(x.offre.id));
    if (filterSource !== "Tous") list = list.filter(x => x.offre.source === filterSource);
    if (search.trim()) list = list.filter(x => x.offre.ville?.toLowerCase().includes(search.toLowerCase()));
    list.sort((a, b) => {
      if (sortBy === "ratio") return (a.result.ratio ?? 99) - (b.result.ratio ?? 99);
      if (sortBy === "cout") return (a.result.coutMensuelOcc || 0) - (b.result.coutMensuelOcc || 0);
      if (sortBy === "decote") return (b.result.decote ?? -99) - (a.result.decote ?? -99);
      if (sortBy === "bouquet") return (a.offre.bouquet || 0) - (b.offre.bouquet || 0);
      if (sortBy === "date") return new Date(b.offre.datePublication || b.offre.createdAt || 0).getTime() - new Date(a.offre.datePublication || a.offre.createdAt || 0).getTime();
      if (sortBy === "nego") return b.result.negoScore - a.result.negoScore;
      return 0;
    });
    return list;
  }, [computed, sortBy, filterSource, search, activeTab, favoris, anomalies]);

  const addOffre = (o: any) => setOffres(p => [...p, { ...o, id: Math.max(0, ...p.map((x: any) => x.id)) + 1 }]);
  const correctOffre = (id: any, corrections: any) => {
    setOffres(p => p.map((o: any) => o.id === id ? { ...o, ...corrections } : o));
    // Mettre à jour en base Neon si c'est une annonce DB
    if (String(id).startsWith("db-")) {
      const dbId = String(id).replace("db-", "");
      fetch("/api/listings/" + dbId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corrections),
      }).catch(() => {});
    }
  };
  const delOffre = (id: number) => setOffres(p => p.filter((o: any) => o.id !== id));
  const sources = ["Tous", ...Array.from(new Set(offres.map(o => o.source)))];

  const validRatios = computed.map(x => x.result.ratio).filter(Boolean) as number[];
  const bestRatio = validRatios.length ? Math.min(...validRatios) : null;
  const avgCout = computed.length ? computed.reduce((s, x) => s + (x.result.coutMensuelOcc || 0), 0) / computed.length : null;
  const negoCount = computed.filter(x => x.result.negoScore >= 2).length;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "-apple-system, 'SF Pro Text', 'Inter', system-ui, sans-serif" } as any}>

      {/* Header sticky */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: `0 ${mobile ? 14 : 24}px`, position: "sticky", top: 0, zIndex: 50, boxShadow: "0 1px 0 rgba(0,0,0,.06)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 54 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 30, height: 30, background: C.orange, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, boxShadow: "0 2px 6px rgba(232,93,38,.25)" }}>🏠</div>
            <div>
              <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.04em", color: C.text }}>viager</span>
              <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.04em", color: C.orange }}>scan</span>
            </div>
            <span style={{ fontSize: 9, color: C.text3, background: C.bg, padding: "2px 7px", borderRadius: 20, border: `1px solid ${C.border}`, fontWeight: 700, letterSpacing: ".04em" }}>BETA</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowVocab(true)} title="Vocabulaire du parser"
              style={{ background: C.bg, color: C.text3, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontSize: 13 }}>
              📚
            </button>
            <button onClick={syncNow} disabled={syncing}
              style={{ background: C.bg, color: syncing ? C.text3 : C.green, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 14px", cursor: syncing ? "wait" : "pointer", fontSize: 12, fontWeight: 600 }}>
              {syncing ? "⏳" : "⟳"}{mobile ? "" : syncing ? " Sync…" : " Sync"}
            </button>
            <button onClick={() => setShowImport(true)}
              style={{ background: C.orange, color: C.white, border: "none", borderRadius: 8, padding: mobile ? "8px 16px" : "8px 20px", cursor: "pointer", fontSize: 13, fontWeight: 700, boxShadow: "0 2px 6px rgba(232,93,38,.25)" }}>
              {mobile ? "+ Importer" : "+ Importer une annonce"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: `16px ${mobile ? 12 : 20}px` }}>

        {/* Stats — 2×2 sur mobile, 4×1 sur desktop */}
        <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(4,1fr)", gap: 10, marginBottom: 20 }}>
          {[
            { label: "Opportunités", value: offres.length, color: C.text, sub: `${sorted.length} affichées` },
            { label: "Meilleur ratio", value: bestRatio != null ? fmtPct(bestRatio) : "—", color: scoreColor(bestRatio), sub: "Prix revient / vénale" },
            { label: "Coût moyen", value: avgCout ? `-${fmt(Math.round(avgCout))}/m` : "—", color: C.red, sub: "Cash flow mensuel" },
            { label: "Négociables", value: negoCount, color: C.green, sub: `sur ${offres.length} annonces` },
          ].map(s => (
            <div key={s.label} style={{ background: C.surface, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}`, borderTop: `3px solid ${s.color}`, boxShadow: C.shadow }}>
              <div style={{ fontSize: 9, color: C.text3, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontSize: mobile ? 20 : 24, fontWeight: 800, color: s.color, letterSpacing: "-.02em" }}>{s.value}</div>
              <div style={{ fontSize: 9, color: C.text3, marginTop: 3 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Onglets principaux */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {([["all", "📋 Toutes", computed.filter(x => !anomalies.has(x.offre.id)).length],
             ["favoris", "⭐ Favoris", computed.filter(x => favoris.has(x.offre.id)).length],
             ["anomalies", "⚠️ Anomalies", anomalies.size]] as [string, string, number][]).map(([tab, label, count]) => (
            <button key={tab} onClick={() => setActiveTab(tab as any)}
              style={{ background: activeTab === tab ? (tab === "anomalies" ? C.red : tab === "favoris" ? C.gold : C.orange) + "20" : C.card,
                color: activeTab === tab ? (tab === "anomalies" ? C.red : tab === "favoris" ? C.gold : C.orange) : C.text3,
                border: `1px solid ${activeTab === tab ? (tab === "anomalies" ? C.red : tab === "favoris" ? C.gold : C.orange) + "40" : C.border}`,
                borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontSize: 11, fontWeight: activeTab === tab ? 700 : 400 }}>
              {label} <span style={{ fontSize: 10, opacity: 0.8 }}>({count})</span>
            </button>
          ))}
        </div>

        {/* Hypothèses */}
        <div style={{ marginBottom: 14 }}>
          <button onClick={() => setShowHypo(p => !p)}
            style={{ background: showHypo ? `${C.orange}20` : C.card, color: showHypo ? C.orange : C.text3, border: `1px solid ${showHypo ? C.orange + "40" : C.border}`, borderRadius: 8, padding: "7px 14px", cursor: "pointer", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            ⚙️ Hypothèses {showHypo ? "▲" : "▼"}
          </button>
          {showHypo && (
            <div style={{ background: C.card, borderRadius: 12, padding: 16, marginTop: 8, border: `1px solid ${C.border}`, display: "grid", gridTemplateColumns: mobile ? "1fr 1fr" : "repeat(3,1fr)", gap: 14 }}>
              {[
                { label: "Inflation", key: "inflation", unit: "%/an", min: 0, max: 10, step: 0.5, hint: "Impact rentes & charges" },
                { label: "Rééval. TF", key: "croissanceTF", unit: "%/an", min: 0, max: 10, step: 0.5, hint: "Croissance taxe foncière" },
                { label: "Appréciation bien", key: "appreciationBien", unit: "%/an", min: -5, max: 15, step: 0.5, hint: "Impact valeur vénale finale" },
              ].map(h => (
                <div key={h.key}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <div style={{ fontSize: 10, color: C.text2, fontWeight: 600 }}>{h.label}</div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: C.orange }}>{(hypo as any)[h.key]}{h.unit}</div>
                  </div>
                  <input type="range" min={h.min} max={h.max} step={h.step}
                    value={(hypo as any)[h.key]}
                    onChange={e => setHypo(p => ({ ...p, [h.key]: +e.target.value }))}
                    style={{ width: "100%", accentColor: C.orange }} />
                  <div style={{ fontSize: 9, color: C.text3, marginTop: 2 }}>{h.hint}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher une ville…"
              style={{ background: C.card, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.text, padding: "9px 14px", fontSize: 13, flex: 1, minWidth: 120, "::placeholder": { color: C.text3 } } as any} />
            <div style={{ display: "flex", gap: 4 }}>
              {sources.map(s => (
                <button key={s} onClick={() => setFilterSource(s)}
                  style={{ background: filterSource === s ? `${C.orange}20` : C.card, color: filterSource === s ? C.orange : C.text3, border: `1px solid ${filterSource === s ? C.orange + "40" : C.border}`, borderRadius: 8, padding: "8px 12px", cursor: "pointer", fontSize: 11, fontWeight: filterSource === s ? 700 : 400 }}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 4, background: C.card, borderRadius: 10, padding: 4, border: `1px solid ${C.border}`, alignSelf: "flex-start", overflowX: "auto" }}>
            {[["ratio", "Ratio"], ["cout", "Coût/m"], ["decote", "Décote"], ["bouquet", "Bouquet"], ["date", "Récentes"], ["nego", "Négociables"]].map(([k, l]) => (
              <button key={k} onClick={() => setSortBy(k)}
                style={{ background: sortBy === k ? C.orange : "none", color: sortBy === k ? C.white : C.text3, border: "none", borderRadius: 7, padding: "6px 10px", cursor: "pointer", fontSize: 11, fontWeight: sortBy === k ? 700 : 400, whiteSpace: "nowrap" }}>
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* Légende */}
        <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          {[["<70%", C.green, "Excellent"], ["70–85%", C.gold, "Intéressant"], ["85–100%", C.red, "Limite"], [">100%", "#7f1d1d", "Défavorable"]].map(([r, c, l]) => (
            <div key={r as string} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: c as string }} />
              <span style={{ color: c as string, fontWeight: 700 }}>{r}</span>
              <span style={{ color: C.text3 }}>{l}</span>
            </div>
          ))}
          <span style={{ color: C.text3, fontSize: 10, marginLeft: "auto" }}>{sorted.length}/{offres.length}</span>
        </div>

        {/* Grid */}
        {sorted.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 20px" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🏠</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 8 }}>Aucune opportunité</div>
            <div style={{ fontSize: 13, color: C.text3, marginBottom: 24 }}>Importe ta première annonce viager</div>
            <button onClick={() => setShowImport(true)} style={{ background: C.orange, color: C.white, border: "none", borderRadius: 12, padding: "14px 28px", cursor: "pointer", fontSize: 15, fontWeight: 700 }}>
              + Importer une annonce
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "repeat(auto-fill,minmax(320px,1fr))", gap: 12 }}>
            {sorted.map(({ offre, result }) => (
              <Card key={offre.id} offre={offre} result={result} onDetail={setDetail} onFavori={toggleFavori} onRejeter={toggleRejete} onSignal={(o: any) => setSignal({offre: o})} isFavori={favoris.has(offre.id)} />
            ))}
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 32, padding: "14px 18px", background: C.card, borderRadius: 10, fontSize: 10, color: C.text3, border: `1px solid ${C.border}`, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span><strong style={{ color: C.text3 }}>Ratio</strong> = Prix revient / Valeur vénale</span>
          <span><strong style={{ color: C.text3 }}>Coût/m</strong> = Cash flow négatif mensuel</span>
          <span><strong style={{ color: C.text3 }}>Durée</strong> = Espérance vie INSEE</span>
          <span><strong style={{ color: C.text3 }}>Scraping</strong> = Firecrawl · Modèle INSEE 2024</span>
        </div>
      </div>

      {showImport && <ImportModal onClose={() => setShowImport(false)} onImport={addOffre} />}
      {showVocab && <VocabModal onClose={() => setShowVocab(false)} />}
      {detail && <DetailPanel offre={detail} onClose={() => setDetail(null)} />}
      {signal && <SignalModal offre={signal.offre} onClose={() => setSignal(null)} onCorrect={correctOffre} />}
    </div>
  );
}
