export function renderDashboard(
  container,
  {
    profile,
    onManageMembers,
    onManageHours,
    onOpenReports,
    onManageLevels,
    loadSummary, // async () => summary (see data/dashboardRepository.js)
    onOpenReport, // (reportId, presetFilters) => void
    onSignOut,
  },
) {
  const isAdmin = profile.role === "admin";

  container.innerHTML = `
    <section class="dashboard">
      <header class="topbar">
        <h1>Pathway Admin</h1>
        <div class="account">
          <span>Signed in as <strong>${
    escapeHtml(profile.username)
  }</strong> (${escapeHtml(profile.role)})</span>
          <button class="button button-secondary" id="sign-out" type="button">Sign out</button>
        </div>
      </header>
      <main class="dashboard-content">
        <h2>Welcome back</h2>
        <p>Set up membership levels before creating member records.</p>
        <section class="summary" id="summary" aria-live="polite" aria-label="Membership summary">
          <p class="summary-status">Loading summary…</p>
        </section>
        <div class="module-grid">
          <article class="module-card module-card-action">
            <h3>Members</h3>
            <p>Maintain member details and renewal dates.</p>
            <button class="button button-secondary button-small" id="manage-members" type="button">Manage members</button>
          </article>
          <article class="module-card module-card-action">
            <h3>Hours</h3>
            <p>Record clinical, supervision, and OPD hours.</p>
            <button class="button button-secondary button-small" id="manage-hours" type="button">Manage hours</button>
          </article>
          <article class="module-card module-card-action">
            <h3>Reports</h3>
            <p>Review yearly totals and export results.</p>
            <button class="button button-secondary button-small" id="open-reports" type="button">Open reports</button>
          </article>
          <article class="module-card module-card-action">
                    <h3>Membership levels</h3>
                    <p>${
            isAdmin
              ? "Create and maintain the list used when adding members."
              : "View the available membership levels."
          }</p>
                    <button class="button button-secondary button-small" id="manage-levels" type="button">${
            isAdmin ? "Manage levels" : "View levels"
          }</button>
          </article>
        </div>
      </main>
    </section>
  `;

  container
    .querySelector("#manage-members")
    .addEventListener("click", onManageMembers);
  container
    .querySelector("#open-reports")
    .addEventListener("click", onOpenReports);
  container
    .querySelector("#manage-hours")
    .addEventListener("click", onManageHours);
  container
    .querySelector("#manage-levels")
    .addEventListener("click", onManageLevels);
  container.querySelector("#sign-out").addEventListener("click", onSignOut);

  const summaryEl = container.querySelector("#summary");

  // Where each clickable tile goes.
  const targets = {
    members: () => onManageMembers(),
    expired: () => onOpenReport("expiring", { months: "0", status: "active" }),
    expiring: () =>
      onOpenReport("expiring", { months: "6", status: "active", includeExpired: false }),
    missing: () => onOpenReport("incomplete", { status: "active" }),
  };

  summaryEl.addEventListener("click", (event) => {
    const tile = event.target.closest("[data-target]");
    if (tile) targets[tile.dataset.target]?.();
  });

  // A failed summary must never break the rest of the dashboard.
  loadSummary()
    .then((summary) => {
      if (!summaryEl.isConnected) return; // the person already left this screen
      summaryEl.innerHTML = summaryHtml(summary);
    })
    .catch(() => {
      if (!summaryEl.isConnected) return;
      summaryEl.innerHTML =
        '<p class="summary-status" role="alert">The summary could not be loaded. Please check your connection or trun VPN on.</p>';
    });
}

const formatNumber = (value) => Number(value).toLocaleString("en-US");

function tile({ target, label, value, note, tone }) {
  const body = `
    <span class="stat-label">${escapeHtml(label)}</span>
    <span class="stat-value">${formatNumber(value)}</span>
    ${note ? `<span class="stat-note">${escapeHtml(note)}</span>` : ""}`;

  return target
    ? `<button type="button" class="stat-tile stat-link"${tone ? ` data-tone="${tone}"` : ""} data-target="${target}">${body}</button>`
    : `<div class="stat-tile"${tone ? ` data-tone="${tone}"` : ""}>${body}</div>`;
}

function summaryHtml(summary) {
  const expiringTotal =
    summary.expiringWithin1 + summary.expiringWithin3 + summary.expiringWithin6;

  const tiles = [
    tile({
      target: "members",
      label: "Active members",
      value: summary.activeMembers,
      note: `${formatNumber(summary.suspendedMembers)} suspended`,
    }),
    tile({
      target: "members",
      label: "New this month",
      value: summary.newThisMonth,
      note: "Active members added",
    }),
    tile({
      target: "expired",
      label: "Expired",
      value: summary.expired,
      note: "Active, past expiry date",
      tone: summary.expired ? "danger" : "",
    }),
    tile({
      target: "expiring",
      label: "Expiring in 6 months",
      value: expiringTotal,
      note: `1 mo: ${formatNumber(summary.expiringWithin1)} · 1–3 mo: ${
        formatNumber(summary.expiringWithin3)
      } · 3–6 mo: ${formatNumber(summary.expiringWithin6)}`,
      tone: summary.expiringWithin1 ? "warning" : "",
    }),
    tile({
      target: "missing",
      label: "Missing details",
      value: summary.missingDetails,
      note: "Active members with an empty detail",
      tone: summary.missingDetails ? "warning" : "",
    }),
  ].join("");

  const mostMembers = Math.max(1, ...summary.levels.map((level) => level.count));
  const levels = summary.levels.length
    ? summary.levels.map((level) => `
        <li class="level-row">
          <span class="level-name">${escapeHtml(level.name)}</span>
          <span class="level-bar" aria-hidden="true"><span style="width:${
      Math.round((level.count / mostMembers) * 100)
    }%"></span></span>
          <span class="level-count">${formatNumber(level.count)}</span>
        </li>`).join("")
    : '<li class="level-row"><span class="level-name">No active membership levels yet.</span></li>';

  return `
    <div class="stat-grid">${tiles}</div>
    <div class="level-card">
      <h3>Active members by level</h3>
      <ul class="level-list">${levels}</ul>
    </div>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
