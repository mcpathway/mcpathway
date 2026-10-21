import { formatMemberCode } from "../data/memberRepository.js";
import {
  formatDuration,
  MONTH_NAMES,
  splitMinutes,
} from "../data/hoursRepository.js";
import { expiryState } from "./membersView.js";

const SEARCH_DELAY_MS = 250;

/* ------------------------------------------------------------------ */
/* Screen 1: find a member (autocomplete by name or code)              */
/* ------------------------------------------------------------------ */

export function renderHoursMemberPicker(
  container,
  {
    profile,
    onSearch, // (term) => Promise<member[]>
    onSelect, // (member) => void
    onBack,
    onSignOut,
  },
) {
  container.innerHTML = `
    <section class="dashboard">
      ${topbar(profile)}
      <main class="dashboard-content">
        <div class="section-header">
          <div>
            <button class="text-button" id="back-to-dashboard" type="button">← Dashboard</button>
            <h2>Manage hours</h2>
            <p>Find a member by name or code number, then choose the year.</p>
          </div>
        </div>
        <section class="editor-card picker-card">
          <label class="field" for="hours-member-search">
            Member
            <input id="hours-member-search" type="search" role="combobox" aria-expanded="false"
              aria-controls="hours-member-options" aria-autocomplete="list" autocomplete="off"
              placeholder="Type a name or code…" />
          </label>
          <ul class="picker-options" id="hours-member-options" role="listbox" aria-label="Matching members" hidden></ul>
          <p class="picker-status" id="picker-status" role="status"></p>
        </section>
      </main>
    </section>
  `;

  container.querySelector("#back-to-dashboard").addEventListener("click", onBack);
  container.querySelector("#sign-out").addEventListener("click", onSignOut);

  const input = container.querySelector("#hours-member-search");
  const list = container.querySelector("#hours-member-options");
  const status = container.querySelector("#picker-status");

  let results = [];
  let resultsTerm = "";
  let active = -1;
  let requestId = 0;
  let timer;

  function draw() {
    list.innerHTML = results.map((member, index) => `
      <li role="option" id="hours-option-${index}" data-index="${index}"
          aria-selected="${index === active}" class="picker-option${index === active ? " is-active" : ""}">
        <span class="picker-name">${escapeHtml(member.name)}</span>
        <span class="picker-meta">${formatMemberCode(member.code_number)} · ${
      escapeHtml(member.membership_levels?.name ?? "No level")
    }${
      member.status === "suspended"
        ? ' <span class="status status-inactive">Suspended</span>'
        : ""
    }</span>
      </li>`).join("");

    list.hidden = results.length === 0;
    input.setAttribute("aria-expanded", String(results.length > 0));
    if (active >= 0) input.setAttribute("aria-activedescendant", `hours-option-${active}`);
    else input.removeAttribute("aria-activedescendant");
  }

  async function search() {
    const term = input.value.trim();
    const thisRequest = ++requestId;

    if (!term) {
      results = [];
      resultsTerm = "";
      active = -1;
      status.textContent = "";
      draw();
      return;
    }

    try {
      const found = await onSearch(term);
      if (thisRequest !== requestId) return;
      results = found;
      resultsTerm = term;
      active = found.length ? 0 : -1;
      status.textContent = found.length ? "" : `No members match “${term}”.`;
      draw();
    } catch (error) {
      if (thisRequest !== requestId) return;
      results = [];
      active = -1;
      draw();
      status.textContent = error instanceof Error
        ? error.message
        : "Unable to search members.";
    }
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(search, SEARCH_DELAY_MS);
  });

  input.addEventListener("keydown", (event) => {
    if (!results.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      active = (active + 1) % results.length;
      draw();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      active = (active - 1 + results.length) % results.length;
      draw();
    } else if (event.key === "Enter") {
      event.preventDefault();
      // Ignore Enter while the list still belongs to an older search text.
      if (active >= 0 && input.value.trim() === resultsTerm) onSelect(results[active]);
    } else if (event.key === "Escape") {
      results = [];
      active = -1;
      draw();
    }
  });

  list.addEventListener("click", (event) => {
    const option = event.target.closest("[data-index]");
    if (option) onSelect(results[Number(option.dataset.index)]);
  });

  input.focus();
}

/* ------------------------------------------------------------------ */
/* Screen 2: one member, one year, twelve months                       */
/* ------------------------------------------------------------------ */

