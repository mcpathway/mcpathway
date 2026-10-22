// The Reports screens: a menu of reports, and one generic report page that
// draws whichever report definition (data/reportDefinitions.js) it is given.
// A report page loads ONE page of rows at a time; downloads fetch everything.

const SEARCH_DELAY_MS = 300;

/* ------------------------------------------------------------------ */
/* Reports menu                                                        */
/* ------------------------------------------------------------------ */

export function renderReportsHome(
  container,
  { profile, reports, onOpen, onBack, onSignOut },
) {
  container.innerHTML = `
    <section class="dashboard">
      ${topbar(profile)}
      <main class="dashboard-content">
        <div class="section-header">
          <div>
            <button class="text-button" id="back-to-dashboard" type="button">← Dashboard</button>
            <h2>Reports</h2>
            <p>Choose a report. Each one can be downloaded as CSV or Excel.</p>
          </div>
        </div>
        <div class="module-grid" id="report-list">
          ${
    reports.map((report) => `
            <article class="module-card module-card-action">
              <h3>${escapeHtml(report.title)}</h3>
              <p>${escapeHtml(report.description)}</p>
              <button class="button button-secondary button-small" data-report="${escapeHtml(report.id)}" type="button">Open report</button>
            </article>`).join("")
  }
        </div>
      </main>
    </section>
  `;

  container.querySelector("#back-to-dashboard").addEventListener("click", onBack);
  container.querySelector("#sign-out").addEventListener("click", onSignOut);
  container.querySelector("#report-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-report]");
    if (button) onOpen(button.dataset.report);
  });
}

/* ------------------------------------------------------------------ */
/* One report                                                          */
/* ------------------------------------------------------------------ */

