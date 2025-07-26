const express = require('express');
const router = express.Router();
const {
    getUserNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification,
    getNotificationSummary,
    createNotification,
    getNotificationsByType
} = require('../controllers/notification.controller');
const auth = require('../middlewares/auth.middleware');

// All routes require authentication
router.use(auth);

// Notification routes
router.get('/', getUserNotifications);                           // Get user's notifications with filtering
router.get('/summary', getNotificationSummary);                 // Get notification summary for dashboard
router.get('/type/:type', getNotificationsByType);              // Get notifications by specific type
router.put('/:notificationId/read', markNotificationAsRead);    // Mark specific notification as read
router.put('/mark-all-read', markAllNotificationsAsRead);       // Mark all notifications as read
router.delete('/:notificationId', deleteNotification);          // Delete a notification
router.post('/create', createNotification);                     // Create notification (admin/system use)

module.exports = router;
