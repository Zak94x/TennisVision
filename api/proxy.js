// ══════════════════════════════════════════════════════════════
// TennisIQ — api/proxy.js (Vercel)
// Proxy sécurisé vers Anthropic — vérifie JWT + plan
// ══════════════════════════════════════════════════════════════

const jwt = require('jsonwebtoken');

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const JWT_SECRET    = process.env.JWT_SECRET || 'change-me-in-env';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function getUser(email) {
  try {
    const url = `users/${email.toLowerCase().replace(/[@.]/g, '_')}.json`;
    const res  = await fetch(`https://blob.vercel-storage.com/${url}`, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

function hasAccess(user) {
  if (user.plan && user.plan !== 'free') return true;
  if (user.trialEndsAt && new Date(user.trialEndsAt) > new Date()) return true;
  return false;
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // ── Auth ─────────────────────────────────────────────────────
  const authHeader = (req.headers.authorization || '').replace('Bearer ', '');
  if (!authHeader) return res.status(401).json({ error: 'Non authentifié — connecte-toi pour utiliser TennisIQ' });

  let decoded;
  try { decoded = jwt.verify(authHeader, JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Session expirée — reconnecte-toi' }); }

  const user = await getUser(decoded.email);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  if (!hasAccess(user)) {
    return res.status(403).json({ error: 'Abonnement requis — choisis un plan pour continuer' });
  }

  // ── Forward vers Anthropic ────────────────────────────────────
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method : 'POST',
    headers: {
      'Content-Type'      : 'application/json',
      'x-api-key'         : ANTHROPIC_KEY,
      'anthropic-version' : '2023-06-01',
    },
    body: JSON.stringify(req.body),
  });

  const data = await response.json();
  return res.status(response.status).json(data);
}
