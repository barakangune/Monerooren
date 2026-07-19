// server.js

const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

// IMPORTANT : Remplacez cette valeur par votre secret Moneroo
const MONEROO_WEBHOOK_SECRET =
    process.env.MONEROO_WEBHOOK_SECRET ||
    "VOTRE_SECRET_MONEROO";

// On récupère le body brut pour vérifier la signature
app.use(
    express.json({
        verify: (req, res, buffer) => {
            req.rawBody = buffer.toString();
        },
    })
);

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
        // Nom de l'en-tête à adapter selon la documentation Moneroo
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

        console.log("================================");
        console.log("WEBHOOK MONEROO REÇU");
        console.log("================================");

        console.log("Type :", payload.event);
        console.log("Transaction ID :", payload.data?.id);
        console.log("Montant :", payload.data?.amount);
        console.log("Devise :", payload.data?.currency);
        console.log("Statut :", payload.data?.status);
        console.log("Client :", payload.data?.customer?.email);

        console.log(
            "Données complètes :",
            JSON.stringify(payload, null, 2)
        );

        // Exemple :
        // - Activer un abonnement.
        // - Mettre à jour la base de données.
        // - Envoyer une notification.

        if (payload.data?.status === "success") {
            console.log(
                "Paiement confirmé : activation de l'abonnement."
            );
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
    app.get('/', (req, res) => {
    res.send('Mon serveur fonctionne!'}
});

app.listen(PORT, () => {
    console.log(
        `Serveur Moneroo démarré sur http://localhost:${PORT}`
    );
});
