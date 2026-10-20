export function renderMembershipLevels(
  container,
  {
    profile,
    levels,
    loadError,
    onBack,
    onCreate,
    onUpdate,
    onDelete,
    onSignOut,
  },
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
        <div class="section-header">
          <div>
            <button class="text-button" id="back-to-dashboard" type="button">← Dashboard</button>
            <h2>Membership levels</h2>
            <p>These options will appear in the membership-level dropdown when a member is created or updated.</p>
          </div>
        </div>
        ${
    loadError
      ? `<p class="error-panel" role="alert">${escapeHtml(loadError)}</p>`
      : `
              <div class="management-grid">
                ${isAdmin ? levelForm() : readOnlyNotice()}
                ${levelsTable(levels, isAdmin)}
              </div>
            `
  }
      </main>
    </section>
  `;

  container
    .querySelector("#back-to-dashboard")
    .addEventListener("click", onBack);
  container.querySelector("#sign-out").addEventListener("click", onSignOut);

  if (!isAdmin || loadError) return;

  attachAdminActions(container, levels, { onCreate, onUpdate, onDelete });
}

function levelForm() {
  return `
    <section class="editor-card">
      <h3 id="level-form-title">Create membership level</h3>
      <form id="membership-level-form">
        <label class="field" for="level-name">
          Level name
          <input id="level-name" name="name" maxlength="100" required />
        </label>
        <label class="field" for="level-description">
          Description <span class="field-hint">(optional)</span>
          <textarea id="level-description" name="description" rows="4" maxlength="500"></textarea>
        </label>
        <label class="field" for="level-sort-order">
          Display order
          <input id="level-sort-order" name="sortOrder" type="number" min="0" step="1" value="0" required />
        </label>
        <label class="checkbox-field" for="level-is-active">
          <input id="level-is-active" name="isActive" type="checkbox" checked />
          Available for new members
        </label>
        <div class="form-actions">
          <button class="button button-small" id="save-level" type="submit">Create level</button>
          <button class="button button-secondary button-small" id="cancel-edit" type="button" hidden>Cancel</button>
        </div>
        <p class="message" id="level-form-message" role="alert"></p>
      </form>
    </section>
  `;
}

function readOnlyNotice() {
  return `
    <section class="editor-card">
      <h3>Read-only access</h3>
      <p>Only the admin account can create, update, or delete membership levels.</p>
    </section>
  `;
}

function levelsTable(levels, isAdmin) {
  if (!levels.length) {
    return `
      <section class="list-card empty-state">
        <h3>No membership levels yet</h3>
        <p>${
      isAdmin
        ? "Create the first level using the form."
        : "Ask the admin to add a level."
    }</p>
      </section>
    `;
  }

  const rows = levels
    .map(
      (level) => `
        <tr>
          <td><strong>${escapeHtml(level.name)}</strong></td>
          <td>${level.description ? escapeHtml(level.description) : "—"}</td>
          <td>${level.sort_order}</td>
          <td><span class="status ${
        level.is_active ? "status-active" : "status-inactive"
      }">${level.is_active ? "Active" : "Inactive"}</span></td>
          ${
        isAdmin
          ? `<td class="row-actions">
                  <button class="button button-secondary button-small" data-edit-level="${
            escapeHtml(level.id)
          }" type="button">Edit</button>
                  <button class="button button-secondary button-small text-button-danger" data-delete-level="${
            escapeHtml(level.id)
          }" type="button">Delete</button>
                </td>`
          : ""
      }
        </tr>
      `,
    )
    .join("");

  return `
    <section class="list-card">
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Level</th>
              <th scope="col">Description</th>
              <th scope="col">Order</th>
              <th scope="col">Status</th>
              ${
    isAdmin
      ? '<th scope="col"><span class="screen-reader-text">Actions</span></th>'
      : ""
  }
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

function attachAdminActions(
  container,
  levels,
  { onCreate, onUpdate, onDelete },
) {
  const form = container.querySelector("#membership-level-form");
  const title = container.querySelector("#level-form-title");
  const submitButton = container.querySelector("#save-level");
  const cancelButton = container.querySelector("#cancel-edit");
  const message = container.querySelector("#level-form-message");
  let editingLevel = null;

  function resetForm() {
    editingLevel = null;
    form.reset();
    form.elements.isActive.checked = true;
    form.elements.sortOrder.value = "0";
    title.textContent = "Create membership level";
    submitButton.textContent = "Create level";
    cancelButton.hidden = true;
    message.textContent = "";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    submitButton.disabled = true;

    const values = new FormData(form);
    const levelValues = {
      name: values.get("name"),
      description: values.get("description"),
      sortOrder: values.get("sortOrder"),
      isActive: values.get("isActive") === "on",
    };

    try {
      if (editingLevel) await onUpdate(editingLevel.id, levelValues);
      else await onCreate(levelValues);
    } catch (error) {
      message.textContent = error instanceof Error
        ? error.message
        : "Unable to save the membership level.";
      submitButton.disabled = false;
    }
  });

  cancelButton.addEventListener("click", resetForm);

  container.querySelectorAll("[data-edit-level]").forEach((button) => {
    button.addEventListener("click", () => {
      editingLevel = levels.find((level) =>
        level.id === button.dataset.editLevel
      );
      if (!editingLevel) return;

      form.elements.name.value = editingLevel.name;
      form.elements.description.value = editingLevel.description || "";
      form.elements.sortOrder.value = String(editingLevel.sort_order);
      form.elements.isActive.checked = editingLevel.is_active;
      title.textContent = `Edit ${editingLevel.name}`;
      submitButton.textContent = "Save changes";
      cancelButton.hidden = false;
      message.textContent = "";
      form.elements.name.focus();
    });
  });

  container.querySelectorAll("[data-delete-level]").forEach((button) => {
    button.addEventListener("click", async () => {
      const level = levels.find((item) =>
        item.id === button.dataset.deleteLevel
      );
      if (!level) return;
      if (!window.confirm(`Delete the membership level “${level.name}”?`)) {
        return;
      }

      try {
        button.disabled = true;
        await onDelete(level.id);
      } catch (error) {
        button.disabled = false;
        window.alert(
          error instanceof Error
            ? error.message
            : "Unable to delete the membership level.",
        );
      }
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
