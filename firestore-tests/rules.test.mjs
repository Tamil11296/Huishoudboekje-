// Tests van firestore.rules tegen de Firestore-emulator:  npm run test:rules
import { test, before, after, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, query, where, Timestamp } from "firebase/firestore";

let env;
const OWNER = { uid: "u_owner", email: "owner@example.com" };
const PARTNER = { uid: "u_partner", email: "partner@example.com" };
const STRANGER = { uid: "u_x", email: "vreemde@example.com" };
const HID = "hh_1";

const dbAs = (u) => env.authenticatedContext(u.uid, { email: u.email, email_verified: true }).firestore();
const future = () => Timestamp.fromDate(new Date(Date.now() + 7 * 86400000));
const past = () => Timestamp.fromDate(new Date(Date.now() - 86400000));

const household = (extra = {}) => ({
  household_id: HID, name: "Thuis", owner_id: OWNER.uid,
  members: [{ user_id: OWNER.uid, email: OWNER.email, name: "Owner", role: "owner" }],
  member_ids: [OWNER.uid], invites: {}, invited_list: [], persons: [], categories: {},
  quote_statuses: [], quick_presets: [], split_rule: "income", dashboard_year: 2026, ...extra,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-huishoudboekje",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "config/access"), { allowed_emails: [OWNER.email] });
    await setDoc(doc(db, `households/${HID}`), household());
    await setDoc(doc(db, `households/${HID}/fixed_expenses/f1`), { item_id: "f1", household_id: HID, amount: 144 });
  });
});

test("niet ingelogd: niets lezen", async () => {
  const db = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, `households/${HID}`)));
  await assertFails(getDoc(doc(db, `households/${HID}/fixed_expenses/f1`)));
});

test("vreemde: geen toegang tot huishouden of gegevens", async () => {
  const db = dbAs(STRANGER);
  await assertFails(getDoc(doc(db, `households/${HID}`)));
  await assertFails(getDoc(doc(db, `households/${HID}/fixed_expenses/f1`)));
  await assertFails(setDoc(doc(db, `households/${HID}/fixed_expenses/f2`), { household_id: HID, amount: 1 }));
  await assertFails(updateDoc(doc(db, `households/${HID}`), { name: "gehackt" }));
});

test("vreemde kan zichzelf niet toevoegen zonder uitnodiging", async () => {
  const db = dbAs(STRANGER);
  await assertFails(updateDoc(doc(db, `households/${HID}`), {
    member_ids: [OWNER.uid, STRANGER.uid],
    members: [...household().members, { user_id: STRANGER.uid, email: STRANGER.email, name: "x", role: "member" }],
  }));
});

test("vreemde kan geen huishouden aanmaken; eigenaar wel", async () => {
  await assertFails(setDoc(doc(dbAs(STRANGER), "households/hh_x"),
    { ...household(), household_id: "hh_x", owner_id: STRANGER.uid, member_ids: [STRANGER.uid] }));
  await assertSucceeds(setDoc(doc(dbAs(OWNER), "households/hh_2"), { ...household(), household_id: "hh_2" }));
});

test("toegangslijst alleen leesbaar voor wie erop staat", async () => {
  await assertSucceeds(getDoc(doc(dbAs(OWNER), "config/access")));
  await assertFails(getDoc(doc(dbAs(STRANGER), "config/access")));
  await assertFails(setDoc(doc(dbAs(OWNER), "config/access"), { allowed_emails: [OWNER.email, STRANGER.email] }));
});

test("eigenaar en leden: lezen/schrijven gegevens", async () => {
  const db = dbAs(OWNER);
  await assertSucceeds(getDoc(doc(db, `households/${HID}/fixed_expenses/f1`)));
  await assertSucceeds(setDoc(doc(db, `households/${HID}/fixed_expenses/f2`), { household_id: HID, amount: 1 }));
  // household_id moet kloppen
  await assertFails(setDoc(doc(db, `households/${HID}/fixed_expenses/f3`), { household_id: "ander", amount: 1 }));
  // onbekende collectie dicht
  await assertFails(setDoc(doc(db, `households/${HID}/geheim/x`), { household_id: HID }));
});

async function invitePartner(expires = future()) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), `households/${HID}`), {
      invites: { [PARTNER.email]: { expires_at: expires, invited_by: "Owner" } },
      invited_list: [PARTNER.email],
    });
  });
}
const joinPatch = (u) => ({
  member_ids: [OWNER.uid, u.uid],
  members: [...household().members, { user_id: u.uid, email: u.email, name: "P", role: "member" }],
  invites: {}, invited_list: [],
});

