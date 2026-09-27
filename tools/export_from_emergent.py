"""Haalt al je gegevens uit de oude Emergent-app en maakt er een back-upbestand van
dat je in de nieuwe app terugzet (Instellingen > Back-up terugzetten).

Gebruik (eenmalig, op je eigen computer):
    pip install requests
    python export_from_emergent.py

Je wordt gevraagd om het adres van de oude app, je e-mail en wachtwoord van de oude app.
Bijlagen (pdf's/foto's) gaan niet mee; die upload je opnieuw.
"""
import getpass
import json
from datetime import datetime, timezone

import requests

COLLECTIONS = {  # API-pad in de oude app -> naam in de back-up
    "incomes": "incomes",
    "fixed-expenses": "fixed_expenses",
    "variable-expenses": "variable_expenses",
    "bouwdepots": "bouwdepots",
    "bouwposten": "bouwposten",
    "invoices": "invoices",
    "pots": "pots",
    "project-items": "project_items",
}


def main():
    base = input("Adres oude app [https://budget-reno-1.emergent.host]: ").strip() or "https://budget-reno-1.emergent.host"
    base = base.rstrip("/") + "/api"
    email = input("E-mail oude app: ").strip()
    password = getpass.getpass("Wachtwoord oude app: ")
    s = requests.Session()
    r = s.post(f"{base}/auth/login", json={"email": email, "password": password}, timeout=30)
    r.raise_for_status()
    households = s.get(f"{base}/households", timeout=30).json()
    for i, h in enumerate(households):
        print(f"  [{i}] {h['name']}")
    idx = int(input("Welk huishouden? [0]: ").strip() or 0)
    hh = households[idx]
    hid = hh["household_id"]
    out = {"version": 1, "exported_at": datetime.now(timezone.utc).isoformat(), "household": hh}
    for path, key in COLLECTIONS.items():
        rows = s.get(f"{base}/households/{hid}/{path}", timeout=60).json()
        out[key] = rows
        print(f"  {key}: {len(rows)} regels")
    fn = f"backup-emergent-{datetime.now().date().isoformat()}.json"
    with open(fn, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f"\nKlaar: {fn}\nZet dit bestand terug in de nieuwe app via Instellingen > Back-up terugzetten.")
    print("Let op: dit bestand bevat al je financiële gegevens. Verwijder het daarna.")


if __name__ == "__main__":
    main()