export function renderReport(
  container,
  {
    profile,
    report,
    backLabel,
    pageSize,
    onBack,
    onExport, // (format: "csv" | "xlsx", { name, headers, rows }) => Promise<void>
    onSignOut,
  },
) {
  container.innerHTML = `
    <section class="dashboard">
      ${topbar(profile)}
      <main class="dashboard-content">
        <div class="section-header">
          <div>
            <button class="text-button" id="back-to-reports" type="button">← ${escapeHtml(backLabel)}</button>
            <h2>${escapeHtml(report.title)}</h2>
            <p>${escapeHtml(report.description)}</p>
          </div>
        </div>
        <section class="list-card report-card">
          <div class="report-filters" id="report-filters"></div>
          <div class="report-toolbar">
            <button class="button button-secondary button-small" id="report-csv" type="button" disabled>Download CSV</button>
            <button class="button button-secondary button-small" id="report-xlsx" type="button" disabled>Download Excel</button>
            ${
    (report.actions ?? []).map((action) => `
            <button class="button button-secondary button-small" data-action="${escapeHtml(action.id)}" type="button" disabled>${escapeHtml(action.label)}</button>`).join("")
  }
          </div>
          <p class="message" id="report-message" role="status" data-kind="info"></p>
          <div id="report-results" aria-live="polite"></div>
        </section>
      </main>
    </section>
  `;

  container.querySelector("#back-to-reports").addEventListener("click", onBack);
  container.querySelector("#sign-out").addEventListener("click", onSignOut);

  const filtersEl = container.querySelector("#report-filters");
  const resultsEl = container.querySelector("#report-results");
  const messageEl = container.querySelector("#report-message");
  const csvButton = container.querySelector("#report-csv");
  const xlsxButton = container.querySelector("#report-xlsx");
  const actionButtons = [...container.querySelectorAll("[data-action]")];

  const filters = {};
  for (const filter of report.filters) {
    filters[filter.name] = typeof filter.default === "function" ? filter.default() : filter.default;
  }

  let rows = []; // the rows of the CURRENT page only
  let total = 0; // matching rows across all pages
  let summary = [];
  let notes = [];
  let page = 1;
  let loading = false;
  let busyWithDownload = false;
  let requestId = 0;
  let searchTimer;

  function setMessage(text, kind = "info") {
    messageEl.textContent = text;
    messageEl.dataset.kind = kind;
  }

  const visibleColumns = () =>
    report.columns.filter((column) => !column.show || column.show(filters));

  function updateButtons() {
    const disabled = loading || busyWithDownload || total === 0;
    csvButton.disabled = disabled;
    xlsxButton.disabled = disabled;
    actionButtons.forEach((button) => (button.disabled = disabled));
  }

  function applyVisibility() {
    for (const filter of report.filters) {
      if (!filter.showWhen) continue;
      const wrapper = filtersEl.querySelector(`[data-filter="${filter.name}"]`);
      if (wrapper) wrapper.hidden = !filter.showWhen(filters);
    }
  }

  function drawResults() {
    const columns = visibleColumns().filter((column) => !column.exportOnly);
    const title = report.resultsTitle ? report.resultsTitle(filters) : "";
    let html = "";

    if (title) html += `<h3 class="report-title">${escapeHtml(title)}</h3>`;

    if (summary.length) {
      html += `<dl class="report-summary">${
        summary.map((item) =>
          `<div class="total-tile"><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`
        ).join("")
      }</dl>`;
    }

    for (const note of notes) html += `<p class="report-note">${escapeHtml(note)}</p>`;

    if (!rows.length) {
      html += `
        <div class="empty-results">
          <h3>Nothing to show</h3>
          <p>${escapeHtml(report.emptyMessage ?? "No members match these filters.")}</p>
        </div>`;
    } else {
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const first = (page - 1) * pageSize + 1;
      const last = first + rows.length - 1;

      html += `
        <div class="table-scroll">
          <table class="report-table">
            <thead>
              <tr>${columns.map((column) => `<th scope="col">${escapeHtml(column.label)}</th>`).join("")}</tr>
            </thead>
            <tbody>
              ${rows.map((row) => `<tr>${columns.map((column) => cell(column, row)).join("")}</tr>`).join("")}
            </tbody>
          </table>
        </div>
        <nav class="pager" aria-label="Report pages">
          <button class="button button-secondary button-small" data-page="prev" type="button"${
        page <= 1 ? " disabled" : ""
      }>← Previous</button>
          <span class="pager-info">${first}–${last} of ${total}<span class="pager-page"> · Page ${page} of ${totalPages}</span></span>
          <button class="button button-secondary button-small" data-page="next" type="button"${
        page >= totalPages ? " disabled" : ""
      }>Next →</button>
        </nav>`;
    }

    resultsEl.innerHTML = html;
    updateButtons();
  }

  // Loads the current page. Late answers to old requests are ignored, so quick
  // filter changes can't leave the screen showing results for the wrong filters.
  async function load() {
    const thisRequest = ++requestId;
    loading = true;
    updateButtons();
    resultsEl.setAttribute("aria-busy", "true");

    try {
      const result = await report.loadPage({ ...filters }, { page, pageSize });
      if (thisRequest !== requestId) return;

      rows = result.rows;
      total = result.total;
      page = result.page ?? page;
      summary = result.summary ?? [];
      notes = result.notes ?? [];
      loading = false;
      drawResults();
    } catch (error) {
      if (thisRequest !== requestId) return;

      rows = [];
      total = 0;
      loading = false;
      resultsEl.innerHTML = `<p class="error-panel" role="alert">${
        escapeHtml(error instanceof Error ? error.message : "Unable to load the report.")
      }</p>`;
      updateButtons();
    } finally {
      if (thisRequest === requestId) resultsEl.removeAttribute("aria-busy");
    }
  }

  // Dropdowns and checkboxes reload straight away...
  filtersEl.addEventListener("change", (event) => {
    const control = event.target.closest("select, input");
    if (!control || control.type === "search") return;

    const filter = report.filters.find((item) => item.name === control.name);
    if (!filter) return;

    filters[filter.name] = control.type === "checkbox" ? control.checked : control.value;
    applyVisibility();
    setMessage("");

    if (filter.local) return; // only affects copying, nothing to reload
    page = 1;
    load();
  });

  // ...and the member search waits until typing pauses.
  filtersEl.addEventListener("input", (event) => {
    const control = event.target;
    if (control.type !== "search") return;

    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filters[control.name] = control.value.trim();
      page = 1;
      setMessage("");
      load();
    }, SEARCH_DELAY_MS);
  });

  resultsEl.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-page]");
    if (!button) return;

    page += button.dataset.page === "next" ? 1 : -1;
    await load();
    resultsEl.scrollIntoView({ block: "start" });
  });

  // Downloads and "copy" need every matching row, not just this page.
  async function withEveryRow(work) {
    setMessage("Preparing the full list…");
    busyWithDownload = true;
    updateButtons();

    try {
      setMessage((await work()) ?? "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Something went wrong.", "error");
    } finally {
      busyWithDownload = false;
      updateButtons();
    }
  }

  function exportAs(format) {
    return withEveryRow(async () => {
      const all = await report.loadAll({ ...filters });
      const columns = visibleColumns();
      await onExport(format, {
        name: report.exportName(filters),
        headers: columns.map((column) => column.label),
        rows: all.map((row) => columns.map((column) => column.value(row))),
      });
    });
  }

  csvButton.addEventListener("click", () => exportAs("csv"));
  xlsxButton.addEventListener("click", () => exportAs("xlsx"));

  for (const button of actionButtons) {
    button.addEventListener("click", () => {
      const action = report.actions.find((item) => item.id === button.dataset.action);
      if (!action) return;

      withEveryRow(async () => {
        // Started inside the click so browsers still allow the clipboard write.
        const resultPromise = report.loadAll({ ...filters }).then((all) => action.run(all, filters));
        const copied = await copyResult(resultPromise);
        const { message } = await resultPromise;

        if (!copied) throw new Error("Couldn't copy automatically. Download the list instead.");
        return message;
      });
    });
  }

  // Resolve dropdown options (some load from the database), draw the
  // filters, then run the report once with the default filters.
  (async () => {
    const options = {};
    try {
      for (const filter of report.filters) {
        if (filter.type !== "select") continue;
        options[filter.name] = typeof filter.options === "function"
          ? await filter.options()
          : filter.options;
      }
    } catch (error) {
      resultsEl.innerHTML = `<p class="error-panel" role="alert">${
        escapeHtml(error instanceof Error ? error.message : "Unable to load the filters.")
      }</p>`;
      return;
    }

    filtersEl.innerHTML = report.filters
      .map((filter) => filterControl(filter, options[filter.name], filters[filter.name]))
      .join("");
    applyVisibility();
    await load();
  })();
}

