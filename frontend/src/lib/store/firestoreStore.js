// Opslag in Firebase: Authentication (Google) + Cloud Firestore.
// Toegang wordt afgedwongen door firestore.rules — niet door deze code.
import { initializeApp } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged,
} from "firebase/auth";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, writeBatch, Timestamp,
} from "firebase/firestore";

// Firebase Hosting levert de (openbare) configuratie automatisch op /__/firebase/init.json.
// Lokaal ontwikkelen: zet REACT_APP_FIREBASE_* in frontend/.env.local.
async function loadConfig() {
  const env = process.env;
  if (env.REACT_APP_FIREBASE_API_KEY) {
    return {
      apiKey: env.REACT_APP_FIREBASE_API_KEY,
      authDomain: env.REACT_APP_FIREBASE_AUTH_DOMAIN,
      projectId: env.REACT_APP_FIREBASE_PROJECT_ID,
      appId: env.REACT_APP_FIREBASE_APP_ID,
    };
  }
  const r = await fetch("/__/firebase/init.json");
  if (!r.ok) throw new Error("Firebase-configuratie niet gevonden");
  return r.json();
}

// Vervaldata van uitnodigingen staan in Firestore als Timestamp (nodig voor de regels).
const toIso = (v) => (v instanceof Timestamp ? v.toDate().toISOString() : v);
const fromFirestore = (d) => {
  if (!d) return null;
  if (d.invites) {
    d.invites = Object.fromEntries(Object.entries(d.invites).map(([k, v]) =>
      [k, { ...v, expires_at: toIso(v.expires_at) }]));
  }
  return d;
};
const toFirestore = (patch) => {
  const p = { ...patch };
  if (p.invites) {
    p.invites = Object.fromEntries(Object.entries(p.invites).map(([k, v]) =>
      [k, { ...v, expires_at: v.expires_at ? Timestamp.fromDate(new Date(v.expires_at)) : null }]));
  }
  // Firestore accepteert geen undefined
  for (const k of Object.keys(p)) if (p[k] === undefined) p[k] = null;
  return p;
};
const clean = (o) => {
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k] = v === undefined ? null : v;
  return out;
};

export async function createFirestoreStore() {
  const app = initializeApp(await loadConfig());
  const auth = getAuth(app);
  auth.languageCode = "nl";
  // Offline-cache: de app opent ook zonder netwerk en synchroniseert later.
  const db = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
  let current = null;
  const readyP = new Promise((resolve) => {
    let first = true;
    onAuthStateChanged(auth, (u) => {
      current = u ? { user_id: u.uid, email: (u.email || "").toLowerCase(), name: u.displayName || "",
        picture: u.photoURL || "", email_verified: u.emailVerified } : null;
      if (first) { first = false; resolve(current); }
    });
  });
  const hRef = (hid) => doc(db, "households", hid);
  const cRef = (hid, c) => collection(db, "households", hid, c);

  return {
    kind: "firestore",
    async ready() { await readyP; return current; },
    currentUser() { return current ? { ...current } : null; },
    async signIn() {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
      await readyP;
      const u = auth.currentUser;
      current = { user_id: u.uid, email: (u.email || "").toLowerCase(), name: u.displayName || "",
        picture: u.photoURL || "", email_verified: u.emailVerified };
      return { ...current };
    },
    async signOut() { await fbSignOut(auth); current = null; },
    // Toegangslijst staat in Firestore: config/access { allowed_emails: [...] }.
    // De regels laten dit document alleen lezen door wie er zelf op staat.
    async isAllowedCreator() {
      try {
        return (await getDoc(doc(db, "config", "access"))).exists();
      } catch (e) {
        if (e.code === "permission-denied") return false;
        throw e;
      }
    },

    async listHouseholdsFor(uid) {
      const s = await getDocs(query(collection(db, "households"), where("member_ids", "array-contains", uid)));
      return s.docs.map((d) => fromFirestore(d.data()));
    },
    async listInvitedHouseholds(email) {
      const s = await getDocs(query(collection(db, "households"), where("invited_list", "array-contains", email)));
      return s.docs.map((d) => fromFirestore(d.data()));
    },
    async getHousehold(hid) {
      try {
        const s = await getDoc(hRef(hid));
        return s.exists() ? fromFirestore(s.data()) : null;
      } catch (e) {
        if (e.code === "permission-denied") return null;
        throw e;
      }
    },
    async createHousehold(d) { await setDoc(hRef(d.household_id), toFirestore(clean(d))); },
    async updateHousehold(hid, patch) { await updateDoc(hRef(hid), toFirestore(patch)); },
    async deleteHousehold(hid, collections) {
      for (const c of collections) {
        const s = await getDocs(cRef(hid, c));
        for (let i = 0; i < s.docs.length; i += 400) {
          const b = writeBatch(db);
          s.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
          await b.commit();
        }
      }
      await deleteDoc(hRef(hid));
    },

    async list(hid, c) { return (await getDocs(cRef(hid, c))).docs.map((d) => d.data()); },
    async get(hid, c, id) {
      const s = await getDoc(doc(db, "households", hid, c, id));
      return s.exists() ? s.data() : null;
    },
    async set(hid, c, id, d) { await setDoc(doc(db, "households", hid, c, id), clean(d)); },
    async update(hid, c, id, patch) {
      const ref = doc(db, "households", hid, c, id);
      if (!(await getDoc(ref)).exists()) return false;
      await updateDoc(ref, clean(patch));
      return true;
    },
    async remove(hid, c, id) { await deleteDoc(doc(db, "households", hid, c, id)); },
    async removeWhere(hid, c, field, value) {
      const s = await getDocs(query(cRef(hid, c), where(field, "==", value)));
      for (const d of s.docs) await deleteDoc(d.ref);
    },
    async clear(hid, c) {
      const s = await getDocs(cRef(hid, c));
      for (let i = 0; i < s.docs.length; i += 400) {
        const b = writeBatch(db);
        s.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
        await b.commit();
      }
    },
    async setMany(hid, c, idField, docs) {
      for (let i = 0; i < docs.length; i += 400) {
        const b = writeBatch(db);
        docs.slice(i, i + 400).forEach((d) => b.set(doc(db, "households", hid, c, d[idField]), clean(d)));
        await b.commit();
      }
    },
  };
}