export function renderHoursYear(
  container,
  {
    profile,
    member,
    year,
    bounds, // { min, max } years the stepper may show
    current, // { year, month } today
    records, // live records for this year
    deletedRecords, // admin only, or null
    showDeleted,
    loadError,
    from, // { label, go } where the back link leads
    onChangeYear, // (year) => void
    onToggleDeleted, // (checked) => void
    onEditMonth, // (month, record | null) => void
    onDelete, // (record) => Promise<void>
    onRestore, // (record) => Promise<void>
    onSignOut,
  },
) {
  const isAdmin = profile.role === "admin";
  const byMonth = new Map(
    records.map((record) => [Number(String(record.period_month).slice(5, 7)), record]),
  );
  const sum = (key) => records.reduce((total, record) => total + record[key], 0);
  const expectedMonths = year === current.year ? current.month : 12;

  const body = loadError
    ? `<p class="error-panel" role="alert">${escapeHtml(loadError)}</p>`
    : `
      <dl class="totals" aria-label="Totals for ${year}">
        <div class="total-tile"><dt>Clinical</dt><dd>${formatDuration(sum("clinical_minutes"))}</dd></div>
        <div class="total-tile"><dt>Supervision</dt><dd>${formatDuration(sum("supervision_minutes"))}</dd></div>
        <div class="total-tile"><dt>OPD points</dt><dd>${sum("opd_points")}</dd></div>
        <div class="total-tile"><dt>Months recorded</dt><dd>${records.length} of ${expectedMonths}</dd></div>
      </dl>
      <section class="list-card">
        <table class="hours-table">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Clinical</th>
              <th scope="col">Supervision</th>
              <th scope="col">OPD points</th>
              <th scope="col"><span class="screen-reader-text">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            ${
      Array.from({ length: 12 }, (_, index) =>
        monthRow(index + 1, year, current, byMonth.get(index + 1), isAdmin)).join("")
    }
          </tbody>
        </table>
      </section>
      ${
      isAdmin
        ? `<label class="checkbox-field" for="show-deleted-hours">
               <input id="show-deleted-hours" type="checkbox"${showDeleted ? " checked" : ""} />
               Show deleted records
             </label>`
        : ""
    }
      ${showDeleted && deletedRecords ? deletedSection(deletedRecords, year) : ""}
    `;

  container.innerHTML = `
    <section class="dashboard">
      ${topbar(profile)}
      <main class="dashboard-content">
        <div class="section-header">
          <div>
            <button class="text-button" id="back-from-hours" type="button">← ${escapeHtml(from.label)}</button>
            <h2>Hours</h2>
          </div>
        </div>
        ${memberCard(member)}
        <div class="year-bar">
          <div class="year-stepper" role="group" aria-label="Year">
            <button class="button button-secondary button-small" id="prev-year" type="button" aria-label="Previous year"${
    year <= bounds.min ? " disabled" : ""
  }>←</button>
            <strong class="year-stepper-year" aria-live="polite">${year}</strong>
            <button class="button button-secondary button-small" id="next-year" type="button" aria-label="Next year"${
    year >= bounds.max ? " disabled" : ""
  }>→</button>
          </div>
          ${
    year !== current.year
      ? `<button class="text-button" id="this-year" type="button">Back to ${current.year}</button>`
      : ""
  }
        </div>
        ${body}
      </main>
    </section>
  `;

  container.querySelector("#sign-out").addEventListener("click", onSignOut);
  container.querySelector("#back-from-hours").addEventListener("click", from.go);
  container.querySelector("#prev-year").addEventListener("click", () => onChangeYear(year - 1));
  container.querySelector("#next-year").addEventListener("click", () => onChangeYear(year + 1));
  container.querySelector("#this-year")?.addEventListener("click", () => onChangeYear(current.year));
  container.querySelector("#show-deleted-hours")?.addEventListener("change", (event) => {
    onToggleDeleted(event.target.checked);
  });

  // One listener on the page element (not on `container`, which outlives this screen).
  container.querySelector(".dashboard").addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.dataset.addMonth) {
      onEditMonth(Number(button.dataset.addMonth), null);
      return;
    }

    if (button.dataset.editMonth) {
      const month = Number(button.dataset.editMonth);
      onEditMonth(month, byMonth.get(month) ?? null);
      return;
    }

    if (button.dataset.deleteRecord) {
      const record = records.find((r) => r.id === button.dataset.deleteRecord);
      if (!record) return;
      const month = Number(String(record.period_month).slice(5, 7));
      if (!window.confirm(
        `Delete the ${MONTH_NAMES[month - 1]} ${year} record for ${member.name}? An admin can restore it later.`,
      )) return;

      try {
        button.disabled = true;
        await onDelete(record);
      } catch (error) {
        button.disabled = false;
        window.alert(error instanceof Error ? error.message : "Unable to delete the record.");
      }
      return;
    }

    if (button.dataset.restoreRecord) {
      const record = (deletedRecords ?? []).find((r) => r.id === button.dataset.restoreRecord);
      if (!record) return;

      try {
        button.disabled = true;
        await onRestore(record);
      } catch (error) {
        button.disabled = false;
        window.alert(error instanceof Error ? error.message : "Unable to restore the record.");
      }
    }
  });
}

