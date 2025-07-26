const express = require('express');
const router = express.Router();
const {
    createReview,
    getUserReviews,
    getProductReviews,
    getReviewableItems,
    markReviewHelpful,
    getUserGivenReviews
} = require('../controllers/review.controller');
const auth = require('../middlewares/auth.middleware');

// All routes require authentication
router.use(auth);

// Review management routes
router.post('/create', createReview);                        // Create a review (sample or order)
router.get('/reviewable', getReviewableItems);               // Get items that can be reviewed
router.get('/my-reviews', getUserGivenReviews);              // Get reviews user has written
router.get('/user/:userId', getUserReviews);                 // Get reviews for a specific user
router.get('/product/:productId', getProductReviews);        // Get reviews for a specific product
router.patch('/:reviewId/helpful', markReviewHelpful);       // Mark review as helpful/not helpful

module.exports = router;
