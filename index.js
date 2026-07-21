'use strict';

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// =====================
// Configuration
// =====================
const MONEROO_API_KEY = process.env.MONEROO_API_KEY;
const MONEROO_WEBHOOK_SECRET = process.env.MONEROO_WEBHOOK_SECRET;
const MONEROO_API_BASE_URL = process.env.MONEROO_API_BASE_URL || 'https://api.moneroo.io';
const MONEROO_RETURN_URL =
  process.env.MONEROO_RETURN_URL || 'https://monerooren.onrender.com/paiement/retour';

const CHARIOW_API_KEY = process.env.CHARIOW_API_KEY;
const CHARIOW_API_BASE_URL = process.env.CHARIOW_API_BASE_URL || 'https://api.chariow.com';

// IDs des produits Chariow
const CHARIOW_PRODUCT_IDS = {
  standard: process.env.CHARIOW_STANDARD_PRODUCT_ID || 'prd_ygxc18l4',
  premium: process.env.CHARIOW_PREMIUM_PRODUCT_ID || 'prd_a0sebq9j',
  advanced: process.env.CHARIOW_ADVANCED_PRODUCT_ID || 'prd_4ighppgk',
};

// Pour un paiement par carte XOF
const DEFAULT_PAYMENT_METHODS = ['card_xof'];

// Mémoire temporaire de test
const subscriptions = new Map();
const pendingPurchases = new Map();

// Middleware pour récupérer le raw body nécessaire à la vérification du webhook
app.use(
  express.json({
    verify: (req, res, buffer) => {
      req.rawBody = buffer.toString('utf8');
    },
  })
);

// =====================
// Helpers
// =====================
function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getPaymentMethodsFromEnv() {
  const raw = process.env.MONEROO_PAYMENT_METHODS;
  if (!raw) return DEFAULT_PAYMENT_METHODS;

  const methods = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return methods.length ? methods : DEFAULT_PAYMENT_METHODS;
}

function verifyWebhookSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const expectedBuffer = Buffer.from(expectedSignature);
  const receivedBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function isMonerooConfigured() {
  return Boolean(MONEROO_API_KEY);
}

function isChariowConfigured() {
  return Boolean(CHARIOW_API_KEY);
}

function normalizePlan(plan) {
  const value = String(plan || '').trim().toLowerCase();

  if (
    value === 'standard' ||
    value === 'standard ai' ||
    value === 'offre standard'
  ) {
    return 'standard';
  }

  if (
    value === 'premium' ||
    value === 'premium ai' ||
    value === 'offre premium'
  ) {
    return 'premium';
  }

  if (
    value === 'advanced' ||
    value === 'advance' ||
    value === 'advanced ai' ||
    value === 'offre avancé' ||
    value === 'offre avance' ||
    value === 'offre advanced'
  ) {
    return 'advanced';
  }

  return value || null;
}

function resolveChariowProductId({ plan, product_id }) {
  if (product_id) return String(product_id).trim();

  const normalizedPlan = normalizePlan(plan);
  if (!normalizedPlan) return null;

  return CHARIOW_PRODUCT_IDS[normalizedPlan] || null;
}

function sanitizePhone(phone) {
  if (phone === undefined || phone === null) return null;

  const raw = String(phone).trim();
  if (!raw) return null;

  // Garde uniquement les chiffres
  const digits = raw.replace(/[^\d]/g, '');
  return digits || null;
}

