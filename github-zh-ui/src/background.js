'use strict';

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  showOriginal: true,
  auditEnabled: true
});
const MAX_AUDIT_ENTRIES = 1500;
let auditQueue = Promise.resolve();

async function ensureDefaults() {
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) await chrome.storage.local.set({ settings: { ...DEFAULT_SETTINGS } });
}

chrome.runtime.onInstalled.addListener(() => { void ensureDefaults(); });
chrome.runtime.onStartup.addListener(() => { void ensureDefaults(); });

function sanitizeBatch(batch) {
  if (!Array.isArray(batch)) return [];
  return batch.slice(0, 250).flatMap((entry) => {
    const text = typeof entry?.text === 'string' ? entry.text.trim() : '';
    const pageType = typeof entry?.pageType === 'string' ? entry.pageType.slice(0, 100) : 'unknown';
    if (!text || text.length > 180 || !/[A-Za-z]/.test(text)) return [];
    return [{ text, pageType }];
  });
}

async function recordAuditBatch(batch) {
  const sanitized = sanitizeBatch(batch);
  if (!sanitized.length) return { saved: 0 };
  const { auditEntries = [] } = await chrome.storage.local.get('auditEntries');
  const indexed = new Map(auditEntries.map((entry) => [`${entry.pageType}\u0000${entry.text}`, entry]));
  const now = new Date().toISOString();
  for (const item of sanitized) {
    const key = `${item.pageType}\u0000${item.text}`;
    const current = indexed.get(key);
    if (current) {
      current.count = Math.min(Number(current.count || 0) + 1, 1_000_000);
      current.lastSeen = now;
    } else if (indexed.size < MAX_AUDIT_ENTRIES) {
      indexed.set(key, { ...item, count: 1, firstSeen: now, lastSeen: now });
    }
  }
  const nextEntries = [...indexed.values()].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  await chrome.storage.local.set({ auditEntries: nextEntries });
  return { saved: sanitized.length, total: nextEntries.length };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'audit:recordBatch') {
    auditQueue = auditQueue.catch(() => undefined).then(() => recordAuditBatch(message.entries));
    auditQueue.then(sendResponse, (error) => sendResponse({ error: String(error) }));
    return true;
  }
  if (message?.type === 'audit:clear') {
    auditQueue = auditQueue.catch(() => undefined).then(async () => {
      await chrome.storage.local.set({ auditEntries: [] });
      return { cleared: true };
    });
    auditQueue.then(sendResponse, (error) => sendResponse({ error: String(error) }));
    return true;
  }
  return false;
});
