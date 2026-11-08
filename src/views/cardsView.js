import { formatMonthYear } from "../data/dateFormat.js";
import { DELIVERY_LABELS } from "../data/cardRepository.js";
import { formatMemberCode } from "../data/memberRepository.js";

/* ------------------------------------------------------------------ */
/* Screen 1: a member's physical cards                                  */
/* ------------------------------------------------------------------ */

export function renderMemberCards(
  container,
  {
    profile,
    member,
    cards, // live cards, newest first
    deletedCards, // admin only, or null
    showDeleted,
    loadError,
    from, // { label, go } where the back link leads
    onToggleDeleted, // (checked) => void
    onAdd, // () => void - record a card for the current expiry date
    onEdit, // (card) => void
    onDelete, // (card) => Promise<void>
    onRestore, // (card) => Promise<void>
    onSignOut,
  },
) {
  const isAdmin = profile.role === "admin";
  const today = localToday();
  const changes = describeChanges(cards);

  // The newest PHYSICAL card for the member's current expiry date (the digital record never counts).
  const current = cards.find((card) =>
    card.delivery_method !== "digital" && card.valid_until === member.membership_expiry_date
  );

  const body = loadError
    ? `<p class="error-panel" role="alert">${escapeHtml(loadError)}</p>`
    : `
      ${currentPanel(member, current, today)}
      ${
      cards.length
        ? `<section class="list-card">
        <table class="hours-table cards-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Card</th>
              <th scope="col">Level on card</th>
              <th scope="col">Change</th>
              <th scope="col">Valid until</th>
              <th scope="col">Note</th>
              <th scope="col"><span class="screen-reader-text">Actions</span></th>
            </tr>
          </thead>
          <tbody>${cards.map((card) => cardRow(card, member, isAdmin, changes.get(card.id))).join("")}</tbody>
        </table>
      </section>`
        : '<p class="muted">No physical cards have been recorded for this member yet.</p>'
    }
      ${
      isAdmin
        ? `<label class="checkbox-field" for="show-deleted-cards">
               <input id="show-deleted-cards" type="checkbox"${showDeleted ? " checked" : ""} />
               Show deleted cards
             </label>`
        : ""
    }
      ${showDeleted && deletedCards ? deletedSection(deletedCards) : ""}
    `;

  container.innerHTML = `
    <section class="dashboard">
      ${topbar(profile)}
      <main class="dashboard-content">
        <div class="section-header">
          <div>
            <button class="text-button" id="back-from-cards" type="button">← ${escapeHtml(from.label)}</button>
            <h2>Cards</h2>
            <p>The digital ID is the starting record for every member. Record each physical card as it is posted or collected.</p>
          </div>
          ${
    !loadError
      ? '<button class="button button-small" id="add-card" type="button">Record card</button>'
      : ""
  }
        </div>
        ${memberCard(member)}
        ${body}
      </main>
    </section>
  `;

  container.querySelector("#sign-out").addEventListener("click", onSignOut);
  container.querySelector("#back-from-cards").addEventListener("click", from.go);
  container.querySelector("#add-card")?.addEventListener("click", onAdd);
  container.querySelector("#show-deleted-cards")?.addEventListener("change", (event) => {
    onToggleDeleted(event.target.checked);
  });

  // One listener on the page element (not on `container`, which outlives this screen).
  container.querySelector(".dashboard").addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.dataset.editCard) {
      const card = cards.find((c) => c.id === button.dataset.editCard);
      if (card) onEdit(card);
      return;
    }

    if (button.dataset.deleteCard) {
      const card = cards.find((c) => c.id === button.dataset.deleteCard);
      if (!card) return;
      if (!window.confirm(
        `Delete the ${DELIVERY_LABELS[card.delivery_method]} record dated ${card.issued_date}? ` +
          "The record is hidden but kept, and an admin can restore it.",
      )) return;

      try {
        button.disabled = true;
        await onDelete(card);
      } catch (error) {
        button.disabled = false;
        window.alert(error instanceof Error ? error.message : "Unable to delete the card.");
      }
      return;
    }

    if (button.dataset.restoreCard) {
      const card = (deletedCards ?? []).find((c) => c.id === button.dataset.restoreCard);
      if (!card) return;

      try {
        button.disabled = true;
        await onRestore(card);
      } catch (error) {
        button.disabled = false;
        window.alert(error instanceof Error ? error.message : "Unable to restore the card.");
      }
    }
  });
}

