/* =====================================================================
   CLASSEMENTS — accès cloud (Firestore, collection « stats »)
   Module ES : à placer APRÈS le <script type="module"> Firebase d'origine.
   Réutilise l'application Firebase déjà initialisée (getApp()).
   Ajoute à window.Cloud :
     statsAdd(uid, pseudo, ajouts, records)   ajouts = compteurs (increment), records = valeurs max
     statsGet(uid)                            stats d'un joueur
     statsTop(champ, n)                       meilleurs joueurs triés sur « champ »
   Règle Firestore à ajouter :
     match /stats/{uid} { allow read: if true; allow write: if request.auth != null && request.auth.uid == uid; }
   ===================================================================== */
import { getApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, collection, query, orderBy, limit, getDocs, increment } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

try {
  const db = getFirestore(getApp());
  const C = window.Cloud || (window.Cloud = {});
  C.statsAdd = (uid, pseudo, add, rec) => {
    const d = { pseudo, updatedAt: Date.now() };
    for (const k in (add || {})) if (add[k]) d[k] = increment(add[k]);
    Object.assign(d, rec || {});
    return setDoc(doc(db, "stats", uid), d, { merge: true });
  };
  C.statsGet = async (uid) => { const s = await getDoc(doc(db, "stats", uid)); return s.exists() ? s.data() : null; };
  C.statsTop = async (field, n) =>
    (await getDocs(query(collection(db, "stats"), orderBy(field, "desc"), limit(n || 20)))).docs
      .map(d => Object.assign({ uid: d.id }, d.data()));
  window.dispatchEvent(new Event("stats-ready"));
} catch (e) {
  console.warn("Classements indisponibles (Firebase) :", e);
}
