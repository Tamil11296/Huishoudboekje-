# Dashboard-standaard: look & feel en werkwijze

> **Gebruik:** plak dit bestand in de *Project knowledge* (of de projectinstructies) van elk
> Claude-project waarin je een dashboard of app bouwt. Zeg daarna bijvoorbeeld:
> *"Bouw volgens de Dashboard-standaard een dashboard voor [onderwerp]. Bron: [bestand/lijst]."*
>
> Referentie-implementatie: repository **Huishoudboekje-** (React + FastAPI).
> Taal van alle schermen, teksten en communicatie: **Nederlands**.

---

## 1. Werkwijze: zo pakken we een dashboard aan

Deze stappen zijn belangrijker dan het uiterlijk. Een mooi dashboard dat verkeerd rekent, is
schadelijker dan een lelijke spreadsheet.

### 1.1 Eerst de sommen, dan de schermen

1. **Leg de bron van de waarheid vast.** Welke gegevens gaan erin (Excel, SharePoint-lijst,
   export), en welke cijfers moeten eruit komen? Schrijf 3 tot 5 concrete voorbeelden op met de
   **verwachte uitkomst**, uit de huidige spreadsheet of met de hand nagerekend.
2. **Schrijf de rekenregels apart** van de schermen: één module met pure functies, zonder
   database of schermcode. In de referentie is dat `backend/calc.py`.
3. **Maak tests met vaste uitkomsten** voordat je schermen bouwt. Een test vergelijkt de
   uitkomst met een getal dat je van tevoren kende (bijv. *"oktober samen over = € 1.196,53"*),
   niet met wat de code zelf uitrekent.
4. **Test de randgevallen bewust:**
   - begin- en einddatum op de 29e, 30e of 31e, en schrikkeljaren
   - jaarlijkse, kwartaal- en halfjaarlijkse posten
   - lege velden, nul, negatieve bedragen (correcties)
   - dubbeltelling: kan één bedrag via twee routes meetellen?
   - gedeeltelijke betalingen en termijnen
5. **Een controle moet onafhankelijk zijn.** Tel hetzelfde totaal op twee verschillende manieren
   op (bijv. per post én per depot) en toon het verschil. Een controle die met dezelfde formule
   rekent als de uitkomst, geeft altijd € 0 en bewijst niets.

### 1.2 Klein beginnen, bewust uitbreiden

- Bouw eerst de kern: invoer → berekening → overzicht → controle. Pas als de kern klopt:
  extra's zoals grafieken, export, meldingen en AI.
- Elke nieuwe functie moet een concreet probleem oplossen. "Zou handig kunnen zijn" is geen
  reden. Elke functie is extra onderhoud en extra plekken waar het mis kan gaan.
- Liever **één scherm dat klopt** dan vijf tabbladen waarvan er één verkeerd rekent.

### 1.3 Opleveren

- **Complete, direct bruikbare bestanden.** Geen losse fragmenten die je zelf moet samenvoegen.
  Bij VBA: complete `.bas`-modules.
- **Werkt iets niet na twee pogingen?** Terug naar de laatst werkende versie en opnieuw
  analyseren, in plaats van steeds hetzelfde onderdeel aan te passen.
- **Voor elke oplevering controleren:**
  1. alle tests groen
  2. de build slaagt zonder fouten
  3. zelf doorgeklikt (mobiel én desktop), met echte of realistische gegevens
  4. zoeken naar wachtwoorden, sleutels en e-mailadressen in de code (`git grep`)
- **Zeg eerlijk wat niet getest is,** bijvoorbeeld "de echte Google-login kon ik niet testen".

### 1.4 Beveiliging (altijd, ook voor "alleen voor ons")

- **Geen wachtwoorden, sleutels of verbindingsgegevens** in de code, in tests, in documentatie
  of in de chat. Alleen in omgevingsvariabelen of secrets van de hosting. Een voorbeeldbestand
  (`.env.example`) bevat alleen lege of nepwaarden.
- **Repository standaard privé.**
- **Inloggen via een bestaande identiteit:** Google (privé) of Microsoft Entra ID (werk). Geen
  eigen wachtwoorden en geen open registratie.
- **Toegang op basis van een lijst:** een toegangslijst plus uitnodigingen. Uitnodigingen zijn:
  - gekoppeld aan één e-mailadres
  - eenmalig te gebruiken
  - verlopen na een termijn
