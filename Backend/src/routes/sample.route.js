const express = require('express');
const router = express.Router();
const {
    requestSample,
    requestSampleOneClick,
    getIncomingSampleRequests,
    getOutgoingSampleRequests,
    updateSampleRequestStatus,
    markSampleAsReceived,
    getSampleDashboard,
    getSampleDetails,
    uploadSampleImage,
    getSamplesByCategory,
    getUserSampleProfile,
    getSampleOrderDetails,
    checkSampleEligibility,
    getProductSampleHistory
} = require('../controllers/sample.controller');
const auth = require('../middlewares/auth.middleware');

// All routes require authentication
router.use(auth);

// Sample request routes
router.post('/request', requestSample);                           // Request a sample (detailed)
router.post('/request-one-click', requestSampleOneClick);         // One-click sample request (minimal input)
router.get('/check-eligibility', checkSampleEligibility);         // Check if user can request sample for a product
router.get('/incoming', getIncomingSampleRequests);               // Get incoming requests (for suppliers)
router.get('/outgoing', getOutgoingSampleRequests);               // Get outgoing requests (for receivers)
router.patch('/:id/status', updateSampleRequestStatus);           // Accept/reject sample request (supplier)
router.patch('/:id/received', markSampleAsReceived);              // Mark sample as received (receiver)

// Sample information routes
router.get('/dashboard', getSampleDashboard);                     // Get sample activity dashboard
router.get('/profile', getUserSampleProfile);                     // Get comprehensive user sample profile
router.get('/:id', getSampleDetails);                             // Get sample details by ID
router.get('/:id/order-details', getSampleOrderDetails);          // Get comprehensive sample order details
router.get('/product/:productId/history', getProductSampleHistory); // Get sample history for specific product
router.get('/category/:category', getSamplesByCategory);          // Get samples by category

// Sample image upload
router.patch('/:id/upload-image', uploadSampleImage);             // Upload/update sample image

module.exports = router;
