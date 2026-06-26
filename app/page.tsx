"use client";
import { useState, useMemo } from "react";

const INSEE = {
  H:{60:23.5,61:22.6,62:21.7,63:20.8,64:19.9,65:19.1,66:18.3,67:17.5,68:16.7,69:15.9,70:15.2,71:14.5,72:13.8,73:13.1,74:12.4,75:11.8,76:11.2,77:10.6,78:10.0,79:9.4,80:8.9,81:8.4,82:7.9,83:7.4,84:6.9,85:6.5,86:6.1,87:5.7,88:5.3,89:4.9,90:4.6},
  F:{60:27.4,61:26.4,62:25.5,63:24.6,64:23.6,65:22.7,66:21.8,67:20.9,68:20.0,69:19.1,70:18.2,71:17.4,72:16.5,73:15.7,74:14.9,75:14.1,76:13.3,77:12.6,78:11.9,79:11.2,80:10.5,81:9.9,82:9.3,83:8.7,84:8.1,85:7.6,86:7.1,87:6.6,88:6.1,89:5.7,90:5.3},
};
const getEsp = (age:number, sex:string):number => ((INSEE as any)[sex]||INSEE.F)[Math.min(Math.max(age,60),90)]??10;

const ZONES:any[] = [
  [/paris\s*[12]/i,28],[/paris\s*[34]/i,27],[/paris\s*[56]/i,30],
  [/paris\s*[78]/i,29],[/paris\s*9(?!\d)/i,26],[/paris\s*1[0-9]/i,24],
  [/paris/i,25],[/neuilly|levallois/i,23],[/boulogne|issy|vanves/i,20],
  [/courbevoie|puteaux|montrouge|malakoff/i,18],[/marseille/i,13],
  [/lyon/i,16],[/nice|cannes|antibes/i,18],[/bordeaux/i,15],
  [/toulouse/i,13],[/aix/i,14],[/toulon/i,12],[/frejus/i,11],
  [/ciotat/i,12],[/cagnes/i,13],[/montpellier/i,13],
];
const loyerEst=(ville:string,surf:number)=>{
  if(!ville||!surf)return 0;
  for(const[p,v]of ZONES)if(p.test(ville))return Math.round(v*surf);
  return Math.round(10*surf);
};

function computeIRR(flows:number[],guess=0.08):number{
  let rate=guess;
  for(let i=0;i<80;i++){
    let npv=0,deriv=0;
    for(let t=0;t<flows.length;t++){
      npv+=flows[t]/Math.pow(1+rate,t);
      deriv+=-t*flows[t]/Math.pow(1+rate,t+1);
    }
    if(Math.abs(deriv)<1e-10)break;
    const next=rate-npv/deriv;
    if(Math.abs(next-rate)<1e-7)return next;
    rate=next;
  }
  return rate;
}
const computeNPV=(flows:number[],r:number)=>flows.reduce((s,f,t)=>s+f/Math.pow(1+r,t),0);

function computeViager(o:any,libAns:number|null=null){
  const inf=o.tauxInflation||0.03,tfTx=o.tauxCroissanceTF||0.04;
  const ventil=o.ventilationCharges??0.33;
  const chargesAnn=(o.chargesCopro||0)+(o.autresCharges||0);
  const tf=o.taxeFonciere||0;
  const e1=o.occupant1Age?getEsp(o.occupant1Age,o.occupant1Sexe||"F"):0;
  const e2=o.occupant2Age?getEsp(o.occupant2Age,o.occupant2Sexe||"F"):0;
  const duree=Math.max(e1,e2);
  const libActive=libAns!==null&&libAns>0&&libAns<duree;
  const majRente=o.majorationRenteLiberation??0.30;
  const loyer=(o.loyerMensuelManuel&&o.loyerMensuelManuel>0)?o.loyerMensuelManuel:loyerEst(o.ville,o.superficie);
  let rentes=0,tfTot=0,chg=0,loyers=0;
  const flows:number[]=[-(o.bouquet||0)];
  for(let y=1;y<=Math.ceil(duree);y++){
    const frac=y<=duree?1:duree-Math.floor(duree);
    if(frac<=0)break;
    let fOcc=frac,fLib=0;
    if(libActive){
      if(y<=Math.floor(libAns!)){fOcc=frac;fLib=0;}
      else if(y===Math.ceil(libAns!)&&!Number.isInteger(libAns)){fOcc=libAns!-Math.floor(libAns!);fLib=frac-fOcc;}
      else{fOcc=0;fLib=frac;}
    }
    const r0=(o.rente||0)*12*Math.pow(1+inf,y-1);
    const renteY=r0*fOcc+r0*(1+majRente)*fLib;
    rentes+=renteY;
    const tfY=tf*Math.pow(1+tfTx,y-1)*frac+tf*0.15*Math.pow(1+tfTx,y-1)*fLib;
    tfTot+=tfY;
    const cY=chargesAnn*Math.pow(1+inf,y-1);
    const chgY=cY*ventil*fOcc+cY*fLib;
    chg+=chgY;
    const loyY=loyer*12*Math.pow(1+inf,y-1)*fLib;
    loyers+=loyY;
    flows.push(-renteY-tfY-chgY+loyY);
  }
  const prixBrut=(o.bouquet||0)+rentes+tfTot+chg;
  const prixNet=prixBrut-loyers;
  const vv=o.valeurVenale||0;
  if(vv>0&&flows.length>1)flows[flows.length-1]+=vv;
  const tri=computeIRR(flows)*100;
  const van=computeNPV(flows,0.04);
  return{duree,libActive,totalRentes:rentes,tfTotal:tfTot,chgTotal:chg,loyers,
    loyerMensuelEffectif:loyer,prixBrut,prixNet,
    ratio:vv>0?prixNet/vv:null,decote:vv>0?(vv-prixNet)/vv:null,
    anneesOcc:libActive?libAns:duree,anneesLib:libActive?duree-libAns!:0,tri,van,flows};
}

