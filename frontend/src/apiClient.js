// Centralized API client that automatically appends userid & firmid from URL
export function getTenantIds() {
  const params = new URLSearchParams(window.location.search);
  const userid = params.get('userid');
  const firmid = params.get('firmid');
  return { userid, firmid };
}

export async function apiFetch(path, options = {}) {
  const base = process.env.REACT_APP_API_BASE || 'http://localhost:5600';
  const { userid, firmid } = getTenantIds();
  const url = new URL(path.startsWith('http') ? path : `${base}${path}`);
  if (userid && !url.searchParams.get('userid')) url.searchParams.set('userid', userid);
  if (firmid && !url.searchParams.get('firmid')) url.searchParams.set('firmid', firmid);
  const resp = await fetch(url.toString(), options);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Request failed (${resp.status}): ${text}`);
  }
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) return resp.json();
  return resp.text();
}
