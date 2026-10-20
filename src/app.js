import { getCurrentUser, signIn, signOut } from "./data/authRepository.js";
import {
  createMembershipLevel,
  deleteMembershipLevel,
  listMembershipLevels,
  updateMembershipLevel,
} from "./data/membershipLevelsRepository.js";
import {
  createMember,
  deleteMember,
  listAllMembersForExport,
  listMembersPage,
  MEMBERS_PAGE_SIZE,
  restoreMember,
  updateMember,
} from "./data/memberRepository.js";
import {
  exportMembersCsv,
  exportMembersXlsx,
} from "./data/memberExport.js";
import { renderDashboard } from "./views/dashboardView.js";
import { renderLogin } from "./views/loginView.js";
import { renderMemberForm, renderMembers } from "./views/membersView.js";
import { renderMembershipLevels } from "./views/membershipLevelsView.js";

const app = document.querySelector("#app");

async function signOutAndShowLogin() {
  try {
    await signOut();
  } finally {
    showLoggedOut();
  }
}

async function showDashboard(user) {
  renderDashboard(app, {
    profile: user.profile,
    onManageMembers: () => showMembers(user),
    onManageLevels: () => showMembershipLevels(user),
    onSignOut: signOutAndShowLogin,
  });
}

/* ---------------------------- Members ---------------------------- */

const freshListState = () => ({ page: 1, search: "", showDeleted: false });

// The list screen remembers its page and search, so coming back from the
// add/edit screen returns to the same place.
function showMembers(user, listState = freshListState()) {
  let state = listState;

  renderMembers(app, {
    profile: user.profile,
    initialState: state,
    pageSize: MEMBERS_PAGE_SIZE,
    loadPage: ({ page, search, showDeleted }) =>
      listMembersPage({
        page,
        search,
        includeDeleted: showDeleted && user.profile.role === "admin",
        pageSize: MEMBERS_PAGE_SIZE,
      }),
    onStateChange: (next) => {
      state = next;
    },
    onAdd: () => showMemberForm(user, null, state),
    onEdit: (member) => showMemberForm(user, member, state),
    onDelete: async (id) => {
      ensureAdmin(user, "Only the admin account can delete members.");
      await deleteMember(id);
    },
    onRestore: async (id) => {
      ensureAdmin(user, "Only the admin account can restore members.");
      await restoreMember(id);
    },
    onExport: async (format) => {
      const all = await listAllMembersForExport();
      if (format === "csv") exportMembersCsv(all);
      else await exportMembersXlsx(all);
    },
    onBack: () => showDashboard(user),
    onSignOut: signOutAndShowLogin,
  });
}

async function showMemberForm(user, member, listState) {
  app.innerHTML = '<p class="loading">Loading…</p>';

  let levels = [];
  let loadError = null;
  try {
    levels = await listMembershipLevels();
  } catch (error) {
    loadError = error instanceof Error
      ? error.message
      : "Unable to load membership levels.";
  }

  renderMemberForm(app, {
    profile: user.profile,
    levels,
    member,
    loadError,
    onSave: async (values) => {
      if (member) {
        await updateMember(member.id, values);
        showMembers(user, listState);
      } else {
        await createMember(values);
        // New members have the highest code, so they appear at the top of page 1.
        showMembers(user, { ...listState, page: 1, search: "" });
      }
    },
    onCancel: () => showMembers(user, listState),
    onSignOut: signOutAndShowLogin,
  });
}

/* ------------------------ Membership levels ------------------------ */

async function showMembershipLevels(user) {
  app.innerHTML = '<p class="loading">Loading membership levels…</p>';

  try {
    const levels = await listMembershipLevels();
    renderLevelsPage(user, levels);
  } catch (error) {
    renderLevelsPage(user, [], error);
  }
}

function renderLevelsPage(user, levels, loadError) {
  renderMembershipLevels(app, {
    profile: user.profile,
    levels,
    loadError: loadError instanceof Error
      ? loadError.message
      : loadError
      ? "Unable to load membership levels."
      : null,
    onBack: () => showDashboard(user),
    onCreate: async (values) => {
      ensureAdmin(user);
      await createMembershipLevel(values);
      await showMembershipLevels(user);
    },
    onUpdate: async (id, values) => {
      ensureAdmin(user);
      await updateMembershipLevel(id, values);
      await showMembershipLevels(user);
    },
    onDelete: async (id) => {
      ensureAdmin(user);
      await deleteMembershipLevel(id);
      await showMembershipLevels(user);
    },
    onSignOut: signOutAndShowLogin,
  });
}

function ensureAdmin(
  user,
  message = "Only the admin account can change membership levels.",
) {
  if (user.profile.role !== "admin") {
    throw new Error(message);
  }
}

function showLoggedOut() {
  renderLogin(app, {
    onSubmit: async (username, password) => {
      const user = await signIn(username, password);
      await showDashboard(user);
    },
  });
}

async function start() {
  app.innerHTML = '<p class="loading">Opening Pathway Logbook Management System…</p>';
  try {
    const user = await getCurrentUser();
    if (user) await showDashboard(user);
    else showLoggedOut();
  } catch (error) {
    showLoggedOut();
  }
}

start();
