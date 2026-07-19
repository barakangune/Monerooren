############
 Moneroon
Ce projet est un serveur backend simple et sécurisé utilisant **Node.js** et **Express**.
## Fonctionnalités
 * **Webhook Moneroo** : Il expose un point de terminaison /webhook/moneroo pour recevoir et traiter les notifications de paiement de Moneroo.
 * **Sécurité** : Il vérifie la signature HMAC des requêtes entrantes pour garantir qu'elles proviennent bien de Moneroo.
 * **Journalisation** : Il enregistre les détails des transactions reçues (ID, montant, devise, statut) dans la console pour le suivi et le débogage.
## Utilisation
Ce serveur est conçu pour être déployé et configuré avec votre secret Moneroo (MONEROO_WEBHOOK_SECRET) via une variable d'environnement pour maintenir la sécurité de vos accès.
Une fois ce texte copié, cliquez sur le bouton vert **« Commit changes... »** en haut à droite pour enregistrer votre présentation.
Avez-vous besoin d'aide pour configurer d'autres aspects de votre dépôt ?