function filterControl(filter, options, value) {
  const name = escapeHtml(filter.name);

  if (filter.type === "checkbox") {
    return `
      <label class="checkbox-field" data-filter="${name}">
        <input type="checkbox" name="${name}"${value ? " checked" : ""} />
        ${escapeHtml(filter.label)}
      </label>`;
  }

  if (filter.type === "search") {
    return `
      <label class="field" data-filter="${name}">
        ${escapeHtml(filter.label)}
        <input type="search" name="${name}" value="${escapeHtml(value ?? "")}"
          placeholder="${escapeHtml(filter.placeholder ?? "")}" autocomplete="off" />
      </label>`;
  }

  return `
    <label class="field" data-filter="${name}">
      ${escapeHtml(filter.label)}
      <select name="${name}">
        ${
    options.map(([optionValue, label]) =>
      `<option value="${escapeHtml(optionValue)}"${String(value) === String(optionValue) ? " selected" : ""}>${escapeHtml(label)}</option>`
    ).join("")
  }
      </select>
    </label>`;
}

function cell(column, row) {
  const raw = column.value(row);
  const text = raw === null || raw === undefined ? "" : String(raw);
  const tag = column.tag?.(row);

  let content;
  if (text === "") content = "—";
  else if (tag) content = `<span class="status ${escapeHtml(tag)}">${escapeHtml(text)}</span>`;
  else content = escapeHtml(text);

  return `<td data-label="${escapeHtml(column.label)}">${content}</td>`;
}

// Copies the text from a promise of { text }. Safari only allows a clipboard
// write that starts inside the click, so the promise is handed to the clipboard
// right away instead of being awaited first.
async function copyResult(resultPromise) {
  if (window.ClipboardItem && navigator.clipboard?.write) {
    try {
      const item = new ClipboardItem({
        "text/plain": resultPromise.then(({ text }) => new Blob([text], { type: "text/plain" })),
      });
      await navigator.clipboard.write([item]);
      return true;
    } catch {
      // Fall through to the older approaches below.
    }
  }

  const { text } = await resultPromise;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fall back for browsers/pages where the clipboard API isn't allowed.
  }

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

function topbar(profile) {
  return `
      <header class="topbar">
        <h1>Pathway Admin</h1>
        <div class="account">
          <span>Signed in as <strong>${escapeHtml(profile.username)}</strong> (${escapeHtml(profile.role)})</span>
          <button class="button button-secondary" id="sign-out" type="button">Sign out</button>
        </div>
      </header>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
