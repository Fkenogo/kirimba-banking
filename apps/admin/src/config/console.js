export const ADMIN_ROLES = {
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  FINANCE: "finance",
};

export const ROLE_LABELS = {
  [ADMIN_ROLES.SUPER_ADMIN]: "Super Admin",
  [ADMIN_ROLES.ADMIN]: "Operations Admin",
  [ADMIN_ROLES.FINANCE]: "Finance",
};

export const ROLE_BADGE_STYLES = {
  [ADMIN_ROLES.SUPER_ADMIN]: "bg-indigo-100 text-indigo-700 border-indigo-200",
  [ADMIN_ROLES.ADMIN]: "bg-sky-100 text-sky-700 border-sky-200",
  [ADMIN_ROLES.FINANCE]: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

export const ADMIN_ROUTES = {
  DASHBOARD: "/admin/dashboard",
  AGENTS: "/admin/agents",
  AGENTS_NEW: "/admin/agents/new",
  RECONCILIATION_SETTLEMENTS: "/admin/operations/reconciliation-settlements",
  RISK_EXCEPTIONS: "/admin/operations/risk-exceptions",
  RECONCILIATION_LEGACY: "/admin/operations/reconciliation",
  SETTLEMENTS_LEGACY: "/admin/operations/settlements",
};

export const NAV_SECTIONS = [
  {
    id: "overview",
    label: "Overview",
    items: [
      {
        id: "dashboard",
        label: "Dashboard",
        description: "KPI summary and operational attention",
        to: ADMIN_ROUTES.DASHBOARD,
        matchPrefixes: [ADMIN_ROUTES.DASHBOARD],
        roles: [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN, ADMIN_ROLES.FINANCE],
      },
      {
        id: "approvals",
        label: "Approvals",
        description: "Pending members and groups",
        to: "/admin/approvals",
        matchPrefixes: ["/admin/approvals"],
        roles: [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN],
      },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    items: [
      {
        id: "transactions",
        label: "Transactions",
        description: "System-wide transaction oversight",
        to: "/admin/super/transactions",
        matchPrefixes: ["/admin/super/transactions"],
        roles: [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN, ADMIN_ROLES.FINANCE],
      },
      {
        id: "groups",
        label: "Groups",
        description: "Governance and group review",
        to: "/admin/super/groups",
        matchPrefixes: ["/admin/super/groups"],
        roles: [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN],
      },
      {
        id: "loans",
        label: "Loans",
        description: "Operational loan queue and detail views",
        to: "/admin/loans",
        matchPrefixes: ["/admin/loans"],
        roles: [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN, ADMIN_ROLES.FINANCE],
      },
      {
        id: "loan-portfolio",
        label: "Portfolio Summary",
        description: "Aggregate portfolio health",
        to: "/admin/super/loans",
        matchPrefixes: ["/admin/super/loans"],
        roles: [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.FINANCE],
      },
      {
        id: "deposits",
        label: "Deposits & Batches",
        description: "Deposit queues, batch confirmations, and flagged issues",
        to: "/admin/deposits/pending",
        matchPrefixes: ["/admin/deposits/pending"],
        roles: [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN, ADMIN_ROLES.FINANCE],
      },
      {
        id: "reconciliation-settlements",
        label: "Reconciliation & Settlements",
        description: "Unified operations center for reconciliation and payout workflows",
        to: ADMIN_ROUTES.RECONCILIATION_SETTLEMENTS,
        matchPrefixes: [ADMIN_ROUTES.RECONCILIATION_SETTLEMENTS],
        roles: [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN, ADMIN_ROLES.FINANCE],
      },
      {
        id: "agents",
        label: "Agents",
        description: "Separate directory module, still limited in scope",
        to: ADMIN_ROUTES.AGENTS,
        matchPrefixes: [ADMIN_ROUTES.AGENTS],
        roles: [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN],
      },
      {
        id: "risk",
        label: "Risk & Exceptions",
        description: "Flagged activity, suspensions, and open intervention items",
        to: ADMIN_ROUTES.RISK_EXCEPTIONS,
        matchPrefixes: [ADMIN_ROUTES.RISK_EXCEPTIONS],
        roles: [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN],
      },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    items: [
      {
        id: "users-roles",
        label: "Users & Roles",
        description: "Access oversight and account status",
        to: "/admin/super/admins",
        matchPrefixes: ["/admin/super/admins", "/admin/admins/new"],
        roles: [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN],
      },
      {
        id: "user-provisioning",
        label: "User Provisioning",
        description: "Invitation-based account setup for non-member roles",
        to: "/admin/super/provisioning",
        matchPrefixes: ["/admin/super/provisioning"],
        roles: [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN],
      },
      {
        id: "institutions",
        label: "Institutions",
        description: "Partner institution management",
        to: "/admin/super/institutions",
        matchPrefixes: ["/admin/super/institutions", "/admin/institutions/new"],
        roles: [ADMIN_ROLES.SUPER_ADMIN],
      },
      {
        id: "pricing-rules",
        label: "Pricing & Rules",
        description: "Fees, policies, and business rules",
        to: "/admin/super/config",
        matchPrefixes: ["/admin/super/config"],
        roles: [ADMIN_ROLES.SUPER_ADMIN],
      },
      {
        id: "audit-log",
        label: "Audit Log",
        description: "Administrative audit trail",
        to: "/admin/super/audit",
        matchPrefixes: ["/admin/super/audit"],
        roles: [ADMIN_ROLES.SUPER_ADMIN],
      },
      {
        id: "fund",
        label: "Fund Management",
        description: "Kirimba fund capital and ledger",
        to: "/admin/super/fund",
        matchPrefixes: ["/admin/super/fund"],
        roles: [ADMIN_ROLES.SUPER_ADMIN],
      },
    ],
  },
];

export function getNavigationForRole(role) {
  return NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.roles.includes(role)),
    }))
    .filter((section) => section.items.length > 0);
}

