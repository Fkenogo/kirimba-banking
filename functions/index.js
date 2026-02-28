const functions = require("firebase-functions");

exports.healthCheck = functions.https.onRequest((req, res) => {
  res.status(200).send("KIRIMBA backend is running");
});