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

// Pour un paiement par carte XOF, la doc Moneroo liste notamment le shortcode `card_xof`.
// Tu peux remplacer via MONEROO_PAYMENT_METHODS="card_xof" ou ajouter d'autres codes supportés.
const DEFAULT_PAYMENT_METHODS = ['card_xof'];

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

// =====================
// Route santé
// =====================
app.get('/', (req, res) => {
  res.send('Mon serveur Moneroo fonctionne correctement.');
});

// =====================
// Initier un paiement
// =====================
// Body attendu par ton app Android par exemple :
// {
//   "plan": "Premium",
//   "amount": 1000,
//   "cardholderName": "Jean",
//   "email": "[email protected]",
//   "firstName": "Jean",
//   "lastName": "Kabila"
// }
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

    // Champs optionnels si tu veux les transmettre
    if (phone) payload.customer.phone = String(phone);
    if (address) payload.customer.address = String(address);
    if (city) payload.customer.city = String(city);
    if (country) payload.customer.country = String(country);
    if (zip) payload.customer.zip = String(zip);

    // Metadata optionnel : Moneroo attend un tableau d'objets clé/valeur ou
    // des données additionnelles selon le format de ta version.
    // On accepte ici un objet simple et on le convertit proprement.
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
    const checkoutUrl = data?.data?.checkout_url || null;
    const paymentId = data?.data?.id || null;

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

// =====================
// Vérifier un paiement
// Moneroo recommande de re-vérifier via l’API avant de créditer le client.
// =====================
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

// =====================
// Webhook Moneroo
// La signature est dans X-Moneroo-Signature et se vérifie en HMAC-SHA256
// =====================
app.post('/webhook/moneroo', async (req, res) => {
  try {
    const signature =
      req.headers['x-moneroo-signature'] ||
      req.headers['X-Moneroo-Signature'] ||
      '';

    if (!MONEROO_WEBHOOK_SECRET) {
      return res.status(500).json({
        success: false,
        message: 'MONEROO_WEBHOOK_SECRET manquante.',
      });
    }

    const isValid = verifyWebhookSignature(
      req.rawBody || '',
      String(signature),
      MONEROO_WEBHOOK_SECRET
    );

    if (!isValid) {
      return res.status(403).json({
        success: false,
        message: 'Signature webhook invalide.',
      });
    }

    const payload = safeJsonParse(req.rawBody, null);

    if (!payload) {
      return res.status(400).json({
        success: false,
        message: 'Payload webhook JSON invalide.',
      });
    }

    const event = payload.event;
    const data = payload.data || {};

    console.log('Webhook Moneroo reçu :', {
      event,
      paymentId: data.id || null,
      status: data.status || null,
    });

    // Exemple de traitement
    if (event === 'payment.success') {
      // Ici tu peux:
      // 1) re-vérifier le paiement via /v1/payments/{paymentId}/verify
      // 2) créditer l'utilisateur
      // 3) marquer la commande comme payée
      console.log('Paiement réussi:', data.id);
    } else if (event === 'payment.failed') {
      console.log('Paiement échoué:', data.id);
    }

    return res.status(200).json({
      success: true,
      message: 'Webhook traité avec succès.',
    });
  } catch (error) {
    console.error('ERREUR WEBHOOK MONEROO:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur webhook.',
    });
  }
});

// =====================
// Lancer le serveur
// =====================
app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
  console.log(`Base API Moneroo : ${MONEROO_API_BASE_URL}`);
});