export function getPrimaryModulesForRole(role) {
  return getNavigationForRole(role)
    .flatMap((section) => section.items)
    .filter((item) => item.id !== "dashboard");
}

export const ROUTE_ACCESS = {
  [ADMIN_ROUTES.DASHBOARD]: [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN, ADMIN_ROLES.FINANCE],
  "/admin/approvals": [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN],
  [ADMIN_ROUTES.AGENTS]: [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN],
  [ADMIN_ROUTES.AGENTS_NEW]: [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN],
  "/admin/admins/new": [ADMIN_ROLES.SUPER_ADMIN],
  "/admin/institutions/new": [ADMIN_ROLES.SUPER_ADMIN],
  [ADMIN_ROUTES.RECONCILIATION_SETTLEMENTS]: [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN, ADMIN_ROLES.FINANCE],
  "/admin/deposits/pending": [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN, ADMIN_ROLES.FINANCE],
  "/admin/loans": [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN, ADMIN_ROLES.FINANCE],
  "/admin/loans/:loanId": [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN, ADMIN_ROLES.FINANCE],
  "/admin/super/executive": [ADMIN_ROLES.SUPER_ADMIN],
  "/admin/super/transactions": [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN, ADMIN_ROLES.FINANCE],
  "/admin/super/groups": [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN],
  "/admin/super/groups/:groupId": [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN],
  "/admin/super/loans": [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.FINANCE],
  "/admin/super/admins": [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN],
  "/admin/super/provisioning": [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN],
  "/admin/super/audit": [ADMIN_ROLES.SUPER_ADMIN],
  "/admin/super/config": [ADMIN_ROLES.SUPER_ADMIN],
  "/admin/super/institutions": [ADMIN_ROLES.SUPER_ADMIN],
  [ADMIN_ROUTES.RISK_EXCEPTIONS]: [ADMIN_ROLES.SUPER_ADMIN, ADMIN_ROLES.ADMIN],
  "/admin/super/fund": [ADMIN_ROLES.SUPER_ADMIN],
};

export function canAccessRoute(role, path) {
  const allowedRoles = ROUTE_ACCESS[path];
  return Array.isArray(allowedRoles) ? allowedRoles.includes(role) : true;
}