test("uitgenodigde partner kan lid worden en daarna gegevens lezen", async () => {
  await invitePartner();
  const db = dbAs(PARTNER);
  await assertSucceeds(getDoc(doc(db, `households/${HID}`)));
  await assertFails(getDoc(doc(db, `households/${HID}/fixed_expenses/f1`))); // nog geen lid
  await assertSucceeds(getDocs(query(collection(db, "households"), where("invited_list", "array-contains", PARTNER.email))));
  await assertSucceeds(updateDoc(doc(db, `households/${HID}`), joinPatch(PARTNER)));
  await assertSucceeds(getDoc(doc(db, `households/${HID}/fixed_expenses/f1`)));
  await assertSucceeds(getDocs(query(collection(db, "households"), where("member_ids", "array-contains", PARTNER.uid))));
});

test("uitnodiging werkt niet voor een ander account", async () => {
  await invitePartner();
  await assertFails(updateDoc(doc(dbAs(STRANGER), `households/${HID}`), joinPatch(STRANGER)));
});

test("verlopen uitnodiging werkt niet", async () => {
  await invitePartner(past());
  await assertFails(updateDoc(doc(dbAs(PARTNER), `households/${HID}`), joinPatch(PARTNER)));
});

test("partner kan zichzelf geen eigenaar maken of extra mensen toevoegen", async () => {
  await invitePartner();
  const db = dbAs(PARTNER);
  await assertFails(updateDoc(doc(db, `households/${HID}`), {
    ...joinPatch(PARTNER),
    members: [...household().members, { user_id: PARTNER.uid, email: PARTNER.email, name: "P", role: "owner" }],
  }));
  await assertFails(updateDoc(doc(db, `households/${HID}`), { ...joinPatch(PARTNER), owner_id: PARTNER.uid }));
  await assertFails(updateDoc(doc(db, `households/${HID}`), {
    ...joinPatch(PARTNER), member_ids: [OWNER.uid, PARTNER.uid, STRANGER.uid] }));
});

test("lid mag instellingen wijzigen maar niet leden of uitnodigingen", async () => {
  await invitePartner();
  const db = dbAs(PARTNER);
  await updateDoc(doc(db, `households/${HID}`), joinPatch(PARTNER));
  await assertSucceeds(updateDoc(doc(db, `households/${HID}`), { name: "Thuis 2" }));
  await assertFails(updateDoc(doc(db, `households/${HID}`), { invited_list: [STRANGER.email] }));
  await assertFails(updateDoc(doc(db, `households/${HID}`), { member_ids: [PARTNER.uid] }));
  await assertFails(deleteDoc(doc(db, `households/${HID}`)));
});

test("eigenaar kan uitnodigen en verwijderen, maar zichzelf niet buitensluiten", async () => {
  const db = dbAs(OWNER);
  await assertSucceeds(updateDoc(doc(db, `households/${HID}`), {
    invites: { [PARTNER.email]: { expires_at: future(), invited_by: "Owner" } }, invited_list: [PARTNER.email] }));
  await assertFails(updateDoc(doc(db, `households/${HID}`), { member_ids: [] }));
  await assertFails(updateDoc(doc(db, `households/${HID}`), { owner_id: PARTNER.uid }));
});

test("logboek: lid voegt toe als zichzelf; niemand past aan", async () => {
  const db = dbAs(OWNER);
  await assertSucceeds(setDoc(doc(db, `households/${HID}/change_log/l1`), { user_id: OWNER.uid, detail: "x" }));
  await assertFails(setDoc(doc(db, `households/${HID}/change_log/l2`), { user_id: "iemand_anders", detail: "x" }));
  await assertFails(updateDoc(doc(db, `households/${HID}/change_log/l1`), { detail: "verborgen" }));
});

test("bijlagen: stukken max. ~700 kB", async () => {
  const db = dbAs(OWNER);
  await assertSucceeds(setDoc(doc(db, `households/${HID}/attachment_chunks/a_0`), { att_id: "a", i: 0, data: "x".repeat(700000) }));
  await assertFails(setDoc(doc(db, `households/${HID}/attachment_chunks/a_1`), { att_id: "a", i: 1, data: "x".repeat(800000) }));
});
