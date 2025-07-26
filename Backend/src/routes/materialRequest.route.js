const express = require('express');
const router = express.Router();
const {
    createMaterialRequest,
    getMaterialRequests,
    acceptMaterialRequest,
    getUserMaterialRequests,
    getRequestResponses,
    acceptSellerResponse
} = require('../controllers/materialRequest.controller');
const auth = require('../middlewares/auth.middleware');

// All routes require authentication
router.use(auth);

// Material Request routes
router.post('/create', createMaterialRequest);                          // Create a new material request
router.get('/all', getMaterialRequests);                               // Get all material requests with filtering
router.post('/:requestId/accept', acceptMaterialRequest);              // Accept/respond to a material request
router.get('/my-requests', getUserMaterialRequests);                   // Get user's own material requests
router.get('/:requestId/responses', getRequestResponses);              // Get responses to a specific request
router.put('/response/:acceptanceId/action', acceptSellerResponse);    // Accept or reject a seller's response

module.exports = router;
