// ══════════════════════════════════════════════════════════════
// TennisIQ — api/create-checkout.js (Vercel)
// Crée une session Stripe Checkout
// ══════════════════════════════════════════════════════════════

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const jwt    = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';
const SITE_URL   = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'https://tennisiq-kappa.vercel.app';

const PRICE_IDS = {
  solo     : process.env.STRIPE_PRICE_SOLO,
  club     : process.env.STRIPE_PRICE_CLUB,
  academie : process.env.STRIPE_PRICE_ACADEMIE,
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function getUser(email) {
  try {
    const url = `users/${email.toLowerCase().replace(/[@.]/g, '_')}.json`;
    const r   = await fetch(`https://blob.vercel-storage.com/${url}`, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` }
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function saveUser(user) {
  const { put } = require('@vercel/blob');
  const key  = `users/${user.email.replace(/[@.]/g, '_')}.json`;
  const blob = new Blob([JSON.stringify(user)], { type: 'application/json' });
  await put(key, blob, { access: 'public', token: process.env.BLOB_READ_WRITE_TOKEN, allowOverwrite: true });
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // ── Auth ──────────────────────────────────────────────────────
  const authHeader = (req.headers.authorization || '').replace('Bearer ', '');
  let decoded;
  try { decoded = jwt.verify(authHeader, JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Non authentifié' }); }

  const { plan } = req.body;
  const priceId  = PRICE_IDS[plan];
  if (!priceId) return res.status(400).json({ error: `Plan inconnu: ${plan}` });

  // ── Customer Stripe ───────────────────────────────────────────
  const user = await getUser(decoded.email);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });

  let customerId = user.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email, name: user.name,
      metadata: { tennisiq_email: user.email },
    });
    customerId = customer.id;
    user.stripeCustomerId = customerId;
    await saveUser(user);
  }

  // ── Session Checkout ──────────────────────────────────────────
  const session = await stripe.checkout.sessions.create({
    customer   : customerId,
    mode       : 'subscription',
    line_items : [{ price: priceId, quantity: 1 }],
    success_url: `${SITE_URL}/?checkout=success&plan=${plan}`,
    cancel_url : `${SITE_URL}/?checkout=cancel`,
    allow_promotion_codes: true,
    subscription_data: {
      trial_period_days: 30,
      metadata: { plan, tennisiq_email: user.email },
    },
    metadata: { plan, tennisiq_email: user.email },
  });

  return res.status(200).json({ url: session.url });
}
