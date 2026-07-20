const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// IMPORTANT : Remplacez cette valeur par votre secret Moneroo
const MONEROO_WEBHOOK_SECRET =
  process.env.MONEROO_WEBHOOK_SECRET ||
  "Pvk_sandbox_m7um19|01KXXVNT2X8MBDQ8P9ZC3YXPNS";

// On récupère le body brut pour vérifier la signature
app.use(
  express.json({
    verify: (req, res, buffer) => {
      req.rawBody = buffer.toString();
    },
  })
);

/**
 * Nouvelle route pour l'application Android NEXA AI
 * Elle reçoit les données du formulaire de l'application
 */
app.post("/initier-paiement", async (req, res) => {
  try {
    const { plan, amount, cardNumber, cardHolderName } = req.body;
    console.log(`Paiement initié pour le plan : ${plan} par ${cardHolderName}`);

    // Ici, vous ajouterez l'appel à l'API Moneroo pour traiter la transaction
    
    return res.status(200).json({
      status: "success",
      message: "Paiement en cours de traitement"
    });
  } catch (error) {
    console.error("Erreur initier-paiement :", error);
    return res.status(500).json({ status: "error", message: "Erreur serveur" });
  }
});

/**
 * Vérifie la signature HMAC du webhook.
 */
function verifySignature(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(signature)
  );
}

/**
 * Webhook Moneroo
 */
app.post("/webhook/moneroo", (req, res) => {
  try {
    const signature = req.headers["x-moneroo-signature"];

    if (!signature) {
      return res.status(400).json({
        success: false,
        message: "Signature manquante.",
      });
    }

    const isValid = verifySignature(
      req.rawBody,
      signature,
      MONEROO_WEBHOOK_SECRET
    );

    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: "Signature invalide.",
      });
    }

    const payload = req.body;

    console.log("=====================================");
    console.log("WEBHOOK MONEROO RECU");
    console.log("=====================================");

    if (payload.data?.status === "success") {
      console.log("Paiement confirmé : activation de l'abonnement.");
    }

    return res.status(200).json({
      success: true,
      message: "Webhook traité avec succès.",
    });
  } catch (error) {
    console.error("Erreur :", error);
    return res.status(500).json({
      success: false,
      message: "Erreur interne du serveur.",
    });
  }
});

app.get("/", (req, res) => {
  res.send("Mon serveur fonctionne!");
});

app.listen(PORT, () => {
  console.log(`Serveur Moneroo démarré sur http://localhost:${PORT}`);
});
