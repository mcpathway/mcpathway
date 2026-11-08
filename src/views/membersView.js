import { formatMemberCode } from "../data/memberRepository.js";

const SEARCH_DELAY_MS = 300;

const EXPIRY_OPTIONS = [
  ["", "Any"],
  ["expired", "Expired"],
  ["1", "Expiring within 1 month"],
  ["3", "Expiring within 3 months"],
  ["6", "Expiring within 6 months"],
  ["valid", "Still valid"],
];

const SORT_OPTIONS = [
  ["newest", "Newest first"],
  ["oldest", "Oldest first"],
  ["name", "Name A–Z"],
  ["expiry_soon", "Expiry: soonest first"],
  ["expiry_late", "Expiry: latest first"],
];

/* ------------------------------------------------------------------ */
/* Screen 1: the members list (search, pages, export, Add button)      */
/* ------------------------------------------------------------------ */

export function renderMembers(
  container,
  {
    profile,
    initialState, // { page, search, showDeleted, levelId, expiry, sort } - restored when coming back from the form
    pageSize,
    loadLevels, // async () => membership levels (for the level filter)
    loadOrganisations, // async () => organisation names (suggestions for the organisation filter)
    loadPage, // ({ page, search, showDeleted, levelId, expiry, sort }) => Promise<{ members, total, page }>
    onStateChange, // remembers page/search so Back from the form returns here
    onAdd,
    onEdit, // (member) => void
    onHours, // (member) => void - opens that member's hours
    onDelete, // (id) => Promise<void>
    onRestore, // (id) => Promise<void>
    onExport, // (format: "csv" | "xlsx", { search, levelId, expiry, organisation, sort }) => Promise<void> - follows the filters
    onBack,
    onSignOut,
  },
) {
  const isAdmin = profile.role === "admin";
  const state = {
    page: 1,
    search: "",
    showDeleted: false,
    levelId: "",
    expiry: "",
    organisation: "",
    sort: "newest",
    ...initialState,
  };
  if (!isAdmin) state.showDeleted = false;

  container.innerHTML = `
    <section class="dashboard">
      ${topbar(profile)}
      <main class="dashboard-content">
        <div class="section-header">
          <div>
            <button class="text-button" id="back-to-dashboard" type="button">← Dashboard</button>
            <h2>Members</h2>
            <p>Search by name or code number.</p>
          </div>
          <button class="button button-small" id="add-member" type="button">Add member</button>
        </div>
        <section class="list-card">
          <div class="list-toolbar">
            <input id="member-search" type="search" placeholder="Search name or code…" aria-label="Search members by name or code" autocomplete="off" />
            <div class="toolbar-actions">
              <button class="button button-secondary button-small" id="toggle-filters" type="button" aria-expanded="false" aria-controls="filter-panel">Filters</button>
              ${
    isAdmin
      ? `<label class="checkbox-field" for="show-deleted">
                       <input id="show-deleted" type="checkbox" />
                       Show deleted
                     </label>`
      : ""
  }
              <button class="button button-secondary button-small" id="export-csv" type="button">Download CSV</button>
              <button class="button button-secondary button-small" id="export-xlsx" type="button">Download Excel</button>
            </div>
          </div>
          <div class="filter-panel" id="filter-panel" hidden>
            <label class="field" for="filter-level">
              Membership level
              <select id="filter-level"><option value="">All levels</option></select>
            </label>
            <label class="field" for="filter-expiry">
              Expiry
              <select id="filter-expiry">
                ${EXPIRY_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
              </select>
            </label>
            <label class="field" for="filter-organisation">
              Organisation
              <input id="filter-organisation" type="search" list="organisation-list" maxlength="200" autocomplete="off" placeholder="Part of the name…" />
              <datalist id="organisation-list"></datalist>
            </label>
            <label class="field" for="filter-sort">
              Sort by
              <select id="filter-sort">
                ${SORT_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
              </select>
            </label>
          </div>
          <div class="filter-chips" id="filter-chips" aria-live="polite"></div>
          <p class="message" id="export-message" role="alert"></p>
          <div id="members-results" aria-live="polite"></div>
        </section>
      </main>
    </section>
  `;

  const results = container.querySelector("#members-results");
  const searchInput = container.querySelector("#member-search");
  const showDeletedBox = container.querySelector("#show-deleted");
  const exportMessage = container.querySelector("#export-message");
  const filterButton = container.querySelector("#toggle-filters");
  const filterPanel = container.querySelector("#filter-panel");
  const levelSelect = container.querySelector("#filter-level");
  const expirySelect = container.querySelector("#filter-expiry");
  const sortSelect = container.querySelector("#filter-sort");
  const organisationInput = container.querySelector("#filter-organisation");
  const organisationList = container.querySelector("#organisation-list");
  const chipsEl = container.querySelector("#filter-chips");

  let levelNames = new Map(); // id -> name, for the filter chips

  searchInput.value = state.search;
  expirySelect.value = state.expiry;
  sortSelect.value = state.sort;
  organisationInput.value = state.organisation;
  if (showDeletedBox) showDeletedBox.checked = state.showDeleted;

  container.querySelector("#back-to-dashboard").addEventListener("click", onBack);
  container.querySelector("#sign-out").addEventListener("click", onSignOut);
  container.querySelector("#add-member").addEventListener("click", onAdd);

  // ---- Filters: level, expiry and sort order (the search box stays always visible) ----
  const activeFilters = () => {
    const chips = [];
    if (state.levelId) chips.push(["levelId", levelNames.get(state.levelId) ?? "Selected level"]);
    if (state.expiry) {
      chips.push(["expiry", EXPIRY_OPTIONS.find(([value]) => value === state.expiry)?.[1] ?? state.expiry]);
    }
    if (state.organisation) chips.push(["organisation", `Organisation: ${state.organisation}`]);
    return chips;
  };

  function drawFilterState() {
    const chips = activeFilters();
    filterButton.textContent = chips.length ? `Filters (${chips.length})` : "Filters";

    chipsEl.innerHTML = chips.length
      ? chips.map(([key, label]) =>
          `<span class="filter-chip">${escapeHtml(label)}<button type="button" data-clear-filter="${key}" aria-label="Remove filter ${escapeHtml(label)}">×</button></span>`
        ).join("") +
        '<button class="text-button" type="button" data-clear-filter="all">Clear filters</button>'
      : "";
  }

  function setPanelOpen(open) {
    filterPanel.hidden = !open;
    filterButton.setAttribute("aria-expanded", String(open));
  }

  filterButton.addEventListener("click", () => setPanelOpen(filterPanel.hidden));

  levelSelect.addEventListener("change", () => {
    state.levelId = levelSelect.value;
    state.page = 1;
    drawFilterState();
    load();
  });
  expirySelect.addEventListener("change", () => {
    state.expiry = expirySelect.value;
    state.page = 1;
    drawFilterState();
    load();
  });
  let organisationTimer;
  organisationInput.addEventListener("input", () => {
    clearTimeout(organisationTimer);
    organisationTimer = setTimeout(() => {
      state.organisation = organisationInput.value.trim();
      state.page = 1;
      drawFilterState();
      load();
    }, SEARCH_DELAY_MS);
  });

  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value;
    state.page = 1;
    load();
  });

  chipsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-clear-filter]");
    if (!button) return;

    const which = button.dataset.clearFilter;
    if (which === "levelId" || which === "all") {
      state.levelId = "";
      levelSelect.value = "";
    }
    if (which === "expiry" || which === "all") {
      state.expiry = "";
      expirySelect.value = "";
    }
    if (which === "organisation" || which === "all") {
      clearTimeout(organisationTimer);
      state.organisation = "";
      organisationInput.value = "";
    }
    state.page = 1;
    drawFilterState();
    load();
  });

  // The level list loads in the background; a failure just leaves "All levels".
  Promise.resolve(loadLevels?.())
    .then((levels) => {
      if (!container.contains(levelSelect)) return; // the person already left this screen
      levelNames = new Map(levels.map((level) => [level.id, level.name]));
      levelSelect.innerHTML = '<option value="">All levels</option>' +
        levels.map((level) =>
          `<option value="${escapeHtml(level.id)}">${escapeHtml(level.name)}${level.is_active ? "" : " (inactive)"}</option>`
        ).join("");
      levelSelect.value = state.levelId;
      drawFilterState();
    })
    .catch(() => {});

  // Organisations already in use are offered as suggestions; typing part of a name works too.
  Promise.resolve(loadOrganisations?.())
    .then((names) => {
      if (!container.contains(organisationList)) return;
      organisationList.innerHTML = names
        .map((name) => `<option value="${escapeHtml(name)}"></option>`)
        .join("");
    })
    .catch(() => {});

  drawFilterState();
  setPanelOpen(Boolean(state.levelId || state.expiry || state.organisation || state.sort !== "newest"));

  let members = [];
  let total = 0;
  let requestId = 0;

  // Loads the current page and redraws only the results area, so the search box
  // keeps focus while typing. Late answers to old requests are ignored.
  async function load() {
    const thisRequest = ++requestId;
    results.setAttribute("aria-busy", "true");

    try {
      const data = await loadPage({
        page: state.page,
        search: state.search,
        showDeleted: state.showDeleted,
        levelId: state.levelId,
        expiry: state.expiry,
        organisation: state.organisation,
        sort: state.sort,
      });
      if (thisRequest !== requestId) return;

      members = data.members;
      total = data.total;
      state.page = data.page;
      onStateChange?.({ ...state });
      drawResults();
    } catch (error) {
      if (thisRequest !== requestId) return;
      results.innerHTML = `<p class="error-panel" role="alert">${
        escapeHtml(error instanceof Error ? error.message : "Unable to load members.")
      }</p>`;
    } finally {
      if (thisRequest === requestId) results.removeAttribute("aria-busy");
    }
  }

  function drawResults() {
    if (!members.length) {
      results.innerHTML = `
        <div class="empty-results">
          <h3>${state.search || activeFilters().length ? "No matching members" : "No members yet"}</h3>
          <p>${
        state.search
          ? `Nothing matches “${escapeHtml(state.search)}”${activeFilters().length ? " with these filters" : ""}. Try part of the name, or the code number.`
          : activeFilters().length
          ? "No members match these filters. Try removing one."
          : "Use “Add member” to create the first one."
      }</p>
        </div>`;
      return;
    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const first = (state.page - 1) * pageSize + 1;
    const last = first + members.length - 1;

    results.innerHTML = `
      <table class="members-table">
        <thead>
          <tr>
            <th scope="col">Code</th>
            <th scope="col">Name</th>
            <th scope="col">Level</th>
            <th scope="col">Expiry</th>
            <th scope="col">Organisation</th>
            <th scope="col">Status</th>
            <th scope="col"><span class="screen-reader-text">Actions</span></th>
          </tr>
        </thead>
        <tbody>${members.map((member) => memberRow(member, isAdmin)).join("")}</tbody>
      </table>
      <nav class="pager" aria-label="Member pages">
        <button class="button button-secondary button-small" data-page="prev" type="button"${
      state.page <= 1 ? " disabled" : ""
    }>← Previous</button>
        <span class="pager-info">${first}–${last} of ${total}<span class="pager-page"> · Page ${state.page} of ${totalPages}</span></span>
        <button class="button button-secondary button-small" data-page="next" type="button"${
      state.page >= totalPages ? " disabled" : ""
    }>Next →</button>
      </nav>
    `;
  }

  results.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.dataset.page) {
      state.page += button.dataset.page === "next" ? 1 : -1;
      await load();
      container.querySelector("#member-search").scrollIntoView({ block: "nearest" });
      return;
    }

    if (button.dataset.editMember) {
      const member = members.find((m) => m.id === button.dataset.editMember);
      if (member) onEdit(member);
      return;
    }

    if (button.dataset.hoursMember) {
      const member = members.find((m) => m.id === button.dataset.hoursMember);
      if (member) onHours(member);
      return;
    }

    if (button.dataset.deleteMember) {
      const member = members.find((m) => m.id === button.dataset.deleteMember);
      if (!member) return;
      if (!window.confirm(
        `Delete ${member.name}? The record is hidden but kept, and an admin can restore it. ` +
          `To keep someone on reports, set their status to Suspended instead.`,
      )) return;

      try {
        button.disabled = true;
        await onDelete(member.id);
        await load();
      } catch (error) {
        button.disabled = false;
        window.alert(error instanceof Error ? error.message : "Unable to delete the member.");
      }
      return;
    }

    if (button.dataset.restoreMember) {
      try {
        button.disabled = true;
        await onRestore(button.dataset.restoreMember);
        await load();
      } catch (error) {
        button.disabled = false;
        window.alert(error instanceof Error ? error.message : "Unable to restore the member.");
      }
    }
  });

  let searchTimer;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = searchInput.value.trim();
      state.page = 1;
      load();
    }, SEARCH_DELAY_MS);
  });

  showDeletedBox?.addEventListener("change", () => {
    state.showDeleted = showDeletedBox.checked;
    state.page = 1;
    load();
  });

  for (const format of ["csv", "xlsx"]) {
    const button = container.querySelector(`#export-${format}`);
    button.addEventListener("click", async () => {
      exportMessage.textContent = "";
      button.disabled = true;
      try {
        // Downloads follow what is on screen: the search, level, expiry and sort order.
        await onExport(format, {
          search: state.search,
          levelId: state.levelId,
          expiry: state.expiry,
          organisation: state.organisation,
          sort: state.sort,
        });
      } catch (error) {
        exportMessage.textContent = error instanceof Error
          ? error.message
          : "Unable to export the members.";
      } finally {
        button.disabled = false;
      }
    });
  }

  load();
}

