# Huishoudboekje

Budget en bouwdepot voor ons huishouden. Inloggen met Google; alleen wie op de toegangslijst
staat of een uitnodiging heeft, komt erin.

- **Frontend:** React (in `frontend/`)
- **Backend:** FastAPI + MongoDB (in `backend/`)
- **Hosting:** één container (Google Cloud Run) + MongoDB Atlas (gratis M0-cluster)

Geen Emergent, geen AI, geen tracking.

---

## Eerst bekijken: demo in je browser (geen accounts nodig)

1. Op GitHub: **Code → Codespaces → Create codespace on main**.
2. Wacht een paar minuten; de app wordt gebouwd en opent vanzelf in een nieuw tabblad
   (anders: tabblad **Ports** → poort 8000 → wereldbolletje).
3. Klik **Inloggen als Robeson** of **Inloggen als Miraja**.

De demo gebruikt onze cijfers uit Excel v5 in een tijdelijke database in het geheugen; wijzigingen
verdwijnen bij herstarten. Stop de codespace als je klaar bent (**Codespaces → … → Stop**), dan
telt hij niet mee in je gratis uren. De demo zit niet in de echte app.

---

## In gebruik nemen (eenmalig, ±45 minuten)

Je maakt drie accounts/onderdelen aan. Alle geheime waarden zet je bij Cloud Run, **nooit in de code**.

### 1. Database: MongoDB Atlas

1. Ga naar <https://cloud.mongodb.com> en log in met je Google-account.
2. **Create** → kies **M0 (Free)**, provider **Google Cloud** of **AWS**, regio **Europa** (bijv. Frankfurt of Belgium).
3. **Database Access** → *Add new database user* → gebruikersnaam + sterk wachtwoord (bewaar dit in je wachtwoordmanager).
4. **Network Access** → *Add IP address* → `0.0.0.0/0`.
   Cloud Run heeft geen vast IP-adres; de database is beveiligd met gebruikersnaam en wachtwoord.
5. **Database** → **Connect** → **Drivers** → kopieer de verbindingsregel (`mongodb+srv://...`) en vul je wachtwoord in.
   Dit is `MONGO_URL`.

### 2. Google Cloud: project, Google-login en hosting

1. Ga naar <https://console.cloud.google.com> → nieuw project, bijv. `huishoudboekje`.
2. Koppel een **factureringsaccount** (verplicht voor Cloud Run). Voor twee gebruikers blijf je
   vrijwel zeker binnen het gratis gebruik. Stel voor de zekerheid een **budgetmelding** in (bijv. € 5).
3. **APIs & Services → OAuth consent screen**
   - User type: **External**, app-naam `Huishoudboekje`, jouw e-mail als support/contact.
   - Laat de app in **Testing** staan en voeg bij **Test users** jouw Gmail en die van je vrouw toe.
4. Deploy eerst de app (stap 3 hieronder), zodat je het adres kent. Daarna:
   **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Type: **Web application**
   - **Authorized JavaScript origins:** het Cloud Run-adres, bijv. `https://huishoudboekje-xxxxx.europe-west4.run.app`
   - Kopieer de **Client ID**. Dit is `GOOGLE_CLIENT_ID`. (Het client secret heb je niet nodig.)

### 3. App publiceren op Cloud Run

1. **Cloud Run → Deploy container → Service → "Continuously deploy from a repository"**
   → koppel GitHub en kies deze repository, branch `main`, build type **Dockerfile**.
2. Regio: **europe-west4 (Nederland)**.
3. Authentication: **Allow unauthenticated invocations** (de app regelt zelf het inloggen).
4. Minimum instances `0`, maximum `1`, geheugen `512 MiB`.
5. **Variables & Secrets** → zet:

   | Naam | Waarde |
   |---|---|
   | `MONGO_URL` | uit stap 1 (als *Secret*) |
   | `DB_NAME` | `huishoudboekje` |
   | `JWT_SECRET` | willekeurige tekst van 48+ tekens (als *Secret*) — maak die met `python3 -c "import secrets;print(secrets.token_urlsafe(48))"` of een wachtwoordgenerator |
   | `GOOGLE_CLIENT_ID` | uit stap 2.4 |
   | `ALLOWED_EMAILS` | jouw Gmail-adres |
   | `APP_URL` | het Cloud Run-adres, zonder `/` aan het eind |

6. Deploy. Na de eerste keer: vul `GOOGLE_CLIENT_ID` en `APP_URL` in en deploy opnieuw
   (*Edit & deploy new revision*).

Elke `git push` naar `main` bouwt en publiceert daarna automatisch een nieuwe versie.

### 4. Eerste keer inloggen en je vrouw uitnodigen

1. Open het Cloud Run-adres → **Inloggen met Google**.
2. Maak je huishouden aan.
3. **Instellingen → Partner uitnodigen** → haar Gmail-adres → kopieer de link en stuur die
   (bijv. via WhatsApp). Stel je `RESEND_API_KEY` en `EMAIL_FROM` in, dan gaat er ook een e-mail uit.
4. Zij opent de link en logt in met **dat** Google-account. Ze komt automatisch in het huishouden.
   De link werkt één keer, alleen voor dat e-mailadres, en verloopt na 14 dagen.

### 5. Gegevens overzetten uit de oude Emergent-app

Zolang de oude app nog draait:

```bash
pip install requests
python tools/export_from_emergent.py
```

Dit maakt een `backup-emergent-….json`. Zet die terug via **Instellingen → Back-up terugzetten**.
Bijlagen gaan niet mee; die upload je opnieuw. Verwijder het back-upbestand daarna.

**Zet daarna de oude Emergent-app uit.** Het wachtwoord ervan stond in de oude code.

---

## Back-ups

**Instellingen → Back-up downloaden** geeft een JSON-bestand met alle gegevens (zonder bijlagen).
Doe dit maandelijks en bewaar het op een veilige plek. Atlas M0 maakt zelf geen back-ups.

## Lokaal ontwikkelen

```bash
# backend
cd backend
cp .env.example .env        # vul in; COOKIE_SECURE=false en CORS_ORIGINS=http://localhost:3000
pip install -r requirements-dev.txt
uvicorn server:app --reload --port 8001

# frontend (andere terminal)
cd frontend
yarn install
yarn start                  # http://localhost:3000, /api wordt doorgestuurd naar :8001
```

Voeg `http://localhost:3000` toe als *Authorized JavaScript origin* bij je OAuth-client.

## Tests

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

- `tests/test_calc.py`: de rekenregels, getoetst aan vaste uitkomsten uit ons Excel-bestand (v5).
  Ook de bouwdepot-scenario's die in de Emergent-versie fout gingen.
- `tests/test_api.py`: toegang, uitnodigingen, afscherming tussen huishoudens, bijlagen en back-up.

Draai de tests vóór elke wijziging aan `calc.py`. Een rood testresultaat betekent dat er iets
aan de sommen is veranderd.

## Beveiliging in het kort

- Alleen Google-login; geen wachtwoorden in de app.
- Toegang: e-mailadressen in `ALLOWED_EMAILS` + openstaande uitnodigingen + bestaande leden.
- Sessie in `HttpOnly`/`Secure`/`SameSite=Lax`-cookies (12 uur, stil verlengd tot 30 dagen).
- Elke API-aanroep controleert of je lid bent van het huishouden.
- Bijlagen: alleen pdf/afbeeldingen, max. 10 MB, opgeslagen in de eigen database.
- Geen analytics of externe scripts, behalve Google-login en Google Fonts.

**Deze repository moet privé blijven.** De tests bevatten onze echte bedragen.
