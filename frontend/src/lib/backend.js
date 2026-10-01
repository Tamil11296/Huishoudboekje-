// Kiest de opslag: Firebase (normaal) of geheugen met voorbeeldgegevens (demo-build).
import { createMemoryStore } from "./store/memoryStore";
import { seedDemo, DEMO_USERS } from "./demoSeed";

export const isDemo = () => process.env.REACT_APP_DEMO === "1";

let storeP = null;
export function getStore() {
  if (!storeP) {
    storeP = isDemo()
      ? (async () => {
          const s = createMemoryStore({ users: DEMO_USERS, allowedEmails: ["robeson@demo.nl"], persistKey: "hb_demo" });
          if (!s.restored) await seedDemo(s);
          return s;
        })()
      : import("./store/firestoreStore").then((m) => m.createFirestoreStore());
  }
  return storeP;
}
