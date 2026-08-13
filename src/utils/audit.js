// System Audit Log Utility
// Stores operational actions in localStorage under 'pos_audit_logs'

const AUDIT_STORAGE_KEY = "pos_audit_logs";
const SESSION_STORAGE_KEY = "pos_session";

/**
 * Retrieve current active session
 */
export const getActiveSession = () => {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.error("Error reading session:", e);
    return null;
  }
};

/**
 * Log a user action to the audit ledger
 * @param {string} action - Short title of the action (e.g. "إتمام عملية دفع")
 * @param {string} details - Detailed description of the operation
 * @param {object} [userOverride] - Optional user object if logging outside active session (e.g. during login)
 */
export const logAction = (action, details, userOverride = null) => {
  try {
    const session = userOverride || getActiveSession() || {
      userId: "system",
      username: "نظام",
      role: "system"
    };

    const newLog = {
      id: "LOG-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
      timestamp: new Date().toISOString(),
      userId: session.userId || session.id || "unknown",
      username: session.username || session.fullName || "مستخدم غير معروف",
      role: session.role || "unknown",
      action: action || "عملية غير محددة",
      details: typeof details === "object" ? JSON.stringify(details) : (details || "")
    };

    const existingLogs = getAuditLogs();
    // Keep up to 1,000 most recent logs
    const updatedLogs = [newLog, ...existingLogs].slice(0, 1000);
    localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(updatedLogs));

    return newLog;
  } catch (err) {
    console.error("Error writing audit log:", err);
    return null;
  }
};

/**
 * Get all audit logs
 * @returns {Array} List of audit logs
 */
export const getAuditLogs = () => {
  try {
    const raw = localStorage.getItem(AUDIT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.error("Error fetching audit logs:", err);
    return [];
  }
};

/**
 * Get audit logs filtered by a specific date (YYYY-MM-DD)
 * @param {string} dateStr - Date formatted as YYYY-MM-DD
 * @returns {Array} Filtered list of audit logs
 */
export const getAuditLogsByDate = (dateStr) => {
  try {
    const logs = getAuditLogs();
    if (!dateStr) return logs;
    return logs.filter((log) => {
      const logDate = log.timestamp.split("T")[0];
      return logDate === dateStr;
    });
  } catch (err) {
    console.error("Error filtering audit logs by date:", err);
    return [];
  }
};

/**
 * Clear all audit logs (Admin only)
 */
export const clearAuditLogs = () => {
  try {
    localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify([]));
  } catch (err) {
    console.error("Error clearing audit logs:", err);
  }
};
