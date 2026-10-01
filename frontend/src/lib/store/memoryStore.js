// Opslag in het geheugen: voor de demo (geen Firebase nodig) en voor tests.
// Zelfde interface als firestoreStore.js.

const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

export function createMemoryStore({ users = {}, allowedEmails = [], persistKey = null } = {}) {
  const households = new Map(); // hid -> doc
  const sub = new Map(); // `${hid}/${coll}` -> Map(id -> doc)
  let current = null;
  // Optioneel bewaren in sessionStorage, zodat de demo een herlaadactie overleeft (alleen dit tabblad).
  const save = () => {
    if (!persistKey) return;
    try {
      sessionStorage.setItem(persistKey, JSON.stringify({
        current, households: [...households], sub: [...sub].map(([k, m]) => [k, [...m]]),
      }));
    } catch { /* opslag vol of uitgeschakeld: dan alleen in het geheugen */ }
  };
  let restored = false;
  if (persistKey) {
    try {
      const raw = sessionStorage.getItem(persistKey);
      if (raw) {
        const d = JSON.parse(raw);
        current = d.current;
        d.households.forEach(([k, v]) => households.set(k, v));
        d.sub.forEach(([k, entries]) => sub.set(k, new Map(entries)));
        restored = true;
      }
    } catch { /* negeren */ }
  }
  const coll = (hid, c) => {
    const k = `${hid}/${c}`;
    if (!sub.has(k)) sub.set(k, new Map());
    return sub.get(k);
  };

  return {
    kind: "memory",
    restored,
    save,
    demoUsers: users,
    async ready() { return current; },
    currentUser() { return current ? { ...current } : null; },
    async signIn(email) {
      const u = users[email];
      if (!u) throw Object.assign(new Error("Onbekende demogebruiker"), { status: 401 });
      current = { ...u, email };
      save();
      return { ...current };
    },
    async signOut() { current = null; save(); },
    async isAllowedCreator(email) { return allowedEmails.includes(email); },

    async listHouseholdsFor(uid) {
      return [...households.values()].filter((h) => (h.member_ids || []).includes(uid)).map(clone);
    },
    async listInvitedHouseholds(email) {
      return [...households.values()].filter((h) => (h.invited_list || []).includes(email)).map(clone);
    },
    async getHousehold(hid) { return clone(households.get(hid)) || null; },
    async createHousehold(doc) { households.set(doc.household_id, clone(doc)); save(); },
    async updateHousehold(hid, patch) {
      const h = households.get(hid);
      if (!h) throw Object.assign(new Error("Huishouden niet gevonden"), { status: 404 });
      households.set(hid, { ...h, ...clone(patch) });
      save();
    },
    async deleteHousehold(hid) {
      for (const k of [...sub.keys()]) if (k.startsWith(`${hid}/`)) sub.delete(k);
      households.delete(hid);
      save();
    },

    async list(hid, c) { return [...coll(hid, c).values()].map(clone); },
    async get(hid, c, id) { return clone(coll(hid, c).get(id)) || null; },
    async set(hid, c, id, doc) { coll(hid, c).set(id, clone(doc)); save(); },
    async update(hid, c, id, patch) {
      const m = coll(hid, c);
      if (!m.has(id)) return false;
      m.set(id, { ...m.get(id), ...clone(patch) });
      save();
      return true;
    },
    async remove(hid, c, id) { coll(hid, c).delete(id); save(); },
    async removeWhere(hid, c, field, value) {
      const m = coll(hid, c);
      for (const [id, d] of [...m]) if (d[field] === value) m.delete(id);
      save();
    },
    async clear(hid, c) { coll(hid, c).clear(); save(); },
    async setMany(hid, c, idField, docs) { for (const d of docs) coll(hid, c).set(d[idField], clone(d)); save(); },
  };
}
