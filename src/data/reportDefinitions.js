import { listMembershipLevels } from "./membershipLevelsRepository.js";
import { formatMonthYear } from "./dateFormat.js";
import { formatMemberCode } from "./memberRepository.js";
import {
  currentPeriod,
  formatDuration,
  MONTH_NAMES,
  periodKey,
  yearBounds,
} from "./hoursRepository.js";
import {
  countCardChanges,
  getSharedTotals,
  listAllSharedMembers,
  listSharedGroupsPage,
  countCardStates,
  listAllCardChanges,
  listCardChangesPage,
  listAllCardStatus,
  listCardStatusPage,
  countMembersExpiring,
  listAllIncompleteMembers,
  listIncompleteMembersPage,
  MEMBER_DETAIL_FIELDS,
  getMemberHoursTotals,
  listAllMemberEmails,
  listAllMemberHours,
  listAllMembersExpiring,
  listMemberEmailsPage,
  listMemberHoursPage,
  listMembersExpiringPage,
} from "./reportRepository.js";

/* ------------------------------------------------------------------ *
 * Each report is a plain object:
 *   id, title, description
 *   filters    - controls shown above the results
 *                { name, label, type: "select" | "checkbox" | "search", default,
 *                  options (pairs [value, label], or an async function),
 *                  placeholder, showWhen(filters), local (true = no reload) }
 *   loadPage(filters, { page, pageSize })
 *              -> { rows, total, page, summary?, notes? }   (ONE page, for the screen)
 *   loadAll(filters) -> rows                                (everything, for downloads/copy)
 *   columns    - { label, value(row), display?(row), tag?(row) -> CSS class, show?(filters),
 *                  exportOnly? (downloads only), screenOnly? (screen only) }
 *   actions    - extra buttons: { id, label, run(allRows, filters) -> { text, message } }
 *   exportName(filters), resultsTitle?(filters), emptyMessage
 * To add a report, add an object here and list it in REPORTS at the bottom.
 * ------------------------------------------------------------------ */

const pad = (n) => String(n).padStart(2, "0");

const todayParts = (now = new Date()) => ({
  year: now.getFullYear(),
  month: now.getMonth() + 1,
  day: now.getDate(),
});

const dateString = ({ year, month, day }) => `${year}-${pad(month)}-${pad(day)}`;

// Adds months without overflowing (31 Aug + 6 months = 28/29 Feb, not March).
function addMonths({ year, month, day }, months) {
  const index = year * 12 + (month - 1) + months;
  const newYear = Math.floor(index / 12);
  const newMonth = (index % 12) + 1;
  const lastDay = new Date(newYear, newMonth, 0).getDate();
  return { year: newYear, month: newMonth, day: Math.min(day, lastDay) };
}

