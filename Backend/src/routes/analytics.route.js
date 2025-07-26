const express = require('express');
const router = express.Router();
const {
    getUserAnalytics,
    getPlatformStats,
    getUserPerformanceMetrics
} = require('../controllers/analytics.controller');
const auth = require('../middlewares/auth.middleware');

// All routes require authentication
router.use(auth);

// User analytics routes
router.get('/user', getUserAnalytics);                    // Get user's comprehensive analytics
router.get('/user/performance', getUserPerformanceMetrics); // Get user's performance metrics

// Platform analytics routes  
router.get('/platform', getPlatformStats);               // Get platform-wide statistics

module.exports = router;
