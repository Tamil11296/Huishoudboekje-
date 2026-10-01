// Excel- en PDF-export in de browser (was backend/export.py). Bibliotheken worden pas
// geladen als iemand op de knop drukt, zodat de app zelf klein blijft.

const eur = (v) => "€ " + Number(v || 0).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function buildExcel(p) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const dash = p.dashboard;
  const persons = Object.fromEntries((dash.persons || []).map((x) => [x.person_id, x.name]));
  const sheet = (title, headers, rows) => {
    const ws = wb.addWorksheet(title);
    ws.addRow(headers);
    ws.getRow(1).eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F172A" } };
    });
    rows.forEach((r) => ws.addRow(r));
    ws.columns.forEach((col) => {
      let w = 10;
      col.eachCell({ includeEmpty: false }, (c) => { w = Math.max(w, String(c.value ?? "").length); });
      col.width = Math.min(w + 3, 42);
    });
  };
  sheet("Dashboard", ["Maand", "Status", "Inkomen", "Vaste lasten", "Variabele lasten", "Totale lasten", "Over", "Cumulatief", "Spaarquote %"],
    dash.months.map((m) => [m.label, m.status, m.income, m.fixed, m.variable, m.expenses, m.over, m.cumulative, m.savings_rate]));
  const a = dash.annual;
  sheet("Jaartotaal", ["Post", "Bedrag"], [["Totaal inkomen", a.income], ["Vaste lasten", a.fixed],
    ["Variabele lasten", a.variable], ["Totale lasten", a.expenses], ["Over", a.over],
    ["Gem. per maand sparen", a.avg_monthly_over || 0], ["Spaarquote %", a.savings_rate]]);
  sheet("Per persoon", ["Persoon", "Verdient", "Betaalt", "Aandeel gezamenlijk", "Houdt over"],
    Object.entries(dash.per_person_year).map(([pid, v]) => [persons[pid] || pid, v.income, v.own, v.joint_share, v.net]));
  sheet("Categorieen", ["Categorie", "Uitgaven (jaar)"], Object.entries(dash.expense_by_category || {}));
  const depotRows = [], postRows = [];
  for (const d of p.depots) {
    depotRows.push([d.name, d.start_amount, d.paid_out, d.submitted_not_paid, d.still_to_submit, d.freely_available, d.end_date, d.days_remaining]);
    for (const po of d.posts) postRows.push([d.name, po.name, po.budget, po.accepted_quotes, po.invoiced, po.paid, po.commitment, po.room]);
  }
  sheet("Bouwdepot", ["Depot", "Startbedrag", "Uitbetaald", "Ingediend n.n. betaald", "Nog in te dienen", "Vrij besteedbaar", "Einddatum", "Dagen resterend"], depotRows);
  sheet("Bouwposten", ["Depot", "Bouwpost", "Budget", "Geaccepteerde offertes", "Gefactureerd", "Betaald", "Verplichting", "Ruimte"], postRows);
  sheet("Facturen", ["Leverancier", "Type", "Status", "Bedrag incl btw", "Factuurbedrag", "Ingediend", "Betaald op"],
    (p.invoices || []).map((i) => [i.supplier, i.type, i.status, i.amount_incl_vat, i.invoice_amount, i.submitted_to_bank ? "Ja" : "Nee", i.paid_on]));
  sheet("Doelen & Sparen", ["Doel", "Type", "Streefdatum", "Saldo", "Per maand", "Nog nodig", "Maanden", "Haalbaar"],
    (p.goals || []).map((g) => [g.name, g.has_target ? "Project" : "Doorlopend", g.target_date || "-", g.balance, g.monthly_amount,
      g.has_target ? g.remaining : "-", g.has_target ? g.months_left : "-", g.has_target ? (g.feasible ? "Ja" : "Nee") : "-"]));
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export async function buildPdf(p) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const docPdf = new jsPDF({ unit: "mm", format: "a4" });
  const dash = p.dashboard, a = dash.annual;
  const persons = Object.fromEntries((dash.persons || []).map((x) => [x.person_id, x.name]));
  let y = 20;
  docPdf.setFontSize(16); docPdf.setTextColor(15, 23, 42);
  docPdf.text(`Huishoudboekje — ${p.household.name}`, 16, y);
  docPdf.setFontSize(9); docPdf.setTextColor(100, 116, 139);
  docPdf.text(`Jaaroverzicht ${dash.year} · EUR`, 16, (y += 6));
  const table = (title, head, body) => {
    docPdf.setFontSize(12); docPdf.setTextColor(15, 23, 42);
    docPdf.text(title, 16, (y += 10));
    autoTable(docPdf, {
      startY: y + 3, head: [head], body, margin: { left: 16, right: 16 },
      styles: { fontSize: 8, cellPadding: 1.8 }, headStyles: { fillColor: [15, 23, 42] },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      columnStyles: Object.fromEntries(head.slice(1).map((_, i) => [i + 1, { halign: "right" }])),
    });
    y = docPdf.lastAutoTable.finalY;
    if (y > 250) { docPdf.addPage(); y = 10; }
  };
  table("Jaartotaal", ["Post", "Bedrag"], [["Totaal inkomen", eur(a.income)], ["Vaste lasten", eur(a.fixed)],
    ["Variabele lasten", eur(a.variable)], ["Totale lasten", eur(a.expenses)], ["Over", eur(a.over)],
    ["Gem. per maand sparen", eur(a.avg_monthly_over)], ["Spaarquote", `${a.savings_rate}%`]]);
  table("Per persoon — wat houden we over?", ["Persoon", "Verdient", "Betaalt", "Gezamenlijk", "Houdt over"],
    Object.entries(dash.per_person_year).map(([pid, v]) => [persons[pid] || pid, eur(v.income), eur(v.own), eur(v.joint_share), eur(v.net)]));
  for (const d of p.depots) {
    table(`Bouwdepot — ${d.name}`, ["Post", "Bedrag"], [["Startbedrag", eur(d.start_amount)], ["Uitbetaald", eur(d.paid_out)],
      ["Ingediend, nog niet betaald", eur(d.submitted_not_paid)], ["Nog in te dienen", eur(d.still_to_submit)],
      ["Vrij besteedbaar", eur(d.freely_available)], ["Einddatum", String(d.end_date || "-")],
      ["Dagen resterend", d.days_remaining == null ? "-" : String(d.days_remaining)]]);
    if (d.posts.length) table("Bouwposten", ["Bouwpost", "Budget", "Verplichting", "Ruimte"],
      d.posts.map((po) => [po.name, eur(po.budget), eur(po.commitment), eur(po.room)]));
  }
  if ((p.goals || []).length) table("Doelen & Sparen", ["Doel", "Type", "Streefdatum", "Saldo", "Per maand", "Haalbaar"],
    p.goals.map((g) => [g.name, g.has_target ? "Project" : "Doorlopend", String(g.target_date || "-"), eur(g.balance),
      eur(g.has_target ? g.required_monthly : g.monthly_amount), g.has_target ? (g.feasible ? "Ja" : "Nee") : "-"]));
  return docPdf.output("blob");
}