- **Elke API-aanroep controleert of de gebruiker bij de gegevens mag.** Een test bewijst dat
  gebruiker B de gegevens van A niet kan lezen of wijzigen.
- **Geen tracking of analytics** (PostHog, GA) in apps met persoonlijke of bedrijfsgegevens.
- **Uploads beperken:** alleen toegestane bestandstypes (pdf, afbeeldingen) en een maximale
  grootte.
- **Een back-up** die je zelf kunt downloaden en terugzetten.
- **Tools die code voor je genereren** (Emergent, Lovable, enz.): lees de code na op
  hardgecodeerde inloggegevens, tracking-scripts en tests die alleen zichzelf bevestigen.

---

## 2. Look & feel

Stijl: **rustig, zakelijk, cijfers centraal.** Neutrale leisteen-grijstinten (slate), één
signaalkleur per betekenis, veel witruimte, afgeronde kaarten. Werkt als eerste op de telefoon.

### 2.1 Lettertypes

| Gebruik | Lettertype | Tailwind-class |
|---|---|---|
| Koppen, logo | **Outfit** (600–800) | `font-heading` |
| Tekst, labels | **IBM Plex Sans** (400–600) | standaard (`body`) |
| Bedragen, getallen | **JetBrains Mono** met `tabular-nums` | `font-num` |

```css
@import url("https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap");
body { font-family: "IBM Plex Sans", -apple-system, sans-serif; -webkit-font-smoothing: antialiased; }
.font-heading { font-family: "Outfit", "IBM Plex Sans", sans-serif; }
.font-num { font-family: "JetBrains Mono", monospace; font-variant-numeric: tabular-nums; }
```

**Typografie-hiërarchie:**
- Paginatitel: `font-heading text-3xl sm:text-4xl font-extrabold tracking-tight`
- Sectietitel: `font-heading text-lg font-semibold`
- Label boven een waarde: `text-xs uppercase tracking-widest font-semibold text-slate-500`
- KPI-waarde: `font-num font-bold text-2xl sm:text-3xl`
- Toelichting: `text-xs text-muted-foreground`

### 2.2 Kleuren: betekenis, geen decoratie

| Betekenis | Licht | Donker | Hex |
|---|---|---|---|
| Hoofdkleur, knoppen, "lasten" | `slate-900` | `white` / `slate-100` | #0f172a |
| Positief, inkomen, "klopt" | `emerald-600` | `emerald-400` | #059669 |
| Negatief, tekort, fout | `rose-600` | `rose-400` | #e11d48 |
| Sparen, doelen, prognose | `indigo-500` | `indigo-400` | #6366f1 |
| Waarschuwing, bijna op | `amber-500` / `amber-50` als achtergrond | `amber-300` | #f59e0b |
| Pagina-achtergrond | `slate-50` | `slate-950` | #f8fafc |
| Kaart | `white` | `slate-900` | |
| Randen | `slate-200` | `slate-800` | |
| Rustige tekst | `slate-500` | `slate-400` | |

**Regels:**
- Groen en rood alleen voor goed en fout, nooit als versiering. Kleur staat nooit alleen: zet er
  altijd een teken (−), icoon of woord bij.
- Maximaal 3 kleuren in één grafiek. Voor meer categorieën (taart- en staafgrafieken) gebruik je
  deze volgorde: `#0f172a #059669 #f59e0b #6366f1 #ec4899 #14b8a6 #ef4444 #8b5cf6 #0ea5e9 #84cc16`.
- Donkere modus via de class `.dark`. Alle kleuren als CSS-variabelen (shadcn-tokens), zie
  `frontend/src/index.css`. Afronding: `--radius: 0.75rem`.

### 2.3 Opbouw van een scherm

```
┌───────────────────────────────────────────────┐
│ Header (sticky, wazig doorschijnend)          │  logo · context-kiezer · nav · NL/EN · ☾ · avatar
├───────────────────────────────────────────────┤
│ Paginatitel                                   │
│ context · periode                             │
│ [‹ September ›]  [Maand|Jaar]  [2026 ▾]       │  periodekiezer
│ [Overzicht][Grafieken][Per persoon][Tabel]    │  tabbladen tegen lang scrollen
│ ┌KPI┐ ┌KPI┐ ┌KPI┐ ┌KPI┐                        │  1 kolom mobiel → 2 → 4 desktop
│ ┌ Controlepaneel (groen = klopt / rood) ┐      │
│ ┌ Kaart: grafiek / tabel ┐                     │
│                                          (+)  │  zwevende knop "snel toevoegen"
└───────────────────────────────────────────────┘
```

