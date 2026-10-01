# Huishoudboekje

Budget en bouwdepot voor ons huishouden. Een React-app die zonder eigen server draait:

- **Firebase Authentication:** inloggen met Google.
- **Cloud Firestore:** gedeelde database, beveiligd met `firestore.rules`.
- **Firebase Hosting:** de app zelf, met https en een eigen adres.
- **Later:** als app in de Google Play Store (stap 6).

Alles valt binnen het gratis Firebase-abonnement (Spark). Je hebt geen creditcard of
factureringsaccount nodig.

```
frontend/                  de app (React + Tailwind + shadcn/ui)
  src/lib/calc.js          ALLE berekeningen (getest: calc.test.js)
  src/lib/api.js           "API" in de browser: dezelfde routes als vroeger, nu via Firestore
  src/lib/store/           opslag: Firestore of geheugen (demo)
  src/lib/demoSeed.js      voorbeeldgegevens voor de demo
firestore.rules            wie mag wat — de enige echte toegangscontrole
firestore-tests/           tests van de beveiligingsregels
.github/workflows/         tests bij elke push; publiceren bij push naar main
```

---

## Eerst bekijken: demo (geen accounts nodig)

- **Op GitHub:** Code → Codespaces → Create codespace. De demo start vanzelf.
- **Lokaal:** `cd frontend && yarn install && yarn start:demo`

Log in als Robeson of Miraja. De gegevens staan alleen in je browsertabblad.

---

## In gebruik nemen (eenmalig, ±30 minuten)

### 1. Firebase-project aanmaken
1. Ga naar <https://console.firebase.google.com> → **Project toevoegen**, bijv. `huishoudboekje`.
   Google Analytics: **uit**.
2. **Build → Firestore Database → Create database**
   - locatie: **eur3 (Europe)** of **europe-west4 (Nederland)**. Dit kun je later niet wijzigen.
   - start in **production mode**.
3. **Build → Authentication → Get started → Sign-in method → Google → Enable**
   - kies je e-mailadres als ondersteuningsadres.
4. **Toegangslijst:** ga naar Firestore → **Start collection**
   - Collection ID: `config` → Document ID: `access`
   - Veld: `allowed_emails`, type **array**, met één waarde: jouw Gmail-adres in kleine letters.

   Alleen wie op deze lijst staat, kan een huishouden aanmaken. Je vrouw hoeft er niet op;
   zij komt binnen via een uitnodiging.

### 2. App registreren
**Projectinstellingen (tandwiel) → Your apps → Web (`</>`)** → naam `Huishoudboekje` →
vink **Firebase Hosting** aan → Register. De configuratie die je ziet hoef je niet te kopiëren:
Firebase Hosting levert die automatisch aan de app.

### 3. Sleutel voor automatisch publiceren
1. Ga in de Firebase-console naar **Projectinstellingen → Service accounts → Manage service account
   permissions**. Je komt dan in Google Cloud terecht.
2. **Create service account**, naam `github-deploy`, rollen:
   - **Firebase Admin**
   - **Service Usage Consumer**
3. Open het account → **Keys → Add key → JSON**. Er wordt een bestand gedownload.
   **Dit is een geheim:** deel het met niemand, ook niet in een chat.

### 4. GitHub koppelen
In je repository op GitHub: **Settings → Secrets and variables → Actions**
- tabblad **Secrets** → *New repository secret*:
  - `FIREBASE_SERVICE_ACCOUNT` = de volledige inhoud van het JSON-bestand.
  - Verwijder het bestand daarna van je computer.
- tabblad **Variables** → *New repository variable*:
  - `FIREBASE_PROJECT_ID` = je project-ID, bijv. `huishoudboekje-1a2b3`.

Daarna publiceert elke push naar `main` automatisch: eerst draaien de tests, dan wordt de app gebouwd
en gaan app en beveiligingsregels online. Bekijk de voortgang onder het tabblad **Actions**.
De eerste keer start je hem handmatig: Actions → *Publiceren (Firebase)* → *Run workflow*.