function monthRow(month, year, current, record, isAdmin) {
  const future = year === current.year && month > current.month;
  const isCurrent = year === current.year && month === current.month;
  const classes = [future ? "row-future" : "", isCurrent ? "row-current" : ""]
    .filter(Boolean)
    .join(" ");

  let cells;
  let actions = "";

  if (record) {
    cells = `
      <td data-label="Clinical">${formatDuration(record.clinical_minutes)}</td>
      <td data-label="Supervision">${formatDuration(record.supervision_minutes)}</td>
      <td data-label="OPD points">${record.opd_points}</td>`;
    actions = `<button class="text-button" data-edit-month="${month}" type="button">Edit</button>${
      isAdmin
        ? `<button class="text-button text-button-danger" data-delete-record="${escapeHtml(record.id)}" type="button">Delete</button>`
        : ""
    }`;
  } else if (future) {
    cells = '<td class="muted-cell" colspan="3">Upcoming</td>';
  } else {
    cells = '<td class="muted-cell" colspan="3">Not recorded</td>';
    actions = `<button class="text-button" data-add-month="${month}" type="button">Add hours</button>`;
  }

  return `
    <tr${classes ? ` class="${classes}"` : ""}>
      <th scope="row">${MONTH_NAMES[month - 1]}${
    isCurrent ? ' <span class="status status-active">This month</span>' : ""
  }</th>
      ${cells}
      <td class="row-actions">${actions}</td>
    </tr>`;
}

function deletedSection(deletedRecords, year) {
  if (!deletedRecords.length) {
    return `<section class="list-card deleted-hours"><h3>Deleted records</h3><p class="muted">No deleted records for ${year}.</p></section>`;
  }

  return `
    <section class="list-card deleted-hours">
      <h3>Deleted records</h3>
      <ul class="deleted-list">
        ${
    deletedRecords.map((record) => {
      const month = Number(String(record.period_month).slice(5, 7));
      return `
          <li>
            <span><strong>${MONTH_NAMES[month - 1]}</strong> · Clinical ${
        formatDuration(record.clinical_minutes)
      } · Supervision ${formatDuration(record.supervision_minutes)} · OPD ${record.opd_points}</span>
            <button class="text-button" data-restore-record="${escapeHtml(record.id)}" type="button">Restore</button>
          </li>`;
    }).join("")
  }
      </ul>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* Screen 3: add / edit one month                                      */
/* ------------------------------------------------------------------ */

export function renderHoursForm(
  container,
  {
    profile,
    member,
    year,
    month,
    record, // null when adding
    onSave, // (values) => Promise<void>; the app leaves this screen on success
    onCancel,
    onSignOut,
  },
) {
  const editing = Boolean(record);
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`;
  const clinical = splitMinutes(record?.clinical_minutes ?? 0);
  const supervision = splitMinutes(record?.supervision_minutes ?? 0);
  // When adding, leave the boxes empty (placeholder 0); when editing, show the saved values.
  const shown = (value) => (editing ? String(value) : "");

  container.innerHTML = `
    <section class="dashboard">
      ${topbar(profile)}
      <main class="dashboard-content">
        <div class="section-header">
          <div>
            <button class="text-button" id="back-to-year" type="button">← ${year}</button>
            <h2>${editing ? "Edit" : "Add"} hours · ${escapeHtml(monthLabel)}</h2>
            <p>${formatMemberCode(member.code_number)} · ${escapeHtml(member.name)}</p>
          </div>
        </div>
        <section class="editor-card hours-form-card">
          <form id="hours-form" novalidate>
            ${
    durationField("clinical", "Clinical time", shown(clinical.hours), shown(clinical.minutes))
  }
            ${
    durationField("supervision", "Supervision time", shown(supervision.hours), shown(supervision.minutes))
  }
            <label class="field" for="opd-points">
              OPD points
              <input id="opd-points" name="opdPoints" type="text" inputmode="numeric" autocomplete="off"
                placeholder="0" value="${editing ? record.opd_points : ""}" />
            </label>
            <p class="field-hint">Leave a box empty to record 0. Minutes must be between 0 and 59.</p>
            <div class="form-actions">
              <button class="button button-small" id="save-hours" type="submit">${
    editing ? "Save changes" : "Save hours"
  }</button>
              <button class="button button-secondary button-small" id="cancel-hours" type="button">Cancel</button>
            </div>
            <p class="message" id="hours-form-message" role="alert"></p>
          </form>
        </section>
      </main>
    </section>
  `;

  container.querySelector("#sign-out").addEventListener("click", onSignOut);
  container.querySelector("#back-to-year").addEventListener("click", onCancel);
  container.querySelector("#cancel-hours").addEventListener("click", onCancel);

  const form = container.querySelector("#hours-form");
  const submitButton = container.querySelector("#save-hours");
  const message = container.querySelector("#hours-form-message");

  // Live "Total: 2 h 15 min" under each time group.
  for (const group of ["clinical", "supervision"]) {
    const hoursInput = form.elements[`${group}Hours`];
    const minutesInput = form.elements[`${group}Minutes`];
    const totalLine = container.querySelector(`#${group}-total`);
    const update = () => {
      totalLine.textContent = previewDuration(hoursInput.value, minutesInput.value);
    };
    hoursInput.addEventListener("input", update);
    minutesInput.addEventListener("input", update);
    update();
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    submitButton.disabled = true;

    try {
      await onSave(Object.fromEntries(new FormData(form)));
    } catch (error) {
      message.textContent = error instanceof Error
        ? error.message
        : "Unable to save the hours.";
      submitButton.disabled = false;
    }
  });

  (form.elements.clinicalHours).focus();
}

