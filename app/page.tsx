"use client";
import { useState, useMemo } from "react";

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

// ─── Seed data ────────────────────────────────────────────────────────────
const SEED: any[] = [
  { id:1, source:"SeLoger", ville:"Paris 15 – Lourmel", superficie:56, valeurVenale:480000, bouquet:249000, rente:1377, occupant1Age:81, occupant1Sexe:"H", taxeFonciere:450, chargesCopro:960, tauxInflation:0.03, tauxCroissanceTF:0.04, datePublication:"2026-06-20", url:"https://www.seloger.com/annonces/achat/appartement/paris-15eme-75/", note:"T2 56m² viager occupé H 81 ans", priceHistory:[{date:"2026-06-20",bouquet:249000,rente:1377}] },
  { id:2, source:"Renée Costes", ville:"Toulon", superficie:51, valeurVenale:145000, bouquet:18500, rente:435, occupant1Age:74, occupant1Sexe:"F", taxeFonciere:804, chargesCopro:828, tauxInflation:0.03, tauxCroissanceTF:0.04, datePublication:"2025-12-01", url:"https://www.costes-viager.com/acheter/annonces", note:"Quartier des Lices", priceHistory:[{date:"2025-12-01",bouquet:20000,rente:450},{date:"2026-02-15",bouquet:18500,rente:435}] },
  { id:3, source:"SeLoger", ville:"Essonne – RER B", superficie:45, valeurVenale:136222, bouquet:70316, rente:750, occupant1Age:79, occupant1Sexe:"H", taxeFonciere:300, chargesCopro:600, tauxInflation:0.03, tauxCroissanceTF:0.04, datePublication:"2026-06-15", url:"https://www.seloger.com/recherche/achat/appartement/viager/ile-de-france/essonne-91/", note:"Décote 36%, 2 pièces pied RER B", priceHistory:[{date:"2026-06-15",bouquet:70316,rente:750}] },
];

// ─── Formatters ───────────────────────────────────────────────────────────
const fmt = (n: any) => n != null ? Math.round(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }) : "—";
const fmtPct = (n: any) => n != null ? (n * 100).toFixed(1) + "%" : "—";
const fmtYrs = (n: any) => n != null ? n.toFixed(1) + " ans" : "—";
const fmtTRI = (n: any) => (n != null && isFinite(n)) ? n.toFixed(2) + "%" : "—";
const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const scoreColor = (r: any) => r === null ? "#6b7280" : r < 0.70 ? "#16a34a" : r < 0.85 ? "#ca8a04" : r < 1.0 ? "#dc2626" : "#7f1d1d";
const scoreLabel = (r: any) => r === null ? "N/A" : r < 0.70 ? "Excellent" : r < 0.85 ? "Intéressant" : r < 1.0 ? "Limite" : "Défavorable";
const scoreBg = (r: any) => r === null ? "#6b728015" : r < 0.70 ? "#16a34a15" : r < 0.85 ? "#ca8a0415" : r < 1.0 ? "#dc262615" : "#7f1d1d15";

