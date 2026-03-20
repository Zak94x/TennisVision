// ══════════════════════════════════════════════════════════════
// TennisIQ — api/auth.js (Vercel)
// Actions : signup | login | verify
// ══════════════════════════════════════════════════════════════

const jwt    = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET  = process.env.JWT_SECRET || 'change-me-in-env';
const JWT_EXPIRES = '30d';

// ── KV Store via Vercel Blob ──────────────────────────────────
const { put, get } = require('@vercel/blob');

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

async function saveUser(user) {
  const key  = `users/${user.email.replace(/[@.]/g, '_')}.json`;
  const blob = new Blob([JSON.stringify(user)], { type: 'application/json' });
  await put(key, blob, { access: 'public', token: process.env.BLOB_READ_WRITE_TOKEN, allowOverwrite: true });
}

// ── CORS ──────────────────────────────────────────────────────
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ── Handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, password, name } = req.body;
  const emailClean = (email || '').toLowerCase().trim();

  // ── SIGNUP ──────────────────────────────────────────────────
  if (action === 'signup') {
    if (!emailClean || !password || !name)
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean))
      return res.status(400).json({ error: 'Email invalide' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Mot de passe : 8 caractères minimum' });

    if (await getUser(emailClean))
      return res.status(400).json({ error: 'Un compte existe déjà avec cet email' });

    const hash = await bcrypt.hash(password, 10);
    const now  = Date.now();
    const user = {
      email      : emailClean,
      name       : name.trim(),
      passwordHash: hash,
      plan       : 'free',
      stripeCustomerId     : null,
      stripeSubscriptionId : null,
      createdAt  : new Date(now).toISOString(),
      trialEndsAt: new Date(now + 30 * 86400 * 1000).toISOString(),
    };
    await saveUser(user);

    const token = jwt.sign(
      { email: user.email, name: user.name, plan: user.plan },
      JWT_SECRET, { expiresIn: JWT_EXPIRES }
    );
    return res.status(201).json({ token, user: publicUser(user) });
  }

  // ── LOGIN ────────────────────────────────────────────────────
  if (action === 'login') {
    if (!emailClean || !password)
      return res.status(400).json({ error: 'Email et mot de passe requis' });

    const user = await getUser(emailClean);
    if (!user) return res.status(400).json({ error: 'Email ou mot de passe incorrect' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid)  return res.status(400).json({ error: 'Email ou mot de passe incorrect' });

    const token = jwt.sign(
      { email: user.email, name: user.name, plan: user.plan },
      JWT_SECRET, { expiresIn: JWT_EXPIRES }
    );
    return res.status(200).json({ token, user: publicUser(user) });
  }

  // ── VERIFY ───────────────────────────────────────────────────
  if (action === 'verify') {
    const header = (req.headers.authorization || '').replace('Bearer ', '');
    if (!header) return res.status(401).json({ error: 'Token manquant' });
    try {
      const decoded = jwt.verify(header, JWT_SECRET);
      const user    = await getUser(decoded.email);
      if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
      return res.status(200).json({ user: publicUser(user) });
    } catch {
      return res.status(401).json({ error: 'Token invalide ou expiré' });
    }
  }

  return res.status(400).json({ error: 'Action inconnue' });
}

function publicUser(u) {
  return {
    email      : u.email,
    name       : u.name,
    plan       : u.plan,
    trialEndsAt: u.trialEndsAt,
    stripeSubscriptionId: u.stripeSubscriptionId,
  };
}