### 5. Eerste keer inloggen
1. Open `https://<project-id>.web.app` → **Inloggen met Google**.
2. Maak het huishouden aan.
3. **Instellingen → Partner uitnodigen** → haar Gmail-adres → stuur haar de link.
   Zij logt in met **dat** Google-account en zit er direct in. De uitnodiging is 14 dagen geldig.
4. **Gegevens overzetten** uit de oude app: draai `tools/export_from_emergent.py` (zie het
   bestand) en zet de back-up terug via **Instellingen → Back-up terugzetten**.

---

## 6. Naar de Google Play Store (als alles werkt)

De app wordt verpakt als **Trusted Web Activity**: een echte Android-app die je website toont
zonder adresbalk. Updates van de website zitten er direct in.

1. Ga naar <https://www.pwabuilder.com>, vul `https://<project-id>.web.app` in → **Package for stores
   → Android**.
   - package-ID: bijv. `nl.constantine.huishoudboekje`
   - Bewaar de **signing key** (`.keystore` + wachtwoorden) veilig. Zonder die sleutel kun je nooit
     meer een update uitbrengen.
2. Je krijgt een zip met een `.aab`-bestand en `assetlinks.json`.
   - Zet `assetlinks.json` in `frontend/public/.well-known/assetlinks.json` en push.
   - Daardoor verdwijnt de adresbalk in de app.
3. <https://play.google.com/console> → ontwikkelaarsaccount (eenmalig $25) → **Create app**.
4. Kies **Testing → Internal testing**:
   - upload het `.aab`-bestand
   - voeg jouw en haar Gmail toe als testers
   - deel de testlink

   Interne tests hebben geen review-wachttijd en geen eis van 12 testers. Voor jullie tweeën is dit
   genoeg; publiek publiceren is niet nodig.
5. Wil je later toch publiek gaan, dan heb je nodig:
   - een privacyverklaring
   - een manier om je account en gegevens te verwijderen (de eigenaar kan het huishouden nu al verwijderen)
   - 14 dagen gesloten test met 12 testers

**iPhone:** open de site in Safari → Deel → **Zet op beginscherm**. Dat werkt zonder App Store.

---

## Ontwikkelen en testen

```bash
cd frontend
yarn install
yarn start:demo          # demo, zonder Firebase
CI=true yarn test        # rekenregels (vaste uitkomsten uit Excel v5)
yarn build               # productie-build

# Echte Firebase lokaal: zet in frontend/.env.local
#   REACT_APP_FIREBASE_API_KEY=…  REACT_APP_FIREBASE_AUTH_DOMAIN=…
#   REACT_APP_FIREBASE_PROJECT_ID=…  REACT_APP_FIREBASE_APP_ID=…
# en voeg localhost toe bij Authentication → Settings → Authorized domains.

# Beveiligingsregels testen (vereist Java 21):
cd .. && npm install && npm run test:rules
```

GitHub Actions draait bij elke push: de rekentests, beide builds en de regeltests in de
Firestore-emulator. **Een rode test betekent: niet publiceren.**

## Beveiliging in het kort

- **Inloggen:** alleen met Google. Een vreemd Google-account kan wel "inloggen", maar ziet niets:
  de regels geven alleen leden toegang tot een huishouden en de gegevens daarin.
- **Huishouden aanmaken:** alleen e-mailadressen in `config/access`.
- **Lid worden:** alleen met een uitnodiging voor jouw e-mailadres die nog geldig is. Je kunt
  jezelf daarbij alleen als "lid" toevoegen, niet als eigenaar en niet samen met anderen.
- **Leden** mogen gegevens en instellingen wijzigen. Leden en uitnodigingen beheert alleen de
  eigenaar.
- **Bijlagen:** pdf of foto, max. 10 MB. Foto's worden automatisch verkleind. Ze worden in stukken
  in Firestore bewaard, zodat er geen betaalde opslag nodig is.
- **Geen** analytics, tracking of AI.
- **Back-up:** download maandelijks via Instellingen. Firestore maakt op het gratis abonnement zelf
  geen back-ups.

**Deze repository moet privé blijven.** De tests en de demo bevatten onze echte bedragen.