function memberRow(member, isAdmin) {
  const deleted = Boolean(member.deleted_at);
  const expiry = expiryState(member.membership_expiry_date);
  const id = escapeHtml(member.id);

  const actions = deleted
    ? `<button class="button button-secondary button-small" data-restore-member="${id}" type="button">Restore</button>`
    : `<button class="button button-secondary button-small" data-edit-member="${id}" type="button">Edit</button><button class="button button-secondary button-small" data-hours-member="${id}" type="button">Hours</button>${
      isAdmin
        ? `<button class="button button-secondary button-small text-button-danger" data-delete-member="${id}" type="button">Delete</button>`
        : ""
    }`;

  const membership_expiry_date = new Date(member.membership_expiry_date);
  const formatted_membership_expiry_date = membership_expiry_date.toLocaleDateString('en-US', {
                                            month: 'short', // "October" (use 'short' for "Oct")
                                            year: 'numeric' // "2026"
                                          });


  return `
    <tr${deleted ? ' class="row-deleted"' : ""}>
      <td data-label="Code">${formatMemberCode(member.code_number)}</td>
      <td data-label="Name"><strong>${escapeHtml(member.name)}</strong></td>
      <td data-label="Level">${escapeHtml(member.membership_levels?.name ?? "—")}</td>
      <td data-label="Expiry"><span>${escapeHtml(formatted_membership_expiry_date)}${
    expiry && !deleted
      ? ` <span class="status ${expiry.className}">${expiry.label}</span>`
      : ""
  }</span></td>
      <td data-label="Organisation">${member.organisation ? escapeHtml(member.organisation) : "—"}</td>
      <td data-label="Status"><span><span class="status ${
    member.status === "active" ? "status-active" : "status-inactive"
  }">${member.status === "active" ? "Active" : "Suspended"}</span>${
    deleted ? ' <span class="status status-inactive">Deleted</span>' : ""
  }</span></td>
      <td class="row-actions">${actions}</td>
    </tr>
  `;
}

