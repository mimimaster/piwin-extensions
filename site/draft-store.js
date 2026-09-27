// Unsent submit-form draft, per browser. Storage can be unavailable (private
// mode, blocked site data); the form works the same without it.
const KEY = 'piwin-extensions:submit-draft:v1';

export function loadDraft() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const draft = raw ? JSON.parse(raw) : null;
    return draft && typeof draft === 'object' ? draft : null;
  } catch {
    return null;
  }
}

export function saveDraft(values) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(values));
  } catch {
    // Not persisted; the page keeps working.
  }
}

export function clearDraft() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing stored to clear.
  }
}