function currentPanel(member, current, today) {
  const until = formatMonthYear(member.membership_expiry_date);
  const expired = String(member.membership_expiry_date) < today;

  if (!current) {
    return `
      <section class="card-current card-current-due" aria-label="Current card">
        <strong>Card due</strong>
        <span>No physical card recorded for the membership expiring ${escapeHtml(until)}.${
      expired
        ? " That date has passed: if the membership is being renewed, update the expiry date on the member first, then record the card."
        : ""
    }</span>
      </section>`;
  }

  return `
    <section class="card-current" aria-label="Current card">
      <strong>Card issued</strong>
      <span>${escapeHtml(DELIVERY_LABELS[current.delivery_method])} on ${escapeHtml(current.issued_date)} · valid until ${escapeHtml(until)}</span>
    </section>`;
}

// Compares every card with the member's previous one (oldest first), so each row can say
// whether the level changed and how many days passed. Returns Map(cardId -> text).
function describeChanges(cards) {
  const oldestFirst = [...cards].sort((a, b) =>
    String(a.issued_date).localeCompare(String(b.issued_date)) ||
    String(a.created_at).localeCompare(String(b.created_at))
  );

  const notes = new Map();
  oldestFirst.forEach((card, index) => {
    if (index === 0) {
      notes.set(card.id, "Starting level");
      return;
    }

    const previous = oldestFirst[index - 1];
    const days = daysBetween(previous.issued_date, card.issued_date);
    const later = `${days} ${days === 1 ? "day" : "days"} after the previous card`;
    const previousName = previous.membership_levels?.name ?? "previous level";

    notes.set(
      card.id,
      card.membership_level_id === previous.membership_level_id
        ? `Same level · ${later}`
        : `Changed from ${previousName} · ${later}`,
    );
  });

  return notes;
}