function durationField(group, legend, hoursValue, minutesValue) {
  return `
    <fieldset class="duration-field">
      <legend>${legend}</legend>
      <div class="duration-inputs">
        <label for="${group}-hours">
          <span class="duration-unit">Hours</span>
          <input id="${group}-hours" name="${group}Hours" type="text" inputmode="numeric"
            autocomplete="off" placeholder="0" value="${escapeHtml(hoursValue)}" />
        </label>
        <label for="${group}-minutes">
          <span class="duration-unit">Minutes</span>
          <input id="${group}-minutes" name="${group}Minutes" type="text" inputmode="numeric"
            autocomplete="off" placeholder="0" value="${escapeHtml(minutesValue)}" />
        </label>
      </div>
      <p class="duration-total" id="${group}-total" aria-live="polite"></p>
    </fieldset>`;
}

function previewDuration(hoursText, minutesText) {
  const hoursTextClean = hoursText.trim();
  const minutesTextClean = minutesText.trim();
  if (hoursTextClean === "" && minutesTextClean === "") return "";

  const read = (text) => (text === "" ? 0 : /^\d{1,6}$/.test(text) ? Number(text) : null);
  const hours = read(hoursTextClean);
  const minutes = read(minutesTextClean);
  if (hours === null || minutes === null || minutes > 59) return "";

  return `Total: ${formatDuration(hours * 60 + minutes)}`;
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

function memberCard(member) {
  const expiry = expiryState(member.membership_expiry_date);

  const membership_expiry_date = new Date(member.membership_expiry_date);
  const formatted_membership_expiry_date = membership_expiry_date.toLocaleDateString('en-US', {
                                            month: 'short', // "October" (use 'short' for "Oct")
                                            year: 'numeric' // "2026"
                                          });

  return `
    <section class="member-card" aria-label="Selected member">
      <div class="member-card-main">
        <span class="member-card-code">${formatMemberCode(member.code_number)}</span>
        <h3>${escapeHtml(member.name)}</h3>
      </div>
      <p class="member-card-meta">
        <span>${escapeHtml(member.membership_levels?.name ?? "No level")}</span>
        <span class="status ${member.status === "active" ? "status-active" : "status-inactive"}">${
    member.status === "active" ? "Active" : "Suspended"
  }</span>
        <span>Expires ${escapeHtml(formatted_membership_expiry_date)}${
    expiry ? ` <span class="status ${expiry.className}">${expiry.label}</span>` : ""
  }</span>
      </p>
    </section>`;
}

function topbar(profile) {
  return `
      <header class="topbar">
        <h1>Pathway Clinical Hours Management System</h1>
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
