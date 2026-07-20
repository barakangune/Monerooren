const express = require("express");
const crypto = require("crypto");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 10000;

// Configurations
const MONEROO_WEBHOOK_SECRET = process.env.MONEROO_WEBHOOK_SECRET || "pvk_sandbox_3n9wfo|01KY052WE3E4D3H1NR5STJ1PZH";
const MONEROO_API_KEY = process.env.MONEROO_API_KEY; 

app.use(express.json({ 
    verify: (req, res, buffer) => { req.rawBody = buffer.toString(); } 
}));

/** 
 * ROUTE ANDROID : Initier le paiement
 */
app.post("/initier-paiement", async (req, res) => {
  try {
    const { plan, amount, cardholderName } = req.body;
    
    if (!MONEROO_API_KEY) {
        console.error("Erreur : MONEROO_API_KEY est manquante dans les variables d'environnement.");
        return res.status(500).json({ status: "error", message: "Configuration serveur manquante." });
    }

    console.log(`Tentative de paiement pour : ${plan}, Montant : ${amount}`);

    const response = await axios.post("https://api-sandbox.moneroo.io/v1/payments/initialize", {
        amount: amount,
        currency: "XOF",
        description: `Abonnement ${plan}`,
        customer: { 
            name: cardholderName || "Client inconnu",
            email: "client@exemple.com"
        },
        return_url: "https://monerooren.onrender.com"
    }, {
        headers: { 
            "Authorization": `Bearer ${MONEROO_API_KEY}`,
            "Content-Type": "application/json"
        }
    });

    return res.status(200).json(response.data);

  } catch (error) {
    // Affiche l'erreur réelle dans les logs Render pour diagnostic
    const errorDetails = error.response?.data || error.message;
    console.error("ERREUR DÉTAILLÉE MONEROO :", JSON.stringify(errorDetails));
    
    return res.status(500).json({ 
        status: "error", 
        message: "Erreur lors de la connexion à Moneroo",
        details: errorDetails
    });
  }
});

/** 
 * ROUTE WEBHOOK
 */
function verifySignature(payload, signature, secret) {
  const expectedSignature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature));
}

app.post("/webhook/moneroo", (req, res) => {
  const signature = req.headers["x-moneroo-signature"];
  if (!signature || !verifySignature(req.rawBody, signature, MONEROO_WEBHOOK_SECRET)) {
      return res.status(401).json({ success: false, message: "Signature invalide." });
  }
  console.log("Webhook reçu avec succès.");
  return res.status(200).json({ success: true });
});

app.get("/", (req, res) => { res.send("Mon serveur fonctionne parfaitement!"); });

app.listen(PORT, () => { console.log(`Serveur démarré sur le port ${PORT}`); });