- **Container:** `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8`
- **Header:** `sticky top-0 z-50 backdrop-blur-md bg-white/80 dark:bg-slate-950/80 border-b`, hoogte `h-16`.
  Op mobiel wordt de navigatie een menu (☰).
- **Kaart:** shadcn `Card`, `p-5` of `p-6`, `rounded-xl`, een subtiele rand en geen zware schaduw.
- **KPI-tegels in een raster:** `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4`.
- **Tabbladen** (shadcn `Tabs`) om lang scrollen te voorkomen. Op mobiel alleen iconen.
- **Periodekiezer:** vorige/volgende-pijlen + Maand/Jaar-schakelaar + jaarkeuze. De huidige
  periode is de standaard.
- **Tabellen:** horizontaal scrollbaar op mobiel (`overflow-x-auto`), bedragen rechts uitgelijnd
  in `font-num`, de totaalrij vet met een lijn erboven.
- **Status als badge:**
  - Afgesloten / Lopend / Prognose (prognose: grijs en cursief)
  - Ontvangen / Geaccepteerd / Ingediend / Betaald / Te laat
- **Controlepaneel** bovenaan elk financieel of kwaliteitsoverzicht:
  - groen `bg-emerald-50 border-emerald-200` met ✓ "Alles klopt — controle € 0"
  - rood `bg-rose-50` met ⚠ en per afwijking één regel met uitleg
- **Zwevende knop** (`fixed bottom-6 right-6`, rond, `bg-slate-900`) voor de meest gebruikte
  invoer. Opent een dialoog.
- **Dialogen** (shadcn `Dialog`) voor toevoegen en bewerken. Velden onder elkaar, label erboven,
  "Opslaan" rechts onderaan.
- **Meldingen:** `sonner`, rechtsboven.

### 2.4 KPI-tegel (standaardcomponent)

```jsx
function Kpi({ icon: Icon, label, value, tone, sub }) {
  const toneCls = tone === "pos" ? "text-emerald-600 dark:text-emerald-400"
    : tone === "neg" ? "text-rose-600 dark:text-rose-400"
    : "text-slate-900 dark:text-slate-100";
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-widest font-semibold text-slate-500">{label}</span>
        <Icon className="h-4 w-4 text-slate-400" />
      </div>
      <div className={`font-num font-bold text-2xl sm:text-3xl mt-3 ${toneCls}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </Card>
  );
}
```

### 2.5 Grafieken (Recharts)

- **Staafgrafiek per maand:** staven met afgeronde bovenkant `radius={[4,4,0,0]}`, raster alleen
  horizontaal (`vertical={false}`, gestippeld, `hsl(214 32% 91%)`), assen in `hsl(215 16% 47%)`, `fontSize: 12`.
- **Verloop:** `Area` met een verloop van 40% naar 0% dekking. Het gemiddelde of doel als
  gestippelde `ReferenceLine`.
- **Prognose tegenover werkelijk:** werkelijk als doorgetrokken lijn, prognose gestippeld.
- **Y-as** in duizenden: `€12k`. De tooltip toont het volledige bedrag.
- Altijd in een `ResponsiveContainer` met een vaste hoogte (`h-80`).

### 2.6 Opmaak van getallen en datums (NL)

```js
export const eur  = (v) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(v || 0));
export const eur2 = (v) => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v || 0));
export const pct  = (v) => `${Number(v || 0).toFixed(1)}%`;
```

- KPI's zonder centen (`€ 8.076`), tabellen en controles met centen (`€ 8.075,74`).
- Datum `dd-mm-jjjj`, maandnamen voluit ("September").
- Invoer accepteert zowel `64,20` als `64.20`.

### 2.7 Toegankelijkheid en mobiel

- Aanraakdoelen minimaal 44 px. Echte `<button>`- en `<label>`-elementen gebruiken.
- Contrast minimaal 4,5 : 1. Daarom `slate-500` op wit, en niet lichter.
- Eerst testen op 390 px breed (telefoon), daarna desktop (1366 px).
- Donkere modus en NL/EN via een schakelaar in de header. De keuze wordt onthouden.

---

## 3. Techniek: kies de juiste stapel

**Belangrijk:** de stapel van de referentie-app is bedoeld voor **persoonlijke** apps. Voor
werk (BRC/IFS-omgeving, bedrijfsgegevens) gelden andere eisen: gegevens binnen de
Microsoft-omgeving van het bedrijf, inloggen via Entra ID, en IT-goedkeuring. Neem de
persoonlijke stapel dus niet over voor werkapps. Neem wel de look & feel en de werkwijze over.

| | **A. Persoonlijk** (referentie) | **B. Werk: low-code** | **C. Werk: maatwerk** |
|---|---|---|---|
| Schermen | React + Tailwind + shadcn/ui + Recharts | Power Apps (canvas) | React + Tailwind + shadcn/ui |
| Gegevens | MongoDB Atlas (EU) | SharePoint-lijsten / Dataverse | SharePoint / Dataverse via Graph |
| Inloggen | Google Identity Services | M365 (automatisch) | Microsoft Entra ID (MSAL) |
| Logica | FastAPI (`calc.py` + pytest) | Power Fx / Power Automate | API of Azure Functions |
| Hosting | Google Cloud Run (NL) | Power Platform | Azure Static Web Apps (EU) |

**Look & feel in Power Apps (B):** zelfde kleuren (hex uit 2.2), `Lato` of `Segoe UI` als
tekstlettertype, getallen rechts uitgelijnd, KPI-tegels als containers met afronding 12 en een rand
`#E2E8F0`, een controlelabel bovenaan in groen of rood.

