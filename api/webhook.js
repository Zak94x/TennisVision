// ══════════════════════════════════════════════════════════════
// TennisIQ — api/webhook.js (Vercel)
// Reçoit les events Stripe → met à jour le plan
// ══════════════════════════════════════════════════════════════

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { put } = require('@vercel/blob');

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const PRICE_TO_PLAN = {
  [process.env.STRIPE_PRICE_SOLO]     : 'solo',
  [process.env.STRIPE_PRICE_CLUB]     : 'club',
  [process.env.STRIPE_PRICE_ACADEMIE] : 'academie',
};

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

// Vercel — désactiver le bodyParser pour lire le raw body (nécessaire pour Stripe)
export const config = { api: { bodyParser: false } };

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await getRawBody(req);
  const sig     = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, WEBHOOK_SECRET);
  } catch (e) {
    console.error('Webhook signature error:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  const data = event.data.object;

  async function updateUserPlan(customerId, newPlan, subId = null) {
    const email = data.metadata?.tennisiq_email
      || (await stripe.customers.retrieve(customerId))?.metadata?.tennisiq_email;
    if (!email) return;

    const user = await getUser(email);
    if (!user) return;

    user.plan = newPlan;
    if (subId) user.stripeSubscriptionId = subId;
    await saveUser(user);
    console.log(`✓ Plan mis à jour: ${email} → ${newPlan}`);
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub     = data;
        const status  = sub.status;
        const priceId = sub.items?.data[0]?.price?.id;
        const plan    = PRICE_TO_PLAN[priceId] || 'free';
        const active  = ['trialing', 'active'].includes(status);
        await updateUserPlan(sub.customer, active ? plan : 'free', sub.id);
        break;
      }
      case 'customer.subscription.deleted':
        await updateUserPlan(data.customer, 'free');
        break;
      case 'invoice.payment_failed':
        console.warn('Paiement échoué pour customer:', data.customer);
        break;
    }
  } catch (e) {
    console.error('Webhook processing error:', e);
    return res.status(500).end();
  }

  return res.status(200).json({ received: true });
}
