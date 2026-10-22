export function renderDashboard(
  container,
  { profile, onManageMembers, onManageHours, onOpenReports, onManageLevels, onSignOut },
) {
  const isAdmin = profile.role === "admin";

  container.innerHTML = `
    <section class="dashboard">
      <header class="topbar">
        <h1>Pathway Clinical Hours Management System</h1>
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
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