function addDays({ year, month, day }, days) {
  const date = new Date(year, month - 1, day + days);
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

function daysBetween(fromText, toText) {
  const [y1, m1, d1] = fromText.split("-").map(Number);
  const [y2, m2, d2] = toText.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

const statusText = (status) => (status === "suspended" ? "Suspended" : "Active");
const statusTag = (status) => (status === "suspended" ? "status-inactive" : "status-active");
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);

const STATUS_OPTIONS = [
  ["all", "Active and suspended"],
  ["active", "Active only"],
  ["suspended", "Suspended only"],
];

const MEMBER_FILTER = {
  name: "search",
  label: "Find a member",
  type: "search",
  default: "",
  placeholder: "Name or code…",
};

/* ------------------- 1. Memberships expiring soon ------------------- */

function timeLeft(days) {
  if (days < 0) return days === -1 ? "Expired yesterday" : `Expired ${-days} days ago`;
  if (days === 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  return `In ${days} days`;
}

function expiringOptions(filters) {
  const today = todayParts();

  // "0" = only memberships that have already expired (before today).
  if (filters.months === "0") {
    return {
      startDate: null,
      endDate: dateString(addDays(today, -1)),
      status: filters.status,
      search: filters.search,
    };
  }

  return {
    startDate: filters.includeExpired ? null : dateString(today),
    endDate: dateString(addMonths(today, Number(filters.months))),
    status: filters.status,
    search: filters.search,
  };
}

const withDaysLeft = (rows) => {
  const todayText = dateString(todayParts());
  return rows.map((member) => ({
    ...member,
    daysLeft: daysBetween(todayText, member.membership_expiry_date),
  }));
};

const expiringReport = {
  id: "expiring",
  title: "Memberships expiring soon",
  description:
    "Members whose membership expires within the chosen period, including renewals that are already overdue.",
  filters: [
    MEMBER_FILTER,
    {
      name: "months",
      label: "Expiring within",
      type: "select",
      default: "6",
      options: [
        ["0", "Already expired only"],
        ["1", "1 month"],
        ["2", "2 months"],
        ["3", "3 months"],
        ["6", "6 months"],
        ["12", "12 months"],
      ],
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      default: "all",
      options: STATUS_OPTIONS,
    },
    {
      name: "includeExpired",
      label: "Include memberships that have already expired",
      type: "checkbox",
      default: true,
    },
  ],
  async loadPage(filters, { page, pageSize }) {
    const today = todayParts();
    const todayText = dateString(today);
    const soonText = dateString(addDays(today, 30));
    const options = expiringOptions(filters);

    const [result, expired, soon] = await Promise.all([
      listMembersExpiringPage(options, page, pageSize),
      filters.includeExpired
        ? countMembersExpiring(options, (q) => q.lt("membership_expiry_date", todayText))
        : Promise.resolve(0),
      countMembersExpiring(options, (q) =>
        q.gte("membership_expiry_date", todayText).lte("membership_expiry_date", soonText)),
    ]);

    return {
      rows: withDaysLeft(result.rows),
      total: result.total,
      page: result.page,
      summary: [
        { label: "Members listed", value: result.total },
        ...(filters.includeExpired ? [{ label: "Already expired", value: expired }] : []),
        { label: "Expiring within 30 days", value: soon },
      ],
    };
  },
  async loadAll(filters) {
    return withDaysLeft(await listAllMembersExpiring(expiringOptions(filters)));
  },
  columns: [
    { label: "Code", value: (r) => formatMemberCode(r.code_number) },
    { label: "Name", value: (r) => r.name },
    { label: "Level", value: (r) => r.membership_levels?.name ?? "" },
    {
      label: "Expiry date",
      value: (r) => r.membership_expiry_date, // downloads keep the full date
      display: (r) => formatMonthYear(r.membership_expiry_date), // screen: month and year
    },
    {
      label: "Time left",
      value: (r) => timeLeft(r.daysLeft),
      tag: (r) => (r.daysLeft < 0 ? "status-expired" : r.daysLeft <= 30 ? "status-warning" : null),
    },
    { label: "Status", value: (r) => statusText(r.status), tag: (r) => statusTag(r.status) },
    { label: "Email", value: (r) => r.email ?? "" },
    { label: "Phone", value: (r) => r.phone ?? "" },
  ],
  exportName: (filters) =>
    filters.months === "0"
      ? `members-expired-${dateString(todayParts())}`
      : `members-expiring-${filters.months}-months-${dateString(todayParts())}`,
  emptyMessage: "No memberships match these filters.",
};

/* ------------------------- 2. Member hours ------------------------- */

const round2 = (n) => Math.round(n * 100) / 100;

function hoursOptions(filters) {
  const year = Number(filters.year);
  const month = Number(filters.month);
  const monthly = filters.period === "monthly";

  return {
    from: periodKey(year, monthly ? month : 1),
    to: !monthly || month === 12 ? periodKey(year + 1, 1) : periodKey(year, month + 1),
    status: filters.status === "all" ? null : filters.status,
    search: filters.search,
    hideEmpty: filters.hideEmpty,
  };
}

const hoursReport = {
  id: "hours",
  title: "Member hours",
  description:
    "Clinical, supervision and OPD totals for every member, for one month or a whole year. Search for a single member, or leave it empty to see everyone.",
  filters: [
    {
      name: "period",
      label: "Period",
      type: "select",
      default: "monthly",
      options: [
        ["monthly", "Monthly"],
        ["yearly", "Yearly"],
      ],
    },
    {
      name: "year",
      label: "Year",
      type: "select",
      default: () => String(currentPeriod().year),
      // Built from today's date, so a new year appears by itself.
      options: () => {
        const { min, max } = yearBounds();
        const years = [];
        for (let year = max; year >= min; year--) years.push([String(year), String(year)]);
        return years;
      },
    },
    {
      name: "month",
      label: "Month",
      type: "select",
      default: () => String(currentPeriod().month),
      options: MONTH_NAMES.map((name, index) => [String(index + 1), name]),
      showWhen: (filters) => filters.period === "monthly",
    },
    MEMBER_FILTER,
    {
      name: "status",
      label: "Status",
      type: "select",
      default: "all",
      options: STATUS_OPTIONS,
    },
    {
      name: "hideEmpty",
      label: "Hide members with no hours recorded",
      type: "checkbox",
      default: false,
    },
  ],
  async loadPage(filters, { page, pageSize }) {
    const options = hoursOptions(filters);
    const [result, totals] = await Promise.all([
      listMemberHoursPage(options, page, pageSize),
      getMemberHoursTotals(options),
    ]);

    return {
      rows: result.rows,
      total: result.total,
      page: result.page,
      summary: [
        { label: "Members listed", value: totals.members_count },
        { label: "Clinical total", value: formatDuration(totals.clinical_minutes) },
        { label: "Supervision total", value: formatDuration(totals.supervision_minutes) },
        { label: "OPD points total", value: round2(Number(totals.opd_points)) },
        {
          label: filters.period === "monthly" ? "Not recorded this month" : "No records this year",
          value: totals.members_without_records,
        },
      ],
    };
  },
  loadAll: (filters) => listAllMemberHours(hoursOptions(filters)),
  columns: [
    { label: "Code", value: (r) => formatMemberCode(r.code_number) },
    { label: "Name", value: (r) => r.member_name },
    { label: "Level", value: (r) => r.level_name ?? "" },
    { label: "Status", value: (r) => statusText(r.member_status), tag: (r) => statusTag(r.member_status) },
    { label: "Clinical", value: (r) => (r.months_recorded ? formatDuration(r.clinical_minutes) : "") },
    { label: "Supervision", value: (r) => (r.months_recorded ? formatDuration(r.supervision_minutes) : "") },
    { label: "OPD points", value: (r) => (r.months_recorded ? round2(Number(r.opd_points)) : "") },
    {
      label: "Recorded",
      show: (filters) => filters.period === "monthly",
      value: (r) => (r.months_recorded ? "Yes" : "No"),
      tag: (r) => (r.months_recorded ? "status-active" : "status-warning"),
    },
    {
      label: "Months recorded",
      show: (filters) => filters.period === "yearly",
      value: (r) => r.months_recorded,
    },
    // Numbers for Excel / calculations (downloads only).
    {
      label: "Clinical (decimal hours)",
      exportOnly: true,
      value: (r) => (r.months_recorded ? round2(r.clinical_minutes / 60) : ""),
    },
    {
      label: "Supervision (decimal hours)",
      exportOnly: true,
      value: (r) => (r.months_recorded ? round2(r.supervision_minutes / 60) : ""),
    },
  ],
  resultsTitle: (filters) =>
    filters.period === "monthly"
      ? `Hours for ${MONTH_NAMES[Number(filters.month) - 1]} ${filters.year}`
      : `Hours for ${filters.year}`,
  exportName: (filters) =>
    filters.period === "monthly"
      ? `member-hours-${filters.year}-${pad(Number(filters.month))}`
      : `member-hours-${filters.year}`,
  emptyMessage: "No members match these filters.",
};

/* -------------------------- 3. Member emails -------------------------- */

function emailOptions(filters) {
  return {
    status: filters.status,
    levelId: filters.levelId === "all" ? null : filters.levelId,
    search: filters.search,
    emailFilter: filters.emailFilter,
  };
}

const emailsReport = {
  id: "emails",
  title: "Member email addresses",
  description:
    "Copy or download member email addresses, and see which members have no email on file.",
  filters: [
    MEMBER_FILTER,
    {
      name: "emailFilter",
      label: "Show",
      type: "select",
      default: "with",
      options: [
        ["with", "Members with an email"],
        ["without", "Members without an email"],
        ["all", "All members"],
      ],
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      default: "active",
      options: STATUS_OPTIONS,
    },
    {
      name: "levelId",
      label: "Membership level",
      type: "select",
      default: "all",
      options: async () => {
        const levels = await listMembershipLevels();
        return [
          ["all", "All levels"],
          ...levels.map((level) => [
            level.id,
            level.is_active ? level.name : `${level.name} (inactive)`,
          ]),
        ];
      },
    },
    {
      name: "separator",
      label: "Separate copied addresses with",
      type: "select",
      default: "comma",
      local: true,
      showWhen: (filters) => filters.emailFilter !== "without",
      options: [
        ["comma", "Comma (Gmail, most apps)"],
        ["semicolon", "Semicolon (Outlook)"],
      ],
    },
  ],
  async loadPage(filters, { page, pageSize }) {
    const result = await listMemberEmailsPage(emailOptions(filters), page, pageSize);

    return {
      rows: result.rows,
      total: result.total,
      page: result.page,
      summary: [
        { label: "Members listed", value: result.total },
        { label: "With an email", value: result.withEmail },
        { label: "Without an email", value: result.withoutEmail },
      ],
      notes: filters.emailFilter === "with" && result.withoutEmail
        ? [`${result.withoutEmail} ${plural(result.withoutEmail, "member")} in this selection ${
          plural(result.withoutEmail, "has", "have")
        } no email address. Choose “Members without an email” in the Show box to see who.`]
        : [],
    };
  },
  loadAll: (filters) => listAllMemberEmails(emailOptions(filters)),
  columns: [
    { label: "Code", value: (r) => formatMemberCode(r.code_number) },
    { label: "Name", value: (r) => r.name },
    { label: "Email", value: (r) => r.email ?? "" },
    {
      // Handy for contacting members who have no email on file.
      label: "Phone",
      show: (filters) => filters.emailFilter !== "with",
      value: (r) => r.phone ?? "",
    },
    { label: "Level", value: (r) => r.membership_levels?.name ?? "" },
    { label: "Status", value: (r) => statusText(r.status), tag: (r) => statusTag(r.status) },
  ],
  actions: [
    {
      id: "copy-emails",
      label: "Copy email addresses",
      showWhen: (filters) => filters.emailFilter !== "without",
      // Receives EVERY matching row (not just the page on screen).
      run(rows, filters) {
        const list = uniqueEmails(rows);
        if (!list.length) throw new Error("There are no email addresses in this list to copy.");

        const withAddress = rows.filter((row) => String(row.email ?? "").trim()).length;
        const duplicates = withAddress - list.length;
        const separator = filters.separator === "semicolon" ? "; " : ", ";

        return {
          text: list.join(separator),
          message: `Copied ${list.length} email ${plural(list.length, "address", "addresses")}${
            duplicates ? ` (${duplicates} duplicate ${plural(duplicates, "was", "were")} removed)` : ""
          }.`,
        };
      },
    },
  ],
  resultsTitle: (filters) =>
    ({
      with: "Members with an email address",
      without: "Members without an email address",
      all: "All members",
    })[filters.emailFilter],
  exportName: (filters) =>
    filters.emailFilter === "without"
      ? `members-without-email-${dateString(todayParts())}`
      : `member-emails-${dateString(todayParts())}`,
  emptyMessage: (filters) =>
    filters.emailFilter === "without"
      ? "Every member in this selection has an email address."
      : "No members match these filters.",
};

function uniqueEmails(rows) {
  const seen = new Set();
  const list = [];
  for (const row of rows) {
    const email = String(row.email ?? "").trim();
    const key = email.toLowerCase();
    if (email && !seen.has(key)) {
      seen.add(key);
      list.push(email);
    }
  }
  return list;
}

/* ------------------ 4. Incomplete member records ------------------ */

function incompleteOptions(filters) {
  return {
    status: filters.status,
    levelId: filters.levelId === "all" ? null : filters.levelId,
    search: filters.search,
    fields: filters.fields,
  };
}

// Every optional detail that is empty for this member (not only the ticked ones).
const missingDetails = (member) =>
  MEMBER_DETAIL_FIELDS
    .filter(([column]) => !String(member[column] ?? "").trim())
    .map(([, label]) => label);

const incompleteReport = {
  id: "incomplete",
  title: "Incomplete member records",
  description:
    "Find members with missing details such as email, phone, address or organisation. Tick the details to check: a member is listed if any ticked detail is empty.",
  filters: [
    MEMBER_FILTER,
    {
      name: "fields",
      label: "Details to check",
      type: "checkboxes",
      default: () => MEMBER_DETAIL_FIELDS.map(([column]) => column),
      options: MEMBER_DETAIL_FIELDS,
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      default: "all",
      options: STATUS_OPTIONS,
    },
    {
      name: "levelId",
      label: "Membership level",
      type: "select",
      default: "all",
      options: async () => {
        const levels = await listMembershipLevels();
        return [
          ["all", "All levels"],
          ...levels.map((level) => [
            level.id,
            level.is_active ? level.name : `${level.name} (inactive)`,
          ]),
        ];
      },
    },
  ],
  async loadPage(filters, { page, pageSize }) {
    if (!filters.fields.length) {
      return {
        rows: [],
        total: 0,
        page: 1,
        summary: [],
        notes: ["Tick at least one detail to check."],
      };
    }

    const result = await listIncompleteMembersPage(incompleteOptions(filters), page, pageSize);

    return {
      rows: result.rows,
      total: result.total,
      page: result.page,
      summary: [
        { label: "Members with missing details", value: result.total },
        { label: "Complete records", value: result.selectionTotal - result.total },
      ],
    };
  },
  loadAll: (filters) =>
    filters.fields.length ? listAllIncompleteMembers(incompleteOptions(filters)) : [],
  columns: [
    { label: "Code", value: (r) => formatMemberCode(r.code_number) },
    { label: "Name", value: (r) => r.name },
    { label: "Level", value: (r) => r.membership_levels?.name ?? "" },
    { label: "Status", value: (r) => statusText(r.status), tag: (r) => statusTag(r.status) },
    { label: "Missing", value: (r) => missingDetails(r).join(", "), tag: () => "status-warning" },
  ],
  exportName: () => `incomplete-member-records-${dateString(todayParts())}`,
  emptyMessage: "No members are missing the ticked details.",
};

/* ------------------------- 5. Card status ------------------------- */

const CARD_STATE_LABELS = {
  due: "Card due",
  post: "Posted",
  collect: "Collected",
};

function cardOptions(filters) {
  return {
    cardState: filters.cardState,
    status: filters.status,
    levelId: filters.levelId === "all" ? null : filters.levelId,
    search: filters.search,
  };
}

const cardsReport = {
  id: "cards",
  title: "Card status",
  description:
    "Which members have been given a physical card for their current membership expiry date, and which are still due one.",
  filters: [
    MEMBER_FILTER,
    {
      name: "cardState",
      label: "Card",
      type: "select",
      default: "due",
      options: [
        ["due", "Card due (no card yet)"],
        ["all", "All members"],
        ["issued", "Issued (any)"],
        ["post", "Posted"],
        ["collect", "Collected"],
      ],
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      default: "active",
      options: STATUS_OPTIONS,
    },
    {
      name: "levelId",
      label: "Membership level",
      type: "select",
      default: "all",
      options: async () => {
        const levels = await listMembershipLevels();
        return [
          ["all", "All levels"],
          ...levels.map((level) => [
            level.id,
            level.is_active ? level.name : `${level.name} (inactive)`,
          ]),
        ];
      },
    },
  ],
  async loadPage(filters, { page, pageSize }) {
    const options = cardOptions(filters);
    const [result, counts] = await Promise.all([
      listCardStatusPage(options, page, pageSize),
      countCardStates(options),
    ]);

    return {
      rows: result.rows,
      total: result.total,
      page: result.page,
      summary: [
        { label: "Card due", value: counts.due },
        { label: "Posted", value: counts.post },
        { label: "Collected", value: counts.collect },
      ],
    };
  },
  loadAll: (filters) => listAllCardStatus(cardOptions(filters)),
  columns: [
    { label: "Code", value: (r) => formatMemberCode(r.code_number) },
    { label: "Name", value: (r) => r.name },
    { label: "Level", value: (r) => r.level_name ?? "" },
    {
      label: "Expiry date",
      value: (r) => r.membership_expiry_date, // downloads keep the full date
      display: (r) => formatMonthYear(r.membership_expiry_date), // screen: month and year
    },
    {
      label: "Card",
      value: (r) => CARD_STATE_LABELS[r.card_state] ?? r.card_state,
      tag: (r) => (r.card_state === "due" ? "status-warning" : "status-active"),
    },
    { label: "Date", value: (r) => r.issued_date ?? "" },
    { label: "Level on card", value: (r) => r.card_level_name ?? "" },
    { label: "Note", value: (r) => r.note ?? "" },
    { label: "Status", value: (r) => statusText(r.status), tag: (r) => statusTag(r.status) },
  ],
  exportName: (filters) => `card-status-${filters.cardState}-${dateString(todayParts())}`,
  emptyMessage: "No members match these filters.",
};

/* ---------------------- 6. Card level changes ---------------------- */

function changeOptions(filters) {
  const months = Number(filters.period);
  return {
    change: filters.change,
    status: filters.status,
    search: filters.search,
    fromDate: months ? dateString(addMonths(todayParts(), -months)) : null,
  };
}

const cardChangesReport = {
  id: "cardchanges",
  title: "Card level changes",
  description:
    "Physical cards compared with the member's previous card (the digital ID at registration, or an earlier card): did the membership level change, and how many days later.",
  filters: [
    MEMBER_FILTER,
    {
      name: "change",
      label: "Show",
      type: "select",
      default: "changed",
      options: [
        ["changed", "Level changed"],
        ["same", "Same level"],
        ["all", "All cards"],
      ],
    },
    {
      name: "period",
      label: "Card issued in the last",
      type: "select",
      default: "0",
      options: [
        ["0", "Any time"],
        ["3", "3 months"],
        ["6", "6 months"],
        ["12", "12 months"],
      ],
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      default: "all",
      options: STATUS_OPTIONS,
    },
  ],
  async loadPage(filters, { page, pageSize }) {
    const options = changeOptions(filters);
    const [result, counts] = await Promise.all([
      listCardChangesPage(options, page, pageSize),
      countCardChanges(options),
    ]);

    return {
      rows: result.rows,
      total: result.total,
      page: result.page,
      summary: [
        { label: "Level changed", value: counts.changed },
        { label: "Same level", value: counts.same },
      ],
    };
  },
  loadAll: (filters) => listAllCardChanges(changeOptions(filters)),
  columns: [
    // On screen: four short columns. Downloads: the full detail (the exportOnly columns).
    {
      label: "Member",
      value: (r) => `${formatMemberCode(r.code_number)} · ${r.name}`,
      screenOnly: true,
    },
    {
      label: "Level",
      value: (r) =>
        r.level_changed
          ? `${r.previous_level_name} → ${r.level_name}`
          : `${r.level_name} · no change`,
      tag: (r) => (r.level_changed ? "status-warning" : "status-active"),
      screenOnly: true,
    },
    {
      label: "Card",
      value: (r) => `${CARD_STATE_LABELS[r.delivery_method] ?? r.delivery_method} ${r.issued_date ?? ""}`,
      screenOnly: true,
    },
    {
      label: "Since previous card",
      value: (r) => (r.days_since_previous === null || r.days_since_previous === undefined
        ? ""
        : `${r.days_since_previous} ${r.days_since_previous === 1 ? "day" : "days"}`),
      screenOnly: true,
    },
    { label: "Code", value: (r) => formatMemberCode(r.code_number), exportOnly: true },
    { label: "Name", value: (r) => r.name, exportOnly: true },
    { label: "Previous level", value: (r) => r.previous_level_name ?? "", exportOnly: true },
    { label: "Level on card", value: (r) => r.level_name ?? "", exportOnly: true },
    {
      label: "Change",
      value: (r) => (r.level_changed ? "Changed" : "Same level"),
      exportOnly: true,
    },
    { label: "Previous card date", value: (r) => r.previous_date ?? "", exportOnly: true },
    { label: "Card date", value: (r) => r.issued_date ?? "", exportOnly: true },
    { label: "Days between", value: (r) => r.days_since_previous ?? "", exportOnly: true },
    {
      label: "Card",
      value: (r) => CARD_STATE_LABELS[r.delivery_method] ?? r.delivery_method,
      exportOnly: true,
    },
    { label: "Status", value: (r) => statusText(r.status), exportOnly: true },
  ],
  exportName: (filters) => `card-level-changes-${filters.change}-${dateString(todayParts())}`,
  emptyMessage: "No cards match these filters.",
};

/* ------------------------- 7. Shared details ------------------------- */

const SHARED_FIELDS = [
  ["name", "Name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["organisation", "Organisation"],
];

const WHO_SHOWN = 5; // names listed before "+N more"

function sharedOptions(filters) {
  return {
    fields: filters.fields,
    status: filters.status,
    levelId: filters.levelId === "all" ? null : filters.levelId,
    search: filters.search,
    maxSize: filters.size === "any" ? null : Number(filters.size),
  };
}

const escapeText = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

// The members of a group: the first few, and a button that opens the rest inside the row.
function whoHtml(members) {
  const list = members ?? [];
  const items = list.map((member, index) =>
    `<li${index >= WHO_SHOWN ? ' class="shared-more" hidden' : ""}>${
      escapeText(formatMemberCode(member.code))
    } ${escapeText(member.name)}</li>`
  ).join("");

  const hiddenCount = list.length - WHO_SHOWN;
  const more = hiddenCount > 0
    ? `<button type="button" class="text-button" data-expand data-hidden="${hiddenCount}">+${hiddenCount} more ▾</button>`
    : "";

  return `<div class="shared-who"><ul>${items}</ul>${more}</div>`;
}

const sharedReport = {
  id: "shared",
  title: "Shared details",
  description:
    "Find members who share the same name, email, phone or organisation. Tick what to compare: members are grouped when all the ticked details match.",
  filters: [
    MEMBER_FILTER,
    {
      name: "fields",
      label: "Compare",
      type: "checkboxes",
      default: () => ["email"],
      options: SHARED_FIELDS,
    },
    {
      name: "size",
      label: "Show groups of",
      type: "select",
      default: "any",
      options: [
        ["any", "Any size"],
        ["5", "2–5 members"],
        ["10", "2–10 members"],
        ["20", "2–20 members"],
      ],
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      default: "all",
      options: STATUS_OPTIONS,
    },
    {
      name: "levelId",
      label: "Membership level",
      type: "select",
      default: "all",
      options: async () => {
        const levels = await listMembershipLevels();
        return [
          ["all", "All levels"],
          ...levels.map((level) => [
            level.id,
            level.is_active ? level.name : `${level.name} (inactive)`,
          ]),
        ];
      },
    },
  ],
  async loadPage(filters, { page, pageSize }) {
    if (!filters.fields.length) {
      return {
        rows: [],
        total: 0,
        page: 1,
        summary: [],
        notes: ["Tick at least one detail to compare."],
      };
    }

    const options = sharedOptions(filters);
    const [result, totals] = await Promise.all([
      listSharedGroupsPage(options, page, pageSize),
      getSharedTotals(options),
    ]);

    return {
      rows: result.rows,
      total: result.total,
      page: result.page,
      summary: [
        { label: "Shared groups", value: totals.groups },
        { label: "Members involved", value: totals.members },
      ],
    };
  },
  loadAll: (filters) =>
    filters.fields.length ? listAllSharedMembers(sharedOptions(filters)) : [],
  columns: [
    // On screen: one row per group. Downloads: one row per member (the exportOnly columns).
    { label: "Shared by", value: (r) => r.shared_value, screenOnly: true },
    { label: "Members", value: (r) => r.members_count, screenOnly: true },
    { label: "Who", value: (r) => "", html: (r) => whoHtml(r.members), screenOnly: true },
    { label: "Shared value", value: (r) => r.shared_value, exportOnly: true },
    { label: "Group size", value: (r) => r.members_count, exportOnly: true },
    { label: "Code", value: (r) => formatMemberCode(r.code_number), exportOnly: true },
    { label: "Name", value: (r) => r.member_name, exportOnly: true },
    { label: "Level", value: (r) => r.level_name ?? "", exportOnly: true },
    { label: "Status", value: (r) => statusText(r.member_status), exportOnly: true },
    { label: "Email", value: (r) => r.email ?? "", exportOnly: true },
    { label: "Phone", value: (r) => r.phone ?? "", exportOnly: true },
    { label: "Organisation", value: (r) => r.organisation ?? "", exportOnly: true },
  ],
  exportName: (filters) =>
    `shared-details-${filters.fields.join("-") || "none"}-${dateString(todayParts())}`,
  emptyMessage: "No members share the ticked details.",
};

/* ------------------------------------------------------------------ */

export const REPORTS = [expiringReport, hoursReport, emailsReport, incompleteReport, cardsReport, cardChangesReport, sharedReport];

export function findReport(id) {
  return REPORTS.find((report) => report.id === id);
}
