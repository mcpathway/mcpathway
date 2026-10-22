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
  currentPeriod,
  deleteHours,
  listDeletedHoursForYear,
  listHoursForYear,
  restoreHours,
  saveHours,
  searchMembersForHours,
  yearBounds,
} from "./data/hoursRepository.js";
import {
  exportMembersCsv,
  exportMembersXlsx,
} from "./data/memberExport.js";
import { renderDashboard } from "./views/dashboardView.js";
import {
  renderHoursForm,
  renderHoursMemberPicker,
  renderHoursYear,
} from "./views/hoursView.js";
import { renderLogin } from "./views/loginView.js";
import { renderMemberForm, renderMembers } from "./views/membersView.js";
import { renderMembershipLevels } from "./views/membershipLevelsView.js";
import { findReport, REPORTS } from "./data/reportDefinitions.js";
import { exportTableCsv, exportTableXlsx } from "./data/reportExport.js";
import { REPORT_PAGE_SIZE } from "./data/reportRepository.js";
import { renderReport, renderReportsHome } from "./views/reportsView.js";

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
    onManageHours: () => showHoursPicker(user),
    onOpenReports: () => showReportsHome(user),
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
    onHours: (member) =>
      showHoursYear(user, member, currentPeriod().year, {
        from: { label: "Members", go: () => showMembers(user, state) },
      }),
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

/* ------------------------------ Hours ------------------------------ */

function showHoursPicker(user) {
  renderHoursMemberPicker(app, {
    profile: user.profile,
    onSearch: searchMembersForHours,
    onSelect: (member) =>
      showHoursYear(user, member, currentPeriod().year, {
        from: { label: "Change member", go: () => showHoursPicker(user) },
      }),
    onBack: () => showDashboard(user),
    onSignOut: signOutAndShowLogin,
  });
}

// ctx = { from: { label, go }, showDeleted } - carried between the year view
// and the month form so the back links and the "show deleted" choice survive.
async function showHoursYear(user, member, year, ctx = {}) {
  const isAdmin = user.profile.role === "admin";
  const showDeleted = Boolean(ctx.showDeleted) && isAdmin;
  const from = ctx.from ?? {
    label: "Change member",
    go: () => showHoursPicker(user),
  };
  const nextCtx = { from, showDeleted };
  const reload = (nextYear = year, extra = {}) =>
    showHoursYear(user, member, nextYear, { ...nextCtx, ...extra });

  app.innerHTML = '<p class="loading">Loading hours…</p>';

  let records = [];
  let deletedRecords = null;
  let loadError = null;
  try {
    records = await listHoursForYear(member.id, year);
    if (showDeleted) deletedRecords = await listDeletedHoursForYear(member.id, year);
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Unable to load hours.";
  }

  renderHoursYear(app, {
    profile: user.profile,
    member,
    year,
    bounds: yearBounds(),
    current: currentPeriod(),
    records,
    deletedRecords,
    showDeleted,
    loadError,
    from,
    onChangeYear: (nextYear) => reload(nextYear),
    onToggleDeleted: (checked) => reload(year, { showDeleted: checked }),
    onEditMonth: (month, record) =>
      showHoursForm(user, member, year, month, record, nextCtx),
    onDelete: async (record) => {
      ensureAdmin(user, "Only the admin account can delete hour records.");
      await deleteHours(record.id);
      await reload();
    },
    onRestore: async (record) => {
      ensureAdmin(user, "Only the admin account can restore hour records.");
      await restoreHours(record.id);
      await reload();
    },
    onSignOut: signOutAndShowLogin,
  });
}

function showHoursForm(user, member, year, month, record, ctx) {
  renderHoursForm(app, {
    profile: user.profile,
    member,
    year,
    month,
    record,
    onSave: async (values) => {
      await saveHours({
        memberId: member.id,
        year,
        month,
        recordId: record?.id,
        values,
      });
      await showHoursYear(user, member, year, ctx);
    },
    onCancel: () => showHoursYear(user, member, year, ctx),
    onSignOut: signOutAndShowLogin,
  });
}

/* ----------------------------- Reports ----------------------------- */

function showReportsHome(user) {
  renderReportsHome(app, {
    profile: user.profile,
    reports: REPORTS,
    onOpen: (id) => showReport(user, id),
    onBack: () => showDashboard(user),
    onSignOut: signOutAndShowLogin,
  });
}

function showReport(user, id) {
  const report = findReport(id);
  if (!report) {
    showReportsHome(user);
    return;
  }

  renderReport(app, {
    profile: user.profile,
    report,
    backLabel: "Reports",
    pageSize: REPORT_PAGE_SIZE,
    onBack: () => showReportsHome(user),
    onExport: async (format, table) => {
      if (format === "csv") exportTableCsv(table);
      else await exportTableXlsx(table);
    },
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
  app.innerHTML = '<p class="loading">Opening Pathway Admin…</p>';
  try {
    const user = await getCurrentUser();
    if (user) await showDashboard(user);
    else showLoggedOut();
  } catch (error) {
    showLoggedOut();
  }
}

start();
