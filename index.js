const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// Configurations
const MONEROO_WEBHOOK_SECRET = process.env.MONEROO_WEBHOOK_SECRET || "Pvk_sandbox_m7um19|01KXXVNT2X8MBDQ8P9ZC3YXPNS";
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

    // Sécurité: Si le montant envoyé par Android est 0, on met un prix par défaut (ex: 1000 XOF) 
    // car l'API Moneroo refusera un paiement de 0.
    const prixFinal = amount > 0 ? amount : 1000;

    // Appel à l'API Moneroo
    const response = await axios.post("https://api.moneroo.io/v1/payments", {
        amount: prixFinal,
        currency: "XOF",
        customer: { name: cardholderName || "Client" },
        description: `Abonnement ${plan}`
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
    console.error("Erreur API Moneroo :", error.response ? error.response.data : error.message);
    return res.status(500).json({ 
        status: "error", 
        message: "Erreur lors de la connexion à Moneroo",
        details: error.response ? error.response.data : error.message
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

    return res.status(200).json({ success: true, message: "Webhook traité avec succès." });
  } catch (error) {
    console.error("Erreur Webhook :", error);
    return res.status(500).json({ success: false, message: "Erreur interne." });
  }
});

app.get("/", (req, res) => { res.send("Mon serveur fonctionne!"); });

app.listen(PORT, () => { console.log(`Serveur démarré sur le port ${PORT}`); });
