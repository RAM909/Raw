const express = require('express');
const router = express.Router();
const {
    createNegotiation,
    getUserNegotiations,
    getNegotiationDetails,
    sendNegotiationMessage,
    acceptNegotiationOffer,
    cancelNegotiation,
    getNegotiationStats
} = require('../controllers/negotiation.controller');
const auth = require('../middlewares/auth.middleware');

// All routes require authentication
router.use(auth);

// Negotiation CRUD routes
router.post('/create', createNegotiation);                           // Create a new negotiation
router.get('/my-negotiations', getUserNegotiations);                 // Get user's negotiations with filtering
router.get('/stats', getNegotiationStats);                          // Get negotiation statistics
router.get('/:negotiationId', getNegotiationDetails);               // Get specific negotiation details
router.post('/:negotiationId/message', sendNegotiationMessage);     // Send a message in negotiation
router.put('/:negotiationId/accept', acceptNegotiationOffer);       // Accept a price offer
router.put('/:negotiationId/cancel', cancelNegotiation);            // Cancel a negotiation

module.exports = router;