async function importFromAPI(url:string){
  const res=await fetch("/api/import",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({url}),
  });
  const json=await res.json();
  if(!res.ok||!json.success)throw new Error(json.error||`Erreur ${res.status}`);
  return json.data;
}

const SEED:any[]=[
  {id:1,source:"SeLoger",ville:"Paris 15 – Lourmel",superficie:56,valeurVenale:480000,bouquet:249000,rente:1377,occupant1Age:81,occupant1Sexe:"H",taxeFonciere:450,chargesCopro:960,tauxInflation:0.03,tauxCroissanceTF:0.04,datePublication:"2026-06-20",url:"https://www.seloger.com/annonces/achat/appartement/paris-15eme-75/",note:"T2 56m²"},
  {id:2,source:"Renée Costes",ville:"Toulon",superficie:51,valeurVenale:145000,bouquet:18500,rente:435,occupant1Age:74,occupant1Sexe:"F",taxeFonciere:804,chargesCopro:828,tauxInflation:0.03,tauxCroissanceTF:0.04,datePublication:"2025-12-01",url:"https://www.costes-viager.com/acheter/annonces",note:"Quartier des Lices"},
  {id:3,source:"SeLoger",ville:"Essonne – RER B",superficie:45,valeurVenale:136222,bouquet:70316,rente:750,occupant1Age:79,occupant1Sexe:"H",taxeFonciere:300,chargesCopro:600,tauxInflation:0.03,tauxCroissanceTF:0.04,datePublication:"2026-06-15",url:"https://www.seloger.com/recherche/achat/appartement/viager/ile-de-france/essonne-91/",note:"Décote 36%"},
];