// ─── Detail Panel ─────────────────────────────────────────────────────────
function DetailPanel({ offre, onClose }: { offre: any; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState("analyse");
  const [libEnabled, setLibEnabled] = useState(false);
  const e1 = offre.occupant1Age ? getEsp(offre.occupant1Age, offre.occupant1Sexe || "F") : 0;
  const e2 = offre.occupant2Age ? getEsp(offre.occupant2Age, offre.occupant2Sexe || "F") : 0;
  const dureeMax = Math.max(e1, e2);
  const [libAns, setLibAns] = useState(Math.round(dureeMax * 0.5));

  const resBase = useMemo(() => computeViager(offre, null), [offre]);
  const resLib = useMemo(() => libEnabled ? computeViager(offre, libAns) : null, [offre, libEnabled, libAns]);
  const res = resLib || resBase;
  const col = scoreColor(res.ratio);
  const loyer = res.loyerMensuelEffectif;

  const tabs = [
    { id: "analyse", label: "📊 Analyse" },
    { id: "liberation", label: "⚡ Libération" },
    { id: "historique", label: "📅 Historique" },
    { id: "detail", label: "🏠 Bien" },
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 12 }} onClick={onClose}>
      <div style={{ background: "#0f172a", borderRadius: 16, width: "min(98vw,680px)", maxHeight: "94vh", overflowY: "auto", border: "1px solid #1e293b", boxShadow: "0 40px 80px rgba(0,0,0,.8)" }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: "20px 24px 0", borderBottom: "1px solid #1e293b" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#f1f5f9" }}>{offre.ville}</div>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>
                {offre.superficie ? `${offre.superficie} m² · ` : ""}
                <span style={{ color: offre.source === "Renée Costes" ? "#fbbf24" : "#60a5fa" }}>{offre.source}</span>
                {offre.agence ? ` · ${offre.agence}` : ""}
                {" · "}
                <span style={{ color: "#475569" }}>Publié le {fmtDate(offre.datePublication)}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {offre.url && (
                <a href={offre.url} target="_blank" rel="noreferrer"
                  style={{ background: "#1e293b", color: "#93c5fd", border: "1px solid #334155", borderRadius: 8, padding: "6px 12px", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>
                  🔗 Voir l'annonce
                </a>
              )}
              <button onClick={onClose} style={{ background: "#1e293b", border: "1px solid #334155", color: "#64748b", cursor: "pointer", fontSize: 18, borderRadius: 8, width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>
          </div>

          {/* Score hero */}
          <div style={{ background: scoreBg(res.ratio), border: `1px solid ${col}30`, borderRadius: 12, padding: "14px 18px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4, textTransform: "uppercase", letterSpacing: ".06em" }}>Prix de revient / Valeur vénale</div>
              <div style={{ fontSize: 36, fontWeight: 900, color: col, lineHeight: 1 }}>{fmtPct(res.ratio)}</div>
              <div style={{ fontSize: 12, color: col, fontWeight: 600, marginTop: 4 }}>{scoreLabel(res.ratio)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Sur {fmtYrs(res.duree)}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#60a5fa" }}>{fmtTRI(res.tri)}</div>
              <div style={{ fontSize: 10, color: "#64748b" }}>TRI</div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 2 }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                style={{ background: activeTab === t.id ? "#1e293b" : "none", color: activeTab === t.id ? "#f1f5f9" : "#64748b", border: "none", borderRadius: "8px 8px 0 0", padding: "8px 14px", cursor: "pointer", fontSize: 12, fontWeight: activeTab === t.id ? 700 : 400, borderBottom: activeTab === t.id ? "2px solid #3b82f6" : "2px solid transparent" }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: 24 }}>

          {/* ── TAB ANALYSE ── */}
          {activeTab === "analyse" && (
            <div>
              {/* KPIs */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 20 }}>
                {[
                  ["TRI", fmtTRI(res.tri), "#60a5fa", "Taux Rendement Interne"],
                  ["VAN", fmt(res.van), res.van >= 0 ? "#34d399" : "#f87171", "Valeur Actuelle Nette (4%)"],
                  ["Durée", fmtYrs(res.duree), "#fbbf24", "Espérance de vie INSEE"],
                  ["Bouquet", fmt(offre.bouquet), "#f1f5f9", "Capital initial"],
                  ["Rente", fmt(offre.rente) + "/m", "#f1f5f9", "Rente mensuelle"],
                  ["Décote", fmtPct(res.decote), res.decote > 0 ? "#34d399" : "#f87171", "vs valeur vénale"],
                ].map(([k, v, c, sub]) => (
                  <div key={k as string} style={{ background: "#1e293b", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 4 }}>{k}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: c as string }}>{v}</div>
                    <div style={{ fontSize: 9, color: "#475569", marginTop: 3 }}>{sub}</div>
                  </div>
                ))}
              </div>

              {/* Décomposition */}
              <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 12 }}>Décomposition du prix de revient</div>
                {[
                  ["Bouquet", offre.bouquet || 0],
                  ["Rentes cumulées (indexées)", res.totalRentes],
                  ["Taxe foncière cumulée", res.tfTotal],
                  ["Charges acquéreur cumulées", res.chgTotal],
                ].map(([label, val]) => {
                  const total = res.prixBrut || 1;
                  const pct = ((val as number) / total * 100).toFixed(0);
                  return (
                    <div key={label as string} style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                        <span style={{ color: "#94a3b8" }}>{label}</span>
                        <span style={{ color: "#f1f5f9", fontWeight: 600 }}>{fmt(val as number)} <span style={{ color: "#475569", fontWeight: 400 }}>({pct}%)</span></span>
                      </div>
                      <div style={{ background: "#0f172a", borderRadius: 4, height: 4 }}>
                        <div style={{ background: "#3b82f6", borderRadius: 4, height: 4, width: `${pct}%`, transition: "width .5s" }} />
                      </div>
                    </div>
                  );
                })}
                <div style={{ borderTop: "1px solid #334155", paddingTop: 10, display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 800 }}>
                  <span style={{ color: "#cbd5e1" }}>Prix de revient total</span>
                  <span style={{ color: col }}>{fmt(res.prixNet)}</span>
                </div>
              </div>

              {/* Loyer estimé */}
              {loyer > 0 && (
                <div style={{ background: "#1e293b", borderRadius: 10, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>Loyer marché estimé (fourchette basse)</div>
                    <div style={{ fontSize: 10, color: "#475569", marginTop: 2 }}>Si libération anticipée du bien</div>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: "#34d399" }}>{fmt(loyer)}/mois</div>
                </div>
              )}
            </div>
          )}

          {/* ── TAB LIBÉRATION ── */}
          {activeTab === "liberation" && (
            <div>
              <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: libEnabled ? 16 : 0 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#93c5fd" }}>Libération anticipée</div>
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>Simuler si l'occupant quitte le bien avant son décès</div>
                  </div>
                  <button onClick={() => setLibEnabled(p => !p)}
                    style={{ background: libEnabled ? "#1d4ed8" : "#334155", color: "#fff", border: "none", borderRadius: 20, padding: "6px 16px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
                    {libEnabled ? "✓ Activée" : "Activer"}
                  </button>
                </div>

                {libEnabled && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                      <div style={{ flex: 1 }}>
                        <input type="range" min={1} max={Math.max(1, Math.floor(dureeMax - 0.5))} step={0.5}
                          value={libAns} onChange={e => setLibAns(+e.target.value)}
                          style={{ width: "100%", accentColor: "#3b82f6" }} />
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#475569", marginTop: 2 }}>
                          <span>An 1</span>
                          <span>Esp. vie {fmtYrs(dureeMax)}</span>
                        </div>
                      </div>
                      <div style={{ background: "#0f172a", borderRadius: 10, padding: "10px 16px", textAlign: "center", minWidth: 80 }}>
                        <div style={{ fontSize: 22, fontWeight: 900, color: "#93c5fd" }}>{libAns}</div>
                        <div style={{ fontSize: 9, color: "#475569" }}>ans</div>
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 16 }}>
                      {[
                        ["Majoration rente", `+${((offre.majorationRenteLiberation || 0.30) * 100).toFixed(0)}%`, "#fbbf24"],
                        ["Charges post-lib.", "100% acquéreur", "#fbbf24"],
                        ["Loyer estimé", `${fmt(loyer)}/m`, "#34d399"],
                      ].map(([k, v, c]) => (
                        <div key={k as string} style={{ background: "#0f172a", borderRadius: 8, padding: "10px 12px" }}>
                          <div style={{ fontSize: 9, color: "#64748b", marginBottom: 3 }}>{k}</div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: c as string }}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Comparaison */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, border: `1px solid ${scoreColor(resBase.ratio)}30` }}>
                  <div style={{ fontSize: 10, color: "#64748b", marginBottom: 6, textTransform: "uppercase" }}>Occupé à vie</div>
                  <div style={{ fontSize: 28, fontWeight: 900, color: scoreColor(resBase.ratio) }}>{fmtPct(resBase.ratio)}</div>
                  <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{fmt(resBase.prixNet)}</div>
                  <div style={{ fontSize: 11, color: "#60a5fa", marginTop: 2 }}>TRI {fmtTRI(resBase.tri)}</div>
                </div>
                {resLib && (
                  <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, border: `1px solid ${scoreColor(resLib.ratio)}30` }}>
                    <div style={{ fontSize: 10, color: "#93c5fd", marginBottom: 6, textTransform: "uppercase" }}>Lib. an {libAns}</div>
                    <div style={{ fontSize: 28, fontWeight: 900, color: scoreColor(resLib.ratio) }}>{fmtPct(resLib.ratio)}</div>
                    <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{fmt(resLib.prixNet)} net</div>
                    <div style={{ fontSize: 11, marginTop: 2, fontWeight: 700, color: resLib.tri > resBase.tri ? "#34d399" : "#f87171" }}>
                      {resLib.tri > resBase.tri ? "▲" : "▼"} TRI {fmtTRI(resLib.tri)}
                    </div>
                  </div>
                )}
              </div>

              {!libEnabled && (
                <div style={{ textAlign: "center", color: "#475569", fontSize: 12, padding: 20 }}>
                  Active la libération anticipée pour voir la comparaison
                </div>
              )}
            </div>
          )}

          {/* ── TAB HISTORIQUE ── */}
          {activeTab === "historique" && (
            <div>
              <div style={{ background: "#1e293b", borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 14 }}>Historique des prix</div>
                {(offre.priceHistory || [{ date: offre.datePublication, bouquet: offre.bouquet, rente: offre.rente }]).map((h: any, i: number, arr: any[]) => {
                  const prev = arr[i - 1];
                  const baisseB = prev && h.bouquet < prev.bouquet;
                  const baisseR = prev && h.rente < prev.rente;
                  return (
                    <div key={i} style={{ display: "flex", gap: 14, marginBottom: 14, paddingBottom: 14, borderBottom: i < arr.length - 1 ? "1px solid #334155" : "none" }}>
                      <div style={{ width: 2, background: i === arr.length - 1 ? "#3b82f6" : "#334155", borderRadius: 2, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>
                          {fmtDate(h.date)}
                          {i === 0 && <span style={{ background: "#1d4ed830", color: "#93c5fd", borderRadius: 4, padding: "1px 6px", fontSize: 10, marginLeft: 8 }}>Publication</span>}
                          {i === arr.length - 1 && i > 0 && <span style={{ background: "#16a34a20", color: "#34d399", borderRadius: 4, padding: "1px 6px", fontSize: 10, marginLeft: 8 }}>Actuel</span>}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <div style={{ background: "#0f172a", borderRadius: 7, padding: "8px 12px" }}>
                            <div style={{ fontSize: 9, color: "#64748b" }}>Bouquet</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: baisseB ? "#34d399" : "#f1f5f9" }}>
                              {fmt(h.bouquet)}
                              {baisseB && <span style={{ fontSize: 10, marginLeft: 4 }}>▼ {fmt(prev.bouquet - h.bouquet)}</span>}
                            </div>
                          </div>
                          <div style={{ background: "#0f172a", borderRadius: 7, padding: "8px 12px" }}>
                            <div style={{ fontSize: 9, color: "#64748b" }}>Rente</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: baisseR ? "#34d399" : "#f1f5f9" }}>
                              {fmt(h.rente)}/m
                              {baisseR && <span style={{ fontSize: 10, marginLeft: 4 }}>▼ {fmt(prev.rente - h.rente)}</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ background: "#1e293b", borderRadius: 10, padding: "12px 16px", display: "flex", gap: 12, alignItems: "center" }}>
                <div style={{ fontSize: 20 }}>💡</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  Une baisse du bouquet ou de la rente est un signal positif — le vendeur est plus motivé. Surveille l'ancienneté : une annonce déposée depuis {">"}6 mois est négociable.
                </div>
              </div>
            </div>
          )}

          {/* ── TAB BIEN ── */}
          {activeTab === "detail" && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                {[
                  ["Superficie", offre.superficie ? `${offre.superficie} m²` : "—"],
                  ["Valeur vénale", fmt(offre.valeurVenale)],
                  ["Taxe foncière", fmt(offre.taxeFonciere) + "/an"],
                  ["Charges copro", fmt(offre.chargesCopro) + "/an"],
                  ["Occupant 1", offre.occupant1Age ? `${offre.occupant1Age} ans ${offre.occupant1Sexe === "F" ? "♀" : "♂"}` : "—"],
                  ["Occupant 2", offre.occupant2Age ? `${offre.occupant2Age} ans ${offre.occupant2Sexe === "F" ? "♀" : "♂"}` : "—"],
                  ["Inflation hypothèse", ((offre.tauxInflation || 0.03) * 100).toFixed(1) + "%"],
                  ["Croissance TF", ((offre.tauxCroissanceTF || 0.04) * 100).toFixed(1) + "%"],
                ].map(([k, v]) => (
                  <div key={k as string} style={{ background: "#1e293b", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", marginBottom: 4 }}>{k}</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}>{v}</div>
                  </div>
                ))}
              </div>

              {offre.note && (
                <div style={{ background: "#1e293b", borderRadius: 10, padding: "12px 16px", marginBottom: 12 }}>
                  <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", marginBottom: 6 }}>Notes</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>{offre.note}</div>
                </div>
              )}

              {offre.url && (
                <a href={offre.url} target="_blank" rel="noreferrer"
                  style={{ display: "block", background: "#1d4ed8", color: "#fff", borderRadius: 10, padding: "12px 20px", textAlign: "center", textDecoration: "none", fontSize: 13, fontWeight: 700 }}>
                  Contacter l'agence →
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
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <label style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase" }}>{label}</label>
      <input type={type} value={edited?.[key] ?? ""} onChange={e => upd(key, type === "number" ? (e.target.value === "" ? "" : +e.target.value) : e.target.value)}
        style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 7, color: "#f1f5f9", padding: "9px 12px", fontSize: 13, width: "100%" }} />
    </div>
  );
  const reset = () => { setStep("input"); setUrl(""); setErrMsg(""); setParsed(null); setEdited(null); };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }} onClick={onClose}>
      <div style={{ background: "#0f172a", borderRadius: 16, width: "min(95vw,620px)", maxHeight: "90vh", overflowY: "auto", padding: 28, border: "1px solid #1e293b" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>🔗 Importer une annonce</div>
          <button onClick={onClose} style={{ background: "#1e293b", border: "1px solid #334155", color: "#64748b", cursor: "pointer", fontSize: 18, borderRadius: 8, width: 34, height: 34 }}>✕</button>
        </div>

        {step === "input" && (
          <div>
            <label style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", fontWeight: 600, marginBottom: 8, display: "block" }}>URL de l'annonce</label>
            <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === "Enter" && analyze()}
              placeholder="https://www.seloger.com/annonces/... ou costes-viager.com/..."
              style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 10, color: "#f1f5f9", padding: "12px 16px", fontSize: 13, width: "100%", marginBottom: 12 }} />
            <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              {[["SeLoger", "#3b82f6"], ["Renée Costes", "#fbbf24"], ["LeBonCoin", "#34d399"], ["PAP", "#a78bfa"]].map(([s, c]) => (
                <span key={s as string} style={{ background: `${c}20`, color: c as string, border: `1px solid ${c}30`, borderRadius: 20, padding: "3px 10px", fontSize: 11 }}>{s}</span>
              ))}
            </div>
            <button onClick={analyze} disabled={!url.trim()}
              style={{ background: "#3b82f6", color: "#fff", border: "none", borderRadius: 10, padding: "13px 20px", cursor: "pointer", fontSize: 14, fontWeight: 700, width: "100%", opacity: url.trim() ? 1 : 0.4 }}>
              🔍 Analyser
            </button>
          </div>
        )}

        {step === "loading" && (
          <div style={{ textAlign: "center", padding: "50px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
            <div style={{ fontSize: 15, color: "#94a3b8", fontWeight: 600 }}>Analyse en cours…</div>
            <div style={{ fontSize: 12, color: "#475569", marginTop: 8 }}>Firecrawl scrape l'annonce · Extraction des données</div>
          </div>
        )}

        {step === "error" && (
          <div>
            <div style={{ background: "#7f1d1d20", border: "1px solid #7f1d1d50", borderRadius: 12, padding: 16, marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#fca5a5", marginBottom: 6 }}>⚠️ Erreur d'import</div>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>{errMsg}</div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => { setStep("form"); setEdited({ url, source: "Manuel" }); }}
                style={{ flex: 1, background: "#1e293b", color: "#cbd5e1", border: "1px solid #334155", borderRadius: 10, padding: "11px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                ✏️ Saisie manuelle
              </button>
              <button onClick={reset} style={{ flex: 1, background: "none", border: "1px solid #334155", color: "#94a3b8", borderRadius: 10, padding: "11px", cursor: "pointer", fontSize: 13 }}>← Réessayer</button>
            </div>
          </div>
        )}

        {step === "form" && (
          <div>
            {parsed && (
              <div style={{ background: "#1e293b", borderRadius: 10, padding: 14, marginBottom: 16, border: "1px solid #1e3a5f" }}>
                <div style={{ fontSize: 13, color: "#93c5fd", fontWeight: 700, marginBottom: 3 }}>
                  ✅ {parsed.source} — {Math.round((parsed.confidence || 0) * 100)}% des champs extraits automatiquement
                </div>
                <div style={{ fontSize: 11, color: "#475569" }}>Vérifie et complète les champs manquants avant d'ajouter.</div>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
              {field("Ville", "ville", "text")}{field("Superficie (m²)", "superficie")}
              {field("Bouquet (€)", "bouquet")}{field("Rente mensuelle (€)", "rente")}
              {field("Âge occupant", "occupant1Age")}{field("Valeur vénale (€)", "valeurVenale")}
              {field("Taxe foncière (€/an)", "taxeFonciere")}{field("Charges copro (€/an)", "chargesCopro")}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={add} style={{ flex: 1, background: "#16a34a", color: "#fff", border: "none", borderRadius: 10, padding: "13px", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
                ✓ Ajouter au portefeuille
              </button>
              <button onClick={reset} style={{ flex: 1, background: "#1e293b", color: "#cbd5e1", border: "1px solid #334155", borderRadius: 10, padding: "13px", cursor: "pointer", fontSize: 13 }}>← Autre URL</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Card ──────────────────────────────────────────────────────────────────
function Card({ offre, result, onDetail, onDelete }: { offre: any; result: any; onDetail: (o: any) => void; onDelete: (id: number) => void }) {
  const { prixNet, ratio, duree, tri, van, decote } = result;
  const col = scoreColor(ratio);
  const hasHistory = offre.priceHistory && offre.priceHistory.length > 1;
  const lastChange = hasHistory ? offre.priceHistory[offre.priceHistory.length - 2] : null;
  const priceDrop = lastChange && offre.bouquet < lastChange.bouquet;

  return (
    <div style={{ background: "#1e293b", borderRadius: 12, overflow: "hidden", border: "1px solid #334155", transition: "all .2s", cursor: "pointer" }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = col; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "#334155"; (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; }}
      onClick={() => onDetail(offre)}>

      {/* Color bar top */}
      <div style={{ height: 3, background: col }} />

      <div style={{ padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div style={{ flex: 1, marginRight: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#f1f5f9" }}>{offre.ville || "Ville inconnue"}</div>
              {priceDrop && <span style={{ background: "#16a34a20", color: "#34d399", border: "1px solid #16a34a30", borderRadius: 4, fontSize: 9, padding: "1px 5px", fontWeight: 700 }}>↓ Prix baissé</span>}
            </div>
            <div style={{ fontSize: 10, color: "#64748b" }}>
              {offre.superficie ? `${offre.superficie}m² · ` : ""}
              <span style={{ color: offre.source === "Renée Costes" ? "#fbbf24" : "#60a5fa" }}>{offre.source}</span>
              {offre.datePublication ? ` · ${fmtDate(offre.datePublication)}` : ""}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: col }}>{fmtPct(ratio)}</div>
            <div style={{ fontSize: 9, color: col, fontWeight: 700, textTransform: "uppercase" }}>{scoreLabel(ratio)}</div>
          </div>
        </div>

        {/* KPIs row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: 10 }}>
          {[["TRI", fmtTRI(tri), "#60a5fa"], ["VAN", fmt(van), van >= 0 ? "#34d399" : "#f87171"], ["Durée", fmtYrs(duree), "#fbbf24"]].map(([k, v, c]) => (
            <div key={k as string} style={{ background: "#0f172a", borderRadius: 7, padding: "7px 8px" }}>
              <div style={{ fontSize: 8, color: "#64748b", textTransform: "uppercase" }}>{k}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: c as string, marginTop: 1 }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6, marginBottom: 12 }}>
          {[["Bouquet", fmt(offre.bouquet)], ["Rente", offre.rente ? fmt(offre.rente) + "/m" : "—"], ["Prix revient", fmt(prixNet)]].map(([k, v]) => (
            <div key={k as string} style={{ background: "#0f172a", borderRadius: 7, padding: "7px 8px" }}>
              <div style={{ fontSize: 8, color: "#64748b", textTransform: "uppercase" }}>{k}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#f1f5f9", marginTop: 1 }}>{v}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 7 }}>
          <button onClick={e => { e.stopPropagation(); onDetail(offre); }}
            style={{ flex: 1, background: "#3b82f620", color: "#93c5fd", border: "1px solid #3b82f630", borderRadius: 7, padding: "8px 0", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>
            Détail complet
          </button>
          {offre.url && (
            <a href={offre.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
              style={{ background: "#1e3a5f", color: "#93c5fd", border: "1px solid #1d4ed830", borderRadius: 7, padding: "8px 12px", fontSize: 11, fontWeight: 600, textDecoration: "none" }}>
              🔗
            </a>
          )}
          <button onClick={e => { e.stopPropagation(); onDelete(offre.id); }}
            style={{ background: "#0f172a", color: "#64748b", border: "1px solid #1e293b", borderRadius: 7, padding: "8px 10px", fontSize: 11, cursor: "pointer" }}>
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
  const [sortBy, setSortBy] = useState("tri");
  const [filterSource, setFilterSource] = useState("Tous");
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [detail, setDetail] = useState<any>(null);

  const computed = useMemo(() => offres.map(o => ({ offre: o, result: computeViager(o) })), [offres]);

  const sorted = useMemo(() => {
    let list = [...computed];
    if (filterSource !== "Tous") list = list.filter(x => x.offre.source === filterSource);
    if (search.trim()) list = list.filter(x => x.offre.ville?.toLowerCase().includes(search.toLowerCase()));
    list.sort((a, b) => {
      if (sortBy === "tri") return (b.result.tri || -99) - (a.result.tri || -99);
      if (sortBy === "van") return (b.result.van || -1e12) - (a.result.van || -1e12);
      if (sortBy === "ratio") return (a.result.ratio ?? 99) - (b.result.ratio ?? 99);
      if (sortBy === "bouquet") return (a.offre.bouquet || 0) - (b.offre.bouquet || 0);
      return 0;
    });
    return list;
  }, [computed, sortBy, filterSource, search]);

  const addOffre = (o: any) => setOffres(p => [...p, { ...o, id: Math.max(0, ...p.map((x: any) => x.id)) + 1 }]);
  const delOffre = (id: number) => setOffres(p => p.filter((o: any) => o.id !== id));

  const sources = ["Tous", ...Array.from(new Set(offres.map(o => o.source)))];
  const tris = computed.map(x => x.result.tri).filter((t: any) => t != null && isFinite(t));
  const avgTRI = tris.length ? tris.reduce((s: number, t: number) => s + t, 0) / tris.length : null;
  const bestRatio = computed.map(x => x.result.ratio).filter(Boolean).reduce((a: number, b: any) => Math.min(a, b), 99);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0f1e", color: "#f1f5f9", fontFamily: "'Inter',system-ui,sans-serif" }}>

      {/* Header */}
      <div style={{ background: "#0f172a", borderBottom: "1px solid #1e293b", padding: "0 24px", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 1300, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div>
              <span style={{ fontSize: 20, fontWeight: 900, letterSpacing: "-.02em" }}>Viager</span>
              <span style={{ fontSize: 20, fontWeight: 900, color: "#3b82f6" }}>Scan</span>
              <span style={{ fontSize: 10, color: "#475569", marginLeft: 8, background: "#1e293b", padding: "2px 8px", borderRadius: 20 }}>BETA</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {avgTRI != null && (
              <div style={{ background: "#1e293b", borderRadius: 8, padding: "6px 14px", fontSize: 12 }}>
                <span style={{ color: "#64748b" }}>TRI moy. </span>
                <span style={{ color: "#60a5fa", fontWeight: 700 }}>{fmtTRI(avgTRI)}</span>
              </div>
            )}
            {bestRatio < 99 && (
              <div style={{ background: "#1e293b", borderRadius: 8, padding: "6px 14px", fontSize: 12 }}>
                <span style={{ color: "#64748b" }}>Meilleur </span>
                <span style={{ color: scoreColor(bestRatio), fontWeight: 700 }}>{fmtPct(bestRatio)}</span>
              </div>
            )}
            <button onClick={() => setShowImport(true)}
              style={{ background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, padding: "9px 18px", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
              + Importer
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1300, margin: "0 auto", padding: "20px 16px" }}>

        {/* Stats bar */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 24 }}>
          {[
            ["Opportunités", offres.length, "#f1f5f9"],
            ["TRI moyen", fmtTRI(avgTRI), "#60a5fa"],
            ["Meilleur ratio", bestRatio < 99 ? fmtPct(bestRatio) : "—", scoreColor(bestRatio)],
            ["Sources actives", sources.length - 1, "#a78bfa"],
          ].map(([k, v, c]) => (
            <div key={k as string} style={{ background: "#1e293b", borderRadius: 10, padding: "14px 16px", borderLeft: `3px solid ${c}` }}>
              <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>{k}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: c as string }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Rechercher une ville…"
            style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9", padding: "8px 14px", fontSize: 12, width: 200 }} />

          <div style={{ display: "flex", gap: 3, background: "#1e293b", borderRadius: 8, padding: 3 }}>
            {[["tri", "TRI"], ["van", "VAN"], ["ratio", "Ratio"], ["bouquet", "Bouquet"]].map(([k, l]) => (
              <button key={k} onClick={() => setSortBy(k)}
                style={{ background: sortBy === k ? "#3b82f6" : "none", color: sortBy === k ? "#fff" : "#94a3b8", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontSize: 11, fontWeight: sortBy === k ? 700 : 400 }}>
                {l}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 4 }}>
            {sources.map(s => (
              <button key={s} onClick={() => setFilterSource(s)}
                style={{ background: filterSource === s ? "#1d4ed8" : "#1e293b", color: filterSource === s ? "#fff" : "#94a3b8", border: "none", borderRadius: 7, padding: "6px 12px", cursor: "pointer", fontSize: 11 }}>
                {s}
              </button>
            ))}
          </div>

          <div style={{ marginLeft: "auto", fontSize: 11, color: "#475569" }}>
            {sorted.length} / {offres.length} offres
          </div>
        </div>

        {/* Légende */}
        <div style={{ display: "flex", gap: 14, marginBottom: 20, flexWrap: "wrap" }}>
          {[["<70%", "#16a34a", "Excellent"], ["70–85%", "#ca8a04", "Intéressant"], ["85–100%", "#dc2626", "Limite"], [">100%", "#7f1d1d", "Défavorable"]].map(([r, c, l]) => (
            <div key={r as string} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: c as string }} />
              <span style={{ color: c as string, fontWeight: 600 }}>{r}</span>
              <span style={{ color: "#64748b" }}>{l}</span>
            </div>
          ))}
        </div>

        {/* Grid */}
        {sorted.length === 0 ? (
          <div style={{ textAlign: "center", padding: 80 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🏠</div>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Aucune opportunité</div>
            <div style={{ fontSize: 12, color: "#475569", marginBottom: 20 }}>Importe ta première annonce viager</div>
            <button onClick={() => setShowImport(true)} style={{ background: "#3b82f6", color: "#fff", border: "none", borderRadius: 10, padding: "12px 24px", cursor: "pointer", fontSize: 14, fontWeight: 700 }}>
              + Importer une annonce
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 14 }}>
            {sorted.map(({ offre, result }) => (
              <Card key={offre.id} offre={offre} result={result} onDetail={setDetail} onDelete={delOffre} />
            ))}
          </div>
        )}

        <div style={{ marginTop: 32, padding: "14px 20px", background: "#1e293b", borderRadius: 10, fontSize: 11, color: "#475569", display: "flex", gap: 20, flexWrap: "wrap" }}>
          <span><strong style={{ color: "#64748b" }}>TRI</strong> = Taux rendement interne (flux acquéreur + récupération bien)</span>
          <span><strong style={{ color: "#64748b" }}>VAN</strong> = Valeur actuelle nette actualisée à 4%</span>
          <span><strong style={{ color: "#64748b" }}>Ratio</strong> = Prix de revient total / Valeur vénale</span>
          <span><strong style={{ color: "#64748b" }}>Données</strong> = Scraping Firecrawl · Modèle INSEE 2024</span>
        </div>
      </div>

      {showImport && <ImportModal onClose={() => setShowImport(false)} onImport={addOffre} />}
      {detail && <DetailPanel offre={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