function daysBetween(fromText, toText) {
  const [y1, m1, d1] = String(fromText).split("-").map(Number);
  const [y2, m2, d2] = String(toText).split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

function localToday() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function cardRow(card, member, isAdmin, change) {
  const id = escapeHtml(card.id);
  const digital = card.delivery_method === "digital";
  const isCurrent = !digital && card.valid_until === member.membership_expiry_date;
  const changed = change?.startsWith("Changed");

  return `
    <tr${isCurrent ? ' class="row-current"' : ""}>
      <th scope="row">${escapeHtml(card.issued_date)}</th>
      <td data-label="Card"><span class="status ${digital ? "status-inactive" : "status-active"}">${escapeHtml(DELIVERY_LABELS[card.delivery_method] ?? card.delivery_method)}</span></td>
      <td data-label="Level on card">${escapeHtml(card.membership_levels?.name ?? "—")}</td>
      <td data-label="Change">${change ? `<span${changed ? ' class="card-change-up"' : ""}>${escapeHtml(change)}</span>` : "—"}</td>
      <td data-label="Valid until">${escapeHtml(formatMonthYear(card.valid_until))}</td>
      <td data-label="Note">${card.note ? escapeHtml(card.note) : "—"}</td>
      <td class="row-actions">${
    digital ? "" : `<button class="text-button" data-edit-card="${id}" type="button">Edit</button>`
  }${
    isAdmin
      ? `<button class="text-button text-button-danger" data-delete-card="${id}" type="button">Delete</button>`
      : ""
  }</td>
    </tr>`;
}

function deletedSection(deletedCards) {
  if (!deletedCards.length) {
    return `<section class="deleted-hours"><h3>Deleted cards</h3><p class="muted">No deleted cards.</p></section>`;
  }

  return `
    <section class="deleted-hours">
      <h3>Deleted cards</h3>
      <ul class="deleted-list">
        ${
    deletedCards.map((card) => `
        <li>
          <span>${escapeHtml(card.issued_date)} · ${
      escapeHtml(DELIVERY_LABELS[card.delivery_method] ?? card.delivery_method)
    } · valid until ${escapeHtml(formatMonthYear(card.valid_until))}</span>
          <button class="text-button" data-restore-card="${escapeHtml(card.id)}" type="button">Restore</button>
        </li>`).join("")
  }
      </ul>
    </section>`;
}

/* ------------------------------------------------------------------ */
/* Screen 2: record / edit a card (its own page)                        */
/* ------------------------------------------------------------------ */

export function renderCardForm(
  container,
  {
    profile,
    member,
    levels,
    card, // null when recording a new card
    loadError,
    today, // "YYYY-MM-DD", the default date
    onSave, // (values) => Promise<void>; the app leaves this screen on success
    onCancel,
    onSignOut,
  },
) {
  const editing = Boolean(card);
  const method = card?.delivery_method ?? "post";
  const levelId = card?.membership_level_id ?? member.membership_level_id ?? "";
  const validUntil = card?.valid_until ?? member.membership_expiry_date;

  container.innerHTML = `
    <section class="dashboard">
      ${topbar(profile)}
      <main class="dashboard-content">
        <div class="section-header">
          <div>
            <button class="text-button" id="back-to-cards" type="button">← Cards</button>
            <h2>${editing ? "Edit card" : "Record card"}</h2>
            <p>The card is valid until the member's expiry date, even if it is issued later. Add as many cards as needed, for example a replacement or a new level during the year.</p>
          </div>
        </div>
        ${memberCard(member)}
        ${
    loadError
      ? `<p class="error-panel" role="alert">${escapeHtml(loadError)}</p>`
      : `
        <section class="editor-card form-card card-form-card">
          <form id="card-form" novalidate>
            <div class="form-grid">
              <div class="field">
                Valid until
                <strong class="card-valid-until">${escapeHtml(formatMonthYear(validUntil))}</strong>
              </div>
              <label class="field" for="card-method">
                Card
                <select id="card-method" name="deliveryMethod" required>
                  <option value="post"${method === "post" ? " selected" : ""}>Posted</option>
                  <option value="collect"${method === "collect" ? " selected" : ""}>Collected</option>
                </select>
              </label>
              <label class="field" for="card-date" id="card-date-field">
                <span id="card-date-label">Date</span>
                <input id="card-date" name="issuedDate" type="date" required value="${escapeHtml(card?.issued_date ?? today)}" />
              </label>
              <label class="field" for="card-level">
                Membership level on the card
                <select id="card-level" name="membershipLevelId" required>
                  ${levelOptions(levels, levelId)}
                </select>
              </label>
              <label class="field field-wide" for="card-note">
                Note <span class="field-hint">(optional)</span>
                <textarea id="card-note" name="note" rows="3" maxlength="500">${escapeHtml(card?.note ?? "")}</textarea>
              </label>
            </div>
            <div class="form-actions">
              <button class="button button-small" id="save-card" type="submit">${
        editing ? "Save changes" : "Record card"
      }</button>
              <button class="button button-secondary button-small" id="cancel-card" type="button">Cancel</button>
            </div>
            <p class="message" id="card-form-message" role="alert"></p>
          </form>
        </section>`
  }
      </main>
    </section>
  `;

  container.querySelector("#back-to-cards").addEventListener("click", onCancel);
  container.querySelector("#sign-out").addEventListener("click", onSignOut);

  if (loadError) return;

  container.querySelector("#cancel-card").addEventListener("click", onCancel);

  const form = container.querySelector("#card-form");
  const submitButton = container.querySelector("#save-card");
  const message = container.querySelector("#card-form-message");
  const methodSelect = container.querySelector("#card-method");
  const dateLabel = container.querySelector("#card-date-label");

  // "Posted" asks for the posting date, "Collected" for the collection date.
  function syncDate() {
    dateLabel.textContent = methodSelect.value === "collect" ? "Date collected" : "Date posted";
  }
  methodSelect.addEventListener("change", syncDate);
  syncDate();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";
    submitButton.disabled = true;

    try {
      await onSave(Object.fromEntries(new FormData(form)));
    } catch (error) {
      message.textContent = error instanceof Error ? error.message : "Unable to save the card.";
      submitButton.disabled = false;
    }
  });
}

// Inactive levels are hidden for new cards, but the card's current level is
// always kept in the list so editing doesn't silently change it.
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

/* ------------------------------------------------------------------ */
/* Shared pieces                                                        */
/* ------------------------------------------------------------------ */

function memberCard(member) {
  return `
    <section class="member-card" aria-label="Member">
      <div class="member-card-main">
        <span class="member-card-code">${formatMemberCode(member.code_number)}</span>
        <h3>${escapeHtml(member.name)}</h3>
      </div>
      <p class="member-card-meta">
        <span>${escapeHtml(member.membership_levels?.name ?? "No level")}</span>
        <span class="status ${member.status === "active" ? "status-active" : "status-inactive"}">${
    member.status === "active" ? "Active" : "Suspended"
  }</span>
        <span>Expires ${escapeHtml(formatMonthYear(member.membership_expiry_date))}</span>
      </p>
    </section>`;
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
