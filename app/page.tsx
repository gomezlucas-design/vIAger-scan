"use client";
import { useState, useMemo, useEffect } from "react";

// ─── DESIGN SYSTEM ────────────────────────────────────────────────────────
const C = {
  bg:       "#0D0D0D",
  surface:  "#141414",
  card:     "#1A1A1A",
  border:   "#2A2A2A",
  border2:  "#333333",
  orange:   "#FF6B35",
  orange2:  "#FF8C5A",
  orangeD:  "#CC4A1A",
  gold:     "#F5A623",
  blue:     "#4A9EFF",
  green:    "#34D399",
  red:      "#F87171",
  yellow:   "#FCD34D",
  text:     "#F0F0F0",
  text2:    "#A0A0A0",
  text3:    "#606060",
  white:    "#FFFFFF",
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
  const e1 = o.occupant1Age ? getEsp(o.occupant1Age, o.occupant1Sexe || "F") : 0;
  const e2 = o.occupant2Age ? getEsp(o.occupant2Age, o.occupant2Sexe || "F") : 0;
  const duree = Math.max(e1, e2);
  const libActive = libAns !== null && libAns > 0 && libAns < duree;
  const majRente = o.majorationRenteLiberation ?? 0.30;
  const loyer = (o.loyerMensuelManuel && o.loyerMensuelManuel > 0)
    ? o.loyerMensuelManuel : loyerEst(o.ville, o.superficie);

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
    const r0 = (o.rente || 0) * 12 * Math.pow(1 + inf, y - 1);
    const renteY = r0 * fOcc + r0 * (1 + majRente) * fLib;
    rentes += renteY;
    const tfY = tf * Math.pow(1 + tfTx, y - 1) * frac
              + tf * 0.15 * Math.pow(1 + tfTx, y - 1) * fLib;
    tfTot += tfY;
    const cY = chargesAnn * Math.pow(1 + inf, y - 1);
    const chgY = cY * ventil * fOcc + cY * fLib;
    chg += chgY;
    const loyY = loyer * 12 * Math.pow(1 + inf, y - 1) * fLib;
    loyers += loyY;
    flows.push(-renteY - tfY - chgY + loyY);
  }

  const prixBrut = (o.bouquet || 0) + rentes + tfTot + chg;
  const prixNet = prixBrut - loyers;
  const vv = o.valeurVenale || 0;
  if (vv > 0 && flows.length > 1) flows[flows.length - 1] += vv;

  // Coût mensuel net = cash flow négatif moyen sur la durée occupée
  const dureeOccMois = (libActive ? libAns! : duree) * 12;
  const coutMensuelOcc = dureeOccMois > 0
    ? ((o.bouquet || 0) / dureeOccMois) + (o.rente || 0) + (tf + chargesAnn * ventil) / 12
    : 0;

  // Post libération: coût mensuel - loyer
  const dureeLibMois = libActive ? (duree - libAns!) * 12 : 0;
  const coutMensuelLib = dureeLibMois > 0
    ? ((o.rente || 0) * (1 + majRente)) + (tf + chargesAnn) / 12 - loyer
    : null;

  // Point d'équilibre: à partir de quand loyer > charges post-lib
  const chargesMensuellesLib = ((o.rente || 0) * (1 + majRente)) + (tf + chargesAnn) / 12;
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
    duree, libActive, totalRentes: rentes, tfTotal: tfTot,
    chgTotal: chg, loyers, loyerMensuelEffectif: loyer,
    prixBrut, prixNet,
    ratio: vv > 0 ? prixNet / vv : null,
    decote: vv > 0 ? (vv - prixNet) / vv : null,
    anneesOcc: libActive ? libAns : duree,
    anneesLib: libActive ? duree - libAns! : 0,
    tri: computeIRR(flows) * 100,
    van: computeNPV(flows, 0.04),
    flows,
    coutMensuelOcc,
    coutMensuelLib,
    equilibreAtteint,
    chargesMensuellesLib,
    ageJours, hasPriceDrop, negoScore, negoLabel, negoColor,
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
  { id:1, source:"SeLoger", ville:"Paris 15 – Lourmel", superficie:56, valeurVenale:480000, bouquet:249000, rente:1377, occupant1Age:81, occupant1Sexe:"H", taxeFonciere:450, chargesCopro:960, tauxInflation:0.03, tauxCroissanceTF:0.04, datePublication:"2026-04-01", url:"https://www.seloger.com/annonces/achat/appartement/paris-15eme-75/", note:"T2 56m² viager occupé H 81 ans", priceHistory:[{date:"2026-04-01",bouquet:265000,rente:1400},{date:"2026-06-20",bouquet:249000,rente:1377}] },
  { id:2, source:"Renée Costes", ville:"Toulon", superficie:51, valeurVenale:145000, bouquet:18500, rente:435, occupant1Age:74, occupant1Sexe:"F", taxeFonciere:804, chargesCopro:828, tauxInflation:0.03, tauxCroissanceTF:0.04, datePublication:"2025-12-01", url:"https://www.costes-viager.com/acheter/annonces", note:"Quartier des Lices", priceHistory:[{date:"2025-12-01",bouquet:20000,rente:450},{date:"2026-02-15",bouquet:18500,rente:435}] },
  { id:3, source:"SeLoger", ville:"Essonne – RER B", superficie:45, valeurVenale:136222, bouquet:70316, rente:750, occupant1Age:79, occupant1Sexe:"H", taxeFonciere:300, chargesCopro:600, tauxInflation:0.03, tauxCroissanceTF:0.04, datePublication:"2026-05-15", url:"https://www.seloger.com/recherche/achat/appartement/viager/ile-de-france/essonne-91/", note:"Décote 36%, 2 pièces pied RER B", priceHistory:[{date:"2026-05-15",bouquet:70316,rente:750}] },
];