// Expired, or due for renewal within the next three months.
export function expiryState(dateString) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  if (!year) return null;

  const expiry = new Date(year, month - 1, day);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const threshold = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());

  if (expiry < startOfToday) return { label: "Expired", className: "status-inactive" };
  if (expiry <= threshold) return { label: "Due soon", className: "status-warning" };
  return null;
}

/* ------------------------------------------------------------------ */
/* Screen 2: add / edit a member (its own page)                        */
/* ------------------------------------------------------------------ */

export function renderMemberForm(
  container,
  {
    profile,
    levels,
    member, // null when adding
    loadError,
    onSave, // (values) => Promise<void>; the app leaves this screen on success
    onCancel,
    onSignOut,
  },
) {
  const editing = Boolean(member);
  const m = member ?? {};
  const heading = editing
    ? `Edit ${formatMemberCode(m.code_number)} – ${m.name}`
    : "Add member";
  const hasChoices = levels.some((level) => level.is_active);

  container.innerHTML = `
    <section class="dashboard">
      ${topbar(profile)}
      <main class="dashboard-content">
        <div class="section-header">
          <div>
            <button class="text-button" id="back-to-members" type="button">← Members</button>
            <h2>${escapeHtml(heading)}</h2>
            <p>Required: name, membership level and membership expiry date.</p>
          </div>
        </div>
        ${
    loadError
      ? `<p class="error-panel" role="alert">${escapeHtml(loadError)}</p>`
      : `
        <section class="editor-card form-card">
          <form id="member-form" novalidate>
            <div class="form-grid">
              <label class="field field-wide" for="member-name">
                Name
                <input id="member-name" name="name" maxlength="200" required value="${escapeHtml(m.name ?? "")}" />
              </label>
              <label class="field" for="member-level">
                Membership level
                <select id="member-level" name="membershipLevelId" required>
                  ${levelOptions(levels, m.membership_level_id ?? "")}
                </select>
                ${
        hasChoices || editing
          ? ""
          : '<span class="field-hint">No membership levels are available yet. Ask the admin to add one.</span>'
      }
              </label>
              <label class="field" for="member-expiry">
                Membership expiry date
                <input id="member-expiry" name="membershipExpiryDate" type="date" required value="${escapeHtml(m.membership_expiry_date ?? "")}" />
              </label>
              <label class="field" for="member-status">
                Status
                <select id="member-status" name="status">
                  <option value="active"${m.status !== "suspended" ? " selected" : ""}>Active</option>
                  <option value="suspended"${m.status === "suspended" ? " selected" : ""}>Suspended</option>
                </select>
              </label>
              <label class="field" for="member-organisation">
                Organisation <span class="field-hint">(optional)</span>
                <input id="member-organisation" name="organisation" maxlength="200" value="${escapeHtml(m.organisation ?? "")}" />
              </label>
              <label class="field" for="member-position">
                Position <span class="field-hint">(optional)</span>
                <input id="member-position" name="position" maxlength="200" value="${escapeHtml(m.position ?? "")}" />
              </label>
              <label class="field" for="member-specialisation">
                Specialisation <span class="field-hint">(optional)</span>
                <input id="member-specialisation" name="specialisation" maxlength="200" value="${escapeHtml(m.specialisation ?? "")}" />
              </label>
              <label class="field" for="member-email">
                Email <span class="field-hint">(optional)</span>
                <input id="member-email" name="email" type="email" inputmode="email" maxlength="254" value="${escapeHtml(m.email ?? "")}" />
              </label>
              <label class="field" for="member-phone">
                Phone <span class="field-hint">(optional)</span>
                <input id="member-phone" name="phone" type="tel" inputmode="tel" maxlength="50" value="${escapeHtml(m.phone ?? "")}" />
              </label>
              <label class="field field-wide" for="member-education">
                Education background <span class="field-hint">(optional)</span>
                <textarea id="member-education" name="educationBackground" rows="3" maxlength="2000">${escapeHtml(m.education_background ?? "")}</textarea>
              </label>
              <label class="field field-wide" for="member-address">
                Address <span class="field-hint">(optional)</span>
                <textarea id="member-address" name="address" rows="3" maxlength="1000">${escapeHtml(m.address ?? "")}</textarea>
              </label>
            </div>
            <div class="form-actions">
              <button class="button button-small" id="save-member" type="submit">${
        editing ? "Save changes" : "Add member"
      }</button>
              <button class="button button-secondary button-small" id="cancel-member" type="button">Cancel</button>
            </div>
            <p class="message" id="member-form-message" role="alert"></p>
          </form>
        </section>`
  }
      </main>
    </section>
  `;

  container.querySelector("#back-to-members").addEventListener("click", onCancel);
  container.querySelector("#sign-out").addEventListener("click", onSignOut);

  if (loadError) return;

  container.querySelector("#cancel-member").addEventListener("click", onCancel);

  const form = container.querySelector("#member-form");
  const submitButton = container.querySelector("#save-member");
  const message = container.querySelector("#member-form-message");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    submitButton.disabled = true;

    try {
      await onSave(Object.fromEntries(new FormData(form)));
    } catch (error) {
      message.textContent = error instanceof Error
        ? error.message
        : "Unable to save the member.";
      submitButton.disabled = false;
    }
  });

  if (!editing) form.elements.name.focus();
}

// Inactive levels are hidden from new members, but the member's current level
// is always kept in the list so editing doesn't silently change it.
function levelOptions(levels, selectedId) {
  const options = levels
    .filter((level) => level.is_active || level.id === selectedId)
    .map((level) =>
      `<option value="${escapeHtml(level.id)}"${
        level.id === selectedId ? " selected" : ""
      }>${escapeHtml(level.name)}${level.is_active ? "" : " (inactive)"}</option>`
    )
    .join("");

  return `<option value="" disabled${selectedId ? "" : " selected"}>Select a level…</option>${options}`;
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