function extractCheckoutUrl(payload) {
  const visited = new Set();
  const stack = [payload];

  while (stack.length) {
    const current = stack.pop();

    if (!current || typeof current !== 'object') continue;
    if (visited.has(current)) continue;
    visited.add(current);

    if (typeof current.checkout_url === 'string' && current.checkout_url.trim()) {
      return current.checkout_url.trim();
    }

    if (typeof current.checkoutUrl === 'string' && current.checkoutUrl.trim()) {
      return current.checkoutUrl.trim();
    }

    if (typeof current.payment_url === 'string' && current.payment_url.trim()) {
      return current.payment_url.trim();
    }

    if (typeof current.paymentUrl === 'string' && current.paymentUrl.trim()) {
      return current.paymentUrl.trim();
    }

    if (typeof current.url === 'string' && current.url.trim()) {
      return current.url.trim();
    }

    if (current.data && typeof current.data === 'object') stack.push(current.data);
    if (current.payment && typeof current.payment === 'object') stack.push(current.payment);
    if (current.checkout && typeof current.checkout === 'object') stack.push(current.checkout);
    if (Array.isArray(current.items)) stack.push(...current.items);
    if (Array.isArray(current.results)) stack.push(...current.results);
  }

  return null;
}

function extractChariowEvent(payload) {
  return (
    payload?.event ||
    payload?.type ||
    payload?.data?.event ||
    payload?.data?.type ||
    null
  );
}

function extractChariowEmail(payload) {
  return (
    payload?.email ||
    payload?.data?.email ||
    payload?.data?.customer?.email ||
    payload?.customer?.email ||
    null
  );
}

function extractChariowProductId(payload) {
  return (
    payload?.product_id ||
    payload?.data?.product_id ||
    payload?.data?.product?.id ||
    payload?.data?.product?.product_id ||
    payload?.product?.id ||
    null
  );
}

function activateSubscription({ email, userId, plan, productId, source }) {
  const key = String(userId || email || productId || '').trim();
  if (!key) return;

  subscriptions.set(key, {
    active: true,
    email: email || null,
    userId: userId || null,
    plan: plan || null,
    productId: productId || null,
    source: source || null,
    activatedAt: new Date().toISOString(),
  });
}

function getSubscriptionStatus(key) {
  const item = subscriptions.get(String(key || '').trim());
  if (!item) {
    return {
      active: false,
      plan: null,
      productId: null,
      activatedAt: null,
    };
  }

  return item;
}

function planFromProductId(productId) {
  const id = String(productId || '').trim();

  if (id === CHARIOW_PRODUCT_IDS.standard) return 'standard';
  if (id === CHARIOW_PRODUCT_IDS.premium) return 'premium';
  if (id === CHARIOW_PRODUCT_IDS.advanced) return 'advanced';

  return null;
}

// =====================
// Route santé
// =====================
app.get('/', (req, res) => {
  res.send('Mon serveur Moneroo et Chariow fonctionne correctement.');
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    monerooConfigured: isMonerooConfigured(),
    chariowConfigured: isChariowConfigured(),
  });
});

// =====================
// Moneroo
// =====================
app.post('/initier-paiement', async (req, res) => {
  try {
    if (!isMonerooConfigured()) {
      return res.status(500).json({
        status: 'error',
        message: 'MONEROO_API_KEY manquante dans les variables d’environnement.',
      });
    }

    const {
      plan,
      amount,
      cardholderName,
      email,
      firstName,
      lastName,
      phone,
      country,
      city,
      address,
      zip,
      metadata,
    } = req.body || {};

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Le champ amount doit être un nombre positif.',
      });
    }

    if (!email) {
      return res.status(400).json({
        status: 'error',
        message: 'Le champ email est obligatoire.',
      });
    }

    const customerFirstName = firstName || cardholderName || 'Client';
    const customerLastName = lastName || 'Inconnu';

    const payload = {
      amount: Math.round(numericAmount),
      currency: 'XOF',
      description: plan ? `Abonnement ${plan}` : 'Paiement carte',
      return_url: MONEROO_RETURN_URL,
      customer: {
        email: String(email),
        first_name: String(customerFirstName),
        last_name: String(customerLastName),
      },
      methods: getPaymentMethodsFromEnv(),
    };

    if (phone) payload.customer.phone = String(phone);
    if (address) payload.customer.address = String(address);
    if (city) payload.customer.city = String(city);
    if (country) payload.customer.country = String(country);
    if (zip) payload.customer.zip = String(zip);

    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
      payload.metadata = Object.entries(metadata).map(([key, value]) => ({
        key: String(key),
        value: String(value),
      }));
    }

    const response = await axios.post(
      `${MONEROO_API_BASE_URL}/v1/payments/initialize`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${MONEROO_API_KEY}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 30000,
      }
    );

    const data = response.data || {};
    const checkoutUrl = extractCheckoutUrl(data);
    const paymentId = data?.data?.id || data?.id || null;

    return res.status(200).json({
      status: 'success',
      message: 'Transaction initialisée avec succès.',
      paymentId,
      checkoutUrl,
      raw: data,
    });
  } catch (error) {
    const errorDetails = error.response?.data || {
      message: error.message,
      code: error.code || null,
    };

    console.error(
      'ERREUR MONEROO INITIALIZE:',
      JSON.stringify(errorDetails, null, 2)
    );

    return res.status(500).json({
      status: 'error',
      message: "Erreur lors de l'initialisation du paiement Moneroo.",
      details: errorDetails,
    });
  }
});

