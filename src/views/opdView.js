import {
  calculateOpd,
  formatDuration,
  formatPoints,
  OPD_CATEGORIES,
} from "../data/opdCalculator.js";

// The OPD calculator screen. Used inside the system (profile given, with a back button) and as
// the public page without a login (profile = null). It never talks to the database.
export function renderOpdCalculator(container, { profile = null, onBack, onSignOut }) {
  container.innerHTML = `
    <section class="dashboard">
      ${topbar(profile)}
      <main class="dashboard-content">
        <div class="section-header">
          <div>
            ${profile ? '<button class="text-button" id="back-to-dashboard" type="button">← Dashboard</button>' : ""}
            <h2>OPD calculator</h2>
            <p>Estimate the OPD points you can claim for a training. Add each training to the list to see your total. Nothing is saved.</p>
          </div>
        </div>

        <section class="editor-card opd-card">
          <form id="opd-form" novalidate>
            <label class="field" for="opd-category">
              Category
              <select id="opd-category">
                ${
    Object.values(OPD_CATEGORIES).map((c) =>
      `<option value="${c.code}">${c.code} – ${escapeHtml(c.name)}</option>`
    ).join("")
  }
              </select>
            </label>

            <div class="opd-trainings" id="opd-trainings" aria-live="polite"></div>

            <label class="field" for="opd-title">
              Training name <span class="field-hint">(optional, to recognise it in your list)</span>
              <input id="opd-title" maxlength="120" autocomplete="off" />
            </label>

            <fieldset class="duration-field">
              <legend>Training time</legend>
              <div class="duration-inputs">
                <label for="opd-hours">
                  <input id="opd-hours" type="number" inputmode="numeric" min="0" max="999" step="1" placeholder="0" />
                  <span class="duration-unit">hours</span>
                </label>
                <label for="opd-minutes">
                  <input id="opd-minutes" type="number" inputmode="numeric" min="0" max="59" step="1" placeholder="0" />
                  <span class="duration-unit">minutes</span>
                </label>
              </div>
            </fieldset>

            <label class="checkbox-field" id="opd-first-field" for="opd-first">
              <input id="opd-first" type="checkbox" checked />
              This is the first time I am attending this training
            </label>

            <div class="form-actions">
              <button class="button button-small" type="submit">Calculate</button>
            </div>
            <p class="message" id="opd-message" role="alert"></p>
          </form>

          <div class="opd-result" id="opd-result" aria-live="polite" hidden></div>
        </section>

        <section class="list-card opd-list" id="opd-list" aria-label="Your list"></section>
      </main>
    </section>
  `;

  if (profile) {
    container.querySelector("#back-to-dashboard").addEventListener("click", onBack);
    container.querySelector("#sign-out").addEventListener("click", onSignOut);
  }

  const form = container.querySelector("#opd-form");
  const categorySelect = container.querySelector("#opd-category");
  const trainingsEl = container.querySelector("#opd-trainings");
  const titleInput = container.querySelector("#opd-title");
  const hoursInput = container.querySelector("#opd-hours");
  const minutesInput = container.querySelector("#opd-minutes");
  const firstField = container.querySelector("#opd-first-field");
  const firstBox = container.querySelector("#opd-first");
  const messageEl = container.querySelector("#opd-message");
  const resultEl = container.querySelector("#opd-result");
  const listEl = container.querySelector("#opd-list");

  let current = null; // the last calculation, waiting to be added to the list
  let items = []; // the list (kept in this page only)
  let nextId = 1;

  function clearResult() {
    current = null;
    resultEl.hidden = true;
    resultEl.innerHTML = "";
    messageEl.textContent = "";
  }

  // The expected trainings of the chosen category, so people can see where theirs belongs.
  function drawCategory() {
    const rules = OPD_CATEGORIES[categorySelect.value];
    trainingsEl.innerHTML = `
      <p class="opd-rule"><strong>${escapeHtml(rules.rule)}</strong></p>
      <p class="opd-trainings-title">Expected trainings in this category</p>
      <ul>${rules.trainings.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>
      <p class="opd-evidence-line">${escapeHtml(rules.evidence)}</p>`;
    firstField.hidden = !rules.hasRepeat;
  }

  function drawResult() {
    resultEl.hidden = false;
    resultEl.innerHTML = `
      <p class="opd-points"><span>${formatPoints(current.points)}</span> OPD ${current.points === 1 ? "point" : "points"}</p>
      <p class="opd-explain">${escapeHtml(current.explanation)}</p>
      <p class="opd-evidence ${current.evidenceRequired ? "is-required" : ""}">${escapeHtml(current.evidence)}</p>
      <button class="button button-small" id="opd-add" type="button">Add to list</button>`;
  }

  function drawList() {
    if (!items.length) {
      listEl.innerHTML = `<h3>Your list</h3><p class="muted">No trainings added yet. Calculate a training, then choose “Add to list”.</p>`;
      return;
    }

    const total = items.reduce((sum, item) => sum + item.points * 2, 0) / 2;

    listEl.innerHTML = `
      <h3>Your list</h3>
      <ul class="opd-items">
        ${
      items.map((item) => `
        <li class="opd-item">
          <div class="opd-item-main">
            <strong>${escapeHtml(item.title || "Training")}</strong>
            <span class="opd-item-meta">Category ${item.category} · ${escapeHtml(formatDuration(item.totalMinutes))}${
        OPD_CATEGORIES[item.category].hasRepeat ? ` · ${item.repeat ? "Repeat" : "First time"}` : ""
      }</span>
            <span class="status ${item.evidenceRequired ? "status-warning" : "status-inactive"}">${
        item.evidenceRequired ? "Certificate or essay required" : "Certificate or essay optional"
      }</span>
          </div>
          <div class="opd-item-points">${formatPoints(item.points)}</div>
          <button class="text-button text-button-danger" data-remove="${item.id}" type="button">Remove</button>
        </li>`).join("")
    }
      </ul>
      <p class="opd-total">Estimated total: <strong>${formatPoints(total)}</strong> OPD ${total === 1 ? "point" : "points"}
        <span class="muted">(${items.length} ${items.length === 1 ? "training" : "trainings"})</span></p>
      <button class="button button-secondary button-small" id="opd-clear" type="button">Clear list</button>`;
  }

  categorySelect.addEventListener("change", () => {
    drawCategory();
    clearResult();
  });
  for (const control of [hoursInput, minutesInput, firstBox]) {
    control.addEventListener("input", clearResult);
    control.addEventListener("change", clearResult);
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const result = calculateOpd({
      category: categorySelect.value,
      hours: hoursInput.value,
      minutes: minutesInput.value,
      firstTime: firstBox.checked,
    });

    if (!result.ok) {
      clearResult();
      messageEl.textContent = result.error;
      return;
    }

    messageEl.textContent = "";
    current = result;
    drawResult();
  });

  resultEl.addEventListener("click", (event) => {
    if (!event.target.closest("#opd-add") || !current) return;

    items.push({ ...current, id: nextId++, title: titleInput.value.trim() });
    drawList();
    titleInput.value = "";
    hoursInput.value = "";
    minutesInput.value = "";
    firstBox.checked = true;
    clearResult();
    hoursInput.focus();
  });

  listEl.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove]");
    if (remove) {
      items = items.filter((item) => String(item.id) !== remove.dataset.remove);
      drawList();
      return;
    }

    if (event.target.closest("#opd-clear")) {
      items = [];
      drawList();
    }
  });

  drawCategory();
  drawList();
  hoursInput.focus();
}

function topbar(profile) {
  if (!profile) {
    return `
      <header class="topbar">
        <h1>Pathway Admin</h1>
      </header>`;
  }

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