const fmt=(n:any)=>n!=null?Math.round(n).toLocaleString("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0}):"—";
const fmtPct=(n:any)=>n!=null?(n*100).toFixed(1)+"%":"—";
const fmtYrs=(n:any)=>n!=null?n.toFixed(1)+" ans":"—";
const fmtTRI=(n:any)=>(n!=null&&isFinite(n))?n.toFixed(2)+"%":"—";
const fmtDate=(d:any)=>d?new Date(d).toLocaleDateString("fr-FR",{day:"2-digit",month:"short",year:"numeric"}):"—";
const scoreColor=(r:any)=>r===null?"#6b7280":r<0.70?"#16a34a":r<0.85?"#ca8a04":r<1.0?"#dc2626":"#7f1d1d";
const scoreLabel=(r:any)=>r===null?"N/A":r<0.70?"Excellent":r<0.85?"Intéressant":r<1.0?"Limite":"Défavorable";

function ImportModal({onClose,onImport}:{onClose:()=>void,onImport:(o:any)=>void}){
  const[url,setUrl]=useState("");
  const[step,setStep]=useState("input");
  const[errMsg,setErrMsg]=useState("");
  const[parsed,setParsed]=useState<any>(null);
  const[edited,setEdited]=useState<any>(null);

  const analyze=async()=>{
    if(!url.trim())return;
    setStep("loading");
    try{
      const result=await importFromAPI(url.trim());
      if(result.error&&!result.data){setErrMsg(result.error);setStep("error");return;}
      setParsed(result);
      setEdited({...result.data,url:url.trim(),source:result.source});
      setStep("form");
    }catch(e:any){setErrMsg(e.message||"Erreur inconnue");setStep("error");}
  };

  const add=()=>{
    if(!edited)return;
    onImport({...edited,
      occupant1Age:edited.occupant1Age||78,occupant1Sexe:edited.occupant1Sexe||"F",
      taxeFonciere:edited.taxeFonciere||400,chargesCopro:edited.chargesCopro||800,
      autresCharges:0,ventilationCharges:0.33,majorationRenteLiberation:0.30,
      tauxInflation:0.03,tauxCroissanceTF:0.04,loyerMensuelManuel:null,
      datePublication:new Date().toISOString().slice(0,10),
      note:edited.note||`Importé via ${edited.source}`,
    });
    onClose();
  };

  const upd=(k:string,v:any)=>setEdited((p:any)=>({...p,[k]:v}));
  const field=(label:string,key:string,type="number")=>(
    <div style={{display:"flex",flexDirection:"column",gap:3}}>
      <label style={{fontSize:10,color:"#94a3b8",textTransform:"uppercase"}}>{label}</label>
      <input type={type} value={edited?.[key]??""} onChange={e=>upd(key,type==="number"?(e.target.value===""?"":+e.target.value):e.target.value)}
        style={{background:"#0f172a",border:"1px solid #334155",borderRadius:6,color:"#f1f5f9",padding:"7px 10px",fontSize:12,width:"100%"}}/>
    </div>
  );
  const reset=()=>{setStep("input");setUrl("");setErrMsg("");setParsed(null);setEdited(null);};

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200,padding:16}} onClick={onClose}>
      <div style={{background:"#1e293b",borderRadius:14,width:"min(95vw,640px)",maxHeight:"90vh",overflowY:"auto",padding:26,border:"1px solid #334155"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div style={{fontSize:17,fontWeight:800}}>🔗 Importer une annonce</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#64748b",cursor:"pointer",fontSize:22}}>✕</button>
        </div>

        {step==="input"&&(
          <div>
            <label style={{fontSize:11,color:"#94a3b8",textTransform:"uppercase",fontWeight:600,marginBottom:6,display:"block"}}>URL de l'annonce</label>
            <input value={url} onChange={e=>setUrl(e.target.value)} onKeyDown={e=>e.key==="Enter"&&analyze()}
              placeholder="https://www.seloger.com/annonces/achat/..."
              style={{background:"#0f172a",border:"1px solid #334155",borderRadius:8,color:"#f1f5f9",padding:"11px 14px",fontSize:13,width:"100%",marginBottom:10}}/>
            <div style={{fontSize:10,color:"#64748b",marginBottom:14}}>
              Sites supportés : <span style={{color:"#93c5fd"}}>SeLoger</span>, <span style={{color:"#fbbf24"}}>Renée Costes</span>, <span style={{color:"#34d399"}}>LeBonCoin</span>
            </div>
            <button onClick={analyze} disabled={!url.trim()}
              style={{background:"#3b82f6",color:"#fff",border:"none",borderRadius:8,padding:"12px 20px",cursor:"pointer",fontSize:13,fontWeight:600,width:"100%",opacity:url.trim()?1:0.4}}>
              🔍 Analyser
            </button>
          </div>
        )}

        {step==="loading"&&(
          <div style={{textAlign:"center",padding:"40px 0"}}>
            <div style={{fontSize:32,marginBottom:14}}>⏳</div>
            <div style={{fontSize:14,color:"#94a3b8",fontWeight:600}}>Analyse en cours…</div>
            <div style={{fontSize:11,color:"#475569",marginTop:8}}>Scraping de l'annonce via le backend</div>
          </div>
        )}

        {step==="error"&&(
          <div>
            <div style={{background:"#7f1d1d30",border:"1px solid #7f1d1d",borderRadius:10,padding:16,marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:700,color:"#fca5a5",marginBottom:6}}>⚠️ Erreur d'import</div>
              <div style={{fontSize:12,color:"#fca5a580"}}>{errMsg}</div>
            </div>
            <div style={{fontSize:11,color:"#64748b",marginBottom:14}}>Tu peux quand même saisir les données manuellement.</div>
            <button onClick={()=>{setStep("form");setEdited({url,source:"Manuel"});}}
              style={{background:"#334155",color:"#cbd5e1",border:"none",borderRadius:7,padding:"9px 18px",cursor:"pointer",fontSize:12,marginRight:8}}>
              Saisie manuelle →
            </button>
            <button onClick={reset} style={{background:"none",border:"1px solid #334155",color:"#94a3b8",borderRadius:7,padding:"9px 18px",cursor:"pointer",fontSize:12}}>← Réessayer</button>
          </div>
        )}

        {step==="form"&&(
          <div>
            {parsed&&(
              <div style={{background:"#0f172a",borderRadius:10,padding:12,marginBottom:14,border:"1px solid #1e3a5f"}}>
                <div style={{fontSize:12,color:"#93c5fd",fontWeight:700,marginBottom:3}}>
                  ✅ {parsed.source} — {Math.round((parsed.confidence||0)*100)}% des champs extraits
                </div>
                <div style={{fontSize:10,color:"#475569"}}>Vérifie et complète les champs manquants.</div>
              </div>
            )}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
              {field("Ville","ville","text")}{field("Superficie (m²)","superficie")}
              {field("Bouquet (€)","bouquet")}{field("Rente mensuelle (€)","rente")}
              {field("Âge occupant","occupant1Age")}{field("Valeur vénale (€)","valeurVenale")}
              {field("Taxe foncière (€/an)","taxeFonciere")}{field("Charges copro (€/an)","chargesCopro")}
            </div>
            <div style={{display:"flex",gap:10}}>
              <button onClick={add} style={{flex:1,background:"#16a34a",color:"#fff",border:"none",borderRadius:8,padding:"12px 20px",cursor:"pointer",fontSize:13,fontWeight:600}}>
                ✓ Ajouter au portefeuille
              </button>
              <button onClick={reset} style={{flex:1,background:"#334155",color:"#cbd5e1",border:"none",borderRadius:8,padding:"12px 20px",cursor:"pointer",fontSize:13}}>← Nouvelle URL</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({offre,result,onDelete}:{offre:any,result:any,onDelete:(id:number)=>void}){
  const{prixNet,ratio,duree,tri,van}=result;
  const col=scoreColor(ratio);
  return(
    <div style={{background:"#1e293b",borderRadius:10,padding:14,borderLeft:`3px solid ${col}`}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
        <div style={{flex:1,marginRight:8}}>
          <div style={{fontSize:14,fontWeight:700}}>{offre.ville||"Ville inconnue"}</div>
          <div style={{fontSize:10,color:"#64748b",marginTop:2}}>
            {offre.superficie?`${offre.superficie}m² · `:""}
            <span style={{color:offre.source==="Renée Costes"?"#fbbf24":"#94a3b8"}}>{offre.source}</span>
            {offre.datePublication?` · ${fmtDate(offre.datePublication)}`:""}
          </div>
        </div>
        <div style={{textAlign:"right",flexShrink:0}}>
          <div style={{fontSize:19,fontWeight:800,color:col}}>{fmtPct(ratio)}</div>
          <div style={{fontSize:9,color:col,fontWeight:600}}>{scoreLabel(ratio)}</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:8}}>
        {[["TRI",fmtTRI(tri),"#60a5fa"],["VAN",fmt(van),van>=0?"#34d399":"#f87171"],["Durée",fmtYrs(duree),"#fbbf24"]].map(([k,v,c])=>(
          <div key={k} style={{background:"#0f172a",borderRadius:5,padding:"6px 7px"}}>
            <div style={{fontSize:8,color:"#64748b"}}>{k}</div>
            <div style={{fontSize:11,fontWeight:600,color:c as string,marginTop:1}}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:6,marginBottom:10}}>
        {[["Bouquet",fmt(offre.bouquet)],["Rente",offre.rente?fmt(offre.rente)+"/m":"—"],["Prix revient",fmt(prixNet)]].map(([k,v])=>(
          <div key={k} style={{background:"#0f172a",borderRadius:5,padding:"6px 7px"}}>
            <div style={{fontSize:8,color:"#64748b"}}>{k}</div>
            <div style={{fontSize:11,fontWeight:600,color:"#f1f5f9",marginTop:1}}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:7}}>
        {offre.url&&<a href={offre.url} target="_blank" rel="noreferrer"
          style={{flex:1,background:"#1d4ed820",color:"#93c5fd",border:"1px solid #1d4ed830",borderRadius:5,padding:"6px 0",fontSize:11,fontWeight:600,textDecoration:"none",textAlign:"center"}}>
          🔗 Annonce
        </a>}
        <button onClick={()=>onDelete(offre.id)}
          style={{background:"#0f172a",color:"#64748b",border:"1px solid #334155",borderRadius:5,padding:"6px 12px",fontSize:11,cursor:"pointer"}}>
          Supprimer
        </button>
      </div>
    </div>
  );
}

export default function ViagerScan(){
  const[offres,setOffres]=useState<any[]>(SEED);
  const[sortBy,setSortBy]=useState("tri");
  const[showImport,setShowImport]=useState(false);

  const computed=useMemo(()=>offres.map(o=>({offre:o,result:computeViager(o)})),[offres]);
  const sorted=useMemo(()=>{
    const list=[...computed];
    list.sort((a,b)=>{
      if(sortBy==="tri")return(b.result.tri||-99)-(a.result.tri||-99);
      if(sortBy==="van")return(b.result.van||-1e12)-(a.result.van||-1e12);
      if(sortBy==="ratio")return(a.result.ratio??99)-(b.result.ratio??99);
      return 0;
    });
    return list;
  },[computed,sortBy]);

  const addOffre=(o:any)=>setOffres(p=>[...p,{...o,id:Math.max(0,...p.map((x:any)=>x.id))+1}]);
  const delOffre=(id:number)=>setOffres(p=>p.filter((o:any)=>o.id!==id));
  const tris=computed.map(x=>x.result.tri).filter((t:any)=>t!=null&&isFinite(t));
  const avgTRI=tris.length?tris.reduce((s:number,t:number)=>s+t,0)/tris.length:null;

  return(
    <div style={{minHeight:"100vh",background:"#0f172a",color:"#f1f5f9",fontFamily:"'Inter',system-ui,sans-serif"}}>
      <div style={{borderBottom:"1px solid #1e293b",padding:"16px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10}}>
        <div>
          <div style={{fontSize:20,fontWeight:800}}>Viager<span style={{color:"#3b82f6"}}>Scan</span></div>
          <div style={{fontSize:10,color:"#475569",marginTop:1}}>{offres.length} opportunités · TRI · VAN · Ratio · Import URL</div>
        </div>
        <button onClick={()=>setShowImport(true)}
          style={{background:"#3b82f6",color:"#fff",border:"none",borderRadius:8,padding:"9px 18px",cursor:"pointer",fontSize:13,fontWeight:600}}>
          🔗 Importer une annonce
        </button>
      </div>

      <div style={{maxWidth:1200,margin:"0 auto",padding:"16px 14px"}}>
        <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
          <div style={{display:"flex",gap:4,background:"#1e293b",borderRadius:7,padding:4}}>
            {[["tri","TRI"],["van","VAN"],["ratio","Ratio"]].map(([k,l])=>(
              <button key={k} onClick={()=>setSortBy(k)}
                style={{background:sortBy===k?"#3b82f6":"none",color:sortBy===k?"#fff":"#94a3b8",border:"none",borderRadius:5,padding:"5px 12px",cursor:"pointer",fontSize:11,fontWeight:sortBy===k?700:400}}>
                {l}
              </button>
            ))}
          </div>
          {avgTRI!=null&&<div style={{background:"#1e293b",borderRadius:7,padding:"5px 12px",fontSize:11,marginLeft:"auto"}}>
            <span style={{color:"#64748b"}}>TRI moyen </span>
            <span style={{color:"#60a5fa",fontWeight:700}}>{fmtTRI(avgTRI)}</span>
          </div>}
        </div>

        <div style={{display:"flex",gap:14,marginBottom:14,flexWrap:"wrap"}}>
          {[["<70%","#16a34a","Excellent"],["70–85%","#ca8a04","Intéressant"],["85–100%","#dc2626","Limite"],[">100%","#7f1d1d","Défavorable"]].map(([r,c,l])=>(
            <div key={r} style={{display:"flex",alignItems:"center",gap:5,fontSize:10}}>
              <div style={{width:8,height:8,borderRadius:2,background:c as string}}/>
              <span style={{color:c as string}}>{r}</span>
              <span style={{color:"#64748b"}}>{l}</span>
            </div>
          ))}
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:12}}>
          {sorted.map(({offre,result})=>(
            <Card key={offre.id} offre={offre} result={result} onDelete={delOffre}/>
          ))}
        </div>

        <div style={{marginTop:28,padding:"14px 18px",background:"#1e293b",borderRadius:10,fontSize:11,color:"#475569",borderLeft:"3px solid #334155"}}>
          <strong style={{color:"#64748b"}}>TRI</strong> = rendement interne · <strong style={{color:"#64748b"}}>VAN</strong> à 4% · <strong style={{color:"#64748b"}}>Ratio</strong> = prix revient / valeur vénale
        </div>
      </div>

      {showImport&&<ImportModal onClose={()=>setShowImport(false)} onImport={addOffre}/>}
    </div>
  );
}
