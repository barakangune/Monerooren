const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// Configurations
const MONEROO_WEBHOOK_SECRET = process.env.MONEROO_WEBHOOK_SECRET || "pvk_ynbsy6|01KY02RBBBF3HQTZP5FTY6ZS4B";
const MONEROO_API_KEY = process.env.MONEROO_API_KEY; 

// Middleware indispensable pour lire le JSON
app.use(express.json({ 
    verify: (req, res, buffer) => { req.rawBody = buffer.toString(); } 
}));

/** 
 * ROUTE ANDROID : Initier le paiement
 */
app.post("/initier-paiement", async (req, res) => {
  try {
    const { plan, amount, cardNumber, expiry, cvv, cardholderName } = req.body;
    
    console.log(`Paiement initié pour le plan : ${plan} par ${cardholderName}`);

    // Appel à l'API Moneroo avec le endpoint correct /v1/payments/initialize
    const response = await axios.post("https://api-sandbox.moneroo.io/v1/payments/initialize", {
        amount: amount,
        currency: "XOF",
        description: `Abonnement ${plan}`,
        customer: { 
            name: cardholderName,
            email: "client@exemple.com" // Champ requis par l'API
        },
        return_url: "https://monerooren.onrender.com" // URL de retour nécessaire
    }, {
        headers: { 
            "Authorization": `Bearer ${MONEROO_API_KEY}`,
            "Content-Type": "application/json"
        }
    });

    return res.status(200).json({ 
        status: "success", 
        message: "Paiement initié avec succès",
        transaction: response.data 
    });
  } catch (error) {
    console.error("Erreur API Moneroo :", error.response?.data || error.message);
    return res.status(500).json({ 
        status: "error", 
        message: "Erreur lors de la connexion à Moneroo" 
    });
  }
});

/** 
 * ROUTE WEBHOOK : Confirmation de Moneroo
 */
function verifySignature(payload, signature, secret) {
  const expectedSignature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));
}

app.post("/webhook/moneroo", (req, res) => {
  try {
    const signature = req.headers["x-moneroo-signature"];
    if (!signature || !verifySignature(req.rawBody, signature, MONEROO_WEBHOOK_SECRET)) {
        return res.status(401).json({ success: false, message: "Signature invalide ou manquante." });
    }

    const payload = req.body;
    console.log("Webhook reçu :", payload.data?.status);

    if (payload.data?.status === "success") {
      console.log("Paiement confirmé : activation de l'abonnement.");
    }

    return res.status(200).json({ success: true, message: "Webhook traité avec succès." });
  } catch (error) {
    console.error("Erreur Webhook :", error);
    return res.status(500).json({ success: false, message: "Erreur interne." });
  }
});

app.get("/", (req, res) => { res.send("Mon serveur fonctionne!"); });

app.listen(PORT, () => { console.log(`Serveur démarré sur le port ${PORT}`); });