app.get('/paiement/:paymentId/verifier', async (req, res) => {
  try {
    if (!isMonerooConfigured()) {
      return res.status(500).json({
        status: 'error',
        message: 'MONEROO_API_KEY manquante dans les variables d’environnement.',
      });
    }

    const { paymentId } = req.params;

    if (!paymentId) {
      return res.status(400).json({
        status: 'error',
        message: 'paymentId est obligatoire.',
      });
    }

    const response = await axios.get(
      `${MONEROO_API_BASE_URL}/v1/payments/${encodeURIComponent(paymentId)}/verify`,
      {
        headers: {
          Authorization: `Bearer ${MONEROO_API_KEY}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 30000,
      }
    );

    return res.status(200).json({
      status: 'success',
      message: 'Statut du paiement récupéré.',
      raw: response.data,
    });
  } catch (error) {
    const errorDetails = error.response?.data || {
      message: error.message,
      code: error.code || null,
    };

    console.error(
      'ERREUR MONEROO VERIFY:',
      JSON.stringify(errorDetails, null, 2)
    );

    return res.status(500).json({
      status: 'error',
      message: 'Erreur lors de la vérification du paiement Moneroo.',
      details: errorDetails,
    });
  }
});

app.get('/paiement/retour', (req, res) => {
  const { status, paymentId, paymentStatus } = req.query || {};

  res.status(200).send(`
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Retour paiement</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; }
          .ok { color: #0a7a2f; }
          .bad { color: #b00020; }
        </style>
      </head>
      <body>
        <h2>Retour de paiement</h2>
        <p>Status: <strong class="${status === 'success' ? 'ok' : 'bad'}">${status || 'unknown'}</strong></p>
        <p>Payment ID: ${paymentId || '-'}</p>
        <p>Payment Status: ${paymentStatus || '-'}</p>
      </body>
    </html>
  `);
});

// =====================
// Chariow
// =====================
app.post('/acheter-abonnement', async (req, res) => {
  try {
    if (!isChariowConfigured()) {
      return res.status(500).json({
        status: 'error',
        message: 'CHARIOW_API_KEY manquante dans les variables d’environnement.',
      });
    }

    const {
      userId,
      plan,
      product_id,
      email,
      firstName,
      lastName,
      phone,
      countryCode,
    } = req.body || {};

    if (!email) {
      return res.status(400).json({
        status: 'error',
        message: 'Le champ email est obligatoire.',
      });
    }

    const resolvedProductId = resolveChariowProductId({ plan, product_id });

    if (!resolvedProductId) {
      return res.status(400).json({
        status: 'error',
        message: "Impossible de déterminer le product_id Chariow.",
      });
    }

    const normalizedPlan = normalizePlan(plan) || planFromProductId(resolvedProductId);
    const sanitizedPhone = sanitizePhone(phone);

    // On garde une trace locale pour le test/diagnostic
    const lookupKey = String(userId || email || resolvedProductId).trim();
    pendingPurchases.set(lookupKey, {
      userId: userId || null,
      email: String(email),
      plan: normalizedPlan,
      productId: resolvedProductId,
      status: 'pending',
      createdAt: new Date().toISOString(),
    });

    const payload = {
      product_id: resolvedProductId,
      email: String(email),
      first_name: String(firstName || 'Client'),
      last_name: String(lastName || 'Inconnu'),
    };

    if (sanitizedPhone) {
      payload.phone = {
        number: sanitizedPhone,
        country_code: String(countryCode || 'CD').toUpperCase(),
      };
    }

    const response = await axios.post(
      `${CHARIOW_API_BASE_URL}/v1/checkout`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${CHARIOW_API_KEY}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: 30000,
      }
    );

    const data = response.data || {};
    const checkoutUrl = extractCheckoutUrl(data);

    console.log('REPONSE CHARIOW BRUTE :');
    console.log(JSON.stringify(data, null, 2));
    console.log('URL EXTRAITE :', checkoutUrl);

    if (!checkoutUrl) {
      return res.status(502).json({
        status: 'error',
        message: 'URL de paiement introuvable dans la réponse Chariow.',
        raw: data,
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'Achat d’abonnement initié avec succès.',
      checkout_url: checkoutUrl,
      checkoutUrl,
      product_id: resolvedProductId,
      plan: normalizedPlan,
      raw: data,
    });
  } catch (error) {
    const errorDetails = error.response?.data || {
      message: error.message,
      code: error.code || null,
    };

    console.error(
      'ERREUR CHARIOW ACHETER-ABONNEMENT:',
      JSON.stringify(errorDetails, null, 2)
    );

    return res.status(500).json({
      status: 'error',
      message: "Erreur lors de l'initialisation de l'abonnement Chariow.",
      details: errorDetails,
    });
  }
});

app.post('/webhook/chariow', (req, res) => {
  try {
    console.log('===== PULSE CHARIOW =====');
    console.log(req.body);

    const payload = req.body || {};
    const event = extractChariowEvent(payload);
    const email = extractChariowEmail(payload);
    const productId = extractChariowProductId(payload);
    const plan = planFromProductId(productId);

    switch (event) {
      case 'successful.sale':
      case 'sale.success':
      case 'payment.success':
        console.log('Paiement réussi !');

        activateSubscription({
          email,
          userId: payload.userId || payload?.data?.userId || null,
          plan,
          productId,
          source: 'chariow',
        });

        console.log('Abonnement activé :', {
          email,
          plan,
          productId,
        });
        break;

      case 'failed.sale':
      case 'sale.failed':
      case 'payment.failed':
        console.log('Paiement échoué.');
        break;

      case 'refunded.sale':
      case 'sale.refunded':
      case 'payment.refunded':
        console.log('Paiement remboursé.');
        break;

      default:
        console.log('Événement Chariow inconnu :', event);
    }

    return res.status(200).json({
      success: true,
      message: 'Pulse Chariow reçu avec succès.',
    });
  } catch (error) {
    console.error('ERREUR PULSE CHARIOW:', error);

    return res.status(500).json({
      success: false,
      message: 'Erreur serveur.',
    });
  }
});

app.get('/subscription-status/:key', (req, res) => {
  const { key } = req.params;
  return res.status(200).json({
    status: 'success',
    subscription: getSubscriptionStatus(key),
  });
});

app.get('/subscription-status', (req, res) => {
  const { userId, email, product_id } = req.query || {};
  const key = userId || email || product_id;

  if (!key) {
    return res.status(400).json({
      status: 'error',
      message: 'userId, email ou product_id est requis.',
    });
  }

  return res.status(200).json({
    status: 'success',
    subscription: getSubscriptionStatus(key),
  });
});

// =====================
// Lancement du serveur
// =====================
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
  console.log(`Base API Moneroo : ${MONEROO_API_BASE_URL}`);
  console.log(`Base API Chariow : ${CHARIOW_API_BASE_URL}`);
  console.log('Produits Chariow :', CHARIOW_PRODUCT_IDS);
});