**Structuur referentie-app (A):**
```
backend/  server.py (API) · auth.py (login + toegang) · calc.py (alle sommen) · deps.py
          storage.py · tests/ (test_calc.py met vaste uitkomsten, test_api.py toegang/isolatie)
frontend/ src/pages/* (één bestand per scherm) · src/components/ui/* (shadcn)
          src/lib/format.js (NL-opmaak) · src/lib/api.js (API-client + sessievernieuwing)
tools/demo/  demo zonder accounts (Codespaces) — niet in productie
Dockerfile   één container: gebouwde frontend + backend
```

---

## 4. Checklists

**Voordat we bouwen:**
- [ ] Bron van de gegevens en eigenaar bekend
- [ ] 3 tot 5 voorbeelden met verwachte uitkomst op papier
- [ ] Wie mag erin, en wie mag wat wijzigen?
- [ ] Persoonlijk of werk → stapel A, B of C gekozen
- [ ] Minimale versie afgesproken (wat komt er nog **niet** in)

**Voordat we opleveren:**
- [ ] Tests met vaste uitkomsten groen, inclusief de randgevallen
- [ ] Onafhankelijke controle toont € 0 bij correcte gegevens en een afwijking bij fouten
- [ ] Toegangstest: een ander account ziet niets
- [ ] Geen geheimen of tracking in de code; repository privé
- [ ] Mobiel en desktop doorgeklikt, licht en donker
- [ ] README: installeren, back-up, lokaal draaien, tests
- [ ] Eerlijk vermeld wat niet getest kon worden

---

## 5. Startprompt voor een nieuw dashboard

```
Bouw volgens de Dashboard-standaard (project knowledge) een dashboard voor: [ONDERWERP].

Context:
- Gebruikers: [wie], toegang: [wie mag lezen / wijzigen]
- Omgeving: [persoonlijk (stapel A) / werk low-code (B) / werk maatwerk (C)]
- Bron: [bestand / SharePoint-lijst / export] — bijgevoegd: [ja/nee]
- Belangrijkste vragen die het dashboard moet beantwoorden:
  1. ...
  2. ...
- Verwachte uitkomsten om op te testen:
  - [voorbeeld + getal]
  - [voorbeeld + getal]

Werkwijze:
1. Stel eerst de rekenregels en tests met deze vaste uitkomsten op; laat die zien.
2. Bouw daarna de schermen in de look & feel van de standaard (NL, mobiel eerst).
3. Lever complete bestanden op, met README, en meld wat niet getest is.
Wees kritisch: wijs op ontbrekende gegevens, dubbeltellingen en beveiligingsrisico's.
```
