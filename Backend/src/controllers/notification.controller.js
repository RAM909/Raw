const Notification = require('../models/Notification.model');
const asyncHandler = require('../utils/asynchandler');
const ApiResponse = require('../utils/apiResponse');
const ApiError = require('../utils/apiError');
const mongoose = require('mongoose');

// Get user's notifications with filtering and pagination
const getUserNotifications = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const {
        page = 1,
        limit = 20,
        category = 'all',
        isRead = 'all',
        actionRequired = 'all',
        priority = 'all'
    } = req.query;

    const skip = (page - 1) * limit;
    let query = { userId };

    // Apply filters
    if (category !== 'all') query.category = category;
    if (isRead !== 'all') query.isRead = isRead === 'true';
    if (actionRequired !== 'all') query.actionRequired = actionRequired === 'true';
    if (priority !== 'all') query.priority = priority;

    // Remove expired notifications
    query.$or = [
        { expiresAt: { $exists: false } },
        { expiresAt: { $gt: new Date() } }
    ];

    const [notifications, total, summary] = await Promise.all([
        Notification.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Number(limit))
            .lean(),
        Notification.countDocuments(query),
        Notification.getUserNotificationSummary(userId)
    ]);

    // Enhanced notifications with additional info
    const enhancedNotifications = notifications.map(notification => ({
        ...notification,
        timeAgo: getTimeAgo(notification.createdAt),
        priorityColor: getPriorityColor(notification.priority),
        typeIcon: getTypeIcon(notification.type),
        isExpired: notification.expiresAt && notification.expiresAt < new Date()
    }));

    res.status(200).json(
        new ApiResponse(200, {
            notifications: enhancedNotifications,
            summary,
            pagination: {
                current: Number(page),
                pages: Math.ceil(total / limit),
                total,
                hasNext: page < Math.ceil(total / limit),
                hasPrev: page > 1
            }
        }, 'Notifications fetched successfully')
    );
});

// Mark notification as read
const markNotificationAsRead = asyncHandler(async (req, res) => {
    const { notificationId } = req.params;
    const userId = req.user._id;

    const notification = await Notification.findOneAndUpdate(
        { _id: notificationId, userId },
        { 
            isRead: true,
            readAt: new Date()
        },
        { new: true }
    );

    if (!notification) {
        throw new ApiError(404, 'Notification not found');
    }

    res.status(200).json(
        new ApiResponse(200, notification, 'Notification marked as read')
    );
});

// Mark all notifications as read
const markAllNotificationsAsRead = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const result = await Notification.markAllAsRead(userId);

    res.status(200).json(
        new ApiResponse(200, { modifiedCount: result.modifiedCount }, 'All notifications marked as read')
    );
});

// Delete notification
const deleteNotification = asyncHandler(async (req, res) => {
    const { notificationId } = req.params;
    const userId = req.user._id;

    const notification = await Notification.findOneAndDelete({
        _id: notificationId,
        userId
    });

    if (!notification) {
        throw new ApiError(404, 'Notification not found');
    }

    res.status(200).json(
        new ApiResponse(200, null, 'Notification deleted successfully')
    );
});

// Get notification summary for dashboard
const getNotificationSummary = asyncHandler(async (req, res) => {
    const userId = req.user._id;

    const [summary, recentActionRequired, categoryBreakdown] = await Promise.all([
        Notification.getUserNotificationSummary(userId),
        
        // Get recent notifications that require action
        Notification.find({
            userId,
            actionRequired: true,
            isRead: false
        })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),

        // Get breakdown by category
        Notification.aggregate([
            { $match: { userId: new mongoose.Types.ObjectId(userId) } },
            {
                $group: {
                    _id: '$category',
                    total: { $sum: 1 },
                    unread: { $sum: { $cond: ['$isRead', 0, 1] } },
                    actionRequired: { $sum: { $cond: ['$actionRequired', 1, 0] } }
                }
            },
            { $sort: { total: -1 } }
        ])
    ]);

    res.status(200).json(
        new ApiResponse(200, {
            summary,
            recentActionRequired: recentActionRequired.map(notif => ({
                ...notif,
                timeAgo: getTimeAgo(notif.createdAt)
            })),
            categoryBreakdown
        }, 'Notification summary fetched successfully')
    );
});

// Create notification (for internal use/admin)
const createNotification = asyncHandler(async (req, res) => {
    const {
        userId,
        type,
        title,
        message,
        data = {},
        actionRequired = false,
        actionUrl,
        priority = 'medium',
        category = 'system',
        expiresAt
    } = req.body;

    const notification = await Notification.create({
        userId,
        type,
        title,
        message,
        data,
        actionRequired,
        actionUrl,
        priority,
        category,
        expiresAt
    });

    await notification.populate('userId', 'name username');

    res.status(201).json(
        new ApiResponse(201, notification, 'Notification created successfully')
    );
});

// Get notifications by type for specific workflows
const getNotificationsByType = asyncHandler(async (req, res) => {
    const { type } = req.params;
    const userId = req.user._id;
    const { limit = 10 } = req.query;

    const notifications = await Notification.find({
        userId,
        type,
        $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: { $gt: new Date() } }
        ]
    })
    .sort({ createdAt: -1 })
    .limit(Number(limit))
    .lean();

    const enhancedNotifications = notifications.map(notification => ({
        ...notification,
        timeAgo: getTimeAgo(notification.createdAt)
    }));

    res.status(200).json(
        new ApiResponse(200, enhancedNotifications, `${type} notifications fetched successfully`)
    );
});

// Helper functions
const getTimeAgo = (date) => {
    const seconds = Math.floor((new Date() - date) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 86400)}d ago`;
    
    return date.toLocaleDateString();
};

const getPriorityColor = (priority) => {
    switch (priority) {
        case 'urgent': return '#ff3838';
        case 'high': return '#ff6b35';
        case 'medium': return '#f7b731';
        case 'low': return '#5a95e1';
        default: return '#747d8c';
    }
};

const getTypeIcon = (type) => {
    const iconMap = {
        'material_request_response': '📝',
        'material_request_accepted': '✅',
        'material_request_rejected': '❌',
        'order_placed': '🛒',
        'order_confirmed': '✅',
        'order_shipped': '🚚',
        'order_completed': '🎉',
        'sample_request': '🧪',
        'sample_approved': '✅',
        'sample_delivered': '📦',
        'review_received': '⭐',
        'connection_request': '👥',
        'connection_accepted': '🤝',
        'system_announcement': '📢',
        'payment_received': '💰',
        'promotion': '🎁'
    };
    return iconMap[type] || '📬';
};

module.exports = {
    getUserNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification,
    getNotificationSummary,
    createNotification,
    getNotificationsByType
};