// ─── Formatters ───────────────────────────────────────────────────────────
const fmt = (n: any) => n != null ? Math.round(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }) : "—";
const fmtPct = (n: any) => n != null ? (n * 100).toFixed(1) + "%" : "—";
const fmtYrs = (n: any) => n != null ? n.toFixed(1) + " ans" : "—";
const fmtTRI = (n: any) => (n != null && isFinite(n)) ? n.toFixed(2) + "%" : "—";
const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtAge = (days: number) => days === 0 ? "Aujourd'hui" : days < 30 ? `${days}j` : days < 365 ? `${Math.floor(days/30)}m` : `${Math.floor(days/365)}a`;

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

  const resBase = useMemo(() => computeViager(offre), [offre]);
  const resLib = useMemo(() => libEnabled ? computeViager(offre, libAns) : null, [offre, libEnabled, libAns]);
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
                <div style={{ fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 14 }}>Période occupée — Cash Flow mensuel</div>
                <div style={{ fontSize: 36, fontWeight: 900, color: C.red, marginBottom: 4 }}>
                  -{fmt(Math.round(resBase.coutMensuelOcc))}<span style={{ fontSize: 14, fontWeight: 400, color: C.text3 }}>/mois</span>
                </div>
                <div style={{ fontSize: 11, color: C.text3, marginBottom: 16 }}>Effort financier mensuel moyen sur {fmtYrs(resBase.duree)}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    ["Amortissement bouquet", Math.round((offre.bouquet || 0) / ((resBase.duree || 1) * 12))],
                    ["Rente mensuelle", offre.rente || 0],
                    ["Taxe foncière (÷12)", Math.round((offre.taxeFonciere || 0) / 12)],
                    ["Charges acquéreur (÷12)", Math.round(((offre.chargesCopro || 0) * (offre.ventilationCharges || 0.33)) / 12)],
                  ].map(([k, v]) => (
                    <div key={k as string} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "8px 12px", background: C.surface, borderRadius: 8 }}>
                      <span style={{ color: C.text2 }}>{k}</span>
                      <span style={{ color: C.red, fontWeight: 600 }}>-{fmt(v as number)}</span>
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
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
                      {[
                        ["Majoration rente", `+${((offre.majorationRenteLiberation || 0.30) * 100).toFixed(0)}%`, C.yellow],
                        ["Charges", "100% acquéreur", C.yellow],
                        ["Loyer estimé", `${fmt(resLib?.loyerMensuelEffectif || 0)}/m`, C.green],
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
                {[
                  { label: "Occupé à vie", result: resBase, color: scoreColor(resBase.ratio), active: true },
                  { label: libEnabled ? `Libéré an ${libAns}` : "Scénario libération", result: resLib || resBase, color: resLib ? scoreColor(resLib.ratio) : C.border2, active: !!resLib },
                ].map(({ label, result, color, active }) => (
                  <div key={label} style={{ background: C.card, borderRadius: 12, padding: 16, border: `1px solid ${active ? color + "40" : C.border}`, opacity: active ? 1 : 0.4 }}>
                    <div style={{ fontSize: 10, color: C.text3, marginBottom: 8, textTransform: "uppercase" }}>{label}</div>
                    <div style={{ fontSize: 26, fontWeight: 900, color }}>{fmtPct(result.ratio)}</div>
                    <div style={{ fontSize: 11, color: C.text3, marginTop: 4 }}>{fmt(result.prixNet)}</div>
                    <div style={{ fontSize: 11, color: C.text3, marginTop: 2 }}>-{fmt(Math.round(result.coutMensuelOcc))}/m</div>
                    <div style={{ fontSize: 11, color: C.blue, marginTop: 2 }}>TRI {fmtTRI(result.tri)}</div>
                    {resLib && label.includes("Libéré") && (
                      <div style={{ fontSize: 11, marginTop: 6, fontWeight: 700, color: resLib.ratio < resBase.ratio ? C.green : C.red }}>
                        {resLib.ratio < resBase.ratio ? "▲ Meilleur ratio" : "▼ Ratio moins bon"}
                      </div>
                    )}
                  </div>
                ))}
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
function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: (o: any) => void }) {
  const [url, setUrl] = useState("");
  const [step, setStep] = useState("input");
  const [errMsg, setErrMsg] = useState("");
  const [parsed, setParsed] = useState<any>(null);
  const [edited, setEdited] = useState<any>(null);

  const analyze = async () => {
    if (!url.trim()) return;
    setStep("loading");
    try {
      const result = await importFromAPI(url.trim());
      if (result.error && !result.data) { setErrMsg(result.error); setStep("error"); return; }
      setParsed(result);
      setEdited({ ...result.data, url: url.trim(), source: result.source });
      setStep("form");
    } catch (e: any) { setErrMsg(e.message || "Erreur inconnue"); setStep("error"); }
  };

  const add = () => {
    if (!edited) return;
    onImport({
      ...edited,
      occupant1Age: edited.occupant1Age || 78, occupant1Sexe: edited.occupant1Sexe || "F",
      taxeFonciere: edited.taxeFonciere || 400, chargesCopro: edited.chargesCopro || 800,
      autresCharges: 0, ventilationCharges: 0.33, majorationRenteLiberation: 0.30,
      tauxInflation: 0.03, tauxCroissanceTF: 0.04, loyerMensuelManuel: null,
      datePublication: new Date().toISOString().slice(0, 10),
      note: edited.note || `Importé via ${edited.source}`,
      priceHistory: [{ date: new Date().toISOString().slice(0, 10), bouquet: edited.bouquet, rente: edited.rente }],
    });
    onClose();
  };

  const upd = (k: string, v: any) => setEdited((p: any) => ({ ...p, [k]: v }));
  const field = (label: string, key: string, type = "number") => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 10, color: C.text3, textTransform: "uppercase", letterSpacing: ".06em" }}>{label}</label>
      <input type={type} value={edited?.[key] ?? ""} onChange={e => upd(key, type === "number" ? (e.target.value === "" ? "" : +e.target.value) : e.target.value)}
        style={{ background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 8, color: C.text, padding: "10px 14px", fontSize: 13, width: "100%" }} />
    </div>
  );
  const reset = () => { setStep("input"); setUrl(""); setErrMsg(""); setParsed(null); setEdited(null); };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.92)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 200, padding: 0 }} onClick={onClose}>
      <div style={{ background: C.surface, borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 620, maxHeight: "90vh", overflowY: "auto", border: `1px solid ${C.border}`, borderBottom: "none" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 0" }}>
          <div style={{ width: 36, height: 4, background: C.border2, borderRadius: 2 }} />
        </div>
        <div style={{ padding: "16px 20px 28px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: C.text }}>Importer une annonce</div>
            <button onClick={onClose} style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text3, cursor: "pointer", fontSize: 16, borderRadius: 10, width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>

          {step === "input" && (
            <div>
              <div style={{ fontSize: 11, color: C.text3, marginBottom: 8 }}>Colle l'URL d'une annonce viager</div>
              <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && analyze()}
                placeholder="https://www.seloger.com/annonces/..."
                style={{ background: C.card, border: `1px solid ${C.border2}`, borderRadius: 10, color: C.text, padding: "13px 16px", fontSize: 14, width: "100%", marginBottom: 12 }} />
              <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
                {[["SeLoger", C.blue], ["Renée Costes", C.gold], ["LeBonCoin", C.green], ["PAP", "#a78bfa"]].map(([s, c]) => (
                  <span key={s as string} style={{ background: `${c}18`, color: c as string, border: `1px solid ${c}30`, borderRadius: 20, padding: "3px 10px", fontSize: 10, fontWeight: 600 }}>{s}</span>
                ))}
              </div>
              <button onClick={analyze} disabled={!url.trim()}
                style={{ background: C.orange, color: C.white, border: "none", borderRadius: 12, padding: "14px 20px", cursor: "pointer", fontSize: 15, fontWeight: 700, width: "100%", opacity: url.trim() ? 1 : 0.4, letterSpacing: ".02em" }}>
                Analyser →
              </button>
            </div>
          )}

          {step === "loading" && (
            <div style={{ textAlign: "center", padding: "40px 0" }}>
              <div style={{ fontSize: 36, marginBottom: 14 }}>⏳</div>
              <div style={{ fontSize: 15, color: C.text2, fontWeight: 600 }}>Analyse en cours…</div>
              <div style={{ fontSize: 11, color: C.text3, marginTop: 8 }}>Firecrawl scrape l'annonce · Extraction des données</div>
            </div>
          )}

          {step === "error" && (
            <div>
              <div style={{ background: `${C.red}15`, border: `1px solid ${C.red}30`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.red, marginBottom: 4 }}>Erreur d'import</div>
                <div style={{ fontSize: 11, color: C.text3 }}>{errMsg}</div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={() => { setStep("form"); setEdited({ url, source: "Manuel" }); }}
                  style={{ flex: 1, background: C.card, color: C.text2, border: `1px solid ${C.border2}`, borderRadius: 10, padding: "12px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  Saisie manuelle
                </button>
                <button onClick={reset} style={{ flex: 1, background: "none", border: `1px solid ${C.border}`, color: C.text3, borderRadius: 10, padding: "12px", cursor: "pointer", fontSize: 13 }}>Réessayer</button>
              </div>
            </div>
          )}

          {step === "form" && (
            <div>
              {parsed && (
                <div style={{ background: `${C.green}12`, border: `1px solid ${C.green}25`, borderRadius: 10, padding: 12, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, color: C.green, fontWeight: 700 }}>
                    ✅ {parsed.source} — {Math.round((parsed.confidence || 0) * 100)}% des champs extraits
                  </div>
                  <div style={{ fontSize: 10, color: C.text3, marginTop: 3 }}>Complète les champs manquants ci-dessous</div>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                {field("Ville", "ville", "text")}{field("Superficie (m²)", "superficie")}
                {field("Bouquet (€)", "bouquet")}{field("Rente mensuelle (€)", "rente")}
                {field("Âge occupant", "occupant1Age")}{field("Valeur vénale (€)", "valeurVenale")}
                {field("Taxe foncière (€/an)", "taxeFonciere")}{field("Charges copro (€/an)", "chargesCopro")}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={add} style={{ flex: 1, background: C.orange, color: C.white, border: "none", borderRadius: 12, padding: "14px", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
                  Ajouter au portefeuille
                </button>
                <button onClick={reset} style={{ background: C.card, color: C.text3, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px", cursor: "pointer", fontSize: 13 }}>←</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Card ──────────────────────────────────────────────────────────────────
function Card({ offre, result, onDetail, onDelete }: any) {
  const { prixNet, ratio, duree, coutMensuelOcc, negoLabel, negoColor, negoScore, hasPriceDrop, ageJours } = result;
  const col = scoreColor(ratio);

  return (
    <div style={{ background: C.card, borderRadius: 16, overflow: "hidden", border: `1px solid ${C.border}`, cursor: "pointer", transition: "all .18s" }}
      onMouseEnter={e => { (e.currentTarget as any).style.borderColor = C.orange + "60"; (e.currentTarget as any).style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { (e.currentTarget as any).style.borderColor = C.border; (e.currentTarget as any).style.transform = "translateY(0)"; }}
      onClick={() => onDetail(offre)}>

      <div style={{ height: 2, background: `linear-gradient(90deg, ${col}, ${col}44)` }} />

      <div style={{ padding: 16 }}>
        {/* Top row */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{offre.ville || "Ville inconnue"}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 10, color: offre.source === "Renée Costes" ? C.gold : C.orange }}>{offre.source}</span>
              {ageJours > 0 && <span style={{ fontSize: 10, color: C.text3 }}>· {fmtAge(ageJours)}</span>}
              {hasPriceDrop && <Badge color={C.green}>↓ Prix</Badge>}
              {negoScore >= 2 && <Badge color={negoColor}>{negoLabel}</Badge>}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
            <div style={{ fontSize: 24, fontWeight: 900, color: col, lineHeight: 1 }}>{fmtPct(ratio)}</div>
            <div style={{ fontSize: 9, color: col, fontWeight: 700, textTransform: "uppercase", marginTop: 2 }}>{scoreLabel(ratio)}</div>
          </div>
        </div>

        {/* Métriques principales */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <div style={{ background: C.surface, borderRadius: 10, padding: "10px 12px", border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 9, color: C.text3, textTransform: "uppercase", marginBottom: 4 }}>Coût mensuel</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: C.red }}>-{fmt(Math.round(coutMensuelOcc))}</div>
            <div style={{ fontSize: 9, color: C.text3 }}>cash flow / mois</div>
          </div>
          <div style={{ background: C.surface, borderRadius: 10, padding: "10px 12px", border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 9, color: C.text3, textTransform: "uppercase", marginBottom: 4 }}>Prix revient</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: col }}>{fmt(prixNet)}</div>
            <div style={{ fontSize: 9, color: C.text3 }}>sur {fmtYrs(duree)}</div>
          </div>
        </div>

        {/* Secondaires */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: 12 }}>
          {[
            ["Bouquet", fmt(offre.bouquet)],
            ["Rente", offre.rente ? fmt(offre.rente) + "/m" : "—"],
            ["Durée", fmtYrs(duree)],
          ].map(([k, v]) => (
            <div key={k as string} style={{ background: C.surface, borderRadius: 8, padding: "7px 8px" }}>
              <div style={{ fontSize: 8, color: C.text3, textTransform: "uppercase" }}>{k}</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.text2, marginTop: 1 }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={e => { e.stopPropagation(); onDetail(offre); }}
            style={{ flex: 1, background: `${C.orange}15`, color: C.orange, border: `1px solid ${C.orange}25`, borderRadius: 10, padding: "9px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
            Détail complet
          </button>
          {offre.url && (
            <a href={offre.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              style={{ background: C.surface, color: C.text3, border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 12px", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>
              🔗
            </a>
          )}
          <button onClick={e => { e.stopPropagation(); onDelete(offre.id); }}
            style={{ background: C.surface, color: C.text3, border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 10px", fontSize: 11, cursor: "pointer" }}>
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────
export default function ViagerScan() {
  const [offres, setOffres] = useState<any[]>(SEED);
  const [sortBy, setSortBy] = useState("ratio");
  const [filterSource, setFilterSource] = useState("Tous");
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    const check = () => setMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const computed = useMemo(() => offres.map(o => ({ offre: o, result: computeViager(o) })), [offres]);

  const sorted = useMemo(() => {
    let list = [...computed];
    if (filterSource !== "Tous") list = list.filter(x => x.offre.source === filterSource);
    if (search.trim()) list = list.filter(x => x.offre.ville?.toLowerCase().includes(search.toLowerCase()));
    list.sort((a, b) => {
      if (sortBy === "ratio") return (a.result.ratio ?? 99) - (b.result.ratio ?? 99);
      if (sortBy === "cout") return (a.result.coutMensuelOcc || 0) - (b.result.coutMensuelOcc || 0);
      if (sortBy === "decote") return (b.result.decote ?? -99) - (a.result.decote ?? -99);
      if (sortBy === "bouquet") return (a.offre.bouquet || 0) - (b.offre.bouquet || 0);
      if (sortBy === "nego") return b.result.negoScore - a.result.negoScore;
      return 0;
    });
    return list;
  }, [computed, sortBy, filterSource, search]);

  const addOffre = (o: any) => setOffres(p => [...p, { ...o, id: Math.max(0, ...p.map((x: any) => x.id)) + 1 }]);
  const delOffre = (id: number) => setOffres(p => p.filter((o: any) => o.id !== id));
  const sources = ["Tous", ...Array.from(new Set(offres.map(o => o.source)))];

  const validRatios = computed.map(x => x.result.ratio).filter(Boolean) as number[];
  const bestRatio = validRatios.length ? Math.min(...validRatios) : null;
  const avgCout = computed.length ? computed.reduce((s, x) => s + (x.result.coutMensuelOcc || 0), 0) / computed.length : null;
  const negoCount = computed.filter(x => x.result.negoScore >= 2).length;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "-apple-system, 'SF Pro Display', 'Inter', system-ui, sans-serif" }}>

      {/* Header sticky */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.border}`, padding: `0 ${mobile ? 14 : 24}px`, position: "sticky", top: 0, zIndex: 50, backdropFilter: "blur(10px)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, background: `linear-gradient(135deg, ${C.orange}, ${C.orangeD})`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🏠</div>
            <div>
              <span style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-.03em", color: C.text }}>viager</span>
              <span style={{ fontSize: 17, fontWeight: 900, letterSpacing: "-.03em", color: C.orange }}>scan</span>
            </div>
            <span style={{ fontSize: 9, color: C.text3, background: C.card, padding: "2px 7px", borderRadius: 20, border: `1px solid ${C.border}`, fontWeight: 600 }}>BETA</span>
          </div>
          <button onClick={() => setShowImport(true)}
            style={{ background: C.orange, color: C.white, border: "none", borderRadius: 10, padding: mobile ? "8px 16px" : "9px 20px", cursor: "pointer", fontSize: mobile ? 13 : 13, fontWeight: 700, letterSpacing: ".02em" }}>
            {mobile ? "+ Importer" : "+ Importer une annonce"}
          </button>
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
            <div key={s.label} style={{ background: C.card, borderRadius: 12, padding: "14px 16px", border: `1px solid ${C.border}`, borderLeft: `2px solid ${s.color}` }}>
              <div style={{ fontSize: 9, color: C.text3, textTransform: "uppercase", letterSpacing: ".07em", marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontSize: mobile ? 18 : 22, fontWeight: 900, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 9, color: C.text3, marginTop: 3 }}>{s.sub}</div>
            </div>
          ))}
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

          <div style={{ display: "flex", gap: 4, background: C.card, borderRadius: 10, padding: 4, border: `1px solid ${C.border}`, alignSelf: "flex-start" }}>
            {[["ratio", "Ratio"], ["cout", "Coût/m"], ["decote", "Décote"], ["bouquet", "Bouquet"], ["nego", "Négociables"]].map(([k, l]) => (
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
              <Card key={offre.id} offre={offre} result={result} onDetail={setDetail} onDelete={delOffre} />
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
      {detail && <DetailPanel offre={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
