const express = require('express');
const router = express.Router();
const {
    getUserStatistics,
    updateUserProfile,
    getConnections,
    sendConnectionRequest,
    respondToConnectionRequest,
    uploadProfilePicture,
    uploadCoverImage,
    getConnectionSuggestions,
    getUserOrderHistory,
    getUserReviewSections,
    getUserProductListings,
    getUserMaterialRequests,
    getUserNotificationSummary,
    getUserNegotiations
} = require('../controllers/userProfile.controller');
const auth = require('../middlewares/auth.middleware');
const upload = require('../middlewares/multer.middleware');

// All routes require authentication
router.use(auth);

// User profile routes
router.get('/statistics/:userId?', getUserStatistics);          // Get user statistics and analytics
router.put('/update', updateUserProfile);                       // Update user profile information
router.get('/connections', getConnections);                     // Get user connections list
router.post('/connections/request/:userId', sendConnectionRequest); // Send connection request
router.put('/connections/respond/:requestId', respondToConnectionRequest); // Accept/reject connection request
router.post('/upload/profile', upload.single('profilePicture'), uploadProfilePicture); // Upload profile picture
router.post('/upload/cover', upload.single('coverImage'), uploadCoverImage); // Upload cover image
router.get('/suggestions/connections', getConnectionSuggestions); // Get connection suggestions
router.get('/orders', getUserOrderHistory);                     // Get user's order history with enhanced details
router.get('/reviews', getUserReviewSections);                  // Get user's review sections (samples and orders)
router.get('/listings', getUserProductListings);                // Get user's product listings with analytics

// Material requests and notifications for profile
router.get('/material-requests', getUserMaterialRequests);       // Get user's material requests
router.get('/notifications/summary', getUserNotificationSummary); // Get user's notification summary

// Negotiations for profile
router.get('/negotiations', getUserNegotiations);                // Get user's negotiations

module.exports = router;
